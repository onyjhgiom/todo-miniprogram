// utils/recruit-store.ts
// 秋招助手（招聘模块）数据层：本地存储优先 + 可选关联主待办系统
// 覆盖：投递对象 CRUD / 嵌入式知识库 / JD 关键词提取 / 面试清单模板 / 资源库（内置 + 用户分享）/ 关联待办
import { get, set } from '../../../utils/storage';
import { callFn, toast } from '../../../utils/cloud';
import { SUB_TMPL_ID, requestSubscribe, grantSubscription } from '../../../utils/subscribe';
import { FINANCE_SEEDS } from './recruit-seeds-finance';
import { FINANCE_SEEDS_2 } from './recruit-seeds-finance2';
import { FINANCE_SEEDS_EN } from './recruit-seeds-finance-en';
import { rankItems, summarize, autoTopics } from './recruit-library';
import type {
  IApplication, IAppPrep, IInterviewQ, IChecklistItem, IResourceItem, RecruitStatus, ResourceType,
  IStatusChange, IInterview, InterviewMode
} from '../../../types/index';

/* ============ 招聘平台快捷入口配置 ============
   合并自原 subpackages/tools/utils/platforms.ts。
   背景：该模块此前为独立 .ts，被外部工具移入分包后，微信开发者工具增量编译图漏登记它，
   导致 recruit/detail/job-parse 运行时报 "module platforms.js is not defined"。
   并入本文件（recruit-store 已在 DevTools 编译图内、必被编译）后彻底消除该漏编模块。
   跳转方案：主路径 = shortLink（#小程序:// 链接，基础库 2.18.1+ 支持，无需 appId 白名单）；
   兜底 = appId（需同步写进 app.json 的 navigateToMiniProgramAppIdList）；最后兜底 = 复制链接。 */

export interface RecruitPlatform {
  key: string;
  name: string;
  desc: string;
  color: string;
  /** 目标小程序 appId；为空则使用 shortLink 跳转（推荐，无需白名单） */
  appId: string;
  /** 小程序 shortLink（微信「··· → 复制链接」得到的 #小程序:// 链接），为首选跳转方式 */
  shortLink: string;
  /** 目标小程序内的页面路径，仅在配置了 appId 时才有意义 */
  path?: string;
  /** 该平台岗位链接的域名特征，用于解析粘贴进来的网页链接 */
  hosts: string[];
}

export const RECRUIT_PLATFORMS: RecruitPlatform[] = [
  {
    key: 'boss',
    name: 'BOSS直聘',
    desc: '直聊模式 · 反馈快',
    color: '#00a6a7',
    appId: 'wxa8da525af05281f3',
    shortLink: '#小程序://BOSS直聘/WtVAKDrvhA2Si9e',
    hosts: ['zhipin.com']
  },
  {
    key: 'job51',
    name: '前程无忧',
    desc: '51Job · 综合老牌',
    color: '#ff7a00',
    appId: '',
    shortLink: '#小程序://前程无忧/xrujm2pnWHAmDSc',
    hosts: ['51job.com', '51jobcdn.com']
  },
  {
    key: 'liepin',
    name: '猎聘招聘',
    desc: '中高端 · 猎头多',
    color: '#1aad8a',
    appId: '',
    shortLink: '#小程序://猎聘招聘/WIQzD7GCTlxqtgw',
    hosts: ['liepin.com', 'lietou.com']
  }
];

/** 按 key 取平台配置 */
export function platformByKey(key: string): RecruitPlatform | undefined {
  return RECRUIT_PLATFORMS.find((p) => p.key === key);
}

/** 按域名识别平台，返回 key；未识别返回空串 */
export function platformKeyByUrl(url: string): string {
  const u = (url || '').toLowerCase();
  if (!u) return '';
  for (const p of RECRUIT_PLATFORMS) {
    for (const h of p.hosts) {
      if (u.indexOf(h) >= 0) return p.key;
    }
  }
  return '';
}

/** 判断字符串是否为 http(s) 链接 */
export function isHttpUrl(s: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test((s || '').trim());
}

/**
 * 从一段文本中抠出第一个 http(s) 链接。
 */
export function extractUrl(text: string): string {
  const m = (text || '').match(/https?:\/\/[^\s"'<>）)】\]]+/i);
  return m ? m[0] : '';
}

const APP_KEY = 'recruit_apps';
const RES_KEY = 'recruit_resources';
const SUB_TMPL_KEY = 'recruit_sub_tmpl'; // 用户在小程序后台申请的「待办提醒」类目订阅模板 id
/** 资源库收藏（星标）的条目 id 列表 */
const FAV_RES_KEY = 'recruit_fav_res';
/** 关注（盯梢）的岗位 id 列表 */
const FAV_OPENING_KEY = 'recruit_fav_openings';
/** 本地提醒去重日志：即使云端写入失败，也不会重复弹（与主待办的 reminder_fired 同思路） */
const REMIND_FIRED_KEY = 'recruit_remind_fired';

export function uid(prefix = 'rc'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ==================== 投递对象 ==================== */

export function loadApps(): IApplication[] {
  const list = get<IApplication[]>(APP_KEY, []);
  return Array.isArray(list) ? list : [];
}
export function saveApps(list: IApplication[]): void {
  set(APP_KEY, list);
}
export function getAppById(id: string): IApplication | undefined {
  return loadApps().find((a) => a._id === id);
}

/** 新建 / 更新投递对象（幂等：存在则合并） */
export function upsertApp(app: IApplication): void {
  const list = loadApps();
  const idx = list.findIndex((a) => a._id === app._id);
  app.updateTime = Date.now();
  if (idx >= 0) list[idx] = { ...list[idx], ...app };
  else list.unshift(app);
  saveApps(list);
}

export function removeApp(id: string): void {
  saveApps(loadApps().filter((a) => a._id !== id));
}

/**
 * 切换状态：进入「面试」时自动挂载默认 checklist，并向进度时间线追加一个节点。
 * @param note 可选备注，填了即使状态没变也会记一笔（如「已约面 3.12 14:00」）
 */
export function setStatus(id: string, status: RecruitStatus, note?: string): IApplication | undefined {
  const app = getAppById(id);
  if (!app) return undefined;
  // 注意：兜底历史必须在改 status 之前取，否则合成的节点会带上新状态
  const prevHistory = ensureHistory(app);
  const becomingInterview = status === 'interview' && app.status !== 'interview';
  if (becomingInterview && app.checklist.length === 0) {
    app.checklist = getDefaultInterviewChecklist();
  }
  const changed = app.status !== status;
  app.status = status;
  app.history = (changed || note)
    ? [...prevHistory, { status, at: Date.now(), note }]
    : prevHistory;
  upsertApp(app);
  return app;
}

export function emptyPrep(): IAppPrep {
  return { jdText: '', jdKeywords: [], companyNotes: '', questions: [], imported: [] };
}

/* ==================== 面试安排（多轮） ==================== */

/** 可选轮次（与资源库的 RESOURCE_ROUNDS 对齐，便于按轮次找人资料） */
export const INTERVIEW_ROUNDS = ['一面', '二面', '三面', 'Leader面', 'HR面', '终面', '其他'] as const;
export const INTERVIEW_MODES: InterviewMode[] = ['线上', '现场', '电话', '待定'];

/**
 * 归一化面试安排：老数据没有该字段时补空数组，
 * 并丢弃缺时间的脏数据（缺 at 无法进日历、无法提醒）。
 */
export function ensureInterviews(app: IApplication): IInterview[] {
  const raw = Array.isArray(app.interviews) ? app.interviews : [];
  return raw
    .filter((it): it is IInterview => !!(it && typeof it.at === 'number' && it.at > 0))
    .map((it) => ({
      id: it.id || uid('iv'),
      round: it.round || '一面',
      at: it.at,
      mode: it.mode || '待定',
      place: it.place || '',
      interviewer: it.interviewer || '',
      note: it.note || '',
      done: !!it.done
    }))
    .sort((a, b) => a.at - b.at);
}

export function getInterviews(app: IApplication): IInterview[] {
  return ensureInterviews(app);
}

/** 下一场还没结束的面试（按时间升序取第一个未来场次） */
export function nextInterview(app: IApplication): IInterview | null {
  const now = Date.now();
  const list = ensureInterviews(app).filter((it) => !it.done && it.at >= now - 3600000);
  return list.length ? list[0] : null;
}

function mutateInterviews(appId: string, fn: (list: IInterview[]) => IInterview[]): IApplication | undefined {
  const app = getAppById(appId);
  if (!app) return undefined;
  app.interviews = fn(ensureInterviews(app));
  upsertApp(app);
  return app;
}

/** 新增一轮面试 */
export function addInterview(appId: string, partial?: Partial<IInterview>): IInterview | undefined {
  const app = getAppById(appId);
  if (!app) return undefined;
  const item: IInterview = {
    id: uid('iv'),
    round: partial?.round || '一面',
    at: partial?.at || Date.now() + 86400000,
    mode: partial?.mode || '待定',
    place: partial?.place || '',
    interviewer: partial?.interviewer || '',
    note: partial?.note || '',
    done: false
  };
  app.interviews = [...ensureInterviews(app), item].sort((a, b) => a.at - b.at);
  upsertApp(app);
  return item;
}

export function updateInterview(appId: string, iid: string, patch: Partial<IInterview>): void {
  mutateInterviews(appId, (list) => list.map((it) => (it.id === iid ? { ...it, ...patch } : it)));
}

export function removeInterview(appId: string, iid: string): void {
  mutateInterviews(appId, (list) => list.filter((it) => it.id !== iid));
}

export function toggleInterviewDone(appId: string, iid: string): void {
  mutateInterviews(appId, (list) => list.map((it) => (it.id === iid ? { ...it, done: !it.done } : it)));
}

/** 面试安排的展示形态（详情页列表用） */
export interface InterviewVO extends IInterview {
  dateText: string;
  /** 距今天数：负=已过 */
  days: number;
  countdown: string;
  modeKey: string;
}

const MODE_KEY: Record<InterviewMode, string> = { 线上: 'online', 现场: 'onsite', 电话: 'phone', 待定: 'tbd' };

export function interviewVO(it: IInterview, now = Date.now()): InterviewVO {
  const d = new Date(it.at);
  const p = (n: number) => String(n).padStart(2, '0');
  const days = Math.ceil((it.at - now) / 86400000);
  let countdown = '';
  if (it.done) countdown = '已结束';
  else if (days < 0) countdown = `已过 ${Math.abs(days)} 天`;
  else if (days === 0) countdown = '就在今天';
  else if (days === 1) countdown = '明天';
  else countdown = `${days} 天后`;
  return {
    ...it,
    dateText: `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`,
    days,
    countdown,
    modeKey: MODE_KEY[it.mode] || 'tbd'
  };
}

export function newApplication(partial?: Partial<IApplication>): IApplication {
  const now = Date.now();
  const app: IApplication = {
    _id: uid(),
    company: '',
    position: '',
    jdUrl: '',
    applyUrl: '',
    base: '',
    salary: '',
    isReferral: false,
    referrer: '',
    status: 'applied',
    dueDate: null,
    remindAt: [],
    interviews: [],
    prep: emptyPrep(),
    checklist: [],
    linkedTodoId: null,
    rating: 0,
    review: '',
    history: [],
    order: now,
    createTime: now,
    updateTime: now,
    ...partial
  };
  // 时间线的起点：若调用方没给 history，就用最终 status 合成一条，保证时间线非空
  if (!app.history || app.history.length === 0) {
    app.history = [{ status: app.status, at: now }];
  }
  return app;
}

/* ==================== 知识库：面试题 ==================== */

export function addQuestion(appId: string, q: string, a = '', kind: IInterviewQ['kind'] = 'tech'): void {
  const app = getAppById(appId);
  if (!app) return;
  const item: IInterviewQ = { id: uid('q'), q: q.trim(), a: a.trim(), kind, done: false };
  if (kind === 'imported') app.prep.imported.push(item);
  else app.prep.questions.push(item);
  upsertApp(app);
}
export function updateQuestion(appId: string, qid: string, patch: Partial<IInterviewQ>): void {
  const app = getAppById(appId);
  if (!app) return;
  const all = [...app.prep.questions, ...app.prep.imported];
  const t = all.find((x) => x.id === qid);
  if (!t) return;
  Object.assign(t, patch);
  upsertApp(app);
}
export function toggleQuestion(appId: string, qid: string): void {
  const app = getAppById(appId);
  if (!app) return;
  const all = [...app.prep.questions, ...app.prep.imported];
  const t = all.find((x) => x.id === qid);
  if (t) { t.done = !t.done; upsertApp(app); }
}
export function removeQuestion(appId: string, qid: string): void {
  const app = getAppById(appId);
  if (!app) return;
  app.prep.questions = app.prep.questions.filter((x) => x.id !== qid);
  app.prep.imported = app.prep.imported.filter((x) => x.id !== qid);
  upsertApp(app);
}

/* ==================== JD 关键词提取 ==================== */

const STOPWORDS = new Set([
  '的', '了', '和', '与', '及', '或', '在', '是', '我', '你', '他', '她', '它', '我们', '你们', '他们',
  '以及', '具有', '进行', '相关', '能力', '负责', '要求', '优先', '以上', '以下', '至少', '熟悉', '了解',
  '掌握', '使用', '基于', '通过', '能够', '良好', '一定', '经验', '工作', '团队', '沟通', '学习', '可以',
  '需要', '支持', '提供', '包括', '处理', '实现', '设计', '开发', '维护', '等', '岗位', '职责', '任职', '资格',
  'and', 'the', 'you', 'our', 'for', 'with', 'that', 'this', 'will', 'have', 'are'
]);

const TECH_DICT = [
  'Python', 'Java', 'C++', 'Go', 'Golang', 'Rust', 'JavaScript', 'TypeScript', 'SQL', 'Linux', 'MySQL',
  'Redis', 'Kafka', 'Docker', 'Kubernetes', 'Spring', 'React', 'Vue', 'Node', '机器学习', '深度学习',
  '数据结构', '算法', '高并发', '分布式', '微服务', '云计算', '大数据', '人工智能', 'NLP', 'CV',
  '推荐系统', '风控', '数据分析', '用户增长', '项目管理', '前端', '后端', '全栈', '客户端', '测试',
  '嵌入式', '产品经理', '运营', '商业化', 'AB实验', '数仓', '大模型', 'LLM', 'AIGC', 'TensorFlow', 'PyTorch'
];

/**
 * 从 JD 文本提取高频关键词（中英文混合）：
 *  - 英文：正则分词计数
 *  - 中文：优先命中技术词典（大小写不敏感），并对剩余中文做 2~4 字 n-gram 频率统计（剔除停用词）
 * 返回去重后的 Top 15。
 */
export function extractKeywords(text: string): string[] {
  if (!text || !text.trim()) return [];
  const lower = text.toLowerCase();
  const freq = new Map<string, number>();

  // 1) 英文 / 混合词
  const enMatches = lower.match(/[a-z][a-z0-9+#.]{1,}/g) || [];
  for (const w of enMatches) {
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // 2) 技术词典命中（中文 + 部分英文）
  for (const term of TECH_DICT) {
    const t = term.toLowerCase();
    let count = 0;
    let from = 0;
    while ((from = lower.indexOf(t, from)) !== -1) { count++; from += t.length; }
    if (count > 0) freq.set(term, (freq.get(term) || 0) + count * 2); // 词典加权
  }

  // 3) 中文 n-gram（2~4 字）
  const cnChars = text.replace(/[^\u4e00-\u9fa5]/g, ' ').split(/\s+/).join('');
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= cnChars.length; i++) {
      const gram = cnChars.slice(i, i + n);
      if (STOPWORDS.has(gram)) continue;
      // 仅当该 n-gram 至少含一个非停用字时计入
      freq.set(gram, (freq.get(gram) || 0) + 1);
    }
  }

  // 过滤过短/纯停用/单字高频噪音
  const filtered = [...freq.entries()].filter(([k, v]) => {
    if (k.length === 1) return false;
    if (v < 2 && !TECH_DICT.some((t) => t.toLowerCase() === k)) return false;
    return true;
  });

  return filtered
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k]) => k);
}

/* ==================== 面试准备清单（模块四） ==================== */

export function getDefaultInterviewChecklist(): IChecklistItem[] {
  const defaults = [
    '自我介绍（1 分钟精简版）',
    '自我介绍（3 分钟完整版）',
    '项目复盘：STAR 法（背景 / 任务 / 行动 / 结果）',
    '查公司财报 / 核心产品 / 最新业务动态',
    '查面试官背景（职位 / 可能的关注点）',
    '准备反向提问清单（3 个有深度的问题）',
    '技术盲区补漏（根据 JD 关键词）'
  ];
  return defaults.map((t) => ({ id: uid('ck'), text: t, done: false }));
}

export function setChecklist(appId: string, list: IChecklistItem[]): void {
  const app = getAppById(appId);
  if (!app) return;
  app.checklist = list;
  upsertApp(app);
}
export function toggleChecklist(appId: string, cid: string): void {
  const app = getAppById(appId);
  if (!app) return;
  const t = app.checklist.find((c) => c.id === cid);
  if (t) { t.done = !t.done; upsertApp(app); }
}

/* ==================== 评分 / 复盘 ==================== */

export function setRating(appId: string, rating: number): void {
  const app = getAppById(appId);
  if (!app) return;
  app.rating = rating;
  upsertApp(app);
}
export function setReview(appId: string, review: string): void {
  const app = getAppById(appId);
  if (!app) return;
  app.review = review;
  upsertApp(app);
}

/* ==================== 关联主待办（模块二：复用 Deadline 雷达 + 全局提醒调度器） ==================== */

/**
 * 该投递需要触发的提醒时间点（毫秒，升序去重）：
 *  · 用户手动开的「到期提醒」= remindAt（笔试前一天 09:00 / 前 3 小时）
 *  · 每一轮未结束的面试 → 开始前 30 分钟（临时改期/取消时，只要改面试时间点即可）
 */
export function reminderPlan(app: IApplication): number[] {
  const out: number[] = [];
  if (Array.isArray(app.remindAt)) {
    app.remindAt.forEach((t) => { if (typeof t === 'number' && t > 0) out.push(t); });
  }
  ensureInterviews(app).forEach((it) => {
    if (!it.done) out.push(it.at - 30 * 60000);
  });
  const now = Date.now();
  return Array.from(new Set(out.filter((t) => t > now - 3600000))).sort((a, b) => a - b);
}

/**
 * 截止日对应的默认提醒时点：前一天 09:00 + 前 3 小时（已过的自动丢弃）。
 * 抽出来是为了让「开提醒」和「改截止日」共用同一套算法 ——
 * 否则改了截止日、提醒时间还停在旧日期上，用户会看到「提前了 3 天提醒」这种错点。
 */
export function defaultRemindAt(due: number | null, now = Date.now()): number[] {
  if (!due) return [];
  const d = new Date(due);
  const dayBefore = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 9, 0, 0, 0).getTime();
  return [dayBefore, due - 3 * 3600000].filter((t) => t > now).sort((a, b) => a - b);
}

/** 把提醒计划转成主待办的 reminders 结构（供全局 reminder-scheduler 消费） */
function buildTodoReminders(app: IApplication): {
  id: string; at: number; repeat: 'none'; method: 'toast' | 'modal'; sent: boolean; subscribed: boolean;
}[] {
  return reminderPlan(app).map((at) => ({
    id: uid('rm'),
    at,
    repeat: 'none' as const,
    // 面试这类硬时间点用弹窗，避免被用户划走错过
    method: (app.status === 'interview' ? 'modal' : 'toast') as 'toast' | 'modal',
    sent: false,
    // 只有用户授权过订阅消息才标记 subscribed，否则全局调度器会静默跳过推送（本地 toast 仍兜底）
    subscribed: hasSubGranted()
  }));
}

/**
 * 把投递对象的截止日期同步成一个主待办，复用首页「最近 7 天」排序与提醒能力。
 * reminders 一并写入：这是「提醒」真正能被触发的唯一通道 ——
 * 全局 reminder-scheduler 每 30 秒扫的就是 todos.reminders，秋招模块自己不跑定时器。
 */
export async function syncToTodo(app: IApplication): Promise<string | null> {
  const content = `${app.company} · ${app.position}（${statusLabel(app.status)}）`;
  const priority = app.dueDate && app.dueDate - Date.now() < 3 * 86400000 ? 'high' : 'medium';
  const reminders = buildTodoReminders(app);
  const body = {
    content,
    priority,
    dueDate: app.dueDate,
    description: app.applyUrl ? `网申入口：${app.applyUrl}` : '',
    tags: ['秋招'],
    // 只有存在提醒时才传：update 传空数组会把用户在主待办里手动加的提醒一并清掉
    ...(reminders.length ? { reminders } : {})
  };
  try {
    if (app.linkedTodoId) {
      const res = await callFn('todos', { action: 'update', id: app.linkedTodoId, ...body });
      // ⚠️ update 成功只回 { success:true }，**不回 id**（云端与本地 mock 都是）。
      //    早期这里写的是 `res.success && res.id`，于是第二次同步必然拿到 null，
      //    页面报「云未就绪，已本地保存」—— 数据其实早已写进去了。以本地记录为准。
      if (res && res.success) return app.linkedTodoId;
      // 待办可能已被用户在主列表里删掉（mock 回「任务不存在」）→ 退回新增，
      // 否则这个投递此后再也同步不上，用户只会看到反复失败。
      console.warn('[recruit] 关联待办已不存在，改为新建：', res && res.error);
      app.linkedTodoId = null;
    }
    const added = await callFn('todos', { action: 'add', ...body });
    if (added && added.success && added.id) {
      app.linkedTodoId = added.id;
      upsertApp(app);
      return added.id;
    }
    return null;
  } catch (e) {
    console.warn('[recruit] 关联待办失败（云未就绪则用本地）', e);
    return null;
  }
}

/** 关闭提醒时清空关联待办上的 reminders，否则全局调度器仍会按时弹 */
export async function clearTodoReminders(app: IApplication): Promise<boolean> {
  if (!app.linkedTodoId) return true;
  try {
    const res = await callFn('todos', { action: 'update', id: app.linkedTodoId, reminders: [] });
    return !!(res && res.success);
  } catch (e) {
    console.warn('[recruit] 清除待办提醒失败', e);
    return false;
  }
}

/* ==================== 到期提醒（模块二：订阅消息授权 + 本地兜底） ==================== */

/** 用户是否已授权过订阅消息（授权后由全局调度器经云函数推送） */
export function hasSubGranted(): boolean {
  return get<boolean>('recruit_sub_granted', false) === true;
}

/**
 * 申请订阅消息授权。
 * 关键：wx.requestSubscribeMessage 成功只代表用户点了「允许」，微信不会告诉服务端，
 * 必须再调 grantSubscription 写 user_subs，否则云函数推送一律 NO_QUOTA（用户觉得「授权了却收不到」）。
 */
export async function requestRemind(app: IApplication): Promise<boolean> {
  if (!SUB_TMPL_ID) {
    toast('订阅模板未配置，仅本机提醒');
    return false;
  }
  const state = await requestSubscribe(SUB_TMPL_ID);
  if (state !== 'accept') {
    toast(state === 'ban' ? '订阅消息已被微信限制，仅本机提醒' : '已跳过微信通知，仅本机提醒');
    return false;
  }
  const ok = await grantSubscription(SUB_TMPL_ID);
  set('recruit_sub_granted', ok);
  toast(ok ? '已开启微信通知' : '已授权本机提醒（云端未就绪）');
  // 授权状态变了 → 重建 reminders，让 newly 授权的提醒带上 subscribed 标记
  if (app && app._id) await syncToTodo(app);
  return ok;
}

/**
 * 本地兜底提醒：扫描所有投递的提醒计划，把「刚到期」的挑出来。
 * 用途：云函数未部署 / 同步失败时，用户只要打开秋招任一页面就不会错过；
 * 已同步到待办的那些由全局调度器负责（覆盖用户停留在其它页面的情况）。
 */
export interface DueRecruitNotice {
  appId: string;
  company: string;
  title: string;
  at: number;
  method: 'toast' | 'modal';
}

const MISSED_GRACE_MS = 12 * 3600 * 1000;
const FIRED_MAX = 300;

export function collectDueRecruitNotices(now = Date.now()): DueRecruitNotice[] {
  const fired = get<string[]>(REMIND_FIRED_KEY, []);
  const firedSet = new Set(Array.isArray(fired) ? fired : []);
  const out: DueRecruitNotice[] = [];
  const added: string[] = [];

  loadApps().forEach((a) => {
    reminderPlan(a).forEach((at) => {
      const key = `${a._id}_${at}`;
      if (firedSet.has(key)) return;
      if (at > now) return;
      // 错过太久（如一周没打开）不再打扰，静默标记
      added.push(key);
      if (now - at > MISSED_GRACE_MS) return;
      const isInterview = ensureInterviews(a).some((it) => it.at - 30 * 60000 === at && !it.done);
      out.push({
        appId: a._id,
        company: a.company || '未命名公司',
        title: isInterview ? '面试 30 分钟后开始' : `${statusLabel(a.status)}截止提醒`,
        at,
        method: isInterview ? 'modal' : 'toast'
      });
    });
  });

  if (added.length) set(REMIND_FIRED_KEY, [...(Array.isArray(fired) ? fired : []), ...added].slice(-FIRED_MAX));
  return out;
}

/* ==================== 资源库（模块一：全局） ==================== */

/**
 * 读取资源库，并保证内置资源始终是最新版：
 *  - 首次使用：直接写入全部种子数据
 *  - 已使用过：按 _id 增量合并「本地缺失的内置资源」（老用户升级后也能看到新增资料）
 *  - 用户自己分享的（builtin:false）以及本地已有条目一律保留，不会被覆盖
 * 说明：seedResources() 只在需要时调用，避免每次读取都构造一遍全量数据。
 */
export function loadResources(): IResourceItem[] {
  let list = get<IResourceItem[]>(RES_KEY, []);
  if (!Array.isArray(list) || list.length === 0) {
    list = seedResources();
    saveResources(list);
    return list;
  }

  const existIds = new Set(list.map((r) => r._id));
  const missing = seedResources().filter((s) => !existIds.has(s._id));
  if (missing.length > 0) {
    list = [...missing, ...list];
    saveResources(list);
  }
  return list;
}
export function saveResources(list: IResourceItem[]): void {
  set(RES_KEY, list);
}
/** 用户匿名分享（待审核） */
export function shareResource(item: Omit<IResourceItem, '_id' | 'createTime' | 'status' | 'builtin'>): void {
  const list = loadResources();
  list.unshift({
    ...item,
    _id: uid('res'),
    status: 'pending',
    builtin: false,
    createTime: Date.now()
  });
  saveResources(list);
}
/**
 * 资源库检索：关键词 + 类型 + 岗位（三维筛选）
 * @param kw   关键词（匹配标题/正文/分类/标签/公司）
 * @param type 资源类型：qa / resume / experience，'all' 表示不限
 * @param cat  岗位分类（如 后端开发 / 数据分析 / 产品经理），'all' 或空表示不限
 */
/**
 * 资源检索：关键词 + 类型 + 岗位分类 + 面试轮次。
 * 内部已升级为「字段加权 + 相关性排序」：有搜索词时按相关度降序返回（模糊片段也能召回），
 * 无搜索词时保持原顺序。@param round 传 'all' 或不传表示不限制轮次。
 *
 * 注意：为兼容旧调用方（openings 等用 searchResources('', 'all') 取全量），
 * 这里返回的仍是 IResourceItem[]，排序只在 kw 非空时生效。
 */
