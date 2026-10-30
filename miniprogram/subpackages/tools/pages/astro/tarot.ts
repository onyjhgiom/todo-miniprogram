// pages/astro/tarot.ts
// 塔罗占卜：图鉴 + 占卜（单张/三张/爱情/决策四种牌阵）+ CSS3D 翻牌 + 历史
import {
  TAROT_CARDS, tarotAll, getTarotById, TarotCard, TarotSuit
} from '../../utils/astro-data';
import { NS, listAll, addRecord, deleteRecord, readJson, writeJson } from '../../utils/astro-store';

interface DrawnCard {
  cid: string;          // 原 tarot id
  name: string;
  image: string;
  position: string;     // 占位描述（过去/现在/未来 或 指引/对象/障碍 等）
  orientation: '正位' | '逆位';
  flipped: boolean;
  interpretation: string;
}

interface HistoryItem {
  id: string;
  title: string;
  layoutLabel: string;
  timeLabel: string;
}

interface PageData {
  mode: 'draw' | 'gallery';
  question: string;
  layout: 'single' | 'three' | 'love' | 'career';
  layouts: { key: PageData['layout']; name: string; desc: string; positions: string[] }[];
  drawn: DrawnCard[];
  allFlipped: boolean;
  history: HistoryItem[];
  galleryKw: string;
  galleryGroups: { suit: TarotSuit | 'majors'; suitLabel: string; items: { id: string; name: string; image: string }[] }[];
  placeholder: string;
}

const SUIT_LABEL: Record<TarotSuit | 'majors', string> = {
  majors: '大阿卡纳',
  wands: '权杖',
  cups: '圣杯',
  swords: '宝剑',
  pentacles: '星币'
};

const LAYOUTS: PageData['layouts'] = [
  { key: 'single', name: '单张指引', desc: '一张牌给出核心讯息', positions: ['指引'] },
  { key: 'three', name: '经典三张', desc: '过去 / 现在 / 未来', positions: ['过去', '现在', '未来'] },
  { key: 'love', name: '爱情牌阵', desc: '你 / 对方 / 关系 / 障碍', positions: ['你', '对方', '关系', '障碍'] },
  { key: 'career', name: '事业决策', desc: '现状 / 优势 / 挑战 / 建议', positions: ['现状', '优势', '挑战', '建议'] }
];

