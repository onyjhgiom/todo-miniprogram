// utils/todo-store.ts
// 待办数据单一数据源（Single Source of Truth）
//
// 设计目标（对应「超大容量 + 实时刷新」两个诉求）：
//
//  1) 全量数据只驻留 JS 内存，绝不整体进入 setData。
//     小程序 setData 单次上限 1MB，把几千条待办（含装饰后的派生对象）整体下发会直接抛错，
//     且 setData 失败后回调不执行 —— 这正是「新建后列表不刷新」的根因。
//     页面只从 store 取「可视窗口」内的少量条目下发。
//
//  2) 变更事件广播：任意页面（首页/看板/小助手/面板/模板/详情）写入后，
//     由 cloud.ts 广播 → store 增量更新 → 首页订阅后立即重绘。无需手动刷新。
//
//  3) 派生字段（倒计时/头像/标签色/子任务进度）一次计算并缓存，避免每次过滤都重算；
//     排序结果惰性构建并缓存，关键字搜索复用同一份基础列表。
//
//  4) 分片持久化（utils/todo-shard）：写单条只改 1 个分片，O(1)，绕开单 key 1MB 上限。

import { callFn, toast, handleError, isActionSupported, isMissingOnServer } from './cloud';
import { onWrite, type WriteEvent } from './todo-events';
import * as shard from './todo-shard';
import type {
  ITodo,
  DecoratedTodo,
  CountdownInfo,
  CountdownKey,
  Priority,
  FilterKey,
  SearchFilters,
  CloudResult,
  IRecurrence,
  IReminder,
  IAttachment
} from '../types/index';

/* ============================ 常量 ============================ */

/** 首屏拉取条数：足够铺满 2~3 屏，保证首屏 <1s */
const FIRST_PAGE_SIZE = 60;
/** 后台补齐分页大小（云数据库单次 get 上限 1000，取 500 平衡请求数与包体） */
const PAGE_SIZE = 500;
/** 分页保护上限：最多 500 × 500 条 */
const MAX_PAGES = 200;
/** 单页安全阈值：超过该条数时首页启用虚拟列表 */
export const VIRTUAL_THRESHOLD = 120;

const PRIORITY_COLOR: Record<Priority, 'rose' | 'amber' | 'emerald'> = {
  high: 'rose',
  medium: 'amber',
  low: 'emerald'
};
const TAG_TONES = ['rose', 'amber', 'emerald', 'blue', 'violet', 'slate'];
const AVATAR_TONES = ['rose', 'amber', 'emerald', 'blue', 'violet'];

/* ============================ 内部状态 ============================ */

/** 原始数据：id -> ITodo（唯一事实来源） */
const items = new Map<string, ITodo>();
/** 装饰缓存：id -> DecoratedTodo（与 items 同生命周期；变更时失效） */
const deco = new Map<string, DecoratedTodo>();
/**
 * 临时 id → 真实 id 的别名表。
 * 新建时先用 local_xxx 占位上屏，云端返回真实 _id 后替换；
 * 若用户在替换前就点开详情，详情页拿到的还是临时 id，需要靠这张表解析。
 */
const idAlias = new Map<string, string>();
/** 排序后的基础列表缓存；任何数据变更置 null，由 list() 惰性重建 */
let sortedBase: DecoratedTodo[] | null = null;
/** 统计缓存 */
let statsCache: TodoStatsCache | null = null;

let hydrated = false;
let loadSeq = 0;
let serverTotal = 0;

/** 自身发起的写操作计数：忽略 callFn 回来的同源广播，避免重复应用 */
let selfOps = 0;

export interface TodoStatsCache {
  activeCount: number;
  doneCount: number;
  totalCount: number;
  todayDone: number;
  weekDone: number;
  streak: number;
}

export interface StoreEvent {
  /** reset=整体替换 progress=后台补齐一批 item=单条变更 */
  type: 'reset' | 'progress' | 'item';
  id?: string;
}

type StoreListener = (e: StoreEvent) => void;
const listeners: StoreListener[] = [];

/* ============================ 订阅 ============================ */

