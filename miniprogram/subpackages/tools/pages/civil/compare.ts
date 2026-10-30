// pages/civil/compare.ts
// 编制科普对比库：三个 tab
//   compile —— 9 种编制性质逐条讲透（有编/无编 + 优势 + 劣势 + 避雷）
//   compare —— 公务员 / 事业编 / 央国企 三赛道 12 个维度横向对比
//   faq     —— 应届生身份科普（择业期 / 社保红线 / 档案 / 三方协议）
// 参数：tab=compile|compare|faq  focus=<编制key>（从首页编制速查点进来时高亮定位）
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { go } from '../../../../utils/nav';
import type { ThemeKey } from '../../../../types/index';
import {
  COMPILE_TYPES, COMPARE_ROWS, FRESH_FAQ, CIVIL_JOBS, CIVIL_TRACKS,
  compileTone, compileOf, hexA
} from '../../utils/civil-data';

type Tab = 'compile' | 'compare' | 'faq';

interface CompileCard {
  key: string;
  label: string;
  short: string;
  hasBian: boolean;
  tone: string;
  levelLabel: string;
  desc: string;
  pros: string[];
  cons: string[];
  warning: string;
  color: string;
  soft: string;
  count: number;
  examples: string[];
  open: boolean;
}

interface CompareRow {
  dim: string;
  gk: string;
  sy: string;
  yg: string;
  hint: string;
}

interface CompareData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  tab: Tab;
  tabs: { key: Tab; label: string; count: number }[];

  /* compile */
  compiles: CompileCard[];
  bianCount: number;
  unbianCount: number;

  /* compare */
  rows: CompareRow[];
  cols: { key: string; name: string; short: string; color: string; soft: string; icon: string }[];

  /* faq */
  faqs: { q: string; a: string; open: boolean }[];
}

/** 每种编制在岗位库里对应的真实岗位名（取前 2 条做例子，让科普不空） */
function examplesOf(key: string): string[] {
  return CIVIL_JOBS.filter((j) => j.compile === key)
    .slice(0, 2)
    .map((j) => `${j.title}（${j.unit}）`);
}

Page<CompareData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    tab: 'compile',
    tabs: [
      { key: 'compile', label: '编制性质', count: COMPILE_TYPES.length },
      { key: 'compare', label: '赛道对比', count: COMPARE_ROWS.length },
      { key: 'faq', label: '应届身份', count: FRESH_FAQ.length }
    ],
    compiles: [],
    bianCount: 0,
    unbianCount: 0,
    rows: [],
    cols: [],
    faqs: []
  },

  onLoad(q: Record<string, string>) {
    this.applyTheme();
    const tab: Tab = q && (q.tab === 'compare' || q.tab === 'faq') ? (q.tab as Tab) : 'compile';
    const focus = (q && q.focus) || '';

    const compiles: CompileCard[] = COMPILE_TYPES.map((c) => ({
      key: c.key,
      label: c.label,
      short: c.short,
      hasBian: c.hasBian,
      tone: compileTone(c.key),
      levelLabel: c.levelLabel,
      desc: c.desc,
      pros: c.pros,
      cons: c.cons,
      warning: c.warning,
      color: c.color,
      soft: hexA(c.color, 0.14),
      count: CIVIL_JOBS.filter((j) => j.compile === c.key).length,
      examples: examplesOf(c.key),
      open: focus ? c.key === focus : c.key === 'admin'
    }));

    // 三赛道列头：用赛道定义的名字与主色，避免硬编码
    const cols = ['gk', 'sy', 'yg'].map((k) => {
      const t = CIVIL_TRACKS.filter((x) => x.key === k)[0];
      return {
        key: k,
        name: t ? t.name : k,
        short: t ? t.short : k,
        color: t ? t.color : '#6d28d9',
        soft: t ? hexA(t.color, 0.14) : 'rgba(109,40,217,0.14)',
        icon: t ? t.icon : '🏛️'
      };
    });

    this.setData({
      tab,
      compiles,
      bianCount: compiles.filter((c) => c.hasBian).length,
      unbianCount: compiles.filter((c) => !c.hasBian).length,
      rows: COMPARE_ROWS.map((r) => ({ dim: r.dim, gk: r.gk, sy: r.sy, yg: r.yg, hint: r.hint })),
      cols,
      faqs: FRESH_FAQ.map((f) => ({ q: f.q, a: f.a, open: false }))
    });

    // 项目类型定义未含该 API（与 folklore / guaxiang 页保持一致的处理方式）
    if (focus) (wx as any).setNavigationBarTitle({ title: compileOf(focus).label });
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as Tab;
    if (key === this.data.tab) return;
    this.setData({ tab: key });
  },

  onToggleCompile(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({
      compiles: this.data.compiles.map((c) => (c.key === key ? { ...c, open: !c.open } : c))
    });
  },

  onToggleFaq(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({
      faqs: this.data.faqs.map((f, idx) => (idx === i ? { ...f, open: !f.open } : f))
    });
  },

  /** 从编制卡跳到对应岗位（岗位库带 compile 参数，落地即按该编制筛好） */
  onCompileJobs(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    go(`/subpackages/tools/pages/civil/track?type=all&compile=${key}`, { loading: '正在筛选' });
  },

  onTrack(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    go(`/subpackages/tools/pages/civil/track?type=${key}`, { loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '9 种编制性质一次讲透｜有没有编制，一眼看清',
      path: '/subpackages/tools/pages/civil/compare'
    };
  }
});
