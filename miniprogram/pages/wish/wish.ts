// pages/wish/wish.ts
// 愿望清单：自定义分类/状态/字段 + 多级子任务进度聚合 + 周期心愿 + 复盘归档 + 年度报告 + 模板复用
import { getThemeState, syncNavBar } from '../../utils/theme';
import { toast } from '../../utils/cloud';
import { formatMoney, parseMoney } from '../../utils/money';
import { get as storageGet, set as storageSet } from '../../utils/storage';
import {
  loadWishes, saveWishes, upsertWish, archiveWish, unarchiveWish,
  loadCategories, saveCategories, loadStatuses, saveStatuses,
  loadFields, saveFields, loadTemplates, saveTemplates,
  createWish, createWishFromTemplate, statSubTasks, wishProgress, wishProgressText,
  wishUrgency, sortWishes, applyCycles, buildYearReport, loadFromCloud
} from '../../utils/wish-store';
import type { WishSortMode } from '../../utils/wish-store';
import type {
  IWish, IWishCategory, IWishStatus, IWishField, IWishTemplate,
  IWishSubTask, IWishYearReport, WishProgressMode, WishStatusKind
} from '../../types/index';
import type { ThemeKey } from '../../types/index';

/** 列表展示派生字段 */
interface DecoratedWish extends IWish {
  catName: string;
  catIcon: string;
  catColor: string;
  statusName: string;
  statusColor: string;
  progressPct: number;
  progressText: string;
  urgency: string;
  urgencyText: string;
  priceText: string;
  subStat: { total: number; done: number };
  cover: string;
  /** 描述（备注单行截断） */
  noteText: string;
  /** 标签 chip 数组 */
  tagChips: string[];
  /** 目标日期 2026.08 */
  dateText: string;
  /** 距目标：还有 N 天 / 已逾期 */
  daysText: string;
  /** 是否已完成态 */
  isDoneKind: boolean;
}

/** 编辑器草稿（字段值统一按字符串处理，保存时再转换） */
interface WishDraft {
  _id: string;
  title: string;
  note: string;
  /** 为什么想实现它 */
  reason: string;
  categoryId: string;
  statusId: string;
  star: number;
  priceText: string;
  link: string;
  progressMode: WishProgressMode;
  targetText: string;
  currentText: string;
  autoDone: boolean;
  subTasks: IWishSubTask[];
  fieldValues: Record<string, string>;
  tagsText: string;
  targetDateText: string;
  cycleEnabled: boolean;
  cyclePeriod: string;
  budgetCategory: string;
  budgetMonthlyText: string;
  isPrivate: boolean;
  isPinned: boolean;
}

interface WishData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  wishes: DecoratedWish[];
  categories: IWishCategory[];
  statuses: IWishStatus[];
  fields: IWishField[];
  templates: IWishTemplate[];
  activeCat: string;
  activeStatus: string;
  sortMode: WishSortMode;
  keyword: string;
  showArchived: boolean;
  stat: { total: number; doing: number; done: number; spent: string };
  // 编辑器
  editorOpen: boolean;
  editorMode: 'create' | 'edit';
  draft: WishDraft;
  draftSubStat: { total: number; done: number; pct: number };
  // 设置
  settingsOpen: boolean;
  settingsTab: 'category' | 'status' | 'field';
  // 模板
  templateOpen: boolean;
  // 报告
  reportOpen: boolean;
  reportYear: number;
  report: IWishYearReport | null;
  // 归档复盘
  reviewOpen: boolean;
  reviewText: string;
  reviewId: string;
  // 暮色版新增
  /** 实现率 0-100 */
  rate: number;
  /** 我的愿景文案 */
  vision: string;
  visionOpen: boolean;
  visionDraft: string;
  /** 愿望实现庆祝弹层 */
  celebrateOpen: boolean;
  celebrate: { title: string; date: string };
  /** 编辑器目标日期倒计时提示 */
  draftDaysText: string;
}

const DAY_MS = 86400000;

/** 愿景文案存储键 */
const VISION_KEY = 'wish_vision';

