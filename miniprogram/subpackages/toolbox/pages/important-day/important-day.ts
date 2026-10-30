// subpackages/toolbox/pages/important-day/important-day.ts
// 重要日 · 时间管理中心 —— 页面逻辑
//
// 涵盖：天空 Hero 自定义导航、玻璃核心卡、即将到来/已过期 Tab、考研智能倒计时、
// 检索/排序/筛选、左滑删除/点击详情/长按管理模式、新建编辑表单、分类管理、考研节点一键导入、
// 提醒订阅、设置、首页/日历/提醒调度联动。
//
// 数据全部走 utils/important-day-store（本地优先，派生字段刷新时计算）。
import {
  ImpDay, ImpView, ImpCategory, ImpCategoryDef, ImpRepeat, ImpPriority,
  IMP_CATEGORIES, IMP_CATEGORY_MAP, IMP_REPEATS, IMP_PRIORITY,
  IMP_REMIND_OPTIONS, IMP_SORTS,
  loadDays, decorate, splitViews, sortDays, searchViews, filterViews,
  categoryCounts, addDay, updateDay, removeDay, removeDays, duplicateDay,
  kaoyanNodes, kaoyanPanel, importKaoyanNodes,
  dayStart, weekdayCnOf, parseYMD, toYMD,
  activeKaoyanCohort, currentCohort, saveCohortOverride, loadHomeBanner, saveHomeBanner,
  loadKaoyanTarget, saveKaoyanTarget, saveKaoyanDateOverride,
  KaoyanNodeDef
} from '../../../../utils/important-day-store';
import { requestSubscribe, grantSubscription, SUB_TMPL_ID } from '../../../../utils/subscribe';
import { toast } from '../../../../utils/cloud';

const IMP_SUB_KEY = 'imp_sub_enabled';

const CAT_DESC: Record<string, string> = {
  birthday: '亲友的生日，每年自动提醒',
  anniversary: '纪念日，值得被记得',
  kaoyan: '报名、初试、复试等关键节点',
  exam: '各类考试与考证时间',
  work: '工作、实习与面试',
  bill: '账单、还款与到期缴费',
  travel: '出行、机票与行程',
  lease: '租约、合同与续约',
  custom: '自定义任意重要日子'
};

interface IData {
  statusBarH: number;
  navH: number;
  navActRight: number;
  navBlur: boolean;
  city: { k: string; l: number; w: number; h: number; o: number }[];
  tab: 'future' | 'past';
  tabPillLeft: number;
  tabPillWidth: number;
  ky: {
    show: boolean; cohort: number; cohortLabel: string; nodeName: string;
    ymd: string; ts: number; dayDiff: number; dateText: string;
    weekdayText: string; weeksText: string; days: number; official: boolean; progress: number;
  } | null;
  keyword: string;
  searching: boolean;
  filterChipText: string;
  sortChipText: string;
  manageMode: boolean;
  selectedIds: string[];
  swipeId: string;
  list: ImpView[];
  loading: boolean;
  emptyTitle: string;
  emptySub: string;
  emptyAction: string;
  detail: ImpView | null;
  sheet: '' | 'detail' | 'editor' | 'categories' | 'kaoyan' | 'sort' | 'more' | 'settings';
  editingId: string;
  // 表单
  formTitle: string; formDate: string; formDateText: string; formTime: string;
  formCategory: ImpCategory; formRepeat: ImpRepeat; formRepeatDays: number;
  formPriority: ImpPriority; formReminder: boolean; formReminderTime: number;
  formDesc: string; formError: string;
  // 选项
  categories: ImpCategoryDef[];
  repeats: { key: ImpRepeat; label: string }[];
  priorities: { key: ImpPriority; label: string }[];
  remindOptions: number[];
  // 分类管理
  catStats: { key: string; label: string; icon: string; grad: string; desc: string; count: number }[];
  categoryFilter: 'all' | ImpCategory;
  totalCount: number;
  // 考研节点
  kyNodes: {
    key: string; name: string; desc: string; date: string; dateText: string;
    weekdayText: string; diffText: string; official: boolean; edited: boolean;
    added: boolean; isTarget: boolean;
  }[];
  // 排序
  sorts: { key: string; label: string; icon: string }[];
  sortMode: string;
  // 设置
  cohorts: number[];
  cohort: number;
  subStateText: string;
  homeBanner: boolean;
}