export function subscribe(fn: StoreListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function emit(e: StoreEvent): void {
  const snapshot = listeners.slice();
  for (const fn of snapshot) {
    try {
      fn(e);
    } catch (err) {
      console.error('[todo-store] listener error:', err);
    }
  }
}

function invalidate(): void {
  sortedBase = null;
  statsCache = null;
}

/* ============================ 本地删除墓碑 ============================ */
//
// 本地优先策略下，删除在本地立即生效，云端删除失败不回滚。
// 但云端若仍存在这条，下一次同步会把它重新拉回来，用户看到「删了又回来」。
// 因此把本地已删除的 id 记入墓碑，同步时跳过，直到云端确认删除成功。
const TOMBSTONE_KEY = 'todo_tombstones_v1';
let tombstones: Set<string> | null = null;

function tombstoneSet(): Set<string> {
  if (tombstones) return tombstones;
  try {
    const raw = wx.getStorageSync(TOMBSTONE_KEY);
    tombstones = new Set<string>(Array.isArray(raw) ? (raw as string[]) : []);
  } catch (_e) {
    tombstones = new Set<string>();
  }
  return tombstones;
}

function persistTombstones(): void {
  try {
    wx.setStorageSync(TOMBSTONE_KEY, Array.from(tombstoneSet()));
  } catch (_e) {
    /* 忽略：墓碑丢了只是多同步一次，不影响正确性 */
  }
}

function addTombstone(id: string): void {
  tombstoneSet().add(id);
  persistTombstones();
}

function clearTombstone(id: string): void {
  if (tombstoneSet().delete(id)) persistTombstones();
}

/** 本地已删除、云端可能仍存在的 id */
function isTombstoned(id: string): boolean {
  return tombstoneSet().has(id);
}

/** 本地新建、云端尚未确认的条目（临时 id） */
function isLocalOnly(id: string): boolean {
  return id.indexOf('local_') === 0;
}

/* ============================ 装饰（派生字段） ============================ */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDueDate(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function initialOf(name: string): string {
  const s = (name || '').trim();
  return s ? s.charAt(0).toUpperCase() : '?';
}

/** 毫秒差 → 「X天X小时X分钟」 */
function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin <= 0) return '不到1分钟';
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}分钟`);
  return parts.join('');
}

/** 仅用时间戳运算，避免 iOS 字符串日期解析兼容问题 */
function remainingInfo(due: number, diffDays: number): { key: CountdownKey; text: string } {
  const diff = due - Date.now();
  if (diff < 0) return { key: 'overdue', text: `已逾期 ${formatDuration(-diff)}` };
  let key: CountdownKey;
  if (diffDays <= 0) key = 'today';
  else if (diffDays === 1) key = 'tomorrow';
  else if (diffDays <= 7) key = 'week';
  else key = 'later';
  return { key, text: `还有 ${formatDuration(diff)}` };
}

function computeCountdown(due?: number | null): CountdownInfo {
  if (!due) return { key: 'none', text: '', days: Infinity };
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueStart = new Date(due);
  dueStart.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueStart.getTime() - todayStart) / 86400000);
  const info = remainingInfo(due, diffDays);
  return { key: info.key, text: info.text, days: diffDays };
}

function buildDecorated(it: ITodo): DecoratedTodo {
  const priority = (it.priority as Priority | null) || null;
  const people = Array.isArray(it.people) ? it.people : [];
  const tags = Array.isArray(it.tags) ? it.tags : [];
  const subtaskCount = typeof it.subtaskCount === 'number' ? it.subtaskCount : 0;
  const subtaskDone = typeof it.subtaskDoneCount === 'number' ? it.subtaskDoneCount : 0;
  const due = it.dueDate || null;
  const isOverdue = due ? Date.now() > due : false;
  // undefined / true 视为刚性；只有显式 false 才是弹性
  const isElastic = it.rigid === false;

  return {
    ...it,
    people,
    tags,
    createTimeText: formatDate(it.createTime),
    dueDateText: formatDueDate(due),
    overdue: isOverdue,
    elasticOverdue: isOverdue && isElastic,
    countdown: computeCountdown(due),
    priorityColor: priority ? PRIORITY_COLOR[priority] : 'slate',
    avatars: people.slice(0, 3).map((name, i) => ({
      name,
      initial: initialOf(name),
      tone: AVATAR_TONES[i % AVATAR_TONES.length]
    })),
    avatarOverflow: people.length > 3 ? people.length - 3 : 0,
    tagTones: tags.map((_t, i) => TAG_TONES[i % TAG_TONES.length]),
    subtaskProgress: subtaskCount > 0 ? subtaskDone / subtaskCount : 0,
    done: !!it.completed
  };
}

/**
 * 弹性待办顺延调度：在 App 启动 / 首页显示时调用一次。
 * 对所有「弹性 + 未完 + 已逾期 + 未软删 + 未冬眠」的待办：
 *   - 截止日顺延 1 天，snoozeCount +1；
 *   - snoozeCount 达到上限(3) 后不再自动顺延，交由 UI 弹「要不要删掉/挪后」的减负提示。
 * 直接改内存 + 分片持久化，不逐条弹 toast、不阻塞首屏。
 */
export const SNOOZE_MAX = 3;
export function runSnoozePass(): void {
  const now = Date.now();
  let changed = false;
  items.forEach((it) => {
    if (it.completed || it.deletedAt || it.hibernateUntil) return;
    if (it.rigid !== false) return; // 仅弹性待办参与
    if (!it.dueDate || it.dueDate >= now) return;
    const count = typeof it.snoozeCount === 'number' ? it.snoozeCount : 0;
    if (count >= SNOOZE_MAX) return; // 已达上限，留给 UI 引导
    const next: ITodo = {
      ...it,
      dueDate: it.dueDate + 86400000,
      snoozeCount: count + 1,
      updateTime: now
    };
    items.set(it._id, next);
    deco.delete(it._id);
    shard.upsert(next);
    changed = true;
  });
  if (changed) {
    invalidate();
    emit({ type: 'reset' });
  }
}

/** 今日聚焦：最多返回 3 件 focusToday 且未完成的待办（按优先级/截止排序） */
export function focusTodos(): DecoratedTodo[] {
  return list()
    .filter((t) => t.focusToday && !t.completed && !t.deletedAt && !t.hibernateUntil)
    .sort(compareTodos)
    .slice(0, 3);
}

/**
 * 碎片时间匹配：返回「预估耗时 ≤ minutes」的未完成待办，按耗时升序。
 * 用于「我有 X 分钟空闲」场景，帮用户把碎片时间用起来。
 * 不带预估耗时的待办不直接匹配（避免误推大任务），由 UI 引导补充预估。
 */
export function matchFreeTime(minutes: number): DecoratedTodo[] {
  const cap = Math.max(1, minutes || 0);
  return list()
    .filter((t) => !t.completed && !t.archived && !t.deletedAt && !t.hibernateUntil)
    .filter((t) => {
      const em = typeof t.estimatedMinutes === 'number' ? t.estimatedMinutes : null;
      return em !== null && em <= cap;
    })
    .sort((a, b) => {
      const ae = a.estimatedMinutes as number;
      const be = b.estimatedMinutes as number;
      if (ae !== be) return ae - be;
      return compareTodos(a, b);
    });
}

/* ============================ 年度回忆录统计 ============================ */

export interface YearStat {
  year: number;
  /** 年内已完成总数 */
  totalCompleted: number;
  /** 年内新建总数 */
  totalCreated: number;
  /** 12 个月完成分布 */
  byMonth: number[];
  byPriority: { high: number; medium: number; low: number; none: number };
  /** 高频标签 Top5 */
  topTags: { tag: string; count: number }[];
  /** 年内有完成的天数（坚持天数） */
  activeDays: number;
  /** 最长连续完成天数 */
  longestStreak: number;
  /** 已完成任务预估耗时合计（分钟） */
  totalEstimatedMin: number;
}

/** 统计指定年份（默认今年）的完成数据，用于年度治愈系回忆录 */
export function yearStats(year?: number): YearStat {
  const y = year || new Date().getFullYear();
  const start = new Date(y, 0, 1).getTime();
  const end = new Date(y + 1, 0, 1).getTime();
  const byMonth = new Array(12).fill(0);
  const byPriority = { high: 0, medium: 0, low: 0, none: 0 };
  const tagCount = new Map<string, number>();
  const daySet = new Map<number, boolean>();
  let totalCompleted = 0;
  let totalCreated = 0;
  let totalEstimatedMin = 0;
  const completedDays: number[] = [];
  const DAY = 86400000;
  items.forEach((it) => {
    if (it.createTime >= start && it.createTime < end) totalCreated += 1;
    if (it.completed && it.completedTime && it.completedTime >= start && it.completedTime < end) {
      totalCompleted += 1;
      const d = new Date(it.completedTime);
      byMonth[d.getMonth()] += 1;
      const pr = it.priority || null;
      if (pr === 'high') byPriority.high += 1;
      else if (pr === 'medium') byPriority.medium += 1;
      else if (pr === 'low') byPriority.low += 1;
      else byPriority.none += 1;
      const em = typeof it.estimatedMinutes === 'number' ? it.estimatedMinutes : 0;
      totalEstimatedMin += em;
      const dayTs = new Date(y, d.getMonth(), d.getDate()).getTime();
      if (!daySet.has(dayTs)) {
        daySet.set(dayTs, true);
        completedDays.push(dayTs);
      }
      for (const t of it.tags || []) {
        tagCount.set(t, (tagCount.get(t) || 0) + 1);
      }
    }
  });
  completedDays.sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev = -1;
  for (const d of completedDays) {
    if (prev >= 0 && d - prev === DAY) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    prev = d;
  }
  const topTags = Array.from(tagCount.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    year: y,
    totalCompleted,
    totalCreated,
    byMonth,
    byPriority,
    topTags,
    activeDays: daySet.size,
    longestStreak: longest,
    totalEstimatedMin
  };
}

/** 回收站列表（已软删、未彻底清除） */
export function trashList(): ITodo[] {
  const arr: ITodo[] = [];
  items.forEach((it) => {
    if (it.deletedAt) arr.push(it);
  });
  return arr.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

/** 软删除（移入回收站，可恢复） */
export async function softDelete(id: string): Promise<void> {
  const cur = items.get(id);
  if (!cur) return;
  const next: ITodo = { ...cur, deletedAt: Date.now(), updateTime: Date.now() };
  items.set(id, next);
  touch(id);
  invalidate();
  emit({ type: 'item', id });
  shard.upsert(next);
  try {
    await selfCall('todos', { action: 'update', id, deletedAt: next.deletedAt });
    toast('已移入回收站', 'success');
  } catch (err) {
    if (isMissingOnServer(err)) return;
    console.warn('[todo-store] 云端同步软删失败，本地已保留:', id, err);
  }
}

/** 从回收站恢复 */
export async function restoreTodo(id: string): Promise<void> {
  const cur = items.get(id);
  if (!cur) return;
  const next: ITodo = { ...cur, deletedAt: null, updateTime: Date.now() };
  items.set(id, next);
  touch(id);
  invalidate();
  emit({ type: 'item', id });
  shard.upsert(next);
  try {
    await selfCall('todos', { action: 'update', id, deletedAt: null });
    toast('已恢复', 'success');
  } catch (err) {
    if (isMissingOnServer(err)) return;
    console.warn('[todo-store] 云端同步恢复失败，本地已保留:', id, err);
  }
}

/** 取（并缓存）装饰后的条目 */
export function decorateOf(it: ITodo): DecoratedTodo {
  const cached = deco.get(it._id);
  if (cached) return cached;
  const d = buildDecorated(it);
  deco.set(it._id, d);
  return d;
}

/* ============================ 排序 ============================ */

function priorityRank(p?: Priority | null): number {
  if (p === 'high') return 0;
  if (p === 'medium') return 1;
  if (p === 'low') return 2;
  return 3;
}

/**
 * 智能排序（默认全局生效，无需手动拖拽）：
 *   1. 归档 / 完成沉底
 *   2. 今日聚焦置顶（focusTodos 再截断到 3 件）
 *   3. 逾期优先（刚性逾期最紧迫）
 *   4. 优先级（高 > 中 > 低 > 无）
 *   5. 截止时间近的优先
 *   6. 同条件下刚性必做先于弹性可缓
 *   7. 有小预估耗时的「速赢」靠前（碎片时间友好）
 *   8. 手动 order 兜底
 */
export function compareTodos(a: DecoratedTodo, b: DecoratedTodo): number {
  if (a.archived !== b.archived) return a.archived ? 1 : -1;
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  const af = a.focusToday ? 1 : 0;
  const bf = b.focusToday ? 1 : 0;
  if (af !== bf) return bf - af;
  const aOver = a.overdue ? 1 : 0;
  const bOver = b.overdue ? 1 : 0;
  if (aOver !== bOver) return bOver - aOver;
  const pa = priorityRank(a.priority);
  const pb = priorityRank(b.priority);
  if (pa !== pb) return pa - pb;
  const aDue = a.dueDate || Infinity;
  const bDue = b.dueDate || Infinity;
  if (aDue !== bDue) return aDue - bDue;
  const ar = a.rigid === false ? 1 : 0;
  const br = b.rigid === false ? 1 : 0;
  if (ar !== br) return ar - br;
  const ae = typeof a.estimatedMinutes === 'number' ? a.estimatedMinutes : Infinity;
  const be = typeof b.estimatedMinutes === 'number' ? b.estimatedMinutes : Infinity;
  if (ae !== be) return ae - be;
  const ao = typeof a.order === 'number' ? a.order : Infinity;
  const bo = typeof b.order === 'number' ? b.order : Infinity;
  if (ao !== bo) return ao - bo;
  return b.createTime - a.createTime;
}

/** 已排序的基础列表（全量，惰性构建 + 缓存）。已软删 / 冬眠中的条目不进入主列表。 */
export function list(): DecoratedTodo[] {
  if (sortedBase) return sortedBase;
  const now = Date.now();
  const arr: DecoratedTodo[] = [];
  items.forEach((it) => {
    if (it.deletedAt) return; // 回收站
    if (it.hibernateUntil && it.hibernateUntil > now) return; // 冬眠中
    arr.push(decorateOf(it));
  });
  arr.sort(compareTodos);
  sortedBase = arr;
  return arr;
}

export function size(): number {
  return items.size;
}

export function serverCount(): number {
  return serverTotal;
}

/** 把可能的临时 id 解析成当前生效的 id */
export function resolveId(id: string): string {
  return idAlias.get(id) || id;
}

export function getById(id: string): ITodo | undefined {
  return items.get(id) || items.get(idAlias.get(id) || '');
}

/* ============================ 过滤查询 ============================ */

/**
 * 按筛选条件过滤已排序基础列表。
 * 只做 filter 不做 sort —— 排序结果复用 list() 的缓存，避免每敲一个字符就重排上万条。
 */
export function query(filter: FilterKey, filters: SearchFilters, keyword: string): DecoratedTodo[] {
  const base = list();
  const kw = (keyword || '').trim().toLowerCase();
  const fPriority = filters.priority;
  const fLocation = filters.location ? filters.location.toLowerCase() : null;
  const fPerson = filters.person ? filters.person.toLowerCase() : null;
  const fTag = filters.tag ? filters.tag.toLowerCase() : null;

  const needFilter =
    filter !== 'all' || !!fPriority || !!fLocation || !!fPerson || !!fTag || !!kw;
  if (!needFilter) return base;

  const out: DecoratedTodo[] = [];
  for (let i = 0; i < base.length; i++) {
    const t = base[i];
    if (filter === 'active' && (t.completed || t.archived)) continue;
    if (filter === 'done' && !t.completed) continue;
    if (filter === 'archived' && !t.archived) continue;
    if (fPriority && t.priority !== fPriority) continue;
    if (fLocation && (t.location || '').toLowerCase() !== fLocation) continue;
    if (fPerson) {
      let hit = false;
      const people = t.people || [];
      for (let j = 0; j < people.length; j++) {
        if (people[j].toLowerCase() === fPerson) { hit = true; break; }
      }
      if (!hit) continue;
    }
    if (fTag) {
      let hit = false;
      const tags = t.tags || [];
      for (let j = 0; j < tags.length; j++) {
        if (tags[j].toLowerCase() === fTag) { hit = true; break; }
      }
      if (!hit) continue;
    }
    if (kw) {
      // 直接拼接比较，避免每次构造中间数组
      let hay = t.content || '';
      if (t.location) hay += ' ' + t.location;
      if (t.description) hay += ' ' + t.description;
      if (t.people && t.people.length) hay += ' ' + t.people.join(' ');
      if (t.tags && t.tags.length) hay += ' ' + t.tags.join(' ');
      if (hay.toLowerCase().indexOf(kw) < 0) continue;
    }
    out.push(t);
  }
  return out;
}

/** 筛选可选项（地点/人物/标签去重集合） */
export function distinctOptions(key: 'location' | 'person' | 'tag'): string[] {
  const set = new Set<string>();
  items.forEach((t) => {
    if (key === 'location') {
      const v = (t.location || '').trim();
      if (v) set.add(v);
      return;
    }
    const arr = (key === 'person' ? t.people : t.tags) || [];
    for (const n of arr) {
      const s = (n || '').trim();
      if (s) set.add(s);
    }
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/* ============================ 统计 ============================ */

export function stats(): TodoStatsCache {
  if (statsCache) return statsCache;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 6 * 86400000;

  let active = 0;
  let done = 0;
  let todayDone = 0;
  let weekDone = 0;
  let total = 0;
  const dayHasDone = new Set<number>();

  items.forEach((t) => {
    if (t.archived) return;
    total++;
    if (t.completed) {
      done++;
      const ts = t.completedTime || t.updateTime || 0;
      if (ts >= todayStart) todayDone++;
      if (ts >= weekStart) weekDone++;
      if (ts) {
        const d = new Date(ts);
        dayHasDone.add(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
      }
    } else {
      active++;
    }
  });

  let streak = 0;
  let cursor = todayStart;
  while (dayHasDone.has(cursor)) {
    streak++;
    cursor -= 86400000;
  }

  statsCache = {
    activeCount: active,
    doneCount: done,
    totalCount: total,
    todayDone,
    weekDone,
    streak
  };
  return statsCache;
}

/**
 * 让 30 秒一次的倒计时局部刷新复用同一份缓存对象（原地更新，避免整列表重算）。
 * 返回文案发生变化的 id 列表，页面据此做路径级 setData，只重绘真正变化的那几行。
 */
export function refreshCountdowns(): string[] {
  const target = sortedBase || Array.from(deco.values());
  const changed: string[] = [];
  for (const t of target) {
    if (!t.dueDate || t.completed || t.archived) continue;
    const next = computeCountdown(t.dueDate);
    if (next.text !== t.countdown.text || next.key !== t.countdown.key) {
      t.countdown = next;
      t.overdue = Date.now() > (t.dueDate as number);
      changed.push(t._id);
    }
  }
  return changed;
}

/* ============================ 本地水合 ============================ */

/** 从分片存储恢复（秒开首屏，不等网络） */
export function hydrateLocal(): void {
  if (hydrated && items.size) return;
  const local = shard.loadAll();
  hydrated = true;
  if (!local.length) return;
  for (const it of local) {
    if (it && it._id && !isTombstoned(it._id)) items.set(it._id, it);
  }
  invalidate();
  emit({ type: 'reset' });
  console.log(`[todo-store] 本地水合 ${local.length} 条`);
}

/* ============================ 云端同步（分页 + 后台补齐） ============================ */

interface ListPagedResult {
  success?: boolean;
  items?: ITodo[];
  total?: number;
  skip?: number;
  hasMore?: boolean;
}

interface ListSinceResult {
  success?: boolean;
  items?: ITodo[];
  since?: number;
  hasMore?: boolean;
}

/** 旧版 list 接口（云函数未重新部署时的兜底） */
interface LegacyListResult {
  success?: boolean;
  items?: ITodo[];
  cursor?: number;
  hasMore?: boolean;
}

let pendingSync: Promise<void> | null = null;
/** 上次同步完成时间：增量同步以此为起点 */
let lastSyncAt = 0;
/** 增量同步的重叠窗口，容忍时钟/写入边界差异（重复条目按 id 去重，无副作用） */
const SYNC_OVERLAP_MS = 2000;
/** 增量同步最多拉取的批次数 */
const MAX_INCREMENTAL_ROUNDS = 40;

/**
 * 同步数据源。
 *  - force=true（首屏 / 下拉刷新）→ 全量分页拉取，并剔除服务端已删除的条目
 *  - 否则 → 增量同步，只取上次同步后 updateTime 变化的条目（回到首页只花 1 次请求）
 *  - 云端未部署 listSince 时自动回落到全量同步，保证数据仍是最新
 */
export function sync(force = false): Promise<void> {
  if (pendingSync) return pendingSync;
  // 云端云函数若尚未部署增量接口（listSince），必须回落到全量同步：
  // 否则「回到首页」会永远停在增量分支被静默跳过，远端改动再也拉不下来。
  const canIncremental =
    !force && lastSyncAt !== 0 && isActionSupported('todos', 'listSince');
  const run = canIncremental ? doIncrementalSync : doFullSync;
  pendingSync = run().finally(() => {
    pendingSync = null;
  });
  return pendingSync;
}

/**
 * 全量同步：先取首屏立即上屏，再在后台按分页补齐剩余数据。
 * 每批到达都会广播 progress，页面按窗口增量重绘，全程不阻塞交互。
 */
async function doFullSync(): Promise<void> {
  const seq = ++loadSeq;
  // 完整同步结束后用它剔除服务端已不存在的本地缓存条目
  const seen = new Set<string>();

  try {
    // 只有分页拉取完整收尾（hasMore=false）才认定数据完整，才敢剔除本地多余条目；
    // 否则只合并 —— 否则旧版接口的条数上限会把本地"多出来"的数据误删
    const complete = isActionSupported('todos', 'listPaged')
      ? await syncByPages(seq, seen)
      : false;

    if (!complete) await syncByLegacyList(seq);
    if (complete) pruneNotSeen(seen);

    persistAll();
    lastSyncAt = Date.now();
    everLoaded = true;
  } catch (err) {
    handleError(err, '加载失败');
  }
}

/** 分页全量拉取；返回 true 表示服务端数据已全部拉完（可据此剔除本地失效条目） */
async function syncByPages(seq: number, seen: Set<string>): Promise<boolean> {
  let offset = 0;
  let rounds = 0;
  let hasMore = true;
  let first = true;

  try {
    while (hasMore && rounds <= MAX_PAGES) {
      // 用显式 skip 推进：首屏 60 条、后续 500 条条数不同，用 page 换算会错位漏数据
      const size = first ? FIRST_PAGE_SIZE : PAGE_SIZE;
      const res = await callFn<ListPagedResult>('todos', {
        action: 'listPaged',
        skip: offset,
        pageSize: size,
        archived: false
      });
      if (seq !== loadSeq) return false;

      const batch = res.items || [];
      if (typeof res.total === 'number') serverTotal = res.total;
      offset += batch.length;

      // 首屏不清空已有（本地缓存可能更全），合并策略可避免列表闪烁
      for (const it of batch) {
        if (it && it._id) {
          seen.add(it._id);
          // 本地已删除（墓碑）：不回填，否则用户会看到「删了又回来」
          if (isTombstoned(it._id)) continue;
          items.set(it._id, it);
          deco.delete(it._id);
        }
      }
      invalidate();
      emit({ type: first ? 'reset' : 'progress' });
      first = false;

      hasMore = !!res.hasMore && batch.length > 0;
      rounds++;
      // 让出主线程，保证滚动/输入不掉帧
      await yieldToUI();
    }
    return !hasMore;
  } catch (err) {
    // 云函数版本过旧（服务端不认识 listPaged）→ 上层退回旧版 list。
    // 已拉到的批次保留在内存里，只是不做剔除，不会丢数据。
    if (!isActionSupported('todos', 'listPaged')) return false;
    throw err;
  }
}

/**
 * 旧版全量接口兜底：云函数尚未部署 listPaged 时走这里。
 * 注意——旧版 list 有单次条数上限、且未必支持游标，因此只合并、绝不剔除本地条目。
 */
async function syncByLegacyList(seq: number): Promise<void> {
  let cursor: number | undefined;
  let rounds = 0;
  const fetched = new Set<string>();

  while (rounds < MAX_PAGES) {
    const res = await callFn<LegacyListResult>('todos', {
      action: 'list',
      archived: false,
      pageSize: PAGE_SIZE,
      ...(typeof cursor === 'number' ? { cursor } : {})
    });
    if (seq !== loadSeq) return;

    const batch = res.items || [];
    if (!batch.length) break;

    let fresh = 0;
    for (const it of batch) {
      if (!it || !it._id) continue;
      if (!fetched.has(it._id)) {
        fetched.add(it._id);
        fresh++;
      }
      // 本地已删除（墓碑）：不回填
      if (isTombstoned(it._id)) continue;
      items.set(it._id, it);
      deco.delete(it._id);
    }
    invalidate();
    emit({ type: rounds === 0 ? 'reset' : 'progress' });
    rounds++;

    // 旧版 list 不认 cursor 时每页都返回同一批数据：本页没有新 id 就停，避免死循环
    if (!fresh) break;
    if (res.hasMore === false) break;

    const last = batch[batch.length - 1];
    const next = typeof res.cursor === 'number' ? res.cursor : (last && last.createTime);
    if (typeof next !== 'number') break;
    if (typeof cursor === 'number' && next >= cursor) break;
    cursor = next;
    await yieldToUI();
  }
}

/** 剔除服务端已不存在的本地缓存条目（仅在确认拉取完整后调用） */
function pruneNotSeen(seen: Set<string>): void {
  const stale: string[] = [];
  items.forEach((_v, id) => {
    // 本地新建、云端尚未确认的条目（local_ 前缀）不属于「服务端已删除」，必须保留 ——
    // 否则云端写入失败时，刚新建的任务会在下一次全量同步里被静默剔除
    if (isLocalOnly(id)) return;
    if (!seen.has(id)) stale.push(id);
  });
  if (!stale.length) return;
  for (const id of stale) {
    items.delete(id);
    deco.delete(id);
    idAlias.delete(id);
  }
  invalidate();
  emit({ type: 'reset' });
}

/**
 * 增量同步：只拉取 updateTime 晚于上次同步的条目。
 * 回到首页/从其它页面返回时只发 1 次请求，海量数据下也不会反复全量拉取。
 */
async function doIncrementalSync(): Promise<void> {
  // 云函数版本过旧、没有增量接口时静默跳过：本地数据仍然可用，
  // 等开发者重新部署云函数后自动恢复（不会每次回首页都报错）
  if (!isActionSupported('todos', 'listSince')) return;

  const seq = ++loadSeq;
  let cursor = Math.max(0, lastSyncAt - SYNC_OVERLAP_MS);
  try {
    let rounds = 0;
    let hasMore = true;
    let changed = 0;

    while (hasMore && rounds < MAX_INCREMENTAL_ROUNDS) {
      const res = await callFn<ListSinceResult>('todos', {
        action: 'listSince',
        since: cursor,
        pageSize: PAGE_SIZE
      });
      if (seq !== loadSeq) return;

      const batch = res.items || [];
      for (const it of batch) {
        if (!it || !it._id) continue;
        // 本地已删除（墓碑）：不回填
        if (isTombstoned(it._id)) continue;
        items.set(it._id, it);
        deco.delete(it._id);
        changed++;
      }
      if (batch.length) {
        invalidate();
        emit({ type: 'progress' });
      }
      cursor = typeof res.since === 'number' && res.since > cursor ? res.since : cursor;
      hasMore = !!res.hasMore && batch.length > 0;
      rounds++;
      await yieldToUI();
    }

    if (changed) persistAll();
    lastSyncAt = Date.now();
    everLoaded = true;
  } catch (err) {
    // 云函数版本过旧（服务端不认识 listSince）：静默降级，不打印错误堆栈；
    // 重置 lastSyncAt，下一次 sync() 会自动回落到全量同步，数据依旧保持最新。
    if ((err as { code?: string } | null)?.code === 'UNSUPPORTED_ACTION') {
      lastSyncAt = 0;
      return;
    }
    // 其它失败（网络抖动等）不打断使用（本地数据仍可用），下次再试
    console.warn('[todo-store] 增量同步失败:', err);
  }
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function persistAll(): void {
  try {
    shard.replaceAll(Array.from(items.values()));
  } catch (err) {
    console.error('[todo-store] 持久化失败:', err);
  }
}

/* ============================ 写操作（乐观更新 + 广播） ============================ */

function selfCall<T>(name: string, data: Record<string, unknown>): Promise<T> {
  selfOps++;
  return Promise.resolve(callFn<T>(name, data)).finally(() => {
    selfOps--;
  });
}

function makeTempId(): string {
  return `local_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function touch(id: string): void {
  deco.delete(id);
  invalidate();
}

