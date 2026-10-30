// pages/love/wardrobe/wardrobe.ts
// 我的衣橱：拍照上传真实单品 → 自动搭配一周 OOTD
//
// 图片双通道持久化（云存储 fileID + 本地 base64 兜底）见 love-wardrobe.ts 顶部说明。
import { applySkin, watchSkin, guardTap, confirmDanger, toast, withLoading } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import {
  loadCloset, addClosetItem, updateClosetItem, removeClosetItem, closetStats,
  getWardrobe, onTopic
} from '../../utils/love-store';
import {
  CATEGORIES, COLOR_FAMILY, catLabel, catEmoji, displaySrc,
  pickClothImage, generateWeek, WEEK_LABELS, DEFAULT_OCCASIONS
} from '../../utils/love-wardrobe';
import type { WardrobeItem, WardrobeCategory, OotdPlan, OotdDay } from '../../utils/love-types';
import { outfitStyles } from '../../utils/love-outfit';

interface DecoItem extends WardrobeItem {
  src: string;
  catText: string;
  catIco: string;
  colorHex: string;
}

interface WardrobeData {
  skin: SkinView;
  items: DecoItem[];
  stats: { cat: string; text: string; emoji: string; count: number }[];
  total: number;

  showForm: boolean;
  editingId: string;
  catList: { key: string; label: string; emoji: string }[];
  colorList: { key: string; label: string; hex: string }[];
  styleList: { key: string; emoji: string }[];
  seasonList: string[];
  form: {
    cat: WardrobeCategory;
    name: string;
    color: string;
    styles: string[];
    seasons: string[];
    warmth: number;
    formality: number;
    fav: boolean;
    image: string;
    local: string;
    note: string;
  };

  temp: string;
  occasions: string[];
  plan: OotdPlan | null;
  weekLabels: string[];
  generating: boolean;
}

function emptyForm() {
  return {
    cat: 'top' as WardrobeCategory,
    name: '',
    color: '白',
    styles: [] as string[],
    seasons: ['四季'],
    warmth: 3,
    formality: 3,
    fav: false,
    image: '',
    local: '',
    note: ''
  };
}

