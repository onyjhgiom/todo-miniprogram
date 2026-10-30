// pages/love/makeup/makeup.ts
// 妆造顾问：妆感 × 场合 → 具体化妆步骤；甲型 × 风格 × 场合 → 美甲款式
import { applySkin, watchSkin, guardTap, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { getBeauty, setBeauty } from '../../utils/love-store';
import {
  makeupStyles, makeupOccasions, buildMakeup,
  nailShapes, nailStyleTags, recommendNails, NAIL_CARE
} from '../../utils/love-beauty';
import type { MakeupPlan, NailDesign } from '../../utils/love-beauty';
import type { BeautyPrefs } from '../../utils/love-types';

type TabKey = 'face' | 'nail';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'face', label: '💄 妆容' },
  { key: 'nail', label: '💅 美甲' }
];

const NAIL_OCCASIONS = ['日常', '通勤', '约会', '婚礼', '聚会', '拍照'];

interface MakeupData {
  skin: SkinView;
  tabs: { key: TabKey; label: string }[];
  tab: TabKey;

  styleList: { key: string; emoji: string; desc: string }[];
  occList: { key: string; emoji: string; focus: string }[];
  style: string;
  occasion: string;
  plan: MakeupPlan | null;

  prefs: BeautyPrefs;
  skinTags: { key: string; label: string }[];
  toneTags: { key: string; label: string }[];

  nailShapes: string[];
  nailTags: string[];
  nailOccasions: string[];
  nailShape: string;
  nailStyles: string[];
  nailOcc: string;
  nails: NailDesign[];
  nailCare: string[];
}

Page<MakeupData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    tabs: TABS,
    tab: 'face',
    styleList: makeupStyles(),
    occList: makeupOccasions(),
    style: '',
    occasion: '',
    plan: null,
    prefs: {} as BeautyPrefs,
    skinTags: [
      { key: 'dry', label: '干皮' }, { key: 'oil', label: '油皮' },
      { key: 'comb', label: '混合皮' }, { key: 'sensitive', label: '敏感肌' }
    ],
    toneTags: [
      { key: 'fair', label: '偏白' }, { key: 'medium', label: '自然' }, { key: 'tan', label: '偏深' }
    ],
    nailShapes: nailShapes(),
    nailTags: nailStyleTags(),
    nailOccasions: NAIL_OCCASIONS,
    nailShape: '',
    nailStyles: [],
    nailOcc: '',
    nails: [],
    nailCare: NAIL_CARE
  },

  onLoad() {
    const p = getBeauty();
    this.setData({
      skin: applySkin(),
      prefs: p,
      style: (p.styles && p.styles[0]) || '温柔奶杏',
      occasion: (p.occasions && p.occasions[0]) || '日常',
      nailShape: p.nailShape || '方圆',
      nailStyles: p.nailStyles || [],
      nailOcc: '日常'
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
    const plan = buildMakeup(d.style, d.occasion, d.prefs);
    const nails = recommendNails(d.nailShape, d.nailStyles, d.nailOcc, d.prefs.tone);
    this.setData({ plan, nails });
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as TabKey;
    if (!key || key === this.data.tab) return;
    this.setData({ tab: key });
  },

  onStyle(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    this.setData({ style: v });
    setBeauty({ styles: [v] });
    this.build();
  },

  onOccasion(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    this.setData({ occasion: v });
    setBeauty({ occasions: [v] });
    this.build();
  },

  onSkinType(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    setBeauty({ skin: v as BeautyPrefs['skin'] });
    this.setData({ prefs: getBeauty() });
    this.build();
  },

  onTone(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    setBeauty({ tone: v as BeautyPrefs['tone'] });
    this.setData({ prefs: getBeauty() });
    this.build();
  },

  /* ============================ 美甲 ============================ */

  onNailShape(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    setBeauty({ nailShape: v });
    this.setData({ nailShape: v });
    this.build();
  },

  onNailStyle(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const cur = this.data.nailStyles || [];
    const next = cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]);
    setBeauty({ nailStyles: next.slice(0, 3) });
    this.setData({ nailStyles: next.slice(0, 3) });
    this.build();
  },

  onNailOcc(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    this.setData({ nailOcc: v });
    this.build();
  },

  /** 把整套步骤抄成一段可复制的文字（方便发给朋友或存备忘录） */
  onCopyPlan() {
    if (!guardTap('copy', 1200)) return;
    const p = this.data.plan;
    if (!p) return;
    const lines: string[] = [`【${p.styleName} · ${p.occasionName}】约 ${p.minutes} 分钟`, p.summary, ''];
    p.steps.forEach((s) => {
      lines.push(`${s.emoji} ${s.part}`);
      s.steps.forEach((x) => lines.push('  · ' + x));
      lines.push('');
    });
    lines.push('补妆要点：');
    p.touchUp.forEach((x) => lines.push('  · ' + x));
    try {
      wx.setClipboardData({ data: lines.join('\n') });
    } catch (e) {
      toast('复制失败');
    }
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '妆造顾问 · 按妆感和场合给具体步骤', path: '/subpackages/love/pages/makeup/makeup' };
  }
});
