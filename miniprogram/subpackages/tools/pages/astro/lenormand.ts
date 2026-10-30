// pages/astro/lenormand.ts
// 雷诺曼：36 牌图鉴 + 单张/3 张/5 张牌阵占卜 + 历史
import { LENORMAND, getLenormandById } from '../../utils/astro-data';
import { NS, listAll, addRecord, deleteRecord } from '../../utils/astro-store';

interface DrawnCard {
  id: string; name: string; symbol: string; meaning: string; image: string;
}

/** 结构化解读段落 */
export interface ComboPart { label: string; text: string; }

interface HistoryItem {
  id: string; title: string; layoutLabel: string; timeLabel: string;
}

interface PageData {
  mode: 'draw' | 'gallery';
  layout: 'single' | 'three' | 'five';
  layouts: { key: PageData['layout']; name: string; desc: string }[];
  drawn: DrawnCard[];
  combination: string;
  combinationParts: ComboPart[];
  history: HistoryItem[];
  gallery: DrawnCard[];
  placeholder: string;
}

const LAYOUTS: PageData['layouts'] = [
  { key: 'single', name: '单张指引', desc: '一张牌 + 含义' },
  { key: 'three', name: '3 张线性', desc: '依序阅读过去/现在/未来' },
  { key: 'five', name: '5 张综合', desc: '十字展开 全局视野' }
];

function blank() {
  return { drawn: [] as DrawnCard[], combination: '', combinationParts: [] as ComboPart[] };
}

Page<PageData>({
  data: {
    mode: 'draw',
    layout: 'single',
    layouts: LAYOUTS,
    drawn: [],
    combination: '',
    combinationParts: [],
    history: [],
    gallery: LENORMAND.map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, meaning: c.meaning, image: '/subpackages/tools/assets/astro/card_lenormand.png' })),
    placeholder: '/subpackages/tools/assets/astro/card_lenormand.png'
  },

  onShow() {
    this.applyHistory();
  },

  onSwitchMode(e: WechatMiniprogram.TouchEvent) {
    const m = e.currentTarget.dataset.mode as PageData['mode'];
    this.setData({ mode: m });
  },

  onPickLayout(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as PageData['layout'];
    if (key === this.data.layout) return;
    this.setData({ layout: key, ...blank() });
  },

  onDraw() {
    const n = this.data.layout === 'single' ? 1 : this.data.layout === 'three' ? 3 : 5;
    const pool = LENORMAND.slice();
    const drawn: DrawnCard[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const c = pool[idx];
      pool.splice(idx, 1);
      drawn.push({
        id: c.id, name: c.name, symbol: c.symbol, meaning: c.meaning,
        image: '/subpackages/tools/assets/astro/card_lenormand.png'
      });
    }
    const parts = makeCombination(drawn);
    this.setData({ drawn, combination: parts.map((p) => p.text).join(' '), combinationParts: parts });
  },

  onRedraw() { this.setData(blank()); },

  onSaveDraw() {
    if (this.data.drawn.length === 0) return;
    const layout = LAYOUTS.find((l) => l.key === this.data.layout);
    const summary = (layout ? layout.name : '占卜') + ' · ' + this.data.drawn.map((d) => d.name).join(' / ');
    addRecord(NS.lenorHis, {
      id: '',
      layout: this.data.layout,
      layoutLabel: layout ? layout.name : '',
      cardIds: this.data.drawn.map((d) => d.id),
      summary
    } as unknown as { id: string; layout: string; layoutLabel: string; cardIds: string[]; summary: string });
    this.applyHistory();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  applyHistory() {
    const list = listAll<{ id: string; summary: string; layoutLabel: string; createdAt: number }>(NS.lenorHis).slice(0, 12);
    this.setData({
      history: list.map((h) => ({ id: h.id, title: h.summary, layoutLabel: h.layoutLabel, timeLabel: relTime(h.createdAt) }))
    });
  },

  onDeleteHis(e: WechatMiniprogram.TouchEvent) {
    deleteRecord(NS.lenorHis, e.currentTarget.dataset.id as string);
    this.applyHistory();
  },

  onCardDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const c = getLenormandById(id);
    if (!c) return;
    wx.showModal({
      title: c.symbol + ' ' + c.name,
      content: c.meaning + '\n\n「' + this.data.drawn.find((d) => d.id === id)?.meaning + '」',
      showCancel: false
    });
  },

  onCardDetail2(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const c = getLenormandById(id);
    if (!c) return;
    wx.showModal({ title: c.symbol + ' ' + c.name, content: c.meaning, showCancel: false });
  },

  onImgErr(e: WechatMiniprogram.CustomEvent) {
    const t = e.currentTarget as WechatMiniprogram.Image;
    if (t.src !== this.data.placeholder) t.setData({ src: this.data.placeholder });
  }
});

