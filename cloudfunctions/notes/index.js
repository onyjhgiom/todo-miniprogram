// 云函数 notes：便签云端同步
// action:
//   - list    拉取当前用户全部便签（按置顶 + 更新时间排序）
//   - upsert  写入/更新一条便签（idempotent by _id）
//   - remove  删除一条便签
//   - clear   清空当前用户全部便签
// 数据隔离：_openid 强制
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'notes';

function getOpenid() {
  const ctx = cloud.getWXContext();
  if (!ctx.OPENID) throw new Error('未拿到 OPENID');
  return ctx.OPENID;
}

const PATTERNS = ['solid', 'dots', 'stripes', 'grid', 'waves', 'fade'];
const FIGURES = [
  'none', 'cat', 'dog', 'bear', 'rabbit', 'panda',
  'hamster', 'fox', 'chick', 'pig', 'koala'
];

function normalizeNote(p) {
  if (!p || typeof p !== 'object') return null;
  const content = typeof p.content === 'string' ? p.content.trim().slice(0, 500) : '';
  if (!content) return null;
  return {
    content,
    colorKey: typeof p.colorKey === 'string' ? p.colorKey.slice(0, 32) : 'lemon',
    patternKey: PATTERNS.indexOf(p.patternKey) >= 0 ? p.patternKey : 'solid',
    figureKey: FIGURES.indexOf(p.figureKey) >= 0 ? p.figureKey : 'none',
    pinned: !!p.pinned,
    createTime: Number.isFinite(p.createTime) ? Math.floor(p.createTime) : Date.now(),
    updateTime: Number.isFinite(p.updateTime) ? Math.floor(p.updateTime) : Date.now()
  };
}

async function list() {
  const OPENID = getOpenid();
  const res = await db
    .collection(COL)
    .where({ _openid: OPENID })
    .limit(1000)
    .get();
  const items = (res.data || []).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updateTime || 0) - (a.updateTime || 0);
  });
  return { success: true, items, total: items.length };
}

async function upsert(payload) {
  const OPENID = getOpenid();
  if (!payload || !payload.note || !payload.note._id) throw new Error('note._id 必填');
  const norm = normalizeNote(payload.note);
  if (!norm) throw new Error('便签内容不合法');
  const data = Object.assign({ _openid: OPENID }, norm);
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
  try {
    await db.collection(COL).doc(payload.note._id).set({ data });
    return { success: true, id: payload.note._id, updated: 1 };
  } catch (e) {
    if (e && /document not exist|not exist/i.test(e.errMsg || e.message || '')) {
      await db.collection(COL).add({ data: Object.assign({ _id: payload.note._id }, data) });
      return { success: true, id: payload.note._id, created: 1 };
    }
    throw e;
  }
}

async function remove(payload) {
  const OPENID = getOpenid();
  if (!payload || !payload._id) throw new Error('_id 必填');
  const res = await db.collection(COL).where({ _openid: OPENID, _id: payload._id }).remove();
  return { success: true, removed: res.stats.removed };
}

async function clear() {
  const OPENID = getOpenid();
  const res = await db.collection(COL).where({ _openid: OPENID }).remove();
  return { success: true, removed: res.stats.removed };
}

exports.main = async (event) => {
  const { action } = event || {};
  try {
    switch (action) {
      case 'list':   return await list();
      case 'upsert': return await upsert(event);
      case 'remove': return await remove(event);
      case 'clear':  return await clear();
      default:       return { success: false, error: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[notes] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};
