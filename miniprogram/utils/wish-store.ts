// utils/wish-store.ts
// 愿望清单数据层：本地优先 + 云端尽力同步
// 覆盖：分类/状态/字段/模板自定义、多级子任务进度聚合、周期心愿、复盘归档、年度报告、模板复用
import { get, set } from './storage';
import { callFn } from './cloud';
import type {
  IWish,
  IWishCategory,
  IWishStatus,
  IWishField,
  IWishTemplate,
  IWishSubTask,
  IWishYearReport
} from '../types/index';

const WISH_KEY = 'wishes';
const CAT_KEY = 'wish_categories';
const STATUS_KEY = 'wish_statuses';
const FIELD_KEY = 'wish_fields';
const TPL_KEY = 'wish_templates';

/* ==================== 默认配置 ==================== */

export const DEFAULT_CATEGORIES: IWishCategory[] = [
  { id: 'cat_want', name: '想要', icon: '🛍️', color: '#f97316', isPrivate: false, order: 0 },
  { id: 'cat_play', name: '想玩', icon: '🎮', color: '#8b5cf6', isPrivate: false, order: 1 },
  { id: 'cat_go', name: '想去', icon: '✈️', color: '#0ea5e9', isPrivate: false, order: 2 },
  { id: 'cat_learn', name: '想学', icon: '📚', color: '#10b981', isPrivate: false, order: 3 },
  { id: 'cat_do', name: '想实现', icon: '🎯', color: '#ef4444', isPrivate: false, order: 4 }
];

export const DEFAULT_STATUSES: IWishStatus[] = [
  { id: 'st_grass', name: '种草中', color: '#f59e0b', kind: 'todo', order: 0 },
  { id: 'st_saving', name: '攒钱中', color: '#3b82f6', kind: 'doing', order: 1 },
  { id: 'st_done', name: '已实现', color: '#10b981', kind: 'done', order: 2 },
  { id: 'st_drop', name: '已放弃', color: '#94a3b8', kind: 'dropped', order: 3 }
];

export const DEFAULT_FIELDS: IWishField[] = [
  { id: 'f_price', name: '预估花费', type: 'money', required: false, order: 0, unit: '元' },
  { id: 'f_link', name: '商品链接', type: 'link', required: false, order: 1 },
  { id: 'f_urgent', name: '很想要吗', type: 'checkbox', required: false, order: 2 }
];

export const BUILTIN_TEMPLATES: IWishTemplate[] = [
  {
    id: 'tpl_travel', name: '旅行清单', icon: '✈️', desc: '一次说走就走的旅行',
    categoryId: 'cat_go', progressMode: 'checklist', target: 0, star: 4, price: 500000,
    subTasks: ['定目的地', '查攻略', '订机票', '订住宿', '收拾行李'], tags: ['旅行'], builtin: true, createTime: 0
  },
  {
    id: 'tpl_read', name: '读书清单', icon: '📚', desc: '今年要读完的书',
    categoryId: 'cat_learn', progressMode: 'counter', target: 12, star: 3, price: 60000,
    subTasks: [], tags: ['阅读'], builtin: true, createTime: 0
  },
  {
    id: 'tpl_digital', name: '数码清单', icon: '💻', desc: '心心念念的电子设备',
    categoryId: 'cat_want', progressMode: 'bar', target: 100, star: 5, price: 600000,
    subTasks: ['对比参数', '看测评', '等降价', '下单'], tags: ['数码'], builtin: true, createTime: 0
  },
  {
    id: 'tpl_fitness', name: '健身目标', icon: '🏃', desc: '坚持就是胜利',
    categoryId: 'cat_do', progressMode: 'percent', target: 100, star: 4, price: 200000,
    subTasks: ['办卡', '制定计划'], tags: ['健康'], builtin: true, createTime: 0
  },
  {
    id: 'tpl_skill', name: '技能目标', icon: '🎯', desc: '解锁一个新技能',
    categoryId: 'cat_learn', progressMode: 'percent', target: 100, star: 4, price: 0,
    subTasks: ['找教程', '入门练习', '做小项目'], tags: ['成长'], builtin: true, createTime: 0
  }
];

