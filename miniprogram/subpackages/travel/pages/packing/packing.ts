// subpackages/travel/pages/packing/packing.ts
// 行李清单：分类折叠分组 · 进度条与撒花 · 筛选 · 批量模式 · 智能生成 · 物品编辑
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import * as store from '../../utils/travel-store';
import { PACKING_TEMPLATES, SCENE_KEYS, sceneMeta } from '../../utils/trip-templates';
import type { IPackingItem, TravelScene } from '../../utils/travel-types';
import type { ThemeKey } from '../../../../types/index';

interface ViewItem {
  _id: string;
  name: string;
  category: string;
  count: number;
  owner: string;
  isEssential: boolean;
  packed: boolean;
  note: string;
  reminderText: string;
}

interface ViewGroup {
  category: string;
  categoryEmoji: string;
  items: ViewItem[];
  total: number;
  packed: number;
  percent: number;
  essentialLeft: number;
  collapsed: boolean;
}

interface SceneChip {
  key: TravelScene;
  name: string;
  icon: string;
  desc: string;
  on: boolean;
}

interface PackingData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  id: string;
  tripTitle: string;
  destination: string;

  groups: ViewGroup[];
  packed: number;
  total: number;
  percent: number;
  essentialLeft: number;
  allDone: boolean;

  /** 筛选 */
  filter: 'all' | 'unpacked' | 'essential';
  owner: string;
  owners: string[];

  /** 批量 */
  batchMode: boolean;
  selected: string[];
  categories: string[];

  /** 智能生成引导 */
  showGen: boolean;
  scenes: SceneChip[];
  genInfo: string;

  /** 物品编辑 */
  showEditor: boolean;
  isNew: boolean;
  draft: {
    _id: string;
    name: string;
    category: string;
    count: number;
    owner: string;
    isEssential: boolean;
    reminderDaysBefore: number;
    /** 提醒天数的展示文案（picker 回显用，wxml 无法做下标映射） */
    reminderText: string;
    note: string;
  } | null;

  /** 撒花 */
  showConfetti: boolean;
  confettiDots: { left: number; delay: number; color: string; size: number }[];

  /** 模板库（整套一键导入） */
  templateList: { key: string; name: string; icon: string; count: number }[];
  /** 出发前提醒：picker 文案 与 天数一一对应 */
  reminderLabels: string[];
  reminderDays: number[];
}

const CAT_EMOJI: Record<string, string> = {
  证件: '🪪',
  衣物: '👕',
  洗漱: '🧴',
  电子: '🔌',
  药品: '💊',
  母婴: '🍼',
  其他: '🎒'
};

const CONFETTI_COLORS = ['#B5714C', '#C09A5E', '#6E8E6E', '#C0522F', '#4C8DAE', '#D8A05C'];

function decorateItems(list: IPackingItem[]): ViewItem[] {
  return list.map((p) => ({
    _id: p._id,
    name: p.name,
    category: p.category,
    count: Number(p.count) || 1,
    owner: p.owner || '',
    isEssential: !!p.isEssential,
    packed: !!p.packed,
    note: p.note || '',
    reminderText: (p.reminderDaysBefore || 0) > 0 ? `出发前 ${p.reminderDaysBefore} 天提醒` : ''
  }));
}

