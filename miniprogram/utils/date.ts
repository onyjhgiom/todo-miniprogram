// utils/date.ts
// 日期 / 倒计时 / 排序工具（无外部依赖）
import type { CountdownInfo, CountdownKey, ITodo, ISubtask, IReminder, IRecurrence } from '../types/index';

const DAY_MS = 86400000;

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
export function formatYMD(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function formatHM(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
export function formatMD(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}-${day}`;
}
export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const past = diff < 0;
  if (abs < 60000) return past ? '刚刚' : '即将';
  if (abs < 3600000) return `${Math.round(abs / 60000)} 分钟${past ? '前' : '后'}`;
  if (abs < 86400000) return `${Math.round(abs / 3600000)} 小时${past ? '前' : '后'}`;
  if (abs < 7 * DAY_MS) return `${Math.round(abs / DAY_MS)} 天${past ? '前' : '后'}`;
  return formatYMD(ts);
}

/** 计算距 dueDate 的倒计时（按"日"粒度） */
export function computeCountdown(dueDate: number | null | undefined, now: number = Date.now()): CountdownInfo {
  if (!dueDate || !Number.isFinite(dueDate)) {
    return { key: 'none', text: '', days: 9999 };
  }
  const startToday = startOfDay(now);
  const startDue = startOfDay(dueDate);
  const days = Math.round((startDue - startToday) / DAY_MS);
  if (days < 0) return { key: 'overdue', text: `已逾期 ${Math.abs(days)} 天`, days };
  if (days === 0) return { key: 'today', text: '今天截止', days: 0 };
  if (days === 1) return { key: 'tomorrow', text: '明天截止', days: 1 };
  if (days <= 7) return { key: 'week', text: `${days} 天后`, days };
  return { key: 'later', text: `${formatMD(dueDate)} 截止`, days };
}

/** 给定月份生成日历数据（含跨月补齐） */
export function buildCalendar(year: number, month: number): Array<{
  date: number; ymd: string; inMonth: boolean; isToday: boolean; weekday: number;
}> {
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay(); // 0=周日
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  const todayYMD = formatYMD(Date.now());
  const cells: Array<{ date: number; ymd: string; inMonth: boolean; isToday: boolean; weekday: number }> = [];

  // 上月补齐
  for (let i = startWeekday - 1; i >= 0; i--) {
    const date = prevMonthDays - i;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMon = month === 1 ? 12 : month - 1;
    const ymd = `${prevYear}-${String(prevMon).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    cells.push({ date, ymd, inMonth: false, isToday: ymd === todayYMD, weekday: (startWeekday - i - 1 + 7) % 7 });
  }
  // 当月
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ date: d, ymd, inMonth: true, isToday: ymd === todayYMD, weekday: new Date(ymd).getDay() });
  }
  // 下月补齐到 42 格
  while (cells.length < 42) {
    const idx = cells.length - daysInMonth - startWeekday + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMon = month === 12 ? 1 : month + 1;
    const date = idx;
    const ymd = `${nextYear}-${String(nextMon).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    cells.push({ date, ymd, inMonth: false, isToday: ymd === todayYMD, weekday: (cells.length) % 7 });
  }
  return cells;
}

/** 排序：未完成 > 优先级 > 截止 > 创建时间 */
export function compareTodos(a: ITodo, b: ITodo): number {
  // 归档置底
  if ((a.archived ? 1 : 0) !== (b.archived ? 1 : 0)) return (a.archived ? 1 : 0) - (b.archived ? 1 : 0);
  // 完成置底
  if ((a.completed ? 1 : 0) !== (b.completed ? 1 : 0)) return (a.completed ? 1 : 0) - (b.completed ? 1 : 0);
  // 优先级
  const pa = priorityWeight(a.priority);
  const pb = priorityWeight(b.priority);
  if (pa !== pb) return pb - pa; // 高优先级在前
  // 截止
  const ad = a.dueDate || Infinity;
  const bd = b.dueDate || Infinity;
  if (ad !== bd) return ad - bd;
  // 创建时间
  return (b.createTime || 0) - (a.createTime || 0);
}
function priorityWeight(p: ITodo['priority']): number {
  if (p === 'high') return 3;
  if (p === 'medium') return 2;
  if (p === 'low') return 1;
  return 0;
}

/** 计算连续打卡天数（基于 completedTime） */
export function computeStreak(todos: ITodo[], now: number = Date.now()): number {
  const completedDays = new Set<string>();
  for (const t of todos) {
    if (t.completedTime) completedDays.add(formatYMD(t.completedTime));
  }
  let streak = 0;
  let cursor = startOfDay(now);
  // 若今天没打卡，从昨天算起
  if (!completedDays.has(formatYMD(cursor))) {
    cursor -= DAY_MS;
  }
  while (completedDays.has(formatYMD(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

/** 今日完成 / 本周完成 */
export function computeCompletionStats(todos: ITodo[], now: number = Date.now()): {
  today: number; thisWeek: number; total: number;
} {
  const todayYMD = formatYMD(now);
  const weekStart = startOfDay(now) - new Date(now).getDay() * DAY_MS;
  let today = 0;
  let thisWeek = 0;
  let total = 0;
  for (const t of todos) {
    if (!t.completedTime) continue;
    total += 1;
    const ymd = formatYMD(t.completedTime);
    if (ymd === todayYMD) today += 1;
    if (t.completedTime >= weekStart) thisWeek += 1;
  }
  return { today, thisWeek, total };
}

/** 解析提醒项文案 */
export function describeReminder(r: IReminder): string {
  const date = new Date(r.at);
  return `${formatMD(r.at)} ${formatHM(r.at)}${r.sent ? ' · 已发送' : ''}`;
}

/** 重复规则文案 */
export function describeRecurrence(r: IRecurrence | null | undefined): string {
  if (!r || r.type === 'none') return '不重复';
  if (r.type === 'daily') return '每天';
  if (r.type === 'weekly') {
    const ws = (r.weekdays || []).map((w) => '周' + '日一二三四五六'[w]).join('、');
    return ws ? `每周 ${ws}` : '每周';
  }
  if (r.type === 'monthly') return '每月';
  if (r.type === 'custom') return `每 ${r.interval || 1} 天`;
  return '不重复';
}

/** 子任务排序（order asc, then createTime asc） */
export function compareSubtasks(a: ISubtask, b: ISubtask): number {
  if ((a.order || 0) !== (b.order || 0)) return (a.order || 0) - (b.order || 0);
  return (a.createTime || 0) - (b.createTime || 0);
}