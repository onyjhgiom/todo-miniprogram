// pages/astro/treehole.ts
// 树洞：私密心事 · 遗憾/委屈/迷茫 记录，仅本地（不上传服务器）
import { NS, listAll, addRecord, updateRecord, deleteRecord } from '../../utils/astro-store';

interface Hole {
  id: string;
  title?: string;
  content: string;
  mood: string;
  sealed: boolean;
  /** 由 astro-store.addRecord 自动补；入参侧可选 */
  createdAt?: number;
}

interface ViewHole extends Hole {
  moodLabel: string;
  createAt: string;
}

interface PageData {
  rawList: ViewHole[];
  filtered: ViewHole[];
  visible: ViewHole[];   // 分页渲染：当前已加载的前 N 条
  shown: number;
  pageSize: number;
  moodFilter: string;
  moodFilters: { key: string; emoji: string; label: string }[];
  moods: { key: string; emoji: string; label: string }[];
  editorOpen: boolean;
  editor: { id?: string; title: string; content: string; mood: string };
}

const MOODS = [
  { key: 'sad', emoji: '😢', label: '难过' },
  { key: 'regret', emoji: '🥀', label: '遗憾' },
  { key: 'grievance', emoji: '🌧️', label: '委屈' },
  { key: 'miss', emoji: '🕊️', label: '怀念' },
  { key: 'guilt', emoji: '🪨', label: '愧疚' },
  { key: 'lost', emoji: '🌫️', label: '迷茫' }
];

Page<PageData>({
  data: {
    rawList: [], filtered: [], visible: [], shown: 0, pageSize: 10,
    moodFilter: 'all',
    moodFilters: [{ key: 'all', emoji: '🗂', label: '全部' }, ...MOODS],
    moods: MOODS,
    editorOpen: false,
    editor: { title: '', content: '', mood: 'sad' }
  },

  onShow() { this.applyList(); },

  /** 触底加载下一页（分批渲染，防心事过多时列表卡顿） */
  onReachBottom() {
    const { filtered, shown, pageSize } = this.data;
    if (shown >= filtered.length) return;
    const next = Math.min(filtered.length, shown + pageSize);
    this.setData({ shown: next, visible: filtered.slice(0, next) });
  },

  applyList() {
    const list = listAll<Hole>(NS.treehole).slice();
    const view: ViewHole[] = list.map((h) => ({
      ...h,
      moodLabel: this.labelFor(h.mood),
      createAt: fmtDate(h.createdAt)
    }));
    view.sort((a, b) => b.createdAt - a.createdAt);
    const filtered = view.filter((h) => this.data.moodFilter === 'all' || h.mood === this.data.moodFilter);
    const shown = Math.min(this.data.pageSize, filtered.length);
    this.setData({ rawList: view, filtered, shown, visible: filtered.slice(0, shown) });
  },

  labelFor(key: string): string {
    const m = MOODS.find((x) => x.key === key);
    return m ? m.label : '';
  },

  onPickFilter(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === this.data.moodFilter) return;
    this.setData({ moodFilter: key }, () => this.applyList());
  },

  onNew() {
    this.setData({ editorOpen: true, editor: { title: '', content: '', mood: 'sad' } });
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const h = this.data.rawList.find((x) => x.id === id);
    if (!h) return;
    this.setData({
      editorOpen: true,
      editor: { id: h.id, title: h.title || '', content: h.content, mood: h.mood }
    });
  },

  onCloseEditor() { this.setData({ editorOpen: false }); },
  noop() {},

  onEditTitle(e: WechatMiniprogram.InputEvent) { this.setData({ 'editor.title': e.detail.value }); },
  onEditContent(e: WechatMiniprogram.InputEvent) { this.setData({ 'editor.content': e.detail.value }); },

  onPickEditMood(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'editor.mood': e.currentTarget.dataset.key as string });
  },

  onSave() {
    const ed = this.data.editor;
    if (!ed.content.trim()) { wx.showToast({ title: '写下一些吧', icon: 'none' }); return; }
    if (ed.id) {
      updateRecord<Hole>(NS.treehole, ed.id, { title: ed.title || undefined, content: ed.content, mood: ed.mood });
    } else {
      addRecord<Hole>(NS.treehole, {
        id: '',
        title: ed.title || undefined,
        content: ed.content,
        mood: ed.mood,
        sealed: false
      });
    }
    this.setData({ editorOpen: false });
    this.applyList();
  },

  onUnseal(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    updateRecord<Hole>(NS.treehole, id, { sealed: false });
    this.applyList();
  },

  onToggleSeal(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const h = this.data.rawList.find((x) => x.id === id);
    if (!h) return;
    updateRecord<Hole>(NS.treehole, id, { sealed: !h.sealed });
    this.applyList();
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除记录', content: '确认彻底删除这条心事吗？',
      success: (r) => { if (r.confirm) { deleteRecord(NS.treehole, id); this.applyList(); } }
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