Page<PackingData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    id: '',
    tripTitle: '',
    destination: '',
    groups: [],
    packed: 0,
    total: 0,
    percent: 0,
    essentialLeft: 0,
    allDone: false,
    filter: 'all',
    owner: '',
    owners: [],
    batchMode: false,
    selected: [],
    categories: [],
    showGen: false,
    scenes: [],
    genInfo: '',
    showEditor: false,
    isNew: false,
    draft: null,
    showConfetti: false,
    confettiDots: [],
    templateList: PACKING_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      icon: t.icon,
      count: t.items.length
    })),
    reminderLabels: ['不提醒', '出发前 1 天', '出发前 3 天', '出发前 7 天', '出发前 15 天'],
    reminderDays: [0, 1, 3, 7, 15]
  },

  /** 上一次的完成状态：用于判断是否该放撒花（只在「从不全到全」那一次触发） */
  wasAllDone: false,
  /** 用户是否手动关过生成引导（关过就不再自动弹） */
  genDismissed: false,

  onLoad(q: Record<string, string>) {
    this.applyTheme();
    const id = (q && q.id) || '';
    if (!id) {
      toast('缺少行程 id', 'none');
      return;
    }
    this.setData({
      id,
      scenes: SCENE_KEYS.map((k) => ({
        key: k,
        name: sceneMeta(k).name,
        icon: sceneMeta(k).icon,
        desc: sceneMeta(k).desc,
        on: false
      }))
    });
    this.refresh();
    this.unsub = store.subscribe(() => this.refresh());
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
    const opts: { onlyUnpacked?: boolean; onlyEssential?: boolean; owner?: string } = {};
    if (this.data.filter === 'unpacked') opts.onlyUnpacked = true;
    if (this.data.filter === 'essential') opts.onlyEssential = true;
    if (this.data.owner) opts.owner = this.data.owner;

    const groups = store.packingGroups(this.data.id, opts).map((g) => ({
      ...g,
      categoryEmoji: CAT_EMOJI[g.category] || '🎒',
      items: decorateItems(g.items),
      collapsed: false
    }));

    const prog = store.packingProgress(this.data.id);
    const allDone = prog.total > 0 && prog.packed === prog.total;

    this.setData({
      tripTitle: trip ? trip.title : '',
      destination: trip ? trip.destination : '',
      groups,
      packed: prog.packed,
      total: prog.total,
      percent: prog.percent,
      essentialLeft: prog.essentialLeft,
      allDone,
      owners: store.packingOwners(this.data.id),
      // 空清单首次进入自动弹生成引导；用户关掉后不再自动打扰
      showGen: prog.total === 0 && !this.genDismissed,
      categories: this.collectCategories()
    });

    // 全部完成 → 撒花 + 祝贺（只在跨过临界点时触发一次）
    if (allDone && !this.wasAllDone) {
      this.setData({ showConfetti: true, confettiDots: makeConfetti() });
      setTimeout(() => this.setData({ showConfetti: false }), 2600);
      wx.vibrateShort({ type: 'medium', fail: () => {} });
      setTimeout(() => {
        wx.showModal({
          title: '🎉 全部打包完成',
          content: `${prog.total} 件物品已全部就位，祝你旅途愉快！`,
          showCancel: false,
          confirmText: '好耶'
        });
      }, 600);
    }
    this.wasAllDone = allDone;
  },

  /* ============================ 勾选 / 编辑 ============================ */

  onToggle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    let packed = false;
    for (const g of this.data.groups) {
      const it = g.items.find((i) => i._id === id);
      if (it) {
        packed = !it.packed;
        break;
      }
    }
    void store.togglePacked(id, packed);
  },

  onToggleGroup(e: WechatMiniprogram.TouchEvent) {
    const cat = e.currentTarget.dataset.cat as string;
    this.setData({
      groups: this.data.groups.map((g) => (g.category === cat ? { ...g, collapsed: !g.collapsed } : g))
    });
  },

  onAddItem() {
    this.openEditor(null);
  },

  onEditItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const raw = store.listPacking(this.data.id).find((p) => p._id === id);
    if (raw) this.openEditor(raw);
  },

  openEditor(raw: IPackingItem | null) {
    const days = raw ? Number(raw.reminderDaysBefore) || 0 : 0;
    this.setData({
      showEditor: true,
      isNew: !raw,
      draft: {
        _id: raw ? raw._id : '',
        name: raw ? raw.name : '',
        category: raw ? raw.category : '其他',
        count: raw ? Number(raw.count) || 1 : 1,
        owner: raw ? raw.owner : '',
        isEssential: raw ? !!raw.isEssential : false,
        reminderDaysBefore: days,
        reminderText: this.reminderLabel(days),
        note: raw ? raw.note : ''
      }
    });
  },

  /** 天数 → 展示文案（0/1/3/7/15 之外的自定义值直接拼） */
  reminderLabel(days: number): string {
    const i = this.data.reminderDays.indexOf(days);
    if (i >= 0) return this.data.reminderLabels[i];
    return days > 0 ? `出发前 ${days} 天` : '不提醒';
  },

  onCloseEditor() {
    this.setData({ showEditor: false, draft: null });
  },

  onNoop() {
    /* 阻止穿透 */
  },

  onDraftInput(e: WechatMiniprogram.InputEvent) {
    const key = e.currentTarget.dataset.key as string;
    const d = this.data.draft;
    if (!d) return;
    const patch: Record<string, string | number> = {};
    patch[key] = e.detail.value;
    this.setData({ draft: { ...d, ...patch } as PackingData['draft'] });
  },

  onDraftCategory(e: WechatMiniprogram.PickerChangeEvent) {
    const d = this.data.draft;
    if (!d) return;
    const idx = Number(e.detail.value) || 0;
    this.setData({ draft: { ...d, category: this.data.categories[idx] || '其他' } });
  },

  onDraftEssential(e: { detail: { value: boolean } }) {
    const d = this.data.draft;
    if (!d) return;
    this.setData({ draft: { ...d, isEssential: !!e.detail.value } });
  },

  onDraftCount(e: WechatMiniprogram.TouchEvent) {
    const delta = Number(e.currentTarget.dataset.delta);
    const d = this.data.draft;
    if (!d) return;
    this.setData({ draft: { ...d, count: Math.max(1, Math.min(99, d.count + delta)) } });
  },

  /** picker 给的是下标，要换成真实天数（0/1/3/7/15） */
  onDraftReminder(e: WechatMiniprogram.PickerChangeEvent) {
    const d = this.data.draft;
    if (!d) return;
    const idx = Number(e.detail.value) || 0;
    const days = this.data.reminderDays[idx] || 0;
    this.setData({ draft: { ...d, reminderDaysBefore: days, reminderText: this.reminderLabel(days) } });
  },

  onSaveDraft() {
    const d = this.data.draft;
    if (!d) return;
    const name = (d.name || '').trim();
    if (!name) {
      toast('物品名称不能为空', 'none');
      return;
    }
    const payload = {
      name,
      category: d.category,
      count: d.count,
      owner: d.owner,
      isEssential: d.isEssential,
      reminderDaysBefore: d.reminderDaysBefore,
      note: d.note
    };
    if (d._id) {
      void store.updatePackingItem(d._id, payload).then(() => {
        this.setData({ showEditor: false, draft: null });
        toast('已更新', 'success');
      });
    } else {
      void store.addPackingItem(this.data.id, payload).then(() => {
        this.setData({ showEditor: false, draft: null });
        toast('已添加', 'success');
      });
    }
  },

  onDeleteDraft() {
    const d = this.data.draft;
    if (!d || !d._id) return;
    wx.showModal({
      title: '删除物品',
      content: `确认删除「${d.name}」？`,
      confirmColor: '#C0522F',
      success: (m) => {
        if (!m.confirm) return;
        void store.removePackingItem(d._id).then(() => {
          this.setData({ showEditor: false, draft: null });
          toast('已删除', 'success');
        });
      }
    });
  },

  /* ============================ 筛选 ============================ */

  onFilter(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as PackingData['filter'];
    this.setData({ filter: key }, () => this.refresh());
  },

  onOwner(e: WechatMiniprogram.PickerChangeEvent) {
    const idx = Number(e.detail.value) || 0;
    const owner = idx === 0 ? '' : this.data.owners[idx - 1] || '';
    this.setData({ owner }, () => this.refresh());
  },

  /* ============================ 批量模式 ============================ */

  onToggleBatch() {
    this.setData({ batchMode: !this.data.batchMode, selected: [] });
  },

  onSelectItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const cur = this.data.selected;
    this.setData({
      selected: cur.indexOf(id) >= 0 ? cur.filter((i) => i !== id) : cur.concat([id])
    });
  },

  onSelectAll() {
    const all: string[] = [];
    this.data.groups.forEach((g) => g.items.forEach((i) => all.push(i._id)));
    this.setData({ selected: all });
  },

  onBatchDelete() {
    const ids = this.data.selected;
    if (!ids.length) {
      toast('先选择物品', 'none');
      return;
    }
    wx.showModal({
      title: '批量删除',
      content: `确认删除选中的 ${ids.length} 件物品？`,
      confirmColor: '#C0522F',
      success: (m) => {
        if (!m.confirm) return;
        void store.batchRemovePacking(ids).then(() => {
          this.setData({ selected: [] });
          toast('已删除', 'success');
        });
      }
    });
  },

  onBatchCategory(e: WechatMiniprogram.PickerChangeEvent) {
    const ids = this.data.selected;
    if (!ids.length) {
      toast('先选择物品', 'none');
      return;
    }
    const idx = Number(e.detail.value) || 0;
    const category = this.data.categories[idx] || '其他';
    void store.batchSetCategory(ids, category).then(() => {
      this.setData({ selected: [] });
      toast(`已改为「${category}」`, 'success');
    });
  },

  /* ============================ 智能生成 ============================ */

  onOpenGen() {
    this.setData({ showGen: true });
  },

  onCloseGen() {
    this.genDismissed = true;
    this.setData({ showGen: false });
  },

  onToggleSceneChip(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as TravelScene;
    this.setData({
      scenes: this.data.scenes.map((s) => (s.key === key ? { ...s, on: !s.on } : s))
    });
  },

  onGenerate() {
    const scenes = this.data.scenes.filter((s) => s.on).map((s) => s.key);
    if (!scenes.length) {
      toast('至少选一个场景', 'none');
      return;
    }
    wx.showLoading({ title: '生成清单', mask: true });
    void store.applyPackingTemplate(this.data.id, scenes).then((n) => {
      wx.hideLoading();
      this.setData({ showGen: false });
      toast(`已生成 ${n} 件物品`, 'success');
      this.refresh();
    });
  },

  /** 直接用整套模板模式（一键导入） */
  onUseTemplate(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const tpl = PACKING_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    wx.showLoading({ title: '导入中', mask: true });
    const scenes: TravelScene[] = tpl.scene === '通用' ? [] : [tpl.scene as TravelScene];
    void store.applyPackingTemplate(this.data.id, scenes).then((n) => {
      wx.hideLoading();
      toast(`已导入 ${n} 件物品`, 'success');
      this.refresh();
    });
  },

  onClearAll() {
    wx.showModal({
      title: '清空清单',
      content: '清空当前行程的全部行李物品？',
      confirmColor: '#C0522F',
      success: (m) => {
        if (!m.confirm) return;
        void store.clearPacking(this.data.id).then(() => toast('已清空', 'success'));
      }
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: `${this.data.tripTitle || '旅行'} · 行李清单 ${this.data.packed}/${this.data.total}`,
      path: `/subpackages/travel/pages/packing/packing?id=${this.data.id}`
    };
  },

  /** 预置分类 + 本行程里出现过的自定义分类，供选择器使用 */
  collectCategories(): string[] {
    const base = ['证件', '衣物', '洗漱', '电子', '药品', '母婴', '其他'];
    try {
      const extra = Array.from(new Set(store.listPacking(this.data.id).map((p) => p.category))).filter(
        (c) => base.indexOf(c) < 0
      );
      return base.concat(extra);
    } catch (_e) {
      return base;
    }
  }
});


/** 生成撒花粒子（位置/延迟/颜色随机，纯展示数据） */
function makeConfetti(): { left: number; delay: number; color: string; size: number }[] {
  const dots: { left: number; delay: number; color: string; size: number }[] = [];
  for (let i = 0; i < 28; i += 1) {
    dots.push({
      left: Math.floor(Math.random() * 96),
      delay: Math.floor(Math.random() * 600),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 10 + Math.floor(Math.random() * 10)
    });
  }
  return dots;
}

