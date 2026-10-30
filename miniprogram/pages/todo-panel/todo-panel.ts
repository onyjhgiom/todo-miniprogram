// pages/todo-panel/todo-panel.ts
// 待办清单（工具中心内）：按「日 / 月 / 年 / 全部」四个时间跨度组织待办。
//
// 与首页待办共用同一份数据（utils/todo-store → callFn('todos')），本页只负责呈现与操作。
//
// 四条硬约束（改动时勿破坏）：
//  1. **零编造**：完成率、剩余件数、四项汇总、近 7 天柱状、分组计数，
//     全部由真实 todos 推导；没有数据就显示 0 与空状态，绝不填示例数字。
//  2. **不新增存储字段**：优先级沿用 priority（high/medium/low），
//     分类复用既有的 tags[0]，时间与到期文案由 dueDate 格式化。
//  3. **本地先改、云端后写**：勾选/删除/改期立刻改本地并刷新界面，
//     云端失败再回滚，避免「点了没反应」。
//  4. **Canvas 只画环**：进度环与页签图标都用 Canvas 2D
//     （小程序不支持内联 SVG），dpr 上限 2、不跑常驻 rAF，仅数据变化时重绘。

import { getThemeState, syncNavBar } from '../../utils/theme';
import { callFn, toast } from '../../utils/cloud';
import * as todoStore from '../../utils/todo-store';
import { loadShell, saveShell } from '../../utils/tool-shell';
import type { ThemeKey, ITodo, Priority } from '../../types/index';
import type { PageStyleKey, BgStyleKey } from '../../utils/tool-shell';
import { go } from '../../utils/nav';

/** 四个时间维度 */
type DimKey = 'day' | 'month' | 'year' | 'all';

interface DimDef {
  key: DimKey;
  label: string;
  /** todo-glyph 组件的图标名 */
  icon: string;
}

const DIMS: DimDef[] = [
  { key: 'day', label: '日待办', icon: 'sun' },
  { key: 'month', label: '月待办', icon: 'month' },
  { key: 'year', label: '年待办', icon: 'year' },
  { key: 'all', label: '全部', icon: 'all' }
];

/** 分类：复用 tags[0]，缺省归入「其他」 */
interface CatDef {
  key: string;
  label: string;
  color: string;
}

const CATS: CatDef[] = [
  { key: '工作', label: '工作', color: '#7B8CD0' },
  { key: '生活', label: '生活', color: '#E0A06A' },
  { key: '学习', label: '学习', color: '#9A86C8' },
  { key: '健康', label: '健康', color: '#62AE93' }
];
const CAT_FALLBACK: CatDef = { key: '其他', label: '其他', color: '#A0A6B8' };

/** 优先级 → 角标文案（颜色在样式表里，不在 WXML 拼色值） */
const PRI_TEXT: Record<Priority, string> = { high: '重要', medium: '', low: '' };

/** 分组 */
type GroupKey = 'late' | 'todo' | 'done';

interface Row {
  _id: string;
  content: string;
  done: boolean;
  /** 到期文案（已含「今天 / 明天 / 逾期 N 天」等人话） */
  dueText: string;
  overdue: boolean;
  /** 弹性逾期：已逾期且为弹性待办（不应标红催促） */
  elastic: boolean;
  /** 已顺延次数（弹性待办达到上限时用于减负提示） */
  snoozeCount: number;
  priorityText: string;
  catLabel: string;
  catColor: string;
  /** 日/月/年角标文案 */
  scopeText: string;
  showScope: boolean;
  /** 该行是否带截止日期（无日期的不显示改期按钮） */
  hasDate: boolean;
}

/** 近 7 天柱状图的一天 */
interface DayBar {
  key: string;
  label: string;
  /** 柱高百分比 0-100 */
  pct: number;
  isToday: boolean;
}

interface Summary {
  pending: number;
  done: number;
  today: number;
  late: number;
}

interface TodoPanelData {
  theme: ThemeKey;
  themeStyle: string;
  pageStyle: PageStyleKey;
  bgStyle: BgStyleKey;
  bgClass: string;
  shellClass: string;
  pagePresets: { key: PageStyleKey; name: string; dot: string }[];
  bgPresets: { key: BgStyleKey; name: string; dot: string }[];
  showStyleSheet: boolean;

