// 云函数 civilAI —— 仕途衡鉴（体制内模块）AI 能力
//
// 四个 action：
//   assess    体质内赛道测评：按专业 / 学历 / 党员 / 应届 / 偏好，给出四赛道适配分与报考组合
//   plan      备考计划生成：按赛道 + 目标 + 每周可投入小时 + 当前月份，生成周计划 / 月目标
//   interview 面试模拟点评：结构化 / 半结构化 / 群面，按体制内评分逻辑逐条点评
//   polish    简历优化：把普通简历文案改成国企 / 公考风（严谨、政审偏好）
//
// 设计原则（与项目既有 helperChat 保持一致，便于统一运维）：
//   1. 多供应商：智谱 / DeepSeek / 任意 OpenAI 兼容端点（按 AI_API_BASE 自动判定）
//   2. 模型候选链：主模型不可用时自动顺延，避免「某个模型未开通 → 整条链路挂掉」
//   3. 超时预算收敛：按平台剩余预算收敛上游超时，避免被强杀成没有指向性的 -504003
//   4. 优雅降级：未配 Key / 调用失败时返回 AI_NOT_CONFIGURED / 具体原因，
//      客户端自动回退到本地规则引擎（civil-strategy.ts 的 assessLocal / buildPlanLocal）
//
// 配置（云函数环境变量；已内置兜底 Key，完全不配也能直接用）：
//   AI_API_KEY      选填。API Key；不配则用源码里的 FALLBACK_API_KEY
//   AI_API_BASE     选填。默认 https://ark.cn-beijing.volces.com/api/v3（火山方舟）
//   AI_PROVIDER     选填。ark | zhipu | deepseek | openai
//   AI_MODEL        选填。默认按供应商取候选链首位（方舟首位 doubao-seed-character-260628）
//   AI_THINKING     选填。enabled | disabled，默认 disabled（关思考快很多）
//   AI_TIMEOUT_MS   选填。单次上游请求超时（毫秒），默认 45000
//
// 主档案 = 火山方舟（豆包），冷备 = 智谱 GLM：
//   实测（2026-09-14）豆包 doubao-seed-character-260628 空跑 1.0s、长 JSON 4.3s，
//   智谱 glm-4.6 空跑要 11-14s。方舟整体失败（Key 失效 / 欠费 / 模型下线 / 网络不通）
//   时自动切到智谱再打一遍，避免一个 Key 出问题就让整个模块降级成本地规则。
//
// ⚠️ 超时是这条链路的命门：微信云开发云函数**默认超时只有 20 秒**，而云函数目录下
//    config.json 里的 timeout 未必随部署生效（本项目实测踩过：写了 60 仍是默认值）。
//    → 请到 云开发控制台 → 云函数 → civilAI → 版本与配置，把超时时间设为 60 秒。

const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

/** 兜底 Key：优先读环境变量，没配时用这里，做到「上传即可用」。
 *  ⚠️ 服务端代码，Key 不会下发到客户端；但若仓库对外分发会随代码泄露。
 *     生产建议：在云函数环境变量里配 AI_API_KEY，然后把下面清空。 */
const FALLBACK_API_KEY = '';

/** 冷备档案：主档案（火山方舟）整体失败时顶上 */
const AI_BACKUP = {
  provider: (process.env.AI_BACKUP_PROVIDER || 'zhipu').trim(),
  base: (process.env.AI_BACKUP_BASE || 'https://open.bigmodel.cn/api/paas/v4').trim().replace(/\/+$/, ''),
  key: (process.env.AI_BACKUP_KEY || '').trim(),
  models: ['glm-4.6', 'glm-4-flash'],
  // AI_BACKUP_DISABLE=1 可关闭冷备（单供应商排障 / 离线自检时用）
  enabled: (process.env.AI_BACKUP_DISABLE || '').trim() !== '1'
};

const REQUEST_TIMEOUT = Math.max(5000, Number(process.env.AI_TIMEOUT_MS) || 45000);

/* ============================ 供应商与模型 ============================ */

const PROVIDERS = ['zhipu', 'deepseek', 'ark', 'openai'];

