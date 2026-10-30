// utils/memo-store.ts
// 语音备忘录数据层：本地优先 + 云端尽力同步
// 覆盖：无限层级文件夹 / 备忘 CRUD / 清单模式 / 语音片段 / 标签搜索 / 加密解锁 / 版本回溯 / 归档 / 云端合并
import { get, set } from './storage';
import { callFn } from './cloud';
import type { IMemo, IMemoFolder, IMemoVersion, IAudioClip } from '../types/index';

const MEMO_KEY = 'memo_list';
const FOLDER_KEY = 'memo_folders';

export const MEMO_COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

export const DEFAULT_FOLDERS: IMemoFolder[] = [
  { id: 'fd_life', name: '生活', parentId: '', color: '#10b981', order: 0, createTime: 0 },
  { id: 'fd_work', name: '工作', parentId: '', color: '#3b82f6', order: 1, createTime: 0 },
  { id: 'fd_idea', name: '灵感', parentId: '', color: '#f59e0b', order: 2, createTime: 0 }
];

export const MAX_VERSIONS = 20;

/* ==================== 读写 ==================== */

export function loadMemos(): IMemo[] {
  const list = get<IMemo[]>(MEMO_KEY, []);
  return Array.isArray(list) ? list : [];
}
export function saveMemos(list: IMemo[]): void {
  set(MEMO_KEY, list);
}

