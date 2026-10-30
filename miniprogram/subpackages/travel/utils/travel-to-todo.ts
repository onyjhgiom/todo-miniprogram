// subpackages/travel/utils/travel-to-todo.ts
// 把「旅行模式」的某个行程（旅游单）的行程项，同步到首页普通待办清单。
//
// 设计要点：
//   1) 复用主包 todo-store 的 bulkAddTodos（一次 emit('reset')，首页订阅后即时重绘，不刷屏、不逐条 toast）；
//   2) 每条待办带来源标记 tags：['旅行', 'trip:<tripId>', 'tripItem:<itemId>']；
//      - 'trip:' 便于在首页按行程筛选 / 后续批量管理；
//      - 'tripItem:' 用于去重：重复点击「同步到待办」不会生成重复待办；
//   3) 时间映射到 dueDate（出发日 + 第 N 天 + 起始时间），让待办出现在正确的日期下；
//   4) 这是显式的用户操作，不依赖 cloudCapable，本地优先即可落库。

import { bulkAddTodos, list } from '../../../utils/todo-store';
import type { AddPayload } from '../../../utils/todo-store';
import * as store from './travel-store';
import type { ITrip, ITripPlanItem, TripItemType } from './travel-types';

/** 行程项类型 → emoji（与详情页 TYPE_ICON 对齐） */
const TYPE_ICON: Record<TripItemType, string> = {
  交通: '🚆',
  景点: '🎫',
  餐厅: '🍜',
  酒店: '🏨',
  购物: '🛍️',
  自定义: '📌'
};

/** 'yyyy-mm-dd' → 当日 0 点的毫秒时间戳（本地时区） */
function parseYMD(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return Date.now();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

/** 行程项 → 截止时间：出发日 + (第 day 天 - 1) + 起始时间（无时间取 09:00） */
function dueTimeOf(trip: ITrip, item: ITripPlanItem): number {
  const base = parseYMD(trip.startDate) + (item.day - 1) * 86400000;
  const d = new Date(base);
  const [h, mi] = (item.startTime || '09:00').split(':').map((x) => Number(x) || 0);
  d.setHours(h || 9, mi || 0, 0, 0);
  return d.getTime();
}

export interface SyncToTodoResult {
  added: number;
  skipped: number;
  message: string;
}

/**
 * 把指定行程的所有行程项同步为首页待办。
 * @returns 新增条数与提示文案
 */
export async function syncTripToTodos(tripId: string): Promise<SyncToTodoResult> {
  const trip = store.getTrip(tripId);
  if (!trip) return { added: 0, skipped: 0, message: '未找到该行程' };

  const items = store.listItems(tripId);
  if (!items.length) return { added: 0, skipped: 0, message: '该行程还没有行程安排，先去加几条吧' };

  // 已同步过的条目（按 tripItem:<itemId> 标记去重）
  const synced = new Set<string>();
  list().forEach((t) => {
    (t.tags || []).forEach((tag) => {
      if (tag && tag.indexOf('tripItem:') === 0) synced.add(tag);
    });
  });

  const payloads: AddPayload[] = [];
  let skipped = 0;
  for (const it of items) {
    const tag = `tripItem:${it._id}`;
    if (synced.has(tag)) {
      skipped++;
      continue;
    }
    const icon = TYPE_ICON[it.itemType] || '📌';
    const locText = it.location && it.location.name ? ` @${it.location.name}` : '';
    const addrText = it.location && it.location.address ? `\n地址：${it.location.address}` : '';
    const noteText = it.note ? `\n备注：${it.note}` : '';
    payloads.push({
      content: `${icon} ${it.content}${locText}`,
      completed: it.completed,
      dueDate: dueTimeOf(trip, it),
      location: it.location && it.location.name ? it.location.name : null,
      people: trip.members && trip.members.length ? trip.members : undefined,
      priority: it.itemType === '交通' || it.itemType === '酒店' ? 'high' : null,
      tags: ['旅行', `trip:${tripId}`, tag],
      description: `行程「${trip.title}」· 第${it.day}天${noteText}${addrText}`
    });
  }

  if (!payloads.length) {
    return { added: 0, skipped, message: `没有新条目（${skipped} 条已同步过）` };
  }

  const added = await bulkAddTodos(payloads);
  const message = `已同步 ${added} 条到首页待办${skipped ? `（跳过 ${skipped} 条已同步）` : ''}`;
  return { added, skipped, message };
}
