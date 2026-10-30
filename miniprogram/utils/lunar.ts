// utils/lunar.ts
// 农历转换 + 法定节假日/调休排班数据
//
// 农历算法：查表法（数据源自香港天文台 1900-2100 农历数据，同 calendar.js 开源库）
// 节假日数据：2026 年为国务院办公厅官方安排（国办发明电〔2025〕7 号）；
//             2027-2030 官方尚未发布，按法定节假日核心日预估（不含调休推算），
//             官方发布后可在 HOLIDAY_DATA 中补充覆盖。

/* ============ 农历数据表（2019-2035） ============ */
// 每年一个数：bit0-3 闰月月号(0=无闰月)；bit4-15 十二个月大小(1=大月30天)；
//             bit16 闰月是否大月。下标 0 对应 2019 年。
//
// 【2026 年已手工校准】原表该项为 0x0d260，二/三月长度与真实农历不符，
// 会让五月初五（端午）算成 6/20、八月十五（中秋）算成 9/26、七夕算成 9/15，
// 均与公开历法相差一天。现按 2026 年真实初一序列反推为 0x0a870
// （月份 30/29/30/29/30/29/29/29/30/30/30/29，年总长 354 天不变，
//  因此 2027 春节仍为 2/6，不影响后续年份）：
//   正月初一 2/17 · 元宵 3/3 · 三月初一 4/17 · 五月初一 6/15（端午 6/19）
//   七月初一 8/13（七夕 8/19）· 八月初一 9/11（中秋 9/25）· 九月初一 10/10（重阳 10/18）
//   十月初一 11/9 · 冬月初一 12/9 · 腊月初八 1/15（2027）· 除夕 2027/2/5
const LUNAR_INFO: number[] = [
  0x0a930, // 2019
  0x07954, // 2020
  0x06aa0, // 2021
  0x0ad50, // 2022
  0x05b52, // 2023
  0x04b60, // 2024
  0x0a6e6, // 2025
  0x0a870, // 2026 ⚠ 已校准（原表误写 0x0d260）
  0x0ea65, // 2027
  0x0d530, // 2028
  0x05aa0, // 2029
  0x076a3, // 2030
  0x096d0, // 2031
  0x04afb, // 2032
  0x04ad0, // 2033
  0x0a4d0, // 2034
  0x1d0b6  // 2035
];

const LUNAR_FIRST_YEAR = 2019;
const LUNAR_LAST_YEAR = 2035;

/** 农历 2019-02-05（正月初一）距 1970-01-01 的天数 */
const LUNAR_BASE_OFFSET = Math.floor(Date.UTC(2019, 1, 5) / 86400000);

function infoOf(year: number): number {
  return LUNAR_INFO[year - LUNAR_FIRST_YEAR];
}
function leapMonth(year: number): number {
  return infoOf(year) & 0xf;
}
function leapDays(year: number): number {
  if (leapMonth(year)) return infoOf(year) & 0x10000 ? 30 : 29;
  return 0;
}
function monthDays(year: number, month: number): number {
  return infoOf(year) & (0x10000 >> month) ? 30 : 29;
}
function yearDays(year: number): number {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    if (infoOf(year) & i) sum += 1;
  }
  return sum + leapDays(year);
}

/* ============ 名称表 ============ */

const MONTH_CN = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const DAY_CN = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ANIMALS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

export interface LunarDate {
  lYear: number;
  lMonth: number;
  lDay: number;
  isLeap: boolean;
  /** 月名（正月/腊月/闰四月…） */
  monthCn: string;
  /** 日名（初一/廿三…） */
  dayCn: string;
  /** 干支年（丙午） */
  gzYear: string;
  /** 生肖（马） */
  animal: string;
}

