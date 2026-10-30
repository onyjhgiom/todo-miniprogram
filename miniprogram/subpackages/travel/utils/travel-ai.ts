// subpackages/travel/utils/travel-ai.ts
// 旅游清单 AI：结构化「逐日行程生成」，直接喂给创建流程里的可编辑预览。
//
// 接入：云函数 travel 的 aiPlan action（服务端主档案火山方舟 + 内置兜底 Key，冷备智谱 GLM）。
// 密钥只存在于云函数服务端，绝不进入客户端包，也不落本地存储。
//
// ⚠️ 「AI 能不能用」与「云端数据库能不能同步」是两件事（这是历史故障的根因）：
//   旧实现把 AI 开关绑在 store.isCloudSynced() 上，而那个开关的探测要走数据库 list ——
//   只要云开发控制台里没建过 trips / travel_items / travel_notes 三个集合，
//   list 就 -502005 失败、开关恒为 false，界面上永远只有「启用并生成」，点了也没反应。
//   现在改为独立探测云函数的 aiStatus（不碰数据库、不消耗 token），见 store.probeAI。

import { callFn } from '../../../utils/cloud';
import * as store from './travel-store';
import type { TripItemType } from './travel-types';

/** AI 返回的单个行程条目（已归一化） */
export interface AIPlanItem {
  day: number;
  startTime: string;
  content: string;
  type: TripItemType;
  place: string;
  cost: number;
  note: string;
}

export interface AIPlanResult {
  ok: boolean;
  days: number;
  items: AIPlanItem[];
  message?: string;
}

/** 是否已具备调用条件（独立探测结果，与云端同步状态无关） */
export function aiAvailable(): boolean {
  return store.isAICapable();
}

/** 探测 / 启用 AI 能力。纯权限探测（云函数 aiStatus），不消耗 token、不读数据库。 */
export async function enableAI(): Promise<{ ok: boolean; msg: string }> {
  return store.probeAI();
}

/**
 * 智能行程生成：按目的地 / 天数 / 预算 / 同行 / 场景，生成逐日结构化行程。
 * 返回可直接映射为 ITripPlanItem 的条目数组，由创建页渲染成可编辑预览。
 */
export async function generatePlan(input: {
  destination: string;
  days: number;
  budget: number;
  members: string[];
  scenes?: string[];
}): Promise<AIPlanResult> {
  if (!aiAvailable()) return { ok: false, days: input.days, items: [], message: '请先启用 AI 规划' };
  try {
    const res = (await callFn<Record<string, unknown>>('travel', {
      action: 'aiPlan',
      destination: input.destination,
      days: input.days,
      budget: input.budget,
      members: input.members,
      scenes: input.scenes || []
    })) as {
      ok?: boolean;
      days?: number;
      items?: AIPlanItem[];
      message?: string;
    };
    if (res && res.ok && Array.isArray(res.items) && res.items.length) {
      return { ok: true, days: res.days || input.days, items: res.items };
    }
    return { ok: false, days: input.days, items: [], message: res?.message || 'AI 未返回行程' };
  } catch (err) {
    const e = err as { code?: string; message?: string; errMsg?: string };
    const m = `${e?.code || ''} ${e?.message || ''} ${e?.errMsg || ''}`;
    // 超时是最常见的一种：客户端只等 20s，大模型偶发变慢就会命中。
    // 单独给文案，用户才能「减少天数」自救，而不是反复点重试。
    if (e?.code === 'AI_TIMEOUT' || /TIMEOUT|timeout|-404012|polling exceed/i.test(m)) {
      return { ok: false, days: input.days, items: [], message: 'AI 生成较慢，请重试或减少天数' };
    }
    if (/未部署|FUNCTION_NOT_FOUND|FunctionName|未实现函数/.test(m)) {
      return { ok: false, days: input.days, items: [], message: '需先部署 travel 云函数后才能使用 AI 规划' };
    }
    return { ok: false, days: input.days, items: [], message: 'AI 调用失败，请稍后重试' };
  }
}
