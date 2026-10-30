// subpackages/travel/utils/travel-store.ts
// 「旅行模式」数据层：本地优先 + 云端尽力同步
//
// 与 todo-store 同样的三条纪律：
//   1) 本地即真相：任何写操作先落 wx.storage 并立即广播，界面零延迟；
//   2) 云端尽力而为：写云端失败静默保留本地，下次同步补上，绝不回滚用户操作；
//   3) 变更广播：subscribe() 后任意页面改动都能即时刷新，无需手动 reload。
//
// 复用主包底层：utils/storage（命名空间+兜底）、utils/cloud（callFn / toast / handleError）、
// utils/subscribe（订阅消息授权）。

import { get, set, uid } from '../../../utils/storage';
import { callFn, toast } from '../../../utils/cloud';
import { requestSubscribe } from '../../../utils/subscribe';
import type {
  ITrip,
  IPackingItem,
  ITripPlanItem,
  ITripNote,
  TripCard,
  TripDayGroup,
  CostStat,
  CostCategory,
  PackingGroup,
  TripSummary,
  TravelScene,
  PackingCategory,
  TripItemType
} from './travel-types';
import {
  buildPackingItems,
  matchRouteTemplate,
  suggestPackingByItems,
  allRouteTemplates
} from './trip-templates';

/* ============================ 常量 ============================ */

const K_TRIPS = 'travel_trips';
const K_PACKING = 'travel_packing';
const K_ITEMS = 'travel_items';
const K_NOTES = 'travel_notes';
/** 云端同步游标 */
const K_SYNC = 'travel_sync_at';
/** 删除墓碑：id → 删除时间（见下方「删除墓碑」小节） */
const K_TOMB = 'travel_tomb';
/** 墓碑保留期：超过 30 天的墓碑可以清掉，避免无限增长 */
const TOMB_TTL = 30 * 86400000;

/** 行程条目类型 → 费用分类 */
const TYPE_TO_COST: Record<TripItemType, CostCategory> = {
  交通: '交通',
  景点: '门票',
  餐厅: '餐饮',
  酒店: '住宿',
  购物: '购物',
  自定义: '其他'
};

/** 星期文案 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/* ============================ 内存态 ============================ */

let trips: ITrip[] = [];
let packing: IPackingItem[] = [];
let items: ITripPlanItem[] = [];
let notes: ITripNote[] = [];
/** 已删除 id 的墓碑（id → 删除时间） */
let tombstones: Record<string, number> = {};
let loaded = false;

type Listener = () => void;
const listeners: Listener[] = [];

function emit(): void {
  for (const fn of listeners.slice()) {
    try {
      fn();
    } catch (err) {
      console.error('[travel-store] listener error:', err);
    }
  }
}

export function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/* ============================ 持久化 ============================ */

function persistTrips(): void {
  set<ITrip[]>(K_TRIPS, trips);
}
function persistPacking(): void {
  set<IPackingItem[]>(K_PACKING, packing);
}
function persistItems(): void {
  set<ITripPlanItem[]>(K_ITEMS, items);
}
function persistNotes(): void {
  set<ITripNote[]>(K_NOTES, notes);
}
function persistTomb(): void {
  set<Record<string, number>>(K_TOMB, tombstones);
}

/* ============================ 删除墓碑 ============================ */
//
// 为什么必须有（「清单删不掉 / 删了又回来」的第二道防线）：
//   删除是「本地即时生效 + 云端尽力而为」。只要有一次云端删除没真正送出去
//   （当时未开启云端、网络抖动、云函数还是旧版本按前端 id 匹配不到文档），
//   下一次 list 就会把「已删除」的记录原样拉回来 —— 用户看到的就是「删不掉」。
//   cloudCapable 断开重连、换设备全量同步、清缓存后重新开启同步，都会触发这一路径。
//
//   墓碑记录「这些 id 已被用户删除」，mergeDown 时直接丢弃云端副本；
//   下次同步成功后再由 flushTombstones 在云端真删掉（双保险）。

/** 记墓碑（删除 / 覆盖式替换时调用） */
function markTomb(ids: string[]): void {
  const now = Date.now();
  let n = 0;
  ids.forEach((id) => {
    if (!id) return;
    tombstones[id] = now;
    n += 1;
  });
  if (!n) return;
  pruneTomb();
  persistTomb();
}

/** 清掉过期墓碑 */
function pruneTomb(): void {
  const cut = Date.now() - TOMB_TTL;
  let changed = false;
  Object.keys(tombstones).forEach((id) => {
    if (tombstones[id] < cut) {
      delete tombstones[id];
      changed = true;
    }
  });
  if (changed) persistTomb();
}

/** 载入本地数据（幂等） */
export function hydrate(): void {
  if (loaded) return;
  trips = get<ITrip[]>(K_TRIPS, []) || [];
  packing = get<IPackingItem[]>(K_PACKING, []) || [];
  items = get<ITripPlanItem[]>(K_ITEMS, []) || [];
  notes = get<ITripNote[]>(K_NOTES, []) || [];
  tombstones = get<Record<string, number>>(K_TOMB, {}) || {};
  loaded = true;
}

/* ============================ 云端同步 ============================ */

/**
 * 云端能力开关（持久化）。
 * 默认关闭：travel 云函数未部署时，绝不能去 callFn 一个不存在的函数——
 * 否则 wx.cloud.callFunction 会进入 30~45s 的轮询重试，把页面 onLoad 拖死（reLaunch 超时），
 * 还会误命中 cloud.ts 的 isCloudSystemError 分支，把全局 cloudDegraded 置真、
 * 连带把主待办的云同步也拖进「本地模式」。
 * 仅当用户显式点「云端同步」且探测成功后才置 true；此后写操作与按需拉取才真正走云端。
 * 这样「不部署云函数也能完整使用」天然成立，页面加载零云端调用、零长轮询。
 */
let cloudCapable = get<boolean>('travel_cloud_on', false);

/**
 * 云端写入：失败一律静默（本地已生效）。
 * cloudCapable 为 false 时直接跳过，不再发起任何可能长时间挂起的调用。
 */
async function cloud(action: string, data: Record<string, unknown>): Promise<void> {
  if (!cloudCapable) return;
  try {
    await callFn('travel', { action, ...data });
  } catch (err) {
    console.warn('[travel-store] 云端同步跳过（本地已保存）:', action, err);
    cloudCapable = false;
    set('travel_cloud_on', false);
  }
}

