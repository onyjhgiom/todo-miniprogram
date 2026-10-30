// 云函数 goalPlanner —— 「目标拆解」AI 生成
//
// 职责：把用户输入的【一个目标】拆解为可立即执行的子任务序列，并做「任务分配」，严格输出 JSON。
//
// 关键约束（来自产品需求，改动前请务必理解）：
//   1. 输出会被小程序端直接 JSON.parse 后写入数据库，任何多余文字都会导致解析失败；
//      因此提示词里已三令五申「只输出 JSON」，本函数仍做了兜底提取（去代码围栏 + 截取首尾花括号）。
//   2. 12 条拆解规则（P0 可执行性 / P1 时间结构 / P2 启动设计 / P3 信息补全）+
//      4 条分配规则（P4 阶段/优先级/依赖/资源）全部写在提示词里，
//      本函数只做「结构级」的二次校验与修复（数量、offset 单调、末尾留 2 天缓冲、字段裁剪），
//      不擅自改写模型给的文案，避免破坏语义。
//
// 配置（云函数环境变量；已内置兜底 Key，完全不配也能直接用）：
//   AI_API_KEY      选填。API Key；不配则用源码里的 FALLBACK_API_KEY（仅服务端，不会下发客户端）
//   AI_API_BASE     选填。默认 https://open.bigmodel.cn/api/paas/v4（智谱 GLM）
//   AI_MODEL        选填。默认 glm-5.3-flash（强制思考，推理更强，适合做全面拆解）
//   AI_THINKING     选填。enabled | disabled；默认按模型判定（glm-5.3 系列强制思考）
//   AI_JSON_MODE    选填。置为 '1' 时附带 response_format={type:'json_object'}（部分服务不支持，故默认关闭）
// 未配置 AI_API_KEY 且兜底 Key 也缺失时返回 AI_NOT_CONFIGURED，客户端自动切换本地规则兜底拆解。
//
// ⚠️ 超时是命门：新版 CloudBase 云函数默认超时仅 3 秒，撑不住大模型调用。
//    → 请把云函数超时设为 60 秒（见本目录 config.json，实测仍建议去云开发控制台再确认一次）。
//    代码侧已按平台剩余预算收敛上游超时，预算不足立刻返回 AI_TIMEOUT_BUDGET 并附修复指引。

const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 默认走火山方舟（豆包，OpenAI 兼容接口）
const DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL = 'doubao-seed-character-260628';

/** 兜底 Key：优先读环境变量 AI_API_KEY，没配时用这里，做到「上传即可用」。
 *  ⚠️ 这是服务端代码，Key 不会下发到客户端；但若仓库对外分发会随代码泄露。
 *     生产建议：在云函数环境变量里配 AI_API_KEY，然后把下面这行清空。 */
const FALLBACK_API_KEY = '';

/** 冷备档案：主档案（火山方舟）整体失败（Key 失效 / 欠费 / 模型下线 / 网络不通）时顶上。
 *  实测 2026-09-14：豆包空跑 1.0s、长 JSON 4.3s；智谱 glm-4.6 空跑要 11-14s，故只作兜底。 */
const AI_BACKUP = {
  base: (process.env.AI_BACKUP_BASE || 'https://open.bigmodel.cn/api/paas/v4').trim().replace(/\/+$/, ''),
  key: (process.env.AI_BACKUP_KEY || '').trim(),
  model: 'glm-4.6',
  // AI_BACKUP_DISABLE=1 可关闭冷备（单供应商排障 / 离线自检时用）
  enabled: (process.env.AI_BACKUP_DISABLE || '').trim() !== '1'
};

// 单次上游请求超时上限（实际会再按平台剩余预算收敛，见 budgetedTimeout）
const REQUEST_TIMEOUT = Math.max(5000, Number(process.env.AI_TIMEOUT_MS) || 60000);
const BUDGET_MARGIN = 700; // 给平台回收、序列化留的余量（毫秒）

const STYLES = ['balanced', 'aggressive', 'conservative'];
const CATEGORIES = ['学习', '工作', '健康', '生活', '财务', '其他'];
const REPEATS = ['daily', 'weekly', 'none'];
const PHASES = ['准备', '执行', '收尾'];
const PRIORITIES = ['high', 'medium', 'low'];
const PRIORITY_CN = { high: '高', medium: '中', low: '低' };