/** 本地新增一条完整默认值的待办（供乐观插入复用） */
function makeLocalTodo(payload: AddPayload, id: string): ITodo {
  const now = Date.now();
  return {
    _id: id,
    content: (payload.content || '').trim(),
    completed: payload.completed ?? false,
    createTime: now,
    updateTime: now,
    dueDate: payload.dueDate ?? null,
    reminded: false,
    priority: payload.priority ?? null,
    location: payload.location ?? null,
    people: Array.isArray(payload.people) ? payload.people : [],
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    description: payload.description ?? null,
    recurrence: payload.recurrence ?? null,
    reminders: Array.isArray(payload.reminders) ? payload.reminders : [],
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    quadrant: payload.quadrant ?? null,
    archived: false,
    archivedAt: null,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    order: now
  };
}

export interface AddPayload {
  content: string;
  /** 是否已完成（默认 false；旅行单等外部来源同步已完成项时用） */
  completed?: boolean;
  priority?: Priority | null;
  dueDate?: number | null;
  location?: string | null;
  people?: string[];
  tags?: string[];
  description?: string | null;
  recurrence?: IRecurrence | null;
  reminders?: IReminder[];
  attachments?: IAttachment[];
  quadrant?: 1 | 2 | 3 | 4 | null;
}

/**
 * 新增：本地立刻插入并广播（列表即时可见），云端后台写入成功后把临时 id 换成真实 id。
 * 失败则回滚并提示。
 */