/** 2026.08 格式 */
function fmtDotDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 距目标：还有 N 天 / 就是今天 / 已逾期 N 天 */
function daysTextFor(ts: number): string {
  if (!ts) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(ts);
  t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - today.getTime()) / DAY_MS);
  if (diff < 0) return `已逾期 ${-diff} 天`;
  if (diff === 0) return '就是今天';
  return `还有 ${diff} 天`;
}

function emptyDraft(): WishDraft {
  return {
    _id: '', title: '', note: '', reason: '', categoryId: '', statusId: '', star: 3,
    priceText: '', link: '', progressMode: 'checklist', targetText: '100',
    currentText: '0', autoDone: true, subTasks: [], fieldValues: {},
    tagsText: '', targetDateText: '', cycleEnabled: false, cyclePeriod: 'month',
    budgetCategory: '', budgetMonthlyText: '', isPrivate: false, isPinned: false
  };
}

function parseDate(s: string): number {
  if (!s) return 0;
  const t = new Date(`${s.replace(/\//g, '-')}T00:00:00`).getTime();
  return isFinite(t) ? t : 0;
}

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

Page<WishData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    wishes: [],
    categories: [],
    statuses: [],
    fields: [],
    templates: [],
    activeCat: 'all',
    activeStatus: 'all',
    sortMode: 'smart',
    keyword: '',
    showArchived: false,
    stat: { total: 0, doing: 0, done: 0, spent: '¥0.00' },
    editorOpen: false,
    editorMode: 'create',
    draft: emptyDraft(),
    draftSubStat: { total: 0, done: 0, pct: 0 },
    settingsOpen: false,
    settingsTab: 'category',
    templateOpen: false,
    reportOpen: false,
    reportYear: new Date().getFullYear(),
    report: null,
    reviewOpen: false,
    reviewText: '',
    reviewId: '',
    rate: 0,
    vision: '',
    visionOpen: false,
    visionDraft: '',
    celebrateOpen: false,
    celebrate: { title: '', date: '' },
    draftDaysText: ''
  },

  onLoad() {
    applyCycles();
    this.applyThemeToPage();
    this.setData({ vision: String(storageGet(VISION_KEY, '') || '') });
    this.refresh();
    loadFromCloud().then(() => this.refresh()).catch(() => {});
  },

  onShow() {
    this.applyThemeToPage();
  },

  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient
    });
    syncNavBar(state);
  },

  /** 重新加载并渲染列表 */
  refresh() {
    const cats = loadCategories();
    const statuses = loadStatuses();
    const fields = loadFields();
    const templates = loadTemplates();
    const all = loadWishes();

    const doneIds = statuses.filter((s) => s.kind === 'done').map((s) => s.id);
    const dropIds = statuses.filter((s) => s.kind === 'dropped').map((s) => s.id);
    const active = all.filter((w) => !w.isArchived);
    const doneList = active.filter((w) => doneIds.indexOf(w.statusId) >= 0);

    const { activeCat, activeStatus, sortMode, keyword, showArchived } = this.data;

    let list = showArchived ? all.filter((w) => w.isArchived) : active;
    if (activeCat !== 'all') list = list.filter((w) => w.categoryId === activeCat);
    if (activeStatus !== 'all') list = list.filter((w) => w.statusId === activeStatus);
    if (keyword) {
      const q = keyword.trim().toLowerCase();
      list = list.filter((w) => {
        // 搜索范围：标题 / 描述 / 为什么（原因）/ 标签
        const hay = `${w.title} ${w.note} ${w.reason || ''} ${(w.tags || []).join(' ')}`.toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }

    const wishes: DecoratedWish[] = sortWishes(list, sortMode).map((w) => {
      const cat = cats.find((c) => c.id === w.categoryId) || cats[0];
      const st = statuses.find((s) => s.id === w.statusId) || statuses[0];
      const pct = wishProgress(w);
      const urgency = wishUrgency(w);
      const s = statSubTasks(w.subTasks);
      const isDoneKind = !!st && st.kind === 'done';
      return Object.assign({}, w, {
        catName: cat ? cat.name : '未分类',
        catIcon: cat ? cat.icon : '⭐',
        catColor: cat ? cat.color : '#94a3b8',
        statusName: st ? st.name : '—',
        statusColor: st ? st.color : '#94a3b8',
        progressPct: pct,
        progressText: wishProgressText(w),
        urgency,
        urgencyText: urgency === 'overdue' ? '已逾期' : urgency === 'soon' ? '临期' : '',
        priceText: w.price > 0 ? formatMoney(w.price) : '',
        subStat: { total: s.total, done: Math.round(s.done) },
        cover: (w.images && w.images[0]) || '',
        noteText: w.isPrivate ? '🔒 私密愿望' : (w.note || w.reason || '').replace(/\s+/g, ' ').slice(0, 42),
        tagChips: (w.tags || []).slice(0, 3),
        dateText: fmtDotDate(w.targetDate),
        daysText: isDoneKind ? '' : daysTextFor(w.targetDate),
        isDoneKind
      });
    });

    const spent = doneList.reduce((s, w) => s + (w.price || 0), 0);
    // 实现率 = 已实现 / 全部未归档愿望
    const rate = active.length > 0 ? Math.round((doneList.length / active.length) * 100) : 0;
    this.setData({
      wishes,
      categories: cats,
      statuses,
      fields,
      templates,
      rate,
      stat: {
        total: active.length,
        doing: active.filter((w) => doneIds.indexOf(w.statusId) < 0 && dropIds.indexOf(w.statusId) < 0).length,
        done: doneList.length,
        spent: formatMoney(spent)
      }
    });
  },

  /* ==================== 筛选与搜索 ==================== */

  onCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ activeCat: e.currentTarget.dataset.id as string }, () => this.refresh());
  },
  onStatus(e: WechatMiniprogram.TouchEvent) {
    this.setData({ activeStatus: e.currentTarget.dataset.id as string }, () => this.refresh());
  },
  onSort(e: WechatMiniprogram.TouchEvent) {
    this.setData({ sortMode: e.currentTarget.dataset.mode as WishSortMode }, () => this.refresh());
  },
  onSearch(e: WechatMiniprogram.InputEvent) {
    this.setData({ keyword: e.detail.value }, () => this.refresh());
  },
  onToggleArchived() {
    this.setData({ showArchived: !this.data.showArchived }, () => this.refresh());
  },

  /* ==================== 我的愿景 ==================== */

  onVisionOpen() {
    this.setData({ visionOpen: true, visionDraft: this.data.vision });
  },
  onVisionClose() {
    this.setData({ visionOpen: false });
  },
  onVisionInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ visionDraft: e.detail.value });
  },
  onVisionSave() {
    const v = this.data.visionDraft.trim().slice(0, 800);
    storageSet(VISION_KEY, v);
    this.setData({ visionOpen: false, vision: v });
    toast('愿景已保存');
  },

  /* ==================== 编辑器 ==================== */

  onFab() {
    this.setData({ templateOpen: true });
  },

  onTemplatePick(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const tpl = this.data.templates.find((t) => t.id === id);
    const wish = tpl ? createWishFromTemplate(tpl) : createWish();
    this.setData({ templateOpen: false });
    this.openEditor(wish, 'create');
  },

  onBlankWish() {
    this.setData({ templateOpen: false });
    this.openEditor(createWish(), 'create');
  },

  onWishTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const wish = loadWishes().find((w) => w._id === id);
    if (wish) this.openEditor(wish, 'edit');
  },

  openEditor(wish: IWish, mode: 'create' | 'edit') {
    const fields = loadFields();
    const fieldValues: Record<string, string> = {};
    fields.forEach((f) => {
      const v = wish.fields ? wish.fields[f.id] : undefined;
      fieldValues[f.id] = v === undefined || v === null ? '' : String(v);
    });
    const draft: WishDraft = {
      _id: wish._id,
      title: wish.title,
      note: wish.note,
      reason: wish.reason || '',
      categoryId: wish.categoryId,
      statusId: wish.statusId,
      star: wish.star,
      priceText: wish.price ? String(Math.round(wish.price / 100)) : '',
      link: wish.link,
      progressMode: wish.progressMode,
      targetText: String(wish.target),
      currentText: String(wish.current),
      autoDone: wish.autoDone,
      subTasks: wish.subTasks || [],
      fieldValues,
      tagsText: (wish.tags || []).join(' '),
      targetDateText: fmtDate(wish.targetDate),
      cycleEnabled: !!(wish.cycle && wish.cycle.enabled),
      cyclePeriod: wish.cycle ? wish.cycle.period : 'month',
      budgetCategory: wish.budgetLink ? wish.budgetLink.categoryName : '',
      budgetMonthlyText: wish.budgetLink ? String(Math.round(wish.budgetLink.monthly / 100)) : '',
      isPrivate: wish.isPrivate,
      isPinned: wish.isPinned
    };
    this.setData({
      editorOpen: true,
      editorMode: mode,
      draft,
      draftDaysText: wish.targetDate ? daysTextFor(wish.targetDate) : '',
      draftSubStat: statSubTasks(draft.subTasks)
    });
  },

  onEditorClose() {
    this.setData({ editorOpen: false });
  },

  onDraftInput(e: WechatMiniprogram.InputEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ [`draft.${key}`]: e.detail.value });
  },

  onStarPick(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'draft.star': Number(e.currentTarget.dataset.v) });
  },

  onDraftPick(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ [`draft.${key}`]: e.currentTarget.dataset.v });
  },

  onDraftSwitch(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ [`draft.${key}`]: !!e.detail.value });
  },

  onDatePick(e: WechatMiniprogram.PickerChangeEvent) {
    const val = String(e.detail.value || '');
    const ts = parseDate(val);
    this.setData({ 'draft.targetDateText': val, draftDaysText: ts ? daysTextFor(ts) : '' });
  },

  onFieldInput(e: WechatMiniprogram.InputEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ [`draft.fieldValues.${id}`]: e.detail.value });
  },

  /** 下拉字段：picker 返回索引，需转成选项文本 */
  onFieldSelect(e: WechatMiniprogram.PickerChangeEvent) {
    const id = e.currentTarget.dataset.id as string;
    const f = loadFields().find((x) => x.id === id);
    const idx = Number(e.detail.value);
    const val = f && f.options ? f.options[idx] : '';
    this.setData({ [`draft.fieldValues.${id}`]: val || '' });
  },

  /** 弹层容器：截断冒泡，避免误关闭 */
  onSheetStop() {},

  /* ---- 子任务（支持任意层级） ---- */

  onSubToggle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const next = toggleNode(this.data.draft.subTasks, id);
    this.setData({ 'draft.subTasks': next, draftSubStat: statSubTasks(next) });
  },

  onSubAdd() {
    const node: IWishSubTask = {
      id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: '新子任务',
      done: false,
      weight: 1,
      children: []
    };
    const next = [...this.data.draft.subTasks, node];
    this.setData({ 'draft.subTasks': next, draftSubStat: statSubTasks(next) });
  },

  onSubAddChild(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const node: IWishSubTask = {
      id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: '新子步骤',
      done: false,
      weight: 1,
      children: []
    };
    const next = addChildNode(this.data.draft.subTasks, id, node);
    this.setData({ 'draft.subTasks': next, draftSubStat: statSubTasks(next) });
  },

  onSubRemove(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const next = removeNode(this.data.draft.subTasks, id);
    this.setData({ 'draft.subTasks': next, draftSubStat: statSubTasks(next) });
  },

  onSubTitle(e: WechatMiniprogram.InputEvent) {
    const id = e.currentTarget.dataset.id as string;
    const next = renameNode(this.data.draft.subTasks, id, e.detail.value);
    this.setData({ 'draft.subTasks': next });
  },

  /* ---- 保存 ---- */

  onEditorSave() {
    const d = this.data.draft;
    if (!d.title.trim()) {
      toast('请先填写心愿名称');
      return;
    }
    // 自定义字段必填校验
    const miss = loadFields().find((f) => f.required && !String(d.fieldValues[f.id] || '').trim());
    if (miss) {
      toast(`「${miss.name}」为必填项`);
      return;
    }
    const statuses = loadStatuses();
    const doneStatus = statuses.find((s) => s.kind === 'done');
    const prev = loadWishes().find((w) => w._id === d._id);
    const now = Date.now();

    const statusId = d.statusId || (statuses[0] && statuses[0].id) || '';
    const justAchieved = !!(doneStatus && statusId === doneStatus.id && !(prev && prev.achievedAt));
    const achievedAt = doneStatus && statusId === doneStatus.id
      ? (prev && prev.achievedAt) || now
      : 0;

    const fields: Record<string, string | number | boolean> = {};
    Object.keys(d.fieldValues).forEach((k) => {
      const f = loadFields().find((x) => x.id === k);
      const raw = d.fieldValues[k];
      if (!f) return;
      if (f.type === 'number' || f.type === 'money' || f.type === 'star') fields[k] = Number(raw) || 0;
      else if (f.type === 'checkbox') fields[k] = raw === 'true';
      else fields[k] = String(raw || '');
    });

    const wish: IWish = {
      _id: d._id || `w_${now.toString(36)}`,
      title: d.title.trim(),
      note: d.note,
      reason: d.reason.trim(),
      categoryId: d.categoryId,
      statusId,
      star: d.star,
      price: parseMoney(d.priceText) ,
      link: d.link,
      images: (prev && prev.images) || [],
      progressMode: d.progressMode,
      target: Number(d.targetText) || 0,
      current: Number(d.currentText) || 0,
      autoDone: d.autoDone,
      subTasks: d.subTasks,
      fields,
      tags: d.tagsText.split(/[\s,，]+/).filter(Boolean),
      targetDate: parseDate(d.targetDateText),
      achievedAt,
      isArchived: (prev && prev.isArchived) || false,
      archivedAt: (prev && prev.archivedAt) || 0,
      review: (prev && prev.review) || '',
      cycle: d.cycleEnabled
        ? { enabled: true, period: d.cyclePeriod as IWish['cycle'] extends null ? never : any, nextAt: now + 30 * DAY_MS }
        : null,
      budgetLink: d.budgetCategory
        ? { categoryName: d.budgetCategory, monthly: parseMoney(d.budgetMonthlyText) }
        : null,
      isPrivate: d.isPrivate,
      isPinned: d.isPinned,
      templateId: (prev && prev.templateId) || '',
      createTime: (prev && prev.createTime) || now,
      updateTime: now,
      version: (prev && prev.version) || 1
    };

    upsertWish(wish);
    this.setData({ editorOpen: false });
    toast(d._id ? '已保存' : '心愿已创建');
    if (justAchieved) {
      const nd = new Date();
      this.setData({
        celebrateOpen: true,
        celebrate: {
          title: wish.title,
          date: `${nd.getFullYear()}.${String(nd.getMonth() + 1).padStart(2, '0')}.${String(nd.getDate()).padStart(2, '0')}`
        }
      });
    }
    this.refresh();
  },

  onCelebrateClose() {
    this.setData({ celebrateOpen: false });
  },

  /* ---- 长按菜单 ---- */

  onWishLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const wish = loadWishes().find((w) => w._id === id);
    if (!wish) return;
    const items = ['编辑', wish.isPinned ? '取消置顶' : '置顶', wish.isArchived ? '取消归档' : '归档并复盘', '放弃愿望'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const idx = res.tapIndex;
        if (idx === 0) this.openEditor(wish, 'edit');
        else if (idx === 1) {
          wish.isPinned = !wish.isPinned;
          upsertWish(wish);
          this.refresh();
        } else if (idx === 2) {
          if (wish.isArchived) unarchiveWish(id);
          else this.setData({ reviewOpen: true, reviewId: id, reviewText: wish.review || '' });
          this.refresh();
        } else if (idx === 3) {
          // 放弃而非物理删除：状态流置为 dropped，可在「已放弃」中找回
          wx.showModal({
            title: '放弃愿望',
            content: '确定放弃这个愿望吗？\n\n放弃后仍可以在「已放弃」中找到它。',
            confirmText: '确定放弃',
            cancelText: '取消',
            success: (r) => {
              if (!r.confirm) return;
              const statuses = loadStatuses();
              const drop = statuses.find((s) => s.kind === 'dropped');
              if (!drop) {
                toast('未找到「已放弃」状态');
                return;
              }
              upsertWish(Object.assign({}, wish, { statusId: drop.id }));
              this.refresh();
              toast('已放入「已放弃」');
            }
          });
        }
      },
      fail: () => {}
    });
  },

  onReviewInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ reviewText: e.detail.value });
  },

  onReviewConfirm() {
    const { reviewId, reviewText } = this.data;
    if (reviewId) archiveWish(reviewId, reviewText);
    this.setData({ reviewOpen: false, reviewText: '', reviewId: '' });
    this.refresh();
    toast('已归档');
  },

  onReviewCancel() {
    this.setData({ reviewOpen: false, reviewText: '', reviewId: '' });
  },

  /* ==================== 设置：分类 / 状态 / 字段 ==================== */

  onSettingsOpen() {
    this.setData({ settingsOpen: true, settingsTab: 'category' });
  },
  onSettingsTab(e: WechatMiniprogram.TouchEvent) {
    this.setData({ settingsTab: e.currentTarget.dataset.tab as WishData['settingsTab'] });
  },
  onSettingsClose() {
    this.setData({ settingsOpen: false });
    this.refresh();
  },

  // 分类
  onCatAdd() {
    wx.showModal({
      title: '新建分类',
      editable: true,
      placeholderText: '分类名称',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const list = loadCategories();
        list.push({
          id: `cat_${Date.now().toString(36)}`,
          name: String(res.content).trim().slice(0, 8),
          icon: '⭐',
          color: '#B5714C',
          isPrivate: false,
          order: list.length
        });
        saveCategories(list);
        this.refresh();
      }
    });
  },
  onCatRemove(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const list = loadCategories();
    if (list.length <= 1) {
      toast('至少保留一个分类');
      return;
    }
    saveCategories(list.filter((c) => c.id !== id));
    this.refresh();
  },
  onCatTogglePrivate(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const list = loadCategories();
    const c = list.find((x) => x.id === id);
    if (c) {
      c.isPrivate = !c.isPrivate;
      saveCategories(list);
      this.refresh();
    }
  },

  // 状态
  onStatusAdd() {
    wx.showModal({
      title: '新建状态',
      editable: true,
      placeholderText: '状态名称，如「已下单」',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const list = loadStatuses();
        list.push({
          id: `stt_${Date.now().toString(36)}`,
          name: String(res.content).trim().slice(0, 8),
          color: '#B5714C',
          kind: 'doing',
          order: list.length
        });
        saveStatuses(list);
        this.refresh();
      }
    });
  },
  onStatusRemove(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const list = loadStatuses();
    if (list.length <= 1) {
      toast('至少保留一个状态');
      return;
    }
    saveStatuses(list.filter((s) => s.id !== id));
    this.refresh();
  },
  onStatusKind(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const list = loadStatuses();
    const s = list.find((x) => x.id === id);
    if (!s) return;
    const kinds: WishStatusKind[] = ['todo', 'doing', 'done', 'dropped'];
    const labels = ['未开始', '进行中', '已完成', '已放弃'];
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        s.kind = kinds[res.tapIndex];
        saveStatuses(list);
        this.refresh();
      },
      fail: () => {}
    });
  },

  // 字段
  onFieldAdd() {
    const types: { key: string; label: string }[] = [
      { key: 'text', label: '文本' },
      { key: 'number', label: '数字' },
      { key: 'money', label: '金额' },
      { key: 'date', label: '日期' },
      { key: 'select', label: '下拉单选' },
      { key: 'checkbox', label: '勾选' },
      { key: 'star', label: '星级' },
      { key: 'link', label: '链接' }
    ];
    wx.showActionSheet({
      itemList: types.map((t) => t.label),
      success: (res) => {
        const type = types[res.tapIndex].key;
        wx.showModal({
          title: '新字段名称',
          editable: true,
          placeholderText: '如：购买渠道',
          success: (r) => {
            if (!r.confirm || !r.content) return;
            const list = loadFields();
            list.push({
              id: `fld_${Date.now().toString(36)}`,
              name: String(r.content).trim().slice(0, 10),
              type: type as IWishField['type'],
              required: false,
              order: list.length,
              options: type === 'select' ? ['选项一', '选项二'] : undefined
            });
            saveFields(list);
            this.refresh();
          }
        });
      },
      fail: () => {}
    });
  },
  onFieldRemove(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    saveFields(loadFields().filter((f) => f.id !== id));
    this.refresh();
  },
  onFieldToggleRequired(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const list = loadFields();
    const f = list.find((x) => x.id === id);
    if (f) {
      f.required = !f.required;
      saveFields(list);
      this.refresh();
    }
  },
  onFieldMove(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const dir = Number(e.currentTarget.dataset.dir);
    const list = loadFields();
    const i = list.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    saveFields(list);
    this.refresh();
  },

  /* ==================== 模板 ==================== */

  onTemplateClose() {
    this.setData({ templateOpen: false });
  },
  onSaveAsTemplate() {
    const d = this.data.draft;
    if (!d.title.trim()) {
      toast('请先填写名称再另存为模板');
      return;
    }
    const list = loadTemplates();
    list.push({
      id: `tpl_${Date.now().toString(36)}`,
      name: d.title.trim(),
      icon: '✨',
      desc: '我的模板',
      categoryId: d.categoryId,
      progressMode: d.progressMode,
      target: Number(d.targetText) || 0,
      star: d.star,
      price: parseMoney(d.priceText),
      subTasks: d.subTasks.map((s) => s.title),
      tags: d.tagsText.split(/[\s,，]+/).filter(Boolean),
      builtin: false,
      createTime: Date.now()
    });
    saveTemplates(list);
    toast('已存为模板');
  },

  /* ==================== 年度报告 ==================== */

  onReportOpen() {
    this.buildReport(this.data.reportYear);
    this.setData({ reportOpen: true });
  },
  onReportClose() {
    this.setData({ reportOpen: false });
  },
  onYearChange(e: WechatMiniprogram.TouchEvent) {
    const dir = Number(e.currentTarget.dataset.dir);
    const year = this.data.reportYear + dir;
    this.setData({ reportYear: year });
    this.buildReport(year);
  },
  buildReport(year: number) {
    const report = buildYearReport(loadWishes(), year, loadCategories(), loadStatuses());
    this.setData({ report, reportYear: year });
  },

  onShareAppMessage() {
    return { title: '我的愿望清单', path: '/pages/wish/wish' };
  }
});

