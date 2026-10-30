// 云函数 travel：旅行模式云端存储
//
// 集合：trips（行程）、travel_items（行程条目 + 行李，用 kind 区分）、travel_notes（日记）
// 数据隔离：一律按 OPENID 过滤，_openid 由服务端强制写入，不信任前端传入。
//
// 容错原则：云端只是"多设备同步"的加强项，前端本地优先、云端失败静默跳过，
// 因此这里任何异常都返回可读错误，由前端记日志后继续用本地数据。
//
// AI（aiStatus / aiChat / aiPlan）：主档案火山方舟 + 内置兜底 Key，冷备智谱 GLM，
//   **不依赖任何数据库集合**。⚠️ 请勿把 AI 能力与 list 绑定 —— 集合没建时
//   list 会 -502005 失败，若 AI 跟着一起判死，用户就永远开不了「AI 智能规划」。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COL_TRIP = 'trips';
const COL_ITEM = 'travel_items';
const COL_NOTE = 'travel_notes';

function getOpenid() {
  const wxContext = cloud.getWXContext();
  if (!wxContext.OPENID) throw new Error('未拿到 OPENID');
  return wxContext.OPENID;
}

function str(v, max) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bool(v) {
  return v === true || v === 'true';
}

function strList(arr, maxCount, maxLen) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = Object.create(null);
  for (const it of arr) {
    const s = str(it, maxLen);
    if (!s || seen[s]) continue;
    seen[s] = true;
    out.push(s);
    if (out.length >= maxCount) break;
  }
  return out;
}

/** yyyy-mm-dd 校验（不合法就退回空串，前端会忽略） */
function ymd(v) {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function hhmm(v) {
  const s = str(v, 5);
  return /^\d{1,2}:\d{2}$/.test(s) ? s : '';
}

/** 从 AI 返回的（可能带 ```json 围栏 / 多余文字）文本中抽出 JSON 对象 */
/**
 * 从被截断的 JSON 里抢救出完整部分。
 *
 * 为什么需要：上游输出长度**极不稳定**。同一份提示词实测有时 620 字、有时 4800 字，
 * 一旦超过 max_tokens 就被截断（finish_reason=length），末尾 JSON 不完整，
 * 直接 JSON.parse 必然失败 —— 表现为「AI 未返回有效行程」，用户看到的就是「AI 用不了」。
 *
 * 做法：从后往前找 `}` 作为候选截断点，把该点之前的片段补齐闭合括号再 parse，
 * 第一个成功的即返回 —— 能救回截断前已经写好的那几天行程，而不是整块丢弃。
 */
function salvageJSON(raw) {
  const src = String(raw || '');
  const start = src.indexOf('{');
  if (start < 0) return {};
  const s = src.slice(start);
  const cuts = [];
  for (let i = s.length - 1; i >= 0 && cuts.length < 60; i -= 1) {
    if (s[i] === '}') cuts.push(i + 1);
  }
  cuts.push(s.length);
  for (let k = 0; k < cuts.length; k += 1) {
    const cut = cuts[k];
    let head = s.slice(0, cut).replace(/,\s*$/, '');
    const st = [];
    let inStr = false;
    let esc = false;
    for (let i = 0; i < head.length; i += 1) {
      const c = head[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === '{' || c === '[') {
        st.push(c === '{' ? '}' : ']');
      } else if (c === '}' || c === ']') {
        if (st.length && st[st.length - 1] === c) st.pop();
      }
    }
    if (inStr) continue; // 截断点落在字符串中间，跳过
    head += st.reverse().join('');
    try {
      const j = JSON.parse(head);
      if (j && typeof j === 'object') return j;
    } catch (e) {
      /* 这个候选点救不回来，继续往前退 */
    }
  }
  return {};
}

function parseAIMarkdownJSON(raw) {
  if (!raw) return {};
  let s = String(raw).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    // 严格解析失败 → 多半是被 max_tokens 截断，尝试抢救
    return salvageJSON(raw);
  }
}

/* ============================ 写入 ============================ */

