// utils/datefmt.ts
// 通用日期格式化工具（时间戳 → 中文友好文案），供多人提醒 / 订阅提醒 / 重要日等工具页复用。
export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** yyyy-MM-dd */
export function fmtYmd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** yyyy年M月d日 HH:mm */
export function fmtCn(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** HH:mm */
export function fmtHm(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相对时刻描述：刚刚 / x分钟前 / 今天 HH:mm / 昨天 HH:mm / M月d日 */
export function relTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff >= 0 && diff < 60 * 1000) return '刚刚';
  if (diff >= 0 && diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  const d = new Date(ts);
  const nowD = new Date(now);
  const startToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  if (ts >= startToday) return `今天 ${fmtHm(ts)}`;
  if (ts >= startToday - 86400000) return `昨天 ${fmtHm(ts)}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 天差（取整） */
export function diffDays(a: number, b = Date.now()): number {
  const da = new Date(a);
  const db = new Date(b);
  const sa = new Date(da.getFullYear(), da.getMonth(), da.getDate()).getTime();
  const sb = new Date(db.getFullYear(), db.getMonth(), db.getDate()).getTime();
  return Math.round((sa - sb) / 86400000);
}

/** 今天 00:00 时间戳 */
export function startOfToday(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}
