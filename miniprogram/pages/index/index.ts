// pages/index/index.ts
// Phase 3 性能重构版首页
//
// 解决的两个核心问题：
//
//  【一】新建后不实时刷新
//   旧实现把「全量待办（含装饰派生字段）」整体 setData 下发。setData 单次上限 1MB，
//   数据量一上来调用就会抛错，且失败后回调不执行 —— 于是新增的条目根本没有进入视图。
//   现在：数据源在 utils/todo-store（纯 JS 内存），页面只下发「可视窗口内的十几行」，
//   并且新增走乐观插入 + 事件广播，任意页面新建后首页立即出现。
//
//  【二】超大清单卡顿/崩溃
//   1) 虚拟列表：只渲染可视区域 + 上下预渲染，1 万条也只挂 20+ 个节点。
//   2) 分页加载：首屏 60 条秒开，其余在后台按 500 条/批静默补齐。
//   3) 派生字段与排序结果缓存，过滤复用同一份已排序列表。
//   4) 小列表（≤120 条）保留原有卡片视觉；超过则切换为紧凑单行虚拟列表。
import { getThemeState, syncNavBar } from '../../utils/theme';
import { readHomeSkin } from '../../utils/home-skin';
import type { HomeBg, HomeStyle } from '../../utils/home-skin';
import * as store from '../../utils/todo-store';
import { go } from '../../utils/nav';
import type {
  DecoratedTodo,
  FilterKey,
  IAttachment,
  ITodo,
  Priority,
  SearchFilters,
  ThemeKey,
  ViewKey
} from '../../types/index';
import { kaoyanCountdown, nextUpcoming, loadHomeBanner } from '../../utils/important-day-store';

/* ============================ 常量 ============================ */

/** 紧凑虚拟行高（rpx）：固定值才能做虚拟滚动 */
const DENSE_ROW_RPX = 112;
/** 可视区上下额外预渲染行数 */
const OVERSCAN = 8;
/** 超过该条数启用虚拟列表 */
const VIRTUAL_THRESHOLD = store.VIRTUAL_THRESHOLD;
/** 搜索防抖：避免每次击键触发全量过滤 */
const KEYWORD_DEBOUNCE_MS = 250;
/** onShow 刷新节流 */
const REFRESH_THROTTLE_MS = 800;
/** 倒计时刷新间隔 */
const COUNTDOWN_TICK_MS = 30 * 1000;
/** 后台分批数据到达时的重排合并窗口 */
const REBUILD_COALESCE_MS = 120;
/** 滚动窗口更新的最小间隔（毫秒），防止快速滑动时 setData 过密 */
const WINDOW_SETDATA_MIN_GAP = 32;
/** onShow 与 store 同步的节流时间戳 */
let lastRefreshTs = 0;

/* ============================ 类型 ============================ */

/** 紧凑虚拟行：字段裁剪到最小，控制 setData 体积 */
interface DenseRow {
  _id: string;
  content: string;
  completed: boolean;
  priority: string;
  priorityColor: string;
  cdKey: string;
  cdText: string;
  location: string;
  tagText: string;
  __top: number;
}

interface PageData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  /** 舞台背景模式（随主题切换：sunset/aurora/stardust/grid/ink） */
  fxMode: string;
  /** 舞台背景强度 0~10 */
  fxLevel: number;
  /** 舞台场景图路径 */
  fxSrc: string;
  /** 场景图是否全屏 */
  fxFull: boolean;
  /** 场景照片根背景样式 */
  bgStyle: string;
  /** 主页「风格」维度（工艺：圆角/描边/阴影/玻璃质感），与主题正交 */
  homeStyle: HomeStyle;
  /** 主页「背景」维度（氛围装饰层），与风格、主题各自独立 */
  homeBg: HomeBg;
  /** 非虚拟模式：完整装饰列表（仅 ≤120 条时使用） */
  todos: DecoratedTodo[];
  /** 今日聚焦：最多 3 件 focusToday 待办 */
  focusItems: DecoratedTodo[];
  /** 碎片时间匹配弹层状态 */
  freeOpen: boolean;
  freeMinutes: number;
  freeMatches: DecoratedTodo[];
  freePresets: number[];
  /** 虚拟模式：当前窗口内的紧凑行 */
  windowItems: DenseRow[];
  /** 是否启用虚拟列表 */
  virtual: boolean;
  /** 虚拟列表总高度（px） */
  vTotalHeight: number;
  /** 过滤后的总条数 */
  vCount: number;
  /** 单行高度（px） */
  rowH: number;
  filter: FilterKey;
  filters: SearchFilters;
  keyword: string;
  activeCount: number;
  doneCount: number;
  totalCount: number;
  todayDone: number;
  weekDone: number;
  streak: number;
  emptyTitle: string;
  emptySubtitle: string;
  loading: boolean;
  composerVisible: boolean;
  editingId: string | null;
  tabs: { key: string; icon: string; label: string }[];
  /** 重要日联动：考研倒计时 + 最近的一条重要日 */
  impReady: boolean;
  impKaoyan: { nodeName: string; days: number; dateText: string; weekdayText: string } | null;
  impNext: { title: string; countdownText: string } | null;
}