/* ==================== 配置读写 ==================== */

export function loadCategories(): IWishCategory[] {
  const list = get<IWishCategory[]>(CAT_KEY, []);
  return list.length ? list : DEFAULT_CATEGORIES;
}
export function saveCategories(list: IWishCategory[]): void {
  set(CAT_KEY, list);
}

export function loadStatuses(): IWishStatus[] {
  const list = get<IWishStatus[]>(STATUS_KEY, []);
  return list.length ? list : DEFAULT_STATUSES;
}
export function saveStatuses(list: IWishStatus[]): void {
  set(STATUS_KEY, list);
}

export function loadFields(): IWishField[] {
  const list = get<IWishField[]>(FIELD_KEY, []);
  return list.length ? list : DEFAULT_FIELDS;
}
export function saveFields(list: IWishField[]): void {
  set(FIELD_KEY, list);
}

/** 模板 = 内置 + 用户自定义 */
export function loadTemplates(): IWishTemplate[] {
  const custom = get<IWishTemplate[]>(TPL_KEY, []);
  return [...BUILTIN_TEMPLATES, ...custom];
}
export function saveTemplates(list: IWishTemplate[]): void {
  set(TPL_KEY, list.filter((t) => !t.builtin));
}

/* ==================== 心愿读写 ==================== */

export function loadWishes(): IWish[] {
  const list = get<IWish[]>(WISH_KEY, []);
  return Array.isArray(list) ? list : [];
}
export function saveWishes(list: IWish[]): void {
  set(WISH_KEY, list);
}
export function newWishId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 创建空白心愿（带默认状态与分类） */
export function createWish(patch?: Partial<IWish>): IWish {
  const now = Date.now();
  const statuses = loadStatuses();
  const cats = loadCategories();
  return {
    _id: newWishId(),
    title: '',
    note: '',
    categoryId: (cats[0] && cats[0].id) || 'cat_want',
    statusId: (statuses[0] && statuses[0].id) || 'st_grass',
    star: 3,
    price: 0,
    images: [],
    link: '',
    progressMode: 'checklist',
    target: 100,
    current: 0,
    autoDone: true,
    subTasks: [],
    fields: {},
    tags: [],
    targetDate: 0,
    achievedAt: 0,
    isArchived: false,
    archivedAt: 0,
    review: '',
    cycle: null,
    budgetLink: null,
    isPrivate: false,
    isPinned: false,
    templateId: '',
    createTime: now,
    updateTime: now,
    version: 1,
    ...patch
  };
}

/** 从模板快速创建心愿 */
export function createWishFromTemplate(tpl: IWishTemplate): IWish {
  return createWish({
    title: tpl.name,
    categoryId: tpl.categoryId,
    progressMode: tpl.progressMode,
    target: tpl.target,
    star: tpl.star,
    price: tpl.price,
    tags: [...tpl.tags],
    templateId: tpl.id,
    subTasks: tpl.subTasks.map((t, i) => ({
      id: `st_${Date.now().toString(36)}_${i}`,
      title: t,
      done: false,
      weight: 1,
      children: []
    }))
  });
}

export function upsertWish(wish: IWish): IWish[] {
  const list = loadWishes();
  const idx = list.findIndex((w) => w._id === wish._id);
  const next = Object.assign({}, wish, { updateTime: Date.now(), version: (wish.version || 1) + 1 });
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  saveWishes(list);
  syncToCloudSilently({ action: 'upsert', wish: next });
  return list;
}

export function removeWish(id: string): IWish[] {
  const list = loadWishes().filter((w) => w._id !== id);
  saveWishes(list);
  syncToCloudSilently({ action: 'remove', _id: id });
  return list;
}

/** 归档（写入复盘） */
export function archiveWish(id: string, review: string): IWish[] {
  const list = loadWishes();
  const item = list.find((w) => w._id === id);
  if (item) {
    item.isArchived = true;
    item.archivedAt = Date.now();
    item.review = review || '';
    item.updateTime = Date.now();
    saveWishes(list);
    syncToCloudSilently({ action: 'upsert', wish: item });
  }
  return list;
}

