// 云函数 subtasks
// 子任务管理，独立集合，按 todoId 关联；OPENID 隔离
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const SUB_COL = 'subtasks';
const TODO_COL = 'todos';

function getOpenid() {
  const wxContext = cloud.getWXContext();
  if (!wxContext.OPENID) throw new Error('未拿到 OPENID');
  return wxContext.OPENID;
}
function assertStr(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} 不能为空`);
  if (v.length > 100) throw new Error(`${name} 长度不能超过 100`);
}
function normalizeText(v, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

// 重新统计 todo 的 subtaskCount / subtaskDoneCount
async function recountTodo(OPENID, todoId) {
  try {
    const [totalRes, doneRes] = await Promise.all([
      db.collection(SUB_COL).where({ _openid: OPENID, todoId }).count(),
      db.collection(SUB_COL).where({ _openid: OPENID, todoId, completed: true }).count()
    ]);
    await db.collection(TODO_COL).where({ _id: todoId, _openid: OPENID }).update({
      data: {
        subtaskCount: totalRes.total || 0,
        subtaskDoneCount: doneRes.total || 0,
        updateTime: Date.now()
      }
    });
  } catch (e) {
    console.error('[subtasks.recount] failed:', e);
  }
}

async function listByTodo({ todoId }) {
  const OPENID = getOpenid();
  if (!todoId) throw new Error('todoId 必填');
  const res = await db.collection(SUB_COL)
    .where({ _openid: OPENID, todoId })
    .orderBy('order', 'asc')
    .orderBy('createTime', 'asc')
    .limit(200)
    .get();
  return { success: true, items: res.data || [] };
}
async function countByTodo({ todoId }) {
  const OPENID = getOpenid();
  if (!todoId) throw new Error('todoId 必填');
  const [totalRes, doneRes] = await Promise.all([
    db.collection(SUB_COL).where({ _openid: OPENID, todoId }).count(),
    db.collection(SUB_COL).where({ _openid: OPENID, todoId, completed: true }).count()
  ]);
  return { success: true, total: totalRes.total || 0, done: doneRes.total || 0 };
}
async function add({ todoId, content }) {
  const OPENID = getOpenid();
  if (!todoId) throw new Error('todoId 必填');
  assertStr(content, 'content');
  // 校验 todo 属于当前用户
  const t = await db.collection(TODO_COL).where({ _id: todoId, _openid: OPENID }).count();
  if (t.total === 0) throw new Error('任务不存在或无权限');
  const now = Date.now();
  const doc = {
    _openid: OPENID,
    todoId,
    content: content.trim(),
    completed: false,
    order: now,
    createTime: now,
    updateTime: now
  };
  const res = await db.collection(SUB_COL).add({ data: doc });
  await recountTodo(OPENID, todoId);
  return { success: true, id: res._id };
}
async function update({ id, content }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  if (content !== undefined) assertStr(content, 'content');
  const data = { updateTime: Date.now() };
  if (content !== undefined) data.content = content.trim();
  const res = await db.collection(SUB_COL).where({ _id: id, _openid: OPENID }).update({ data });
  if (res.stats.updated === 0) throw new Error('子任务不存在或无权限');
  return { success: true, updated: res.stats.updated };
}
async function toggle({ id, completed }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  if (typeof completed !== 'boolean') throw new Error('completed 必须为布尔');
  const now = Date.now();
  // 先取 todoId
  const orig = await db.collection(SUB_COL).where({ _id: id, _openid: OPENID }).get();
  const item = (orig.data || [])[0];
  if (!item) throw new Error('子任务不存在或无权限');
  const res = await db.collection(SUB_COL).where({ _id: id, _openid: OPENID }).update({
    data: { completed, updateTime: now }
  });
  if (res.stats.updated === 0) throw new Error('子任务不存在或无权限');
  await recountTodo(OPENID, item.todoId);
  return { success: true, updated: res.stats.updated };
}
async function remove({ id }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  const orig = await db.collection(SUB_COL).where({ _id: id, _openid: OPENID }).get();
  const item = (orig.data || [])[0];
  if (!item) throw new Error('子任务不存在或无权限');
  const res = await db.collection(SUB_COL).where({ _id: id, _openid: OPENID }).remove();
  if (res.stats.removed === 0) throw new Error('子任务不存在或无权限');
  await recountTodo(OPENID, item.todoId);
  return { success: true, removed: res.stats.removed };
}
async function clearDone({ todoId }) {
  const OPENID = getOpenid();
  if (!todoId) throw new Error('todoId 必填');
  const res = await db.collection(SUB_COL).where({
    _openid: OPENID, todoId, completed: true
  }).remove();
  await recountTodo(OPENID, todoId);
  return { success: true, removed: res.stats.removed };
}

exports.main = async (event) => {
  const { action } = event || {};
  try {
    switch (action) {
      case 'listByTodo':  return await listByTodo(event);
      case 'countByTodo': return await countByTodo(event);
      case 'add':         return await add(event);
      case 'update':      return await update(event);
      case 'toggle':      return await toggle(event);
      case 'delete':      return await remove(event);
      case 'clearDone':   return await clearDone(event);
      default:            return { success: false, error: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[subtasks] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};