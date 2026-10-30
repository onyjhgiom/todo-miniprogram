// utils/resume-adapt.ts
// 简历「岗位上下文自适应编排」层。
//
// 定位：夹在草稿转换与 canvas 排版之间，只做「取舍与排序」，绝不做措辞改写。
// 为什么改写留给 AI 而不是本地：本地模板化改写容易把「做了 A」说成「主导 A」，
// 属于夸大事实；本地只负责把最相关的经历露出来、把不相关的压短，语义 100% 保持用户原话。
//
// 三件事：
//   1. 模块顺序自适应：应届（教育优先）vs 有工作经验（经历优先）走不同的顺序策略表；
//   2. 详略自适应：按 JD 关键词给每段经历算相关度，相关度高保留 4 条要点，不相关压到 2 条；
//   3. 篇幅可控：总要点数与总字符数软上限，超出时从最不相关的经历开始收缩（保底 1 条）。

import type { ResumeItem, ResumeProfile, ResumeSection } from './resume-doc';
import { sectionDef } from './resume-schema';

/** 岗位上下文：来自用户的求职意向 / 投递 JD，用于决定「突出什么」 */
export interface JobContext {
  /** 目标岗位，如「后端开发」 */
  target: string;
  /** JD 关键词 */
  keywords: string[];
  /** 是否有明确意向（无意向时不做相关性裁剪，避免误伤） */
  has: boolean;
}

export type Seniority = 'fresh' | 'junior' | 'experienced';

/**
 * 顺序策略表（配置驱动，新增模块 / 调整优先级只改这里）：
 *  - fresh（在校应届，实习为主）：教育放最前，学校与专业是主要信号；
 *  - junior（1-3 年，有正式工作）：工作与项目在前，教育退到中段；
 *  - experienced（多年经验）：工作与项目绝对优先，教育最后（学历已不是卖点）。
 */
export const ORDER_STRATEGY: Record<Seniority, string[]> = {
  fresh: ['edu', 'intern', 'proj', 'skill', 'award', 'cert', 'lang', 'custom', 'summary'],
  junior: ['work', 'proj', 'intern', 'edu', 'skill', 'cert', 'award', 'lang', 'custom', 'summary'],
  experienced: ['work', 'proj', 'skill', 'edu', 'cert', 'lang', 'award', 'custom', 'summary']
};

/** 篇幅预算（可按版式收紧：一页纸 classic 用更小的额度） */
export interface Budget {
  /** 相关度「高」的每条经历最多保留几条要点 */
  maxBulletsHigh: number;
  /** 相关度「中」 */
  maxBulletsMid: number;
  /** 相关度「低 / 无」 */
  maxBulletsLow: number;
  /** 全篇要点总数软上限 */
  maxTotalBullets: number;
  /** 全篇正文字符数软上限（超出按相关度从低到高收缩） */
  maxTotalChars: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxBulletsHigh: 4,
  maxBulletsMid: 3,
  maxBulletsLow: 2,
  maxTotalBullets: 22,
  maxTotalChars: 3800
};

/** classic 一页纸：信息密度高但容量小，预算收紧 */
export const CLASSIC_BUDGET: Budget = {
  maxBulletsHigh: 3,
  maxBulletsMid: 2,
  maxBulletsLow: 2,
  maxTotalBullets: 16,
  maxTotalChars: 2600
};

/** minimal 简约一页版：留白多、容量最小，只留最相关的要点 */
export const MINIMAL_BUDGET: Budget = {
  maxBulletsHigh: 3,
  maxBulletsMid: 2,
  maxBulletsLow: 1,
  maxTotalBullets: 14,
  maxTotalChars: 2400
};

/** compact 紧凑多页版：单页容量最大，内容多时页数最少 */
export const COMPACT_BUDGET: Budget = {
  maxBulletsHigh: 5,
  maxBulletsMid: 4,
  maxBulletsLow: 3,
  maxTotalBullets: 30,
  maxTotalChars: 5200
};

/** 版式 → 篇幅预算（版式只影响排版与容量，不影响内容本身） */
export function budgetOfLayout(layout?: string): Budget {
  if (layout === 'classic') return CLASSIC_BUDGET;
  if (layout === 'minimal') return MINIMAL_BUDGET;
  if (layout === 'compact') return COMPACT_BUDGET;
  return DEFAULT_BUDGET;
}