/* ============================ 提示词 ============================ */
// 占位符：{today} {today_weekday} {style} {daily_minutes} {deadline}
const SPEC_TEMPLATE = `你要做「目标拆解」：把一个目标拆解为可立即执行的子任务序列，并给出清晰的「任务分配」。
你的输出会被程序直接解析为 JSON 存入数据库，任何格式错误都会导致功能故障，因此必须严格遵守输出规范，不得输出 JSON 以外的任何文字，不得使用 markdown 代码块标记。

【当前上下文】
- 今天日期：{today}（{today_weekday}）
- 拆解风格：{style}（balanced=均衡，aggressive=前期激进，conservative=前期保守）
- 用户每日可用时间：{daily_minutes} 分钟
- 用户目标截止日：{deadline}（可能为空，为空时你根据目标性质自行估算合理周期并在 assumption 中说明）

【拆解原则，按优先级执行】
P0 可执行性：
1. 每个子任务必须是动词开头的具体动作，能在 {daily_minutes} 分钟内完成或明确分段。
2. 禁止空泛表述，例如"学习英语"是禁止的，必须改成"用APP背50个高频词"；"准备考试"必须改成"做一套真题并批改"。
3. 任务之间禁止死锁依赖，任务 N+1 依赖任务 N 时，在 depends_on 中注明前置任务标题。
P1 时间结构：
4. 按 {style} 分配任务密度：balanced 时子任务均匀分布在整个周期；aggressive 时前40%时间完成60%的任务（适合时间紧或拖延用户）；conservative 时前40%时间只完成30%的任务（适合时间碎片化或新手）。
5. deadline_offset 为相对今天的天数，0 表示今天开始。
6. 最后一个子任务的 deadline_offset 必须 ≤ 总天数减2，为目标留出至少2天缓冲，除非用户明确表达时间非常紧迫。
7. 周期性任务（每天、每周重复做的事）用 repeat 字段表达，禁止展开成多条独立任务。
P2 启动设计：
8. 第一个子任务必须满足三个条件：现在立刻就能做、15分钟内能完成、不需要任何准备材料。这是为了降低用户启动门槛，第一个任务设计失败会导致整个拆解被弃用。
9. 每个子任务给一句不超过20字的执行提示 tip，优先给出具体工具、方法或资源。
P3 信息补全：
10. 用户输入信息不足时，做合理假设并写入 assumption 字段，例如"未说明英语基础，按四级水平估算"。
11. 只有一条关键信息缺失且完全无法假设时，才在 assumption 中提出一个反问。
12. 永远不要要求用户提供超过1条信息。

【分配设计，让拆解更全面可执行】
P4 阶段 / 优先级 / 依赖 / 资源：
13. 给每个子任务标注 phase（阶段）："准备"=规划与取材、"执行"=核心推进、"收尾"=检查与复盘；一条合理的拆解应同时包含三个阶段，缺一不可。
14. 给每个子任务标 priority（优先级）："high"=关键路径、不做就崩；"medium"=重要但可缓；"low"=锦上添花。用户时间紧张时优先保证 high 完成。
15. depends_on 列出必须在该任务之前完成的任务标题（最多2个，可为空数组 []），形成清晰的前后置关系而非死锁；只有真正存在先后依赖才填。
16. resources 写明完成该任务最关键的 1 个资源/工具/资料（不超过20字），例如"墨墨背单词APP""Excel模板"；不需要任何工具则填空字符串 ""。

【输出格式】
严格输出 JSON，结构如下：
{"assumption":"string，你的核心假设，不超过50字","total_days":number，总天数,"milestones":[{"title":"string，不超过15字，动词开头","phase":"准备|执行|收尾","deadline_offset":number，相对今天的天数,"duration_minutes":number，预计用时,"repeat":"daily|weekly|none","category":"学习|工作|健康|生活|财务|其他","priority":"high|medium|low","depends_on":["前置任务标题"],"resources":"string，不超过20字，没有则填空串","tip":"string，不超过20字"}],"first_action":"string，不超过25字，用户现在立刻能做的最小一步","risk_warning":"string，潜在风险提示，不超过30字，没有风险则填 null"}

【示例】
输入：目标「9月读完《认知觉醒》，大概300页」，截止「2026-09-30」，风格 balanced，每天60分钟。
输出：{"assumption":"按阅读速度20页/小时估算，每天可读约25页","total_days":18,"milestones":[{"title":"通读目录，标重点章","phase":"准备","deadline_offset":0,"duration_minutes":20,"repeat":"none","category":"学习","priority":"high","depends_on":[],"resources":"豆瓣书评","tip":"先看豆瓣书评找重点章"},{"title":"读第一至第三章","phase":"执行","deadline_offset":3,"duration_minutes":60,"repeat":"none","category":"学习","priority":"high","depends_on":["通读目录，标重点章"],"resources":"","tip":"每章末尾用自己的话总结3行"},{"title":"读第四至第六章","phase":"执行","deadline_offset":6,"duration_minutes":60,"repeat":"none","category":"学习","priority":"medium","depends_on":[],"resources":"荧光笔","tip":"第六章讲情绪，建议做标记"},{"title":"读剩余章节","phase":"执行","deadline_offset":9,"duration_minutes":60,"repeat":"none","category":"学习","priority":"medium","depends_on":[],"resources":"","tip":"加快扫读，案例可略过"},{"title":"重读标记段整笔记","phase":"收尾","deadline_offset":12,"duration_minutes":45,"repeat":"none","category":"学习","priority":"medium","depends_on":["读第四至第六章"],"resources":"康奈尔笔记法","tip":"用康奈尔笔记法一页纸搞定"},{"title":"写3条改进计划","phase":"收尾","deadline_offset":14,"duration_minutes":40,"repeat":"none","category":"学习","priority":"low","depends_on":["重读标记段整笔记"],"resources":"","tip":"只写下周就能执行的"}],"first_action":"现在打开书，花20分钟只看目录和序言","risk_warning":null}

【输出前自检，必须全部通过】
1. 你的输出能被严格解析为合法 JSON 吗？
2. milestones 数量在 3 到 12 之间吗？
3. 所有 deadline_offset ≥ 0 且最后一个 ≤ total_days 减 2 吗？
4. 第一个任务真的15分钟内、零准备能开始吗？
5. 有没有重复、空泛、或互相死锁的任务？
6. 是否每个任务都有 phase / priority，且三个阶段都覆盖到了？`;