/** 去掉 undefined 字段（云数据库不接受 undefined 值） */
function pruneUndefined(obj) {
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

/**
 * 幂等写入：**必须**把前端生成的 `_id` 原样带进云端。
 *
 * 踩过的坑（「清单删不掉 / 删了又回来 / 越同步越多」的根因）：
 *   旧实现用 normalizeXxx 重新拼一个文档，`_id` 被丢掉，云端自行生成新 id
 *   （前端是 `pack_xxx`，云端是随机 24 位）。于是：
 *     ① 前端的 removePacking / removeTripItem 按 `_id` 匹配 → 云端一条也删不掉，
 *        本地删了、云端还在；
 *     ② list 下来时同一个物品带着两个不同 `_id`，前端 mergeDown 按 `_id` 合并
 *        → 同一件物品变两份；被删掉的以「云端副本」身份复活。
 * 同 id 已存在（重试 / 多端并发）时改为更新，保证幂等。
 */
async function putDoc(col, doc) {
  const data = pruneUndefined(doc);
  try {
    await db.collection(col).add({ data });
    return data._id || '';
  } catch (e) {
    if (!data._id) throw e;
    await db.collection(col).doc(data._id).update({ data });
    return data._id;
  }
}

/**
 * 从「归一化后的完整文档」里挑出 patch 真正声明过的字段，供 update 使用。
 * 必须剔掉不可变字段：云数据库不允许 update 主键（`_id`），
 * 归一化函数现在会带上 `_id`/`kind`/_openid，一旦漏进去整条 update 都会失败。
 */
const IMMUTABLE = { _id: true, _openid: true, kind: true, createTime: true };
function patchOf(rawPatch, normalized) {
  const clean = {};
  Object.keys(rawPatch || {}).forEach((k) => {
    if (IMMUTABLE[k]) return;
    if (normalized[k] !== undefined) clean[k] = normalized[k];
  });
  return clean;
}

/* ============================ 归一化 ============================ */

function normalizeTrip(t, openid) {
  const now = Date.now();
  return {
    // 前端生成的 id 原样保留，前端删除时才匹配得上（见 putDoc 注释）
    _id: str(t && t._id, 60) || undefined,
    title: str(t && t.title, 40) || '未命名行程',
    destination: str(t && t.destination, 30),
    startDate: ymd(t && t.startDate),
    endDate: ymd(t && t.endDate),
    cover: str(t && t.cover, 300),
    budget: Math.max(0, Math.round(num(t && t.budget))),
    members: strList(t && t.members, 20, 16),
    scenes: strList(t && t.scenes, 8, 8),
    currency: t && t.currency && typeof t.currency === 'object'
      ? {
          code: str(t.currency.code, 8),
          symbol: str(t.currency.symbol, 8),
          rate: Math.max(0, num(t.currency.rate))
        }
      : null,
    archived: bool(t && t.archived),
    _openid: openid,
    updateTime: now
  };
}

/** 行程条目（kind='tripItem'） */
function normalizeTripItem(it, openid) {
  const now = Date.now();
  const loc = it && it.location && typeof it.location === 'object' ? it.location : null;
  return {
    _id: str(it && it._id, 60) || undefined,
    kind: 'tripItem',
    tripId: str(it && it.tripId, 60),
    content: str(it && it.content, 60) || '新安排',
    day: Math.max(1, Math.min(60, Math.round(num(it && it.day) || 1))),
    startTime: hhmm(it && it.startTime) || '09:00',
    duration: Math.max(0, Math.min(1440, Math.round(num(it && it.duration) || 60))),
    location: loc
      ? {
          name: str(loc.name, 60),
          address: str(loc.address, 120),
          latitude: num(loc.latitude),
          longitude: num(loc.longitude)
        }
      : null,
    itemType: ['交通', '景点', '餐厅', '酒店', '购物', '自定义'].indexOf(it && it.itemType) >= 0
      ? it.itemType
      : '自定义',
    cost: Math.max(0, Math.round(num(it && it.cost) * 100) / 100),
    note: str(it && it.note, 300),
    ticketUrl: str(it && it.ticketUrl, 300),
    completed: bool(it && it.completed),
    order: Math.round(num(it && it.order)),
    _openid: openid,
    updateTime: now
  };
}

/** 行李物品（kind='packing'） */
function normalizePacking(p, openid) {
  const now = Date.now();
  return {
    _id: str(p && p._id, 60) || undefined,
    kind: 'packing',
    tripId: str(p && p.tripId, 60),
    name: str(p && p.name, 40) || '未命名物品',
    category: str(p && p.category, 16) || '其他',
    count: Math.max(1, Math.min(999, Math.round(num(p && p.count) || 1))),
    owner: str(p && p.owner, 16),
    isEssential: bool(p && p.isEssential),
    packed: bool(p && p.packed),
    reminderDaysBefore: Math.max(0, Math.min(60, Math.round(num(p && p.reminderDaysBefore)))),
    note: str(p && p.note, 200),
    order: Math.round(num(p && p.order)),
    fromTemplate: str(p && p.fromTemplate, 40),
    _openid: openid,
    updateTime: now
  };
}

function normalizeNote(n, openid) {
  const now = Date.now();
  return {
    _id: str(n && n._id, 60) || undefined,
    tripId: str(n && n.tripId, 60),
    day: Math.max(1, Math.min(60, Math.round(num(n && n.day) || 1))),
    text: str(n && n.text, 2000),
    photos: strList(n && n.photos, 30, 300),
    _openid: openid,
    updateTime: now
  };
}

/* ============================ actions ============================ */

async function list(openid, data) {
  const since = num(data.since);
  // 首次全量，后续增量（按 updateTime）
  const where = since > 0 ? { _openid: openid, updateTime: _.gt(since) } : { _openid: openid };
  const [t, i, n] = await Promise.all([
    db.collection(COL_TRIP).where(where).limit(200).get(),
    db.collection(COL_ITEM).where(where).limit(1000).get(),
    db.collection(COL_NOTE).where(where).limit(200).get()
  ]);
  return {
    success: true,
    trips: t.data,
    packing: i.data.filter((x) => x.kind === 'packing'),
    items: i.data.filter((x) => x.kind === 'tripItem'),
    notes: n.data
  };
}

async function addTrip(openid, data) {
  const doc = normalizeTrip(data.trip, openid);
  doc.createTime = (data.trip && data.trip.createTime) || Date.now();
  const id = await putDoc(COL_TRIP, doc);
  return { success: true, id };
}

async function updateTrip(openid, data) {
  const id = str(data.id, 60);
  const patch = normalizeTrip(Object.assign({}, data.patch, { title: data.patch && data.patch.title }), openid);
  // 只允许更新存在的字段，避免把 undefined 写进去
  const clean = patchOf(data.patch, patch);
  await db.collection(COL_TRIP).where({ _id: id, _openid: openid }).update({ data: clean });
  return { success: true };
}

async function removeTrip(openid, data) {
  const id = str(data.id, 60);
  await Promise.all([
    db.collection(COL_TRIP).where({ _id: id, _openid: openid }).remove(),
    db.collection(COL_ITEM).where({ tripId: id, _openid: openid }).remove(),
    db.collection(COL_NOTE).where({ tripId: id, _openid: openid }).remove()
  ]);
  return { success: true };
}

async function addPacking(openid, data) {
  const doc = normalizePacking(data.item, openid);
  doc.createTime = (data.item && data.item.createTime) || Date.now();
  const id = await putDoc(COL_ITEM, doc);
  return { success: true, id };
}

/**
 * 批量写入行李（模板生成 / 行程联动建议）。
 * 优先用前端算好的完整 items（带 `_id`，与本地一一对应，删除才匹配得上）；
 * 兼容旧的 `names` 入参（老版本前端）。
 */
async function addPackingBulk(openid, data) {
  const tripId = str(data.tripId, 60);
  const now = Date.now();
  const list = Array.isArray(data.items) ? data.items : [];
  const docs = [];
  if (list.length) {
    list.slice(0, 300).forEach((it, idx) => {
      const d = normalizePacking(Object.assign({}, it, { tripId }), openid);
      d.createTime = (it && it.createTime) || now + idx;
      docs.push(d);
    });
  } else {
    const names = Array.isArray(data.names) ? data.names : [];
    names.slice(0, 300).forEach((name, idx) => {
      const d = normalizePacking({ tripId, name, category: '其他', count: 1, fromTemplate: '行程联动' }, openid);
      d.createTime = now + idx;
      d.order = now + idx;
      docs.push(d);
    });
  }
  if (!docs.length) return { success: true, count: 0 };
  // add 一次只能一条，这里串行写入（批量通常 < 60 条，可控）
  for (const d of docs) {
    await putDoc(COL_ITEM, d);
  }
  return { success: true, count: docs.length };
}

/**
 * 模板生成清单：前端算好物品（含 `_id`），云端落库。
 * 旧实现只返回一个「已应用」标记，清单本身从未上传 —— 换设备 / 清缓存后清单直接消失。
 */
async function applyPackingTemplate(openid, data) {
  const tripId = str(data.tripId, 60);
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    return { success: true, tripId, scenes: strList(data.scenes, 8, 8), count: 0 };
  }
  // 同名去重：与前端 applyPackingTemplate 的「已存在同名跳过」保持一致
  const exist = await db
    .collection(COL_ITEM)
    .where({ tripId, kind: 'packing', _openid: openid })
    .limit(500)
    .get();
  const names = {};
  (exist.data || []).forEach((d) => { names[d.name] = true; });
  const now = Date.now();
  let count = 0;
  const docs = [];
  items.slice(0, 300).forEach((it, idx) => {
    const name = str(it && it.name, 40);
    if (!name || names[name]) return;
    names[name] = true;
    const d = normalizePacking(Object.assign({}, it, { tripId }), openid);
    d.createTime = (it && it.createTime) || now + idx;
    docs.push(d);
    count += 1;
  });
  for (const d of docs) {
    await putDoc(COL_ITEM, d);
  }
  return { success: true, tripId, scenes: strList(data.scenes, 8, 8), count: count };
}

