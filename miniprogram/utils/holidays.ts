// utils/holidays.ts
// 节假日倒计时数据：28 个节日的统一数据模型 + 距今天数计算
//
// 数据按"如何确定公历日期"分三类：
//   - solar    公历固定日（如 1/1 元旦）
//   - lunar    农历节日（用 lunarFestivalDate 反查公历）
//   - dynamic  动态算（父亲节 6 月第 3 个周日、清明 qingmingDay）
//
// 节日类别用于着色分组：法定/传统/纪念/网络/少数民族

import { qingmingDay, lunarFestivalDate, solarToLunar } from './lunar';

export type HolidayKind = 'legal' | 'traditional' | 'memorial' | 'network' | 'ethnic';

export type HolidaySource = 'solar' | 'lunar' | 'dynamic';

export interface HolidayDef {
  id: string;
  name: string;
  kind: HolidayKind;
  source: HolidaySource;
  // solar: 公历固定月/日
  month?: number;
  day?: number;
  // lunar: 农历月/日
  lMonth?: number;
  lDay?: number;
  // dynamic: 动态算子，year -> 公历月日
  resolve?: (year: number) => { month: number; day: number } | null;
}

// ===== 公历固定 =====
const SOLAR_HOLIDAYS: HolidayDef[] = [
  { id: 'new-year',      name: '元旦',                 kind: 'legal',      source: 'solar', month: 1,  day: 1 },
  { id: 'valentine',     name: '情人节',               kind: 'network',    source: 'solar', month: 2,  day: 14 },
  { id: 'feb-7',         name: '二七纪念日',           kind: 'memorial',   source: 'solar', month: 2,  day: 7 },
  { id: 'womens-day',    name: '妇女节',               kind: 'memorial',   source: 'solar', month: 3,  day: 8 },
  { id: 'tree-planting', name: '植树节',               kind: 'memorial',   source: 'solar', month: 3,  day: 12 },
  { id: 'qingming',      name: '清明节',               kind: 'legal',      source: 'dynamic', resolve: (y) => { const d = qingmingDay(y); return d ? { month: 4, day: d } : null; } },
  { id: 'labour-day',    name: '劳动节',               kind: 'legal',      source: 'solar', month: 5,  day: 1 },
  { id: 'youth-day',     name: '青年节',               kind: 'memorial',   source: 'solar', month: 5,  day: 4 },
  { id: 'nurses-day',    name: '护士节',               kind: 'memorial',   source: 'solar', month: 5,  day: 12 },
  { id: 'may-30',        name: '五卅纪念日',           kind: 'memorial',   source: 'solar', month: 5,  day: 30 },
  { id: 'children-day',  name: '儿童节',               kind: 'memorial',   source: 'solar', month: 6,  day: 1 },
  { id: 'mothers-day',   name: '母亲节',               kind: 'network',    source: 'dynamic', resolve: (y) => mothersDay(y) },
  { id: 'fathers-day',   name: '父亲节',               kind: 'network',    source: 'dynamic', resolve: (y) => fathersDay(y) },
  { id: '520',           name: '520',                  kind: 'network',    source: 'solar', month: 5,  day: 20 },
  { id: 'armyday',       name: '中国人民解放军建军纪念日', kind: 'memorial', source: 'solar', month: 8,  day: 1 },
  { id: 'july-7',        name: '七七抗战纪念日',       kind: 'memorial',   source: 'solar', month: 7,  day: 7 },
  { id: 'sept-3',        name: '九三抗战胜利纪念日',   kind: 'memorial',   source: 'solar', month: 9,  day: 3 },
  { id: 'sept-18',       name: '九一八纪念日',         kind: 'memorial',   source: 'solar', month: 9,  day: 18 },
  { id: 'teachers-day',  name: '教师节',               kind: 'memorial',   source: 'solar', month: 9,  day: 10 },
  { id: 'journalist-day',name: '记者节',               kind: 'memorial',   source: 'solar', month: 11, day: 8 },
  { id: 'national-day',  name: '国庆节',               kind: 'legal',      source: 'solar', month: 10, day: 1 },
  { id: 'christmas',     name: '圣诞节',               kind: 'network',    source: 'solar', month: 12, day: 25 },
  // 泼水节公历按傣历新年估算，稳定落在 4 月 13 日附近
  { id: 'water-splash',  name: '泼水节',               kind: 'ethnic',     source: 'solar', month: 4,  day: 13 },
  // 雪顿节是藏历节日，公历浮动大；取 8 月下旬经验值
  { id: 'xuedun',        name: '雪顿节',               kind: 'ethnic',     source: 'solar', month: 8,  day: 22 },
];