/** ================= 组合解读引擎 =================
 * 输出结构：每个位置的位置含义 + 相邻两牌的组合关系 + 基于整体牌面倾向的综合建议
 * tone: +1 偏吉 / 0 中性 / -1 偏挑战
 */
const TONE: Record<string, number> = {
  rider: 1, clover: 1, ship: 0, house: 1, tree: 1, clouds: -1, snake: -1, coffin: -1,
  bouquet: 1, scythe: -1, whip: -1, birds: 0, child: 1, fox: -1, bear: 0, stars: 1,
  stork: 1, dog: 1, tower: 0, garden: 1, mountain: -1, crossroad: 0, mice: -1, heart: 1,
  ring: 1, book: 0, letter: 0, man: 0, woman: 0, lily: 1, sun: 1, moon: 1,
  key: 1, fish: 1, anchor: 1, cross: -1
};

/** 三张线性：过去 → 现在 → 未来 */
const POS3 = ['过去', '现在', '未来'];
/** 五张综合：现状 / 障碍 / 根源 / 助力 / 走向 */
const POS5 = ['现状', '障碍', '根源', '助力', '走向'];

function toneOf(id: string): number { return TONE[id] ?? 0; }

function toneWord(t: number): string {
  return t > 0 ? '偏吉' : t < 0 ? '偏挑战' : '中性';
}

/** 位置解读：结合位置语义给出人话 */
function positionText(pos: string, c: DrawnCard): string {
  if (pos === '过去') return c.name + '（' + c.meaning + '）——它是事件的起点：' + c.meaning + '已经在影响你，此刻的你正站在这段经历延长线上。';
  if (pos === '现在') return c.name + '（' + c.meaning + '）——这是当下的核心：你正处于「' + c.meaning + '」的氛围里，它是整副牌最需要关注的一张。';
  if (pos === '未来') return c.name + '（' + c.meaning + '）——这是事态走向：若维持当前路径，接下来更可能呈现「' + c.meaning + '」的局面。';
  if (pos === '现状') return c.name + '（' + c.meaning + '）——你现在的处境核心是「' + c.meaning + '」，先如实承认它，再谈改变。';
  if (pos === '障碍') return c.name + '（' + c.meaning + '）——横在你面前的是「' + c.meaning + '」，它正是推进中最卡的地方。';
  if (pos === '根源') return c.name + '（' + c.meaning + '）——往深处挖，问题的种子与「' + c.meaning + '」有关，表面状况只是它的投影。';
  if (pos === '助力') return c.name + '（' + c.meaning + '）——你可以借力的资源是「' + c.meaning + '」，主动靠近它会比单打独斗轻松。';
  if (pos === '走向') return c.name + '（' + c.meaning + '）——综合前四张，事情的落点偏向「' + c.meaning + '」，这也是最值得你预备的方向。';
  return c.name + '（' + c.meaning + '）';
}

