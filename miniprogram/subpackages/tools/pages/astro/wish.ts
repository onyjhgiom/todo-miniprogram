// pages/astro/wish.ts
// 星愿：心愿增删改 + 状态机 + 目标时间倒数 + 分类/心情/置顶 + 筛选/归档（仅本地）
import { NS, listAll, addRecord, updateRecord, deleteRecord } from '../../utils/astro-store';

type WishStatus = 'pending' | 'done' | 'archived';

interface WishItem {
  id: string;
  title: string;
  content: string;
  category: string;
  mood: string;
  pinned: boolean;
  status: WishStatus;
  targetAt?: string;
  /** 由 astro-store.addRecord 自动补；入参侧可选 */
  createdAt?: number;
}

interface ViewWish extends WishItem {
  createAt: string;
  targetLeft?: string;
  catColor: string;
  catColor2: string;
}

interface PageData {
  rawList: ViewWish[];
  filtered: ViewWish[];
  visible: ViewWish[];   // 分页渲染：当前已加载的前 N 条（wx:for 用它，防大列表卡顿）
  shown: number;         // 已加载条数
  pageSize: number;      // 每批加载条数
  status: 'pending' | 'done' | 'all';
  showArchived: boolean;
  statusFilters: { key: PageData['status']; label: string }[];
  categories: { key: string; label: string; c1: string; c2: string }[];
  moods: { key: string; emoji: string; label: string }[];
  editorOpen: boolean;
  editor: { id?: string; title: string; content: string; category: string; mood: string; targetAt: string };
}

const CATEGORIES = [
  { key: 'grow', label: '个人成长', c1: '#B5714C', c2: '#D8A05C' },
  { key: 'love', label: '感情心愿', c1: '#f472b6', c2: '#fb7185' },
  { key: 'study', label: '学业目标', c1: '#60a5fa', c2: '#3b82f6' },
  { key: 'wealth', label: '财富期待', c1: '#fbbf24', c2: '#f59e0b' },
  { key: 'other', label: '其他', c1: '#A9915C', c2: '#7E9E7E' }
];

const MOODS = [
  { key: 'calm', emoji: '😌', label: '平静' },
  { key: 'happy', emoji: '😊', label: '开心' },
  { key: 'hope', emoji: '🌟', label: '期待' },
  { key: 'doubt', emoji: '🌫️', label: '迷茫' }
];

Page<PageData>({
  data: {
    rawList: [], filtered: [], visible: [], shown: 0, pageSize: 10,
    status: 'pending',
    showArchived: false,
    statusFilters: [
      { key: 'pending', label: '进行中' },
      { key: 'done', label: '已达成' },
      { key: 'all', label: '全部' }
    ],
    categories: CATEGORIES,
    moods: MOODS,
    editorOpen: false,
    editor: { title: '', content: '', category: 'grow', mood: '', targetAt: '' }
  },

  onShow() { this.applyList(); },

  /** 触底加载下一页：每次追加 pageSize 条（模拟虚拟列表分批渲染，防卡片过多卡顿） */
  onReachBottom() {
    const { filtered, shown, pageSize } = this.data;
    if (shown >= filtered.length) return;
    const next = Math.min(filtered.length, shown + pageSize);
    this.setData({ shown: next, visible: filtered.slice(0, next) });
  },

  applyList() {
    const list = listAll<WishItem>(NS.wish).slice();
    const view: ViewWish[] = list.map((w) => {
      const cat = CATEGORIES.find((c) => c.key === w.category) || CATEGORIES[4];
      return {
        ...w,
        createAt: fmtDate(w.createdAt),
        targetLeft: w.targetAt ? leftLabel(w.targetAt) : '',
        catColor: cat.c1, catColor2: cat.c2
      };
    });
    view.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
    const filtered = view.filter((w) => {
      if (!this.data.showArchived && w.status === 'archived') return false;
      if (this.data.status === 'all') return true;
      return w.status === this.data.status;
    });
    // 全量结果保留用于计数/筛选，渲染用分页切片 visible（重置到第一页）
    const shown = Math.min(this.data.pageSize, filtered.length);
    this.setData({ rawList: view, filtered, shown, visible: filtered.slice(0, shown) });
  },

  onPickStatus(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.key as PageData['status'];
    if (k === this.data.status) return;
    this.setData({ status: k }, () => this.applyList());
  },

  onToggleArchived() {
    this.setData({ showArchived: !this.data.showArchived }, () => this.applyList());
  },

  onNew() {
    this.setData({ editorOpen: true, editor: { title: '', content: '', category: 'grow', mood: '', targetAt: '' } });
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const w = this.data.rawList.find((x) => x.id === id);
    if (!w) return;
    this.setData({
      editorOpen: true,
      editor: { id: w.id, title: w.title, content: w.content, category: w.category, mood: w.mood, targetAt: w.targetAt || '' }
    });
  },

  onCloseEditor() { this.setData({ editorOpen: false }); },

  noop() {},

  onEditTitle(e: WechatMiniprogram.InputEvent) { this.setData({ 'editor.title': e.detail.value }); },
  onEditContent(e: WechatMiniprogram.InputEvent) { this.setData({ 'editor.content': e.detail.value }); },

  onPickCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'editor.category': e.currentTarget.dataset.key as string });
  },

  onPickEditMood(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ 'editor.mood': this.data.editor.mood === key ? '' : key });
  },

  onPickTarget(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ 'editor.targetAt': e.detail.value as string });
  },

  onSaveWish() {
    const ed = this.data.editor;
    if (!ed.title.trim()) { wx.showToast({ title: '请填写心愿标题', icon: 'none' }); return; }
    if (!ed.content.trim()) { wx.showToast({ title: '请写下详情', icon: 'none' }); return; }
    if (ed.id) {
      updateRecord<WishItem>(NS.wish, ed.id, {
        title: ed.title, content: ed.content, category: ed.category, mood: ed.mood, targetAt: ed.targetAt || undefined
      });
    } else {
      addRecord<WishItem>(NS.wish, {
        id: '',
        title: ed.title, content: ed.content, category: ed.category, mood: ed.mood, pinned: false, status: 'pending',
        targetAt: ed.targetAt || undefined
      });
    }
    this.setData({ editorOpen: false });
    this.applyList();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onPin(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const w = this.data.rawList.find((x) => x.id === id);
    if (!w) return;
    updateRecord<WishItem>(NS.wish, id, { pinned: !w.pinned });
    this.applyList();
  },

  onToggleStatus(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const next = e.currentTarget.dataset.status as WishStatus;
    updateRecord<WishItem>(NS.wish, id, { status: next });
    this.applyList();
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除心愿', content: '确认删除这条心愿吗？',
      success: (r) => { if (r.confirm) { deleteRecord(NS.wish, id); this.applyList(); } }
    });
  }
});

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
  const dd = (d.getDate() < 10 ? '0' : '') + d.getDate();
  const hh = (d.getHours() < 10 ? '0' : '') + d.getHours();
  const mm = (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  return y + '-' + m + '-' + dd + ' ' + hh + ':' + mm;
}

function leftLabel(target: string): string {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return '已到期';
  const d = Math.floor(ms / 86400_000);
  if (d >= 1) return '剩 ' + d + ' 天';
  const h = Math.floor(ms / 3600_000);
  if (h >= 1) return '剩 ' + h + ' 小时';
  const m2 = Math.floor(ms / 60_000);
  return '剩 ' + m2 + ' 分钟';
}