interface IMethods {
  onLoad?(): void;
  onShow?(): void;
  onUnload?(): void;
  onPageScroll?(e: { scrollTop: number }): void;
  // 导航
  onBack(): void;
  onMore(): void;
  onSettings(): void;
  // 头部动作
  onAdd(): void;
  onOpenCategories(): void;
  onOpenKaoyan(): void;
  onTab(e: WechatMiniprogram.TouchEvent): void;
  // 检索 / 排序 / 筛选
  onSearchInput(e: WechatMiniprogram.InputEvent): void;
  onSearchFocus(): void;
  onSearchBlur(): void;
  onClearKeyword(): void;
  onOpenSort(): void;
  onPickSort(e: WechatMiniprogram.TouchEvent): void;
  onClearCategory(): void;
  // 列表交互
  onLongPress(e: WechatMiniprogram.TouchEvent): void;
  onTapCard(e: WechatMiniprogram.TouchEvent): void;
  onTapEdit(e: WechatMiniprogram.TouchEvent): void;
  onSwipeStart(e: WechatMiniprogram.TouchEvent): void;
  onSwipeMove(e: WechatMiniprogram.TouchEvent): void;
  onSwipeEnd(): void;
  onDeleteOne(e: WechatMiniprogram.TouchEvent): void;
  onSelectAll(): void;
  onBatchArchive(): void;
  onBatchDelete(): void;
  onExitManage(): void;
  onEnterManage(): void;
  onClearArchived(): void;
  // 详情
  onCloseSheet(): void;
  onSheetStop(): void;
  onToggleRemindFromDetail(e: WechatMiniprogram.TouchEvent): void;
  onEditFromDetail(e: WechatMiniprogram.TouchEvent): void;
  onCopyDay(e: WechatMiniprogram.TouchEvent): void;
  onArchiveDay(e: WechatMiniprogram.TouchEvent): void;
  onDeleteFromDetail(e: WechatMiniprogram.TouchEvent): void;
  // 编辑器
  onTitle(e: WechatMiniprogram.InputEvent): void;
  onDate(e: WechatMiniprogram.TouchEvent): void;
  onTime(e: WechatMiniprogram.TouchEvent): void;
  onCategory(e: WechatMiniprogram.TouchEvent): void;
  onRepeat(e: WechatMiniprogram.TouchEvent): void;
  onRepeatDays(e: WechatMiniprogram.InputEvent): void;
  onPriority(e: WechatMiniprogram.TouchEvent): void;
  onReminder(e: WechatMiniprogram.TouchEvent): void;
  onRemindTime(e: WechatMiniprogram.TouchEvent): void;
  onDesc(e: WechatMiniprogram.InputEvent): void;
  onSave(): void;
  onEditorClose(): void;
  // 分类管理
  onPickCategory(e: WechatMiniprogram.TouchEvent): void;
  // 考研
  onPickKaoyanTarget(e: WechatMiniprogram.TouchEvent): void;
  onImportNode(e: WechatMiniprogram.TouchEvent): void;
  onImportAllNodes(): void;
  // 更多
  onOpenSearchFromMenu(): void;
  // 设置
  onEnableSubscribe(): void;
  onPickCohort(e: WechatMiniprogram.TouchEvent): void;
  // 空状态
  onEmptyAction(): void;
  // 内部
  refresh(): void;
  buildKy(now: number): void;
  buildKyNodes(now: number): void;
  buildList(now: number): void;
  openDetail(id: string): void;
  resetForm(edit?: ImpDay): void;
  getCohort(now: number): number;
  [k: string]: unknown;
}

function fmtDateText(ymd: string): string {
  const p = parseYMD(ymd);
  if (!p) return ymd;
  return `${p.y}年${p.m}月${p.d}日`;
}

