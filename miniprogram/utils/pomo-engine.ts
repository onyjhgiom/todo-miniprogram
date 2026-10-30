// utils/pomo-engine.ts
// 番茄时钟核心状态机：
//   idle → focus（开始计时）→ focus running → 完成 → short/long rest
//   任何阶段可 pause / resume / abandon
//   累计 focusCount 达到 longEvery 时切换 long 休息
//
// 引擎输出「视图快照」Snapshot，由 Page 用 setData 渲染；
// 引擎自身不依赖任何 Page/Component，便于在 Web 环境跑单测。

import type {
  IPomoSettings,
  PomoMode,
  PomoDirection,
  IPomoLog
} from '../types/index';
import { DEFAULT_POMO_SETTINGS } from './pomo-storage';

export type EngineState =
  | 'idle' // 未开始
  | 'running' // 计时中
  | 'paused' // 暂停
  | 'finished'; // 本轮已结束（动画/弹窗阶段）

export interface Snapshot {
  state: EngineState;
  mode: PomoMode;
  /** 设计时长（秒） */
  plannedSec: number;
  /** 实际已累计秒数（>=0） */
  elapsedSec: number;
  /** 剩余秒数（倒计时模式有效；正计时模式为 0） */
  remainingSec: number;
  /** 当前进度 0-100 */
  pct: number;
  /** 当前模式下格式化时间字符串 */
  text: string;
  /** 累计专注轮数（用于长休触发） */
  focusCount: number;
  /** 关联 todoId */
  todoId: string | null;
  todoTitle: string | null;
  /** 起始时间戳 */
  startAt: number;
  /** 本轮实际开始时间戳（去重暂停） */
  sessionStartAt: number;
}

export interface EngineSnapshotInput {
  mode: PomoMode;
  state: EngineState;
  plannedSec: number;
  elapsedSec: number;
  focusCount: number;
  todoId: string | null;
  todoTitle: string | null;
  startAt: number;
}

export interface CompleteInput {
  plannedSec: number;
  actualSec: number;
  mode: PomoMode;
  startAt: number;
  endAt: number;
  todoId: string | null;
  todoTitle: string | null;
  status: 'completed' | 'abandoned' | 'aborted';
}

export interface EngineConfig {
  settings: IPomoSettings;
  now: number;
}

