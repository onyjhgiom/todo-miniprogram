// 云函数 ledger：记账本云端同步
// action:
//   - list       拉取当前用户全部流水
//   - upsert     写入/更新一条
//   - upsertMany 批量写入（导入/备份还原）
//   - remove     删除一条
//   - clear      清空当前用户全部流水
// 数据隔离：_openid 强制；金额一律以「分」为整数
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'ledger_tx';

const TYPES = ['expense', 'income', 'transfer'];
const SPLIT_MODES = ['none', 'average', 'ratio', 'amount', 'treat'];

function getOpenid() {
  const ctx = cloud.getWXContext();
  if (!ctx.OPENID) throw new Error('未拿到 OPENID');
  return ctx.OPENID;
}

function num(v, def) {
  const n = Number(v);
  return isFinite(n) ? n : def;
}

function normalizeTx(p) {
  if (!p || typeof p !== 'object') return null;
  const amount = Math.max(0, Math.round(num(p.amount, 0)));
  if (amount <= 0 || amount > 1e11) return null; // 单笔上限 10 亿元
  return {
    accountId: String(p.accountId || '').slice(0, 64),
    type: TYPES.indexOf(p.type) >= 0 ? p.type : 'expense',
    amount,
    categoryId: String(p.categoryId || '').slice(0, 64),
    note: typeof p.note === 'string' ? p.note.slice(0, 200) : '',
    occurredAt: num(p.occurredAt, Date.now()),
    payerId: String(p.payerId || '').slice(0, 64),
    payerName: typeof p.payerName === 'string' ? p.payerName.slice(0, 32) : '',
    splitMode: SPLIT_MODES.indexOf(p.splitMode) >= 0 ? p.splitMode : 'none',
    splitDetail: (Array.isArray(p.splitDetail) ? p.splitDetail : []).slice(0, 50).map((s) => ({
      userId: String((s && s.userId) || '').slice(0, 64),
      name: String((s && s.name) || '').slice(0, 32),
      amount: Math.max(0, Math.round(num(s && s.amount, 0)))
    })),
    tags: (Array.isArray(p.tags) ? p.tags : []).filter((s) => typeof s === 'string').slice(0, 20),
    isReimbursable: !!p.isReimbursable,
    images: (Array.isArray(p.images) ? p.images : []).filter((s) => typeof s === 'string').slice(0, 9),
    wishId: String(p.wishId || '').slice(0, 64),
    subscriptionId: String(p.subscriptionId || '').slice(0, 64),
    createTime: num(p.createTime, Date.now()),
    updateTime: num(p.updateTime, Date.now()),
    version: num(p.version, 1)
  };
}

async function list() {
  const OPENID = getOpenid();
  const res = await db.collection(COL).where({ _openid: OPENID }).limit(1000).get();
  const items = (res.data || []).sort((a, b) => (b.occurredAt || 0) - (a.occurredAt || 0));
  return { success: true, items, total: items.length };
}

async function writeOne(OPENID, raw) {
  if (!raw || !raw._id) throw new Error('tx._id 必填');
  const norm = normalizeTx(raw);
  if (!norm) throw new Error('流水金额不合法');
  const data = Object.assign({ _openid: OPENID }, norm);
  try {
    await db.collection(COL).doc(raw._id).set({ data });
    return { id: raw._id, updated: 1 };
  } catch (e) {
    if (e && /not exist/i.test(e.errMsg || e.message || '')) {
      await db.collection(COL).add({ data: Object.assign({ _id: raw._id }, data) });
      return { id: raw._id, created: 1 };
    }
    throw e;
  }
}

async function upsert(event) {
  const OPENID = getOpenid();
  const r = await writeOne(OPENID, event.tx);
  return { success: true, id: r.id };
}

async function upsertMany(event) {
  const OPENID = getOpenid();
  const list = Array.isArray(event.txs) ? event.txs : [];
  if (!list.length) return { success: true, updated: 0 };
  if (list.length > 500) throw new Error('单次批量不得超过 500 条');
  let ok = 0;
  for (const t of list) {
    try {
      await writeOne(OPENID, t);
      ok++;
    } catch (e) {
      // 单条失败不影响整体
    }
  }
  return { success: true, updated: ok };
}

async function remove(event) {
  const OPENID = getOpenid();
  if (!event || !event._id) throw new Error('_id 必填');
  const res = await db.collection(COL).where({ _openid: OPENID, _id: event._id }).remove();
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
      case 'list': return await list();
      case 'upsert': return await upsert(event);
      case 'upsertMany': return await upsertMany(event);
      case 'remove': return await remove(event);
      case 'clear': return await clear();
      default: return { success: false, error: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[ledger] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};
