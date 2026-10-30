// 云函数 helperChat —— 小助手 AI 对话（v2 全面智能版）
//
// 职责：接收用户消息 + 真实待办上下文（可选图片），调用大模型返回结构化回复与「可执行操作」。
//
// 相比 v1 的增强：
//   1. 多供应商：智谱 / DeepSeek / 任意 OpenAI 兼容端点（按 AI_API_BASE 自动判定）
//   2. 模型候选链：主模型不可用时自动顺延，避免「某个模型未开通 → 整条链路直接挂掉」
//   3. thinking 可控：推理模型默认关闭思考，响应从 ~100s 降到 ~5s（可用 AI_THINKING 打开）
//   4. ops 结构化动作：批量建待办 / 标记完成 / 改期 / 删除 / 记账 / 便签（不再只有跳转）
//   5. 真实待办明细注入：能回答「我还有哪些没做」「明天有什么安排」
//   6. brief 简报模式：进入小助手时主动生成今日简报与风险提示
//   7. 多模态：带图时自动切视觉模型，按 content 数组格式传图
//
// 配置（云函数环境变量；已内置兜底 Key，完全不配也能直接用）：
//   AI_API_KEY      选填。API Key；不配则用源码里的 FALLBACK_API_KEY
//   AI_API_BASE     选填。默认 https://open.bigmodel.cn/api/paas/v4
//   AI_PROVIDER     选填。zhipu | deepseek | ark | openai（自建代理/中转域名时显式指定）
//   AI_MODEL        选填。默认按供应商取候选链首位
//   AI_VISION_MODEL 选填。带图时使用的模型
//   AI_THINKING     选填。enabled | disabled，默认 disabled
//   AI_TIMEOUT_MS   选填。单次上游请求超时（毫秒），默认 45000
//
// ⚠️ 超时是这条链路的命门，务必确认：
//    新版 CloudBase 云函数**默认超时只有 3 秒**，而云函数目录下 config.json 里的
//    timeout 未必随部署生效（实测踩过坑：写了 60 仍然是 3 秒）。
//    → 请到 云开发控制台 → 云函数 → helperChat → 版本与配置，把超时时间设为 60 秒。
//    代码侧已做保护：按平台给的剩余预算收敛上游超时；预算不足时立刻返回
//    AI_TIMEOUT_BUDGET 并附上修复指引，而不是被平台强杀成 -504003。
//
// Key 优先级：环境变量 AI_API_KEY > 环境变量 ZHIPU_API_KEY > 源码 FALLBACK_API_KEY。
// 都取不到时返回 AI_NOT_CONFIGURED，客户端自动回退到本地规则引擎。
//
// 主档案 = 火山方舟（豆包），冷备 = 智谱 GLM：
//   实测（2026-09-14）豆包 doubao-seed-character-260628 空跑 1.0s、长 JSON 4.3s，
//   且支持图片输入（面相/手相已在用同一个 Key）；智谱 glm-4.6 空跑要 11-14s。
//   方舟整体失败（Key 失效 / 欠费 / 模型下线 / 网络不通）时自动切到智谱再打一遍。

const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

/** 兜底 Key：优先读环境变量 AI_API_KEY，没配时用这里，做到「上传即可用」。
 *  ⚠️ 这是服务端代码，Key 不会下发到客户端；但若仓库对外分发（如传到 GitHub），
 *     这里会随代码泄露。生产建议：在云函数环境变量里配 AI_API_KEY，然后把下面清空。 */
const FALLBACK_API_KEY = '';

/** 冷备档案：主档案（火山方舟）整体失败时顶上。
 *  可用环境变量覆盖，便于换冷备厂商 / 指向自建中转：
 *    AI_BACKUP_BASE / AI_BACKUP_KEY / AI_BACKUP_PROVIDER
 *  另设 AI_BACKUP_DISABLE=1 可整体关闭冷备（单供应商排障、离线自检时用）。 */
const AI_BACKUP = {
  provider: (process.env.AI_BACKUP_PROVIDER || 'zhipu').trim(),
  base: (process.env.AI_BACKUP_BASE || 'https://open.bigmodel.cn/api/paas/v4').trim().replace(/\/+$/, ''),
  key: (process.env.AI_BACKUP_KEY || '').trim(),
  enabled: (process.env.AI_BACKUP_DISABLE || '').trim() !== '1'
};

