// pages/calendar/calendar.ts
// 日历页：农历 + 法定节假日/调休 + 当日任务
import { callFn, handleError } from '../../utils/cloud';
import * as todoStore from '../../utils/todo-store';
import { buildCalendar, formatYMD, startOfDay } from '../../utils/date';
import { getThemeState, syncNavBar } from '../../utils/theme';
import { getDayMeta, getYearHolidayData, formatHolidayRange } from '../../utils/lunar';
import type { ITodo, ThemeKey } from '../../types/index';
import { go } from '../../utils/nav';
import { datesInMonth, viewsOnDate } from '../../utils/important-day-store';

interface DayCell {
  date: number;
  ymd: string;
  inMonth: boolean;
  isToday: boolean;
  weekday: number;
  /** cell 下方小字：节日名 > 农历（初一显示月名） */
  lunarText: string;
  /** 当天是否有节日（红色显示） */
  isFestival: boolean;
  /** 角标：'休'（法定假日）| '班'（调休上班）| '' */
  badge: string;
  /** 普通双休（周末且非调休班） */
  isWeekend: boolean;
  /** 调休上班 */
  isWork: boolean;
  /** 法定假日 */
  isRest: boolean;
  /** 假期首日（cell 显示天数） */
  isHolidayStart: boolean;
  /** 假期首日显示的放假天数 */
  holidayDays: number;
}

interface DayItem { _id: string; content: string; completed: boolean; priorityColor: string; time?: string }

interface MonthHoliday {
  name: string;
  rangeText: string;
  days: number;
  official: boolean;
  /** 调休上班日期描述 */
  workdayText: string;
}

interface SelectedMeta {
  /** 完整农历：丙午马年 五月初九 */
  lunarFull: string;
  festival: string;
  holidayDesc: string;
  holidayOfficial: boolean;
  /** '休' | '班' | '' */
  badge: string;
  badgeText: string;
}