export function unarchiveWish(id: string): IWish[] {
  const list = loadWishes();
  const item = list.find((w) => w._id === id);
  if (item) {
    item.isArchived = false;
    item.archivedAt = 0;
    item.updateTime = Date.now();
    saveWishes(list);
    syncToCloudSilently({ action: 'upsert', wish: item });
  }
  return list;
}

/* ==================== 子任务与进度 ==================== */

export interface SubTaskStat {
  total: number;
  done: number;
  /** 加权完成率 0-100 */
  pct: number;
}

/** 递归统计多级子任务（按权重聚合） */
export function statSubTasks(nodes: IWishSubTask[]): SubTaskStat {
  let total = 0;
  let done = 0;
  const walk = (list: IWishSubTask[]) => {
    (list || []).forEach((n) => {
      const w = n.weight > 0 ? n.weight : 1;
      const kids = n.children && n.children.length ? n.children : null;
      if (kids) {
        const s = statSubTasks(kids);
        total += w;
        done += (w * s.pct) / 100;
      } else {
        total += w;
        if (n.done) done += w;
      }
    });
  };
  walk(nodes);
  return { total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/** 按展示模式计算进度百分比 */
export function wishProgress(wish: IWish): number {
  if (wish.progressMode === 'checklist') {
    const s = statSubTasks(wish.subTasks);
    return s.total > 0 ? s.pct : (wish.current > 0 ? 100 : 0);
  }
  if (wish.target > 0) {
    return Math.max(0, Math.min(100, Math.round((wish.current / wish.target) * 100)));
  }
  return 0;
}

/** 进度文案（按模式适配：计数器 / 进度条 / 百分比 / 勾选清单） */
export function wishProgressText(wish: IWish): string {
  const pct = wishProgress(wish);
  if (wish.progressMode === 'checklist') {
    const s = statSubTasks(wish.subTasks);
    if (s.total === 0) return '未拆解';
    return `${s.done >= s.total ? s.total : Math.round(s.done)}/${s.total} 项`;
  }
  if (wish.progressMode === 'counter') return `${wish.current}/${wish.target}`;
  if (wish.progressMode === 'bar') return `${pct}%`;
  return `${pct}%`;
}

/* ==================== 紧急度与排序 ==================== */

export type WishUrgency = 'overdue' | 'soon' | 'normal' | 'none';

/** 紧急度：已逾期 / 临期（默认 7 天内）/ 正常 / 未设日期 */
export function wishUrgency(wish: IWish, soonDays = 7): WishUrgency {
  if (!wish.targetDate) return 'none';
  const dayMs = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(wish.targetDate);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / dayMs);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= soonDays) return 'soon';
  return 'normal';
}

export type WishSortMode = 'smart' | 'star' | 'date' | 'created' | 'price';

/** 智能排序：心动值 ×2 + 临期衰减因子（越近越高） */
export function sortWishes(list: IWish[], mode: WishSortMode = 'smart'): IWish[] {
  const arr = [...list];
  const dayMs = 86400000;
  const now = Date.now();
  const score = (w: IWish) => {
    let s = w.star * 2;
    if (w.targetDate) {
      const days = (w.targetDate - now) / dayMs;
      if (days < 0) s += 8; // 逾期优先
      else s += Math.max(0, 10 - days);
    }
    if (w.isPinned) s += 100;
    return s;
  };
  arr.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    switch (mode) {
      case 'star': return b.star - a.star;
      case 'date': return (a.targetDate || Infinity) - (b.targetDate || Infinity);
      case 'created': return b.createTime - a.createTime;
      case 'price': return b.price - a.price;
      default: return score(b) - score(a);
    }
  });
  return arr;
}

/* ==================== 周期心愿 ==================== */

const CYCLE_MS: Record<string, number> = {
  week: 7 * 86400000,
  month: 30 * 86400000,
  quarter: 90 * 86400000,
  year: 365 * 86400000
};