/** 拉取云端数据并与本地合并（以 updateTime 较新者为准）。cloudCapable 关闭时直接返回（页面加载走这里，必须瞬时）。 */
export async function pullFromCloud(): Promise<void> {
  if (!cloudCapable) return;
  hydrate();
  try {
    const res = await callFn<{ trips?: ITrip[]; packing?: IPackingItem[]; items?: ITripPlanItem[]; notes?: ITripNote[] }>(
      'travel',
      { action: 'list', since: get<number>(K_SYNC, 0) || 0 }
    );
    if (!res || !res.trips) return;
    mergeDown(res.trips || [], res.packing || [], res.items || [], res.notes || []);
    set<number>(K_SYNC, Date.now());
    persistAll();
    emit();
  } catch (err) {
    console.warn('[travel-store] 拉取云端失败，使用本地数据:', err);
    cloudCapable = false;
    set('travel_cloud_on', false);
  }
}

/**
 * 显式云端同步（手动触发）：探测 travel 云函数是否可用，可用则拉取并开启后续自动同步。
 * 这是唯一会主动 callFn 的入口，避免页面加载时静默长轮询。
 *
 * ⚠️ 关键判定：callFn 在 travel 函数「未部署」时不会抛错，而是被 cloud.ts 降级到
 * mockCall，最终返回一个 success:false 的占位结果（如 { error:'mock 未实现函数 travel' }）。
 * 因此绝不能「callFn 没抛错就当云端可用」——必须确认真实返回了 trips 业务数据，
 * 否则会把 cloudCapable 误置 true，导致后续每次写操作 / 天气都去 callFn 一个不存在的函数、
 * 触发 45s 轮询重试（reLaunch 超时的根因）。
 */
export async function syncCloud(): Promise<{ ok: boolean; msg: string }> {
  hydrate();
  try {
    const res = (await callFn<Record<string, unknown>>('travel', {
      action: 'list',
      since: get<number>(K_SYNC, 0) || 0
    })) as {
      success?: boolean;
      trips?: unknown;
      packing?: unknown;
      items?: unknown;
      notes?: unknown;
      error?: string;
      message?: string;
      errMsg?: string;
    };
    // 仅当云端确实返回了成功态 + trips 数组，才算真正可用
    const reallyOk = res && res.success === true && Array.isArray(res.trips);
    if (!reallyOk) {
      cloudCapable = false;
      set('travel_cloud_on', false);
      const hint = res?.error || res?.message || res?.errMsg || '';
      if (hint.indexOf('FUNCTION_NOT_FOUND') >= 0 || hint.indexOf('FunctionName') >= 0 || hint.indexOf('未实现函数') >= 0 || hint.indexOf('未部署') >= 0) {
        return { ok: false, msg: '未部署 travel 云函数，已使用本地数据' };
      }
      return { ok: false, msg: '云端暂未返回行程数据，已使用本地数据' };
    }
    cloudCapable = true;
    set('travel_cloud_on', true);
    mergeDown(
      (res.trips as ITrip[]) || [],
      (res.packing as IPackingItem[]) || [],
      (res.items as ITripPlanItem[]) || [],
      (res.notes as ITripNote[]) || []
    );
    set<number>(K_SYNC, Date.now());
    persistAll();
    emit();
    // 同步成功 = 云端确认可达，此时把「离线期间删掉的东西」补一刀真删
    await flushTombstones();
    return { ok: true, msg: '已同步到云端' };
  } catch (err) {
    cloudCapable = false;
    set('travel_cloud_on', false);
    const e = err as { errMsg?: string; message?: string };
    const msg = e?.errMsg || e?.message || String(err || '');
    if (msg.indexOf('FUNCTION_NOT_FOUND') >= 0 || msg.indexOf('FunctionName') >= 0) {
      return { ok: false, msg: '未部署 travel 云函数，已使用本地数据' };
    }
    return { ok: false, msg: '云端同步失败，已使用本地数据' };
  }
}

/** 当前云端能力状态（供页面展示「本地模式 / 已同步」标识） */
export function isCloudSynced(): boolean {
  return cloudCapable;
}

/* ============================ AI 能力（与云端同步解耦） ============================ */

/**
 * AI 能力开关（内存态，不持久化：每次进页面重新探测，避免「上次能用这次环境变了」）。
 *
 * ⚠️ 为什么**不能**复用 cloudCapable（这正是「AI 规划无法启用」的根因）：
 *   cloudCapable 的探测走的是 `list`，要求 trips / travel_items / travel_notes
 *   三个集合都已在云开发控制台建好；集合没建时 list 直接 -502005 失败，
 *   cloudCapable 就恒为 false —— AI 被一起锁死，界面上永远只有「启用并生成」。
 *   而 AI 只需要「云函数已部署」这一件事（密钥由服务端内置兜底，用户无需配置），
 *   与集合存不存在毫无关系，所以必须用独立探针（云函数 aiStatus，纯本地判断、不碰数据库）。
 */
let aiCapable = false;

/** AI 当前是否可用（供页面决定显示「启用并生成」还是「生成行程」） */
export function isAICapable(): boolean {
  return aiCapable;
}

/** 探测 AI 是否可用。只发一次 aiStatus（不消耗 token、不读数据库），成功即点亮。 */
export async function probeAI(): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = (await callFn<Record<string, unknown>>('travel', { action: 'aiStatus' })) as {
      success?: boolean;
      ok?: boolean;
      ai?: boolean;
      error?: string;
      message?: string;
      errMsg?: string;
    };
    if (res && res.success === true && (res.ai === true || res.ok === true)) {
      aiCapable = true;
      return { ok: true, msg: 'AI 已就绪' };
    }
    aiCapable = false;
    const hint = res?.error || res?.message || res?.errMsg || '';
    if (hint.indexOf('本地模式') >= 0) {
      return { ok: false, msg: '当前为本地模式，配置云开发环境后即可使用 AI 规划' };
    }
    if (hint.indexOf('FUNCTION_NOT_FOUND') >= 0 || hint.indexOf('未实现函数') >= 0 || hint.indexOf('未部署') >= 0) {
      return { ok: false, msg: '需先部署 travel 云函数后才能使用 AI 规划' };
    }
    return { ok: false, msg: 'AI 暂不可用，已使用本地模板生成' };
  } catch (err) {
    aiCapable = false;
    const e = err as { code?: string; errMsg?: string; message?: string };
    const msg = e?.errMsg || e?.message || String(err || '');
    if (e?.code === 'AI_TIMEOUT' || /polling exceed|-404012|TIMEOUT|timeout/i.test(msg)) {
      return { ok: false, msg: 'AI 服务响应慢，请稍后重试' };
    }
    if (
      msg.indexOf('FUNCTION_NOT_FOUND') >= 0 ||
      msg.indexOf('FunctionName') >= 0 ||
      msg.indexOf('resource function not found') >= 0 ||
      msg.indexOf('cloud function not found') >= 0
    ) {
      return { ok: false, msg: '需先部署 travel 云函数后才能使用 AI 规划' };
    }
    return { ok: false, msg: 'AI 调用失败，请检查网络后重试' };
  }
}