// ===== 农历节日 =====
const LUNAR_HOLIDAYS: HolidayDef[] = [
  { id: 'spring-festival', name: '春节',     kind: 'legal',      source: 'lunar', lMonth: 1,  lDay: 1 },
  { id: 'yuanxiao',        name: '元宵节',   kind: 'traditional', source: 'lunar', lMonth: 1,  lDay: 15 },
  { id: 'dragon-boat',     name: '端午节',   kind: 'legal',      source: 'lunar', lMonth: 5,  lDay: 5 },
  { id: 'qixi',            name: '七夕节',   kind: 'traditional', source: 'lunar', lMonth: 7,  lDay: 7 },
  { id: 'mid-autumn',      name: '中秋节',   kind: 'legal',      source: 'lunar', lMonth: 8,  lDay: 15 },
  { id: 'chongyang',       name: '重阳节',   kind: 'traditional', source: 'lunar', lMonth: 9,  lDay: 9 },
  { id: 'torch',           name: '火把节',   kind: 'ethnic',     source: 'lunar', lMonth: 6,  lDay: 24 },
];

export const ALL_HOLIDAYS: HolidayDef[] = [...SOLAR_HOLIDAYS, ...LUNAR_HOLIDAYS];

// ===== 工具：父亲节（6 月第 3 个星期日）/ 母亲节（5 月第 2 个星期日）=====
function fathersDay(year: number): { month: number; day: number } {
  // 6 月 1 日是周几？6 月 1 日的星期 = dayOfWeek
  const first = new Date(year, 5, 1);
  const dow = first.getDay(); // 0=日
  // 第 3 个周日：第 1 个周日 = 1 + (7 - dow) % 7 之后的 14 天
  const firstSun = 1 + ((7 - dow) % 7);
  return { month: 6, day: firstSun + 14 };
}

function mothersDay(year: number): { month: number; day: number } {
  const first = new Date(year, 4, 1);
  const dow = first.getDay();
  const firstSun = 1 + ((7 - dow) % 7);
  return { month: 5, day: firstSun + 7 };
}

// ===== 解析某年某节日的公历 (month, day) =====
export function resolveDate(def: HolidayDef, year: number): { month: number; day: number } | null {
  if (def.source === 'solar') {
    if (def.month && def.day) return { month: def.month, day: def.day };
    return null;
  }
  if (def.source === 'lunar') {
    if (def.lMonth && def.lDay) {
      const r = lunarFestivalDate(year, def.lMonth, def.lDay);
      if (r) return { month: r.m, day: r.d };
    }
    return null;
  }
  if (def.source === 'dynamic' && def.resolve) {
    return def.resolve(year);
  }
  return null;
}

// ===== 给定公历月日，计算 "距 today" 的天数（按本地午夜 vs today 午夜）=====
function daysBetween(target: { month: number; day: number }, year: number, today: Date): number {
  const targetDate = new Date(year, target.month - 1, target.day);
  // 今日 0 点
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = targetDate.getTime() - todayMid.getTime();
  return Math.round(diffMs / 86400000);
}

// ===== 主入口：取全部节日（含已过）+ 距今天数 =====
export interface HolidayItem {
  id: string;
  name: string;
  kind: HolidayKind;
  source: HolidaySource;
  monthDayText: string;     // "3月8日" / "农历正月初一"
  monthDayShort: string;    // "3.8"
  /** 距今天数：负数=已过 N 天；0=今天；正数=还有 N 天 */
  daysLeft: number;
  /** 是否就是今天 */
  isToday: boolean;
}

export function getAllHolidayItems(now: Date = new Date()): HolidayItem[] {
  const y = now.getFullYear();
  const items: HolidayItem[] = [];
  for (const def of ALL_HOLIDAYS) {
    // 优先用今年；今年解析失败/已过时再考虑明年
    let resolved = resolveDate(def, y);
    let days = resolved ? daysBetween(resolved, y, now) : Number.POSITIVE_INFINITY;
    if (!resolved || days < 0) {
      const next = resolveDate(def, y + 1);
      if (!next) continue;
      resolved = next;
      days = daysBetween(next, y + 1, now);
    }
    if (!resolved) continue;
    items.push({
      id: def.id,
      name: def.name,
      kind: def.kind,
      source: def.source,
      monthDayText: formatMonthDay(def, resolved, y),
      monthDayShort: `${resolved.month}.${resolved.day}`,
      daysLeft: days,
      isToday: days === 0
    });
  }
  // 排序：未过的（含今天）按 daysLeft 升序在前，已过的按 daysLeft 降序（最近刚过的排前面）
  items.sort((a, b) => {
    if (a.daysLeft >= 0 && b.daysLeft >= 0) return a.daysLeft - b.daysLeft;
    if (a.daysLeft < 0 && b.daysLeft < 0) return b.daysLeft - a.daysLeft;
    return a.daysLeft >= 0 ? -1 : 1;
  });
  return items;
}

