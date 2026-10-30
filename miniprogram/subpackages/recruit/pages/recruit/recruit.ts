// pages/recruit/recruit.ts
// 秋招助手 Hub：投递列表 + Deadline 雷达（最近 7 天置顶）+ 资源库/日历入口
import { getCareerState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { get, set } from '../../../../utils/storage';
import {
  loadApps, removeApp, setStatus, syncToTodo, dueInfo, statusLabel,
  parseJobFromText, emptyPrep, newApplication, upsertApp, searchResources,
  overview, readiness, timelineNodes, RECRUIT_PLATFORMS, RecruitPlatform,
  interviewAgenda, collectDueRecruitNotices, loadFollowedOpenings
} from '../../utils/recruit-store';
import type { AgendaItem } from '../../utils/recruit-store';
import type { IApplication, RecruitStatus } from '../../../../types/index';
import type { ThemeKey } from '../../../../types/index';
import { go } from '../../../../utils/nav';
import { todayBrief, weeklyAdvice, parseCommand, COPILOT_COMMANDS } from '../../utils/recruit-intel';
import type { TodayBrief, WeeklyAdvice, CommandRoute } from '../../utils/recruit-intel';
import { guardTap, confirmDanger, debounce, cancelDebounce, withLoading } from '../../utils/recruit-ui';

/** 跳转招聘平台后「回来回填」回执条的有效期（毫秒） */
const BACK_HINT_TTL = 15 * 60 * 1000;
const BACK_HINT_KEY = 'recruit_last_platform_jump';

const STATUS_FILTERS: { key: RecruitStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'applied', label: '网申' },
  { key: 'written', label: '笔试' },
  { key: 'interview', label: '面试' },
  { key: 'offer', label: 'Offer' }
];

const STATUS_OPTIONS: RecruitStatus[] = ['applied', 'written', 'interview', 'offer', 'rejected', 'givenup'];

/** 首页快捷能力宫格（均指向真实存在的工作台，不造假入口） */
interface QuickAction { key: string; name: string; desc: string; icon: string; bg: string; go: string; }
const QUICK_ACTIONS: QuickAction[] = [
  { key: 'job', name: '职位搜索', desc: '海量岗位 · 精准推荐', icon: '🔍', bg: 'linear-gradient(135deg,#2563EB,#3B82F6)', go: '/subpackages/recruit/pages/recruit/openings' },
  { key: 'resume', name: '简历优化', desc: '岗位匹配 · AI 提炼 · 多套版式', icon: '📄', bg: 'linear-gradient(135deg,#4F46E5,#7C3AED)', go: '/subpackages/recruit/pages/recruit/resume' },
  { key: 'interview', name: '面试准备', desc: '模拟面试 · 经验题库', icon: '🎯', bg: 'linear-gradient(135deg,#0EA5E9,#22D3EE)', go: '/subpackages/recruit/pages/recruit/resource' },
  { key: 'resource', name: '秋招资源', desc: '面经 · 模板 · 报告', icon: '📚', bg: 'linear-gradient(135deg,#8B5CF6,#A855F7)', go: '/subpackages/recruit/pages/recruit/resource' },
  { key: 'analysis', name: '数据看板', desc: '转化漏斗 · 进度诊断', icon: '📊', bg: 'linear-gradient(135deg,#10B981,#34D399)', go: '/subpackages/recruit/pages/recruit/analysis' }
];

/** 开发指令面板 · 内置 Prompt 模板（点模板直达对应工作台，不做假 AI） */
interface PromptTemplate { id: string; title: string; desc: string; go: string; }
const PROMPT_TEMPLATES: PromptTemplate[] = [
  { id: 'resume', title: '/resume optimize', desc: '简历优化 · 匹配度 · ATS', go: '/subpackages/recruit/pages/recruit/resume' },
  { id: 'job', title: '/job analyze', desc: '岗位画像 · 面试重点', go: '/subpackages/recruit/pages/recruit/openings' },
  { id: 'match', title: '/job match', desc: '是否值得投递', go: '/subpackages/recruit/pages/recruit/openings' },
  { id: 'interview', title: '/interview prep', desc: '模拟面试 · STAR', go: '/subpackages/recruit/pages/recruit/resource' },
  { id: 'behavior', title: '/behavior interview', desc: '行为面试训练', go: '/subpackages/recruit/pages/recruit/resource' },
  { id: 'industry', title: '/industry analysis', desc: '行业趋势 · 薪资', go: '/subpackages/recruit/pages/recruit/analysis' },
  { id: 'apply', title: '/apply strategy', desc: '投递策略 · 节奏', go: '/subpackages/recruit/pages/recruit/openings?view=timeline' },
  { id: 'data', title: '/data analysis', desc: '转化漏斗 · 复盘', go: '/subpackages/recruit/pages/recruit/analysis' }
];

