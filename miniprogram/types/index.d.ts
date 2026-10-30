/**
 * types/index.d.ts
 * 业务模型（具名导出，供 import type 使用）+ 微信小程序全局 API 声明
 *
 * Phase 1 升级：subtasks / recurrence / reminders / attachments / archived / templates / themes
 */

export {};

/* ============ 业务模型（模块导出） ============ */

export type Priority = 'high' | 'medium' | 'low';

/** 重复规则 */
export interface IRecurrence {
  /** none=不重复; daily=每天; weekly=每周(可选 weekdays); monthly=每月; custom=自定义间隔 */
  type: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
  /** 间隔（仅 custom 生效；如 type=custom interval=2 表示每 2 天/周/月） */
  interval?: number;
  /** 仅 weekly 生效：1-7 表示周一到周日 */
  weekdays?: number[];
  /** 重复终止时间（毫秒时间戳），不设则无限重复 */
  endDate?: number | null;
}

  /** 提醒项 */
  export interface IReminder {
    id: string;
    /** 提醒时间（毫秒时间戳） */
    at: number;
    /** 是否已发送（去重用） */
    sent?: boolean;
    /** 提醒类型（预留；当前仅 in-app 订阅消息） */
    channel?: 'app' | 'sys';
    /** 重复周期：none=不重复; daily=每天; weekly=每周; monthly=每月; yearly=每年 */
    repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    /** 提醒方式：toast=应用内通知条；modal=弹窗 */
    method?: 'toast' | 'modal';
    /** 用户是否已授权该提醒的微信订阅消息（仅本地提醒无需授权；授权后到期由服务端推送） */
    subscribed?: boolean;
    /** 授权成功的时间戳；用于判断一次性授权是否仍在有效期内（建议结合服务端校验） */
    grantedAt?: number;
  }

/** 附件（图片或链接） */
export interface IAttachment {
  id: string;
  type: 'image' | 'video' | 'link';
  /** 图片/视频：cloud://...fileID；链接：原 url */
  url: string;
  /** 链接标题（仅 link 类型） */
  title?: string;
  /** 本地临时路径（仅图片/视频，缓存预览；上传成功后置空） */
  tempPath?: string;
  /** 视频封面：cloud://...fileID（仅 video，上传成功后写入） */
  poster?: string;
  /** 视频封面本地临时路径（仅 video，上传前即时预览用） */
  posterTemp?: string;
  /** 视频时长（秒，仅 video） */
  duration?: number;
}

/** 任务主体（todos 集合） */
export interface ITodo {
  _id: string;
  _openid?: string;
  content: string;
  completed: boolean;
  createTime: number;
  updateTime: number;
  /** 截止时间（毫秒时间戳）；null/undefined 表示无截止 */
  dueDate?: number | null;
  /** 已完成时间（毫秒），完成后写入；用于归档统计 */
  completedTime?: number | null;
  /** 是否已发送过单字段订阅消息 */
  reminded?: boolean;
  /** 优先级 */
  priority?: Priority | null;
  /** 地点（自由文本） */
  location?: string | null;
  /** 关联人物 */
  people?: string[];
  /** 标签 */
  tags?: string[];
  /** 备注/详情 */
  description?: string | null;
  /** 重复规则 */
  recurrence?: IRecurrence | null;
  /** 提醒项列表（多个时间点） */
  reminders?: IReminder[];
  /** 附件 */
  attachments?: IAttachment[];
  /** 是否已归档（完成后用户手动或自动归档） */
  archived?: boolean;
  /** 归档时间（毫秒） */
  archivedAt?: number | null;
  /** 子任务总数（冗余，避免每次统计 subtasks） */
  subtaskCount?: number;
  /** 已完成的子任务数 */
  subtaskDoneCount?: number;
  /** 手动排序顺序（数字小排前） */
  order?: number;
  /** 象限（1=重要紧急 / 2=重要不紧急 / 3=紧急不重要 / 4=都不） */
  quadrant?: 1 | 2 | 3 | 4 | null;
  /** 刚性 vs 弹性：刚性（默认）逾期标红强提醒；弹性逾期不打扰、自动顺延。undefined 视为刚性 */
  rigid?: boolean | null;
  /** 弹性待办已顺延次数（达到上限后引导减负/删除） */
  snoozeCount?: number;
  /** 预估耗时（分钟）：用于粒度拆分提示、碎片时间匹配、优先级排序 */
  estimatedMinutes?: number | null;
  /** 是否纳入「今日聚焦」（每日最多 3 件） */
  focusToday?: boolean;
  /** 冬眠唤醒时间（毫秒）：到该时刻前从主页隐藏，到期后轻量提醒 */
  hibernateUntil?: number | null;
  /** 是否私密（放入私密箱，需生物识别解锁） */
  isPrivate?: boolean;
  /** 回收站软删时间（毫秒）：有值表示已移入回收站，列表不展示 */
  deletedAt?: number | null;
}

/** 子任务（subtasks 集合） */
export interface ISubtask {
  _id: string;
  _openid?: string;
  /** 关联的 todo _id */
  todoId: string;
  content: string;
  completed: boolean;
  order: number;
  createTime: number;
  updateTime: number;
}

/** 模板（templates 集合） */
export interface ITemplate {
  _id: string;
  _openid?: string;
  /** 模板名称 */
  name: string;
  /** 模板图标（emoji） */
  icon: string;
  /** 模板分类（工作计划/学习任务/生活管理/出行准备/健康健身等） */
  category?: string;
  /** 系统预置 vs 用户自定义 */
  isSystem?: boolean;
  /** 模板项（参考 ITodo 字段，仅保留必要） */
  items: Array<{
    content: string;
    priority?: Priority | null;
    location?: string | null;
    tags?: string[];
    description?: string | null;
    subtasks?: string[];
    dueOffsetDays?: number;
  }>;
  createTime: number;
  updateTime: number;
}

/** 番茄时钟模式 */
export type PomoMode = 'focus' | 'short' | 'long';
/** 番茄计数方式 */
export type PomoDirection = 'down' | 'up';

/** 番茄设置（持久化到 wx.storage key='pomo_settings'） */
export interface IPomoSettings {
  /** 专注时长（秒），默认 25*60 */
  focusSec: number;
  /** 短休息时长（秒），默认 5*60 */
  shortSec: number;
  /** 长休息时长（秒），默认 15*60 */
  longSec: number;
  /** 累计专注 N 轮后进入长休息，默认 4 */
  longEvery: number;
  /** 计时方向：down=倒计时(默认)，up=正计时 */
  direction: PomoDirection;
  /** 完成轮次后是否自动进入下一轮（默认 true） */
  autoCycle: boolean;
  /** 休息是否自动开始（默认 false，需手动点） */
  autoBreak: boolean;
  /** 智能休息：按本轮专注时长 + 今日已完成番茄数自动加长休息（默认 false） */
  adaptive: boolean;
  /** 计时结束时是否振动（默认 true） */
  vibrate: boolean;
  /** 计时结束时是否播放结束音（默认 true） */
  sound: boolean;
  /** 是否请求微信服务通知（默认 false） */
  subscribe: boolean;
  /** 环境音 key：off/rain/cafe/forest/ocean/white */
  ambient: 'off' | 'rain' | 'cafe' | 'forest' | 'ocean' | 'white';
  /** 环境音音量 0-1 */
  ambientVolume: number;
  /** 结束音 key：chime/bell/digital/ding/fail */
  finishTone: 'chime' | 'bell' | 'digital' | 'ding' | 'fail';
  /** 结束音音量 0-1 */
  toneVolume: number;
  /** 无干扰模式（弱化页面其他元素） */
  zen: boolean;
}