export function getUpcomingHolidayItems(limit: number, now: Date = new Date()): HolidayItem[] {
  return getAllHolidayItems(now).filter((i) => i.daysLeft >= 0).slice(0, limit);
}

// ===== 节日类别映射中文标签 =====
export const KIND_LABEL: Record<HolidayKind, string> = {
  legal: '法定节日',
  traditional: '传统节日',
  memorial: '纪念日',
  network: '网络/西方',
  ethnic: '民族节日'
};

// ===== 内部：将 (month, day) 翻译成 "X月X日" =====
function formatMonthDay(def: HolidayDef, r: { month: number; day: number }, year: number): string {
  if (def.source === 'lunar') {
    const ld = lunarFestivalDate(year, def.lMonth || 1, def.lDay || 1);
    if (ld) return `${ld.m}月${ld.d}日`;
  }
  return `${r.month}月${r.day}日`;
}

// ============================================================
// 节假日信息中心（年份视图）：
//  - getHolidayItemsForYear(year)  某一年全部节日（含已过，daysLeft 可为负）
//  - getNextHolidayItem()          距今最近的下一个节日（跨年查找）
//  视觉映射：每个节日固定 emoji + 渐变底色，用于列表缩略图
// ============================================================

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface HolidayVisual {
  emoji: string;
  /** CSS 渐变背景（缩略图底色，仅作识别辅助不抢文字视觉） */
  grad: string;
}

/** 按节日 id 定制缩略图；未命中的回落到按类别的默认配色 */
const HOLIDAY_VISUAL: Record<string, HolidayVisual> = {
  'new-year':        { emoji: '🎆', grad: 'linear-gradient(135deg, #BFD4FF 0%, #8FB0F5 100%)' },
  'spring-festival': { emoji: '🏮', grad: 'linear-gradient(135deg, #FFD9C4 0%, #F09A76 100%)' },
  'yuanxiao':        { emoji: '🍡', grad: 'linear-gradient(135deg, #FFE1C9 0%, #F5B583 100%)' },
  'qingming':        { emoji: '🌿', grad: 'linear-gradient(135deg, #CDEBD2 0%, #93CB9E 100%)' },
  'labour-day':      { emoji: '🌷', grad: 'linear-gradient(135deg, #FFE3C9 0%, #F5B478 100%)' },
  'dragon-boat':     { emoji: '🐉', grad: 'linear-gradient(135deg, #CFF0DC 0%, #8CCFA8 100%)' },
  'mid-autumn':      { emoji: '🌕', grad: 'linear-gradient(135deg, #FCE9C8 0%, #EDC484 100%)' },
  'national-day':    { emoji: '🎊', grad: 'linear-gradient(135deg, #FFD6CB 0%, #F08B7C 100%)' },
  'chongyang':       { emoji: '🍁', grad: 'linear-gradient(135deg, #FFE0C2 0%, #EBA96E 100%)' },
  'valentine':       { emoji: '💐', grad: 'linear-gradient(135deg, #FFD9E4 0%, #F29BB4 100%)' },
  'qixi':            { emoji: '💞', grad: 'linear-gradient(135deg, #E4D9FF 0%, #B39BEF 100%)' },
  '520':             { emoji: '💝', grad: 'linear-gradient(135deg, #FFD9E4 0%, #EF8FAD 100%)' },
  'womens-day':      { emoji: '🌷', grad: 'linear-gradient(135deg, #FFDDE8 0%, #F0A2BC 100%)' },
  'mothers-day':     { emoji: '🌸', grad: 'linear-gradient(135deg, #FFDFE8 0%, #F2A9BF 100%)' },
  'fathers-day':     { emoji: '👔', grad: 'linear-gradient(135deg, #CFE3F5 0%, #92B9DF 100%)' },
  'children-day':    { emoji: '🎈', grad: 'linear-gradient(135deg, #CDE4FF 0%, #8FB8F0 100%)' },
  'tree-planting':   { emoji: '🌱', grad: 'linear-gradient(135deg, #D3EDD3 0%, #96CD96 100%)' },
  'christmas':       { emoji: '🎄', grad: 'linear-gradient(135deg, #D8E7F8 0%, #A3BEE2 100%)' },
  'journalist-day':  { emoji: '📝', grad: 'linear-gradient(135deg, #D9E2F5 0%, #9DB2DC 100%)' },
  'teachers-day':    { emoji: '🍎', grad: 'linear-gradient(135deg, #FFE0D2 0%, #F0A48A 100%)' },
  'nurses-day':      { emoji: '💉', grad: 'linear-gradient(135deg, #D5EEF2 0%, #93CBD4 100%)' },
  'youth-day':       { emoji: '🔥', grad: 'linear-gradient(135deg, #FFE1C7 0%, #F2A86F 100%)' },
  'armyday':         { emoji: '🎖️', grad: 'linear-gradient(135deg, #D6E4C8 0%, #A3C28A 100%)' },
  'feb-7':           { emoji: '🕊️', grad: 'linear-gradient(135deg, #DDE3EC 0%, #A8B4C6 100%)' },
  'may-30':          { emoji: '🕊️', grad: 'linear-gradient(135deg, #DDE3EC 0%, #A8B4C6 100%)' },
  'july-7':          { emoji: '🕊️', grad: 'linear-gradient(135deg, #DDE3EC 0%, #A8B4C6 100%)' },
  'sept-3':          { emoji: '🕊️', grad: 'linear-gradient(135deg, #DDE3EC 0%, #A8B4C6 100%)' },
  'sept-18':         { emoji: '🕊️', grad: 'linear-gradient(135deg, #DDE3EC 0%, #A8B4C6 100%)' },
  'water-splash':    { emoji: '💦', grad: 'linear-gradient(135deg, #CBE9F5 0%, #8CC6E0 100%)' },
  'xuedun':          { emoji: '🏔️', grad: 'linear-gradient(135deg, #DCE8F2 0%, #A2C0D8 100%)' },
  'torch':           { emoji: '🔥', grad: 'linear-gradient(135deg, #FFE3C2 0%, #F0A462 100%)' }
};