export function loadFolders(): IMemoFolder[] {
  const list = get<IMemoFolder[]>(FOLDER_KEY, []);
  return Array.isArray(list) && list.length ? list : DEFAULT_FOLDERS;
}
export function saveFolders(list: IMemoFolder[]): void {
  set(FOLDER_KEY, list);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ==================== 简易哈希（备忘锁密码，非安全场景） ==================== */

export function hashLock(pwd: string): string {
  let h = 5381;
  for (let i = 0; i < pwd.length; i++) {
    h = ((h << 5) + h + pwd.charCodeAt(i)) >>> 0;
  }
  return 'h' + h.toString(36);
}

/* ==================== 文件夹：无限层级 ==================== */

/** 文件夹链（从根到该文件夹），带防环保护 */
export function folderChain(folders: IMemoFolder[], id: string): IMemoFolder[] {
  const chain: IMemoFolder[] = [];
  const seen = new Set<string>();
  let cur = folders.find((f) => f.id === id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
  }
  return chain;
}

/** 完整路径名（含「/」分隔），根目录返回「全部」 */
export function folderPathText(folders: IMemoFolder[], id: string): string {
  if (!id) return '全部';
  return folderChain(folders, id).map((f) => f.name).join(' / ');
}

/** 某文件夹的全部后代 id（含自身），用于树形浏览 / 删除校验 */
export function folderSubtreeIds(folders: IMemoFolder[], id: string): string[] {
  const ids: string[] = [id];
  const walk = (pid: string) => {
    folders.filter((f) => f.parentId === pid).forEach((c) => {
      ids.push(c.id);
      walk(c.id);
    });
  };
  walk(id);
  return ids;
}

/** 移动文件夹：目标是自身后代则拒绝（防环） */
export function canMoveFolder(folders: IMemoFolder[], srcId: string, destId: string): boolean {
  if (srcId === destId) return false;
  return !folderSubtreeIds(folders, srcId).includes(destId);
}

export function createFolder(name: string, parentId: string, color?: string): IMemoFolder[] {
  const list = loadFolders();
  const order = list.filter((f) => f.parentId === parentId).length;
  const folder: IMemoFolder = {
    id: newId('fd'),
    name: name.trim() || '新文件夹',
    parentId,
    color: color || MEMO_COLORS[list.length % MEMO_COLORS.length],
    order,
    createTime: Date.now()
  };
  list.push(folder);
  saveFolders(list);
  return list;
}

export function renameFolder(id: string, name: string): IMemoFolder[] {
  const list = loadFolders();
  const f = list.find((x) => x.id === id);
  if (f && name.trim()) f.name = name.trim();
  saveFolders(list);
  return list;
}

export function removeFolder(id: string): { folders: IMemoFolder[]; memos: IMemo[] } {
  const folders = loadFolders();
  const dead = new Set(folderSubtreeIds(folders, id));
  const nextFolders = folders.filter((f) => !dead.has(f.id));
  saveFolders(nextFolders);
  // 该文件夹（含后代）下的备忘移到根目录，不删除内容
  const memos = loadMemos().map((m) => (dead.has(m.folderId) ? { ...m, folderId: '' } : m));
  saveMemos(memos);
  return { folders: nextFolders, memos };
}

/* ==================== 备忘 CRUD ==================== */

export function createMemo(patch?: Partial<IMemo>): IMemo {
  const now = Date.now();
  return {
    _id: newId('memo'),
    title: '',
    content: '',
    checklist: [],
    isChecklist: false,
    audioList: [],
    imageList: [],
    color: MEMO_COLORS[0],
    folderId: '',
    tags: [],
    isLocked: false,
    isPinned: false,
    isArchived: false,
    versions: [],
    createTime: now,
    updateTime: now,
    version: 1,
    ...patch
  };
}

/** 保存前生成版本快照（标题/正文/清单变化才入版本库，最多保留 MAX_VERSIONS 条） */
function pushVersion(prev: IMemo, next: IMemo): IMemoVersion[] {
  const changed =
    prev.title !== next.title ||
    prev.content !== next.content ||
    JSON.stringify(prev.checklist) !== JSON.stringify(next.checklist);
  if (!changed) return prev.versions || [];
  const snap: IMemoVersion = {
    id: newId('ver'),
    title: prev.title,
    content: prev.content,
    createTime: prev.updateTime || prev.createTime
  };
  return [snap, ...(prev.versions || [])].slice(0, MAX_VERSIONS);
}

export function upsertMemo(memo: IMemo): IMemo[] {
  const list = loadMemos();
  const idx = list.findIndex((m) => m._id === memo._id);
  let next: IMemo;
  if (idx >= 0) {
    const prev = list[idx];
    next = Object.assign({}, memo, {
      versions: pushVersion(prev, memo),
      updateTime: Date.now(),
      version: (memo.version || 1) + 1
    });
    list[idx] = next;
  } else {
    next = Object.assign({}, memo, { updateTime: Date.now() });
    list.unshift(next);
  }
  saveMemos(list);
  syncToCloudSilently({ action: 'upsert', memo: next });
  return list;
}

export function removeMemo(id: string): IMemo[] {
  const list = loadMemos().filter((m) => m._id !== id);
  saveMemos(list);
  syncToCloudSilently({ action: 'remove', _id: id });
  return list;
}

export function archiveMemo(id: string, archived: boolean): IMemo[] {
  const list = loadMemos();
  const m = list.find((x) => x._id === id);
  if (m) {
    m.isArchived = archived;
    m.updateTime = Date.now();
  }
  saveMemos(list);
  if (m) syncToCloudSilently({ action: 'upsert', memo: m });
  return list;
}

/* ==================== 语音片段 ==================== */

export function makeAudioClip(src: string, duration: number, text: string): IAudioClip {
  return {
    id: newId('au'),
    src,
    duration: Math.max(0, Math.round(duration)),
    text,
    status: text ? 'done' : 'pending',
    anchor: 0,
    createTime: Date.now()
  };
}

/** 待转写重试队列：所有 pending 且有 src 的片段 */
export function pendingClips(memos: IMemo[]): { memoId: string; clip: IAudioClip }[] {
  const out: { memoId: string; clip: IAudioClip }[] = [];
  for (const m of memos) {
    for (const c of m.audioList || []) {
      if (c.status === 'pending' && c.src) out.push({ memoId: m._id, clip: c });
    }
  }
  return out;
}

/** 把某条片段标记为已转写 / 失败 */
export function setClipStatus(memoId: string, clipId: string, status: IAudioClip['status'], text?: string): IMemo[] {
  const list = loadMemos();
  const m = list.find((x) => x._id === memoId);
  if (m) {
    const c = (m.audioList || []).find((x) => x.id === clipId);
    if (c) {
      c.status = status;
      if (text !== undefined) c.text = text;
      m.updateTime = Date.now();
    }
    saveMemos(list);
  }
  return list;
}

/* ==================== 搜索 / 排序 ==================== */

export interface MemoFilter {
  keyword?: string;
  folderId?: string;
  showArchived?: boolean;
}

export function filterMemos(memos: IMemo[], filter: MemoFilter): IMemo[] {
  const kw = (filter.keyword || '').trim().toLowerCase();
  return memos.filter((m) => {
    if (filter.showArchived !== undefined) {
      if (filter.showArchived !== !!m.isArchived) return false;
    } else if (m.isArchived) {
      return false;
    }
    if (filter.folderId && m.folderId !== filter.folderId) return false;
    if (kw) {
      const inTitle = (m.title || '').toLowerCase().includes(kw);
      const inContent = (m.content || '').toLowerCase().includes(kw);
      const inTags = (m.tags || []).some((t) => t.toLowerCase().includes(kw));
      const inCheck = (m.checklist || []).some((c) => (c.text || '').toLowerCase().includes(kw));
      const inAudio = (m.audioList || []).some((a) => (a.text || '').toLowerCase().includes(kw));
      if (!inTitle && !inContent && !inTags && !inCheck && !inAudio) return false;
    }
    return true;
  }).sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.updateTime - a.updateTime;
  });
}

