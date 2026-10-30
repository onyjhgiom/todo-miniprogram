// subpackages/travel/pages/trip-detail/trip-detail.ts
// 行程详情：封面 / 天气 / 预算环 / 行李进度 + 按天时间线（拖拽排序 · 左滑操作）+ 地图模式 + 海报分享
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { go } from '../../../../utils/nav';
import * as store from '../../utils/travel-store';
import { syncTripToTodos } from '../../utils/travel-to-todo';
import { COVER_PRESETS } from '../../utils/trip-templates';
import type { ITrip, ITripPlanItem, TripItemType, TripDayGroup } from '../../utils/travel-types';
import type { ThemeKey } from '../../../../types/index';

/** 条目类型 → 图标 */
const TYPE_ICON: Record<TripItemType, string> = {
  交通: '🚆',
  景点: '🎫',
  餐厅: '🍜',
  酒店: '🏨',
  购物: '🛍️',
  自定义: '📌'
};

/** 视图层条目 */
interface ViewItem {
  _id: string;
  day: number;
  icon: string;
  content: string;
  timeText: string;
  durationText: string;
  locationText: string;
  costText: string;
  noteText: string;
  completed: boolean;
  itemType: string;
}

interface ViewDay {
  day: number;
  dateText: string;
  weekdayText: string;
  items: ViewItem[];
  cost: number;
  durationText: string;
}

interface Marker {
  /** 地图组件的 markerId 是 number，这里保持一致便于点击回查 */
  id: number;
  latitude: number;
  longitude: number;
  title: string;
  iconPath?: string;
  width?: number;
  height?: number;
  callout?: { content: string; display: 'ALWAYS' | 'BYCLICK'; padding: number; borderRadius: number };
}

interface Draft {
  _id: string;
  content: string;
  day: number;
  startTime: string;
  duration: string;
  itemType: TripItemType;
  cost: string;
  note: string;
  locationText: string;
  ticketUrl: string;
}

interface TripDetailData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  id: string;
  trip: ITrip | null;
  coverStyle: string;
  coverEmoji: string;
  coverIsImage: boolean;
  dateText: string;
  weekdayText: string;
  countdownText: string;
  dayCount: number;
  memberText: string;
  sceneText: string;

  weatherIcon: string;
  weatherTemp: string;
  weatherText: string;
  weatherTip: string;
  weatherWarning: string;

  budget: number;
  spent: number;
  budgetPercent: number;
  overBudget: boolean;

  packingPercent: number;
  packingText: string;
  packingEssentialLeft: number;

  days: ViewDay[];
  mode: 'timeline' | 'map';
  markers: Marker[];

  /** 左滑 */
  swipeId: string;
  swipeOffset: number;

  /** 拖拽排序 */
  draggingId: string;
  draggingText: string;
  dragY: number;
  dragVisible: boolean;
  dragTargetId: string;

  /** 编辑弹层 */
  showSheet: boolean;
  isNew: boolean;
  draft: Draft | null;
  typeTabs: { key: TripItemType; icon: string; name: string }[];
  dayTabs: number[];

  /** 清单联动建议 */
  suggestions: string[];
  /** 当前展开的分组（-1 表示全展开） */
  collapsedDays: number[];
}

function durationText(min: number): string {
  const m = Number(min) || 0;
  if (m <= 0) return '';
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
}

function toViewItem(it: ITripPlanItem): ViewItem {
  return {
    _id: it._id,
    day: it.day,
    icon: TYPE_ICON[it.itemType] || '📌',
    content: it.content,
    timeText: it.startTime || '--:--',
    durationText: durationText(it.duration),
    locationText: it.location ? it.location.name : '',
    costText: (Number(it.cost) || 0) > 0 ? `¥${it.cost}` : '',
    noteText: it.note || '',
    completed: !!it.completed,
    itemType: it.itemType
  };
}