async function updatePacking(openid, data) {
  const id = str(data.id, 60);
  const patch = normalizePacking(Object.assign({}, data.patch), openid);
  const clean = patchOf(data.patch, patch);
  await db.collection(COL_ITEM).where({ _id: id, _openid: openid }).update({ data: clean });
  return { success: true };
}

async function togglePacking(openid, data) {
  await db
    .collection(COL_ITEM)
    .where({ _id: str(data.id, 60), _openid: openid })
    .update({ data: { packed: bool(data.packed), updateTime: Date.now() } });
  return { success: true };
}

async function removePacking(openid, data) {
  await db.collection(COL_ITEM).where({ _id: str(data.id, 60), _openid: openid }).remove();
  return { success: true };
}

async function batchRemovePacking(openid, data) {
  const ids = strList(data.ids, 200, 60);
  if (!ids.length) return { success: true };
  await db.collection(COL_ITEM).where({ _id: _.in(ids), _openid: openid }).remove();
  return { success: true };
}

async function batchSetCategory(openid, data) {
  const ids = strList(data.ids, 200, 60);
  if (!ids.length) return { success: true };
  await db
    .collection(COL_ITEM)
    .where({ _id: _.in(ids), _openid: openid })
    .update({ data: { category: str(data.category, 16) || '其他', updateTime: Date.now() } });
  return { success: true };
}

