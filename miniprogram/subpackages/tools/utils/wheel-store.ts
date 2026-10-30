// subpackages/tools/utils/wheel-store.ts
// 万能转盘数据层：转盘配置 CRUD + 权重抽取 + 历史记录 + 统计
//
// 存储策略（与「本地优先」一致）：
//   · 真相源在本地 storage（分片不需要，数据量很小：20 个转盘 + 100 条记录）；
//   · 云端只做镜像备份：写操作后台静默 push，失败完全不影响使用；
//   · 仅当本地**完全没有**转盘数据时才尝试拉取云端（避免把本地改动覆盖掉）。
//
// 注意：所有写操作都走 saveDebounced（防抖 1s），连续改选项不会每次都跨线程写盘。

import { get, set, uid } from '../../../utils/storage';
import { callFn } from '../../../utils/cloud';
import { PALETTES, getTemplate } from './wheel-templates';
import type { PaletteKey, IWheelTemplate } from './wheel-templates';

/* ==================== 类型 ==================== */

export interface IWheelOption {
  id: string;
  text: string;
  /** 扇区颜色（hex） */
  color: string;
  /** 权重 1-9（概率倍率） */
  weight: number;
  /** 快捷图标（emoji，可空） */
  icon?: string;
  /** 视觉标记：由待办导入的选项可在本轮打勾（不回写原待办） */
  done?: boolean;
  /** 来源待办 id（从待办导入时有值，仅用于溯源，不做回写） */
  todoId?: string;
}

export type WheelDuration = 'short' | 'standard' | 'long';

export interface IWheelSettings {
  duration: WheelDuration;
  /** 摇一摇触发转动 */
  shakeEnabled: boolean;
  /** 音效 */
  soundEnabled: boolean;
  /** 震动 */
  vibrateEnabled: boolean;
}

export interface IWheel {
  _id: string;
  name: string;
  icon: string;
  theme: PaletteKey;
  options: IWheelOption[];
  settings: IWheelSettings;
  /** 是否由模板创建（仅统计用） */
  isTemplate: boolean;
  /** 来源模板 id */
  templateId?: string;
  useCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface IWheelRecordOption {
  text: string;
  color: string;
  icon?: string;
}

export interface IWheelRecord {
  _id: string;
  wheelId: string;
  wheelName: string;
  /** 抽中结果文本 */
  result: string;
  /** 抽中结果图标 */
  resultIcon?: string;
  /** 转盘名快照（删除转盘后仍能显示） */
  optionSnapshot: IWheelRecordOption[];
  createdAt: number;
}

export interface IWheelGlobal {
  /** 全局静音（跟随小程序设置，true 时任何音效都不响） */
  muted: boolean;
  /** 待办完成彩蛋是否开启 */
  rewardEnabled: boolean;
  /** 连续完成待办计数（达到 5 触发一次彩蛋） */
  combo: number;
  /** combo 计数的日期（跨天重置） */
  comboDay: string;
}

/** 转动时长（ms） */
export const DURATION_MS: Record<WheelDuration, number> = {
  short: 2000,
  standard: 3500,
  long: 5000
};

export const MAX_WHEELS = 20;
export const MAX_RECORDS = 100;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 12;

/* ==================== 存储键 ==================== */

const KEY_LIST = 'wheel_list';
const KEY_RECORDS = 'wheel_records';
const KEY_CURRENT = 'wheel_current';
const KEY_GLOBAL = 'wheel_global';
/** 首页彩蛋计数也在主包里读写（首页不引用本文件，避免主包被分包代码拖大） */
export const KEY_REWARD = 'wheel_reward';

/* ==================== 内存态 ==================== */

let wheels: IWheel[] | null = null;
let records: IWheelRecord[] | null = null;
let globalCfg: IWheelGlobal | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 首次进入是否已尝试过云端拉取（只试一次，失败不再打扰） */
let pulled = false;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function ensure(): void {
  if (wheels === null) {
    const raw = get<IWheel[]>(KEY_LIST, []);
    wheels = Array.isArray(raw) ? raw : [];
  }
  if (records === null) {
    const raw = get<IWheelRecord[]>(KEY_RECORDS, []);
    records = Array.isArray(raw) ? raw : [];
  }
  if (globalCfg === null) {
    const raw = get<Partial<IWheelGlobal>>(KEY_GLOBAL, {});
    globalCfg = {
      muted: !!raw.muted,
      rewardEnabled: raw.rewardEnabled !== false,
      combo: Number(raw.combo) || 0,
      comboDay: raw.comboDay || ''
    };
  }
}

/* ==================== 保存（防抖 / 立即） ==================== */

export function saveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (wheels !== null) set(KEY_LIST, wheels);
  if (records !== null) set(KEY_RECORDS, records);
  if (globalCfg !== null) set(KEY_GLOBAL, globalCfg);
}

