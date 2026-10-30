// utils/goal-insight.ts
// 「目标拆解」本地智能分析层（纯函数、离线可测）：
//   ① analyzeGoal      —— 从一句话目标里识别 类型 / 周期 / 难度 / 建议频率 / 每日投入
//   ② stagePreview     —— 目标结构预览（4 阶段周区间）
//   ③ feasibilityOf    —— 可行性分析（可执行度 / 目标压力 / 时间匹配 + 建议）
//   ④ recommendStyle   —— 拆解策略推荐 + 判断依据
//
// 设计约束：
//  - 只做「启发式理解」，不联网、不虚构。识别不出的周期明确标 inferred，
//    前端据此展示「按通用节奏估算」，不冒充 AI 结论。
//  - 全部输入容忍脏数据：空串 / 乱码 / 越界数字都不抛错，返回安全值。
import type { PlanStyle } from './goal-store';

/* ============================ 类型 ============================ */

export interface GoalInsight {
  /** 目标类型（学习 / 健康 / 工作 / 生活 / 财务 / 其他） */
  category: string;
  categoryIcon: string;
  /** 预计周期（周） */
  weeks: number;
  /** 周期来源：deadline=用户截止日 parsed=文案里写了 inferred=按类型通用节奏估算 */
  weeksSource: 'deadline' | 'parsed' | 'inferred';
  /** 目标难度 1~5（对应 ★★★★☆） */
  difficulty: number;
  /** 建议执行频率（天 / 周） */
  freqPerWeek: number;
  /** 预计每日投入区间（分钟） */
  dailyMin: number;
  dailyMax: number;
}

export interface StageNode {
  title: string;
  /** 如「第 1~2 周」 */
  weeksLabel: string;
  desc: string;
}

export interface FeasibilityNote {
  level: 'ok' | 'warn';
  text: string;
}

export interface Feasibility {
  /** 可执行程度 0~100 */
  execute: number;
  /** 目标压力 0~100（越高越紧） */
  pressure: number;
  /** 时间匹配 0~100 */
  timeMatch: number;
  notes: FeasibilityNote[];
}

export interface StyleRecommendation {
  key: PlanStyle;
  reasons: string[];
}

export interface ExecMode {
  key: 'daily' | 'weekdays' | 'weekly';
  name: string;
  desc: string;
}

/* ============================ 常量 ============================ */

/** 分类关键词表（顺序即优先级：越靠前越强） */
const CATEGORY_RULES: { key: string; icon: string; words: string[] }[] = [
  {
    key: '工作', icon: '💼',
    words: ['简历', '秋招', '春招', '面试', 'offer', 'Offer', '跳槽', '升职', '加薪', '述职', '汇报', '副业', '作品集', '转正', '绩效', '客户', '项目上线']
  },
  {
    key: '健康', icon: '🏃',
    words: ['减重', '减肥', '瘦', '增肌', '体重', '健身', '锻炼', '运动', '跑步', '马拉松', '游泳', '体脂', '早睡', '戒', '体检']
  },
  {
    key: '财务', icon: '💰',
    words: ['存钱', '存款', '存下', '存够', '攒', '理财', '投资', '记账', '预算', '债务', '还清', '基金', '储蓄']
  },
  {
    key: '学习', icon: '📚',
    words: ['读书', '读完', '阅读', '学', '学习', '考', '复习', '备考', '背', '单词', '英语', '日语', '法语', '课程', '教程', '证书', '刷题', '论文', '钢琴', '编程', '代码', '算法', 'N1', 'N2', '雅思', '托福', '考研', '408']
  },
  {
    key: '生活', icon: '🏠',
    words: ['旅行', '旅游', '搬家', '整理', '断舍离', '习惯', '早起', '冥想', '做饭', '房间', '衣柜', '拍照', '摄影', '日记']
  }
];

const CATEGORY_DEFAULT: { key: string; icon: string } = { key: '其他', icon: '🎯' };

/** 各分类的难度基线与默认周期（周） */
const CATEGORY_BASE: Record<string, { difficulty: number; weeks: number }> = {
  工作: { difficulty: 3, weeks: 6 },
  健康: { difficulty: 3, weeks: 8 },
  学习: { difficulty: 3, weeks: 8 },
  财务: { difficulty: 2, weeks: 12 },
  生活: { difficulty: 2, weeks: 4 },
  其他: { difficulty: 3, weeks: 6 }
};

/** 「这件事本身很难」的关键词 → 难度 +1 */
const HARD_WORDS = ['从零', '入门到精通', '精通', '考研', '考证', '雅思', '托福', 'N1', 'N2', '马拉松', '转行', '竞赛', '专利', '上岸'];