async function clearPacking(openid, data) {
  await db
    .collection(COL_ITEM)
    .where({ tripId: str(data.tripId, 60), kind: 'packing', _openid: openid })
    .remove();
  return { success: true };
}

async function addTripItem(openid, data) {
  const doc = normalizeTripItem(data.item, openid);
  doc.createTime = (data.item && data.item.createTime) || Date.now();
  const id = await putDoc(COL_ITEM, doc);
  return { success: true, id };
}

/**
 * 批量写入行程条目（AI 生成的行程 / 路线模板导入）。
 * ⚠️ 这个方法以前在 ACTIONS 里根本不存在，前端调用会拿到 UNSUPPORTED_ACTION
 * （callFn 静默吞掉），表现为「AI 生成的行程换设备就没了」。
 */
async function bulkAddTripItems(openid, data) {
  const tripId = str(data.tripId, 60);
  const list = Array.isArray(data.items) ? data.items : [];
  if (!tripId || !list.length) return { success: true, count: 0 };
  const now = Date.now();
  const docs = list.slice(0, 300).map((it, idx) => {
    const d = normalizeTripItem(Object.assign({}, it, { tripId }), openid);
    d.createTime = (it && it.createTime) || now + idx;
    if (it && it.order !== undefined) d.order = Math.round(num(it.order));
    return d;
  });
  for (const d of docs) {
    await putDoc(COL_ITEM, d);
  }
  return { success: true, count: docs.length };
}

async function updateTripItem(openid, data) {
  const id = str(data.id, 60);
  const patch = normalizeTripItem(Object.assign({}, data.patch), openid);
  const clean = patchOf(data.patch, patch);
  await db.collection(COL_ITEM).where({ _id: id, _openid: openid }).update({ data: clean });
  return { success: true };
}

async function toggleTripItem(openid, data) {
  await db
    .collection(COL_ITEM)
    .where({ _id: str(data.id, 60), _openid: openid })
    .update({ data: { completed: bool(data.completed), updateTime: Date.now() } });
  return { success: true };
}

async function removeTripItem(openid, data) {
  await db.collection(COL_ITEM).where({ _id: str(data.id, 60), _openid: openid }).remove();
  return { success: true };
}

/** 拖拽排序：服务端按前端算好的 day/index 落库（同天重排由前端给出 order 序列） */
async function moveTripItem(openid, data) {
  await db
    .collection(COL_ITEM)
    .where({ _id: str(data.id, 60), _openid: openid })
    .update({ data: { day: Math.max(1, Math.round(num(data.day) || 1)), updateTime: Date.now() } });
  return { success: true };
}

/**
 * 应用路线模板：与前端语义一致 —— **替换**该行程已有的全部行程条目。
 *
 * ⚠️ 旧实现只返回一个标记，云端一条都不动。于是前端「换成另一条路线」时
 * 本地条目被换掉了、云端旧条目还在，下次同步又全部回来（清单越删越多）。
 * 现在：先清掉该行程原有的 tripItem，再按前端算好的 items 落库（保留 `_id`）。
 */
async function applyRouteTemplate(openid, data) {
  const tripId = str(data.tripId, 60);
  const items = Array.isArray(data.items) ? data.items : [];
  if (!tripId) return { success: true, count: 0 };
  if (items.length) {
    await db
      .collection(COL_ITEM)
      .where({ tripId, kind: 'tripItem', _openid: openid })
      .remove();
  }
  const now = Date.now();
  const docs = items.slice(0, 300).map((it, idx) => {
    const d = normalizeTripItem(Object.assign({}, it, { tripId }), openid);
    d.createTime = (it && it.createTime) || now + idx;
    if (it && it.order !== undefined) d.order = Math.round(num(it.order));
    return d;
  });
  for (const d of docs) {
    await putDoc(COL_ITEM, d);
  }
  return { success: true, tripId, templateKey: str(data.templateKey, 40), count: docs.length };
}

async function cloneTrip(openid, data) {
  const trip = normalizeTrip(data.trip, openid);
  const now = Date.now();
  trip.createTime = now;
  const newId = await putDoc(COL_TRIP, trip);
  // 条目 / 行李的 id 由前端重新生成后一并传下来，这里保持原样落库（与前端一一对应）
  const items = Array.isArray(data.items) ? data.items : [];
  const packs = Array.isArray(data.packing) ? data.packing : [];
  for (let i = 0; i < items.length; i += 1) {
    const d = normalizeTripItem(Object.assign({}, items[i], { tripId: newId, completed: false, cost: 0 }), openid);
    d.createTime = now + i;
    await putDoc(COL_ITEM, d);
  }
  for (let i = 0; i < packs.length; i += 1) {
    const d = normalizePacking(Object.assign({}, packs[i], { tripId: newId, packed: false }), openid);
    d.createTime = now + i;
    await putDoc(COL_ITEM, d);
  }
  return { success: true, id: newId };
}

