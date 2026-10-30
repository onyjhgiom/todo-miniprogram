// pages/note/note.ts
// 便签页：手账风分类筛选 + 便签墙 + 新建/编辑弹窗(分类/颜色/背景样式/图样实时预览) + 外观设置面板
import { getThemeState, syncNavBar } from '../../utils/theme';
import { toast } from '../../utils/cloud';
import {
  loadNotes,
  upsertNote,
  removeNote,
  clearNotes,
  loadFromCloud,
  sortNotes,
  newNoteId,
  loadNoteDefaults,
  saveNoteDefaults
} from '../../utils/note-storage';
import {
  NOTE_COLORS,
  NOTE_PATTERNS,
  NOTE_FIGURES,
  NOTE_COLOR_FILTERS,
  NOTE_CATEGORIES,
  buildNoteVisual,
  colorGroupOf,
  categoryGroupOf,
  categoryOf,
  inferCategory,
  figureEmoji
} from '../../utils/note-presets';
import type {
  ThemeKey,
  INote,
  INoteDraft,
  NotePatternKey,
  NoteFigureKey,
  NoteCategoryKey
} from '../../types/index';
import type { NoteColorOption, NotePatternOption, NoteFigureOption, NoteCategoryOption } from '../../utils/note-presets';

/** 卡片顶部胶带四色循环（参考稿：粉 / 黄 / 绿 / 紫） */
const NOTE_TAPE_COLORS = ['#F7D9DC', '#F8E4AD', '#DCEBD9', '#DDD4EB'];
/** 卡片右上角图钉符号循环 */
const NOTE_PIN_ICONS = ['♡', '✦', '☁', '✿'];

interface NoteVisual {
  bgStyle: string;
  ink: string;
  accent: string;
}

interface DecoratedNote extends INote {
  visual: NoteVisual;
  figureEmoji: string;
  timeText: string;
  /** 「10月07日」卡片底部日期（参考稿格式） */
  dateText: string;
  /** 卡片标题（老数据无 title 时为空，卡片隐藏标题行） */
  titleText: string;
  /** 分类展示信息 */
  catLabel: string;
  catIcon: string;
  catInk: string;
  /** 胶带底色（按 seq 循环四色） */
  tapeColor: string;
  /** 右上角图钉符号（按 seq 循环） */
  pinIcon: string;
  /** 卡片序号（用于手账随机微旋转） */
  seq: number;
}

interface EditorDraft extends INoteDraft {}

interface NotePageData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  themeName: string;
  // 列表
  allNotes: DecoratedNote[];
  displayNotes: DecoratedNote[];
  totalCount: number;
  keyword: string;
  activeCategory: string;
  categories: (NoteCategoryOption & { count: number })[];
  // 颜色筛选（折叠式，保留原有能力）
  showColorFilter: boolean;
  activeColor: string;
  colorFilters: typeof NOTE_COLOR_FILTERS;
  // 弹窗
  modalOpen: boolean;
  modalMode: 'editor' | 'defaults';
  editingId: string | null;
  draft: EditorDraft;
  draftCount: number;
  // 预览
  previewStyle: string;
  previewInk: string;
  previewAccent: string;
  previewFigure: string;
  previewText: string;
  // 预设
  palette: NoteColorOption[];
  patterns: NotePatternOption[];
  figures: NoteFigureOption[];
  categoryOptions: NoteCategoryOption[];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function timeText(ts: number): string {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  const minute = 60000;
  const hour = 3600000;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  const d = new Date(ts);
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ts >= dayStart) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= dayStart - 86400000) return '昨天';
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

