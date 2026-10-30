// pages/recruit/detail.ts
// 投递对象详情：公司/职位字段 + 嵌入式面试知识库 + 面试清单自动生成 + 评分复盘
import { getCareerState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import {
  getAppById, newApplication, upsertApp, removeApp, setStatus,
  addQuestion, updateQuestion, toggleQuestion, removeQuestion,
  extractKeywords, getDefaultInterviewChecklist, toggleChecklist,
  setRating, setReview, syncToTodo, requestRemind, statusLabel,
  timelineNodes, addProgressNote, readiness,
  ensureInterviews, interviewVO, addInterview, updateInterview, removeInterview, toggleInterviewDone,
  reminderPlan, clearTodoReminders, defaultRemindAt, INTERVIEW_ROUNDS, INTERVIEW_MODES
} from '../../utils/recruit-store';
import type { TimelineNode, InterviewVO } from '../../utils/recruit-store';
import type {
  IApplication, IInterviewQ, IChecklistItem, RecruitStatus, InterviewMode
} from '../../../../types/index';
import type { ThemeKey } from '../../../../types/index';
import { go, backAfter } from '../../../../utils/nav';
import { guardTap, confirmDanger, validateFields, firstError } from '../../utils/recruit-ui';
import {
  parseJobLink, parseJobText, readClipboard, composeBase
} from '../../utils/job-parse';
import type { ParsedJobLink } from '../../utils/job-parse';
import { isHttpUrl, extractUrl } from '../../utils/recruit-store';
import { parseShortLink } from '../../utils/job-link';
import type { ShortLinkInfo } from '../../utils/job-link';
import {
  matchResumeToJob, appInsight, buildDrill
} from '../../utils/recruit-intel';
import type { MatchResult, AppInsight, DrillPlan } from '../../utils/recruit-intel';

const STATUS_OPTIONS: RecruitStatus[] = ['applied', 'written', 'interview', 'offer', 'rejected', 'givenup'];
const STATUS_LABELS = STATUS_OPTIONS.map((s) => statusLabel(s));

function toDateStr(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function parseDateStr(s: string): number | null {
  if (!s) return null;
  const t = new Date(s.replace(' ', 'T')).getTime();
  return isNaN(t) ? null : t;
}

interface FormState {
  company: string;
  position: string;
  jdUrl: string;
  applyUrl: string;
  base: string;
  salary: string;
  isReferral: boolean;
  referrer: string;
  status: RecruitStatus;
  dueDate: number | null;
  dueText: string;
}

interface DetailData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  isEdit: boolean;
  id: string;
  form: FormState;
  statusLabel: string;
  statusOptions: string[];
  statusIndex: number;
  keywords: string[];
  /** JD 原文（回显用；此前该文本域绑的是死值，导致保存后重进看不到内容） */
  jdText: string;
  companyNotes: string;
  questions: IInterviewQ[];
  imported: IInterviewQ[];
  checklist: IChecklistItem[];
  ckDone: number;
  ckTotal: number;
  checklistVisible: boolean;
  rating: number;
  review: string;
  remindOn: boolean;
  canRemind: boolean;
  /** 已存的小程序岗位链接（#小程序://） */
  shortLink: string;
  /** 面试安排（多轮） */
  interviews: InterviewVO[];
  ivCount: number;
  ivNextText: string;
  // 面试安排编辑器
  showIvEditor: boolean;
  ivEditId: string;
  ivRound: string;
  ivDateText: string;
  ivMode: InterviewMode;
  ivPlace: string;
  ivInterviewer: string;
  ivNote: string;
  ivRoundIndex: number;
  ivModeIndex: number;
  roundOptions: string[];
  modeOptions: InterviewMode[];
  // 问题编辑器
  showQEditor: boolean;
  qEditId: string;
  qEditText: string;
  qEditAns: string;
  // 知识库区展开
  kbTab: 'jd' | 'company' | 'questions';
  // 进度时间线 + 准备度
  timeline: TimelineNode[];
  readyScore: number;
  readyLevel: string;
  readyLevelKey: 'good' | 'ok' | 'warn' | 'bad';
  showNote: boolean;
  noteDraft: string;
  /** 链接解析中（显示 loading，避免重复点击） */
  parsing: boolean;
  /** 字段级校验提示：字段名 → 错误文案 */
  errors: Record<string, string>;
  /** 保存中：按钮置为忙碌态并拒绝重复提交 */
  saving: boolean;
  /** 保存按钮是否可用（公司名为唯一必填项） */
  canSave: boolean;
  /** 简历 × JD 匹配度（结合用户真实简历算，不是空泛建议） */
  match: MatchResult | null;
  /** 投递洞察：下一步、关键时间节点、停滞提醒 */
  insight: AppInsight | null;
  /** 面试提纲生成器：轮次 / 时长选择 + 索引 */
  drillRound: string;
  drillRoundIndex: number;
  drillMinutes: number;
  drillMinuteIndex: number;
  drillRoundOptions: string[];
  drillMinuteOptions: number[];
  /** 生成的面试提纲 */
  drill: DrillPlan | null;
  /** 提纲是否已导入题库（导入后变「已导入」并禁用重复导入） */
  drillImported: boolean;
}

function readyKeyOf(score: number): 'good' | 'ok' | 'warn' | 'bad' {
  if (score >= 85) return 'good';
  if (score >= 60) return 'ok';
  if (score >= 35) return 'warn';
  return 'bad';
}

Page<DetailData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    isEdit: false,
    id: '',
    form: {
      company: '', position: '', jdUrl: '', applyUrl: '', base: '', salary: '',
      isReferral: false, referrer: '', status: 'applied', dueDate: null, dueText: ''
    },
    statusLabel: '网申',
    statusOptions: STATUS_LABELS,
    statusIndex: 0,
    keywords: [],
    jdText: '',
    companyNotes: '',
    questions: [],
    imported: [],
    checklist: [],
    ckDone: 0,
    ckTotal: 0,
    checklistVisible: false,
    rating: 0,
    review: '',
    remindOn: false,
    canRemind: false,
    shortLink: '',
    interviews: [],
    ivCount: 0,
    ivNextText: '',
    showIvEditor: false,
    ivEditId: '',
    ivRound: '一面',
    ivDateText: '',
    ivMode: '待定',
    ivPlace: '',
    ivInterviewer: '',
    ivNote: '',
    ivRoundIndex: 0,
    ivModeIndex: 3,
    roundOptions: INTERVIEW_ROUNDS.slice() as unknown as string[],
    modeOptions: INTERVIEW_MODES,
    showQEditor: false,
    qEditId: '',
    qEditText: '',
    qEditAns: '',
    kbTab: 'jd',
    timeline: [],
    readyScore: 0,
    readyLevel: '',
    readyLevelKey: 'bad',
    showNote: false,
    noteDraft: '',
    parsing: false,
    errors: {},
    saving: false,
    canSave: false,
    match: null,
    insight: null,
    drillRound: '一面',
    drillRoundIndex: 0,
    drillMinutes: 45,
    drillMinuteIndex: 1,
    drillRoundOptions: INTERVIEW_ROUNDS.slice() as unknown as string[],
    drillMinuteOptions: [30, 45, 60],
    drill: null,
    drillImported: false
  },

  onLoad(query: Record<string, string | undefined>) {
    this.applyTheme();
    if (query && query.id) {
      const app = getAppById(query.id);
      if (app) { this.app = app; this.setData({ isEdit: true, id: app._id }); }
    }
    if (!this.app) {
      this.app = newApplication();
    }
    // 从「岗位开放」模块的「存为投递卡」进入：company|jobCategory|recruitType|applyUrl
    if (query && query.fromOpening) {
      const parts = decodeURIComponent(String(query.fromOpening)).split('|');
      const app = this.app as IApplication;
      if (parts[0]) app.company = parts[0];
      if (parts[1]) app.position = parts[1];
      if (parts[2]) app.base = parts[2];
      if (parts[3]) { app.applyUrl = parts[3]; app.jdUrl = parts[3]; }
    }
    this.project();
    // 首次进入即按当前简历 + JD 生成一份面试提纲（轮次/时长用默认）
    this.genDrill();
    // 从「粘贴链接建卡」入口进入：自动读剪贴板并解析
    if (query && query.autoLink === '1') {
      // 等首屏渲染完再弹，避免和页面转场抢线程
      setTimeout(() => this.autoFillFromClipboard(), 260);
    }
  },

  onShow() {
    this.applyTheme();
    // 从资源库「导入」返回后，重新投影最新数据
    if (this.app && this.app._id) {
      const fresh = getAppById(this.app._id);
      if (fresh) { this.app = fresh; this.project(); }
    }
  },

  applyTheme() {
    const s = getCareerState(); // 秋招助手固定「求职工作台」深蓝视觉，不随全局主题漂移
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  /** 把 this.app 投影到 data 供渲染 */
  project() {
    const a = this.app as IApplication;
    const qAll = [...a.prep.questions, ...a.prep.imported];
    const ckTotal = a.checklist.length;
    const rd = readiness(a);
    const ivs = ensureInterviews(a).map((it) => interviewVO(it));
    const nextIv = ivs.find((it) => !it.done);
    this.setData({
      form: {
        company: a.company, position: a.position, jdUrl: a.jdUrl, applyUrl: a.applyUrl,
        base: a.base, salary: a.salary, isReferral: a.isReferral, referrer: a.referrer,
        status: a.status, dueDate: a.dueDate, dueText: a.dueDate ? toDateStr(a.dueDate) : '点击设置截止时间'
      },
      statusLabel: statusLabel(a.status),
      statusIndex: STATUS_OPTIONS.indexOf(a.status),
      keywords: a.prep.jdKeywords,
      jdText: a.prep.jdText,
      companyNotes: a.prep.companyNotes,
      questions: a.prep.questions,
      imported: a.prep.imported,
      checklist: a.checklist,
      ckDone: a.checklist.filter((c) => c.done).length,
      ckTotal,
      checklistVisible: a.checklist.length > 0,
      rating: a.rating,
      review: a.review,
      remindOn: (a.remindAt || []).length > 0,
      canRemind: !!a.dueDate,
      shortLink: a.shortLink || '',
      interviews: ivs,
      ivCount: ivs.filter((it) => !it.done).length,
      ivNextText: nextIv ? `${nextIv.round} · ${nextIv.dateText}（${nextIv.countdown}）` : '',
      timeline: timelineNodes(a),
      readyScore: rd.score,
      readyLevel: rd.level,
      readyLevelKey: readyKeyOf(rd.score),
      // 智能化：把当前投递的「简历×JD 匹配度」和「下一步 / 关键时间节点」算出来，随卡片一起刷新
      match: matchResumeToJob(a),
      insight: appInsight(a),
      // 保存按钮的可用态：公司名是唯一必填项，为空时按钮置灰
      canSave: !!a.company.trim()
    });
  },

  /**
   * 编辑中的字段防抖落库：JD 原文 / 公司研究都是大段文字，
   * 此前只改内存、不点「保存」就退出会直接丢；评分与复盘却是即时落库，行为不一致。
   * 统一成「停笔 800ms 自动保存」，用户不必担心。
   */
  scheduleAutoSave() {
    const self = this as unknown as { _autoSaveTimer?: ReturnType<typeof setTimeout> };
    if (self._autoSaveTimer) clearTimeout(self._autoSaveTimer);
    self._autoSaveTimer = setTimeout(() => {
      self._autoSaveTimer = undefined;
      const app = this.app as IApplication;
      if (!app._id) return;
      if (!app.company.trim()) return;   // 连公司名都没有，先不落库，避免产生垃圾记录
      upsertApp(app);
      if (!this.data.isEdit) this.setData({ isEdit: true, id: app._id });
    }, 800);
  },

  /**
   * 立即落库。返回是否成功。
   * force=false 时公司名为空则不落库（避免自动保存产生一堆无名垃圾记录）；
   * 用户主动点「保存 / 评分 / 加面试」这类明确动作时传 true。
   */
  persistNow(force?: boolean): boolean {
    const app = this.app as IApplication;
    if (!app.company.trim() && !force) return false;
    upsertApp(app);
    if (!this.data.isEdit) this.setData({ isEdit: true, id: app._id });
    else if (this.data.id !== app._id) this.setData({ id: app._id });
    return true;
  },

  /* ===== 基础字段 ===== */
  onInput(e: WechatMiniprogram.InputEvent) {
    const field = e.currentTarget.dataset.field as string;
    (this.app as IApplication)[field as keyof IApplication] = e.detail.value as never;
    this.project();
    // 输入即消错：正在修改的字段立刻收起红框，错误提示不会一直挂在那儿
    if (this.data.errors && this.data.errors[field]) {
      this.setData({ errors: { ...this.data.errors, [field]: '' } });
    }
  },
  onReferral(e: WechatMiniprogram.TouchEvent) {
    (this.app as IApplication).isReferral = e.currentTarget.dataset.v === '1';
    this.project();
  },
  onDue(e: WechatMiniprogram.PickerChangeEvent) {
    const ts = parseDateStr(String(e.detail.value));
    const app = this.app as IApplication;
    const wasOn = (app.remindAt || []).length > 0;
    app.dueDate = ts;
    // 截止日变了 → 原提醒时间是按旧日期算的，必须重排，否则提醒会落在错误的时间点
    if (wasOn) app.remindAt = defaultRemindAt(ts);
    this.project();
    // picker 是离散选择（不是连续输入），直接落库，不必等 800ms 防抖
    if (app.company.trim()) {
      this.persistNow(true);
      if (wasOn) void this.refreshReminders(true);
    }
  },
  onStatus(e: WechatMiniprogram.PickerChangeEvent) {
    const idx = Number(e.detail.value);
    const target = STATUS_OPTIONS[idx];
    if (!target) return;
    const cur = this.app as IApplication;
    // 必须先落库再 setStatus：setStatus 是从存储里读数据改的，
    // 否则「刚输入的公司名/职位」会被存储中的旧值覆盖回去（表现为输入内容莫名回退）
    if (!cur.company.trim()) {
      cur.status = target;
      this.project();
      toast('已切换状态；填写公司名后才会保存');
      return;
    }
    upsertApp(cur);
    const next = setStatus(cur._id, target);
    if (next) {
      this.app = getAppById(next._id) || next;
      if (target === 'interview') toast('已自动挂载面试准备清单');
    }
    this.setData({ isEdit: true, id: cur._id });
    this.project();
  },

  /* ===== 跳转投递入口（复制链接） ===== */
  copyApply() {
    const url = (this.app as IApplication).applyUrl;
    if (!url) { toast('请先填写网申/投递链接'); return; }
    wx.setClipboardData({ data: url, success: () => toast('已复制网申链接，去浏览器或微信打开') });
  },
  copyJd() {
    const url = (this.app as IApplication).jdUrl;
    if (!url) { toast('请先填写 JD 链接'); return; }
    wx.setClipboardData({ data: url, success: () => toast('已复制 JD 链接') });
  },

  /* ===== 知识库：JD 关键词提取（模块一） ===== */
  onJdInput(e: WechatMiniprogram.InputEvent) {
    const app = this.app as IApplication;
    app.prep.jdText = e.detail.value;
    this.setData({ jdText: e.detail.value });
    this.scheduleAutoSave();
  },
  extractKeywords() {
    const app = this.app as IApplication;
    const text = this.data.jdText || app.prep.jdText || '';
    app.prep.jdText = text;
    const kw = extractKeywords(text);
    app.prep.jdKeywords = kw;
    upsertApp(app);
    if (!this.data.isEdit && app.company.trim()) this.setData({ isEdit: true, id: app._id });
    this.project();
    if (kw.length === 0) toast('没提取到关键词，请先粘贴更完整的 JD');
    else toast(`已提取 ${kw.length} 个关键词`);
  },
  removeKeyword(e: WechatMiniprogram.TouchEvent) {
    const kw = e.currentTarget.dataset.kw as string;
    const app = this.app as IApplication;
    app.prep.jdKeywords = app.prep.jdKeywords.filter((k) => k !== kw);
    upsertApp(app);
    this.project();
  },

  onCompanyNotes(e: WechatMiniprogram.InputEvent) {
    const app = this.app as IApplication;
    app.prep.companyNotes = e.detail.value;
    this.setData({ companyNotes: e.detail.value });
    this.scheduleAutoSave();
  },

  /* ===== 知识库 Tab 切换 ===== */
  onKbTab(e: WechatMiniprogram.TouchEvent) {
    this.setData({ kbTab: e.currentTarget.dataset.tab as 'jd' | 'company' | 'questions' });
  },

  /**
   * 从存储重新读取当前投递，再投影到 data。
   * 必须这么做：this.app 是 getAppById 拿到的一份「快照」，而 store 里的
   * addQuestion / toggleChecklist 等函数是自己从存储读一份副本去改再写回的，
   * 改完 this.app 仍是旧快照 —— 直接 project() 会把旧数据重新 setData，
   * 表现为「点了勾选框没反应 / 新增的题目不出现」。
   */
  reload() {
    const fresh = getAppById((this.app as IApplication)._id);
    if (fresh) this.app = fresh;
    this.project();
  },

  /* ===== 面试题准备（模块一） ===== */
  openQEditor(e?: WechatMiniprogram.TouchEvent) {
    if (e) {
      const id = e.currentTarget.dataset.id as string;
      const all = [...this.data.questions, ...this.data.imported];
      const q = all.find((x) => x.id === id);
      this.setData({ showQEditor: true, qEditId: id, qEditText: q?.q || '', qEditAns: q?.a || '' });
    } else {
      this.setData({ showQEditor: true, qEditId: '', qEditText: '', qEditAns: '' });
    }
  },
  closeQEditor() {
    this.setData({ showQEditor: false, qEditId: '', qEditText: '', qEditAns: '', errors: { ...this.data.errors, qText: '' } });
  },
  onQText(e: WechatMiniprogram.InputEvent) {
    this.setData({ qEditText: e.detail.value, errors: { ...this.data.errors, qText: '' } });
  },
  onQAns(e: WechatMiniprogram.InputEvent) { this.setData({ qEditAns: e.detail.value }); },
  saveQEditor() {
    const q = this.data.qEditText.trim();
    if (!q) {
      this.setData({ errors: { ...this.data.errors, qText: '请填写问题' } });
      toast('请填写问题');
      return;
    }
    this.setData({ errors: { ...this.data.errors, qText: '' } });
    // 新建页第一道题：先把卡片落库，否则 appId 是空串、问题会被静默丢弃
    this.persistNow(true);
    const id = (this.app as IApplication)._id;
    if (this.data.qEditId) {
      updateQuestion(id, this.data.qEditId, { q, a: this.data.qEditAns.trim() });
    } else {
      addQuestion(id, q, this.data.qEditAns.trim(), 'tech');
    }
    this.closeQEditor();
    this.reload();
    toast('已保存');
  },
  toggleQ(e: WechatMiniprogram.TouchEvent) {
    toggleQuestion((this.app as IApplication)._id, e.currentTarget.dataset.id as string);
    this.reload();
  },
  removeQ(e: WechatMiniprogram.TouchEvent) {
    removeQuestion((this.app as IApplication)._id, e.currentTarget.dataset.id as string);
    this.reload();
  },
  importFromLib() {
    // 跳转到资源库，带上来源投递 id，选中的题目将被导入。
    // 先落库：否则 appId 为空，资源库里「导入到投递」按钮不会出现
    this.persistNow(true);
    go(`/subpackages/recruit/pages/recruit/resource?appId=${(this.app as IApplication)._id}`);
  },

  /* ===== 面试提纲生成器（智能化：引导式追问） =====
   * 根据 JD 关键词 / 简历项目 / 公司研究自动出提纲，并允许一键导入题库。
   * 缺输入时 buildDrill 会返回 missing，UI 据此引导用户补充，而不是硬凑通用题。 */
  genDrill() {
    const a = this.app as IApplication;
    const plan = buildDrill(a, { round: this.data.drillRound, minutes: this.data.drillMinutes });
    this.setData({ drill: plan, drillImported: false });
  },
  onDrillRound(e: WechatMiniprogram.PickerChangeEvent) {
    const i = Number(e.detail.value);
    const round = (this.data.drillRoundOptions[i]) || '一面';
    this.setData({ drillRound: round, drillRoundIndex: i }, () => this.genDrill());
  },
  onDrillMinutes(e: WechatMiniprogram.PickerChangeEvent) {
    const i = Number(e.detail.value);
    const m = this.data.drillMinuteOptions[i];
    if (!m) return;
    this.setData({ drillMinutes: m, drillMinuteIndex: i }, () => this.genDrill());
  },
  /** 把生成的提纲一键导入本题投递的面试题库（按题干去重，避免重复） */
  importDrill() {
    const a = this.app as IApplication;
    if (!a._id) { toast('请先保存投递再导入提纲'); return; }
    const plan = this.data.drill;
    if (!plan || plan.groups.length === 0) { toast('还没有可导入的题目'); return; }
    const existing = new Set(
      [...a.prep.questions, ...a.prep.imported].map((q) => (q.q || '').trim()).filter(Boolean)
    );
    let added = 0;
    plan.groups.forEach((g) => g.items.forEach((q) => {
      const t = (q.q || '').trim();
      if (!t || existing.has(t)) return;
      // kind 与题库一致：tech/behavior/project/company/ask
      addQuestion(a._id, t, '', q.kind as IInterviewQ['kind']);
      existing.add(t);
      added++;
    }));
    this.reload();
    this.setData({ drillImported: true });
    toast(added > 0 ? `已导入 ${added} 道面试题（去「题库」查看）` : '题目已全部在题库中');
  },

  /* ===== 面试清单（模块四） ===== */
  toggleCk(e: WechatMiniprogram.TouchEvent) {
    toggleChecklist((this.app as IApplication)._id, e.currentTarget.dataset.id as string);
    this.reload();
  },
  /** 一键重置面试准备清单（误删或想重新走一遍流程时用） */
  resetChecklist() {
    const appId = (this.app as IApplication)._id;
    const app = getAppById(appId);
    if (!app) return;
    app.checklist = getDefaultInterviewChecklist();
    upsertApp(app);
    this.reload();
    toast('已重置为默认准备清单');
  },


  /* ===== 评分 / 复盘（模块四） ===== */
  onRate(e: WechatMiniprogram.TouchEvent) {
    const r = Number(e.currentTarget.dataset.r);
    const app = this.app as IApplication;
    app.rating = r;
    // 直接写 this.app 再落库：先前只调 setRating 写存储、不更新内存副本，
    // 之后任意一次 upsertApp(this.app) 都会把评分覆盖回旧值
    this.persistNow(true);
    this.setData({ rating: r });
    toast(`已评分 ${r} 星`);
  },
  onReview(e: WechatMiniprogram.InputEvent) {
    (this.app as IApplication).review = e.detail.value;
    this.setData({ review: e.detail.value });
    this.scheduleAutoSave();
  },

  /* ===== 面试安排（模块五：日历事件与提醒的数据源） ===== */
  openIvEditor(e?: WechatMiniprogram.TouchEvent) {
    const id = e ? (e.currentTarget.dataset.id as string) : '';
    const iv = id ? ensureInterviews(this.app as IApplication).find((x) => x.id === id) : undefined;
    if (iv) {
      this.setData({
        showIvEditor: true,
        ivEditId: iv.id,
        ivRound: iv.round,
        ivDateText: toDateStr(iv.at),
        ivMode: iv.mode,
        ivPlace: iv.place,
        ivInterviewer: iv.interviewer,
        ivNote: iv.note,
        ivRoundIndex: Math.max(0, (INTERVIEW_ROUNDS as readonly string[]).indexOf(iv.round)),
        ivModeIndex: Math.max(0, INTERVIEW_MODES.indexOf(iv.mode))
      });
      return;
    }
    // 新增：默认取「下一轮」，时间默认明天 10:00（秋招面试最常见的时间）
    const list = ensureInterviews(this.app as IApplication);
    const nextRound = INTERVIEW_ROUNDS[Math.min(list.length, INTERVIEW_ROUNDS.length - 1)];
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    this.setData({
      showIvEditor: true,
      ivEditId: '',
      ivRound: nextRound,
      ivDateText: toDateStr(d.getTime()),
      ivMode: '待定',
      ivPlace: '',
      ivInterviewer: '',
      ivNote: '',
      ivRoundIndex: Math.max(0, (INTERVIEW_ROUNDS as readonly string[]).indexOf(nextRound)),
      ivModeIndex: INTERVIEW_MODES.indexOf('待定')
    });
  },
  closeIvEditor() { this.setData({ showIvEditor: false, ivEditId: '' }); },
  onIvRound(e: WechatMiniprogram.PickerChangeEvent) {
    const i = Number(e.detail.value);
    this.setData({ ivRoundIndex: i, ivRound: INTERVIEW_ROUNDS[i] || '一面' });
  },
  onIvMode(e: WechatMiniprogram.PickerChangeEvent) {
    const i = Number(e.detail.value);
    this.setData({ ivModeIndex: i, ivMode: INTERVIEW_MODES[i] || '待定' });
  },
  onIvDate(e: WechatMiniprogram.PickerChangeEvent) {
    // 选了时间就立刻收起「请选择面试时间」的错误提示
    this.setData({
      ivDateText: String(e.detail.value),
      errors: { ...this.data.errors, ivDate: '' }
    });
  },
  onIvPlace(e: WechatMiniprogram.InputEvent) { this.setData({ ivPlace: e.detail.value }); },
  onIvInterviewer(e: WechatMiniprogram.InputEvent) { this.setData({ ivInterviewer: e.detail.value }); },
  onIvNote(e: WechatMiniprogram.InputEvent) { this.setData({ ivNote: e.detail.value }); },

  saveIvEditor() {
    const at = parseDateStr(this.data.ivDateText);
    if (!at) {
      // 面试时间是这条安排的唯一必填项：提示挂到字段下方，比弹 toast 更好定位
      this.setData({ errors: { ...this.data.errors, ivDate: '请选择面试时间' } });
      toast('请选择面试时间');
      return;
    }
    const wasEdit = !!this.data.ivEditId;
    this.persistNow(true);
    const appId = (this.app as IApplication)._id;
    const patch = {
      round: this.data.ivRound,
      at,
      mode: this.data.ivMode,
      place: this.data.ivPlace.trim(),
      interviewer: this.data.ivInterviewer.trim(),
      note: this.data.ivNote.trim()
    };
    if (wasEdit) updateInterview(appId, this.data.ivEditId, patch);
    else addInterview(appId, patch);
    this.app = getAppById(appId) || this.app;
    this.closeIvEditor();
    this.project();
    // 面试时间是提醒计划的一部分，改完顺手把待办上的提醒刷新一遍
    void this.refreshReminders(true);
    toast(wasEdit ? '已更新面试安排' : '已添加面试安排');
  },

  removeIv(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const appId = (this.app as IApplication)._id;
    wx.showModal({
      title: '删除这场面试',
      content: '该面试对应的提醒也会一并取消。',
      confirmColor: '#ef4444',
      success: (r) => {
        if (!r.confirm) return;
        removeInterview(appId, id);
        this.app = getAppById(appId) || this.app;
        this.project();
        void this.refreshReminders(true);
        toast('已删除');
      }
    });
  },

  toggleIvDone(e: WechatMiniprogram.TouchEvent) {
    const appId = (this.app as IApplication)._id;
    toggleInterviewDone(appId, e.currentTarget.dataset.id as string);
    this.app = getAppById(appId) || this.app;
    this.project();
    void this.refreshReminders(true);
  },

  /** 把这场面试记进进度时间线（面完顺手留痕） */
  logIv(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const iv = ensureInterviews(this.app as IApplication).find((x) => x.id === id);
    if (!iv) return;
    this.persistNow(true);
    const text = `${iv.round} · ${toDateStr(iv.at)}${iv.mode !== '待定' ? ' · ' + iv.mode : ''}${iv.place ? ' · ' + iv.place : ''}`;
    if (!addProgressNote((this.app as IApplication)._id, text)) { toast('记录失败，请重试'); return; }
    this.app = getAppById((this.app as IApplication)._id) || this.app;
    this.project();
    toast('已记入时间线');
  },

  /* ===== 到期提醒（模块二：重复提醒 + 订阅消息） ===== */
  async toggleRemind() {
    const app = this.app as IApplication;
    if (!app.dueDate) { toast('请先设置截止日期'); return; }
    if (this.data.remindOn) {
      // 只关「截止提醒」：面试提醒由面试安排派生，不该被这个开关连坐清掉。
      // refreshReminders 会按剩余计划重建（没有剩余计划就清空待办上的 reminders）。
      app.remindAt = [];
      upsertApp(app);
      this.project();
      await this.refreshReminders(true);
      toast('已关闭到期提醒');
      return;
    }
    // 截止日前一天 09:00 + 前 3 小时各一次；面试提醒由面试安排自动派生，不在这里叠加
    app.remindAt = defaultRemindAt(app.dueDate);
    upsertApp(app);
    this.project();
    // 先落待办并写入 reminders（保证即使用户拒绝微信授权，本机提醒也已生效），
    // 再申请订阅授权 —— 授权成功后 requestRemind 会重建一次 reminders 以带上 subscribed 标记
    const tid = await this.syncToTodoQuiet();
    await requestRemind(app);
    this.project();
    if (!tid) toast('提醒已开启（仅本机）；云就绪后可后台推送');
  },

  /** 静默同步（不弹 toast），返回关联到的待办 id */
  async syncToTodoQuiet(): Promise<string | null> {
    const app = this.app as IApplication;
    if (!app.company.trim()) return null;
    return syncToTodo(app);
  },

  /**
   * 面试安排 / 状态变化后刷新提醒计划。
   * 只更新「已经关联过的主待办」，不擅自新建 —— 用户没点过「同步到待办」就说明
   * 不想让这条投递进自己的待办列表；此时提醒由本机兜底（collectDueRecruitNotices）负责。
   * 没有提醒可排时清空待办上的 reminders，否则全局调度器仍会按时弹。
   */
  async refreshReminders(silent: boolean) {
    const app = this.app as IApplication;
    if (!app.company.trim() || !app.linkedTodoId) return;
    if (reminderPlan(app).length === 0) {
      await clearTodoReminders(app);
      return;
    }
    const tid = await syncToTodo(app);
    if (!silent && !tid) toast('云未就绪，提醒将仅在本机生效');
  },

  /* ===== 同步到待办（模块二：复用首页 Deadline 雷达） =====
     注意：本方法不接受参数。此前签名是 linkTodo(silent?: boolean)，
     而 wxml 用 bindtap 绑定会把事件对象当第一个实参传进来（恒为真值），
     导致「同步到待办」按钮永远静默、点了毫无反馈。 */
  async linkTodo() {
    const app = this.app as IApplication;
    if (!app.company.trim()) { toast('请先填写公司名'); return; }
    upsertApp(app);
    if (!this.data.isEdit) this.setData({ isEdit: true, id: app._id });
    wx.showLoading({ title: '同步中…', mask: true });
    const tid = await syncToTodo(app);
    wx.hideLoading();
    this.project();
    if (tid) toast('已同步到待办（首页 Deadline 雷达可见，提醒也已排期）');
    else toast('云未就绪：本机提醒仍有效，待办同步稍后可重试');
  },


  /* ===== 进度时间线：手动记一笔（不改状态） ===== */
  openNoteEditor() { this.setData({ showNote: true, noteDraft: '' }); },
  closeNoteEditor() { this.setData({ showNote: false, noteDraft: '' }); },
  onNoteInput(e: WechatMiniprogram.InputEvent) { this.setData({ noteDraft: e.detail.value }); },
  saveNote() {
    const text = (this.data.noteDraft || '').trim();
    if (!text) { toast('写点什么再保存'); return; }
    const app = this.app as IApplication;
    if (!app.company.trim()) { toast('请先填写公司名称'); return; }
    if (!this.data.isEdit) {
      // 新建中直接记备注：先落库，否则这条记录会丢
      upsertApp(app);
      this.setData({ isEdit: true, id: app._id });
    }
    if (!addProgressNote(app._id, text)) { toast('记录失败，请重试'); return; }
    this.app = getAppById(app._id) || app;
    this.closeNoteEditor();
    this.project();
    toast('已记入时间线');
  },

  /* ===== 链接 / 文案自动提取（模块六） ===== */

  /**
   * 读剪贴板 → 判断是链接还是文案 → 分别走云函数解析或本地文本解析。
   * 这是「投递岗位后回来建卡」的主入口。
   */
  async autoFillFromClipboard() {
    if (this.data.parsing) return;
    const raw = await readClipboard();
    // ① 微信小程序链接（#小程序://）：解析不出内容，但可以一键跳转，先存下来
    const sl = parseShortLink(raw);
    if (sl) {
      this.handleShortLink(sl);
      return;
    }
    const url = extractUrl(raw);
    if (url && isHttpUrl(url)) {
      await this.doParseLink(url);
      return;
    }
    // 剪贴板里不是链接：当作分享文案 / JD 处理
    if (raw && raw.trim()) {
      await this.doParseText(raw);
      return;
    }
    // 剪贴板空 → 弹输入框让用户手贴
    this.askForLink();
  },

  /** 手动粘贴链接（输入框） */
  askForLink() {
    wx.showModal({
      title: '粘贴岗位链接',
      content: '',
      editable: true,
      placeholderText: '粘贴 BOSS / 前程无忧 / 猎聘 / 小程序 等岗位链接',
      confirmText: '解析',
      cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) return;
        const val = String((r as any).content || '').trim();
        if (!val) return;
        const sl = parseShortLink(val);
        if (sl) { this.handleShortLink(sl); return; }
        const url = extractUrl(val) || val;
        if (isHttpUrl(url)) await this.doParseLink(url);
        else await this.doParseText(val);
      }
    });
  },

  /* ===== 微信小程序链接（#小程序://）==========
   * 解析不出公司/岗位/时间（微信加密令牌，官方无反解接口），
   * 但可以用它一键跳回该岗位页——所以做法是「存链接 + 跳转 + 引导补全」。
   */

  /** 收到一条小程序链接：先存档，再说明原因并给出操作 */
  handleShortLink(sl: ShortLinkInfo) {
    const app = this.app as IApplication;
    app.shortLink = sl.raw;
    if (!app.jdUrl) app.jdUrl = sl.raw;
    this.project();

    wx.showModal({
      title: `「${sl.appName}」小程序岗位`,
      content:
        `${sl.reason}\n\n` +
        `可以这样做：\n` +
        sl.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      confirmText: '打开岗位',
      cancelText: '稍后填写',
      success: (r) => {
        if (r.confirm) this.openShortLink();
        else toast('链接已保存到这张投递卡，可稍后补填');
      }
    });
  },

  /** 用 shortLink 跳转目标小程序（微信官方支持，不需要 appId） */
  openShortLink() {
    const app = this.app as IApplication;
    const link = app.shortLink || '';
    if (!link) { toast('还没有保存小程序链接'); return; }
    wx.navigateToMiniProgram({
      shortLink: link,
      fail: (err) => {
        console.error('[openShortLink] fail:', err);
        wx.showModal({
          title: '打开失败',
          content:
            '这条小程序链接可能已过期（微信 ShortLink 有有效期），或当前不在微信环境中。\n' +
            '建议回到「' + (app.company || '该') + '」小程序里重新分享一次链接。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  /** 调云函数解析链接 */
  async doParseLink(url: string) {
    this.setData({ parsing: true });
    wx.showLoading({ title: '解析中…', mask: true });
    let res: ParsedJobLink;
    try {
      res = await parseJobLink(url);
    } finally {
      wx.hideLoading();
      this.setData({ parsing: false });
    }

    if (!res.ok) {
      this.onParseBlocked(res, url);
      return;
    }
    this.applyParsed(res, url, true);
  },

  /** 解析被拦截：给出原因，并引导降级为粘贴文案 */
  onParseBlocked(res: ParsedJobLink, url: string) {
    // 链接本身先存下来，别让用户白贴一次
    const app = this.app as IApplication;
    if (url && !app.applyUrl) { app.applyUrl = url; }
    if (url && !app.jdUrl) { app.jdUrl = url; }
    this.project();

    wx.showModal({
      title: '该链接无法自动读取',
      content: `${res.hint}\n\n可以回到招聘 App，长按复制岗位信息（公司、职位、薪资、城市），再点「粘贴文案解析」；也可以直接手动填写，链接已帮你存好。`,
      confirmText: '粘贴文案解析',
      cancelText: '手动填写',
      success: async (r) => {
        if (!r.confirm) return;
        const raw = await readClipboard();
        const text = raw && raw.trim() && !isHttpUrl(raw.trim()) ? raw : '';
        if (text) { await this.doParseText(text); return; }
        // 剪贴板还没有文案，弹输入框
        wx.showModal({
          title: '粘贴岗位文案',
          content: '',
          editable: true,
          placeholderText: '把招聘 App 里的岗位信息粘贴到这里',
          confirmText: '解析',
          cancelText: '取消',
          success: (r2) => {
            if (!r2.confirm) return;
            const v = String((r2 as any).content || '').trim();
            if (v) this.doParseText(v);
          }
        });
      }
    });
  },

  /** 粘贴分享文案 / JD 文本入口：先读剪贴板，读不到再弹输入框 */
  async askForText() {
    const raw = await readClipboard();
    const text = (raw || '').trim();
    if (text && !isHttpUrl(text)) { await this.doParseText(text); return; }
    wx.showModal({
      title: '粘贴岗位文案',
      content: '',
      editable: true,
      placeholderText: '把招聘 App 里的岗位信息粘贴到这里',
      confirmText: '解析',
      cancelText: '取消',
      success: (r) => {
        if (!r.confirm) return;
        const v = String((r as any).content || '').trim();
        if (v) this.doParseText(v);
      }
    });
  },

  /** 解析分享文案 / JD 文本（本地解析，不需要云函数） */
  async doParseText(raw: string) {
    const p = parseJobText(raw);
    if (!p.company && !p.position && !p.salary && !p.location) {
      toast('没识别出公司/岗位，请手动填写');
      return;
    }
    const app = this.app as IApplication;
    if (p.company) app.company = p.company;
    if (p.position) app.position = p.position;
    if (p.salary) app.salary = p.salary;
    const base = composeBase(p.location, p.experience, p.education);
    if (base) app.base = base;
    if (p.jdText) app.prep.jdText = p.jdText;
    if (p.keywords && p.keywords.length) app.prep.jdKeywords = p.keywords;
    this.project();
    toast(`已提取：${[p.company, p.position].filter(Boolean).join(' · ') || '岗位信息'}`);
    this.confirmAndSave();
  },

  /** 把解析结果写入表单，并询问是否直接生成待办 */
  applyParsed(res: ParsedJobLink, url: string, withTodo: boolean) {
    const app = this.app as IApplication;
    if (res.company) app.company = res.company;
    if (res.position) app.position = res.position;
    if (res.salary) app.salary = res.salary;
    const base = composeBase(res.location, res.experience, res.education);
    if (base) app.base = base;
    if (url) { if (!app.applyUrl) app.applyUrl = url; if (!app.jdUrl) app.jdUrl = url; }
    if (res.jdText) {
      app.prep.jdText = res.jdText;
      const kw = extractKeywords(res.jdText);
      if (kw.length) app.prep.jdKeywords = kw;
    }
    this.project();

    const summary = [
      res.company ? `公司：${res.company}` : '',
      res.position ? `岗位：${res.position}` : '',
      res.location ? `工作地：${res.location}` : '',
      res.salary ? `薪资：${res.salary}` : ''
    ].filter(Boolean).join('\n');

    if (!withTodo) { this.confirmAndSave(false, summary); return; }

    wx.showModal({
      title: '已自动提取',
      content: `${summary || '（字段较少，可手动补充）'}\n\n是否同时生成一条待办？`,
      confirmText: '保存并生成待办',
      cancelText: '仅保存',
      success: (r) => {
        if (r.confirm) this.saveAndLinkTodo();
        else this.saveOnly();
      }
    });
  },

  /** 保存并生成待办 */
  async saveAndLinkTodo() {
    this.saveOnly(true);
    await this.linkTodo(true);
    wx.showModal({
      title: '已建卡并生成待办',
      content: `${(this.app as IApplication).company} · ${(this.app as IApplication).position || '（未填岗位）'}\n\n待办已加入首页，可在 Deadline 雷达里看到。返回秋招助手可继续补充 JD 与面试准备。`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /** 仅保存（silent=true 时不弹 toast） */
  saveOnly(silent?: boolean) {
    const app = this.app as IApplication;
    if (!app.company.trim()) {
      if (!silent) toast('请先填写公司名称');
      return;
    }
    upsertApp(app);
    this.setData({ isEdit: true, id: app._id });
    if (!silent) toast('已保存');
  },

  /** 兼容旧的「填好并生成待办」调用 */
  confirmAndSave(withTodo?: boolean, _summary?: string) {
    if (withTodo === false) { this.saveOnly(); return; }
    wx.showModal({
      title: '信息已填入',
      content: '是否同时生成一条待办？',
      confirmText: '保存并生成待办',
      cancelText: '仅保存',
      success: (r) => {
        if (r.confirm) this.saveAndLinkTodo();
        else this.saveOnly();
      }
    });
  },

  /* ===== 保存 / 删除 ===== */

  /**
   * 保存前统一校验：公司名是唯一必填项。
   * 校验失败时把错误挂到字段上（红框 + 字段下方提示），
   * 而不是只弹一句 toast —— 用户一眼就能看到是哪一项没填。
   */
  validateForm(): boolean {
    const app = this.app as IApplication;
    const errors = validateFields([
      { field: 'company', label: '公司名称', value: app.company, required: true }
    ]);
    this.setData({ errors });
    if (Object.keys(errors).length > 0) {
      toast(firstError(errors));
      return false;
    }
    return true;
  },

  save() {
    if (this.data.saving) return;              // 保存中：拒绝重复提交
    if (!this.validateForm()) return;
    const app = this.app as IApplication;
    this.setData({ saving: true });
    upsertApp(app);
    this.setData({ isEdit: true, id: app._id });
    toast('已保存');
    this.setData({ saving: false });
    // 用 backAfter 而不是裸 setTimeout：等待期内用户自己返回也不会多退一页
    backAfter(400);
  },

  async onDelete() {
    if (!this.data.isEdit) { wx.navigateBack(); return; }
    if (!guardTap('detail-del')) return;
    const ok = await confirmDanger({
      title: '删除投递',
      content: '确定删除该投递记录？删除后不可恢复。'
    });
    if (!ok) return;
    removeApp(this.data.id);
    wx.navigateBack();
  }
});
