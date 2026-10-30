// utils/goal-store.ts
// 「目标拆解」数据层：计划模型 + 结构校验修复 + 本地历史 + 离线兜底拆解。
//
// 设计要点：
//  1. AI 返回的结构一律先过 sanitizePlan()，再交给视图层渲染。即便模型偶发跑偏
//     （数量越界 / offset 乱序 / 缓冲不足），也能修成可用计划，避免整页空白。
//  2. 云端不可用时（未配 AI_API_KEY / 网络异常）走 localFallbackPlan()：
//     用规则生成一份仍然满足 12 条拆解原则的计划，保证功能「永远有输出」。
//  3. 历史记录本地存储（最多 20 条），预留云端。
import { get, set } from './storage';
import type { AddPayload } from './todo-store';

/** 拆解风格 */
export type PlanStyle = 'balanced' | 'aggressive' | 'conservative';
/** 子任务周期 */
export type MilestoneRepeat = 'daily' | 'weekly' | 'none';
/** 子任务分类 */
export type MilestoneCategory = '学习' | '工作' | '健康' | '生活' | '财务' | '其他';
/** 子任务阶段（分配设计） */
export type MilestonePhase = '准备' | '执行' | '收尾';
/** 子任务优先级（分配设计，写入待办时用于排序/高亮） */
export type MilestonePriority = 'high' | 'medium' | 'low';

export interface GoalMilestone {
  title: string;
  /** 阶段：准备（规划取材）/ 执行（核心推进）/ 收尾（检查复盘） */
  phase?: MilestonePhase;
  /** 相对今天的天数，0 = 今天 */
  deadline_offset: number;
  duration_minutes: number;
  repeat: MilestoneRepeat;
  category: MilestoneCategory;
  /** 优先级：high / medium / low（分配用） */
  priority?: MilestonePriority;
  /** 前置依赖任务标题（最多 2 个） */
  depends_on?: string[];
  /** 完成该任务所需的关键资源 / 工具 / 资料 */
  resources?: string;
  tip: string;
}

export interface GoalPlan {
  assumption: string;
  total_days: number;
  milestones: GoalMilestone[];
  first_action: string;
  risk_warning: string | null;
}

export interface GoalRecord {
  id: string;
  goal: string;
  style: PlanStyle;
  dailyMinutes: number;
  deadline: string;
  plan: GoalPlan;
  /** true=AI 生成，false=本地规则兜底 */
  byAI: boolean;
  createTime: number;
}

/** 视图层用的装饰后里程碑（带真实日期与图标） */
export interface DecoratedMilestone extends GoalMilestone {
  /** 稳定的 wx:key（标题可能重复，故拼上序号） */
  key: string;
  /** yyyy-mm-dd */
  date: string;
  /** 月-日，如 09-14 */
  dateShort: string;
  /** 今天 / 明天 / N 天后 */
  dateLabel: string;
  /** 是否已过期（历史记录回看时可能出现） */
  overdue: boolean;
  icon: string;
  repeatLabel: string;
  durationLabel: string;
  /** 阶段中文标签 */
  phaseLabel: string;
  /** 优先级中文标签（高/中/低），无则为空串 */
  priorityLabel: string;
  /** 前置依赖标题拼接（无则为空串） */
  dependsLabel: string;
  /** 资源（无则为空串） */
  resourcesText: string;
}

export const STYLES: { key: PlanStyle; name: string; desc: string }[] = [
  { key: 'balanced', name: '均衡', desc: '任务均匀分布' },
  { key: 'aggressive', name: '激进', desc: '前段多推进' },
  { key: 'conservative', name: '保守', desc: '前段留白多' }
];

export const CATEGORIES: MilestoneCategory[] = ['学习', '工作', '健康', '生活', '财务', '其他'];
export const PHASES: MilestonePhase[] = ['准备', '执行', '收尾'];
export const PRIORITIES: MilestonePriority[] = ['high', 'medium', 'low'];
export const PRIORITY_CN: Record<MilestonePriority, string> = { high: '高', medium: '中', low: '低' };

