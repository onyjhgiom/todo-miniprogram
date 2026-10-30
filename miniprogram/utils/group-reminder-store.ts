// utils/group-reminder-store.ts
// 多人提醒：创建提醒 → 选择多位参与者 → 到期时同时通知。
// 数据存储：优先本地（wx.storage），预留云端同步适配（_cloudId 空则本地）。
//
// 多人送达说明：微信小程序无法主动向非本机用户弹通知（需订阅消息 + 云函数推送）。
// 本实现「本地优先」策略：
//   1) 提醒到点在本机弹「通知条/弹窗」（覆盖创建者本人，实时可验证）；
//   2) 参与者以「成员卡片」形式记录并随提醒一并展示，供用户复制分享或当面转达；
//   3) 预留 requestShare / 云同步接口，未来接入订阅消息推送可无缝扩展。
import { get, set, remove } from './storage';
import { registerChecker, sweepNow, type DueItem } from './alert-scheduler';
import { addLog } from './group-reminder-log';
import type { CloudResult } from '../types/index';

export interface GrpMember {
  id: string;
  name: string;
  /** 头像 emoji 或首字 */
  avatar: string;
  /** 成员辨识色 */
  tone: string;
}

export type RepeatKind = 'none' | 'daily' | 'weekly' | 'monthly';

export interface GrpAlert {
  id: string;
  title: string;
  note: string;
  /** 提醒时间（ms） */
  dueAt: number;
  /** 参与成员 */
  members: GrpMember[];
  /** 触发方式 */
  method: 'toast' | 'modal';
  /** 重复周期（none=一次性） */
  repeat: RepeatKind;
  /** 是否启用 */
  enabled: boolean;
  createTime: number;
  updateTime: number;
  /** 用户是否授权该提醒的微信订阅消息（需 MP 后台注册模板后生效） */
  subscribed?: boolean;
  /** 授权成功的时间戳；用于判断一次性授权是否仍在有效期内 */
  grantedAt?: number;
  /** 云端预留：未来订阅消息推送目标 openid 列表 */
  targets?: string[];
}

const KEY = 'grp_alerts_v1';
export const MEMBER_TONES = ['#6366f1', '#e11d48', '#10b981', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ec4899', '#f97316'];
export const DEFAULT_MEMBERS: GrpMember[] = [
  { id: 'self', name: '我', avatar: '🙋', tone: '#B5714C' },
  { id: 'm1', name: '同事', avatar: '👩‍💼', tone: '#e11d48' },
  { id: 'm2', name: '家人', avatar: '🏠', tone: '#10b981' },
  { id: 'm3', name: '好友', avatar: '👫', tone: '#f59e0b' }
];

export function uid(): string {
  return 'ga_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function loadAlerts(): GrpAlert[] {
  const list = get<GrpAlert[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}
export function saveAlerts(list: GrpAlert[]): void {
  set(KEY, list);
}
export function addAlert(alert: GrpAlert): GrpAlert[] {
  const list = loadAlerts();
  list.unshift(alert);
  saveAlerts(list);
  return list;
}
export function updateAlert(id: string, patch: Partial<GrpAlert>): GrpAlert[] {
  const list = loadAlerts().map((a) => (a.id === id ? { ...a, ...patch, updateTime: Date.now() } : a));
  saveAlerts(list);
  return list;
}
export function removeAlert(id: string): GrpAlert[] {
  const list = loadAlerts().filter((a) => a.id !== id);
  saveAlerts(list);
  return list;
}
export function clearAlerts(): void {
  remove(KEY);
}

/** 周期推进（在 now 之后的下一实例时间点；一次性则原样） */
export function nextOccurrence(dueAt: number, repeat: RepeatKind, now = Date.now()): number {
  if (!repeat || repeat === 'none') return dueAt > now ? dueAt : 0;
  let t = dueAt;
  const d = new Date(t);
  while (t <= now && t > 0) {
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    t = d.getTime();
    if (t === dueAt) break; // 防御：异常时避免死循环
  }
  return t;
}

/** 供调度器收集本工具到期的提醒项；并就地推进周期 */
export function collectDue(): DueItem[] {
  const now = Date.now();
  let changed = false;
  const due: DueItem[] = [];
  const list = loadAlerts().map((a) => {
    if (!a.enabled || a.dueAt > now) return a;
    // 到期
    const who = a.members.length ? a.members.map((m) => m.name).join('、') : '我';
    due.push({
      key: `${a.id}_${a.dueAt}`,
      title: a.title || '提醒',
      desc: `${a.note || '无备注'} · 通知：${who}`,
      method: a.method,
      subscribed: a.subscribed,
      at: a.dueAt,
      clearSub: a.subscribed ? () => updateAlert(a.id, { subscribed: false }) : undefined
    });
    // 落一条完整的触发记录（本机展示），保证"提醒记录"可追溯
    addLog({
      alertId: a.id,
      title: a.title || '提醒',
      members: a.members.map((m) => m.name),
      channel: 'in-app',
      status: 'shown'
    });
    if (a.repeat && a.repeat !== 'none') {
      const nxt = nextOccurrence(a.dueAt, a.repeat, now);
      changed = true;
      return { ...a, dueAt: nxt, updateTime: now };
    }
    changed = true;
    return { ...a, enabled: false, updateTime: now }; // 一次性：触发后停用
  });
  if (changed) saveAlerts(list);
  return due;
}

/** 注册到全局调度器（幂等，可在 onLoad 调用） */
export function ensureRegistered(): void {
  registerChecker('grp', () => collectDue());
}

/** 云端同步预留：失败静默，保持本地可跑（未来接 triggerDueReminders 推送） */
export async function syncToCloud(alerts: GrpAlert[]): Promise<CloudResult> {
  void alerts;
  return { success: true };
}

/** 生成一条可复制/分享给参与者的消息 */
export function buildShareMessage(a: GrpAlert): string {
  const time = new Date(a.dueAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const who = a.members.length ? a.members.map((m) => m.name).join('、') : '我';
  return `🔔【多人提醒】${a.title}\n时间：${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}\n提醒：${who}\n${a.note ? '备注：' + a.note : ''}\n（来自待办清单 · 工具中心）`;
}
