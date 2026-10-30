// 云函数 todos（Phase 1 完整版）
// 包含全部 ITodo 字段支持、子任务清理、归档、分页、拖拽排序、移动
// 数据隔离由 OPENID 强制执行
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COL = 'todos';
const SUB_COL = 'subtasks';
/**
 * 订阅消息投递的小程序版本：定时器触发时拿不到前端参数，只能靠云函数环境变量。
 * 云开发控制台 → 本云函数 → 配置 → 环境变量 MP_STATE = developer / trial / formal。
 * 未设置时保守用 formal（已发布线上）；未发布前请在控制台设为 trial，否则收不到消息。
 */
const MP_STATE = process.env.MP_STATE || 'trial';

/* ============ 工具 ============ */
function getOpenid() {
  const wxContext = cloud.getWXContext();
  if (!wxContext.OPENID) throw new Error('未拿到 OPENID');
  return wxContext.OPENID;
}
function assertStr(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} 不能为空`);
  if (v.length > 200) throw new Error(`${name} 长度不能超过 200`);
}
function normalizePriority(p) {
  return p === 'high' || p === 'medium' || p === 'low' ? p : null;
}
function normalizeText(v, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}
function normalizeStringList(arr, maxCount, maxItemLen) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = Object.create(null);
  for (const it of arr) {
    if (typeof it !== 'string') continue;
    const s = it.trim();
    if (!s) continue;
    const v = s.length > maxItemLen ? s.slice(0, maxItemLen) : s;
    if (seen[v]) continue;
    seen[v] = true;
    out.push(v);
    if (out.length >= maxCount) break;
  }
  return out;
}
function normalizeRecurrence(r) {
  if (!r || typeof r !== 'object') return null;
  const allowed = ['none', 'daily', 'weekly', 'monthly', 'custom'];
  if (!allowed.includes(r.type)) return null;
  const out = { type: r.type };
  if (r.type === 'custom' && Number.isFinite(r.interval)) {
    out.interval = Math.max(1, Math.min(60, Math.floor(r.interval)));
  }
  if (r.type === 'weekly' && Array.isArray(r.weekdays)) {
    out.weekdays = r.weekdays
      .filter((w) => Number.isInteger(w) && w >= 1 && w <= 7)
      .slice(0, 7);
  }
  if (r.endDate) {
    out.endDate = typeof r.endDate === 'number' ? r.endDate : null;
  }
  return out;
}
function normalizeReminders(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const now = Date.now();
  for (const r of arr) {
    if (!r || typeof r.at !== 'number') continue;
    if (r.at < now - 60000) continue; // 过期 1 分钟以上的丢弃
    out.push({
      id: typeof r.id === 'string' ? r.id : `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: r.at,
      sent: !!r.sent,
      channel: r.channel === 'sys' ? 'sys' : 'app'
    });
    if (out.length >= 6) break;
  }
  return out.sort((a, b) => a.at - b.at);
}
function normalizeAttachments(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const a of arr) {
    if (!a || typeof a.url !== 'string') continue;
    const type = a.type === 'link' ? 'link' : 'image';
    out.push({
      id: typeof a.id === 'string' ? a.id : `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      url: a.url.slice(0, 1000),
      title: type === 'link' ? normalizeText(a.title, 60) : undefined,
      tempPath: type === 'image' && a.tempPath ? a.tempPath.slice(0, 500) : undefined
    });
    if (out.length >= 9) break;
  }
  return out;
}
function normalizeQuadrant(q) {
  return q === 1 || q === 2 || q === 3 || q === 4 ? q : null;
}

/* ============ Action ============ */
// 分页说明：全部使用 createTime 倒序 + 游标（cursor = 上一批最后一条的 createTime）。
// 相比 skip(page*size)，游标分页在深翻页时不会随页码增长而变慢，是支撑上万条清单的关键。
// 建议在云开发控制台为 todos 集合建立组合索引：_openid + createTime(降序)，以及 _openid + archived + createTime(降序)。

/** 全量/游标读取（兼容旧调用：不传 cursor 时返回最新一批） */
async function list({ archived, cursor, pageSize } = {}) {
  const OPENID = getOpenid();
  const where = { _openid: OPENID };
  if (archived === true) where.archived = true;
  else if (archived === false) where.archived = _.neq(true);
  if (typeof cursor === 'number') where.createTime = _.lt(cursor);

  const size = Math.min(Math.max(1, pageSize || 500), 1000);
  const res = await db
    .collection(COL)
    .where(where)
    .orderBy('createTime', 'desc')
    .limit(size)
    .get();

  const items = res.data || [];
  const nextCursor = items.length ? items[items.length - 1].createTime : 0;
  return {
    success: true,
    items,
    cursor: nextCursor,
    hasMore: items.length === size
  };
}

async function listPaged({ page = 1, pageSize = 20, archived = false, cursor, skip } = {}) {
  const OPENID = getOpenid();
  const where = { _openid: OPENID };
  if (archived) where.archived = true;
  else where.archived = _.neq(true);

  const size = Math.min(Math.max(1, pageSize), 1000);
  // 传了 cursor 走游标分页（深翻页稳定）；否则用显式 skip（首屏与后续条数不同也不会错位）
  const useCursor = typeof cursor === 'number';
  if (useCursor) where.createTime = _.lt(cursor);

  const offset = useCursor
    ? 0
    : typeof skip === 'number'
      ? Math.max(0, Math.floor(skip))
      : Math.max(0, (page - 1) * size);

  const baseQuery = db.collection(COL).where(where).orderBy('createTime', 'desc');

  const [listRes, countRes] = await Promise.all([
    (offset > 0 ? baseQuery.skip(offset) : baseQuery).limit(size).get(),
    db.collection(COL).where({
      _openid: OPENID,
      archived: archived ? true : _.neq(true)
    }).count()
  ]);

  const items = listRes.data || [];
  const nextCursor = items.length ? items[items.length - 1].createTime : 0;
  return {
    success: true,
    items,
    total: countRes.total || 0,
    page,
    pageSize: size,
    skip: offset + items.length,
    cursor: nextCursor,
    hasMore: items.length === size
  };
}

/** 按 id 取单条：详情页 O(1) 取数（旧实现是全量 list 后内存 find，数据量越大越慢） */
async function getOne({ id } = {}) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  const res = await db.collection(COL).doc(id).get().catch(() => null);
  const doc = res && res.data;
  if (!doc || doc._openid !== OPENID) return { success: false, error: '任务不存在' };
  return { success: true, item: doc };
}

/** 只取总数，用于超大清单的进度展示 */
async function count() {
  const OPENID = getOpenid();
  const res = await db
    .collection(COL)
    .where({ _openid: OPENID, archived: _.neq(true) })
    .count();
  return { success: true, total: res.total || 0 };
}

/** 增量拉取：返回 createTime > since 的变更（用于多端/后台回到前台时的轻量补拉） */
async function listSince({ since = 0, pageSize = 500 } = {}) {
  const OPENID = getOpenid();
  const size = Math.min(Math.max(1, pageSize), 1000);
  const res = await db
    .collection(COL)
    .where({ _openid: OPENID, updateTime: _.gt(since) })
    .orderBy('updateTime', 'asc')
    .limit(size)
    .get();
  const items = res.data || [];
  const nextSince = items.length ? items[items.length - 1].updateTime : since;
  return { success: true, items, since: nextSince, hasMore: items.length === size };
}
async function add(payload) {
  const OPENID = getOpenid();
  const { content, dueDate, priority, location, people, tags, description, recurrence, reminders, attachments, quadrant } = payload;
  assertStr(content, 'content');
  const now = Date.now();
  const doc = {
    _openid: OPENID,
    content: content.trim(),
    completed: false,
    createTime: now,
    updateTime: now,
    dueDate: typeof dueDate === 'number' ? dueDate : null,
    reminded: false,
    priority: normalizePriority(priority),
    location: normalizeText(location, 60),
    people: normalizeStringList(people, 8, 20),
    tags: normalizeStringList(tags, 8, 12),
    description: normalizeText(description, 500),
    recurrence: normalizeRecurrence(recurrence),
    reminders: normalizeReminders(reminders),
    attachments: normalizeAttachments(attachments),
    quadrant: normalizeQuadrant(quadrant),
    archived: false,
    archivedAt: null,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    order: now
  };
  const res = await db.collection(COL).add({ data: doc });
  return { success: true, id: res._id };
}
async function update(payload) {
  const OPENID = getOpenid();
  const { id, content, dueDate, priority, location, people, tags, description, recurrence, reminders, attachments, quadrant, order } = payload;
  if (!id) throw new Error('id 必填');
  if (content !== undefined) assertStr(content, 'content');
  const data = { updateTime: Date.now() };
  if (content !== undefined) data.content = content.trim();
  if (dueDate !== undefined) {
    data.dueDate = typeof dueDate === 'number' ? dueDate : null;
    data.reminded = false;
  }
  if (priority !== undefined) data.priority = normalizePriority(priority);
  if (location !== undefined) data.location = normalizeText(location, 60);
  if (people !== undefined) data.people = normalizeStringList(people, 8, 20);
  if (tags !== undefined) data.tags = normalizeStringList(tags, 8, 12);
  if (description !== undefined) data.description = normalizeText(description, 500);
  if (recurrence !== undefined) data.recurrence = normalizeRecurrence(recurrence);
  if (reminders !== undefined) data.reminders = normalizeReminders(reminders);
  if (attachments !== undefined) data.attachments = normalizeAttachments(attachments);
  if (quadrant !== undefined) data.quadrant = normalizeQuadrant(quadrant);
  if (order !== undefined && Number.isFinite(order)) data.order = Math.floor(order);
  const res = await db.collection(COL).where({ _id: id, _openid: OPENID }).update({ data });
  if (res.stats.updated === 0) throw new Error('任务不存在或无权限');
  return { success: true, updated: res.stats.updated };
}
async function toggle({ id, completed }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  if (typeof completed !== 'boolean') throw new Error('completed 必须为布尔');
  const now = Date.now();
  const data = { completed, updateTime: now };
  if (completed) data.completedTime = now;
  else data.completedTime = null;
  const res = await db.collection(COL).where({ _id: id, _openid: OPENID }).update({ data });
  if (res.stats.updated === 0) throw new Error('任务不存在或无权限');
  return { success: true, updated: res.stats.updated };
}
async function archive({ id, archived }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  const flag = archived !== false; // 默认归档
  const now = Date.now();
  const res = await db.collection(COL).where({ _id: id, _openid: OPENID }).update({
    data: { archived: flag, archivedAt: flag ? now : null, updateTime: now }
  });
  if (res.stats.updated === 0) throw new Error('任务不存在或无权限');
  return { success: true, updated: res.stats.updated };
}
async function move({ id, order }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  if (!Number.isFinite(order)) throw new Error('order 必须为数字');
  const res = await db.collection(COL).where({ _id: id, _openid: OPENID }).update({
    data: { order: Math.floor(order), updateTime: Date.now() }
  });
  if (res.stats.updated === 0) throw new Error('任务不存在或无权限');
  return { success: true, updated: res.stats.updated };
}
async function remove({ id }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  // 同时清理子任务
  await db.collection(SUB_COL).where({ _openid: OPENID, todoId: id }).remove().catch(() => null);
  const res = await db.collection(COL).where({ _id: id, _openid: OPENID }).remove();
  if (res.stats.removed === 0) throw new Error('任务不存在或无权限');
  return { success: true, removed: res.stats.removed };
}
async function clearCompleted() {
  const OPENID = getOpenid();
  // 分批删除：云数据库单次 get 上限 1000、单次 remove 也有条数限制，
  // 数据量大时一次性操作会超时失败，这里每轮 100 条循环清理。
  let removedTotal = 0;
  for (let round = 0; round < 300; round++) {
    const doneRes = await db
      .collection(COL)
      .where({ _openid: OPENID, completed: true })
      .field({ _id: true })
      .limit(100)
      .get();
    const ids = (doneRes.data || []).map((d) => d._id);
    if (!ids.length) break;

    await db
      .collection(SUB_COL)
      .where({ _openid: OPENID, todoId: _.in(ids) })
      .remove()
      .catch(() => null);

    const res = await db
      .collection(COL)
      .where({ _openid: OPENID, _id: _.in(ids) })
      .remove();
    const removed = res.stats.removed || 0;
    removedTotal += removed;
    if (removed === 0) break;
  }
  return { success: true, removed: removedTotal };
}

/* ============ 提醒（供定时器触发） ============ */
// 把待办提醒映射为订阅消息模板字段（KEY_MAP 与 pushReminder 云函数保持一致）。
// 【关键】模板 5 个关键词必须全填，否则 47003；真实 key 来自「我的模板→模板详情」的 {{xxx.DATA}}，
// 微信字段序号不连续也不按类型顺序（thing2/date9/time6/time38/time30），切勿臆测编号。
function clip20(s) {
  s = s == null ? '' : String(s).trim();
  return s.length > 20 ? s.slice(0, 19) + '…' : s;
}
const KEY_MAP = {
  content: 'thing2',    // 提醒内容（thing 类）
  expireTime: 'date9',  // 到期时间（date 类）
  startTime: 'time6',   // 开始时间（time 类）
  endTime: 'time38',    // 截止时间（time 类）
  remindTime: 'time30'  // 提醒时间（time 类）
};
function padT(n) {
  return n < 10 ? '0' + n : '' + n;
}
/**
 * 值格式严格贴合官方参数限制（否则 47003），且必须与 pushReminder 云函数**完全一致**：
 *   date 类 → `YYYY-MM-DD`（官方示例与正则都接受）
 *   time 类 → `HH:mm`  ← 【踩坑】time 类**不能带年月日**；
 *                      官方文档里「支持+年月日」只适用于 date 类，
 *                      给 time 类传年月日会直接 47003（模板参数不准确）。
 */
function fmtDateOnly(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + padT(d.getMonth() + 1) + '-' + padT(d.getDate());
}
/** time 类：纯时刻 HH:mm */
function fmtClock(ts) {
  const d = new Date(ts);
  return padT(d.getHours()) + ':' + padT(d.getMinutes());
}
function buildReminderData(t, r) {
  const title = (t && t.content) || '待办提醒';
  // 备注字段是 todo.description（不是 note —— 之前读 t.note 恒为空，备注永远带不上）
  const desc = ((t && t.description) || '').toString();
  const at = (r && r.at) || Date.now();
  const due = (t && t.dueDate) || at; // 无截止时间 → 用提醒时刻兜底，不出现空值
  const content = desc ? `${clip20(title).slice(0, 12)}（${clip20(desc).slice(0, 6)}）` : clip20(title);
  const K = KEY_MAP;
  const d = {};
  d[K.content] = { value: clip20(content) };      // 提醒内容（thing 类，≤20 字符）
  d[K.expireTime] = { value: fmtDateOnly(due) };  // 到期时间（date 类：YYYY-MM-DD）
  d[K.startTime] = { value: fmtClock(at) };       // 开始时间（time 类：本次提醒时刻）
  d[K.endTime] = { value: fmtClock(due) };        // 截止时间（time 类：截止时刻）
  d[K.remindTime] = { value: fmtClock(at) };      // 提醒时间（time 类，不能带年月日）
  return d;
}

async function remind() {
  // 定时器触发，无 OPENID，扫描全局；按每条 todo 自带 _openid 推送
  const now = Date.now();
  const res = await db.collection(COL).where({
    completed: false,
    archived: _.neq(true),
    'reminders.at': _.lte(now),
    'reminders.sent': _.neq(true)
  }).limit(200).get();

  const tasks = res.data || [];
  let sentCount = 0;
  let pushCount = 0;
  for (const t of tasks) {
    const dueList = (t.reminders || []).filter((r) => !r.sent && r.at <= now);
    if (dueList.length === 0) continue;
    // 尝试微信订阅消息推送：仅该用户已授权、配额未用尽、未过期才发；失败不阻塞本地标记
    try {
      const sub = await db
        .collection('user_subs')
        .where({ _openid: t._openid })
        .limit(1)
        .get();
      const rec = sub.data && sub.data[0];
      // 与 pushReminder 保持同一套配额语义：quota 是「剩余可推送条数」，可累积、逐条递减
      const quota = rec ? rec.quota || 0 : 0;
      const expireAt = rec ? rec.expireAt || (rec.grantedAt || 0) + 7 * 864e5 : 0;
      if (rec && quota > 0) {
        if (Date.now() > expireAt) {
          // 一次性授权有效期约 7 天，过期即作废
          await db.collection('user_subs').doc(rec._id).update({ data: { quota: 0 } }).catch(() => {});
        } else {
          await cloud.openapi.subscribeMessage.send({
            touser: t._openid,
            templateId: rec.tmplId,
            miniprogramState: MP_STATE,
            page: 'pages/index/index',
            data: buildReminderData(t, dueList[0])
          });
          await db
            .collection('user_subs')
            .doc(rec._id)
            .update({ data: { quota: quota - 1 } })
            .catch(() => {});
          pushCount += 1;
        }
      }
    } catch (e) {
      console.error('[todos.remind] push failed:', e && (e.errCode || e.errMsg));
    }
    // 标记为已发送（无论推送是否成功，避免重复处理）
    const updatedReminders = (t.reminders || []).map((r) =>
      dueList.find((d) => d.id === r.id) ? { ...r, sent: true } : r
    );
    try {
      await db.collection(COL).doc(t._id).update({
        data: { reminders: updatedReminders, updateTime: now }
      });
      sentCount += dueList.length;
    } catch (e) {
      console.error('[todos.remind] flag failed:', e);
    }
  }
  return { success: true, scanned: tasks.length, sent: sentCount, push: pushCount };
}

/* ============ 入口 ============ */
exports.main = async (event) => {
  const { action } = event || {};
  try {
    switch (action) {
      case 'list':           return await list(event);
      case 'listPaged':      return await listPaged(event);
      case 'listSince':      return await listSince(event);
      case 'getOne':         return await getOne(event);
      case 'count':          return await count();
      case 'add':            return await add(event);
      case 'update':         return await update(event);
      case 'toggle':         return await toggle(event);
      case 'archive':        return await archive(event);
      case 'move':           return await move(event);
      case 'delete':         return await remove(event);
      case 'clearCompleted': return await clearCompleted();
      case 'remind':         return await remind();
      default:               return { success: false, error: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[todos] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};