// utils/pomo-stats.ts
// 番茄日志聚合：
//   - 日/周/月完成数与专注分钟数
//   - 连续打卡天数（streak）
//   - 12 周热力图（按周索引 [weekIdx][weekday]）
//   - 24 小时效率直方图 + 最近 N 天时间轴 + 最佳/高效时段
//   - 单任务累计专注分钟

import type {
  IPomoLog,
  IPomoStats,
  IDailyPoint,
  IBestWindow
} from '../types/index';

const DAY_MS = 86400000;

/**
 * 是否「有效专注完成」日志：
 * - 仅 mode==='focus' 的完成记录纳入统计
 * - 短/长休息仅用于状态机推进，不计入打卡/热力/专注时长
 */
function isFocusCompleted(log: IPomoLog): boolean {
  return log.status === 'completed' && log.mode === 'focus';
}

/** 日聚合（仅 focus 完成） */
function aggregateByDay(logs: IPomoLog[], dayKey: string): { count: number; minutes: number } {
  let count = 0;
  let minutes = 0;
  for (const l of logs) {
    if (!isFocusCompleted(l)) continue;
    if (l.dateKey !== dayKey) continue;
    count += 1;
    minutes += Math.round(l.actualSec / 60);
  }
  return { count, minutes };
}

/** 范围聚合（仅 focus 完成） */
function aggregateByRange(
  logs: IPomoLog[],
  fromTs: number,
  toTs: number
): { count: number; minutes: number } {
  let count = 0;
  let minutes = 0;
  for (const l of logs) {
    if (!isFocusCompleted(l)) continue;
    if (l.startAt < fromTs || l.startAt > toTs) continue;
    count += 1;
    minutes += Math.round(l.actualSec / 60);
  }
  return { count, minutes };
}