function toViewDay(g: TripDayGroup): ViewDay {
  return {
    day: g.day,
    dateText: g.dateText,
    weekdayText: g.weekdayText,
    items: g.items.map(toViewItem),
    cost: g.cost,
    durationText: durationText(g.duration)
  };
}

/**
 * 左滑操作区宽度（px）。与 wxss 里 .tl__swipe 的 240rpx 对应：
 * 240rpx 在 375pt 宽的屏上 = 120px，这里按 px 计算位移，避免 px/rpx 混用导致手感减半。
 */
const SWIPE_W = 120;

/** 拖拽命中判定用的行信息 */
interface RowRect {
  id: string;
  day: number;
  index: number;
  top: number;
  height: number;
}

Page<TripDetailData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    id: '',
    trip: null,
    coverStyle: '',
    coverEmoji: '',
    coverIsImage: false,
    dateText: '',
    weekdayText: '',
    countdownText: '',
    dayCount: 0,
    memberText: '',
    sceneText: '',
    weatherIcon: '☀️',
    weatherTemp: '--',
    weatherText: '',
    weatherTip: '',
    weatherWarning: '',
    budget: 0,
    spent: 0,
    budgetPercent: 0,
    overBudget: false,
    packingPercent: 0,
    packingText: '0/0',
    packingEssentialLeft: 0,
    days: [],
    mode: 'timeline',
    markers: [],
    swipeId: '',
    swipeOffset: 0,
    draggingId: '',
    draggingText: '',
    dragY: 0,
    dragVisible: false,
    dragTargetId: '',
    showSheet: false,
    isNew: false,
    draft: null,
    typeTabs: [
      { key: '交通', icon: '🚆', name: '交通' },
      { key: '景点', icon: '🎫', name: '景点' },
      { key: '餐厅', icon: '🍜', name: '餐厅' },
      { key: '酒店', icon: '🏨', name: '酒店' },
      { key: '购物', icon: '🛍️', name: '购物' },
      { key: '自定义', icon: '📌', name: '自定义' }
    ],
    dayTabs: [],
    suggestions: [],
    collapsedDays: []
  },

  /** 拖拽行几何信息（页面坐标） */
  rowRects: [] as RowRect[],
  dragStartY: 0,
  touchStartX: 0,
  touchStartY: 0,

  onLoad(q: Record<string, string>) {
    this.applyTheme();
    const id = (q && q.id) || '';
    if (!id) {
      toast('缺少行程 id', 'none');
      return;
    }
    this.setData({ id });
    this.refresh();
    this.unsub = store.subscribe(() => this.refresh());
    void store.pullFromCloud().then(() => this.refresh());
    void this.loadWeather();
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  onShow() {
    this.applyTheme();
    if (this.data.id) this.refresh();
  },

  unsub: null as (() => void) | null,

  applyTheme() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient
    });
    syncNavBar(state);
  },

  refresh() {
    const trip = store.getTrip(this.data.id);
    if (!trip) return;
    const cov = COVER_PRESETS.find((p) => p.key === trip.cover);
    const card = store.tripCard(trip);
    const prog = store.packingProgress(trip._id);
    const days = store.dayGroups(trip._id).map(toViewDay);
    const startTs = store.parseDate(trip.startDate);
    const left = store.diffDays(store.todayStart(), startTs);

    this.setData({
      trip,
      coverStyle: cov ? `background:${cov.gradient}` : '',
      coverEmoji: cov ? cov.emoji : '',
      coverIsImage: !cov && !!trip.cover,
      dateText: `${trip.startDate} ~ ${trip.endDate}`,
      weekdayText: '',
      countdownText: card.countdownText,
      dayCount: card.totalDays,
      memberText: trip.members && trip.members.length ? trip.members.join('、') : '独自出行',
      sceneText: trip.scenes && trip.scenes.length ? trip.scenes.join(' · ') : '未设场景',
      budget: Number(trip.budget) || 0,
      spent: card.spentCost,
      budgetPercent: card.budgetPercent,
      overBudget: card.overBudget,
      packingPercent: prog.percent,
      packingText: `${prog.packed}/${prog.total}`,
      packingEssentialLeft: prog.essentialLeft,
      days,
      dayTabs: days.map((d) => d.day),
      markers: buildMarkers(trip._id),
      suggestions: store.suggestPacking(trip._id)
    });
    this.drawBudgetRing(card.budgetPercent, card.overBudget);
  },

  async loadWeather() {
    const trip = store.getTrip(this.data.id);
    if (!trip) return;
    const w = await store.fetchWeather(trip.destination, trip.startDate);
    this.setData({
      weatherIcon: w.icon,
      weatherTemp: w.temp,
      weatherText: w.text,
      weatherTip: w.tip,
      weatherWarning: w.warning
    });
  },

  /** 预算进度环（canvas 2d 绘制） */
  drawBudgetRing(percent: number, over: boolean) {
    const q = wx.createSelectorQuery();
    q.select('#budgetRing')
      .fields({ node: true, size: true })
      .exec((res: unknown) => {
        const r = (res as { node?: unknown; width?: number; height?: number }[]) || [];
        const info = r[0];
        if (!info || !info.node) return;
        const canvas = info.node as WechatMiniprogram.Canvas;
        const ctx = canvas.getContext('2d');
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : (wx.getSystemInfoSync().pixelRatio || 2)) as number;
        const w = info.width || 72;
        const h = info.height || 72;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 5;

        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(158, 147, 132, 0.28)';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        const p = Math.max(0, Math.min(1, percent / 100));
        ctx.strokeStyle = over ? '#C0522F' : '#B5714C';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        ctx.stroke();

        ctx.fillStyle = over ? '#C0522F' : '#35302A';
        ctx.font = '600 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${percent}%`, cx, cy);
      });
  },

  /* ============================ 顶部操作 ============================ */

  onOpenPacking() {
    go(`/subpackages/travel/pages/packing/packing?id=${this.data.id}`, { title: '行李清单' });
  },

  onEditTrip() {
    go(`/subpackages/travel/pages/trip-edit/trip-edit?id=${this.data.id}`, { title: '编辑行程' });
  },

  onOpenSummary() {
    go(`/subpackages/travel/pages/trip-summary/trip-summary?id=${this.data.id}`, { title: '旅行复盘' });
  },

  /** 把本行程的行程项同步到首页普通待办清单（带去重） */
  async onSyncToTodo() {
    const trip = this.data.trip;
    if (!trip) return;
    wx.showLoading({ title: '同步中', mask: true });
    try {
      const r = await syncTripToTodos(this.data.id);
      wx.hideLoading();
      if (r.added > 0) {
        wx.showModal({
          title: '已同步到首页待办',
          content: r.message + '\n\n回到首页「全部/按日期」即可看到这些行程安排。',
          showCancel: true,
          cancelText: '留在当前',
          confirmText: '去首页',
          success: (res) => {
            if (res.confirm) {
              // 本小程序没有 tabBar，switchTab 只能跳 tabBar 页 → 必然失败，
              // 白白多绕一次路由（还会连带触发 nav 层兜底，短时间内连发多次路由）。
              // 统一走 nav 层，由它处理栈深预检与三级兜底。
              go('/pages/index/index', { title: '待办' });
            }
          }
        });
      } else {
        toast(r.message, 'none');
      }
    } catch (e) {
      wx.hideLoading();
      toast('同步失败，请稍后再试', 'none');
    }
  },

  onToggleMode() {
    const mode = this.data.mode === 'timeline' ? 'map' : 'timeline';
    this.setData({ mode });
    if (mode === 'map' && this.data.markers.length === 0) {
      toast('还没有带坐标的地点，先在条目里选点', 'none');
    }
  },

  onMarkerTap(e: WechatMiniprogram.TouchEvent) {
    const id = Number((e.detail as { markerId?: string | number }).markerId);
    const mk = this.data.markers.find((m) => m.id === id);
    if (mk) toast(mk.title, 'none');
  },

  /** 订阅行程提醒 */
  async onSubscribe() {
    const ok = await store.requestTripSubscribe();
    if (ok) {
      toast('已授权，出发前会收到提醒', 'success');
      void store.pushTripReminder(this.data.id, 'packing');
    } else {
      toast('未授权，可在行程内手动查看', 'none');
    }
  },

  /* ============================ 条目操作 ============================ */

  onToggleCollapse(e: WechatMiniprogram.TouchEvent) {
    const day = Number(e.currentTarget.dataset.day);
    const cur = this.data.collapsedDays;
    const next = cur.indexOf(day) >= 0 ? cur.filter((d) => d !== day) : cur.concat([day]);
    this.setData({ collapsedDays: next });
  },

  onAddItem(e: WechatMiniprogram.TouchEvent) {
    const day = Number(e.currentTarget.dataset.day) || 1;
    this.openSheet(null, day);
  },

  onAddQuick() {
    // 追加到最后一天末尾
    const day = this.data.dayCount || 1;
    this.openSheet(null, day);
  },

  /** 点击条目 → 编辑 */
  onTapItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (this.data.swipeId) {
      this.setData({ swipeId: '', swipeOffset: 0 });
      return;
    }
    const raw = store.listItems(this.data.id).find((it) => it._id === id);
    if (!raw) return;
    this.openSheet(raw, raw.day);
  },

  /* ---------- 左滑 ---------- */
  onItemTouchStart(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0];
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
  },

  onItemTouchMove(e: WechatMiniprogram.TouchEvent) {
    // 正在拖拽排序时，手势归拖拽处理，别再触发左滑
    if (this.data.draggingId) return;
    const t = e.touches[0];
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;
    // 纵向手势交给拖拽，只有明确的横向手势才走左滑
    if (Math.abs(dy) > Math.abs(dx)) return;
    const id = e.currentTarget.dataset.id as string;
    // 单位统一用 px（与 transform:translateX(px) 对应）：
    // 操作区宽 SWIPE_W，最大只能推到 SWIPE_W
    const offset = Math.max(-SWIPE_W, Math.min(0, dx));
    if (this.data.swipeId && this.data.swipeId !== id) {
      // 换一条时先收起上一条
      this.setData({ swipeId: id, swipeOffset: offset });
      return;
    }
    this.setData({ swipeId: id, swipeOffset: offset });
  },

  /** 松手：划过 1/3 就吸附展开，否则弹回 */
  onItemTouchEnd() {
    const keep = this.data.swipeOffset < -SWIPE_W / 3;
    this.setData({
      swipeOffset: keep ? -SWIPE_W : 0,
      swipeId: keep ? this.data.swipeId : ''
    });
  },

  onSwipeDone(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const raw = store.listItems(this.data.id).find((it) => it._id === id);
    this.setData({ swipeId: '', swipeOffset: 0 });
    if (raw) void store.toggleTripItem(id, !raw.completed);
  },

  onSwipeCopy(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ swipeId: '', swipeOffset: 0 });
    const names = this.data.days.map((d) => `第 ${d.day} 天`);
    wx.showActionSheet({
      itemList: names,
      success: (res) => {
        const day = this.data.days[res.tapIndex].day;
        void store.copyItemToDay(id, day).then(() => toast(`已复制到第 ${day} 天`, 'success'));
      },
      fail: () => {
        /* 取消 */
      }
    });
  },

  onSwipeDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ swipeId: '', swipeOffset: 0 });
    const raw = store.listItems(this.data.id).find((it) => it._id === id);
    wx.showModal({
      title: '删除安排',
      content: `确认删除「${raw ? raw.content : '该安排'}」？`,
      confirmColor: '#C0522F',
      success: (m) => {
        if (!m.confirm) return;
        void store.removeTripItem(id).then(() => toast('已删除', 'success'));
      }
    });
  },

  /* ---------- 长按拖拽 ---------- */
  onItemLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const raw = store.listItems(this.data.id).find((it) => it._id === id);
    if (!raw) return;
    this.measureRows();
    this.setData({ draggingId: id, draggingText: raw.content, dragVisible: true, dragY: 0, dragTargetId: '' });
    wx.vibrateShort({ type: 'light', fail: () => {} });
  },

  /** 量出每一行的屏幕坐标，供拖拽命中判定 */
  measureRows() {
    const flat: { id: string; day: number; index: number }[] = [];
    this.data.days.forEach((d) => {
      d.items.forEach((it, i) => flat.push({ id: it._id, day: d.day, index: i }));
    });
    const q = wx.createSelectorQuery();
    q.selectAll('.tl-row').boundingClientRect((rects: unknown) => {
      const arr = (rects as { top: number; height: number }[]) || [];
      const rows: RowRect[] = [];
      for (let i = 0; i < arr.length && i < flat.length; i += 1) {
        rows.push({ ...flat[i], top: arr[i].top, height: arr[i].height });
      }
      this.rowRects = rows;
    });
    q.exec();
  },

  onPageTouchMove(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.draggingId) return;
    const y = e.touches[0].clientY;
    const hit = this.rowRects.find((r) => y >= r.top && y < r.top + r.height);
    this.setData({ dragY: y - 60, dragTargetId: hit ? hit.id : '' });
  },

  onPageTouchEnd() {
    if (!this.data.draggingId) return;
    const dragId = this.data.draggingId;
    const targetId = this.data.dragTargetId;
    this.setData({ draggingId: '', dragVisible: false, dragTargetId: '', dragY: 0 });
    if (!targetId || targetId === dragId) return;

    const flat = this.rowRects;
    const from = flat.find((r) => r.id === dragId);
    const to = flat.find((r) => r.id === targetId);
    if (!from || !to) return;

    // 目标天内的落点下标（按「移除被拖项之后」的列表计算，store 会先移除再插入）
    const dayRows = flat.filter((r) => r.day === to.day);
    const draggedInTargetDay = from.day === to.day;
    const targetIdxRaw = dayRows.findIndex((r) => r.id === to.id);
    const draggedIdxRaw = draggedInTargetDay ? dayRows.findIndex((r) => r.id === dragId) : -1;
    let targetIdx = targetIdxRaw;
    if (draggedInTargetDay && draggedIdxRaw < targetIdxRaw) targetIdx -= 1;
    // 同天下移 → 插到目标之后；其余情况插到目标位置
    const insertIdx = draggedInTargetDay && draggedIdxRaw < targetIdxRaw ? targetIdx + 1 : targetIdx;

    void store.moveTripItem(dragId, to.day, insertIdx).then(() => this.refresh());
  },

  /* ============================ 编辑弹层 ============================ */

  openSheet(raw: ITripPlanItem | null, day: number) {
    const draft: Draft = {
      _id: raw ? raw._id : '',
      content: raw ? raw.content : '',
      day: raw ? raw.day : day,
      startTime: raw ? raw.startTime : '09:00',
      duration: raw ? String(raw.duration || 60) : '60',
      itemType: raw ? raw.itemType : '景点',
      cost: raw ? String(raw.cost || 0) : '',
      note: raw ? raw.note || '' : '',
      locationText: raw && raw.location ? raw.location.name : '',
      ticketUrl: raw ? raw.ticketUrl || '' : ''
    };
    this.setData({ showSheet: true, isNew: !raw, draft });
  },

  onCloseSheet() {
    this.setData({ showSheet: false, draft: null });
  },

  onNoop() {
    /* 阻止弹层内的点击穿透 */
  },

  onDraftInput(e: WechatMiniprogram.InputEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!this.data.draft) return;
    const patch: Record<string, string> = {};
    patch[key] = e.detail.value;
    this.setData({ draft: { ...this.data.draft, ...patch } as Draft });
  },

  onDraftType(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as TripItemType;
    if (!this.data.draft) return;
    this.setData({ draft: { ...this.data.draft, itemType: key } });
  },

  onDraftDay(e: WechatMiniprogram.PickerChangeEvent) {
    if (!this.data.draft) return;
    const idx = Number(e.detail.value) || 0;
    this.setData({ draft: { ...this.data.draft, day: this.data.dayTabs[idx] || 1 } });
  },

  onDraftTime(e: WechatMiniprogram.PickerChangeEvent) {
    if (!this.data.draft) return;
    this.setData({ draft: { ...this.data.draft, startTime: e.detail.value as string } });
  },

  onDraftLocation() {
    if (!this.data.draft) return;
    wx.chooseLocation({
      success: (res) => {
        const d = this.data.draft as Draft;
        this.setData({ draft: { ...d, locationText: res.name || res.address || '' } });
        // 记住坐标，保存时一起写入
        this.pickedPlace = {
          name: res.name || '',
          address: res.address || '',
          latitude: res.latitude || 0,
          longitude: res.longitude || 0
        };
      },
      fail: (err) => {
        // 用户主动取消不打扰；接口未开通 / 授权被拒时提示改手动填写
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) return;
        toast('地图选点暂不可用，可直接填写地点', 'none');
      }
    });
  },

  pickedPlace: null as null | { name: string; address: string; latitude: number; longitude: number },

  onSaveDraft() {
    const d = this.data.draft;
    if (!d) return;
    const content = (d.content || '').trim();
    if (!content) {
      toast('写点什么吧', 'none');
      return;
    }
    const cost = Number(d.cost) || 0;
    const duration = Number(d.duration) || 60;
    const location = this.pickedPlace
      ? this.pickedPlace
      : d.locationText
      ? { name: d.locationText, address: '', latitude: 0, longitude: 0 }
      : null;

    const payload = {
      content,
      day: d.day,
      startTime: d.startTime,
      duration,
      location,
      itemType: d.itemType,
      cost,
      note: d.note || '',
      ticketUrl: d.ticketUrl || ''
    };
    this.pickedPlace = null;
    if (d._id) {
      void store.updateTripItem(d._id, payload).then(() => {
        this.setData({ showSheet: false, draft: null });
        this.refresh();
        toast('已更新', 'success');
      });
    } else {
      void store.addTripItem(this.data.id, payload).then(() => {
        this.setData({ showSheet: false, draft: null });
        this.refresh();
        toast('已添加', 'success');
      });
    }
  },

  onDeleteDraft() {
    const d = this.data.draft;
    if (!d || !d._id) return;
    wx.showModal({
      title: '删除安排',
      content: `确认删除「${d.content}」？`,
      confirmColor: '#C0522F',
      success: (m) => {
        if (!m.confirm) return;
        void store.removeTripItem(d._id).then(() => {
          this.setData({ showSheet: false, draft: null });
          this.refresh();
          toast('已删除', 'success');
        });
      }
    });
  },

  /* ============================ 清单联动 ============================ */

  onApplySuggest() {
    const names = this.data.suggestions;
    if (!names.length) return;
    wx.showModal({
      title: '补充行李',
      content: `根据行程为你推荐 ${names.length} 件物品：${names.slice(0, 3).join('、')}${
        names.length > 3 ? ' 等' : ''
      }。加入清单？`,
      confirmText: '加入',
      success: (m) => {
        if (!m.confirm) return;
        void store.addSuggestedPacking(this.data.id, names).then((n) => {
          toast(`已加入 ${n} 件`, 'success');
          this.refresh();
        });
      }
    });
  },

  /* ============================ 海报分享 ============================ */

  onSharePoster() {
    const trip = this.data.trip;
    if (!trip) return;
    wx.showLoading({ title: '生成海报', mask: true });
    const q = wx.createSelectorQuery();
    q.select('#poster')
      .fields({ node: true, size: true })
      .exec((res: unknown) => {
        const info = ((res as { node?: unknown }[]) || [])[0];
        if (!info || !info.node) {
          wx.hideLoading();
          this.onShareAppMessage();
          toast('海报生成失败，已改为分享卡片', 'none');
          return;
        }
        const canvas = info.node as WechatMiniprogram.Canvas;
        const ctx = canvas.getContext('2d');
        const W = 600;
        const H = 860;
        const dpr = 2;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);

        // 背景
        const grd = ctx.createLinearGradient(0, 0, W, H);
        grd.addColorStop(0, '#F0EDE6');
        grd.addColorStop(1, '#E4DED2');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);

        // 标题区
        ctx.fillStyle = '#35302A';
        ctx.font = '700 30px sans-serif';
        ctx.fillText(trip.title.slice(0, 14), 40, 78);

        ctx.fillStyle = '#6E6558';
        ctx.font = '18px sans-serif';
        ctx.fillText(`📍 ${trip.destination || '未设目的地'} · ${this.data.dateText}`, 40, 112);

        // 封面条
        ctx.fillStyle = '#B5714C';
        ctx.fillRect(40, 136, W - 80, 8);

        // 时间线摘要
        let y = 190;
        ctx.font = '20px sans-serif';
        this.data.days.forEach((d) => {
          if (y > H - 120) return;
          ctx.fillStyle = '#B5714C';
          ctx.font = '700 20px sans-serif';
          ctx.fillText(`Day ${d.day} · ${d.dateText}`, 40, y);
          y += 32;
          ctx.fillStyle = '#35302A';
          ctx.font = '18px sans-serif';
          d.items.slice(0, 4).forEach((it) => {
            if (y > H - 100) return;
            const line = `${it.icon} ${it.timeText} ${it.content.slice(0, 16)}`;
            ctx.fillText(line, 56, y);
            y += 27;
          });
          y += 16;
        });

        // 页脚
        ctx.fillStyle = '#9E9384';
        ctx.font = '16px sans-serif';
        ctx.fillText(`行李 ${this.data.packingText} · 预算 ¥${this.data.spent}/${this.data.budget}`, 40, H - 40);
        ctx.fillText('来自「待办清单」小程序 · 旅行模式', 40, H - 18);

        wx.canvasToTempFilePath({
          canvas,
          success: (r) => {
            wx.hideLoading();
            wx.previewImage({ urls: [r.tempFilePath], current: r.tempFilePath });
          },
          fail: () => {
            wx.hideLoading();
            toast('海报生成失败', 'none');
          }
        });
      });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const trip = this.data.trip;
    return {
      title: trip ? `${trip.title} · 行程共享` : '我的行程',
      path: `/subpackages/travel/pages/trip-detail/trip-detail?id=${this.data.id}`
    };
  }
});

/**
 * 由带坐标的条目构造地图标记。
 * 只认 latitude/longitude 非 0 的条目——模板导入的地点只有名字没有坐标，
 * 不能拿 (0,0) 去打点，否则会在几内亚湾堆一坨标记。
 */
function buildMarkers(tripId: string): Marker[] {
  return store
    .listItems(tripId)
    .filter((it) => it.location && it.location.latitude && it.location.longitude)
    .map((it, i) => ({
      id: i,
      latitude: (it.location as NonNullable<ITripPlanItem['location']>).latitude,
      longitude: (it.location as NonNullable<ITripPlanItem['location']>).longitude,
      title: it.content,
      width: 32,
      height: 32,
      callout: {
        content: `${it.startTime || ''} ${it.content}`.trim(),
        display: 'BYCLICK' as const,
        padding: 6,
        borderRadius: 6
      }
    }));
}
