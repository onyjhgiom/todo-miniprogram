// pages/recruit/calendar.ts
// 日历视图（模块五）：月/周视图看笔试面试，面试当天给真实时间轴，提前 30 分钟本地提醒。
//
// 事件来源有两条，此前只有第一条 —— 导致「面试当天时间轴」是一段写死的假文案：
//   ① 投递对象的 dueDate（网申 / 笔试截止）
//   ② 面试安排 interviews[]（一面 / 二面 / HR 面…，各带时间、形式、地点）
// 时间轴也改成按当天真实事件 + 该投递的准备度/清单剩余项生成。
import { getCareerState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import {
  loadApps, dueInfo, statusLabel, ensureInterviews, readiness, collectDueRecruitNotices,
  upsertApp, getAppById
} from '../../utils/recruit-store';
import type { IApplication, RecruitStatus } from '../../../../types/index';
import type { ThemeKey } from '../../../../types/index';
import { go } from '../../../../utils/nav';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const STATUS_COLOR: Record<RecruitStatus, string> = {
  applied: '#6E8E6E', written: '#A9915C', interview: '#C09A5E',
  offer: '#5C7A5C', rejected: '#94857A', givenup: '#C9B5A1'
};
/** 面试事件固定用主色系，和「截止」在视觉上分开 */
const INTERVIEW_COLOR = '#B5714C';

function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function hhmm(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface DayCell {
  day: number;
  key: string;
  inMonth: boolean;
  isToday: boolean;
  hasEvent: boolean;
  /** 当天有几场面试（月历上给面试单独上色） */
  ivCount: number;
}
interface DayEvent {
  /** 事件唯一 key */
  key: string;
  /** 投递 id */
  appId: string;
  /** 面试安排 id（截止事件为空串） */
  ivId: string;
  kind: 'due' | 'interview';
  time: string;
  company: string;
  position: string;
  /** 事件标题：面试为「一面 · 线上」，截止为「网申截止」 */
  title: string;
  color: string;
  place: string;
  done: boolean;
}
/** 时间轴节点 */
interface TlNode {
  key: string;
  time: string;
  text: string;
  tone: 'normal' | 'go' | 'warn';
}

Page<{
  theme: ThemeKey; themeStyle: string; heroGradient: string;
  view: 'month' | 'week';
  year: number; month: number;
  title: string;
  grid: DayCell[];
  week: DayCell[];
  weekKey: string;
  weekLabels: string[];
  selectedKey: string;
  events: DayEvent[];
  ivCount: number;
  dueCount: number;
  hasInterview: boolean;
  timeline: TlNode[];
  /** 最近一场面试的倒计时提示（页头） */
  nextHint: string;
  /** 提醒是否已排期到待办（决定提示文案） */
  remindScheduled: boolean;
}>({
  data: {
    theme: 'light', themeStyle: '', heroGradient: '',
    view: 'month',
    year: 0, month: 0, title: '',
    grid: [], week: [], weekKey: '', weekLabels: WEEK_LABELS,
    selectedKey: '', events: [], ivCount: 0, dueCount: 0,
    hasInterview: false, timeline: [], nextHint: '', remindScheduled: false
  },

  onLoad() {
    this.applyTheme();
    const now = new Date();
    this.setData({ year: now.getFullYear(), month: now.getMonth() });
    this.selectDay(dateKey(now));
    this.checkReminders();
  },
  onShow() {
    this.applyTheme();
    this.checkReminders();
    // 重新载入当天事件（数据可能变化）
    this.selectDay(this.data.selectedKey);
  },
  applyTheme() {
    const s = getCareerState(); // 秋招助手固定「求职工作台」深蓝视觉，不随全局主题漂移
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  /**
   * 到期提醒：统一走数据层的提醒计划（remindAt + 每场面试提前 30 分钟），
   * 本地用 fired log 去重；已同步到待办的场次由全局调度器负责后台推送。
   * 进入页面时补扫一次，避免用户恰好只在秋招页活动时错过提醒。
   */
  checkReminders() {
    const notices = collectDueRecruitNotices();
    if (notices.length === 0) return;
    const modal = notices.find((n) => n.method === 'modal');
    const rest = notices.length - 1;
    if (modal) {
      wx.vibrateShort && wx.vibrateShort({});
      wx.showModal({
        title: '⏰ 提醒',
        content: `「${modal.company}」${modal.title}${rest > 0 ? `，另有 ${rest} 条提醒` : ''}`,
        showCancel: false,
        confirmText: '知道了'
      });
    } else {
      toast(`⏰ ${notices[0].company} ${notices[0].title}`, 'none');
    }
  },

  /* ---------- 事件抽取 ---------- */

  /** 当天事件（截止 + 面试），按时间升序 */
  eventsOn(key: string): DayEvent[] {
    const out: DayEvent[] = [];
    loadApps().forEach((a) => {
      if (a.dueDate && dateKey(new Date(a.dueDate)) === key) {
        out.push({
          key: `${a._id}_due`,
          appId: a._id,
          ivId: '',
          kind: 'due',
          time: hhmm(a.dueDate),
          company: a.company || '未命名公司',
          position: a.position,
          title: `${statusLabel(a.status)}截止`,
          color: STATUS_COLOR[a.status],
          place: '',
          done: false
        });
      }
      ensureInterviews(a).forEach((it) => {
        if (dateKey(new Date(it.at)) !== key) return;
        out.push({
          key: `${a._id}_${it.id}`,
          appId: a._id,
          ivId: it.id,
          kind: 'interview',
          time: hhmm(it.at),
          company: a.company || '未命名公司',
          position: a.position,
          title: `${it.round} · ${it.mode}`,
          color: INTERVIEW_COLOR,
          place: it.place,
          done: it.done
        });
      });
    });
    return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  },

  buildMonthGrid(year: number, month: number): DayCell[] {
    const first = new Date(year, month, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = dateKey(new Date());
    const marks = this.marksByDay();
    const cells: DayCell[] = [];
    // 上月补位
    const prevDays = new Date(year, month, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevDays - i);
      cells.push(this.makeCell(d, marks, todayKey, false));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(this.makeCell(new Date(year, month, d), marks, todayKey, true));
    }
    // 下月补位到 42
    while (cells.length % 7 !== 0 || cells.length < 42) {
      const d = cells.length - (startWeekday + daysInMonth) + 1;
      cells.push(this.makeCell(new Date(year, month + 1, d), marks, todayKey, false));
      if (cells.length >= 42) break;
    }
    return cells.slice(0, 42);
  },

  makeCell(d: Date, marks: Record<string, number>, todayKey: string, inMonth: boolean): DayCell {
    const key = dateKey(d);
    return {
      day: d.getDate(),
      key,
      inMonth,
      isToday: key === todayKey,
      hasEvent: marks[key] > 0,
      ivCount: marks[key] || 0
    };
  },

  /** 每天的事件数（同时统计面试场次，供月历上色） */
  marksByDay(): Record<string, number> {
    const map: Record<string, number> = {};
    loadApps().forEach((a) => {
      if (a.dueDate) {
        const k = dateKey(new Date(a.dueDate));
        map[k] = (map[k] || 0) + 1;
      }
      ensureInterviews(a).forEach((it) => {
        const k = dateKey(new Date(it.at));
        map[k] = (map[k] || 0) + 1;
      });
    });
    return map;
  },

  selectDay(key: string) {
    const [y, m] = key.split('-').map(Number);
    this.setData({ selectedKey: key, year: y, month: m - 1 });
    const events = this.eventsOn(key);
    const ivEvents = events.filter((e) => e.kind === 'interview');
    const hasInterview = ivEvents.length > 0;
    this.setData({
      events,
      ivCount: ivEvents.length,
      dueCount: events.length - ivEvents.length,
      hasInterview,
      timeline: hasInterview ? this.buildTimeline(key, events) : [],
      nextHint: this.nextInterviewHint(),
      remindScheduled: this.hasScheduledReminder()
    });
    this.refreshGrid();
  },

  /**
   * 面试当天时间轴：不再是写死的 6 行文案，
   * 而是按当天的真实面试（时间 / 形式 / 地点）+ 该投递的准备度与清单剩余项生成。
   */
  buildTimeline(key: string, events: DayEvent[]): TlNode[] {
    const nodes: TlNode[] = [];
    const apps = loadApps();
    events
      .filter((e) => e.kind === 'interview')
      .forEach((e, idx) => {        const app = apps.find((a) => a._id === e.appId);
        const iv = app ? ensureInterviews(app).find((x) => x.id === e.ivId) : undefined;
        if (!iv) return;

        // 提前量：线上 30 分钟调试设备，现场 45 分钟出发
        const leadMin = iv.mode === '现场' ? 45 : 30;
        nodes.push({
          key: `${e.key}_lead`,
          time: hhmm(iv.at - leadMin * 60000),
          text: iv.mode === '现场'
            ? `出发 / 到场：${iv.place || '地点待填'}`
            : `设备调试：摄像头、麦克风、${iv.place || '会议链接待填'}`,
          tone: 'warn'
        });
        nodes.push({
          key: `${e.key}_start`,
          time: hhmm(iv.at),
          text: `${iv.round} 开始${iv.interviewer ? '（' + iv.interviewer + '）' : ''}`,
          tone: 'go'
        });
        nodes.push({
          key: `${e.key}_intro`,
          time: hhmm(iv.at + 2 * 60000),
          text: '自我介绍：1 分钟精简版 + 3 分钟详细版各过一遍',
          tone: 'normal'
        });
        if (app) {
          const rd = readiness(app);
          nodes.push({
            key: `${e.key}_ready`,
            time: hhmm(iv.at + 6 * 60000),
            text: `当前准备度 ${rd.score}%（${rd.level}）：${rd.tips[0] || '状态不错，保持手感'}`,
            tone: rd.score >= 60 ? 'normal' : 'warn'
          });
          const ck = app.checklist || [];
          const left = ck.filter((c) => !c.done).length;
          if (ck.length > 0 && left > 0) {
            nodes.push({
              key: `${e.key}_ck`,
              time: hhmm(iv.at - 60 * 60000),
              text: `准备清单还剩 ${left} 项（共 ${ck.length} 项），去详情页打勾`,
              tone: 'warn'
            });
          }
        }
        // 最后一场之后给收尾节点
        nodes.push({
          key: `${e.key}_end`,
          time: hhmm(iv.at + 45 * 60000),
          text: idx === 0 ? '反向提问 + 礼貌收尾' : '面试收尾，记一句复盘',
          tone: 'normal'
        });
      });

    nodes.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

    const dedup: TlNode[] = [];
    const seen = new Set<string>();
    for (const n of nodes) {
      const k = `${n.time}|${n.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(n);
    }
    return dedup;
  },

  /** 页头倒计时：最近一场未结束的面试 */
  nextInterviewHint(): string {
    let best: { at: number; company: string; round: string } | null = null;
    const now = Date.now();
    loadApps().forEach((a) => {
      ensureInterviews(a).forEach((it) => {
        if (it.done || it.at < now - 3600000) return;
        if (!best || it.at < best.at) best = { at: it.at, company: a.company || '未命名', round: it.round };
      });
    });
    if (!best) return '';
    const b = best as { at: number; company: string; round: string };
    const days = Math.ceil((b.at - now) / 86400000);
    const when = days <= 0 ? `今天 ${hhmm(b.at)}` : days === 1 ? `明天 ${hhmm(b.at)}` : `${days} 天后 ${hhmm(b.at)}`;
    return `下一场面试：${b.company} ${b.round}（${when}）`;
  },

  /** 是否已至少有一个投递同步到待办 —— 决定提醒提示文案 */
  hasScheduledReminder(): boolean {
    return loadApps().some((a) => !!a.linkedTodoId);
  },

  refreshGrid() {
    if (this.data.view === 'month') {
      const grid = this.buildMonthGrid(this.data.year, this.data.month);
      const title = `${this.data.year} 年 ${this.data.month + 1} 月`;
      this.setData({ grid, title });
    } else {
      this.buildWeek();
    }
  },

  buildWeek() {
    const sel = new Date(this.data.selectedKey.replace(/-/g, '/'));
    const day = sel.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day; // 以周一为起点
    const week: DayCell[] = [];
    const marks = this.marksByDay();
    const todayKey = dateKey(new Date());
    for (let i = 0; i < 7; i++) {
      const d = new Date(sel);
      d.setDate(sel.getDate() + mondayOffset + i);
      week.push(this.makeCell(d, marks, todayKey, true));
    }
    const p = (n: number) => String(n).padStart(2, '0');
    const wk = `${sel.getFullYear()}-${p(sel.getMonth() + 1)}-${p(sel.getDate())}`;
    this.setData({ week, weekKey: wk, title: `本周（周一 ${week[0].key}）` });
  },

  onPrev() {
    if (this.data.view === 'month') {
      let { year, month } = this.data;
      month -= 1; if (month < 0) { month = 11; year -= 1; }
      this.setData({ year, month }, () => this.refreshGrid());
    } else {
      this.shiftWeek(-7);
    }
  },
  onNext() {
    if (this.data.view === 'month') {
      let { year, month } = this.data;
      month += 1; if (month > 11) { month = 0; year += 1; }
      this.setData({ year, month }, () => this.refreshGrid());
    } else {
      this.shiftWeek(7);
    }
  },
  shiftWeek(delta: number) {
    const sel = new Date(this.data.selectedKey.replace(/-/g, '/'));
    sel.setDate(sel.getDate() + delta);
    this.selectDay(dateKey(sel));
  },
  /** 回到今天 */
  goToday() {
    this.selectDay(dateKey(new Date()));
  },

  onCellTap(e: WechatMiniprogram.TouchEvent) {
    this.selectDay(e.currentTarget.dataset.key as string);
  },
  switchView(e: WechatMiniprogram.TouchEvent) {
    this.setData({ view: e.currentTarget.dataset.v as 'month' | 'week' }, () => this.refreshGrid());
  },

  onEventTap(e: WechatMiniprogram.TouchEvent) {
    const appId = e.currentTarget.dataset.id as string;
    if (!appId) return;
    go(`/subpackages/recruit/pages/recruit/detail?id=${appId}`);
  },

  /** 一键把当天未完成的面试标记为已结束（面完顺手收尾） */
  finishInterview(e: WechatMiniprogram.TouchEvent) {
    const appId = e.currentTarget.dataset.id as string;
    const ivId = e.currentTarget.dataset.iv as string;
    const app = getAppById(appId);
    if (!app || !ivId) return;
    app.interviews = ensureInterviews(app).map((it) => (it.id === ivId ? { ...it, done: true } : it));
    upsertApp(app);
    toast('已标记为已结束');
    this.selectDay(this.data.selectedKey);
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '秋招日历 · 笔试面试一览', path: '/subpackages/recruit/pages/recruit/calendar' };
  }
});
