// utils/important-day-store.ts
// 重要日数据层：生日 / 纪念日 / 到期日 / 考研节点…… 的本地优先存储 + 派生展示 + 排序检索。
//
// 设计要点
//  1. 字段口径与需求第十五节一致（id/title/date/time/category/description/reminder/
//     reminderTime/repeatType/priority/color/icon/status/createdAt/updatedAt）。
//  2. **向后兼容**：老数据只有 { title, date, yearly, category(中文), note, createTime,
//     updateTime }，normalize() 会在读取时一次性补齐新字段，旧 key 不丢数据也不报错。
//  3. 展示字段（天数、星期、倒计时文案）一律在 refresh 时派生，**不落盘**，
//     这样跨天/跨年自动正确，不会出现「昨天算的天数今天还显示」。
//  4. 考研节点日期：官方已公布的用官方日期并标 official；其余按历年规律推算并标
//     estimated —— UI 会显式区分「官方 / 参考」，不把推算值伪装成官方通知。
import { get, set, remove } from './storage';

/* ============================ 类型 ============================ */

export type ImpCategory =
  | 'birthday'    // 生日
  | 'anniversary' // 纪念日
  | 'kaoyan'      // 考研节点
  | 'exam'        // 考试
  | 'work'        // 工作 / 实习
  | 'bill'        // 账单 / 到期
  | 'travel'      // 出行
  | 'lease'       // 租约
  | 'custom';     // 自定义

export type ImpRepeat = 'none' | 'yearly' | 'monthly' | 'custom';
export type ImpPriority = 'high' | 'normal' | 'low';
export type ImpStatus = 'active' | 'done' | 'archived';
export type ImpSortKey = 'nearest' | 'priority' | 'category' | 'custom';
/** 情绪标签：决定卡片配色语言与文案语气 */
export type ImpEmotion = 'expect' | 'memory' | 'anniv' | 'regret' | 'miss' | 'growth';

export interface ImpDay {
  id: string;
  title: string;
  /** 锚定日期 YYYY-MM-DD */
  date: string;
  /** 事件时刻 HH:mm */
  time: string;
  category: ImpCategory;
  description: string;
  /** 是否开启提醒 */
  reminder: boolean;
  /** 提前几天提醒 */
  reminderTime: number;
  repeatType: ImpRepeat;
  /** repeatType==='custom' 时的间隔天数 */
  repeatDays?: number;
  priority: ImpPriority;
  color: string;
  icon: string;
  status: ImpStatus;
  createdAt: number;
  updatedAt: number;
  /** 自定义排序位（越小越靠前） */
  order?: number;
  /** 情绪标签（人生时刻记录册） */
  emotion?: ImpEmotion;
  /** 卡片配图：本地路径 / 云端 fileID / 网络图 */
  photo?: string;
  /** 该条是否为 Hero 主推（可手动置顶） */
  pinned?: boolean;
  /** 系统预置（考研节点）：日期带官方/参考标记 */
  preset?: boolean;
  presetKey?: string;
  cloudId?: string;
}

/** 写入入参：除 title/date 外全部可选；兼容老字段 */
export interface ImpInput {
  id?: string;
  title: string;
  date: string;
  time?: string;
  category?: string;
  description?: string;
  reminder?: boolean;
  reminderTime?: number;
  repeatType?: string;
  repeatDays?: number;
  priority?: string;
  color?: string;
  icon?: string;
  status?: string;
  order?: number;
  emotion?: string;
  photo?: string;
  pinned?: boolean;
  preset?: boolean;
  presetKey?: string;
  /** @deprecated 旧字段：每年重复 */
  yearly?: boolean;
  /** @deprecated 旧字段：备注 */
  note?: string;
  /** @deprecated 旧字段 */
  createTime?: number;
  /** @deprecated 旧字段 */
  updateTime?: number;
}

export interface ImpCategoryDef {
  key: ImpCategory;
  label: string;
  icon: string;
  /** 主色（图标描边 / 强调文字） */
  color: string;
  /** 极浅底 */
  soft: string;
  /** 芯片渐变 */
  grad: string;
}

export interface ImpRepeatDef { key: ImpRepeat; label: string }

/* ============================ 常量 ============================ */

/** 九大分类：顺序即「分类排序」的先后 */
export const IMP_CATEGORIES: ImpCategoryDef[] = [
  { key: 'birthday',    label: '生日',      icon: '🎂', color: '#E488A6', soft: '#FDEDF3', grad: 'linear-gradient(135deg,#FBD5E3,#F5B3CC)' },
  { key: 'anniversary', label: '纪念日',    icon: '❤️', color: '#E4708E', soft: '#FDEDF1', grad: 'linear-gradient(135deg,#FBC8D7,#F5A2BB)' },
  { key: 'kaoyan',      label: '考研节点',  icon: '🎓', color: '#6C7BE0', soft: '#EEF0FC', grad: 'linear-gradient(135deg,#CBD2F8,#A9B4F0)' },
  { key: 'exam',        label: '考试',      icon: '📚', color: '#5C97DA', soft: '#EDF4FD', grad: 'linear-gradient(135deg,#C7DFF8,#A6CBF3)' },
  { key: 'work',        label: '工作实习',  icon: '💼', color: '#6E9CBF', soft: '#EDF5F9', grad: 'linear-gradient(135deg,#C9E0ED,#AACDE1)' },
  { key: 'bill',        label: '账单到期',  icon: '💰', color: '#D9A45C', soft: '#FDF4E9', grad: 'linear-gradient(135deg,#F8E1BF,#F0CC9A)' },
  { key: 'travel',      label: '出行',      icon: '✈️', color: '#5FB3C4', soft: '#EAF7F9', grad: 'linear-gradient(135deg,#BDE7EF,#97D5E1)' },
  { key: 'lease',       label: '租约',      icon: '🏠', color: '#9B8AD8', soft: '#F1EFFB', grad: 'linear-gradient(135deg,#D6CCF4,#BDADEC)' },
  { key: 'custom',      label: '自定义',    icon: '📅', color: '#8C9BB5', soft: '#EEF1F6', grad: 'linear-gradient(135deg,#D4DBE7,#BBC5D5)' }
];