/* ==================== 子任务树工具 ==================== */

function toggleNode(nodes: IWishSubTask[], id: string): IWishSubTask[] {
  return nodes.map((n) => {
    if (n.id === id) return Object.assign({}, n, { done: !n.done, doneAt: !n.done ? Date.now() : 0 });
    if (n.children && n.children.length) return Object.assign({}, n, { children: toggleNode(n.children, id) });
    return n;
  });
}

function addChildNode(nodes: IWishSubTask[], id: string, node: IWishSubTask): IWishSubTask[] {
  return nodes.map((n) => {
    if (n.id === id) return Object.assign({}, n, { children: [...(n.children || []), node] });
    if (n.children && n.children.length) return Object.assign({}, n, { children: addChildNode(n.children, id, node) });
    return n;
  });
}

function removeNode(nodes: IWishSubTask[], id: string): IWishSubTask[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.children && n.children.length ? Object.assign({}, n, { children: removeNode(n.children, id) }) : n));
}

function renameNode(nodes: IWishSubTask[], id: string, title: string): IWishSubTask[] {
  return nodes.map((n) => {
    if (n.id === id) return Object.assign({}, n, { title });
    if (n.children && n.children.length) return Object.assign({}, n, { children: renameNode(n.children, id, title) });
    return n;
  });
}
