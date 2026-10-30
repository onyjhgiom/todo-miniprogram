/**
 * AI 链路体检（真实联网）
 *
 * 用途：当用户反馈「AI 调用不了」时，用一条命令定位到底断在哪一环：
 *   ① 后端档案（Key / base / model 是否解析出来）
 *   ② 云函数 aiStatus（前端用来点灯的探针）返回什么
 *   ③ 云函数 aiPlan（真正生成行程）返回什么
 *   ④ 绕过云函数、直接打上游，看最原始的 HTTP 状态码与响应体
 *
 * 与 check-travel-store.js 的区别：那是离线的（假 https），只验逻辑；
 * 这个是联网的（真 https），只验「上游真的能用吗」。两者互补。
 *
 * 用法：
 *   node scripts/ai-doctor.js              # 体检（会真实消耗极少量 token）
 *   node scripts/ai-doctor.js --no-upstream # 只查档案与 aiStatus，不发上游
 *
 * ⚠️ 本脚本会加载 cloudfunctions/travel/index.js 里**真实的内置兜底 Key**，
 *    因此输出里对 Key 只打前 8 位 + 后 4 位做脱敏。
 */

const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const NO_UPSTREAM = process.argv.indexOf('--no-upstream') >= 0;

/** 脱敏：ark-710ed02e-...-61b3f → ark-710e***b3f */
function maskKey(k) {
  const s = String(k || '');
  if (!s) return '(空)';
  if (s.length <= 12) return s.slice(0, 3) + '***';
  return s.slice(0, 8) + '***' + s.slice(-4);
}

/* ---------------- 用假 SDK 加载真实云函数（但保留真实 https） ---------------- */
function loadCloudFunction() {
  const collections = new Map();
  const db = {
    collection(name) {
      if (!collections.has(name)) collections.set(name, new Map());
      const map = collections.get(name);
      const api = {
        where() { return api; },
        orderBy() { return api; },
        limit() { return api; },
        skip() { return api; },
        field() { return api; },
        async get() { return { data: Array.from(map.values()) }; },
        async add({ data }) { const id = 'd' + (map.size + 1); map.set(id, Object.assign({}, data, { _id: id })); return { _id: id }; },
        doc(id) { return { async update() { map.set(id, Object.assign({}, map.get(id) || {}, {})); return { stats: { updated: 1 } }; }, async remove() { map.delete(id); return { stats: { removed: 1 } }; } }; },
        async remove() { return { stats: { removed: 0 } }; },
        async count() { return { total: map.size }; }
      };
      return api;
    },
    command: { inc: (n) => n },
    serverDate: () => new Date()
  };
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'ai-doctor' }),
    openapi: { subscribeMessage: { send: async () => ({}) } }
  };

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return sdk;
    return origLoad.call(this, request, parent, isMain);
  };
  const file = path.join(ROOT, 'cloudfunctions', 'travel', 'index.js');
  delete require.cache[require.resolve(file)];
  let mod;
  try {
    mod = require(file);
  } finally {
    Module._load = origLoad;
  }
  return mod;
}

/**
 * 抓包：包装 https.request，记录云函数内部每一次上游请求的入参与响应。
 * 这是定位「云函数说没返回有效行程、但同样的请求我手打却正常」的唯一办法 ——
 * 因为云函数内部不会把 raw content 打出来。
 */
function installHttpTrace() {
  const https = require('https');
  if (https.__aiTrace) return https.__aiTrace;
  const trace = [];
  const orig = https.request;
  https.request = function (opts, cb) {
    const rec = { host: (opts && opts.hostname) || '?', model: '', maxTokens: null, hasRF: false, status: 0, finish: '', content: '', resBody: '' };
    trace.push(rec);
    const req = orig.call(this, opts, function (res) {
      rec.status = res.statusCode;
      res.on('data', (c) => { rec.resBody += c; });
      if (cb) cb(res);
    });
    const ow = req.write.bind(req);
    req.write = function (d) {
      const s = String(d || '');
      try {
        const j = JSON.parse(s);
        rec.model = j.model || '';
        rec.maxTokens = j.max_tokens;
        rec.hasRF = !!(j.response_format && j.response_format.type);
      } catch (e) { /* 非 JSON body，忽略 */ }
      return ow(d);
    };
    return req;
  };
  https.__aiTrace = trace;
  return trace;
}