export const IMP_CATEGORY_MAP: Record<string, ImpCategoryDef> = IMP_CATEGORIES.reduce(
  (acc, c) => { acc[c.key] = c; return acc; },
  {} as Record<string, ImpCategoryDef>
);

/** 老数据的中文分类 → 新 key */
const LEGACY_CATEGORY: Record<string, ImpCategory> = {
  生日: 'birthday',
  纪念日: 'anniversary',
  到期日: 'bill',
  其他: 'custom',
  考试: 'exam',
  工作: 'work',
  出行: 'travel',
  租约: 'lease',
  自定义: 'custom'
};

/** 兼容旧调用方（love/cycle 等）：按中文分类取图标 */
export const IMP_CATEGORY_ICON: Record<string, string> = IMP_CATEGORIES.reduce(
  (acc, c) => { acc[c.label] = c.icon; return acc; },
  { 其他: '📅' } as Record<string, string>
);

export const IMP_REPEATS: ImpRepeatDef[] = [
  { key: 'none',    label: '不重复' },
  { key: 'yearly',  label: '每年' },
  { key: 'monthly', label: '每月' },
  { key: 'custom',  label: '自定义' }
];

export const IMP_REMIND_OPTIONS: number[] = [1, 3, 7, 30];

export const IMP_SORTS: { key: ImpSortKey; label: string; icon: string }[] = [
  { key: 'nearest',  label: '最近发生',   icon: '⚡' },
  { key: 'priority', label: '优先级最高', icon: '🔥' },
  { key: 'category', label: '按分类',     icon: '🗂' },
  { key: 'custom',   label: '自定义排序', icon: '✋' }
];

export const IMP_PRIORITY: Record<ImpPriority, { label: string; color: string }> = {
  high:   { label: '高', color: '#E4708E' },
  normal: { label: '普通', color: '#6C7BE0' },
  low:    { label: '低', color: '#9AA6BC' }
};

/* ============================ 情绪体系 ============================
   倒数日不只是工具，也是「人生重要时刻记录册」：
   期待 / 回忆 / 纪念 / 遗憾 / 想念 / 成长 各有一套视觉语言。
   低饱和、高级、克制，不做高饱和糖果色。 */

export interface ImpEmotionDef {
  key: ImpEmotion;
  label: string;
  icon: string;
  /** 标签底色 */
  bg: string;
  /** 标签文字色 */
  color: string;
  /** 卡片左侧情绪条 / 强调色 */
  accent: string;
  /** 一句引导语（分类条右侧） */
  hint: string;
}

export const IMP_EMOTIONS: ImpEmotionDef[] = [
  { key: 'expect', label: '期待', icon: '🌸', bg: '#FFF0F2', color: '#D9788', accent: '#E79AA6', hint: '愿所有的等待，都有意义' },
  { key: 'memory', label: '回忆', icon: '📷', bg: '#EEF3F8', color: '#7189A3', accent: '#93A9C0', hint: '那天光很轻，风也很轻' },
  { key: 'anniv',  label: '纪念', icon: '♡',  bg: '#FFF4DC', color: '#C5964A', accent: '#DCB877', hint: '认真记住的每一天' },
  { key: 'regret', label: '遗憾', icon: '☁',  bg: '#F0EDF2', color: '#887A8D', accent: '#A99CAF', hint: '来不及说的，都留在心里' },
  { key: 'miss',   label: '想念', icon: '♡',  bg: '#F6EAF2', color: '#B46F9B', accent: '#CE93B6', hint: '有些人住在很久以前' },
  { key: 'growth', label: '成长', icon: '🍃', bg: '#EAF4EB', color: '#729477', accent: '#95B79A', hint: '走过的路，都算数' }
];

export const IMP_EMOTION_MAP: Record<string, ImpEmotionDef> = IMP_EMOTIONS.reduce(
  (acc, e) => { acc[e.key] = e; return acc; },
  {} as Record<string, ImpEmotionDef>
);

function normalizeEmotion(raw: unknown): ImpEmotion {
  const s = String(raw || '').trim();
  if (IMP_EMOTION_MAP[s]) return s as ImpEmotion;
  const byLabel = IMP_EMOTIONS.find((e) => e.label === s);
  return byLabel ? byLabel.key : 'expect';
}

/** 内置情绪配图池（本地压缩图，供新建时一键选用 / 无图时随机兜底） */
export const IMP_PHOTO_POOL: { key: string; label: string; src: string }[] = [
  { key: 'sea',    label: '海边黄昏', src: '/subpackages/toolbox/assets/countdown/hero.jpg' },
  { key: 'sakura', label: '春日樱花', src: '/subpackages/toolbox/assets/countdown/cd-sakura.jpg' },
  { key: 'night',  label: '城市夜色', src: '/subpackages/toolbox/assets/countdown/cd-night.jpg' },
  { key: 'shore',  label: '清晨海面', src: '/subpackages/toolbox/assets/countdown/cd-sea.jpg' },
  { key: 'cat',    label: '午后猫咪', src: '/subpackages/toolbox/assets/countdown/cd-cat.jpg' },
  { key: 'diary',  label: '旧日手记', src: '/subpackages/toolbox/assets/countdown/cd-diary.jpg' }
];