Page<PageData>({
  data: {
    mode: 'draw',
    question: '',
    layout: 'single',
    layouts: LAYOUTS,
    drawn: [],
    allFlipped: false,
    history: [],
    galleryKw: '',
    galleryGroups: [],
    placeholder: '/subpackages/tools/assets/astro/card_minor.png'
  },

  onShow() {
    this.applyHistory();
    this.applyGallery('');
  },

  onSwitchMode(e: WechatMiniprogram.TouchEvent) {
    const m = e.currentTarget.dataset.mode as PageData['mode'];
    if (m === this.data.mode) return;
    this.setData({ mode: m });
    if (m === 'gallery') this.applyGallery(this.data.galleryKw);
  },

  onInputQ(e: WechatMiniprogram.InputEvent) {
    this.setData({ question: e.detail.value });
  },

  onPickLayout(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as PageData['layout'];
    if (key === this.data.layout) return;
    this.setData({ layout: key, drawn: [], allFlipped: false });
  },

  onDraw() {
    const layout = LAYOUTS.find((l) => l.key === this.data.layout);
    if (!layout) return;
    const n = layout.positions.length;
    const pool = TAROT_CARDS.slice();
    const drawn: DrawnCard[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const c = pool[idx];
      pool.splice(idx, 1);
      const reversed = Math.random() < 0.45;
      drawn.push({
        cid: c.id,
        name: c.name,
        image: c.suit === 'majors' ? '/subpackages/tools/assets/astro/card_major.png' : '/subpackages/tools/assets/astro/card_minor.png',
        position: layout.positions[i],
        orientation: reversed ? '逆位' : '正位',
        flipped: false,
        interpretation: reversed ? c.reversed : c.upright
      });
    }
    this.setData({ drawn, allFlipped: false });
  },

  onFlipCard(e: WechatMiniprogram.TouchEvent) {
    const idx = e.currentTarget.dataset.index as number;
    const arr = this.data.drawn.slice();
    if (!arr[idx] || arr[idx].flipped) return;
    arr[idx] = { ...arr[idx], flipped: true };
    const all = arr.every((c) => c.flipped);
    this.setData({ drawn: arr, allFlipped: all });
  },

  onRedraw() {
    this.setData({ drawn: [], allFlipped: false });
  },

  onSaveDraw() {
    if (this.data.drawn.length === 0) return;
    const layout = LAYOUTS.find((l) => l.key === this.data.layout);
    const summary = (this.data.question || '未留问句').slice(0, 20) + ' · ' + (layout ? layout.name : '');
    const cardText = this.data.drawn.map((d) => d.name + '(' + d.orientation + ')').join(' / ');
    addRecord(NS.tarotHis, {
      id: '',
      layout: this.data.layout,
      layoutLabel: layout ? layout.name : '',
      question: this.data.question,
      cardIds: this.data.drawn.map((d) => d.cid),
      cardText,
      summary
    } as unknown as { id: string; layout: string; layoutLabel: string; question: string; cardIds: string[]; cardText: string; summary: string });
    this.applyHistory();
    wx.showToast({ title: '已保存占卜', icon: 'success' });
  },

  applyHistory() {
    const list = listAll<{ id: string; summary: string; layoutLabel: string; createdAt: number }>(NS.tarotHis).slice(0, 12);
    this.setData({
      history: list.map((h) => ({ id: h.id, title: h.summary, layoutLabel: h.layoutLabel, timeLabel: relTime(h.createdAt) }))
    });
  },

  onDeleteHis(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    deleteRecord(NS.tarotHis, id);
    this.applyHistory();
  },

  /* 图鉴 */
  onGalleryInput(e: WechatMiniprogram.InputEvent) {
    this.applyGallery(e.detail.value);
  },

  applyGallery(kw: string) {
    const q = (kw || '').trim().toLowerCase();
    const filtered = TAROT_CARDS.filter((c) =>
      !q || c.name.toLowerCase().includes(q) || (c.keywords || []).some((k) => k.includes(q))
    );
    const groups: Record<string, TarotCard[]> = {};
    filtered.forEach((c) => {
      const k = c.suit || 'majors';
      if (!groups[k]) groups[k] = [];
      groups[k].push(c);
    });
    const order: (TarotSuit | 'majors')[] = ['majors', 'wands', 'cups', 'swords', 'pentacles'];
    const out = order
      .filter((k) => groups[k])
      .map((k) => ({
        suit: k,
        suitLabel: SUIT_LABEL[k],
        items: groups[k].map((c) => ({
          id: c.id,
          name: c.name,
          image: c.suit === 'majors' ? '/subpackages/tools/assets/astro/card_major.png' : c.suit === 'pentacles' ? '/subpackages/tools/assets/astro/card_minor.png' : c.suit === 'wands' ? '/subpackages/tools/assets/astro/card_minor.png' : '/subpackages/tools/assets/astro/card_minor.png'
        }))
      }));
    this.setData({ galleryGroups: out, galleryKw: kw });
  },

  onCardInfo(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const c = getTarotById(id);
    if (!c) return;
    wx.showModal({
      title: c.name,
      content: '关键词：' + (c.keywords || []).join(' / ') + '\n\n正位：' + c.upright + '\n\n逆位：' + c.reversed,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onImgErr(e: WechatMiniprogram.CustomEvent) {
    const t = e.currentTarget as WechatMiniprogram.Image;
    if (t.src !== this.data.placeholder) t.setData({ src: this.data.placeholder });
  }
});

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return Math.floor(d / 60_000) + ' 分钟前';
  if (d < 86400_000) return Math.floor(d / 3600_000) + ' 小时前';
  if (d < 30 * 86400_000) return Math.floor(d / 86400_000) + ' 天前';
  const date = new Date(ts);
  return date.getFullYear() + '-' + ((date.getMonth() + 1 < 10 ? '0' : '') + (date.getMonth() + 1)) + '-' + ((date.getDate() < 10 ? '0' : '') + date.getDate());
}