Page<WardrobeData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    items: [],
    stats: [],
    total: 0,
    showForm: false,
    editingId: '',
    catList: CATEGORIES,
    colorList: COLOR_FAMILY,
    styleList: outfitStyles().map((s) => ({ key: s.key, emoji: s.emoji })),
    seasonList: ['春', '夏', '秋', '冬', '四季'],
    form: emptyForm(),
    temp: '',
    occasions: DEFAULT_OCCASIONS,
    plan: null,
    weekLabels: WEEK_LABELS,
    generating: false
  },

  onLoad() {
    this.setData({ skin: applySkin() });
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.unsubData = onTopic('wardrobe', () => this.refresh());
    this.refresh();
  },

  onUnload() {
    if (this.unsub) this.unsub();
    if (this.unsubData) this.unsubData();
  },

  onShow() {
    this.setData({ skin: applySkin() });
  },

  unsub: null as (() => void) | null,
  unsubData: null as (() => void) | null,

  refresh() {
    const list = loadCloset();
    const items: DecoItem[] = list.map((x) => ({
      ...x,
      src: displaySrc(x),
      catText: catLabel(x.cat),
      catIco: catEmoji(x.cat),
      colorHex: (COLOR_FAMILY.find((c) => c.key === x.color) || { hex: '#DDD' }).hex
    }));
    const stats = closetStats().filter((s) => s.count > 0).map((s) => ({
      cat: s.cat, text: catLabel(s.cat), emoji: catEmoji(s.cat), count: s.count
    }));
    this.setData({ items, stats, total: list.length });
  },

  /* ============================ 添加 / 编辑 ============================ */

  onAdd() {
    if (!guardTap('add', 500)) return;
    this.setData({ showForm: true, editingId: '', form: emptyForm() });
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const it = loadCloset().find((x) => x.id === id);
    if (!it) return;
    this.setData({
      showForm: true,
      editingId: id,
      form: {
        cat: it.cat, name: it.name, color: it.color, styles: it.styles || [],
        seasons: it.seasons || ['四季'], warmth: it.warmth || 3, formality: it.formality || 3,
        fav: !!it.fav, image: it.image || '', local: it.local || '', note: it.note || ''
      }
    });
  },

  onCloseForm() {
    this.setData({ showForm: false, editingId: '', form: emptyForm() });
  },

  /** 选图：压缩 + 云存储优先 + base64 兜底 */
  onPickImage() {
    if (!guardTap('pick', 1000)) return;
    withLoading(() => pickClothImage(), '处理图片', 300)
      .then((r) => {
        const f = this.data.form;
        this.setData({
          form: { ...f, image: r.image, local: r.local }
        });
        toast(r.cloud ? '已上传云端' : '已保存到本地');
      })
      .catch(() => {
        /* 用户取消选择，不提示 */
      });
  },

  onFormCat(e: WechatMiniprogram.TouchEvent) {
    const f = this.data.form;
    this.setData({ form: { ...f, cat: e.currentTarget.dataset.v as WardrobeCategory } });
  },

  onFormColor(e: WechatMiniprogram.TouchEvent) {
    const f = this.data.form;
    this.setData({ form: { ...f, color: e.currentTarget.dataset.v as string } });
  },

  onFormStyle(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const f = this.data.form;
    const next = f.styles.indexOf(v) >= 0 ? f.styles.filter((x) => x !== v) : f.styles.concat([v]);
    this.setData({ form: { ...f, styles: next.slice(0, 2) } });
  },

  onFormSeason(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const f = this.data.form;
    let next: string[];
    if (v === '四季') {
      next = f.seasons.indexOf('四季') >= 0 ? [] : ['四季'];
    } else {
      const base = f.seasons.filter((x) => x !== '四季');
      next = base.indexOf(v) >= 0 ? base.filter((x) => x !== v) : base.concat([v]);
    }
    this.setData({ form: { ...f, seasons: next } });
  },

  onFormWarmth(e: WechatMiniprogram.TouchEvent) {
    const f = this.data.form;
    this.setData({ form: { ...f, warmth: Number(e.currentTarget.dataset.v) || 3 } });
  },

  onFormFormality(e: WechatMiniprogram.TouchEvent) {
    const f = this.data.form;
    this.setData({ form: { ...f, formality: Number(e.currentTarget.dataset.v) || 3 } });
  },

  onFormFav() {
    const f = this.data.form;
    this.setData({ form: { ...f, fav: !f.fav } });
  },

  onFormName(e: WechatMiniprogram.InputEvent) {
    const f = this.data.form;
    this.setData({ form: { ...f, name: e.detail.value } });
  },

  onFormNote(e: WechatMiniprogram.InputEvent) {
    const f = this.data.form;
    this.setData({ form: { ...f, note: e.detail.value } });
  },

  onSaveItem() {
    if (!guardTap('save_item', 800)) return;
    const f = this.data.form;
    if (!f.image && !f.local) { toast('先拍一张照片'); return; }
    if (!f.name) { toast('给它起个名字，比如「米白针织开衫」'); return; }
    const payload = {
      cat: f.cat, name: f.name, color: f.color, styles: f.styles, seasons: f.seasons,
      warmth: f.warmth, formality: f.formality, fav: f.fav,
      image: f.image, local: f.local, note: f.note
    };
    if (this.data.editingId) {
      updateClosetItem(this.data.editingId, payload);
      toast('已更新');
    } else {
      addClosetItem(payload);
      toast('已收进衣橱');
    }
    this.setData({ showForm: false, editingId: '', form: emptyForm() });
    this.refresh();
  },

  onDelItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('把这件从衣橱里删掉？', () => {
      removeClosetItem(id);
      this.refresh();
    }, '删除单品');
  },

  onPreview(e: WechatMiniprogram.TouchEvent) {
    const src = e.currentTarget.dataset.src as string;
    if (!src) return;
    try {
      wx.previewImage({ urls: [src], current: src });
    } catch (err) { /* 忽略 */ }
  },

  /* ============================ 一周 OOTD ============================ */

  onTemp(e: WechatMiniprogram.InputEvent) {
    this.setData({ temp: e.detail.value });
  },

  onGenWeek() {
    if (!guardTap('gen', 1200)) return;
    const list = loadCloset();
    if (!list.length) { toast('衣橱还是空的，先添加几件单品'); return; }
    const w = getWardrobe();
    const t = Number((this.data.temp || '').replace(/[^\d-]/g, ''));
    const temp = isNaN(t) ? 22 : t;
    this.setData({ generating: true });
    setTimeout(() => {
      const plan = generateWeek({
        style: (w.styles && w.styles[0]) || '温柔韩系',
        temp,
        occasions: this.data.occasions,
        body: w.body
      });
      this.setData({ plan, generating: false });
    }, 220);
  },

  onClearPlan() {
    this.setData({ plan: null });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '我的衣橱 · 拍照上传，自动搭一周', path: '/subpackages/love/pages/wardrobe/wardrobe' };
  }
});
