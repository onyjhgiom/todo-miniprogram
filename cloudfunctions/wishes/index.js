// 云函数 wishes：愿望清单云端同步
// action:
//   - list       拉取当前用户全部心愿
//   - upsert     写入/更新一条
//   - upsertMany 批量写入（周期重置等场景）
//   - remove     删除一条
//   - clear      清空当前用户全部心愿
// 数据隔离：_openid 强制
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = 'wishes';

const PROGRESS_MODES = ['checklist', 'counter', 'bar', 'percent'];
const MAX_IMAGES = 9;

function getOpenid() {
  const ctx = cloud.getWXContext();
  if (!ctx.OPENID) throw new Error('未拿到 OPENID');
  return ctx.OPENID;
}

function num(v, def) {
  const n = Number(v);
  return isFinite(n) ? n : def;
}

function normalizeSub(n) {
  if (!n || typeof n !== 'object') return null;
  const title = typeof n.title === 'string' ? n.title.trim().slice(0, 60) : '';
  if (!title) return null;
  return {
    id: typeof n.id === 'string' ? n.id.slice(0, 64) : `st_${Date.now()}`,
    title,
    done: !!n.done,
    weight: Math.max(0, Math.min(100, num(n.weight, 1))),
    doneAt: num(n.doneAt, 0) || 0,
    children: (Array.isArray(n.children) ? n.children : []).map(normalizeSub).filter(Boolean).slice(0, 50)
  };
}

function normalizeWish(p) {
  if (!p || typeof p !== 'object') return null;
  const title = typeof p.title === 'string' ? p.title.trim().slice(0, 60) : '';
  if (!title) return null;
  return {
    title,
    note: typeof p.note === 'string' ? p.note.slice(0, 2000) : '',
    categoryId: String(p.categoryId || '').slice(0, 64),
    statusId: String(p.statusId || '').slice(0, 64),
    star: Math.max(1, Math.min(5, num(p.star, 3))),
    price: Math.max(0, num(p.price, 0)),
    images: (Array.isArray(p.images) ? p.images : []).filter((s) => typeof s === 'string').slice(0, MAX_IMAGES),
    link: typeof p.link === 'string' ? p.link.slice(0, 500) : '',
    progressMode: PROGRESS_MODES.indexOf(p.progressMode) >= 0 ? p.progressMode : 'checklist',
    target: Math.max(0, num(p.target, 100)),
    current: Math.max(0, num(p.current, 0)),
    autoDone: !!p.autoDone,
    subTasks: (Array.isArray(p.subTasks) ? p.subTasks : []).map(normalizeSub).filter(Boolean).slice(0, 100),
    fields: p.fields && typeof p.fields === 'object' ? p.fields : {},
    tags: (Array.isArray(p.tags) ? p.tags : []).filter((s) => typeof s === 'string').slice(0, 20),
    targetDate: num(p.targetDate, 0),
    achievedAt: num(p.achievedAt, 0),
    isArchived: !!p.isArchived,
    archivedAt: num(p.archivedAt, 0),
    review: typeof p.review === 'string' ? p.review.slice(0, 1000) : '',
    cycle: p.cycle && typeof p.cycle === 'object' ? p.cycle : null,
    budgetLink: p.budgetLink && typeof p.budgetLink === 'object' ? p.budgetLink : null,
    isPrivate: !!p.isPrivate,
    isPinned: !!p.isPinned,
    templateId: String(p.templateId || '').slice(0, 64),
    createTime: num(p.createTime, Date.now()),
    updateTime: num(p.updateTime, Date.now()),
    version: num(p.version, 1)
  };
}

async function list() {
  const OPENID = getOpenid();
  const res = await db.collection(COL).where({ _openid: OPENID }).limit(1000).get();
  const items = (res.data || []).sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0));
  return { success: true, items, total: items.length };
}

async function writeOne(OPENID, raw) {
  if (!raw || !raw._id) throw new Error('wish._id 必填');
  const norm = normalizeWish(raw);
  if (!norm) throw new Error('心愿数据不合法');
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
  const r = await writeOne(OPENID, event.wish);
  return { success: true, id: r.id };
}

async function upsertMany(event) {
  const OPENID = getOpenid();
  const list = Array.isArray(event.wishes) ? event.wishes : [];
  if (!list.length) return { success: true, updated: 0 };
  if (list.length > 200) throw new Error('单次批量不得超过 200 条');
  let ok = 0;
  for (const w of list) {
    try {
      await writeOne(OPENID, w);
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
    console.error('[wishes] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};
