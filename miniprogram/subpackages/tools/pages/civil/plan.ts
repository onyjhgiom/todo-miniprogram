// pages/civil/plan.ts
// AI 上岸规划：四个 tab
//   assess    —— 赛道适配测评（专业/学历/党员/应届/诉求 → 四赛道评分 + 报考组合 + 优先级 + 避坑）
//   plan      —— 备考计划生成（赛道/目标/每周小时 → 4 周计划 + 阶段目标）
//   interview —— 面试模拟点评（题目 + 作答 → 分数 + 亮点 + 改进项 + 示范作答）
//   polish    —— 简历国企/公考风优化（原文 → 改写后 + 改动说明）
//
// 双路设计：优先调 civilAI 云函数；未配 Key / 调用失败 / 超时 → 自动降级本地规则引擎
// （assessLocal / buildPlanLocal 已在 civil-strategy 内实现，离线也能出结果）。
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { go } from '../../../../utils/nav';
import { toast, callFn } from '../../../../utils/cloud';
import type { ThemeKey } from '../../../../types/index';
import { CIVIL_TRACKS } from '../../utils/civil-data';
import { assessLocal, buildPlanLocal, interviewLocalCheck } from '../../utils/civil-strategy';
import type { AssessResult, PlanResult, InterviewComment } from '../../utils/civil-strategy';

type Tab = 'assess' | 'plan' | 'interview' | 'polish';
type AiState = 'idle' | 'loading' | 'ai' | 'local';

interface AssessItem {
  key: string;
  name: string;
  icon: string;
  score: number;
  level: string;
  reason: string;
  color: string;
  barColor: string;
}

interface WeekRow {
  week: string;
  focus: string;
  items: string[];
}

interface PolishResult {
  polished: string;
  changes: string[];
}

interface PlanData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  tab: Tab;
  tabs: { key: Tab; label: string; icon: string }[];

  /* AI 状态 */
  aiState: AiState;
  aiNote: string;

  /* ---- assess ---- */
  majors: string[];
  educations: string[];
  eduIdx: number;
  major: string;
  party: boolean;
  fresh: boolean;
  prefers: { key: string; label: string }[];
  prefer: string;
  aResult: AssessResult | null;
  aItems: AssessItem[];

  /* ---- plan ---- */
  trackOpts: { key: string; name: string; icon: string }[];
  trackIdx: number;
  target: string;
  hours: number;
  /** 日均小时（保留 1 位小数），避免在 wxml 里做除法产生长小数 */
  perDay: number;
  pResult: PlanResult | null;
  pWeeks: WeekRow[];

  /* ---- interview ---- */
  kinds: { key: string; label: string; desc: string }[];
  kind: string;
  question: string;
  answer: string;
  iResult: InterviewComment | null;

  /* ---- polish ---- */
  pText: string;
  pTarget: string;
  polResult: PolishResult | null;
}

/** 常见专业快捷项：让学生少打字，也顺带教育模型识别口径 */
const MAJOR_PRESETS = ['会计学', '金融学', '法学', '计算机科学与技术', '汉语言文学', '师范/小学教育', '临床医学', '电气工程', '土木工程', '农学', '数学与应用数学', '工商管理'];

const PREFS = [
  { key: 'stability', label: '求稳定' },
  { key: 'salary', label: '看重收入' },
  { key: 'balance', label: '工作平衡' },
  { key: 'unknown', label: '还没想清楚' }
];

function barColorOf(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 62) return '#0ea5e9';
  if (score >= 45) return '#f59e0b';
  return '#94a3b8';
}

