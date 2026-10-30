// pages/love/outfit/outfit.ts
// 穿搭与好物：按风格场合季节给成套方案；按预算档推荐包袋首饰等具体选品
import { applySkin, watchSkin, guardTap, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { getWardrobe, setWardrobe, budgetFromMonthly } from '../../utils/love-store';
import {
  outfitStyles, outfitOccasions, occasionRule, bodyOptions, buildOutfit,
  budgetBands, goodsCategories, recommendGoods
} from '../../utils/love-outfit';
import type { OutfitPlan, GoodItem, BudgetBand } from '../../utils/love-outfit';
import type { WardrobePrefs, BudgetKey } from '../../utils/love-types';

type TabKey = 'look' | 'goods';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'look', label: '👗 成套穿搭' },
  { key: 'goods', label: '🛍️ 好物推荐' }
];

const SEASONS = ['春', '夏', '秋', '冬'];

interface OutfitData {
  skin: SkinView;
  tabs: { key: TabKey; label: string }[];
  tab: TabKey;

  styleList: { key: string; emoji: string; desc: string }[];
  occList: string[];
  seasons: string[];
  style: string;
  occasion: string;
  season: string;
  temp: string;
  plan: OutfitPlan | null;
  occRule: string;

  prefs: WardrobePrefs;
  bodyList: { key: string; label: string }[];
  heightTags: { key: string; label: string }[];
  showSetup: boolean;
  monthlyText: string;

  bands: BudgetBand[];
  goodsCats: string[];
  goodsCat: string;
  goods: GoodItem[];
}

Page<OutfitData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    tabs: TABS,
    tab: 'look',
    styleList: outfitStyles(),
    occList: outfitOccasions(),
    seasons: SEASONS,
    style: '',
    occasion: '',
    season: '',
    temp: '',
    plan: null,
    occRule: '',
    prefs: {} as WardrobePrefs,
    bodyList: bodyOptions(),
    heightTags: [
      { key: 'petite', label: '155 以下' },
      { key: 'average', label: '155–168' },
      { key: 'tall', label: '168 以上' }
    ],
    showSetup: false,
    monthlyText: '',
    bands: budgetBands(),
    goodsCats: ['全部'].concat(goodsCategories()),
    goodsCat: '全部',
    goods: []
  },

  onLoad() {
    const p = getWardrobe();
    const season = SEASONS[Math.floor((new Date().getMonth() + 1) / 3) % 4];
    this.setData({
      skin: applySkin(),
      prefs: p,
      style: (p.styles && p.styles[0]) || '温柔韩系',
      occasion: '日常',
      season,
      temp: '',
      monthlyText: p.monthly ? String(p.monthly) : ''
    });
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.build();
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  onShow() {
    this.setData({ skin: applySkin() });
  },

  unsub: null as (() => void) | null,

  build() {
    const d = this.data;
    const plan = buildOutfit(d.style, d.occasion, d.season, d.temp, d.prefs);
    const goods = recommendGoods(d.goodsCat, d.prefs.budget, d.style);
    this.setData({ plan, occRule: occasionRule(d.occasion), goods });
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as TabKey;
    if (!key || key === this.data.tab) return;
    this.setData({ tab: key });
  },

  onStyle(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    setWardrobe({ styles: [v] });
    this.setData({ style: v, prefs: getWardrobe() });
    this.build();
  },

  onOccasion(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    this.setData({ occasion: v });
    this.build();
  },

  onSeason(e: WechatMiniprogram.TouchEvent) {
    this.setData({ season: e.currentTarget.dataset.v as string });
    this.build();
  },

  onTemp(e: WechatMiniprogram.InputEvent) {
    this.setData({ temp: e.detail.value });
  },

  onTempBlur() {
    this.build();
  },

  onToggleSetup() {
    if (!guardTap('setup', 400)) return;
    this.setData({ showSetup: !this.data.showSetup });
  },

  onBody(e: WechatMiniprogram.TouchEvent) {
    setWardrobe({ body: e.currentTarget.dataset.v as WardrobePrefs['body'] });
    this.setData({ prefs: getWardrobe() });
    this.build();
  },

  onHeight(e: WechatMiniprogram.TouchEvent) {
    setWardrobe({ height: e.currentTarget.dataset.v as WardrobePrefs['height'] });
    this.setData({ prefs: getWardrobe() });
    this.build();
  },

  onBudget(e: WechatMiniprogram.TouchEvent) {
    setWardrobe({ budget: e.currentTarget.dataset.v as BudgetKey });
    this.setData({ prefs: getWardrobe() });
    this.build();
  },

  onMonthly(e: WechatMiniprogram.InputEvent) {
    this.setData({ monthlyText: e.detail.value });
  },

  /** 填月收入 → 自动推导预算档（用户仍可手动覆盖） */
  onMonthlyBlur() {
    const n = Number((this.data.monthlyText || '').replace(/[^\d]/g, ''));
    if (!n) return;
    const key = budgetFromMonthly(n);
    setWardrobe({ monthly: n, budget: key });
    this.setData({ prefs: getWardrobe() });
    toast(`已按月支配 ${n} 元定位到「${(this.data.bands.find((b) => b.key === key) || { label: '' }).label}」`);
    this.build();
  },

  /* ============================ 好物 ============================ */

  onGoodsCat(e: WechatMiniprogram.TouchEvent) {
    this.setData({ goodsCat: e.currentTarget.dataset.v as string });
    this.build();
  },

  onCopyLook() {
    if (!guardTap('copy', 1200)) return;
    const p = this.data.plan;
    if (!p) return;
    const lines: string[] = [`【${p.style} · ${p.occasion} · ${p.season}】`, p.summary, '', '单品：'];
    p.pieces.forEach((x) => lines.push(`  ${x.emoji} ${x.slot}：${x.name}（${x.price}）\n     ${x.detail}`));
    lines.push('', `配色：${p.color}`, `整套预算：${p.budget}`);
    try {
      wx.setClipboardData({ data: lines.join('\n') });
    } catch (e) {
      toast('复制失败');
    }
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '穿搭与好物 · 成套方案 + 按预算选品', path: '/subpackages/love/pages/outfit/outfit' };
  }
});