export function searchResources(
  kw: string,
  type: ResourceType | 'all',
  cat?: string,
  round?: string
): IResourceItem[] {
  const list = loadResources();
  const q = (kw || '').trim().toLowerCase();
  const filtered = list.filter((r) => {
    if (r.status !== 'approved') return false;
    if (type !== 'all' && r.type !== type) return false;
    if (cat && cat !== 'all' && r.category !== cat) return false;
    if (round && round !== 'all' && r.round !== round) return false;
    if (!q) return true;
    // 兜底子串匹配（保证即便索引未命中也能在关键词完全出现在原文时召回）
    const hay = `${r.title} ${r.content} ${r.category} ${(r.tags || []).join(' ')} ${r.company || ''} ${r.round || ''}`.toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  if (!q) return filtered;
  // 有搜索词：在过滤结果上做相关性排序（rankItems 仅对命中项计分）
  return rankItems(filtered, q).map((x) => x.item);
}

/**
 * 结构化检索结果：在 searchResources 基础上额外返回每个条目的相关性分值（供 UI 展示「匹配度」）。
 */
export function searchResourcesRanked(
  kw: string,
  type: ResourceType | 'all',
  cat?: string,
  round?: string
): { item: IResourceItem; score: number }[] {
  const list = loadResources();
  const q = (kw || '').trim().toLowerCase();
  const filtered = list.filter((r) => {
    if (r.status !== 'approved') return false;
    if (type !== 'all' && r.type !== type) return false;
    if (cat && cat !== 'all' && r.category !== cat) return false;
    if (round && round !== 'all' && r.round !== round) return false;
    return true;
  });
  if (!q) return filtered.map((item) => ({ item, score: 0 }));
  return rankItems(filtered, q);
}

/**
 * 自动结构化汇总：对当前筛选条件下的资料，生成「高频主题 + 公司/轮次分布 + 核心结论 + 推荐阅读顺序」。
 * 这是「自动汇总」对外的统一入口；具体框架见 recruit-library.ts 的 summarize()。
 */
export function summarizeResources(
  kw: string,
  type: ResourceType | 'all',
  cat?: string,
  round?: string
): ReturnType<typeof summarize> {
  const items = searchResources(kw, type, cat, round);
  const scope: string[] = [];
  if (cat && cat !== 'all') scope.push(cat);
  if (round && round !== 'all') scope.push(round);
  if (type !== 'all') scope.push(type === 'qa' ? '面试题库' : type === 'resume' ? '简历模板' : '面经分享');
  if (kw && kw.trim()) scope.push(`“${kw.trim()}”`);
  return summarize(items, scope.length ? scope.join(' · ') : '全部资料');
}

/**
 * 自动归类 facet：返回当前筛选结果的「高频主题」列表（key/label/count），
 * 供 UI 生成一键筛选的标签云。
 */
export function libraryTopics(
  kw: string,
  type: ResourceType | 'all',
  cat?: string,
  round?: string
): { key: string; label: string; layer: string; count: number }[] {
  const items = searchResources(kw, type, cat, round);
  const m = new Map<string, { label: string; layer: string; count: number }>();
  for (const r of items) {
    for (const t of autoTopics(r).topics) {
      const cur = m.get(t.key) || { label: t.label, layer: t.layer, count: 0 };
      cur.count += 1;
      m.set(t.key, cur);
    }
  }
  return Array.from(m.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

/* ==================== 内置资源种子数据 ==================== */

/** 紧凑定义：只写差异字段，builtin / status / createTime 统一填充（减少主包体积） */
export interface SeedDef {
  id: string;
  type: ResourceType;
  /** 岗位分类，用于资源库岗位筛选 */
  cat: string;
  title: string;
  content: string;
  tags: string[];
  company?: string;
  /** 面试轮次：一面 / 二面 / Leader面 / HR面 / 通用 */
  round?: string;
  author?: string;
}

function buildSeed(defs: SeedDef[]): IResourceItem[] {
  const now = Date.now();
  return defs.map((d) => ({
    _id: d.id,
    type: d.type,
    category: d.cat,
    title: d.title,
    content: d.content,
    tags: d.tags,
    company: d.company,
    round: d.round,
    author: d.author,
    builtin: true,
    status: 'approved' as const,
    createTime: now
  }));
}

/** 岗位分类（与资源库页面岗位筛选保持一致） */
export const RESOURCE_CATEGORIES = [
  '后端开发', '数据分析', '产品经理', '前端开发', '算法工程师', '运营', '财务', 'Finance', '通用'
] as const;

/** 面试轮次（资源库第二轮筛选维度；'通用'/'General' 表示不区分轮次的方法论资料） */
export const RESOURCE_ROUNDS = ['一面', '二面', 'Leader面', 'HR面', '通用', 'Round 1', 'Round 2', 'Leader', 'HR', 'General'] as const;
export type ResourceRound = typeof RESOURCE_ROUNDS[number];

const SEED_DEFS: SeedDef[] = [
  /* ==================== 后端开发 · 面试题库 ==================== */
  {
    id: 'seed_be_qa_url', type: 'qa', cat: '后端开发', tags: ['计算机网络', '八股'],
    title: '后端高频：从 URL 输入到页面渲染，中间发生了什么？',
    content: '① DNS 解析（浏览器缓存→系统缓存→路由器→运营商→根/顶级/权威 DNS）→ ② TCP 三次握手 → ③ 发送 HTTP 请求 → ④ 服务器处理并返回响应 → ⑤ 浏览器解析渲染（DOM 树 / CSSOM 树 → Render 树 → 布局 → 绘制 → 合成）→ ⑥ 四次挥手断开。加分项：CDN 加速、HTTP/2 多路复用、强缓存与协商缓存、HTTPS 的 TLS 握手。'
  },
  {
    id: 'seed_be_qa_limit', type: 'qa', cat: '后端开发', tags: ['高并发', '分布式'],
    title: '高并发场景如何设计限流与降级？',
    content: '限流：固定窗口 / 滑动窗口 / 漏桶 / 令牌桶（Guava RateLimiter、Redis + Lua）。降级：熔断（Sentinel/Hystrix，按慢调用比例或错误率触发）、返回兜底数据、关闭非核心链路。配套：超时控制、重试退避、资源隔离（线程池/信号量）。答题要点：结合业务给具体阈值，如「单机 QPS 2000，令牌桶速率 1500/s，桶容量 200」。'
  },
  {
    id: 'seed_be_qa_tcp', type: 'qa', cat: '后端开发', tags: ['计算机网络', '八股'],
    title: 'TCP 三次握手与四次挥手（为什么不是两次？）',
    content: '三次握手：客户端 SYN → 服务端 SYN+ACK → 客户端 ACK。为什么不是两次：防止已失效的连接请求突然到达服务端，造成错误资源分配。四次挥手：FIN → ACK → FIN → ACK。为什么四次：TCP 是全双工，每个方向要单独关闭。TIME_WAIT 为什么要等 2MSL：保证最后一个 ACK 能到达对端，并让本次连接的残留报文在网络中消散。'
  },
  {
    id: 'seed_be_qa_https', type: 'qa', cat: '后端开发', tags: ['计算机网络', '安全'],
    title: 'HTTPS 的 TLS 握手过程是怎样的？',
    content: '客户端发 ClientHello（支持的加密套件、随机数）→ 服务端回 ServerHello（选定套件、随机数）+ 数字证书 → 客户端校验证书（CA 信任链、有效期、域名是否匹配）→ 用证书公钥加密 Premaster Secret 发送 → 双方用三个随机数生成对称会话密钥 → 后续用对称加密通信。核心：非对称加密用于安全交换密钥，对称加密用于高效传输数据。'
  },
  {
    id: 'seed_be_qa_thread', type: 'qa', cat: '后端开发', tags: ['操作系统'],
    title: '进程、线程、协程的区别？',
    content: '进程是资源分配的最小单位，线程是 CPU 调度的最小单位；线程共享进程的地址空间（堆、文件描述符），但各有自己的栈和寄存器，切换成本远低于进程。协程是用户态轻量级线程，由程序自身调度，切换只需保存少量寄存器、无需陷入内核，适合高并发 IO 密集场景（Go goroutine、Kotlin 协程）。'
  },
  {
    id: 'seed_be_qa_deadlock', type: 'qa', cat: '后端开发', tags: ['操作系统', '并发'],
    title: '死锁的必要条件与如何避免？',
    content: '四个必要条件：互斥、请求与保持、不可抢占、循环等待。避免思路：破坏任一条件即可——「按固定顺序获取锁」破循环等待；「一次性申请所有资源」破请求与保持；用带超时的 tryLock 主动释放。排查：jstack 抓线程栈，看 BLOCKED 状态的线程与锁等待链。'
  },
  {
    id: 'seed_be_qa_idx', type: 'qa', cat: '后端开发', tags: ['MySQL', '数据库'],
    title: 'MySQL 为什么用 B+ 树？哪些场景索引会失效？',
    content: '为什么 B+ 树：非叶子节点只存索引不存数据，单页能放更多 key，树更矮、磁盘 IO 更少；叶子节点用链表相连，天然支持范围查询；哈希索引只适合等值查询，B 树范围查询要中序遍历。索引失效：违反最左前缀、对列做函数或运算、隐式类型转换、like 以 % 开头、or 连接非索引列、优化器判断全表扫描更快。'
  },
  {
    id: 'seed_be_qa_tx', type: 'qa', cat: '后端开发', tags: ['MySQL', '事务'],
    title: 'MySQL 事务 ACID、隔离级别与 MVCC',
    content: 'ACID：原子性靠 undo log，持久性靠 redo log，隔离性靠 MVCC + 锁，一致性是最终目标。隔离级别：读未提交 → 读已提交 → 可重复读（MySQL 默认）→ 串行化，依次解决脏读、不可重复读、幻读。MVCC：通过 undo log 版本链 + ReadView 实现快照读，使读写不互斥；当前读（select for update）仍需加锁。'
  },
  {
    id: 'seed_be_qa_slow', type: 'qa', cat: '后端开发', tags: ['MySQL', '性能优化'],
    title: 'MySQL 慢查询如何排查与优化？',
    content: '排查：开启慢查询日志 → EXPLAIN 看 type（至少到 range，最好 ref/const）、key、rows、Extra（出现 Using filesort 或 Using temporary 需优化）→ 判断是否走索引、回表是否过多。优化：联合索引遵循最左前缀、用覆盖索引避免回表、避免 select *、深分页用 id > last_id 代替 offset、必要时冗余字段或读写分离。'
  },
  {
    id: 'seed_be_qa_cache', type: 'qa', cat: '后端开发', tags: ['Redis', '缓存'],
    title: '缓存穿透、击穿、雪崩分别是什么，怎么解决？',
    content: '穿透（查询根本不存在的数据）：布隆过滤器拦截，或缓存空值并设置较短过期。击穿（单个热点 key 过期瞬间大量请求打到数据库）：互斥锁/单飞重建，或热点 key 设为不过期。雪崩（大批 key 同时过期）：过期时间加随机抖动、多级缓存、限流降级兜底。'
  },
  {
    id: 'seed_be_qa_redis', type: 'qa', cat: '后端开发', tags: ['Redis', '分布式锁'],
    title: 'Redis 持久化、分布式锁与缓存一致性',
    content: '持久化：RDB（快照，恢复快但可能丢数据）、AOF（追加写命令，更安全但文件大），生产常用混合持久化。分布式锁：set key value NX PX 原子加锁（value 用唯一标识），释放必须用 Lua 脚本先比对 value 再删除，防止误删别人的锁；业务未执行完用看门狗续期（Redisson）。缓存与数据库一致性：推荐「先更新数据库，再删除缓存」，配合延迟双删或订阅 binlog 补偿。'
  },
  {
    id: 'seed_be_qa_mq', type: 'qa', cat: '后端开发', tags: ['消息队列', 'Kafka'],
    title: '消息队列如何保证不丢、不重复、有序？',
    content: '不丢：生产者用 confirm/事务、Broker 持久化 + 多副本、消费者手动 ack。不重复：至少一次语义下重复不可避免，消费端必须做幂等（唯一键 / 状态机 / 去重表）。有序：Kafka 同 key 进同一 partition 且消费者单线程处理，保证分区内有序；全局有序只能单分区，会牺牲吞吐。'
  },
  {
    id: 'seed_be_qa_kafka', type: 'qa', cat: '后端开发', tags: ['Kafka', '消息队列'],
    title: 'Kafka 为什么吞吐量这么高？',
    content: '顺序磁盘写（追加日志，远快于随机写）、零拷贝（sendfile 减少内核态与用户态之间的拷贝和上下文切换）、页缓存（直接用操作系统 page cache 而非 JVM 堆）、批量压缩发送、分区并行消费。'
  },
  {
    id: 'seed_be_qa_dtx', type: 'qa', cat: '后端开发', tags: ['分布式', '事务'],
    title: '分布式事务有哪些方案，怎么选？',
    content: '2PC：强一致，但同步阻塞、协调者单点。TCC：Try/Confirm/Cancel，业务侵入大、性能好。本地消息表 / 事务消息（RocketMQ 半消息）：最终一致，最常用。最大努力通知 + 对账补偿。选型：真正需要强一致的场景很少，多数业务用「最终一致 + 对账补偿」即可。Seata AT 模式基于 undo log 自动补偿。'
  },
  {
    id: 'seed_be_qa_cap', type: 'qa', cat: '后端开发', tags: ['分布式', '八股'],
    title: 'CAP 理论、BASE 与分布式 ID 生成',
    content: 'CAP：一致性、可用性、分区容错性不可兼得；网络分区客观存在，所以实际是在 CP 与 AP 之间选（ZooKeeper 偏 CP，Eureka 偏 AP）。BASE 是对 CAP 的补充：基本可用、软状态、最终一致。分布式 ID：UUID（无序、索引性能差）、数据库号段、雪花算法（时间戳 + 机器位 + 序列号，趋势递增）、Redis INCR。'
  },
  {
    id: 'seed_be_qa_hash', type: 'qa', cat: '后端开发', tags: ['分布式', '负载均衡'],
    title: '一致性哈希解决了什么问题？负载均衡有哪些算法？',
    content: '一致性哈希：把节点和数据都映射到 2^32 的环形空间，数据顺时针找最近节点；节点下线只影响相邻区间，避免全量数据重分布；引入虚拟节点解决数据倾斜。负载均衡算法：轮询、加权轮询、随机、最小连接数、一致性哈希（适合有状态或缓存场景）。'
  },
  {
    id: 'seed_be_qa_seckill', type: 'qa', cat: '后端开发', tags: ['系统设计', '高并发'],
    title: '系统设计：如何设计一个秒杀系统？',
    content: '分层拦截：前端限流（按钮置灰、验证码、防重复提交）→ 网关限流（令牌桶、黑名单）→ 库存预热到 Redis，用 Lua 脚本原子预扣减 → 消息队列异步下单削峰 → 数据库最终扣减，并用唯一索引防超卖。核心思路：读多写少用缓存、写操作异步化串行化、热点数据打散、静态资源走 CDN。'
  },
  {
    id: 'seed_be_qa_design', type: 'qa', cat: '后端开发', tags: ['系统设计'],
    title: '系统设计：短链服务与 Feed 流怎么设计？',
    content: '短链：发号器（雪花 ID / 号段）生成唯一 ID → base62 编码成短码 → 存长短期映射（Redis 加速 + DB 持久化）→ 访问时 301/302 跳转（302 便于统计与灵活变更）。Feed 流：推模式（写扩散，粉丝收件箱，读快但大 V 成本极高）、拉模式（读扩散，拉关注列表聚合，写简单但读慢）；大厂常用推拉结合——大 V 用拉，普通用户用推。'
  },
  {
    id: 'seed_be_qa_jvm', type: 'qa', cat: '后端开发', tags: ['JVM', 'Java'],
    title: 'JVM 内存结构、GC 与 OOM 排查',
    content: '内存区域：堆（对象，分新生代 Eden/S0/S1 与老年代）、元空间（类信息）、虚拟机栈、本地方法栈、程序计数器。GC：对象优先在 Eden 分配，Minor GC 后存活对象进 Survivor，年龄达阈值（默认 15）晋升老年代；老年代用 CMS/G1。存活判定：可达性分析（GC Roots）。OOM 排查：先区分堆溢出（内存泄漏、大对象）还是元空间/栈溢出，用 jmap 导堆快照再用 MAT 分析。'
  },
  {
    id: 'seed_be_qa_juc', type: 'qa', cat: '后端开发', tags: ['Java', '并发'],
    title: 'Java 并发：synchronized / volatile / CAS / AQS / 线程池',
    content: 'synchronized 是 JVM 关键字，可重入、自动释放，JDK 1.6 后引入偏向锁与轻量级锁优化。volatile 保证可见性与禁止指令重排，但不保证原子性。CAS 是乐观锁（AtomicInteger），存在 ABA 问题（用 AtomicStampedReference 版本号解决）。AQS 是 ReentrantLock/Semaphore/CountDownLatch 的底层（state + CLH 队列）。线程池核心参数：核心线程数、最大线程数、工作队列、拒绝策略；务必用有界队列防止 OOM。'
  },
  {
    id: 'seed_be_qa_spring', type: 'qa', cat: '后端开发', tags: ['Spring', '框架'],
    title: 'Spring IOC / AOP、循环依赖与事务失效场景',
    content: 'IOC：控制反转，把对象创建与依赖交给容器，通过依赖注入（构造器/Setter）解耦。AOP：面向切面，基于动态代理（JDK 动态代理用于接口，CGLIB 用于类），常用于日志、事务、鉴权。循环依赖：三级缓存可解决单例 setter 注入的循环依赖，但构造器注入的循环依赖无法解决。事务失效常见原因：方法非 public、同类内部调用（没走代理）、异常被 catch 吞掉、数据库引擎不支持事务、传播行为配错。'
  },
  {
    id: 'seed_be_qa_linux', type: 'qa', cat: '后端开发', tags: ['Linux', '排查'],
    title: '线上服务 CPU 飙高 / 内存异常怎么排查？',
    content: 'CPU 飙高：top 找进程 → top -Hp 找线程 → 线程 ID 转十六进制 → jstack 查线程栈（常见于死循环、频繁 GC）。内存：free、jstat 看 GC 情况，jmap 导出堆快照。磁盘：df / du 找大文件，iostat 看 IO 等待。网络：netstat/ss 看连接数与状态分布（TIME_WAIT 是否过多），必要时 tcpdump 抓包。通用原则：先看监控和日志定位范围，再下沉到具体线程或请求。'
  },
  {
    id: 'seed_be_qa_docker', type: 'qa', cat: '后端开发', tags: ['Docker', 'K8s'],
    title: 'Docker 与 Kubernetes 基础（面试能答到什么程度）',
    content: 'Docker：镜像是分层的只读模板，容器是镜像的运行实例，用 namespace 做隔离、cgroups 做资源限制，Dockerfile 用于构建镜像。K8s：Pod 是最小调度单元，Deployment 管理副本与滚动更新，Service 提供稳定访问入口，ConfigMap/Secret 管理配置，HPA 自动扩缩容。面试重点是能讲清「为什么容器化」——环境一致、快速扩缩、资源隔离。'
  },
  {
    id: 'seed_be_qa_code', type: 'qa', cat: '后端开发', tags: ['手撕代码', '算法'],
    title: '手撕：LRU 缓存与 TopK',
    content: 'LRU：哈希表 + 双向链表（Java 可直接用 LinkedHashMap 并设 accessOrder=true），get 后把节点移到头部，容量满时删尾部，要求 get/put 都是 O(1)。TopK：维护一个大小为 K 的小顶堆，遍历数据时比堆顶大就替换，复杂度 O(n log K)；海量数据场景用分治 + 堆，或 MapReduce 多路归并。'
  },
  {
    id: 'seed_be_qa_idem', type: 'qa', cat: '后端开发', tags: ['接口设计', '幂等'],
    title: '接口幂等性怎么设计？',
    content: '常见方案：数据库唯一索引/主键防重复插入（最省事）；乐观锁（version 字段或状态机，如 status=0 才允许改为 1）；分布式锁让同一请求串行化；Token 机制（先申请 token，提交时校验并删除，防重复提交）；防重表。选型：纯写入用唯一键，更新类用状态机 + 乐观锁。'
  },

  /* ==================== 后端开发 · 简历模板 ==================== */
  {
    id: 'seed_be_cv_star', type: 'resume', cat: '后端开发', tags: ['简历', '技术'],
    title: '后端岗简历模板（STAR 项目写法）',
    content: '结构：基本信息 → 教育背景 → 技术栈（按熟练度分级，别轻易写「精通」）→ 实习/项目（3 个以内，每个用 STAR + 量化结果）→ 竞赛/开源/博客。项目描述避免「参与开发」「负责某模块」，要写清「我负责 X，用 Y 方案解决 Z 问题，带来 N% 提升」。技术栈与目标 JD 对齐，没把握的技术不要写，避免被追问时翻车。'
  },
  {
    id: 'seed_be_cv_rewrite', type: 'resume', cat: '后端开发', tags: ['简历', '项目'],
    title: '项目描述改写：从「弱表达」到「强表达」',
    content: '弱：「参与电商后台开发，负责订单模块，使用 Spring Boot 和 MySQL。」强：「主导订单服务重构，针对大促下单超时问题，引入本地消息表保证库存扣减与订单创建的最终一致，并将热点商品库存预热至 Redis 用 Lua 原子扣减，使下单 P99 从 800ms 降至 180ms，大促期间零超卖。」要点：有背景、有难点、有你的具体动作、有量化结果。'
  },
  {
    id: 'seed_be_cv_nointern', type: 'resume', cat: '后端开发', tags: ['简历', '应届'],
    title: '没有实习 / 亮眼项目，简历怎么补？',
    content: '① 把课程大作业按工程标准重构（加并发、加缓存、加单测、补一份压测报告）；② 参与开源，哪怕只是修文档、提 issue、做小功能；③ 写技术博客或复盘沉淀，附链接；④ 刷算法，ACM/LeetCode 名次是硬通货；⑤ 用 STAR 把小事讲透——重点是你能否说清「为什么这么做、权衡了什么、结果如何」，而不是项目本身多大。'
  },

  /* ==================== 后端开发 · 面经 ==================== */
  {
    id: 'seed_be_exp_1', type: 'experience', cat: '后端开发', company: '互联网大厂', author: '匿名用户', tags: ['后端', '一面'],
    title: '某大厂后端一面面经（45 分钟）',
    content: '流程：1 道算法（链表反转变体）+ 项目深挖（你怎么保证接口幂等？为什么选 Kafka 而不是 RocketMQ？）+ 一道系统设计（短链服务）。建议：算法刷到 hot100 中等难度，项目里每个技术选型都要能答出「为什么选它、为什么不选别的」。'
  },
  {
    id: 'seed_be_exp_2', type: 'experience', cat: '后端开发', company: '互联网大厂', author: '匿名用户', tags: ['后端', '二面'],
    title: '后端二面面经（偏深度与场景题）',
    content: '二面更看重深度：项目难点追问很细（你怎么定位到是慢 SQL 而不是网络问题？explain 看到了什么？）、场景题（设计一个支持千万用户的点赞系统）、手撕（生产者消费者 / 手写阻塞队列）。建议：准备 2 个能讲满 10 分钟的深度项目点，回答时主动把话题引导到自己熟悉的领域。'
  },
  {
    id: 'seed_be_exp_3', type: 'experience', cat: '后端开发', company: '互联网大厂', author: '匿名用户', tags: ['后端', '主管面'],
    title: '后端主管面 / 三面面经',
    content: '主管面看潜力与匹配度：为什么想来、职业规划、遇到的最大挫折、如何与同事协作、对团队业务的了解。技术问得少，但会追问「你说的这个方案，如果流量翻 10 倍还成立吗」。建议：提前了解团队业务与产品，准备 3 个有深度的反向提问，表现出你对这个方向的真实兴趣。'
  },

  /* ==================== 数据分析 · 面试题库 ==================== */
  {
    id: 'seed_da_qa_sql', type: 'qa', cat: '数据分析', tags: ['SQL', '窗口函数'],
    title: 'SQL 窗口函数：row_number / rank / lag 怎么用？',
    content: 'row_number() 组内连续排序（1,2,3）；rank() 并列且跳号（1,1,3）；dense_rank() 并列不跳号（1,1,2）。典型应用：每组取 TopN（row_number() over(partition by 分组列 order by 排序列)，外层取 rn<=N）；计算环比同比（lag/lead 取上一行同列值）；累计求和（sum() over(order by 日期 rows between unbounded preceding and current row）。'
  },
  {
    id: 'seed_da_qa_keep', type: 'qa', cat: '数据分析', tags: ['指标', '留存'],
    title: '留存率与漏斗分析怎么算？',
    content: '留存：第 N 日留存 = 注册后第 N 日仍活跃的用户数 / 当日新增用户数。注意分母是「当日新增」，分子必须与分母是同一批用户。漏斗：各环节转化率 = 通过该环节人数 / 进入上一环节人数；既要看整体转化，也要找单步流失最大的环节。常考 SQL：用自关联（按日期差 join）或窗口函数计算每日留存矩阵。'
  },
  {
    id: 'seed_da_qa_ab', type: 'qa', cat: '数据分析', tags: ['AB实验', '统计'],
    title: 'AB 实验的完整流程是什么？',
    content: '① 明确假设与指标（一个核心指标 + 若干护栏指标）；② 估算样本量（依据基线转化率、最小可检出提升 MDE、显著性水平 α、统计功效 power）；③ 随机分流（按用户维度，保证独立性与跨设备一致性）；④ 跑够时间（至少一个完整周，覆盖周末效应）；⑤ 显著性检验（双样本 Z 检验 / t 检验）；⑥ 出结论并推动决策。'
  },
  {
    id: 'seed_da_qa_abtrap', type: 'qa', cat: '数据分析', tags: ['AB实验', '陷阱'],
    title: 'AB 实验有哪些常见坑？',
    content: '① 样本量不足或中途反复偷看（peeking）导致假阳性；② 分流不均或维度错误（应按用户而非按行为分流）；③ 辛普森悖论——整体上涨但各子群体都下降，必须分层看；④ 新奇效应（老用户短期好奇，要看长期效果与新用户表现）；⑤ 多个实验同时跑相互干扰；⑥ 只看核心指标忽略护栏指标（点击涨了但留存跌了）。'
  },
  {
    id: 'seed_da_qa_stat', type: 'qa', cat: '数据分析', tags: ['统计', '假设检验'],
    title: '假设检验：p 值、置信区间、两类错误',
    content: 'p 值：在原假设成立的前提下，观察到当前结果（或更极端结果）的概率；p < α（通常取 0.05）则拒绝原假设。置信区间：重复抽样下有 95% 的区间会包含真值；若两组指标的置信区间不重叠，通常认为差异显著。两类错误：第一类（误报，概率 α）与第二类（漏报，概率 β），统计功效 = 1 - β，通常需要 ≥ 0.8。'
  },
  {
    id: 'seed_da_qa_causal', type: 'qa', cat: '数据分析', tags: ['因果推断', '统计'],
    title: '相关不等于因果，那怎么判断因果？',
    content: '经典的混淆变量例子：冰淇淋销量与溺水率正相关，共同原因是气温。判断因果的金标准是随机实验（AB 测试）。无法做实验时用因果推断方法：倾向得分匹配 PSM、双重差分 DID、断点回归 RDD、工具变量。分析时始终警惕混淆变量与选择偏差（如「领券用户客单价更高」可能只是高意愿用户更爱领券）。'
  },
  {
    id: 'seed_da_qa_anomaly', type: 'qa', cat: '数据分析', tags: ['业务分析', '异动'],
    title: '高频业务题：DAU 突然下降 20%，你怎么分析？',
    content: '① 先确认数据本身没问题（埋点是否上线/回传异常、口径是否变化、ETL 是否延迟）；② 维度下钻定位（按渠道、地域、版本、机型、新老用户逐层拆，看是哪一块跌）；③ 漏斗拆解（是拉新变少，还是留存变差）；④ 关联外部因素（节假日、竞品动作、发版、活动结束、政策）；⑤ 给出定量结论与可执行建议。这题考察的是结构化思维与排查顺序。'
  },
  {
    id: 'seed_da_qa_dw', type: 'qa', cat: '数据分析', tags: ['数仓', '建模'],
    title: '数仓分层与维度建模',
    content: '分层：ODS（原始数据）→ DWD（明细层，清洗脱敏、维度退化）→ DWS（汇总层，按主题建宽表）→ ADS（应用层，报表与接口）。建模：维度建模 = 事实表（业务行为记录）+ 维度表（描述属性），星型模型；缓慢变化维用拉链表处理。分层的价值：解耦、复用、减少重复计算、统一口径。'
  },
  {
    id: 'seed_da_qa_skew', type: 'qa', cat: '数据分析', tags: ['SQL', '大数据'],
    title: '数据倾斜是什么，怎么解决？',
    content: '现象：某个 reduce 任务特别慢或直接 OOM。原因：某个 key 的数据量远大于其他 key（常见于大量 null 或默认值）。解决：① 过滤异常值或给 null 加随机前缀打散；② 两阶段聚合（先加盐局部聚合，再去盐全局聚合）；③ 大表 join 小表改用 map join（广播小表）；④ 开启 skew join 优化；⑤ 适当调大并行度。'
  },
  {
    id: 'seed_da_qa_metric', type: 'qa', cat: '数据分析', tags: ['指标体系'],
    title: '如何搭建一套指标体系？（OSM / UJM / AARRR）',
    content: 'OSM：目标 Objective → 策略 Strategy → 度量 Metric，保证指标服务于业务目标。UJM：用户旅程地图，按「认知-考虑-购买-使用-留存-推荐」拆解各环节指标。AARRR：获取、激活、留存、收入、推荐。北极星指标：选一个最能代表产品长期价值的指标（如「日活用户的有效互动次数」），其余指标为其拆解。'
  },
  {
    id: 'seed_da_qa_profile', type: 'qa', cat: '数据分析', tags: ['用户画像', '标签'],
    title: '用户画像与标签体系怎么建？',
    content: '标签分层：基础属性（性别/年龄/地域）、行为属性（活跃度/偏好类目/消费频次）、业务属性（付费等级/生命周期阶段）。流程：数据源接入 → 标签规则定义（或用模型预测）→ 离线/实时计算 → 存储（ES/ClickHouse/Redis）→ 支撑精准营销、推荐、分层运营。关键：每个标签都要有明确口径、更新频率与负责人，否则很快变成垃圾场。'
  },
  {
    id: 'seed_da_qa_fermi', type: 'qa', cat: '数据分析', tags: ['估算题', 'case'],
    title: '费米估算题怎么答？（例：北京有多少加油站）',
    content: '思路：把大问题拆成可估算的小问题，明确假设，逐层相乘，量级正确即可。示例：北京常住人口约 2000 万 → 汽车保有量约 600 万 → 单车每周加油约 1 次 → 单站每天约服务 500 辆 → 每天需 600万/7 ≈ 86 万次 → 86万/500 ≈ 1700 座。这题考察结构化拆解与常识，不是要精确答案，答题时大声说出你的假设。'
  },
  {
    id: 'seed_da_qa_sqlcase', type: 'qa', cat: '数据分析', tags: ['SQL', '真题'],
    title: 'SQL 实战：连续登录 N 天 / TopN / 去重',
    content: '连续登录 N 天：先按用户 + 日期去重，用 row_number 按日期排序得到 rn，再用「登录日期 - rn 天」得到分组键，同一个键说明日期连续，最后按用户 + 分组键计数取 ≥ N。TopN：row_number() over(partition by 分组列 order by 排序列) 取 rn <= N。去重：group by 或 row_number 取 rn=1。行转列：case when + sum，或用 pivot。'
  },
  {
    id: 'seed_da_qa_py', type: 'qa', cat: '数据分析', tags: ['Python', 'pandas'],
    title: 'Python 数据处理（pandas）常考什么？',
    content: '高频操作：读取数据（read_csv / read_sql）、快速查看（head / info / describe）、清洗（dropna、fillna、drop_duplicates、astype）、分组聚合（groupby + agg，可同时算多个统计量）、表连接（merge，注意 how 参数与连接键是否重复）、透视表（pivot_table）、时间序列（resample、rolling 计算移动平均）。面试常现场给一份数据，让你写「各城市 GMV Top5」这类聚合。'
  },
  {
    id: 'seed_da_qa_case', type: 'qa', cat: '数据分析', tags: ['业务case'],
    title: '业务 case：如何评估是否上线一个新功能？',
    content: '框架：① 明确目标与成功标准（提升哪个指标）；② 拆解指标（如 GMV = 流量 × 转化率 × 客单价）；③ 定位瓶颈（哪个环节提升空间最大、成本最低）；④ 提出假设与具体方案；⑤ 设计验证方式（优先 AB 实验，不能实验则用前后对比 + 对照组）；⑥ 评估收益与成本，给出上线建议与复盘指标。'
  },

  /* ==================== 数据分析 · 简历与面经 ==================== */
  {
    id: 'seed_da_cv', type: 'resume', cat: '数据分析', tags: ['简历', '数据'],
    title: '数据分析岗简历模板',
    content: '结构：教育背景（数学/统计/计算机专业加分）→ 技能（SQL 熟练并注明会写窗口函数、Python/R、BI 工具、统计基础）→ 项目/实习（2-3 个，突出「从数据到结论再到业务动作」）→ 竞赛。写法：不要只说「做了数据分析」，要写「搭建了 X 指标体系，定位到 Y 环节流失最高，推动改版后次日留存提升 Z%」。'
  },
  {
    id: 'seed_da_cv_proj', type: 'resume', cat: '数据分析', tags: ['简历', '项目'],
    title: '数据分析项目怎么写才有说服力？',
    content: '好项目的三要素：① 有明确的业务问题（而不是纯练手的公开数据集）；② 有完整的分析过程（口径怎么定、维度怎么拆、假设如何验证）；③ 有结论与落地（推动了什么改动、效果如何）。可以包装：Kaggle 比赛（讲清特征工程与模型选型理由）、课程项目（加上 AB 实验设计）、实习中做过的一次专项分析。'
  },
  {
    id: 'seed_da_exp_1', type: 'experience', cat: '数据分析', company: '互联网大厂', author: '匿名用户', tags: ['数据分析', '面经'],
    title: '数据分析岗面经（三轮结构）',
    content: '一面：SQL 手写 + 统计基础（当场写求留存的 SQL、解释 p 值）。二面：业务 case（DAU 下降怎么分析、如何设计一个实验验证新策略）。三面：主管面（职业规划、业务理解、跨部门协作）。建议：准备 1 个能讲透的完整分析案例，练熟窗口函数与 group by，把统计概念能用大白话讲清楚。'
  },

  /* ==================== 产品经理 · 面试题库 ==================== */
  {
    id: 'seed_pm_qa_metric', type: 'qa', cat: '产品经理', tags: ['产品', '数据'],
    title: '如何衡量一个功能的成败？（产品岗必考）',
    content: '先定义北极星指标并拆解（AARRR / OSM）；上线前就确定核心指标与护栏指标，用 AB 实验验证并看显著性；上线后关注长期留存与自然增长，不能只看短期 DAU；再结合定性反馈（用户访谈、客诉）做复盘。切忌只回答「看 DAU」。'
  },
  {
    id: 'seed_pm_qa_need', type: 'qa', cat: '产品经理', tags: ['需求分析'],
    title: '如何判断需求的真伪？KANO 模型怎么用？',
    content: '判断真伪：① 问「用户在什么场景下、为什么需要」，而不是「你要不要这个功能」；② 看真实行为数据，而不是用户的口头回答；③ 用 MVP 小成本验证。KANO 模型：基本型（没有会不满）、期望型（越多越好）、兴奋型（超出预期）、无差异型、反向型。优先级通常：基本型 > 期望型 > 兴奋型。'
  },
  {
    id: 'seed_pm_qa_comp', type: 'qa', cat: '产品经理', tags: ['竞品分析'],
    title: '竞品分析怎么做才不是功能罗列？',
    content: '框架：① 明确分析目标（找机会点，还是验证方案）；② 选对竞品（直接竞品/间接竞品/替代品）；③ 多维度对比（目标用户、核心场景、功能矩阵、体验流程、商业模式、数据表现）；④ 亲自体验拆解（完整走一遍核心路径，记录卡点）；⑤ 输出结论：我们的差异化机会在哪、优先级建议。核心是「结论驱动」，不是堆信息。'
  },
  {
    id: 'seed_pm_qa_research', type: 'qa', cat: '产品经理', tags: ['用户调研'],
    title: '用户调研有哪些方法，怎么避免踩坑？',
    content: '方法：深度访谈（适合探索需求，样本小、能问出动机）、问卷（适合验证假设，样本大，注意不要出引导性问题）、可用性测试（看用户实际操作而非听他说）、数据分析（看真实行为）、反馈挖掘（应用商店评论、客服记录）。要点：多问「过去的实际行为」，少问「未来的意愿」，样本要有代表性。'
  },
  {
    id: 'seed_pm_qa_prio', type: 'qa', cat: '产品经理', tags: ['优先级'],
    title: '需求优先级怎么排？（RICE / KANO / MoSCoW）',
    content: 'RICE：Reach（覆盖人数）× Impact（影响力）× Confidence（信心）/ Effort（投入成本），按得分排序。KANO 按需求类型分层排序。MoSCoW：Must / Should / Could / Won’t（本期不做）。答题要点：先给出判断标准（业务目标 + 用户价值 + 投入产出比），再用某个框架给结论，最后说明会用数据复盘来调整。'
  },
  {
    id: 'seed_pm_qa_zero', type: 'qa', cat: '产品经理', tags: ['产品设计'],
    title: '从 0 到 1 设计一款产品，你会怎么做？',
    content: '框架：① 明确目标用户与核心场景（谁、在什么情况下、遇到什么问题）；② 验证需求（用户访谈 + 数据 + MVP）；③ 定义核心价值与关键路径（MVP 只做通一个最重要的闭环）；④ 设计关键流程与衡量指标；⑤ 上线后用数据持续迭代。忌讳一上来就背功能清单，先讲清楚为谁解决什么问题。'
  },
  {
    id: 'seed_pm_qa_bc', type: 'qa', cat: '产品经理', tags: ['B端', 'C端'],
    title: 'B 端产品与 C 端产品的差异？',
    content: 'C 端：用户量大、体验与情感化设计重要、决策快、靠增长与留存驱动、关注漏斗与留存。B 端：客户是企业，决策链长（使用者、采购、老板诉求不同），强调效率与稳定性，要求可配置、可对接、重视权限/审计/数据安全，客单价高，交付与服务占比重。做 B 端要能抽象出通用能力与定制需求的边界。'
  },
  {
    id: 'seed_pm_qa_money', type: 'qa', cat: '产品经理', tags: ['商业化'],
    title: '产品的商业化 / 变现模式有哪些？',
    content: '常见模式：广告（流量变现，看 eCPM）、增值服务/会员（看付费率与 ARPPU）、电商与佣金（看 GMV 与 take rate）、SaaS 订阅（看续费率与 LTV）、交易抽成。分析思路：先明确为谁创造了什么价值，再选匹配的变现方式，并注意变现不能伤害核心体验（用留存、口碑作为护栏指标）。'
  },
  {
    id: 'seed_pm_qa_prd', type: 'qa', cat: '产品经理', tags: ['PRD'],
    title: '一份合格的 PRD 应该包含什么？',
    content: '要素：背景与目标（为什么做、用什么指标衡量）、范围与优先级、用户故事与使用场景、功能详述（流程图、状态机、边界与异常分支、文案）、数据埋点需求、非功能需求（性能/兼容/安全）、上线计划与灰度方案。好 PRD 的标准：研发看完能直接评估工作量，边界条件没有遗漏。'
  },
  {
    id: 'seed_pm_qa_conflict', type: 'qa', cat: '产品经理', tags: ['协作', '行为面'],
    title: '与研发/设计意见冲突时怎么处理？',
    content: '原则：回到共同目标（用户价值与业务目标），用数据和用户证据说话，而不是用职位压人。做法：先听清对方的真实顾虑（研发可能担心工期与技术债，设计可能担心体验一致性），把分歧拆小，提出折中方案（分阶段上线、先做 MVP 验证），必要时升级决策并明确责任人与时间节点。'
  },
  {
    id: 'seed_pm_qa_why', type: 'qa', cat: '产品经理', tags: ['行为面'],
    title: '你为什么想做产品经理？',
    content: '避免空泛的「我喜欢做产品」。好的回答：讲清你的能力匹配（对用户的同理心 + 逻辑与数据能力 + 推动落地的能力），并用经历佐证（做过什么、发现了什么问题、推动了什么改动、结果如何），再说明你想在哪个领域深耕，以及为什么是这个公司/团队。让面试官看到「你是想清楚了才来的」。'
  },
  {
    id: 'seed_pm_qa_opt', type: 'qa', cat: '产品经理', tags: ['产品sense'],
    title: '挑一个你常用的产品，说说怎么优化？',
    content: '结构：① 选你真正深度使用、且有明确用户群的产品；② 说明目标用户与核心场景；③ 指出一个具体痛点（用数据或真实体验支撑，如「新用户首次发布内容的完成率只有 X%」）；④ 给出解决方案与预期收益；⑤ 说明如何验证（AB 实验 + 指标）。最忌讳泛泛而谈「界面不好看」。'
  },
  {
    id: 'seed_pm_qa_cold', type: 'qa', cat: '产品经理', tags: ['冷启动'],
    title: '一个新产品如何做冷启动？',
    content: '① 明确最小可行的供给与需求；② 种子用户获取（定向邀请、社群、地推、借平台流量）；③ 优先保证核心闭环体验（宁可功能少，也要让第一批用户有完整体验）；④ 用运营手段补足初期内容或供给（人工运营、搬运、激励）；⑤ 监控留存与关键行为，快速迭代；⑥ 找到可复制的增长渠道后再放大投入。'
  },
  {
    id: 'seed_pm_qa_data', type: 'qa', cat: '产品经理', tags: ['数据驱动'],
    title: '如何用数据驱动产品迭代？',
    content: '① 先建立指标体系（北极星 + 分层拆解）；② 每次迭代前明确假设与衡量指标；③ 上线后看数据（漏斗、留存、分群对比）；④ 结合定性反馈解释「为什么会这样」；⑤ 复盘沉淀，决定继续投入、调整还是下线。注意：数据用于验证假设和发现机会，但不能替代对用户价值本身的判断。'
  },
  {
    id: 'seed_pm_qa_life', type: 'qa', cat: '产品经理', tags: ['产品生命周期'],
    title: '产品生命周期各阶段的重点是什么？',
    content: '引入期：验证需求，重点看留存与核心行为完成率，追求 PMF（产品市场匹配）。成长期：放大增长，重点看获客效率与活跃。成熟期：精细化运营、商业化提效、防流失。衰退期：寻找第二曲线或有序收缩。不同阶段的产品目标与衡量指标完全不同，答题时要先说清楚产品处于哪个阶段。'
  },

  /* ==================== 产品经理 · 简历与面经 ==================== */
  {
    id: 'seed_pm_cv', type: 'resume', cat: '产品经理', tags: ['简历', '产品'],
    title: '产品经理简历模板',
    content: '突出「数据驱动」：项目用「背景 - 动作 - 结果（量化）」表达；附上作品集、竞品分析或复盘文章的链接；技能写「Axure/Figma/SQL/数据分析」。少写主观形容词，多写可验证的成果。有实习写实习，没有的话可以写一次完整的产品分析或校园项目，并附上作品链接，让面试官有东西可看。'
  },
  {
    id: 'seed_pm_exp_1', type: 'experience', cat: '产品经理', company: '互联网大厂', author: '匿名用户', tags: ['产品', '面经'],
    title: '产品经理岗面经（流程与准备重点）',
    content: '常见流程：群面或业务一面（业务理解 + 产品 sense，如「为老年人设计一款打车产品」）→ 二面（深挖实习与项目，追问细节与数据）→ 三面/交叉面（综合素质、职业规划）。建议：准备 1-2 个完整案例，能说清需求判断、方案权衡与上线效果；多练「为什么」的连环追问。'
  },

  /* ==================== 前端开发 ==================== */
  {
    id: 'seed_fe_qa_js', type: 'qa', cat: '前端开发', tags: ['JavaScript', '八股'],
    title: '前端高频：闭包、原型链与事件循环',
    content: '闭包：函数能记住并访问其词法作用域，即使函数在作用域外执行；常用于数据私有化与防抖节流，注意可能引发内存泄漏。原型链：对象通过 __proto__ 链接到构造函数的 prototype 实现属性继承。事件循环：同步任务 → 清空微任务队列（Promise.then、queueMicrotask）→ 执行一个宏任务（setTimeout、I/O），循环往复。'
  },
  {
    id: 'seed_fe_qa_fw', type: 'qa', cat: '前端开发', tags: ['React', 'Vue'],
    title: '虚拟 DOM、响应式原理与 Hooks 注意点',
    content: '虚拟 DOM：用 JS 对象描述真实 DOM，通过 diff 找出最小变更再批量更新，减少昂贵的重排重绘。Vue 响应式：2.x 用 Object.defineProperty 劫持属性，3.x 用 Proxy；依赖收集 + 派发更新。React Hooks：注意 useEffect 的依赖数组与闭包陷阱，useMemo/useCallback 用于性能优化。列表 key 的作用是帮助 diff 识别节点身份，不要用 index。'
  },
  {
    id: 'seed_fe_cv', type: 'resume', cat: '前端开发', tags: ['简历', '前端'],
    title: '前端岗简历模板',
    content: '结构：技能（HTML/CSS/JS 基础、Vue/React 框架、Webpack/Vite 工程化、TypeScript）→ 项目（3 个，突出难点：性能优化、组件库沉淀、工程化改造）→ 开源/博客。项目写法要量化，如「首屏加载从 3s 优化到 1.2s（路由懒加载 + 图片懒加载 + CDN）」「抽离 15 个通用组件，团队复用率 60%」。'
  },

  /* ==================== 算法工程师 ==================== */
  {
    id: 'seed_al_qa_ml', type: 'qa', cat: '算法工程师', tags: ['机器学习'],
    title: '机器学习基础：过拟合、偏差方差与评估指标',
    content: '过拟合：训练集表现好、测试集差；解决办法包括增加数据/数据增强、正则化（L1/L2）、早停、dropout、简化模型。偏差-方差权衡：高偏差是欠拟合（模型太简单），高方差是过拟合（模型太复杂）。评估指标：类别不平衡时准确率不可靠，要看精确率、召回率、F1，以及 AUC（衡量排序能力）与 PR 曲线。'
  },
  {
    id: 'seed_al_qa_dl', type: 'qa', cat: '算法工程师', tags: ['深度学习', '大模型'],
    title: '深度学习与大模型基础（面试怎么答）',
    content: '基础：反向传播、梯度消失与爆炸（残差连接、LayerNorm、合理初始化）、常见结构（CNN 的局部感受野、RNN/Transformer 的序列建模、Attention 机制）。大模型：预训练 + 监督微调 SFT + 对齐 RLHF；推理优化手段（KV Cache、量化、蒸馏）；RAG 用外部检索缓解幻觉。面试重基础推导与项目细节，不要只堆名词。'
  },
  {
    id: 'seed_al_qa_math', type: 'qa', cat: '算法工程师', tags: ['数学基础', '机器学习'],
    title: '算法岗必考的数学与优化基础',
    content: '线性代数：矩阵求导、特征值与 SVD、常见距离度量（余弦相似度、欧氏距离）。概率统计：常见分布、贝叶斯公式、极大似然估计、期望与方差。优化：梯度下降的三种形式（BGD/SGD/Mini-batch）、动量、Adam 的自适应学习率、学习率衰减与 warmup。损失函数：回归用 MSE/MAE，分类用交叉熵（由极大似然推导而来）。面试常要求手推逻辑回归或 softmax 的梯度，务必能完整写下来。'
  },
  {
    id: 'seed_al_qa_derive', type: 'qa', cat: '算法工程师', tags: ['手推', '机器学习'],
    title: '手推高频：LR、SVM、决策树与 Attention',
    content: '逻辑回归：sigmoid 把线性输出映射到概率，损失用交叉熵，梯度形式与线性回归一致，本质是极大似然估计，可加 L1/L2 正则。SVM：最大化间隔，软间隔引入松弛变量与惩罚系数 C，核函数把低维不可分映射到高维，对偶问题与 KKT 条件。决策树：信息熵与基尼系数的计算、信息增益与增益率。Attention：softmax(QKᵀ/√dₖ)V，除以根号 dₖ 是为了防止点积过大导致 softmax 梯度饱和。准备方法：把推导手写三遍，能讲清每一步的意义。'
  },
  {
    id: 'seed_al_qa_feat', type: 'qa', cat: '算法工程师', tags: ['特征工程', '调参'],
    title: '特征工程怎么做？模型效果不好时怎么排查？',
    content: '特征工程：数值特征做归一化/分桶/交叉，类别特征用 one-hot、target encoding 或 embedding，时间特征取周期量与窗口统计，文本用 TF-IDF 或句向量。特征筛选：过滤法（相关性、卡方、IV 值）、包裹法（递归特征消除）、嵌入法（L1、树模型重要性）。效果不好时按顺序排查：先看数据（标签是否干净、有没有特征穿越、线上线下是否一致）→ 再看样本（不平衡、分布漂移）→ 再看模型（欠拟合加特征或加复杂度，过拟合加正则或加数据）→ 最后才是调参。'
  },
  {
    id: 'seed_al_qa_tree', type: 'qa', cat: '算法工程师', tags: ['树模型', 'XGBoost'],
    title: '决策树与 GBDT / XGBoost / LightGBM 高频考点',
    content: '决策树分裂：ID3 用信息增益、C4.5 用信息增益率、CART 用基尼系数（分类）或均方误差（回归）。集成：Bagging（随机森林，并行、降低方差）、Boosting（串行拟合残差、降低偏差）。XGBoost 相对 GBDT 的改进：二阶泰勒展开、显式正则项、特征粒度并行、缺失值自动处理。LightGBM 更快的原因：直方图算法、Leaf-wise 生长、GOSS 与 EFB。防过拟合：控制树深、最小叶子样本数、学习率、行采样与列采样、早停。'
  },
  {
    id: 'seed_al_qa_rec', type: 'qa', cat: '算法工程师', tags: ['推荐系统', '搜广推'],
    title: '推荐系统 / 搜广推常见面试问题',
    content: '流程：召回 → 粗排 → 精排 → 重排。召回常用：协同过滤（UserCF/ItemCF）、向量召回（双塔 + ANN 近似检索）、热门与规则兜底，多路召回后合并去重。精排模型演进：LR → GBDT+LR → DeepFM/DIN 等深度模型，重点在特征交叉与用户行为序列建模。评估：离线看 AUC、GAUC、Recall@K，线上看 CTR、CVR、时长与留存。一定要强调离线提升不等于线上提升，必须经 AB 实验验证。常见问题：冷启动、马太效应与多样性打散、位置偏差与曝光偏差纠偏。'
  },
  {
    id: 'seed_al_qa_nlp', type: 'qa', cat: '算法工程师', tags: ['NLP', 'Transformer'],
    title: 'NLP 方向：从词向量到 Transformer',
    content: '演进：词袋与 TF-IDF → Word2Vec（CBOW/Skip-gram、负采样）→ ELMO/BERT（预训练 + 微调）→ 大语言模型。Transformer 要点：Self-Attention 的 QKV 计算与缩放点积、多头注意力、位置编码（正弦或 RoPE）、残差连接与 LayerNorm、Encoder-Decoder 结构。必问题：BERT 与 GPT 的区别（双向理解 vs 自回归生成）、预训练任务（MLM/NSP）、微调与 Prompt 的取舍。工程侧：分词与 tokenizer、长文本截断与滑窗、推理吞吐与成本。'
  },
  {
    id: 'seed_al_qa_cv', type: 'qa', cat: '算法工程师', tags: ['CV', '深度学习'],
    title: 'CV 基础：CNN、目标检测与数据增强',
    content: 'CNN：卷积的局部连接与权值共享、感受野的叠加、池化的平移不变性；经典结构 ResNet（残差连接解决网络退化）、Inception（多尺度并行）、MobileNet（深度可分离卷积）。目标检测：两阶段（R-CNN 系列，先出候选框再分类，精度高）、单阶段（YOLO/SSD，直接回归框，速度快）；核心概念 anchor、NMS 非极大值抑制、mAP 评估。数据增强：翻转、裁剪、色彩抖动、Mixup、CutMix；小样本场景优先迁移学习与预训练微调。'
  },
  {
    id: 'seed_al_qa_eval', type: 'qa', cat: '算法工程师', tags: ['模型评估', '落地'],
    title: '离线指标涨了、线上却没效果，为什么？',
    content: '常见原因：① 特征穿越——训练时用了预测时刻拿不到的字段（如事后才落库的数据），离线虚高；② 样本偏差——训练样本只覆盖曝光或点击过的用户，与线上全量人群分布不一致；③ 标签定义错误或数据泄露；④ 线上线下特征两套实现，取值对不上；⑤ 离线指标（AUC）与线上目标（时长、留存、GMV）不对齐。排查方法：做时间外验证、抽样人工核对特征取值、上线前先小流量 AB 并盯住护栏指标。'
  },
  {
    id: 'seed_al_qa_llm', type: 'qa', cat: '算法工程师', tags: ['大模型', 'RAG'],
    title: '大模型应用岗（RAG / Agent / 微调）怎么准备？',
    content: '三条主线：① RAG——文档切分、向量化与检索（BM25 与向量混合检索、rerank 重排）、提示词组织、答案引用与可溯源；核心评估指标是召回率与答案忠实度。② Agent——工具调用（function calling）、任务规划、多轮对话记忆、失败重试与人工兜底。③ 微调——什么时候需要微调（格式风格固定、领域术语、小模型降本）vs 什么时候用提示词或 RAG 就够了；SFT 数据构造、LoRA 低秩微调、评测集设计。高频追问：如何降低幻觉、如何控制成本与延迟、怎么做效果评测。'
  },
  {
    id: 'seed_al_qa_code', type: 'qa', cat: '算法工程师', tags: ['手撕代码', '算法'],
    title: '算法岗手撕代码：高频题型与准备方法',
    content: '高频题型：数组与双指针（两数之和、滑动窗口）、链表（反转、环检测、合并）、二叉树（遍历、最近公共祖先、层序）、动态规划（背包、最长子序列、编辑距离）、回溯（排列组合、N 皇后）、堆与排序（TopK、快排划分）、二分查找。准备方法：按题型刷而不是按题号刷，每类总结一套模板；中等题要求 20 分钟内写出可运行代码并讲清时间复杂度；写完主动说明边界条件（空输入、单元素、整型溢出）。面试官更看重代码风格与沟通过程，而不是有没有秒出最优解。'
  },
  {
    id: 'seed_al_cv', type: 'resume', cat: '算法工程师', tags: ['简历', '算法'],
    title: '算法岗简历模板',
    content: '结构：教育背景（硕士更常见）→ 研究方向与论文/比赛（Kaggle 名次、顶会论文）→ 项目（突出问题定义、特征工程、模型选型与对比、效果提升）→ 工程能力（Python/C++、分布式训练）。要点：能量化就量化（如「AUC 从 0.72 提升到 0.81」），并能说清为什么选这个模型、做了哪些消融实验。'
  },
  {
    id: 'seed_al_cv_nopaper', type: 'resume', cat: '算法工程师', tags: ['简历', '无论文'],
    title: '没有顶会论文，算法岗简历怎么补？',
    content: '① 比赛：Kaggle/天池等名次是最直接的硬通货，写清比赛规模、方案亮点与名次百分比；② 项目：做一个完整闭环的小项目（数据获取→清洗→特征→模型→评估→Demo），并把复盘写成博客附上链接；③ 复现：复现经典论文并给出与原文的对照实验；④ 工程能力：熟练 Python/C++、分布式训练、模型部署与推理优化，很多团队更缺能落地的算法工程师；⑤ 实习：哪怕是数据清洗与特征开发，也要量化你的具体贡献。'
  },
  {
    id: 'seed_al_exp_1', type: 'experience', cat: '算法工程师', company: '互联网大厂', author: '匿名用户', tags: ['算法', '一面'],
    title: '算法岗面经（一面：代码 + 基础 + 项目）',
    content: '典型流程：自我介绍 → 1-2 道手撕代码（中等难度，要求讲思路与复杂度）→ 项目深挖（数据规模、特征怎么做的、为什么选这个模型、对比实验结果）→ 机器学习基础（过拟合、评估指标、手推 LR 或决策树）。建议：代码练到能在白板或共享文档里一次写对；项目准备 2 个能讲满 10 分钟的点，说清「基线是什么、你改了什么、涨了多少、代价是什么」。'
  },

  /* ==================== 运营 ==================== */
  {
    id: 'seed_op_qa_growth', type: 'qa', cat: '运营', tags: ['运营', '增长'],
    title: '用户增长遇到瓶颈，你会怎么做？（运营岗）',
    content: '拆解漏斗定位流失环节 → 复盘各渠道质量 → 设计召回/促活策略（push、裂变、权益激励）→ 用数据验证 ROI。核心是强调「假设 - 实验 - 迭代」的闭环，而不是一次性拍脑袋上策略。'
  },
  {
    id: 'seed_op_qa_act', type: 'qa', cat: '运营', tags: ['活动运营', '内容运营'],
    title: '如何策划一场活动 / 做内容运营？',
    content: '活动策划：明确目标（拉新/活跃/转化）与衡量指标 → 选主题与玩法（门槛低、有意思、有分享动机）→ 设计参与路径与激励 → 安排资源位与节奏（预热-爆发-长尾）→ 数据监控与实时调优 → 复盘沉淀。内容运营：定位内容调性 → 建立选题与生产机制 → 分发与推荐 → 看消费与互动数据迭代。'
  },
  {
    id: 'seed_op_qa_kind', type: 'qa', cat: '运营', tags: ['运营', '求职方向'],
    title: '运营有哪些方向？我该投哪个？',
    content: '常见方向：内容运营（生产与分发内容）、用户运营（分层与生命周期管理）、活动运营（策划活动促活拉新转化）、产品运营（把产品能力转化为用户价值，与产品/研发协作）、社群与私域运营、电商运营（店铺、商品、直播）、渠道与增长运营（投放、商务合作）。选择方法：对照自己的长项——爱写爱策划选内容与活动，数据敏感选增长与产品运营，会聊天会组织选社群。面试前一定要说清你为什么选这个方向，并用具体经历佐证。'
  },
  {
    id: 'seed_op_qa_user', type: 'qa', cat: '运营', tags: ['用户运营', '分层'],
    title: '用户运营：分层与生命周期怎么做？',
    content: '分层：按价值用 RFM 模型（最近一次消费、消费频率、消费金额），或按生命周期阶段（新用户、成长期、成熟期、沉默期、流失期）划分。策略：新用户做引导与首单转化，成长期做习惯养成与权益激励，成熟期做价值提升与交叉销售，沉默期做召回唤醒。要点：分层之后必须配套差异化策略与触达节奏，并用数据验证每一层的转化与 ROI，而不是分完就结束了。'
  },
  {
    id: 'seed_op_qa_community', type: 'qa', cat: '运营', tags: ['社群运营', '私域'],
    title: '社群 / 私域运营怎么做才有效？',
    content: '定位先行：这个群为用户解决什么问题（答疑、福利、兴趣交流、陪伴打卡）。搭建：入群欢迎语与群规、固定栏目（每日早报、每周答疑直播）、KOC 培养与氛围维护。增长：老带新裂变、权益激励、内容沉淀。防死群：控制群规模、及时清理广告、保持稳定输出节奏、设置阶段目标与仪式感。衡量：活跃率、人均消息数、留存率、转化率与 GMV 贡献。'
  },
  {
    id: 'seed_op_qa_content', type: 'qa', cat: '运营', tags: ['内容运营', '新媒体'],
    title: '内容运营：怎么持续产出爆款？',
    content: '选题：从用户需求、热点、产品卖点三个来源建立选题库，而不是临时想。生产：沉淀模板与 SOP（标题公式、开头三秒、结构设计、结尾引导动作），用数据与用户反馈持续迭代。分发：理解平台推荐机制（完播率、互动率），打磨标题/封面/标签与发布时间。复盘：把内容按曝光-点击-互动-转化拆成漏斗，找出最弱的一环重点优化。关键认知：爆款有偶然性，但可复制的是选题机制与生产流程。'
  },
  {
    id: 'seed_op_qa_metric', type: 'qa', cat: '运营', tags: ['数据分析', '指标'],
    title: '运营必须掌握的指标体系',
    content: '规模：DAU/MAU、新增、累计注册。质量：次日/7 日/30 日留存、使用时长、使用频次。转化：注册转化率、付费转化率、客单价、复购率、ARPU。效率：获客成本 CAC、用户生命周期价值 LTV、投入产出比 ROI（通常要求 LTV/CAC > 3）。答题技巧：先说清指标定义与统计口径，再讲你怎么用它做决策；被问「指标下降怎么办」时先拆维度定位，再给可执行动作，而不是直接抛策略。'
  },
  {
    id: 'seed_op_qa_channel', type: 'qa', cat: '运营', tags: ['渠道运营', '获客'],
    title: '拉新渠道怎么选？获客成本怎么降？',
    content: '渠道分类：自然流量（内容、搜索、口碑）、付费投放（信息流、搜索竞价、应用商店）、合作换量（异业合作、渠道分销）、裂变（邀请有奖、拼团）。评估：用 CAC + 留存 + LTV 三个维度衡量渠道质量，不能只看量——低 CAC 但留存差的渠道是假便宜。降本思路：优化素材与落地页提升转化率、做渠道归因剔除虚荣数据、提高自然流量与裂变占比、改善新用户首日体验以提升留存从而摊薄成本。'
  },
  {
    id: 'seed_op_qa_recall', type: 'qa', cat: '运营', tags: ['用户运营', '召回'],
    title: '沉默用户召回怎么做？',
    content: '定义：先明确「沉默」的口径（如 7 日未活跃），并按流失时长、历史价值、流失前行为分层。找原因：是产品没价值、打扰太多、还是需求本身低频。策略：push/短信/邮件/外呼按打扰成本从低到高选择，权益激励（回归礼包、优惠券）、内容召回（告诉用户有什么新变化）、社交召回（好友邀请）。要点：控制触达频次避免反感，设置对照组做 AB 实验衡量真实增量，并关注召回后的二次留存而不只是回流率。'
  },
  {
    id: 'seed_op_qa_gmv', type: 'qa', cat: '运营', tags: ['电商运营', 'GMV'],
    title: '电商运营：GMV 怎么拆解和提升？',
    content: '公式：GMV = 流量 × 转化率 × 客单价（可再细拆为 曝光 × 点击率 × 转化率 × 客单价）。提升路径：流量端（搜索优化、投放、活动、直播）、转化端（详情页、评价、价格与促销、客服响应、库存与履约）、客单价端（关联推荐、凑单满减、套装组合、会员体系）。工作方法：先找出当前最薄弱的因子集中突破，每个动作配一个可衡量的目标与复盘，避免「什么都做但不知道哪个起了作用」。'
  },
  {
    id: 'seed_op_qa_review', type: 'qa', cat: '运营', tags: ['活动运营', '复盘'],
    title: '活动复盘报告怎么写？（面试常考）',
    content: '结构：① 目标回顾（原定目标是什么，用数据说明是否达成）；② 过程复盘（时间线、关键动作、资源投入）；③ 数据分析（按漏斗拆各环节转化，与历史数据或对照组对比）；④ 亮点与不足（各写 3 条，不足要写清根因，不要只写「准备不足」）；⑤ 可复用的方法论与下一步行动计划。加分项：附上你的 AB 实验设计、成本收益核算，以及沉淀下来的 SOP。'
  },
  {
    id: 'seed_op_qa_case', type: 'qa', cat: '运营', tags: ['场景题', '增长'],
    title: '运营场景题：给你 10 万预算，怎么花？',
    content: '答题框架：① 先问清目标（拉新、促活还是转化？考核指标是什么？周期多长？）② 做假设与测算（预估各渠道 CAC 与可带来的量级，算出 ROI）③ 分配预算并留出测试预算（建议 70% 投确定性高的渠道，30% 做新渠道测试）④ 设定过程指标与监控节奏（日级看消耗与转化，及时止损或加码）⑤ 复盘沉淀，把有效渠道变成可复用的投放模型。面试官看重的是结构化拆解与数据意识，而不是具体数字。'
  },
  {
    id: 'seed_op_cv', type: 'resume', cat: '运营', tags: ['简历', '运营'],
    title: '运营岗简历模板',
    content: '突出「结果」与「方法论」：写清运营目标、你的具体动作、量化结果（如「策划 X 活动，带动 DAU 提升 15%，获客成本下降 20%」）；体现数据能力（会用 SQL/Excel 做分析、会搭漏斗）；附上作品（活动方案、文案、数据复盘）。避免「负责日常运营」这类没有信息量的描述。'
  },
  {
    id: 'seed_op_cv_nodata', type: 'resume', cat: '运营', tags: ['简历', '无数据'],
    title: '运营简历没有亮眼数据怎么办？',
    content: '① 把过程指标写清楚：即使没有最终结果，也可以写「搭建 X 个社群、覆盖 Y 人、日均产出 Z 条内容」；② 用相对值：如「活动参与人数为上一期的 2.3 倍」；③ 突出方法论沉淀：SOP、选题库、复盘文档、模板；④ 附作品集：活动方案、文案、数据看板截图，比空口描述有力得多；⑤ 校园经历同样可用（社团、公众号、校级活动），关键是有目标、有动作、有结果与反思。'
  },
  {
    id: 'seed_op_exp_1', type: 'experience', cat: '运营', company: '互联网公司', author: '匿名用户', tags: ['运营', '面经'],
    title: '运营岗面经（业务面 + 总监面）',
    content: '业务面常问：给你一个具体产品怎么拉新、DAU 下滑怎么办、怎么做一场活动、你最喜欢的一款产品为什么好、你怎么看某个竞品；会深挖你简历里的每份经历，追问「这个数是怎么来的」「你的角色是什么」。总监面更关注：你对业务的理解深度、自驱力与复盘能力、长期意愿。建议：提前体验并拆解应聘公司的产品，准备一份你对该产品的优化建议，这会让你明显区别于其他候选人。'
  },

  /* ==================== 财务 ==================== */
  {
    id: 'seed_fin_qa_kind', type: 'qa', cat: '财务', tags: ['求职方向', '财务'],
    title: '财务类岗位有哪些方向？该怎么选？',
    content: '常见方向：会计核算（记账、报表、总账）、财务分析 FP&A（预算、经营分析、业务伙伴）、资金与融资（现金流、银企关系）、税务（申报、筹划、合规）、内控与审计（企业内审、事务所外审）、风控与信用、投资者关系。选择建议：想稳健、走专业认证路线可选会计与审计；想贴近业务、参与决策选 FP&A；对资本市场感兴趣选资金或 IR。秋招投递前务必分清「核算型」与「分析型」岗位，两者的能力要求差别很大。'
  },
  {
    id: 'seed_fin_qa_acc', type: 'qa', cat: '财务', tags: ['会计基础', '高频'],
    title: '会计基础高频：借贷记账与权责发生制',
    content: '恒等式：资产 = 负债 + 所有者权益。借贷记账：资产、费用增加记借方；负债、所有者权益、收入增加记贷方，每笔分录借贷必相等。权责发生制 vs 收付实现制：收入在「已实现或可实现、已赚得」时确认，而不是等收到钱——这正是应收账款与收入确认问题的根源。常考：折旧与摊销（把固定资产成本分摊到各期）、预提与待摊、坏账准备、存货计价方法。答题时把分录写完整，并说明对三张报表的影响。'
  },
  {
    id: 'seed_fin_qa_report', type: 'qa', cat: '财务', tags: ['财务报表', '高频'],
    title: '三大报表分别讲什么？彼此怎么勾稽？',
    content: '利润表：一段时间内经营成果（收入 - 成本 - 费用 = 净利润），回答「赚没赚钱」。资产负债表：某一时点的财务状况（资产 = 负债 + 所有者权益），回答「家底如何」。现金流量表：按经营、投资、筹资三类列示现金真实进出，回答「钱还在不在」。勾稽关系：净利润加回折旧摊销、调整营运资金变动后，是经营活动现金流量的起点；本期净利润进入资产负债表的所有者权益（未分配利润）；现金及等价物的期初期末差额等于现金流量表净增加额。'
  },
  {
    id: 'seed_fin_qa_ratio', type: 'qa', cat: '财务', tags: ['财务分析', '杜邦分析'],
    title: '财务分析常用指标与杜邦分析',
    content: '盈利能力：毛利率、净利率、ROE、ROA。营运能力：应收账款周转天数、存货周转天数、应付账款周转天数，三者共同构成现金转换周期。偿债能力：流动比率、速动比率、资产负债率、利息保障倍数。成长性：收入与利润增速。杜邦分析把 ROE 拆成「净利率 × 资产周转率 × 权益乘数」，用来判断高 ROE 究竟来自高利润、高周转还是高杠杆——这是回答「这家公司好不好」时最有说服力的框架。'
  },
  {
    id: 'seed_fin_qa_excel', type: 'qa', cat: '财务', tags: ['Excel', '财务建模'],
    title: '财务岗必会的 Excel 与建模基础',
    content: '必会函数：SUMIFS/COUNTIFS 多条件汇总、VLOOKUP 或 XLOOKUP 匹配、INDEX+MATCH、IFERROR、文本函数、日期函数。数据透视表：多维度交叉汇总、按日期分组、计算字段。建模：三张报表联动（利润表→资产负债表→现金流量表），假设驱动（增长率、毛利率、周转天数作为输入变量），务必做到「改一个假设，全表自动更新」，并把假设区与计算区分开、配色区分。加分项：会用 Power Query 做数据清洗、会画瀑布图与敏感性分析表。'
  },
  {
    id: 'seed_fin_cv', type: 'resume', cat: '财务', tags: ['简历', '财务'],
    title: '财务岗简历模板',
    content: '结构：教育背景（院校、专业、GPA、核心课程）→ 证书与技能（CPA/CFA/ACCA 已通过科目、初级会计、Excel/SQL/Python、SAP/用友/金蝶等财务系统）→ 实习经历（用「动作 + 量化结果」，如「独立完成 3 家子公司月度结账，出具报表时间从 8 天缩短到 5 天」「搭建费用分析模板，支持 X 个部门的预算复盘」）→ 校园与实践。要点：数字务必真实、口径清楚；财务岗尤其看重细致严谨，错别字与格式混乱是致命伤。'
  },
  {
    id: 'seed_fin_exp_1', type: 'experience', cat: '财务', company: '企业/事务所', author: '匿名用户', tags: ['财务', '面经'],
    title: '财务岗面经（专业面 + 综合面）',
    content: '专业面常问：三张报表的勾稽关系、收入确认原则、折旧方法及其对利润的影响、杜邦分析、营运资金管理、增值税与企业所得税常识，部分公司会现场让你做透视表或写函数。综合面会问：为什么选财务、职业规划、能否接受重复性强的工作与月末年末加班、对所投行业的了解。建议：准备一份你熟悉公司的财报解读，能从头到尾讲一遍；投事务所要突出抗压与项目经历，投企业财务要突出业务理解与数据能力。'
  },

  /* ==================== 通用（行为面 / 求职技巧） ==================== */
  {
    id: 'seed_ge_qa_behavior', type: 'qa', cat: '通用', tags: ['行为面', 'STAR'],
    title: '请说一个你解决过的最难的问题（行为面）',
    content: '用 STAR 结构：背景（什么项目、遇到什么瓶颈）→ 任务（你的职责是什么）→ 行动（具体采取了什么技术或协调手段）→ 结果（量化指标，如性能提升 40%、成本下降 20%）。重点始终放在「你」做了什么，而不是团队做了什么，并准备好被追问细节。'
  },
  {
    id: 'seed_ge_qa_intro', type: 'qa', cat: '通用', tags: ['自我介绍'],
    title: '自我介绍怎么讲才出彩？（1 分钟与 3 分钟版）',
    content: '准备两版：1 分钟版用于开场，3 分钟版用于深挖前。结构：我是谁（教育/背景）→ 我做过什么（挑 2 个与岗位最相关的亮点，必须带量化结果）→ 我为什么来（与岗位/公司的匹配点）。要点：不讲流水账，把经历串成一条「为什么我适合这个岗位」的逻辑线，结尾抛个钩子，引导面试官追问你最擅长的部分。'
  },
  {
    id: 'seed_ge_qa_why', type: 'qa', cat: '通用', tags: ['行为面'],
    title: '你为什么选择我们公司？',
    content: '三层次回答：① 公司层面（业务方向、技术氛围、行业地位，要具体，别只说「平台大」）；② 团队/岗位层面（这个岗位做的事与你的能力、兴趣匹配）；③ 个人层面（你想在这里获得什么成长）。关键是提前做功课：看官网、财报、产品与近期动态，能说出你自己的具体看法。'
  },
  {
    id: 'seed_ge_qa_weak', type: 'qa', cat: '通用', tags: ['行为面'],
    title: '你的缺点是什么？（怎么答不踩坑）',
    content: '原则：说一个真实但无伤大雅、并且正在改进中的缺点。既不要说「我太追求完美」这种敷衍答案，也不要暴露致命短板。结构：承认缺点 → 说明它如何影响了工作 → 你采取了什么具体措施改进 → 目前进展如何。示例：「以前做方案偏理想化、对工期预估不足，后来我学会了拆分任务并提前和研发对齐排期。」'
  },
  {
    id: 'seed_ge_qa_plan', type: 'qa', cat: '通用', tags: ['行为面'],
    title: '你的职业规划是什么？',
    content: '说清短中长期，且与应聘岗位的发展路径一致：短期（1-2 年）扎实基本功、能独立完成任务；中期（3 年）能独立负责一个方向或模块、带小项目；长期希望在某个领域深耕。要点：让公司觉得你打算在这里成长，而不是当跳板；避免主动说「以后想创业/想转岗」这类让面试官担忧的话。'
  },
  {
    id: 'seed_ge_qa_ask', type: 'qa', cat: '通用', tags: ['反问'],
    title: '反问环节应该问什么？',
    content: '准备 3 个有深度的问题：① 这个岗位入职后前 3 个月主要负责什么？团队期望我解决什么问题？② 团队目前最大的挑战或正在攻坚的方向是什么？③ 团队的技术栈与协作方式是怎样的？优秀的人在这个团队通常具备什么特质？忌讳反问薪资福利（留给 HR 阶段）或问官网一查就有的信息。'
  },
  {
    id: 'seed_ge_qa_salary', type: 'qa', cat: '通用', tags: ['谈薪'],
    title: '谈薪技巧：怎么谈才能拿到更好的 offer？',
    content: '① 先摸清市场价（同城市、同岗位、同年限的区间，多问往届学长学姐与手上的 offer）；② 尽量让对方先给数字，再基于自身价值与其他 offer 去谈；③ 谈总包而非只看 base（base + 奖金 + 股票期权 + 签字费 + 公积金比例）；④ 手上有多个 offer 是最大筹码，但要诚实、不要虚构；⑤ 态度诚恳有依据，别硬碰硬；⑥ 谈定后务必拿到书面确认。'
  },
  {
    id: 'seed_ge_qa_apply', type: 'qa', cat: '通用', tags: ['网申', '笔试'],
    title: '网申与笔试有哪些注意事项？',
    content: '网申：尽早投递（很多公司是滚动招聘，名额先到先得）；开放题要写得具体、有数据；建一张投递台账，跟踪进度与截止日期，避免错过笔试面试。笔试：多练真题（行测/性格测试/专业题），注意考试时间与网络环境；性格测试保持前后一致、不要走极端；技术笔试刷 hot100 中等难度题，保证代码能跑通并覆盖边界条件。'
  },
  {
    id: 'seed_ge_cv_common', type: 'resume', cat: '通用', tags: ['简历', '避坑'],
    title: '简历通用规范与常见避坑',
    content: '应届生控制在一页为佳，导出 PDF 并命名为「姓名-岗位-学校」；照片用正式证件照；不要写「精通」，除非能扛住追问；技能与目标 JD 对齐；经历按时间倒序；每段经历用「动作 + 量化结果」表达；检查错别字、时间冲突，确认学历符合岗位要求；不要用过于花哨的模板（对 HR 与系统解析都不友好）。'
  }
];

/**
 * 扩充资源（第二批）：按岗位补齐面试题库 / 简历模板 / 面经分享三大类。
 * 与原 SEED_DEFS 分开存放，便于后续继续追加而不影响既有条目。
 */
const SEED_DEFS_EXTRA: SeedDef[] = [
  /* ==================== 后端开发 · 面试题库（扩充） ==================== */
  {
    id: 'seed2_be_qa_proc', type: 'qa', cat: '后端开发', tags: ['操作系统', '并发'],
    title: '进程、线程、协程的区别与选型',
    content: '进程是资源分配的基本单位，有独立地址空间，切换开销最大；线程是 CPU 调度的基本单位，共享进程内存，切换需内核介入；协程是用户态轻量级线程，切换不进内核，开销最小，适合高并发 IO 密集场景（如 Go goroutine、Java 虚拟线程）。答题要点：先给定义，再比较「地址空间 / 切换开销 / 通信方式 / 崩溃影响」，最后落到选型——CPU 密集用多进程，IO 密集用协程，需要隔离稳定性用多进程。'
  },
  {
    id: 'seed2_be_qa_lock', type: 'qa', cat: '后端开发', tags: ['MySQL', '锁'],
    title: 'MySQL 有哪些锁？行锁什么时候退化成表锁？',
    content: '按粒度：行锁、表锁、间隙锁（Gap Lock）、临键锁（Next-Key Lock）。InnoDB 行锁依赖索引实现：**如果查询没有走索引，行锁会退化为表锁**，这是高频考点。间隙锁只在可重复读（RR）隔离级别下存在，用于解决幻读。答题要点：举例说明——update 语句 where 条件字段无索引时会锁全表；再补充死锁排查手段（show engine innodb status 查看最近死锁日志）。'
  },
  {
    id: 'seed2_be_qa_mvcc', type: 'qa', cat: '后端开发', tags: ['MySQL', 'MVCC'],
    title: 'MVCC 是怎么实现可重复读的？',
    content: 'MVCC（多版本并发控制）靠三个东西：① 隐藏字段（DB_TRX_ID 事务 id、DB_ROLL_PTR 回滚指针）② undo log 版本链 ③ ReadView。读已提交（RC）每次快照读都生成新的 ReadView，所以能读到别人已提交的修改；可重复读（RR）只在第一次快照读生成 ReadView，之后复用，因此多次读取结果一致。答题加分：说明「快照读走 MVCC 不加锁，当前读（select for update / update）走锁」，以及 MVCC 并不能完全解决幻读（当前读仍靠间隙锁）。'
  },
  {
    id: 'seed2_be_qa_rdb', type: 'qa', cat: '后端开发', tags: ['Redis', '持久化'],
    title: 'Redis 的 RDB 与 AOF 该怎么选？',
    content: 'RDB 是定时内存快照，文件小、恢复快，但会丢失最后一次快照之后的数据；AOF 记录每条写命令，数据更完整（可配 everysec 最多丢 1 秒），但文件大、恢复慢。生产环境通常**两者都开**：用 AOF 保证数据安全，用 RDB 做冷备与快速恢复；Redis 4.0 起支持混合持久化（AOF 重写时前半段写 RDB 格式），兼顾体积与速度。答题要点：讲清「取舍在性能与数据完整性」，并说明 fork 子进程的成本。'
  },
  {
    id: 'seed2_be_qa_cluster', type: 'qa', cat: '后端开发', tags: ['Redis', '高可用'],
    title: 'Redis 主从、哨兵、集群各自解决什么问题？',
    content: '主从复制解决「读扩展与数据备份」，但主节点挂了要人工切换；哨兵（Sentinel）在主从基础上加自动故障转移与监控，解决高可用，但仍是单写、容量受单机限制；Cluster 集群通过 16384 个哈希槽分片，解决「容量与写性能的水平扩展」，具备一定的高可用能力。答题要点：按「备份 → 高可用 → 扩容」三级递进回答，并补充主从同步流程（全量 RDB + 增量命令传播）。'
  },
  {
    id: 'seed2_be_qa_pool', type: 'qa', cat: '后端开发', tags: ['Java', '并发'],
    title: '线程池的核心参数与拒绝策略',
    content: '七个参数：核心线程数、最大线程数、存活时间、时间单位、阻塞队列、线程工厂、拒绝策略。执行顺序是：核心线程未满 → 建核心线程；核心满 → 进队列；队列满 → 建非核心线程；达到最大线程数 → 触发拒绝策略。四种拒绝策略：AbortPolicy（抛异常，默认）、CallerRunsPolicy（调用方自己执行，起削峰作用）、DiscardPolicy（静默丢弃）、DiscardOldestPolicy（丢弃队首）。答题加分：说明「IO 密集 vs CPU 密集」的线程数估算，以及为什么不建议用 Executors 创建（队列无界易 OOM）。'
  },
  {
    id: 'seed2_be_qa_aqs', type: 'qa', cat: '后端开发', tags: ['Java', '并发'],
    title: 'synchronized 和 ReentrantLock 的区别',
    content: 'synchronized 是 JVM 关键字，自动释放锁，不可中断，非公平，JDK 1.6 后有偏向锁/轻量级锁优化；ReentrantLock 是 JDK 层实现（基于 AQS），需手动 unlock（必须放 finally），支持可中断、超时获取、公平锁、多个 Condition。答题要点：先说「都能重入」，再从「实现层面 / 释放方式 / 可中断 / 公平性 / 条件队列」五个维度比较，最后给选型——简单同步用 synchronized，需要超时或公平性时用 ReentrantLock。'
  },
  {
    id: 'seed2_be_qa_gc', type: 'qa', cat: '后端开发', tags: ['JVM', '性能'],
    title: 'JVM 垃圾回收：CMS 与 G1 有什么区别？',
    content: 'CMS 以「最短停顿」为目标，采用标记-清除，并发收集，但有碎片问题、对 CPU 敏感，JDK 9 起被标记废弃；G1 把堆划分成多个 Region，可预测停顿时间（设置 -XX:MaxGCPauseMillis），兼顾吞吐与停顿，采用标记-整理，碎片少，JDK 9 后为默认。答题要点：说清「分代 → 分区」的思路变化，判断对象存活用可达性分析（GC Roots），并补充排查手段（jstat 看 GC 频率、jmap 导出堆、MAT 分析大对象）。'
  },
  {
    id: 'seed2_be_qa_spring', type: 'qa', cat: '后端开发', tags: ['Spring', '框架'],
    title: 'Spring 如何解决循环依赖？哪些情况解决不了？',
    content: 'Spring 通过三级缓存解决**单例 setter 注入**的循环依赖：一级缓存放成品对象，二级缓存放半成品（已实例化未填充属性），三级缓存放对象工厂（用于生成代理对象）。解决不了的情况：构造器注入的循环依赖、prototype 作用域的循环依赖。答题要点：先说「三级缓存各自存什么」，再强调「只有单例且非构造器注入才行」，最后补一句工程建议——用 @Lazy 或重构依赖关系来根治。'
  },
  {
    id: 'seed2_be_qa_idem', type: 'qa', cat: '后端开发', tags: ['分布式', '接口设计'],
    title: '接口幂等性怎么设计？',
    content: '常见方案：① 数据库唯一索引（插入类天然防重）② 乐观锁（版本号 / 条件更新，如 update set stock=stock-1 where stock>0）③ 分布式锁 + 去重表 ④ Token 机制（进入页面先取 token，提交时校验并删除）⑤ 状态机（订单状态只允许单向流转）。答题要点：先定义幂等（同一请求执行多次与一次结果一致），再按「读 / 写 / 扣减」分类给方案，最后说明前端配合（按钮置灰、防重复提交）。'
  },
  {
    id: 'seed2_be_qa_id', type: 'qa', cat: '后端开发', tags: ['分布式', '雪花算法'],
    title: '分布式 ID 生成方案有哪些？雪花算法的坑',
    content: '方案：UUID（无序、影响索引性能）、数据库自增步长（有瓶颈）、号段模式（一次取一段，本地发号，性能好）、Redis INCR、雪花算法 Snowflake（时间戳 + 机器 id + 序列号）。Snowflake 的两个坑：**时钟回拨**会导致 ID 重复（解决：记录上次时间戳，回拨则等待或报错；或备用机器位）；机器 id 需要统一分配（可用 zk / 数据库 / K8s 编号）。答题加分：提到百度 UidGenerator、美团 Leaf 这两个改进实现。'
  },
  {
    id: 'seed2_be_qa_seckill', type: 'qa', cat: '后端开发', tags: ['系统设计', '高并发'],
    title: '手撕系统设计：秒杀系统怎么做？',
    content: '分层削峰：① 页面静态化 + CDN，按钮前置灰防重复点击 ② 网关层限流（令牌桶）+ 风控拦截脚本刷子 ③ 库存预热到 Redis，用 Lua 脚本原子扣减，扣减成功再发消息 ④ MQ 异步下单，削峰填谷，消费者落库 ⑤ 数据库用乐观锁兜底（where stock > 0）。一致性：允许短暂少卖，通过定时对账补偿。答题要点：核心思路是「把请求挡在上游、把库存判断前移、把下单异步化」，并主动说出「超卖怎么防」「如何防止恶意刷单」「热点账户分桶」。'
  },
  {
    id: 'seed2_be_qa_cpu', type: 'qa', cat: '后端开发', tags: ['Linux', '排查'],
    title: '线上服务 CPU 飙到 100%，你怎么排查？',
    content: '标准流程：① top 找到占用高的进程 PID ② top -Hp PID 找到最耗 CPU 的线程，转成十六进制 ③ jstack PID 导出线程栈，用十六进制线程号定位到具体代码行 ④ 结合代码判断是否死循环、频繁 GC、正则回溯、大量序列化。若是 GC 引起，再用 jstat -gcutil 观察回收频率、jmap 导出堆用 MAT 分析泄漏对象。答题要点：体现「有章法」——先定位进程、再定位线程、再定位代码，而不是一上来就说重启。'
  },
  {
    id: 'seed2_be_qa_docker', type: 'qa', cat: '后端开发', tags: ['Docker', 'K8s'],
    title: 'Docker 与 K8s 常问的几个基础问题',
    content: 'Docker：镜像是分层只读模板，容器是镜像的运行实例；Dockerfile 每条指令生成一层，因此要合并 RUN、用 .dockerignore 减小体积；容器与虚拟机区别在于共享宿主机内核，启动更快、资源占用更少。K8s：Pod 是最小调度单元，Deployment 管理副本与滚动更新，Service 提供稳定访问入口，ConfigMap / Secret 管理配置与密钥，HPA 根据 CPU 自动扩缩容。答题要点：说明「容器解决打包一致性与交付，K8s 解决编排与自愈」。'
  },
  {
    id: 'seed2_be_qa_lru', type: 'qa', cat: '后端开发', tags: ['手撕代码', 'LRU'],
    title: '手撕算法：实现 LRU 缓存',
    content: '思路：哈希表 + 双向链表。哈希表保证 O(1) 查找，双向链表维护访问顺序——get 时把节点移到头部，put 时若已存在则更新并移到头部，若不存在则插到头部，超过容量则删除尾部节点。Java 可直接用 LinkedHashMap（构造时 accessOrder=true 并重写 removeEldestEntry）。答题要点：先讲清为什么单链表不行（删除需要前驱指针），再手写代码，最后说明「为什么不用数组」（移动成本高）。'
  },

  /* ==================== 后端开发 · 简历模板（扩充） ==================== */
  {
    id: 'seed2_be_cv_skill', type: 'resume', cat: '后端开发', tags: ['简历', '技能'],
    title: '后端简历「技能栏」怎么写才不扣分',
    content: '错误写法：熟悉 Java / MySQL / Redis / Spring（罗列名词，无法验证）。正确写法：按「熟练度 + 具体能力」分条——Java：熟悉并发编程与 JVM 调优，能定位死锁与内存泄漏；MySQL：熟悉索引与事务，有慢查询优化经验（某查询从 2s 优化到 80ms）；框架：熟悉 Spring Boot / MyBatis，了解 IOC 与 AOP 原理。原则：写得上被追问的才写，不要用「精通」；没把握的技术写成「了解」，并准备被问到区别。'
  },
  {
    id: 'seed2_be_cv_trap', type: 'resume', cat: '后端开发', tags: ['简历', '避坑'],
    title: '后端简历最常见的 8 个坑',
    content: '① 写「参与开发」不写自己负责什么 ② 项目没有量化结果 ③ 技能栏罗列一堆名词却答不上原理 ④ 把课程设计包装成项目却经不起追问 ⑤ 简历超过一页（应届应严格一页）⑥ 出现「精通」字样 ⑦ 项目时间、职责与面试描述不一致 ⑧ 贴大量无关证书与自我评价。改法：每条经历都用「我负责 X，通过 Y 手段，达成 Z 结果」，数字优先用真实的量级（QPS、耗时、占比、人数）。'
  },
  {
    id: 'seed2_be_cv_quant', type: 'resume', cat: '后端开发', tags: ['简历', '量化'],
    title: '后端项目描述量化模板（可直接套用）',
    content: '模板：【背景】为支撑 XX 场景（日活/订单量），需解决 XX 问题；【我的职责】独立负责 XX 模块的设计与开发；【手段】采用 XX 技术（缓存/异步/分库分表/限流），关键点在于 XX；【结果】接口 P99 从 800ms 降至 120ms，QPS 提升 3 倍，异常率由 1.2% 降至 0.1%，上线后稳定运行 N 个月。提示：数字可以估算但必须能说出推算依据；如果没有线上数据，就写实验室压测结果并注明「本地压测」。'
  },
  {
    id: 'seed2_be_cv_bank', type: 'resume', cat: '后端开发', tags: ['简历', '国企银行'],
    title: '投银行 / 国企科技岗，简历要怎么调整',
    content: '与互联网简历的差异：① 稳定性与合规性优先——突出长期项目、规范流程、证书（软考、计算机等级、英语四六级）② 弱化「造轮子」「高并发极致优化」等互联网味道过重的表述，强化「业务理解、系统稳定、数据安全」③ 增加政治面貌、学生干部、奖学金、实习单位性质等信息 ④ 项目描述强调「与业务方协作」「按规范交付」「文档完备」。注意：这类岗位常有硬性门槛（学历、英语、专业），简历要把这些显性信息放在靠前位置。'
  },

  /* ==================== 后端开发 · 面经分享（扩充） ==================== */
  {
    id: 'seed2_be_exp_byte', type: 'experience', cat: '后端开发', company: '字节跳动', author: '网友投稿', tags: ['后端', '一面'],
    title: '字节后端一面（60 分钟）：重算法与项目深挖',
    content: '流程：自我介绍 5 分钟 → 两道算法（一道链表、一道二叉树层序遍历，要求白板写并分析复杂度）→ 项目深挖 25 分钟（追问 Redis 缓存一致性怎么保证、为什么用消息队列、消息丢失怎么办）→ 一道八股（TCP 三次握手）→ 反问。体感：算法必须一遍写对，面试官会关注边界条件；项目会一直追问到「为什么这么做」和「有没有更优方案」。建议：提前准备一个能讲 20 分钟的项目，把技术选型的取舍想清楚。'
  },
  {
    id: 'seed2_be_exp_ali', type: 'experience', cat: '后端开发', company: '阿里巴巴', author: '网友投稿', tags: ['后端', '二面'],
    title: '阿里后端二面（70 分钟）：系统设计 + 场景题',
    content: '流程：项目复盘 15 分钟 → 系统设计「设计一个短链服务」（考察哈希算法、发号器、缓存、302 与 301 的区别、过期与统计）→ 场景题「线上接口突然变慢怎么排查」→ 一道算法（TopK）→ 价值观类问题（最有成就感的事、与同事冲突怎么处理）。体感：系统设计没有标准答案，重点是边说边确认需求边界（数据量、QPS、存储时长），并主动说出瓶颈与扩展方案。建议：练 3-5 个经典设计题（短链、Feed 流、限流、秒杀、分布式锁）。'
  },
  {
    id: 'seed2_be_exp_tencent', type: 'experience', cat: '后端开发', company: '腾讯', author: '网友投稿', tags: ['后端', '交叉面'],
    title: '腾讯后端交叉面（45 分钟）：偏基础与编码规范',
    content: '流程：不考自我介绍，直接进入技术：一道算法（字符串处理）→ C++/Java 基础（多态、内存管理、智能指针）→ 网络（HTTP 状态码、长连接、WebSocket）→ 数据库（索引失效场景）→ 让你评价自己写过的代码有什么可以改进的地方。体感：交叉面面试官来自其他部门，更关注基本功与工程素养，不追业务。建议：准备「代码重构」类问题，能说出命名、异常处理、日志、可测试性四个方面的改进。'
  },
  {
    id: 'seed2_be_exp_bank', type: 'experience', cat: '后端开发', company: '国有银行软开', author: '网友投稿', tags: ['后端', '国企银行'],
    title: '银行软件开发中心面经：半结构化 + 技术基础',
    content: '流程：自我介绍 → 家庭情况与稳定性询问（是否有考研/考公计划、能否接受加班与出差）→ 技术基础（数据库事务、索引、Java 基础，难度低于互联网）→ 项目介绍 → 英语或行测类小问题 → 反问。体感：技术占四成，稳定性与沟通表达占六成；面试官很在意「是否了解我行」「为什么选择银行」。建议：提前了解该行的科技子品牌与主要系统，回答就业动机时突出长期发展与服务实体业务。'
  },

  /* ==================== 数据分析 · 面试题库（扩充） ==================== */
  {
    id: 'seed2_da_qa_pivot', type: 'qa', cat: '数据分析', tags: ['SQL', '行转列'],
    title: 'SQL 行转列与列转行怎么写？',
    content: '行转列：用 CASE WHEN 配合聚合，如 sum(case when subject = 语文 then score else 0 end) as 语文；或用 PIVOT（部分数据库支持）。列转行：用 UNION ALL 把多列拆成多行，或用 UNNEST / LATERAL VIEW explode（Hive）。答题要点：先问清目标形态，再说明「行转列的本质是条件聚合」，并提醒聚合函数要选对（数值用 sum/max，去重计数用 count distinct）。'
  },
  {
    id: 'seed2_da_qa_rank', type: 'qa', cat: '数据分析', tags: ['SQL', '窗口函数'],
    title: 'row_number / rank / dense_rank 的区别',
    content: '排序相同时：row_number 给出 1,2,3,4（不并列）；rank 给出 1,1,3,4（并列后跳号）；dense_rank 给出 1,1,2,3（并列后不跳号）。典型场景：取每个分组 Top N 用 row_number；算「并列第几名」用 rank；做连续等级划分用 dense_rank。答题要点：能写出完整句式 row_number() over (partition by 分组字段 order by 排序字段 desc)，并说明窗口函数与普通聚合的区别（不减少行数）。'
  },
  {
    id: 'seed2_da_qa_retention', type: 'qa', cat: '数据分析', tags: ['SQL', '留存'],
    title: '手写 SQL：计算次日留存率',
    content: '思路：用「首登表」左连接「第 N 日活跃表」。select a.dt, count(distinct a.user_id) as new_cnt, count(distinct b.user_id) as retain_cnt from (select user_id, min(dt) as dt from login group by user_id) a left join login b on a.user_id = b.user_id and b.dt = date_add(a.dt, 1) group by a.dt; 留存率 = retain_cnt / new_cnt。答题要点：先说清口径定义（新增用户中第 N 天仍活跃的占比），再说明「分母是当日新增、分子是其中次日活跃」，注意去重与日期函数差异。'
  },
  {
    id: 'seed2_da_qa_funnel', type: 'qa', cat: '数据分析', tags: ['漏斗', '路径分析'],
    title: '漏斗分析与路径分析分别解决什么问题？',
    content: '漏斗分析用于**已知固定路径**的转化衡量：曝光→点击→加购→下单→支付，看每一步转化率与流失，适合定位「哪一步掉得最狠」，可结合分群对比（渠道、新老用户、机型）找出异常人群。路径分析用于**未知路径**的探索：把用户行为串成序列，看主流路径、常见断点与回流，适合发现「用户实际怎么走」。答题要点：一句话区分「漏斗验证假设，路径发现假设」，并说明漏斗要固定时间窗口与步骤顺序，否则结果不可比。'
  },
  {
    id: 'seed2_da_qa_sample', type: 'qa', cat: '数据分析', tags: ['AB实验', '样本量'],
    title: 'AB 实验需要多少样本量？提前看结果有什么问题？',
    content: '样本量由四类因素决定：显著性水平（通常 0.05）、统计功效（通常 0.8）、基线转化率、最小可检测提升（MDE）。基线越低、MDE 越小，所需样本越大；可用在线计算器或公式 n ≈ 16 × p(1-p) / MDE² 快速估算。提前看结果（窥探）会显著抬高假阳性率，正确做法是**事先算好样本量与实验天数**，或采用序贯检验 / 贝叶斯方法。答题加分：提到「新奇效应」（老用户对改动初期反应异常）与「辛普森悖论」（分群与整体结论相反）。'
  },
  {
    id: 'seed2_da_qa_simpson', type: 'qa', cat: '数据分析', tags: ['统计学', '悖论'],
    title: '什么是辛普森悖论？实验中怎么避免？',
    content: '辛普森悖论指：分组看 A 都优于 B，但汇总后 B 反而优于 A，根源是**分组权重不均衡**（如实验组里高活跃用户占比更高）。避免方法：① 随机分流保证两组人群结构一致，实验后做「分流均匀性检验（AA 检验）」② 结论必须分群看，再加权汇总 ③ 关注分群样本量，避免小样本噪声。答题要点：能举一个具体例子（如两个渠道的转化率各自更高，但整体更低），并说出「先查分流是否均匀」。'
  },
  {
    id: 'seed2_da_qa_abnormal', type: 'qa', cat: '数据分析', tags: ['指标异动', '排查'],
    title: 'DAU 突然下跌 20%，你怎么排查？',
    content: '标准四步：① 先确认是不是数据问题——埋点是否上线变更、ETL 任务是否失败、口径是否调整、是否有重复计数或漏计 ② 若是真实下跌，做维度拆解——按渠道、地域、机型、版本、新老用户逐层下钻，定位受影响最大的人群 ③ 结合外部因素——竞品活动、节假日、政策、服务器故障、App 商店下架 ④ 给出结论与建议——归因到具体原因并提出可落地的修复/补偿方案。答题要点：强调「先验证数据真实性再找业务原因」，这是面试官最看重的一条。'
  },
  {
    id: 'seed2_da_qa_model', type: 'qa', cat: '数据分析', tags: ['数仓', '建模'],
    title: '数仓分层与星型模型、雪花模型',
    content: '常见分层：ODS（原始数据）→ DWD（明细清洗）→ DWS（轻度汇总）→ ADS（应用数据）。分层目的是解耦、复用、减少重复计算、便于回溯。星型模型：事实表直接连接各维度表，维度表非规范化，查询简单、性能好，适合分析场景；雪花模型：维度表再规范化拆分，节省存储但增加 Join，适合维度层级复杂、存储敏感的场景。答题要点：说清「事实表存度量、维度表存描述」，以及实际工作中更常用星型模型（用空间换查询性能）。'
  },
  {
    id: 'seed2_da_qa_track', type: 'qa', cat: '数据分析', tags: ['埋点', '数据质量'],
    title: '埋点方案怎么设计？数据质量怎么保证？',
    content: '埋点设计：明确事件三要素（事件名、属性、触发时机），统一命名规范（如 page_view / click_submit），区分「页面浏览、点击、曝光、自定义」四类，并维护埋点字典（字段含义、取值枚举、责任人）。数据质量：① 上线前埋点校验（抓包看上报参数）② 建监控看板（上报量突降/突增告警、空值率、枚举值异常）③ 定期做数据核对（与后端订单表对账）④ 明确口径文档，避免同一指标多种算法。答题要点：指出「埋点是数据质量的第一道关，返工成本极高」。'
  },
  {
    id: 'seed2_da_qa_case', type: 'qa', cat: '数据分析', tags: ['业务case', 'GMV'],
    title: '业务 case：本月 GMV 下降 15%，如何分析？',
    content: '先把 GMV 拆解为「流量 × 转化率 × 客单价」（或 用户数 × 购买频次 × 客单价），逐项对比环比与同比，定位是哪个因子下降。再逐层下钻：流量下降看渠道与投放；转化下降看漏斗各环节与商品供给；客单价下降看品类结构、促销力度、凑单策略。然后做归因：区分「季节性/大促退潮」等正常因素与「竞品冲击/缺货/价格调整」等异常因素。最后输出结论与建议（如恢复某渠道投放、补充某品类库存）。答题要点：先给拆解框架再下钻，切忌一上来就猜原因。'
  },

  /* ==================== 数据分析 · 简历模板（扩充） ==================== */
  {
    id: 'seed2_da_cv_skill', type: 'resume', cat: '数据分析', tags: ['简历', '技能'],
    title: '数据分析简历技能栏与工具栈写法',
    content: '工具层：SQL（熟练窗口函数、多表关联、性能优化）、Python（pandas / numpy / sklearn，能独立完成清洗与建模）、BI（Tableau / PowerBI / 帆软，能搭建看板）、Excel（数据透视表、函数）。能力层：指标体系搭建、AB 实验设计与解读、专题分析、数据可视化表达。写法示例：「熟练使用 SQL 完成复杂取数与指标计算，独立搭建过 XX 主题看板，覆盖 X 个业务指标」。原则：工具只写能现场写代码的，能力项必须能举出对应案例。'
  },
  {
    id: 'seed2_da_cv_case', type: 'resume', cat: '数据分析', tags: ['简历', '项目'],
    title: '数分简历里的「项目经历」怎么写才像做过',
    content: '结构：【业务背景】某业务 GMV 连续两月下滑，需定位原因 【分析思路】拆解 GMV = 流量 × 转化 × 客单价，逐层下钻到渠道与品类 【数据与方法】取数 X 万行，用 SQL 完成漏斗计算，用 Python 做显著性检验 【结论】定位为某渠道投放中断导致新客减少 30% 【落地】建议恢复投放并调整出价，次月新客回升 18%。关键：写清「你的假设是什么、用什么数据和方法验证、结论如何、推动了什么动作」，而不是只写「做了数据分析」。'
  },
  {
    id: 'seed2_da_cv_trap', type: 'resume', cat: '数据分析', tags: ['简历', '避坑'],
    title: '数据分析简历的 6 个常见坑',
    content: '① 只写工具不写业务（熟练 SQL/Python，但说不出解决过什么业务问题）② 项目全是课程作业（泰坦尼克、房价预测），同质化严重且无业务价值 ③ 写「数据分析」却不给任何数字 ④ 把看板搭建写成「做了可视化」，没说清指标口径与服务对象 ⑤ 技能栏写「精通机器学习」但只跑过 demo ⑥ 没有作品集链接。改进：优先写实习/真实的业务分析项目；课程项目要补上业务背景与结论；附上可访问的作品集（看板截图脱敏、分析文章链接）。'
  },
  {
    id: 'seed2_da_cv_nointern', type: 'resume', cat: '数据分析', tags: ['简历', '无实习'],
    title: '没有数据分析实习，简历怎么写',
    content: '三条替代路径：① 竞赛与开源——Kaggle / 天池名次、完整的数据分析 notebook（要写清特征工程思路与提升幅度）② 自主分析项目——爬取或用公开数据做一份完整专题分析（如某行业舆情、某城市房价），输出结论并写成文章发布，附链接 ③ 校内数据工作——帮实验室/社团做问卷分析、运营数据复盘，包装成业务问题。写法统一用「背景—方法—结论—落地」，并在简历里给出可验证的链接，让面试官有东西可追问。'
  },

  /* ==================== 数据分析 · 面经分享（扩充） ==================== */
  {
    id: 'seed2_da_exp_1', type: 'experience', cat: '数据分析', company: '互联网大厂', author: '网友投稿', tags: ['数据分析', '一面'],
    title: '大厂数据分析一面：SQL 手写 + 指标口径',
    content: '流程：自我介绍 → 三道 SQL（连续登录天数、留存、分组 TopN，要求当场写出且考虑执行效率）→ 指标口径题（DAU 与 MAU 的区别、活跃怎么定义为什么这么定义）→ 业务题（某指标下降怎么排查）→ 反问。体感：SQL 是硬门槛，写不出来基本就结束；指标题考察「是否真的理解口径而非背定义」。建议：把窗口函数、自连接、日期函数练到能盲写，并准备两个自己定义过指标的例子。'
  },
  {
    id: 'seed2_da_exp_2', type: 'experience', cat: '数据分析', company: '互联网大厂', author: '网友投稿', tags: ['数据分析', '二面'],
    title: '数据分析二面：AB 实验与业务理解深挖',
    content: '流程：项目深挖 30 分钟（追问为什么选这个指标、样本怎么选、结论是否显著、有没有做分群）→ AB 实验设计题（给一个具体改动，让你设计实验与评估指标）→ 开放业务题（如何提升某功能的渗透率）→ 反问。体感：面试官会不断追问「为什么」，考察思考的严谨性而非答案对错。建议：准备一个能讲透的项目，把「指标选择—实验设计—结果解读—落地动作」串成完整故事，并主动说出局限性。'
  },
  {
    id: 'seed2_da_exp_3', type: 'experience', cat: '数据分析', company: '互联网大厂', author: '网友投稿', tags: ['数据分析', 'HR面'],
    title: '数据分析 HR 面：动机、稳定性与 Offer 沟通',
    content: '高频问题：为什么选数据分析而不是开发/产品、你理解的数分价值是什么、遇到过最大的挫折、如何与业务方沟通分歧、期望薪资与手上的其他 offer。体感：HR 主要验证「求职动机是否真实、是否有长期做数据的意愿、沟通是否顺畅」。建议：准备一段清晰的职业叙事（为什么做数分—做过什么—想做什么），谈薪时先了解市场区间，给出区间而非单一数字，并说明可接受的其他条件（地点、团队、成长空间）。'
  },
  /* ==================== 产品经理 · 面试题库（扩充） ==================== */
  {
    id: 'seed2_pm_qa_compete', type: 'qa', cat: '产品经理', tags: ['竞品分析', '方法论'],
    title: '竞品分析怎么做才不是「抄功能清单」',
    content: '正确做法分四步：① 明确目的——是为进入新市场、优化某功能，还是找差异化；目的不同结论完全不同 ② 选对对象——直接竞品（同类用户同类需求）、间接竞品（不同形态但解决同一需求）、替代品 ③ 建立分析维度——目标用户、核心场景、功能结构、体验路径、商业化、数据表现，用同一套维度横向对比 ④ 输出结论——不是罗列，而是回答「我们该不该做、怎么做、凭什么能赢」。加分：能说出信息获取渠道（应用商店评论、行业报告、财报、用户访谈、亲自体验）。'
  },
  {
    id: 'seed2_pm_qa_need', type: 'qa', cat: '产品经理', tags: ['需求', '判断'],
    title: '如何判断一个需求是真需求还是伪需求',
    content: '四个验证方法：① 场景还原——用户是在什么时间、什么处境下产生这个需求，离开具体场景的需求多半是伪需求 ② 数据验证——看现有用户是否已经在用别的方式绕路解决（如用表格、用群），绕路行为越普遍需求越真 ③ 用户分层——是高价值用户的强需求，还是少数人的弱需求 ④ MVP 验证——用最小成本做原型或灰度，看真实使用率与留存。答题要点：区分「用户口头说的需求」与「用户真实行为暴露的需求」，并提到 KANO 模型区分基本型、期望型、兴奋型。'
  },
  {
    id: 'seed2_pm_qa_dau', type: 'qa', cat: '产品经理', tags: ['数据', '产品分析'],
    title: '产品视角：DAU 掉了 15% 你怎么处理',
    content: '与数据岗不同，产品岗要更强调「定位到可干预的产品动作」。流程：① 确认数据准确（埋点、口径、版本发布）② 拆解结构——新老用户、渠道、版本、功能入口，看是谁在流失 ③ 定性补充——看用户反馈、应用商店评论、客服工单，找与数据变化匹配的线索 ④ 归因到具体变更（某次改版、某策略调整、某渠道停投）⑤ 给出方案——回滚、优化、或补偿运营动作，并说明如何验证效果。答题要点：体现「数据 + 定性」双线验证，最后必须落到产品动作。'
  },
  {
    id: 'seed2_pm_qa_zero', type: 'qa', cat: '产品经理', tags: ['产品设计', '从0到1'],
    title: '从 0 到 1 设计一个功能，你的完整思路',
    content: '六步：① 定义问题——服务谁、在什么场景、解决什么痛点，给出用户画像与场景故事 ② 明确目标——北极星指标与阶段性目标（如首月渗透率 10%）③ 方案设计——核心路径画原型，列出关键分支与异常态 ④ 优先级——MVP 只做能验证主假设的最小集合，其余排期 ⑤ 验证——灰度或 AB 实验，定义成功标准 ⑥ 迭代——看数据、看反馈，决定放大、调整还是砍掉。答题要点：主动说明「MVP 范围如何裁剪」与「成功标准如何定义」，这两点最见功力。'
  },
  {
    id: 'seed2_pm_qa_bc', type: 'qa', cat: '产品经理', tags: ['B端', 'C端'],
    title: 'B 端产品和 C 端产品的核心差异',
    content: 'B 端：用户是角色（审批人、运营），需求来自业务流程，决策链长（使用者/采购者/决策者分离），重视效率、稳定、权限与集成，付费方明确，定制化需求多，指标看「任务完成时长、错误率、采纳率」。C 端：用户是个体，需求来自动机与情绪，决策快，重视体验、增长与留存，靠流量变现，指标看「DAU、留存、转化」。答题加分：指出 B 端容易陷入「被客户牵着做定制」，需要抽象共性需求做成标准能力。'
  },
  {
    id: 'seed2_pm_qa_push', type: 'qa', cat: '产品经理', tags: ['协作', '沟通'],
    title: '研发说做不了 / 排期不够，你怎么推进',
    content: '三步：① 先理解——听清「做不了」的真实原因（技术不可行、成本过高、收益不明、人力不足），不同原因对策不同 ② 用数据对齐收益——把这个需求的用户量、频次、对指标的预期影响讲清楚，让对方理解价值 ③ 找替代方案——拆分成两期、用现有能力组合实现、降低效果预期先上 MVP、或用人工流程验证再自动化。若仍不行，升级到共同上级决策，但要带着方案与数据而不是情绪。答题要点：强调「不是说服，而是对齐目标与成本」，尊重专业判断。'
  },
  {
    id: 'seed2_pm_qa_money', type: 'qa', cat: '产品经理', tags: ['商业化', '变现'],
    title: '一个产品的商业化方式有哪些，怎么选',
    content: '常见模式：广告（信息流、搜索、开屏）、增值服务（会员、虚拟道具）、交易抽成（电商、应用商店佣金）、订阅（SaaS 按席位/按用量收费）、数据与服务输出。选择依据：① 用户画像与付费意愿（to B 更适合订阅，大流量 to C 更适合广告）② 商业模式与用户体验的冲突程度（广告伤体验，会员需有独占权益）③ 单位经济模型（LTV > CAC）。答题要点：说明「先看用户规模与粘性，再选模式」，并提到免费增值（Freemium）的转化漏斗设计。'
  },
  {
    id: 'seed2_pm_qa_prd', type: 'qa', cat: '产品经理', tags: ['PRD', '文档'],
    title: '一份合格的 PRD 应该包含什么',
    content: '结构：① 背景与目标（为什么做、衡量指标）② 需求范围与优先级（本次做什么、明确不做什么）③ 用户故事与流程图（角色 + 场景 + 路径，包含异常与边界）④ 页面与交互说明（原型图、字段规则、状态变化、文案）⑤ 数据需求（埋点事件与属性）⑥ 非功能需求（性能、兼容、权限、安全）⑦ 上线与回滚方案。答题要点：强调 PRD 的目的是「让研发、测试、设计对同一件事有相同理解」，因此边界条件与异常态比主流程更重要。'
  },
  {
    id: 'seed2_pm_qa_research', type: 'qa', cat: '产品经理', tags: ['用户调研', '方法'],
    title: '用户调研有哪些方法，各自的坑',
    content: '方法：问卷（量大、可量化，但只能验证已知的假设）、深度访谈（挖掘动机，但样本小、易被引导）、可用性测试（看真实操作，发现体验问题）、数据分析（看真实行为，最客观）、竞品体验与评论分析。常见坑：① 问「你会不会用」——用户会说会，但不代表真的会用，要问过去行为 ② 只调研重度用户，忽略流失用户 ③ 样本单一导致结论偏颇 ④ 带着结论找证据。答题要点：定性与定量结合，用数据发现现象、用访谈解释原因。'
  },
  {
    id: 'seed2_pm_qa_fail', type: 'qa', cat: '产品经理', tags: ['复盘', '迭代'],
    title: '功能上线后数据不达预期，你怎么办',
    content: '先判断不达标的类型：① 没人用（触达不足、入口太深、需求本身弱）② 用了不留（首次体验差、价值感知弱）③ 用了但没带来业务价值（指标选错）。对应动作：触达问题看入口曝光与点击；体验问题做用户路径回放与访谈；价值问题回到目标重新定义指标。之后决定「优化—降权—下线」，并沉淀复盘（当时的假设错在哪、下次如何更早验证）。答题要点：体现「把失败当信息」，并说明如何更早用小成本验证假设。'
  },

  /* ==================== 产品经理 · 简历模板（扩充） ==================== */
  {
    id: 'seed2_pm_cv_skill', type: 'resume', cat: '产品经理', tags: ['简历', '技能'],
    title: '产品经理简历技能栏怎么写',
    content: '分三类写：工具（Axure / Figma / 墨刀，XMind，SQL，Excel/数据看板）、方法论（需求分析、竞品分析、用户调研、AB 实验、数据分析）、领域（如电商交易、内容社区、B 端 SaaS，写明熟悉该领域的业务流程）。示例：「能独立输出 PRD 与原型，熟悉漏斗分析与 AB 实验，具备电商交易链路的产品经验」。原则：领域经验比工具更重要，务必写清你熟悉的业务方向；不要写「精通 Axure」这类无意义表述。'
  },
  {
    id: 'seed2_pm_cv_nointern', type: 'resume', cat: '产品经理', tags: ['简历', '无实习'],
    title: '没有产品实习，怎么写出有说服力的产品经历',
    content: '四条路径：① 校园产品——运营过的公众号/社群/小程序，写出你做的改版、增长动作与数据 ② 产品分析报告——挑一个真实 App 做完整分析并输出改版方案，附链接，这是最有效的替代品 ③ 竞赛与项目——产品经理类比赛、创新训练项目，写清你的角色与产出 ④ 自主设计——从 0 设计一个解决真实痛点的小工具，哪怕没开发，完整的需求文档与原型也是有效证明。写法统一用「发现什么问题—如何验证—方案是什么—预期/实际效果」。'
  },
  {
    id: 'seed2_pm_cv_portfolio', type: 'resume', cat: '产品经理', tags: ['简历', '作品集'],
    title: '产品经理作品集怎么准备（附结构清单）',
    content: '建议包含 3 个案例，每个按此结构：① 项目背景与目标 ② 我的角色与职责 ③ 分析过程（用户调研、竞品、数据）④ 方案设计（流程图 + 原型截图）⑤ 结果与复盘（数据、未解决的遗憾）。呈现方式：做成在线文档或 PDF，控制在 15 页以内，截图注意脱敏。加分项：附一篇你对某产品的深度分析文章，展示思考深度。提醒：作品集重「思考过程」而非「界面美观」，面试官看的是你如何得出结论。'
  },
  {
    id: 'seed2_pm_cv_trap', type: 'resume', cat: '产品经理', tags: ['简历', '避坑'],
    title: '产品经理简历的 6 个常见坑',
    content: '① 只写「负责产品设计」不写具体模块与结果 ② 项目无数据（改版后转化率提升多少、覆盖多少用户）③ 经历与面试描述对不上，一追问就露怯 ④ 罗列一堆方法论名词却没有落地案例 ⑤ 把运营活动当产品成果（除非你确实做了产品侧改动）⑥ 自我评价写「热爱互联网、抗压能力强」这类空话。改进：每条经历写清「负责哪个模块、做了什么决策、带来什么变化」，并准备 2 个能讲 15 分钟的完整案例。'
  },

  /* ==================== 产品经理 · 面经分享（扩充） ==================== */
  {
    id: 'seed2_pm_exp_1', type: 'experience', cat: '产品经理', company: '互联网大厂', author: '网友投稿', tags: ['产品', '一面'],
    title: '大厂产品一面：需求分析 + 开放设计题',
    content: '流程：自我介绍 → 深挖一段经历（追问你为什么这么设计、有没有别的方案、数据如何）→ 开放题（如「为老年人设计一款买菜产品」「如何提升某功能的渗透率」）→ 反问。体感：开放题没有标准答案，看的是「能不能先澄清目标用户与场景，再给方案，并说明衡量标准」。建议：练 5 道开放题，固定用「明确用户与场景 → 拆解目标 → 给核心方案 → 定义指标 → 说优先级」的结构回答。'
  },
  {
    id: 'seed2_pm_exp_2', type: 'experience', cat: '产品经理', company: '互联网大厂', author: '网友投稿', tags: ['产品', '群面'],
    title: '产品群面（无领导小组）：怎么不被淹没',
    content: '流程：5-8 人一组，读题后自由讨论 25-30 分钟并汇报。高分策略：① 前 2 分钟快速搭框架（目标用户—核心场景—关键功能—衡量指标），抢到框架即抢到话语权 ② 中途做「时间控制者」或「归纳者」，推动讨论收敛 ③ 有分歧时不硬吵，用「我们的目标是什么」把讨论拉回主线 ④ 汇报时主动承担或补充他人遗漏的衡量指标。切忌：全程沉默、强行打断、只挑细节不贡献结构。建议：提前模拟 2-3 次，熟悉节奏。'
  },
  {
    id: 'seed2_pm_exp_3', type: 'experience', cat: '产品经理', company: '互联网大厂', author: '网友投稿', tags: ['产品', '总监面'],
    title: '产品总监面：看潜力、格局与自我认知',
    content: '高频问题：你做过最成功/最失败的事、你怎么看我们这个行业、你觉得自己三年后是什么样、你和别的候选人比优势在哪、你最近在用什么产品觉得哪里不好。体感：不考具体技能，看思考深度、好奇心与自我复盘能力；回答浮夸或背模板很容易被识破。建议：准备一段真实的失败复盘（说清当时的判断错在哪、后来怎么改），并真实体验过对方产品，能提出 2-3 个有洞察的改进点。'
  },

  /* ==================== 前端开发 · 面试题库（扩充） ==================== */
  {
    id: 'seed2_fe_qa_loop', type: 'qa', cat: '前端开发', tags: ['JavaScript', '事件循环'],
    title: 'JS 事件循环：宏任务与微任务执行顺序',
    content: '规则：同步代码先执行完 → 清空所有微任务（Promise.then、queueMicrotask、MutationObserver）→ 取一个宏任务（setTimeout、setInterval、I/O、UI 渲染）执行 → 再清空微任务 → 循环。经典输出题：console.log 同步 → Promise.then 微任务 → setTimeout 宏任务。答题要点：先说「同步 > 微任务 > 宏任务」，再说明 await 后面的代码相当于放进 then（微任务），能现场推导一段含 async/await 的输出顺序。'
  },
  {
    id: 'seed2_fe_qa_closure', type: 'qa', cat: '前端开发', tags: ['JavaScript', '闭包'],
    title: '什么是闭包？有什么用途和坑',
    content: '闭包是函数与其词法环境的组合——内层函数引用了外层函数的变量，且外层已执行完毕，这些变量仍被保留。用途：数据私有化（模拟私有变量）、函数柯里化、防抖节流、模块化。经典坑：循环中用 var 定义变量，所有闭包共享同一个 i，输出全是最终值；解决是用 let（块级作用域，每次循环生成新绑定）或 IIFE。另一个坑是内存泄漏：闭包持有大对象引用且未释放，需在不需要时手动置 null。'
  },
  {
    id: 'seed2_fe_qa_proto', type: 'qa', cat: '前端开发', tags: ['JavaScript', '原型'],
    title: '原型与原型链，一句话讲清楚',
    content: '每个对象都有内部属性 [[Prototype]]（可通过 __proto__ 访问），指向它的原型对象；构造函数有 prototype 属性，指向调用它创建的实例的原型。查找属性时，若对象自身没有，就沿 __proto__ 一层层向上找，直到 Object.prototype（其 __proto__ 为 null），这条链即原型链。答题要点：能画出「实例 → 构造函数.prototype → Object.prototype → null」的关系，并说明 ES6 class 只是语法糖，底层仍是原型继承。'
  },
  {
    id: 'seed2_fe_qa_vue', type: 'qa', cat: '前端开发', tags: ['Vue', '响应式'],
    title: 'Vue 响应式原理：Vue2 与 Vue3 的区别',
    content: 'Vue2 用 Object.defineProperty 劫持属性的 getter/setter，缺点是**无法监听新增/删除属性**、无法直接监听数组下标与长度变化（需重写数组方法），且需要递归遍历整个对象。Vue3 用 Proxy 代理整个对象，可以拦截新增、删除、数组索引等操作，惰性递归（用到才转换），性能更好。两者都在 getter 中收集依赖（Dep/Watcher 或 effect），在 setter 中触发更新。答题加分：提到 Vue3 的 ref/reactive 区别与 toRefs 的用途。'
  },
  {
    id: 'seed2_fe_qa_diff', type: 'qa', cat: '前端开发', tags: ['React', '虚拟DOM'],
    title: '虚拟 DOM 与 Diff 算法为什么更快',
    content: '虚拟 DOM 是用 JS 对象描述 DOM 结构，状态变化时先生成新树，与旧树做 Diff，再把差异批量更新到真实 DOM，从而避免频繁直接操作 DOM（重排重绘代价高）。React Diff 的三个策略：① 只做同层比较，跨层级移动直接重建 ② 同类型组件继续比较，不同类型直接替换 ③ 用 key 标识同层节点，提高复用率。答题要点：说明「虚拟 DOM 不一定比手写原生操作快，它的价值是保证下限与开发效率」，并强调 key 不能用 index（插入删除时会导致错误复用）。'
  },
  {
    id: 'seed2_fe_qa_cors', type: 'qa', cat: '前端开发', tags: ['网络', '跨域'],
    title: '跨域是什么？有哪些解决方案',
    content: '同源策略要求协议、域名、端口三者一致，否则即为跨域，浏览器会拦截响应（注意：请求其实已发出，是响应被拦）。方案：① CORS——服务端设置 Access-Control-Allow-Origin 等响应头，最标准；带 Cookie 时需 Allow-Credentials 且 Origin 不能为通配符 ② 开发环境用代理（webpack devServer / vite proxy），本质是服务端转发，无同源限制 ③ JSONP——利用 script 标签不受限，只支持 GET，已基本淘汰 ④ Nginx 反向代理。答题要点：能区分「简单请求与预检请求（OPTIONS）」。'
  },
  {
    id: 'seed2_fe_qa_perf', type: 'qa', cat: '前端开发', tags: ['性能优化', '首屏'],
    title: '前端性能优化：首屏加载慢怎么优化',
    content: '分阶段：① 网络层——上 CDN、开启 gzip/brotli、HTTP/2、合理缓存（强缓存 + 协商缓存）、域名预解析 ② 资源层——代码分割与路由懒加载、Tree Shaking、图片用 WebP 并做懒加载、按需引入组件库 ③ 渲染层——关键 CSS 内联、JS 放底部或 defer、骨架屏、避免强制同步布局 ④ 体验层——骨架屏与预渲染、接口合并与预取。衡量指标：FCP、LCP、CLS、TTI（Core Web Vitals）。答题要点：先说「先测量再优化」，用 Lighthouse/Performance 面板定位瓶颈。'
  },
  {
    id: 'seed2_fe_qa_cache', type: 'qa', cat: '前端开发', tags: ['浏览器', '缓存'],
    title: '强缓存与协商缓存的区别与流程',
    content: '强缓存：命中时不发请求，直接用本地副本，靠 Cache-Control（max-age，优先级高）与 Expires 控制；状态码显示 200 (from disk cache)。协商缓存：强缓存失效后，浏览器带 If-None-Match（对应 ETag）或 If-Modified-Since（对应 Last-Modified）询问服务端，若资源未变返回 304，浏览器继续用本地副本。ETag 更精确（可识别内容变化与秒级修改）。实践：HTML 用协商缓存，带 hash 的 JS/CSS 用强缓存并设较长 max-age。'
  },

  /* ==================== 前端开发 · 简历模板（扩充） ==================== */
  {
    id: 'seed2_fe_cv_skill', type: 'resume', cat: '前端开发', tags: ['简历', '技能'],
    title: '前端简历技能栏与项目写法',
    content: '技能写法要区分深度：掌握（能独立开发并解决常见问题）、熟悉（了解原理，能调优）、了解（用过但说不清原理）。示例：「熟悉 React 技术栈，理解虚拟 DOM 与 Diff 流程，能独立完成组件库封装」。项目写法重点：① 技术选型与原因 ② 你解决的难点（如长列表虚拟滚动、首屏优化、复杂表单状态管理）③ 量化结果（首屏从 3.2s 降到 1.1s，包体积减少 40%）。原则：不要罗列所有框架名，挑 2-3 个能讲透的。'
  },
  {
    id: 'seed2_fe_cv_proj', type: 'resume', cat: '前端开发', tags: ['简历', '项目'],
    title: '前端项目怎么写出技术含量（避免 todo 类项目）',
    content: 'todo、仿 XXX 页面这类项目已严重同质化。更有价值的选题：① 性能优化专项——对某个真实项目做首屏优化，给出前后指标对比 ② 组件库/工具库——封装并发布 npm 包，写清 API 设计与兼容性处理 ③ 工程化实践——搭建脚手架、实现埋点 SDK、搭建可视化搭建平台 ④ 复杂交互——长列表虚拟滚动、拖拽排版、富文本编辑器。写法统一：背景 → 难点 → 方案 → 结果（量化），并给出可访问的仓库或在线地址。'
  },
  {
    id: 'seed2_fe_cv_nointern', type: 'resume', cat: '前端开发', tags: ['简历', '无实习'],
    title: '没有前端实习，如何证明工程能力',
    content: '三件事最有说服力：① 可访问的在线作品——部署到 Vercel / Gitee Pages，简历附链接，面试官会真的打开看 ② 开源贡献——给知名项目提过 issue 或 PR，哪怕只修文档，也说明你读过源码 ③ 技术沉淀——写过系列笔记或复盘文章，展示你的思考深度。另外：把课程项目重新打磨（补上工程化配置、单元测试、README 与部署），比堆数量更有效。提醒：所有链接必须保证能打开，链接失效比没有更糟。'
  },

  /* ==================== 前端开发 · 面经分享（扩充） ==================== */
  {
    id: 'seed2_fe_exp_1', type: 'experience', cat: '前端开发', company: '互联网大厂', author: '网友投稿', tags: ['前端', '一面'],
    title: '前端一面：基础 + 手写题',
    content: '流程：自我介绍 → JS 基础（事件循环输出题、闭包、原型链、this 指向）→ CSS（BFC、垂直居中、flex 布局）→ 一道手写（防抖节流、深拷贝、Promise.all、数组扁平化）→ 反问。体感：手写题要求一次写对并考虑边界（如深拷贝要处理循环引用、Symbol、Date）。建议：把 10 个高频手写题练到肌肉记忆，写的时候先说思路再动手。'
  },
  {
    id: 'seed2_fe_exp_2', type: 'experience', cat: '前端开发', company: '互联网大厂', author: '网友投稿', tags: ['前端', '二面'],
    title: '前端二面：框架原理 + 工程化 + 项目深挖',
    content: '流程：项目深挖 20 分钟（为什么这么设计、遇到什么坑、如何优化）→ 框架原理（Vue/React 响应式或 Diff、组件通信、状态管理选型）→ 工程化（Webpack/Vite 构建优化、Tree Shaking、按需加载）→ 场景题（首屏优化、长列表渲染、权限设计）→ 反问。体感：更关注「你能否独立负责一个模块」，会追问技术选型的取舍。建议：准备一个做过性能优化的真实案例，能说出前后数据与具体手段。'
  },

  /* ==================== 算法工程师 · 面试题库（扩充） ==================== */
  {
    id: 'seed2_al_qa_overfit', type: 'qa', cat: '算法工程师', tags: ['机器学习', '基础'],
    title: '过拟合怎么判断、怎么解决',
    content: '判断：训练集准确率高但验证集明显下降，且两者差距随训练增大（学习曲线发散）。解决方案分四类：① 数据——增加数据量、数据增强、修正标签噪声 ② 模型——降低复杂度（减少层数/树深）、早停（early stopping）③ 正则化——L1（产生稀疏，可做特征选择）、L2（权重衰减）、Dropout、BatchNorm ④ 集成——Bagging 降低方差。答题加分：补充交叉验证与正确的划分方式（时序数据不能随机划分），以及「偏差-方差分解」的解释框架。'
  },
  {
    id: 'seed2_al_qa_tree', type: 'qa', cat: '算法工程师', tags: ['机器学习', '树模型'],
    title: 'LR、GBDT、XGBoost 的区别与选型',
    content: 'LR 是线性模型，可解释性强、易于在线学习与大规模部署，适合特征是线性可分、需要快速迭代的场景，但需要大量人工特征交叉。GBDT 是集成树模型，能自动做特征交叉、处理非线性，但对异常值敏感、难以并行。XGBoost/LightGBM 在 GBDT 基础上加了正则项、二阶泰勒展开、直方图加速与特征并行，精度与速度更好，是表格数据的首选。答题要点：表格数据优先树模型；需要可解释性与在线学习选 LR；并说明「没有免费午餐」，要按数据规模与业务要求选。'
  },
  {
    id: 'seed2_al_qa_attn', type: 'qa', cat: '算法工程师', tags: ['深度学习', 'Transformer'],
    title: 'Attention 与 Transformer 的核心思想',
    content: 'Attention 的本质是「按相关性加权聚合」：用 Query 与 Key 算相似度得分，softmax 归一化后对 Value 加权求和，公式为 Attention(Q,K,V) = softmax(QK^T / √dk) V。除以 √dk 是为了防止点积过大导致 softmax 梯度消失。Transformer 用多头自注意力并行捕捉不同子空间的关系，配合位置编码引入顺序信息，相比 RNN 可并行训练、长程依赖更强。答题加分：能说出多头的作用、残差与 LayerNorm 的意义，以及 Encoder-Decoder 与仅 Decoder（GPT）架构的差异。'
  },
  {
    id: 'seed2_al_qa_auc', type: 'qa', cat: '算法工程师', tags: ['评估指标', '机器学习'],
    title: 'AUC 是什么？类别不平衡时为什么不能只看准确率',
    content: 'AUC 是 ROC 曲线下面积，等价于「随机抽一个正样本和一个负样本，模型给正样本打分更高的概率」，取值 0.5-1，对正负样本比例不敏感，因此适合不平衡场景。准确率在 99% 负样本时，全预测负类也有 99% 准确率，毫无意义；此时应看精确率、召回率、F1、PR-AUC。选型：关注「抓全坏人」用召回率（风控、疾病筛查）；关注「不误伤」用精确率（推荐、推送）；需要权衡看 F1 或自定义代价。'
  },
  {
    id: 'seed2_al_qa_feature', type: 'qa', cat: '算法工程师', tags: ['特征工程', '机器学习'],
    title: '特征工程都有哪些环节，说说你做过的',
    content: '环节：① 数据清洗——缺失值（填充/删除/单独编码）、异常值（截断或分箱）、重复值 ② 特征构造——统计特征（计数、均值、比例、时间窗）、交叉特征、嵌入特征 ③ 特征变换——归一化/标准化、对数变换、分箱（WOE）、类别编码（One-Hot、Target Encoding、Embedding）④ 特征选择——过滤法（相关性、卡方）、包裹法（递归消除）、嵌入法（L1、树模型重要度）。答题要点：结合具体业务举例（如「对用户近 7/30 天的行为做时间窗统计」），并强调「避免用未来信息造成数据泄露」。'
  },
  {
    id: 'seed2_al_qa_cnn', type: 'qa', cat: '算法工程师', tags: ['深度学习', '基础'],
    title: 'CNN 与 RNN 各自适用什么场景，有什么局限',
    content: 'CNN 靠卷积核提取局部特征，具有参数共享与平移不变性，擅长图像、以及可视为局部模式的序列（如文本分类）；局限是感受野有限、不擅长长程依赖。RNN/LSTM 通过隐状态传递序列信息，天然处理变长序列；局限是无法并行、长序列易梯度消失（LSTM/GRU 用门控缓解，但仍有限）。现在序列任务多被 Transformer 取代。答题要点：说清「局部性与参数共享」、「时序与长程依赖」这两个核心差异，并补充感受野与并行度。'
  },
  {
    id: 'seed2_al_qa_lora', type: 'qa', cat: '算法工程师', tags: ['大模型', '微调'],
    title: '大模型微调：LoRA 是什么，为什么有效',
    content: '全参数微调大模型显存与存储成本极高（每个任务一份完整权重）。LoRA 冻结原模型权重，只在注意力层旁挂一个低秩分解的旁路（W + BA，其中 B、A 为低秩矩阵），只训练这两个小矩阵，参数量通常不到原模型的 1%，推理时可合并回原权重，不增加延迟。优势：显存占用低、切换任务只需换小文件、缓解灾难性遗忘。答题加分：提到常见的其他方案（Prefix Tuning、P-Tuning、QLoRA 量化微调）与 RLHF 的作用（对齐人类偏好）。'
  },
  {
    id: 'seed2_al_qa_code', type: 'qa', cat: '算法工程师', tags: ['手撕代码', '排序'],
    title: '手撕算法：快速排序与 TopK 的两种解法',
    content: '快排：选基准，分区（小于基准放左、大于放右），递归；平均 O(n log n)，最坏 O(n²)（有序数组取首元素为基准），优化方式是随机选基准或三数取中。TopK 两种解法：① 堆——维护大小为 K 的小顶堆，遍历数据，比堆顶大则替换，复杂度 O(n log K)，适合海量数据/流式 ② 快排分区思想（快速选择）——按分区位置决定只递归一侧，平均 O(n)，但会修改原数组。答题要点：说出「数据量小用排序，海量用堆」，并说明堆方法内存占用 O(K) 的优势。'
  },

  /* ==================== 算法工程师 · 简历模板（扩充） ==================== */
  {
    id: 'seed2_al_cv_skill', type: 'resume', cat: '算法工程师', tags: ['简历', '技能'],
    title: '算法岗简历：论文、竞赛、项目怎么排序',
    content: '优先级：顶会论文（一作 > 合作）> 有含金量的竞赛名次（Kaggle Master/金牌、天池 top）> 与岗位方向匹配的工业界实习 > 工程项目。写法：论文写明「会议/期刊、作者位次、核心贡献一句话」；竞赛写明「名次/参赛队伍数、方案亮点、提升幅度」；项目写清「数据规模、模型、指标提升、是否落地」。原则：算法岗最忌讳「跑通 demo」，必须写清「你的改进点是什么、为什么有效、提升多少」，并准备被追问细节。'
  },
  {
    id: 'seed2_al_cv_nopaper', type: 'resume', cat: '算法工程师', tags: ['简历', '无论文'],
    title: '无论文怎么投算法岗（可行的替代路径）',
    content: '① 明确方向——NLP/CV/推荐/风控选一个，避免「什么都做过一点」② 用竞赛证明能力——打 2-3 场高质量比赛，比赛方案要能讲清思路与消融实验 ③ 复现与改进——复现经典论文并做改进实验，写成技术报告或文章，重点是「有对照实验和结论」④ 工程能力补位——把模型部署成服务（ONNX/TensorRT、推理优化），这对应用型算法岗非常加分 ⑤ 瞄准应用算法岗——很多公司更看重落地能力而非论文。提醒：投递时优先选「应用算法/机器学习工程师」而非研究型岗位。'
  },

  /* ==================== 算法工程师 · 面经分享（扩充） ==================== */
  {
    id: 'seed2_al_exp_1', type: 'experience', cat: '算法工程师', company: '互联网大厂', author: '网友投稿', tags: ['算法', '一面'],
    title: '算法一面：代码 + 机器学习基础',
    content: '流程：一道算法题（链表/树/动态规划，要求白板写并优化）→ 机器学习基础（过拟合、LR 推导、树模型区别、评估指标）→ 项目/论文深挖（追问实验设计与消融结果）→ 反问。体感：代码必须一遍过，面试官会追问复杂度与边界；基础题要求「讲清推导」而非背结论（如 LR 的损失函数推导、信息增益计算）。建议：手撕题按专题刷（链表、二叉树、DP、二分、堆），每个专题练到 15 分钟内完成。'
  },
  {
    id: 'seed2_al_exp_2', type: 'experience', cat: '算法工程师', company: '互联网大厂', author: '网友投稿', tags: ['算法', '二面'],
    title: '算法二面：研究方向深挖 + 场景建模题',
    content: '流程：论文/项目深挖 30 分钟（创新点、实验设置、对比基线、为什么有效、局限性）→ 场景建模题（如「如何构建推荐召回模型」「如何做冷启动」「样本不平衡怎么处理」）→ 一道中等难度算法题 → 反问。体感：重点是「有没有科研品味」——能否说清自己的贡献边界与方法的适用范围。建议：准备一段 5 分钟的研究介绍，按「问题—现有方法不足—我的思路—实验—结论」组织，并主动说出方法的局限。'
  },
  /* ==================== 运营 · 面试题库（扩充） ==================== */
  {
    id: 'seed2_op_qa_activity', type: 'qa', cat: '运营', tags: ['活动策划', '方法论'],
    title: '一场活动从策划到复盘怎么做',
    content: '五步：① 定目标——拉新、促活、转化还是品牌，指标要唯一且可量化（如新增注册 5000、GMV 50 万）② 定人群与钩子——谁参与、给什么利益（优惠、权益、荣誉、社交货币）③ 设计路径——入口、参与门槛、分享机制、履约，尽量缩短路径、降低参与成本 ④ 资源与排期——渠道、预算、物料、风险预案（库存、并发、客诉）⑤ 复盘——对比目标看达成，拆解漏斗找流失，沉淀可复用的结论。答题要点：一定要说「目标只有一个主指标」和「复盘要落到下次怎么改」。'
  },
  {
    id: 'seed2_op_qa_community', type: 'qa', cat: '运营', tags: ['社群', '私域'],
    title: '社群运营怎么做才不会变成死群',
    content: '关键在「定位 + 节奏 + 角色」：① 定位清晰——这个群为谁解决什么问题（答疑、福利、同好交流），进群前就要说清楚 ② 有固定节奏——每日/每周固定栏目（早报、话题、答疑、福利日），让用户形成预期 ③ 培养 KOC——找到活跃用户给予身份与权益，让他们产出内容 ④ 及时清理与分层——沉默用户单独运营，核心用户进高阶群 ⑤ 设置生命周期——活动群到期解散，避免稀释。答题加分：提到社群的衡量指标（活跃率、发言人数、转化率）与「死群的三个信号」。'
  },
  {
    id: 'seed2_op_qa_segment', type: 'qa', cat: '运营', tags: ['用户分层', '精细化'],
    title: '用户分层怎么做，RFM 模型是什么',
    content: 'RFM 三个维度：R（Recency 最近一次消费距今天数）、F（Frequency 消费频次）、M（Monetary 消费金额）。把每个维度按高低二分，可分成 8 类人群，如重要价值客户（R 高 F 高 M 高）、重要保持客户、一般发展客户、流失客户等，针对不同人群给不同策略（高价值给专属服务，流失用户做召回）。答题要点：分层不是为了分类，而是为了「不同人群给不同动作」，并说明分层要结合业务（内容产品可用「浏览频次 + 互动深度」替代消费指标）。'
  },
  {
    id: 'seed2_op_qa_private', type: 'qa', cat: '运营', tags: ['私域', '增长'],
    title: '私域流量到底是什么，怎么做起来',
    content: '私域指品牌可反复触达、免费触达的自有用户池（企微好友、社群、公众号、小程序会员）。做法：① 引流——包裹卡、门店导购、公域内容、广告投放把用户沉淀到企微/社群 ② 承接——首次触达给明确价值（优惠券、资料、专属服务），并打标签 ③ 分层运营——按标签做差异化内容与推送，避免无差别群发 ④ 转化与复购——活动、会员日、1v1 推荐 ⑤ 指标——好友增量、留存率、社群活跃、私域 GMV 占比。答题要点：强调「私域的核心是信任与长期关系，不是加好友数量」。'
  },
  {
    id: 'seed2_op_qa_content', type: 'qa', cat: '运营', tags: ['内容运营', '新媒体'],
    title: '内容运营如何稳定产出爆款',
    content: '爆款不可完全复制，但可以提高概率：① 建立选题库——从用户评论、搜索词、竞品热门、行业热点持续积累，而不是临场想 ② 固定内容骨架——标题公式（数字、悬念、利益点、对比）、开头三秒钩子、结构化表达 ③ 数据驱动迭代——拆解自己的历史数据（完播率、点赞率、转发率），找出高表现元素的共性 ④ 发布节奏与测试——固定频次，同一内容做多版本 A/B 测标题与封面 ⑤ 复用——爆款内容拆解重组，做成系列。答题要点：说清「用机制对抗灵感不稳定」，并给出你复盘过的具体数据。'
  },
  {
    id: 'seed2_op_qa_recall', type: 'qa', cat: '运营', tags: ['召回', '增长'],
    title: '沉默用户召回有哪些手段，怎么评估效果',
    content: '手段：push/短信（成本低、覆盖广，但易被屏蔽）、邮件、企微 1v1、电话（高价值用户）、站内信、广告重定向（再营销）、权益激励（回归礼包）。做法：① 先定义沉默（如 30 天未活跃）② 分层——按历史价值决定投入成本，高价值用人工与权益，低价值用批量 ③ 给回归理由——新功能、专属权益、内容更新，而不是空洞的「好久不见」④ 控制频次避免骚扰。评估：召回率、回归后 7 日留存、召回用户的后续付费；**必须设对照组**才能判断是召回有效还是自然回流。'
  },
  {
    id: 'seed2_op_qa_kol', type: 'qa', cat: '运营', tags: ['投放', 'KOL'],
    title: 'KOL 投放怎么选人、怎么判断值不值',
    content: '选人：① 看人群匹配而非单纯粉丝量——账号粉丝画像与目标用户是否重合 ② 看互动质量——点赞评论的真实度、评论区是否为水军、是否存在刷量（点赞与评论比异常、粉丝增长曲线突兀）③ 看历史带货/转化数据，优先复用已验证的账号 ④ 组合投放——头部做声量、腰尾部做转化与铺量。评估：CPM（千次曝光成本）、CPE（单次互动成本）、ROI，以及更长期的新客获取成本与留存。要点：小预算先小规模测试，跑出数据再放量。'
  },
  {
    id: 'seed2_op_qa_review', type: 'qa', cat: '运营', tags: ['复盘', '数据分析'],
    title: '活动效果不达标，复盘报告怎么写',
    content: '结构：① 目标与达成（差多少，按主指标与过程指标分别看）② 拆解漏斗——曝光、点击、参与、转化各环节数据，定位掉得最狠的一步 ③ 归因——区分「方案问题」（钩子不够、路径太长）、「执行问题」（渠道没上、时间不对）、「外部因素」（竞品活动、节假日）④ 用户反馈与定性补充 ⑤ 沉淀——下次可复用的经验与要避免的坑，写成 checklist。答题要点：复盘不是找锅，而是产出「可执行的下次动作」；并强调「事前就要定好成功标准与数据埋点」。'
  },

  /* ==================== 运营 · 简历模板（扩充） ==================== */
  {
    id: 'seed2_op_cv_skill', type: 'resume', cat: '运营', tags: ['简历', '技能'],
    title: '运营简历技能栏与经历写法',
    content: '技能分三类：内容（选题、文案、排版、剪辑）、用户（社群、分层、活动策划）、数据（Excel、SQL 基础、看板搭建、AB 实验）。经历写法模板：【目标】为提升某指标 【动作】策划并执行 XX 活动/搭建 XX 社群/产出 XX 篇内容 【结果】曝光 X 万，参与 X 人，转化率 X%，环比提升 X%。原则：运营简历最忌「负责日常运营」，必须写清「做了什么动作、带来什么数字」，并附上作品（活动方案、文案、数据截图脱敏）。'
  },
  {
    id: 'seed2_op_cv_portfolio', type: 'resume', cat: '运营', tags: ['简历', '作品集'],
    title: '运营作品集准备清单',
    content: '建议包含：① 一份完整的活动方案（背景、目标、玩法、路径、预算、风险预案、复盘数据）② 3-5 篇代表性内容（公众号文章、短视频脚本、海报文案），注明阅读量/播放量/转化 ③ 社群运营案例（群规模、活跃率、转化率截图脱敏）④ 一份数据分析报告（用数据发现问题并给出建议）。呈现：PDF 或在线文档，控制在 10-15 页，每个案例配「我的角色」说明。提醒：数据必须真实可解释，面试官会追问数字来源与你的具体贡献。'
  },
  {
    id: 'seed2_op_cv_nointern', type: 'resume', cat: '运营', tags: ['简历', '无实习'],
    title: '没有运营实习，怎么证明能力',
    content: '最有效的是「自己做一个可验证的账号或项目」：① 运营一个真实账号（公众号/小红书/抖音），哪怕只有几百粉丝，能说清「定位—选题—数据—迭代」就是有力证明 ② 策划并执行一场校园活动，写出参与人数与转化 ③ 帮校内组织做社群或内容运营，产出数据 ④ 做一份竞品运营拆解报告。写法要点：用「我做了什么—数据如何—我从中学到什么」的结构，并强调「从 0 到 1」的过程，面试官看重的是方法论意识而非绝对规模。'
  },

  /* ==================== 运营 · 面经分享（扩充） ==================== */
  {
    id: 'seed2_op_exp_1', type: 'experience', cat: '运营', company: '互联网公司', author: '网友投稿', tags: ['运营', '一面'],
    title: '运营一面：经历深挖 + 活动策划题',
    content: '流程：自我介绍 → 深挖一段运营经历（数据、你的具体动作、遇到什么问题）→ 现场出题（如「为某产品策划一场拉新活动」「某社群活跃度下降怎么办」）→ 反问。体感：非常看重「有没有真实做过事」，数字一追问就穿帮；策划题看结构是否完整（目标—人群—玩法—路径—指标）。建议：准备 1 个能讲透的活动案例，把背景、你的动作、数据、复盘结论全部背熟，并主动说出失败之处。'
  },
  {
    id: 'seed2_op_exp_2', type: 'experience', cat: '运营', company: '互联网公司', author: '网友投稿', tags: ['运营', '二面'],
    title: '运营二面：数据意识与跨部门协作',
    content: '流程：项目复盘 20 分钟 → 数据分析题（给一组数据让你发现问题并提建议）→ 协作题（与设计/研发/产品意见不一致怎么办）→ 对行业与竞品的看法 → 反问。体感：二面关注「能否独立负责一个业务模块」，会问你如何排优先级、如何在资源有限时取舍。建议：准备一个「资源有限但达成目标」的例子，展示取舍逻辑；并提前体验对方产品，能提出具体的运营改进建议。'
  },

  /* ==================== 财务 · 面试题库（扩充） ==================== */
  {
    id: 'seed2_fin_qa_report', type: 'qa', cat: '财务', tags: ['财务', '三大报表'],
    title: '三大报表分别看什么，之间如何勾稽',
    content: '资产负债表看「某一时点的家底」（资产 = 负债 + 所有者权益）；利润表看「一段时间的经营成果」（收入 - 费用 = 净利润）；现金流量表看「钱怎么进出的」，分经营、投资、筹资三类，最能反映真实造血能力。勾稽关系：利润表净利润转入资产负债表未分配利润（扣除分红后）；现金流量表期末现金等于资产负债表货币资金；净利润与经营现金流通过「间接法」调整（加回折旧摊销、调整应收应付与存货变动）。答题要点：能说出「有利润没现金流」的常见原因（大量赊销、囤积库存）。'
  },
  {
    id: 'seed2_fin_qa_dupont', type: 'qa', cat: '财务', tags: ['财务分析', '杜邦'],
    title: '杜邦分析：净资产收益率怎么拆解',
    content: 'ROE（净资产收益率）= 销售净利率 × 总资产周转率 × 权益乘数，分别对应「盈利能力、营运能力、杠杆水平」。拆解意义：ROE 高不一定好——可能来自高杠杆（风险大）而非经营效率；通过对比三项可以定位驱动因素并给出建议（提毛利、加速周转、优化资本结构）。答题加分：提到改进的杜邦分析（引入利息负担与税收负担率），以及分析时要做同业对比与趋势对比，单看绝对值无意义。'
  },
  {
    id: 'seed2_fin_qa_ratio', type: 'qa', cat: '财务', tags: ['财务分析', '指标'],
    title: '常用财务分析指标与解读要点',
    content: '偿债能力：流动比率（2 左右较健康）、速动比率、资产负债率、利息保障倍数。营运能力：应收账款周转天数（越短越好，但过严可能影响销售）、存货周转天数、总资产周转率。盈利能力：毛利率（反映产品竞争力与成本结构）、净利率、ROE、ROA。现金流：经营现金流净额与净利润的比值（持续小于 1 需警惕）。答题要点：指标必须结合行业特性与趋势看，并说出「异常背后的业务原因」，而不是只报数字。'
  },
  {
    id: 'seed2_fin_qa_cost', type: 'qa', cat: '财务', tags: ['成本', '核算'],
    title: '成本核算方法有哪些，怎么选',
    content: '常见方法：品种法（大量大批单步骤生产，如发电）、分批法（按订单/批次核算，适合定制与小批量，如设备制造）、分步法（多步骤连续生产，如化工纺织）、作业成本法 ABC（按作业动因分摊间接费用，适合间接成本高、产品差异大的企业）。选择依据：生产组织特点（大量/单件）、工艺过程（单步骤/多步骤）、管理要求。答题加分：说明「传统方法按人工工时分摊制造费用会导致成本扭曲，ABC 能更准确反映产品真实耗用」。'
  },
  {
    id: 'seed2_fin_qa_excel', type: 'qa', cat: '财务', tags: ['Excel', '实操'],
    title: '财务岗 Excel 必会技能清单',
    content: '必会：数据透视表（多维汇总，财务最常用的工具）、SUMIFS/COUNTIFS（多条件汇总）、VLOOKUP/XLOOKUP（跨表匹配）、INDEX + MATCH（更灵活的匹配）、IFERROR（容错）、TEXT/DATE 类函数（日期与文本处理）、条件格式（异常标红）、分列与数据验证。进阶：Power Query（自动化清洗多表合并）、数组公式、宏与 VBA（批量处理）。面试常考现场操作：给你两张表做匹配与汇总。建议：准备一个「用透视表 10 分钟完成月度报表」的真实案例。'
  },

  /* ==================== 财务 · 简历模板（扩充） ==================== */
  {
    id: 'seed2_fin_cv_skill', type: 'resume', cat: '财务', tags: ['简历', '技能'],
    title: '财务简历技能与经历写法',
    content: '技能：核算（熟悉企业会计准则、能独立完成凭证到报表全流程）、税务（增值税、企业所得税申报）、分析（财务分析、预算编制、成本控制）、工具（Excel 高级功能、金蝶/用友、Power BI 加分）、证书（初级/中级会计、CPA 通过科目、ACCA 进度、税务师）。经历写法：【职责】负责 XX 模块核算/报表/税务申报 【量化】月均处理凭证 X 笔，参与年度审计 X 次，编制预算覆盖 X 个部门 【成果】发现并纠正 XX 差错、优化某流程使月结周期缩短 X 天。'
  },
  {
    id: 'seed2_fin_cv_nointern', type: 'resume', cat: '财务', tags: ['简历', '无实习'],
    title: '财务岗无实习：简历怎么写',
    content: '① 证书优先——把 CPA/ACCA/初级会计的通过科目写在显眼位置，这是最有效的能力证明 ② 课程项目转化——把「会计模拟实训」「财务分析课程设计」写成项目，说明你完成了什么（编制三张报表、做了一次杜邦分析）③ 校园财务相关工作——社团或实验室的经费管理，写清金额与规范 ④ 竞赛——会计/税务/案例分析类比赛。写法要点：强调「规范性与准确性」，财务岗最看重细致与合规意识，简历本身排版整洁、无错别字就是第一张名片。'
  },

  /* ==================== 财务 · 面经分享（扩充） ==================== */
  {
    id: 'seed2_fin_exp_1', type: 'experience', cat: '财务', company: '企业/事务所', author: '网友投稿', tags: ['财务', '面经'],
    title: '财务岗面经：专业知识 + 稳定性考察',
    content: '流程：自我介绍 → 专业知识（三大报表、税种、折旧方法、收入确认）→ Excel 实操或笔试（部分公司现场考）→ 实习/项目深挖（做过哪些科目、遇到过什么差错）→ 稳定性与职业规划（是否考研考公、能否接受加班与月末结账）→ 反问。体感：专业基础扎实是硬门槛，Excel 手速经常被现场检验。建议：复习核心会计准则与常用税种税率，准备一个「发现并纠正错误」的例子体现细致，并明确表达长期从事财务工作的意愿。'
  },

  /* ==================== 通用 · 面试题库（扩充） ==================== */
  {
    id: 'seed2_ge_qa_intro', type: 'qa', cat: '通用', tags: ['自我介绍', '行为面'],
    title: '自我介绍怎么说才不像背简历',
    content: '推荐结构「一个定位 + 两个证据 + 一个动机」：① 定位——一句话说清你是谁（XX 方向，具备 XX 能力）② 证据——挑 1-2 个与目标岗位最相关的经历，用「做了什么 + 结果数字」证明，不要复述简历 ③ 动机——为什么投这个岗位/公司，体现你做过功课。时长控制在 60-90 秒。避坑：不要按时间线流水账、不要罗列所有经历、不要说空泛形容词（勤奋、热爱）。练习方法：录音回听，确保去掉所有口头禅，并能应对「挑一段展开讲讲」的追问。'
  },
  {
    id: 'seed2_ge_qa_why', type: 'qa', cat: '通用', tags: ['动机', '行为面'],
    title: '「为什么选择我们公司」高分答法',
    content: '三层递进：① 行业与业务——认可该业务的方向或市场地位，说出具体了解（某产品、某数据、某战略）② 岗位匹配——这个岗位需要的能力与我的经历如何对应，给出具体例子 ③ 个人成长——在这里能获得什么（技术挑战、业务复杂度、团队氛围）。避坑：不要说「因为你们是大厂/平台大/待遇好」，也不要背官网介绍。加分：提到你真实使用过对方产品并有一个自己的观察。注意：不同公司要换具体理由，面试官能听出是否通用模板。'
  },
  {
    id: 'seed2_ge_qa_weak', type: 'qa', cat: '通用', tags: ['缺点', '行为面'],
    title: '「你最大的缺点」怎么回答不加分也不扣分',
    content: '原则：说真实但不致命的缺点，并一定要给出改进动作与进展。公式：缺点（具体、与岗位核心能力不冲突）+ 造成的影响 + 你采取的措施 + 当前改善情况。示例：「我以前做方案容易追求完美导致交付偏晚，后来学会先定 MVP 范围并按优先级排期，最近两个项目都按期交付。」避坑：不要说「我太拼了/追求完美」这类伪装成优点的空话；也不要暴露与岗位硬要求冲突的短板（如应聘财务说自己粗心）。'
  },
  {
    id: 'seed2_ge_qa_plan', type: 'qa', cat: '通用', tags: ['职业规划', '行为面'],
    title: '你的职业规划是什么（应届生版）',
    content: '建议按「1 年 / 3 年」两档回答，突出「先扎实做事」：1 年内——快速熟悉业务与技术栈，能独立负责一个模块，把基础打牢；3 年——成为某个方向可独当一面的人，能带小项目或影响团队决策。避坑：不要说「三年后想做管理」（显得浮躁），也不要说「还没想过」（缺乏规划）。加分：把规划与该公司能提供的发展路径挂钩，说明你了解这个岗位的成长路线。'
  },
  {
    id: 'seed2_ge_qa_ask', type: 'qa', cat: '通用', tags: ['反问', '行为面'],
    title: '反问环节问什么最加分',
    content: '推荐三类问题：① 业务与技术——「团队目前最有挑战的技术/业务问题是什么」「这个岗位未来半年最重要的目标是什么」② 团队协作——「日常如何与产品/设计协作，需求怎么排期」「新人有怎样的培养与 mentor 机制」③ 成长反馈——「您觉得在这个岗位做得好的人有什么共同特质」。避坑：不要问薪资福利（留给 HR 面）、不要问网上能查到的基础信息、不要问「我今天表现怎么样」。反问是展示你思考深度的机会，务必准备 2-3 个。'
  },
  {
    id: 'seed2_ge_qa_salary', type: 'qa', cat: '通用', tags: ['谈薪', 'Offer'],
    title: '谈薪怎么谈：时机、口径与底线',
    content: '时机：等对方明确表示要发 offer 再谈，不要主动先报数字；被问期望薪资时给区间而非单点，区间下限是你可接受的底线。口径：用市场行情与自身依据支撑（同岗位行情、你的实习/项目/竞赛、手上其他 offer），而不是「我觉得我值」。策略：先了解对方预算（「这个岗位的薪资范围是多少」），再在区间内取上沿。多 offer 可如实说明（不透露具体公司名），争取匹配。注意：把总包拆开看（月薪、年终、股票、补贴、公积金基数），并确认试用期比例与绩效规则。'
  },
  {
    id: 'seed2_ge_qa_group', type: 'qa', cat: '通用', tags: ['群面', '无领导小组'],
    title: '群面（无领导小组讨论）通关要点',
    content: '角色选择：leader（搭框架、控节奏，风险高收益高）、timer（控时间，稳）、recorder（记录归纳，稳）、reporter（汇报，加分）、member（贡献观点）。高分行为：① 开场快速给出分析框架 ② 主动推进讨论收敛，避免陷入细节 ③ 用数据或逻辑说服而非音量 ④ 适当让步并记录他人观点，体现协作 ⑤ 汇报时结构清晰。低分行为：全程沉默、频繁打断、固执己见、只挑刺不建设。建议：提前练习 3-5 次，熟悉常见题型（排序类、方案类、辩论类、资源分配类）。'
  },
  {
    id: 'seed2_ge_qa_pressure', type: 'qa', cat: '通用', tags: ['压力面', '应对'],
    title: '压力面：被质疑、被否定时怎么应对',
    content: '先识别：压力面通常是故意质疑你的经历、指出方案漏洞、或沉默施压，目的是看你的情绪稳定性与应变。应对三步：① 不辩解不慌乱，先确认对方的问题（「您的意思是担心 X 对吗」）② 用事实与逻辑回应，承认不确定的部分（「这块我确实没有深入，我的理解是…」）③ 主动给出改进方案或补充视角。避坑：不要硬刚、不要沉默到底、不要为了讨好而全盘否定自己。要点：面试官看的是「你在压力下是否还能清晰思考」，诚实比圆滑更得分。'
  },

  /* ==================== 通用 · 简历模板（扩充） ==================== */
  {
    id: 'seed2_ge_cv_onepage', type: 'resume', cat: '通用', tags: ['简历', '排版'],
    title: '一页纸原则与排版规范',
    content: '应届生简历严格一页。排版顺序：基本信息（姓名、电话、邮箱、求职意向、所在地）→ 教育背景（学校、专业、学历、时间、GPA/排名若优秀）→ 实习/项目经历（最重要的放最前，2-3 段）→ 技能与证书 → 其他（竞赛、学生工作，若与目标岗位相关）。排版规范：字体统一（推荐思源黑体/苹方）、字号 10.5-12pt、边距不小于 1.5cm、时间右对齐、使用项目符号、全篇对齐方式一致。输出 PDF 并命名为「姓名-岗位-学校.pdf」，避免 Word 排版错乱。'
  },
  {
    id: 'seed2_ge_cv_check', type: 'resume', cat: '通用', tags: ['简历', '自检'],
    title: '投递前简历自检 10 条清单',
    content: '① 是否有错别字与中英文标点混用 ② 手机号与邮箱是否正确且可联系 ③ 是否一页 ④ 每段经历是否都有动词开头 + 量化结果 ⑤ 时间线是否连贯无空档（有空档要能解释）⑥ 技能栏是否每一项都能被追问 ⑦ 是否针对该岗位调整了重点（不要用同一份海投）⑧ 数字是否真实且能说出来源 ⑨ 是否出现「精通」「负责全面工作」等空话 ⑩ 是否导出 PDF 并确认手机端打开排版正常。建议：投递前让同学交叉检查一遍，自己写的东西最容易看不出错。'
  },
  {
    id: 'seed2_ge_cv_star', type: 'resume', cat: '通用', tags: ['简历', 'STAR'],
    title: 'STAR 法则写经历：四步模板',
    content: 'S（Situation 背景）：一句话说清项目背景与难点，如「某系统日均订单 10 万，高峰期接口超时率 5%」。T（Task 任务）：你负责什么，「我负责订单查询模块的性能优化」。A（Action 行动）：你具体做了什么、用了什么方法，「通过慢查询分析定位到缺少联合索引，并引入 Redis 缓存热点数据，用 Lua 保证原子更新」。R（Result 结果）：量化结果，「P99 从 900ms 降至 130ms，超时率降至 0.2%」。要点：A 要写「你的动作」而非团队动作；R 必须有数字。'
  },
  {
    id: 'seed2_ge_cv_english', type: 'resume', cat: '通用', tags: ['简历', '英文'],
    title: '英文简历注意事项（外企 / 出海岗位）',
    content: '格式：一页，无照片（欧美惯例），不用表格与图形（ATS 系统解析会错乱）。用词：动词开头用过去式（Developed、Led、Optimized），避免 very / responsible for 这类弱表达；用具体动词（Reduced latency by 60%）。内容：教育、经历、技能、项目，经历写 3-5 条 bullet，每条含动作 + 量化结果。避坑：不要直译中文简历的套话；不要写年龄、婚姻、政治面貌（可能涉及歧视敏感项）；英文表达请让母语者或靠谱工具校对一遍语法。'
  },
  {
    id: 'seed2_ge_cv_email', type: 'resume', cat: '通用', tags: ['简历', '投递'],
    title: '邮件投递的标题与正文怎么写',
    content: '标题：按招聘要求写；若未要求，用「姓名-学校-应聘岗位-可实习时间-最快到岗时间」，让 HR 一眼获取关键信息。正文：简短三段——① 我是谁、应聘什么岗位 ② 为什么匹配（2-3 句，挑最相关的经历与数字）③ 附件说明与联系方式、可到岗时间。附件：PDF 简历，命名与标题一致；若有作品集可附链接而非大附件。避坑：不要空正文直接发附件、不要群发抄送多个 HR、不要用奇怪的邮箱昵称（建议用姓名拼音）。投递后可在 3-5 个工作日无回复时礼貌跟进一次。'
  },
  {
    id: 'seed2_ge_cv_cross', type: 'resume', cat: '通用', tags: ['简历', '跨专业'],
    title: '跨专业 / 低相关背景怎么补救',
    content: '策略：① 找交集——从原专业中提炼可迁移能力（如机械转产品：有硬件理解，适合 IoT 产品；化学转数据：有实验设计思维）② 补证据——用项目、竞赛、证书、作品集证明你已具备目标岗位能力，而不是只说「我很感兴趣」③ 针对性改简历——删减无关经历篇幅，把相关课程、自学项目、实习放到前面 ④ 动机讲清楚——在简历或求职信里说明转行原因与准备过程，消除「一时冲动」的疑虑。要点：跨专业不是劣势，缺乏证据才是；用可验证的产出代替口头热情。'
  },

  /* ==================== 通用 · 面经分享（扩充） ==================== */
  {
    id: 'seed2_ge_exp_group', type: 'experience', cat: '通用', company: '多家公司综合', author: '网友投稿', tags: ['群面', '经验'],
    title: '群面实录：30 分钟排序题怎么拿高分',
    content: '题目形式：给 8 个选项按重要性排序并说明理由。高分做法：① 前 3 分钟提议「先定评判标准再排序」，如按「影响人数 × 紧急程度 × 可行性」三维度打分，立刻与其他候选人拉开差距 ② 主动承担记录，把大家观点结构化写在纸上 ③ 出现僵持时提出「先按多数意见通过，剩余时间再回顾」④ 汇报时用「结论 + 三个理由 + 一个风险补充」。失败案例：全程纠结某一项的排序、或只说「我同意」没有增量。核心：群面考察的是推动团队产出结论的能力。'
  },
  {
    id: 'seed2_ge_exp_hr', type: 'experience', cat: '通用', company: '多家公司综合', author: '网友投稿', tags: ['HR面', '经验'],
    title: 'HR 面高频问题与应答思路',
    content: '高频：自我介绍 / 为什么选我们 / 手上有哪些 offer、如何比较 / 期望薪资 / 能实习多久、何时到岗 / 家庭情况与支持度 / 遇到的最大挫折 / 是否考研考公。应答原则：① 动机类回答要具体且真实，避免套话 ② offer 比较要围绕「业务方向、成长空间、团队」而非只谈钱 ③ 稳定性问题要给出明确承诺（可实习时长、到岗时间）④ 挫折题展示复盘能力而不是抱怨。反问环节可问培养机制、团队构成、晋升路径。提醒：HR 面也要认真准备，因「求职意愿不明确」被刷的案例并不少见。'
  },
  {
    id: 'seed2_ge_exp_offer', type: 'experience', cat: '通用', company: '多家公司综合', author: '网友投稿', tags: ['Offer', '选择'],
    title: '多个 Offer 怎么选：六个维度打分法',
    content: '维度：① 业务前景（赛道是否增长、公司在行业的位置）② 岗位匹配（做的事是否是你想深耕的方向）③ 成长性（mentor、技术/业务复杂度、能否独立负责）④ 团队氛围（直属 leader 与协作方式）⑤ 薪酬总包（拆月薪、年终、股票、补贴、公积金）⑥ 城市与生活成本。做法：给每项 1-5 分并按个人偏好加权，避免被单一高薪绑架。补充建议：向在职或已离职员工了解真实情况（脉脉、校友、实习时的同事）；面试过程中你对 leader 的感受往往是最准的信号。'
  }
];

function seedResources(): IResourceItem[] {
  return buildSeed([...SEED_DEFS, ...SEED_DEFS_EXTRA, ...FINANCE_SEEDS, ...FINANCE_SEEDS_2, ...FINANCE_SEEDS_EN]);
}

/* ==================== 剪贴板岗位解析（配合招聘平台导入） ==================== */

export interface ParsedJob {
  company: string;
  position: string;
  salary: string;
  location: string;
  experience: string;
  education: string;
  jdText: string;
  keywords: string[];
}

/**
 * 从剪贴板复制的 JD 文本中尽力解析出结构化字段。
 * 由于各平台文案格式不一，这里做「标签匹配 + 简单启发式」解析：
 *  - 先按常见中文标签（公司 / 职位 / 薪资 / 地点 / 经验 / 学历）正则提取
 *  - 未命中公司时，用「中文 + 公司/科技/网络…」启发式兜底
 *  - 薪资额外兼容「15k-25k」「1万-2万」这类区间写法
 *  - 全程文本交给 extractKeywords 提取高频关键词（用于详情页知识库）
 * 解析结果建议用户到详情页二次核对、补全。
 */
export function parseJobFromText(raw: string): ParsedJob {
  const text = (raw || '').trim();
  const field = (labels: string[], max = 24): string => {
    const re = new RegExp(`(?:${labels.join('|')})[:：]\\s*([^\\n，,。；;]{1,${max}})`);
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  let salary = field(['薪资', '薪酬', '工资', '月薪', '年薪', '待遇', 'salary', 'Salary']);
  if (!salary) {
    const sm = text.match(/\d+\s*[kK万]?\s*[-~–]\s*\d+\s*[kK万]?/);
    if (sm) salary = sm[0].trim();
  }

  const position = field(['职位名称', '职位', '岗位', '招聘岗位', 'title', 'Title']);
  let company = field(['公司', '企业', '雇主', '用人单位']);
  if (!company) {
    const cm = text.match(/([\u4e00-\u9fa5]{2,18}?(?:公司|科技|网络技术|信息技术|技术|集团|企业|有限公司|股份有限公司|股份))/);
    if (cm) company = cm[1].trim();
  }
  const location = field(['地点', '城市', '工作地', '地区', '工作地点']);
  const experience = field(['经验', '工作年限', '年限']);
  const education = field(['学历', '教育', '文凭']);

  return {
    company,
    position,
    salary,
    location,
    experience,
    education,
    jdText: text,
    keywords: extractKeywords(text)
  };
}

/* ==================== 展示辅助 ==================== */

export const STATUS_LABELS: Record<RecruitStatus, string> = {
  applied: '网申', written: '笔试', interview: '面试', offer: 'Offer', rejected: '拒信', givenup: '放弃'
};
export function statusLabel(s: RecruitStatus): string { return STATUS_LABELS[s]; }

export function dueInfo(due: number | null): { key: string; text: string; days: number } {
  if (!due) return { key: 'none', text: '无截止', days: 9999 };
  const now = Date.now();
  const days = Math.ceil((due - now) / 86400000);
  if (days < 0) return { key: 'overdue', text: `已过 ${Math.abs(days)} 天`, days };
  if (days === 0) return { key: 'today', text: '今天截止', days };
  if (days === 1) return { key: 'tomorrow', text: '明天截止', days };
  if (days <= 7) return { key: 'week', text: `${days} 天后截止`, days };
  return { key: 'later', text: `${days} 天后截止`, days };
}

/**
 * 订阅模板 id：默认复用主待办的模板（utils/subscribe 的 SUB_TMPL_ID，已在后台申请好），
 * 避免出现「秋招提醒因为本地没配模板 id 而永远走不到订阅推送」这种隐性死功能。
 * 如确有需要单独用另一个模板，可用 setSubTemplateId 覆盖。
 */
export function setSubTemplateId(id: string): void { set(SUB_TMPL_KEY, id); }
export function getSubTemplateId(): string {
  return get<string>(SUB_TMPL_KEY, '') || SUB_TMPL_ID;
}

/* ==================== 进度时间线（状态流转） ==================== */

/** 主线阶段（不含「拒信 / 放弃」这类终点状态） */
export const PIPELINE: RecruitStatus[] = ['applied', 'written', 'interview', 'offer'];

/**
 * 归一化历史：老数据没有 history 时，用 updateTime 合成一条最小历史。
 * 保证时间线永远非空，各页面不必各自判空。
 */
export function ensureHistory(app: IApplication): IStatusChange[] {
  const raw = Array.isArray(app.history) ? app.history : [];
  const list = raw
    .filter((h) => !!(h && h.status))
    .slice()
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  if (list.length > 0) return list;
  return [{ status: app.status, at: app.updateTime || app.createTime || Date.now() }];
}

export function getHistory(app: IApplication): IStatusChange[] {
  return ensureHistory(app);
}

/**
 * 该投递在主线里到达过的最深阶段下标（最小 0：任何投递都走过「网申」）。
 * 终点状态（拒信/放弃）本身不在主线，靠历史推断它曾走到哪一轮；
 * 老数据没有历史时，至少算作到达网申，避免漏斗顶端对不上总数。
 */
export function maxStageIndex(app: IApplication): number {
  let m = PIPELINE.indexOf(app.status);
  ensureHistory(app).forEach((h) => {
    const i = PIPELINE.indexOf(h.status);
    if (i > m) m = i;
  });
  return m < 0 ? 0 : m;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 距今描述（时间线用） */
export function agoText(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

/** 时间线展示节点 */
export interface TimelineNode {
  /** 稳定的列表 key（同一毫秒内多条也不会重复） */
  idx: number;
  status: RecruitStatus;
  label: string;
  at: number;
  dateText: string;
  agoText: string;
  note: string;
  isLatest: boolean;
  /** 阶段序号（主线内），非主线为 -1，用于配色 */
  stage: number;
}

export function timelineNodes(app: IApplication): TimelineNode[] {
  const list = ensureHistory(app);
  const last = list.length - 1;
  return list.map((h, i) => ({
    idx: i,
    status: h.status,
    label: statusLabel(h.status),
    at: h.at,
    dateText: `${fmtDay(h.at)} ${fmtTime(h.at)}`,
    agoText: agoText(h.at),
    note: h.note || '',
    isLatest: i === last,
    stage: PIPELINE.indexOf(h.status)
  }));
}

/** 只记一笔进展备注（不改状态），用于「已约面」「笔试改期」这类流水 */
export function addProgressNote(appId: string, note: string): boolean {
  const app = getAppById(appId);
  if (!app) return false;
  const text = (note || '').trim();
  if (!text) return false;
  app.history = [...ensureHistory(app), { status: app.status, at: Date.now(), note: text }];
  upsertApp(app);
  return true;
}

/* ==================== 数据看板：漏斗 / 趋势 / 渠道 / 准备度 ==================== */

export interface FunnelRow {
  key: RecruitStatus;
  label: string;
  /** 曾到达该阶段的数量（含已流转出去的） */
  reached: number;
  /** 当前停留该阶段的数量 */
  current: number;
  /** 相对上一阶段的转化率 0-100 */
  rateFromPrev: number;
  /** 条宽百分比（相对总投递）0-100 */
  barPct: number;
}

export interface FunnelResult {
  total: number;
  rows: FunnelRow[];
  /** 仍在推进（网申 / 笔试 / 面试） */
  active: number;
  /** 已闭环（Offer / 拒信 / 放弃） */
  closed: number;
  interviewRate: number;
  offerRate: number;
}

export function funnelStats(list?: IApplication[]): FunnelResult {
  const apps = list || loadApps();
  const total = apps.length;
  const reachedAt = (i: number) => apps.filter((a) => maxStageIndex(a) >= i).length;
  const rows: FunnelRow[] = PIPELINE.map((key, i) => {
    const reached = reachedAt(i);
    const prev = i === 0 ? total : reachedAt(i - 1);
    return {
      key,
      label: statusLabel(key),
      reached,
      current: apps.filter((a) => a.status === key).length,
      rateFromPrev: prev > 0 ? Math.round((reached / prev) * 100) : 0,
      barPct: total > 0 ? Math.round((reached / total) * 100) : 0
    };
  });
  return {
    total,
    rows,
    active: apps.filter((a) => PIPELINE.indexOf(a.status) >= 0 && a.status !== 'offer').length,
    closed: apps.filter((a) => a.status === 'offer' || a.status === 'rejected' || a.status === 'givenup').length,
    interviewRate: total > 0 ? Math.round((reachedAt(PIPELINE.indexOf('interview')) / total) * 100) : 0,
    offerRate: total > 0 ? Math.round((reachedAt(PIPELINE.indexOf('offer')) / total) * 100) : 0
  };
}

export interface TrendBucket {
  label: string;
  count: number;
  start: number;
  isCurrent: boolean;
  /** 柱高百分比 0-100 */
  pct: number;
}

/** 近 N 周投递节奏（按 createTime 归周，周一为一周起点） */
export function weeklyTrend(weeks = 6, list?: IApplication[]): { buckets: TrendBucket[]; max: number; total: number } {
  const apps = list || loadApps();
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
  thisMonday.setHours(0, 0, 0, 0);
  const WEEK = 7 * 86400000;
  const buckets: TrendBucket[] = [];
  let total = 0;
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisMonday.getTime() - i * WEEK;
    const end = start + WEEK;
    const count = apps.filter((a) => a.createTime >= start && a.createTime < end).length;
    total += count;
    const d = new Date(start);
    buckets.push({
      label: i === 0 ? '本周' : `${d.getMonth() + 1}/${d.getDate()}`,
      count,
      start,
      isCurrent: i === 0,
      pct: 0
    });
  }
  const max = buckets.reduce((m, b) => (b.count > m ? b.count : m), 0);
  buckets.forEach((b) => { b.pct = max > 0 ? Math.round((b.count / max) * 100) : 0; });
  return { buckets, max, total };
}

export interface ReferralStat {
  key: 'referral' | 'self';
  label: string;
  total: number;
  /** 进入面试及以上 */
  interviewPlus: number;
  offer: number;
  /** 该渠道进入面试及以上的比例 0-100 */
  interviewRate: number;
  /** 条宽百分比（相对两组最大值）0-100 */
  pct: number;
}

export function referralCompare(list?: IApplication[]): ReferralStat[] {
  const apps = list || loadApps();
  const ivIdx = PIPELINE.indexOf('interview');
  const ofIdx = PIPELINE.indexOf('offer');
  const build = (key: 'referral' | 'self', label: string): ReferralStat => {
    const group = apps.filter((a) => (key === 'referral' ? a.isReferral : !a.isReferral));
    const interviewPlus = group.filter((a) => maxStageIndex(a) >= ivIdx).length;
    return {
      key,
      label,
      total: group.length,
      interviewPlus,
      offer: group.filter((a) => maxStageIndex(a) >= ofIdx).length,
      interviewRate: group.length > 0 ? Math.round((interviewPlus / group.length) * 100) : 0,
      pct: 0
    };
  };
  const rows = [build('referral', '内推'), build('self', '自投')];
  const max = Math.max(rows[0].total, rows[1].total, 1);
  rows.forEach((r) => { r.pct = Math.round((r.total / max) * 100); });
  return rows;
}

const PLATFORM_MATCHERS: { label: string; hosts: string[] }[] = [
  { label: 'BOSS 直聘', hosts: ['zhipin.com'] },
  { label: '前程无忧', hosts: ['51job.com', 'yingjiesheng.com'] },
  { label: '猎聘', hosts: ['liepin.com'] },
  { label: '牛客网', hosts: ['nowcoder.com'] },
  { label: '拉勾', hosts: ['lagou.com'] },
  { label: '智联招聘', hosts: ['zhaopin.com'] }
];

export interface PlatformStat {
  label: string;
  count: number;
  ratio: number;
  pct: number;
}

/** 从投递 / JD 链接识别来源渠道（识别不到的归入「企业官网 / 其他」） */
export function platformStats(list?: IApplication[]): PlatformStat[] {
  const apps = list || loadApps();
  const counter = new Map<string, number>();
  let noLink = 0;
  apps.forEach((a) => {
    const url = `${a.applyUrl || ''} ${a.jdUrl || ''}`.trim().toLowerCase();
    if (!url) { noLink++; return; }
    const hit = PLATFORM_MATCHERS.find((m) => m.hosts.some((h) => url.indexOf(h) >= 0));
    const label = hit ? hit.label : '企业官网 / 其他';
    counter.set(label, (counter.get(label) || 0) + 1);
  });
  const total = apps.length || 1;
  const rows: PlatformStat[] = [];
  counter.forEach((count, label) => rows.push({ label, count, ratio: Math.round((count / total) * 100), pct: 0 }));
  rows.sort((a, b) => b.count - a.count);
  if (noLink > 0) rows.push({ label: '未填链接', count: noLink, ratio: Math.round((noLink / total) * 100), pct: 0 });
  const max = rows.reduce((m, r) => (r.count > m ? r.count : m), 0);
  rows.forEach((r) => { r.pct = max > 0 ? Math.round((r.count / max) * 100) : 0; });
  return rows;
}

export interface Readiness {
  /** 0-100 */
  score: number;
  level: string;
  /** 待补强项 */
  tips: string[];
}

/**
 * 面试准备度 0-100：
 *  - JD 关键词 20（≥1 个得 10，≥5 个得 20）
 *  - 面经题目完成率 40
 *  - 准备清单完成率 20（未到面试阶段不惩罚）
 *  - 评分 + 复盘 各 10
 */
export function readiness(app: IApplication): Readiness {
  const tips: string[] = [];
  let score = 0;
  const atInterview = app.status === 'interview' || app.status === 'offer' || app.status === 'rejected';

  const kw = app.prep && Array.isArray(app.prep.jdKeywords) ? app.prep.jdKeywords.length : 0;
  if (kw >= 5) score += 20;
  else if (kw >= 1) { score += 10; tips.push('JD 关键词偏少，多粘一段 JD 再提取'); }
  else tips.push('还没提取 JD 关键词');

  const qAll = [...((app.prep && app.prep.questions) || []), ...((app.prep && app.prep.imported) || [])];
  if (qAll.length > 0) {
    const done = qAll.filter((q) => q.done).length;
    score += Math.round((done / qAll.length) * 40);
    if (done < qAll.length) tips.push(`还有 ${qAll.length - done} 道面试题没过`);
  } else {
    tips.push('还没有准备面试题，可从资源库导入');
  }

  const ck = app.checklist || [];
  if (ck.length > 0) {
    const cd = ck.filter((c) => c.done).length;
    score += Math.round((cd / ck.length) * 20);
    if (cd < ck.length) tips.push(`准备清单还剩 ${ck.length - cd} 项`);
  } else if (atInterview) {
    tips.push('面试准备清单是空的');
  } else {
    score += 10; // 尚未到面试阶段，不惩罚
  }

  if (app.rating > 0) score += 10;
  else if (atInterview) tips.push('还没给这次面试打分');
  if ((app.review || '').trim()) score += 10;
  else if (atInterview) tips.push('建议写一段复盘，下次面试用得上');

  // 面试安排相关的提醒（不改分数，只把「临场该做的事」提前顶出来）
  const ivs = ensureInterviews(app);
  if (ivs.length > 0) {
    const next = nextInterview(app);
    if (next) {
      const hours = (next.at - Date.now()) / 3600000;
      if (hours <= 48 && hours > -1) {
        tips.unshift(`${next.round} ${hours <= 1 ? '马上开始' : hours <= 24 ? '就在今天/明天' : '两天内'}，先过一遍高频题与自我介绍`);
      }
      if (!next.place && next.mode !== '待定' && next.mode !== '线上') {
        tips.push(`${next.round}是${next.mode}，还没填地点`);
      }
      if (!next.place && next.mode === '线上') tips.push(`${next.round}是线上，记得把会议链接填上`);
    }
  } else if (atInterview) {
    tips.push('还没登记面试时间，登记后会自动进日历并提前 30 分钟提醒');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 85 ? '准备充分' : score >= 60 ? '基本就绪' : score >= 35 ? '还需补强' : '准备不足';
  return { score, level, tips };
}

export interface OfferCard {
  _id: string;
  company: string;
  position: string;
  base: string;
  salary: string;
  rating: number;
  stars: string;
  isReferral: boolean;
}

export function offerList(list?: IApplication[]): OfferCard[] {
  const apps = list || loadApps();
  return apps
    .filter((a) => a.status === 'offer')
    .sort((a, b) => b.rating - a.rating)
    .map((a) => ({
      _id: a._id,
      company: a.company || '未命名公司',
      position: a.position || '',
      base: a.base || '未填',
      salary: a.salary || '未填',
      rating: a.rating,
      stars: a.rating > 0 ? '★'.repeat(a.rating) : '未评分',
      isReferral: a.isReferral
    }));
}

export interface Overview {
  total: number;
  active: number;
  closed: number;
  offer: number;
  offerRate: number;
  weekCount: number;
  /** 今天还有几场面试 */
  interviewToday: number;
  /** 未来 7 天共有几场面试 */
  interviewWeek: number;
}

export function overview(list?: IApplication[]): Overview {
  const apps = list || loadApps();
  const total = apps.length;
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset).getTime();
  const ofIdx = PIPELINE.indexOf('offer');

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 86400000;
  const weekLater = Date.now() + 7 * 86400000;
  let interviewToday = 0;
  let interviewWeek = 0;
  apps.forEach((a) => {
    ensureInterviews(a).forEach((it) => {
      if (it.done) return;
      if (it.at >= startOfToday && it.at < endOfToday) interviewToday += 1;
      if (it.at >= Date.now() && it.at <= weekLater) interviewWeek += 1;
    });
  });

  return {
    total,
    active: apps.filter((a) => PIPELINE.indexOf(a.status) >= 0 && a.status !== 'offer').length,
    closed: apps.filter((a) => a.status === 'offer' || a.status === 'rejected' || a.status === 'givenup').length,
    offer: apps.filter((a) => a.status === 'offer').length,
    offerRate: total > 0 ? Math.round((apps.filter((a) => maxStageIndex(a) >= ofIdx).length / total) * 100) : 0,
    weekCount: apps.filter((a) => a.createTime >= monday).length,
    interviewToday,
    interviewWeek
  };
}

/** 面试议程：未来 N 天内的面试场次（扁平化，带公司/岗位），供 Hub 与日历共用 */
export interface AgendaItem {
  /** 列表 key：同一投递有多轮面试时 appId 会重复，不能用 appId 当 wx:key */
  key: string;
  appId: string;
  company: string;
  position: string;
  round: string;
  mode: InterviewMode;
  place: string;
  at: number;
  done: boolean;
  /** 日期 key：YYYY-MM-DD（本地时区） */
  dayKey: string;
  timeText: string;
  countdown: string;
}

export function interviewAgenda(days = 7, list?: IApplication[], now = Date.now()): AgendaItem[] {
  const apps = list || loadApps();
  const limit = now + days * 86400000;
  const p = (n: number) => String(n).padStart(2, '0');
  const out: AgendaItem[] = [];
  apps.forEach((a) => {
    ensureInterviews(a).forEach((it) => {
      if (it.done || it.at > limit) return;
      const d = new Date(it.at);
      out.push({
        key: `${a._id}_${it.id}`,
        appId: a._id,
        company: a.company || '未命名公司',
        position: a.position || '',
        round: it.round,
        mode: it.mode,
        place: it.place,
        at: it.at,
        done: it.done,
        dayKey: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
        timeText: `${p(d.getHours())}:${p(d.getMinutes())}`,
        countdown: interviewVO(it, now).countdown
      });
    });
  });
  return out.sort((a, b) => a.at - b.at);
}


/** 根据当前数据生成「下一步该干嘛」的行动建议 */
export function suggestions(list?: IApplication[]): string[] {
  const apps = list || loadApps();
  if (apps.length === 0) {
    return ['还没有投递记录：去 BOSS / 前程无忧 复制一份 JD，回到秋招助手点「从剪贴板导入岗位」就能自动建卡。'];
  }
  const out: string[] = [];
  const wrIdx = PIPELINE.indexOf('written');
  const ofIdx = PIPELINE.indexOf('offer');
  const reached = (i: number) => apps.filter((a) => maxStageIndex(a) >= i).length;

  const urgent = apps.filter((a) => {
    if (!a.dueDate || PIPELINE.indexOf(a.status) < 0) return false;
    const d = dueInfo(a.dueDate).days;
    return d >= 0 && d <= 3;
  });
  if (urgent.length > 0) {
    out.push(`⏰ ${urgent.length} 个投递的截止在 3 天内（${urgent.slice(0, 3).map((a) => a.company || '未命名').join('、')}），优先处理。`);
  }

  // 面试议程优先于其它建议：硬时间点错过就没了
  const agenda = interviewAgenda(7, apps);
  const todayAgenda = agenda.filter((x) => (x.at - Date.now()) < 86400000);
  if (todayAgenda.length > 0) {
    out.push(`📞 24 小时内有 ${todayAgenda.length} 场面试（${todayAgenda.slice(0, 3).map((x) => `${x.company} ${x.round}`).join('、')}），先过自我介绍与项目深挖。`);
  } else if (agenda.length > 0) {
    out.push(`📅 未来 7 天有 ${agenda.length} 场面试，最近一场是 ${agenda[0].company} 的${agenda[0].round}（${agenda[0].countdown}）。`);
  }

  const stuck = apps.filter((a) => a.status === 'applied').length;
  if (stuck >= 3 && reached(wrIdx) === 0) {
    out.push(`📮 已投 ${stuck} 家但还没有笔试：节奏偏慢，建议同期补投 3~5 家同档位公司拉开梯度。`);
  }

  // 正在面试阶段但准备不足的（拿到 Offer 的不用再催刷题）
  const weak = apps
    .filter((a) => a.status === 'interview')
    .map((a) => ({ a, r: readiness(a) }))
    .filter((x) => x.r.score < 60)
    .sort((x, y) => x.r.score - y.r.score);
  if (weak.length > 0) {
    out.push(`🎯 ${weak.slice(0, 2).map((x) => x.a.company || '未命名').join('、')} 已进入面试但准备度只有 ${weak[0].r.score}%，先刷高频题再面。`);
  }

  const rc = referralCompare(apps);
  if (rc[0].total >= 2 && rc[1].total >= 2 && rc[0].interviewRate < rc[1].interviewRate) {
    out.push(`🤝 内推转化率（${rc[0].interviewRate}%）低于自投（${rc[1].interviewRate}%）：检查内推是不是只「挂名」，或岗位档位不匹配。`);
  }

  const offers = reached(ofIdx);
  if (offers >= 2) {
    out.push(`🏆 已有 ${offers} 个 Offer：用下方「Offer 对比」按薪资 / base / 面试评分做决策，别拖过答复期限。`);
  } else if (offers === 1) {
    out.push('🎉 已拿到 1 个 Offer：建议再面 1~2 家作为比价筹码，同时回填评分与复盘。');
  }

  const noReview = apps.filter((a) => a.status === 'rejected' && !(a.review || '').trim()).length;
  if (noReview >= 2) {
    out.push(`📝 ${noReview} 次被拒还没写复盘：补一句「挂在哪一轮、考了什么」，是提升最快的一步。`);
  }

  if (out.length === 0) {
    out.push('📈 节奏正常：保持每周固定投递量，重点公司提前一周进入准备状态。');
  }
  return out;
}

/* ==================== 收藏（资源库资料）与关注（岗位开放） ====================
   两者都只存 id 列表，不写进种子数据本身：
   loadResources() 会按 _id 增量合并内置种子，若把收藏标记挂在条目上，
   老用户升级后会被种子覆盖掉。独立一个 key 最稳。 */

function idListOf(key: string): string[] {
  const v = get<string[]>(key, []);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && !!x) : [];
}

export function loadFavResources(): string[] {
  return idListOf(FAV_RES_KEY);
}

export function isFavResource(id: string): boolean {
  return loadFavResources().indexOf(id) >= 0;
}

/** 切换资源收藏；返回切换后是否「已收藏」 */
export function toggleFavResource(id: string): boolean {
  const list = loadFavResources();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  set(FAV_RES_KEY, list);
  return i < 0;
}

export function clearFavResources(): void {
  set(FAV_RES_KEY, []);
}

export function loadFollowedOpenings(): string[] {
  return idListOf(FAV_OPENING_KEY);
}

export function isFollowedOpening(id: string): boolean {
  return loadFollowedOpenings().indexOf(id) >= 0;
}

/** 切换岗位关注；返回切换后是否「已关注」 */
export function toggleFollowOpening(id: string): boolean {
  const list = loadFollowedOpenings();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  set(FAV_OPENING_KEY, list);
  return i < 0;
}