/** 相邻两牌组合关系：按吉凶倾向给出关系描述 */
function pairText(a: DrawnCard, b: DrawnCard): string {
  const ta = toneOf(a.id), tb = toneOf(b.id);
  if (ta > 0 && tb > 0) {
    return a.name + ' + ' + b.name + '：顺水推舟的组合。「' + a.meaning + '」会得到「' + b.meaning + '」的加持，趁势推进最省力。';
  }
  if (ta < 0 && tb < 0) {
    return a.name + ' + ' + b.name + '：双重压力提醒。「' + a.meaning + '」叠加「' + b.meaning + '」，先照顾好情绪，不急着在低谷做重大决定。';
  }
  if ((ta > 0 && tb < 0) || (ta < 0 && tb > 0)) {
    const good = ta > 0 ? a : b, hard = ta > 0 ? b : a;
    return a.name + ' + ' + b.name + '：一明一暗。「' + hard.meaning + '」的阻碍里藏着「' + good.meaning + '」的出口——难题不是终点，转机要主动找。';
  }
  return a.name + ' + ' + b.name + '：以平常心看待。「' + a.meaning + '」与「' + b.meaning + '」交织，方向感来自你自己的判断，而非外界的喧哗。';
}

/** 综合建议：按整副牌吉凶占比收尾 */
function adviceText(drawn: DrawnCard[]): string {
  let score = 0;
  drawn.forEach((d) => { score += toneOf(d.id); });
  const names = drawn.map((d) => d.name).join('、');
  if (score >= 2) return '整体牌面「' + names + '」以吉为主：大方向是顺的，把握当下节奏，大胆往前走。';
  if (score <= -2) return '整体牌面「' + names + '」挑战偏多：这更像提醒而非判决——放慢脚步、先处理情绪与基本面，局势会随你的调整而松动。';
  return '整体牌面「' + names + '」吉凶相抵：不急不躁、择机而动，把可控的事做扎实，结果自然清晰。';
}

/** 结构化组合解读：位置含义 + 相邻组合 + 综合建议 */
function makeCombination(drawn: DrawnCard[]): ComboPart[] {
  if (drawn.length === 0) return [];
  if (drawn.length === 1) {
    const c = drawn[0];
    const t = toneOf(c.id);
    return [
      { label: '核心牌 · ' + c.name, text: c.name + '（' + c.symbol + '）的关键词是「' + c.meaning + '」，这是一张' + toneWord(t) + '牌。' },
      { label: '给你的指引', text: t >= 0
        ? '围绕「' + c.meaning + '」行动会顺流而下：今天主动创造与它相关的机会，好状态会自己滚起来。'
        : '「' + c.meaning + '」出现时不必慌，它是在提醒你提前避开这个坑：先做减法、守住底线，再谈推进。' }
    ];
  }
  const isFive = drawn.length >= 5;
  const positions = isFive ? POS5 : POS3;
  const parts: ComboPart[] = [];
  // 1) 每个位置的牌义
  for (let i = 0; i < drawn.length; i++) {
    const pos = positions[i] || '第' + (i + 1) + '张';
    parts.push({ label: pos + ' · ' + drawn[i].name, text: positionText(pos, drawn[i]) });
  }
  // 2) 相邻牌组合关系（两张以上才讲）
  if (drawn.length >= 3) {
    parts.push({ label: '牌与牌的关系', text: pairText(drawn[0], drawn[1]) + '\n' + pairText(drawn[1], drawn[2]) + (isFive ? '\n' + pairText(drawn[3], drawn[4]) : '') });
  }
  // 3) 综合建议
  parts.push({ label: '综合建议', text: adviceText(drawn) });
  return parts;
}

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return Math.floor(d / 60_000) + ' 分钟前';
  if (d < 86400_000) return Math.floor(d / 3600_000) + ' 小时前';
  if (d < 30 * 86400_000) return Math.floor(d / 86400_000) + ' 天前';
  const date = new Date(ts);
  return date.getFullYear() + '-' + ((date.getMonth() + 1 < 10 ? '0' : '') + (date.getMonth() + 1)) + '-' + ((date.getDate() < 10 ? '0' : '') + date.getDate());
}