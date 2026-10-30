// subpackages/travel/pages/trip-summary/trip-summary.ts
// 复盘归档：去过的地方 · 花费分类 · 完成度 · 没用到的物品 · 忘了带的 · 实际 vs 计划 · 日记归档 · 复制为模板
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { go } from '../../../../utils/nav';
import * as store from '../../utils/travel-store';
import type { TripSummary as ISummary, ITripNote } from '../../utils/travel-types';
import type { ThemeKey } from '../../../../types/index';

interface NoteView {
  _id: string;
  day: number;
  dayText: string;
  text: string;
  photos: string[];
  photoCount: number;
  editing: boolean;
}

interface TripSummaryData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  id: string;
  s: ISummary | null;
  /** 去过的地方（最多展示 8 个） */
  places: { name: string; count: number }[];
  /** 花费分类 */
  costs: { category: string; amount: number; percent: number; count: number }[];
  costTotal: number;
  budgetLeftText: string;
  overBudget: boolean;

  /** 未用到 / 忘了带 */
  unused: { _id: string; name: string; category: string }[];
  missing: { _id: string; name: string; category: string }[];

  /** 日记 */
  notes: NoteView[];
  noteDay: number;
  noteText: string;
  showNoteEditor: boolean;
  dayTabs: { day: number; label: string }[];

  /** 计划 vs 实际 */
  plannedHoursText: string;
  itemProgressText: string;
}

Page<TripSummaryData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    id: '',
    s: null,
    places: [],
    costs: [],
    costTotal: 0,
    budgetLeftText: '',
    overBudget: false,
    unused: [],
    missing: [],
    notes: [],
    noteDay: 1,
    noteText: '',
    showNoteEditor: false,
    dayTabs: [],
    plannedHoursText: '',
    itemProgressText: ''
  },

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
    const s = store.tripSummary(this.data.id);
    if (!s) return;
    const notes: NoteView[] = s.notes.map((n: ITripNote) => ({
      _id: n._id,
      day: n.day,
      dayText: `Day ${n.day}`,
      text: n.text,
      photos: n.photos || [],
      photoCount: (n.photos || []).length,
      editing: false
    }));
    const hours = Math.floor((s.plannedMinutes || 0) / 60);
    const mins = (s.plannedMinutes || 0) % 60;

    this.setData({
      s,
      places: s.visitedPlaces.slice(0, 8),
      costs: s.costByCategory.map((c) => ({
        category: c.category,
        amount: c.amount,
        percent: c.percent,
        count: c.count
      })),
      costTotal: s.costTotal,
      budgetLeftText: s.overBudget ? `超支 ¥${Math.abs(s.budgetLeft)}` : `结余 ¥${s.budgetLeft}`,
      overBudget: s.overBudget,
      unused: s.unusedItems.slice(0, 20).map((p) => ({ _id: p._id, name: p.name, category: p.category })),
      missing: s.missingItems.slice(0, 20).map((p) => ({ _id: p._id, name: p.name, category: p.category })),
      notes,
      dayTabs: Array.from({ length: s.totalDays }, (_, i) => ({
        day: i + 1,
        label: `Day ${i + 1}`
      })),
      plannedHoursText: hours > 0 ? `${hours} 小时 ${mins} 分` : `${mins} 分`,
      itemProgressText: `${s.itemDone}/${s.itemTotal}`
    });
  },

  /* ============================ 日记 ============================ */

  onOpenNoteEditor() {
    const days = this.data.dayTabs;
    const day = days.length ? days[0].day : 1;
    const exist = store.listNotes(this.data.id).find((n) => n.day === day);
    this.setData({ showNoteEditor: true, noteDay: day, noteText: exist ? exist.text : '' });
  },

  onCloseNoteEditor() {
    this.setData({ showNoteEditor: false });
  },

  onNoop() {
    /* 阻止穿透 */
  },

  onNoteDay(e: WechatMiniprogram.PickerChangeEvent) {
    const idx = Number(e.detail.value) || 0;
    const day = this.data.dayTabs[idx] ? this.data.dayTabs[idx].day : 1;
    const exist = store.listNotes(this.data.id).find((n) => n.day === day);
    this.setData({ noteDay: day, noteText: exist ? exist.text : '' });
  },

  onNoteText(e: WechatMiniprogram.InputEvent) {
    this.setData({ noteText: e.detail.value });
  },

  onAddPhoto() {
    wx.chooseMedia({
      count: 6,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).map((f) => f.tempFilePath);
        const exist = store.listNotes(this.data.id).find((n) => n.day === this.data.noteDay);
        const photos = (exist && exist.photos ? exist.photos : []).concat(files);
        void store.saveNote(this.data.id, this.data.noteDay, this.data.noteText, photos).then(() => {
          toast(`已添加 ${files.length} 张照片`, 'success');
        });
      },
      fail: () => {
        /* 取消 */
      }
    });
  },

  onSaveNote() {
    void store.saveNote(this.data.id, this.data.noteDay, this.data.noteText).then(() => {
      this.setData({ showNoteEditor: false });
      toast('已保存', 'success');
    });
  },

  onDeleteNote(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除日记',
      content: '确认删除这天的旅行日记？',
      confirmColor: '#C0522F',
      success: (m) => {
        if (!m.confirm) return;
        void store.removeNote(id).then(() => toast('已删除', 'success'));
      }
    });
  },

  onPreviewPhoto(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string;
    const all = [] as string[];
    this.data.notes.forEach((n) => n.photos.forEach((p) => all.push(p)));
    wx.previewImage({ current: url, urls: all.length ? all : [url] });
  },

  /* ============================ 归档 / 复制 ============================ */

  onArchive() {
    const s = this.data.s;
    if (!s) return;
    const archived = !s.trip.archived;
    wx.showModal({
      title: archived ? '归档行程' : '取消归档',
      content: archived ? '归档后行程会移到「历史行程」，随时可以再取出来。' : '取消归档后行程将回到进行中列表。',
      success: (m) => {
        if (!m.confirm) return;
        void store.archiveTrip(this.data.id, archived).then(() => {
          toast(archived ? '已归档' : '已取消归档', 'success');
        });
      }
    });
  },

  /** 一键复制为下次旅行模板 */
  onCloneAsTemplate() {
    wx.showModal({
      title: '复制为旅行模板',
      content: '将复制这份行程的条目与行李清单（行李重置为未打包、花费清零），日期顺延一个月，方便下次复用。',
      success: (m) => {
        if (!m.confirm) return;
        const start = store.toYMD(store.todayStart() + 30 * 86400000);
        void store.cloneTrip(this.data.id, start).then((t) => {
          if (!t) {
            toast('复制失败', 'none');
            return;
          }
          toast('已复制为新行程', 'success');
          setTimeout(() => {
            go(`/subpackages/travel/pages/trip-detail/trip-detail?id=${t._id}`, { title: t.title });
          }, 500);
        });
      }
    });
  },

  onOpenPacking() {
    go(`/subpackages/travel/pages/packing/packing?id=${this.data.id}`, { title: '行李清单' });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const s = this.data.s;
    return {
      title: s ? `${s.trip.title} · 旅行复盘：${s.itemDone}/${s.itemTotal} 完成，花费 ¥${s.costTotal}` : '旅行复盘',
      path: `/subpackages/travel/pages/trip-summary/trip-summary?id=${this.data.id}`
    };
  }
});
