// pages/civil/decision.ts
// 仕途衡鉴 · 战略决策台 —— 智能分层组合 + 均衡资源调配
// 形态：独立决策页（保留原 hub 与赛道/岗位/对比/时间轴/规划页不变）。
// 引擎：纯本地规则（assessLocal / recommendPortfolio / buildResourcePlan），
//       未配 AI 也能立刻出结果；与 plan.ts 的 AI 降级范式一致。
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { go } from '../../../../utils/nav';
import { toast } from '../../../../utils/cloud';
import type { ThemeKey } from '../../../../types/index';
import { CIVIL_META } from '../../utils/civil-data';
import {
  assessLocal, recommendPortfolio, buildResourcePlan,
  type AssessInput, type AssessItem, type PortfolioResult, type ResourcePlan
} from '../../utils/civil-strategy';

interface EduOpt { key: string; label: string; }
interface PreferOpt { key: string; label: string; icon: string; }

interface DecisionData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  meta: typeof CIVIL_META;

  /* ---- 输入表单 ---- */
  major: string;
  educations: EduOpt[];
  eduIndex: number;
  party: boolean;
  fresh: boolean;
  prefers: PreferOpt[];
  preferKey: string;
  hours: number;

  /* ---- 结果 ---- */
  assessed: boolean;
  assess: (AssessItem & { bar: number })[];
  portfolio: PortfolioResult | null;
  resource: ResourcePlan | null;
}

const PREFERS: PreferOpt[] = [
  { key: 'stability', label: '求稳定', icon: '🛡️' },
  { key: 'salary', label: '看收入', icon: '💰' },
  { key: 'balance', label: '求平衡', icon: '⚖️' },
  { key: 'unknown', label: '没想清', icon: '❓' }
];

Page<DecisionData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    meta: CIVIL_META,

    major: '',
    educations: [
      { key: '专科及以上', label: '专科' },
      { key: '本科及以上', label: '本科' },
      { key: '硕士及以上', label: '硕士' }
    ],
    eduIndex: 1,
    party: false,
    fresh: true,
    prefers: PREFERS,
    preferKey: 'balance',
    hours: 20,

    assessed: false,
    assess: [],
    portfolio: null,
    resource: null
  },

  onLoad() {
    this.applyTheme();
  },
  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  /* ---------- 表单交互 ---------- */
  onInputMajor(e: WechatMiniprogram.InputEvent) {
    this.setData({ major: (e.detail.value || '').trim() });
  },
  onPickEdu(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index) || 0;
    this.setData({ eduIndex: i });
  },
  onToggleParty() {
    this.setData({ party: !this.data.party });
  },
  onToggleFresh() {
    this.setData({ fresh: !this.data.fresh });
  },
  onPickPrefer(e: WechatMiniprogram.TouchEvent) {
    this.setData({ preferKey: e.currentTarget.dataset.key as string });
  },
  onHours(e: WechatMiniprogram.CustomEvent) {
    this.setData({ hours: e.detail.value });
  },

  /* ---------- 核心：生成决策 ---------- */
  onGenerate() {
    const input: AssessInput = {
      major: this.data.major || '其他',
      education: this.data.educations[this.data.eduIndex].key,
      party: this.data.party,
      fresh: this.data.fresh,
      prefer: this.data.preferKey as AssessInput['prefer']
    };

    const a = assessLocal(input);
    const assess = a.items.map((it) => ({ ...it, bar: Math.max(8, Math.min(100, it.score)) }));

    const portfolio = recommendPortfolio(input);
    const resource = buildResourcePlan(input, this.data.hours);

    this.setData({ assessed: true, assess, portfolio, resource });
    toast('已生成分层组合与资源调配', 'none');
  },

  onReset() {
    this.setData({ assessed: false, assess: [], portfolio: null, resource: null, major: '', eduIndex: 1, party: false, fresh: true, preferKey: 'balance', hours: 20 });
  },

  /* ---------- 跳转 / 复制 ---------- */
  onJob(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    go(`/subpackages/tools/pages/civil/job?id=${id}`, { loading: true });
  },
  onCopyApply(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string;
    if (!url) {
      toast('该岗位暂无报名入口', 'none');
      return;
    }
    wx.setClipboardData({ data: url, success: () => toast('已复制报名入口，粘贴到浏览器打开') });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '仕途衡鉴 · 战略决策台｜智能分层组合 + 均衡资源调配',
      path: '/subpackages/tools/pages/civil/decision'
    };
  }
});