export const CATEGORY_ICON: Record<string, string> = {
  学习: '📚', 工作: '💼', 健康: '🏃', 生活: '🏠', 财务: '💰', 其他: '🎯'
};

const KEY = 'goal_plans_v1';
const MAX_RECORDS = 20;

/* ============================ 基础工具 ============================ */
export function uid(): string {
  return 'goal_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function clampText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : def;
}

/** 当天 00:00 时间戳 */
export function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).getTime();
}

/** 相对今天的偏移 → 当天 00:00 时间戳 */
export function offsetToTs(offset: number): number {
  return startOfToday() + Math.max(0, offset) * 86400000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 时间戳 → yyyy-mm-dd */
export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ============================ 校验修复 ============================ */
/**
 * 结构级校验 + 修复（与云函数 goalPlanner 的 normalizePlan 保持一致）。
 * 返回 null 表示这份结果不可用（里程碑少于 3 条），调用方应转兜底。
 */
export function sanitizePlan(raw: unknown, dailyMinutes: number, deadlineDays: number | null): GoalPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const list = Array.isArray(src.milestones) ? src.milestones : [];
  const milestones: GoalMilestone[] = [];

  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const title = clampText(o.title, 30);
    if (!title) continue;
    const repeat = o.repeat === 'daily' || o.repeat === 'weekly' ? o.repeat : 'none';
    const category = CATEGORIES.indexOf(o.category as MilestoneCategory) >= 0
      ? (o.category as MilestoneCategory)
      : '其他';
    // 时长：越界值分两档处理——1~720 分钟按上限 720 截断；明显失真（如 99999）
    // 回落为「每天可用时间」，避免页面出现「一个任务 20 小时」这种不可信数据
    let duration = toInt(o.duration_minutes, dailyMinutes);
    if (!Number.isFinite(duration) || duration < 1) duration = 1;
    if (duration > 720) duration = dailyMinutes;
    // 分配字段：缺失/非法时给安全默认，不阻断整条计划
    const phase = PHASES.indexOf(o.phase as MilestonePhase) >= 0 ? (o.phase as MilestonePhase) : '执行';
    const priority = PRIORITIES.indexOf(o.priority as MilestonePriority) >= 0 ? (o.priority as MilestonePriority) : 'medium';
    let depends = '';
    if (Array.isArray(o.depends_on)) {
      depends = (o.depends_on as unknown[])
        .filter((x) => typeof x === 'string' && String(x).trim())
        .map((x) => String(x).trim())
        .slice(0, 2)
        .join('、');
    }
    const resources = clampText(o.resources, 20);
    milestones.push({
      title,
      phase,
      deadline_offset: Math.max(0, toInt(o.deadline_offset, 0)),
      duration_minutes: Math.min(720, duration),
      repeat,
      category,
      priority,
      depends_on: depends ? depends.split('、') : [],
      resources,
      tip: clampText(o.tip, 40)
    });
  }

  if (milestones.length < 3) return null;
  const trimmed = milestones.slice(0, 12);
  trimmed.sort((a, b) => a.deadline_offset - b.deadline_offset);

  let totalDays = toInt(src.total_days, 0);
  if (!totalDays || totalDays < 3) {
    totalDays = deadlineDays && deadlineDays > 2 ? deadlineDays : Math.max(7, trimmed.length * 2 + 2);
  }
  if (deadlineDays !== null && deadlineDays >= 3 && totalDays > deadlineDays) totalDays = deadlineDays;
  totalDays = Math.max(3, Math.min(400, totalDays));

  // 规则 6：末尾任务至少留 2 天缓冲
  const last = trimmed[trimmed.length - 1];
  const maxOffset = Math.max(0, totalDays - 2);
  if (last.deadline_offset > maxOffset) {
    if (deadlineDays === null) {
      totalDays = last.deadline_offset + 2;
    } else {
      const ratio = maxOffset / (last.deadline_offset || 1);
      trimmed.forEach((m) => {
        m.deadline_offset = Math.max(0, Math.round(m.deadline_offset * ratio));
      });
    }
  }

  const risk = src.risk_warning;
  return {
    assumption: clampText(src.assumption, 80),
    total_days: totalDays,
    milestones: trimmed,
    first_action: clampText(src.first_action, 50),
    risk_warning: risk === null || risk === undefined ? null : clampText(risk, 60) || null
  };
}