/* ============================ 工具函数 ============================ */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 取东八区「今天」的 YYYY-MM-DD */
function todayStr(now) {
  const d = new Date(now + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekdayStr(now) {
  const d = new Date(now + 8 * 3600 * 1000);
  return WEEKDAYS[d.getUTCDay()];
}

/** 'YYYY-MM-DD' → 东八区当天 00:00 的时间戳 */
function parseDateTs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d) - 8 * 3600 * 1000;
}

/** 截止日距今还有几天（今天=0） */
function daysFromToday(now, deadline) {
  const ts = parseDateTs(deadline);
  if (ts === null) return null;
  const todayTs = parseDateTs(todayStr(now));
  return Math.round((ts - todayTs) / 86400000);
}

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
            try {
              const j = JSON.parse(data);
              detail = (j && j.error && (j.error.message || j.error.type)) || '';
            } catch (e) {
              detail = String(data).slice(0, 160);
            }
            const err = new Error(`UPSTREAM_${res.statusCode}${detail ? ':' + detail : ''}`);
            err.statusCode = res.statusCode;
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
 * thinking 参数不被支持时，去掉后重试一次。
 * 典型是智谱 glm-5.3 系列：它「始终思考」，传 disabled 会被拒；
 * 但部分中转/旧版本又不认 thinking 字段。按文案判断，去掉后重试。
 */
function isThinkingUnsupported(err) {
  if (!err) return false;
  if (err.statusCode !== 400 && err.statusCode !== 422) return false;
  return /thinking|reasoning|思考/i.test(`${err.message || ''}`);
}

/** 是否对当前模型开启思考：env 显式 > 模型默认（glm-5.3 强制思考） */
function resolveThinking(model) {
  const e = (process.env.AI_THINKING || '').trim().toLowerCase();
  if (e === 'enabled') return 'enabled';
  if (e === 'disabled') return 'disabled';
  // glm-5.3 系列强制思考，关不掉（传 disabled 直接报 1210）
  if (/glm-5\.3/i.test(model)) return 'enabled';
  // 其余模型一律关思考：豆包带思考会慢 2-3 倍，对拆解质量没有正向帮助
  return 'disabled';
}