export async function addTodo(payload: AddPayload): Promise<ITodo | null> {
  const tempId = makeTempId();
  const local = makeLocalTodo(payload, tempId);
  if (!local.content) {
    wx.showToast({ title: '请输入任务内容', icon: 'none' });
    return null;
  }
  items.set(tempId, local);
  touch(tempId);
  emit({ type: 'item', id: tempId });

  try {
    const res = await selfCall<{ id?: string }>('todos', {
      action: 'add',
      ...(payload as unknown as Record<string, unknown>)
    });
    const realId = res && res.id;
    if (realId && realId !== tempId) {
      const cur = items.get(tempId);
      items.delete(tempId);
      deco.delete(tempId);
      if (cur) {
        cur._id = realId;
        items.set(realId, cur);
        // 记下别名：详情页若在替换前就用临时 id 打开，仍能解析到这条
        idAlias.set(tempId, realId);
        shard.upsert(cur);
      }
      invalidate();
      emit({ type: 'item', id: realId });
      return cur || null;
    }
    shard.upsert(local);
    return local;
  } catch (err) {
    // 本地优先：云端写入失败不回滚，条目保留在本地分片（id 保持 local_ 前缀）。
    // pruneNotSeen 会跳过 local_ 条目，所以它不会在后续同步中消失。
    shard.upsert(local);
    console.warn('[todo-store] 云端新增失败，已仅保存到本地:', err);
    if (!isMissingOnServer(err)) {
      try {
        wx.showToast({ title: '已存到本地，稍后自动同步', icon: 'none' });
      } catch (_e) {
        /* 忽略 */
      }
    }
    return local;
  }
}

