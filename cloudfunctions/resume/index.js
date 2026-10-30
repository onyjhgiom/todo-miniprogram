// 云函数 resume
// 把小程序 canvas 导出的简历页图（JPEG）封装成标准 PDF。
//
// 为什么这么做：
//   在云函数里直接用 PDF 库写中文需要嵌入中文字体（体积数 MB、还要处理授权与子集化）。
//   而「canvas 渲染 → 整页 JPEG → 以 DCTDecode 嵌入 PDF」完全绕开字体问题：
//   canvas 用系统字体渲染中文，天然不乱码；PDF 只负责把图片摆到页面上。
//
// 实现方式：手写最小 PDF 结构（Catalog / Pages / Page / Image XObject / Contents），
// 零第三方依赖，装完即可上传部署。产出的 PDF 可被 wx.openDocument 打开、转发与打印。
//
// 已知取舍：文字是位图，不可复制搜索。对「投递用的一页纸简历」这个场景可接受；
// 若未来需要可选中文字，需要改为嵌入 CJK 字体 + pdfkit 的方案。

const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/* ==================== JPEG 尺寸解析 ==================== */

/**
 * 从 JPEG 二进制里读出宽高（解析 SOF 段）。
 * 不引第三方库，只处理标准基线/渐进式 JPEG 即可满足 canvas 导出场景。
 */
function jpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // 不是 JPEG
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // 填充字节
    if (marker === 0xff) { i++; continue; }
    // SOI / EOI / TEM / RSTn 无长度字段
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9) break;
    // SOF0~SOF15（0xC0~0xCF，排除 C4/DHT、C8/JPG、CC/DAC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (width > 0 && height > 0) return { width, height };
    }
    const segLen = buf.readUInt16BE(i + 2);
    if (!segLen || segLen < 2) break;
    i += 2 + segLen;
  }
  return null;
}

/* ==================== 最小 PDF 构造 ==================== */

/**
 * 把若干张 JPEG 组装成一个 PDF（一图一页）。
 * @param {Array<{buffer: Buffer, width: number, height: number}>} images
 * @returns {Buffer}
 */