/** 检查并执行周期心愿重置；返回被重置的心愿数 */
export function applyCycles(): number {
  const list = loadWishes();
  const statuses = loadStatuses();
  const doingStatus = statuses.find((s) => s.kind === 'todo') || statuses[0];
  const now = Date.now();
  let changed = 0;
  list.forEach((w) => {
    if (!w.cycle || !w.cycle.enabled) return;
    if (w.isArchived) return;
    if (now < w.cycle.nextAt) return;
    // 重置为新一轮：清空进度与子任务勾选
    w.current = 0;
    w.subTasks = (w.subTasks || []).map(clearNode);
    if (doingStatus) w.statusId = doingStatus.id;
    w.achievedAt = 0;
    w.cycle.nextAt = now + (CYCLE_MS[w.cycle.period] || CYCLE_MS.month);
    w.updateTime = now;
    changed++;
  });
  if (changed) {
    saveWishes(list);
    syncToCloudSilently({ action: 'upsertMany', wishes: list });
  }
  return changed;
}

function clearNode(n: IWishSubTask): IWishSubTask {
  return Object.assign({}, n, {
    done: false,
    doneAt: undefined,
    children: (n.children || []).map(clearNode)
  });
}

/* ==================== 年度报告 ==================== */

export function buildYearReport(wishes: IWish[], year: number, categories: IWishCategory[], statuses: IWishStatus[]): IWishYearReport {
  const doneIds = statuses.filter((s) => s.kind === 'done').map((s) => s.id);
  const dropIds = statuses.filter((s) => s.kind === 'dropped').map((s) => s.id);
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();

  const inYear = wishes.filter((w) => {
    const t = w.achievedAt || w.updateTime || w.createTime;
    return t >= start && t < end;
  });
  const achievedList = inYear.filter((w) => doneIds.indexOf(w.statusId) >= 0);
  const dropped = inYear.filter((w) => dropIds.indexOf(w.statusId) >= 0).length;
  const doing = wishes.filter((w) => !w.isArchived && doneIds.indexOf(w.statusId) < 0 && dropIds.indexOf(w.statusId) < 0).length;

  const spent = achievedList.reduce((s, w) => s + (w.price || 0), 0);
  const dayMs = 86400000;
  const durations = achievedList
    .filter((w) => w.achievedAt && w.createTime)
    .map((w) => (w.achievedAt - w.createTime) / dayMs);
  const avgDays = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
    : 0;

  const byMonth = new Array(12).fill(0) as number[];
  achievedList.forEach((w) => {
    const m = new Date(w.achievedAt || w.updateTime).getMonth();
    byMonth[m] += 1;
  });

  const byStar = new Array(5).fill(0) as number[];
  achievedList.forEach((w) => {
    const i = Math.max(0, Math.min(4, (w.star || 1) - 1));
    byStar[i] += 1;
  });

  const byCategory = categories.map((c) => {
    const items = achievedList.filter((w) => w.categoryId === c.id);
    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      count: items.length,
      spent: items.reduce((s, w) => s + (w.price || 0), 0)
    };
  }).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);

  return {
    year,
    total: inYear.length,
    achieved: achievedList.length,
    dropped,
    doing,
    spent,
    avgDays,
    byCategory,
    byMonth,
    byStar
  };
}

/* ==================== 云同步 ==================== */

function syncToCloudSilently(payload: Record<string, unknown>): void {
  callFn('wishes', payload).catch(() => {
    // 静默失败：本地已保存，联网后再同步
  });
}

export async function loadFromCloud(): Promise<IWish[]> {
  const res = await callFn<{ items?: IWish[] }>('wishes', { action: 'list' });
  const cloud = (res && res.items) || [];
  if (!cloud.length) return loadWishes();
  return mergeFromCloud(cloud);
}

/** 合并策略：按 updateTime 取新，保留本地独有记录 */
export function mergeFromCloud(cloud: IWish[]): IWish[] {
  const local = loadWishes();
  const map = new Map<string, IWish>();
  local.forEach((w) => map.set(w._id, w));
  cloud.forEach((w) => {
    const exist = map.get(w._id);
    if (!exist || (w.updateTime || 0) > (exist.updateTime || 0)) map.set(w._id, w);
  });
  const merged = Array.from(map.values());
  saveWishes(merged);
  return merged;
}