/** 资源库总条数（种子数据基本静态，缓存避免每次 onShow 都重建 272 条对象） */
let _resourceTotal = -1;
function resourceTotal(): number {
  if (_resourceTotal < 0) _resourceTotal = searchResources('', 'all').length;
  return _resourceTotal;
}

/** 投递列表排序方式 */
type SortKey = 'due' | 'update' | 'ready';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'due', label: '截止优先' },
  { key: 'update', label: '最近更新' },
  { key: 'ready', label: '准备度低' }
];

/** 投递对象在列表中的展示形态 */
interface DecoApp {
  _id: string;
  company: string;
  position: string;
  status: RecruitStatus;
  statusLabel: string;
  dueDate: number | null;
  dueText: string;
  dueKey: string;
  days: number;
  jdCount: number;
  qTotal: number;
  qDone: number;
  ckTotal: number;
  ckDone: number;
  referrer: string;
  isReferral: boolean;
  applyUrl: string;
  /** 面试准备度 0-100 */
  readyScore: number;
  readyLevelKey: string;
  /** 最近一次状态流转的文字描述 */
  lastText: string;
}

interface RecruitData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  apps: DecoApp[];
  radar: DecoApp[];
  radarCount: number;
  total: number;
  filter: RecruitStatus | 'all';
  filters: { key: string; label: string }[];
  stats: { applied: number; written: number; interview: number; offer: number };
  platforms: RecruitPlatform[];
  resourceCount: number;
  /** 未来 7 天的面试议程 */
  agenda: AgendaItem[];
  agendaCount: number;
  /** 今天有几场面试 */
  interviewToday: number;
  /** 已关注的岗位数（岗位开放模块） */
  followCount: number;
  // 搜索 / 排序 / 概览
  keyword: string;
  sort: SortKey;
  sorts: { key: SortKey; label: string }[];
  weekCount: number;
  offerRate: number;
  activeCount: number;
  /** 「刚从 XX 回来？」回执条 */
  backHint: string;
  backHintName: string;
  /** 链接解析中 */
  parsing: boolean;
  /** 今日下一步：把各投递的待办聚成一张清单（升级前的首页只有统计数字） */
  brief: TodayBrief | null;
  /** 本周建议（AI 助手卡；来自真实数据，空数据为欢迎态） */
  advice: WeeklyAdvice | null;
  /** 建议点用「 · 」拼好的一句话（省 wxml 处理） */
  adviceText: string;
  /** 开发指令面板：内置快捷指令（点 chip 直达对应工作台） */
  commands: CommandRoute[];
  /** Copilot 输入框内容与解析提示 */
  copilotInput: string;
  copilotHint: string;
  /** 首页快捷能力宫格 */
  quickActions: QuickAction[];
  /** 开发指令面板 · 内置 Prompt 模板 */
  promptTemplates: PromptTemplate[];
}

function readyKeyOf(score: number): string {
  if (score >= 85) return 'good';
  if (score >= 60) return 'ok';
  if (score >= 35) return 'warn';
  return 'bad';
}

function decorate(a: IApplication): DecoApp {
  const di = dueInfo(a.dueDate);
  const qAll = [...a.prep.questions, ...a.prep.imported];
  const ckTotal = a.checklist.length;
  const ckDone = a.checklist.filter((c) => c.done).length;
  const rd = readiness(a);
  const nodes = timelineNodes(a);
  const last = nodes.length > 0 ? nodes[nodes.length - 1] : null;
  return {
    _id: a._id,
    company: a.company || '未命名公司',
    position: a.position || '',
    status: a.status,
    statusLabel: statusLabel(a.status),
    dueDate: a.dueDate,
    dueText: di.text,
    dueKey: di.key,
    days: di.days,
    jdCount: a.prep.jdKeywords.length,
    qTotal: qAll.length,
    qDone: qAll.filter((q) => q.done).length,
    ckTotal,
    ckDone,
    referrer: a.referrer,
    isReferral: a.isReferral,
    applyUrl: a.applyUrl,
    readyScore: rd.score,
    readyLevelKey: readyKeyOf(rd.score),
    lastText: last ? `${last.label} · ${last.agoText}` : '刚刚创建'
  };
}