function buildPdf(images) {
  const objects = []; // 1-based 在写入时处理

  // 目录结构：1=Catalog, 2=Pages, 之后每页 3 个对象：Page / Contents / Image
  const pageCount = images.length;
  // 对象编号分配
  const CATALOG = 1;
  const PAGES = 2;
  const firstPageObj = 3;

  const chunks = [];
  let offset = 0;
  const offsets = []; // offsets[objNum] = byte offset

  const push = (str) => {
    const b = Buffer.from(str, 'latin1');
    chunks.push(b);
    offset += b.length;
  };
  const pushBuf = (b) => {
    chunks.push(b);
    offset += b.length;
  };

  push('%PDF-1.4\n');
  // 二进制标记，避免被当成文本处理
  push('%âãÏÓ\n');

  const writeObj = (num, body, streamBuf) => {
    offsets[num] = offset;
    push(`${num} 0 obj\n${body}\n`);
    if (streamBuf) {
      push(`stream\n`);
      pushBuf(streamBuf);
      push(`\nendstream\n`);
    }
    push(`endobj\n`);
  };

  // 占位：先按顺序写，Pages 的 Kids 需要提前知道编号
  const pageObjNums = [];
  for (let p = 0; p < pageCount; p++) {
    pageObjNums.push(firstPageObj + p * 3);
  }

  // 1 Catalog
  writeObj(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R >>`);
  // 2 Pages
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(' ');
  writeObj(PAGES, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);

  for (let p = 0; p < pageCount; p++) {
    const img = images[p];
    const pageObj = pageObjNums[p];
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;

    // 页面尺寸：图片按 96dpi 换算成 pt（1px = 0.75pt），保证与屏幕观感一致
    const pw = Math.round(img.width * 0.75);
    const ph = Math.round(img.height * 0.75);

    // Page
    writeObj(
      pageObj,
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
        `/Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`
    );

    // Contents：把图片铺满整页
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q\n`;
    writeObj(contentObj, `<< /Length ${Buffer.byteLength(content, 'latin1')} >>`, Buffer.from(content, 'latin1'));

    // Image XObject
    const imgDict =
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.buffer.length} >>`;
    writeObj(imageObj, imgDict, img.buffer);
  }

  // xref
  const maxObj = firstPageObj + pageCount * 3 - 1;
  const xrefOffset = offset;
  let xref = `xref\n0 ${maxObj + 1}\n`;
  xref += `0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n++) {
    const off = offsets[n] === undefined ? 0 : offsets[n];
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${maxObj + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

/* ==================== AI 补充润色（智谱 GLM） ==================== */
//
// action=enhance：把用户的草稿简历发给大模型，在不虚构经历的前提下扩充 / 量化 / 润色，
// 产出一份可用于秋招投递的完整简历 JSON，由小程序侧回填表单后再渲染成 PDF。
//
// 配置（云函数环境变量，选填；未配时使用下方内置兜底 Key，与 helperChat/goalPlanner 等云函数同款）：
//   AI_API_KEY      选填。主档案 Key，优先级最高（配了则覆盖内置兜底）
//   ZHIPU_API_KEY    选填。次选（兼容旧约定）
//   AI_API_BASE      选填。默认 https://ark.cn-beijing.volces.com/api/v3（火山方舟）
//   AI_MODEL         选填。默认 doubao-seed-2-1-pro-260915（推理模型，约 2-5s；JSON 合规）
//   AI_TIMEOUT_MS    选填。单次上游超时，默认 45000
// ⚠️ 超时是命门：请到云开发控制台把本云函数超时设为 60 秒，否则高峰期会被平台强杀。
//
// 主档案 = 火山方舟（豆包）；智谱 GLM 降级为「冷备」：
// 已验证（2026-09-28）doubao-seed-2-1-pro-260915 支持 chat/completions + response_format=json_object，
// 简历润色 JSON 返回稳定；冷备为智谱 GLM，方舟整体失败时自动切换。

const AI_DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
// 内置兜底 Key：与本项目其他 AI 云函数（civilAI/helperChat/goalPlanner/travel…）同一把火山方舟 Key，
// 上传部署即可用；若在云开发控制台配置了 AI_API_KEY 环境变量则优先用环境变量。
const AI_FALLBACK_KEY = '';
const AI_MODELS = ['doubao-seed-2-1-pro-260915', 'doubao-seed-character-260628'];

/** 冷备档案：主档案（火山方舟）整体失败时顶上 */
const AI_BACKUP = {
  base: (process.env.AI_BACKUP_BASE || 'https://open.bigmodel.cn/api/paas/v4').trim().replace(/\/+$/, ''),
  // 冷备 Key 同样走环境变量 AI_BACKUP_KEY，不写死任何 Key
  key: (process.env.AI_BACKUP_KEY || '').trim(),
  models: ['glm-4.6', 'glm-4-flash'],
  // AI_BACKUP_DISABLE=1 可关闭冷备（单供应商排障 / 离线自检时用）
  enabled: (process.env.AI_BACKUP_DISABLE || '').trim() !== '1'
};

function aiKey() {
  return process.env.AI_API_KEY || process.env.ZHIPU_API_KEY || AI_FALLBACK_KEY;
}
function aiBase() {
  return (process.env.AI_API_BASE || AI_DEFAULT_BASE).replace(/\/$/, '');
}
function aiModel() {
  return process.env.AI_MODEL || AI_MODELS[0];
}

/** 是否属于「换一家供应商还有救」的失败（Key 失效 / 欠费 / 模型下线 / 网络不通）。
 *  参数类错误（400/422）不切换——换一家同样报错，只会白等一轮。 */
function isProviderLevelFailure(err) {
  const msg = (err && err.message) || '';
  if (/TIMEOUT/i.test(msg)) return false; // 预算已耗尽，再打一发必然还是超时
  if (/返回 400|返回 422/.test(msg)) return false;
  return /返回 (401|402|403|404|429)|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(msg);
}

function httpsPostJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      timeout: timeoutMs,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }, headers)
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: buf }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('AI 请求超时')); });
    req.write(data);
    req.end();
  });
}