/** 番茄单条日志（云端 collection=pomoLogs） */
export interface IPomoLog {
  _id: string;
  _openid?: string;
  /** 模式 */
  mode: PomoMode;
  /** 设计时长（秒） */
  plannedSec: number;
  /** 实际时长（秒）—— 完成时 = plannedSec；放弃时 < plannedSec */
  actualSec: number;
  /** 关联 todo（可空） */
  todoId?: string | null;
  /** 关联 todo 标题（冗余，便于统计/分享） */
  todoTitle?: string | null;
  /** 状态：completed=完成；abandoned=中途放弃；aborted=系统重置 */
  status: 'completed' | 'abandoned' | 'aborted';
  /** 开始时间戳 */
  startAt: number;
  /** 结束时间戳 */
  endAt: number;
  /** 关联日期 yyyy-mm-dd（便于按日聚合） */
  dateKey: string;
}

/** 番茄状态统计聚合 */
export interface IPomoStats {
  todayCount: number;
  todayMinutes: number;
  weekCount: number;
  weekMinutes: number;
  monthCount: number;
  monthMinutes: number;
  totalCount: number;
  totalMinutes: number;
  /** 连续打卡天数 */
  streak: number;
  /** 12 周热力图（[weekIndex][weekdayIndex] -> 完成数） */
  heatmap: number[][];
  /** 24 小时效率直方图：index = 小时 (0-23)，value = 该小时累计完成数 */
  hourHistogram: number[];
  /** 24 小时峰值 */
  hourPeak: number;
  /** 时间轴：最近 N 天每天的完成情况 */
  timeline: IDailyPoint[];
  /** 最佳时段（Top 1 连续高效窗口，按完成数排序） */
  bestWindow: IBestWindow | null;
  /** 高效时段（Top 2~3 候选窗口） */
  efficientWindows: IBestWindow[];
}

/** 时间轴一天的数据点 */
export interface IDailyPoint {
  /** yyyy-mm-dd */
  dateKey: string;
  /** 完成番茄数（仅 focus） */
  count: number;
  /** 专注分钟 */
  minutes: number;
  /** 星期几 0-6（0=周日） */
  weekday: number;
  /** 是否今天 */
  isToday: boolean;
}

/** 高效时段窗口 */
export interface IBestWindow {
  /** 起始小时 0-23 */
  startHour: number;
  /** 结束小时 0-23（不含，即 [start, end)） */
  endHour: number;
  /** 该窗口累计完成数 */
  count: number;
  /** 该窗口累计分钟 */
  minutes: number;
  /** 标签，例如 "09:00 - 11:00" */
  label: string;
}

/** 番茄用户目标（持久化 wx.storage key='pomo_goals'） */
export interface IPomoGoals {
  /** 今日目标番茄数（仅 focus 计入） */
  dailyTarget: number;
  /** 本周目标番茄数（仅 focus 计入） */
  weeklyTarget: number;
}

/* ============ 便签（Sticky Note） ============ */

/** 便签背景样式键（纯色/圆点/斜纹/网格/波浪/渐变） */
export type NotePatternKey = 'solid' | 'dots' | 'stripes' | 'grid' | 'waves' | 'fade';

/** 便签图样键（卡通动物装饰，none=无） */
export type NoteFigureKey =
  | 'none'
  | 'cat'
  | 'dog'
  | 'bear'
  | 'rabbit'
  | 'panda'
  | 'hamster'
  | 'fox'
  | 'chick'
  | 'pig'
  | 'koala';

/** 便签主体（本地 + 云端 collection=notes） */
/** 便签分类（手账式：生活 / 学习 / 工作 / 心情） */
export type NoteCategoryKey = 'life' | 'study' | 'work' | 'mood';

export interface INote {
  _id: string;
  _openid?: string;
  /** 便签内容 */
  content: string;
  /** 便签标题（可选，参考稿的「周末去看花」这类短标题；为空时卡片只显示正文） */
  title?: string;
  /** 分类键（手账分类，老数据缺失时归为 life） */
  category?: NoteCategoryKey;
  /** 颜色键（NOTE_COLORS[key]） */
  colorKey: string;
  /** 背景样式键 */
  patternKey: NotePatternKey;
  /** 图样键（卡通动物） */
  figureKey: NoteFigureKey;
  /** 是否置顶 */
  pinned: boolean;
  createTime: number;
  updateTime: number;
}

/** 便签编辑草稿（新建/编辑弹窗临时态） */
export interface INoteDraft {
  content: string;
  /** 便签标题（可选） */
  title?: string;
  category: NoteCategoryKey;
  colorKey: string;
  patternKey: NotePatternKey;
  figureKey: NoteFigureKey;
  pinned: boolean;
}

/** 节日设置（wx.storage key='theme'） */
export type ThemeKey =
  | 'light' | 'dark' | 'rose' | 'forest' | 'twilight' | 'scarlet' | 'jade' | 'indigo'
  // 十二风格槽位（对齐用户 12 套视觉提示词：极简白/深空科技/暖阳治愈/暗黑高级/
  // 潮流多彩/复古胶片/莫兰迪/动态渐变/国风水墨/游戏像素/自然森系/液态金属）
  | 'minimal' | 'tech' | 'healing' | 'noir' | 'candy' | 'retro' | 'morandi' | 'aurora' | 'ink' | 'pixel' | 'forest' | 'liquid'
  // 深海蓝金·上海：深海蓝 / 午夜蓝 / 雾灰 / 暖白 / 香槟金，蓝金双色体系 + 上海城市环境背景
  | 'deepsea'
  // 求职工作台：秋招助手子包专用深蓝 AI Dashboard（#07152D 底 + 品牌蓝 + AI 青紫强调，玻璃拟态）
  | 'career'
  | 'custom';

export interface IThemeSetting {
  key: ThemeKey;
  /** 主题名（展示用） */
  name: string;
  /** 主题渐变 hero 背景 */
  heroGradient: string;
}

/** 自定义主题颜色（wx.storage key='theme_custom'，仅 theme='custom' 时生效） */
export interface ICustomTheme {
  /** 主题色（hex，如 #6366f1），替换全局紫色强调色 */
  primary: string;
  /** 背景色（hex）；null 表示跟随明暗模式默认背景 */
  bg: string | null;
  /** 深色模式 */
  dark: boolean;
}

