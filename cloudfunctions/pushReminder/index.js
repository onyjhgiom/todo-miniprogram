// 云函数 pushReminder
// 微信订阅消息「真正发送」的服务端入口（前端无法调用 openapi，必须由云函数代发）。
// 两个 action：
//   grant：前端用户点击「开启微信通知」并授权成功后调用，把授权记录写入 user_subs
//           （一次性订阅：授权一次 = quota +1，且 7 天有效期；可累积，每发 1 条 quota -1）
//   send ：前端到期派发（dispatchSubs）或本云函数被 remind 复用调用，真正发消息
//
// 部署：右键 cloudfunctions/pushReminder → 上传并部署；云开发控制台新建集合 user_subs
// user_subs 统一 schema：
//   _openid, tmplId, grantedAt (最新授权时间), expireAt (=grantedAt+7d),
//   quota (剩余可推送条数，授权一次 +1，推送一次 -1，与 todos.remind 保持一致)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const SUB_COL = 'user_subs';
// 一次性订阅有效期约 7 天（微信官方上限）。超过则视为失效，不再推送。
const TTL = 7 * 24 * 3600 * 1000;

function getOpenid() {
  const ctx = cloud.getWXContext();
  if (!ctx.OPENID) throw new Error('未拿到 OPENID');
  return ctx.OPENID;
}
function clip(s, n) {
  s = (s == null ? '' : String(s)).trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * miniprogramState 白名单：只允许 developer / trial / formal。
 * 【为什么要校验】非法值（如拼错成 'dev'、'test'）会被原样透传给微信接口，
 * 发出去必然失败，而且报错信息不会告诉你是拼写问题 → 排查成本极高。
 * 非法值一律回落「环境变量 MP_STATE」→ 再回落 'trial'。
 */
const MP_STATES = ['developer', 'trial', 'formal'];
function normalizeState(v) {
  return MP_STATES.indexOf(v) >= 0 ? v : '';
}

/**
 * 订阅消息模板字段映射（KEY_MAP）—— 已按「我的模板 → 模板详情」截图确认的真实 key
 * 模板 ID：T4UwrfCq5J94JYAG1zucDiLN_OBvZeb58LNpfkHKnsg（标题：日程提醒，类目：备忘录）
 * 关键词 → 真实字段（来源：详情内容里的 {{xxx.DATA}}）：
 *   提醒内容 → thing2   到期时间 → date9   开始时间 → time6   截止时间 → time38   提醒时间 → time30
 * 【重要】微信字段序号**不连续、也不按类型顺序**（thing2/date9/time6/time38/time30），
 * 千万不要臆测编号，必须以模板详情的 {{xxx.DATA}} 为准。
 * 【重要】模板 5 个关键词必须**全部填充**，少一个即报 47003（模板参数不准确）。
 * 字段类型决定值格式：thing=≤20字符文本；date=日期；time=时间（支持带年月日）。
 */
const KEY_MAP = {
  content: 'thing2',    // 提醒内容（thing 类）
  expireTime: 'date9',  // 到期时间（date 类）
  startTime: 'time6',   // 开始时间（time 类）
  endTime: 'time38',    // 截止时间（time 类）
  remindTime: 'time30'  // 提醒时间（time 类）
};

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}
/** date 类字段：YYYY-MM-DD */
function fmtDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
/**
 * time 类字段：只允许 HH:mm 或 HH:mm:ss。
 * 【踩坑】官方参数限制中 time 类的格式**不含年月日**（「支持+年月日」只适用于 date 类），
 * 带上日期会直接 47003（模板参数不准确）。曾用 `YYYY-MM-DD HH:mm` → 首测必失败。
 * 两个云函数（pushReminder / todos）必须保持同一套格式。
 */