async function callLLM(messages) {
  const key = aiKey();
  if (!key || key === 'AI_NOT_CONFIGURED') {
    throw new Error('AI 未配置（请在云函数环境变量配置 AI_API_KEY）');
  }

  // 依次尝试的档案：主档案 → 冷备（主档案本身就是冷备时不重复挂）
  const plans = [{
    base: aiBase(),
    key,
    models: [aiModel(), ...AI_MODELS].filter((m, i, a) => m && a.indexOf(m) === i)
  }];
  if (AI_BACKUP.enabled && AI_BACKUP.key && plans[0].base !== AI_BACKUP.base) {
    plans.push({ base: AI_BACKUP.base, key: AI_BACKUP.key, models: AI_BACKUP.models.slice() });
  }

  let lastErr = null;
  for (let i = 0; i < plans.length; i++) {
    try {
      return await callModelOnce(plans[i], messages);
    } catch (e) {
      lastErr = e;
      if (i < plans.length - 1 && isProviderLevelFailure(e)) {
        console.warn('[resume] 主档案失败（' + ((e && e.message) || '') + '），切换冷备重试');
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('AI 调用失败');
}

async function callModelOnce(plan, messages) {
  const key = plan.key;
  const base = plan.base;
  const models = plan.models;
  let lastErr;
  for (const model of models) {
    try {
      const r = await httpsPostJson(
        `${base}/chat/completions`,
        { Authorization: `Bearer ${key}` },
        {
          model,
          messages,
          temperature: 0.7,
          response_format: { type: 'json_object' }
        },
        Math.max(8000, Number(process.env.AI_TIMEOUT_MS) || 45000)
      );
      if (r.status && r.status >= 200 && r.status < 300) {
        const j = JSON.parse(r.text);
        const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!content) throw new Error('AI 返回内容为空');
        return content;
      }
      lastErr = new Error(`模型 ${model} 返回 ${r.status}: ${String(r.text).slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('AI 调用失败');
}

/**
 * 岗位上下文指令：把目标岗位、JD 关键词、已命中 / 缺失关键词交给模型，
 * 让它按岗位调整措辞侧重点。只影响「怎么表达」，不影响「有什么事实」——
 * 本地编排层负责取舍与排序，这里只负责润色与扩充。
 */
function jobDirective(job) {
  if (!job || typeof job !== 'object') return '';
  const target = String(job.target || '').trim();
  const kws = Array.isArray(job.keywords) ? job.keywords.filter(Boolean).slice(0, 12) : [];
  const hits = Array.isArray(job.hits) ? job.hits.filter(Boolean).slice(0, 8) : [];
  const gaps = Array.isArray(job.gaps) ? job.gaps.filter(Boolean).slice(0, 8) : [];
  if (!target && !kws.length) return '';

  let s = `\n本次目标岗位：${target || '未指定'}`;
  if (kws.length) s += `（JD 关键词：${kws.join('、')}）`;
  s += '。请在不改变任何事实的前提下，让与该岗位最相关的经历在措辞上更贴近岗位语言' +
    '（使用行业术语、突出对应能力）；不相关的经历保持原样，不要强行往岗位上靠。\n';
  if (hits.length) s += `简历里已经命中这些关键词：${hits.join('、')} —— 这些经历优先扩充、写得更具体。\n`;
  if (gaps.length) {
    s += `这些关键词在简历里没有出现：${gaps.join('、')}。` +
      '如果用户的原始经历里确实有对应内容，就在措辞上点出来；' +
      '如果完全没有，**严禁编造或暗示用户具备该能力**，只能忽略。\n';
  }
  return s;
}

async function enhanceResume(profile, lang, job) {
  const isEn = lang === 'en';
  const jobLine = jobDirective(job);
  const sys = isEn
    ? 'You are a senior HR / resume consultant. The user gives you a draft resume (possibly very brief). Without fabricating experiences, expand and polish it into a professional, complete, ready-to-submit resume IN ENGLISH.\n' +
      'Requirements:\n' +
      '1. Keep the real company/school/project names, positions and dates unchanged (minor wording tweaks allowed; never fabricate or exaggerate).\n' +
      '2. Expand each experience to 2-4 bullets using the STAR structure, quantified whenever possible (numbers / percentages / outcomes), professional and concise.\n' +
      '3. Produce a professional "skills" paragraph and a "summary" paragraph; if the user already provided them, polish on top — never delete real information.\n' +
      '4. Keep headline / expected salary / expected city / contacts as-is unless clearly improvable.\n' +
      '5. CRITICAL section order: education (edu) first, then internships (intern) / projects (proj), then anything else. Never put skills, summary or other sections before education.\n' +
      '6. Output JSON only, exactly this structure, no explanatory text:\n' +
      '{"name":string,"headline":string,"salary":string,"city":string,"contacts":string,' +
      '"skills":string,"summary":string,' +
      '"sections":[{"key":string,"title":string,"items":[{"primary":string,"secondary":string,"meta":string,"bullets":[string]}]}]}' +
      '\n7. NEVER output placeholders: no XX, ____, TBD, "your name", name@example.com. If a field is missing and cannot be inferred, output an empty string — never fabricate, never leave a placeholder.\n' +
      '8. Consistent tone: third person / verb-first bullet style throughout (resume convention). Never use "I" or "my". Plain and professional, no adjective piling.\n' +
      '9. Length control: 2-4 bullets per experience, max 60 words each, max 20 bullets total.\n' +
      '10. Never invent numbers the user did not provide. Put the most job-relevant bullet of each experience first.' +
      jobLine
    : '你是资深 HR / 简历顾问。用户会给你一份草稿简历（可能很简略）。请在不编造虚假经历的前提下，' +
      '把内容扩充、润色成一份专业、完整、可用于秋招投递的中文简历。\n' +
      '要求：\n' +
      '1. 保持用户提供的真实公司/学校/项目名、岗位、时间不变（可微调措辞，但不得虚构或夸大事实）。\n' +
      '2. 每个经历的 bullets 扩充为 2-4 条，用 STAR 思路，尽量量化（数字/比例/结果），语言专业、简洁。\n' +
      '3. 生成一段专业的「技能与证书」(skills) 与「自我评价」(summary)；若用户已提供则在其基础上润色补充，不得删除真实信息。\n' +
      '4. 求职意向(headline)、期望薪资(salary)、期望城市(city)、联系方式(contacts) 保留用户原值，仅在明显可优化时微调。\n' +
      '5. 小节顺序硬性要求：教育背景(edu) 必须在最前，其次实习(intern)/项目(proj)，其它小节放最后；' +
      '禁止把技能、自我评价或任何英文内容段排到最前面（技术名词/缩写可保留英文，但正文必须中文）。\n' +
      '6. 只输出 JSON，结构严格如下，不要任何解释性文字：\n' +
      '{"name":string,"headline":string,"salary":string,"city":string,"contacts":string,' +
      '"skills":string,"summary":string,' +
      '"sections":[{"key":string,"title":string,"items":[{"primary":string,"secondary":string,"meta":string,"bullets":[string]}]}]}' +
      '\n7. 严禁占位符：不得出现 XX、____、此处填写、待补充、你的名字、name@example.com 等模板痕迹；' +
      '用户未提供且无法推断的字段直接输出空字符串，不得编造，也不得留占位提示。\n' +
      '8. 语气统一：全文用第三人称 / 无主语句式（简历惯例），禁止出现「我」「本人」；平实专业，不堆砌形容词。\n' +
      '9. 篇幅控制：每段经历 bullets 2-4 条、每条不超过 60 字，全文要点总数不超过 20 条。\n' +
      '10. 每条 bullet 尽量写成「动作 + 对象 + 量化结果」的闭环；用户没给数字的不要替他编数字，' +
      '可写成「显著提升 / 明显下降」等定性表述，但不得出现具体百分比或金额。\n' +
      '11. 与岗位最相关的那段经历的要点排在该段的最前面（顺序也是表达的一部分）。' +
      jobLine;

  const content = await callLLM([
    { role: 'system', content: sys },
    { role: 'user', content: JSON.stringify({ lang: isEn ? 'en' : 'zh', profile, job: job || null }) }
  ]);
  let txt = String(content).trim();
  const s = txt.indexOf('{');
  const e = txt.lastIndexOf('}');
  if (s >= 0 && e > s) txt = txt.slice(s, e + 1);
  return JSON.parse(txt);
}

/* ==================== 入口 ==================== */

exports.main = async (event) => {
  // ⚠️ job 必须一起解构：它是「目标岗位 + JD 关键词」上下文，
  // 漏掉会直接抛 ReferenceError，表现为「AI 润色必失败且报不出原因」。
  const { action, fileIDs, cloudPath, profile, lang, job } = event || {};
  try {
    // AI 补充润色：先把草稿扩充成完整简历 JSON（lang 控制输出语言，zh=中文默认）
    if (action === 'enhance') {
      if (!profile || typeof profile !== 'object') {
        return { success: false, error: '缺少 profile' };
      }
      try {
        const enriched = await enhanceResume(profile, lang, job || null);
        return { success: true, profile: enriched };
      } catch (err) {
        return { success: false, error: (err && err.message) ? err.message : String(err) };
      }
    }

    if (action !== 'pdf') {
      return { success: false, error: `未知 action: ${action}` };
    }
    if (!Array.isArray(fileIDs) || fileIDs.length === 0) {
      return { success: false, error: '缺少 fileIDs' };
    }

    // 1) 逐页下载小程序上传的页图
    const images = [];
    for (const fid of fileIDs) {
      const res = await cloud.downloadFile({ fileID: fid });
      const buf = res && res.fileContent;
      if (!buf) continue;
      const size = jpegSize(buf);
      // 解析失败时退化为一个常见比例，避免整份 PDF 生成失败
      images.push({
        buffer: buf,
        width: size ? size.width : 750,
        height: size ? size.height : 1060
      });
    }
    if (images.length === 0) {
      return { success: false, error: '页图下载失败' };
    }

    // 2) 组装 PDF
    const pdf = buildPdf(images);

    // 3) 上传云存储，返回 fileID 供 wx.openDocument 使用
    const name = `resumes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
    const up = await cloud.uploadFile({
      cloudPath: cloudPath || name,
      fileContent: pdf
    });

    // 4) 顺手清理临时的页图，避免云存储堆积
    for (const fid of fileIDs) {
      try {
        await cloud.deleteFile({ fileList: [fid] });
      } catch (e) {
        // 清理失败不影响结果
      }
    }

    return {
      success: true,
      fileID: up && up.fileID,
      pages: images.length,
      size: pdf.length
    };
  } catch (err) {
    console.error('[resume] error:', err);
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
};