/* ============ 衍生展示 ============ */

/** 倒计时分桶（用于卡片视觉分级） */
export type CountdownKey =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'week'
  | 'later'
  | 'none';

export interface CountdownInfo {
  key: CountdownKey;
  text: string;
  /** 距截止的天数（负数表示已过 X 天） */
  days: number;
}

export interface DecoratedTodo extends ITodo {
  createTimeText: string;
  dueDateText: string;
  overdue: boolean;
  countdown: CountdownInfo;
  priorityColor: 'rose' | 'amber' | 'emerald' | 'slate';
  avatars: { name: string; initial: string; tone: string }[];
  avatarOverflow: number;
  tagTones: string[];
  /** 子任务进度 0-1 */
  subtaskProgress: number;
  /** 是否已完成（供 view 复用） */
  done: boolean;
  /** 弹性逾期：已逾期且为弹性待办（不应标红催促） */
  elasticOverdue?: boolean;
}

/* ============ 筛选 / 操作 ============ */

export type FilterKey = 'all' | 'active' | 'done' | 'archived';
export type ViewKey = 'list' | 'calendar' | 'kanban';

export interface SearchFilters {
  keyword: string;
  priority: Priority | null;
  location: string | null;
  person: string | null;
  tag: string | null;
}

export type TodoAction =
  | 'list'
  | 'add'
  | 'update'
  | 'toggle'
  | 'delete'
  | 'archive'
  | 'restore'
  | 'clearCompleted'
  | 'remind'
  | 'move'
  | 'listPaged'
  /** 游标分页：按 createTime 倒序，返回比 cursor 更早的一批（用于超大清单顺序拉取） */
  | 'listSince'
  /** 按 id 取单条，详情页 O(1) 取数，替代旧版全量 list + 内存 find */
  | 'getOne'
  /** 只取总数，用于超大清单的进度展示 */
  | 'count';

export interface TodoEventPayload {
  action: TodoAction;
  id?: string;
  content?: string;
  completed?: boolean;
  dueDate?: number | null;
  priority?: Priority | null;
  location?: string | null;
  people?: string[];
  tags?: string[];
  description?: string | null;
  recurrence?: IRecurrence | null;
  reminders?: IReminder[];
  attachments?: IAttachment[];
  quadrant?: 1 | 2 | 3 | 4 | null;
  order?: number;
  archived?: boolean;
  page?: number;
  pageSize?: number;
  /** 跳过的条数（与 page 二选一）。首屏条数与后续分页条数不一致时必须用它，否则会漏数据 */
  skip?: number;
  /** 游标：上一批最后一条的 createTime */
  cursor?: number;
  /** 增量拉取起点时间戳 */
  since?: number;
  /** 批量 id（如按 id 集合取数） */
  ids?: string[];
}

export type SubtaskAction =
  | 'listByTodo'
  | 'add'
  | 'toggle'
  | 'update'
  | 'delete'
  | 'clearDone'
  | 'countByTodo';

export interface SubtaskEventPayload {
  action: SubtaskAction;
  id?: string;
  todoId?: string;
  content?: string;
  completed?: boolean;
  order?: number;
}

export type TemplateAction = 'list' | 'save' | 'delete' | 'apply' | 'seed';

export interface TemplateEventPayload {
  action: TemplateAction;
  id?: string;
  template?: ITemplate;
}

export type ExportAction = 'json' | 'csv';

export interface ExportEventPayload {
  action: ExportAction;
}

export interface CloudResult<T = unknown> {
  success?: boolean;
  data?: T;
  id?: string;
  updated?: number;
  removed?: number;
  scanned?: number;
  sent?: number;
  scannedFiles?: number;
  error?: string;
  items?: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
}

/* ==================== 愿望清单 ==================== */

/** 状态语义：进行中 / 已完成 / 已放弃（决定统计口径） */
export type WishStatusKind = 'todo' | 'doing' | 'done' | 'dropped';

/** 自定义状态（状态流中的一环） */
export interface IWishStatus {
  id: string;
  name: string;
  color: string;
  kind: WishStatusKind;
  order: number;
}

/** 自定义分类 */
export interface IWishCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** 隐私分类：需解锁后才展示内容 */
  isPrivate: boolean;
  order: number;
}

/** 自定义字段类型 */
export type WishFieldType =
  | 'text' | 'number' | 'money' | 'date'
  | 'select' | 'checkbox' | 'star' | 'link';

/** 自定义字段定义（可增删、排序、设必填） */
export interface IWishField {
  id: string;
  name: string;
  type: WishFieldType;
  required: boolean;
  order: number;
  /** select 类型的选项 */
  options?: string[];
  /** number/money 的单位 */
  unit?: string;
}

/** 进度展示模式 */
export type WishProgressMode = 'checklist' | 'counter' | 'bar' | 'percent';

/** 子任务（支持无限层级） */
export interface IWishSubTask {
  id: string;
  title: string;
  done: boolean;
  /** 权重（进度聚合时按权重计算） */
  weight: number;
  doneAt?: number;
  children?: IWishSubTask[];
}

/** 自定义字段值 */
export type WishFieldValue = string | number | boolean;

/** 周期心愿配置 */
export interface IWishCycle {
  enabled: boolean;
  /** 周期单位 */
  period: 'week' | 'month' | 'quarter' | 'year';
  /** 下一次重置时间 */
  nextAt: number;
}

/** 预算联动（关联记账本分类与月度预算） */
export interface IWishBudgetLink {
  categoryName: string;
  monthly: number;
}

export interface IWish {
  _id: string;
  _openid?: string;
  title: string;
  note: string;
  /** 为什么想实现它（愿景动机，可选） */
  reason?: string;
  categoryId: string;
  /** 当前状态 id（状态流） */
  statusId: string;
  /** 心动值 1-5 星 */
  star: number;
  /** 预估金额（分） */
  price: number;
  images: string[];
  link: string;
  /** 进度展示模式 */
  progressMode: WishProgressMode;
  /** 目标值（counter/bar/percent 模式） */
  target: number;
  /** 当前值（counter/bar/percent 模式） */
  current: number;
  /** checklist 模式下全部勾选是否自动置为已完成 */
  autoDone: boolean;
  subTasks: IWishSubTask[];
  /** 自定义字段值：fieldId -> value */
  fields: Record<string, WishFieldValue>;
  tags: string[];
  /** 期望实现日期（毫秒） */
  targetDate: number;
  achievedAt: number;
  isArchived: boolean;
  archivedAt: number;
  /** 复盘内容 */
  review: string;
  cycle: IWishCycle | null;
  budgetLink: IWishBudgetLink | null;
  isPrivate: boolean;
  isPinned: boolean;
  /** 来源模板 id */
  templateId: string;
  createTime: number;
  updateTime: number;
  version: number;
}

