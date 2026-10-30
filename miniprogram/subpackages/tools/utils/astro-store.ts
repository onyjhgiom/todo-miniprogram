// utils/astro-store.ts
// 星语星球通用本地存储封装：按 namespace 隔离多业务数据 + 提供标准 CRUD
// 全部仅本地（wx.setStorage），关闭小程序数据保留；不上传服务端
import { uid } from '../../../utils/storage';

/**
 * 记录基类。
 * - createdAt / updatedAt 由 addRecord 自动生成，故入参侧为可选；
 * - 这里刻意不写 `[k: string]: unknown` 索引签名：业务接口（Hole / WishItem / NoteItem…）
 *   没有索引签名，加上约束会导致它们全部不满足 T extends AstroRecord 而报类型错。
 */
export interface AstroRecord {
  id: string;
  createdAt?: number;      // Date.now()，入库时自动补
  updatedAt?: number;
}

const PREFIX = 'astro_';

/** 读取整个列表 */
export function listAll<T extends AstroRecord>(namespace: string): T[] {
  try {
    const v = wx.getStorageSync(PREFIX + namespace);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch (_e) {
    return [];
  }
}

function writeAll<T extends AstroRecord>(namespace: string, list: T[]): void {
  try {
    wx.setStorageSync(PREFIX + namespace, list);
  } catch (_e) {
    /* 忽略 */
  }
}

export function addRecord<T extends AstroRecord>(namespace: string, data: T): T {
  const list = listAll<T>(namespace);
  const now = Date.now();
  const rec: T = { id: data.id || uid('astro_'), createdAt: now, updatedAt: now, ...data } as T;
  list.unshift(rec);
  writeAll(namespace, list);
  return rec;
}

export function updateRecord<T extends AstroRecord>(namespace: string, id: string, patch: Partial<T>): T | null {
  const list = listAll<T>(namespace);
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const merged = { ...list[idx], ...patch, id, updatedAt: Date.now() } as T;
  list[idx] = merged;
  writeAll(namespace, list);
  return merged;
}

export function deleteRecord<T extends AstroRecord>(namespace: string, id: string): boolean {
  const list = listAll<T>(namespace);
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  writeAll(namespace, list);
  return true;
}

export function getRecord<T extends AstroRecord>(namespace: string, id: string): T | null {
  const list = listAll<T>(namespace);
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

export function clearNamespace(namespace: string): void {
  try {
    wx.removeStorageSync(PREFIX + namespace);
  } catch (_e) {
    /* 忽略 */
  }
}

/* 各模块命名空间（便于维护与切换） */
export const NS = {
  zodiac: 'zodiac',           // 本命星座（单个对象，存 {signKey, setAt}）
  dashboard: 'dashboard',     // 首页仪表盘附加态（{date, bump}：能量加成，跨天清零）
  horoHis: 'horoscope_history', // 星座浏览历史
  tarotHis: 'tarot_history',
  lenorHis: 'lenormand_history',
  calNotes: 'star_notes',
  calBookmarks: 'star_bookmarks',
  sisterChat: 'sister_chat',
  meditationLog: 'meditation_log',
  wish: 'wish_list',
  treehole: 'treehole_list'
} as const;

export function readJson<T>(key: string, fallback: T): T {
  try {
    const v = wx.getStorageSync(key);
    return v == null ? fallback : (v as T);
  } catch (_e) {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T): void {
  try {
    wx.setStorageSync(key, value);
  } catch (_e) {
    /* 忽略 */
  }
}