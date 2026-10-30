// 云函数 pomoLogs：番茄时钟日志云端同步
// action:
//   - upsert    写入或更新一条日志（idempotent by _id）
//   - listRange [fromTs, toTs] 范围内的全部日志
//   - listSince 增量同步：startAt > sinceTs 的日志
//   - dailyStats 按 dateKey 聚合，dateKey = yyyy-mm-dd
//   - remove     删除一条日志（谨慎使用）
// 数据隔离：_openid 强制
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COL = 'pomoLogs';

function getOpenid() {
  const ctx = cloud.getWXContext();
  if (!ctx.OPENID) throw new Error('未拿到 OPENID');
  return ctx.OPENID;
}
function assertStr(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} 不能为空`);
}
function normalizeMode(m) {
  return m === 'focus' || m === 'short' || m === 'long' ? m : null;
}
function normalizeStatus(s) {
  return s === 'completed' || s === 'abandoned' || s === 'aborted' ? s : 'completed';
}
function normalizeLog(p) {
  if (!p || typeof p !== 'object') return null;
  const mode = normalizeMode(p.mode);
  if (!mode) return null;
  if (!Number.isFinite(p.startAt) || !Number.isFinite(p.endAt)) return null;
  return {
    mode,
    plannedSec: Math.max(0, Math.min(8 * 3600, Math.floor(p.plannedSec || 0))),
    actualSec: Math.max(0, Math.min(8 * 3600, Math.floor(p.actualSec || 0))),
    status: normalizeStatus(p.status),
    startAt: Math.floor(p.startAt),
    endAt: Math.floor(p.endAt),
    todoId: typeof p.todoId === 'string' ? p.todoId.slice(0, 64) : null,
    todoTitle: typeof p.todoTitle === 'string' ? p.todoTitle.slice(0, 80) : null,
    dateKey: typeof p.dateKey === 'string' ? p.dateKey.slice(0, 10) : null
  };
}

async function upsert(payload) {
  const OPENID = getOpenid();
  if (!payload || !payload._id) throw new Error('_id 必填');
  const norm = normalizeLog(payload);
  if (!norm) throw new Error('日志字段不合法');
  const data = Object.assign({ _openid: OPENID, updateTime: Date.now() }, norm);
  // 防御：去掉 undefined 字段
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
  try {
    await db.collection(COL).doc(payload._id).set({ data });
    return { success: true, id: payload._id, updated: 1 };
  } catch (e) {
    // 文档不存在时 set 会失败，回退 add
    if (e && /document not exist|not exist/i.test(e.errMsg || e.message || '')) {
      await db.collection(COL).add({ data: Object.assign({ _id: payload._id }, data) });
      return { success: true, id: payload._id, created: 1 };
    }
    throw e;
  }
}

async function listRange(payload) {
  const OPENID = getOpenid();
  const from = Number(payload && payload.fromTs) || 0;
  const to = Number(payload && payload.toTs) || Date.now();
  const res = await db
    .collection(COL)
    .where({ _openid: OPENID, startAt: _.gte(from).and(_.lte(to)) })
    .orderBy('startAt', 'asc')
    .limit(1000)
    .get();
  return { success: true, items: res.data || [], total: (res.data || []).length };
}

async function listSince(payload) {
  const OPENID = getOpenid();
  const since = Number(payload && payload.sinceTs) || 0;
  const res = await db
    .collection(COL)
    .where({ _openid: OPENID, startAt: _.gt(since) })
    .orderBy('startAt', 'asc')
    .limit(1000)
    .get();
  return { success: true, items: res.data || [], total: (res.data || []).length };
}

async function dailyStats(payload) {
  const OPENID = getOpenid();
  const days = Array.isArray(payload && payload.dateKeys) ? payload.dateKeys.slice(0, 31) : [];
  if (days.length === 0) return { success: true, stats: {} };
  const res = await db
    .collection(COL)
    .where({ _openid: OPENID, dateKey: _.in(days), status: 'completed' })
    .limit(2000)
    .get();
  const stats = {};
  for (const k of days) stats[k] = { count: 0, minutes: 0 };
  for (const it of res.data || []) {
    const k = it.dateKey;
    if (!stats[k]) continue;
    stats[k].count += 1;
    stats[k].minutes += Math.round((it.actualSec || 0) / 60);
  }
  return { success: true, stats };
}

async function remove(payload) {
  const OPENID = getOpenid();
  if (!payload || !payload._id) throw new Error('_id 必填');
  const res = await db.collection(COL).where({ _openid: OPENID, _id: payload._id }).remove();
  return { success: true, removed: res.stats.removed };
}

exports.main = async (event) => {
  const { action } = event || {};
  try {
    switch (action) {
      case 'upsert':     return await upsert(event);
      case 'listRange':  return await listRange(event);
      case 'listSince':  return await listSince(event);
      case 'dailyStats': return await dailyStats(event);
      case 'remove':     return await remove(event);
      default:           return { success: false, error: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[pomoLogs] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};