/* ============================ 渲染装饰 ============================ */
export function decorateMilestones(plan: GoalPlan): DecoratedMilestone[] {
  const today = startOfToday();
  return plan.milestones.map((m, i) => {
    const ts = offsetToTs(m.deadline_offset);
    const diff = Math.round((ts - today) / 86400000);
    return {
      ...m,
      key: `m${i}_${m.title}`,
      date: fmtDate(ts),
      dateShort: fmtDate(ts).slice(5),
      dateLabel: diff <= 0 ? '今天' : diff === 1 ? '明天' : `${diff} 天后`,
      overdue: diff < 0,
      icon: CATEGORY_ICON[m.category] || '🎯',
      repeatLabel: m.repeat === 'daily' ? '每天' : m.repeat === 'weekly' ? '每周' : '',
      durationLabel: m.duration_minutes >= 60
        ? `${Math.floor(m.duration_minutes / 60)}${m.duration_minutes % 60 ? `.${Math.round((m.duration_minutes % 60) / 6)}` : ''} 小时`
        : `${m.duration_minutes} 分钟`,
      phaseLabel: PHASES.indexOf(m.phase as MilestonePhase) >= 0 ? (m.phase as MilestonePhase) : '执行',
      priorityLabel: m.priority ? PRIORITY_CN[m.priority] : '',
      dependsLabel: m.depends_on && m.depends_on.length ? m.depends_on.join('、') : '',
      resourcesText: m.resources || ''
    };
  });
}

/* ============================ 本地兜底拆解 ============================ */
/** 按风格把 n 个任务分配到 [0, span] 天区间内（span = total_days - 2 缓冲） */
function distribute(count: number, span: number, style: PlanStyle): number[] {
  const safeSpan = Math.max(1, span);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const f = count === 1 ? 0 : i / (count - 1);
    let p: number;
    if (style === 'aggressive') {
      // 前 40% 时间完成 60% 任务
      p = f <= 0.6 ? (f / 0.6) * 0.4 : 0.4 + ((f - 0.6) / 0.4) * 0.6;
    } else if (style === 'conservative') {
      // 前 40% 时间只完成 30% 任务
      p = f <= 0.3 ? (f / 0.3) * 0.4 : 0.4 + ((f - 0.3) / 0.7) * 0.6;
    } else {
      p = f;
    }
    out.push(Math.round(p * safeSpan));
  }
  return out;
}

function shortGoal(goal: string, max = 10): string {
  const g = goal.trim().replace(/\s+/g, '');
  return g.length > max ? `${g.slice(0, max)}…` : g;
}

/**
 * 离线兜底：不依赖 AI，按通用目标管理方法论生成 6 步计划。
 * 仍然满足：动词开头、首步 15 分钟内零准备、末尾留 2 天缓冲。
 */