  /**
   * 缩放基准单位：窄窗 1rpx（=视口/750，随屏自适应），宽窗固定 0.78px。
   * 由 JS 读真实窗口宽算好后内联到 .tl 上 —— 尺度只此一个来源，
   * 不用 @media（曾两次因媒体查询在真机上误命中而返工）。
   */
  uUnit: string;

  /* 头部 */
  dateText: string;
  greetText: string;
  /** 页签图标的两种描边色（跟随主题，避免在 WXML 里写死色值） */
  accentInk: string;
  muted: string;

  /* 汇总 */
  pct: number;
  todayDone: number;
  todayTotal: number;
  heroHint: string;
  summary: Summary;
  weekTotal: string;
  weekBars: DayBar[];

  /* 下一件事 */
  focusRow: Row | null;
  focusTag: string;
  focusWhen: string;

  /* 页签 */
  dims: DimDef[];
  activeDim: DimKey;
  /** 当前页签序号，驱动指示器位移 */
  tabIndex: number;
  dimBadges: Record<string, number>;
  secTitle: string;
  secCount: string;
  /** 今日聚焦：最多 3 件 focusToday 待办 */
  focusList: Row[];
  focusMax: number;
  /** 低负反馈：连续低完成率时给出的减负提示（空则不显示） */
  lowFeedback: string;

  /* 列表 */
  groups: { key: GroupKey; title: string; count: number; rows: Row[] }[];
  showDoneGroup: boolean;
  openId: string;
  loading: boolean;

  /* 新建弹层 */
  showComposer: boolean;
  quickText: string;
  scopeOptions: { key: DimKey; label: string }[];
  dueOptions: { key: string; label: string }[];
  catOptions: CatDef[];
  priOptions: { key: Priority; label: string }[];
  pickScope: DimKey;
  pickDue: string;
  pickCat: string;
  pickPri: Priority;
  pickTime: string;

  /* Toast */
  toastText: string;
  canUndo: boolean;
}