/* ============================ 内部工具 ============================ */

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function countRe(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) {
    if (text.indexOf(w) >= 0) n += 1;
  }
  return n;
}

/** 距离本月末还有几周（用于「月底前」这类表述） */
function weeksToMonthEnd(now?: Date): number {
  const d = now || new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const remaining = end - d.getDate();
  return clamp(Math.max(1, Math.round(remaining / 7)), 1, 8);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/* ============================ ① 目标理解 ============================ */

/** 识别目标类型（导出便于冒烟直测） */
export function detectCategory(text: string): { key: string; icon: string } {
  const t = (text || '').trim();
  if (!t) return { ...CATEGORY_DEFAULT };
  for (const rule of CATEGORY_RULES) {
    if (countRe(t, rule.words) > 0) return { key: rule.key, icon: rule.icon };
  }
  return { ...CATEGORY_DEFAULT };
}

/** 中文数字 → 阿拉伯数字（支持 一~九 / 两 / 十 / 十X / X十 / X十Y） */
function cnNum(s: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (map[s]) return map[s];
  if (s === '十') return 10;
  const m = /^(.+)十(.?)$/.exec(s);
  if (m) {
    const tens = map[m[1]] || 1;
    const ones = m[2] ? (map[m[2]] || 0) : 0;
    return tens * 10 + ones;
  }
  return NaN;
}

/** 从文案 / 截止日推断周期（周）；识别不出返回 null */
export function parseWeeks(text: string, deadlineDays: number | null, now?: Date): { weeks: number; source: 'deadline' | 'parsed' } | null {
  if (deadlineDays !== null && Number.isFinite(deadlineDays) && deadlineDays > 0) {
    return { weeks: clamp(Math.round(deadlineDays / 7), 1, 60), source: 'deadline' };
  }
  const t = (text || '').trim();
  if (!t) return null;

  // 阿拉伯数字（含「个」缓冲：3个月 / 3 个月）
  let m = /(\d{1,3})\s*个?\s*月/.exec(t);
  if (m) return { weeks: clamp(Math.round(Number(m[1]) * 4.33), 1, 60), source: 'parsed' };

  m = /(\d{1,3})\s*个?\s*(?:周|星期)/.exec(t);
  if (m) return { weeks: clamp(Number(m[1]), 1, 60), source: 'parsed' };

  m = /(\d{1,4})\s*天/.exec(t);
  if (m) return { weeks: clamp(Math.ceil(Number(m[1]) / 7), 1, 60), source: 'parsed' };

  m = /(\d)\s*个?\s*年/.exec(t);
  if (m) return { weeks: clamp(Number(m[1]) * 52, 4, 60), source: 'parsed' };

  // 中文数字（两个月 / 一年 / 十周 / 十二个月）；同样排除「X月底」
  m = /([一二两三四五六七八九十]{1,3})\s*个?\s*月(?!底|末)/.exec(t);
  if (m) {
    const n = cnNum(m[1]);
    if (Number.isFinite(n)) return { weeks: clamp(Math.round(n * 4.33), 1, 60), source: 'parsed' };
  }
  m = /([一二两三四五六七八九十]{1,3})\s*个?\s*(?:周|星期)/.exec(t);
  if (m) {
    const n = cnNum(m[1]);
    if (Number.isFinite(n)) return { weeks: clamp(n, 1, 60), source: 'parsed' };
  }
  m = /([一二两三四五六七八九十]{1,3})\s*个?\s*年/.exec(t);
  if (m) {
    const n = cnNum(m[1]);
    if (Number.isFinite(n)) return { weeks: clamp(n * 52, 4, 60), source: 'parsed' };
  }
  m = /([一二两三四五六七八九十]{1,4})\s*天/.exec(t);
  if (m) {
    const n = cnNum(m[1]);
    if (Number.isFinite(n)) return { weeks: clamp(Math.ceil(n / 7), 1, 60), source: 'parsed' };
  }

  if (/月底|月末/.test(t)) return { weeks: weeksToMonthEnd(now), source: 'parsed' };
  if (/年底|年末/.test(t)) {
    const d = now || new Date();
    const end = new Date(d.getFullYear(), 11, 31);
    const days = Math.round((end.getTime() - d.getTime()) / 86400000);
    return { weeks: clamp(Math.max(1, Math.round(days / 7)), 1, 60), source: 'parsed' };
  }
  return null;
}

/**
 * 目标理解主入口。文案少于 4 个有效字符返回 null（不装懂）。
 * @param text 目标文案
 * @param deadlineDays 截止日距今天数（无则 null）
 */
export function analyzeGoal(text: string, deadlineDays: number | null, now?: Date): GoalInsight | null {
  const t = (text || '').trim().replace(/\s+/g, '');
  if (t.length < 4) return null;

  const cat = detectCategory(t);
  const base = CATEGORY_BASE[cat.key] || CATEGORY_BASE['其他'];
  const parsed = parseWeeks(t, deadlineDays, now);
  const weeks = parsed ? parsed.weeks : base.weeks;

  // 难度：分类基线 + 难词 + 短周期惩罚
  let difficulty = base.difficulty;
  if (countRe(t, HARD_WORDS) > 0) difficulty += 1;
  if (/\d+\s*(公斤|kg|斤|页|本|篇|个单词)/.test(t) && cat.key === '学习') difficulty += 0;
  if (weeks <= 2) difficulty += 1;
  if (weeks >= 12) difficulty -= 0;
  difficulty = clamp(difficulty, 1, 5);

  // 建议频率：难度越高越密集，但封顶 6（留恢复日）
  const freqPerWeek = clamp(difficulty + 2, 3, 6);

  // 每日投入：难度 × 周期压缩系数
  const dailyBase = Math.round(40 * (difficulty / 3) * Math.sqrt(8 / weeks));
  const dailyMin = clamp(Math.round(dailyBase / 5) * 5, 15, 120);
  const dailyMax = clamp(Math.round((dailyMin * 1.35) / 5) * 5, dailyMin + 5, 150);

  return {
    category: cat.key,
    categoryIcon: cat.icon,
    weeks,
    weeksSource: parsed ? parsed.source : 'inferred',
    difficulty,
    freqPerWeek,
    dailyMin,
    dailyMax
  };
}

/* ============================ ② 结构预览 ============================ */

/**
 * 目标结构预览：把 weeks 切成 4 个阶段（准备 25% / 执行 40% / 强化 20% / 冲刺 15%）。
 * 不足 4 周时合并为 3 段，避免出现「第 1~0 周」这种区间。
 */
export function stagePreview(weeks: number): StageNode[] {
  const w = clamp(Math.round(weeks) || 1, 1, 60);
  const defs: { title: string; desc: string; ratio: number }[] = [
    { title: '目标准备', desc: '写清完成标准，备齐材料', ratio: 0.25 },
    { title: '核心执行', desc: '推进占比最大的主体任务', ratio: 0.4 },
    { title: '强化提升', desc: '查漏补缺，针对弱项加练', ratio: 0.2 },
    { title: '最终完成', desc: '收尾复盘，交付结果', ratio: 0.15 }
  ];
  const use = w < 4 ? defs.filter((d) => d.title !== '强化提升') : defs;
  // 把比例换算成周数，尾段吸收取整误差
  const raw = use.map((d) => Math.max(1, Math.round(w * d.ratio)));
  let assigned = raw.reduce((s, n) => s + n, 0);
  let i = raw.length - 1;
  while (assigned !== w && i >= 0) {
    const step = assigned > w ? -1 : 1;
    if (raw[i] + step >= 1) {
      raw[i] += step;
      assigned += step;
    }
    if (raw.reduce((s, n) => s + n, 0) === w) break;
    i = i > 0 ? i - 1 : raw.length - 1;
    if (i === 0 && assigned !== w) break;
  }
  let cursor = 1;
  return use.map((d, idx) => {
    const from = cursor;
    const to = cursor + raw[idx] - 1;
    cursor = to + 1;
    return {
      title: d.title,
      weeksLabel: from === to ? `第 ${from} 周` : `第 ${from}~${to} 周`,
      desc: d.desc
    };
  });
}

/* ============================ ③ 可行性分析 ============================ */

/** 执行节奏 → 每周实际执行天数 */
export function execDaysPerWeek(mode: string): number {
  if (mode === 'weekdays') return 5;
  if (mode === 'weekly') return 2;
  return 7;
}

/**
 * 可行性分析。execute/pressure/timeMatch 均为 0~100 整数，
 * notes 最多 3 条，warn 排前面。
 */
export function feasibilityOf(
  insight: GoalInsight,
  dailyMinutes: number,
  execMode: string
): Feasibility {
  const demand = insight.dailyMin * insight.freqPerWeek;
  const capacity = Math.max(15, dailyMinutes) * execDaysPerWeek(execMode);
  const ratio = capacity / Math.max(1, demand);

  // 可执行度：产能富余越多越高
  let execute: number;
  if (ratio >= 1.5) execute = 92;
  else if (ratio >= 1.1) execute = Math.round(80 + (ratio - 1.1) * 30);
  else if (ratio >= 0.75) execute = Math.round(64 + (ratio - 0.75) * 45);
  else execute = Math.round(40 + ratio * 32);
  execute = clamp(execute, 30, 96);

  // 压力：难度高 + 产能不足 → 紧
  const pressure = clamp(
    Math.round(insight.difficulty * 13 + (ratio < 0.9 ? 28 : ratio < 1.3 ? 14 : 4)),
    10,
    95
  );

  // 时间匹配：贴近预计投入为佳；缺口惩罚重于盈余（时间富余好过时间不足）
  const setMin = Math.max(15, dailyMinutes);
  const dev = setMin < insight.dailyMin
    ? (insight.dailyMin - setMin) / Math.max(1, insight.dailyMin)
    : ((setMin - insight.dailyMin) / Math.max(1, insight.dailyMin)) * 0.25;
  const timeMatch = clamp(Math.round(96 - dev * 55), 35, 96);

  const notes: FeasibilityNote[] = [];
  if (insight.weeks <= 2 && insight.difficulty >= 4) {
    notes.push({ level: 'warn', text: '周期偏紧，建议延后截止或降低完成标准' });
  } else {
    notes.push({ level: 'ok', text: '目标周期合理' });
  }
  if (capacity < demand) {
    notes.push({ level: 'warn', text: '时间预算低于预计投入，建议上调每日时间' });
  } else {
    notes.push({ level: 'ok', text: '每日时间基本充足' });
  }
  if (insight.freqPerWeek >= 6 || execMode === 'daily') {
    notes.push({ level: 'warn', text: '建议每周预留 1 天恢复，避免中断弃坑' });
  }

  const warns = notes.filter((n) => n.level === 'warn');
  const oks = notes.filter((n) => n.level === 'ok');
  return { execute, pressure, timeMatch, notes: warns.concat(oks).slice(0, 3) };
}

/* ============================ ④ 策略推荐 ============================ */

/**
 * 策略推荐：短周期 / 高难度 → 激进；长周期 + 低预算 → 保守；其余 → 均衡。
 * reasons 给出可解释的判断依据（展示在「查看为什么」里）。
 */
export function recommendStyle(
  insight: GoalInsight,
  dailyMinutes: number,
  deadlineDays: number | null
): StyleRecommendation {
  const reasons: string[] = [];
  reasons.push(`目标周期：${insight.weeks} 周${insight.weeksSource === 'inferred' ? '（估算）' : ''}`);
  reasons.push(`每日时间：${Math.max(15, dailyMinutes)} 分钟`);
  reasons.push(`目标难度：${'★'.repeat(insight.difficulty)}${'☆'.repeat(5 - insight.difficulty)}`);

  if (insight.weeks <= 4 || insight.difficulty >= 4) {
    reasons.push('周期短或难度高，前段多投入能显著降低烂尾风险');
    reasons.push('预计完成概率：较高（激进节奏下）');
    return { key: 'aggressive', reasons };
  }
  if (insight.weeks >= 8 && dailyMinutes < 45) {
    reasons.push('周期长且每日预算有限，低压力推进更容易坚持');
    reasons.push('预计完成概率：较高（保守节奏下）');
    return { key: 'conservative', reasons };
  }
  reasons.push(deadlineDays !== null ? '设有明确截止日，均匀分布最稳' : '周期与投入均衡，稳定节奏最容易长期执行');
  reasons.push('预计完成概率：较高');
  return { key: 'balanced', reasons };
}

/* ============================ 执行节奏 ============================ */

export const EXEC_MODES: ExecMode[] = [
  { key: 'daily', name: '每天推进', desc: '适合习惯养成类目标' },
  { key: 'weekdays', name: '工作日推进', desc: '周末休息，适合上班族' },
  { key: 'weekly', name: '每周集中', desc: '整块时间，适合大任务' }
];

/* ============================ 视图辅助 ============================ */

/** 难度 → 5 颗星的布尔数组（wxml 用 wx:for 渲染） */
export function difficultyStars(difficulty: number): boolean[] {
  const d = clamp(Math.round(difficulty), 1, 5);
  return [1, 2, 3, 4, 5].map((i) => i <= d);
}

/** 周数 → 中文周期标签（满 4 周的整数倍翻成「N 个月」；inferred 一律带「（估算）」标记） */
export function weeksLabel(weeks: number, source: string): string {
  const w = clamp(Math.round(weeks), 1, 60);
  let base: string;
  if (w >= 8 && w % 4 === 0) base = `${w / 4} 个月`;
  else if (w > 4 && w % 4 >= 2 && w % 4 <= 3) base = `${Math.floor(w / 4)} 个半月`;
  else base = `${w} 周`;
  return source === 'inferred' ? `${base}（估算）` : base;
}

/** 日期 → yyyy年M月d日 */
export function fmtCnDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return '';
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 今天 → yyyy-mm-dd（供页面初始化 minDate / 默认截止日） */
export function todayStr(now?: Date): string {
  const d = now || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
