// utils/alert-scheduler.ts
// 通用本地提醒调度内核：供「多人提醒 / 订阅提醒」等工具共用。
// 应用存活期间每 20 秒调用一次已注册的检查器(checker)，收集到期的提醒项并统一展示。
//
// 各工具只需注册一个 checker：
//   registerChecker('grp', () => list)   // list 为到期项数组
// 返回数组元素见 DueItem。
//
// 去重：基于 (id_at) 记录在 fired 缓存，避免重复弹；周期型提醒由调用方负责推进周期并返回新 at。
// 纯本地实现；未来接入微信订阅消息时，替换 notify 层即可，业务数据层无需改动。
import { get, set, remove as removeStore } from './storage';
import { SUB_TMPL_ID, pushReminder } from './subscribe';

export interface DueItem {
  /** 全局唯一 key（用做去重前缀） */
  key: string;
  /** 标题（展示） */
  title: string;
  /** 描述（展示） */
  desc?: string;
  /** 提醒方式 */
  method?: 'toast' | 'modal';
  /** 是否已授权微信订阅消息（授权后到期由服务端推送；未授权仅本机提醒） */
  subscribed?: boolean;
  /** 提醒时间点（ms），用于构造订阅消息时间字段 */
  at?: number;
  /** 事项截止时间（ms），用于模板「到期/截止」字段；缺省时由云函数用 at 兜底 */
  due?: number;
  /** 点击通知后跳转的页面路径（不带前导斜杠）；缺省走 DEFAULT_PAGE */
  page?: string;
  /** 推送失败（用户失效/模板无效）时清订阅标记，由调用方提供 */
  clearSub?: () => void;
}

interface Checker {
  key: string;
  collect: () => Promise<DueItem[]> | DueItem[];
}

const FIRED_KEY = 'alert_fired_v1';
const INTERVAL = 20 * 1000;
/** 应用未打开期间错过的提醒，超过此时长不再打扰（仅内部记录） */
const GRACE_MS = 6 * 3600 * 1000;
const MAX_FIRED = 400;

const checkers: Checker[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
/** 首次延迟检查的 timeout：必须与 interval 一起回收，否则反复切后台会堆积 */
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function loadFired(): string[] {
  const v = get<string[]>(FIRED_KEY, []);
  return Array.isArray(v) ? v : [];
}
function saveFired(arr: string[]): void {
  set(FIRED_KEY, arr.slice(-MAX_FIRED));
}

export function registerChecker(key: string, collect: Checker['collect']): void {
  const idx = checkers.findIndex((c) => c.key === key);
  const checker = { key, collect };
  if (idx >= 0) checkers[idx] = checker;
  else checkers.push(checker);
}

/** 进程内去重：同一 key 只派发一次订阅消息（微信一次性授权推一次即失效） */
const subFired = new Set<string>();
/** 需清授权标记的错误码：用户拒绝/未授权、模板无效、openid 非法、配额用尽 —— 命中即清标记、降级本机 */
const FATAL_SUB_CODES = ['43101', '47003', '40003', 'NO_QUOTA'];
/** 点击通知的默认落地页（各 checker 可用 DueItem.page 覆盖） */
const DEFAULT_PAGE = 'pages/group-reminder/group-reminder';

/**
 * 订阅消息派发：仅对「已授权(subscribed)」的到期项，调服务端推送一条微信订阅消息。
 * 本地 toast/modal 仍照常展示（兜底，保证用户一定看得到）。
 * 失败且为致命码 → 调 clearSub 清授权标记（下次不再推送，避免反复 43101 打扰）。
 */
function dispatchSubs(items: DueItem[]): void {
  if (!SUB_TMPL_ID) return; // 模板未配置，根本不派发
  for (const it of items) {
    if (!it.subscribed) continue;       // 仅已授权才推送
    if (subFired.has(it.key)) continue; // 防重复派发
    subFired.add(it.key);
    void pushReminder({
      tmplId: SUB_TMPL_ID,
      todoId: it.key,
      title: it.title || '提醒',
      desc: it.desc,
      at: it.at || Date.now(),
      due: it.due,
      page: it.page || DEFAULT_PAGE
    }).then((r) => {
      if (!r.ok && r.code && FATAL_SUB_CODES.includes(r.code)) {
        it.clearSub?.();
      }
    });
  }
}

function notify(items: DueItem[]): void {
  if (items.length === 0) return;
  // 先派发订阅消息（异步、不阻塞本地展示）
  dispatchSubs(items);
  const modal = items.filter((i) => i.method === 'modal');
  const toast = items.filter((i) => i.method !== 'modal');
  if (modal.length > 0) {
    const first = modal[0];
    const extra = modal.length - 1 + toast.length;
    wx.showModal({
      title: '⏰ ' + first.title,
      content: first.desc || '时间到，记得查看~' + (extra > 0 ? `（另有 ${extra} 条）` : ''),
      showCancel: false,
      confirmText: '知道了',
      success: () => {
        if (toast.length > 0) fireToast(toast);
      }
    });
  } else {
    fireToast(items);
  }
}

function fireToast(items: DueItem[]): void {
  if (items.length === 0) return;
  const first = items[0];
  const title =
    items.length === 1
      ? `⏰ ${first.title}`
      : `⏰ ${first.title} 等 ${items.length} 条`;
  wx.showToast({ title, icon: 'none', duration: 2600 });
}

/** 主检查循环 */
export async function sweepAlerts(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const fired = loadFired();
    const firedSet = new Set(fired);
    const due: DueItem[] = [];
    const newKeys: string[] = [];

    for (const c of checkers) {
      let collected: DueItem[] = [];
      try {
        collected = await c.collect();
      } catch (_e) {
        continue;
      }
      if (!Array.isArray(collected)) continue;
      for (const it of collected) {
        // key 由调用方形如 `${taskId}_${at}`，已到期的 here
        if (!it || !it.key) continue;
        if (firedSet.has(it.key)) continue;
        newKeys.push(it.key);
        firedSet.add(it.key);
        // 静默错过逻辑由调用方决定是否产出；此处仅按产出展示
        due.push(it);
      }
    }

    if (newKeys.length > 0) saveFired([...fired, ...newKeys]);
    if (due.length > 0) notify(due);
  } catch (_e) {
    /* 静默 */
  } finally {
    running = false;
  }
}

/** 启动调度（幂等；App onLaunch 调用） */
export function startAlertScheduler(): void {
  if (timer !== null) return;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    sweepAlerts();
  }, 2500);
  timer = setInterval(() => { sweepAlerts(); }, INTERVAL);
}

/** 停止 */
export function stopAlertScheduler(): void {
  if (bootTimer !== null) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** 立即扫描一次（页面 onShow 兜底） */
export function sweepNow(): void {
  sweepAlerts();
}

/** 供测试/重置 */
export function clearAlertFired(): void {
  try {
    removeStore(FIRED_KEY);
  } catch (_e) {
    /* 忽略 */
  }
}