/** 防抖 1s 落盘：编辑页连续改字不会每次都写 storage */
export function saveDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 1000);
}

/* ==================== 默认 & 模板实例化 ==================== */

function defaultSettings(): IWheelSettings {
  return {
    duration: 'standard',
    shakeEnabled: false,
    soundEnabled: true,
    vibrateEnabled: true
  };
}

function optId(): string {
  return uid('wo');
}

/** 由模板内容生成运行时选项（自动配色、补权重） */
export function optionsFromTemplate(tpl: IWheelTemplate): IWheelOption[] {
  const colors = (PALETTES[tpl.theme] || PALETTES.candy).colors;
  return (tpl.options || []).slice(0, MAX_OPTIONS).map((o, i) => ({
    id: optId(),
    text: o.text,
    color: colors[i % colors.length],
    weight: Math.max(1, Math.min(9, o.weight || 1)),
    icon: o.icon || ''
  }));
}

/** 空转盘（自定义从零开始） */
export function blankOptions(): IWheelOption[] {
  const colors = PALETTES.candy.colors;
  return [
    { id: optId(), text: '选项一', color: colors[0], weight: 1, icon: '' },
    { id: optId(), text: '选项二', color: colors[1], weight: 1, icon: '' }
  ];
}

/**
 * 首次进入的兜底转盘：直接用「今天吃什么」模板，
 * 让用户第一次进来就能转，而不是面对一个空页面。
 */