Page<PlanData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    tab: 'assess',
    tabs: [
      { key: 'assess', label: '赛道测评', icon: '🧭' },
      { key: 'plan', label: '备考计划', icon: '📅' },
      { key: 'interview', label: '面试模拟', icon: '🎤' }
    ],
    aiState: 'idle',
    aiNote: '首次使用会调用 AI；若云端不可用会自动降级为本地规则，功能不中断。',

    majors: MAJOR_PRESETS,
    educations: ['专科', '本科', '硕士', '博士'],
    eduIdx: 1,
    major: '',
    party: false,
    fresh: true,
    prefers: PREFS,
    prefer: 'unknown',
    aResult: null,
    aItems: [],

    trackOpts: [],
    trackIdx: 0,
    target: '',
    hours: 20,
    perDay: 2.9,
    pResult: null,
    pWeeks: [],

    kinds: [
      { key: 'structured', label: '结构化面试', desc: '公考 / 事业编：综合分析、应急应变、人际关系、组织管理、岗位匹配' },
      { key: 'semi', label: '半结构化', desc: '国企：自我介绍 + 简历追问 + 专业题 + 价值观匹配' },
      { key: 'group', label: '无领导小组', desc: '读题、个人陈述、自由讨论、总结陈词，重点看是否推动团队前进' }
    ],
    kind: 'structured',
    question: '',
    answer: '',
    iResult: null,

    pText: '',
    pTarget: '',
    polResult: null
  },

  onLoad() {
    this.applyTheme();
    this.setData({
      trackOpts: CIVIL_TRACKS.filter((t) => t.key !== 'strategy').map((t) => ({
        key: t.key,
        name: t.name,
        icon: t.icon
      }))
    });
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

  /* ==================== 公共：AI 状态 ==================== */

  /**
   * 调一次 civilAI。返回 data 或 null（null 表示该降级）。
   * 三种降级情形统一在这里收口：未配 Key / 超时预算不足 / 网络与上游异常。
   */
  async callAI(payload: Record<string, unknown>, loadingText: string): Promise<Record<string, unknown> | null> {
    this.setData({ aiState: 'loading', aiNote: loadingText });
    try {
      const r = (await callFn('civilAI', payload)) as unknown as Record<string, unknown>;
      if (r && r.success) {
        this.setData({ aiState: 'ai' });
        return r;
      }
      // 云函数返回了可读原因（未配 Key / 未部署 / 超时预算不足 / 模型不可用…）。
      // 若这条原因本身已经说明了「已走本地」，就直接用它，避免拼出重复的话。
      const msg = (r && (r.message as string)) || (r && (r.error as string)) || 'AI 暂不可用';
      const selfExplained = msg.indexOf('本地') >= 0 || msg.indexOf('规则引擎') >= 0;
      this.setData({
        aiState: 'local',
        aiNote: selfExplained ? msg : `AI 未生效（${msg}），已用本地规则引擎给出结果`
      });
      return null;
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: string }).message || '')
        : '';
      this.setData({
        aiState: 'local',
        aiNote: msg && msg.indexOf('本地') >= 0
          ? msg
          : 'AI 云函数未部署或调用失败，已用本地规则引擎给出结果'
      });
      return null;
    }
  },

  /* ==================== Tab1：赛道测评 ==================== */

  onMajorPick(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    this.setData({ major: this.data.major === v ? '' : v });
  },
  onMajorInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ major: e.detail.value });
  },
  onEduChange(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ eduIdx: Number(e.detail.value) });
  },
  onToggleParty() {
    this.setData({ party: !this.data.party });
  },
  onToggleFresh() {
    this.setData({ fresh: !this.data.fresh });
  },
  onPrefer(e: WechatMiniprogram.TouchEvent) {
    this.setData({ prefer: e.currentTarget.dataset.key as string });
  },

  async onAssess() {
    const d = this.data;
    if (!d.major.trim()) {
      toast('先填一下你的专业，这决定了能报哪些岗位');
      return;
    }
    const education = d.educations[d.eduIdx];
    const input = {
      major: d.major.trim(),
      education,
      party: d.party,
      fresh: d.fresh,
      prefer: d.prefer as 'stability' | 'salary' | 'balance' | 'unknown'
    };

    const r = await this.callAI(
      { action: 'assess', ...input },
      '正在结合你的专业与身份评估四条赛道…'
    );

    let result: AssessResult;
    if (r) {
      result = {
        items: Array.isArray(r.items) ? (r.items as AssessResult['items']) : [],
        combo: Array.isArray(r.combo) ? (r.combo as AssessResult['combo']) : [],
        priority: Array.isArray(r.priority) ? (r.priority as string[]) : [],
        avoid: Array.isArray(r.avoid) ? (r.avoid as string[]) : [],
        note: typeof r.note === 'string' ? r.note : ''
      };
      // AI 偶尔会漏字段：缺的组合用本地结果补齐，绝不给用户看半张空表
      if (!result.items.length) result = assessLocal(input);
      else if (!result.combo.length || !result.priority.length || !result.avoid.length) {
        const local = assessLocal(input);
        result = {
          items: result.items,
          combo: result.combo.length ? result.combo : local.combo,
          priority: result.priority.length ? result.priority : local.priority,
          avoid: result.avoid.length ? result.avoid : local.avoid,
          note: result.note || local.note
        };
      }
    } else {
      result = assessLocal(input);
    }

    this.setData({
      aResult: result,
      aItems: result.items.map((it) => ({ ...it, barColor: barColorOf(it.score) }))
    });
  },

  onAssessJobs(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    go(`/subpackages/tools/pages/civil/track?type=${key}`, { loading: true });
  },

  /** 把测评结论复制下来，方便贴进备忘录慢慢消化 */
  onCopyAssess() {
    const d = this.data;
    if (!d.aResult) return;
    const L: string[] = ['【体制内赛道适配测评】', ''];
    d.aItems.forEach((it) => L.push(`${it.name}：${it.score} 分（${it.level}）— ${it.reason}`));
    L.push('');
    if (d.aResult.combo.length) {
      L.push('【报考组合】');
      d.aResult.combo.forEach((c) => L.push(`· ${c.role}：${c.text}`));
      L.push('');
    }
    if (d.aResult.priority.length) {
      L.push('【备考优先级】');
      d.aResult.priority.forEach((x) => L.push(`· ${x}`));
      L.push('');
    }
    if (d.aResult.avoid.length) {
      L.push('【建议避开】');
      d.aResult.avoid.forEach((x) => L.push(`· ${x}`));
    }
    wx.setClipboardData({ data: L.join('\n'), success: () => toast('已复制测评结论') });
  },

  /* ==================== Tab2：备考计划 ==================== */

  onTrackChange(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ trackIdx: Number(e.detail.value) });
  },
  onTargetInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ target: e.detail.value });
  },
  onHoursChange(e: WechatMiniprogram.CustomEvent) {
    const h = Number(e.detail.value);
    this.setData({ hours: h, perDay: Math.round((h / 7) * 10) / 10 });
  },

  async onPlan() {
    const d = this.data;
    const track = d.trackOpts[d.trackIdx] ? d.trackOpts[d.trackIdx].key : 'gk';
    const input = { track, target: d.target.trim(), hours: d.hours };

    const r = await this.callAI(
      { action: 'plan', ...input },
      '正在按当前月份与你的可投入时间排计划…'
    );

    let result: PlanResult;
    if (r && Array.isArray(r.weeks) && (r.weeks as unknown[]).length) {
      result = {
        title: typeof r.title === 'string' ? r.title : '',
        summary: typeof r.summary === 'string' ? r.summary : '',
        weeks: r.weeks as PlanResult['weeks'],
        monthly: Array.isArray(r.monthly) ? (r.monthly as PlanResult['monthly']) : [],
        tips: Array.isArray(r.tips) ? (r.tips as string[]) : [],
        text: typeof r.text === 'string' ? r.text : ''
      };
      if (!result.text) result = { ...result, text: buildPlanLocal(input).text };
    } else {
      result = buildPlanLocal(input);
    }

    this.setData({
      pResult: result,
      pWeeks: result.weeks.map((w) => ({ week: w.week, focus: w.focus, items: w.items }))
    });
  },

  onCopyPlan() {
    const r = this.data.pResult;
    if (!r) return;
    wx.setClipboardData({ data: r.text, success: () => toast('已复制备考计划') });
  },

  /* ==================== Tab3：面试模拟 ==================== */

  onKind(e: WechatMiniprogram.TouchEvent) {
    this.setData({ kind: e.currentTarget.dataset.key as string });
  },
  onQuestion(e: WechatMiniprogram.InputEvent) {
    this.setData({ question: e.detail.value });
  },
  onAnswer(e: WechatMiniprogram.InputEvent) {
    this.setData({ answer: e.detail.value });
  },

  async onInterview() {
    const d = this.data;
    if (d.answer.trim().length < 20) {
      toast('作答内容太短，至少写几句话再让 AI 点评');
      return;
    }
    const track = d.trackOpts[d.trackIdx] ? d.trackOpts[d.trackIdx].key : 'gk';
    const r = await this.callAI(
      { action: 'interview', track, kind: d.kind, question: d.question.trim(), answer: d.answer.trim() },
      '正在按体制内评分标准逐条点评你的作答…'
    );

    if (!r) {
      // AI 不可用：给本地自检而不是空手而归（并在结果里标明来源，不冒充 AI 评分）
      this.setData({ iResult: interviewLocalCheck(d.answer.trim(), d.kind) });
      toast('AI 未生效，已给出本地自检结果');
      return;
    }
    this.setData({
      iResult: {
        score: typeof r.score === 'number' ? r.score : 65,
        level: typeof r.level === 'string' ? r.level : '及格',
        good: Array.isArray(r.good) ? (r.good as string[]) : [],
        improve: Array.isArray(r.improve) ? (r.improve as string[]) : [],
        sample: typeof r.sample === 'string' ? r.sample : ''
      }
    });
  },

  onCopyInterview() {
    const r = this.data.iResult;
    if (!r) return;
    const L: string[] = [`【面试点评】${r.score} 分 · ${r.level}`, ''];
    if (r.good.length) {
      L.push('【答得好的】');
      r.good.forEach((x) => L.push(`· ${x}`));
      L.push('');
    }
    if (r.improve.length) {
      L.push('【要改进的】');
      r.improve.forEach((x) => L.push(`· ${x}`));
      L.push('');
    }
    if (r.sample) {
      L.push('【示范作答】');
      L.push(r.sample);
    }
    wx.setClipboardData({ data: L.join('\n'), success: () => toast('已复制点评') });
  },

  /* ==================== 分享 ==================== */

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: 'AI 上岸规划｜赛道测评 · 备考计划 · 面试模拟',
      path: '/subpackages/tools/pages/civil/plan'
    };
  }
});