/** 局部更新（不传 id 之外的字段即只改这些字段） */
/**
 * 批量新增待办（供其它模块如旅行清单一次性把多条行程项落库到首页待办）。
 * 与 addTodo 的区别：只做一次 emit('reset') 与一次后台同步，避免逐条弹 toast / 多次重排。
 * 返回实际新增条数。
 */
export async function bulkAddTodos(payloads: AddPayload[]): Promise<number> {
  if (!payloads || !payloads.length) return 0;
  const created: ITodo[] = [];
  for (const p of payloads) {
    const content = (p.content || '').trim();
    if (!content) continue;
    const local = makeLocalTodo(p, makeTempId());
    items.set(local._id, local);
    created.push(local);
  }
  if (!created.length) return 0;
  invalidate();
  emit({ type: 'reset' });
  // 后台增量同步到云端（失败不影响本地可见性，遵循本地优先）
  sync().catch(() => null);
  return created.length;
}

export async function updateTodo(id: string, patch: Partial<ITodo>, silent = false): Promise<void> {
  const cur = items.get(id);
  if (!cur) return;
  const next: ITodo = { ...cur, ...patch, _id: id, updateTime: Date.now() };
  items.set(id, next);
  touch(id);
  emit({ type: 'item', id });
  shard.upsert(next);

  try {
    await selfCall('todos', {
      action: 'update',
      id,
      ...(patch as unknown as Record<string, unknown>)
    });
    if (!silent) toast('已更新', 'success');
  } catch (err) {
    // 服务端没有这条记录（本地创建后尚未同步 / 云端被清空过）：
    // 本地改动保留，不回滚也不弹错 —— 否则用户会看到"更新失败"且改动被撤销
    if (isMissingOnServer(err)) {
      console.warn('[todo-store] 云端无此记录，已保留本地改动:', id);
      return;
    }
    items.set(id, cur);
    touch(id);
    emit({ type: 'item', id });
    shard.upsert(cur);
    handleError(err, '更新失败');
  }
}