/** 云端下来数据 vs 本地冲突：以 updateTime 新者为准（云端为准 + 本地未同步的保留） */
function mergeDown(
  cTrips: ITrip[],
  cPacking: IPackingItem[],
  cItems: ITripPlanItem[],
  cNotes: ITripNote[]
): void {
  // 墓碑优先：用户已删除的 id，云端再来多少遍都不许进来（否则就是「删了又回来」）
  const alive = <T extends { _id: string }>(arr: T[]): T[] => arr.filter((r) => r && !tombstones[r._id]);
  const merge = <T extends { _id: string; updateTime: number }>(local: T[], remote: T[]): T[] => {
    const map = new Map<string, T>();
    local.forEach((i) => map.set(i._id, i));
    remote.forEach((r) => {
      const cur = map.get(r._id);
      if (!cur || (r.updateTime || 0) >= (cur.updateTime || 0)) map.set(r._id, r);
    });
    return Array.from(map.values());
  };
  trips = merge(trips, alive(cTrips));
  packing = merge(packing, alive(cPacking));
  items = merge(items, alive(cItems));
  notes = merge(notes, alive(cNotes));
}

/**
 * 把本地墓碑补发到云端（尽力而为）。
 * mergeDown 只是让本机「看不见」，换设备照样回来；这里在云端真删掉，然后清墓碑。
 * 失败（旧版本云函数没有 purge / 集合缺失）就留着，下次同步再补发。
 */
async function flushTombstones(): Promise<void> {
  if (!cloudCapable) return;
  const ids = Object.keys(tombstones);
  if (!ids.length) return;
  try {
    await callFn('travel', { action: 'purge', ids });
    ids.forEach((id) => {
      delete tombstones[id];
    });
    persistTomb();
  } catch (err) {
    console.warn('[travel-store] 墓碑补发失败，留待下次同步:', err);
  }
}

function persistAll(): void {
  persistTrips();
  persistPacking();
  persistItems();
  persistNotes();
}

/* ============================ 日期工具 ============================ */

