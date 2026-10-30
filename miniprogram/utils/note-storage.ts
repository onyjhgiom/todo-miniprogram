// utils/note-storage.ts
// 便签数据层：本地持久化（渲染源） + 尽力而为的云端镜像
//  - 本地 storage key='notes'（前缀 todo_app_）作为渲染源，保证离线/弱网可用
//  - 每次增删改同步 fire-and-forget 到云函数 notes；openShow 时把云端合并回本地
//  - 云函数未部署/不可用时 callFn 自动降级 mock，行为不变

import { callFn } from './cloud';
import { get, set } from './storage';
import type { CloudResult, INote, NotePatternKey, NoteFigureKey, NoteCategoryKey } from '../types/index';

const NOTES_KEY = 'notes';
const DEFAULTS_KEY = 'note_defaults';

/** 新便签默认外观（可在外观设置面板自定义并持久化） */
export interface INoteDefaults {
  colorKey: string;
  patternKey: NotePatternKey;
  figureKey: NoteFigureKey;
  /** 默认分类 */
  category: NoteCategoryKey;
}

export const DEFAULT_NOTE_STYLE: INoteDefaults = {
  colorKey: 'lemon',
  patternKey: 'solid',
  figureKey: 'none',
  category: 'life'
};

export function loadNoteDefaults(): INoteDefaults {
  return get<INoteDefaults>(DEFAULTS_KEY, { ...DEFAULT_NOTE_STYLE });
}

export function saveNoteDefaults(d: INoteDefaults): void {
  set(DEFAULTS_KEY, { ...DEFAULT_NOTE_STYLE, ...d });
}

/** 排序：置顶优先，再按更新时间倒序 */
export function sortNotes(notes: INote[]): INote[] {
  return notes.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updateTime || 0) - (a.updateTime || 0);
  });
}

/** 本地读取当前全部便签 */
export function loadNotes(): INote[] {
  return get<INote[]>(NOTES_KEY, []);
}

/** 本地持久化全部便签（调用方须保证已排序） */
export function saveNotes(notes: INote[]): void {
  set(NOTES_KEY, notes);
}

/** 生成便签 id */
export function newNoteId(): string {
  return 'note_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** 新增/更新一条便签（本地立即生效 + 云镜像） */
export function upsertNote(note: INote): void {
  const notes = loadNotes();
  const idx = notes.findIndex((n) => n._id === note._id);
  if (idx >= 0) notes[idx] = note;
  else notes.push(note);
  saveNotes(sortNotes(notes));
  syncToCloudSilently({ action: 'upsert', note });
}

/** 删除一条便签 */
export function removeNote(id: string): void {
  const notes = loadNotes().filter((n) => n._id !== id);
  saveNotes(sortNotes(notes));
  syncToCloudSilently({ action: 'remove', _id: id });
}

/** 清空所有便签 */
export function clearNotes(): void {
  saveNotes([]);
  syncToCloudSilently({ action: 'clear' });
}

/** 云端合并：把云端便签并回本地（云端 updateTime 更新者胜出） */
export function mergeFromCloud(cloud: INote[]): void {
  if (!Array.isArray(cloud)) return;
  const local = loadNotes();
  const map = new Map<string, INote>();
  for (const n of local) map.set(n._id, n);
  for (const n of cloud) {
    const exist = map.get(n._id);
    if (!exist || (n.updateTime || 0) > (exist.updateTime || 0)) map.set(n._id, n);
  }
  saveNotes(sortNotes([...map.values()]));
}

/** 打开页面时拉取云端便签并合并（尽力而为，失败静默保留本地） */
export async function loadFromCloud(): Promise<void> {
  try {
    const res = await callFn<CloudResult & { items?: INote[] }>('notes', { action: 'list' });
    if (res && Array.isArray(res.items)) mergeFromCloud(res.items);
  } catch (_e) {
    /* 静默：保持本地 */
  }
}

/** 尽力而为地同步到云端（不阻塞、不弹错） */
function syncToCloudSilently(payload: Record<string, unknown>): void {
  callFn('notes', payload).catch(() => {
    /* 云端失败可忽略，本地已保存 */
  });
}
