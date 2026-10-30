// pages/guaxiang/daily/daily.ts
// 每日一卦 · 卦历打卡：按日期确定性生成今日卦象，可打卡形成个人卦历（连续天数 + 近30天网格）。
// 纯本地、确定性（同日同卦），无网络、无预测。合规：传统哲理科普 + 自省记录，不预言吉凶。
import { getThemeState, syncNavBar } from '../../../../../utils/theme';
import { DISCLAIMER_FULL, DISCLAIMER_SHORT, sanitize } from '../../../utils/folklore';
import { HEXAGRAMS } from '../../../utils/guaxiang-data';
import {
  findByNum,
  findByLines,
  buildReadingByNum,
  hexLines,
  toDisplayLines,
  Reading,
  DisplayLine
} from '../../../utils/guaxiang';
import type { ThemeKey } from '../../../../../types/index';
import { go } from '../../../../../utils/nav';

interface Checkin { date: string; num: number; ts: number; }
interface CalDay { key: string; day: number; checked: boolean; num: number; name: string; }

interface DailyData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  dateLabel: string;
  reading: Reading | null;
  benName: string;
  benNum: number;
  benLines: DisplayLine[];
  bianName: string;
  bianLines: DisplayLine[];
  bianPhilosophy: string;
  keywordsLine: string;
  checked: boolean;
  streak: number;
  total: number;
  calendar: CalDay[];
  disclaimer: string;
  disclaimerShort: string;
}

const CHECKIN_KEY = 'guaxiang_daily_checkin';

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 日期 → 1..64 确定性卦序（同一天稳定，跨天渐变） */
function dailyNum(d: Date): number {
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const h = (seed * 1103515245 + 12345) >>> 0;
  return (h % 64) + 1;
}

/** 日期 → 动爻位 1..6（确定性，使每日可有变卦推演） */
function dailyMoving(d: Date): number {
  const seed = d.getFullYear() + (d.getMonth() + 1) * 31 + d.getDate();
  return (seed % 6) + 1;
}

function loadCheckins(): Checkin[] {
  try {
    const a = wx.getStorageSync(CHECKIN_KEY) as Checkin[] | '';
    if (a && Array.isArray(a)) return a;
  } catch (_e) { /* 忽略 */ }
  return [];
}

function saveCheckins(list: Checkin[]): void {
  try { wx.setStorageSync(CHECKIN_KEY, list); } catch (_e) { /* 忽略 */ }
}

/** 连续打卡天数（自今日往前数，今日未打卡则从昨日算起） */
function computeStreak(list: Checkin[]): number {
  if (!list.length) return 0;
  const set = new Set(list.map((c) => c.date));
  const d = new Date();
  if (!set.has(dateKey(d))) d.setDate(d.getDate() - 1);
  let s = 0;
  while (set.has(dateKey(d))) { s++; d.setDate(d.getDate() - 1); }
  return s;
}

/** 近 30 天网格（含今日），已打卡的格子带卦名 */
function buildCalendar(list: Checkin[]): CalDay[] {
  const map = new Map<string, Checkin>();
  list.forEach((c) => map.set(c.date, c));
  const days: CalDay[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = dateKey(d);
    const c = map.get(key);
    days.push({
      key,
      day: d.getDate(),
      checked: !!c,
      num: c ? c.num : 0,
      name: c ? findByNum(c.num).name : ''
    });
  }
  return days;
}

Page<DailyData>({
  data: {
    theme: 'light', themeStyle: '', heroGradient: '',
    dateLabel: '', reading: null, benName: '', benNum: 0,
    benLines: [], bianName: '', bianLines: [], bianPhilosophy: '',
    keywordsLine: '',
    checked: false, streak: 0, total: 0, calendar: [],
    disclaimer: DISCLAIMER_FULL, disclaimerShort: DISCLAIMER_SHORT
  },

  onLoad() {
    this.applyTheme();
    this.render();
  },

  onShow() {
    this.applyTheme();
    this.render();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
    try {
      wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#15110D', fail: () => { /* 忽略 */ } });
    } catch (_e) { /* 忽略 */ }
  },

  render() {
    const today = new Date();
    const num = dailyNum(today);
    const moving = dailyMoving(today);
    const hex = findByNum(num);
    const reading = buildReadingByNum(num);
    const bianLinesRaw = hexLines(hex).map((v, i) => (i + 1 === moving ? (v === 1 ? 0 : 1) : v));
    const bian = findByLines(bianLinesRaw);
    const list = loadCheckins();
    const key = dateKey(today);
    const checked = list.some((c) => c.date === key);
    const kw = hex.keywords.slice(0, 3).join(' · ');

    this.setData({
      dateLabel: `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`,
      reading,
      benName: hex.fullName,
      benNum: hex.num,
      benLines: reading.benLines,
      bianName: bian ? bian.fullName : '',
      bianLines: bian ? toDisplayLines(bianLinesRaw) : [],
      bianPhilosophy: bian ? sanitize(bian.philosophy) : '',
      keywordsLine: kw,
      checked,
      streak: computeStreak(list),
      total: list.length,
      calendar: buildCalendar(list)
    });
  },

  onCheckin() {
    if (this.data.checked) {
      wx.showToast({ title: '今日已打卡', icon: 'none' });
      return;
    }
    const today = new Date();
    const num = dailyNum(today);
    const list = loadCheckins();
    list.push({ date: dateKey(today), num, ts: Date.now() });
    saveCheckins(list);
    this.setData({
      checked: true,
      total: list.length,
      streak: computeStreak(list),
      calendar: buildCalendar(list)
    });
    wx.showToast({ title: '打卡成功', icon: 'success' });
  },

  onDayTap(e: WechatMiniprogram.TouchEvent) {
    const num = parseInt(String(e.currentTarget.dataset.num), 10);
    if (!num) return;
    go(`/subpackages/tools/pages/guaxiang/index?num=${num}`);
  },

  onCopy() {
    const r = this.data.reading;
    if (!r) return;
    const text =
      `【${r.ben.fullName}·${this.data.dateLabel}】\n` +
      `卦辞：${r.benCi}\n` +
      `象传：${r.benXiang}\n` +
      `卦意今解：${r.benPhilosophy}\n` +
      `人生疏导：${r.guide}\n` +
      `可行之法：${r.advice}\n` +
      DISCLAIMER_SHORT;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  },

  onGoDraw() {
    go('/subpackages/tools/pages/guaxiang/draw');
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const r = this.data.reading;
    const title = r ? `今日一卦：${r.ben.fullName}` : '每日一卦';
    return { title: `${title}｜${DISCLAIMER_SHORT}`, path: '/subpackages/tools/pages/guaxiang/daily' };
  }
});