type Ctx = WechatMiniprogram.CanvasRenderingContext;

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function isoOf(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 毫秒差 → 整天数（正数表示未来） */
function diffDays(aTs: number, bTs: number): number {
  return Math.round((startOfDay(new Date(aTs)) - startOfDay(new Date(bTs))) / 86400000);
}

/** Toast 里的短标题，超长截断加省略号 */
function shortTitle(s: string): string {
  return s.length > 10 ? s.slice(0, 10) + '…' : s;
}

/**
 * 版式基准（替代 @media）。
 * 尺度由 JS 读真实窗口宽决定并内联到 .tl 上，不依赖任何媒体特性。
 */
function layoutScale(windowWidth: number): string {
  const w = windowWidth > 0 ? windowWidth : 375;
  return w >= 700 ? '0.78px' : '1rpx';
}

Page<TodoPanelData>({
  data: {
    theme: 'light',
    themeStyle: '',
    pageStyle: 'glass',
    bgStyle: 'aurora',
    bgClass: '',
    shellClass: '',
    pagePresets: [],
    bgPresets: [],
    showStyleSheet: false,

    uUnit: '1rpx',

    dateText: '',
    greetText: '',
    accentInk: '#4A4E8C',
    muted: '#8A8DA3',

    pct: 0,
    todayDone: 0,
    todayTotal: 0,
    heroHint: '',
    summary: { pending: 0, done: 0, today: 0, late: 0 },
    weekTotal: '',
    weekBars: [],

    focusRow: null,
    focusTag: '下一件',
    focusWhen: '',

    dims: DIMS,
    activeDim: 'day',
    tabIndex: 0,
    dimBadges: {},
    secTitle: '',
    secCount: '',
    focusList: [],
    focusMax: 3,
    lowFeedback: '',

    groups: [],
    showDoneGroup: false,
    openId: '',
    loading: true,

    showComposer: false,
    quickText: '',
    scopeOptions: [
      { key: 'day', label: '日' },
      { key: 'month', label: '月' },
      { key: 'year', label: '年' }
    ],
    dueOptions: [],
    catOptions: CATS,
    priOptions: [
      { key: 'low', label: '普通' },
      { key: 'high', label: '重要' }
    ],
    pickScope: 'day',
    pickDue: 'today',
    pickCat: '工作',
    pickPri: 'low',
    pickTime: '',

    toastText: '',
    canUndo: false
  },

  /* ===== 非响应式实例字段：避免每次渲染撑大 diff ===== */
  allTodos: [] as ITodo[],
  ringCtx: null as Ctx | null,
  ringW: 0,
  ringH: 0,
  ringInited: false,
  toastTimer: null as ReturnType<typeof setTimeout> | null,
  /** 删除撤销快照（不进 data，避免整棵列表随快照变化而 diff） */
  undoSnapshot: null as { index: number; todo: ITodo } | null,

  onLoad() {
    const shell = loadShell('tpl');
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.applyTheme();
    this.applyShell(shell.pageStyle, shell.bgStyle);
    this.setData({
      uUnit: layoutScale(info.windowWidth || 375),
      dueOptions: this.buildDueOptions('day')
    });
    this.refresh();
  },

  onReady() {
    this.initRing();
  },

  onShow() {
    this.applyTheme();
    this.applyLayoutScale();
    this.refresh();
  },

  onResize() {
    this.applyLayoutScale();
  },

  onHide() {
    this.hideToast();
  },

  onUnload() {
    this.ringCtx = null;
    this.ringInited = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle });
    syncNavBar(s);
  },

  /** 旋转 / 分屏 / iPad 浮动窗口会改窗口宽，重算一次基准（--u） */
  applyLayoutScale() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const next = layoutScale(info.windowWidth || 375);
      if (next !== this.data.uUnit) {
        this.setData({ uUnit: next });
        // 环按 px 绘制，宽度变了要重画
        if (this.ringInited) this.drawRing();
      }
    } catch (_e) {
      /* 取不到窗口信息就沿用默认值 */
    }
  },

  applyShell(page: PageStyleKey, bg: BgStyleKey) {
    const shell = saveShell('tpl', { pageStyle: page, bgStyle: bg });
    this.setData({
      pageStyle: shell.pageStyle,
      bgStyle: shell.bgStyle,
      shellClass: `tshell-ps-${shell.pageStyle}`,
      bgClass: `tshell-bg-${shell.bgStyle}`,
      pagePresets: [
        { key: 'glass', name: '立体玻璃', dot: '#38bdf8' },
        { key: 'frost', name: '柔雾磨砂', dot: '#a78bfa' },
        { key: 'relief', name: '丝绒浮雕', dot: '#f472b6' }
      ],
      bgPresets: [
        { key: 'none', name: '纯净', dot: '#e2e8f0' },
        { key: 'aurora', name: '极光', dot: '#6366f1' },
        { key: 'mesh', name: '星尘', dot: '#22d3ee' },
        { key: 'halo', name: '暖晖', dot: '#fbbf24' },
        { key: 'lattice', name: '栅格', dot: '#64748b' },
        { key: 'dots', name: '粒子', dot: '#c084fc' }
      ]
    });
  },

  /* ==================== 进度环（Canvas 2D） ==================== */

  initRing() {
    wx.createSelectorQuery()
      .in(this)
      .select('#ringCv')
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) return; // 拿不到节点静默降级，页面其余部分照常
        const canvas = item.node;
        const ctx = canvas.getContext('2d') as Ctx;
        const w = item.width || 88;
        const h = item.height || w;
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const dpr = Math.min(2, info.pixelRatio || 1); // 上限 2，再高只白烧 GPU
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        // 重设尺寸会重置上下文状态，scale 必须在之后
        ctx.scale(dpr, dpr);
        this.ringCtx = ctx;
        this.ringW = w;
        this.ringH = h;
        this.ringInited = true;
        this.drawRing();
      });
  },

  drawRing() {
    const ctx = this.ringCtx;
    if (!ctx) return;
    const w = this.ringW;
    const h = this.ringH;
    const S = Math.min(w, h);
    if (S <= 0) return;

    const cx = w / 2;
    const cy = h / 2;
    const p = Math.max(0, Math.min(100, this.data.pct)) / 100;
    const lw = Math.max(5, S * 0.08); // 线宽对齐参考稿的 7/88
    const r = S / 2 - lw / 2 - S * 0.04;

    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';

    // 轨道
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(113,136,209,.16)';
    ctx.lineWidth = lw;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // 进度弧：主色渐变（与 focus-ring 同族）
    if (p > 0.001) {
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, '#7188C1');
      g.addColorStop(1, '#8EA6E8');
      ctx.strokeStyle = g;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      ctx.stroke();
    }
  },

  /* ==================== 数据推导 ==================== */

  async refresh() {
    try {
      await todoStore.ensureLoaded();
      this.allTodos = todoStore.rawList();
    } catch (_e) {
      this.allTodos = [];
    }
    this.recompute();
  },

  /** 是否逾期：未完成 + 截止时间早于今天零点 */
  isLate(t: ITodo, todayStart: number): boolean {
    return !t.completed && !!t.dueDate && t.dueDate < todayStart;
  },

  /**
   * 四维筛选。
   *   day   —— 今天到期（逾期的单独进「已逾期」分组，故只要 date>=今天）
   *   month —— 本月及以后到期
   *   year  —— 今年内到期
   *   all   —— 所有（含无截止日期）
   * 无 dueDate 的条目只在 all 出现，避免「月待办里混着没日期的」。
   */
  inDim(t: ITodo, dim: DimKey, todayStart: number, monthStart: number, yearStart: number, yearEnd: number): boolean {
    if (dim === 'all') return true;
    if (!t.dueDate) return false;
    if (dim === 'day') return t.dueDate >= todayStart && t.dueDate < todayStart + 86400000;
    if (dim === 'month') return t.dueDate >= monthStart;
    return t.dueDate >= yearStart && t.dueDate < yearEnd;
  },

  /** 展示排序：逾期最前 → 未完成 → 时间早的靠前 */
  sortRows(list: ITodo[]): ITodo[] {
    const now = Date.now();
    return list.slice().sort((a, b) => {
      const la = !a.completed && !!a.dueDate && a.dueDate < now;
      const lb = !b.completed && !!b.dueDate && b.dueDate < now;
      if (la !== lb) return la ? -1 : 1;
      if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
      return (a.dueDate || Number.MAX_SAFE_INTEGER) - (b.dueDate || Number.MAX_SAFE_INTEGER);
    });
  },

  /** 到期文案：转成「逾期 3 天 / 今天 18:00 / 明天 / 10月8日」这类人话 */
  dueLabel(t: ITodo, todayStart: number): string {
    if (!t.dueDate) return '未设截止';
    const d = new Date(t.dueDate);
    const late = !t.completed && t.dueDate < todayStart;
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    const hm = hasTime ? ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '';
    const delta = diffDays(t.dueDate, todayStart);

    if (late) return '逾期 ' + Math.abs(delta) + ' 天';
    if (delta === 0) return '今天' + hm;
    if (delta === 1) return '明天' + hm;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    const base = sameYear ? d.getMonth() + 1 + '月' + d.getDate() + '日' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    return base + hm;
  },

  /** 日/月/年角标文案（按 dueDate 落在哪个跨度决定） */
  scopeTagOf(t: ITodo, todayStart: number): string {
    if (!t.dueDate) return '待定';
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    const yearStart = new Date(today.getFullYear(), 0, 1).getTime();
    const yearEnd = new Date(today.getFullYear() + 1, 0, 1).getTime();
    if (t.dueDate >= todayStart && t.dueDate < todayStart + 86400000) return '日待办';
    if (t.dueDate >= monthStart) return '月待办';
    if (t.dueDate >= yearStart && t.dueDate < yearEnd) return '年待办';
    return '待定';
  },

  toRow(t: ITodo, todayStart: number, showScope: boolean): Row {
    const catKey = (t.tags && t.tags[0]) || '';
    const cat = CATS.find((c) => c.key === catKey) || CAT_FALLBACK;
    const pr = t.priority || 'low';
    return {
      _id: t._id,
      content: t.content,
      done: !!t.completed,
      dueText: this.dueLabel(t, todayStart),
      overdue: this.isLate(t, todayStart),
      elastic: t.rigid === false && this.isLate(t, todayStart),
      snoozeCount: typeof t.snoozeCount === 'number' ? t.snoozeCount : 0,
      priorityText: PRI_TEXT[pr] || '',
      catLabel: cat.label,
      catColor: cat.color,
      scopeText: this.scopeTagOf(t, todayStart),
      showScope,
      hasDate: !!t.dueDate
    };
  },

  /** 分组：已逾期 / 待处理 / 已完成（后者可折叠） */
  buildGroups(list: ITodo[], todayStart: number, dim: DimKey): TodoPanelData['groups'] {
    const showScope = dim === 'all';
    const late = this.sortRows(list.filter((t) => this.isLate(t, todayStart)));
    const todo = this.sortRows(list.filter((t) => !t.completed && !this.isLate(t, todayStart)));
    const done = list
      .filter((t) => t.completed)
      .sort((a, b) => (b.completedTime || b.updateTime || 0) - (a.completedTime || a.updateTime || 0));

    const groups: TodoPanelData['groups'] = [];
    if (late.length) {
      groups.push({
        key: 'late',
        title: '已逾期',
        count: late.length,
        rows: late.map((t) => this.toRow(t, todayStart, showScope))
      });
    }
    if (todo.length) {
      groups.push({
        key: 'todo',
        // 首个分组不重复显示「待处理」标题（区块标题已说明当前维度）
        title: groups.length ? '待处理' : '',
        count: todo.length,
        rows: todo.map((t) => this.toRow(t, todayStart, showScope))
      });
    }
    if (done.length) {
      groups.push({
        key: 'done',
        title: '已完成',
        count: done.length,
        rows: this.data.showDoneGroup ? done.map((t) => this.toRow(t, todayStart, showScope)) : []
      });
    }
    return groups;
  },

  recompute() {
    const list = (this.allTodos || []).filter((t) => !t.archived);
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const yearEnd = new Date(now.getFullYear() + 1, 0, 1).getTime();
    const dim = this.data.activeDim;

    /* ---- 头部问候 ---- */
    const hr = now.getHours();
    const wd = '日一二三四五六'[now.getDay()];
    this.setData({
      dateText: now.getMonth() + 1 + '月' + now.getDate() + '日 · 周' + wd,
      greetText:
        (hr < 6 ? '夜深了' : hr < 12 ? '早上好' : hr < 18 ? '下午好' : '晚上好') +
        '，今天也稳稳推进'
    });

    /* ---- 汇总（进度环 + 四项 + 近 7 天） ---- */
    const todayAll = list.filter(
      (t) => t.dueDate && t.dueDate >= todayStart && t.dueDate < todayStart + 86400000
    );
    const todayDone = todayAll.filter((t) => t.completed).length;
    const pending = list.filter((t) => !t.completed).length;
    const done = list.length - pending;
    const lateAll = list.filter((t) => this.isLate(t, todayStart)).length;
    const left = todayAll.length - todayDone;

    // 近 7 天柱状
    const counts: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const key = isoOf(addDays(now, -i));
      let c = 0;
      for (const t of list) {
        if (!t.completed) continue;
        const at = t.completedTime || t.updateTime || 0;
        if (at && isoOf(new Date(at)) === key) c++;
      }
      counts.push(c);
    }
    const max = Math.max(1, ...counts);
    const weekTotal = counts.reduce((a, b) => a + b, 0);
    const bars: DayBar[] = counts.map((c, i) => ({
      key: 'd' + i,
      label: i === 6 ? '今天' : '周' + '日一二三四五六'[addDays(now, -(6 - i)).getDay()],
      // 0 值也留 6% 高度，保证「今天还没做」也能看出有这一列
      pct: c <= 0 ? 6 : Math.max(18, Math.round((c / max) * 100)),
      isToday: i === 6
    }));

    const summary: Summary = { pending, done, today: left, late: lateAll };
    const pct = todayAll.length ? Math.round((todayDone / todayAll.length) * 100) : 0;
    const heroHint = !todayAll.length
      ? '今天还没有安排，先加一件小事吧'
      : left === 0
      ? '今天的事全部完成了'
      : '还剩 ' + left + ' 件' + (lateAll ? '，另有 ' + lateAll + ' 件已逾期' : '');

    /* ---- 页签角标 + 序号 ---- */
    const dimBadges: Record<string, number> = {};
    DIMS.forEach((d) => {
      dimBadges[d.key] = list.filter(
        (t) => !t.completed && this.inDim(t, d.key, todayStart, monthStart, yearStart, yearEnd)
      ).length;
    });

    /* ---- 分组列表 ---- */
    const items = list.filter((t) => this.inDim(t, dim, todayStart, monthStart, yearStart, yearEnd));
    const groups = this.buildGroups(items, todayStart, dim);
    const tcount = items.filter((t) => !t.completed).length;

    /* ---- 区块标题 ---- */
    const m = now.getMonth() + 1;
    const monthEndTs = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
    const y = now.getFullYear();
    const yearPct = Math.round(((now.getTime() - yearStart) / (yearEnd - yearStart)) * 100);
    let secTitle = '';
    if (dim === 'day') secTitle = '今天到期的任务 · ' + m + '月' + now.getDate() + '日';
    else if (dim === 'month') secTitle = m + ' 月任务 · 本月还剩 ' + Math.max(0, diffDays(monthEndTs, todayStart)) + ' 天';
    else if (dim === 'year') secTitle = y + ' 年任务 · 今年已过 ' + yearPct + '%';
    else secTitle = '全部任务';

    /* ---- 下一件事：今天到期或已逾期、未完成、优先级最高的那条 ---- */
    const cand = this.sortRows(
      list.filter((t) => !t.completed && t.dueDate && t.dueDate < todayStart + 86400000)
    )[0];
    const focusRow = cand ? this.toRow(cand, todayStart, false) : null;

    /* ---- 今日聚焦：最多 3 件 focusToday 待办 ---- */
    const focusList = todoStore
      .focusTodos()
      .map((t) => this.toRow(t, todayStart, false))
      .slice(0, 3);

    /* ---- 低负反馈：刚顺延满 3 次的弹性待办，温柔地问一句要不要放下 ---- */
    const snoozeMaxed = list.filter(
      (t) => !t.completed && t.rigid === false && typeof t.snoozeCount === 'number' && t.snoozeCount >= 3
    );
    const lowFeedback = snoozeMaxed.length
      ? '有 ' + snoozeMaxed.length + ' 件事一直没做，要不要先放一放？留着它们只会让自己更累。'
      : '';

    this.setData({
      pct,
      todayDone,
      todayTotal: todayAll.length,
      heroHint,
      summary,
      weekTotal: '共 ' + weekTotal + ' 件',
      weekBars: bars,
      focusRow,
      focusTag: focusRow ? (focusRow.overdue ? '先补上这件' : '下一件') : '下一件',
      focusWhen: focusRow ? (focusRow.overdue ? '已逾期' : focusRow.dueText.replace(/^今天 ?/, '')) : '',
      focusList,
      lowFeedback,
      dimBadges,
      secTitle,
      secCount: tcount + ' 项待处理',
      tabIndex: Math.max(0, DIMS.findIndex((d) => d.key === dim)),
      groups,
      loading: false
    });

    // 数据变了才重绘环
    if (this.ringInited) this.drawRing();
  },

  /* ==================== 交互 ==================== */

  onDim(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '') as DimKey;
    if (!key || key === this.data.activeDim) return;
    this.setData({ activeDim: key, openId: '', showDoneGroup: false }, () => this.recompute());
  },

  /** 展开某行的操作工具栏 */
  onToggleTools(e: WechatMiniprogram.TouchEvent) {
    const id = String((e.currentTarget.dataset as { id?: string }).id || '');
    this.setData({ openId: this.data.openId === id ? '' : id });
  },

  /** 勾选完成/恢复 */
  async onToggle(e: WechatMiniprogram.TouchEvent) {
    const id = String((e.currentTarget.dataset as { id?: string }).id || '');
    await this.applyToggle(id);
  },

  /** 下一件事卡片上的快捷完成 */
  async onToggleFocus() {
    const id = this.data.focusRow && this.data.focusRow._id;
    if (!id) return;
    await this.applyToggle(id);
  },

  /** 聚焦区：从「今日聚焦」移除某件（取消 focusToday） */
  async onUnfocus(e: WechatMiniprogram.TouchEvent) {
    const id = String((e.currentTarget.dataset as { id?: string }).id || '');
    if (!id) return;
    try {
      await todoStore.updateTodo(id, { focusToday: false }, true);
      this.recompute();
    } catch (err) {
      console.warn('[todo-panel] 取消聚焦失败', err);
    }
  },

  /** 低负反馈提示关闭 */
  onLowFeedbackClose() {
    this.setData({ lowFeedback: '' });
  },

  /** 本地先改立刻响应，云端失败回滚 */
  async applyToggle(id: string) {
    const target = (this.allTodos || []).find((t) => t._id === id);
    if (!target) return;
    const next = !target.completed;
    const prevTime = target.completedTime;

    target.completed = next;
    target.completedTime = next ? Date.now() : null;
    target.updateTime = Date.now();
    this.recompute();

    try {
      await callFn('todos', { action: 'toggle', id, completed: next });
      this.showToast(next ? '已完成 ✓' : '已恢复为待办');
    } catch (_e) {
      target.completed = !next;
      target.completedTime = prevTime;
      this.recompute();
      toast('操作失败，已恢复');
    }
  },

  /** 推迟一天：逾期项先挪到今天，否则顺延一天 */
  async onPostpone(e: WechatMiniprogram.TouchEvent) {
    const id = String((e.currentTarget.dataset as { id?: string }).id || '');
    const t = (this.allTodos || []).find((x) => x._id === id);
    if (!t) return;
    const todayStart = startOfDay(new Date());
    const base = t.dueDate && t.dueDate < todayStart ? todayStart : t.dueDate || todayStart;
    const nextDue = addDays(new Date(base), 1).getTime();
    const prev = t.dueDate;

    t.dueDate = nextDue;
    t.updateTime = Date.now();
    this.setData({ openId: '' });
    this.recompute();

    try {
      await callFn('todos', { action: 'update', id, patch: { dueDate: nextDue } });
      this.showToast(nextDue <= todayStart ? '已移到今天' : '已推迟一天');
    } catch (_e) {
      t.dueDate = prev;
      this.recompute();
      toast('操作失败，已恢复');
    }
  },

  /**
   * 删除：本地先移除并给「撤销」提示，云端失败自动回滚。
   * 撤销时用 add 补写（云函数 add 不接受自定义 _id，
   * 所以本地保留原 _id 让列表不跳动；云端会拿到新 id，后续同步以云端为准）。
   */
  async onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = String((e.currentTarget.dataset as { id?: string }).id || '');
    const idx = (this.allTodos || []).findIndex((x) => x._id === id);
    if (idx < 0) return;
    const removed = this.allTodos[idx];

    this.undoSnapshot = { index: idx, todo: removed };
    this.allTodos.splice(idx, 1);
    this.setData({ openId: '' });
    this.recompute();
    this.showToast('已删除「' + shortTitle(removed.content) + '」', true);

    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      // 撤销窗口结束，锁定快照
      this.undoSnapshot = null;
      this.setData({ canUndo: false });
    }, 4000);

    try {
      await callFn('todos', { action: 'delete', id });
    } catch (_e) {
      this.restoreDeleted();
      toast('删除失败，已恢复');
    }
  },

  /** 把删掉的那条放回原位 */
  restoreDeleted(): boolean {
    const snap = this.undoSnapshot;
    if (!snap) return false;
    this.allTodos.splice(Math.min(snap.index, this.allTodos.length), 0, snap.todo);
    this.undoSnapshot = null;
    this.recompute();
    return true;
  },

  /** 撤销删除：本地放回并补一次云端写入 */
  onUndo() {
    const snap = this.undoSnapshot;
    if (!snap) {
      this.hideToast();
      return;
    }
    this.undoSnapshot = null;
    this.allTodos.splice(Math.min(snap.index, this.allTodos.length), 0, snap.todo);
    this.recompute();
    this.hideToast();
    toast('已撤销');
    const t = snap.todo;
    callFn('todos', {
      action: 'add',
      content: t.content,
      dueDate: t.dueDate || null,
      priority: t.priority || 'low',
      tags: t.tags && t.tags.length ? t.tags : []
    }).catch(() => {
      /* 补写失败：下次进页面会从云端重新拉取，以云端为准 */
    });
  },

  onOpenDetail(e: WechatMiniprogram.TouchEvent) {
    const id = String((e.currentTarget.dataset as { id?: string }).id || '');
    if (!id) return;
    go(`/pages/detail/detail?id=${id}`);
  },

  /* ==================== 外观 ==================== */

  toggleStyleSheet() {
    this.setData({ showStyleSheet: !this.data.showStyleSheet });
  },
  onStyleSheetStop() {
    /* 阻止点面板内部时穿透到遮罩 */
  },
  onPageStyle(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as PageStyleKey;
    if (!key || key === this.data.pageStyle) return;
    this.applyShell(key, this.data.bgStyle);
  },
  onBgStyle(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as BgStyleKey;
    if (!key || key === this.data.bgStyle) return;
    this.applyShell(this.data.pageStyle, key);
  },

  /* ==================== 新建 ==================== */

  /** 到期选项随「类型」联动（参考稿同款逻辑） */
  buildDueOptions(scope: DimKey): { key: string; label: string }[] {
    const now = new Date();
    if (scope === 'month') {
      return [
        { key: 'monthEnd', label: '本月底' },
        { key: 'nextMonthEnd', label: '下月底' }
      ];
    }
    if (scope === 'year') {
      return [{ key: 'yearEnd', label: '今年底' }];
    }
    const toSun = (7 - now.getDay()) % 7;
    const opts = [
      { key: 'today', label: '今天' },
      { key: 'tomorrow', label: '明天' }
    ];
    if (toSun > 1) opts.push({ key: 'sunday', label: '本周日' });
    return opts;
  },

  onAddOpen() {
    const scope: DimKey = this.data.activeDim === 'all' ? 'day' : this.data.activeDim;
    this.setData({
      showComposer: true,
      quickText: '',
      pickScope: scope,
      pickDue: scope === 'day' ? 'today' : scope === 'month' ? 'monthEnd' : 'yearEnd',
      pickCat: '工作',
      pickPri: 'low',
      pickTime: '',
      dueOptions: this.buildDueOptions(scope)
    });
  },

  onAddClose() {
    this.setData({ showComposer: false });
  },

  onSheetStop() {
    /* 阻止穿透 */
  },

  onQuickText(e: WechatMiniprogram.InputEvent) {
    this.setData({ quickText: e.detail.value });
  },

  onPickScope(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '') as DimKey;
    if (!key || key === this.data.pickScope) return;
    const opts = this.buildDueOptions(key);
    this.setData({
      pickScope: key,
      pickDue: opts.length ? opts[0].key : '',
      pickTime: '',
      dueOptions: opts
    });
  },

  onPickDue(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '');
    if (key) this.setData({ pickDue: key });
  },

  onPickCat(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '');
    if (key) this.setData({ pickCat: key });
  },

  onPickPri(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '') as Priority;
    if (key) this.setData({ pickPri: key });
  },

  onPickTime(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const v = String((e.detail && e.detail.value) || '');
    this.setData({ pickTime: v });
  },

  /** 把「类型 + 到期 + 时间」三个选择换算成真实 dueDate 时间戳 */
  resolveDue(): number | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = this.data.pickDue;
    let base: Date | null = null;

    if (this.data.pickScope === 'day') {
      if (d === 'today') base = today;
      else if (d === 'tomorrow') base = addDays(today, 1);
      else if (d === 'sunday') base = addDays(today, (7 - now.getDay()) % 7);
    } else if (this.data.pickScope === 'month') {
      if (d === 'monthEnd') base = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      else if (d === 'nextMonthEnd') base = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    } else if (this.data.pickScope === 'year') {
      if (d === 'yearEnd') base = new Date(now.getFullYear(), 11, 31);
    }
    if (!base) return null;

    // 「日待办」带具体时间；其余维度统一落到当天 23:59（表示「这天之前完成」）
    const hm = this.data.pickTime.match(/^(\d{1,2}):(\d{2})$/);
    if (this.data.pickScope === 'day' && hm) {
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Number(hm[1]), Number(hm[2]), 0, 0).getTime();
    }
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 0).getTime();
  },

  async onQuickSave() {
    const content = this.data.quickText.trim();
    if (!content) {
      toast('请输入内容');
      return;
    }
    const dueDate = this.resolveDue();
    try {
      await callFn('todos', {
        action: 'add',
        content,
        dueDate,
        priority: this.data.pickPri,
        tags: [this.data.pickCat]
      });
      this.setData({ showComposer: false, quickText: '' });
      toast('已添加');
      // 新建后跳到能看见它的维度，否则用户会以为没加上
      const target: DimKey = dueDate === null ? 'all' : this.data.pickScope;
      if (this.data.activeDim !== target) this.setData({ activeDim: target });
      this.refresh();
    } catch (_e) {
      toast('添加失败，请重试');
    }
  },

  /* ==================== Toast ==================== */

  showToast(msg: string, canUndo: boolean = false) {
    this.setData({ toastText: msg, canUndo });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (!canUndo) {
      this.toastTimer = setTimeout(() => this.hideToast(), 2000);
    }
  },

  hideToast() {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.data.toastText) this.setData({ toastText: '', canUndo: false });
  }
});