/** 是否属于「换一家供应商还有救」的失败（Key 失效 / 欠费 / 模型下线 / 网络不通）。
 *  参数类错误（400/422）不切换——换一家同样报错，只会白等一轮。 */
function isProviderLevelFailure(err) {
  const msg = (err && err.message) || '';
  if (/TIMEOUT/i.test(msg)) return false; // 预算已耗尽，再打一发必然还是超时
  if (/UPSTREAM_400|UPSTREAM_422/.test(msg)) return false;
  return /UPSTREAM_(401|402|403|404|429)|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(msg);
}

/** 主档案 → 冷备 依次尝试，避免一个 Key 出问题就整块功能不可用 */
async function requestWithProviderFallback(apiBase, apiKey, model, payload, thinking, timeoutMs) {
  const attempts = [{ base: apiBase, key: apiKey, model }];
  if (AI_BACKUP.enabled && AI_BACKUP.key && apiBase !== AI_BACKUP.base) {
    attempts.push({ base: AI_BACKUP.base, key: AI_BACKUP.key, model: AI_BACKUP.model });
  }
  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    try {
      return await requestOnce(a.base, a.key, a.model, payload, resolveThinking(a.model) || thinking, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (i < attempts.length - 1 && isProviderLevelFailure(e)) {
        console.warn('[goalPlanner] 主档案失败（' + ((e && e.message) || '') + '），切换冷备重试');
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('AI 调用失败');
}

async function requestOnce(base, apiKey, model, payloadBase, thinking, timeoutMs) {
  const payload = { ...payloadBase, model };
  if (thinking) payload.thinking = { type: thinking };
  try {
    return await requestJSON(`${base}/chat/completions`, payload, apiKey, timeoutMs);
  } catch (err) {
    if (thinking && isThinkingUnsupported(err)) {
      console.warn('[goalPlanner] 服务端不支持 thinking 参数，去掉后重试');
      const plain = { ...payloadBase, model };
      return await requestJSON(`${base}/chat/completions`, plain, apiKey, timeoutMs);
    }
    throw err;
  }
}

/** 平台给本次调用的剩余时间（毫秒），取不到返回 null */
function remainingBudgetMs(context) {
  try {
    if (context && typeof context.getRemainingTimeInMillis === 'function') {
      const v = Number(context.getRemainingTimeInMillis());
      if (isFinite(v) && v > 0) return v;
    }
  } catch (_e) { /* 平台不支持，降级 */ }
  return null;
}

/** 本次上游请求真正可用的超时：按剩余预算收敛，给回收留余量 */
function budgetedTimeout(context) {
  const budget = remainingBudgetMs(context);
  if (budget === null) return REQUEST_TIMEOUT;
  return Math.max(600, Math.min(REQUEST_TIMEOUT, Math.round(budget - BUDGET_MARGIN)));
}

/** 预算低到根本不可能拿到模型回复时：直接快失败并告诉调用方怎么修 */
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
      '请在云开发控制台 → 云函数 → goalPlanner → 版本与配置，把超时时间改为 60 秒。',
    budgetMs: budget
  };
}

/** 从模型输出中稳健提取 JSON：去代码围栏 + 截取首尾花括号 + 花括号配对兜底 */
function extractJSON(text) {
  if (!text) return null;
  let s = String(text).trim();
  // 去掉所有可能残留的代码围栏（```json 与 ``` 均清掉，兼容头尾）
  s = s.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // 兜底：模型偶尔在 JSON 前后夹带散文（如"以下是拆解：…希望对你有帮助"），
    // 用花括号配对找出第一个完整对象再试一次。
    return extractFirstBalanced(candidate);
  }
}