/** 模板（内置 + 用户自定义，支持一键复用） */
export interface IWishTemplate {
  id: string;
  name: string;
  icon: string;
  desc: string;
  categoryId: string;
  progressMode: WishProgressMode;
  target: number;
  star: number;
  price: number;
  /** 子任务标题模板 */
  subTasks: string[];
  tags: string[];
  builtin: boolean;
  createTime: number;
}

/** 年度报表统计结果 */
export interface IWishYearReport {
  year: number;
  total: number;
  achieved: number;
  dropped: number;
  doing: number;
  /** 已实现心愿总花费（分） */
  spent: number;
  /** 平均实现耗时（天） */
  avgDays: number;
  byCategory: { id: string; name: string; icon: string; color: string; count: number; spent: number }[];
  /** 月度实现分布（12 项） */
  byMonth: number[];
  /** 心动值分布（5 项，下标 0 = 1 星） */
  byStar: number[];
}

/* ==================== 记账本 ==================== */

export type LedgerType = 'expense' | 'income' | 'transfer';

/** 账户（个人 / 共享） */
export interface IAccount {
  id: string;
  name: string;
  type: 'personal' | 'shared';
  icon: string;
  color: string;
  /** 初始余额（分） */
  balance: number;
  members: string[];
  createTime: number;
  updateTime: number;
}

/** 分类（支持无限层级，parentId 为空表示顶级） */
export interface ILedgerCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: LedgerType;
  parentId: string;
  order: number;
}

/** 流水（金额一律以「分」为整数存储） */
export interface ITransaction {
  _id: string;
  _openid?: string;
  accountId: string;
  type: LedgerType;
  /** 金额（分，正数） */
  amount: number;
  categoryId: string;
  note: string;
  /** 商户 / 地点（如「星巴克」「王府井」），报销与对账时便于检索 */
  merchant?: string;
  /** 发生时间（毫秒） */
  occurredAt: number;
  payerId: string;
  payerName: string;
  /** 分账方式 */
  splitMode: 'none' | 'average' | 'ratio' | 'amount' | 'treat';
  splitDetail: { userId: string; name: string; amount: number }[];
  tags: string[];
  /** 可报销标记 */
  isReimbursable: boolean;
  /** 票据图片 */
  images: string[];
  /** 关联愿望 id */
  wishId: string;
  /** 关联订阅 id */
  subscriptionId: string;
  createTime: number;
  updateTime: number;
  version: number;
}

/** 预算（总预算 / 分类预算） */
export interface IBudget {
  id: string;
  accountId: string;
  /** 为空表示总预算 */
  categoryId: string;
  /** 限额（分） */
  limit: number;
  period: 'week' | 'month';
  /** 预警阈值百分比，如 [50, 80, 100] */
  thresholds: number[];
  enabled: boolean;
  createTime: number;
  updateTime: number;
}

/** 报表统计结果 */
export interface ILedgerReport {
  byCategory: { id: string; name: string; icon: string; color: string; amount: number; pct: number }[];
  /** 近 N 个月收支趋势 */
  trend: { month: string; income: number; expense: number }[];
  top5: { name: string; icon: string; amount: number }[];
  income: number;
  expense: number;
  balance: number;
}

/* ==================== 秋招助手（招聘模块） ==================== */

/** 投递状态：网申 / 笔试 / 面试 / offer / 拒信 / 放弃 */
export type RecruitStatus = 'applied' | 'written' | 'interview' | 'offer' | 'rejected' | 'givenup';

/** 面试题 / 答题要点 */
export interface IInterviewQ {
  id: string;
  /** 问题 */
  q: string;
  /** 答题要点 */
  a: string;
  /** tech=技术; behavior=行为; imported=从公共面经库导入 */
  kind: 'tech' | 'behavior' | 'imported';
  /** 是否已复习 */
  done: boolean;
}

/** 面试准备清单项 */
export interface IChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** 嵌入式面试准备知识库（每个投递对象内嵌） */
export interface IAppPrep {
  /** 粘贴的 JD 原文 */
  jdText: string;
  /** JD 高频关键词（自动提取） */
  jdKeywords: string[];
  /** 公司研究笔记（自由文本：文化 / 产品 / 竞争对手） */
  companyNotes: string;
  /** 自行整理的面试题 & 答题要点 */
  questions: IInterviewQ[];
  /** 从公共面经库导入的问题 */
  imported: IInterviewQ[];
}

/** 面试形式 */
export type InterviewMode = '线上' | '现场' | '电话' | '待定';

/**
 * 面试轮次安排（一面 / 二面 / Leader面 / HR面 …）。
 * 秋招的「截止日期」只有一个，但面试往往有多轮且各有独立时间，
 * 因此单独建表：日历视图按它出事件，提醒按最近一轮的时间点触发。
 */
export interface IInterview {
  id: string;
  /** 轮次名称，如 一面 / 二面 / Leader面 / HR面 */
  round: string;
  /** 面试开始时间（毫秒时间戳） */
  at: number;
  /** 形式：线上 / 现场 / 电话 / 待定 */
  mode: InterviewMode;
  /** 地点或会议链接 */
  place: string;
  /** 面试官（可选，如「技术 leader」） */
  interviewer: string;
  /** 备注：结果、感受、待确认事项 */
  note: string;
  /** 是否已结束 */
  done: boolean;
}

/** 投递状态流转记录（进度时间线的一个节点） */
export interface IStatusChange {
  /** 变更后的状态 */
  status: RecruitStatus;
  /** 变更时间（毫秒时间戳） */
  at: number;
  /** 可选备注（如「约面：3.12 14:00 线上」） */
  note?: string;
}

/** 投递对象（公司 / 职位卡片） */
export interface IApplication {
  _id: string;
  company: string;
  position: string;
  /** JD 链接 */
  jdUrl: string;
  /** 投递入口（网申）链接 */
  applyUrl: string;
  /**
   * 微信小程序链接（#小程序://xxx/token）。
   * 无法解析出岗位内容，但可用 wx.navigateToMiniProgram({ shortLink }) 一键回跳到该岗位页，
   * 因此单独存一个字段，与 http 链接区分开。
   */
  shortLink?: string;
  /** 工作地 base */
  base: string;
  /** 薪资范围 */
  salary: string;
  /** 是否内推 */
  isReferral: boolean;
  /** 内推人联系方式 */
  referrer: string;
  /** 当前状态 */
  status: RecruitStatus;
  /** 截止日期（网申 / 笔试 deadline，毫秒时间戳）；null 表示无 */
  dueDate: number | null;
  /** 提醒时间列表（毫秒），用于重复提醒（如笔试前一天、前 3 小时） */
  remindAt: number[];
  /**
   * 面试轮次安排。老数据可能没有该字段，读取时一律经
   * recruit-store.ensureInterviews() 归一化为数组。
   */
  interviews?: IInterview[];
  prep: IAppPrep;
  checklist: IChecklistItem[];
  /** 关联的待办 _id（点「同步到待办」创建，用于复用首页 Deadline 雷达） */
  linkedTodoId: string | null;
  /** 面试后评分 1-5 */
  rating: number;
  /** 面后复盘 */
  review: string;
  /**
   * 状态流转历史（进度时间线）。
   * 老数据可能没有该字段，读取时一律经 recruit-store.ensureHistory() 归一化。
   */
  history?: IStatusChange[];
  /** 排序（小排前） */
  order: number;
  createTime: number;
  updateTime: number;
}