async function saveNote(openid, data) {
  const note = data.note || {};
  const doc = normalizeNote(note, openid);
  // `_id` 不能出现在 update 的 data 里（云数据库不允许改主键），单独取出来
  const clientId = doc._id;
  delete doc._id;
  const old = await db
    .collection(COL_NOTE)
    .where({ tripId: doc.tripId, day: doc.day, _openid: openid })
    .limit(1)
    .get();
  if (old.data && old.data.length) {
    await db.collection(COL_NOTE).where({ _id: old.data[0]._id, _openid: openid }).update({ data: doc });
    return { success: true, id: old.data[0]._id };
  }
  doc.createTime = (note && note.createTime) || Date.now();
  const id = await putDoc(COL_NOTE, clientId ? Object.assign({}, doc, { _id: clientId }) : doc);
  return { success: true, id };
}

async function removeNote(openid, data) {
  await db.collection(COL_NOTE).where({ _id: str(data.id, 60), _openid: openid }).remove();
  return { success: true };
}

/**
 * 按 id 物理清除（前端「删除墓碑」的补发入口）。
 *
 * 前端只记 id、不记集合（行程 / 条目 / 日记都会被删），因此这里三张表各按
 * `_id in ids` 删一遍 —— 天然覆盖所有情况，以后再加集合也不用改前端。
 * 用途：用户离线（cloudCapable=false）时删掉的东西云端还留着，
 * 只在本地挡住的话换设备照样回来；同步成功后再补这一刀。
 */
async function purge(openid, data) {
  const ids = strList(data.ids, 300, 60);
  if (!ids.length) return { success: true, removed: 0 };
  const cond = { _id: _.in(ids), _openid: openid };
  const [t, i, n] = await Promise.all([
    db.collection(COL_TRIP).where(cond).remove(),
    db.collection(COL_ITEM).where(cond).remove(),
    db.collection(COL_NOTE).where(cond).remove()
  ]);
  const removed =
    ((t && t.stats && t.stats.removed) || 0) +
    ((i && i.stats && i.stats.removed) || 0) +
    ((n && n.stats && n.stats.removed) || 0);
  return { success: true, removed };
}

/**
 * 天气：接和风天气。未配置 QWEATHER_KEY 时返回 ok:false，
 * 前端会用「按月份的穿衣建议」兜底，绝不显示空白。
 */
async function weather(data) {
  const key = process.env.QWEATHER_KEY;
  const dest = str(data.destination, 30);
  const date = ymd(data.date);
  if (!key || !dest) return { success: true, ok: false };
  try {
    const https = require('https');
    const locUrl = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(dest)}&key=${key}`;
    const loc = await httpsGet(locUrl);
    const locJson = JSON.parse(loc);
    if (!locJson.location || !locJson.location.length) return { success: true, ok: false };
    const id = locJson.location[0].id;
    const wUrl = `https://devapi.qweather.com/v7/weather/3d?location=${id}&key=${key}`;
    const w = JSON.parse(await httpsGet(wUrl));
    const day = (w.daily || []).find((d) => d.fxDate === date) || (w.daily || [])[0];
    if (!day) return { success: true, ok: false };
    const textDay = day.textDay || '';
    const warn = /雨|雪|雷|台风/.test(textDay)
      ? `目的地当日预报「${textDay}」，户外项目请备好雨具或考虑改期`
      : '';
    return {
      success: true,
      ok: true,
      text: textDay,
      temp: `${day.tempMin || '--'}° ~ ${day.tempMax || '--'}°`,
      tip: `今日${textDay}，风力 ${day.windScaleDay || '--'} 级，紫外线 ${day.uvIndex || '--'}`,
      warning: warn
    };
  } catch (e) {
    return { success: true, ok: false };
  }
}

function httpsGet(url) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
        });
        res.on('end', () => resolve(buf));
      })
      .on('error', reject);
  });
}

/* ============================ AI 档案（与其他 AI 云函数同一套约定） ============================ */