/** 绕开云函数，直接按云函数解析出的档案打上游，拿最原始的状态码与响应 */
function rawProbe(cfg, opts) {
  const o = opts || {};
  const https = require('https');
  const urlmod = require('url');
  const payload = {
    model: o.model || cfg.model,
    messages: o.messages || [{ role: 'user', content: 'hi' }],
    max_tokens: o.maxTokens || 8
  };
  if (o.responseFormat) payload.response_format = o.responseFormat;
  const body = JSON.stringify(payload);
  const u = urlmod.parse(`${cfg.base}/chat/completions`);
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${cfg.key}`
        }
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', (e) => resolve({ status: 0, body: `NETWORK: ${e && e.message}` }));
    req.setTimeout(60000, () => req.destroy(new Error('TIMEOUT')));
    req.write(body);
    req.end();
  });
}

/** 与云函数 aiPlan 逐字一致的提示词，用于「复刻请求」诊断 */
const PLAN_SYS =
  '你是资深旅行规划师。根据用户给出的目的地、天数、人均预算、同行组合、偏好场景，生成逐日行程。' +
  '每一天按「上午/下午/晚上」安排 3~5 个条目。每个条目包含：开始时间(HH:mm 24小时制)、' +
  '内容(简短标题)、类型(只能是 交通/景点/餐厅/酒店/购物/自定义 之一)、地点、预计花费(人民币数字,无则填0)、备注。' +
  '整体花费须控制在预算内，兼顾景点顺序、当地美食、演出文化活动、特色体验。' +
  '只输出 JSON，严格按如下结构：{"plan":[{"day":1,"items":[{"startTime":"09:00","content":"宽窄巷子","type":"景点","place":"宽窄巷子","cost":0,"note":""}]}]}。' +
  '不要输出任何解释文字或 markdown 围栏。';

(async () => {
  console.log('='.repeat(64));
  console.log('旅行 AI 链路体检（真实联网）');
  console.log('='.repeat(64));

  const mod = loadCloudFunction();
  if (!mod || typeof mod.main !== 'function') {
    console.error('✗ 云函数加载失败：exports.main 不存在');
    process.exit(1);
  }

  /* ---- ① 档案 ---- */
  console.log('\n① AI 档案（Key 已脱敏）');
  const st = await mod.main({ action: 'aiStatus' }, {});
  console.log('   aiStatus =', JSON.stringify(st));
  const provider = (st && st.provider) || {};
  console.log('   base     =', provider.base);
  console.log('   model    =', provider.model);
  console.log('   source   =', provider.source, provider.source === 'fallback' ? '(内置兜底 Key)' : '(环境变量)');
  console.log('   冷备      =', provider.backup ? '已启用' : '未启用');
  console.log('   TRAVEL_AI_KEY =', maskKey(process.env.TRAVEL_AI_KEY));
  console.log('   AI_API_KEY    =', maskKey(process.env.AI_API_KEY));

  if (NO_UPSTREAM) {
    console.log('\n(--no-upstream：跳过上游请求)');
    process.exit(0);
  }

  /* ---- ② 直接打上游 ---- */
  console.log('\n② 绕过云函数，直接请求上游（最原始的结果）');
  const cfg = { base: provider.base, model: provider.model, key: process.env.TRAVEL_AI_KEY || process.env.AI_API_KEY || '' };
  if (!cfg.key) {
    // 没配环境变量 → 用云函数的内置兜底（从 aiProviderInfo 无法拿到 Key，这里直接读源码常量）
    const src = require('fs').readFileSync(path.join(ROOT, 'cloudfunctions', 'travel', 'index.js'), 'utf8');
    const m = src.match(/const FALLBACK_API_KEY = '([^']+)'/);
    cfg.key = m ? m[1] : '';
    console.log('   使用源码内置兜底 Key:', maskKey(cfg.key));
  }
  const raw = await rawProbe(cfg);
  console.log('   HTTP', raw.status);
  console.log('   body:', raw.body.replace(/\s+/g, ' ').slice(0, 300));

  /* ---- ②′ 复刻 aiPlan 请求：看模型到底吐了什么 ---- */
  console.log('\n②′ 复刻 aiPlan 的真实请求（定位「未返回有效行程」）');
  const deep = await rawProbe(cfg, {
    messages: [
      { role: 'system', content: PLAN_SYS },
      { role: 'user', content: '目的地：成都\n天数：2 天\n人均预算：2000 元\n同行：朋友结伴\n偏好场景：美食' }
    ],
    maxTokens: 2200,
    responseFormat: { type: 'json_object' }
  });
  console.log('   HTTP', deep.status);
  let parsedBody = null;
  try { parsedBody = JSON.parse(deep.body); } catch (e) { /* 非 JSON（网关错误页等） */ }
  if (parsedBody && parsedBody.choices) {
    const ch = parsedBody.choices[0] || {};
    const content = (ch.message && ch.message.content) || '';
    console.log('   finish_reason =', ch.finish_reason);
    console.log('   usage =', JSON.stringify(parsedBody.usage || {}));
    console.log('   content 长度 =', content.length);
    console.log('   content 开头 200 字 =', JSON.stringify(content.slice(0, 200)));
    const noFence = content.replace(/```(?:json)?/gi, '').trim();
    const f = noFence.indexOf('{');
    const l = noFence.lastIndexOf('}');
    let parseOk = false;
    if (f >= 0 && l > f) {
      try { JSON.parse(noFence.slice(f, l + 1)); parseOk = true; } catch (e) { parseOk = false; }
    }
    console.log('   严格 JSON 可解析 =', parseOk ? '是' : '否');
    if (ch.finish_reason === 'length') {
      console.log('   ⚠️ finish_reason=length → 输出被 max_tokens 截断，JSON 不完整，必然解析失败');
    }
  } else {
    console.log('   body:', deep.body.replace(/\s+/g, ' ').slice(0, 400));
  }

  /* ---- ③ 云函数 aiPlan ---- */
  const REPEAT = (() => {
    const a = process.argv.find((x) => x.indexOf('--repeat=') === 0);
    return a ? Math.max(1, parseInt(a.split('=')[1], 10) || 1) : 1;
  })();
  console.log('\n③ 云函数 aiPlan（真实生成，' + (REPEAT > 1 ? REPEAT + ' 连跑' : '单次') + '，消耗极少量 token）');
  const trace = installHttpTrace();
  trace.length = 0; // 只保留 aiPlan 期间的请求
  const results = [];
  for (let i = 0; i < REPEAT; i += 1) {
    const t0 = Date.now();
    const p = await mod.main(
      { action: 'aiPlan', destination: '成都', days: 2, budget: 2000, members: ['朋友'], scenes: ['美食'] },
      {}
    );
    const rec = {
      ms: Date.now() - t0,
      ok: !!(p && p.ok),
      n: ((p && p.items) || []).length,
      msg: (p && p.message) || ''
    };
    results.push(rec);
    console.log(
      `   #${i + 1}  ${String(rec.ms).padStart(6)}ms  ok=${rec.ok}  items=${rec.n}  ${rec.msg}`
    );
  }
  const oks = results.filter((r) => r.ok);
  const msList = results.map((r) => r.ms);
  const avg = Math.round(msList.reduce((a, b) => a + b, 0) / msList.length);
  const slowest = Math.max.apply(null, msList);
  console.log(`   汇总：成功 ${oks.length}/${results.length}，平均 ${avg}ms，最慢 ${slowest}ms`);
  // 微信小程序 wx.cloud.callFunction 客户端侧等待上限为 20s，超过会被判为
  // -404012 polling exceed max timeout（本项目 cloud.ts 把它列入自动降级特征）。
  const overLimit = msList.filter((m) => m > 20000).length;
  if (overLimit) {
    console.log(`   ⚠️ ${overLimit}/${results.length} 次超过 20s 客户端上限 → 线上会以「调用超时」失败并降级到本地模式`);
  }

  /* ---- ③′ 云函数内部真实请求抓包 ---- */
  console.log('\n③′ 云函数内部向上游发了几次请求（抓包）');
  console.log('   共 ' + trace.length + ' 次');
  trace.forEach((r, i) => {
    let finish = '';
    let content = '';
    try {
      const j = JSON.parse(r.resBody);
      const ch = (j.choices && j.choices[0]) || {};
      finish = ch.finish_reason || '';
      content = (ch.message && ch.message.content) || JSON.stringify(j.error || j).slice(0, 200);
    } catch (e) {
      content = r.resBody.slice(0, 200) || '(空响应)';
    }
    console.log(`   [${i + 1}] ${r.host} HTTP ${r.status} model=${r.model} max_tokens=${r.maxTokens} response_format=${r.hasRF ? '有' : '无'}`);
    console.log(`       finish_reason=${finish} content长度=${content.length}`);
    console.log(`       content 开头 = ${JSON.stringify(content.slice(0, 160))}`);
  });

  /* ---- 汇总 ---- */
  console.log('\n' + '='.repeat(64));
  const rawOk = raw.status >= 200 && raw.status < 300;
  const allPlanOk = oks.length === results.length;
  if (rawOk && allPlanOk && !overLimit) {
    console.log('✓ 结论：上游、云函数、延迟全部正常。若小程序里仍调不通 → 云函数未重新部署。');
    process.exit(0);
  }
  if (rawOk && allPlanOk && overLimit) {
    console.log('✗ 结论：上游可用，但延迟超过 20s 客户端上限 —— 线上表现为「AI 调用不了」。需要降延迟。');
    process.exit(6);
  }
  if (raw.status === 401 || raw.status === 403) {
    console.log('✗ 结论：上游 401/403 —— Key 失效或无该模型权限。需更换 TRAVEL_AI_KEY。');
    process.exit(2);
  }
  if (raw.status === 404) {
    console.log('✗ 结论：上游 404 —— 模型名不存在或未开通。检查 AI_MODEL / TRAVEL_AI_MODEL，或换模型。');
    process.exit(3);
  }
  if (raw.status === 429) {
    console.log('✗ 结论：上游 429 —— 限流或欠费。');
    process.exit(4);
  }
  console.log('✗ 结论：上游返回异常（HTTP ' + raw.status + '）。详见上方 body。');
  process.exit(5);
})().catch((e) => {
  console.error('体检脚本异常：', e);
  process.exit(1);
});
