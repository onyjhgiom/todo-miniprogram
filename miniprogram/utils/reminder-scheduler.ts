// utils/reminder-scheduler.ts
// 前端提醒调度器：应用存活期间每 30 秒扫描一次所有待办的提醒项，
// 到期自动触发（toast 通知条 / modal 弹窗），无需用户手动刷新或打开对应页面。
//
// 去重策略：
//  1. 云端/本地数据中的 reminder.sent 标记
//  2. 本机 fired log（storage）——即使云端写入失败也不会重复弹
// 重复周期：到期触发后按 daily/weekly/monthly/yearly 推进到下一周期并重置 sent。
import { callFn } from './cloud';
import { SUB_TMPL_ID, pushReminder } from './subscribe';
import { get, set } from './storage';
import * as todoStore from './todo-store';
import { loadDays, reminderAtOf } from './important-day-store';
import type { ITodo, IReminder, CloudResult } from '../types/index';

type RepeatType = NonNullable<IReminder['repeat']>;

const FIRED_KEY = 'reminder_fired';
const CHECK_INTERVAL = 30 * 1000;
/** 应用未打开期间错过的提醒，超过此时长不再打扰（静默标记为已发送） */
const MISSED_GRACE_MS = 12 * 3600 * 1000;
/** fired log 上限，防止无限膨胀 */
const FIRED_LOG_MAX = 300;