/** 列表展示用摘要：清单模式取未完成计数，正文取前 60 字 */
export function memoSummary(m: IMemo): string {
  if (m.isChecklist) {
    const total = (m.checklist || []).length;
    const done = (m.checklist || []).filter((c) => c.done).length;
    return `清单 ${done}/${total}`;
  }
  return (m.content || '').replace(/\s+/g, ' ').slice(0, 60);
}

export function memoStat(memos: IMemo[]): { total: number; locked: number; audio: number; archived: number } {
  let locked = 0;
  let audio = 0;
  let archived = 0;
  for (const m of memos) {
    if (m.isLocked) locked += 1;
    if ((m.audioList || []).length) audio += 1;
    if (m.isArchived) archived += 1;
  }
  return { total: memos.length, locked, audio, archived };
}

/** 全部标签去重统计（按引用次数降序） */
export function allTags(memos: IMemo[]): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const m of memos) {
    for (const t of m.tags || []) {
      if (!t) continue;
      map.set(t, (map.get(t) || 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/* ==================== 云端同步 ==================== */

function syncToCloudSilently(payload: Record<string, unknown>): void {
  callFn('memo', payload).catch(() => {
    /* 云端尽力而为：失败保留本地，下次进入页面重试 */
  });
}

export function loadFromCloud(): Promise<IMemo[]> {
  return callFn<{ success: boolean; items?: IMemo[] }>('memo', { action: 'list' })
    .then((res) => (Array.isArray(res.items) ? res.items : []))
    .catch(() => []);
}

/** 云端合并：updateTime 取新、本地独有保留 */
export function mergeFromCloud(local: IMemo[], remote: IMemo[]): IMemo[] {
  const map = new Map<string, IMemo>();
  for (const m of local) map.set(m._id, m);
  for (const r of remote) {
    const l = map.get(r._id);
    if (!l || (r.updateTime || 0) > (l.updateTime || 0)) map.set(r._id, r);
  }
  const merged = Array.from(map.values());
  saveMemos(merged);
  const dirty = merged.filter((m) => !remote.some((r) => r._id === m._id));
  if (dirty.length) {
    callFn('memo', { action: 'upsertMany', memos: dirty }).catch(() => {});
  }
  return merged;
}

/* ==================== 版本回溯 ==================== */

/** 恢复到指定版本（当前内容先入版本库） */
export function restoreVersion(memoId: string, versionId: string): IMemo[] {
  const list = loadMemos();
  const m = list.find((x) => x._id === memoId);
  if (!m) return list;
  const v = (m.versions || []).find((x) => x.id === versionId);
  if (!v) return list;
  const snap: IMemoVersion = {
    id: newId('ver'),
    title: m.title,
    content: m.content,
    createTime: m.updateTime || Date.now()
  };
  m.versions = [snap, ...(m.versions || [])].filter((x) => x.id !== versionId).slice(0, MAX_VERSIONS);
  m.title = v.title;
  m.content = v.content;
  m.updateTime = Date.now();
  m.version = (m.version || 1) + 1;
  saveMemos(list);
  syncToCloudSilently({ action: 'upsert', memo: m });
  return list;
}