/** 列表排序：截止优先 / 最近更新 / 准备度低优先 */
function sortApps(list: IApplication[], key: SortKey): IApplication[] {
  const arr = list.slice();
  if (key === 'update') {
    arr.sort((a, b) => b.updateTime - a.updateTime);
  } else if (key === 'ready') {
    // 准备度先算一遍再排：原来写在比较函数里，n 条要算 O(n log n) 次，
    // 投递一多（秋招后期几十条）排序就会明显发涩。
    const readyMap: Record<string, number> = {};
    arr.forEach((a) => { readyMap[a._id] = readiness(a).score; });
    arr.sort((a, b) => (readyMap[a._id] - readyMap[b._id]) || (b.updateTime - a.updateTime));
  } else {
    arr.sort((a, b) => {
      const av = a.dueDate || Number.MAX_SAFE_INTEGER;
      const bv = b.dueDate || Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      return b.updateTime - a.updateTime;
    });
  }
  return arr;
}

Page<RecruitData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    apps: [],
    radar: [],
    radarCount: 0,
    total: 0,
    filter: 'all',
    filters: STATUS_FILTERS,
    stats: { applied: 0, written: 0, interview: 0, offer: 0 },
    platforms: RECRUIT_PLATFORMS,
    resourceCount: 0,
    agenda: [],
    agendaCount: 0,
    interviewToday: 0,
    followCount: 0,
    keyword: '',
    sort: 'due',
    sorts: SORTS,
    weekCount: 0,
    offerRate: 0,
    activeCount: 0,
    backHint: '',
    backHintName: '',
    parsing: false,
    brief: null,
    advice: null,
    adviceText: '',
    commands: COPILOT_COMMANDS,
    copilotInput: '',
    copilotHint: '',
    quickActions: QUICK_ACTIONS,
    promptTemplates: PROMPT_TEMPLATES
  },

  onLoad() {
    // 只做主题：onLoad 之后必定紧跟一次 onShow，不需要在这里算第二遍完整列表
    // （原来是 onLoad + onShow 各算一次，首屏白白多跑一轮统计 / 议程 / 建议）
    this.applyTheme();
  },
  onShow() {
    this.applyTheme();
    this.checkBackHint();
    this.checkReminders();
    this.refresh();
  },

  /**
   * 打开秋招首页时补扫一次到期提醒。
   * 云环境未部署、或用户还没把投递同步到待办时，全局调度器扫不到秋招的提醒，
   * 这里是唯一兜底：只要用户进过秋招页面，就不会静默错过。
   */
  checkReminders() {
    const notices = collectDueRecruitNotices();
    if (notices.length === 0) return;
    const modal = notices.find((n) => n.method === 'modal');
    if (modal) {
      wx.showModal({
        title: '⏰ 提醒',
        content: `「${modal.company}」${modal.title}${notices.length > 1 ? `，另有 ${notices.length - 1} 条提醒` : ''}`,
        showCancel: false,
        confirmText: '知道了'
      });
    } else {
      toast(`⏰ ${notices[0].company} ${notices[0].title}`, 'none');
    }
  },
  applyTheme() {
    const s = getCareerState(); // 秋招助手固定「求职工作台」深蓝视觉，不随全局主题漂移
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  refresh() {
    const all = loadApps();
    const filter = this.data.filter;
    const kw = (this.data.keyword || '').trim().toLowerCase();

    let visible = filter === 'all' ? all : all.filter((a) => a.status === filter);
    if (kw) {
      visible = visible.filter((a) => {
        const hay = `${a.company} ${a.position} ${a.base} ${a.referrer}`.toLowerCase();
        return hay.indexOf(kw) >= 0;
      });
    }
    const apps = sortApps(visible, this.data.sort).map(decorate);

    // Deadline 雷达：截止在 7 天内（含逾期）的置顶，按到期时间升序
    const radar = all
      .filter((a) => a.dueDate && dueInfo(a.dueDate).days <= 7)
      .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0))
      .map(decorate);

    const ov = overview(all);
    const agenda = interviewAgenda(7, all);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const advice = weeklyAdvice(all);
    this.setData({
      apps,
      radar,
      radarCount: radar.length,
      total: all.length,
      stats: all.reduce((s: { applied: number; written: number; interview: number; offer: number }, a) => {
        if (a.status === 'applied') s.applied++;
        else if (a.status === 'written') s.written++;
        else if (a.status === 'interview') s.interview++;
        else if (a.status === 'offer') s.offer++;
        return s;
      }, { applied: 0, written: 0, interview: 0, offer: 0 }),
      weekCount: ov.weekCount,
      offerRate: ov.offerRate,
      activeCount: ov.active,
      agenda,
      agendaCount: agenda.length,
      interviewToday: agenda.filter((x) => x.at <= todayEnd.getTime()).length,
      followCount: loadFollowedOpenings().length,
      // 资源库入口上展示的可用资料条数（只统计已通过审核的）
      resourceCount: resourceTotal(),
      // 智能化：把分散在各投递里的「该做的事」聚成今日清单
      brief: todayBrief(all),
      // AI 助手卡的本周建议（真实数据驱动；空数据为欢迎引导）
      advice,
      adviceText: advice ? advice.points.join(' · ') : ''
    });
  },

  /* ---------- 搜索 / 排序 ---------- */
  /**
   * 搜索防抖：输入过程中每敲一个字就重排整份投递会明显卡顿，
   * 这里合并成「停手 180ms 后算一次」，输入过程始终顺滑。
   */
  onSearch(e: WechatMiniprogram.InputEvent) {
    const kw = e.detail.value || '';
    this.setData({ keyword: kw });
    debounce('recruit-kw', 180, () => this.refresh());
  },
  onClearSearch() {
    if (!this.data.keyword) return;
    cancelDebounce('recruit-kw');
    this.setData({ keyword: '' }, () => this.refresh());
  },
  onSort(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as SortKey;
    if (key === this.data.sort) return;
    this.setData({ sort: key }, () => this.refresh());
  },

  onFilter(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as RecruitStatus | 'all';
    if (key === this.data.filter) return;
    this.setData({ filter: key }, () => this.refresh());
  },

  onAdd() {
    go('/subpackages/recruit/pages/recruit/detail');
  },
  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    // 统一带 loading：页面初始化超过 220ms 才显示遮罩，秒开时不会闪，
    // 慢的时候把「点了没反应」的空白期换成明确进度
    go(`/subpackages/recruit/pages/recruit/detail?id=${id}`, { loading: '正在打开投递卡' });
  },

  onStatus(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    // 防连点：ActionSheet 弹出期间再点一次不会叠出第二层
    if (!guardTap('status-' + id)) return;
    const items = STATUS_OPTIONS.map((s) => statusLabel(s));
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const target = STATUS_OPTIONS[res.tapIndex];
        if (!target) return;
        const app = setStatus(id, target);
        if (app && target === 'interview') {
          toast('已进入面试：已自动挂载准备清单');
        }
        this.refresh();
      }
    });
  },

  async onLinkTodo(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!guardTap('todo-' + id)) return;
    const app = loadApps().find((a) => a._id === id);
    if (!app) return;
    if (!app.dueDate) {
      toast('请先在详情页设置截止日期，再同步到待办');
      return;
    }
    const tid = await withLoading('同步中…', () => syncToTodo(app));
    if (tid) toast('已同步到待办（首页 Deadline 雷达可见）');
    else toast('同步失败：云未就绪，已用本地保存');
    this.refresh();
  },

  async onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!guardTap('del-' + id)) return;
    const app = loadApps().find((a) => a._id === id);
    // 删除不可恢复：统一走危险确认框（红色确认键 + 轻振动），避免手滑误删
    const ok = await confirmDanger({
      title: '删除投递',
      content: `确定删除「${app ? app.company : ''}」的投递记录吗？删除后不可恢复。`
    });
    if (!ok) return;
    removeApp(id);
    this.refresh();
    toast('已删除');
  },

  // 各入口跳转统一带 loading：慢的时候有进度反馈，快的时候遮罩不会闪（>220ms 才出现）
  jumpResource() { go('/subpackages/recruit/pages/recruit/resource', { loading: '正在打开资源库' }); },
  jumpCalendar() { go('/subpackages/recruit/pages/recruit/calendar', { loading: '正在打开日历' }); },
  jumpAnalysis() { go('/subpackages/recruit/pages/recruit/analysis', { loading: '正在生成看板' }); },
  jumpOpenings() { go('/subpackages/recruit/pages/recruit/openings', { loading: '正在打开岗位开放' }); },
  /** 直达岗位开放的时间线视图 */
  jumpTimeline() { go('/subpackages/recruit/pages/recruit/openings?view=timeline', { loading: '正在打开时间线' }); },
  jumpResume() { go('/subpackages/recruit/pages/recruit/resume', { loading: '正在打开简历' }); },
  /** 只看已关注岗位 */
  jumpFollowed() { go('/subpackages/recruit/pages/recruit/openings?followed=1', { loading: '正在打开关注岗位' }); },
  /** 点面试议程 → 直接进该投递详情 */
  onAgendaTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (id) go(`/subpackages/recruit/pages/recruit/detail?id=${id}`, { loading: '正在打开投递卡' });
  },

  /** 点「今日下一步」的某条 → 按 action.go 跳到对应投递详情或固定页面 */
  onBriefTap(e: WechatMiniprogram.TouchEvent) {
    const kind = e.currentTarget.dataset.kind as string;
    const target = e.currentTarget.dataset.target as string;
    if (!target) return;
    if (kind === 'app') go(`/subpackages/recruit/pages/recruit/detail?id=${target}`);
    else go(target);
  },
  /** 仕途衡鉴 · 体制内上岸通（独立大模块） */
  jumpCivil() { go('/subpackages/tools/pages/civil/civil', { loading: '正在打开体制内模块' }); },

  /* ---------- 开发指令 · AI Copilot（本地指令路由：点了就直达对应工作台） ---------- */
  onCopilotInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ copilotInput: e.detail.value, copilotHint: '' });
  },
  /**
   * 「生成方案」：本地解析指令并直达对应工作台。
   * 刻意不假装成云端 AI：识别不了就明说，并引导用快捷指令 —— 不虚构、不空转。
   */
  onCopilotRun() {
    const route = parseCommand(this.data.copilotInput);
    if (!route) {
      this.setData({ copilotHint: '暂时没听懂这句 —— 试试下面的快捷指令，例如「优化我的简历」' });
      return;
    }
    this.setData({ copilotInput: '', copilotHint: '' });
    toast(`已直达「${route.label}」`);
    go(route.go, { loading: route.label });
  },
  /** 点快捷指令 chip：直接去对应工作台 */
  onQuickCmd(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const route = this.data.commands.filter((c) => c.key === key)[0];
    if (route) go(route.go, { loading: route.label });
  },
  /** 快捷能力宫格：按 key 直达对应工作台 */
  onQuickAction(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const a = this.data.quickActions.filter((x) => x.key === key)[0];
    if (a) go(a.go, { loading: a.name });
  },
  /** 开发指令模板：点模板直达对应工作台（把「能力清单」做成可执行入口） */
  onTemplateTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const t = this.data.promptTemplates.filter((x) => x.id === id)[0];
    if (t) go(t.go, { loading: t.title });
  },
  /** 「使用示例」：把示例填进输入框（不直接执行，让用户看清指令形态） */
  onCopilotEg() {
    this.setData({ copilotInput: '分析我的秋招数据', copilotHint: '' });
  },
  /** 秋招黄金期 Banner → 岗位时间线（黄金期 = 卡准各家公司开放节奏） */
  jumpGolden() { this.jumpTimeline(); },

  /* ---------- 招聘平台快捷跳转 + 链接 / 剪贴板导入岗位 ---------- */

  /**
   * 「投递后回来一键回填」：跳转去招聘小程序时记一笔，回到本页 15 分钟内展示回执条。
   * 微信沙箱隔离决定了我们读不到对方 App 的投递行为，所以退而求其次——
   * 回来时主动问一句，把「粘贴岗位链接 → 自动提取 → 建卡 + 待办」这条路铺到最短。
   */
  checkBackHint() {
    const rec = get<{ key: string; at: number } | null>(BACK_HINT_KEY, null);
    if (!rec || !rec.at || Date.now() - rec.at > BACK_HINT_TTL) {
      if (this.data.backHint) this.setData({ backHint: '', backHintName: '' });
      return;
    }
    const p = RECRUIT_PLATFORMS.find((x) => x.key === rec.key);
    if (!p) return;
    this.setData({ backHint: rec.key, backHintName: p.name });
  },
  dismissBackHint() {
    set(BACK_HINT_KEY, null);
    this.setData({ backHint: '', backHintName: '' });
  },
  /** 点回执条：带着「自动读剪贴板」的标记进新建页 */
  useBackHint() {
    const key = this.data.backHint;
    this.dismissBackHint();
    go(`/subpackages/recruit/pages/recruit/detail?autoLink=1&from=${key}`);
  },

  /**
   * 跳转三大招聘小程序。
   * 优先级：shortLink（无需 appId / 无需白名单，三平台通用）→ appId（可深度跳转）→ 复制链接。
   */
  openPlatform(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    // 跳转外部小程序有启动延迟，连点会连续拉起多次，这里直接挡掉
    if (!guardTap('plat-' + key, 1200)) return;
    const p = RECRUIT_PLATFORMS.find((x) => x.key === key);
    if (!p) return;
    // 记录跳转，回来后展示回执条
    set(BACK_HINT_KEY, { key, at: Date.now() });

    const tryAppId = () => {
      if (!p.appId) { this.fallbackLink(p); return; }
      (wx as any).navigateToMiniProgram({
        appId: p.appId,
        path: p.path || '',
        envVersion: 'release',
        fail: (err: any) => {
          console.error('navigateToMiniProgram(appId) fail:', err);
          this.fallbackLink(p);
        }
      });
    };

    if (!p.shortLink) { tryAppId(); return; }
    (wx as any).navigateToMiniProgram({
      shortLink: p.shortLink,
      envVersion: 'release',
      fail: (err: any) => {
        console.error('navigateToMiniProgram(shortLink) fail:', err);
        // shortLink 需要基础库 ≥ 2.18.1，老版本或链接失效时退到 appId
        tryAppId();
      }
    });
  },

  /** 最后兜底：复制 #小程序:// 链接，提示用户在微信里粘贴打开 */
  fallbackLink(p: RecruitPlatform, hint?: string) {
    const link = p.shortLink || '';
    if (!link) { toast(`暂未配置「${p.name}」的打开方式`); return; }
    wx.setClipboardData({
      data: link,
      success: () => {
        wx.showModal({
          title: `已复制「${p.name}」小程序链接`,
          content: hint || '已复制到剪贴板，请在微信聊天框或搜索框粘贴，即可打开该小程序。投递完回来，点「粘贴链接建卡」可自动提取岗位信息并生成待办。',
          showCancel: false,
          confirmText: '知道了'
        });
      },
      fail: () => toast('复制失败，请手动搜索打开')
    });
  },

  /** 入口：粘贴岗位网页链接 → 云函数解析 → 建卡（走详情页统一处理） */
  addByLink() {
    if (this.data.parsing) return;
    go('/subpackages/recruit/pages/recruit/detail?autoLink=1', { loading: '正在打开' });
  },

  /** 从剪贴板导入岗位：在 BOSS / 前程无忧 / 猎聘 复制 JD 后点此，自动解析并建卡 */
  async importFromClipboard() {
    if (this.data.parsing) return;   // 解析中：入口置灰，拒绝重复触发
    if (!guardTap('import-clip', 1000)) return;
    this.setData({ parsing: true });
    try {
      await this.doImportFromClipboard();
    } finally {
      this.setData({ parsing: false });
    }
  },

  async doImportFromClipboard() {
    // 旧版 WeChat 类型只声明了 setClipboardData，这里用 as any 兼容真实存在的 getClipboardData
    const res = await new Promise<{ data?: string }>((resolve) => {
      (wx as any).getClipboardData({ success: (r: any) => resolve(r), fail: () => resolve({}) });
    });
    const raw = (res && res.data) || '';
    if (!raw || !raw.trim()) {
      toast('剪贴板为空：请先在 BOSS / 前程无忧 / 猎聘 里复制岗位信息');
      return;
    }
    // 解析 + 建卡全程带遮罩，长 JD 也不会出现「点了没反应」的空白期
    const app = await withLoading('正在识别岗位…', () => {
      const parsed = parseJobFromText(raw);
      const created = newApplication({
        company: parsed.company,
        position: parsed.position,
        salary: parsed.salary,
        base: [parsed.location, parsed.experience, parsed.education].filter(Boolean).join(' · '),
        prep: { ...emptyPrep(), jdText: parsed.jdText, jdKeywords: parsed.keywords }
      });
      upsertApp(created);
      return created;
    });
    toast(`已导入：${app.prep.jdKeywords.length} 个关键词`);
    this.refresh();
    go(`/subpackages/recruit/pages/recruit/detail?id=${app._id}`, { loading: '正在打开投递卡' });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '秋招助手 · 投递追踪与面试准备', path: '/subpackages/recruit/pages/recruit/recruit' };
  }
});
