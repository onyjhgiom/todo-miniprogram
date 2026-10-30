// 云函数 export
// 导出当前用户全部 todos + subtasks 为 JSON / CSV 文本（直接返回，由前端写入文件）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const TODO_COL = 'todos';
const SUB_COL = 'subtasks';

function getOpenid() {
  const wxContext = cloud.getWXContext();
  if (!wxContext.OPENID) throw new Error('未拿到 OPENID');
  return wxContext.OPENID;
}
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function loadAll(OPENID) {
  const [todosRes, subsRes] = await Promise.all([
    db.collection(TODO_COL).where({ _openid: OPENID }).limit(1000).get(),
    db.collection(SUB_COL).where({ _openid: OPENID }).limit(5000).get()
  ]);
  return {
    todos: todosRes.data || [],
    subtasks: subsRes.data || []
  };
}

async function exportJson() {
  const OPENID = getOpenid();
  const { todos, subtasks } = await loadAll(OPENID);
  const payload = {
    exportedAt: Date.now(),
    openid: OPENID.slice(0, 6) + '***', // 脱敏
    todos,
    subtasks
  };
  return {
    success: true,
    format: 'json',
    filename: `todos-export-${new Date().toISOString().slice(0, 10)}.json`,
    content: JSON.stringify(payload, null, 2),
    total: todos.length,
    subtasks: subtasks.length
  };
}

async function exportCsv() {
  const OPENID = getOpenid();
  const { todos, subtasks } = await loadAll(OPENID);
  const subByTodo = Object.create(null);
  for (const s of subtasks) {
    if (!subByTodo[s.todoId]) subByTodo[s.todoId] = [];
    subByTodo[s.todoId].push(s);
  }
  const header = [
    'id', 'content', 'completed', 'priority', 'location', 'people',
    'tags', 'dueDate', 'createTime', 'updateTime', 'description',
    'subtaskCount', 'subtaskDone', 'archived', 'recurrence'
  ];
  const lines = [header.join(',')];
  for (const t of todos) {
    lines.push([
      csvEscape(t._id),
      csvEscape(t.content),
      csvEscape(t.completed ? 1 : 0),
      csvEscape(t.priority || ''),
      csvEscape(t.location || ''),
      csvEscape((t.people || []).join(';')),
      csvEscape((t.tags || []).join(';')),
      csvEscape(t.dueDate || ''),
      csvEscape(new Date(t.createTime).toISOString()),
      csvEscape(new Date(t.updateTime).toISOString()),
      csvEscape(t.description || ''),
      csvEscape(t.subtaskCount || 0),
      csvEscape(t.subtaskDoneCount || 0),
      csvEscape(t.archived ? 1 : 0),
      csvEscape(t.recurrence ? t.recurrence.type : '')
    ].join(','));
  }
  return {
    success: true,
    format: 'csv',
    filename: `todos-export-${new Date().toISOString().slice(0, 10)}.csv`,
    content: lines.join('\n'),
    total: todos.length
  };
}

exports.main = async (event) => {
  const { action } = event || {};
  try {
    if (action === 'json') return await exportJson();
    if (action === 'csv') return await exportCsv();
    return { success: false, error: `未知 action: ${action}` };
  } catch (err) {
    console.error('[export] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};