/** 花括号配对：从第一个 { 起，找到深度归零的第一个完整 JSON 对象 */
function extractFirstBalanced(s) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') {
      if (start < 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const sub = s.slice(start, i + 1);
        try {
          return JSON.parse(sub);
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

function toInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : def;
}

function clampText(v, max, def) {
  if (typeof v !== 'string' || !v.trim()) return def === undefined ? '' : def;
  return v.trim().slice(0, max);
}

/**
 * 结构级校验 + 修复（不改写文案语义）：
 *  - milestones 数量 3~12（不足 3 条视为不可用，交前端兜底）
 *  - deadline_offset ≥ 0 且按升序
 *  - 末尾任务 ≤ total_days - 2（不够就把 total_days 撑到 last+2；有截止日时压缩到截止日内）
 *  - 首任务 duration 若 > 15 分钟，仅提示不改文案（模型已受规则 8 约束）
 *  - phase / priority / depends_on / resources 仅做裁剪与合法化，缺失不报错
 */
function normalizePlan(raw, opts) {
  if (!raw || typeof raw !== 'object') return null;
  const list = Array.isArray(raw.milestones) ? raw.milestones : [];
  const milestones = [];

  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const title = clampText(it.title, 30);
    if (!title) continue;

    let duration = toInt(it.duration_minutes, opts.dailyMinutes);
    if (!Number.isFinite(duration) || duration < 1) duration = 1;
    if (duration > 720) duration = opts.dailyMinutes;

    // 分配字段：缺失/非法时给安全默认值，不阻断整条计划
    const phase = PHASES.indexOf(it.phase) >= 0 ? it.phase : '执行';
    const priority = PRIORITIES.indexOf(it.priority) >= 0 ? it.priority : 'medium';
    let depends = [];
    if (Array.isArray(it.depends_on)) {
      depends = it.depends_on
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim())
        .slice(0, 2);
    }
    const resources = clampText(it.resources, 20);

    milestones.push({
      title,
      phase,
      deadline_offset: Math.max(0, toInt(it.deadline_offset, 0)),
      duration_minutes: Math.min(720, duration),
      repeat: REPEATS.indexOf(it.repeat) >= 0 ? it.repeat : 'none',
      category: CATEGORIES.indexOf(it.category) >= 0 ? it.category : '其他',
      priority,
      depends_on: depends,
      resources,
      tip: clampText(it.tip, 40)
    });
  }

  if (milestones.length < 3 || milestones.length > 12) return null;

  milestones.sort((a, b) => a.deadline_offset - b.deadline_offset);

  let totalDays = toInt(raw.total_days, 0);
  const deadlineDays = opts.deadlineDays; // null 表示无截止日
  if (!totalDays || totalDays < 3) {
    totalDays = deadlineDays && deadlineDays > 2 ? deadlineDays : Math.max(7, milestones.length * 2 + 2);
  }
  if (deadlineDays !== null && deadlineDays >= 3 && totalDays > deadlineDays) {
    totalDays = deadlineDays;
  }
  totalDays = Math.max(3, Math.min(400, totalDays));

  // 规则 6：末尾任务至少留 2 天缓冲
  const last = milestones[milestones.length - 1];
  const maxOffset = Math.max(0, totalDays - 2);
  if (last.deadline_offset > maxOffset) {
    if (deadlineDays === null) {
      totalDays = last.deadline_offset + 2;
    } else {
      const ratio = maxOffset / (last.deadline_offset || 1);
      milestones.forEach((m) => {
        m.deadline_offset = Math.max(0, Math.round(m.deadline_offset * ratio));
      });
    }
  }

  return {
    assumption: clampText(raw.assumption, 80),
    total_days: totalDays,
    milestones,
    first_action: clampText(raw.first_action, 50),
    risk_warning:
      raw.risk_warning === null || raw.risk_warning === undefined
        ? null
        : clampText(raw.risk_warning, 60) || null
  };
}

/** 把上游错误翻译成前端可读的原因（与 faceReading / palmReading / helperChat 保持一致） */
function describeUpstream(err) {
  const msg = (err && err.message) || '';
  const code = err && err.statusCode;

  if (code === 402 || /insufficient\s*balance|余额|quota/i.test(msg)) {
    return { error: 'AI_BALANCE', message: 'AI 账户余额不足，暂时无法拆解' };
  }
  if (code === 401 || code === 403) {
    return { error: 'AI_AUTH', message: 'API Key 无效或无权限，请检查 AI_API_KEY' };
  }
  if (code === 429) {
    return { error: 'AI_RATE_LIMIT', message: '拆解请求过于频繁，请稍后再试' };
  }
  if (code === 404) {
    return { error: 'AI_MODEL_UNAVAILABLE', message: '模型不可用，请检查 AI_MODEL 配置' };
  }
  if (code === 400 || code === 422) {
    return {
      error: 'AI_BAD_REQUEST',
      message: `模型拒绝了这次请求（${msg.replace(/^UPSTREAM_\d+:?/, '') || '参数不合规'}）`
    };
  }
  if (msg === 'TIMEOUT') {
    return { error: 'AI_TIMEOUT', message: '拆解超时，请稍后重试或缩短目标描述' };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|网络/.test(msg)) {
    return { error: 'AI_NETWORK', message: '无法连接 AI 服务，请稍后重试' };
  }
  return { error: 'AI_ERROR', message: msg || 'AI 服务异常' };
}