/** 挂在页面实例上的运行时状态（不参与 setData） */
interface Runtime {
  allView: DecoratedTodo[];
  winStart: number;
  winEnd: number;
  scrollTop: number;
  rowHpx: number;
  viewportH: number;
  lastWinTs: number;
  lastTotalHeight: number;
  unsub: (() => void) | null;
  rebuildTimer: ReturnType<typeof setTimeout> | null;
  countdownTimer: ReturnType<typeof setInterval> | null;
  keywordTimer: ReturnType<typeof setTimeout> | null;
  destroyed: boolean;
}

const BOTTOM_TABS = [
  { key: 'home', icon: '🏠', label: '首页' },
  { key: 'calendar', icon: '📅', label: '日历' },
  { key: 'kanban', icon: '🗂️', label: '看板' },
  { key: 'tools', icon: '🧰', label: '工具' },
  { key: 'templates', icon: '✨', label: '模板' },
  { key: 'settings', icon: '👤', label: '我的' }
];

function rt(p: unknown): Runtime {
  return p as Runtime;
}

/** 装饰对象 → 紧凑行 */
function toDense(t: DecoratedTodo, top: number): DenseRow {
  const tags = t.tags || [];
  return {
    _id: t._id,
    content: t.content,
    completed: !!t.completed,
    priority: t.priority || '',
    priorityColor: t.priorityColor,
    cdKey: t.countdown.key,
    cdText: t.countdown.text,
    location: t.location || '',
    tagText: tags.length ? '#' + tags.slice(0, 2).join(' #') : '',
    __top: top
  };
}

/* ============================ 页面 ============================ */

