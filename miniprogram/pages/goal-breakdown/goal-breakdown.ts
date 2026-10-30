// pages/goal-breakdown/goal-breakdown.ts
// 「目标拆解」AI 目标规划工作台：
//   用户提出一个愿望 → 本地启发式「AI 理解」（类型/周期/难度/频率/每日投入）
//   → 目标结构预览（4 阶段）→ 策略推荐 + 可行性分析 → 云端 goalPlanner 拆解 → 一键写入待办。
//
// 容错策略（重要）：
//   云端 AI 不可用（未部署 / 未配 Key / 网络异常 / 模型返回不合规）时，
//   一律用 utils/goal-store 的 localFallbackPlan 生成通用拆解，保证功能永远有输出，
//   并用一条 notice 说明原因，不让用户面对空白页。
//   页面内的「AI 理解 / 可行性分析」是本地纯函数（utils/goal-insight），离线始终可用。
import { callFn, toast } from '../../utils/cloud';
import { addTodo } from '../../utils/todo-store';
import {
  sanitizePlan, decorateMilestones, localFallbackPlan,
  loadRecords, saveRecord, removeRecord, planToAddPayloads, uid,
  type PlanStyle, type GoalPlan, type GoalRecord, type DecoratedMilestone
} from '../../utils/goal-store';
import {
  analyzeGoal, stagePreview, feasibilityOf, recommendStyle,
  weeksLabel, fmtCnDate, todayStr,
  EXEC_MODES, type GoalInsight, type StageNode, type Feasibility
} from '../../utils/goal-insight';
import { relaunch } from '../../utils/nav';

interface GoalBreakdownData {
  // 表单
  goal: string;
  style: PlanStyle;
  dailyMinutes: number;
  useDeadline: boolean;
  deadline: string;
  deadlineCn: string;
  minDate: string;
  execMode: 'daily' | 'weekdays' | 'weekly';
  // 视图常量
  examples: string[];
  styleCards: { key: PlanStyle; icon: string; name: string; desc: string }[];
  execModes: typeof EXEC_MODES;
  // AI 理解状态机：idle=未输入 running=分步动画 done=展示理解结果
  aiState: 'idle' | 'running' | 'done';
  aiStep: string;
  insight: {
    category: string;
    categoryIcon: string;
    weeksText: string;
    starsText: string;
    freqText: string;
    dailyText: string;
    sourceNote: string;
  } | null;
  stages: StageNode[];
  feas: Feasibility | null;
  recoKey: PlanStyle | '';
  recoTitle: string;
  recoReasons: string[];
  showWhy: boolean;
  // 生成
  generating: boolean;
  genStep: string;
  notice: string;
  // 结果
  plan: GoalPlan | null;
  items: DecoratedMilestone[];
  byAI: boolean;
  totalMinutes: number;
  savedGoal: string;
  // 历史
  records: GoalRecord[];
  showHistory: boolean;
}

/** 非渲染的模块级字段（定时器 / 用户是否手动改过策略）。
 *  本页同一时刻只有一个实例，用模块级变量承载，规避 Page 泛型版本差异。 */
let aiTimers: ReturnType<typeof setTimeout>[] = [];
let genTimer: ReturnType<typeof setInterval> | null = null;
let goalDebounce: ReturnType<typeof setTimeout> | null = null;
let styleTouched = false;

interface PlannerResult {
  success?: boolean;
  plan?: unknown;
  error?: string;
  message?: string;
}

const AI_ERROR_TEXT: Record<string, string> = {
  AI_NOT_CONFIGURED: '云端 AI 未配置，已用通用模板拆解',
  AI_AUTH: 'AI 密钥无效，已用通用模板拆解',
  AI_BALANCE: 'AI 余额不足，已用通用模板拆解',
  AI_RATE_LIMIT: '请求太频繁，已用通用模板拆解',
  AI_TIMEOUT: '拆解超时，已用通用模板拆解',
  AI_NETWORK: '网络异常，已用通用模板拆解',
  AI_UNPARSEABLE: '模型结果不合规，已用通用模板拆解',
  AI_BAD_REQUEST: '模型拒绝了该目标，已用通用模板拆解',
  UNSUPPORTED_ACTION: '云函数 goalPlanner 版本过旧，已用通用模板拆解'
};