/** 公历 → 农历（支持 2019-02-05 ~ 2035 年底，超范围返回 null） */
export function solarToLunar(y: number, m: number, d: number): LunarDate | null {
  const offset = Math.floor(Date.UTC(y, m - 1, d) / 86400000) - LUNAR_BASE_OFFSET;
  if (offset < 0) return null;

  let lYear = LUNAR_FIRST_YEAR;
  let daysInYear = yearDays(lYear);
  let rest = offset;
  while (rest >= daysInYear && lYear < LUNAR_LAST_YEAR) {
    rest -= daysInYear;
    lYear += 1;
    daysInYear = yearDays(lYear);
  }
  if (rest >= daysInYear) return null; // 超出数据表范围

  const leap = leapMonth(lYear);
  let isLeap = false;
  let lMonth = 1;
  let temp = 0;
  for (let i = 1; i < 13 && rest >= 0; i++) {
    if (leap > 0 && i === leap + 1 && !isLeap) {
      // 先扣闰月
      i -= 1;
      isLeap = true;
      temp = leapDays(lYear);
    } else {
      temp = monthDays(lYear, i);
    }
    if (isLeap && i === leap + 1) {
      isLeap = false; // 闰月扣完，回到正常月份序列
    }
    if (rest < temp) {
      lMonth = i;
      break;
    }
    rest -= temp;
    lMonth = i + 1;
  }

  const lDay = rest + 1;
  const monthCn = (isLeap && leap === lMonth ? '闰' : '') + MONTH_CN[lMonth - 1];
  // 干支年：农历年以立春分界的简化处理按正月初一起算（展示用途足够）
  const gzYear = GAN[(lYear - 4) % 10] + ZHI[(lYear - 4) % 12];
  const animal = ANIMALS[(lYear - 4) % 12];
  return { lYear, lMonth, lDay, isLeap: isLeap && leap === lMonth, monthCn, dayCn: DAY_CN[lDay - 1], gzYear, animal };
}

/** 农历日历 cell 的显示文案：初一显示月名，其余显示日名 */
export function lunarCellText(l: LunarDate | null): string {
  if (!l) return '';
  if (l.lDay === 1) return l.monthCn;
  return l.dayCn;
}

/* ============ 节气（仅清明，法定假日推算需要） ============ */

/** 清明节公历日期（21 世纪通用公式，4 月 4-6 日） */
export function qingmingDay(year: number): number {
  const y = year % 100;
  return Math.floor(y * 0.2422 + 4.81) - Math.floor(y / 4);
}

/* ============ 传统/公历节日 ============ */

/** 农历节日：key = `${lMonth}-${lDay}`（闰月不算节日） */
const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '5-5': '端午节',
  '7-7': '七夕',
  '8-15': '中秋节',
  '9-9': '重阳节'
};

/** 公历节日：key = `${m}-${d}` */
const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦',
  '5-1': '劳动节',
  '10-1': '国庆节'
};

/* ============ 法定节假日 / 调休数据 ============ */

export interface HolidayRange {
  name: string;
  /** ymd 起（2026-01-01） */
  start: string;
  /** ymd 止 */
  end: string;
  /** 连续放假天数 */
  days: number;
}

export interface YearHolidayData {
  /** 是否官方发布的确切安排 */
  official: boolean;
  holidays: HolidayRange[];
  /** 调休上班日 ymd 列表 */
  workdays: string[];
}

/** 已内置的官方数据（官方发布后逐年补充） */
const HOLIDAY_DATA: Record<number, YearHolidayData> = {
  2026: {
    official: true,
    holidays: [
      { name: '元旦', start: '2026-01-01', end: '2026-01-03', days: 3 },
      { name: '春节', start: '2026-02-15', end: '2026-02-23', days: 9 },
      { name: '清明节', start: '2026-04-04', end: '2026-04-06', days: 3 },
      { name: '劳动节', start: '2026-05-01', end: '2026-05-05', days: 5 },
      { name: '端午节', start: '2026-06-19', end: '2026-06-21', days: 3 },
      { name: '中秋节', start: '2026-09-25', end: '2026-09-27', days: 3 },
      { name: '国庆节', start: '2026-10-01', end: '2026-10-07', days: 7 }
    ],
    workdays: [
      '2026-01-04', // 元旦调休
      '2026-02-14', '2026-02-28', // 春节调休
      '2026-05-09', // 劳动节调休
      '2026-09-20', '2026-10-10' // 国庆调休
    ]
  }
};