function diffTextOf(ymd: string, now: number): string {
  const ts = new Date(ymd + 'T00:00:00').getTime();
  const d = Math.round((ts - dayStart(now)) / 86400000);
  if (d === 0) return '今天';
  if (d > 0) return `还有 ${d} 天`;
  return `已过期 ${-d} 天`;
}

Page({
  data: {
    statusBarH: 20, navH: 44, navActRight: 8, navBlur: false,
    city: [],
    tab: 'future', tabPillLeft: 3, tabPillWidth: 46,
    ky: null,
    keyword: '', searching: false,
    filterChipText: '', sortChipText: '',
    manageMode: false, selectedIds: [], swipeId: '',
    list: [], loading: true,
    emptyTitle: '', emptySub: '', emptyAction: '',
    detail: null, sheet: '', editingId: '',
    formTitle: '', formDate: '', formDateText: '', formTime: '09:00',
    formCategory: 'birthday', formRepeat: 'none', formRepeatDays: 30,
    formPriority: 'normal', formReminder: false, formReminderTime: 1,
    formDesc: '', formError: '',
    categories: IMP_CATEGORIES,
    repeats: IMP_REPEATS,
    priorities: [
      { key: 'high', label: '高' },
      { key: 'normal', label: '普通' },
      { key: 'low', label: '低' }
    ],
    remindOptions: IMP_REMIND_OPTIONS,
    catStats: [], categoryFilter: 'all', totalCount: 0,
    kyNodes: [],
    sorts: IMP_SORTS,
    sortMode: 'nearest',
    cohorts: [], cohort: 2027, subStateText: '未开启',
    homeBanner: true, kyHasTarget: false
  },

  onLoad() {
    const set = (o: Record<string, unknown>) => this.setData(o as any);
    let sb = 20;
    try {
      const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) as { statusBarHeight?: number };
      sb = info.statusBarHeight || 20;
    } catch (_e) { /* ignore */ }
    // 城市天际线（左低右高，右侧陆家嘴簇）
    const city = [
      { k: 'b1', l: 1, w: 9, h: 16, o: 0.9 },
      { k: 'b2', l: 9, w: 7, h: 26, o: 0.85 },
      { k: 'b3', l: 15, w: 8, h: 12, o: 0.95 },
      { k: 'b4', l: 23, w: 10, h: 38, o: 0.8 },
      { k: 'b5', l: 33, w: 7, h: 22, o: 0.9 },
      { k: 'b6', l: 40, w: 12, h: 30, o: 0.82 },
      { k: 'b7', l: 52, w: 9, h: 52, o: 0.78 },
      { k: 'b8', l: 61, w: 8, h: 40, o: 0.8 },
      { k: 'b9', l: 69, w: 11, h: 64, o: 0.75 },
      { k: 'b10', l: 80, w: 7, h: 34, o: 0.82 },
      { k: 'b11', l: 87, w: 10, h: 78, o: 0.7 },
      { k: 'b12', l: 97, w: 6, h: 46, o: 0.78 }
    ];
    set({ statusBarH: sb, city });
    this.getCohort(Date.now());
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  onUnload() {
    this.data.manageMode = false;
  },

  onPageScroll(e: { scrollTop: number }) {
    const blur = e.scrollTop > 30;
    if (blur !== this.data.navBlur) this.setData({ navBlur: blur } as any);
  },

  /* ============================ 导航 ============================ */
  onBack() {
    const pages = (getCurrentPages() || []) as unknown[];
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/index/index' });
  },
  onMore() { this.setData({ sheet: 'more' } as any); },
  onSettings() { this.setData({ sheet: 'settings' } as any); },

  /* ============================ 头部动作 ============================ */
  onAdd() {
    this.resetForm();
    this.setData({ sheet: 'editor', editingId: '' } as any);
  },
  onOpenCategories() { this.setData({ sheet: 'categories' } as any); },
  onOpenKaoyan() {
    this.buildKy(Date.now());
    this.setData({ sheet: 'kaoyan' } as any);
  },
  onTab(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset.key as 'future' | 'past') || 'future';
    this.setData({
      tab: key,
      tabPillLeft: key === 'future' ? 3 : 51,
      swipeId: '', manageMode: false, selectedIds: []
    } as any);
    this.refresh();
  },

  /* ============================ 检索 / 排序 / 筛选 ============================ */
  onSearchInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ keyword: e.detail.value || '' } as any);
    this.buildList(Date.now());
  },
  onSearchFocus() { this.setData({ searching: true } as any); },
  onSearchBlur() { this.setData({ searching: false } as any); },
  onClearKeyword() {
    this.setData({ keyword: '', searching: false } as any);
    this.buildList(Date.now());
  },
  onOpenSort() { this.setData({ sheet: 'sort' } as any); },
  onPickSort(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    wx.setStorageSync('imp_sort', key);
    this.setData({ sortMode: key, sheet: '' } as any);
    this.buildList(Date.now());
  },
  onClearCategory() {
    this.setData({ categoryFilter: 'all' } as any);
    this.buildList(Date.now());
  },

  /* ============================ 列表交互 ============================ */
  onLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    if (this.data.list.length === 0) { toast('暂无可管理的日子'); return; }
    this.setData({ manageMode: true, selectedIds: [id], swipeId: '' } as any);
  },
  onTapCard(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const swipeId = this.data.swipeId;
    if (swipeId) {
      this.setData({ swipeId: '' } as any);
      return;
    }
    if (this.data.manageMode) {
      const sel = this.data.selectedIds.slice();
      const i = sel.indexOf(id);
      if (i >= 0) sel.splice(i, 1); else sel.push(id);
      this.setData({ selectedIds: sel } as any);
      return;
    }
    this.openDetail(id);
  },
  onTapEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const d = getDaySafe(id);
    if (!d) return;
    this.resetForm(d);
    this.setData({ sheet: 'editor', editingId: id } as any);
  },
  onSwipeStart(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0];
    (this as any)._sx = t ? t.clientX : 0;
    (this as any)._id = e.currentTarget.dataset.id;
  },
  onSwipeMove(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0];
    const sx = (this as any)._sx || 0;
    if (!t) return;
    const dx = t.clientX - sx;
    const id = (this as any)._id;
    if (dx < -24 && id && this.data.swipeId !== id) {
      this.setData({ swipeId: id } as any);
    } else if (dx > 24 && this.data.swipeId === id) {
      this.setData({ swipeId: '' } as any);
    }
  },
  onSwipeEnd() {
    (this as any)._sx = 0; (this as any)._id = '';
  },
  onDeleteOne(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.showModal({
      title: '删除确认',
      content: '确定删除这个重要日吗？',
      confirmText: '删除', confirmColor: '#E4708E',
      success: (r) => {
        if (r.confirm) {
          removeDay(id);
          this.setData({ swipeId: '' } as any);
          this.refresh();
          toast('已删除');
        }
      }
    });
  },
  onSelectAll() {
    this.setData({ selectedIds: this.data.list.map((i) => i.id) } as any);
  },
  onBatchArchive() {
    const ids = this.data.selectedIds;
    if (!ids.length) return;
    ids.forEach((id) => updateDay(id, { status: 'archived' } as any));
    this.setData({ manageMode: false, selectedIds: [] } as any);
    this.refresh();
    toast('已归档');
  },
  onBatchDelete() {
    const ids = this.data.selectedIds;
    if (!ids.length) return;
    wx.showModal({
      title: '批量删除',
      content: `确定删除选中的 ${ids.length} 个重要日吗？`,
      confirmText: '删除', confirmColor: '#E4708E',
      success: (r) => {
        if (r.confirm) {
          removeDays(ids);
          this.setData({ manageMode: false, selectedIds: [] } as any);
          this.refresh();
          toast('已删除');
        }
      }
    });
  },
  onExitManage() { this.setData({ manageMode: false, selectedIds: [] } as any); },
  onEnterManage() {
    if (this.data.list.length === 0) { toast('暂无可管理的日子'); return; }
    this.setData({ manageMode: true, selectedIds: [], sheet: '' } as any);
  },
  onClearArchived() {
    const archived = loadDays().filter((d) => d.status === 'archived').map((d) => d.id);
    if (!archived.length) { toast('没有已归档的重要日'); return; }
    removeDays(archived);
    this.refresh();
    toast('已清除已归档');
  },

  /* ============================ 详情 ============================ */
  onCloseSheet() { this.setData({ sheet: '' } as any); },
  onSheetStop() { /* 阻止冒泡 */ },
  onToggleRemindFromDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const d = getDaySafe(id);
    if (!d) return;
    updateDay(id, { reminder: !d.reminder } as any);
    const v = decorate(d);
    v.reminder = !d.reminder;
    v.reminderText = v.reminder ? `提前 ${v.reminderTime} 天` : '未开启提醒';
    this.setData({ detail: v } as any);
    this.buildList(Date.now());
    toast(v.reminder ? '已开启提醒' : '已关闭提醒');
  },
  onEditFromDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const d = getDaySafe(id);
    if (!d) return;
    this.resetForm(d);
    this.setData({ sheet: 'editor', editingId: id } as any);
  },
  onCopyDay(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const r = duplicateDay(id);
    if (r) { this.setData({ sheet: '' } as any); this.refresh(); toast('已复制为副本'); }
  },
  onArchiveDay(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const d = getDaySafe(id);
    if (!d) return;
    const next = d.status === 'active' ? 'archived' : 'active';
    updateDay(id, { status: next } as any);
    this.setData({ sheet: '' } as any);
    this.refresh();
    toast(next === 'archived' ? '已归档' : '已恢复');
  },
  onDeleteFromDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除确认',
      content: '确定删除这个重要日吗？',
      confirmText: '删除', confirmColor: '#E4708E',
      success: (r) => {
        if (r.confirm) {
          removeDay(id);
          this.setData({ sheet: '', detail: null } as any);
          this.refresh();
          toast('已删除');
        }
      }
    });
  },

  /* ============================ 编辑器 ============================ */
  onTitle(e: WechatMiniprogram.InputEvent) { this.setData({ formTitle: e.detail.value || '' } as any); },
  onDate(e: WechatMiniprogram.TouchEvent) {
    const v = e.detail.value as string;
    this.setData({ formDate: v, formDateText: fmtDateText(v) } as any);
  },
  onTime(e: WechatMiniprogram.TouchEvent) { this.setData({ formTime: e.detail.value as string } as any); },
  onCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formCategory: e.currentTarget.dataset.key as ImpCategory } as any);
  },
  onRepeat(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formRepeat: e.currentTarget.dataset.key as ImpRepeat } as any);
  },
  onRepeatDays(e: WechatMiniprogram.InputEvent) {
    const n = Math.max(1, Number(e.detail.value) || 30);
    this.setData({ formRepeatDays: n } as any);
  },
  onPriority(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formPriority: e.currentTarget.dataset.key as ImpPriority } as any);
  },
  onReminder(e: WechatMiniprogram.TouchEvent) { this.setData({ formReminder: !!(e.detail as { value?: boolean }).value } as any); },
  onRemindTime(e: WechatMiniprogram.TouchEvent) {
    this.setData({ formReminderTime: Number(e.currentTarget.dataset.v) } as any);
  },
  onDesc(e: WechatMiniprogram.InputEvent) { this.setData({ formDesc: e.detail.value || '' } as any); },
  onSave() {
    const d = this.data;
    if (!d.formTitle.trim()) { this.setData({ formError: '请填写事件名称' } as any); return; }
    if (!parseYMD(d.formDate)) { this.setData({ formError: '日期格式不正确' } as any); return; }
    const def = IMP_CATEGORY_MAP[d.formCategory];
    const patch: Record<string, unknown> = {
      title: d.formTitle.trim(),
      date: d.formDate,
      time: d.formTime,
      category: d.formCategory,
      description: d.formDesc.trim(),
      reminder: d.formReminder,
      reminderTime: d.formReminderTime,
      repeatType: d.formRepeat,
      priority: d.formPriority,
      color: def.color,
      icon: def.icon
    };
    if (d.formRepeat === 'custom') patch.repeatDays = d.formRepeatDays;
    if (d.editingId) {
      updateDay(d.editingId, patch as any);
    } else {
      addDay(patch as any);
    }
    this.setData({ sheet: '', editingId: '', formError: '' } as any);
    this.refresh();
    toast(d.editingId ? '已保存' : '已添加');
  },
  onEditorClose() { this.setData({ sheet: '', formError: '' } as any); },

  /* ============================ 分类管理 ============================ */
  onPickCategory(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as 'all' | ImpCategory;
    this.setData({ categoryFilter: key, sheet: '' } as any);
    this.buildList(Date.now());
  },

  /* ============================ 考研 ============================ */
  noop() { /* 供 picker 内按钮阻止冒泡 */ },
  onKyDateChange(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '');
    const val = String((e.detail as { value?: string }).value || '');
    const node = kaoyanNodes(this.getCohort(Date.now())).find((n) => n.key === key);
    if (!node || !val) return;
    saveKaoyanDateOverride(this.getCohort(Date.now()), key, val);
    // 若该节点已加入重要日，同步更新那条的日期，保持列表与倒计时一致
    const sync = loadDays().filter((x) => x.preset && x.presetKey === key);
    sync.forEach((x) => updateDay(x.id, { date: val } as any));
    this.buildKy(Date.now());
    this.buildKyNodes(Date.now());
    this.buildList(Date.now());
    toast(`「${node.name}」已改期至 ${val}`);
  },
  onPickKaoyanTarget(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    saveKaoyanTarget(key);
    this.buildKy(Date.now());
    this.buildKyNodes(Date.now());
    toast('已设为倒计时目标');
  },
  onClearKaoyanTarget() {
    saveKaoyanTarget('');
    this.buildKy(Date.now());
    this.buildKyNodes(Date.now());
    toast('已清除倒计时目标，首页不再显示');
  },
  onImportNode(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const nodes = kaoyanNodes(this.getCohort(Date.now()));
    const node = nodes.find((n) => n.key === key);
    if (!node) return;
    const added = new Set(loadDays().filter((x) => x.preset && x.presetKey).map((x) => x.presetKey));
    if (added.has(key)) { toast('该节点已加入'); return; }
    importKaoyanNodes([{ node }]);
    this.buildKyNodes(Date.now());
    this.refresh();
    toast('已加入重要日');
  },
  onImportAllNodes() {
    const cohort = this.getCohort(Date.now());
    const nodes = kaoyanNodes(cohort);
    const added = new Set(loadDays().filter((x) => x.preset && x.presetKey).map((x) => x.presetKey));
    const picks = nodes.filter((n) => !added.has(n.key)).map((n) => ({ node: n as KaoyanNodeDef }));
    if (!picks.length) { toast('节点已全部加入'); return; }
    const n = importKaoyanNodes(picks);
    this.buildKyNodes(Date.now());
    this.refresh();
    toast(`已添加 ${n} 个节点`);
  },

  /* ============================ 更多 ============================ */
  onOpenSearchFromMenu() {
    this.setData({ sheet: '', searching: true } as any);
  },

  /* ============================ 设置 ============================ */
  onEnableSubscribe() {
    if (!SUB_TMPL_ID) { toast('订阅模板未配置'); return; }
    requestSubscribe(SUB_TMPL_ID).then((state) => {
      if (state === 'accept') {
        grantSubscription(SUB_TMPL_ID);
        wx.setStorageSync(IMP_SUB_KEY, true);
        this.setData({ subStateText: '已开启（订阅消息）' } as any);
        toast('已开启微信通知，到期前会推送');
      } else if (state === 'ban') {
        toast('订阅功能被限制，仅本机提醒');
      } else if (state === 'empty') {
        toast('订阅模板未配置');
      } else {
        toast('未授权，已保留本机提醒');
      }
    });
  },
  onToggleHomeBanner(e: WechatMiniprogram.TouchEvent) {
    const show = !!(e.detail as { value?: boolean }).value;
    saveHomeBanner(show);
    this.setData({ homeBanner: show } as any);
    toast(show ? '首页已显示倒计时卡片' : '首页已隐藏倒计时卡片');
  },
  onPickCohort(e: WechatMiniprogram.TouchEvent) {
    const v = Number((e.currentTarget.dataset as { v?: number }).v);
    if (!v) return;
    saveCohortOverride(v);
    this.setData({ cohort: v } as any);
    this.buildKy(Date.now());
    this.buildKyNodes(Date.now());
    toast(`${v} 考研`);
  },

  /* ============================ 空状态 ============================ */
  onEmptyAction() {
    const d = this.data;
    if (d.keyword || d.categoryFilter !== 'all') {
      this.setData({ keyword: '', categoryFilter: 'all' } as any);
      this.buildList(Date.now());
      return;
    }
    if (d.tab === 'future') this.onAdd();
    else this.onOpenKaoyan();
  },

  /* ============================ 内部 ============================ */
  getCohort(now: number): number {
    const base = activeKaoyanCohort(now);
    let c = base;
    try { c = currentCohort(now); } catch (_e) { c = base; }
    this.setData({
      cohort: c,
      cohorts: [base - 1, base, base + 1],
      subStateText: (wx.getStorageSync(IMP_SUB_KEY) ? '已开启（订阅消息）' : '未开启')
    } as any);
    return c;
  },
  buildKy(now: number) {
    const cohort = this.getCohort(now);
    const nodes = kaoyanNodes(cohort);
    const todayStart = dayStart(now);
    const want = loadKaoyanTarget();
    // 只有显式设过目标才有倒计时；未设过 → show:false（页面显示"去设置"引导）
    let node = want ? nodes.find((n) => n.key === want) : undefined;
    if (node) {
      const t0 = new Date(node.date + 'T00:00:00').getTime();
      if (t0 < todayStart) {
        node = nodes.find((n) => new Date(n.date + 'T00:00:00').getTime() >= todayStart);
      }
    }
    if (!node) {
      this.setData({
        ky: {
          show: false, cohort, cohortLabel: `${cohort} 考研`,
          nodeName: '', ymd: '', ts: 0, dayDiff: 0,
          dateText: '', weekdayText: '', weeksText: '',
          days: 0, official: false, progress: 0
        }
      } as any);
      return;
    }
    const ts = new Date(node.date + 'T00:00:00').getTime();
    const dayDiff = Math.round((ts - todayStart) / 86400000);
    const abs = Math.abs(dayDiff);
    const weeks = Math.floor(abs / 7);
    const rest = abs % 7;
    const p = parseYMD(node.date) || { y: 0, m: 1, d: 1 };
    const baoming = nodes.find((n) => n.key === 'baoming');
    const chushi = nodes.find((n) => n.key === 'chushi');
    let progress = 0;
    if (baoming && chushi) {
      const s = new Date(baoming.date + 'T00:00:00').getTime();
      const e = new Date(chushi.date + 'T00:00:00').getTime();
      progress = Math.max(0, Math.min(100, Math.round(((now - s) / (e - s)) * 100)));
    }
    this.setData({
      ky: {
        show: dayDiff >= 0, cohort, cohortLabel: `${cohort} 考研`,
        nodeName: node.name, ymd: node.date, ts, dayDiff,
        dateText: `${p.y}年${p.m}月${p.d}日`,
        weekdayText: weekdayCnOf(ts),
        weeksText: dayDiff === 0 ? '就是今天' : `${weeks > 0 ? `${weeks}周` : ''}${rest}天`,
        days: dayDiff, official: node.official, progress
      }
    } as any);
  },
  buildKyNodes(now: number) {
    const cohort = this.getCohort(now);
    const nodes = kaoyanNodes(cohort);
    const added = new Set(loadDays().filter((x) => x.preset && x.presetKey).map((x) => x.presetKey));
    const target = loadKaoyanTarget();
    const arr = nodes.map((n) => ({
      key: n.key, name: n.name, desc: n.desc,
      date: n.date,
      dateText: fmtDateText(n.date),
      weekdayText: weekdayCnOf(new Date(n.date + 'T00:00:00').getTime()),
      diffText: diffTextOf(n.date, now),
      official: n.official,
      edited: !!n.edited,
      added: added.has(n.key),
      isTarget: n.key === target
    }));
    this.setData({ kyNodes: arr, kyHasTarget: !!target } as any);
  },
  buildList(now: number) {
    const days = loadDays();
    const views = days.map((d) => decorate(d, now));
    const { future, past } = splitViews(views);
    const base = this.data.tab === 'future' ? future : past;
    let list = searchViews(base, this.data.keyword);
    list = filterViews(list, this.data.categoryFilter);
    list = sortDays(list, (this.data.sortMode as any) || 'nearest');

    const counts = categoryCounts(views);
    const catStats = IMP_CATEGORIES.map((c) => ({
      key: c.key, label: c.label, icon: c.icon, grad: c.grad,
      desc: CAT_DESC[c.key] || '', count: counts[c.key] || 0
    }));
    const totalCount = views.length;

    let filterChipText = '';
    if (this.data.categoryFilter !== 'all') {
      const c = IMP_CATEGORY_MAP[this.data.categoryFilter];
      filterChipText = c ? `分类：${c.label}` : '';
    }
    const sortMap: Record<string, string> = {
      nearest: '最近发生', priority: '优先级最高', category: '按分类', custom: '自定义排序'
    };
    const sortChipText = sortMap[this.data.sortMode] ? `排序：${sortMap[this.data.sortMode]}` : '';

    const filtered = !!this.data.keyword || this.data.categoryFilter !== 'all';
    let emptyTitle = '', emptySub = '', emptyAction = '';
    if (list.length === 0) {
      if (filtered) {
        emptyTitle = '没有匹配的重要日';
        emptySub = '换个关键词或分类试试';
        emptyAction = '清除筛选';
      } else if (this.data.tab === 'future') {
        emptyTitle = '还没有即将到来的日子';
        emptySub = '把生日、纪念日、考试……加进来，让每一刻都被记得';
        emptyAction = '＋ 添加第一个重要日';
      } else {
        emptyTitle = '没有已过期的日子';
        emptySub = '过去的重要日归档在这里，方便回看';
        emptyAction = '看看考研节点';
      }
    }

    this.setData({
      list, catStats, totalCount,
      filterChipText, sortChipText,
      emptyTitle, emptySub, emptyAction
    } as any);
  },
  openDetail(id: string) {
    const d = getDaySafe(id);
    if (!d) return;
    this.setData({ detail: decorate(d, Date.now()), sheet: 'detail', swipeId: '' } as any);
  },
  resetForm(edit?: ImpDay) {
    const today = toYMD(new Date());
    if (edit) {
      this.setData({
        formTitle: edit.title,
        formDate: edit.date, formDateText: fmtDateText(edit.date),
        formTime: edit.time,
        formCategory: edit.category,
        formRepeat: edit.repeatType,
        formRepeatDays: edit.repeatDays || 30,
        formPriority: edit.priority,
        formReminder: edit.reminder,
        formReminderTime: edit.reminderTime,
        formDesc: edit.description,
        formError: ''
      } as any);
    } else {
      this.setData({
        formTitle: '',
        formDate: today, formDateText: fmtDateText(today),
        formTime: '09:00',
        formCategory: 'birthday',
        formRepeat: 'none', formRepeatDays: 30,
        formPriority: 'normal',
        formReminder: false, formReminderTime: 1,
        formDesc: '', formError: ''
      } as any);
    }
  },
  refresh() {
    const now = Date.now();
    this.buildKy(now);
    this.buildKyNodes(now);
    const savedSort = (() => { try { return wx.getStorageSync('imp_sort') as string; } catch (_e) { return ''; } })();
    if (savedSort) this.setData({ sortMode: savedSort } as any);
    this.buildList(now);
    this.setData({ loading: false, homeBanner: loadHomeBanner() } as any);
  }
} as any);

/* 取单条数据（安全） */
function getDaySafe(id: string): ImpDay | null {
  const all = loadDays();
  return all.find((d) => d.id === id) || null;
}