/** 勾选完成 / 取消完成 */
export async function toggleTodo(id: string, completed: boolean): Promise<void> {
  const cur = items.get(id);
  if (!cur) return;
  const ts = Date.now();
  const next: ITodo = {
    ...cur,
    completed,
    completedTime: completed ? ts : null,
    updateTime: ts
  };
  items.set(id, next);
  touch(id);
  emit({ type: 'item', id });
  shard.upsert(next);

  try {
    await selfCall('todos', { action: 'toggle', id, completed });
  } catch (err) {
    if (isMissingOnServer(err)) {
      console.warn('[todo-store] 云端无此记录，已保留本地改动:', id);
      return;
    }
    // 本地优先：勾选状态一律以本地为准，云端失败不回滚 ——
    // 否则用户点圆圈后对号会立刻消失，看起来像「点了没反应」
    console.warn('[todo-store] 云端同步失败，本地勾选状态已保留:', id, err);
  }
}

/** 归档 / 取消归档 */
export async function archiveTodo(id: string, archived: boolean): Promise<void> {
  const cur = items.get(id);
  if (!cur) return;
  const now = Date.now();
  const next: ITodo = {
    ...cur,
    archived,
    archivedAt: archived ? now : null,
    updateTime: now
  };
  items.set(id, next);
  touch(id);
  emit({ type: 'item', id });
  shard.upsert(next);

  try {
    await selfCall('todos', { action: 'archive', id, archived });
    toast(archived ? '已归档' : '已取消归档', 'success');
  } catch (err) {
    if (isMissingOnServer(err)) {
      console.warn('[todo-store] 云端无此记录，已保留本地改动:', id);
      return;
    }
    items.set(id, cur);
    touch(id);
    emit({ type: 'item', id });
    shard.upsert(cur);
    handleError(err, '操作失败');
  }
}