function fmtClock(ts) {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/**
 * 构造模板字段。
 * @param at  本次提醒时刻（ms）
 * @param due 事项截止时间（ms）；缺省回落 at
 * 【为什么必须接 due】前端 utils/subscribe.ts 一直有传 due，但这里以前没接收也没转发，
 * 结果「到期时间 / 截止时间」两个字段只能拿提醒时刻顶替 → 用户看到的到期时间是错的。
 * 语义与 todos.remind 的 buildReminderData 保持一致（同为 5 字段模板）。
 */
function buildData(title, desc, at, due) {
  const tAt = at || Date.now();
  const tDue = due || tAt;
  // 备注无独立关键词，并入「提醒内容」（thing 类上限 20 字）
  const content = desc
    ? `${clip(title || '待办提醒', 12)}（${clip(desc, 6)}）`
    : clip(title || '待办提醒', 20);
  const K = KEY_MAP;
  const d = {};
  d[K.content] = { value: clip(content, 20) };   // thing 类（≤20 字符）
  d[K.expireTime] = { value: fmtDate(tDue) };    // date 类：到期时间 → 截止日
  d[K.startTime] = { value: fmtClock(tAt) };     // time 类：开始时间（待办无开始时间，用提醒时刻占位）
  d[K.endTime] = { value: fmtClock(tDue) };      // time 类：截止时刻
  d[K.remindTime] = { value: fmtClock(tAt) };    // time 类：提醒时刻
  return d;
}

async function grant(tmplId) {
  const OPENID = getOpenid();
  if (!tmplId) return { success: false, error: 'tmplId 为空' };
  const now = Date.now();
  const existing = await db
    .collection(SUB_COL)
    .where({ _openid: OPENID, tmplId })
    .limit(1)
    .get();
  if (existing.data && existing.data.length) {
    const rec = existing.data[0];
    const oldQuota = rec.quota || 0;
    const nextQuota = oldQuota + 1;
    // 重新授权：刷新授权时间、quota +1（累积），expireAt 重置
    await db
      .collection(SUB_COL)
      .doc(rec._id)
      .update({ data: { grantedAt: now, expireAt: now + TTL, quota: nextQuota } });
    return { success: true, quota: nextQuota };
  }
  await db.collection(SUB_COL).add({
    // 【关键坑】云函数端（wx-server-sdk）的 add 不会自动写 _openid（只有小程序端直连才会自动写），
    // 必须手动带上；否则后续 send()/todos.remind 里 where({ _openid }) 永远查不到 → 推送恒失败。
    data: { _openid: OPENID, tmplId, grantedAt: now, expireAt: now + TTL, quota: 1 }
  });
  // 回传剩余配额，前端可据此提示「还可推送 N 条」
  return { success: true, quota: 1 };
}

async function send(payload) {
  const OPENID = getOpenid();
  const { tmplId, title, desc, at, due, page, mpState } = payload || {};
  if (!tmplId) return { success: false, code: 'EMPTY_TMPL' };
  const sub = await db
    .collection(SUB_COL)
    .where({ _openid: OPENID, tmplId })
    .limit(1)
    .get();
  const rec = sub.data && sub.data[0];
  const quota = rec ? rec.quota || 0 : 0;
  // 返回体一律带上 quota（剩余可推送条数），前端/测试据此判断是否需要重新引导授权
  if (!rec || quota <= 0) return { success: false, code: 'NO_QUOTA', quota: 0 };
  const expireAt = rec.expireAt || (rec.grantedAt || 0) + TTL;
  if (Date.now() > expireAt) {
    await db.collection(SUB_COL).doc(rec._id).update({ data: { quota: 0 } }).catch(() => {});
    return { success: false, code: 'EXPIRED', quota: 0 };
  }
  // miniprogramState：优先前端传入（需过白名单）→ 环境变量 → 默认 trial（联调期）
  // 正式发布后把云函数环境变量 MP_STATE 设为 'formal' 即可，前端无需改动
  const state = normalizeState(mpState) || normalizeState(process.env.MP_STATE) || 'trial';
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: OPENID,
      templateId: tmplId,
      miniprogramState: state,
      page: page || 'pages/index/index',
      data: buildData(title, desc, at, due)
    });
    // 推送成功：quota -1
    await db.collection(SUB_COL).doc(rec._id).update({ data: { quota: quota - 1 } });
    return { success: true, quota: quota - 1 };
  } catch (e) {
    const code = String((e && (e.errCode || e.errMsg)) || 'ERR');
    // 【只清「授权真的失效」的码】
    //   43101 = 用户拒绝/已取消订阅关系   40003 = openid 无效   40037 = 模板 id 不正确
    // 【绝不清 47003（模板参数不准确）】那是我们自己的字段格式/长度问题，
    //   用户的授权依然有效；清掉只会让用户被迫重新点授权，且修好代码后仍发不出去。
    //   而且 47003 的 errMsg 是 "argument invalid! data.xxx.value invalid"，
    //   旧的正则里含 /argument invalid/ 会把 47003 一并命中 —— 属于误伤，已移除。
    if (/43101|40003|40037|api unauthorized/.test(code)) {
      await db.collection(SUB_COL).doc(rec._id).update({ data: { quota: 0 } }).catch(() => {});
      return { success: false, code, quota: 0 };
    }
    // 保留配额，并把实际 payload 打进日志，便于对照模板详情排查 47003
    console.error('[pushReminder] send failed (quota kept). code=', code, 'payload=', JSON.stringify(buildData(title, desc, at, due)));
    return { success: false, code, quota };
  }
}

exports.main = async (event) => {
  const { action } = event || {};
  try {
    if (action === 'grant') return await grant(event.tmplId);
    if (action === 'send' || !action) return await send(event);
    return { success: false, error: `未知 action: ${action}` };
  } catch (err) {
    return { success: false, code: 'ERR', error: err.message || String(err) };
  }
};