// 单次上游请求超时的上限（实际会再按平台给的剩余预算收敛，见 budgetedTimeout）。
// 平台高峰期实测单次可到 15s+，因此给足余量——但前提是云函数本身超时要够，
// 平台默认的 20 秒在冷启动 + 高峰时会不够，必须去控制台改成 60 秒（见文件顶部「超时是命门」）。
const REQUEST_TIMEOUT = Math.max(5000, Number(process.env.AI_TIMEOUT_MS) || 45000);
const MAX_TODO_BRIEF = 40;     // 注入提示词的待办明细上限（控制 token）

/* ============================ 供应商与模型 ============================ */

/** 支持的供应商（可用 AI_PROVIDER 显式指定，未指定则按 base 自动判定） */
const PROVIDERS = ['zhipu', 'deepseek', 'ark', 'openai'];

/**
 * 判定供应商：AI_PROVIDER 优先（自建代理 / 中转域名时用得上），否则按 base 特征猜。
 */
function resolveProvider(base) {
  const forced = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (forced && PROVIDERS.indexOf(forced) >= 0) return forced;
  if (/bigmodel\.cn|zhipu|paas\/v4/i.test(base)) return 'zhipu';
  if (/deepseek\.com/i.test(base)) return 'deepseek';
  if (/volces\.com|ark\.cn|bytedance/i.test(base)) return 'ark';
  return 'openai';
}

/**
 * 各供应商的模型候选链（按「快 → 稳」排序）。
 * 之所以要链：平台侧「模型未开通 / 已下线」会返回 404，逐个顺延可避免整条链路挂掉。
 *
 * 方舟实测结论（2026-09-14，同一台机器同一个 prompt）：
 *   doubao-seed-character-260628 → 空跑 1.0s、长 JSON 4.3s，JSON 合规   ← 会话首选
 *   doubao-seed-evolving         → 约 4.0s
 *   doubao-seed-1.6              → 本账号 404（未开通），不要放进链
 *
 * 智谱实测结论（2026-09 初测 → 2026-09-14 复测）：
 *   glm-4.6  + thinking:disabled → 2.6s → **已劣化到 11-14s**，故整体降为冷备
 *   glm-4-flash                  → 6.2s，JSON 合规   ← 冷备链第二
 *   glm-5.3 / glm-5.3-flash      → 强制思考，thinking:disabled 直接报 1210
 *                                   （只能作为"能力强但慢"的备选排在后面）
 */
const MODEL_CHAIN = {
  zhipu: ['glm-4.6', 'glm-4-flash', 'glm-5.3-flash', 'glm-5.3', 'glm-4v-flash'],
  deepseek: ['deepseek-chat'],
  ark: ['doubao-seed-character-260628', 'doubao-seed-evolving'],
  openai: []
};

/**
 * 视觉模型候选链：带图场景优先用能真正读图的模型。
 * 实测（2026-09-14）：
 *   doubao-seed-character-260628 → 支持图片输入（最短边需 ≥ 14px），会话首选
 *   doubao-seed-evolving         → 也支持图片输入
 *   智谱 glm-5.3-flash 识图最准（约 3.9s）；glm-4v-flash 最快（约 0.5s）
 *   glm-4.6 只接受纯文本 content，传图直接报 1210「content.type 参数非法」→ 不能进这个链
 */
const VISION_CHAIN = {
  zhipu: ['glm-5.3-flash', 'glm-4v-flash'],
  deepseek: ['deepseek-v4-flash-vision-exp', 'deepseek-chat'],
  ark: ['doubao-seed-character-260628', 'doubao-seed-evolving'],
  openai: []
};