function ymdOf(y: number, m: number, d: number): string {
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 春节假期核心日（除夕~初三）的公历区间，基于农历推算 */
function springFestivalRange(year: number): { start: string; end: string } {
  // 找到当年农历正月初一：在公历 1 月 15 日 ~ 3 月 1 日之间扫描
  let cnyY = year, cnyM = 1, cnyD = 1;
  for (let m = 1; m <= 3; m++) {
    const maxD = m === 3 ? 1 : 31;
    for (let d = (m === 1 ? 15 : 1); d <= maxD; d++) {
      const l = solarToLunar(year, m, d);
      if (l && l.lYear === year && l.lMonth === 1 && l.lDay === 1) {
        cnyY = year; cnyM = m; cnyD = d;
        m = 99;
        break;
      }
    }
  }
  // 春节若在 1 月下旬（如 2028-01-26），除夕在 1 月；否则在 2 月
  const chuxi = new Date(Date.UTC(cnyY, cnyM - 1, cnyD) - 86400000);
  const end = new Date(Date.UTC(cnyY, cnyM - 1, cnyD) + 3 * 86400000); // 正月初三
  return {
    start: ymdOf(chuxi.getUTCFullYear(), chuxi.getUTCMonth() + 1, chuxi.getUTCDate()),
    end: ymdOf(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate())
  };
}

/**
 * 农历节日（端午/中秋/元宵…）当年的公历日期。
 *
 * 【必须按真实日期逐日遍历】曾写成 `for m 1..12 / for d 1..31`，把 2月31日、
 * 4月31日 这类**不存在的日期**也喂给 solarToLunar；而 Date.UTC 会把非法日期
 * 自动进位（2026-02-31 → 2026-03-03），于是「正月十五=3月3日」被误判成 2月31日，
 * 页面直接显示「元宵节 2月31日」。这里改为按 UTC 日期逐日推进，天然不越界。
 */
const lunarFestivalCache: Record<string, { m: number; d: number } | null> = {};

export function lunarFestivalDate(year: number, lMonth: number, lDay: number): { m: number; d: number } | null {
  const ck = `${year}-${lMonth}-${lDay}`;
  if (Object.prototype.hasOwnProperty.call(lunarFestivalCache, ck)) return lunarFestivalCache[ck];

  let hit: { m: number; d: number } | null = null;
  const cur = new Date(Date.UTC(year, 0, 1));
  const end = Date.UTC(year + 1, 0, 1);
  while (cur.getTime() < end) {
    const m = cur.getUTCMonth() + 1;
    const d = cur.getUTCDate();
    const l = solarToLunar(year, m, d);
    if (l && l.lYear === year && !l.isLeap && l.lMonth === lMonth && l.lDay === lDay) {
      hit = { m, d };
      break;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  lunarFestivalCache[ck] = hit;
  return hit;
}

/** 获取某年节假日数据：优先内置官方数据，否则按法定核心日预估 */
export function getYearHolidayData(year: number): YearHolidayData {
  const preset = HOLIDAY_DATA[year];
  if (preset) return preset;

  // 预估：法定假日核心日（新办法：除夕、5.2 各增 1 天）
  const holidays: HolidayRange[] = [{ name: '元旦', start: ymdOf(year, 1, 1), end: ymdOf(year, 1, 1), days: 1 }];
  const spring = springFestivalRange(year);
  holidays.push({ name: '春节', start: spring.start, end: spring.end, days: 4 });

  const qm = qingmingDay(year);
  holidays.push({ name: '清明节', start: ymdOf(year, 4, qm), end: ymdOf(year, 4, qm), days: 1 });
  holidays.push({ name: '劳动节', start: ymdOf(year, 5, 1), end: ymdOf(year, 5, 2), days: 2 });

  const duanwu = lunarFestivalDate(year, 5, 5);
  if (duanwu) holidays.push({ name: '端午节', start: ymdOf(year, duanwu.m, duanwu.d), end: ymdOf(year, duanwu.m, duanwu.d), days: 1 });
  const zhongqiu = lunarFestivalDate(year, 8, 15);
  if (zhongqiu) holidays.push({ name: '中秋节', start: ymdOf(year, zhongqiu.m, zhongqiu.d), end: ymdOf(year, zhongqiu.m, zhongqiu.d), days: 1 });
  holidays.push({ name: '国庆节', start: ymdOf(year, 10, 1), end: ymdOf(year, 10, 3), days: 3 });

  return { official: false, holidays, workdays: [] };
}

/* ============ 单日信息（日历 cell 渲染入口） ============ */

export interface DayMeta {
  /** cell 下方小字：节日名 > 农历日 */
  lunarText: string;
  /** 完整农历描述（详情用）：丙午马年 五月初九 */
  lunarFull: string;
  /** 当天节日名（传统节日/公历节日/法定假日名），无则 null */
  festival: string | null;
  /** 所属法定假期（当天落在放假区间内时非空） */
  holiday: { name: string; days: number; start: string; end: string; official: boolean } | null;
  /** 是否假期首日（用于 cell 显示「X 天」） */
  isHolidayStart: boolean;
  /** 休：法定假日 */
  isRest: boolean;
  /** 班：调休上班的周末 */
  isWork: boolean;
  /** 普通双休（周六日且非调休班） */
  isWeekend: boolean;
  /** 角标文字：'休' | '班' | '' */
  badge: string;
}

function cmpYMD(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 获取某天的农历 + 节假日 + 调休完整信息 */
export function getDayMeta(y: number, m: number, d: number, weekday: number): DayMeta {
  const ymd = ymdOf(y, m, d);
  const lunar = solarToLunar(y, m, d);
  const yearData = getYearHolidayData(y);

  // 节假日归属
  let holiday: DayMeta['holiday'] = null;
  let isHolidayStart = false;
  for (const h of yearData.holidays) {
    if (cmpYMD(ymd, h.start) >= 0 && cmpYMD(ymd, h.end) <= 0) {
      holiday = { name: h.name, days: h.days, start: h.start, end: h.end, official: yearData.official };
      isHolidayStart = ymd === h.start;
      break;
    }
  }

  // 调休上班
  const isWork = yearData.workdays.indexOf(ymd) >= 0;
  const isRest = !!holiday;
  const isWeekend = (weekday === 0 || weekday === 6) && !isWork;

  // 节日名：法定假日名 > 除夕 > 农历节日 > 公历节日
  let festival: string | null = null;
  if (holiday) {
    festival = holiday.name;
  } else {
    // 除夕：明天的农历是正月初一
    const tomorrowLunar = solarToLunar(y, m, d + 1);
    if (tomorrowLunar && tomorrowLunar.lMonth === 1 && tomorrowLunar.lDay === 1 && lunar && lunar.lMonth === 12) {
      festival = '除夕';
    } else if (lunar && !lunar.isLeap) {
      festival = LUNAR_FESTIVALS[`${lunar.lMonth}-${lunar.lDay}`] || SOLAR_FESTIVALS[`${m}-${d}`] || null;
      // 清明（节气日）
      if (!festival && m === 4 && d === qingmingDay(y)) festival = '清明';
    } else {
      festival = SOLAR_FESTIVALS[`${m}-${d}`] || null;
    }
  }

  const lunarText = festival || lunarCellText(lunar);
  const lunarFull = lunar ? `${lunar.gzYear}${lunar.animal}年 ${lunar.monthCn}${lunar.dayCn}` : '';

  return {
    lunarText,
    lunarFull,
    festival,
    holiday,
    isHolidayStart,
    isRest,
    isWork,
    isWeekend,
    badge: isWork ? '班' : isRest ? '休' : ''
  };
}

/** 假期区间的人类可读描述（详情面板用）：'2月15日 - 2月23日' */
export function formatHolidayRange(start: string, end: string): string {
  const s = start.split('-');
  const e = end.split('-');
  return `${Number(s[1])}月${Number(s[2])}日 - ${Number(e[1])}月${Number(e[2])}日`;
}
