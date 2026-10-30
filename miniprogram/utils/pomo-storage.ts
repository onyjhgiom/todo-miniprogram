// utils/pomo-storage.ts
// 番茄设置 / 当前会话 / 日志缓存 / 目标的本地存储层
// - 设置：用户偏好（持久）
// - 会话：当前正在跑的番茄（用于切后台后恢复 + 云端补同步）
// - 日志：本地最近 N 条缓存，弱网环境下渲染统计使用
// - 目标：今日/本周番茄目标（持久）

import type { IPomoSettings, IPomoLog, IPomoGoals, PomoMode } from '../types/index';

const SETTINGS_KEY = 'pomo_settings';
const SESSION_KEY = 'pomo_session';
const LOG_KEY = 'pomo_logs_cache';
const GOALS_KEY = 'pomo_goals';
const MAX_LOG_CACHE = 1000;

export const DEFAULT_POMO_GOALS: IPomoGoals = {
  dailyTarget: 4,
  weeklyTarget: 20
};

export const DEFAULT_POMO_SETTINGS: IPomoSettings = {
  focusSec: 25 * 60,
  shortSec: 5 * 60,
  longSec: 15 * 60,
  longEvery: 4,
  direction: 'down',
  autoCycle: true,
  autoBreak: false,
  adaptive: false,
  vibrate: true,
  sound: true,
  subscribe: false,
  ambient: 'off',
  ambientVolume: 0.4,
  finishTone: 'chime',
  toneVolume: 0.7,
  zen: false
};

/** 读取设置 */
export function loadSettings(): IPomoSettings {
  try {
    const raw = wx.getStorageSync(SETTINGS_KEY);
    if (raw && typeof raw === 'object') {
      return { ...DEFAULT_POMO_SETTINGS, ...(raw as Partial<IPomoSettings>) };
    }
  } catch (_e) {
    /* 忽略 */
  }
  return { ...DEFAULT_POMO_SETTINGS };
}

/** 保存设置 */
export function saveSettings(s: IPomoSettings): void {
  try {
    wx.setStorageSync(SETTINGS_KEY, s);
  } catch (_e) {
    /* 忽略 */
  }
}

/** 当前会话状态（切后台后用于恢复计时） */
export interface PomoSession {
  /** session id，用于云端 idempotent upsert */
  sid: string;
  mode: PomoMode;
  /** 设计时长（秒） */
  plannedSec: number;
  /** 设计起始时间戳 = startAt + 累计暂停秒数 */
  startAt: number;
  /** 已经过的累计暂停秒数 */
  pausedSec: number;
  /** 上次暂停的时刻（0 = 当前不在暂停） */
  pausedAt: number;
  /** 关联 todoId */
  todoId: string | null;
  /** 关联 todo 标题（冗余） */
  todoTitle: string | null;
  /** 当前已完成专注轮数（用于 N 轮触发长休息） */
  focusCount: number;
}

export function loadSession(): PomoSession | null {
  try {
    const raw = wx.getStorageSync(SESSION_KEY);
    if (raw && typeof raw === 'object') {
      return raw as PomoSession;
    }
  } catch (_e) {
    /* 忽略 */
  }
  return null;
}

export function saveSession(s: PomoSession | null): void {
  try {
    if (s) wx.setStorageSync(SESSION_KEY, s);
    else wx.removeStorageSync(SESSION_KEY);
  } catch (_e) {
    /* 忽略 */
  }
}

export function clearSession(): void {
  saveSession(null);
}

/* ============ 日志缓存 ============ */

/** 读取全部本地日志 */
export function loadLocalLogs(): IPomoLog[] {
  try {
    const raw = wx.getStorageSync(LOG_KEY);
    if (Array.isArray(raw)) return raw as IPomoLog[];
  } catch (_e) {
    /* 忽略 */
  }
  return [];
}

/** 追加一条日志到本地缓存 */
export function appendLocalLog(log: IPomoLog): void {
  const list = loadLocalLogs();
  list.unshift(log);
  // 截断到上限
  if (list.length > MAX_LOG_CACHE) list.length = MAX_LOG_CACHE;
  try {
    wx.setStorageSync(LOG_KEY, list);
  } catch (_e) {
    /* 忽略 */
  }
}

/** 用云端日志替换本地（保留最近 MAX_LOG_CACHE） */
export function replaceLocalLogs(logs: IPomoLog[]): void {
  const sorted = logs.slice().sort((a, b) => b.startAt - a.startAt);
  const trimmed = sorted.slice(0, MAX_LOG_CACHE);
  try {
    wx.setStorageSync(LOG_KEY, trimmed);
  } catch (_e) {
    /* 忽略 */
  }
}

/** 清除全部本地日志 */
export function clearLocalLogs(): void {
  try {
    wx.removeStorageSync(LOG_KEY);
  } catch (_e) {
    /* 忽略 */
  }
}

/* ============ 日期工具 ============ */

/** 返回 yyyy-mm-dd（按本机时区） */
export function dateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ============ 目标 ============ */

/** 读取番茄目标 */
export function loadGoals(): IPomoGoals {
  try {
    const raw = wx.getStorageSync(GOALS_KEY);
    if (raw && typeof raw === 'object') {
      return { ...DEFAULT_POMO_GOALS, ...(raw as Partial<IPomoGoals>) };
    }
  } catch (_e) {
    /* 忽略 */
  }
  return { ...DEFAULT_POMO_GOALS };
}

/** 保存番茄目标 */
export function saveGoals(g: IPomoGoals): void {
  try {
    wx.setStorageSync(GOALS_KEY, g);
  } catch (_e) {
    /* 忽略 */
  }
}