export function localFallbackPlan(
  goal: string,
  style: PlanStyle,
  dailyMinutes: number,
  deadlineDays: number | null
): GoalPlan {
  const g = shortGoal(goal);
  const totalDays = deadlineDays && deadlineDays >= 5 ? deadlineDays : 21;
  const session = Math.max(10, Math.min(dailyMinutes, 120));

  const seeds: Omit<GoalMilestone, 'deadline_offset'>[] = [
    {
      title: `写下「${g}」的完成标准`,
      phase: '准备',
      duration_minutes: 10,
      repeat: 'none',
      category: '其他',
      priority: 'high',
      depends_on: [],
      resources: '',
      tip: '一句话写清：做到什么算完成'
    },
    {
      title: `列出完成它要用的全部材料`,
      phase: '准备',
      duration_minutes: 15,
      repeat: 'none',
      category: '其他',
      priority: 'medium',
      depends_on: [],
      resources: '',
      tip: '工具/资料/人脉，逐条列全'
    },
    {
      title: `固定每天 ${session} 分钟执行时段`,
      phase: '准备',
      duration_minutes: 5,
      repeat: 'daily',
      category: '其他',
      priority: 'medium',
      depends_on: [],
      resources: '手机日历',
      tip: '写进日历，闹钟提前5分钟'
    },
    {
      title: `推进前 30% 的核心动作`,
      phase: '执行',
      duration_minutes: session,
      repeat: 'none',
      category: '其他',
      priority: 'high',
      depends_on: [`写下「${g}」的完成标准`],
      resources: '',
      tip: '先啃最难的那一步'
    },
    {
      title: `中期检查：对照标准看差距`,
      phase: '收尾',
      duration_minutes: 20,
      repeat: 'none',
      category: '其他',
      priority: 'medium',
      depends_on: [`推进前 30% 的核心动作`],
      resources: '',
      tip: '差多少就补多少，别硬扛'
    },
    {
      title: `收尾补齐并写三条复盘`,
      phase: '收尾',
      duration_minutes: 25,
      repeat: 'none',
      category: '其他',
      priority: 'low',
      depends_on: [`中期检查：对照标准看差距`],
      resources: '',
      tip: '记下最有效和最无效的一招'
    }
  ];

  const offsets = distribute(seeds.length, Math.max(1, totalDays - 2), style);
  return {
    assumption: 'AI 未配置或不可用，已按通用目标管理法生成基础拆解',
    total_days: totalDays,
    milestones: seeds.map((s, i) => ({ ...s, deadline_offset: offsets[i] })),
    first_action: `现在花 10 分钟写下「${g}」的完成标准`,
    risk_warning: '这是通用模板，建议接入 AI 后重新拆解'
  };
}

/* ============================ 历史记录 ============================ */
export function loadRecords(): GoalRecord[] {
  const list = get<GoalRecord[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveRecord(rec: GoalRecord): GoalRecord[] {
  const list = loadRecords();
  list.unshift(rec);
  const trimmed = list.slice(0, MAX_RECORDS);
  set(KEY, trimmed);
  return trimmed;
}

export function removeRecord(id: string): GoalRecord[] {
  const list = loadRecords().filter((r) => r.id !== id);
  set(KEY, list);
  return list;
}

export function clearRecords(): void {
  set(KEY, []);
}

/* ============================ 计划 → 待办 ============================ */
/** 把拆解结果转成可直接传给 addTodo 的载荷（截止时间取当天 20:00） */
export function planToAddPayloads(goal: string, plan: GoalPlan): AddPayload[] {
  const tags = ['目标拆解'];
  return plan.milestones.map((m) => {
    // 分配信息进入描述：资源 + 前置依赖，让待办卡片自带上下文
    const parts = [
      `来自目标拆解：${goal}`,
      `阶段：${PHASES.indexOf(m.phase as MilestonePhase) >= 0 ? (m.phase as MilestonePhase) : '执行'}`,
      `执行提示：${m.tip || '无'}`,
      `预计用时：${m.duration_minutes} 分钟`
    ];
    if (m.resources) parts.push(`所需资源：${m.resources}`);
    if (m.depends_on && m.depends_on.length) parts.push(`前置依赖：${m.depends_on.join('、')}`);
    return {
      content: m.title,
      dueDate: offsetToTs(m.deadline_offset) + 20 * 3600 * 1000,
      description: parts.join('\n'),
      tags: tags.concat(m.category),
      priority: (PRIORITIES.indexOf(m.priority as MilestonePriority) >= 0 ? (m.priority as MilestonePriority) : null) as AddPayload['priority'],
      recurrence: m.repeat === 'none' ? null : { type: m.repeat, endDate: null }
    };
  });
}