/** 「10月07日」—— 参考稿卡片底部的日期格式 */
function dateText(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${pad(d.getDate())}日`;
}

function decorate(n: INote, seq: number): DecoratedNote {
  const visual = buildNoteVisual(n.colorKey, n.patternKey);
  const cat = categoryOf(inferCategory(n));
  const ts = n.updateTime || n.createTime;
  const d: DecoratedNote = {
    ...n,
    category: inferCategory(n),
    visual,
    figureEmoji: figureEmoji(n.figureKey),
    timeText: timeText(ts),
    dateText: dateText(ts),
    titleText: (n.title || '').trim(),
    catLabel: cat.label,
    catIcon: cat.icon,
    catInk: cat.ink,
    // 胶带配色按 seq 循环（粉/黄/绿/紫），呼应参考稿的四种彩色胶带
    tapeColor: NOTE_TAPE_COLORS[seq % 4],
    // 图钉符号按 seq 循环
    pinIcon: NOTE_PIN_ICONS[seq % 4],
    seq
  };
  return d;
}

function toDraft(n: Partial<INote>, fallbackCategory?: NoteCategoryKey): EditorDraft {
  const category = inferCategory({ category: n.category || fallbackCategory, colorKey: n.colorKey || '' });
  const cat = categoryOf(category);
  // 底色与分类色系不一致时，用该分类默认底色（新建/切分类都保持协调）
  const sameGroup = n.colorKey ? colorGroupOf(n.colorKey) === categoryGroupOf(category) : false;
  return {
    content: n.content || '',
    title: n.title || '',
    category,
    colorKey: sameGroup ? (n.colorKey as string) : cat.defaultColorKey,
    patternKey: n.patternKey || 'solid',
    figureKey: n.figureKey || 'none',
    pinned: !!n.pinned
  };
}

Page<NotePageData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    themeName: '',
    allNotes: [],
    displayNotes: [],
    totalCount: 0,
    keyword: '',
    activeCategory: 'all',
    categories: [],
    showColorFilter: false,
    activeColor: 'all',
    colorFilters: NOTE_COLOR_FILTERS,
    modalOpen: false,
    modalMode: 'editor',
    editingId: null,
    draft: toDraft({}),
    draftCount: 0,
    previewStyle: '',
    previewInk: '',
    previewAccent: '',
    previewFigure: '',
    previewText: '',
    palette: NOTE_COLORS,
    patterns: NOTE_PATTERNS,
    figures: NOTE_FIGURES,
    categoryOptions: NOTE_CATEGORIES
  },

  onLoad() {
    this.applyThemeToPage();
    this.refreshList();
  },

  onShow() {
    this.applyThemeToPage();
    // 云端合并(尽力而为)，随后刷新本地渲染
    loadFromCloud().then(() => this.refreshList());
  },

  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient,
      themeName: state.themeName
    } as Record<string, unknown>);
    syncNavBar(state);
  },

  // ===== 列表 =====
  refreshList() {
    const notes = sortNotes(loadNotes()).map(decorate);
    this.setData({ allNotes: notes });
    this.applyFilter();
  },

  applyFilter() {
    const { allNotes, keyword, activeCategory, activeColor } = this.data;
    const q = (keyword || '').trim().toLowerCase();

    // 分类计数（不受分类/颜色筛选影响，仅受搜索影响，便于展示真实数量）
    const scope = q
      ? allNotes.filter((n) => (n.content || '').toLowerCase().indexOf(q) >= 0)
      : allNotes;
    const categories = NOTE_CATEGORIES.map((c) => ({
      ...c,
      count: scope.filter((n) => inferCategory(n) === c.key).length
    }));

    let list = allNotes;
    if (activeCategory !== 'all') {
      list = list.filter((n) => inferCategory(n) === activeCategory);
    }
    if (activeColor !== 'all') {
      list = list.filter((n) => colorGroupOf(n.colorKey) === activeColor);
    }
    if (q) {
      list = list.filter((n) => (n.content || '').toLowerCase().indexOf(q) >= 0);
    }
    this.setData({ displayNotes: list, totalCount: allNotes.length, categories });
  },

  onSearch(e: WechatMiniprogram.InputEvent) {
    this.setData({ keyword: e.detail.value }, () => this.applyFilter());
  },

  onClearSearch() {
    if (!this.data.keyword) return;
    this.setData({ keyword: '' }, () => this.applyFilter());
  },

  onColorFilter(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === this.data.activeColor) return;
    this.setData({ activeColor: key }, () => this.applyFilter());
  },

  onCategoryFilter(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === this.data.activeCategory) return;
    this.setData({ activeCategory: key }, () => this.applyFilter());
  },

  onToggleColorFilter() {
    this.setData({ showColorFilter: !this.data.showColorFilter });
  },

  // ===== 顶部操作 =====
  onMenu() {
    wx.showActionSheet({
      itemList: ['清空全部便签'],
      success: (res) => {
        if (res.tapIndex === 0) this.onClearAll();
      }
    });
  },

  onSettings() {
    // 打开外观设置面板（默认外观，实时预览）
    this.openModal('defaults', null);
  },

  onFAB() {
    const def = loadNoteDefaults();
    // 新建便签继承当前选中的分类（全部 → life）
    const active = this.data.activeCategory;
    const category = (active !== 'all' ? active : def.category || 'life') as NoteCategoryKey;
    this.openModal('editor', null, { ...def, category });
  },

  onClearAll() {
    wx.showModal({
      title: '清空全部便签',
      content: '将删除所有便签，且不可恢复。确定吗？',
      confirmColor: '#e11d48',
      success: (res) => {
        if (!res.confirm) return;
        clearNotes();
        this.refreshList();
        toast('已清空', 'success');
      }
    });
  },

  // ===== 弹窗 =====
  openModal(
    mode: 'editor' | 'defaults',
    id: string | null,
    base?: { colorKey: string; patternKey: NotePatternKey; figureKey: NoteFigureKey; category?: NoteCategoryKey }
  ) {
    let draft: EditorDraft;
    let count = 0;
    if (mode === 'editor' && id) {
      const note = loadNotes().find((n) => n._id === id);
      draft = toDraft(note || {});
      count = draft.content.length;
    } else {
      const def = base || loadNoteDefaults();
      draft = toDraft({ colorKey: def.colorKey, patternKey: def.patternKey, figureKey: def.figureKey, category: def.category });
      count = draft.content.length;
    }
    this.setData({
      modalOpen: true,
      modalMode: mode,
      editingId: id,
      draft,
      draftCount: count
    });
    this.buildPreview();
  },

  onModalClose() {
    this.setData({ modalOpen: false, editingId: null });
  },

  onModalStop() {
    /* 阻止冒泡到 mask */
  },

  onModalSave() {
    if (this.data.modalMode === 'defaults') {
      const { draft } = this.data;
      saveNoteDefaults({
        colorKey: draft.colorKey,
        patternKey: draft.patternKey,
        figureKey: draft.figureKey,
        category: draft.category
      });
      toast('已设为默认外观', 'success');
      this.onModalClose();
      return;
    }
    const { draft, editingId } = this.data;
    const content = draft.content.trim();
    if (!content) {
      toast('写点什么吧');
      return;
    }
    const now = Date.now();
    const note: INote = {
      _id: editingId || newNoteId(),
      content,
      title: (draft.title || '').trim(),
      category: draft.category,
      colorKey: draft.colorKey,
      patternKey: draft.patternKey,
      figureKey: draft.figureKey,
      pinned: draft.pinned,
      createTime: editingId ? (loadNotes().find((n) => n._id === editingId)?.createTime || now) : now,
      updateTime: now
    };
    upsertNote(note);
    this.refreshList();
    toast(editingId ? '已更新' : '已保存', 'success');
    this.onModalClose();
  },

  // ===== 分类选择 =====
  onCategoryPick(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as NoteCategoryKey;
    if (!key || key === this.data.draft.category) return;
    const cat = categoryOf(key);
    // 若当前底色不在该分类色系内，自动切到该分类默认色
    const keepColor = colorGroupOf(this.data.draft.colorKey) === categoryGroupOf(key);
    this.setData({
      'draft.category': key,
      ...(keepColor ? {} : { 'draft.colorKey': cat.defaultColorKey })
    });
    this.buildPreview();
  },

  // ===== 弹窗输入 =====
  onDraftInput(e: WechatMiniprogram.InputEvent) {
    const value = e.detail.value;
    const safe = value && value.length > 500 ? value.slice(0, 500) : value || '';
    this.setData({ 'draft.content': safe, draftCount: safe.length });
    this.buildPreview();
  },

  /** 标题输入（参考稿每条便签有一个短标题） */
  onDraftTitle(e: WechatMiniprogram.InputEvent) {
    const value = e.detail.value;
    const safe = value && value.length > 20 ? value.slice(0, 20) : value || '';
    this.setData({ 'draft.title': safe });
  },

  onColorPick(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === this.data.draft.colorKey) return;
    this.setData({ 'draft.colorKey': key });
    this.buildPreview();
  },

  onPatternPick(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as NotePatternKey;
    if (key === this.data.draft.patternKey) return;
    this.setData({ 'draft.patternKey': key });
    this.buildPreview();
  },

  onFigurePick(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as NoteFigureKey;
    if (key === this.data.draft.figureKey) return;
    this.setData({ 'draft.figureKey': key });
    this.buildPreview();
  },

  onPinToggle(e: WechatMiniprogram.TouchEvent) {
    const detail = e.detail as { value?: boolean };
    this.setData({ 'draft.pinned': !!detail.value });
  },

  buildPreview() {
    const { draft } = this.data;
    const visual = buildNoteVisual(draft.colorKey, draft.patternKey);
    this.setData({
      previewStyle: visual.bgStyle,
      previewInk: visual.ink,
      previewAccent: visual.accent,
      previewFigure: figureEmoji(draft.figureKey),
      previewText: draft.content || '写点什么…'
    });
  },

  // ===== 便签操作 =====
  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.openModal('editor', id);
  },

  onLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) this.openModal('editor', id);
        else if (res.tapIndex === 1) this.confirmDelete(id);
      }
    });
  },

  confirmDelete(id: string) {
    wx.showModal({
      title: '删除便签',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#e11d48',
      success: (res) => {
        if (!res.confirm) return;
        removeNote(id);
        this.refreshList();
        toast('已删除', 'success');
      }
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '便签 · 随手一贴', path: '/pages/note/note' };
  }
});