/** 资源库类型：qa=面试题库; resume=简历模板; experience=面经分享 */
export type ResourceType = 'qa' | 'resume' | 'experience';

/** 秋招资源库条目（可搜索、用户可匿名分享面经，需审核） */
export interface IResourceItem {
  _id: string;
  type: ResourceType;
  /** 分类（如 技术 / 产品 / 运营；或 互联网 / 国企 等） */
  category: string;
  title: string;
  content: string;
  tags: string[];
  /** 面经分享专属：公司名 */
  company?: string;
  /**
   * 面试轮次：一面 / 二面 / Leader面 / HR面 / 通用。
   * 财务等岗位的资料按「公司 × 轮次」双维度组织，资源库可据此筛选。
   */
  round?: string;
  author?: string;
  /** 审核状态：approved=已发布; pending=待审核 */
  status: 'approved' | 'pending';
  /** 是否内置种子数据 */
  builtin: boolean;
  createTime: number;
}

/* ==================== 语音备忘录 ==================== */

/** 音频片段（原声与文字双向绑定） */
export interface IAudioClip {
  id: string;
  /** 云存储 fileID 或本地临时路径 */
  src: string;
  /** 时长（秒） */
  duration: number;
  /** 转写文本 */
  text: string;
  /** 转写状态 */
  status: 'pending' | 'done' | 'failed';
  /** 文本片段在正文中的锚点，用于高亮与重录 */
  anchor: number;
  createTime: number;
}

/** 备忘录版本（用于回溯对比） */
export interface IMemoVersion {
  id: string;
  title: string;
  content: string;
  createTime: number;
}

export interface IMemo {
  _id: string;
  _openid?: string;
  title: string;
  /** 正文（富文本简化为带标记的文本） */
  content: string;
  /** 清单模式下的条目 */
  checklist: { id: string; text: string; done: boolean }[];
  /** true 表示以清单模式展示 */
  isChecklist: boolean;
  audioList: IAudioClip[];
  imageList: string[];
  color: string;
  folderId: string;
  tags: string[];
  isLocked: boolean;
  /** 加密密码哈希（djb2，非安全场景，仅本地遮挡） */
  lockHash?: string;
  isPinned: boolean;
  isArchived: boolean;
  versions: IMemoVersion[];
  createTime: number;
  updateTime: number;
  version: number;
}

/** 文件夹（无限层级） */
export interface IMemoFolder {
  id: string;
  name: string;
  parentId: string;
  color: string;
  order: number;
  createTime: number;
}

/* ============ 全局声明 ============ */