/** 未命中 id 时按类别的兜底缩略图 */
const KIND_VISUAL: Record<HolidayKind, HolidayVisual> = {
  legal:       { emoji: '🎉', grad: 'linear-gradient(135deg, #FFD9C4 0%, #F09A76 100%)' },
  traditional: { emoji: '🏮', grad: 'linear-gradient(135deg, #FFE1C9 0%, #EBAA74 100%)' },
  memorial:    { emoji: '🕊️', grad: 'linear-gradient(135deg, #DDE3EC 0%, #A8B4C6 100%)' },
  network:     { emoji: '🎈', grad: 'linear-gradient(135deg, #FFD9E4 0%, #EF9CB6 100%)' },
  ethnic:      { emoji: '🥁', grad: 'linear-gradient(135deg, #CBEFDF 0%, #8FCDB0 100%)' }
};

/** 热门节日（列表中展示「热门」角标） */
const HOT_IDS = [
  'spring-festival', 'mid-autumn', 'new-year', 'national-day',
  'qingming', 'dragon-boat', 'labour-day', 'valentine', 'christmas', 'qixi'
];

/** 某一年的节日条目（含已过：daysLeft < 0，界面显示「已结束」） */
export interface HolidayYearItem {
  id: string;
  name: string;
  kind: HolidayKind;
  source: HolidaySource;
  /** 该年实际公历日期 */
  month: number;
  day: number;
  /** "11月8日" */
  monthDayText: string;
  /** "周日" */
  weekdayText: string;
  /** "农历正月初一"（公历节日也反查农历，便于详情展示） */
  lunarText: string;
  /** 距今天数：负=已过；0=今天；正=还有 N 天（实时计算，不存储） */
  daysLeft: number;
  isToday: boolean;
  /** 视觉映射 */
  emoji: string;
  grad: string;
  isHot: boolean;
}

export function getHolidayItemsForYear(year: number, now: Date = new Date()): HolidayYearItem[] {
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const items: HolidayYearItem[] = [];
  for (const def of ALL_HOLIDAYS) {
    const r = resolveDate(def, year);
    if (!r) continue;
    const target = new Date(year, r.month - 1, r.day);
    const days = Math.round((target.getTime() - todayMid.getTime()) / 86400000);
    const lunar = solarToLunar(year, r.month, r.day);
    const vis = HOLIDAY_VISUAL[def.id] || KIND_VISUAL[def.kind];
    items.push({
      id: def.id,
      name: def.name,
      kind: def.kind,
      source: def.source,
      month: r.month,
      day: r.day,
      monthDayText: `${r.month}月${r.day}日`,
      weekdayText: WEEK_CN[target.getDay()],
      lunarText: lunar ? `农历${lunar.monthCn}${lunar.dayCn}` : '',
      daysLeft: days,
      isToday: days === 0,
      emoji: vis.emoji,
      grad: vis.grad,
      isHot: HOT_IDS.indexOf(def.id) >= 0
    });
  }
  items.sort((a, b) => a.daysLeft - b.daysLeft);
  return items;
}

/** 距今最近的下一个节日（今年没有就跨到明年，含今天） */
export function getNextHolidayItem(now: Date = new Date()): HolidayYearItem | null {
  const y = now.getFullYear();
  const all = [...getHolidayItemsForYear(y, now), ...getHolidayItemsForYear(y + 1, now)];
  const next = all.find((i) => i.daysLeft >= 0);
  return next || null;
}