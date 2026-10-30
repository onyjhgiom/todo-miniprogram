// utils/love-duo.ts
// 双人空间 · 协作内容的本地存储 + 云端同步
//
// 【为什么不用旧的「整包快照」】
//  旧同步是 A/B 各占一个槽位、整体覆盖——两人同时写就会互相踩掉。
//  留言、评论、共同心愿这类是**协作写**，必须按条目粒度合并：
//  每条内容一个 id + updatedAt，冲突时「最后写入胜出」（LWW），删除走墓碑（deleted），
//  这样双方各自的新增都能保留，不会出现「我发的留言把 TA 的挤没了」。
//
// 【本地优先】所有读写先落 wx.storage，云端失败只是「暂时没同步出去」，
//  绝不阻塞操作、绝不丢数据；未绑定时全部内容仅本机可见。
import { callFn } from '../../../utils/cloud';
import { isBound, getPair, myRole, myName } from './love-pair';

export type DuoKind = 'msg' | 'mood' | 'anniv' | 'signal' | 'wish' | 'task' | 'post' | 'comment';

export const DUO_KINDS: DuoKind[] = ['msg', 'mood', 'anniv', 'signal', 'wish', 'task', 'post', 'comment'];

/** 云端一条内容 */
export interface DuoItem<T = unknown> {
  id: string;
  data: T;
  /** 最后修改时间——LWW 合并的依据 */
  updatedAt: number;
  /** 谁改的（服务端判定，不可伪造） */
  by: 'me' | 'him';
  /** 墓碑删除：true 表示已删除，同步后双方一起消失 */
  deleted: boolean;
}

/* ============================ 各模块的数据模型 ============================ */

/** 私密留言 */
export interface DuoMsg { id: string; text: string; at: number; }
/** 心情打卡：一人一天一条，id 用 `${role}_${date}` 保证幂等 */
export interface DuoMood { id: string; date: string; mood: string; note: string; at: number; }
/** 纪念日 */
export interface DuoAnniv { id: string; title: string; date: string; yearly: boolean; note: string; }
/** 虚拟互动 / 鼓励赞美 */
export interface DuoSignal {
  id: string;
  kind: 'poke' | 'goodnight' | 'praise' | 'miss' | 'cheer';
  text: string;
  at: number;
}
/** 共同心愿 */
export interface DuoWish { id: string; title: string; note: string; done: boolean; doneAt: number; target: string; }
/** 共同约定 / 任务 */
export interface DuoTask { id: string; title: string; note: string; progress: number; done: boolean; due: string; }
/** 双人动态（图文 / 日记 / 相册） */
export interface DuoPost {
  id: string;
  /** moment=图文动态 diary=日记 album=回忆相册 */
  kind: 'moment' | 'diary' | 'album';
  title: string;
  text: string;
  photos: string[];
  date: string;
  at: number;
}
/** 动态评论 */
export interface DuoComment { id: string; postId: string; text: string; at: number; }

/* ============================ 本地存取 ============================ */

function keyOf(kind: DuoKind): string { return `love_duo_${kind}_v1`; }
const K_SYNC = 'love_duo_sync_v1';

interface SyncMark { [kind: string]: { pullAt: number; pushAt: number }; }

function getSync(): SyncMark {
  try {
    const s = wx.getStorageSync(K_SYNC) as SyncMark | '';
    return (s && typeof s === 'object') ? s : {};
  } catch (e) { return {}; }
}

function setSync(m: SyncMark): void {
  try { wx.setStorageSync(K_SYNC, m); } catch (e) { /* 忽略 */ }
}