/** "yyyy-mm-dd" → 当天 00:00 的时间戳 */
export function parseDate(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return Date.now();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** 时间戳 → "yyyy-mm-dd"（本地时区） */
export function toYMD(ts: number): string {
  const d = new Date(ts);
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 相差整天数（b - a，按自然日） */
export function diffDays(a: number, b: number): number {
  const da = new Date(a);
  const db = new Date(b);
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** 今天 00:00 */
export function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 行程天数（含首尾） */
export function tripDays(trip: ITrip): number {
  const n = diffDays(parseDate(trip.startDate), parseDate(trip.endDate)) + 1;
  return n > 0 ? n : 1;
}

/** 第 n 天的日期（n 从 1 开始） */
export function dayDate(trip: ITrip, day: number): string {
  return toYMD(parseDate(trip.startDate) + (day - 1) * 86400000);
}

function weekdayText(ymd: string): string {
  const ts = parseDate(ymd);
  return WEEKDAYS[new Date(ts).getDay()] || '';
}

function dateText(ymd: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd || '';
  return `${Number(m[1])}月${Number(m[2])}日`;
}

/* ============================ 行程 ============================ */

export interface TripInput {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  cover: string;
  budget: number;
  members: string[];
  scenes: TravelScene[];
  currency: ITrip['currency'];
}

export function listTrips(): ITrip[] {
  hydrate();
  return trips
    .slice()
    .sort((a, b) => parseDate(a.startDate) - parseDate(b.startDate) || b.createTime - a.createTime);
}

export function getTrip(id: string): ITrip | undefined {
  hydrate();
  return trips.find((t) => t._id === id);
}

export async function addTrip(input: TripInput): Promise<ITrip> {
  hydrate();
  const now = Date.now();
  const trip: ITrip = {
    _id: uid('trip'),
    title: input.title || '未命名行程',
    destination: input.destination || '',
    startDate: input.startDate,
    endDate: input.endDate || input.startDate,
    cover: input.cover || '',
    budget: Number(input.budget) || 0,
    members: input.members || [],
    scenes: input.scenes || [],
    currency: input.currency || null,
    archived: false,
    createTime: now,
    updateTime: now
  };
  trips.push(trip);
  persistTrips();
  emit();
  void cloud('addTrip', { trip });
  return trip;
}

export async function updateTrip(id: string, patch: Partial<ITrip>): Promise<void> {
  hydrate();
  const i = trips.findIndex((t) => t._id === id);
  if (i < 0) return;
  trips[i] = { ...trips[i], ...patch, _id: id, updateTime: Date.now() };
  persistTrips();
  emit();
  void cloud('updateTrip', { id, patch });
}

export async function removeTrip(id: string): Promise<void> {
  hydrate();
  // 先记下要一起消失的 id（行李 / 条目 / 日记），云端删除失败时靠墓碑挡住复活
  const gone = [id]
    .concat(packing.filter((p) => p.tripId === id).map((p) => p._id))
    .concat(items.filter((it) => it.tripId === id).map((it) => it._id))
    .concat(notes.filter((n) => n.tripId === id).map((n) => n._id));
  trips = trips.filter((t) => t._id !== id);
  packing = packing.filter((p) => p.tripId !== id);
  items = items.filter((it) => it.tripId !== id);
  notes = notes.filter((n) => n.tripId !== id);
  markTomb(gone);
  persistAll();
  emit();
  void cloud('removeTrip', { id });
}

export async function archiveTrip(id: string, archived: boolean): Promise<void> {
  await updateTrip(id, { archived });
}

/** 一键复制为下次旅行模板：复制行程 + 条目 + 行李（行李重置为未打包），日期顺延到下月同日 */
export async function cloneTrip(id: string, startDate: string): Promise<ITrip | null> {
  hydrate();
  const src = getTrip(id);
  if (!src) return null;
  const days = tripDays(src);
  const start = parseDate(startDate);
  const end = toYMD(start + (days - 1) * 86400000);
  const now = Date.now();
  const copy: ITrip = {
    ...src,
    _id: uid('trip'),
    title: `${src.title}（模板副本）`,
    startDate: startDate,
    endDate: end,
    archived: false,
    createTime: now,
    updateTime: now
  };
  trips.push(copy);

  // ⚠️ 送云端必须是「新生成的副本」而不是 srcItems / srcPacking：
  //   源条目的 _id 还在原行程里用着，把源条目发过去，云端会按同一个 _id 落库，
  //   反而把原行程的条目 tripId 改成副本 id（等于把原行程的行程单搬空）。
  const newItems: ITripPlanItem[] = [];
  const newPacking: IPackingItem[] = [];
  items.filter((it) => it.tripId === id).forEach((it) => {
    const c: ITripPlanItem = {
      ...it,
      _id: uid('titem'),
      tripId: copy._id,
      completed: false,
      cost: 0,
      createTime: now,
      updateTime: now
    };
    items.push(c);
    newItems.push(c);
  });
  packing.filter((p) => p.tripId === id).forEach((p) => {
    const c: IPackingItem = { ...p, _id: uid('pack'), tripId: copy._id, packed: false, createTime: now, updateTime: now };
    packing.push(c);
    newPacking.push(c);
  });
  persistAll();
  emit();
  void cloud('cloneTrip', { trip: copy, items: newItems, packing: newPacking });
  return copy;
}

/* ============================ 行程卡片（首页） ============================ */

export function tripCard(trip: ITrip): TripCard {
  hydrate();
  const start = parseDate(trip.startDate);
  const end = parseDate(trip.endDate);
  const today = todayStart();
  const daysLeft = diffDays(today, start);

  let countdownKey: TripCard['countdownKey'] = 'future';
  let countdownText = '';
  if (daysLeft > 0) {
    countdownKey = daysLeft <= 3 ? 'soon' : 'future';
    countdownText = `距离出发还有 ${daysLeft} 天`;
  } else if (daysLeft === 0) {
    countdownKey = 'traveling';
    countdownText = '今天出发';
  } else if (diffDays(today, end) >= 0) {
    countdownKey = 'traveling';
    countdownText = `旅行中 · 第 ${-daysLeft + 1} 天`;
  } else {
    countdownKey = 'past';
    countdownText = '已结束';
  }

  const tripItems = items.filter((it) => it.tripId === trip._id);
  const pack = packing.filter((p) => p.tripId === trip._id);
  const packedCount = pack.filter((p) => p.packed).length;
  const spentCost = tripItems.reduce((s, it) => s + (Number(it.cost) || 0), 0);
  const budget = Number(trip.budget) || 0;

  return {
    trip,
    countdownText,
    countdownKey,
    daysLeft,
    totalDays: tripDays(trip),
    itemCount: tripItems.length,
    doneItemCount: tripItems.filter((i) => i.completed).length,
    packedCount,
    packingTotal: pack.length,
    packingPercent: pack.length ? Math.round((packedCount / pack.length) * 100) : 0,
    spentCost,
    budgetPercent: budget > 0 ? Math.min(100, Math.round((spentCost / budget) * 100)) : 0,
    overBudget: budget > 0 && spentCost > budget
  };
}

export function listCards(): TripCard[] {
  return listTrips().map(tripCard);
}

/** 进行中/未来的行程 + 已归档 */
export function splitCards(): { active: TripCard[]; archived: TripCard[] } {
  const all = listCards();
  return {
    active: all.filter((c) => !c.trip.archived),
    archived: all.filter((c) => c.trip.archived)
  };
}

/* ============================ 行李清单 ============================ */

export function listPacking(tripId: string): IPackingItem[] {
  hydrate();
  return packing.filter((p) => p.tripId === tripId).sort((a, b) => a.order - b.order || a.createTime - b.createTime);
}

export interface PackingInput {
  name: string;
  category: PackingCategory | string;
  count?: number;
  owner?: string;
  isEssential?: boolean;
  reminderDaysBefore?: number;
  note?: string;
  fromTemplate?: string;
}

export async function addPackingItem(tripId: string, input: PackingInput): Promise<IPackingItem> {
  hydrate();
  const now = Date.now();
  const it: IPackingItem = {
    _id: uid('pack'),
    tripId,
    name: input.name || '未命名物品',
    category: input.category || '其他',
    count: Number(input.count) || 1,
    owner: input.owner || '',
    isEssential: !!input.isEssential,
    packed: false,
    reminderDaysBefore: Number(input.reminderDaysBefore) || 0,
    note: input.note || '',
    order: now,
    fromTemplate: input.fromTemplate || '',
    createTime: now,
    updateTime: now
  };
  packing.push(it);
  persistPacking();
  emit();
  void cloud('addPacking', { item: it });
  return it;
}

export async function updatePackingItem(id: string, patch: Partial<IPackingItem>): Promise<void> {
  hydrate();
  const i = packing.findIndex((p) => p._id === id);
  if (i < 0) return;
  packing[i] = { ...packing[i], ...patch, _id: id, updateTime: Date.now() };
  persistPacking();
  emit();
  void cloud('updatePacking', { id, patch });
}

/** 勾选：本地立即生效，云端失败不回滚（与待办一致，避免「点了没反应」） */
export async function togglePacked(id: string, packed: boolean): Promise<void> {
  hydrate();
  const i = packing.findIndex((p) => p._id === id);
  if (i < 0) return;
  packing[i] = { ...packing[i], packed, updateTime: Date.now() };
  persistPacking();
  emit();
  void cloud('togglePacking', { id, packed });
}

export async function removePackingItem(id: string): Promise<void> {
  hydrate();
  packing = packing.filter((p) => p._id !== id);
  markTomb([id]);
  persistPacking();
  emit();
  void cloud('removePacking', { id });
}

/** 批量删除 */
export async function batchRemovePacking(ids: string[]): Promise<number> {
  hydrate();
  const set0 = new Set(ids);
  const before = packing.length;
  packing = packing.filter((p) => !set0.has(p._id));
  markTomb(ids);
  persistPacking();
  emit();
  void cloud('batchRemovePacking', { ids });
  return before - packing.length;
}

/** 批量改分类 */
export async function batchSetCategory(ids: string[], category: string): Promise<void> {
  hydrate();
  const set0 = new Set(ids);
  const now = Date.now();
  packing = packing.map((p) => (set0.has(p._id) ? { ...p, category, updateTime: now } : p));
  persistPacking();
  emit();
  void cloud('batchSetCategory', { ids, category });
}

/** 清空某行程行李 */
export async function clearPacking(tripId: string): Promise<void> {
  hydrate();
  const gone = packing.filter((p) => p.tripId === tripId).map((p) => p._id);
  packing = packing.filter((p) => p.tripId !== tripId);
  markTomb(gone);
  persistPacking();
  emit();
  void cloud('clearPacking', { tripId });
}

/** 应用行李模板：按场景生成，已存在的同名物品跳过，返回新增条数 */
export async function applyPackingTemplate(tripId: string, scenes: TravelScene[]): Promise<number> {
  hydrate();
  const exist = new Set(packing.filter((p) => p.tripId === tripId).map((p) => p.name));
  const list = buildPackingItems(scenes);
  const now = Date.now();
  const created: IPackingItem[] = [];
  list.forEach((tpl, idx) => {
    if (exist.has(tpl.name)) return;
    const it: IPackingItem = {
      _id: uid('pack'),
      tripId,
      name: tpl.name,
      category: tpl.category,
      count: tpl.count,
      owner: '',
      isEssential: tpl.isEssential,
      packed: false,
      reminderDaysBefore: tpl.reminderDaysBefore || 0,
      note: '',
      order: now + idx,
      fromTemplate: scenes.join('/') || '通用',
      createTime: now,
      updateTime: now
    };
    packing.push(it);
    created.push(it);
  });
  persistPacking();
  emit();
  // ⚠️ 必须把「本地已经算好的 items（含 _id）」一起交给云端：
  //   只发 { tripId, scenes } 有两个后果 ——
  //   ① 旧版云函数只回一个「已应用」标记，清单从未上传，换设备 / 清缓存后清单直接消失；
  //   ② 就算云端自己生成，服务端另分配 _id → 前端删除时按本地 id 匹配不到，删不掉还会复活。
  if (created.length) void cloud('applyPackingTemplate', { tripId, scenes, items: created });
  return created.length;
}

/** 清单联动：依据行程条目给建议补充物品（返回建议名，未写入） */
export function suggestPacking(tripId: string): string[] {
  hydrate();
  const texts = items.filter((it) => it.tripId === tripId).map((it) => `${it.content} ${it.note || ''}`);
  const exist = new Set(packing.filter((p) => p.tripId === tripId).map((p) => p.name));
  return suggestPackingByItems(texts).filter((name) => !exist.has(name));
}

/** 按场景一键补齐建议物品（清单联动的落库动作） */
export async function addSuggestedPacking(tripId: string, names: string[]): Promise<number> {
  hydrate();
  const exist = new Set(packing.filter((p) => p.tripId === tripId).map((p) => p.name));
  const now = Date.now();
  const created: IPackingItem[] = [];
  names.forEach((name, idx) => {
    if (exist.has(name)) return;
    // 分类：命中模板里的同名项就沿用其分类，否则归到「其他」
    const tplItem = buildPackingItems(['度假']).find((t) => t.name === name);
    const it: IPackingItem = {
      _id: uid('pack'),
      tripId,
      name,
      category: tplItem ? tplItem.category : '其他',
      count: 1,
      owner: '',
      isEssential: false,
      packed: false,
      reminderDaysBefore: 0,
      note: '行程联动建议',
      order: now + idx,
      fromTemplate: '行程联动',
      createTime: now,
      updateTime: now
    };
    packing.push(it);
    created.push(it);
  });
  persistPacking();
  emit();
  // 同样要发 items（带 _id）而不是 names —— 见 applyPackingTemplate 的注释
  if (created.length) void cloud('addPackingBulk', { tripId, items: created, names });
  return created.length;
}

/** 进度统计 */
export function packingProgress(tripId: string): { packed: number; total: number; percent: number; essentialLeft: number } {
  hydrate();
  const list = packing.filter((p) => p.tripId === tripId);
  const packed = list.filter((p) => p.packed).length;
  return {
    packed,
    total: list.length,
    percent: list.length ? Math.round((packed / list.length) * 100) : 0,
    essentialLeft: list.filter((p) => p.isEssential && !p.packed).length
  };
}

/** 分类分组（未完成置顶，支持筛选） */
export function packingGroups(
  tripId: string,
  opts?: { onlyUnpacked?: boolean; onlyEssential?: boolean; owner?: string }
): PackingGroup[] {
  hydrate();
  let list = packing.filter((p) => p.tripId === tripId);
  if (opts?.onlyUnpacked) list = list.filter((p) => !p.packed);
  if (opts?.onlyEssential) list = list.filter((p) => p.isEssential);
  if (opts?.owner) list = list.filter((p) => p.owner === opts.owner);

  const map = new Map<string, IPackingItem[]>();
  list.forEach((p) => {
    const arr = map.get(p.category) || [];
    arr.push(p);
    map.set(p.category, arr);
  });
  const groups: PackingGroup[] = [];
  Array.from(map.keys()).forEach((category) => {
    const arr = (map.get(category) as IPackingItem[]).sort((a, b) => {
      // 未完成在前，其次按 order
      if (a.packed !== b.packed) return a.packed ? 1 : -1;
      return a.order - b.order;
    });
    const packed = arr.filter((p) => p.packed).length;
    groups.push({
      category,
      items: arr,
      total: arr.length,
      packed,
      percent: arr.length ? Math.round((packed / arr.length) * 100) : 0,
      essentialLeft: arr.filter((p) => p.isEssential && !p.packed).length
    });
  });
  return groups;
}

/** 同行者列表（用于按人筛选） */
export function packingOwners(tripId: string): string[] {
  hydrate();
  const s = new Set<string>();
  packing.filter((p) => p.tripId === tripId && p.owner).forEach((p) => s.add(p.owner));
  return Array.from(s);
}

/* ============================ 行程条目 ============================ */

export function listItems(tripId: string): ITripPlanItem[] {
  hydrate();
  return items.filter((it) => it.tripId === tripId).sort((a, b) => a.day - b.day || a.order - b.order);
}

export interface TripItemInput {
  content: string;
  day: number;
  startTime?: string;
  duration?: number;
  location?: ITripPlanItem['location'];
  itemType?: TripItemType;
  cost?: number;
  note?: string;
  ticketUrl?: string;
}

export async function addTripItem(tripId: string, input: TripItemInput): Promise<ITripPlanItem> {
  hydrate();
  const day = Math.max(1, Number(input.day) || 1);
  const sameDay = items.filter((it) => it.tripId === tripId && it.day === day);
  const maxOrder = sameDay.reduce((m, i) => Math.max(m, i.order || 0), 0);
  // 没给时间时排在同天末尾（按最后一条的结束时间顺延，避免全部堆在 09:00）
  let startTime = input.startTime || '';
  if (!startTime) {
    const last = sameDay.slice().sort((a, b) => a.order - b.order).pop();
    startTime = last ? addMinutes(last.startTime || '09:00', last.duration || 60) : '09:00';
  }
  const now = Date.now();
  const it: ITripPlanItem = {
    _id: uid('titem'),
    tripId,
    content: input.content || '新安排',
    day,
    startTime,
    duration: Number(input.duration) || 60,
    location: input.location || null,
    itemType: input.itemType || '自定义',
    cost: Number(input.cost) || 0,
    note: input.note || '',
    ticketUrl: input.ticketUrl || '',
    completed: false,
    order: maxOrder + 1,
    createTime: now,
    updateTime: now
  };
  items.push(it);
  persistItems();
  emit();
  void cloud('addTripItem', { item: it });
  return it;
}

export async function updateTripItem(id: string, patch: Partial<ITripPlanItem>): Promise<void> {
  hydrate();
  const i = items.findIndex((it) => it._id === id);
  if (i < 0) return;
  items[i] = { ...items[i], ...patch, _id: id, updateTime: Date.now() };
  persistItems();
  emit();
  void cloud('updateTripItem', { id, patch });
}

export async function toggleTripItem(id: string, completed: boolean): Promise<void> {
  hydrate();
  const i = items.findIndex((it) => it._id === id);
  if (i < 0) return;
  items[i] = { ...items[i], completed, updateTime: Date.now() };
  persistItems();
  emit();
  void cloud('toggleTripItem', { id, completed });
}

export async function removeTripItem(id: string): Promise<void> {
  hydrate();
  items = items.filter((it) => it._id !== id);
  markTomb([id]);
  persistItems();
  emit();
  void cloud('removeTripItem', { id });
}

/** 批量写入行程条目（创建行程时一次性落库，单次 emit / 单次云端同步，避免逐条重绘） */
export async function bulkAddTripItems(tripId: string, inputs: TripItemInput[]): Promise<number> {
  hydrate();
  if (!tripId || !inputs.length) return 0;
  const now = Date.now();
  const perDayOrder: Record<number, number> = {};
  const created: ITripPlanItem[] = [];
  inputs.forEach((input, idx) => {
    const day = Math.max(1, Number(input.day) || 1);
    perDayOrder[day] = (perDayOrder[day] || 0) + 1;
    // 没给时间时排在同天末尾（按最后一条的结束时间顺延，避免全部堆在 09:00）
    let startTime = input.startTime || '';
    if (!startTime) {
      const sameDay = items.filter((it) => it.tripId === tripId && it.day === day);
      const last = sameDay.slice().sort((a, b) => a.order - b.order).pop();
      startTime = last ? addMinutes(last.startTime || '09:00', last.duration || 60) : '09:00';
    }
    const it: ITripPlanItem = {
      _id: uid('titem'),
      tripId,
      content: input.content || '新安排',
      day,
      startTime,
      duration: Number(input.duration) || 60,
      location: input.location || null,
      itemType: input.itemType || '自定义',
      cost: Number(input.cost) || 0,
      note: input.note || '',
      ticketUrl: input.ticketUrl || '',
      completed: false,
      order: perDayOrder[day],
      createTime: now + idx,
      updateTime: now
    };
    items.push(it);
    created.push(it);
  });
  persistItems();
  emit();
  // ⚠️ 必须发 created（带 _id），不能发 inputs（纯入参、没有 id）：
  //   发 inputs 时云端只能自己另分配 _id，前端随后按本地 id 删除就永远匹配不上。
  if (created.length) void cloud('bulkAddTripItems', { tripId, items: created });
  return created.length;
}

/** 复制到其他天 */
export async function copyItemToDay(id: string, day: number): Promise<ITripPlanItem | null> {
  hydrate();
  const src = items.find((it) => it._id === id);
  if (!src) return null;
  const sameDay = items.filter((it) => it.tripId === src.tripId && it.day === day);
  const maxOrder = sameDay.reduce((m, i) => Math.max(m, i.order || 0), 0);
  const now = Date.now();
  const copy: ITripPlanItem = {
    ...src,
    _id: uid('titem'),
    day,
    order: maxOrder + 1,
    completed: false,
    createTime: now,
    updateTime: now
  };
  items.push(copy);
  persistItems();
  emit();
  void cloud('addTripItem', { item: copy });
  return copy;
}

/**
 * 移动条目（拖拽 / 跨天）：放进目标天的指定位置。
 * index 为目标天内的下标（0 起），超出则追加末尾。
 */
export async function moveTripItem(id: string, day: number, index: number): Promise<void> {
  hydrate();
  const cur = items.find((it) => it._id === id);
  if (!cur) return;
  const now = Date.now();
  const others = items.filter((it) => it.tripId === cur.tripId && it._id !== id && it.day === day);
  others.sort((a, b) => a.order - b.order);
  const idx = Math.max(0, Math.min(index, others.length));
  const moved: ITripPlanItem = { ...cur, day, updateTime: now };
  others.splice(idx, 0, moved);
  others.forEach((it, i) => {
    it.order = i + 1;
    it.updateTime = now;
  });
  // 用重排结果回写内存
  const map = new Map<string, ITripPlanItem>();
  others.forEach((it) => map.set(it._id, it));
  items = items.map((it) => map.get(it._id) || it);
  persistItems();
  emit();
  void cloud('moveTripItem', { id, day, index: idx });
}

/** 按天分组（详情页时间线） */
export function dayGroups(tripId: string): TripDayGroup[] {
  hydrate();
  const trip = getTrip(tripId);
  if (!trip) return [];
  const total = tripDays(trip);
  const groups: TripDayGroup[] = [];
  for (let d = 1; d <= total; d += 1) {
    const date = dayDate(trip, d);
    const list = items
      .filter((it) => it.tripId === tripId && it.day === d)
      .sort((a, b) => a.order - b.order);
    groups.push({
      day: d,
      date,
      dateText: dateText(date),
      weekdayText: weekdayText(date),
      items: list,
      cost: list.reduce((s, it) => s + (Number(it.cost) || 0), 0),
      duration: list.reduce((s, it) => s + (Number(it.duration) || 0), 0)
    });
  }
  return groups;
}

/** "HH:mm" 加 N 分钟 */
export function addMinutes(hm: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
  if (!m) return '09:00';
  const total = Number(m[1]) * 60 + Number(m[2]) + (Number(minutes) || 0);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${`${h}`.padStart(2, '0')}:${`${mm}`.padStart(2, '0')}`;
}

/** 导入路线模板：整程覆盖式写入（先清掉该行程原有条目）
 *  templateKey 传空串时自动按「目的地 + 天数」匹配最合适的模板。 */
export async function applyRouteTemplate(tripId: string, templateKey: string): Promise<number> {
  hydrate();
  const trip = getTrip(tripId);
  if (!trip) return 0;
  const tpl = templateKey
    ? allRouteTemplates().find((t) => t.key === templateKey) || null
    : matchRouteTemplate(trip.destination, tripDays(trip));
  if (!tpl) return 0;

  // 覆盖式替换 = 把旧条目全部删掉：必须立墓碑，否则云端仍留着旧条目，
  // 下次同步又原样拉回来（用户看到的就是「换了路线，旧行程又回来了」）
  const gone = items.filter((it) => it.tripId === tripId).map((it) => it._id);
  items = items.filter((it) => it.tripId !== tripId);
  markTomb(gone);
  const now = Date.now();
  const created: ITripPlanItem[] = [];
  tpl.dayList.forEach((d) => {
    d.items.forEach((it, idx) => {
      const row: ITripPlanItem = {
        _id: uid('titem'),
        tripId,
        content: it.content,
        day: d.day,
        startTime: it.startTime,
        duration: it.duration,
        location: it.locationName ? { name: it.locationName, address: '', latitude: 0, longitude: 0 } : null,
        itemType: it.itemType,
        cost: Number(it.cost) || 0,
        note: it.note || '',
        ticketUrl: '',
        completed: false,
        order: idx + 1,
        createTime: now,
        updateTime: now
      };
      items.push(row);
      created.push(row);
    });
  });
  // 预算没填时，用模板建议值兜底
  if (!trip.budget && tpl.budgetHint) {
    const i = trips.findIndex((t) => t._id === tripId);
    if (i >= 0) trips[i] = { ...trips[i], budget: tpl.budgetHint, updateTime: now };
    persistTrips();
  }
  if (!trip.scenes.length && tpl.scenes.length) {
    const i = trips.findIndex((t) => t._id === tripId);
    if (i >= 0) trips[i] = { ...trips[i], scenes: tpl.scenes, updateTime: now };
    persistTrips();
  }
  persistItems();
  emit();
  // 替换式导入：即使 created 为空（模板异常）也要发一次，让云端把旧条目删干净
  void cloud('applyRouteTemplate', { tripId, templateKey: tpl.key, items: created });
  return created.length;
}


/* ============================ 费用 ============================ */

export function costStats(tripId: string): CostStat[] {
  hydrate();
  const list = items.filter((it) => it.tripId === tripId);
  const buckets: Record<CostCategory, { amount: number; count: number }> = {
    交通: { amount: 0, count: 0 },
    住宿: { amount: 0, count: 0 },
    餐饮: { amount: 0, count: 0 },
    门票: { amount: 0, count: 0 },
    购物: { amount: 0, count: 0 },
    其他: { amount: 0, count: 0 }
  };
  let total = 0;
  list.forEach((it) => {
    const cat = TYPE_TO_COST[it.itemType] || '其他';
    const cost = Number(it.cost) || 0;
    buckets[cat].amount += cost;
    buckets[cat].count += 1;
    total += cost;
  });
  return (Object.keys(buckets) as CostCategory[])
    .map((category) => ({
      category,
      amount: buckets[category].amount,
      count: buckets[category].count,
      percent: total > 0 ? Math.round((buckets[category].amount / total) * 100) : 0
    }))
    .filter((s) => s.amount > 0 || s.count > 0)
    .sort((a, b) => b.amount - a.amount);
}

export function tripCost(tripId: string): number {
  hydrate();
  return items.filter((it) => it.tripId === tripId).reduce((s, it) => s + (Number(it.cost) || 0), 0);
}

/* ============================ 日记 ============================ */

export function listNotes(tripId: string): ITripNote[] {
  hydrate();
  return notes.filter((n) => n.tripId === tripId).sort((a, b) => a.day - b.day || a.createTime - b.createTime);
}

export async function saveNote(tripId: string, day: number, text: string, photos: string[] = []): Promise<ITripNote> {
  hydrate();
  const now = Date.now();
  const idx = notes.findIndex((n) => n.tripId === tripId && n.day === day);
  if (idx >= 0) {
    notes[idx] = { ...notes[idx], text, photos, updateTime: now };
    persistNotes();
    emit();
    void cloud('saveNote', { note: notes[idx] });
    return notes[idx];
  }
  const note: ITripNote = { _id: uid('tnote'), tripId, day, text, photos, createTime: now, updateTime: now };
  notes.push(note);
  persistNotes();
  emit();
  void cloud('saveNote', { note });
  return note;
}

export async function removeNote(id: string): Promise<void> {
  hydrate();
  notes = notes.filter((n) => n._id !== id);
  markTomb([id]);
  persistNotes();
  emit();
  void cloud('removeNote', { id });
}

/* ============================ 复盘 ============================ */

export function tripSummary(tripId: string): TripSummary | null {
  hydrate();
  const trip = getTrip(tripId);
  if (!trip) return null;
  const its = items.filter((it) => it.tripId === tripId);
  const pack = packing.filter((p) => p.tripId === tripId);
  const costTotal = its.reduce((s, it) => s + (Number(it.cost) || 0), 0);
  const done = its.filter((it) => it.completed).length;

  const placeMap = new Map<string, number>();
  its.forEach((it) => {
    if (it.location && it.location.name) {
      placeMap.set(it.location.name, (placeMap.get(it.location.name) || 0) + 1);
    }
  });

  return {
    trip,
    visitedPlaces: Array.from(placeMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    totalDays: tripDays(trip),
    itemTotal: its.length,
    itemDone: done,
    completionPercent: its.length ? Math.round((done / its.length) * 100) : 0,
    costTotal,
    costByCategory: costStats(tripId),
    budgetLeft: (Number(trip.budget) || 0) - costTotal,
    overBudget: (Number(trip.budget) || 0) > 0 && costTotal > (Number(trip.budget) || 0),
    /** 勾了打包但全程没有对应行程词 → 视为「没用到」的候选，由用户在复盘页确认 */
    unusedItems: pack.filter((p) => p.packed && !hasRelatedItem(its, p.name)),
    missingItems: pack.filter((p) => p.isEssential && !p.packed),
    packingPercent: pack.length ? Math.round((pack.filter((p) => p.packed).length / pack.length) * 100) : 0,
    plannedMinutes: its.reduce((s, it) => s + (Number(it.duration) || 0), 0),
    plannedCost: costTotal,
    notes: listNotes(tripId),
    photoCount: listNotes(tripId).reduce((s, n) => s + (n.photos ? n.photos.length : 0), 0)
  };
}

/** 物品名与行程条目是否相关（粗糙匹配：取物品名前两字去条目里找） */
function hasRelatedItem(its: ITripPlanItem[], name: string): boolean {
  const key = (name || '').slice(0, 2);
  if (!key) return false;
  return its.some((it) => `${it.content}${it.note || ''}${it.location?.name || ''}`.indexOf(key) >= 0);
}

/* ============================ 订阅消息 ============================ */

/**
 * 申请旅行提醒授权（打包提醒 / 行程提醒）。
 * 用户拒绝或平台不支持都静默处理，不阻塞主流程。
 */
export async function requestTripSubscribe(): Promise<boolean> {
  try {
    const state = await requestSubscribe();
    return state === 'accept';
  } catch (err) {
    console.warn('[travel-store] 订阅授权失败:', err);
    return false;
  }
}

/** 触发一次提醒推送（调试入口 / 出发前提醒复用） */
export async function pushTripReminder(tripId: string, kind: 'packing' | 'depart' | 'item'): Promise<boolean> {
  hydrate();
  const trip = getTrip(tripId);
  if (!trip) return false;
  const prog = packingProgress(tripId);
  const map: Record<string, string> = {
    packing: `你的${trip.destination}行程还有${Math.max(0, diffDays(todayStart(), parseDate(trip.startDate)))}天出发，行李完成度 ${prog.percent}%`,
    depart: `${trip.destination}行程即将出发，请核查证件与必备物品（还剩 ${prog.essentialLeft} 件必备用具未打包）`,
    item: `${trip.title}：今日行程提醒，祝旅途愉快`
  };
  try {
    await cloud('sendReminder', { tripId, kind, text: map[kind] || map.item });
    toast('提醒已排入云端队列', 'none');
    return true;
  } catch (err) {
    toast('提醒失败，已保留本地', 'none');
    return false;
  }
}

/* ============================ 天气（可降级） ============================ */

export interface TripWeather {
  ok: boolean;
  text: string;
  temp: string;
  icon: string;
  tip: string;
  /** 恶劣天气预警（户外项目提示） */
  warning: string;
}

/**
 * 目的地当日天气。
 * 优先走云函数 travel 的 weather action（服务端接和风天气）；
 * 未配置时降级为「按月份给穿衣建议」的本地兜底，绝不返回空白。
 */
export async function fetchWeather(destination: string, date: string): Promise<TripWeather> {
  const fallback = localWeatherFallback(date);
  // 未确认云端可用时直接用本地兜底，绝不发起可能 45s 轮询的调用（避免页面 onLoad 被拖死）
  if (!cloudCapable) return fallback;
  try {
    // 天气返回的是自有结构（ok/text/temp/...），与 CloudResult 无交集，
    // 这里用 Record 承接再自行收窄，避免被 CloudResult 的泛型约束卡住。
    const res = await callFn<Record<string, unknown>>('travel', {
      action: 'weather',
      destination,
      date
    });
    const r = (res || {}) as { ok?: boolean; text?: string; temp?: string; tip?: string; warning?: string };
    if (r.ok && r.temp) {
      return {
        ok: true,
        text: r.text || '',
        temp: r.temp,
        icon: weatherIcon(r.text || ''),
        tip: r.tip || fallback.tip,
        warning: r.warning || ''
      };
    }
    return fallback;
  } catch (err) {
    return fallback;
  }
}

function weatherIcon(text: string): string {
  if (text.indexOf('雨') >= 0) return '🌧️';
  if (text.indexOf('雪') >= 0) return '❄️';
  if (text.indexOf('云') >= 0 || text.indexOf('阴') >= 0) return '☁️';
  if (text.indexOf('雷') >= 0) return '⛈️';
  return '☀️';
}

/** 本地兜底：按月份给穿衣建议 */
function localWeatherFallback(date: string): TripWeather {
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(date || '');
  const month = m ? Number(m[1]) : new Date().getMonth() + 1;
  let tip = '舒适出行，注意防晒补水';
  let icon = '☀️';
  if (month >= 12 || month <= 2) {
    tip = '冬季出行：羽绒服 + 保暖内衣，注意路面结冰';
    icon = '❄️';
  } else if (month >= 3 && month <= 5) {
    tip = '春季出行：外套 + 薄内搭，早晚温差大';
    icon = '🌤️';
  } else if (month >= 6 && month <= 8) {
    tip = '夏季出行：防晒 + 轻便透气，多补水，注意雷雨';
    icon = '🌞';
  } else {
    tip = '秋季出行：长袖 + 薄外套，昼夜温差明显';
    icon = '🍂';
  }
  return { ok: false, text: '', temp: '--', icon, tip, warning: '' };
}

/* ============================ 导出：模板快捷 ============================ */

/** 创建行程后「快速填充」：一键导入默认路线 + 行李 */
export async function bootstrapTrip(tripId: string, scenes: TravelScene[]): Promise<{ route: number; packing: number }> {
  hydrate();
  const trip = getTrip(tripId);
  if (!trip) return { route: 0, packing: 0 };
  const tpl = matchRouteTemplate(trip.destination, tripDays(trip));
  let route = 0;
  if (tpl) route = await applyRouteTemplate(tripId, tpl.key);
  const packingN = await applyPackingTemplate(tripId, scenes.length ? scenes : ['度假']);
  return { route, packing: packingN };
}