/**
 * 主档案 = 火山方舟（豆包），内置兜底 Key → 「上传即可用」，一个环境变量都不配也能跑；
 * 冷备   = 智谱 GLM，主档案整体失败（401/402/403/404/429 / 网络不通）时顶上。
 *
 * 覆盖顺序：TRAVEL_AI_* > AI_* > 内置兜底（fallback）。
 *   TRAVEL_AI_KEY / TRAVEL_AI_BASE / TRAVEL_AI_MODEL   旅行模块专用覆盖
 *   AI_API_KEY / AI_API_BASE / AI_MODEL                与 goalPlanner / civilAI 共用
 *   AI_BACKUP_BASE / AI_BACKUP_KEY / AI_BACKUP_PROVIDER  冷备覆盖
 *   AI_BACKUP_DISABLE=1                                关闭冷备（单供应商排障 / 离线自检必用）
 *
 * ⚠️ 历史坑（问题一「AI 规划无法启用」的根因之一）：
 *   旧实现只认 TRAVEL_AI_KEY，而 config.json 里它默认是空串，也没有任何兜底 Key。
 *   于是「云函数已部署 + AI 永远 ok:false」，前端只能一直停在「启用并生成」。
 *   其他 AI 云函数（resume / helperChat / civilAI / goalPlanner）都内置了兜底 Key，
 *   只有 travel 漏了 —— 这里补齐，与全站保持一致。
 *
 * ⚠️ 冷备必须留在源码里的原因：离线自检若不把冷备指向 mock，
 *   主档案一旦被判为「供应商级失败」就会切真实厂商 —— 用例变联网、白烧 token。
 */
const AI_DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const AI_DEFAULT_MODEL = 'doubao-seed-character-260628';
const FALLBACK_API_KEY = '';

const AI_BACKUP = {
  provider: (process.env.AI_BACKUP_PROVIDER || 'zhipu').trim(),
  base: (process.env.AI_BACKUP_BASE || 'https://open.bigmodel.cn/api/paas/v4').trim().replace(/\/+$/, ''),
  key: (process.env.AI_BACKUP_KEY || '').trim(),
  model: 'glm-4.6',
  // AI_BACKUP_DISABLE=1 可关闭冷备（单供应商排障 / 离线自检时用）
  enabled: (process.env.AI_BACKUP_DISABLE || '').trim() !== '1'
};

/** 解析当前 AI 档案（空串视为未配置，继续往下取兜底） */
function aiConfig() {
  return {
    base: (process.env.TRAVEL_AI_BASE || process.env.AI_API_BASE || AI_DEFAULT_BASE).trim().replace(/\/+$/, ''),
    key: (process.env.TRAVEL_AI_KEY || process.env.AI_API_KEY || FALLBACK_API_KEY || '').trim(),
    model: (process.env.TRAVEL_AI_MODEL || process.env.AI_MODEL || AI_DEFAULT_MODEL).trim()
  };
}

/** 是否具备 AI 调用条件（纯本地判断，不发网络请求；供前端「AI 可启用性」探测） */
function aiConfigured() {
  return !!aiConfig().key;
}

/** 是否属于「换一家供应商还有救」的失败（Key 失效 / 欠费 / 模型下线 / 网络不通）。
 *  参数类错误（400/422）不切换 —— 换一家同样报错，只会白等一轮。 */
function isProviderLevelFailure(err) {
  const msg = (err && err.message) || '';
  if (/TIMEOUT/i.test(msg)) return false; // 预算已耗尽，再打一发必然还是超时
  if (/UPSTREAM_400|UPSTREAM_422/.test(msg)) return false;
  return /UPSTREAM_(401|402|403|404|429)|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(
    msg
  );
}

/**
 * JSON POST（用于 AI 兼容接口），带 50s 超时自毁，避免云函数被拖死。
 *
 * ⚠️ 必须校验 HTTP 状态码：旧实现只看响应体、不看 statusCode，
 *   于是 401（Key 失效）会被当成「AI 返回为空」，永远切不到冷备。
 *   现在非 2xx 统一抛 UPSTREAM_<status>，交给 isProviderLevelFailure 判断是否换供应商。
 */
