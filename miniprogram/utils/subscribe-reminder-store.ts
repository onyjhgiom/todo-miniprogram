// utils/subscribe-reminder-store.ts
// 订阅提醒：订阅一份「提醒事项」，在设定的每日/指定星期 的 时刻接收通知（本地定时）。
// 数据存储：本地优先，预留云端订阅消息适配。
// 触发时机：每到订阅时刻(秒内窗口)，若当天属于所选星期则触发，成功后推进到下一天。
//
// 结构：
//   { id, title, note, hour, minute, weekdays:number[] (0=周日…6=周六，空=每天),
//     method, enabled, lastFireKey, createTime }
import { get, set, remove } from './storage';
import { registerChecker, type DueItem } from './alert-scheduler';
import type { CloudResult } from '../types/index';

export interface SubReminder {
  id: string;
  title: string;
  note: string;
  /** 触发时（当天）的小时 */
  hour: number;
  minute: number;
  /** 空数组 = 每天；否则为命中的星期，0=周日 */
  weekdays: number[];
  method: 'toast' | 'modal';
  enabled: boolean;
  /** 分类键（life/health/work，空=生活，详见 SUB_CATEGORIES） */
  cat?: SubCategoryKey;
  /** 上次触发标记 'yyyy-mm-dd_hh:mm'，用于跨天去重 */
  lastFireKey: string;
  createTime: number;
  updateTime: number;
}

/** 订阅分类键 */
export type SubCategoryKey = 'life' | 'health' | 'work';

export interface SubCategoryDef {
  key: SubCategoryKey;
  label: string;
  icon: string;
}

/** 三大分类（对应设计稿筛选条：日常生活 / 健康养生 / 工作学习） */
export const SUB_CATEGORIES: SubCategoryDef[] = [
  { key: 'life', label: '日常生活', icon: '☕' },
  { key: 'health', label: '健康养生', icon: '♡' },
  { key: 'work', label: '工作学习', icon: '▣' }
];

export function subCategoryOf(key?: string): SubCategoryDef {
  return SUB_CATEGORIES.find((c) => c.key === key) || SUB_CATEGORIES[0];
}

/** 热门推荐模板（设计稿「✦ 热门推荐」四宫格 + 弹层模板卡） */
export interface SubTemplateDef {
  key: string;
  icon: string;
  title: string;
  desc: string;
  cat: SubCategoryKey;
  /** 推荐色调（卡片圆形底色） */
  tint: string;
  hour: number;
  minute: number;
  /** 空=每天；否则指定星期 */
  weekdays: number[];
}

export const SUB_TEMPLATES: SubTemplateDef[] = [
  { key: 'water', icon: '💧', title: '喝水提醒', desc: '每天 8 杯水', cat: 'health', tint: '#EEF5FF', hour: 9, minute: 0, weekdays: [] },
  { key: 'medicine', icon: '💊', title: '吃药提醒', desc: '按时用药', cat: 'health', tint: '#FFF0F0', hour: 8, minute: 30, weekdays: [] },
  { key: 'sport', icon: '🏃', title: '运动提醒', desc: '健康生活', cat: 'health', tint: '#EAF7EF', hour: 19, minute: 0, weekdays: [1, 3, 5] },
  { key: 'review', icon: '📖', title: '每日复盘', desc: '总结提升', cat: 'work', tint: '#F0EDFF', hour: 22, minute: 0, weekdays: [] },
  { key: 'study', icon: '📚', title: '学习提醒', desc: '专注学习与复盘', cat: 'work', tint: '#F0EDFF', hour: 20, minute: 0, weekdays: [1, 2, 3, 4, 5] },
  { key: 'custom', icon: '✦', title: '自定义', desc: '设置自己的周期', cat: 'life', tint: '#FFF6E8', hour: 9, minute: 0, weekdays: [] },
  { key: 'breakfast', icon: '🍳', title: '早餐提醒', desc: '好好吃早餐', cat: 'life', tint: '#EEF5FF', hour: 8, minute: 0, weekdays: [] },
  { key: 'sleep', icon: '🌙', title: '早睡提醒', desc: '规律作息', cat: 'life', tint: '#F0EDFF', hour: 23, minute: 0, weekdays: [] }
];

/** 首页「热门推荐」只展示前四条 */
export const SUB_RECOMMEND = SUB_TEMPLATES.slice(0, 4);

const KEY = 'sub_reminders_v1';
const WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

export function uid(): string {
  return 'sr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export function loadSubs(): SubReminder[] {
  const list = get<SubReminder[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}
export function saveSubs(list: SubReminder[]): void {
  set(KEY, list);
}
export function addSub(s: SubReminder): SubReminder[] {
  const list = loadSubs();
  list.unshift(s);
  saveSubs(list);
  return list;
}
export function updateSub(id: string, patch: Partial<SubReminder>): SubReminder[] {
  const list = loadSubs().map((s) => (s.id === id ? { ...s, ...patch, updateTime: Date.now() } : s));
  saveSubs(list);
  return list;
}
export function removeSub(id: string): SubReminder[] {
  const list = loadSubs().filter((s) => s.id !== id);
  saveSubs(list);
  return list;
}
export function clearSubs(): void {
  remove(KEY);
}

/** 星期展示：['日','一',...] */
export function weekdayLabel(wd: number[]): string {
  if (!wd || wd.length === 0) return '每天';
  const ordered = [1, 2, 3, 4, 5, 6, 0]; // 周一…周日 排序展示
  const sorted = wd.slice().sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b));
  return sorted.map((d) => '周' + WEEK_LABEL[d]).join(' ');
}

/** 该提醒在给定日期(星期 d)是否命中 */
function hitsOn(s: SubReminder, weekday: number): boolean {
  return !s.weekdays || s.weekdays.length === 0 || s.weekdays.indexOf(weekday) >= 0;
}

function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 供调度器收集到点订阅项 */
export function collectDue(): DueItem[] {
  const now = Date.now();
  const d = new Date(now);
  const wd = d.getDay();
  const fireKey = `${dayKeyOf(now)}_${d.getHours()}_${d.getMinutes()}`;
  const due: DueItem[] = [];
  let changed = false;

  const list = loadSubs().map((s) => {
    if (!s.enabled) return s;
    // 命中当天的触发分钟（允许调度粒度误差：now 分钟 == s.minute）
    if (d.getHours() === s.hour && d.getMinutes() === s.minute && hitsOn(s, wd)) {
      if (s.lastFireKey !== fireKey) {
        due.push({
          key: `${s.id}_${fireKey}`,
          title: s.title || '订阅提醒',
          desc: s.note || '到点了，记得查看~',
          method: s.method
        });
        changed = true;
        return { ...s, lastFireKey: fireKey, updateTime: now };
      }
    }
    return s;
  });
  if (changed) saveSubs(list);
  return due;
}

/** 注册到全局调度器（幂等） */
export function ensureRegistered(): void {
  registerChecker('sub', () => collectDue());
}

/** 云端订阅消息适配预留（未填模板ID时静默成功，仅本地） */
export async function syncSubscription(s: SubReminder): Promise<CloudResult> {
  void s;
  return { success: true };
}