export function loadItems<T>(kind: DuoKind): DuoItem<T>[] {
  try {
    const a = wx.getStorageSync(keyOf(kind)) as DuoItem<T>[] | '';
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

function saveItems<T>(kind: DuoKind, list: DuoItem<T>[]): void {
  try { wx.setStorageSync(keyOf(kind), list); } catch (e) { /* 忽略 */ }
}

/** 未删除的条目，按更新时间倒序 */
export function liveItems<T>(kind: DuoKind): DuoItem<T>[] {
  return loadItems<T>(kind)
    .filter((i) => !i.deleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * 写入一条（新增或更新）。本地立即生效，云端能同步就同步，失败静默留待下次。
 * 返回新的完整列表，方便页面直接 setData。
 */
export function upsert<T>(kind: DuoKind, id: string, data: T): DuoItem<T>[] {
  const list = loadItems<T>(kind);
  const now = Date.now();
  const idx = list.findIndex((i) => i.id === id);
  const item: DuoItem<T> = { id, data, updatedAt: now, by: myRole(), deleted: false };
  if (idx >= 0) list[idx] = item; else list.push(item);
  saveItems(kind, list);
  void pushKind(kind); // 不 await：写入不该被网络拖住
  return list;
}

/** 墓碑删除 */
export function remove<T>(kind: DuoKind, id: string): DuoItem<T>[] {
  const list = loadItems<T>(kind);
  const idx = list.findIndex((i) => i.id === id);
  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], { deleted: true, updatedAt: Date.now(), by: myRole() });
    saveItems(kind, list);
    void pushKind(kind);
  }
  return list;
}

/* ============================ 同步 ============================ */

export interface SyncResult { ok: boolean; msg: string; pulled?: number; pushed?: number; }

/** 合并：同一 id 谁新听谁的；墓碑也算一次更新 */
function merge<T>(local: DuoItem<T>[], remote: DuoItem<T>[]): DuoItem<T>[] {
  const map = new Map<string, DuoItem<T>>();
  local.forEach((i) => map.set(i.id, i));
  remote.forEach((r) => {
    const old = map.get(r.id);
    if (!old || r.updatedAt > old.updatedAt) map.set(r.id, r);
  });
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function call(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    return await callFn<Record<string, unknown>>('love', Object.assign({ action }, payload));
  } catch (e) {
    return null;
  }
}

/** 拉取某个类型：只拉 updatedAt >= 上次拉取时间的，减少传输 */
export async function pullKind(kind: DuoKind): Promise<SyncResult> {
  const p = getPair();
  if (!isBound() || !p.pairId) return { ok: false, msg: '未绑定' };
  const sync = getSync();
  const since = (sync[kind] && sync[kind].pullAt) || 0;
  const res = await call('duo.pull', { pairId: p.pairId, kind, since });
  const r = (res || {}) as { ok?: boolean; items?: DuoItem<unknown>[]; error?: string };
  if (!r.ok || !Array.isArray(r.items)) return { ok: false, msg: r.error || '拉取失败' };

  const local = loadItems(kind);
  const next = merge(local, r.items as DuoItem<unknown>[]);
  saveItems(kind, next);

  let maxAt = since;
  r.items.forEach((i) => { if (i.updatedAt > maxAt) maxAt = i.updatedAt; });
  sync[kind] = Object.assign({}, sync[kind], { pullAt: maxAt || Date.now() });
  setSync(sync);
  return { ok: true, msg: '', pulled: r.items.length };
}

/** 推送某个类型里「上次推送之后改过的」条目 */
export async function pushKind(kind: DuoKind): Promise<SyncResult> {
  const p = getPair();
  if (!isBound() || !p.pairId) return { ok: false, msg: '未绑定' };
  const sync = getSync();
  const last = (sync[kind] && sync[kind].pushAt) || 0;
  const dirty = loadItems(kind).filter((i) => i.updatedAt > last);
  if (!dirty.length) return { ok: true, msg: '', pushed: 0 };

  const res = await call('duo.push', {
    pairId: p.pairId,
    kind,
    items: dirty.map((i) => ({ id: i.id, data: i.data, updatedAt: i.updatedAt, deleted: i.deleted }))
  });
  const r = (res || {}) as { ok?: boolean; error?: string; pushed?: number };
  if (!r.ok) return { ok: false, msg: r.error || '同步失败' };

  let maxAt = last;
  dirty.forEach((i) => { if (i.updatedAt > maxAt) maxAt = i.updatedAt; });
  sync[kind] = Object.assign({}, sync[kind], { pushAt: maxAt });
  setSync(sync);
  return { ok: true, msg: '', pushed: r.pushed || dirty.length };
}

/** 先拉后推：保证自己的新内容不会覆盖掉对方刚写的 */
export async function syncKind(kind: DuoKind): Promise<SyncResult> {
  const a = await pullKind(kind);
  const b = await pushKind(kind);
  return { ok: a.ok || b.ok, msg: '', pulled: a.pulled || 0, pushed: b.pushed || 0 };
}

export async function syncAll(): Promise<SyncResult> {
  let pulled = 0; let pushed = 0; let anyOk = false;
  for (const k of DUO_KINDS) {
    // 串行：并发打云函数容易触发限流，且这几类数据量都不大
    const r = await syncKind(k);
    if (r.ok) anyOk = true;
    pulled += r.pulled || 0;
    pushed += r.pushed || 0;
  }
  return { ok: anyOk, msg: '', pulled, pushed };
}

/**
 * 「暂不上传」：把已有本地内容标记为已推送，这样只有**之后**新增的才进双人空间。
 * 用于用户不同意把绑定前的私密内容同步给对方时。
 */
export function skipUpload(): void {
  const sync = getSync();
  const now = Date.now();
  DUO_KINDS.forEach((k) => {
    sync[k] = Object.assign({}, sync[k], { pushAt: now });
  });
  setSync(sync);
}

/** 待上传条数（用于绑定后询问「是否同步已有内容」） */
export function pendingCount(): number {
  const sync = getSync();
  let n = 0;
  DUO_KINDS.forEach((k) => {
    const last = (sync[k] && sync[k].pushAt) || 0;
    n += loadItems(k).filter((i) => i.updatedAt > last).length;
  });
  return n;
}

/* ============================ 业务 API ============================ */

function today(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dateKey(d: Date): string {
  const p = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---- 私密留言 ---- */
export function listMsgs(): DuoItem<DuoMsg>[] {
  return liveItems<DuoMsg>('msg').slice().sort((a, b) => (a.data.at || 0) - (b.data.at || 0));
}
export function addMsg(text: string): void {
  const t = (text || '').trim();
  if (!t) return;
  const id = uid('msg');
  upsert<DuoMsg>('msg', id, { id, text: t, at: Date.now() });
}

/* ---- 心情打卡 ---- */
export function listMoods(): DuoItem<DuoMood>[] { return liveItems<DuoMood>('mood'); }
export function setMood(mood: string, note: string, date?: string): void {
  const d = date || today();
  const id = `${myRole()}_${d}`; // 一人一天一条，重复打卡覆盖当天
  upsert<DuoMood>('mood', id, { id, date: d, mood, note: (note || '').trim(), at: Date.now() });
}
export function moodOf(role: 'me' | 'him', date: string): DuoItem<DuoMood> | null {
  return listMoods().find((m) => m.id === `${role}_${date}`) || null;
}

/* ---- 纪念日 ---- */
export function listAnnivs(): DuoItem<DuoAnniv>[] { return liveItems<DuoAnniv>('anniv'); }
export function addAnniv(title: string, date: string, yearly: boolean, note: string): void {
  const id = uid('anv');
  upsert<DuoAnniv>('anniv', id, { id, title: title.trim(), date, yearly, note: (note || '').trim() });
}
export function delAnniv(id: string): void { remove<DuoAnniv>('anniv', id); }

/** 距离下次还有多少天；yearly 的取今年的纪念日，过了就顺延到明年 */
export function annivCountdown(a: DuoAnniv): number {
  const now = new Date();
  const cur = dateKey(now);
  const [y, m, d] = a.date.split('-').map(Number);
  if (!y || !m || !d) return -1;
  if (a.yearly) {
    let ty = now.getFullYear();
    const thisYear = new Date(ty, m - 1, d);
    if (dateKey(thisYear) < cur) ty += 1;
    const next = new Date(ty, m - 1, d);
    return Math.round((next.getTime() - new Date(`${cur}T00:00:00`).getTime()) / 86400000);
  }
  const tgt = new Date(y, m - 1, d);
  return Math.round((tgt.getTime() - new Date(`${cur}T00:00:00`).getTime()) / 86400000);
}

/* ---- 虚拟互动 / 鼓励赞美 ---- */
export function listSignals(): DuoItem<DuoSignal>[] { return liveItems<DuoSignal>('signal'); }
export function sendSignal(kind: DuoSignal['kind'], text?: string): void {
  const id = uid('sig');
  upsert<DuoSignal>('signal', id, { id, kind, text: (text || '').trim(), at: Date.now() });
}
/** 对方最近一次互动（首页展示「TA 刚刚戳了戳你」） */
export function lastSignalFromOther(): DuoItem<DuoSignal> | null {
  const me = myRole();
  const other: 'me' | 'him' = me === 'me' ? 'him' : 'me';
  return listSignals().find((s) => s.by === other) || null;
}

/* ---- 共同心愿 ---- */
export function listWishes(): DuoItem<DuoWish>[] { return liveItems<DuoWish>('wish'); }
export function addWish(title: string, note: string, target: string): void {
  const id = uid('wsh');
  upsert<DuoWish>('wish', id, { id, title: title.trim(), note: (note || '').trim(), done: false, doneAt: 0, target: target || '' });
}
export function toggleWish(id: string): void {
  const it = listWishes().find((w) => w.id === id);
  if (!it) return;
  upsert<DuoWish>('wish', id, Object.assign({}, it.data, { done: !it.data.done, doneAt: !it.data.done ? Date.now() : 0 }));
}
export function delWish(id: string): void { remove<DuoWish>('wish', id); }

/* ---- 共同约定 / 任务 ---- */
export function listTasks(): DuoItem<DuoTask>[] { return liveItems<DuoTask>('task'); }
export function addTask(title: string, note: string, due: string): void {
  const id = uid('tsk');
  upsert<DuoTask>('task', id, { id, title: title.trim(), note: (note || '').trim(), progress: 0, done: false, due: due || '' });
}
export function setTaskProgress(id: string, progress: number): void {
  const it = listTasks().find((t) => t.id === id);
  if (!it) return;
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  upsert<DuoTask>('task', id, Object.assign({}, it.data, { progress: p, done: p >= 100 }));
}
export function toggleTask(id: string): void {
  const it = listTasks().find((t) => t.id === id);
  if (!it) return;
  const done = !it.data.done;
  upsert<DuoTask>('task', id, Object.assign({}, it.data, { done, progress: done ? 100 : 0 }));
}
export function delTask(id: string): void { remove<DuoTask>('task', id); }

/* ---- 双人动态 ---- */
export function listPosts(): DuoItem<DuoPost>[] { return liveItems<DuoPost>('post'); }
export function addPost(kind: DuoPost['kind'], title: string, text: string, photos: string[], date: string): void {
  const id = uid('pst');
  upsert<DuoPost>('post', id, {
    id, kind, title: (title || '').trim(), text: (text || '').trim(),
    photos: photos || [], date: date || today(), at: Date.now()
  });
}
export function delPost(id: string): void {
  remove<DuoPost>('post', id);
  // 评论跟着一起删，避免留下孤儿评论
  liveItems<DuoComment>('comment').filter((c) => c.data.postId === id).forEach((c) => remove<DuoComment>('comment', c.id));
}

/* ---- 评论 ---- */
export function listComments(postId: string): DuoItem<DuoComment>[] {
  return liveItems<DuoComment>('comment')
    .filter((c) => c.data.postId === postId)
    .slice()
    .sort((a, b) => (a.data.at || 0) - (b.data.at || 0));
}
export function commentCount(postId: string): number { return listComments(postId).length; }
export function addComment(postId: string, text: string): void {
  const t = (text || '').trim();
  if (!t) return;
  const id = uid('cmt');
  upsert<DuoComment>('comment', id, { id, postId, text: t, at: Date.now() });
}
export function delComment(id: string): void { remove<DuoComment>('comment', id); }

/* ============================ 图片上传 ============================ */

/**
 * 上传配图到云存储，拿到 fileID 才能两边都看到。
 * 云端不可用就退回本地路径并标注——至少自己这边不丢图。
 */
export async function uploadImage(localPath: string): Promise<string> {
  if (!localPath) return '';
  try {
    const app = (typeof getApp === 'function' ? getApp() : null) as
      { globalData?: { cloudReady?: boolean; envId?: string } } | null;
    if (!app || !app.globalData || !app.globalData.cloudReady) return localPath;
    const ext = (localPath.split('.').pop() || 'png').toLowerCase();
    const cloudPath = `love/moment/${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`;
    const r = await wx.cloud.uploadFile({ cloudPath, filePath: localPath });
    return (r && r.fileID) || localPath;
  } catch (e) {
    return localPath;
  }
}

/** 动态配图显示用：cloud:// 走云存储临时链接，本地路径直接用 */
export async function resolveImage(fileID: string): Promise<string> {
  if (!fileID) return '';
  if (fileID.indexOf('cloud://') !== 0) return fileID;
  try {
    const r = await wx.cloud.getTempFileURL({ fileList: [fileID] });
    const f = r && r.fileList && r.fileList[0];
    return (f && f.tempFileURL) || '';
  } catch (e) {
    return '';
  }
}

/* ============================ 展示辅助 ============================ */

export function relTime(at: number): string {
  if (!at) return '';
  const diff = Date.now() - at;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
  const d = new Date(at);
  const p = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 这条内容是我发的还是 TA 发的 */
export function isMine<T>(item: DuoItem<T>): boolean {
  return item.by === myRole();
}

/** 展示用的作者名 */
export function authorName<T>(item: DuoItem<T>): string {
  return item.by === myRole() ? myName() : (getPair().partnerName || 'TA');
}

export const MOODS: { key: string; emoji: string; label: string }[] = [
  { key: 'happy', emoji: '😊', label: '开心' },
  { key: 'calm', emoji: '😌', label: '平静' },
  { key: 'excited', emoji: '🤩', label: '期待' },
  { key: 'tired', emoji: '😪', label: '疲惫' },
  { key: 'anxious', emoji: '😣', label: '焦虑' },
  { key: 'sad', emoji: '😢', label: '难过' },
  { key: 'angry', emoji: '😤', label: '生气' },
  { key: 'miss', emoji: '🥺', label: '想你' }
];

export function moodMeta(key: string): { key: string; emoji: string; label: string } {
  return MOODS.find((m) => m.key === key) || { key, emoji: '🙂', label: key || '未记录' };
}

export const SIGNALS: { key: DuoSignal['kind']; emoji: string; label: string; tip: string }[] = [
  { key: 'poke', emoji: '👆', label: '戳一戳', tip: '轻轻戳一下 TA' },
  { key: 'goodnight', emoji: '🌙', label: '道晚安', tip: '和 TA 说声晚安' },
  { key: 'praise', emoji: '🌟', label: '夸一夸', tip: '真诚地夸夸 TA' },
  { key: 'cheer', emoji: '💪', label: '加油打气', tip: '给 TA 充个电' },
  { key: 'miss', emoji: '💗', label: '想你了', tip: '让 TA 知道你在想 TA' }
];