interface DueNotice {
  content: string;
  timeText: string;
  repeat: RepeatType;
  method: 'toast' | 'modal';
  /** 备注（待办 description）→ 推送时并入「提醒内容」 */
  desc?: string;
  /** 是否已授权微信订阅消息（授权后到期由服务端推送；未授权仅本机提醒） */
  subscribed?: boolean;
  /** 提醒时间点（ms） */
  at?: number;
  /** 事项截止时间（ms）→ 推送模板的「到期/截止」字段；缺省用 at 兜底 */
  due?: number;
  /** 推送失败（用户失效/模板无效）时清订阅标记 */
  clearSub?: () => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
/** 首次延迟检查的 timeout：必须与 interval 一起回收，否则反复切后台会堆积 */
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let checking = false;
/** 启动日志只在首次打印，避免每次回前台都刷一行 */
let startedOnce = false;

function pad(n: number) { return String(n).padStart(2, '0'); }
function timeText(at: number) {
  const d = new Date(at);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 按周期推进一次时间点 */
function advance(at: number, repeat: RepeatType): number {
  const d = new Date(at);
  switch (repeat) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
    default: return at;
  }
  return d.getTime();
}

/** 计算下一周期时间点；若应用离线期间跨过了多个周期，直接跳到未来最近的那个 */
function nextOccurrence(at: number, repeat: RepeatType): number {
  let n = at;
  const now = Date.now();
  let guard = 0;
  while (n <= now && guard < 500) {
    n = advance(n, repeat);
    guard += 1;
  }
  return n;
}

function loadFired(): string[] {
  const v = get<string[]>(FIRED_KEY, []);
  return Array.isArray(v) ? v : [];
}
function saveFired(keys: string[]): void {
  // 只保留最近 FIRED_LOG_MAX 条
  set(FIRED_KEY, keys.slice(-FIRED_LOG_MAX));
}

/** 进程内去重：同一 key 只派发一次订阅消息 */
const subFired = new Set<string>();
/**
 * 「需清授权标记」的错误码 —— 命中即清 subscribed，让 UI 回到「未开启」，用户点一下重新授权即可续期：
 *  43101 用户拒绝/已取消  47003 模板参数不匹配  40003 无权限
 *  NO_QUOTA 配额用尽（一次性订阅的累积次数已消费完，这是最常见的一种）
 */
const FATAL_SUB_CODES = ['43101', '47003', '40003', 'NO_QUOTA'];

/** 订阅消息派发：仅对「已授权(subscribed)」的到期项调服务端推送；本地 toast 仍兜底。 */
function dispatchSubs(notices: DueNotice[]): void {
  if (!SUB_TMPL_ID) return;
  for (const n of notices) {
    if (!n.subscribed) continue;
    const key = `${n.content}_${n.at}`;
    if (subFired.has(key)) continue;
    subFired.add(key);
    void pushReminder({
      tmplId: SUB_TMPL_ID,
      title: n.content,
      // 传备注（待办 description），不要传 timeText：
      // 时间已由模板的「提醒时间」字段呈现，塞进「提醒内容」会被截成半截且语义重复
      desc: n.desc,
      at: n.at || Date.now(),
      due: n.due,
      // 待办到期 → 点通知回到首页（首页为 tabBar 页，不支持带 query，故只回首页）
      page: 'pages/index/index'
    }).then((r) => {
      if (!r.ok && r.code && FATAL_SUB_CODES.includes(r.code)) n.clearSub?.();
    });
  }
}

/** 展示到期提醒：弹窗类型逐条弹（首个），其余合并为一条通知条 */
function notify(notices: DueNotice[]): void {
  if (notices.length === 0) return;
  dispatchSubs(notices);
  const modalOnes = notices.filter((n) => n.method === 'modal');
  const rest = notices.filter((n) => n.method !== 'modal');

  if (modalOnes.length > 0) {
    const first = modalOnes[0];
    const extra = modalOnes.length - 1 + rest.length;
    wx.showModal({
      title: '⏰ 提醒',
      content: `「${truncate(first.content, 20)}」提醒时间到（${first.timeText}）${extra > 0 ? `，另有 ${extra} 条提醒` : ''}`,
      showCancel: false,
      confirmText: '知道了',
      success: () => {
        // 弹窗关闭后如有剩余 toast 提醒再补一条汇总
        if (rest.length > 0) toastSummary(rest);
      }
    });
  } else {
    toastSummary(notices);
  }
}

function toastSummary(notices: DueNotice[]): void {
  if (notices.length === 0) return;
  const first = notices[0];
  const title =
    notices.length === 1
      ? `⏰ ${truncate(first.content, 12)}`
      : `⏰ ${truncate(first.content, 8)} 等 ${notices.length} 条提醒`;
  wx.showToast({ title, icon: 'none', duration: 3000 });
}

/** 核心检查：扫描全部待办的提醒项，触发到期提醒 */
export async function checkDueReminders(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    // 直接扫描本地数据源：
    //  ① 不再每 30 秒打一次云端全量（旧 list 有单次条数上限，数据过千会漏扫提醒）
    //  ② 云函数没部署新 action 时也能照常提醒
    // 数据源首次就绪后会常驻内存，这里的扫描是纯内存操作，成本可忽略
    await todoStore.ensureLoaded();
    let todos = todoStore.rawList();
    if (!todos.length) {
      const res = await callFn<CloudResult<ITodo>>('todos', { action: 'list' });
      todos = (res && res.items) || [];
    }
    const now = Date.now();
    const fired = loadFired();
    const firedSet = new Set(fired);
    const notices: DueNotice[] = [];
    const newFiredKeys: string[] = [];

    for (const todo of todos) {
      if (!todo || todo.completed || todo.archived) continue;
      const reminders = Array.isArray(todo.reminders) ? todo.reminders : [];
      if (reminders.length === 0) continue;

      let changed = false;
      const nextReminders = reminders.map((r) => {
        if (!r || typeof r.at !== 'number' || r.at > now) return r;
        const key = `${r.id}_${r.at}`;
        if (r.sent && !firedSet.has(key)) return r; // 云端已标记且本机未记录，也视为已处理
        if (firedSet.has(key)) return r;            // 本机已触发过，跳过

        const repeat = (r.repeat || 'none') as RepeatType;
        const method = (r.method || 'toast') as 'toast' | 'modal';
        const missed = now - r.at > MISSED_GRACE_MS;

        // 错过太久 → 静默处理，不打扰
        if (!missed) {
          notices.push({
            content: todo.content,
            timeText: timeText(r.at),
            repeat,
            method,
            subscribed: r.subscribed,
            desc: todo.description || undefined,
            at: r.at,
            due: todo.dueDate || undefined
          });
        }
        newFiredKeys.push(key);

        if (repeat !== 'none') {
          // 周期性提醒：推进到下一周期，sent 重置
          changed = true;
          return { ...r, at: nextOccurrence(r.at, repeat), sent: false };
        }
        changed = true;
        return { ...r, sent: true };
      });

      if (changed) {
        // 先记本机 fired log（权威去重），再异步写回云端
        newFiredKeys.forEach((k) => firedSet.add(k));
        callFn('todos', { action: 'update', id: todo._id, reminders: nextReminders })
          .catch(() => { /* 云端失败不阻塞：本机 fired log 已去重 */ });
      }
    }

    // 重要日提醒：扫描本地重要日，到期触发本机通知（与待办共用去重与过期策略）
    try {
      for (const d of loadDays()) {
        const at = reminderAtOf(d, now);
        if (!at) continue;
        const key = `imp_${d.id}_${at}`;
        if (firedSet.has(key)) continue;
        if (at > now) continue;
        const missed = now - at > MISSED_GRACE_MS;
        if (!missed) {
          notices.push({
            content: `💖 ${d.title}`,
            timeText: timeText(at),
            repeat: 'none',
            method: 'toast',
            desc: `重要日 · ${d.date}`,
            at,
            due: at
          } as DueNotice);
        }
        newFiredKeys.push(key);
      }
    } catch (_e) { /* 重要日扫描失败不影响待办提醒 */ }

    if (newFiredKeys.length > 0) {
      saveFired([...fired, ...newFiredKeys]);
    }
    if (notices.length > 0) {
      notify(notices);
    }
  } catch (_e) {
    // 云端与本地均不可用时静默跳过，下轮重试
  } finally {
    checking = false;
  }
}

/** 启动调度器（App onLaunch 调用；幂等，重复调用无副作用） */
export function startScheduler(): void {
  if (timer !== null) return;
  // 启动后延迟 3 秒做首次检查（等待云环境初始化与首页加载）
  bootTimer = setTimeout(() => {
    bootTimer = null;
    checkDueReminders();
  }, 3000);
  timer = setInterval(() => { checkDueReminders(); }, CHECK_INTERVAL);
  if (!startedOnce) {
    startedOnce = true;
    console.log('[reminder-scheduler] 已启动（每 30 秒检查一次到期提醒）');
  }
}

/** 停止调度器 */
export function stopScheduler(): void {
  if (bootTimer !== null) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** 立即触发一次检查（App onShow 兜底） */
export function checkNow(): void {
  checkDueReminders();
}
