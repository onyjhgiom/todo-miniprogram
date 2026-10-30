// pages/astro/starCalendar.ts
// 星象日历：今日月相 / 月历 / 天象倒计时 / 选中日简报 / 笔记
import {
  moonPhase, ASTRO_EVENTS, formatDate, MoonPhase
} from '../../utils/astro-data';
import { solarToLunar, lunarCellText } from '../../../../utils/lunar';
import { NS, listAll, addRecord, deleteRecord } from '../../utils/astro-store';

interface NoteItem {
  id: string; ymd: string; content: string; createdAt: number;
}

interface DayCell {
  date: number; ymd: string; inMonth: boolean; lunar: string; hasEvent: boolean;
}

interface UpcomingEvent {
  id: string; name: string; date: string; desc: string; left: string; label: string;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface PageData {
  todayMoon: MoonPhase;
  year: number; month: number; selectedYMD: string;
  weekdayLabels: string[];
  days: DayCell[];
  upcoming: UpcomingEvent[];
  selectedMoon: MoonPhase;
  dayEvents: { name: string; desc: string }[];
  noteDraft: string;
  notes: NoteItem[];
}

Page<PageData>({
  data: {
    todayMoon: moonPhase(new Date()),
    year: 0, month: 0, selectedYMD: '',
    weekdayLabels: WEEKDAYS,
    days: [], upcoming: [],
    selectedMoon: moonPhase(new Date()),
    dayEvents: [], noteDraft: '', notes: []
  },

  onShow() {
    this.refreshToday();
    this.applyNotes();
  },

  refreshToday() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    this.setData({ year: y, month: m, selectedYMD: formatDate(now), todayMoon: moonPhase(now) }, () => {
      this.buildDays();
      this.buildUpcoming();
      this.applySelected();
    });
  },

  onPrevMonth() {
    let y = this.data.year;
    let m = this.data.month - 1;
    if (m < 1) { m = 12; y--; }
    this.setData({ year: y, month: m }, () => { this.buildDays(); this.buildUpcoming(); });
  },

  onNextMonth() {
    let y = this.data.year;
    let m = this.data.month + 1;
    if (m > 12) { m = 1; y++; }
    this.setData({ year: y, month: m }, () => { this.buildDays(); this.buildUpcoming(); });
  },

  buildDays() {
    const y = this.data.year;
    const m = this.data.month;
    const first = new Date(y, m - 1, 1);
    const firstDay = first.getDay();
    const lastDate = new Date(y, m, 0).getDate();
    const cells: DayCell[] = [];
    // 上月补位
    const prevLast = new Date(y, m - 1, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) cells.push({
      date: prevLast - i, ymd: this.ymd(y, m - 1, prevLast - i), inMonth: false,
      lunar: lunarText(y, m - 1, prevLast - i), hasEvent: false
    });
    for (let d = 1; d <= lastDate; d++) {
      const ymd = this.ymd(y, m, d);
      cells.push({
        date: d, ymd, inMonth: true,
        lunar: lunarText(y, m, d), hasEvent: ASTRO_EVENTS.some((e) => e.date === ymd)
      });
    }
    while (cells.length < 42) {
      const extra = cells.length - (firstDay + lastDate) + 1;
      cells.push({ date: extra, ymd: this.ymd(y, m + 1, extra), inMonth: false, lunar: lunarText(y, m + 1, extra), hasEvent: false });
    }
    this.setData({ days: cells });
  },

  ymd(y: number, m: number, d: number): string {
    const mm = m < 10 ? '0' + m : '' + m;
    const dd = d < 10 ? '0' + d : '' + d;
    return y + '-' + mm + '-' + dd;
  },

  buildUpcoming() {
    const now = Date.now();
    const up: UpcomingEvent[] = [];
    ASTRO_EVENTS.forEach((e) => {
      const ts = new Date(e.date + 'T00:00:00').getTime();
      if (ts < now - 86400_000) return;
      const leftMs = ts - now;
      up.push({
        id: e.id, name: e.name, date: e.date, desc: e.desc,
        label: typeLabel(e.type),
        left: fmtLeft(leftMs)
      });
    });
    up.sort((a, b) => a.date.localeCompare(b.date));
    this.setData({ upcoming: up.slice(0, 6) });
  },

  onSelectDate(e: WechatMiniprogram.TouchEvent) {
    const ymd = e.currentTarget.dataset.ymd as string;
    this.setData({ selectedYMD: ymd }, () => this.applySelected());
  },

  applySelected() {
    const ymd = this.data.selectedYMD;
    const d = new Date(ymd + 'T12:00:00');
    this.setData({
      selectedMoon: moonPhase(d),
      dayEvents: ASTRO_EVENTS.filter((e) => e.date === ymd),
      noteDraft: ''
    });
  },

  onNoteInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ noteDraft: e.detail.value });
  },

  onSaveNote() {
    const txt = (this.data.noteDraft || '').trim();
    if (!txt) return;
    addRecord(NS.calNotes, {
      id: '',
      ymd: this.data.selectedYMD,
      content: txt
    } as unknown as NoteItem);
    this.applyNotes();
    this.setData({ noteDraft: '' });
    wx.showToast({ title: '已保存笔记', icon: 'success' });
  },

  applyNotes() {
    const list = listAll<NoteItem>(NS.calNotes).slice(0, 30);
    list.sort((a, b) => b.ymd.localeCompare(a.ymd));
    this.setData({ notes: list });
  },

  onDeleteNote(e: WechatMiniprogram.TouchEvent) {
    deleteRecord(NS.calNotes, e.currentTarget.dataset.id as string);
    this.applyNotes();
  },

  onImgErr(e: WechatMiniprogram.CustomEvent) {
    const t = e.currentTarget as WechatMiniprogram.Image;
    const fb = '/subpackages/tools/assets/astro/moon/moon_full.png';
    if (t.src !== fb) t.setData({ src: fb });
  }
});

function typeLabel(t: string): string {
  const map: Record<string, string> = { 'new-moon': '新月', 'full-moon': '满月', 'retrograde': '逆行', 'eclipse': '食相', 'meteor': '流星雨' };
  return map[t] || '天象';
}

function fmtLeft(ms: number): string {
  if (ms <= 0) return '今日';
  const d = Math.floor(ms / 86400_000);
  if (d >= 1) return d + ' 天';
  const h = Math.floor(ms / 3600_000);
  if (h >= 1) return h + ' 小时';
  const m2 = Math.floor(ms / 60_000);
  return m2 + ' 分钟';
}

/** 完整农历：优先查表法（2019-2035），超范围降级为简化农历 */
function lunarText(y: number, m: number, d: number): string {
  const l = solarToLunar(y, m, d);
  if (l) return lunarCellText(l);
  return lunarLabel(d, m);
}

/** 简化农历（兜底）：仅展示 1/15/末日节气别名（不调复杂农历库） */
function lunarLabel(day: number, month: number): string {
  if (day === 1) return month + '月';
  if (day === 15) return '望';
  if (day === 30 || day === 29) return '晦';
  return '';
}