/* ==================== 资历判定 ==================== */

/** 从 meta 里抓年份（2026.03 - 2026.08 / 2023年9月-2027年6月 都认） */
function yearsOf(s: string): number[] {
  const out: number[] = [];
  const re = /(19|20)\d{2}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(s || '')))) {
    const y = Number(m[0]);
    if (y >= 1970 && y <= 2100) out.push(y);
  }
  return out;
}

/**
 * 资历判定：只看结构性事实（有没有全职经历、时间跨度多长），不做能力评价。
 * 判不准时一律按 fresh（保守：应届顺序对任何简历都不会错得离谱）。
 */
export function inferSeniority(p: ResumeProfile): Seniority {
  const sections = p.sections || [];
  const hasWork = sections.some((s) => s.key === 'work' && (s.items || []).length > 0);
  let min = 9999;
  let max = 0;
  let workItems = 0;
  for (const s of sections) {
    if (s.key === 'edu') continue; // 教育年限不算工作经验
    if (s.key === 'work') workItems += (s.items || []).length;
    for (const it of s.items || []) {
      for (const y of yearsOf(it.meta || '')) {
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }
  }
  const span = (max >= min && min < 9999) ? max - min : 0;

  if (hasWork && (span >= 5 || workItems >= 2)) return 'experienced';
  if (hasWork || span >= 3) return 'junior';
  return 'fresh';
}

/* ==================== 相关度打分 ==================== */

/** 单条经历与 JD 关键词的相关度；-1 表示没有岗位上下文（此时不裁剪） */
export function relevanceOf(it: ResumeItem, keywords: string[]): number {
  if (!keywords || !keywords.length) return -1;
  const text = [it.primary, it.secondary, it.meta].concat(it.bullets || []).join(' ').toLowerCase();
  let score = 0;
  for (const k of keywords) {
    const kk = String(k || '').trim().toLowerCase();
    if (kk.length < 2) continue;          // 单词 / 单字太泛，不参与打分
    if (text.indexOf(kk) >= 0) score += kk.length >= 4 ? 2 : 1;
  }
  return score;
}

/** 按相关度决定这条经历保留几条要点 */
function capOf(rel: number, b: Budget): number {
  // 无岗位上下文 → 尊重用户原文，不做相关性裁剪（只由后面的总预算兜底）；
  // 用户写了 5 条就是想要 5 条，凭空削掉一条属于信息损失。
  if (rel < 0) return Number.MAX_SAFE_INTEGER;
  if (rel >= 2) return b.maxBulletsHigh;
  if (rel === 1) return b.maxBulletsMid;
  return b.maxBulletsLow;
}

/* ==================== 篇幅预算 ==================== */

interface Slot {
  secIdx: number;
  itemIdx: number;
  rel: number;
  keep: number;
  total: number;
}

function countChars(p: ResumeProfile): number {
  let n = 0;
  for (const s of p.sections) {
    if (s.text) n += s.text.length;
    for (const it of s.items || []) {
      n += (it.primary || '').length + (it.secondary || '').length + (it.meta || '').length;
      for (const b of it.bullets || []) n += b.length;
    }
  }
  return n;
}

function totalBullets(p: ResumeProfile): number {
  let n = 0;
  for (const s of p.sections) for (const it of s.items || []) n += (it.bullets || []).length;
  return n;
}

/**
 * 篇幅收缩：从「相关度最低 + 保留条数最多」的经历开始逐条减，保底每条 1 条要点。
 * 顺序：先压总条数，再压总字符，两轮都只在超预算时触发。
 */
function shrinkToBudget(sections: ResumeSection[], slots: Slot[], b: Budget, budgetChars: boolean): string[] {
  const notes: string[] = [];
  const apply = () => {
    for (const s of slots) {
      const it = sections[s.secIdx].items![s.itemIdx];
      it.bullets = (it.bullets || []).slice(0, s.keep);
    }
  };

  // 第一轮：总要点数
  apply();
  let guard = 0;
  while (totalBullets({ name: '', headline: '', contacts: [], sections } as ResumeProfile) > b.maxTotalBullets && guard++ < 200) {
    const cand = slots.filter((s) => s.keep > 1).sort((a, x) => (a.rel - x.rel) || (x.keep - a.keep))[0];
    if (!cand) break;
    cand.keep -= 1;
    apply();
  }
  if (guard > 0) notes.push(`要点总数已压到 ${b.maxTotalBullets} 条以内`);

  // 第二轮：总字符数
  if (budgetChars) {
    guard = 0;
    while (countChars({ name: '', headline: '', contacts: [], sections } as ResumeProfile) > b.maxTotalChars && guard++ < 400) {
      const cand = slots.filter((s) => s.keep > 1).sort((a, x) => (a.rel - x.rel) || (x.keep - a.keep))[0];
      if (!cand) break;
      cand.keep -= 1;
      apply();
    }
    if (guard > 0) notes.push('整体篇幅已压缩，保证重点经历完整');
  }
  return notes;
}

/* ==================== 排序 ==================== */

function orderIndex(key: string, seniority: Seniority): number {
  const table = ORDER_STRATEGY[seniority];
  const i = table.indexOf(key);
  if (i >= 0) return i;
  // 未登记进策略表的模块：按注册表基础权重排在已知模块之后，绝不丢
  return 1000 + sectionDef(key).baseWeight;
}

/* ==================== 主演函数 ==================== */

export interface AdaptResult {
  profile: ResumeProfile;
  seniority: Seniority;
  /** 做了哪些自适应调整（可展示给用户，保证过程透明） */
  notes: string[];
}

/**
 * 自适应编排：按岗位与资历重排模块、按相关度取舍要点、控住篇幅。
 * 契约：不新增任何文字，不改写任何措辞，不虚构任何数据；只做排序与截断。
 */
export function adaptProfile(p: ResumeProfile, ctx?: JobContext, budget?: Budget): AdaptResult {
  const notes: string[] = [];
  const b = budget || DEFAULT_BUDGET;
  const seniority = inferSeniority(p);

  // 1) 模块顺序自适应
  const sections = (p.sections || []).slice().sort(
    (a, x) => orderIndex(a.key, seniority) - orderIndex(x.key, seniority)
  );

  // 2) 详略自适应：先算相关度，再决定每条保留几条
  const keywords = (ctx && ctx.has) ? (ctx.keywords || []) : [];
  const slots: Slot[] = [];
  sections.forEach((sec, secIdx) => {
    if (!sec.items) return;
    sec.items.forEach((it, itemIdx) => {
      const rel = relevanceOf(it, keywords);
      const total = (it.bullets || []).length;
      const keep = Math.min(total, capOf(rel, b));
      slots.push({ secIdx, itemIdx, rel, keep, total });
    });
  });
  if (keywords.length) {
    const trimmed = slots.filter((s) => s.keep < s.total).length;
    if (trimmed) notes.push(`已按「${ctx!.target}」相关性裁剪 ${trimmed} 段经历的次要要点`);
  }

  // 3) 篇幅预算（深拷贝 items，避免改动传入对象）
  const shaped: ResumeSection[] = sections.map((s) => ({
    ...s,
    items: s.items ? s.items.map((it) => ({ ...it, bullets: (it.bullets || []).slice() })) : undefined
  }));
  notes.push(...shrinkToBudget(shaped, slots, b, true));

  // 4) 缺失字段的中性兜底：求职意向为空但用户填过意向岗位 → 用「应聘 X」（非虚构，取用户自己的输入）
  let headline = p.headline;
  if (!headline && ctx && ctx.has && ctx.target) {
    headline = /应聘|求职|意向/.test(ctx.target) ? ctx.target : `应聘${ctx.target}`;
    notes.push('求职意向已按你的目标岗位补全（可在上方修改）');
  }

  return {
    profile: {
      ...p,
      headline,
      sections: shaped.map((s) => {
        const out: ResumeSection = { key: s.key, title: s.title };
        if (s.items && s.items.length) out.items = s.items;
        if (s.text) out.text = s.text;
        if (s.images && s.images.length) out.images = s.images;
        return out;
      })
    },
    seniority,
    notes
  };
}