/** 删除 */
export async function removeTodo(id: string): Promise<void> {
  const cur = items.get(id);
  if (!cur) return;
  items.delete(id);
  deco.delete(id);
  idAlias.delete(id);
  invalidate();
  emit({ type: 'item', id });
  shard.removeById(id);
  // 记墓碑：即使云端删除失败，后续全量/增量同步也不会把它拉回来
  addTombstone(id);

  try {
    await selfCall('todos', { action: 'delete', id });
    // 云端确认删除成功 → 撤掉墓碑，避免无限累积
    clearTombstone(id);
  } catch (err) {
    // 云端本就没有这条 → 删除目标已不存在，视为成功，不恢复、不提示
    if (isMissingOnServer(err)) {
      clearTombstone(id);
      console.warn('[todo-store] 云端无此记录，删除按成功处理:', id);
      return;
    }
    // 本地优先：删除已在本地生效，云端失败也不恢复条目
    console.warn('[todo-store] 云端删除失败，本地已删除并记入墓碑:', id, err);
  }
}

/** 清除全部已完成 */
export async function clearCompleted(): Promise<number> {
  const removedIds: string[] = [];
  items.forEach((t) => {
    if (t.completed) removedIds.push(t._id);
  });
  if (!removedIds.length) return 0;

  const backup = removedIds.map((id) => items.get(id) as ITodo);
  for (const id of removedIds) {
    items.delete(id);
    deco.delete(id);
  }
  invalidate();
  emit({ type: 'reset' });
  shard.replaceAll(Array.from(items.values()));

  try {
    const res = await selfCall<{ removed?: number }>('todos', { action: 'clearCompleted' });
    return (res && res.removed) || removedIds.length;
  } catch (err) {
    for (const it of backup) {
      items.set(it._id, it);
      deco.delete(it._id);
    }
    invalidate();
    emit({ type: 'reset' });
    shard.replaceAll(Array.from(items.values()));
    handleError(err, '清除失败');
    return 0;
  }
}