/** 「开始智能拆解」点击后的分步文案（与按钮进度同步） */
const GEN_STEPS = ['开始分析目标', '识别目标结构', '计算执行周期', '生成阶段任务', '生成每周计划', '生成今日第一步'];

const STYLE_CARDS: { key: PlanStyle; icon: string; name: string; desc: string }[] = [
  { key: 'balanced', icon: '✦', name: '均衡', desc: '稳步推进 · 全面发展' },
  { key: 'aggressive', icon: '⚡', name: '激进', desc: '快速达成 · 挑战自我' },
  { key: 'conservative', icon: '🛡', name: '保守', desc: '循序渐进 · 稳扎稳打' }
];

const STYLE_TITLE: Record<PlanStyle, string> = {
  balanced: '均衡推进',
  aggressive: '快速突破',
  conservative: '低压力推进'
};

const EXAMPLES = ['9月底前读完《认知觉醒》', '两个月内减重 5 公斤', '两周做完秋招简历'];

Page<GoalBreakdownData>({
  data: {
    goal: '',
    style: 'balanced',
    dailyMinutes: 60,
    useDeadline: false,
    deadline: '',
    deadlineCn: '',
    minDate: '',
    execMode: 'daily',
    examples: EXAMPLES,
    styleCards: STYLE_CARDS,
    execModes: EXEC_MODES,
    aiState: 'idle',
    aiStep: '',
    insight: null,
    stages: [],
    feas: null,
    recoKey: '',
    recoTitle: '',
    recoReasons: [],
    showWhy: false,
    generating: false,
    genStep: '',
    notice: '',
    plan: null,
    items: [],
    byAI: false,
    totalMinutes: 0,
    savedGoal: '',
    records: [],
    showHistory: false
  },

  onLoad() {
    this.setData({
      minDate: todayStr(),
      records: loadRecords()
    });
  },

  onUnload() {
    this.clearTimers();
  },

  clearTimers() {
    aiTimers.forEach(clearTimeout);
    aiTimers = [];
    if (goalDebounce) clearTimeout(goalDebounce);
    goalDebounce = null;
    if (genTimer) clearInterval(genTimer);
    genTimer = null;
  },

  // ===== 目标输入 + AI 理解 =====
  onGoal(e: WechatMiniprogram.InputEvent) {
    const goal = e.detail.value;
    this.setData({ goal });
    // 防抖 500ms 后跑分步理解动画
    if (goalDebounce) clearTimeout(goalDebounce);
    goalDebounce = setTimeout(() => {
      goalDebounce = null;
      this.runAnalysis();
    }, 500);
  },

  onExample(e: WechatMiniprogram.TouchEvent) {
    const text = String(e.currentTarget.dataset.text || '');
    if (!text) return;
    this.setData({ goal: text });
    this.runAnalysis();
  },

  /** 分步「AI 理解」动画：正在理解 → 识别类型 → 分析周期 → 生成策略 → 完成 */
  runAnalysis() {
    this.clearAiAnim();
    const text = (this.data.goal || '').trim();
    if (text.replace(/\s+/g, '').length < 4) {
      this.setData({ aiState: 'idle', aiStep: '', insight: null, stages: [], feas: null, recoKey: '', recoReasons: [], showWhy: false });
      return;
    }
    this.setData({ aiState: 'running', aiStep: '正在理解目标...' });
    const steps = ['识别目标类型...', '分析时间周期...', '生成拆解策略...'];
    steps.forEach((s, i) => {
      aiTimers.push(setTimeout(() => this.setData({ aiStep: s }), 380 * (i + 1)));
    });
    aiTimers.push(setTimeout(() => this.applyInsight(), 380 * steps.length + 140));
  },

  clearAiAnim() {
    aiTimers.forEach(clearTimeout);
    aiTimers = [];
  },

  /** 计算理解结果 / 结构预览 / 可行性 / 策略推荐（参数变化时无动画直接刷新） */
  applyInsight() {
    const days = this.deadlineDays();
    const ins: GoalInsight | null = analyzeGoal(this.data.goal, days);
    if (!ins) {
      this.setData({ aiState: 'idle', aiStep: '', insight: null, stages: [], feas: null, recoKey: '', recoReasons: [], showWhy: false });
      return;
    }
    const feas = feasibilityOf(ins, this.data.dailyMinutes, this.data.execMode);
    const reco = recommendStyle(ins, this.data.dailyMinutes, days);
    const patch: Partial<GoalBreakdownData> = {
      aiState: 'done',
      aiStep: '',
      insight: {
        category: ins.category,
        categoryIcon: ins.categoryIcon,
        weeksText: weeksLabel(ins.weeks, ins.weeksSource),
        starsText: '★'.repeat(ins.difficulty) + '☆'.repeat(5 - ins.difficulty),
        freqText: `每周 ${ins.freqPerWeek} 天`,
        dailyText: `${ins.dailyMin} ~ ${ins.dailyMax} 分钟`,
        sourceNote: ins.weeksSource === 'inferred' ? '按目标类型估算' : ins.weeksSource === 'deadline' ? '按截止日推算' : '从目标描述识别'
      },
      stages: stagePreview(ins.weeks),
      feas,
      recoKey: reco.key,
      recoTitle: STYLE_TITLE[reco.key],
      recoReasons: reco.reasons
    };
    // 用户没手动选过策略时，跟随 AI 推荐
    if (!styleTouched && this.data.style !== reco.key) patch.style = reco.key;
    this.setData(patch);
  },

  // ===== 表单 =====
  onStyle(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as PlanStyle;
    if (!key || key === this.data.style) return;
    styleTouched = true;
    this.setData({ style: key });
  },
  onToggleWhy() {
    this.setData({ showWhy: !this.data.showWhy });
  },
  onMinutes(e: WechatMiniprogram.CustomEvent) {
    const detail = e.detail as { value?: number };
    const v = Number(detail && detail.value);
    if (!Number.isFinite(v)) return;
    this.setData({ dailyMinutes: Math.max(15, Math.min(240, Math.round(v))) });
    this.refreshDerived();
  },
  onExecMode(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as 'daily' | 'weekdays' | 'weekly';
    if (!key || key === this.data.execMode) return;
    this.setData({ execMode: key });
    this.refreshDerived();
  },
  onDeadlineToggle(e: WechatMiniprogram.TouchEvent) {
    const use = String(e.currentTarget.dataset.use) === '1';
    if (use === this.data.useDeadline) return;
    this.setData({ useDeadline: use, deadline: use ? this.data.deadline : '', deadlineCn: use ? this.data.deadlineCn : '' });
    this.refreshDerived();
  },
  onDeadline(e: WechatMiniprogram.PickerChangeEvent) {
    const dl = String(e.detail.value || '');
    this.setData({ deadline: dl, deadlineCn: fmtCnDate(dl), useDeadline: true });
    this.refreshDerived();
  },

  /** 参数变化后重算派生数据（理解结果已存在时，无动画直接刷新） */
  refreshDerived() {
    if (this.data.aiState === 'done') this.applyInsight();
  },

  /** 截止日距今天数；无截止日返回 null */
  deadlineDays(): number | null {
    const dl = this.data.deadline;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dl);
    if (!m) return null;
    const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0).getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
    const diff = Math.round((target - today) / 86400000);
    return diff >= 0 ? diff : null;
  },

  // ===== 生成 =====
  async onGenerate() {
    const goal = (this.data.goal || '').trim();
    if (goal.length < 2) {
      toast('先用一句话写下你的目标');
      return;
    }
    if (this.data.generating) return;

    // CTA 分步文案
    let stepIdx = 0;
    this.setData({ generating: true, genStep: GEN_STEPS[0], notice: '' });
    if (genTimer) clearInterval(genTimer);
    genTimer = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, GEN_STEPS.length - 1);
      this.setData({ genStep: GEN_STEPS[stepIdx] });
    }, 500);

    const days = this.deadlineDays();
    let plan: GoalPlan | null = null;
    let byAI = false;
    let notice = '';

    try {
      const res = await callFn<PlannerResult>('goalPlanner', {
        goal,
        style: this.data.style,
        dailyMinutes: this.data.dailyMinutes,
        deadline: this.data.deadline
      });
      if (res && res.success !== false && res.plan) {
        plan = sanitizePlan(res.plan, this.data.dailyMinutes, days);
        if (plan) {
          byAI = true;
        } else {
          notice = '模型结果不合规范，已用通用模板拆解';
        }
      } else {
        notice = AI_ERROR_TEXT[(res && res.error) || ''] || 'AI 暂不可用，已用通用模板拆解';
      }
    } catch (err) {
      const raw = err as { code?: string; message?: string } | null;
      const msg = String((raw && raw.message) || '');
      // 云函数抛错时 message 形如 "AI_BALANCE:xxx" 或 "云函数业务失败"
      let key = '';
      Object.keys(AI_ERROR_TEXT).forEach((k) => {
        if (!key && msg.indexOf(k) >= 0) key = k;
      });
      notice = key ? AI_ERROR_TEXT[key] : 'AI 暂不可用，已用通用模板拆解';
      console.warn('[goal-breakdown] fallback:', msg);
    }

    if (!plan) {
      plan = localFallbackPlan(goal, this.data.style, this.data.dailyMinutes, days);
      byAI = false;
    }

    const items = decorateMilestones(plan);
    const totalMinutes = plan.milestones.reduce((s, m) => s + m.duration_minutes, 0);

    // 自动入历史（最多保留 20 条）
    const record: GoalRecord = {
      id: uid(),
      goal,
      style: this.data.style,
      dailyMinutes: this.data.dailyMinutes,
      deadline: this.data.deadline,
      plan,
      byAI,
      createTime: Date.now()
    };
    const records = saveRecord(record);

    if (genTimer) clearInterval(genTimer);
    genTimer = null;
    this.setData({
      plan,
      items,
      byAI,
      notice,
      totalMinutes,
      savedGoal: goal,
      records,
      generating: false,
      genStep: ''
    });
    // 项目自带的 wx 类型声明未覆盖 pageScrollTo，这里做一次安全降级调用
    const wxx = wx as unknown as { pageScrollTo?: (o: { scrollTop: number; duration: number }) => void };
    if (typeof wxx.pageScrollTo === 'function') wxx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  // ===== 结果操作 =====
  async onAddToTodos() {
    const plan = this.data.plan;
    if (!plan) return;
    const payloads = planToAddPayloads(this.data.savedGoal || this.data.goal, plan);
    wx.showLoading({ title: `写入 ${payloads.length} 条`, mask: true });
    let ok = 0;
    for (const p of payloads) {
      // 串行写入：避免并发写同一本地分片造成顺序错乱
      // eslint-disable-next-line no-await-in-loop
      const r = await addTodo(p);
      if (r) ok += 1;
    }
    wx.hideLoading();
    wx.showModal({
      title: '已加入待办',
      content: `成功写入 ${ok} / ${payloads.length} 条，去首页查看进度吧`,
      confirmText: '去首页',
      cancelText: '留这里',
      success: (res) => {
        // 首页非 tabBar 页，用 reLaunch 清栈回到根页
        if (res.confirm) relaunch('/pages/index/index');
      }
    });
  },

  onReset() {
    this.setData({
      plan: null,
      items: [],
      notice: '',
      byAI: false,
      totalMinutes: 0,
      savedGoal: ''
    });
  },

  // ===== 历史 =====
  onToggleHistory() {
    this.setData({ showHistory: !this.data.showHistory, records: loadRecords() });
  },
  onOpenRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const rec = loadRecords().find((r) => r.id === id);
    if (!rec) return;
    this.setData({
      goal: rec.goal,
      style: rec.style,
      dailyMinutes: rec.dailyMinutes,
      deadline: rec.deadline,
      deadlineCn: fmtCnDate(rec.deadline),
      useDeadline: !!rec.deadline,
      plan: rec.plan,
      items: decorateMilestones(rec.plan),
      byAI: rec.byAI,
      totalMinutes: rec.plan.milestones.reduce((s, m) => s + m.duration_minutes, 0),
      savedGoal: rec.goal,
      notice: rec.byAI ? '' : '这条是通用模板拆解的结果',
      showHistory: false
    });
    // 项目自带的 wx 类型声明未覆盖 pageScrollTo，这里做一次安全降级调用
    const wxx = wx as unknown as { pageScrollTo?: (o: { scrollTop: number; duration: number }) => void };
    if (typeof wxx.pageScrollTo === 'function') wxx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },
  onDeleteRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条拆解记录吗？',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ records: removeRecord(id) });
        toast('已删除');
      }
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: this.data.savedGoal ? `目标拆解：${this.data.savedGoal}` : '把长期目标，变成今天可以完成的一步',
      path: '/pages/goal-breakdown/goal-breakdown'
    };
  }
});