declare global {
  /* ---- 微信云能力 ---- */
  interface WxCloudCallFunctionResult<T = unknown> {
    result: T;
    errMsg: string;
  }
  interface WxCloudCallFunctionOptions {
    name: string;
    data?: Record<string, unknown>;
    config?: { env: string };
    success?: (res: WxCloudCallFunctionResult<CloudResult>) => void;
    fail?: (err: { errMsg: string }) => void;
  }
  interface WxCloudStatic {
    init(opts: { env: string; traceUser?: boolean }): void;
    callFunction(opts: WxCloudCallFunctionOptions): void;
    /** 上传文件到云存储，返回 fileID（语音录音上传用） */
    uploadFile(opts: {
      cloudPath: string;
      filePath: string;
      success?: (res: { fileID: string; statusCode: number; errMsg?: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { fileID?: string; errMsg?: string }) => void;
    }): void;
    /** 从云存储下载文件（云函数侧亦可用） */
    downloadFile(opts: {
      fileID: string;
      success?: (res: { tempFilePath: string; statusCode: number; errMsg?: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { tempFilePath?: string; errMsg?: string }) => void;
    }): void;
    /** 删除云存储文件（附件删除 / 任务删除时清理，传 fileID 列表） */
    deleteFile(opts: {
      fileList: string[];
      success?: (res: { fileList: { fileID: string; status: number; errMsg?: string }[] }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { fileList?: { fileID: string; status: number }[]; errMsg?: string }) => void;
    }): void;
  }

  interface WxModalSuccessResult {
    confirm: boolean;
    cancel?: boolean;
    content?: string;
  }

  /* ---- wx 全局对象 ---- */
  interface WxChooseMediaSuccessRes {
    tempFiles: {
      tempFilePath: string;
      size: number;
      fileType?: string;
      /** 视频首帧封面（仅 video；也是临时路径，需一并上传云存储） */
      thumbTempFilePath?: string;
      /** 视频时长（秒，仅 video） */
      duration?: number;
      width?: number;
      height?: number;
    }[];
    type?: 'image' | 'video' | 'mix';
  }
  interface WxRecorderManager {
    start(opts?: {
      duration?: number;
      sampleRate?: number;
      numberOfChannels?: number;
      format?: 'mp3' | 'aac' | 'wav' | 'PCM';
      /** 开启后可收到 onFrameRecorded 分帧数据（实时波形用） */
      frameSize?: number;
    }): void;
    stop(): void;
    pause(): void;
    resume(): void;
    onStart(cb: () => void): void;
    onStop(cb: (res: { tempFilePath: string; duration: number; fileSize?: number }) => void): void;
    onError(cb: (err: { errMsg: string }) => void): void;
    /** 分帧录制回调（设置 frameSize 后生效），用于实时音量波形 */
    onFrameRecorded(cb: (res: { frameBuffer: ArrayBuffer; isLastFrame?: boolean }) => void): void;
  }
  interface WxInnerAudioContext {
    src: string;
    startTime: number;
    volume: number;
    autoplay: boolean;
    loop: boolean;
    obeyMuteSwitch: boolean;
    duration: number;
    currentTime: number;
    paused: boolean;
    play(): void;
    pause(): void;
    stop(): void;
    seek(position: number): void;
    destroy(): void;
    onCanplay(cb: () => void): void;
    onPlay(cb: () => void): void;
    onPause(cb: () => void): void;
    onStop(cb: () => void): void;
    onEnded(cb: () => void): void;
    onError(cb: (err: { errMsg: string }) => void): void;
  }
  interface WxFileSystemManager {
    /** 同步检查文件/目录是否存在（不存在时抛错） */
    accessSync(path: string): void;
    /** 同步创建目录（recursive: 递归创建） */
    mkdirSync(dirPath: string, recursive?: boolean): void;
    /** 同步保存临时文件到本地用户目录，返回保存后的路径 */
    saveFileSync(tempFilePath: string, filePath?: string): string;
    writeFile(opts: {
      filePath: string;
      data: string | ArrayBuffer;
      encoding?: string;
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    readFile(opts: {
      filePath: string;
      encoding?: string;
      success?: (res: { data: string }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    unlink(opts: {
      filePath: string;
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    /** 检查文件/代码包内资源是否存在（真机排障用） */
    access(opts: {
      path: string;
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { errMsg: string }) => void;
    }): void;
  }
  /** 节点布局信息 */
  interface WxNodeRect {
    width: number;
    height: number;
    top: number;
    left: number;
    right: number;
    bottom: number;
    id?: string;
    dataset?: Record<string, unknown>;
  }
  /**
   * 跳转 API（navigateTo / redirectTo / reLaunch）的通用参数。
   * 之前这里只声明了 url，导致全项目跳转都不敢写 success/fail
   * ——一旦页面栈满 10 层，失败就是静默的，表现为「点了没反应」。
   */
  interface RouteOption {
    url: string;
    events?: Record<string, unknown>;
    success?: (res?: unknown) => void;
    fail?: (err: { errMsg?: string } & Record<string, unknown>) => void;
    complete?: (res?: unknown) => void;
  }
  /** 页面栈中的页面实例 */
  interface PageInstance {
    route?: string;
    data?: Record<string, unknown>;
    setData?(data: Record<string, unknown>, cb?: () => void): void;
    [key: string]: unknown;
  }
  /** scroll-view 增强模式的实例（enhanced=true 时可用） */
  interface WxScrollViewNode {
    scrollTo(opts: { top?: number; left?: number; animated?: boolean; duration?: number }): void;
    scrollOffset(): { scrollTop: number; scrollLeft: number };
  }
  /** wx.createSelectorQuery() 返回的查询器 */
  interface WxSelectorQuery {
    select(selector: string): WxSelectorQuery;
    selectAll(selector: string): WxSelectorQuery;
    in(component: unknown): WxSelectorQuery;
    boundingClientRect(callback?: (rect: any) => void): WxSelectorQuery;
    scrollOffset(callback?: (res: any) => void): WxSelectorQuery;
    fields(fields: Record<string, boolean>, callback?: (res: any) => void): WxSelectorQuery;
    node(callback?: (res: any) => void): WxSelectorQuery;
    exec(callback?: (res: any) => void): void;
  }

  interface WxStatic {
    cloud: WxCloudStatic;
    getStorageSync(key: string): unknown;
    setStorageSync(key: string, value: unknown): void;
    removeStorageSync(key: string): void;
    getStorageInfoSync(): { keys: string[] };
    /** 选择器查询：量取节点尺寸 / 获取 scroll-view 实例（虚拟列表用） */
    createSelectorQuery(): WxSelectorQuery;
    /**
     * 窗口信息（基础库 2.20.1 起支持）。
     * 声明为可选，旧基础库用 getSystemInfoSync 兜底。
     */
    getWindowInfo?(): {
      windowWidth: number;
      windowHeight: number;
      statusBarHeight: number;
      safeArea?: { top: number; bottom: number; left: number; right: number };
      pixelRatio: number;
    };
    showToast(opts: {
      title: string;
      icon?: 'success' | 'error' | 'none' | 'loading';
      duration?: number;
      mask?: boolean;
    }): void;
    showModal(opts: {
      title: string;
      content?: string;
      editable?: boolean;
      placeholderText?: string;
      showCancel?: boolean;
      confirmText?: string;
      cancelText?: string;
      confirmColor?: string;
      cancelColor?: string;
      success?: (res: WxModalSuccessResult) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    showActionSheet(opts: {
      itemList: string[];
      itemColor?: string;
      success?: (res: { tapIndex: number; errMsg?: string }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    requestSubscribeMessage(opts: {
      tmplIds: string[];
      success?: (res: Record<string, 'accept' | 'reject' | 'ban'>) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    chooseMedia(opts: {
      count?: number;
      mediaType?: ('image' | 'video')[];
      sourceType?: ('album' | 'camera')[];
      sizeType?: ('original' | 'compressed')[];
      /** 拍摄视频最长时长（秒，最大 60） */
      maxDuration?: number;
      camera?: 'back' | 'front';
      success?: (res: WxChooseMediaSuccessRes) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    /**
     * 从聊天记录选择文件（type='image' 时可一次勾选最多 100 张图片）。
     * 之所以需要它：`chooseMedia` 单次上限只有 9 张，而照片墙的固定模板动辄要 20~60 张；
     * 用户把照片先发到任意聊天（推荐文件传输助手）后，这里能一次选完，不用来回点 4~6 次。
     * 注意：返回字段是 `path`（不是 `tempFilePath`），`name` 为文件名。
     */
    chooseMessageFile(opts: {
      count?: number;
      type?: 'all' | 'video' | 'image' | 'file';
      extension?: string[];
      success?: (res: { tempFiles: { path: string; size: number; name: string; type: string }[] }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    uploadFile(opts: {
      url: string;
      filePath: string;
      name: string;
      formData?: Record<string, string>;
      success?: (res: { statusCode: number; data: string }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    downloadFile(opts: {
      url: string;
      success?: (res: { tempFilePath: string; statusCode: number }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    /**
     * 图片 + 视频统一预览（基础库 2.12.0+）。
     * 注意：对 cloud:// fileID 支持不稳，视频应先 downloadFile 成本地文件再传进来。
     */
    previewMedia(opts: {
      sources: { url: string; type: 'image' | 'video'; poster?: string }[];
      current?: number;
      success?: () => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    previewImage(opts: {
      urls: string[];
      current?: string;
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    setClipboardData(opts: {
      data: string;
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    getFileSystemManager(): WxFileSystemManager;
    env: {
      USER_DATA_PATH: string;
    };
    getRecorderManager(): WxRecorderManager;
    stopPullDownRefresh(opts?: Record<string, unknown>): void;
    vibrateLong(opts?: Record<string, unknown>): void;
    vibrateShort(opts?: Record<string, unknown>): void;
    createInnerAudioContext(): WxInnerAudioContext;
    /** 画布相关声明（生成专注数据卡片用） */
    createOffscreenCanvas(opts?: { type?: '2d' | 'webgl'; width?: number; height?: number }): unknown;
    /**
     * 选择地点（基础库 1.0.0+）。旅行模块用它给行程条目 / 目的地取经纬度。
     * 需要在 app.json 声明 requiredPrivateInfos: ['chooseLocation'] 才能调用。
     */
    chooseLocation(opts: {
      latitude?: number;
      longitude?: number;
      success?: (res: {
        name: string;
        address: string;
        latitude: number;
        longitude: number;
        errMsg?: string;
      }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: () => void;
    }): void;
    /** 把画布导出为图片（type:'2d' 的 canvas 节点走 canvas 参数） */
    canvasToTempFilePath(opts: {
      canvas?: unknown;
      canvasId?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      destWidth?: number;
      destHeight?: number;
      fileType?: 'jpg' | 'png';
      quality?: number;
      success?: (res: { tempFilePath: string; errMsg?: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: () => void;
    }): void;
    /** 把图片保存到系统相册（照片墙导出用；需 scope.writePhotosAlbum 授权） */
    saveImageToPhotosAlbum(opts: {
      filePath: string;
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: () => void;
    }): void;
    /** 压缩图片（照片墙上传前压大图，quality 0-100） */
    compressImage(opts: {
      src: string;
      quality?: number;
      compressedWidth?: number;
      compressedHeight?: number;
      success?: (res: { tempFilePath: string; errMsg?: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: () => void;
    }): void;
    /** 读取图片原始宽高（拼图排布计算用） */
    getImageInfo(opts: {
      src: string;
      success?: (res: { width: number; height: number; path: string; type?: string; errMsg?: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: () => void;
    }): void;
    /** 创建图片对象（canvas 2d 绘制网络图 / 本地图用） */
    createImage(): Image;
    setNavigationBarColor(opts: {
      frontColor: '#ffffff' | '#000000';
      backgroundColor: string;
      fail?: (err: { errMsg: string }) => void;
    }): void;
    switchTab(opts: RouteOption): void;
    navigateTo(opts: RouteOption): void;
    redirectTo(opts: RouteOption): void;
    reLaunch(opts: RouteOption): void;
    navigateBack(opts?: { delta?: number; fail?: (err: { errMsg: string }) => void }): void;
    showLoading(opts: { title?: string; mask?: boolean }): void;
    hideLoading(): void;
    /** 预下载分包（基础库 2.3.0+），用于降低后续进入分包页面的等待时间 */
    preloadSubpackage(opts: { name: string; success?: () => void; fail?: (err: { errMsg: string }) => void }): void;
    getSystemInfoSync(): {
      windowWidth: number;
      windowHeight: number;
      statusBarHeight: number;
      safeArea?: { top: number; bottom: number; left: number; right: number };
      pixelRatio: number;
      theme?: 'light' | 'dark';
      /** 客户端基础库版本，如 "2.32.0" */
      SDKVersion?: string;
      /** 客户端平台，如 "devtools" / "ios" / "android" */
      platform?: string;
    };
    /**
     * 打开另一个小程序。
     * shortLink 为「小程序链接」（#小程序://名称/路径，通过小程序菜单-复制链接获取），
     * 传该参数后可不传 appId 与 path（基础库 2.18.1 起支持）。
     */
    navigateToMiniProgram(opts: {
      appId?: string;
      path?: string;
      shortLink?: string;
      extraData?: Record<string, unknown>;
      envVersion?: 'develop' | 'trial' | 'release';
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { errMsg: string }) => void;
    }): void;
    getMenuButtonBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number; height: number };

    /* ---- 授权与设置（录音权限 scope.record 等） ---- */
    /** 获取用户已授权的权限列表，authSetting['scope.record'] 为 true/false/undefined */
    getSetting(opts: {
      /** 传入则只返回这些权限的授权状态 */
      withSubscriptions?: boolean;
      success?: (res: { authSetting: Record<string, boolean | undefined>; errMsg?: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { authSetting?: Record<string, boolean | undefined>; errMsg?: string }) => void;
    }): void;
    /** 提前向用户发起授权请求（首次会弹系统授权框） */
    authorize(opts: {
      scope: string;
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { errMsg: string }) => void;
    }): void;
    /** 打开小程序设置页（只能由用户点击触发；用于用户曾拒绝授权后重新开启） */
    openSetting(opts: {
      withSubscriptions?: boolean;
      success?: (res: { authSetting: Record<string, boolean | undefined>; subscriptionsSetting?: Record<string, unknown>; errMsg?: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { authSetting?: Record<string, boolean | undefined>; errMsg?: string }) => void;
    }): void;
    /** 滚动到目标位置（基础库 1.4.0+） */
    pageScrollTo(opts: {
      scrollTop?: number;
      selector?: string;
      duration?: number;
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { errMsg: string }) => void;
    }): void;
    /** 打开微信客服会话（需在公众号后台绑定客服） */
    openCustomerServiceChat(opts: {
      corpid?: string;
      /** 兼容旧调用写法（corpId） */
      corpId?: string;
      /** 会话来源参数（客服消息卡片透传），url 为客服链接 */
      extInfo: { url: string; [key: string]: any };
      success?: (res: { errMsg: string }) => void;
      fail?: (err: { errMsg: string }) => void;
      complete?: (res: { errMsg: string }) => void;
    }): void;
  }
  declare const wx: WxStatic;

  /** 当前页面栈（数组末尾为当前页）。用于栈深检测，避免跳转触顶静默失败 */
  function getCurrentPages(): PageInstance[];

  /* ---- 小程序环境常用全局 ---- */
  interface WxConsole {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    info(...args: unknown[]): void;
    debug(...args: unknown[]): void;
  }
  declare const console: WxConsole;
  declare function setTimeout(handler: () => void, timeout?: number): number;
  declare function clearTimeout(handle?: number): void;
  declare function setInterval(handler: () => void, timeout?: number): number;
  declare function clearInterval(handle?: number): void;
  declare function encodeURIComponent(s: string): string;
  declare function decodeURIComponent(s: string): string;
  declare function Date(): string;
  interface DateConstructor {
    new (): Date;
    (): string;
    /** 距 1970-01-01T00:00:00Z 的毫秒数（农历计算用） */
    UTC(year: number, month: number, date?: number): number;
    now(): number;
  }
  declare function parseInt(s: string, radix?: number): number;

  /* ---- App ---- */
  interface AppGlobalData {
    envId: string;
    cloudReady: boolean;
    /** 当前主题 */
    theme: ThemeKey;
    /** 自定义主题颜色（theme='custom' 时生效） */
    customTheme?: ICustomTheme;
  }
  declare const getApp: () => App.Instance<{ globalData: AppGlobalData }> | undefined;

  declare namespace App {
    interface Instance<TData = Record<string, unknown>> {
      globalData: TData extends { globalData: infer G } ? G : Record<string, unknown>;
    }
    interface Options<TData = Record<string, unknown>> {
      globalData?: TData;
      onLaunch?(opts: Record<string, unknown>): void;
      onShow?(opts: Record<string, unknown>): void;
      onHide?(): void;
      onError?(err: string): void;
    }
  }

  /* ---- Page ---- */
  interface WxPageInstance<TData> {
    data: TData;
    setData(
      data: Partial<TData> | Record<string, unknown>,
      callback?: () => void
    ): void;
  }
  interface WxPageShareContent {
    title: string;
    path: string;
    imageUrl?: string;
    query?: string;
  }
  interface WxPageOptions<TData> {
    data?: TData;
    onLoad?(query: Record<string, string | undefined>): void;
    onShow?(query?: Record<string, string | undefined>): void;
    onHide?(): void;
    onUnload?(): void;
    onPullDownRefresh?(): void;
    onReachBottom?(): void;
    onShareAppMessage?(e?: { from?: 'button' | 'menu'; target?: { dataset?: Record<string, unknown> } }): WxPageShareContent;
    onShareTimeline?(): { title: string; query?: string; imageUrl?: string };
    [key: string]: any;
  }
  declare function Page<TData = any>(
    options: WxPageOptions<TData> & ThisType<WxPageInstance<TData> & Record<string, any>>
  ): void;

  /* ---- Component ---- */
  interface WxComponentInstance {
    data: Record<string, any>;
    setData(data: Record<string, any>, callback?: () => void): void;
    triggerEvent(
      name: string,
      detail?: unknown,
      options?: { bubbles?: boolean; composed?: boolean; capturePhase?: boolean }
    ): void;
    selectComponent(selector: string): WxComponentInstance | null;
  }
  declare function Component(
    options: Record<string, any> &
      ThisType<WxComponentInstance & Record<string, any>>
  ): void;

  /* ---- 事件类型 ---- */
  declare namespace WechatMiniprogram {
    interface IAnyObject {
      [key: string]: unknown;
    }
    namespace Page {
      interface ICustomShareContent {
        title: string;
        path: string;
        imageUrl?: string;
        query?: string;
      }
    }
    interface BaseEvent {
      type: string;
      timeStamp: number;
      target: { id?: string; dataset: IAnyObject };
      currentTarget: { id?: string; dataset: IAnyObject };
      detail: IAnyObject;
    }
    /** 触摸点坐标 */
    interface TouchPoint {
      clientX: number;
      clientY: number;
      pageX?: number;
      pageY?: number;
      identifier?: number;
    }
    /**
     * 触摸事件：左滑删除、长按拖拽排序都要读 touches[0] 的坐标，
     * 之前这里只有 BaseEvent，导致取坐标必须 any 断言。
     */
    interface TouchEvent extends BaseEvent {
      touches: TouchPoint[];
      changedTouches: TouchPoint[];
    }
    interface InputEvent extends BaseEvent {
      detail: { value: string; cursor?: number } & IAnyObject;
    }
    interface PickerChangeEvent extends BaseEvent {
      detail: { value: string | number } & IAnyObject;
    }
    interface CustomEvent<D = unknown> extends BaseEvent {
      detail: (D extends IAnyObject ? D : { value?: D }) & IAnyObject;
    }
    /** scroll-view 滚动事件 */
    interface ScrollViewScroll extends BaseEvent {
      detail: {
        scrollTop: number;
        scrollLeft: number;
        scrollHeight: number;
        scrollWidth: number;
        deltaX: number;
        deltaY: number;
      } & IAnyObject;
    }
    /**
     * canvas 2d 节点：由 wx.createSelectorQuery().select('#id').fields({ node:true }) 取到。
     * 绘制前需按 pixelRatio 手动放大 width/height 再 ctx.scale，否则海报会发虚。
     */
    interface Canvas {
      width: number;
      height: number;
      getContext(type: '2d'): CanvasRenderingContext;
      /** 创建图片对象（离屏画布加载本地图 / 网络图用） */
      createImage(): Image;
    }
    /** 渐变对象（createLinearGradient / createRadialGradient 返回） */
    interface CanvasGradient {
      addColorStop(stop: number, color: string): void;
    }
    /** 2D 绘图上下文（canvas type="2d" 专用，非旧版 CanvasContext） */
    interface CanvasRenderingContext {
      /** 可直接赋色值字符串，也可赋 createLinearGradient 的结果 */
      fillStyle: string | CanvasGradient;
      strokeStyle: string | CanvasGradient;
      lineWidth: number;
      lineCap: 'butt' | 'round' | 'square';
      font: string;
      textAlign: 'left' | 'center' | 'right';
      textBaseline: 'top' | 'middle' | 'bottom';
      globalAlpha: number;
      scale(x: number, y: number): void;
      translate(x: number, y: number): void;
      rotate(angle: number): void;
      save(): void;
      restore(): void;
      clearRect(x: number, y: number, w: number, h: number): void;
      fillRect(x: number, y: number, w: number, h: number): void;
      strokeRect(x: number, y: number, w: number, h: number): void;
      beginPath(): void;
      closePath(): void;
      moveTo(x: number, y: number): void;
      lineTo(x: number, y: number): void;
      arc(x: number, y: number, r: number, s: number, e: number, ccw?: boolean): void;
      fill(): void;
      stroke(): void;
      fillText(text: string, x: number, y: number): void;
      strokeText(text: string, x: number, y: number): void;
      measureText(text: string): { width: number };
      drawImage(img: unknown, x: number, y: number, w?: number, h?: number): void;
      createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
      createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
      /* ===== 以下为照片墙 / 海报拼图所需的扩展绘图能力 ===== */
      /** 9 参数版本：裁剪源图区域后绘制（照片墙拼图用） */
      drawImage(
        img: unknown,
        sx: number, sy: number, sw: number, sh: number,
        dx: number, dy: number, dw: number, dh: number
      ): void;
      /** 裁剪当前路径为绘制区域（圆角照片用） */
      clip(fillRule?: 'nonzero' | 'evenodd'): void;
      roundRect(x: number, y: number, w: number, h: number, r: number | number[]): void;
      ellipse(
        x: number, y: number, rx: number, ry: number,
        rotation: number, startAngle: number, endAngle: number, counterclockwise?: boolean
      ): void;
      quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
      bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
      arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
      rect(x: number, y: number, w: number, h: number): void;
      transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
      setLineDash(segments: number[]): void;
      /** 阴影（照片边框立体感） */
      shadowBlur: number;
      shadowColor: string;
      shadowOffsetX: number;
      shadowOffsetY: number;
      /** 混合模式（滤镜 / 叠加色实现依赖它） */
      globalCompositeOperation: string;
      /** CSS filter 语法，如 'grayscale(1)'；部分基础库不支持，需 try/catch 保护 */
      filter: string;
      /** 像素级处理（蒙版取点、自定义滤镜） */
      getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
      putImageData(data: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number): void;
      createPattern(img: unknown, repetition: string | null): unknown;
      draw(reserve?: boolean, callback?: () => void): void;
    }
    /** 图片对象（wx.createImage 返回），用于星座绘卡等 */
    interface Image {
      src?: string;
      width?: number;
      height?: number;
      onload?: ((this: Image) => void) | null;
      onerror?: ((this: Image, err: { errMsg: string }) => void) | null;
      [key: string]: any;
    }
    /** 2D 画布上下文（wx.createCanvasContext 返回） */
    interface CanvasContext {
      [key: string]: any;
    }
    /** 音频上下文（wx.createInnerAudioContext 返回） */
    interface InnerAudioContext {
      [key: string]: any;
    }
    /** switch 组件 change 事件 */
    interface SwitchChangeEvent extends BaseEvent {
      detail: { value: boolean } & IAnyObject;
    }
  }
}