function requestJSON(url, apiKey, payload, timeoutMs) {
  const https = require('https');
  const urlmod = require('url');
  const data = JSON.stringify(payload);
  const u = urlmod.parse(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${apiKey}`
        }
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
        });
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`UPSTREAM_${status}: ${String(buf).slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error(`UPSTREAM_BAD_JSON: ${String(buf).slice(0, 120)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs || 50000, () => {
      req.destroy(new Error('AI_REQUEST_TIMEOUT'));
    });
    req.write(data);
    req.end();
  });
}

/**
 * 对同一份 payload 依次尝试「主档案 → 冷备」，避免一个 Key 出问题就整块功能不可用。
 *
 * ⚠️ 必须用**总预算**控制耗时（这是「AI 调用不了」的主因之一）：
 *   微信小程序 `wx.cloud.callFunction` 客户端侧只等 20s，超时报
 *   `-404012 polling exceed max timeout`；而 cloud.ts 把这个码列入「云端故障」特征，
 *   会**整体降级为本地模式**（连数据同步一起退化成 mock）。
 *   旧实现单次请求超时给到 50s，冷备再叠一轮 → 必然先被客户端掐断，
 *   用户看到的是「AI 调用不了 / 已使用本地内容」，而且之后整个旅行模块都像坏了。
 *   现在：总预算 18s 内切分给主档案与冷备，宁可快速失败给出可读提示，也不拖到客户端超时。
 *
 * ⚠️ 供应商专有参数要按家剥离：`thinking` 是火山方舟的参数，发给智谱 GLM 会 400，
 *   而 400 不触发降级切换（换家也一样报错），等于把冷备废掉。故只挂在主档案上。
 */
async function requestAI(payload, opts) {
  const cfg = aiConfig();
  const totalMs = Math.max(4000, (opts && opts.totalMs) || 18000);
  const deadline = Date.now() + totalMs;
  const attempts = [
    { base: cfg.base, key: cfg.key, model: cfg.model, extra: { thinking: { type: 'disabled' } } }
  ];
  if (AI_BACKUP.enabled && AI_BACKUP.key && cfg.base !== AI_BACKUP.base) {
    attempts.push({ base: AI_BACKUP.base, key: AI_BACKUP.key, model: AI_BACKUP.model, extra: {} });
  }
  let lastErr = null;
  for (let i = 0; i < attempts.length; i += 1) {
    const a = attempts[i];
    const remain = deadline - Date.now();
    if (remain < 2500) break; // 剩余预算不够打一发了，别再白等
    // 主档案先拿七成预算（正常只需 3~4s），其余留给冷备
    const budget = i === 0 ? Math.min(remain, Math.max(5000, Math.round(remain * 0.7))) : remain;
    try {
      return await requestJSON(
        `${a.base}/chat/completions`,
        a.key,
        Object.assign({}, payload, a.extra || {}, { model: a.model }),
        budget
      );
    } catch (e) {
      lastErr = e;
      if (i < attempts.length - 1 && isProviderLevelFailure(e)) {
        console.warn(`[travel] 主档案失败（${(e && e.message) || ''}），切换冷备重试`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('AI 调用失败');
}

/** 当前使用的 AI 档案（给 aiStatus 回显，便于线上排障；不含 Key 本身） */
function aiProviderInfo() {
  const cfg = aiConfig();
  const useFallback = !process.env.TRAVEL_AI_KEY && !process.env.AI_API_KEY;
  return {
    base: cfg.base,
    model: cfg.model,
    source: useFallback ? 'fallback' : 'env',
    backup: AI_BACKUP.enabled && !!AI_BACKUP.key
  };
}

/**
 * AI 能力探测：**不碰数据库、不发上游请求**，只回答「现在能不能用 AI」。
 *
 * ⚠️ 这是问题一的关键：前端原来的开关绑在 syncCloud 上，而 syncCloud 要走
 *   数据库 list —— 集合没建（-502005）就永远失败，AI 跟着一起被锁死。
 *   AI 只需要云函数 + Key，与集合存不存在无关，所以必须单独提供这个探针。
 */
async function aiStatus() {
  return { success: true, ok: aiConfigured(), ai: aiConfigured(), provider: aiProviderInfo() };
}

/**
 * AI 助手：调用 OpenAI 兼容接口。密钥只存在于服务端（环境变量 / 内置兜底），
 * 绝不下发客户端。输入做长度裁剪，避免超长 / 滥用。
 */
async function aiChat(openid, data) {
  if (!aiConfigured()) return { success: true, ok: false, message: 'AI 未配置密钥' };
  const system = str(data.system, 2000);
  const user = str(data.user, 4000);
  if (!user) return { success: true, ok: false, message: '请输入内容' };
  try {
    const json = await requestAI(
      {
        messages: [
          { role: 'system', content: system || '你是贴心的旅行助手。' },
          { role: 'user', content: user }
        ],
        temperature: 0.8,
        max_tokens: 1200
      },
      { totalMs: 15000 }
    );
    const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!text) return { success: true, ok: false, message: 'AI 返回为空' };
    return { success: true, ok: true, text: str(text, 4000) };
  } catch (e) {
    return { success: true, ok: false, message: `AI 调用失败：${String((e && e.message) || e).slice(0, 200)}` };
  }
}

/**
 * AI 结构化行程规划：返回按天的条目数组（时间 / 类型 / 地点 / 花费），
 * 便于前端直接转成可编辑的行程条目。上游整体失败则 ok:false，前端走本地兜底。
 */
async function aiPlan(openid, data) {
  if (!aiConfigured()) return { success: true, ok: false, message: 'AI 未配置密钥' };
  const destination = str(data.destination, 30) || '未知目的地';
  const days = Math.max(1, Math.min(15, Math.round(num(data.days)) || 1));
  const budget = Math.max(0, Math.round(num(data.budget)));
  const members = strList(data.members, 10, 16);
  const scenes = strList(data.scenes, 8, 8);
  const sys =
    '你是旅行规划师。按目的地/天数/预算/同行/偏好生成逐日行程。' +
    '每天固定 3 条（上午/下午/晚上各一条），不要多也不要少。每条字段：' +
    'startTime(HH:mm 24小时制)、content(不超过12字)、' +
    'type(只能是 交通/景点/餐厅/酒店/购物/自定义 之一)、place(不超过12字)、' +
    'cost(整数元,无则0)、note(不超过15字)。总花费不超预算。' +
    '只输出 JSON，无解释、无 markdown 围栏：' +
    '{"plan":[{"day":1,"items":[{"startTime":"09:00","content":"宽窄巷子","type":"景点","place":"宽窄巷子","cost":0,"note":"尝小吃"}]}]}';
  const user =
    `目的地：${destination}\n天数：${days} 天\n人均预算：${budget} 元\n` +
    `同行：${members.length ? members.join('、') : '朋友结伴'}\n偏好场景：${scenes.length ? scenes.join('、') : '无'}`;
  // 输出量随天数线性增长：实测天气好时 3 天约 900 字 ≈ 700 tokens，
  // 留一倍余量；上限 3200 防止单次生成把云函数时间预算吃光。
  const maxTokens = Math.min(3200, 260 + days * 260);
  try {
    const json = await requestAI(
      {
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: maxTokens
      },
      { totalMs: 18000 }
    );
    const raw = json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : '';
    const parsed = parseAIMarkdownJSON(raw);
    const plan = Array.isArray(parsed && parsed.plan) ? parsed.plan : [];
    const TYPE_SET = ['交通', '景点', '餐厅', '酒店', '购物', '自定义'];
    const items = [];
    plan.forEach((d) => {
      const day = Math.max(1, Math.round(num(d.day)) || 1);
      if (!Array.isArray(d.items)) return;
      d.items.forEach((it) => {
        const t = str(it.type, 6);
        const type = TYPE_SET.indexOf(t) >= 0 ? t : '自定义';
        items.push({
          day,
          startTime: hhmm(it.startTime) || '09:00',
          content: str(it.content, 60) || '新安排',
          type,
          place: str(it.place, 60),
          cost: Math.max(0, Math.round(num(it.cost) * 100) / 100),
          note: str(it.note, 200)
        });
      });
    });
    if (!items.length) return { success: true, ok: false, message: 'AI 未返回有效行程，请重试' };
    return { success: true, ok: true, days, items };
  } catch (e) {
    const msg = String((e && e.message) || e);
    // 超时单独给文案：用户能据此「减少天数」自救，而不是反复点重试
    if (/TIMEOUT/i.test(msg)) {
      return { success: true, ok: false, message: 'AI 生成超时，请减少天数后重试' };
    }
    return { success: true, ok: false, message: `AI 调用失败：${msg.slice(0, 200)}` };
  }
}

/**
 * 发送提醒：把提醒任务落到 remind_queue 集合，由定时触发器消费。
 * 前端调用即入队，真正的订阅消息推送在 triggerTripReminders 里做。
 */
async function sendReminder(openid, data) {
  const doc = {
    _openid: openid,
    tripId: str(data.tripId, 60),
    kind: ['packing', 'depart', 'item'].indexOf(data.kind) >= 0 ? data.kind : 'packing',
    text: str(data.text, 200),
    sent: false,
    createTime: Date.now()
  };
  const r = await db.collection('travel_remind_queue').add({ data: doc });
  return { success: true, id: r._id };
}

/** 定时触发器入口：扫描当天该发的提醒 */
async function scanReminders() {
  const res = await db
    .collection('travel_remind_queue')
    .where({ sent: false })
    .limit(50)
    .get();
  const now = Date.now();
  for (const item of res.data) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: item._openid,
        templateId: process.env.TRIP_TMPL_ID || '',
        miniprogramState: process.env.MP_STATE || 'trial',
        page: `subpackages/travel/pages/index/index`,
        data: { thing1: { value: (item.text || '旅行提醒').slice(0, 20) } }
      });
      await db.collection('travel_remind_queue').doc(item._id).update({ data: { sent: true, sentAt: now } });
    } catch (e) {
      // 单个失败不影响其他：留着下次再扫
    }
  }
  return { success: true, scanned: res.data.length };
}

const ACTIONS = {
  list,
  addTrip,
  updateTrip,
  removeTrip,
  addPacking,
  addPackingBulk,
  applyPackingTemplate,
  updatePacking,
  togglePacking,
  removePacking,
  batchRemovePacking,
  batchSetCategory,
  clearPacking,
  addTripItem,
  bulkAddTripItems,
  updateTripItem,
  toggleTripItem,
  removeTripItem,
  moveTripItem,
  applyRouteTemplate,
  cloneTrip,
  saveNote,
  removeNote,
  purge,
  weather,
  aiStatus,
  aiChat,
  aiPlan,
  sendReminder,
  scanReminders
};

exports.main = async (event) => {
  const action = (event && event.action) || '';
  // 定时触发器不带 action
  if (event && event.Type === 'Timer') {
    return scanReminders();
  }
  const fn = ACTIONS[action];
  if (!fn) {
    return { success: false, error: 'UNSUPPORTED_ACTION', message: `未知 action: ${action}` };
  }
  try {
    const openid = getOpenid();
    return await fn(openid, event);
  } catch (err) {
    return { success: false, error: 'TRAVEL_FAILED', message: String((err && err.message) || err) };
  }
};