Page<PageData>({
  data: {
theme: 'light',
  themeStyle: '',
  heroGradient: '',
  fxMode: 'sunset',
  fxLevel: 8,
  fxSrc: '',
  fxFull: false,
  bgStyle: '',
    homeStyle: 'jicha',
    homeBg: 'warm',
    todos: [],
    focusItems: [],
    /** 碎片时间匹配弹层状态 */
    freeOpen: false,
    freeMinutes: 15,
    freeMatches: [] as DecoratedTodo[],
    freePresets: [5, 10, 15, 30],
    windowItems: [],
    virtual: false,
    vTotalHeight: 0,
    vCount: 0,
    rowH: 56,
    filter: 'all',
    filters: {
      keyword: '',
      priority: null,
      location: null,
      person: null,
      tag: null
    },
    keyword: '',
    activeCount: 0,
    doneCount: 0,
    totalCount: 0,
    todayDone: 0,
    weekDone: 0,
    streak: 0,
    emptyTitle: '今天还没有任务',
    emptySubtitle: '给自己安排一点值得完成的事。',
    loading: true,
    composerVisible: false,
    editingId: null,
    tabs: BOTTOM_TABS,
    impReady: false,
    impKaoyan: null,
    impNext: null
  },

  onLoad() {
    const s = rt(this);
    s.allView = [];
    s.winStart = -1;
    s.winEnd = -1;
    s.scrollTop = 0;
    s.viewportH = 0;
    s.rowHpx = 0;
    s.lastWinTs = 0;
    s.lastTotalHeight = -1;
    s.unsub = null;
    s.rebuildTimer = null;
    s.countdownTimer = null;
    s.keywordTimer = null;
    s.destroyed = false;

    this.applyHomeSkinToPage(); // 先同步 homeBg（bgStyle 的 plain 豁免依赖它）
    this.applyThemeToPage();

    // 计算紧凑行高（rpx → px）
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      s.rowHpx = Math.max(24, Math.round((DENSE_ROW_RPX * (info.windowWidth || 375)) / 750));
      s.viewportH = (info.windowHeight || 667) - 220;
    } catch (_e) {
      s.rowHpx = Math.round((DENSE_ROW_RPX * 375) / 750);
      s.viewportH = 460;
    }
    this.setData({ rowH: s.rowHpx });

    // 订阅数据源变化：任意页面的新增/修改都会走到这里
    s.unsub = store.subscribe((e) => {
      if (s.destroyed) return;
      this.onStoreChange(e);
    });

    // 1) 本地分片秒回显（不等网络）
    store.hydrateLocal();
    // 2) 首屏全量对齐 + 后台按分页补齐
    this.refreshData(true);
  },

  onReady() {
    this.measureViewport();
  },

  onShow() {
    this.applyHomeSkinToPage(); // 先同步 homeBg（bgStyle 的 plain 豁免依赖它）
    this.applyThemeToPage();
    // 模板库刚应用过模板：绕过节流立即增量同步，让新待办马上出现在首页
    let tplApplied = false;
    try {
      const tplTs = (wx.getStorageSync('__tplAppliedAt') as number) || 0;
      if (tplTs > lastRefreshTs) {
        tplApplied = true;
        wx.removeStorageSync('__tplAppliedAt');
      }
    } catch {
      /* storage 异常不阻断正常流程 */
    }
    // 短时间反复回到前台时避免重复拉取；跨页返回由 store 事件保证已是最新
    const now = Date.now();
    if (tplApplied || now - lastRefreshTs > REFRESH_THROTTLE_MS) {
      this.refreshData(false); // 增量同步：只取变化过的条目
    } else {
      this.applyFilter();
    }
    // 模板刚应用：store 已乐观插入新待办，立即用当前数据重渲染，确保零延迟可见（不依赖网络同步）
    if (tplApplied) this.applyFilter();
    this.startCountdownTimer();
    this.refreshImpBanner();
  },

  /** 重要日联动：考研倒计时 + 最近的重要日（首页顶部卡片，可在重要日设置里关闭） */
  refreshImpBanner() {
    try {
      if (!loadHomeBanner()) {
        this.setData({ impReady: false } as Record<string, unknown>);
        return;
      }
      const ky = kaoyanCountdown(Date.now());
      // 没设过考研倒计时目标（或已过且无下一节点）→ 首页不显示该卡片
      if (!ky.show) {
        this.setData({ impReady: false } as Record<string, unknown>);
        return;
      }
      const next = nextUpcoming(undefined, Date.now());
      this.setData({
        impReady: true,
        impKaoyan: {
          nodeName: ky.nodeName,
          days: ky.days,
          dateText: ky.dateText,
          weekdayText: ky.weekdayText
        },
        impNext: next ? { title: next.title, countdownText: next.countdownText } : null
      } as Record<string, unknown>);
    } catch {
      this.setData({ impReady: false } as Record<string, unknown>);
    }
  },
  onOpenImportantDay() {
    wx.navigateTo({ url: '/subpackages/toolbox/pages/important-day/important-day' });
  },

  onHide() {
    this.stopCountdownTimer();
  },

  onUnload() {
    const s = rt(this);
    s.destroyed = true;
    this.stopCountdownTimer();
    if (s.rebuildTimer) {
      clearTimeout(s.rebuildTimer);
      s.rebuildTimer = null;
    }
    if (s.keywordTimer) {
      clearTimeout(s.keywordTimer);
      s.keywordTimer = null;
    }
    if (s.unsub) {
      s.unsub();
      s.unsub = null;
    }
  },

  onPullDownRefresh() {
    // 下拉 = 强制与服务端对齐（含剔除已删除项）
    lastRefreshTs = 0;
    store
      .sync(true)
      .then(() => this.applyFilter())
      .catch(() => null)
      .then(() => wx.stopPullDownRefresh());
  },

  /* ==================== 主题 ==================== */

  applyThemeToPage(): void {
    const state = getThemeState();
    if (
      state.theme !== this.data.theme ||
      state.bgStyle !== this.data.bgStyle ||
      (state.theme === 'custom' && state.themeStyle !== this.data.themeStyle)
    ) {
      this.setData({
        theme: state.theme,
        themeStyle: state.themeStyle,
        heroGradient: state.heroGradient,
        fxMode: state.fxMode,
        fxLevel: state.fxLevel,
        fxSrc: state.fxSrc,
        fxFull: state.fxFull,
        // 照片背景无条件跟随主题（homeBg=plain 只关闭 fx-stage 装饰层，不再豁免照片）
        bgStyle: state.bgStyle
      } as unknown as Partial<PageData>);
      // 真机排障锚点：vConsole 里应看到非零长度；为 0 = 主题同步没跑到这里
      console.log('[首页] bgStyle 已同步，长度=', (state.bgStyle || '').length, '主题=', state.theme);
    }
    syncNavBar(state);
  },

  /**
   * 同步主页「风格 + 背景」两个维度。
   * 每次 onShow 都从 storage 现取 —— 设置页改完返回时无需任何跨页通信即可生效。
   * 只有值真的变了才 setData，避免每次切页都触发一次根节点类名重算。
   */
  applyHomeSkinToPage(): void {
    const skin = readHomeSkin();
    const patch: Record<string, string> = {};
    if (skin.style !== this.data.homeStyle) patch['homeStyle'] = skin.style;
    if (skin.bg !== this.data.homeBg) patch['homeBg'] = skin.bg;
    if (Object.keys(patch).length) this.setData(patch as unknown as Partial<PageData>);
  },

  /* ==================== 数据加载 ==================== */

  /**
   * 拉取数据。
   *  force=true → 全量对齐（首屏 / 下拉刷新）；
   *  force=false → 增量同步（回到首页只发 1 次请求，万级数据也不会反复全量拉取）。
   */
  refreshData(force: boolean): void {
    const s = rt(this);
    if (!s.allView.length) this.setData({ loading: true });
    lastRefreshTs = Date.now();
    store
      .sync(force)
      .then(() => {
        if (s.destroyed) return;
        this.setData({ loading: false });
        this.applyFilter();
      })
      .catch(() => {
        if (!s.destroyed) this.setData({ loading: false });
      });
  },

  /** 数据源变化：合并短时间内的多次变更，避免后台分批补齐时反复重排 */
  onStoreChange(e: { type: 'reset' | 'progress' | 'item'; id?: string }): void {
    const s = rt(this);
    if (!s.allView.length && (e.type === 'reset' || e.type === 'progress')) {
      this.setData({ loading: store.size() > 0 ? false : this.data.loading });
    }
    if (e.type === 'item' || e.type === 'reset') {
      // 单条变更 / 整体替换：立即重算，保证「新增后马上可见」
      this.scheduleRebuild(true);
      return;
    }
    this.scheduleRebuild(false);
  },

  scheduleRebuild(immediate: boolean): void {
    const s = rt(this);
    if (immediate) {
      if (s.rebuildTimer) {
        clearTimeout(s.rebuildTimer);
        s.rebuildTimer = null;
      }
      this.applyFilter();
      return;
    }
    if (s.rebuildTimer) return;
    s.rebuildTimer = setTimeout(() => {
      s.rebuildTimer = null;
      if (!s.destroyed) this.applyFilter();
    }, REBUILD_COALESCE_MS);
  },

  /* ==================== 过滤 / 排序 / 渲染 ==================== */

  applyFilter(): void {
    const s = rt(this);
    const d = this.data;
    if (s.keywordTimer) {
      clearTimeout(s.keywordTimer);
      s.keywordTimer = null;
    }

    // store 内部只做 filter（排序结果已缓存），万级数据也只需几毫秒
    s.allView = store.query(d.filter, d.filters, d.keyword);

    const st = store.stats();
    const empty = this.computeEmptyText(d.filter, !!(d.keyword || '').trim(), d.filters);
    const isVirtual = s.allView.length > VIRTUAL_THRESHOLD;
    const patch: Record<string, unknown> = {
      activeCount: st.activeCount,
      doneCount: st.doneCount,
      totalCount: st.totalCount,
      todayDone: st.todayDone,
      weekDone: st.weekDone,
      streak: st.streak,
      emptyTitle: empty.emptyTitle,
      emptySubtitle: empty.emptySubtitle,
      vCount: s.allView.length,
      focusItems: store.focusTodos()
    };
    if (isVirtual !== d.virtual) patch.virtual = isVirtual;
    this.setData(patch);

    if (isVirtual) {
      // 切换进虚拟模式时清空旧的全量数组，释放 setData 里的内存
      if (d.todos.length) this.setData({ todos: [] });
      this.updateWindow(true);
      // 首次进入虚拟模式时重新量一次容器高度，保证可视行数计算准确
      if (!d.virtual) setTimeout(() => this.measureViewport(), 50);
    } else {
      s.winStart = 0;
      s.winEnd = s.allView.length;
      const u: Record<string, unknown> = { todos: s.allView };
      if (d.windowItems.length) u['windowItems'] = [];
      if (d.vTotalHeight !== 0) u['vTotalHeight'] = 0;
      this.setData(u);
    }
  },

  computeEmptyText(
    filter: FilterKey,
    hasKw: boolean,
    filters: SearchFilters
  ): { emptyTitle: string; emptySubtitle: string } {
    if (hasKw || filters.priority || filters.location || filters.person || filters.tag) {
      return { emptyTitle: '没有匹配的任务', emptySubtitle: '试试调整筛选条件' };
    }
    if (filter === 'done') return { emptyTitle: '暂无已完成任务', emptySubtitle: '完成后会在此显示' };
    if (filter === 'archived') return { emptyTitle: '归档为空', emptySubtitle: '完成的任务可手动归档' };
    if (filter === 'active') return { emptyTitle: '全部已完成 🎉', emptySubtitle: '是时候规划下一个目标了' };
    return { emptyTitle: '今天还没有任务', emptySubtitle: '给自己安排一点值得完成的事。' };
  },

  /** 量取滚动容器高度，虚拟列表按它计算可视行数 */
  measureViewport(): void {
    const s = rt(this);
    if (s.destroyed) return;
    wx.createSelectorQuery()
      .select('.list')
      .boundingClientRect((rect) => {
        const r = rect as { height?: number } | null;
        if (r && r.height) {
          s.viewportH = r.height;
          this.updateWindow(true);
        }
      })
      .exec();
  },

  /**
   * 依据 scrollTop 计算渲染窗口。
   * 只有窗口发生变化才 setData，且只下发窗口内的十几行 —— 这是万级列表不卡的关键。
   */
  updateWindow(force: boolean): void {
    const s = rt(this);
    const total = s.allView.length;
    const rowH = s.rowHpx || 56;

    // 小列表：不启用虚拟滚动
    if (total <= VIRTUAL_THRESHOLD) {
      if (force || s.winStart !== 0 || s.winEnd !== total) {
        s.winStart = 0;
        s.winEnd = total;
        this.setData({ todos: s.allView, vCount: total });
      }
      return;
    }

    const vh = s.viewportH || 460;
    let start = Math.floor(Math.max(0, s.scrollTop) / rowH) - OVERSCAN;
    if (start < 0) start = 0;
    if (start > total - 1) start = Math.max(0, total - 1);
    const visible = Math.ceil(vh / rowH) + 1;
    let end = start + visible + OVERSCAN * 2;
    if (end > total) end = total;

    if (!force && start === s.winStart && end === s.winEnd) return;
    // 节流：快速滑动时窗口频繁变化，限制 setData 频率（预渲染量足够覆盖 32ms 的位移）
    const now = Date.now();
    if (!force && now - s.lastWinTs < WINDOW_SETDATA_MIN_GAP && start > 0) return;

    s.lastWinTs = now;
    s.winStart = start;
    s.winEnd = end;

    const rows: DenseRow[] = new Array(end - start);
    for (let i = start; i < end; i++) {
      rows[i - start] = toDense(s.allView[i], i * rowH);
    }
    const totalHeight = total * rowH;
    const u: Record<string, unknown> = { windowItems: rows };
    if (totalHeight !== s.lastTotalHeight) {
      s.lastTotalHeight = totalHeight;
      u['vTotalHeight'] = totalHeight;
    }
    this.setData(u);
  },

  onListScroll(e: WechatMiniprogram.ScrollViewScroll): void {
    const s = rt(this);
    s.scrollTop = (e.detail && e.detail.scrollTop) || 0;
    if (this.data.virtual) this.updateWindow(false);
  },

  /* ==================== 倒计时局部刷新 ==================== */

  startCountdownTimer(): void {
    const s = rt(this);
    if (s.countdownTimer) return;
    s.countdownTimer = setInterval(() => this.tickCountdown(), COUNTDOWN_TICK_MS);
  },

  stopCountdownTimer(): void {
    const s = rt(this);
    if (s.countdownTimer) {
      clearInterval(s.countdownTimer);
      s.countdownTimer = null;
    }
  },

  /** 只对文案真正变化的行做路径级 setData，绝不整列表重渲染 */
  tickCountdown(): void {
    const s = rt(this);
    if (s.destroyed || !s.allView.length) return;
    const changed = store.refreshCountdowns();
    if (!changed.length) return;
    const changedSet = new Set(changed);
    const patch: Record<string, string> = {};

    if (this.data.virtual) {
      const rows = this.data.windowItems;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!changedSet.has(row._id)) continue;
        const it = store.getById(row._id);
        if (!it) continue;
        const dec = store.decorateOf(it);
        patch[`windowItems[${i}].cdText`] = dec.countdown.text;
        patch[`windowItems[${i}].cdKey`] = dec.countdown.key;
      }
    } else {
      const list = this.data.todos;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!changedSet.has(t._id)) continue;
        const it = store.getById(t._id);
        if (!it) continue;
        const dec = store.decorateOf(it);
        patch[`todos[${i}].countdown.text`] = dec.countdown.text;
        patch[`todos[${i}].countdown.key`] = dec.countdown.key;
      }
    }
    if (Object.keys(patch).length) this.setData(patch);
  },

  /** 原生滚动到指定像素（虚拟模式下不经过 setData，避免回流） */
  scrollToPx(top: number, animated: boolean): void {
    try {
      wx.createSelectorQuery()
        .select('.list')
        .node((res) => {
          const node = (res as { node?: { scrollTo?: (o: { top: number; animated: boolean }) => void } })
            ?.node;
          if (node && typeof node.scrollTo === 'function') {
            node.scrollTo({ top: Math.max(0, Math.round(top)), animated });
          }
        })
        .exec();
    } catch (_e) {
      /* 忽略 */
    }
  },

  /** 新建后把新条目滚动到视野内，让「已添加」当前可见 */
  focusItem(id: string): void {
    const s = rt(this);
    const idx = s.allView.findIndex((t) => t._id === id);
    if (idx < 0) return;
    const rowH = s.rowHpx || 56;
    // 非虚拟模式行高不固定，按平均高度估算即可（仅用于把目标滚进视野）
    const per = this.data.virtual ? rowH : 84;
    const target = Math.max(0, idx * per - per);
    s.scrollTop = target;
    if (this.data.virtual) this.updateWindow(true);
    this.scrollToPx(target, true);
  },

  /* ==================== 视图切换 ==================== */

  onChangeView(e: WechatMiniprogram.CustomEvent<{ key: ViewKey }>): void {
    const { key } = e.detail;
    if (key === 'list') return;
    const map: Record<Exclude<ViewKey, 'list'>, string> = {
      calendar: '/pages/calendar/calendar',
      kanban: '/pages/kanban/kanban'
    };
    go(map[key]);
  },

  onChangeTab(e: WechatMiniprogram.CustomEvent<{ key: string }>): void {
    const { key } = e.detail;
    if (key === 'home') return;
    const map: Record<string, string> = {
      calendar: '/pages/calendar/calendar',
      kanban: '/pages/kanban/kanban',
      tools: '/pages/tools/tools',
      templates: '/pages/templates/templates',
      settings: '/pages/settings/settings'
    };
    const url = map[key];
    if (url) go(url);
  },

  /* ==================== 筛选 ==================== */

  onChangeFilter(e: WechatMiniprogram.CustomEvent<{ value: FilterKey }>): void {
    if (e.detail.value === this.data.filter) return;
    this.setData({ filter: e.detail.value }, () => this.applyFilter());
  },

  onChangeKeyword(e: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    const s = rt(this);
    // 输入框回显立即更新（单字段 setData），过滤延迟到停顿后执行
    this.setData({ keyword: e.detail.value });
    if (s.keywordTimer) clearTimeout(s.keywordTimer);
    s.keywordTimer = setTimeout(() => {
      s.keywordTimer = null;
      if (!s.destroyed) this.applyFilter();
    }, KEYWORD_DEBOUNCE_MS);
  },

  onClearFilter(e: WechatMiniprogram.CustomEvent<{ key: keyof SearchFilters }>): void {
    const { key } = e.detail;
    const filters: SearchFilters = { ...this.data.filters, [key]: null };
    this.setData({ filters }, () => this.applyFilter());
  },

  onResetFilters(): void {
    this.setData(
      {
        filters: { keyword: '', priority: null, location: null, person: null, tag: null },
        keyword: ''
      },
      () => this.applyFilter()
    );
  },

  onOpenFilter(e: WechatMiniprogram.CustomEvent<{ key: keyof SearchFilters }>): void {
    const { key } = e.detail;
    if (key === 'priority') {
      this.openPriorityPicker();
    } else if (key === 'location') {
      this.openDistinctPicker('location', '地点');
    } else if (key === 'person') {
      this.openDistinctPicker('person', '人物');
    } else if (key === 'tag') {
      this.openDistinctPicker('tag', '标签');
    }
  },

  openPriorityPicker(): void {
    const items = ['高', '中', '低', '清除筛选'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const idx = res.tapIndex;
        if (idx < 0 || idx > 2) {
          this.setData({ filters: { ...this.data.filters, priority: null } }, () => this.applyFilter());
          return;
        }
        const map: Priority[] = ['high', 'medium', 'low'];
        this.setData({ filters: { ...this.data.filters, priority: map[idx] } }, () => this.applyFilter());
      }
    });
  },

  openDistinctPicker(key: 'location' | 'person' | 'tag', label: string): void {
    const options = store.distinctOptions(key);
    if (!options.length) {
      wx.showToast({ title: `暂无${label}可选，先去添加吧`, icon: 'none' });
      return;
    }
    const list = options.slice(0, 50);
    wx.showActionSheet({
      itemList: [...list, '清除筛选'],
      success: (res) => {
        const idx = res.tapIndex;
        if (idx < 0 || idx >= list.length) {
          this.setData({ filters: { ...this.data.filters, [key]: null } }, () => this.applyFilter());
          return;
        }
        this.setData({ filters: { ...this.data.filters, [key]: list[idx] } }, () => this.applyFilter());
      }
    });
  },

  /* ==================== 任务操作 ==================== */

  onToggle(e: WechatMiniprogram.CustomEvent<{ id: string; completed: boolean }>): void {
    const { id, completed } = e.detail;
    store.toggleTodo(id, !completed);
    if (!completed) this.maybeWheelReward();
  },

  /** 紧凑行内勾选（dataset 取 id） */
  onToggleRow(e: WechatMiniprogram.TouchEvent): void {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const it = store.getById(id);
    if (!it) return;
    store.toggleTodo(id, !it.completed);
    if (!it.completed) this.maybeWheelReward();
  },

  /**
   * 待办完成彩蛋：连续完成 5 条待办 → 引导转一次幸运转盘。
   * 计数只落在本地 storage（key 与转盘模块共用），不 import 分包代码，
   * 避免主包被分包拖大。可在转盘设置里关闭。
   */
  maybeWheelReward(): void {
    try {
      const key = 'todo_app_wheel_reward';
      const raw = (wx.getStorageSync(key) || {}) as { combo?: number; day?: string; off?: boolean };
      if (raw.off) return;
      const today = new Date().toDateString();
      // 跨天重新计数
      const combo = (raw.day === today ? Number(raw.combo) || 0 : 0) + 1;
      wx.setStorageSync(key, { combo, day: today, off: false });
      if (combo % 5 !== 0) return;
      wx.showModal({
        title: '奖励你转一次转盘',
        content: '连完成 5 个待办了，休息一下，转个幸运转盘领个小奖励？',
        confirmText: '去转转',
        cancelText: '不用了',
        success: (res) => {
          if (res.confirm) {
            go('/subpackages/tools/pages/wheel/index?reward=1', { title: '万能转盘', loading: '正在进入' });
          }
        }
      });
    } catch (e) {
      /* 彩蛋失败不影响主流程 */
    }
  },

  onOpenDetail(e: WechatMiniprogram.CustomEvent<{ id: string }> | WechatMiniprogram.TouchEvent): void {
    const detail = (e as WechatMiniprogram.CustomEvent<{ id: string }>).detail;
    const id = (detail && detail.id) || (e.currentTarget && (e.currentTarget.dataset.id as string));
    if (!id) return;
    go(`/pages/detail/detail?id=${id}`);
  },

  /** 打开「碎片时间」匹配弹层，默认按 15 分钟匹配 */
  onOpenFree(): void {
    const matches = store.matchFreeTime(this.data.freeMinutes);
    this.setData({ freeOpen: true, freeMatches: matches });
  },
  onCloseFree(): void {
    this.setData({ freeOpen: false });
  },
  onPickFree(e: WechatMiniprogram.TouchEvent): void {
    const min = Number(e.currentTarget.dataset.min) || 15;
    const matches = store.matchFreeTime(min);
    this.setData({ freeMinutes: min, freeMatches: matches });
  },
  /** 进入年度回忆录页 */
  onOpenYearReview(): void {
    go('/pages/year-review/year-review');
  },

  onEdit(e: WechatMiniprogram.CustomEvent<{ id: string; todo: ITodo }>): void {
    const { id, todo } = e.detail;
    this.setData({ composerVisible: true, editingId: id });
    const comp = (this as unknown as { selectComponent?: (s: string) => unknown }).selectComponent?.(
      '#todo-composer'
    ) as { open?: (p?: unknown) => void } | undefined;
    if (comp && typeof comp.open === 'function') comp.open({ id, todo });
  },

  onDelete(e: WechatMiniprogram.CustomEvent<{ id: string; content: string }>): void {
    const { id, content } = e.detail;
    this.confirmDelete(id, content);
  },

  /** 紧凑虚拟行内的删除按钮（从 dataset 取 id / content） */
  onDeleteRow(e: WechatMiniprogram.TouchEvent): void {
    const ds = ((e.currentTarget && e.currentTarget.dataset) || {}) as {
      id?: string;
      content?: string;
    };
    if (!ds.id) return;
    this.confirmDelete(ds.id, ds.content || '');
  },

  /**
   * 删除确认：本地立即移除并广播，云端失败也不恢复
   * （见 utils/todo-store.removeTodo —— 本地优先 + 删除墓碑）。
   */
  confirmDelete(id: string, content: string): void {
    if (!id) return;
    wx.showModal({
      title: '删除任务',
      content: `确定删除「${this.truncate(content, 24)}」吗？`,
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: (r) => {
        if (!r.confirm) return;
        store.removeTodo(id);
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  onClearCompleted(): void {
    const { doneCount } = this.data;
    if (!doneCount) return;
    wx.showModal({
      title: '清除已完成',
      content: `共有 ${doneCount} 项已完成任务，确定全部清除吗？`,
      confirmText: '清除',
      confirmColor: '#ef4444',
      success: async (r) => {
        if (!r.confirm) return;
        const n = await store.clearCompleted();
        if (n > 0) wx.showToast({ title: `已清除 ${n} 项`, icon: 'success' });
      }
    });
  },

  /* ==================== Composer（新增 / 编辑） ==================== */

  onTapAdd(): void {
    this.setData({ composerVisible: true, editingId: null });
    const comp = (this as unknown as { selectComponent?: (s: string) => unknown }).selectComponent?.(
      '#todo-composer'
    ) as { open?: (p?: unknown) => void } | undefined;
    if (comp && typeof comp.open === 'function') comp.open();
  },

  onComposerCancel(): void {
    this.setData({ composerVisible: false, editingId: null });
  },

  async onComposerSubmit(
    e: WechatMiniprogram.CustomEvent<{
      content: string;
      priority: Priority | null;
      dueDate: number | null;
      location: string | null;
      people: string[];
      tags: string[];
      description: string | null;
      attachments: IAttachment[];
    }>
  ): Promise<void> {
    const payload = e.detail;
    const editingId = this.data.editingId;
    // 先关弹层，反馈零延迟
    this.setData({ composerVisible: false, editingId: null });

    if (editingId) {
      // 编辑：本地立即生效并广播，云端后台确认
      store.updateTodo(editingId, {
        content: payload.content,
        priority: payload.priority,
        dueDate: payload.dueDate,
        location: payload.location,
        people: payload.people,
        tags: payload.tags,
        description: payload.description,
        attachments: Array.isArray(payload.attachments) ? payload.attachments : []
      });
      return;
    }

    // 新增：store 内乐观插入 → 立即广播 → 首页立刻出现新条目（无需手动刷新）
    const created = await store.addTodo({
      content: payload.content,
      priority: payload.priority,
      dueDate: payload.dueDate,
      location: payload.location,
      people: payload.people,
      tags: payload.tags,
      description: payload.description,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : []
    });
    if (!created) return;

    wx.showToast({ title: '已添加', icon: 'success' });
    // 无筛选条件时把新条目滚进视野，确保"看得见"
    const d = this.data;
    const noFilter =
      d.filter === 'all' &&
      !d.keyword &&
      !d.filters.priority &&
      !d.filters.location &&
      !d.filters.person &&
      !d.filters.tag;
    if (noFilter) {
      // 等一次渲染，保证新行已在列表中
      setTimeout(() => this.focusItem(created._id), 60);
    }
  },

  /* ==================== 工具 ==================== */

  truncate(s: string, n: number): string {
    const str = s || '';
    return str.length > n ? str.slice(0, n) + '…' : str;
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '我的待办清单',
      path: '/pages/index/index'
    };
  }
});