/** 按 id 稳定挑一张内置图（同一条每次进入拿到同一张，不闪变） */
export function defaultPhotoFor(seed: string): string {
  const pool = IMP_PHOTO_POOL;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length].src;
}

const WEEKDAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

const KEY = 'imp_days_v1';
const KAOYAN_TARGET_KEY = 'imp_kaoyan_target';
/** 用户手动改过的考研节点日期：{ [cohort_key]: 'YYYY-MM-DD' } */
const KAOYAN_DATE_OVR_KEY = 'imp_kaoyan_date_ovr';
/** 用户手动指定的考研届次（0 = 自动跟随） */
const KAOYAN_COHORT_KEY = 'imp_kaoyan_cohort';
/** 首页是否显示考研倒计时卡片 */
const HOME_BANNER_KEY = 'imp_home_banner';

/* ============================ 基础工具 ============================ */

export function uid(): string {
  return 'imp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

export function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 解析 YYYY-MM-DD → { y, m, d }（非法返回 null） */
export function parseYMD(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((s || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** 当天 00:00 的时间戳 */
export function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 构造某年某月某日 00:00（自动处理 2/31 这类溢出 → 落到月末，兼容 2/29 非闰年） */
function makeDate(y: number, m: number, d: number): number {
  const dim = new Date(y, m, 0).getDate(); // m 为 1-12
  const dd = Math.min(d, dim);
  return new Date(y, m - 1, dd).getTime();
}

export function weekdayCnOf(ts: number): string {
  return WEEKDAY_CN[new Date(ts).getDay()];
}

export function monthCnOf(m: number): string {
  return MONTH_CN[Math.max(1, Math.min(12, m)) - 1];
}

/* ============================ 规范化 / 读写 ============================ */

function normalizeCategory(raw: unknown): ImpCategory {
  const s = String(raw || '').trim();
  if (!s) return 'custom';
  if (IMP_CATEGORY_MAP[s]) return s as ImpCategory;
  return LEGACY_CATEGORY[s] || 'custom';
}

function normalizeRepeat(raw: unknown, yearly: unknown): ImpRepeat {
  const s = String(raw || '').trim();
  if (s === 'none' || s === 'yearly' || s === 'monthly' || s === 'custom') return s;
  return yearly === true ? 'yearly' : 'none';
}

function normalizePriority(raw: unknown): ImpPriority {
  const s = String(raw || '').trim();
  if (s === 'high' || s === 'normal' || s === 'low') return s;
  if (s === '高') return 'high';
  if (s === '低') return 'low';
  return 'normal';
}

function normalizeStatus(raw: unknown): ImpStatus {
  const s = String(raw || '').trim();
  if (s === 'done' || s === 'archived' || s === 'active') return s;
  return 'active';
}

function normalizeTime(raw: unknown): string {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return '09:00';
  const h = Math.max(0, Math.min(23, +m[1]));
  return `${pad2(h)}:${m[2]}`;
}

/** 任意历史数据 → 完整 ImpDay */
export function normalizeDay(raw: unknown): ImpDay | null {
  const r = (raw || {}) as Record<string, unknown>;
  const title = String(r.title || '').trim();
  const date = String(r.date || '').trim();
  if (!title || !parseYMD(date)) return null;

  const category = normalizeCategory(r.category);
  const def = IMP_CATEGORY_MAP[category];
  const repeatType = normalizeRepeat(r.repeatType, r.yearly);
  const createdAt = Number(r.createdAt || r.createTime || Date.now()) || Date.now();
  const updatedAt = Number(r.updatedAt || r.updateTime || createdAt) || createdAt;
  const descRaw = r.description !== undefined ? r.description : r.note;

  return {
    id: String(r.id || uid()),
    title,
    date,
    time: normalizeTime(r.time),
    category,
    description: String(descRaw || ''),
    reminder: r.reminder === undefined ? false : !!r.reminder,
    reminderTime: IMP_REMIND_OPTIONS.indexOf(Number(r.reminderTime)) >= 0 ? Number(r.reminderTime) : 1,
    repeatType,
    repeatDays: repeatType === 'custom' ? Math.max(1, Number(r.repeatDays) || 30) : undefined,
    priority: normalizePriority(r.priority),
    color: String(r.color || def.color),
    icon: String(r.icon || def.icon),
    status: normalizeStatus(r.status),
    createdAt,
    updatedAt,
    order: r.order === undefined ? undefined : Number(r.order),
    emotion: normalizeEmotion(r.emotion),
    photo: r.photo ? String(r.photo) : undefined,
    pinned: !!r.pinned,
    preset: !!r.preset,
    presetKey: r.presetKey ? String(r.presetKey) : undefined,
    cloudId: r.cloudId ? String(r.cloudId) : undefined
  };
}

export function loadDays(): ImpDay[] {
  const list = get<unknown[]>(KEY, []);
  if (!Array.isArray(list)) return [];
  const out: ImpDay[] = [];
  for (const item of list) {
    const d = normalizeDay(item);
    if (d) out.push(d);
  }
  return out;
}

export function saveDays(list: ImpDay[]): void {
  set(KEY, list);
}

export function getDay(id: string): ImpDay | null {
  return loadDays().find((d) => d.id === id) || null;
}

/** 新增（兼容旧调用：可只传 title/date，其余走默认值） */
export function addDay(input: ImpInput): ImpDay[] {
  const now = Date.now();
  const d = normalizeDay({
    ...input,
    id: input.id || uid(),
    createdAt: input.createTime || now,
    updatedAt: now
  });
  if (!d) return loadDays();
  const list = loadDays();
  list.unshift(d);
  saveDays(list);
  return list;
}

/** 批量新增，返回真正写入的条数 */
export function addDays(inputs: ImpInput[]): number {
  if (!inputs.length) return 0;
  const list = loadDays();
  let n = 0;
  for (const input of inputs) {
    const d = normalizeDay({ ...input, id: input.id || uid() });
    if (!d) continue;
    list.unshift(d);
    n += 1;
  }
  if (n) saveDays(list);
  return n;
}

export function updateDay(id: string, patch: Partial<ImpInput>): ImpDay[] {
  const list = loadDays().map((d) => {
    if (d.id !== id) return d;
    const merged = normalizeDay({ ...d, ...patch, id: d.id, updatedAt: Date.now() });
    return merged || d;
  });
  saveDays(list);
  return list;
}

export function removeDay(id: string): ImpDay[] {
  const list = loadDays().filter((d) => d.id !== id);
  saveDays(list);
  return list;
}

export function removeDays(ids: string[]): ImpDay[] {
  const set0 = new Set(ids);
  const list = loadDays().filter((d) => !set0.has(d.id));
  saveDays(list);
  return list;
}

export function clearDays(): void {
  remove(KEY);
}

/** 一键复制：标题加「副本」，日期沿用，重置为未完成 */
export function duplicateDay(id: string): ImpDay | null {
  const src = getDay(id);
  if (!src) return null;
  const list = addDay({ ...src, id: uid(), title: withCopySuffix(src.title), status: 'active' });
  return list[0] || null;
}

function withCopySuffix(title: string): string {
  const t = title.replace(/\s*副本(\d*)$/, '');
  const base = `${t} 副本`;
  const exist = loadDays().filter((d) => d.title.indexOf(base) === 0).length;
  return exist > 0 ? `${base}${exist + 1}` : base;
}

/** 在自定义排序里上移 / 置顶 */
export function reorder(id: string, dir: 'top' | 'up' | 'down'): void {
  const list = loadDays();
  const sorted = sortDays(list.map((d) => decorate(d)), 'custom');
  const idx = sorted.findIndex((v) => v.id === id);
  if (idx < 0) return;
  const ids = sorted.map((v) => v.id);
  if (dir === 'top') {
    ids.splice(idx, 1);
    ids.unshift(id);
  } else {
    const to = dir === 'up' ? idx - 1 : idx + 1;
    if (to < 0 || to >= ids.length) return;
    ids.splice(idx, 1);
    ids.splice(to, 0, id);
  }
  const orderMap: Record<string, number> = {};
  ids.forEach((x, i) => { orderMap[x] = i; });
  saveDays(list.map((d) => (orderMap[d.id] === undefined ? d : { ...d, order: orderMap[d.id], updatedAt: d.updatedAt })));
}

/* ============================ 派生展示 ============================ */

export interface ImpView {
  id: string;
  title: string;
  date: string;
  time: string;
  category: ImpCategory;
  categoryLabel: string;
  categoryIcon: string;
  categoryColor: string;
  categorySoft: string;
  categoryGrad: string;
  description: string;
  reminder: boolean;
  reminderTime: number;
  reminderText: string;
  repeatType: ImpRepeat;
  repeatLabel: string;
  priority: ImpPriority;
  priorityLabel: string;
  priorityColor: string;
  color: string;
  icon: string;
  status: ImpStatus;
  statusLabel: string;
  /** 本次目标日 YYYY-MM-DD（每年/每月重复会顺延到未来那一次） */
  anchorDate: string;
  anchorTs: number;
  dayDiff: number;
  isToday: boolean;
  isTomorrow: boolean;
  isPast: boolean;
  /** 距事件 < 7 天 → 临近提醒 */
  urgent: boolean;
  bigNum: number;
  countdownText: string;
  dateText: string;
  dayNumText: string;
  monthText: string;
  weekdayText: string;
  weeksText: string;
  labelText: string;
  /* ---- 情绪记录册（人生时刻） ---- */
  emotion: ImpEmotion;
  emotionLabel: string;
  emotionIcon: string;
  emotionBg: string;
  emotionColor: string;
  emotionAccent: string;
  /** 卡片 / Hero 配图（可能为空 → 走情绪渐变占位） */
  photo: string;
  pinned: boolean;
  /** 「还有 128 天」/「已过 654 天」/「就是今天 ♡」 */
  dayPhrase: string;
  /** 短天数（Hero / 卡片大数字） */
  dayNum: number;
  /** 该条对应的默认情绪底色（无图时作占位渐变） */
  photoFallback: string;
  createdAt: number;
  order: number;
  preset: boolean;
  presetKey: string;
}

/** 兼容旧名 */
export type DecoratedImpDay = ImpView;

function repeatLabelOf(d: ImpDay): string {
  if (d.repeatType === 'yearly') return '每年';
  if (d.repeatType === 'monthly') return '每月';
  if (d.repeatType === 'custom') return `每 ${d.repeatDays || 30} 天`;
  return '';
}

function statusLabelOf(s: ImpStatus): string {
  if (s === 'done') return '已完成';
  if (s === 'archived') return '已归档';
  return '';
}

/** 计算「本次目标日」的时间戳 */
function anchorOf(d: ImpDay, todayStart: number): number {
  const p = parseYMD(d.date);
  if (!p) return todayStart;
  const thisYear = new Date(todayStart).getFullYear();

  if (d.repeatType === 'yearly') {
    const t = makeDate(thisYear, p.m, p.d);
    return t >= todayStart ? t : makeDate(thisYear + 1, p.m, p.d);
  }
  if (d.repeatType === 'monthly') {
    const now = new Date(todayStart);
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    let t = makeDate(y, m, p.d);
    if (t < todayStart) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      t = makeDate(y, m, p.d);
    }
    return t;
  }
  if (d.repeatType === 'custom') {
    const step = Math.max(1, d.repeatDays || 30);
    let t = makeDate(p.y, p.m, p.d);
    if (t < todayStart) {
      const steps = Math.ceil((todayStart - t) / (step * 86400000));
      t = t + steps * step * 86400000;
    }
    return t;
  }
  // 不重复：锚定用户填的那一天（可过去）
  return makeDate(p.y, p.m, p.d);
}

export function decorate(d: ImpDay, now = Date.now()): ImpView {
  const todayStart = dayStart(now);
  const anchorTs = anchorOf(d, todayStart);
  const dayDiff = Math.round((anchorTs - todayStart) / 86400000);
  const isToday = dayDiff === 0;
  const isTomorrow = dayDiff === 1;
  const isPast = dayDiff < 0;
  const categoryDef = IMP_CATEGORY_MAP[d.category] || IMP_CATEGORY_MAP.custom;
  const anchorDate = toYMD(new Date(anchorTs));
  const weekdayText = weekdayCnOf(anchorTs);
  const p = parseYMD(anchorDate) || { y: 0, m: 1, d: 1 };

  let countdownText: string;
  if (isToday) countdownText = '今天';
  else if (isTomorrow) countdownText = '明天';
  else if (isPast) countdownText = `已过期 ${-dayDiff} 天`;
  else countdownText = `还有 ${dayDiff} 天`;

  const absDays = Math.abs(dayDiff);
  const weeks = Math.floor(absDays / 7);
  const restDays = absDays % 7;
  const weeksText = isToday
    ? '就是今天'
    : `${isPast ? '已过去' : '距目标还有'} ${weeks > 0 ? `${weeks}周` : ''}${restDays}天`;

  /* 情绪：按「未来 / 当天 / 过去」自动给一个默认倾向，用户没选也能有情绪色彩 */
  const emoKey: ImpEmotion = d.emotion
    ? d.emotion
    : (isToday ? 'anniv' : isPast ? 'memory' : 'expect');
  const emo = IMP_EMOTION_MAP[emoKey] || IMP_EMOTION_MAP.expect;
  const dayPhrase = isToday ? '就是今天 ♡' : isPast ? `已过 ${absDays} 天` : `还有 ${absDays} 天`;
  const photoFallback = `linear-gradient(160deg, ${emo.bg}, ${emo.bg} 55%, #FFFDFB)`;

  return {
    id: d.id,
    title: d.title,
    date: d.date,
    time: d.time,
    category: d.category,
    categoryLabel: categoryDef.label,
    categoryIcon: d.icon || categoryDef.icon,
    categoryColor: categoryDef.color,
    categorySoft: categoryDef.soft,
    categoryGrad: categoryDef.grad,
    description: d.description,
    reminder: d.reminder,
    reminderTime: d.reminderTime,
    reminderText: d.reminder ? `提前 ${d.reminderTime} 天` : '未开启提醒',
    repeatType: d.repeatType,
    repeatLabel: repeatLabelOf(d),
    priority: d.priority,
    priorityLabel: IMP_PRIORITY[d.priority].label,
    priorityColor: IMP_PRIORITY[d.priority].color,
    color: d.color || categoryDef.color,
    icon: d.icon || categoryDef.icon,
    status: d.status,
    statusLabel: statusLabelOf(d.status),
    anchorDate,
    anchorTs,
    dayDiff,
    isToday,
    isTomorrow,
    isPast,
    urgent: !isPast && dayDiff < 7,
    bigNum: absDays,
    countdownText,
    dateText: `${p.y}.${pad2(p.m)}.${pad2(p.d)}`,
    dayNumText: pad2(p.d),
    monthText: monthCnOf(p.m),
    weekdayText,
    weeksText,
    labelText: isPast ? '已过去' : '距目标还有',
    emotion: emo.key,
    emotionLabel: emo.label,
    emotionIcon: emo.icon,
    emotionBg: emo.bg,
    emotionColor: emo.color,
    emotionAccent: emo.accent,
    photo: d.photo || '',
    pinned: !!d.pinned,
    dayPhrase,
    dayNum: absDays,
    photoFallback,
    createdAt: d.createdAt,
    order: d.order === undefined ? Number.MAX_SAFE_INTEGER : d.order,
    preset: !!d.preset,
    presetKey: d.presetKey || ''
  };
}

/** 兼容旧名 */
export function split(list: ImpDay[], now = Date.now()): { future: ImpView[]; past: ImpView[] } {
  return splitViews(list.map((d) => decorate(d, now)));
}

export function splitViews(views: ImpView[]): { future: ImpView[]; past: ImpView[] } {
  const isClosed = (v: ImpView) => v.status === 'done' || v.status === 'archived';
  const future = views.filter((v) => !isClosed(v) && !v.isPast);
  const past = views.filter((v) => (isClosed(v) ? true : v.isPast));
  return { future, past };
}

/* ============================ 排序 / 检索 / 筛选 ============================ */

function priorityWeight(p: ImpPriority): number {
  return p === 'high' ? 0 : p === 'normal' ? 1 : 2;
}

function categoryWeight(c: ImpCategory): number {
  const i = IMP_CATEGORIES.findIndex((x) => x.key === c);
  return i < 0 ? 99 : i;
}

/** 单页排序：距离最近 → 优先级 → 创建时间（默认），另有三种模式 */
export function sortDays(views: ImpView[], mode: ImpSortKey = 'nearest'): ImpView[] {
  const arr = [...views];
  if (mode === 'priority') {
    arr.sort((a, b) =>
      priorityWeight(a.priority) - priorityWeight(b.priority) ||
      Math.min(a.dayDiff, 1e6) - Math.min(b.dayDiff, 1e6) ||
      b.createdAt - a.createdAt);
    return arr;
  }
  if (mode === 'category') {
    arr.sort((a, b) =>
      categoryWeight(a.category) - categoryWeight(b.category) ||
      a.dayDiff - b.dayDiff ||
      b.createdAt - a.createdAt);
    return arr;
  }
  if (mode === 'custom') {
    arr.sort((a, b) => a.order - b.order || b.createdAt - a.createdAt);
    return arr;
  }
  arr.sort((a, b) =>
    a.dayDiff - b.dayDiff ||
    priorityWeight(a.priority) - priorityWeight(b.priority) ||
    b.createdAt - a.createdAt);
  return arr;
}

/** 搜索：标题 / 分类 / 备注 / 重复规则命中即算 */
export function searchViews(views: ImpView[], keyword: string): ImpView[] {
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) return views;
  return views.filter((v) =>
    v.title.toLowerCase().indexOf(kw) >= 0 ||
    v.categoryLabel.toLowerCase().indexOf(kw) >= 0 ||
    v.description.toLowerCase().indexOf(kw) >= 0 ||
    v.dateText.indexOf(kw) >= 0);
}

export function filterViews(views: ImpView[], category: ImpCategory | 'all'): ImpView[] {
  if (!category || category === 'all') return views;
  return views.filter((v) => v.category === category);
}

/** 分类计数（用于分类管理页） */
export function categoryCounts(views: ImpView[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const v of views) map[v.category] = (map[v.category] || 0) + 1;
  return map;
}

/** 下一条即将到来的重要日（首页联动用） */
export function nextUpcoming(list?: ImpDay[], now = Date.now()): ImpView | null {
  const src = list || loadDays();
  const { future } = splitViews(src.map((d) => decorate(d, now)));
  const sorted = sortDays(future, 'nearest');
  return sorted[0] || null;
}

/** 未来 30 天内的重要日条数（首页角标用） */
export function upcomingInDays(days: number, list?: ImpDay[], now = Date.now()): number {
  const src = list || loadDays();
  const { future } = splitViews(src.map((d) => decorate(d, now)));
  return future.filter((v) => v.dayDiff <= days).length;
}

function isSameMonthDay(a: string, b: string): boolean {
  const pa = parseYMD(a), pb = parseYMD(b);
  return !!pa && !!pb && pa.m === pb.m && pa.d === pb.d;
}

/** 按日期取重要日（日历页标记用）—— 含每年重复的「月日命中」 */
export function viewsOnDate(ymd: string, list?: ImpDay[]): ImpView[] {
  const src = list || loadDays();
  const out: ImpView[] = [];
  for (const d of src) {
    if (d.repeatType === 'none' || d.repeatType === 'custom') {
      if (d.date === ymd) out.push(decorate(d, new Date(ymd + 'T00:00:00').getTime()));
      continue;
    }
    if (d.repeatType === 'yearly' && isSameMonthDay(d.date, ymd)) {
      out.push(decorate(d, new Date(ymd + 'T00:00:00').getTime()));
      continue;
    }
    if (d.repeatType === 'monthly') {
      const pa = parseYMD(d.date), pb = parseYMD(ymd);
      if (pa && pb && pa.d === pb.d) out.push(decorate(d, new Date(ymd + 'T00:00:00').getTime()));
    }
  }
  return out;
}

/** 某月内有重要日的日期集合（日历页角标用） */
export function datesInMonth(year: number, month: number, list?: ImpDay[]): Record<string, number> {
  const src = list || loadDays();
  const map: Record<string, number> = {};
  const add = (ymd: string) => { map[ymd] = (map[ymd] || 0) + 1; };
  const dim = new Date(year, month, 0).getDate();
  for (const d of src) {
    if (d.status !== 'active') continue;
    const p = parseYMD(d.date);
    if (!p) continue;
    if (d.repeatType === 'none' || d.repeatType === 'custom') {
      if (p.y === year && p.m === month) add(toYMD(new Date(year, month - 1, Math.min(p.d, dim))));
      continue;
    }
    if (d.repeatType === 'yearly') {
      add(toYMD(new Date(year, month - 1, Math.min(p.d, dim))));
      continue;
    }
    // 每月重复：本月每一天的「同一个日号」
    if (p.d <= dim) add(toYMD(new Date(year, month - 1, p.d)));
  }
  return map;
}

/* ============================ 提醒时刻 ============================ */

/**
 * 本条重要日的「提醒时刻」时间戳：本次目标日当天 time，再往前推 reminderTime 天。
 * 关闭提醒或已完成 → 返回 0（调度器据此跳过）。
 */
export function reminderAtOf(d: ImpDay, now = Date.now()): number {
  if (!d.reminder || d.status !== 'active') return 0;
  const todayStart = dayStart(now);
  const anchor = anchorOf(d, todayStart);
  const t = normalizeTime(d.time);
  const hh = Number(t.slice(0, 2));
  const mm = Number(t.slice(3, 5));
  const at = anchor + hh * 3600000 + mm * 60000 - Math.max(0, d.reminderTime) * 86400000;
  return at;
}

/* ============================ 考研节点 ============================ */

export interface KaoyanNodeDef {
  key: string;
  name: string;
  desc: string;
  /** YYYY-MM-DD */
  date: string;
  /** 官方已公布（否则为按惯例推算） */
  official: boolean;
  /** 该日期被用户手动改过 */
  edited?: boolean;
}

/** 12 月的第 3 个星期六 —— 历年初试日期规律 */
function thirdSaturdayDec(year: number): Date {
  const first = new Date(year, 11, 1);
  const offset = (6 - first.getDay() + 7) % 7; // 距第一个周六
  return new Date(year, 11, 1 + offset + 14, 0, 0, 0, 0);
}

/**
 * 当前进行中的考研届次（入学年）。
 * 规则：每年 9 月 1 日起进入下一届（其初试在当年 12 月）；
 * 9 月 1 日之前仍属本届（初试在去年 12 月，正在等成绩/复试/录取）。
 */
export function activeKaoyanCohort(now = Date.now()): number {
  const d = new Date(now);
  const sept1 = new Date(d.getFullYear(), 8, 1).getTime();
  return now >= sept1 ? d.getFullYear() + 1 : d.getFullYear();
}

/**
 * 生效的考研届次：用户在设置里手动指定过就用指定的，否则跟随当前届次。
 * 重要日页与首页倒计时都读这里，保证「改期」后两边显示一致。
 */
export function currentCohort(now = Date.now()): number {
  const v = get<number>(KAOYAN_COHORT_KEY, 0);
  return v > 0 ? v : activeKaoyanCohort(now);
}

/** 手动指定届次（传 0 恢复自动跟随） */
export function saveCohortOverride(cohort: number): void {
  set(KAOYAN_COHORT_KEY, cohort > 0 ? cohort : 0);
}

/* ---------- 首页倒计时卡片开关 ---------- */

/** 首页是否显示「考研倒计时 + 最近的重要日」卡片（默认显示） */
export function loadHomeBanner(): boolean {
  return get<boolean>(HOME_BANNER_KEY, true) !== false;
}

export function saveHomeBanner(show: boolean): void {
  set(HOME_BANNER_KEY, !!show);
}


/** 2027 届官方日期（教育部《2027 年全国硕士研究生招生工作管理规定》） */
const OFFICIAL_2027: Record<string, string> = {
  baoming: '2026-10-15',
  chushi: '2026-12-19'
};

const NODE_META: { key: string; name: string; desc: string }[] = [
  { key: 'baoming',   name: '考研报名',   desc: '网上报名，逾期不补办' },
  { key: 'queren',    name: '网上确认',   desc: '各省自行安排，注意公告' },
  { key: 'zhunkao',   name: '准考证打印', desc: '一般考前约 10 天开放下载' },
  { key: 'chushi',    name: '初试',       desc: '全国统一考试，两天四科' },
  { key: 'chengji',   name: '成绩公布',   desc: '一般次年 2 月中下旬' },
  { key: 'guojiaxian',name: '国家线公布', desc: '一般 3 月中旬' },
  { key: 'fushi',     name: '复试',       desc: '一般 3 月下旬至 4 月' },
  { key: 'tiaoji',    name: '调剂',       desc: '研招网调剂系统一般 4 月开放' },
  { key: 'luqu',      name: '录取',       desc: '一般 5—6 月下发拟录取' },
  { key: 'kaixue',    name: '开学',       desc: '一般 9 月初入学报到' }
];

function ymd(d: Date): string { return toYMD(d); }

/**
 * 某一届考研的关键节点日期。
 * @param cohort 入学年，如 2027 表示 2027 年入学（初试在 2026 年 12 月）
 */
export function kaoyanNodes(cohort: number): KaoyanNodeDef[] {
  const examYear = cohort - 1;                 // 初试所在年
  const exam = thirdSaturdayDec(examYear);
  const next = cohort;                          // 成绩之后的年份 = 入学年
  const off = (key: string, fallback: string) =>
    (cohort === 2027 && OFFICIAL_2027[key]) ? OFFICIAL_2027[key] : fallback;
  const isOfficial = (key: string) => cohort === 2027 && !!OFFICIAL_2027[key];

  const zhunkao = new Date(exam.getTime() - 10 * 86400000);
  const table: Record<string, string> = {
    baoming:    off('baoming', `${examYear}-10-15`),
    queren:     `${examYear}-11-05`,
    zhunkao:    ymd(zhunkao),
    chushi:     off('chushi', ymd(exam)),
    chengji:    `${next}-02-21`,
    guojiaxian: `${next}-03-11`,
    fushi:      `${next}-03-20`,
    tiaoji:     `${next}-04-06`,
    luqu:       `${next}-05-15`,
    kaixue:     `${next}-09-01`
  };

  return NODE_META.map((m) => {
    const ovr = loadKaoyanDateOverride(cohort, m.key);
    return {
      key: m.key,
      name: m.name,
      desc: m.desc,
      date: ovr || table[m.key],
      official: isOfficial(m.key),
      /** 该日期被用户手动改过（不再等同于官方/推算基线） */
      edited: !!ovr
    };
  });
}

/** 报名官方补充说明（2027 届） */
export const KAOYAN_BAOMING_NOTE = cohort2027Note();
function cohort2027Note(): string {
  return '网上报名 2026-10-15 至 10-24（预报名 10-09 至 10-12），每日 9:00—22:00';
}

export interface KaoyanPanel {
  cohort: number;
  cohortLabel: string;
  nodes: KaoyanNodeDef[];
  /** 已存在（按 presetKey 去重）的节点 key */
  added: string[];
}

export function kaoyanPanel(now = Date.now()): KaoyanPanel {
  const cohort = activeKaoyanCohort(now);
  const nodes = kaoyanNodes(cohort);
  const added = loadDays()
    .filter((d) => d.preset && d.presetKey)
    .map((d) => `${d.presetKey}`);
  return { cohort, cohortLabel: `${cohort} 考研`, nodes, added };
}

/** 一键把若干考研节点写进重要日（date 由调用方按需覆盖） */
export function importKaoyanNodes(
  picks: { node: KaoyanNodeDef; date?: string }[]
): number {
  const inputs: ImpInput[] = picks.map(({ node, date }) => {
    const def = IMP_CATEGORY_MAP.kaoyan;
    return {
      title: `考研${node.name}`,
      date: date || node.date,
      time: '09:00',
      category: 'kaoyan' as const,
      description: node.official
        ? `${node.desc}（教育部已公布）`
        : `${node.desc}（按历年规律推算，请以官方通知为准）`,
      reminder: true,
      reminderTime: 3,
      repeatType: 'none' as const,
      priority: node.key === 'chushi' ? ('high' as const) : ('normal' as const),
      color: def.color,
      icon: def.icon,
      status: 'active' as const,
      preset: true,
      presetKey: node.key
    };
  });
  return addDays(inputs);
}

/* ============================ 考研倒计时（首页联动） ============================ */

export interface KaoyanCountdown {
  show: boolean;
  cohort: number;
  /** 目标节点名，如「初试」 */
  nodeName: string;
  ymd: string;
  ts: number;
  dayDiff: number;
  dateText: string;
  weekdayText: string;
  weeksText: string;
  /** 「距离考研 81 天」用得到的大数字 */
  days: number;
  official: boolean;
}

export function loadKaoyanTarget(): string {
  // 默认空串 = 还没设过倒计时目标（此时重要日页与首页都不显示考研倒计时）
  return get<string>(KAOYAN_TARGET_KEY, '') || '';
}

export function saveKaoyanTarget(key: string): void {
  set(KAOYAN_TARGET_KEY, key || '');
}

/* ---------- 考研节点日期手动覆盖（官方/推算发布后可自行修正） ---------- */

function overrideMap(): Record<string, string> {
  const v = get<Record<string, string>>(KAOYAN_DATE_OVR_KEY, {});
  return v && typeof v === 'object' ? v : {};
}

/** 读取某届某节点被手动改过的日期；未改过返回空串 */
export function loadKaoyanDateOverride(cohort: number, key: string): string {
  return overrideMap()[`${cohort}_${key}`] || '';
}

/** 手动改期（传空串则清除覆盖，回到官方/推算基线） */
export function saveKaoyanDateOverride(cohort: number, key: string, ymd: string): void {
  const m = overrideMap();
  const k = `${cohort}_${key}`;
  if (!ymd || !parseYMD(ymd)) delete m[k];
  else m[k] = ymd;
  set(KAOYAN_DATE_OVR_KEY, m);
}

/**
 * 首页/重要日头部用的考研倒计时。
 * 目标节点默认「初试」；若初试已过，则自动顺延到该届下一个未过节点，
 * 避免出现「距离初试 -12 天」这种尴尬文案。
 */
export function kaoyanCountdown(now = Date.now()): KaoyanCountdown {
  const cohort = currentCohort(now);
  const nodes = kaoyanNodes(cohort);
  const todayStart = dayStart(now);
  const want = loadKaoyanTarget();
  // 只有用户显式「设为倒计时目标」后才有倒计时；没设过就不显示（不再默认回退到初试）
  let node = want ? nodes.find((n) => n.key === want) : undefined;
  if (node) {
    const targetTs = new Date(node.date + 'T00:00:00').getTime();
    if (targetTs < todayStart) {
      // 目标节点已过 → 顺延到该届下一个未过节点；没有则不显示
      node = nodes.find((n) => new Date(n.date + 'T00:00:00').getTime() >= todayStart);
    }
  }
  return buildCountdown(cohort, node, todayStart);
}

function buildCountdown(cohort: number, node: KaoyanNodeDef | undefined, todayStart: number): KaoyanCountdown {
  if (!node) {
    return {
      show: false, cohort, nodeName: '', ymd: '', ts: 0, dayDiff: 0,
      dateText: '', weekdayText: '', weeksText: '', days: 0, official: false
    };
  }
  const ts = new Date(node.date + 'T00:00:00').getTime();
  const dayDiff = Math.round((ts - todayStart) / 86400000);
  const abs = Math.abs(dayDiff);
  const weeks = Math.floor(abs / 7);
  const rest = abs % 7;
  const p = parseYMD(node.date) || { y: 0, m: 1, d: 1 };
  return {
    show: dayDiff >= 0,
    cohort,
    nodeName: node.name,
    ymd: node.date,
    ts,
    dayDiff,
    dateText: `${p.y}年${p.m}月${p.d}日`,
    weekdayText: weekdayCnOf(ts),
    weeksText: dayDiff === 0 ? '就是今天' : `${weeks > 0 ? `${weeks}周` : ''}${rest}天`,
    days: dayDiff,
    official: node.official
  };
}