function resolveProvider(base) {
  const forced = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (forced && PROVIDERS.indexOf(forced) >= 0) return forced;
  if (/bigmodel\.cn|zhipu|paas\/v4/i.test(base)) return 'zhipu';
  if (/deepseek\.com/i.test(base)) return 'deepseek';
  if (/volces\.com|ark\.cn|bytedance/i.test(base)) return 'ark';
  return 'openai';
}

/**
 * 模型候选链：按「快 → 稳」排序。
 * 方舟实测（2026-09）：doubao-seed-character-260628 空跑 1.0s、长 JSON 4.3s，JSON 合规；
 *                     doubao-seed-evolving 约 4.0s。doubao-seed-1.6 在本账号下 404（未开通）。
 * 智谱实测：glm-4.6 + thinking:disabled 原本约 2.6s，2026-09-14 复测已劣化到 11-14s，
 *           故整体降级为冷备；glm-5.3 系列强制思考（传 disabled 报 1210），排在最后。
 */
const MODEL_CHAIN = {
  zhipu: ['glm-4.6', 'glm-4-flash', 'glm-5.3-flash', 'glm-5.3'],
  deepseek: ['deepseek-chat'],
  ark: ['doubao-seed-character-260628', 'doubao-seed-evolving'],
  openai: []
};

function candidateModels(provider, configured) {
  const chain = MODEL_CHAIN[provider] || [];
  const out = [];
  const push = (m) => {
    const v = (m || '').trim();
    if (v && out.indexOf(v) < 0) out.push(v);
  };
  push(configured);
  chain.forEach(push);
  return out;
}

/* ============================ 基础工具 ============================ */