Page<{
  theme: ThemeKey;
  themeStyle: string;
  fxMode: string;
  fxLevel: number;
  fxSrc: string;
  fxFull: boolean;
  bgStyle: string;
  year: number;
  month: number;
  weekdays: string[];
  cells: DayCell[];
  selectedYMD: string;
  selectedDayLabel: string;
  selectedMeta: SelectedMeta;
  monthHolidays: MonthHoliday[];
  countByDate: Record<string, number>;
  dayItems: DayItem[];
  allTodos: ITodo[];
}>({
  data: {
    theme: 'light',
    fxMode: 'sunset',
    fxLevel: 8,
    fxSrc: '',
    fxFull: false,
    bgStyle: '',

    themeStyle: '',
    year: 0, month: 0,
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    cells: [],
    selectedYMD: '',
    selectedDayLabel: '',
    selectedMeta: { lunarFull: '', festival: '', holidayDesc: '', holidayOfficial: true, badge: '', badgeText: '' },
    monthHolidays: [],
    countByDate: {},
    dayItems: [],
    allTodos: []
  },
  onLoad() {
    this.applyThemeToPage();
  },
  onShow() {
    // 主题可能在设置页被修改，每次显示都刷新
    this.applyThemeToPage();
    this.goToday();
    this.loadTodos();
  },
  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient,
      fxMode: state.fxMode,
      fxLevel: state.fxLevel,
      fxSrc: state.fxSrc,
      fxFull: state.fxFull,
      bgStyle: state.bgStyle
    } as Record<string, unknown>);
    syncNavBar(state);
  },
  goToday() {
    const d = new Date();
    this.loadMonth(d.getFullYear(), d.getMonth() + 1);
    this.selectDay(formatYMD(d.getTime()));
  },
  loadMonth(year: number, month: number) {
    const cells: DayCell[] = buildCalendar(year, month).map((c) => {
      const parts = c.ymd.split('-');
      const meta = getDayMeta(Number(parts[0]), Number(parts[1]), Number(parts[2]), c.weekday);
      return {
        ...c,
        lunarText: meta.lunarText,
        isFestival: !!meta.festival,
        badge: meta.badge,
        isWeekend: meta.isWeekend,
        isWork: meta.isWork,
        isRest: meta.isRest,
        isHolidayStart: meta.isHolidayStart,
        holidayDays: meta.holiday ? meta.holiday.days : 0
      };
    });
    this.setData({ year, month, cells, monthHolidays: this.buildMonthHolidays(year, month) }, () => this.recomputeCount());
  },

  /** 本月涉及的假期 + 调休概览（grid 下方展示放假天数与调休排班） */
  buildMonthHolidays(year: number, month: number): MonthHoliday[] {
    const data = getYearHolidayData(year);
    const monPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const result: MonthHoliday[] = [];
    for (const h of data.holidays) {
      const inMonth = h.start.indexOf(monPrefix) === 0 || h.end.indexOf(monPrefix) === 0;
      if (!inMonth) continue;
      result.push({
        name: h.name,
        rangeText: formatHolidayRange(h.start, h.end),
        days: h.days,
        official: data.official,
        workdayText: ''
      });
    }
    // 本月内的调休上班日
    const workdaysThisMonth = data.workdays.filter((ymd) => ymd.indexOf(monPrefix) === 0);
    if (workdaysThisMonth.length > 0) {
      const texts = workdaysThisMonth.map((ymd) => {
        const p = ymd.split('-');
        return `${Number(p[1])}月${Number(p[2])}日`;
      });
      result.push({
        name: '调休上班',
        rangeText: texts.join('、'),
        days: 0,
        official: data.official,
        workdayText: texts.join('、')
      });
    }
    return result;
  },

  recomputeCount() {
    const todos = this.data.allTodos;
    const map: Record<string, number> = {};
    for (const t of todos) {
      if (t.completed || t.archived || !t.dueDate) continue;
      const ymd = formatYMD(t.dueDate);
      map[ymd] = (map[ymd] || 0) + 1;
    }
    // 重要日标记：每月有事件的日期角标 +1
    try {
      const impMap = datesInMonth(this.data.year, this.data.month);
      for (const k in impMap) map[k] = (map[k] || 0) + impMap[k];
    } catch (_e) { /* ignore */ }
    this.setData({ countByDate: map });
  },
  async loadTodos() {
    try {
      await todoStore.ensureLoaded();
      this.setData({ allTodos: todoStore.rawList() }, () => this.recomputeCount());
    } catch (err) {
      handleError(err, '加载失败');
    }
  },
  selectDay(ymd: string) {
    const dayTodos = this.data.allTodos
      .filter((t) => !t.archived && t.dueDate && formatYMD(t.dueDate) === ymd)
      .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
    const items: DayItem[] = dayTodos.map((t) => ({
      _id: t._id,
      content: t.content,
      completed: t.completed,
      priorityColor: t.priority === 'high' ? '#ef4444' : t.priority === 'medium' ? '#f59e0b' : t.priority === 'low' ? '#10b981' : '#9ca3af',
      time: t.dueDate ? new Date(t.dueDate).toTimeString().slice(0, 5) : ''
    }));
    const d = new Date(ymd);
    const weekday = this.data.weekdays[d.getDay()];
    const label = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${weekday}`;

    // 农历 + 节假日信息
    const parts = ymd.split('-');
    const meta = getDayMeta(Number(parts[0]), Number(parts[1]), Number(parts[2]), d.getDay());
    let holidayDesc = '';
    if (meta.holiday) {
      holidayDesc = `${meta.holiday.name} · 放假 ${meta.holiday.days} 天（${formatHolidayRange(meta.holiday.start, meta.holiday.end)}）`;
    }
    const selectedMeta: SelectedMeta = {
      lunarFull: meta.lunarFull,
      festival: meta.festival || '',
      holidayDesc,
      holidayOfficial: meta.holiday ? meta.holiday.official : true,
      badge: meta.badge,
      badgeText: meta.badge === '休' ? '法定假日休息' : meta.badge === '班' ? '调休上班日' : ''
    };
    // 重要日：当日事件一并显示在清单里
    let allItems = items;
    try {
      const impViews = viewsOnDate(ymd);
      if (impViews.length) {
        const impItems: DayItem[] = impViews.map((v) => ({
          _id: v.id,
          content: `💖 ${v.title}（${v.countdownText}）`,
          completed: v.status !== 'active',
          priorityColor: v.categoryColor,
          time: v.time
        }));
        allItems = items.concat(impItems);
      }
    } catch (_e) { /* ignore */ }
    this.setData({ selectedYMD: ymd, selectedDayLabel: label, selectedMeta, dayItems: allItems });
  },
  onPrevMonth() {
    let { year, month } = this.data;
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    this.loadMonth(year, month);
  },
  onNextMonth() {
    let { year, month } = this.data;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    this.loadMonth(year, month);
  },
  onToday() {
    this.goToday();
    this.loadTodos();
  },
  onSelectDay(e: WechatMiniprogram.TouchEvent) {
    this.selectDay(e.currentTarget.dataset.ymd as string);
  },
  onOpenTodo(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    go('/pages/detail/detail?id=' + id);
  },
  onAdd() {
    // 默认选中日期作为 dueDate
    const ymd = this.data.selectedYMD || formatYMD(startOfDay(Date.now()));
    go('/pages/index/index?composeDate=' + ymd);
  }
});