export function seedWheels(): IWheel {
  ensure();
  const tpl = getTemplate('eat-lunch');
  const wheel: IWheel = {
    _id: uid('wh'),
    name: tpl ? tpl.name : '我的转盘',
    icon: tpl ? tpl.icon : '🎡',
    theme: tpl ? tpl.theme : 'candy',
    options: tpl ? optionsFromTemplate(tpl) : blankOptions(),
    settings: defaultSettings(),
    isTemplate: !!tpl,
    templateId: tpl ? tpl.id : '',
    useCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  (wheels as IWheel[]).unshift(wheel);
  saveNow();
  return wheel;
}

/** 用模板创建一个新转盘（复制同款） */
export function createFromTemplate(tpl: IWheelTemplate): IWheel {
  ensure();
  const wheel: IWheel = {
    _id: uid('wh'),
    name: tpl.name,
    icon: tpl.icon,
    theme: tpl.theme,
    options: optionsFromTemplate(tpl),
    settings: defaultSettings(),
    isTemplate: true,
    templateId: tpl.id,
    useCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  (wheels as IWheel[]).unshift(wheel);
  saveDebounced();
  pushWheel(wheel);
  return wheel;
}

/** 创建空白转盘 */
export function createBlank(name = '我的转盘'): IWheel {
  ensure();
  const wheel: IWheel = {
    _id: uid('wh'),
    name,
    icon: '🎡',
    theme: 'candy',
    options: blankOptions(),
    settings: defaultSettings(),
    isTemplate: false,
    templateId: '',
    useCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  (wheels as IWheel[]).unshift(wheel);
  saveDebounced();
  pushWheel(wheel);
  return wheel;
}

/* ==================== 查询 ==================== */

export function listWheels(): IWheel[] {
  ensure();
  if (!(wheels as IWheel[]).length) seedWheels();
  return clone(wheels as IWheel[]);
}

export function getWheel(id: string): IWheel | undefined {
  ensure();
  const w = (wheels as IWheel[]).find((x) => x._id === id);
  return w ? clone(w) : undefined;
}

/** 取内部引用（修改后由调用方 saveDebounced）——仅本模块与页面谨慎使用 */
function refWheel(id: string): IWheel | undefined {
  ensure();
  return (wheels as IWheel[]).find((x) => x._id === id);
}

export function currentId(): string {
  ensure();
  const id = get<string>(KEY_CURRENT, '');
  const list = wheels as IWheel[];
  if (id && list.some((w) => w._id === id)) return id;
  return list.length ? list[0]._id : '';
}

export function setCurrent(id: string): void {
  set(KEY_CURRENT, id);
}

/** 保证至少有一个转盘，返回当前应展示的转盘 */
export function ensureCurrent(): IWheel {
  ensure();
  if (!(wheels as IWheel[]).length) seedWheels();
  const id = currentId();
  const w = refWheel(id) || (wheels as IWheel[])[0];
  setCurrent(w._id);
  return clone(w);
}

/* ==================== 修改 ==================== */

export function updateWheel(id: string, patch: Partial<IWheel>): IWheel | undefined {
  ensure();
  const w = refWheel(id);
  if (!w) return undefined;
  Object.keys(patch).forEach((k) => {
    const key = k as keyof IWheel;
    if (key === '_id' || key === 'createdAt') return;
    (w as unknown as Record<string, unknown>)[k] = patch[key];
  });
  w.updatedAt = Date.now();
  saveDebounced();
  pushWheel(w);
  return clone(w);
}

/** 整体替换（编辑页保存用，避免逐字段 patch） */
export function replaceWheel(next: IWheel): IWheel {
  ensure();
  const list = wheels as IWheel[];
  const i = list.findIndex((w) => w._id === next._id);
  const copy = clone(next);
  copy.updatedAt = Date.now();
  if (i >= 0) list[i] = copy;
  else list.unshift(copy);
  saveNow();
  pushWheel(copy);
  return clone(copy);
}

export function removeWheel(id: string): boolean {
  ensure();
  const list = wheels as IWheel[];
  const i = list.findIndex((w) => w._id === id);
  if (i < 0) return false;
  // 不允许删光：至少保留一个转盘，否则主页无从展示
  if (list.length <= 1) return false;
  list.splice(i, 1);
  saveNow();
  removeWheelRemote(id);
  return true;
}

export function duplicateWheel(id: string): IWheel | undefined {
  ensure();
  if ((wheels as IWheel[]).length >= MAX_WHEELS) return undefined;
  const w = refWheel(id);
  if (!w) return undefined;
  const copy = clone(w);
  copy._id = uid('wh');
  copy.name = `${w.name} 副本`;
  copy.isTemplate = false;
  copy.useCount = 0;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.options = copy.options.map((o) => ({ ...o, id: optId(), done: false }));
  (wheels as IWheel[]).unshift(copy);
  saveNow();
  pushWheel(copy);
  return clone(copy);
}

/** 转盘数量是否已达上限 */
export function isFull(): boolean {
  ensure();
  return (wheels as IWheel[]).length >= MAX_WHEELS;
}

/** 记一次使用（模板埋点 + 转盘使用次数） */
export function markUsed(id: string): void {
  ensure();
  const w = refWheel(id);
  if (!w) return;
  w.useCount = (w.useCount || 0) + 1;
  w.updatedAt = Date.now();
  saveDebounced();
  pushWheel(w);
}

/* ==================== 权重抽取 ==================== */

function weightOf(o: IWheelOption): number {
  const n = Number(o.weight);
  return isNaN(n) ? 1 : Math.max(1, Math.min(9, Math.round(n)));
}

/**
 * 按权重随机抽取一个选项的下标。
 *
 * 算法：把所有可选权重铺成一条 [0, total) 的线段，随机数落进谁的区间就是谁。
 * excluded 用于「移除此项再转一次」——只在本轮剔除，不改动配置。
 * 全部被排除时（理论上不会发生，UI 已限制至少保留 1 个）自动退回全量池。
 */
export function pickIndex(options: IWheelOption[], excluded?: string[]): number {
  const list = options || [];
  if (!list.length) return -1;
  const ex = excluded || [];
  let pool: number[] = [];
  for (let i = 0; i < list.length; i++) {
    if (ex.indexOf(list[i].id) >= 0) continue;
    pool.push(i);
  }
  if (!pool.length) pool = list.map((_, i) => i);
  let total = 0;
  pool.forEach((i) => { total += weightOf(list[i]); });
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)];
  let r = Math.random() * total;
  for (let k = 0; k < pool.length; k++) {
    r -= weightOf(list[pool[k]]);
    if (r < 0) return pool[k];
  }
  return pool[pool.length - 1];
}

/** 权重占比（0~1），用于列表角标与统计页的期望值对比 */
export function weightRatio(options: IWheelOption[], index: number): number {
  const list = options || [];
  let total = 0;
  list.forEach((o) => { total += weightOf(o); });
  if (!total || index < 0 || index >= list.length) return 0;
  return weightOf(list[index]) / total;
}

/* ==================== 历史记录 ==================== */

export function listRecords(wheelId = ''): IWheelRecord[] {
  ensure();
  const list = (records as IWheelRecord[]).slice().sort((a, b) => b.createdAt - a.createdAt);
  return wheelId ? list.filter((r) => r.wheelId === wheelId) : list;
}

export function addRecord(wheel: IWheel, option: IWheelOption): IWheelRecord {
  ensure();
  const rec: IWheelRecord = {
    _id: uid('wr'),
    wheelId: wheel._id,
    wheelName: wheel.name,
    result: option.text,
    resultIcon: option.icon || '',
    optionSnapshot: wheel.options.map((o) => ({
      text: o.text,
      color: o.color,
      icon: o.icon || ''
    })),
    createdAt: Date.now()
  };
  (records as IWheelRecord[]).unshift(rec);
  // 本地只保留最近 100 条（云端保留 90 天由云函数侧清理）
  if ((records as IWheelRecord[]).length > MAX_RECORDS) {
    (records as IWheelRecord[]).length = MAX_RECORDS;
  }
  saveNow();
  pushRecord(rec);
  return rec;
}

export function removeRecord(id: string): void {
  ensure();
  const list = records as IWheelRecord[];
  const i = list.findIndex((r) => r._id === id);
  if (i >= 0) {
    const rid = list[i]._id;
    list.splice(i, 1);
    saveNow();
    cloud('removeRecord', { id: rid });
  }
}

export function clearRecords(wheelId = ''): void {
  ensure();
  const list = records as IWheelRecord[];
  if (!wheelId) {
    list.length = 0;
  } else {
    // 只清某个转盘的记录：先取出保留项再整体回填，避免边遍历边 splice
    const kept = list.filter((r) => r.wheelId !== wheelId);
    list.length = 0;
    kept.forEach((r) => list.push(r));
  }
  saveNow();
  void cloud('clearRecords', { wheelId });
}

/**
 * 选项被抽中的次数统计（用于历史页「次数统计」模式）。
 * 返回按次数降序的数组，含期望占比（按权重）与实际占比。
 */
export interface IStatRow {
  text: string;
  color: string;
  icon?: string;
  count: number;
  /** 实际占比 0~1 */
  ratio: number;
  /** 权重期望占比 0~1（转盘无此选项时为 0） */
  expect: number;
}

export function statsOf(wheelId: string): IStatRow[] {
  const wheel = getWheel(wheelId);
  const recs = listRecords(wheelId);
  const total = recs.length || 1;
  const map = new Map<string, IStatRow>();
  const ensureRow = (text: string, color: string, icon?: string): IStatRow => {
    const key = text || '（空）';
    let row = map.get(key);
    if (!row) {
      row = { text: key, color: color || '#C7B8A8', icon: icon || '', count: 0, ratio: 0, expect: 0 };
      map.set(key, row);
    }
    return row;
  };

  if (wheel) {
    wheel.options.forEach((o, i) => {
      const row = ensureRow(o.text, o.color, o.icon);
      row.expect = weightRatio(wheel.options, i);
    });
  }
  recs.forEach((r) => {
    const snap = (r.optionSnapshot || []).find((s) => s.text === r.result);
    ensureRow(r.result, (snap && snap.color) || '#C7B8A8', r.resultIcon).count += 1;
  });

  const rows = Array.from(map.values()).map((r) => ({ ...r, ratio: r.count / total }));
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

/** 转盘是否已被删除（历史页标记「已删除的转盘」） */
export function isWheelDeleted(wheelId: string): boolean {
  ensure();
  return !(wheels as IWheel[]).some((w) => w._id === wheelId);
}

/* ==================== 全局设置 ==================== */

export function globalCfgOf(): IWheelGlobal {
  ensure();
  return { ...(globalCfg as IWheelGlobal) };
}

export function setGlobalCfg(patch: Partial<IWheelGlobal>): IWheelGlobal {
  ensure();
  globalCfg = { ...(globalCfg as IWheelGlobal), ...patch };
  saveNow();
  return { ...globalCfg };
}

/* ==================== 转待办 ==================== */

/**
 * 抽奖结果 → 新建待办的默认参数。
 * 截止时间默认「今天 18:00」；若当前已过 18:00，则顺延到明天 18:00
 * （否则用户一进来就看到一条已逾期的待办）。
 */
export function resultToTodo(text: string): { content: string; tags: string[]; dueDate: number } {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0);
  if (due.getTime() <= Date.now()) due.setDate(due.getDate() + 1);
  return { content: text, tags: ['生活'], dueDate: due.getTime() };
}

/* ==================== 云同步（静默，失败不影响本地） ==================== */

async function cloud(action: string, data: Record<string, unknown>): Promise<unknown> {
  try {
    return await callFn('wheel', { action, ...data } as Record<string, unknown>);
  } catch (err) {
    // 云函数未部署 / 网络异常：忽略，本地已经是真相源
    return null;
  }
}

export function pushWheel(w: IWheel): void {
  void cloud('upsertWheel', { wheel: w });
}

export function pushRecord(r: IWheelRecord): void {
  void cloud('addRecord', { record: r });
}

export function removeWheelRemote(id: string): void {
  void cloud('removeWheel', { id });
}

/**
 * 仅当本地没有任何转盘时，尝试从云端恢复一次。
 * 不覆盖本地数据 —— 避免用户在 A 手机改过、回到 B 手机被旧版本冲掉。
 */
export async function pullIfEmpty(): Promise<boolean> {
  ensure();
  if (pulled) return false;
  if ((wheels as IWheel[]).length) return false;
  pulled = true;
  try {
    const res = await cloud('listWheels', {});
    const list = res && (res as { wheels?: IWheel[] }).wheels;
    if (Array.isArray(list) && list.length) {
      wheels = list.slice(0, MAX_WHEELS).map(normalizeWheel);
      saveNow();
      return true;
    }
  } catch (err) {
    /* 忽略 */
  }
  return false;
}

/** 云端数据兜底修正（老数据可能缺字段） */
function normalizeWheel(w: IWheel): IWheel {
  return {
    _id: w._id || uid('wh'),
    name: w.name || '我的转盘',
    icon: w.icon || '🎡',
    theme: (w.theme && PALETTES[w.theme] ? w.theme : 'candy') as PaletteKey,
    options: Array.isArray(w.options) ? w.options.map((o) => ({
      id: o.id || optId(),
      text: String(o.text || ''),
      color: o.color || PALETTES.candy.colors[0],
      weight: weightOf(o),
      icon: o.icon || '',
      done: !!o.done,
      todoId: o.todoId || ''
    })) : blankOptions(),
    settings: { ...defaultSettings(), ...(w.settings || {}) } as IWheelSettings,
    isTemplate: !!w.isTemplate,
    templateId: w.templateId || '',
    useCount: Number(w.useCount) || 0,
    createdAt: Number(w.createdAt) || Date.now(),
    updatedAt: Number(w.updatedAt) || Date.now()
  };
}

/* ==================== 待办彩蛋（首页调用） ==================== */

/**
 * 首页每完成一条待办调用一次：连续完成 5 条 → 触发幸运转盘引导。
 * 计数存在独立 key 里，首页只读写 storage，不 import 本模块（主包不引用分包代码）。
 * 返回值：是否应该弹引导。
 */
export function noteTodoCompleted(): boolean {
  try {
    const raw = get<{ combo?: number; day?: string; off?: boolean }>(KEY_REWARD, {});
    const today = new Date().toDateString();
    const combo = (raw.day === today ? Number(raw.combo) || 0 : 0) + 1;
    set(KEY_REWARD, { combo, day: today, off: !!raw.off });
    if (raw.off) return false;
    return combo > 0 && combo % 5 === 0;
  } catch (err) {
    return false;
  }
}

/* ==================== 模板使用埋点 & 首次进入 ==================== */

const KEY_TPL_USE = 'wheel_tpl_use';
const KEY_SEEN = 'wheel_seen';

/** 模板被使用一次（热门模板前置排序用） */
export function markTemplateUsed(tplId: string): void {
  if (!tplId) return;
  const map = get<Record<string, number>>(KEY_TPL_USE, {}) || {};
  map[tplId] = (Number(map[tplId]) || 0) + 1;
  set(KEY_TPL_USE, map);
}

export function templateUseCounts(): Record<string, number> {
  return get<Record<string, number>>(KEY_TPL_USE, {}) || {};
}

/** 是否首次进入（首次要弹模板选择层） */
export function isFirstRun(): boolean {
  return !get<boolean>(KEY_SEEN, false);
}

export function markSeen(): void {
  set(KEY_SEEN, true);
}

/** 首页读取彩蛋是否已关闭（本模块版本，供转盘页设置用） */
export function isRewardOff(): boolean {
  const raw = get<{ off?: boolean }>(KEY_REWARD, {});
  return !!raw.off;
}

export function setRewardOff(off: boolean): void {
  const raw = get<{ combo?: number; day?: string; off?: boolean }>(KEY_REWARD, {});
  set(KEY_REWARD, { ...raw, off });
}
