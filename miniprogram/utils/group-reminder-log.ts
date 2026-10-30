// utils/group-reminder-log.ts
// 多人提醒「触发记录」存储与查询：每次提醒到期并在本机展示/云端推送时各落一条，
// 用于「保留完整的提醒记录」并支持按提醒筛选、最近查询。
// 存储：本地 wx.storage，key = grp_alert_logs_v1（无需云端即可跑）。
import { get, set, remove } from './storage';

export type GrpLogChannel = 'in-app' | 'subscribe';
export type GrpLogStatus = 'shown' | 'pushed' | 'failed';

export interface GrpLog {
  id: string;
  /** 关联提醒 id（便于按提醒查询历史） */
  alertId: string;
  /** 触发时的提醒标题（快照，防止提醒被改后记录失真） */
  title: string;
  /** 触发时的参与人姓名 */
  members: string[];
  /** 渠道：本机弹窗 / 订阅消息 */
  channel: GrpLogChannel;
  /** 状态：已展示 / 已推送 / 失败 */
  status: GrpLogStatus;
  /** 触发时间戳(ms) */
  at: number;
  /** 附加说明（如失败原因） */
  detail?: string;
}

const KEY = 'grp_alert_logs_v1';
const MAX_LOGS = 500;

function uid(): string {
  return 'gl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function loadLogs(alertId?: string): GrpLog[] {
  const list = get<GrpLog[]>(KEY, []);
  if (!Array.isArray(list)) return [];
  const sorted = list.slice().sort((a, b) => b.at - a.at); // 倒序：新→旧
  return alertId ? sorted.filter((l) => l.alertId === alertId) : sorted;
}

export function recentLogs(limit = 50): GrpLog[] {
  return loadLogs().slice(0, limit);
}

/** 写入一条触发记录（自动去重由调用方 fired 缓存保证，这里只负责落库） */
export function addLog(input: {
  alertId: string;
  title: string;
  members: string[];
  channel: GrpLogChannel;
  status: GrpLogStatus;
  detail?: string;
}): GrpLog {
  const entry: GrpLog = {
    id: uid(),
    alertId: input.alertId,
    title: input.title,
    members: input.members,
    channel: input.channel,
    status: input.status,
    at: Date.now(),
    detail: input.detail
  };
  const list = get<GrpLog[]>(KEY, []);
  list.push(entry);
  set(KEY, list.slice(-MAX_LOGS)); // 只保留最近 MAX_LOGS 条
  return entry;
}

export function clearLogs(): void {
  remove(KEY);
}