/* ============================ 外部写操作同步 ============================ */

/**
 * 订阅由 cloud.ts 广播的写操作（来源：看板 / 小助手 / 待办面板 / 模板 / 详情页等）。
 * 自身发起的操作（selfOps > 0）已被乐观更新覆盖，直接忽略，避免重复应用。
 */
onWrite((e: WriteEvent) => {
  if (selfOps > 0) return;
  try {
    applyExternalWrite(e);
  } catch (err) {
    console.error('[todo-store] 外部写操作同步失败:', err);
  }
});

/**
 * 批量本地插入（模板一键应用乐观渲染）。
 * 与 addTodo 不同：这里的待办已由云端/模板生成、带真实 id，直接落地即可，
 * 一次性 emit 避免逐条重排。首页订阅此事件后立即重绘，零网络等待。
 */
function bulkInsertLocal(list: ITodo[]): void {
  let changed = false;
  for (const it of list) {
    if (!it || !it._id) continue;
    if (isTombstoned(it._id)) continue; // 本地已删除的条目不回填
    items.set(it._id, it);
    deco.delete(it._id);
    shard.upsert(it);
    changed = true;
  }
  if (changed) {
    invalidate();
    emit({ type: 'reset' });
  }
}

function applyExternalWrite(e: WriteEvent): void {
  const params = (e.params || {}) as Record<string, unknown>;

  if (e.action === 'bulkAdd') {
    const items = (e.params && (e.params.items as ITodo[] | undefined)) || undefined;
    if (Array.isArray(items) && items.length) {
      // 模板已返回完整待办：本地乐观插入，首页订阅即时渲染（无需等待网络同步）
      bulkInsertLocal(items);
      // 后台增量同步一次，校正云端可能更晚的 updateTime，不阻塞渲染
      sync().catch(() => null);
      return;
    }
    // 兜底：老版本云函数未返回 items，退化延迟增量同步
    setTimeout(() => {
      sync().catch(() => null);
    }, 400);
    return;
  }

  if (e.action === 'add') {
    // 服务端已返回 id：拉取单条（O(1)），保证字段与云端一致
    const id = e.id;
    if (id && !items.has(id) && !isTombstoned(id)) {
      // 兜底：用广播参数本地构造，至少让首页能看到新条目
      const localFallback = () => {
        const local = makeLocalTodo(params as unknown as AddPayload, id);
        items.set(id, local);
        touch(id);
        emit({ type: 'item', id });
        shard.upsert(local);
      };

      if (!isActionSupported('todos', 'getOne')) {
        localFallback();
        return;
      }

      callFn<CloudResult & { item?: ITodo }>('todos', { action: 'getOne', id })
        .then((res) => {
          const it = res && res.item;
          if (it && it._id) {
            items.set(it._id, it);
            touch(it._id);
            emit({ type: 'item', id: it._id });
            shard.upsert(it);
          }
        })
        .catch(() => {
          localFallback();
        });
    }
    return;
  }

  if (e.action === 'delete') {
    if (e.id && items.has(e.id)) {
      items.delete(e.id);
      deco.delete(e.id);
      invalidate();
      emit({ type: 'item', id: e.id });
      shard.removeById(e.id);
    }
    return;
  }

  if (e.action === 'clearCompleted') {
    const removed: ITodo[] = [];
    items.forEach((t) => {
      if (t.completed) removed.push(t);
    });
    if (!removed.length) return;
    for (const t of removed) {
      items.delete(t._id);
      deco.delete(t._id);
    }
    invalidate();
    emit({ type: 'reset' });
    shard.replaceAll(Array.from(items.values()));
    return;
  }

  // update / toggle / archive / move：直接用广播参数本地回填，零额外请求
  const id = e.id;
  if (!id) return;
  const cur = items.get(id);
  if (!cur) return;

  const patch: Partial<ITodo> = { updateTime: Date.now() };
  if (e.action === 'toggle' && typeof params.completed === 'boolean') {
    patch.completed = params.completed;
    patch.completedTime = params.completed ? Date.now() : null;
  }
  if (e.action === 'archive') {
    const flag = params.archived !== false;
    patch.archived = flag;
    patch.archivedAt = flag ? Date.now() : null;
  }
  if (e.action === 'move' && typeof params.order === 'number') {
    patch.order = params.order;
  }
  const passthrough = [
    'content', 'dueDate', 'priority', 'location', 'people',
    'tags', 'description', 'recurrence', 'reminders', 'attachments', 'quadrant'
  ];
  for (const k of passthrough) {
    if (params[k] !== undefined) {
      (patch as Record<string, unknown>)[k] = params[k];
    }
  }

  const next: ITodo = { ...cur, ...patch, _id: id };
  items.set(id, next);
  touch(id);
  emit({ type: 'item', id });
  shard.upsert(next);
}

/* ============================ 其它 ============================ */

/** 供导出 / 调试读取原始数据 */
export function rawList(): ITodo[] {
  return Array.from(items.values());
}

let everLoaded = false;

/**
 * 确保数据源就绪：首次调用触发一次完整同步（含后台分页补齐），之后直接复用内存数据。
 * 供看板 / 日历 / 待办面板等次级页面复用 —— 它们旧实现各自发一次 'list' 请求，
 * 既重复拉取，又受单次返回条数上限约束，数据量大时会丢数据。
 */
export function ensureLoaded(): Promise<void> {
  hydrateLocal();
  if (everLoaded) return Promise.resolve();
  return sync(true).then(() => {
    everLoaded = true;
  });
}

/** 清空全部（含本地分片） */
export function clearAll(): void {
  items.clear();
  deco.clear();
  invalidate();
  shard.clearBuckets();
  tombstoneSet().clear();
  persistTombstones();
  serverTotal = 0;
  emit({ type: 'reset' });
}