/** 组装最终候选模型链：显式配置优先 → 场景链 → 通用链，去重 */
function candidateModels(provider, configured, isVision) {
  const chain = isVision ? VISION_CHAIN[provider] || [] : MODEL_CHAIN[provider] || [];
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

function todayStr(now) {
  const d = new Date(now + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()];
  return `${y}-${m}-${day} · ${wk}`;
}

/** 当前北京时间（供提示词里换算「今天/明天/周五」） */
function nowCn(now) {
  const d = new Date(now + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/* ============================ 时间预算 ============================ */

/**
 * 平台给本次调用的剩余时间（毫秒）。取不到返回 null（按默认超时跑）。
 * 微信云开发基于腾讯云 SCF，context 上带这个方法；本地自检环境没有则降级。
 */
function remainingBudgetMs(context) {
  try {
    if (context && typeof context.getRemainingTimeInMillis === 'function') {
      const v = Number(context.getRemainingTimeInMillis());
      if (isFinite(v) && v > 0) return v;
    }
  } catch (_e) { /* 平台不支持，降级 */ }
  return null;
}

/** 给平台回收、序列化留的余量（毫秒） */
const BUDGET_MARGIN = 700;

/**
 * 本次上游请求真正可用的超时。
 *
 * 为什么需要它：新版 CloudBase 云函数**默认超时只有 3 秒**，而且云函数目录里的
 * config.json 未必随部署生效（实测踩过）。若上游还按 45 秒去等，函数会在第 3 秒
 * 被平台强杀，客户端拿到的是 `-504003 FUNCTIONS_TIME_LIMIT_EXCEEDED`——
 * 一个完全没有指向性的错误。按剩余预算收敛超时后，我们能在被杀之前拿到 TIMEOUT，
 * 从而返回「该怎么修」的提示。
 */
function budgetedTimeout(context) {
  const budget = remainingBudgetMs(context);
  if (budget === null) return REQUEST_TIMEOUT;
  return Math.max(600, Math.min(REQUEST_TIMEOUT, Math.round(budget - BUDGET_MARGIN)));
}

/** 预算低到根本不可能拿到模型回复时：直接快失败，并告诉调用方怎么修 */
const MIN_USABLE_BUDGET = 1200;

function budgetTooLow(context) {
  const budget = remainingBudgetMs(context);
  if (budget === null) return null;
  if (budget >= MIN_USABLE_BUDGET) return null;
  return {
    success: false,
    error: 'AI_TIMEOUT_BUDGET',
    message:
      '云函数超时时间过短（本次可用不足 1.2 秒），模型来不及返回。' +
      '请在云开发控制台 → 云函数 → helperChat → 版本与配置，把超时时间改为 60 秒。',
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

/**
 * 判断一次失败是否属于「这个模型用不了」，从而应当顺延到下一个候选模型。
 * 平台侧常见两种 404，语义完全不同，但都该顺延：
 *   ModelNotOpen                    —— 账号未开通该模型
 *   InvalidEndpointOrModel.NotFound —— 模型 ID 已失效/不存在
 */
function isModelUnavailable(err) {
  if (!err) return false;
  const msg = `${err.message || ''} ${err.upstreamDetail || ''} ${err.upstreamCode || ''}`;
  if (/ModelNotOpen|InvalidEndpointOrModel|model[\s_-]*not[\s_-]*found|模型不存在|未开通|not\s*subscribed|no\s*permission\s*to\s*access\s*model/i.test(msg)) {
    return true;
  }
  return err.statusCode === 404;
}

/**
 * thinking 参数不被支持时，去掉后重试一次。
 * 典型是智谱 glm-5.3 系列：它「始终思考」，传 disabled 会被拒，提示"该模型始终思考，不支持关闭思考"。
 * 注意只按**文案**判断，不要按错误码 1210 —— 1210 是通用参数错误，
 * 例如 glm-4.6 收到图片时也会报 1210（content.type 非法），那种情况该走模型顺延而非摘 thinking。
 */
function isThinkingUnsupported(err) {
  if (!err) return false;
  if (err.statusCode !== 400 && err.statusCode !== 422) return false;
  return /thinking|reasoning|思考/i.test(`${err.message || ''} ${err.upstreamDetail || ''}`);
}

/**
 * 单次调用（含 thinking 降级重试）。
 * 推理模型的「思考」会显著拉长首字延迟，默认关闭；若服务端不认这个参数则自动去掉重试。
 */
async function requestOnce(base, apiKey, model, payloadBase, thinking, timeoutMs) {
  const payload = { ...payloadBase, model };
  if (thinking) payload.thinking = { type: thinking };
  try {
    return await requestJSON(`${base}/chat/completions`, payload, apiKey, timeoutMs);
  } catch (err) {
    if (thinking && isThinkingUnsupported(err)) {
      console.warn('[helperChat] 服务端不支持 thinking 参数，去掉后重试');
      const plain = { ...payloadBase, model };
      return await requestJSON(`${base}/chat/completions`, plain, apiKey, timeoutMs);
    }
    throw err;
  }
}

/** 按候选链依次尝试，命中「模型不可用」才顺延，其余错误（鉴权/余额/限流）立即抛出 */
async function requestWithFallback(base, apiKey, models, payloadBase, thinking, timeoutMs) {
  // 预算紧张时不做顺延：时间只够试一次，多试只会把失败推迟到被平台强杀，
  // 反而丢掉「超时」这个准确原因。
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
      console.warn(`[helperChat] 模型「${model}」不可用，顺延下一个：`, err.message);
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

/** 主档案 → 冷备 依次尝试；返回 { resp, model, provider }
 *  isVision 决定冷备用视觉链还是通用链（带图时不能用纯文本模型）。 */
async function requestWithBackup(base, apiKey, models, payload, thinking, timeoutMs, context, isVision) {
  const primaryProvider = resolveProvider(base);
  try {
    const r = await requestWithFallback(base, apiKey, models, payload, thinking, timeoutMs);
    return { resp: r.resp, model: r.model, provider: primaryProvider };
  } catch (err) {
    const budget = remainingBudgetMs(context);
    const canRetry = budget === null || budget > 9000; // 预算不够就别再打第二家
    const nobackup = !AI_BACKUP.enabled || !AI_BACKUP.key || !AI_BACKUP.base;
    if (nobackup || base === AI_BACKUP.base || !canRetry || !isProviderLevelFailure(err)) throw err;
    console.warn('[helperChat] 主档案失败（' + ((err && err.message) || '') + '），切换冷备（' + AI_BACKUP.provider + '）重试');
    const backupModels = candidateModels(AI_BACKUP.provider, '', !!isVision);
    const r = await requestWithFallback(AI_BACKUP.base, AI_BACKUP.key, backupModels, payload, thinking, timeoutMs);
    return { resp: r.resp, model: r.model, provider: AI_BACKUP.provider };
  }
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
    return {
      error: 'AI_MODEL_UNAVAILABLE',
      message: '当前账号下没有可用的对话模型，请在模型平台开通后再试'
    };
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
  if (msg === 'TIMEOUT') {
    return { error: 'AI_TIMEOUT', message: 'AI 响应超时，请稍后重试' };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|网络/.test(msg)) {
    return { error: 'AI_NETWORK', message: '无法连接 AI 服务，请稍后重试' };
  }
  return { error: 'AI_ERROR', message: msg || 'AI 服务异常' };
}

/* ============================ ops 归一化 ============================ */

/** 动作白名单：模型只能产出这些类型，非法项一律丢弃 */
const OP_TYPES = [
  'todo.add',
  'todo.addMany',
  'todo.complete',
  'todo.uncomplete',
  'todo.reschedule',
  'todo.remove',
  'todo.priority',
  'note.add',
  'ledger.add',
  'nav',
  'none'
];

const PRIORITIES = ['high', 'medium', 'low'];

function normPriority(v) {
  return PRIORITIES.indexOf(v) >= 0 ? v : undefined;
}

/** 日期规整：统一成 `YYYY-MM-DD HH:mm`（模型最容易稳定输出的格式），非法则丢弃 */
function normDate(v) {
  const s = clampText(v, 24);
  if (!s) return undefined;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2}))?/);
  if (!m) return undefined;
  const mo = Number(m[2]);
  const dd = Number(m[3]);
  const hh = m[4] ? Number(m[4]) : 0;
  const mi = m[5] ? Number(m[5]) : 0;
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return undefined;
  const p = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${p(mo)}-${p(dd)} ${p(hh)}:${p(mi)}`;
}

function normalizeOps(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const type = OP_TYPES.indexOf(raw.type) >= 0 ? raw.type : null;
    if (!type || type === 'none') continue;

    if (type === 'todo.add') {
      const content = clampText(raw.content, 200);
      if (!content) continue;
      out.push({
        type,
        content,
        dueDate: normDate(raw.dueDate),
        priority: normPriority(raw.priority),
        tags: Array.isArray(raw.tags) ? raw.tags.map((t) => clampText(t, 12)).filter(Boolean).slice(0, 4) : []
      });
    } else if (type === 'todo.addMany') {
      const items = Array.isArray(raw.items) ? raw.items : [];
      const list = [];
      for (const it of items.slice(0, 10)) {
        const content = clampText(it && it.content, 200);
        if (!content) continue;
        list.push({
          content,
          dueDate: normDate(it && it.dueDate),
          priority: normPriority(it && it.priority),
          tags: Array.isArray(it && it.tags) ? it.tags.map((t) => clampText(t, 12)).filter(Boolean).slice(0, 4) : []
        });
      }
      if (!list.length) continue;
      out.push({ type, items: list });
    } else if (type === 'todo.reschedule') {
      const match = clampText(raw.match, 60);
      const dueDate = normDate(raw.dueDate);
      if (!match || !dueDate) continue;
      out.push({ type, match, dueDate });
    } else if (type === 'todo.priority') {
      const match = clampText(raw.match, 60);
      const priority = normPriority(raw.priority);
      if (!match || !priority) continue;
      out.push({ type, match, priority });
    } else if (type === 'note.add') {
      const text = clampText(raw.text, 300);
      if (!text) continue;
      out.push({ type, text });
    } else if (type === 'ledger.add') {
      const amount = Number(raw.amount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      out.push({
        type,
        amount: Math.round(amount * 100) / 100,
        category: clampText(raw.category, 20) || '其他',
        note: clampText(raw.note, 60)
      });
    } else if (type === 'nav') {
      const module = clampText(raw.module, 40);
      if (!module) continue;
      out.push({ type, module });
    } else {
      // todo.complete / todo.uncomplete / todo.remove
      const match = clampText(raw.match, 60);
      if (!match) continue;
      out.push({ type, match });
    }
  }
  return out.slice(0, 8);
}

const ACTION_KINDS = ['none', 'nav-tools', 'nav-group', 'nav-subscribe', 'nav-important', 'nav-todo-panel', 'nav-pomodoro', 'nav-module'];

function normalizeActions(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const a of arr) {
    if (!a || typeof a !== 'object') continue;
    const kind = ACTION_KINDS.indexOf(a.kind) >= 0 ? a.kind : 'none';
    const label = clampText(a.label, 40) || '查看';
    const module = clampText(a.module, 40) || undefined;
    out.push({ kind, label, module });
  }
  return out.slice(0, 4);
}

/* ============================ 提示词 ============================ */

/** 可用模块清单（与客户端 module-router 保持一致，供模型生成 nav 动作） */
const MODULES = [
  { id: 'home', name: '首页待办', kws: '首页、待办列表' },
  { id: 'todo-panel', name: '待办四维', kws: '日/月/年待办、四维' },
  { id: 'calendar', name: '日历', kws: '日历、日程' },
  { id: 'kanban', name: '看板', kws: '看板、泳道' },
  { id: 'countdown', name: '倒数日', kws: '倒数日、倒计时、还有几天' },
  { id: 'goal-breakdown', name: '目标拆解', kws: '目标拆解、拆目标' },
  { id: 'group-reminder', name: '多人提醒', kws: '多人提醒、团队提醒' },
  { id: 'subscribe-reminder', name: '订阅提醒', kws: '订阅提醒、定时提醒、习惯提醒' },
  { id: 'important-day', name: '重要日', kws: '重要日、纪念日、生日' },
  { id: 'note', name: '便签', kws: '便签、笔记' },
  { id: 'memo', name: '备忘录', kws: '备忘录、速记' },
  { id: 'ledger', name: '记账本', kws: '记账、账本、记一笔' },
  { id: 'wish', name: '愿望清单', kws: '愿望、心愿' },
  { id: 'pomodoro', name: '番茄时钟', kws: '番茄、专注' },
  { id: 'life', name: '人生进度', kws: '人生进度' },
  { id: 'time-progress', name: '时间进度', kws: '时间进度' },
  { id: 'flipclock', name: '翻页时钟', kws: '翻页时钟' },
  { id: 'tools', name: '工具中心', kws: '工具中心、全部工具' },
  { id: 'astro-hub', name: '星语星球', kws: '星语星球、星座、塔罗、运势' },
  { id: 'recruit-hub', name: '秋招助手', kws: '秋招、求职、投递、找工作' },
  { id: 'recruit-analysis', name: '秋招数据看板', kws: '秋招看板、投递统计' },
  { id: 'little-helper', name: '小助手', kws: '小助手' }
];

/** 把真实待办明细格式化成提示词片段（回答「我还有哪些没做」的依据） */
function formatTodoBrief(list) {
  if (!Array.isArray(list) || !list.length) return '（用户当前没有任何待办）';
  const lines = [];
  for (const t of list.slice(0, MAX_TODO_BRIEF)) {
    if (!t || typeof t !== 'object') continue;
    const content = clampText(t.content, 60);
    if (!content) continue;
    const bits = [];
    if (t.done) bits.push('已完成');
    if (t.overdue) bits.push('已逾期');
    if (t.due) bits.push(`截止 ${clampText(t.due, 20)}`);
    if (t.priority) bits.push({ high: '高优先级', medium: '中优先级', low: '低优先级' }[t.priority] || '');
    lines.push(`- ${content}${bits.filter(Boolean).length ? '（' + bits.filter(Boolean).join('，') + '）' : ''}`);
  }
  return lines.length ? lines.join('\n') : '（用户当前没有任何待办）';
}

function outputSpec() {
  return `【输出格式】
你必须只输出一段合法 JSON，不要 markdown 代码块、不要解释、不要多余文字。结构如下：
{
  "text": "string，给用户的自然语言回复，口语化、简洁、控制在 120 字以内",
  "ops": [
    { "type": "todo.add", "content": "周五下午三点开会", "dueDate": "2026-09-18 15:00", "priority": "high" }
  ],
  "actions": [
    { "kind": "nav-module", "label": "📅 打开日历", "module": "calendar" }
  ],
  "createTodo": "string | null"
}

【ops 可用类型（真正会替你执行的操作，用不上就传空数组）】
- todo.add        { content 必填, dueDate 选填"YYYY-MM-DD HH:mm", priority 选填 high|medium|low, tags 选填 }
- todo.addMany    { items: [{ content 必填, dueDate, priority }] }  —— 用户一次交代多件事时用
- todo.complete   { match: "待办标题片段" }  —— 从【用户待办明细】里挑选要标记完成的
- todo.uncomplete { match: "待办标题片段" }
- todo.reschedule { match: "待办标题片段", dueDate: "YYYY-MM-DD HH:mm" }
- todo.priority   { match: "待办标题片段", priority: "high|medium|low" }
- todo.remove     { match: "待办标题片段" }
- note.add        { text: "便签内容" }
- ledger.add      { amount: 数字, category: "餐饮", note: "说明" }
- nav            { module: "模块 id" }

【actions 的 kind 说明】
- nav-module：跳转上方模块列表中的某个 id，必须同时给出 module 字段
- nav-todo-panel / nav-group / nav-subscribe / nav-important / nav-pomodoro / nav-tools
- none：不带跳转，仅展示文案

【规则】
1. 用户说「打开/去/看看/进入 xx」时，优先返回 nav 动作（可同时给 ops 与 actions）。
2. 用户让你记录一件事 → todo.add，把内容写进 content 与 createTodo。
3. 用户一次说了多件事（「帮我记三件事：A、B、C」）→ 用 todo.addMany 全部拆成独立条目。
4. 用户说「把 X 标记完成 / 我做完了 X / 删掉 X / X 改到明天」→ 先在【用户待办明细】里找到最匹配的标题，
   再输出对应的 todo.complete / todo.remove / todo.reschedule，match 用标题里的关键词（不要用整句）。
5. 用户问今天安排 / 还有哪些没做 → 必须依据【用户待办明细】如实回答，不要编造。
6. 不要编造天气、新闻、股价等实时数据；这类问题礼貌说明暂不支持。
7. 日期一律换算成"YYYY-MM-DD HH:mm"再输出；用户说"明天下午三点"要结合当前时间算出具体日期。
8. 保持友好、简短、可操作。`;
}

function buildChatPrompt(ctx) {
  const moduleList = MODULES.map((m) => `- ${m.id}：${m.name}（${m.kws}）`).join('\n');

  return `你是一台微信小程序「待办小助手」里的 AI 助手，名字叫「待办小助手」。
你的职责是用自然语言回答用户，并给出可执行的操作，帮 ta 记账、建待办、管理任务或一键跳转功能。

【当前时间】${nowCn(Date.now())}（${todayStr(Date.now())}）
【用户当前所在页面】${ctx.currentPage || '小助手'}
【统计】今日待办 ${ctx.todayTotal ?? 0} 条，已完成 ${ctx.todayDone ?? 0} 条，进行中 ${ctx.activeTodoCount ?? 0} 条

【用户待办明细（最多 ${MAX_TODO_BRIEF} 条，用于回答"有哪些/完成了什么"）】
${formatTodoBrief(ctx.todoBrief)}

【可用功能模块】
${moduleList}

${outputSpec()}

【示例】
输入：打开日历
输出：{"text":"好的，已为你打开日历 📅","ops":[{"type":"nav","module":"calendar"}],"actions":[{"kind":"nav-module","label":"📅 打开日历","module":"calendar"}]}

输入：帮我记住周五下午三点开会
输出：{"text":"收到，已帮你创建这条待办 ⏰","ops":[{"type":"todo.add","content":"开会","dueDate":"2026-09-18 15:00"}],"actions":[{"kind":"nav-todo-panel","label":"✅ 去待办清单"}],"createTodo":"周五下午三点开会"}

输入：帮我记三件事：买牛奶、交电费、给妈妈打电话
输出：{"text":"好嘞，三件都记下了 ✅","ops":[{"type":"todo.addMany","items":[{"content":"买牛奶"},{"content":"交电费"},{"content":"给妈妈打电话"}]}],"actions":[{"kind":"nav-todo-panel","label":"✅ 查看清单"}]}`;
}

function buildBriefPrompt(ctx) {
  return `你是微信小程序里的「待办小助手」。现在是 ${nowCn(Date.now())}（${todayStr(Date.now())}）。

【用户待办明细】
${formatTodoBrief(ctx.todoBrief)}

【统计】今日待办 ${ctx.todayTotal ?? 0} 条，已完成 ${ctx.todayDone ?? 0} 条，进行中 ${ctx.activeTodoCount ?? 0} 条

请生成一条"今日简报"，要求：
1. 开头一句问候（按当前时间判断早上/下午/晚上），语气自然亲切；
2. 用 2-4 行说清今天的关键情况：有多少待办、已完成多少、有没有逾期或高优先级的事；
3. 结尾给一条可执行的建议（今天优先做哪件、或提醒补充截止时间）；
4. 全程不超过 120 字，可用 emoji，不要罗列全部待办。

只输出一段合法 JSON：
{ "text": "简报内容", "ops": [], "actions": [{"kind":"nav-todo-panel","label":"✅ 去待办清单"}] }`;
}

/* ============================ 主流程 ============================ */

/** 拼装 user 消息：带图时用 content 数组（OpenAI / 智谱通用格式） */
function buildUserContent(message, images) {
  const imgs = Array.isArray(images) ? images.filter((s) => typeof s === 'string' && s.length > 32).slice(0, 3) : [];
  if (!imgs.length) return message;
  const arr = imgs.map((url) => ({ type: 'image_url', image_url: { url } }));
  arr.push({ type: 'text', text: message || '请描述这张图片的内容，并帮我看看能转成什么待办。' });
  return arr;
}

/** ping：自检配置状态，可选做一次真实探测 */
async function ping(event, context) {
  const apiKey = (process.env.AI_API_KEY || process.env.ZHIPU_API_KEY || FALLBACK_API_KEY || '').trim();
  const apiBase = (process.env.AI_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '');
  const provider = resolveProvider(apiBase);
  const configured = (process.env.AI_MODEL || '').trim();
  const models = candidateModels(provider, configured, false);
  const budget = remainingBudgetMs(context);

  const info = {
    success: true,
    provider,
    base: apiBase,
    model: models[0] || '',
    candidates: models,
    hasKey: !!apiKey,
    thinking: (process.env.AI_THINKING || 'disabled').trim(),
    hasVisionModel: !!(process.env.AI_VISION_MODEL || '').trim(),
    // 本次调用的可用预算（毫秒）。正常应接近云函数超时设置（60s → 约 60000）；
    // 若这里只有 3000 上下，说明云函数超时还是平台默认的 3 秒，必须去控制台改。
    budgetMs: budget
  };

  if (!event || !event.probe) return info;
  if (!apiKey) return { ...info, success: false, error: 'AI_NOT_CONFIGURED', message: '未配置 AI_API_KEY' };

  const low = budgetTooLow(context);
  if (low) return { ...info, ...low };

  const started = Date.now();
  try {
    const { resp, model } = await requestWithBackup(
      apiBase,
      apiKey,
      models,
      { temperature: 0.1, max_tokens: 16, messages: [{ role: 'user', content: '回复"OK"' }] },
      info.thinking === 'enabled' ? 'enabled' : 'disabled',
      budgetedTimeout(context),
      context,
      false
    );
    const text = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
    return { ...info, success: true, model, latencyMs: Date.now() - started, sample: clampText(text, 40) };
  } catch (err) {
    console.error('[helperChat] ping 失败:', err && err.message);
    return { ...info, success: false, latencyMs: Date.now() - started, ...describeUpstream(err) };
  }
}

async function chat(event, context) {
  const apiKey = (process.env.AI_API_KEY || process.env.ZHIPU_API_KEY || FALLBACK_API_KEY || '').trim();
  const apiBase = (process.env.AI_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '');
  const provider = resolveProvider(apiBase);
  const thinking = (process.env.AI_THINKING || 'disabled').trim() === 'enabled' ? 'enabled' : 'disabled';

  // 预算不足时直接快失败：与其在第 3 秒被平台强杀（客户端只能看到 -504003 这种
  // 没有指向性的错误），不如立刻返回「去控制台把超时改到 60 秒」这条可执行提示。
  const low = budgetTooLow(context);
  if (low) {
    console.warn('[helperChat] 超时预算不足，放弃调用上游：' + low.budgetMs + 'ms');
    return low;
  }
  const timeoutMs = budgetedTimeout(context);

  const message = clampText(event.message, 800);
  const images = Array.isArray(event.images) ? event.images : [];
  const isBrief = event.mode === 'brief';

  if (!message && !images.length) {
    return { success: false, error: 'NO_MESSAGE', message: '缺少 message' };
  }
  if (!apiKey) {
    return { success: false, error: 'AI_NOT_CONFIGURED', message: '未配置 AI_API_KEY' };
  }

  const ctx = {
    todayTotal: Number(event.todayTotal) || 0,
    todayDone: Number(event.todayDone) || 0,
    activeTodoCount: Number(event.activeTodoCount) || 0,
    currentPage: clampText(event.currentPage, 30),
    todoBrief: Array.isArray(event.todoBrief) ? event.todoBrief : []
  };

  // 带图走视觉模型候选链，纯文本走通用链
  const visionConfigured = (process.env.AI_VISION_MODEL || '').trim();
  const models = images.length
    ? candidateModels(provider, visionConfigured, true)
    : candidateModels(provider, (process.env.AI_MODEL || '').trim(), false);

  if (!models.length) {
    return { success: false, error: 'AI_MODEL_UNAVAILABLE', message: '没有可用模型，请配置 AI_MODEL' };
  }

  const systemPrompt = isBrief ? buildBriefPrompt(ctx) : buildChatPrompt(ctx);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(event.history) ? event.history.slice(-10).map((h) => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: typeof h.text === 'string' ? h.text : String(h.text || '')
    })) : []),
    { role: 'user', content: buildUserContent(message, images) }
  ];

  const payload = {
    temperature: isBrief ? 0.8 : 0.7,
    max_tokens: 1200,
    messages
  };

  const started = Date.now();
  let resp;
  let usedModel = models[0];
  let usedProvider = provider;
  try {
    const r = await requestWithBackup(
      apiBase, apiKey, models, payload, thinking, timeoutMs, context, images.length > 0
    );
    resp = r.resp;
    usedModel = r.model;
    usedProvider = r.provider;
  } catch (err) {
    console.error('[helperChat] upstream error:', err && err.message);
    return { success: false, ...describeUpstream(err) };
  }

  const content =
    resp &&
    resp.choices &&
    resp.choices[0] &&
    resp.choices[0].message &&
    resp.choices[0].message.content;

  const raw = extractJSON(content);
  if (!raw || typeof raw !== 'object') {
    console.error('[helperChat] unparseable:', String(content).slice(0, 300));
    // 模型偶尔会忘记套 JSON：把纯文本当作回复兜底，也好过整条失败
    const plain = clampText(content, 400);
    if (plain) {
      return {
        success: true,
        text: plain,
        ops: [],
        actions: [],
        createTodo: null,
        meta: { model: usedModel, provider: usedProvider, ms: Date.now() - started, degraded: 'plain-text' }
      };
    }
    return {
      success: false,
      error: 'AI_UNPARSEABLE',
      message: 'AI 返回格式异常，已自动切换到本地规则引擎'
    };
  }

  const ops = normalizeOps(raw.ops);

  // 向后兼容：老版本只有 createTodo，没有 ops → 这里补一条 todo.add
  if (!ops.length && raw.createTodo) {
    const content2 = clampText(raw.createTodo, 200);
    if (content2) ops.push({ type: 'todo.add', content: content2, tags: [] });
  }

  return {
    success: true,
    text: clampText(raw.text, 400),
    ops,
    actions: normalizeActions(raw.actions),
    createTodo: clampText(raw.createTodo, 200) || null,
    meta: {
      model: usedModel,
      provider: usedProvider,
      ms: Date.now() - started,
      vision: images.length > 0,
      mode: isBrief ? 'brief' : 'chat',
      usage: resp && resp.usage ? resp.usage : null
    }
  };
}

exports.main = async (event, context) => {
  try {
    const ev = event || {};
    if (ev.action === 'ping') return await ping(ev, context);
    return await chat(ev, context);
  } catch (err) {
    console.error('[helperChat] fatal:', err && err.message);
    const timedOut = /TIMEOUT|timeout/i.test((err && err.message) || '');
    return {
      success: false,
      error: timedOut ? 'AI_TIMEOUT' : 'AI_ERROR',
      message: timedOut
        ? '上游模型响应超时。若频繁出现，请把云函数超时时间调到 60 秒。'
        : (err && err.message) || 'AI 对话失败'
    };
  }
};