/* ============================ 主流程 ============================ */
async function plan(event, context) {
  const apiKey = (process.env.AI_API_KEY || FALLBACK_API_KEY || '').trim();
  const apiBase = (process.env.AI_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '');
  const model = (process.env.AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  const goal = clampText(event.goal, 200);
  if (!goal) {
    return { success: false, error: 'NO_GOAL', message: '缺少目标描述' };
  }
  const style = STYLES.indexOf(event.style) >= 0 ? event.style : 'balanced';
  let dailyMinutes = toInt(event.dailyMinutes, 60);
  if (!Number.isFinite(dailyMinutes) || dailyMinutes < 5) dailyMinutes = 5;
  if (dailyMinutes > 960) dailyMinutes = 960;

  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(event.deadline || '').trim())
    ? String(event.deadline).trim()
    : '';
  const now = Date.now();
  const deadlineDays = deadline ? daysFromToday(now, deadline) : null;

  if (!apiKey) {
    return { success: false, error: 'AI_NOT_CONFIGURED', message: '未配置 AI_API_KEY' };
  }

  // 预算紧张时直接快失败：与其被平台强杀（客户端只看到无指向性的 -504003），
  // 不如立刻返回「去控制台把超时改到 60 秒」这条可执行提示。
  const low = budgetTooLow(context);
  if (low) {
    console.warn('[goalPlanner] 超时预算不足，放弃调用上游：' + low.budgetMs + 'ms');
    return low;
  }
  const timeoutMs = budgetedTimeout(context);

  const thinking = resolveThinking(model);

  const prompt = SPEC_TEMPLATE.replace('{today}', todayStr(now))
    .replace('{today_weekday}', weekdayStr(now))
    .replace(/\{style\}/g, style)
    .replace(/\{daily_minutes\}/g, String(dailyMinutes))
    .replace('{deadline}', deadline || '（用户未指定，请你根据目标性质自行估算合理周期，并在 assumption 中说明）');

  const payload = {
    model,
    temperature: 0.5,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `请拆解我的目标：${goal}\n（拆解风格：${style}；每天可用 ${dailyMinutes} 分钟；截止日：${deadline || '未指定'}）\n只输出 JSON。`
      }
    ]
  };
  // 部分 OpenAI 兼容服务不支持 response_format，故默认关闭，需显式开启
  if (process.env.AI_JSON_MODE === '1') payload.response_format = { type: 'json_object' };

  let resp;
  try {
    resp = await requestWithProviderFallback(apiBase, apiKey, model, payload, thinking, timeoutMs);
  } catch (err) {
    console.error('[goalPlanner] upstream error:', err && err.message);
    return { success: false, ...describeUpstream(err) };
  }

  const content =
    resp &&
    resp.choices &&
    resp.choices[0] &&
    resp.choices[0].message &&
    resp.choices[0].message.content;

  const raw = extractJSON(content);
  const planResult = normalizePlan(raw, { dailyMinutes, deadlineDays });

  if (!planResult) {
    console.error('[goalPlanner] unparseable:', String(content).slice(0, 300));
    return { success: false, error: 'AI_UNPARSEABLE', message: '模型未返回可用的拆解结果，请换个说法再试' };
  }

  return {
    success: true,
    plan: planResult,
    meta: {
      model,
      thinking: thinking || 'off',
      fallback: !process.env.AI_API_KEY,
      usage: resp && resp.usage ? resp.usage : null
    }
  };
}

exports.main = async (event, context) => {
  try {
    return await plan(event || {}, context);
  } catch (err) {
    console.error('[goalPlanner] fatal:', err && err.message);
    return { success: false, error: 'AI_ERROR', message: (err && err.message) || '拆解失败' };
  }
};