/** 连续专注打卡天数（连续 N 天每天至少有 1 次 focus 完成） */
export function calcStreak(logs: IPomoLog[], now: Date = new Date()): number {
  const days = new Set<string>();
  for (const l of logs) {
    if (isFocusCompleted(l)) days.add(l.dateKey);
  }
  let streak = 0;
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // 若今天未打卡但昨天打卡了，streak 从昨天算起（更友好）
  if (!days.has(keyOf(cur))) {
    cur.setDate(cur.getDate() - 1);
    if (!days.has(keyOf(cur))) return 0;
  }
  while (days.has(keyOf(cur))) {
    streak += 1;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

function keyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 12 周热力图：以周日为列 0；按周倒序排列，最近一周在最后一行 */
export function buildHeatmap(logs: IPomoLog[], now: Date = new Date()): number[][] {
  const map: Record<string, number> = {};
  for (const l of logs) {
    if (!isFocusCompleted(l)) continue;
    map[l.dateKey] = (map[l.dateKey] || 0) + 1;
  }
  const weeks: number[][] = [];
  // 找到本周周日（getDay()==0 表示周日）
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay(); // 0=Sun
  const thisSunday = new Date(today.getTime() - dow * DAY_MS);
  for (let w = 11; w >= 0; w--) {
    const week: number[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(thisSunday.getTime() - w * 7 * DAY_MS + d * DAY_MS);
      const k = keyOf(date);
      week.push(map[k] || 0);
    }
    weeks.push(week);
  }
  return weeks;
}

/** 主聚合入口 */
export function computeStats(
  logs: IPomoLog[],
  now: Date = new Date(),
  options: { timelineDays?: number } = {}
): IPomoStats {
  const todayKey = keyOf(now);
  const today = aggregateByDay(logs, todayKey);
  // 本周：以周日为起点
  const dow = now.getDay();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const week = aggregateByRange(logs, weekStart.getTime(), now.getTime() + DAY_MS);
  // 本月
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = aggregateByRange(logs, monthStart.getTime(), now.getTime() + DAY_MS);
  // 总计（仅 focus 完成）
  let totalCount = 0;
  let totalMinutes = 0;
  for (const l of logs) {
    if (!isFocusCompleted(l)) continue;
    totalCount += 1;
    totalMinutes += Math.round(l.actualSec / 60);
  }
  // 24 小时直方图 + 最近 N 天时间轴 + 最佳时段
  const hourHistogram = buildHourHistogram(logs);
  const hourPeak = Math.max(1, ...hourHistogram);
  const timelineDays = options.timelineDays ?? 14;
  const timeline = buildDailyTimeline(logs, timelineDays, now);
  const bestWindow = findBestWindow(hourHistogram);
  const efficientWindows = findEfficientWindows(hourHistogram, 3);
  return {
    todayCount: today.count,
    todayMinutes: today.minutes,
    weekCount: week.count,
    weekMinutes: week.minutes,
    monthCount: month.count,
    monthMinutes: month.minutes,
    totalCount,
    totalMinutes,
    streak: calcStreak(logs, now),
    heatmap: buildHeatmap(logs, now),
    hourHistogram,
    hourPeak,
    timeline,
    bestWindow,
    efficientWindows
  };
}

/** 单任务累计专注分钟（仅 focus 完成） */
export function aggregateByTodo(logs: IPomoLog[], todoId: string): {
  count: number;
  minutes: number;
} {
  let count = 0;
  let minutes = 0;
  for (const l of logs) {
    if (!isFocusCompleted(l)) continue;
    if (l.todoId !== todoId) continue;
    count += 1;
    minutes += Math.round(l.actualSec / 60);
  }
  return { count, minutes };
}

/** 格式化热力图强度（0-4 级） */
export function heatLevel(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}

/* ============================================================
 * 24 小时效率曲线 / 时间轴 / 最佳时段
 * ============================================================ */

/**
 * 24 小时效率直方图：index = 小时 (0-23)，value = 该小时累计完成的番茄数
 * 仅 focus 完成日志；时间戳取 startAt（开始时刻）所在小时。
 */
export function buildHourHistogram(logs: IPomoLog[]): number[] {
  const hist = new Array(24).fill(0);
  for (const l of logs) {
    if (!isFocusCompleted(l)) continue;
    const h = new Date(l.startAt).getHours();
    if (h >= 0 && h < 24) hist[h] += 1;
  }
  return hist;
}

/**
 * 最近 N 天时间轴（按日期升序，最右为今天）：
 * [{dateKey, count, minutes, weekday, isToday}]
 */
export function buildDailyTimeline(
  logs: IPomoLog[],
  days: number,
  now: Date = new Date()
): IDailyPoint[] {
  const map: Record<string, { count: number; minutes: number }> = {};
  for (const l of logs) {
    if (!isFocusCompleted(l)) continue;
    if (!map[l.dateKey]) map[l.dateKey] = { count: 0, minutes: 0 };
    map[l.dateKey].count += 1;
    map[l.dateKey].minutes += Math.round(l.actualSec / 60);
  }
  const todayKey = keyOf(now);
  const out: IDailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = keyOf(t);
    const m = map[k] || { count: 0, minutes: 0 };
    out.push({
      dateKey: k,
      count: m.count,
      minutes: m.minutes,
      weekday: t.getDay(),
      isToday: k === todayKey
    });
  }
  return out;
}

/**
 * 在 24 小时直方图中找出「最佳时段」：从所有 2-3 小时连续窗口里挑累计完成数最大的那个。
 * 要求至少 1 次 focus 完成才返回，否则 null。
 */
export function findBestWindow(hist: number[]): IBestWindow | null {
  const candidates = scanWindows(hist, [2, 3]);
  if (candidates.length === 0) return null;
  const best = candidates.reduce((b, c) => (c.count > b.count ? c : b));
  return best.count > 0 ? best : null;
}

/**
 * 高效时段候选：找出所有累计完成数 >= 峰值的 60% 的窗口（去重/合并）。
 */
export function findEfficientWindows(
  hist: number[],
  topK: number = 3
): IBestWindow[] {
  const all = scanWindows(hist, [2, 3]);
  if (all.length === 0) return [];
  const max = Math.max(...all.map((w) => w.count));
  if (max <= 0) return [];
  const filtered = all.filter((w) => w.count >= Math.max(1, Math.ceil(max * 0.6)));
  // 按 count 降序，去重（同起点/终点去重），最多 topK 个
  const seen = new Set<string>();
  const out: IBestWindow[] = [];
  for (const w of filtered) {
    const k = `${w.startHour}-${w.endHour}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= topK) break;
  }
  return out;
}

/** 扫描所有 [wlen] 小时长的连续窗口 */
function scanWindows(hist: number[], lengths: number[]): IBestWindow[] {
  const out: IBestWindow[] = [];
  for (const wlen of lengths) {
    for (let s = 0; s + wlen <= 24; s++) {
      let count = 0;
      let minutes = 0;
      for (let i = s; i < s + wlen; i++) count += hist[i];
      // 分钟数估算 = count * 平均时长 25min（仅展示用）
      minutes = count * 25;
      out.push({
        startHour: s,
        endHour: s + wlen,
        count,
        minutes,
        label: `${pad(s)}:00 - ${pad(s + wlen)}:00`
      });
    }
  }
  return out;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 计算目标完成度（0-1），用于 UI 进度条 */
export function goalProgress(done: number, target: number): number {
  if (target <= 0) return 0;
  const p = done / target;
  return p > 1 ? 1 : p < 0 ? 0 : p;
}