function clampText(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function clampStrList(arr, maxItems, maxLen) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    const s = clampText(it, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function nowCn(now) {
  const d = new Date(now + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function currentMonth(now) {
  return new Date(now + 8 * 3600 * 1000).getUTCMonth() + 1;
}

/* ============================ 时间预算 ============================ */

function remainingBudgetMs(context) {
  try {
    if (context && typeof context.getRemainingTimeInMillis === 'function') {
      const v = Number(context.getRemainingTimeInMillis());
      if (isFinite(v) && v > 0) return v;
    }
  } catch (_e) { /* 平台不支持，降级 */ }
  return null;
}

const BUDGET_MARGIN = 700;
const MIN_USABLE_BUDGET = 1200;

function budgetedTimeout(context) {
  const budget = remainingBudgetMs(context);
  if (budget === null) return REQUEST_TIMEOUT;
  return Math.max(600, Math.min(REQUEST_TIMEOUT, Math.round(budget - BUDGET_MARGIN)));
}

function budgetTooLow(context) {
  const budget = remainingBudgetMs(context);
  if (budget === null) return null;
  if (budget >= MIN_USABLE_BUDGET) return null;
  return {
    success: false,
    error: 'AI_TIMEOUT_BUDGET',
    message:
      '云函数超时时间过短（本次可用不足 1.2 秒），模型来不及返回。' +
      '请在云开发控制台 → 云函数 → civilAI → 版本与配置，把超时时间改为 60 秒。',
    budgetMs: budget
  };
}

/* ============================ HTTP ============================ */

function requestJSON(url, payload, apiKey, timeoutMs) {
  const body = JSON.stringify(payload);
  const isHttps = url.indexOf('https://') === 0;
  const lib = isHttps ? https : http;
  const u = new URL(url);

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: Math.max(500, Number(timeoutMs) || REQUEST_TIMEOUT)
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let detail = '';
            let code = '';
            try {
              const j = JSON.parse(data);
              detail = (j && j.error && (j.error.message || j.error.type)) || '';
              code = (j && j.error && j.error.code) || '';
            } catch (e) {
              detail = String(data).slice(0, 160);
            }
            const err = new Error(`UPSTREAM_${res.statusCode}${detail ? ':' + detail : ''}`);
            err.statusCode = res.statusCode;
            err.upstreamCode = code;
            err.upstreamDetail = detail;
            reject(err);
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('模型返回内容无法解析'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

function isModelUnavailable(err) {
  if (!err) return false;
  const msg = `${err.message || ''} ${err.upstreamDetail || ''} ${err.upstreamCode || ''}`;
  if (/ModelNotOpen|InvalidEndpointOrModel|model[\s_-]*not[\s_-]*found|模型不存在|未开通|not\s*subscribed|no\s*permission\s*to\s*access\s*model/i.test(msg)) {
    return true;
  }
  return err.statusCode === 404;
}

/** thinking 参数不被支持时去掉后重试（只按文案判断，不按错误码 1210） */
function isThinkingUnsupported(err) {
  if (!err) return false;
  if (err.statusCode !== 400 && err.statusCode !== 422) return false;
  return /thinking|reasoning|思考/i.test(`${err.message || ''} ${err.upstreamDetail || ''}`);
}

async function requestOnce(base, apiKey, model, payloadBase, thinking, timeoutMs) {
  const payload = { ...payloadBase, model };
  if (thinking) payload.thinking = { type: thinking };
  try {
    return await requestJSON(`${base}/chat/completions`, payload, apiKey, timeoutMs);
  } catch (err) {
    if (thinking && isThinkingUnsupported(err)) {
      console.warn('[civilAI] 服务端不支持 thinking 参数，去掉后重试');
      const plain = { ...payloadBase, model };
      return await requestJSON(`${base}/chat/completions`, plain, apiKey, timeoutMs);
    }
    throw err;
  }
}

async function requestWithFallback(base, apiKey, models, payloadBase, thinking, timeoutMs) {
  const canRetry = !timeoutMs || timeoutMs > 1500;
  let lastErr = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const resp = await requestOnce(base, apiKey, model, payloadBase, thinking, timeoutMs);
      return { resp, model };
    } catch (err) {
      lastErr = err;
      if (!isModelUnavailable(err)) throw err;
      if (!canRetry) throw err;
      console.warn(`[civilAI] 模型「${model}」不可用，顺延下一个：`, err.message);
    }
  }
  const e = lastErr || new Error('NO_MODEL_AVAILABLE');
  e.noModelAvailable = true;
  throw e;
}

/* ============================ 跨供应商冷备 ============================ */

/** 是否属于「换一家供应商还有救」的失败（Key 失效 / 欠费 / 模型下线 / 网络不通）。
 *  参数类错误（400/422）不切换——换一家同样报错，只会白等一轮。 */
function isProviderLevelFailure(err) {
  if (!err) return false;
  if (err.noModelAvailable) return true;
  const msg = `${err.message || ''} ${err.upstreamDetail || ''}`;
  if (/TIMEOUT/i.test(err.message || '')) return false; // 预算已耗尽，再打一发必然还是超时
  if (err.statusCode === 400 || err.statusCode === 422) return false;
  if (err.statusCode === 401 || err.statusCode === 402 || err.statusCode === 403
    || err.statusCode === 404 || err.statusCode === 429) return true;
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(msg);
}

/** 主档案 → 冷备 依次尝试；返回 { resp, model, provider } */
async function requestAcrossProviders(apiBase, apiKey, models, payload, thinking, context) {
  const attempts = [{ provider: resolveProvider(apiBase), base: apiBase, key: apiKey, models }];
  if (AI_BACKUP.enabled && AI_BACKUP.key && apiBase !== AI_BACKUP.base) {
    attempts.push({
      provider: AI_BACKUP.provider,
      base: AI_BACKUP.base,
      key: AI_BACKUP.key,
      models: AI_BACKUP.models.slice()
    });
  }

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    try {
      const r = await requestWithFallback(a.base, a.key, a.models, payload, thinking, budgetedTimeout(context));
      return { resp: r.resp, model: r.model, provider: a.provider };
    } catch (err) {
      lastErr = err;
      const budget = remainingBudgetMs(context);
      const canRetry = budget === null || budget > 9000; // 预算不够就别再打第二家
      if (i < attempts.length - 1 && canRetry && isProviderLevelFailure(err)) {
        console.warn('[civilAI] 主档案失败（' + ((err && err.message) || '') + '），切换智谱冷备重试');
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('AI 调用失败');
}

/* ============================ 输出解析 ============================ */

function extractJSON(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function describeUpstream(err) {
  const msg = (err && err.message) || '';
  const code = err && err.statusCode;

  if (err && err.noModelAvailable) {
    return { error: 'AI_MODEL_UNAVAILABLE', message: '当前账号下没有可用的对话模型，请在模型平台开通后再试' };
  }
  if (code === 402 || /insufficient\s*balance|余额|quota/i.test(msg)) {
    return { error: 'AI_BALANCE', message: 'AI 账户余额不足，请充值后重试' };
  }
  if (code === 401 || code === 403) {
    return { error: 'AI_AUTH', message: 'API Key 无效或无权限，请检查 AI_API_KEY' };
  }
  if (code === 429) {
    return { error: 'AI_RATE_LIMIT', message: 'AI 请求过于频繁，请稍后再试' };
  }
  if (code === 404) {
    return { error: 'AI_MODEL_UNAVAILABLE', message: '模型不可用，请检查 AI_MODEL 配置' };
  }
  if (code === 400 || code === 422) {
    return {
      error: 'AI_BAD_REQUEST',
      message: `模型拒绝了请求（${msg.replace(/^UPSTREAM_\d+:?/, '') || '参数不合规'}）`
    };
  }
  if (msg === 'TIMEOUT') return { error: 'AI_TIMEOUT', message: 'AI 响应超时，请稍后重试' };
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|网络/.test(msg)) {
    return { error: 'AI_NETWORK', message: '无法连接 AI 服务，请稍后重试' };
  }
  return { error: 'AI_ERROR', message: msg || 'AI 服务异常' };
}

/* ============================ 赛道元信息（服务端静态表） ============================ */

/** 与客户端 civil-data.ts 的四条赛道保持一致（只用 key/name/color，避免服务端依赖客户端代码） */
const TRACKS = [
  { key: 'gk', name: '公务员（国考）', icon: '🏛️', color: '#7c2d12' },
  { key: 'sk', name: '公务员（省考）', icon: '🗳️', color: '#9a3412' },
  { key: 'sy', name: '事业单位', icon: '🏥', color: '#166534' },
  { key: 'yg', name: '央国企', icon: '🏭', color: '#1e40af' }
];
const TRACK_KEYS = TRACKS.map((t) => t.key);

/** 统一的输出规范（写在每个 prompt 尾部） */
function jsonSpec(spec) {
  return `【输出格式（必须严格遵守）】
只输出一段合法 JSON，不要 markdown 代码块、不要任何解释或多余文字。
${spec}`;
}

/* ============================ action: assess ============================ */

const PREFER_CN = {
  stability: '求稳定',
  salary: '看重收入',
  balance: '求工作生活平衡',
  unknown: '还没想清楚'
};

function buildAssessPrompt(input) {
  return `你是中国体制内就业规划专家，面向应届生做「赛道适配测评」。
【考生情况】
- 专业：${input.major || '未填写'}
- 学历：${input.education || '本科'}
- 政治面貌：${input.party ? '中共党员（含预备）' : '非党员'}
- 应届身份：${input.fresh ? '应届（含择业期内）' : '非应届'}
- 主要诉求：${PREFER_CN[input.prefer] || '还没想清楚'}
- 当前时间：${nowCn(Date.now())}

请依据真实招录规律（专业目录限制、党员门槛、应届倾斜、各单位待遇与竞争比）评估四条赛道的适配度：
- gk 国考（中央机关及垂直系统，行政编）
- sk 省考（省/市/县/乡镇，行政编）
- sy 事业单位（全额/差额/自收自支/备案制，区分编制）
- yg 央国企（央企/省属/市属国企、国有银行、电网、烟草、铁路等）

要求：
1. 四条赛道都要给分，score 为 0-100 整数，必须拉开差距（体现真实差异，不要都给 70 分）。
2. level 从「首选 / 推荐 / 可作保底 / 优先度低」中选一个，必须与 score 一致。
3. reason 写 1-3 条最关键的判断依据，用「；」连接，要具体（点到专业壁垒、岗位数量、竞争比、门槛条件），不要写空话。
4. combo 给三条报考组合建议，role 分别用「主攻 / 并行 / 保底」。
5. priority 给 3-5 条备考优先级（先做什么、为什么），要可执行。
6. avoid 给 3-5 条「你应当避开的岗位类型」及原因，必须结合考生专业与身份，不要泛泛而谈。
7. note 一句话说明本结果的使用建议。

${jsonSpec(`{
  "items": [
    { "key": "gk", "score": 78, "level": "首选", "reason": "..." }
  ],
  "combo": [ { "role": "主攻", "text": "..." } ],
  "priority": ["..."],
  "avoid": ["..."],
  "note": "..."
}`)}`;
}

function normalizeAssess(raw) {
  const arr = Array.isArray(raw.items) ? raw.items : [];
  const byKey = {};
  arr.forEach((it) => {
    if (!it || typeof it !== 'object') return;
    const k = TRACK_KEYS.indexOf(it.key) >= 0 ? it.key : null;
    if (!k || byKey[k]) return;
    let score = Math.round(Number(it.score));
    if (!isFinite(score)) score = 60;
    score = Math.max(5, Math.min(99, score));
    const levelOk = ['首选', '推荐', '可作保底', '优先度低'];
    const level = levelOk.indexOf(it.level) >= 0
      ? it.level
      : (score >= 80 ? '首选' : score >= 62 ? '推荐' : score >= 45 ? '可作保底' : '优先度低');
    byKey[k] = { key: k, score, level, reason: clampText(it.reason, 300) || '适配度一般，可作为补充方向' };
  });

  // 补齐缺失赛道：用中位分兜底，保证前端永远是四条
  TRACKS.forEach((t) => {
    if (!byKey[t.key]) {
      byKey[t.key] = { key: t.key, score: 55, level: '可作保底', reason: '模型未给出该赛道判断，已按中性分兜底，建议人工复核' };
    }
  });

  const items = TRACKS.map((t) => ({
    key: t.key,
    name: t.name,
    icon: t.icon,
    color: t.color,
    score: byKey[t.key].score,
    level: byKey[t.key].level,
    reason: byKey[t.key].reason
  })).sort((a, b) => b.score - a.score);

  const roleOk = ['主攻', '并行', '保底'];
  const combo = (Array.isArray(raw.combo) ? raw.combo : [])
    .filter((c) => c && typeof c === 'object' && clampText(c.text, 300))
    .slice(0, 4)
    .map((c, i) => ({
      role: roleOk.indexOf(c.role) >= 0 ? c.role : (roleOk[i] || '并行'),
      text: clampText(c.text, 300)
    }));

  return {
    items,
    combo,
    priority: clampStrList(raw.priority, 6, 200),
    avoid: clampStrList(raw.avoid, 6, 200),
    note: clampText(raw.note, 300) || 'AI 生成结果，建议结合本省当年公告核对后再决策。'
  };
}

/* ============================ action: plan ============================ */

const TRACK_PLAN_HINT = {
  gk: '笔试为行测 + 申论，行测五大模块（言语/数量/判断/资料/常识），申论含概括、对策、公文、大作文',
  sk: '笔试为行测 + 申论（部分省份分级分类命题），乡镇岗申论偏实务',
  sy: '笔试为职测 + 综合应用能力（A/B/C/D/E 五类），教师岗含教综+学科，医疗岗含医基+专业',
  yg: '笔试多为行测（简化版）+ 性格测评 + 行业常识，面试含半结构化与无领导小组讨论'
};

function buildPlanPrompt(input) {
  const t = TRACKS.filter((x) => x.key === input.track)[0] || TRACKS[0];
  return `你是体制内备考规划师。请为一位应届生生成一份可落地的备考计划。
【目标赛道】${t.name}（${t.key}）
【目标岗位】${input.target || '尚未确定，按赛道通识准备'}
【每周可投入】${input.hours} 小时
【当前时间】${nowCn(Date.now())}（第 ${currentMonth(Date.now())} 月）

【该赛道笔试构成参考】${TRACK_PLAN_HINT[input.track] || TRACK_PLAN_HINT.gk}

要求：
1. weeks 必须正好 4 周，week 用「第 1 周」…「第 4 周」，focus 是这周主题（8 字以内）。
2. 每周 items 给 3-4 条具体动作，必须写明「练什么、怎么练、达到什么标准」，包含可量化的目标（题量、正确率、篇数、用时）。
3. 必须把每周 ${input.hours} 小时合理分配到各动作上。
4. monthly 给未来 3 个月（从第 ${currentMonth(Date.now())} 月起）的阶段目标，month 用「X 月」。
5. tips 给 4 条执行提醒，结合该赛道的真实常见失误。
6. 不要出现「努力学习」「认真复习」这类无法检验的表述。

${jsonSpec(`{
  "title": "计划标题（含赛道名）",
  "summary": "一句话说明这份计划的依据与覆盖范围",
  "weeks": [ { "week": "第 1 周", "focus": "摸底建体系", "items": ["..."] } ],
  "monthly": [ { "month": "9 月", "goal": "..." } ],
  "tips": ["..."]
}`)}`;
}

function normalizePlan(raw, input) {
  const t = TRACKS.filter((x) => x.key === input.track)[0] || TRACKS[0];
  const weeks = (Array.isArray(raw.weeks) ? raw.weeks : [])
    .slice(0, 4)
    .map((w, i) => ({
      week: clampText(w && w.week, 20) || `第 ${i + 1} 周`,
      focus: clampText(w && w.focus, 30) || '按计划推进',
      items: clampStrList(w && w.items, 5, 200)
    }))
    .filter((w) => w.items.length);

  const monthly = (Array.isArray(raw.monthly) ? raw.monthly : [])
    .slice(0, 3)
    .map((m) => ({
      month: clampText(m && m.month, 12) || '',
      goal: clampText(m && m.goal, 120) || ''
    }))
    .filter((m) => m.month && m.goal);

  const tips = clampStrList(raw.tips, 5, 160);

  const title = clampText(raw.title, 60) || `${t.name} · 4 周备考计划`;
  const summary = clampText(raw.summary, 200) || `按当前第 ${currentMonth(Date.now())} 月与每周 ${input.hours} 小时生成。`;

  const L = [];
  L.push(`【${title}】`);
  L.push(summary);
  L.push('');
  weeks.forEach((w) => {
    L.push(`${w.week} · ${w.focus}`);
    w.items.forEach((x) => L.push(`· ${x}`));
    L.push('');
  });
  if (monthly.length) {
    L.push('【未来阶段目标】');
    monthly.forEach((m) => L.push(`· ${m.month}：${m.goal}`));
    L.push('');
  }
  if (tips.length) {
    L.push('【执行提醒】');
    tips.forEach((x) => L.push(`· ${x}`));
  }

  return { title, summary, weeks, monthly, tips, text: L.join('\n') };
}

/* ============================ action: interview ============================ */

const IV_KIND = {
  structured: '公考/事业编结构化面试（综合分析、应急应变、人际关系、组织管理、岗位匹配）',
  semi: '国企半结构化面试（自我介绍 + 简历追问 + 专业题 + 价值观匹配）',
  group: '无领导小组讨论（读题、个人陈述、自由讨论、总结陈词）'
};

function buildInterviewPrompt(input) {
  const t = TRACKS.filter((x) => x.key === input.track)[0];
  return `你是体制内面试考官（${IV_KIND[input.kind] || IV_KIND.structured}），请对考生的作答做逐条点评。
【目标赛道】${t ? t.name : '公务员'}
【题目】${input.question || '（考生未填题目，请按该赛道高频题型默认为一道综合分析题来点评）'}
【考生作答】${input.answer}

评分请按体制内面试真实标准：
- 内容是否切题、是否有真实可行的对策（不是空喊口号）
- 结构是否有逻辑层次（总分总 / 分点列表 / 递进）
- 表达的机关语感与政治站位是否得体（不媚不俗、不越位）
- 是否结合了自身经历与岗位实际

要求：
1. score 0-100 整数，level 从「优秀 / 良好 / 及格 / 需要重练」中选，且与分数一致。
2. good 列 2-3 条真正答得好的点（要引用考生原话中的具体表述，不要泛泛说「思路清晰」）。
3. improve 列 3-5 条具体改进项，必须给出「改成什么样」，可直接照做。
4. sample 给一段 150-250 字的示范作答开头（体现机关语感），供考生对照模仿。

${jsonSpec(`{
  "score": 72,
  "level": "良好",
  "good": ["..."],
  "improve": ["..."],
  "sample": "..."
}`)}`;
}

function normalizeInterview(raw) {
  let score = Math.round(Number(raw.score));
  if (!isFinite(score)) score = 65;
  score = Math.max(0, Math.min(100, score));
  const levelOk = ['优秀', '良好', '及格', '需要重练'];
  const level = levelOk.indexOf(raw.level) >= 0
    ? raw.level
    : (score >= 85 ? '优秀' : score >= 70 ? '良好' : score >= 60 ? '及格' : '需要重练');
  return {
    score,
    level,
    good: clampStrList(raw.good, 4, 220),
    improve: clampStrList(raw.improve, 6, 220),
    sample: clampText(raw.sample, 800)
  };
}

/* ============================ action: polish ============================ */

function buildPolishPrompt(input) {
  return `你是体制内（国企 / 公务员 / 事业单位）简历评审专家。请把下面这段简历文案改写成符合政审偏好与机关文风的版本。
【目标岗位】${input.target || '体制内岗位（国企 / 公考 / 事业编）'}
【原文】
${input.text}

体制内简历的评审偏好：
- 用词严谨、克制，避免「赋能」「闭环」「打法」这类互联网黑话与夸张形容词
- 身份信息与资质前置（政治面貌、学历、证书、学生干部经历）
- 成果用可核查的事实与数字表达（人数、篇数、金额、排名、时长），不写「显著提升」
- 强调组织协调、文字功底、责任心、稳定意愿这类体制内真正看重的特质
- 不用第一人称「我」，用动词短语开头

要求：
1. polished 输出改写后的完整文案，保持原文的段落结构，可直接粘贴进简历。
2. changes 列出 3-6 条你做的关键改写，每条说明「改了什么、为什么」（原文 → 改写后）。
3. 不得虚构原文没有的经历、数字或头衔。

${jsonSpec(`{
  "polished": "...",
  "changes": ["..."]
}`)}`;
}

function normalizePolish(raw) {
  return {
    polished: clampText(raw.polished, 4000),
    changes: clampStrList(raw.changes, 8, 240)
  };
}

/* ============================ 调度 ============================ */

const ACTIONS = ['assess', 'plan', 'interview', 'polish'];

async function runModel(prompt, context, maxTokens) {
  const apiKey = (process.env.AI_API_KEY || process.env.ZHIPU_API_KEY || FALLBACK_API_KEY || '').trim();
  const apiBase = (process.env.AI_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '');
  const provider = resolveProvider(apiBase);
  const thinking = (process.env.AI_THINKING || 'disabled').trim() === 'enabled' ? 'enabled' : 'disabled';

  if (!apiKey) {
    return { fail: { success: false, error: 'AI_NOT_CONFIGURED', message: '未配置 AI_API_KEY' } };
  }

  const low = budgetTooLow(context);
  if (low) {
    console.warn('[civilAI] 超时预算不足，放弃调用上游：' + low.budgetMs + 'ms');
    return { fail: low };
  }

  const models = candidateModels(provider, (process.env.AI_MODEL || '').trim());
  if (!models.length) {
    return { fail: { success: false, error: 'AI_MODEL_UNAVAILABLE', message: '没有可用模型，请配置 AI_MODEL' } };
  }

  const payload = {
    temperature: 0.4,
    max_tokens: maxTokens || 2000,
    messages: [
      { role: 'system', content: '你是严谨的中国体制内就业与考试规划专家，输出必须是严格合法的 JSON。' },
      { role: 'user', content: prompt }
    ]
  };

  const started = Date.now();
  let resp;
  let usedModel = models[0];
  let usedProvider = provider;
  try {
    const r = await requestAcrossProviders(apiBase, apiKey, models, payload, thinking, context);
    resp = r.resp;
    usedModel = r.model;
    usedProvider = r.provider;
  } catch (err) {
    console.error('[civilAI] upstream error:', err && err.message);
    return { fail: { success: false, ...describeUpstream(err) } };
  }

  const content = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  const raw = extractJSON(content);
  if (!raw || typeof raw !== 'object') {
    console.error('[civilAI] unparseable:', String(content).slice(0, 300));
    return { fail: { success: false, error: 'AI_UNPARSEABLE', message: 'AI 返回格式异常，已自动切换到本地规则引擎' } };
  }

  return {
    raw,
    meta: {
      model: usedModel,
      provider: usedProvider,
      ms: Date.now() - started,
      usage: resp && resp.usage ? resp.usage : null
    }
  };
}

exports.main = async (event, context) => {
  try {
    const ev = event || {};
    const action = ev.action;

    if (action === 'ping') {
      const apiKey = (process.env.AI_API_KEY || process.env.ZHIPU_API_KEY || FALLBACK_API_KEY || '').trim();
      const apiBase = (process.env.AI_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '');
      const provider = resolveProvider(apiBase);
      return {
        success: true,
        provider,
        base: apiBase,
        model: candidateModels(provider, (process.env.AI_MODEL || '').trim())[0] || '',
        hasKey: !!apiKey,
        budgetMs: remainingBudgetMs(context)
      };
    }

    if (ACTIONS.indexOf(action) < 0) {
      return { success: false, error: `未知 action: ${action}` };
    }

    if (action === 'assess') {
      const input = {
        major: clampText(ev.major, 60),
        education: clampText(ev.education, 20) || '本科',
        party: !!ev.party,
        fresh: !!ev.fresh,
        prefer: ['stability', 'salary', 'balance', 'unknown'].indexOf(ev.prefer) >= 0 ? ev.prefer : 'unknown'
      };
      const r = await runModel(buildAssessPrompt(input), context, 2000);
      if (r.fail) return r.fail;
      return { success: true, ...normalizeAssess(r.raw), meta: r.meta };
    }

    if (action === 'plan') {
      const input = {
        track: TRACK_KEYS.indexOf(ev.track) >= 0 ? ev.track : 'gk',
        target: clampText(ev.target, 60),
        hours: Math.max(5, Math.min(60, Number(ev.hours) || 20))
      };
      const r = await runModel(buildPlanPrompt(input), context, 2500);
      if (r.fail) return r.fail;
      return { success: true, ...normalizePlan(r.raw, input), meta: r.meta };
    }

    if (action === 'interview') {
      const answer = clampText(ev.answer, 3000);
      if (!answer) return { success: false, error: 'NO_ANSWER', message: '请先填写你的作答内容' };
      const input = {
        track: TRACK_KEYS.indexOf(ev.track) >= 0 ? ev.track : 'gk',
        kind: ['structured', 'semi', 'group'].indexOf(ev.kind) >= 0 ? ev.kind : 'structured',
        question: clampText(ev.question, 300),
        answer
      };
      const r = await runModel(buildInterviewPrompt(input), context, 2000);
      if (r.fail) return r.fail;
      return { success: true, ...normalizeInterview(r.raw), meta: r.meta };
    }

    // polish
    const text = clampText(ev.text, 4000);
    if (!text) return { success: false, error: 'NO_TEXT', message: '请先填写需要优化的简历内容' };
    const input = { target: clampText(ev.target, 60), text };
    const r = await runModel(buildPolishPrompt(input), context, 3000);
    if (r.fail) return r.fail;
    return { success: true, ...normalizePolish(r.raw), meta: r.meta };
  } catch (err) {
    console.error('[civilAI] fatal:', err && err.message);
    const timedOut = /TIMEOUT|timeout/i.test((err && err.message) || '');
    return {
      success: false,
      error: timedOut ? 'AI_TIMEOUT' : 'AI_ERROR',
      message: timedOut
        ? '上游模型响应超时。若频繁出现，请把云函数超时时间调到 60 秒。'
        : (err && err.message) || 'AI 调用失败'
    };
  }
};