/* ============ 格式化 ============ */

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** mm:ss 或 hh:mm:ss（>=1 小时自动加小时段） */
export function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(ss)}`;
  return `${pad(m)}:${pad(ss)}`;
}

/* ============ 视图快照 ============ */

/**
 * 根据 elapsed + 配置返回渲染快照。
 * Page 每秒 tick 调用一次，无需引擎内部维护定时器。
 */
export function buildSnapshot(input: EngineSnapshotInput, cfg: EngineConfig): Snapshot {
  const { mode, state, plannedSec, elapsedSec, focusCount, todoId, todoTitle, startAt } = input;
  const { settings, now } = cfg;
  const direction: PomoDirection = settings.direction;
  const remainingSec = Math.max(0, plannedSec - elapsedSec);
  let pct = 0;
  if (plannedSec > 0) {
    pct = direction === 'down'
      ? Math.min(100, Math.round((elapsedSec / plannedSec) * 100))
      : 100; // 正计时：满格填充，每秒靠 pomo-fab 局部刷新数字
  }
  const text = direction === 'down' ? formatSec(remainingSec) : formatSec(elapsedSec);
  return {
    state,
    mode,
    plannedSec,
    elapsedSec,
    remainingSec,
    pct,
    text,
    focusCount,
    todoId,
    todoTitle,
    startAt,
    sessionStartAt: startAt
  };
}

/* ============ 完成事件 ============ */

/** 创建一个 IPomoLog（实际存储层负责云同步） */
export function buildLog(input: CompleteInput, dateKeyFn: (ts: number) => string): IPomoLog {
  const sid = `pomo_${input.startAt}_${input.mode}`;
  return {
    _id: sid,
    mode: input.mode,
    plannedSec: input.plannedSec,
    actualSec: input.actualSec,
    status: input.status,
    startAt: input.startAt,
    endAt: input.endAt,
    todoId: input.todoId,
    todoTitle: input.todoTitle,
    dateKey: dateKeyFn(input.startAt)
  };
}

/* ============ 模式推荐 ============ */

/**
 * 给定当前 mode 与 focusCount，返回下一轮推荐 mode。
 * - 完成 focus：focusCount++, 若达到 longEvery 进入 long；否则 short
 * - 完成 short/long：进入 focus
 */
export function nextMode(current: PomoMode, focusCount: number, settings: IPomoSettings): PomoMode {
  if (current === 'focus') {
    const newCount = focusCount + 1;
    return newCount % settings.longEvery === 0 ? 'long' : 'short';
  }
  return 'focus';
}

/** 给定 mode 返回秒数 */
export function modeSec(mode: PomoMode, settings: IPomoSettings = DEFAULT_POMO_SETTINGS): number {
  if (mode === 'focus') return settings.focusSec;
  if (mode === 'short') return settings.shortSec;
  return settings.longSec;
}

/**
 * 智能休息：按「本轮专注实际时长 + 今日已完成番茄数」动态调整休息时长。
 *
 * 设计取舍：
 *  - 专注越久越累 → 每满 10 分钟专注，休息 +1 分钟；
 *  - 当日累计番茄越多越累 → 每累计 4 个，休息 +1 分钟；
 *  - 总加成封顶为「基础时长的 100%」（最多翻倍），避免休息喧宾夺主；
 *  - 结果对齐到 30 秒，显示与倒计时都整齐。
 *
 * 只对休息模式生效；关闭智能休息或专注模式时直接返回设置值。
 */
export function adaptiveRestSec(
  mode: PomoMode,
  settings: IPomoSettings,
  focusActualSec: number,
  todayFocusCount: number
): number {
  const base = modeSec(mode, settings);
  if (!settings.adaptive || mode === 'focus') return base;

  const focusBonus = Math.floor(Math.max(0, focusActualSec) / 600) * 60; // 每 10 分钟 +1min
  const fatigueBonus = Math.floor(Math.max(0, todayFocusCount) / 4) * 60; // 每 4 个番茄 +1min
  const bonus = Math.min(focusBonus + fatigueBonus, base); // 封顶：不超过基础时长
  const total = base + bonus;
  return Math.round(total / 30) * 30; // 对齐 30 秒
}

/** mode 显示标签 */
export function modeLabel(mode: PomoMode): string {
  if (mode === 'focus') return '专注';
  if (mode === 'short') return '短休息';
  return '长休息';
}

/** 模式主色 CSS 变量 key（用于环形进度色渐变） */
export function modeGradientVar(mode: PomoMode, customPrimary?: string): {
  from: string;
  to: string;
} {
  if (mode === 'focus') return { from: 'var(--color-primary)', to: customPrimary || '#f43f5e' };
  if (mode === 'short') return { from: '#10b981', to: '#34d399' };
  return { from: '#3b82f6', to: '#06b6d4' };
}

/* ============ 暂停辅助 ============ */

export interface PauseState {
  pausedAt: number;
  pausedSec: number;
}

/** 进入暂停（pausedSec 以「秒」为单位） */
export function pause(_sessionStartAt: number, pausedSec: number, now: number): PauseState {
  return { pausedAt: now, pausedSec };
}

/**
 * 离开暂停，返回累计暂停秒数（含本次暂停时长）
 *  用于修正 elapsed = (now - startAt)/1000 - pausedSec
 */
export function resume(p: PauseState, now: number): number {
  if (!p.pausedAt) return p.pausedSec;
  const extra = Math.max(0, Math.floor((now - p.pausedAt) / 1000));
  return p.pausedSec + extra;
}
