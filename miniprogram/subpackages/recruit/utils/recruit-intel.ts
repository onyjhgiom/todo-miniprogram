// utils/recruit-intel.ts
// 秋招助手「智能分析层」：把用户真实输入（简历 / JD / 投递状态 / 面试安排 / 岗位库关注）
// 变成**结构化结论 + 可执行的下一步**，并让各模块共用同一份上下文。
//
// 为什么单独抽这一层（而不是各页面各写各的）：
//   升级前「简历」「投递」「岗位库」「资源库」「看板」各自读各自的数据，
//   于是出现了典型的信息孤岛：简历填了目标岗位，岗位库不知道；投递里存了 JD 关键词，
//   资源库推荐时不知道；看板只会报数字，说不出「所以现在该干嘛」。
//   这一层统一提供「求职意向 → 简历诊断 → 岗位匹配 → 下一步 → 面试提纲 → 看板结论」，
//   页面只负责展示与跳转，规则集中在一处可测。
//
// 设计原则：
//   1) **全部本地确定性计算，不依赖云端**。秋招场景里「点了没反应」比「结论不够聪明」更致命，
//      而云端链路在云函数未部署 / 超 20s 客户端超时时会静默失败（本项目已踩过）。
//      AI 仍然是可选增强（简历页的「AI 补充润色」），但结论层永远可用。
//   2) **每条结论都要能落到动作**：评分一定伴随「补哪一条、去哪补」，不做纯展示。
//   3) **缺输入就追问**（buildDrill 的 missing / diagnoseResume 的 nextActions），
//      而不是给一个看似完整实则空泛的结果。

import { get, set } from '../../../utils/storage';
import {
  loadApps, readiness, ensureInterviews, nextInterview, dueInfo, statusLabel,
  extractKeywords, uid
} from './recruit-store';
import { loadOpenings, statusOf, dueText, daysLeft } from './recruit-openings';
import type { JobOpening, OpeningStatus } from './recruit-openings';
import type { ResumeProfile, ResumeSection, ResumeImage, ResumeLayout } from './resume-doc';
import { extractJobKeywords } from './resume-smart';
// 容错层：多来源 key 归一、文本清洗（去项目符号 / 折叠空白 / 拆联系方式）
// 注意这里**不删占位符**：诊断要靠它发现「模板痕迹还没替换」，删减只在生成 PDF 前做。
import {
  cleanBullets, cleanContacts, cleanText, fallbackTitle, normalizeSectionKey, sectionDef
} from './resume-schema';
import type { IApplication } from '../../../types/index';

/* ==================== 1. 简历草稿：单一真相源 ====================
 * 简历草稿此前只在 resume.ts 内部读写（页面私有 STORE_KEY），
 * 导致「简历诊断 / 岗位匹配」这类需要读简历的地方拿不到数据，只能各存一份 → 两边不一致。
 * 这里把读写收口，页面与其它模块共用同一份。 */

export const RESUME_STORE_KEY = 'recruit_resume';

/** 表单里的条目：bullets 用多行文本编辑，生成时按换行拆分 */
export interface EditItem {
  primary: string;
  secondary: string;
  meta: string;
  bullets: string;
}
export interface EditSection {
  key: string;
  title: string;
  items: EditItem[];
  /** 模块图片：证书 / 作品 / 截图（渲染为统一方形网格插入本模块） */
  images?: ResumeImage[];
}
export interface ResumeDraft {
  name: string;
  headline: string;
  contacts: string;
  skills: string;
  summary: string;
  salary: string;
  city: string;
  sections: EditSection[];
  /** 证件照（可选） */
  photo?: ResumeImage | null;
  /** 简历语言：zh=中文（默认、列表第一位）/ en=English，控制 AI 润色输出语言 */
  lang?: 'zh' | 'en';
  /** PDF 版式（样式层，与内容解耦）：sectioned=雅致分节版（默认）/ classic / minimal / compact */
  layout?: ResumeLayout;
  /** PDF 配色主题下标（样式层，默认 0=经典蓝） */
  themeIdx?: number;
  /** 目标岗位（匹配用）：为空时自动取求职意向 / 最近投递岗位 */
  jobTarget?: string;
  /** 目标岗位 JD 原文（可选）：粘进来后自动抽关键词做匹配与重排 */
  jdText?: string;
}

export function emptyItem(): EditItem {
  return { primary: '', secondary: '', meta: '', bullets: '' };
}

export function defaultSections(): EditSection[] {
  return [
    { key: 'edu', title: '教育背景', items: [emptyItem()], images: [] },
    { key: 'intern', title: '实习经历', items: [emptyItem()], images: [] },
    { key: 'proj', title: '项目经历', items: [], images: [] }
  ];
}

export function defaultResumeDraft(): ResumeDraft {
  return {
    name: '', headline: '', contacts: '', skills: '', summary: '',
    salary: '', city: '', sections: defaultSections(), photo: null, lang: 'zh', layout: 'sectioned',
    themeIdx: 0, jobTarget: '', jdText: ''
  };
}

/** 合法版式列表：新增版式只改 resume-doc 的注册表 + 这里，不用动页面 */
const VALID_LAYOUTS: ResumeLayout[] = ['sectioned', 'classic', 'minimal', 'compact'];

/**
 * 经历区块确定性排序：教育背景 → 实习 → 项目 → 其它自定义区块。
 * AI 润色返回的 sections 顺序不可信（曾出现把英文/技能段排到最前面），
 * 回填表单前必须过这一道，保证任何来源的简历结构稳定可控。
 */
export function sortSectionsCanonical(sections: EditSection[]): EditSection[] {
  // 权重取自注册表：新增模块（证书 / 语言 / 全职…）自动纳入排序，不用再改这个函数
  const weight = (key: string): number => sectionDef(normalizeSectionKey(key)).baseWeight;
  return (sections || []).slice().sort((a, b) => weight(a.key) - weight(b.key));
}

export function loadResumeDraft(): ResumeDraft {
  const s = get<ResumeDraft | null>(RESUME_STORE_KEY, null);
  if (!s || typeof s !== 'object') return defaultResumeDraft();
  return {
    name: s.name || '',
    headline: s.headline || '',
    contacts: s.contacts || '',
    skills: s.skills || '',
    summary: s.summary || '',
    salary: s.salary || '',
    city: s.city || '',
    sections: (s.sections && s.sections.length) ? s.sections.map((sec) => ({
      ...sec,
      images: (sec.images && sec.images.length) ? sec.images : []
    })) : defaultSections(),
    photo: (s.photo && s.photo.path) ? s.photo : null,
    lang: s.lang === 'en' ? 'en' : 'zh',
    layout: VALID_LAYOUTS.indexOf(s.layout as ResumeLayout) >= 0 ? (s.layout as ResumeLayout) : 'sectioned',
    // 配色 / 目标岗位 / JD：样式与匹配上下文一并持久化，重进页面不回到默认值
    themeIdx: typeof s.themeIdx === 'number' && s.themeIdx >= 0 ? s.themeIdx : 0,
    jobTarget: s.jobTarget || '',
    jdText: s.jdText || ''
  };
}

export function saveResumeDraft(d: ResumeDraft): void {
  set<ResumeDraft>(RESUME_STORE_KEY, d);
}

/** 草稿 → 渲染用文档模型（原 resume.ts 的 toProfile，搬过来供全模块复用） */
export function draftToProfile(d: ResumeDraft): ResumeProfile {
  const sections: ResumeSection[] = [];
  for (const sec of d.sections || []) {
    // key 走注册表归一：AI 回填的 education / 用户自填的「学历」都能落到标准 edu，
    // 认不出的保留为 custom 并保留用户原标题，绝不丢模块。
    const key = normalizeSectionKey(sec.key, sec.title);
    const items = (sec.items || [])
      .filter((it) => (it.primary || '').trim() || (it.secondary || '').trim() || (it.meta || '').trim() || (it.bullets || '').trim())
      .map((it) => ({
        primary: cleanText(it.primary || ''),
        secondary: cleanText(it.secondary || ''),
        meta: cleanText(it.meta || ''),
        bullets: cleanBullets(it.bullets || '')
      }))
      .filter((it) => it.primary || it.secondary || it.meta || it.bullets.length);
    const imgs = (sec.images || []).filter((x) => x && x.path).map((x) => ({ id: x.id, path: x.path, caption: x.caption }));
    const title = fallbackTitle(key, sec.title);
    if (items.length) sections.push({ key, title, items, images: imgs });
    else if (imgs.length) sections.push({ key, title, images: imgs });
  }
  // 技能 / 自我评价：标题与 key 一律取自注册表，新增同类模块只改注册表一处
  const skillDef = sectionDef('skill');
  const sumDef = sectionDef('summary');
  if ((d.skills || '').trim()) sections.push({ key: skillDef.key, title: skillDef.title, text: cleanText(d.skills) });
  if ((d.summary || '').trim()) sections.push({ key: sumDef.key, title: sumDef.title, text: cleanText(d.summary) });

  return {
    name: cleanText(d.name || ''),
    headline: cleanText(d.headline || ''),
    expectedSalary: cleanText(d.salary || ''),
    expectedCity: cleanText(d.city || ''),
    contacts: cleanContacts(d.contacts || ''),
    sections,
    photo: (d.photo && d.photo.path) ? d.photo.path : undefined
  };
}

/** 简历全文（小写），供关键词匹配使用 */
export function resumeText(p: ResumeProfile): string {
  const parts: string[] = [p.name, p.headline, p.expectedCity || ''];
  (p.sections || []).forEach((s) => {
    if (s.text) parts.push(s.text);
    (s.items || []).forEach((it) => {
      parts.push(it.primary || '', it.secondary || '', it.meta || '');
      (it.bullets || []).forEach((b) => parts.push(b));
    });
  });
  return parts.join(' ').toLowerCase();
}

/* ==================== 2. 求职意向：打通简历与投递 ==================== */

export interface JobGoal {
  /** 目标岗位，如「后端开发」 */
  target: string;
  city: string;
  salary: string;
  /** 与目标相关的技能关键词（简历技能 + 最近投递的 JD 关键词并集） */
  keywords: string[];
  /** 来源说明，让用户知道这个「目标」是猜的还是自己填的 */
  source: string;
  /** 是否有明确意向（无意向时匹配度分析要提示先填） */
  has: boolean;
}

/**
 * 当前求职意向。
 * 优先级：简历「求职意向」字段 > 最近投递岗位的职位名。
 * 之所以允许「猜」：很多用户从不填求职意向，但投了 20 家后端 —— 那他的目标就是后端。
 * 猜出来的会在 source 里写明，UI 上提示「点这里改成你的真实意向」。
 */
export function currentGoal(apps?: IApplication[]): JobGoal {
  const draft = loadResumeDraft();
  const list = apps || loadApps();
  const recent = list.slice().sort((a, b) => b.updateTime - a.updateTime);

  let target = (draft.headline || '').trim();
  let source = '来自简历「求职意向」';
  if (!target && recent.length > 0) {
    target = (recent[0].position || '').trim();
    source = `来自最近投递的「${recent[0].company || '未命名公司'}」岗位`;
  }
  const city = (draft.city || '').trim() || (recent[0] ? (recent[0].base || '').trim() : '');
  const salary = (draft.salary || '').trim();

  // 关键词：简历技能拆词 + 最近 5 个投递的 JD 关键词（去重，最多 20 个）
  const kw: string[] = [];
  const push = (s: string) => {
    const v = (s || '').trim();
    if (v && kw.indexOf(v) < 0) kw.push(v);
  };
  (draft.skills || '').split(/[\n,，、·|/]/).forEach(push);
  recent.slice(0, 5).forEach((a) => ((a.prep && a.prep.jdKeywords) || []).forEach(push));

  return {
    target,
    city,
    salary,
    keywords: kw.slice(0, 20),
    source: target ? source : '未设置（填写简历的「求职意向」后推荐会更准）',
    has: !!target
  };
}

/**
 * 智能匹配用的岗位上下文（给 resume-smart 用）。
 * 与 currentGoal 的区别：currentGoal 的关键词混入了「用户自己的技能」，适合做推荐；
 * 这里只认「岗位要求」——JD 原文抽词 > 投递卡里的 JD 关键词，避免自己匹配自己导致覆盖率虚高。
 */
export function smartJobOf(apps?: IApplication[]): { target: string; keywords: string[] } {
  const draft = loadResumeDraft();
  const list = apps || loadApps();
  const recent = list.slice().sort((a, b) => b.updateTime - a.updateTime);

  const target =
    (draft.jobTarget || '').trim() ||
    (draft.headline || '').trim() ||
    (recent[0] ? recent[0].position || '' : '').trim();

  // 1) 用户粘贴的 JD 原文（最贴近真实要求）
  const fromJd = extractJobKeywords([draft.jdText || '', draft.jobTarget || ''].join(' '), 24);
  // 2) 最近投递卡里已提取的 JD 关键词（没有 JD 原文时的兜底）
  const fromApps: string[] = [];
  recent.slice(0, 5).forEach((a) => {
    ((a.prep && a.prep.jdKeywords) || []).forEach((w) => {
      const v = String(w || '').trim();
      if (v && fromApps.indexOf(v) < 0) fromApps.push(v);
    });
  });

  const keywords: string[] = [];
  fromJd.concat(fromApps).forEach((w) => {
    if (w && keywords.indexOf(w) < 0) keywords.push(w);
  });
  return { target, keywords: keywords.slice(0, 24) };
}

/* ==================== 3. 简历诊断 ==================== */

export interface ResumeCheck {
  key: string;
  label: string;
  ok: boolean;
  /** 该项分值（总分 40 的结构分 + 60 的内容分） */
  weight: number;
  fix: string;
}

export interface ResumeIssue {
  level: 'high' | 'mid' | 'low';
  title: string;
  detail: string;
  /** 明确的改法，而不是「建议优化」这种废话 */
  fix: string;
}

export interface ResumeDiag {
  /** 0-100 */
  score: number;
  level: string;
  levelKey: 'good' | 'ok' | 'warn' | 'bad';
  /** 结构完整度检查表（一眼看出缺哪块） */
  checks: ResumeCheck[];
  /** 量化指标（经历段数 / 要点数 / 量化率 …） */
  metrics: { label: string; value: string; good: boolean }[];
  strengths: string[];
  issues: ResumeIssue[];
  /** 按优先级排好的下一步 */
  nextActions: string[];
  /** 简历是否基本为空（空的时候不该报一堆问题吓人） */
  empty: boolean;
}

const ACTION_VERBS = ['负责', '主导', '参与', '搭建', '设计', '开发', '实现', '优化', '推动', '完成', '负责了', '重构', '梳理', '输出', '落地', '跟进', '分析', '提升', '降低', '增长'];

function hasNumber(s: string): boolean {
  return /[0-9]|[０-９]|%|％|倍|万|k\+|K\+/.test(s);
}

function startsWithVerb(s: string): boolean {
  const t = (s || '').trim();
  return ACTION_VERBS.some((v) => t.indexOf(v) === 0);
}

function flattenBullets(p: ResumeProfile): string[] {
  const out: string[] = [];
  (p.sections || []).forEach((s) => (s.items || []).forEach((it) => (it.bullets || []).forEach((b) => out.push(b))));
  return out;
}

function expSections(p: ResumeProfile): ResumeSection[] {
  return (p.sections || []).filter((s) => s.key === 'intern' || s.key === 'proj');
}

/**
 * 简历诊断：结构 40 分 + 内容 60 分。
 * 打分不是目的，**每条扣分都要对应一条「怎么补」**，否则用户看完只知道「我简历 52 分」。
 */
export function diagnoseResume(p?: ResumeProfile): ResumeDiag {
  const profile = p || draftToProfile(loadResumeDraft());
  const checks: ResumeCheck[] = [];
  const issues: ResumeIssue[] = [];
  const strengths: string[] = [];
  let score = 0;

  const bullets = flattenBullets(profile);
  const exps = expSections(profile);
  const expItems = exps.reduce((n, s) => n + (s.items || []).length, 0);
  const skillText = ((profile.sections || []).find((s) => s.key === 'skill') || {}).text || '';
  const skillCount = skillText.split(/[\n,，、·|/]/).map((s) => s.trim()).filter(Boolean).length;
  const contacts = profile.contacts || [];
  const hasPhone = contacts.some((c) => /1[3-9]\d{9}/.test(c.replace(/[^0-9]/g, '')));
  const hasMail = contacts.some((c) => c.indexOf('@') >= 0);

  const pushCheck = (key: string, label: string, ok: boolean, weight: number, fix: string) => {
    checks.push({ key, label, ok, weight, fix });
    if (ok) score += weight;
    else if (fix) issues.push({ level: weight >= 8 ? 'high' : weight >= 5 ? 'mid' : 'low', title: `缺${label}`, detail: '这一项是 HR 先看的地方', fix });
  };

  // —— 结构 40 分 ——
  pushCheck('name', '姓名', !!profile.name.trim(), 4, '填写姓名（PDF 与投递都要用）');
  pushCheck('headline', '求职意向', !!profile.headline.trim(), 6,
    '填写求职意向（如「后端开发」）—— 它决定岗位匹配度与推荐的准度');
  pushCheck('contact', '手机 + 邮箱', hasPhone && hasMail, 8,
    `联系方式至少要有手机号和邮箱，当前${hasPhone ? '有手机号' : '缺手机号'}、${hasMail ? '有邮箱' : '缺邮箱'}`);
  pushCheck('edu', '教育背景', (profile.sections || []).some((s) => s.key === 'edu' && (s.items || []).length > 0), 6,
    '补一段教育背景（学校 / 专业 / 时间 / 学历）');
  pushCheck('exp', '实习或项目经历', expItems > 0, 8,
    '至少写一段实习或项目经历；没有实习就写课程项目 / 比赛 / 开源');
  pushCheck('skill', '技能关键词', skillCount >= 5, 4,
    `技能拆成 5~8 个关键词（如 Java、MySQL、Redis），当前 ${skillCount} 个`);
  pushCheck('summary', '自我评价', !!((profile.sections || []).find((s) => s.key === 'summary') || {}).text, 2,
    '补 2~3 句自我评价：岗位匹配点 + 一个量化成绩');

  // —— 内容 60 分 ——
  // (a) 量化率 20：带数字的要点占比（秋招简历最硬的一条）
  let quantScore = 0;
  if (bullets.length > 0) {
    const hit = bullets.filter(hasNumber).length;
    const rate = hit / bullets.length;
    quantScore = Math.round(rate * 20);
    score += quantScore;
    if (rate >= 0.5) strengths.push(`${Math.round(rate * 100)}% 的要点带数字，结果说得清`);
    else {
      issues.push({
        level: 'high',
        title: '要点缺少量化结果',
        detail: `${bullets.length} 条要点里只有 ${hit} 条带数字（${Math.round(rate * 100)}%）`,
        fix: '把「提升了系统性能」改成「接口 P95 从 800ms 降到 220ms，日活 3 万下无超时」这类写法'
      });
    }
  } else {
    issues.push({
      level: 'high', title: '经历里没有要点', detail: 'bullets 为空，简历只剩标题',
      fix: '每段经历写 2~4 条要点，按「动作 + 对象 + 结果」写'
    });
  }

  // (b) 要点密度 15：每段经历 2~4 条要点最舒服
  let densityScore = 0;
  if (expItems > 0) {
    let good = 0;
    exps.forEach((s) => (s.items || []).forEach((it) => {
      const n = (it.bullets || []).length;
      if (n >= 2 && n <= 4) good += 1;
    }));
    densityScore = Math.round((good / expItems) * 15);
    score += densityScore;
    if (good === expItems && expItems > 0) strengths.push(`${expItems} 段经历的要点数量都在 2~4 条，密度合适`);
    else {
      issues.push({
        level: 'mid', title: '部分经历要点过少或过杂',
        detail: `${expItems} 段经历里只有 ${good} 段的要点数在 2~4 条`,
        fix: '每段经历固定 2~4 条：一条讲做了什么、一条讲难点、一条讲结果'
      });
    }
  }

  // (c) 动词开头 15：HR 扫简历只看开头几个字
  let verbScore = 0;
  if (bullets.length > 0) {
    const v = bullets.filter(startsWithVerb).length;
    verbScore = Math.round((v / bullets.length) * 15);
    score += verbScore;
    if (v / bullets.length >= 0.6) strengths.push('要点多用动词开头，扫读友好');
    else {
      issues.push({
        level: 'mid', title: '要点不是动词开头',
        detail: `${bullets.length} 条要点里 ${v} 条以动词开头`,
        fix: '把「参与了 XX 项目」改成「主导 XX 模块重构，覆盖 12 个接口」'
      });
    }
  }

  // (d) 篇幅 10：一页纸原则
  const totalChars = resumeText(profile).replace(/\s/g, '').length;
  let lenScore = 10;
  if (totalChars === 0) lenScore = 0;
  else if (totalChars < 200) lenScore = 4;
  else if (totalChars > 1400) lenScore = 6;
  score += lenScore;
  if (totalChars > 1400) {
    issues.push({
      level: 'low', title: '内容偏长', detail: `全文约 ${totalChars} 字，超过一页纸`,
      fix: '删掉与岗位无关的经历，或把 3 条以上要点压到 2 条'
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const levelKey: ResumeDiag['levelKey'] = score >= 85 ? 'good' : score >= 65 ? 'ok' : score >= 40 ? 'warn' : 'bad';
  const LEVEL = { good: '可以直接投', ok: '基本合格', warn: '还需补强', bad: '需要重写' };

  const quantRate = bullets.length > 0
    ? Math.round((bullets.filter(hasNumber).length / bullets.length) * 100) : 0;
  const avgLen = bullets.length > 0
    ? Math.round(bullets.reduce((n, b) => n + b.length, 0) / bullets.length) : 0;

  const metrics: ResumeDiag['metrics'] = [
    { label: '经历段数', value: `${expItems} 段`, good: expItems >= 2 },
    { label: '要点条数', value: `${bullets.length} 条`, good: bullets.length >= 6 },
    { label: '量化率', value: `${quantRate}%`, good: quantRate >= 50 },
    { label: '要点均长', value: `${avgLen} 字`, good: avgLen >= 15 && avgLen <= 60 },
    { label: '技能关键词', value: `${skillCount} 个`, good: skillCount >= 5 },
    { label: '全文篇幅', value: `${totalChars} 字`, good: totalChars >= 200 && totalChars <= 1400 }
  ];

  // 下一步：按「影响最大」排序，最多 5 条
  const nextActions: string[] = [];
  issues
    .slice()
    .sort((a, b) => (a.level === 'high' ? -1 : a.level === 'mid' ? 0 : 1) - (b.level === 'high' ? -1 : b.level === 'mid' ? 0 : 1))
    .slice(0, 5)
    .forEach((i) => nextActions.push(i.fix));
  if (nextActions.length === 0) nextActions.push('结构完整、量化到位：去「岗位匹配」看看与目标 JD 的差距');

  return {
    score,
    level: LEVEL[levelKey],
    levelKey,
    checks,
    metrics,
    strengths,
    issues,
    nextActions,
    empty: totalChars === 0
  };
}

/* ==================== 4. 简历 × 岗位匹配 ==================== */

export interface MatchGap {
  kw: string;
  /** 建议补在哪一段 */
  where: string;
  advice: string;
}

export interface MatchResult {
  score: number;
  level: string;
  levelKey: 'good' | 'ok' | 'warn' | 'bad';
  /** JD 关键词命中数 / 总数 */
  hitCount: number;
  totalCount: number;
  hit: string[];
  miss: string[];
  strengths: string[];
  gaps: MatchGap[];
  actions: string[];
  /** 输入不足的原因（没 JD / 没简历），UI 据此引导补充 */
  missing: string[];
}

/**
 * 简历 vs 某条投递的 JD。
 * 只看两件事：JD 关键词有多少能在简历里找到（覆盖度），以及岗位名与简历是否同源。
 * 覆盖度占 70，岗位名相关占 30 —— 全是关键词命中但岗位完全不对（投产品却写着后端）会明显掉分。
 */
export function matchResumeToJob(app: IApplication, p?: ResumeProfile): MatchResult {
  const profile = p || draftToProfile(loadResumeDraft());
  const text = resumeText(profile);
  const missing: string[] = [];

  let kws = (app.prep && app.prep.jdKeywords) || [];
  if (kws.length === 0 && app.prep && app.prep.jdText) kws = extractKeywords(app.prep.jdText);
  if (kws.length === 0) missing.push('这份投递还没有 JD：粘贴 JD 原文后点「提取关键词」，匹配度才算得出来');
  if (text.trim().length === 0) missing.push('简历还是空的：先去「我的简历」填写，才能算匹配度');

  const hit: string[] = [];
  const miss: string[] = [];
  kws.forEach((k) => (text.indexOf(String(k).toLowerCase()) >= 0 ? hit : miss).push(k));

  const cover = kws.length > 0 ? hit.length / kws.length : 0;
  const coverScore = cover * 70;

  // 岗位名相关性：职位名里的词能落进简历 + 简历意向与职位名有交集
  const pos = (app.position || '').toLowerCase();
  let relScore = 0;
  if (pos && text) {
    const goal = (profile.headline || '').toLowerCase();
    if (goal && (pos.indexOf(goal) >= 0 || goal.indexOf(pos) >= 0)) relScore = 30;
    else {
      // 退一步：按 2~4 字切分看命中比例
      const grams: string[] = [];
      for (let n = 2; n <= 4; n++) {
        for (let i = 0; i + n <= pos.length; i++) grams.push(pos.slice(i, i + n));
      }
      if (grams.length > 0) {
        const g = grams.filter((x) => text.indexOf(x) >= 0).length;
        relScore = Math.round((g / grams.length) * 30);
      }
    }
  }

  const score = kws.length > 0 ? Math.max(0, Math.min(100, Math.round(coverScore + relScore))) : 0;
  const levelKey: MatchResult['levelKey'] = score >= 80 ? 'good' : score >= 60 ? 'ok' : score >= 40 ? 'warn' : 'bad';
  const LEVEL = { good: '高度匹配', ok: '基本匹配', warn: '有差距', bad: '差距较大' };

  const strengths: string[] = [];
  if (hit.length > 0) strengths.push(`JD 关键词命中 ${hit.length}/${kws.length}：${hit.slice(0, 5).join('、')}`);
  if (relScore >= 25) strengths.push(`岗位「${app.position}」与简历求职意向一致`);

  // 缺口建议：按「补在哪一段」给具体动作，而不是「建议你补充 X」
  const expTitles = expSections(profile).map((s) => s.title);
  const where = expTitles.length > 0 ? expTitles[0] : '实习/项目经历';
  const gaps: MatchGap[] = miss.slice(0, 6).map((kw) => ({
    kw,
    where,
    advice: /^[a-z0-9+#.]+$/i.test(kw)
      ? `简历里没有「${kw}」：如果用过，补进「技能与证书」并在${where}里写一句用它做了什么`
      : `JD 强调「${kw}」但简历没体现：如做过，在${where}补一条带结果的要点；没做过就先在资源库补这块知识`
  }));

  const actions: string[] = [];
  if (miss.length > 0) actions.push(`优先补这 3 个关键词：${miss.slice(0, 3).join('、')}`);
  if (score < 60) actions.push(`匹配度 ${score}%（${LEVEL[levelKey]}）：建议先按上面的缺口改简历，再投下一批同源岗位`);
  else actions.push('匹配度够用：把命中关键词对应的经历准备好，面试大概率会追问');
  if (missing.length > 0) actions.push(missing[0]);

  return {
    score, level: LEVEL[levelKey], levelKey,
    hitCount: hit.length, totalCount: kws.length,
    hit, miss, strengths, gaps, actions, missing
  };
}

/* ==================== 5. 投递洞察：状态 → 下一步 ==================== */

export interface NextAction {
  key: string;
  icon: string;
  text: string;
  /** 为什么现在要做这件事（说原因而不是只给指令） */
  reason: string;
  urgent: boolean;
  /** 跳转目标：app=某条投递详情；route=固定页面 */
  go: { kind: 'app' | 'route'; target: string };
}

export interface Alert {
  tone: 'warn' | 'info';
  text: string;
}

export interface AppInsight {
  appId: string;
  company: string;
  position: string;
  stage: string;
  /** 距上次更新天数 */
  idleDays: number;
  /** 停滞：投了很久没动静 / 面完很久没下文 */
  silent: boolean;
  /** 距截止天数（无截止为 null） */
  dueIn: number | null;
  nextInterviewText: string;
  readiness: number;
  alerts: Alert[];
  actions: NextAction[];
}

const SILENT_DAYS: Record<string, number> = { applied: 7, written: 5, interview: 4, offer: 3 };

function daysBetween(from: number, to: number): number {
  return Math.floor((to - from) / 86400000);
}

/**
 * 单条投递的洞察。
 * 关键不是「现在什么状态」，而是「这个状态停了多久、下一步该干什么」——
 * 秋招最容易 silent fail 的地方就是：投了 10 天没消息，用户自己也忘了要跟进。
 */
export function appInsight(app: IApplication, now = Date.now()): AppInsight {
  const rd = readiness(app);
  const alerts: Alert[] = [];
  const actions: NextAction[] = [];
  const appRoute = `/subpackages/recruit/pages/recruit/detail?id=${app._id}`;

  const idleDays = daysBetween(app.updateTime || app.createTime || now, now);
  const threshold = SILENT_DAYS[app.status] || 7;
  const active = app.status === 'applied' || app.status === 'written' || app.status === 'interview';
  const silent = active && idleDays >= threshold;

  const di = dueInfo(app.dueDate);
  const dueIn = app.dueDate ? di.days : null;

  const next = nextInterview(app);
  const nextInterviewText = next
    ? `${next.round} · ${new Date(next.at).getMonth() + 1}月${new Date(next.at).getDate()}日 ${String(new Date(next.at).getHours()).padStart(2, '0')}:${String(new Date(next.at).getMinutes()).padStart(2, '0')}`
    : '';

  /* —— 硬时间点优先：错过就没了 —— */
  if (next && !next.done) {
    const hours = (next.at - now) / 3600000;
    if (hours <= 48 && hours > -2) {
      alerts.push({ tone: 'warn', text: `${next.round}在 ${hours <= 1 ? '1 小时内' : Math.ceil(hours) + ' 小时内'}开始，先过一遍高频题与自我介绍` });
      actions.push({
        key: 'iv-ready', icon: '🎯', text: '过一遍面试题与准备清单',
        reason: `${next.round}临近，准备度 ${rd.score}%`, urgent: true,
        go: { kind: 'app', target: app._id }
      });
      if (!next.place) {
        actions.push({
          key: 'iv-place', icon: '📍', text: '补上会议链接 / 地点',
          reason: `${next.round}是${next.mode}，没填地点临场会慌`, urgent: true,
          go: { kind: 'app', target: app._id }
        });
      }
    }
  }

  if (dueIn !== null && app.status !== 'offer' && app.status !== 'rejected' && app.status !== 'givenup') {
    if (dueIn < 0) alerts.push({ tone: 'warn', text: `已过截止 ${Math.abs(dueIn)} 天：确认是否还能补投，或标记为已结束` });
    else if (dueIn <= 3) {
      alerts.push({ tone: 'warn', text: `截止还剩 ${dueIn} 天（${dueInfo(app.dueDate).text}）` });
      actions.push({
        key: 'due', icon: '⏰', text: dueIn === 0 ? '今天截止：立刻投递' : `${dueIn} 天后截止，先把材料补齐`,
        reason: '截止是硬时间点，错过不可恢复', urgent: true,
        go: { kind: 'app', target: app._id }
      });
    }
  }

  /* —— 停滞提醒 —— */
  if (silent) {
    alerts.push({
      tone: 'info',
      text: `${statusLabel(app.status)}已 ${idleDays} 天没动静（同阶段平均 3~5 天会有反馈）`
    });
    actions.push({
      key: 'follow', icon: '📮',
      text: app.status === 'applied' ? '跟进一下：发邮件 / 找内推人问进度' : '确认本轮结果，必要时联系 HR',
      reason: `停在第 ${SILENT_DAYS[app.status]} 天阈值之外，再等容易错过补录窗口`,
      urgent: false, go: { kind: 'app', target: app._id }
    });
  }

  /* —— 缺什么补什么 —— */
  const kws = (app.prep && app.prep.jdKeywords) || [];
  if (kws.length === 0) {
    actions.push({
      key: 'jd', icon: '📄', text: '粘贴 JD 并提取关键词',
      reason: '没有 JD 关键词，匹配度与面试提纲都算不出来', urgent: false,
      go: { kind: 'app', target: app._id }
    });
  } else if (rd.score < 60) {
    actions.push({
      key: 'prep', icon: '📚', text: `准备度只有 ${rd.score}%：补面试题与清单`,
      reason: rd.tips[0] || '进入下一轮前把准备度提到 60% 以上', urgent: false,
      go: { kind: 'app', target: app._id }
    });
  }

  if (app.status === 'interview' && rd.score >= 60 && !next) {
    actions.push({
      key: 'iv-time', icon: '🗓️', text: '登记面试时间',
      reason: '登记后自动进日历，并提前 30 分钟提醒', urgent: false,
      go: { kind: 'app', target: app._id }
    });
  }

  if (app.status === 'rejected' && !(app.review || '').trim()) {
    actions.push({
      key: 'review', icon: '📝', text: '写一句复盘：挂在哪一轮、考了什么',
      reason: '被拒不复盘 = 同一个坑面第二次', urgent: false,
      go: { kind: 'app', target: app._id }
    });
  }

  if (actions.length === 0) {
    actions.push({
      key: 'ok', icon: '✅', text: '暂无待办：保持节奏即可',
      reason: `准备度 ${rd.score}%（${rd.level}）`, urgent: false,
      go: { kind: 'app', target: app._id }
    });
  }

  return {
    appId: app._id,
    company: app.company || '未命名公司',
    position: app.position || '',
    stage: statusLabel(app.status),
    idleDays,
    silent,
    dueIn,
    nextInterviewText,
    readiness: rd.score,
    alerts,
    actions: actions.slice(0, 4)
  };
}

export interface TodayBrief {
  headline: string;
  /** 聚合后的下一步（跨投递，最多 6 条） */
  items: NextAction[];
  counts: { due: number; interview: number; silent: number; todo: number };
}

/**
 * 今日简报：把散在各条投递里的「该做的事」聚成一张清单。
 * 升级前首页只有统计数字（网申 X 家 / 面试 Y 家），用户看完不知道今天该干嘛。
 */
export function todayBrief(list?: IApplication[], now = Date.now()): TodayBrief {
  const apps = (list || loadApps()).filter(
    (a) => a.status !== 'rejected' && a.status !== 'givenup' && a.status !== 'offer'
  );
  const insights = apps.map((a) => appInsight(a, now));

  const due = insights.filter((i) => i.dueIn !== null && (i.dueIn as number) >= 0 && (i.dueIn as number) <= 3).length;
  const interview = insights.filter((i) => !!i.nextInterviewText).length;
  const silent = insights.filter((i) => i.silent).length;

  // 排序：紧急优先，其次准备度低的（离面试越近、准备越差越该先做）
  const all: NextAction[] = [];
  insights.forEach((i) => i.actions.forEach((a) => all.push({ ...a, key: `${i.appId}_${a.key}` })));
  all.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return 0;
  });

  const items = all.filter((a) => a.key.indexOf('_ok') < 0).slice(0, 6);

  let headline = '';
  if (items.length === 0) {
    headline = apps.length === 0
      ? '还没有进行中的投递：复制一份 JD 回来就能自动建卡'
      : '今天没有紧急事项：可以补投 2~3 家拉开梯度';
  } else {
    headline = `今天有 ${items.length} 件事要做` + (due > 0 ? `，其中 ${due} 个截止在 3 天内` : '');
  }

  return { headline, items, counts: { due, interview, silent, todo: items.length } };
}

/* ==================== 6. 面试提纲（引导式追问） ==================== */

export interface DrillQuestion {
  id: string;
  q: string;
  /** 为什么问这个（来自哪条输入） */
  why: string;
  kind: 'tech' | 'behavior' | 'project' | 'company' | 'ask';
}

export interface DrillGroup {
  kind: DrillQuestion['kind'];
  title: string;
  items: DrillQuestion[];
}

export interface DrillPlan {
  target: string;
  round: string;
  total: number;
  groups: DrillGroup[];
  /** 还缺哪些输入（UI 据此引导用户补充，而不是硬给一份通用题） */
  missing: string[];
  /** 生成依据：让用户知道这份提纲是从哪些真实输入来的 */
  basis: string[];
}

const TECH_Q: Record<string, string> = {
  Java: '讲讲 JVM 垃圾回收与一次你做过的调优',
  Python: 'Python 的 GIL 对并发的影响，你踩过什么坑',
  SQL: '写一条慢 SQL 的优化思路：从执行计划到索引',
  MySQL: '索引失效的常见场景，举一个你遇到过的',
  Redis: '缓存穿透 / 击穿 / 雪崩分别怎么解，你用过哪种',
  Kafka: '如何保证消息不丢失与不重复消费',
  Docker: '镜像分层与一次体积优化的经历',
  Kubernetes: 'Pod 调度失败你会怎么排查',
  算法: '挑一道你最熟的算法题，讲思路与复杂度',
  数据结构: '什么场景下你会选堆 / 跳表 / 布隆过滤器',
  分布式: '分布式锁怎么实现，超时与误删怎么处理',
  微服务: '服务拆分怎么划边界，你所在项目的边界合理吗',
  高并发: '描述一次你做过的高并发场景与压测结果',
  React: '讲讲 React 的渲染流程与一次性能优化',
  Vue: 'Vue 响应式原理与它对你的业务代码有什么影响',
  机器学习: '讲一个你做过的模型：数据、特征、指标、上线效果',
  数据分析: '给一个业务指标下降，你怎么拆解归因',
  产品经理: '你做过的哪次需求取舍最难，怎么决定的',
  运营: '一次用户增长活动：目标、动作、结果、复盘'
};

const BEHAVIOR_Q = [
  '用 1 分钟介绍一下你自己（按「我是谁 + 我做过什么 + 我为什么来」）',
  '讲一次你搞砸的事：当时怎么处理，事后改了什么',
  '和同学 / 同事意见冲突时你怎么推进',
  '你最有成就感的一件事是什么，为什么',
  '未来 1~3 年的规划，以及为什么选我们这个方向'
];

const ASK_Q = [
  '这个岗位入职后前 3 个月主要做什么',
  '团队现在最大的技术 / 业务挑战是什么',
  '这个岗位的晋升路径与考核方式是怎样的'
];

/**
 * 生成面试提纲。
 * 输入越全，提纲越贴合：JD 关键词 → 技术深挖；简历项目 → 经历追问；公司笔记 → 反向提问。
 * 缺输入时不硬凑，把缺口写进 missing，让页面去追问（引导式输入）。
 */
export function buildDrill(
  app: IApplication,
  opts?: { round?: string; minutes?: number; focus?: string[] },
  p?: ResumeProfile
): DrillPlan {
  const profile = p || draftToProfile(loadResumeDraft());
  const round = (opts && opts.round) || '';
  const minutes = (opts && opts.minutes) || 45;
  const focus = (opts && opts.focus) || [];

  let kws = (app.prep && app.prep.jdKeywords) || [];
  if (kws.length === 0 && app.prep && app.prep.jdText) kws = extractKeywords(app.prep.jdText);
  if (focus.length > 0) kws = focus.concat(kws);

  const missing: string[] = [];
  const basis: string[] = [];
  if (kws.length === 0) missing.push('JD 原文（决定技术题问什么）');
  else basis.push(`JD 关键词：${kws.slice(0, 6).join('、')}`);
  if (!round) missing.push('本轮面试轮次（一面偏基础、Leader 面偏深度）');
  if (!(app.prep && (app.prep.companyNotes || '').trim())) missing.push('公司研究笔记（决定「为什么选我们」怎么答）');

  // 题量按时长控制：30 分钟 8 题，45 分钟 12 题，60 分钟 15 题
  const cap = minutes <= 30 ? 8 : minutes >= 60 ? 15 : 12;

  const tech: DrillQuestion[] = [];
  kws.slice(0, Math.max(3, Math.ceil(cap * 0.5))).forEach((k) => {
    const key = String(k);
    const tpl = TECH_Q[key];
    tech.push({
      id: uid('dq'),
      q: tpl || `结合你做过的项目，讲讲你是怎么用「${key}」解决问题的`,
      why: tpl ? `JD 明确提到「${key}」` : `JD 关键词「${key}」`,
      kind: 'tech'
    });
  });
  if (tech.length === 0) {
    tech.push({
      id: uid('dq'),
      q: '挑一个你最熟的技术点讲透：原理 + 你用在哪 + 遇到什么问题',
      why: '还没解析出 JD 关键词，先按通用技术面准备',
      kind: 'tech'
    });
  }

  const projects: DrillQuestion[] = [];
  expSections(profile).forEach((s) => {
    (s.items || []).slice(0, 2).forEach((it) => {
      if (!it.primary) return;
      projects.push({
        id: uid('dq'),
        q: `「${it.primary}」这段经历里你具体负责什么？最难的点是什么，怎么解决的`,
        why: `来自简历${s.title}`,
        kind: 'project'
      });
    });
  });
  if (projects.length === 0) {
    projects.push({
      id: uid('dq'),
      q: '准备一段 3 分钟的项目介绍：背景、你的角色、关键决策、结果',
      why: '简历里还没有可追的经历，先补一段再来生成提纲会更准',
      kind: 'project'
    });
    missing.push('至少一段简历经历（否则追问没有落点）');
  }

  const behavior: DrillQuestion[] = BEHAVIOR_Q.slice(0, round && round.indexOf('HR') >= 0 ? 5 : 3).map((q) => ({
    id: uid('dq'),
    q,
    why: round && round.indexOf('HR') >= 0 ? 'HR 面高频行为题' : '通用行为题',
    kind: 'behavior' as const
  }));

  const companyNotes = (app.prep && app.prep.companyNotes) || '';
  const company: DrillQuestion[] = [
    {
      id: uid('dq'),
      q: `为什么选${app.company || '这家公司'}：结合它的业务 / 产品说，不要说「平台大」`,
      why: companyNotes.trim() ? '你已写了公司研究笔记，把里面最具体的一条说出来' : '还没写公司研究笔记，答这句最容易被追问穿',
      kind: 'company'
    },
    {
      id: uid('dq'),
      q: '你觉得自己和这个岗位最匹配的三个点是什么，各配一个例子',
      why: '把简历命中 JD 的点讲成故事',
      kind: 'company'
    }
  ];

  const ask: DrillQuestion[] = ASK_Q.map((q) => ({ id: uid('dq'), q, why: '反向提问体现你做过功课', kind: 'ask' as const }));

  // 截断到 cap：技术 > 项目 > 行为 > 公司 > 反问
  const picked: DrillQuestion[] = [];
  const pushUntil = (arr: DrillQuestion[]) => {
    for (const q of arr) {
      if (picked.length >= cap) return;
      picked.push(q);
    }
  };
  pushUntil(tech);
  pushUntil(projects);
  pushUntil(behavior);
  pushUntil(company);
  pushUntil(ask);

  const byKind = (k: DrillQuestion['kind'], title: string): DrillGroup => ({
    kind: k, title, items: picked.filter((q) => q.kind === k)
  });

  const groups: DrillGroup[] = [
    byKind('tech', '技术 / 专业深挖'),
    byKind('project', '经历与项目追问'),
    byKind('behavior', '行为与动机'),
    byKind('company', '为什么是你'),
    byKind('ask', '反向提问')
  ].filter((g) => g.items.length > 0);

  return {
    target: `${app.company || '未命名公司'} · ${app.position || '岗位'}`,
    round: round || '未指定轮次',
    total: picked.length,
    groups,
    missing,
    basis
  };
}

/* ==================== 6.5 求职方向词典（匹配度计算的基础） ==================== */

/**
 * 岗位库的 jobCategory 是「技术/产品/运营/职能」这类**大类串**，
 * 而用户的求职意向是「后端开发」这类**具体方向**。直接做字符串包含永远匹配不上，
 * 结果就是所有岗位的匹配度都是 0 —— 于是只能退化成按状态排序，匹配度形同虚设。
 *
 * 这里把两边都归一到同一套「方向」标签上，再求交集。
 * 词表刻意只收录可解释的常见说法，不做模糊兜底：宁可算不出，也不给假分。
 */
const FIELD_ALIASES: { field: string; words: string[] }[] = [
  { field: '技术', words: ['技术', '研发', '开发', '后端', '前端', '全栈', '客户端', '服务端', '测试', '运维', '软件', '嵌入式', '架构', '系统', 'it', 'java', 'python', 'golang', 'c++', 'javascript', 'typescript', 'react', 'vue', 'spring', 'springboot', 'mysql', 'redis', 'docker', 'kubernetes', 'linux', 'sql', 'git', '计算机'] },
  { field: '算法', words: ['算法', '人工智能', 'ai', '机器学习', '深度学习', 'nlp', 'cv', '图像', '语音', '推荐', '搜索', '大模型', 'llm'] },
  { field: '数据', words: ['数据', '大数据', '数仓', '数据分析', '商业分析', 'bi', '统计'] },
  { field: '产品', words: ['产品', '产品经理', 'pm'] },
  { field: '运营', words: ['运营', '内容', '社群', '增长'] },
  { field: '设计', words: ['设计', '交互', '视觉', 'ui', 'ue', '美术'] },
  { field: '游戏', words: ['游戏', '策划', '发行'] },
  { field: '财务', words: ['财务', '会计', '审计', '税务', '资金', '核算', '财管', '精算'] },
  { field: '金融', words: ['金融', '投研', '投行', '量化', '风控', '证券', '基金', '银行'] },
  { field: '咨询', words: ['咨询', '战略', '行业研究', '管理咨询'] },
  { field: '市场', words: ['市场', '品牌', '公关', '营销', '广告'] },
  { field: '销售', words: ['销售', '商务', '客户', '政企', '渠道'] },
  { field: '供应链', words: ['供应链', '物流', '采购', '计划', '生产', '制造'] },
  { field: '职能', words: ['职能', '人力', 'hr', '行政', '法务', '公共事务', '管培', '管理', '综合'] }
];

/** ASCII 词用词边界匹配，避免 'ai' 命中 'detail'、'go' 命中 'google' */
function hasWord(text: string, w: string): boolean {
  if (/^[a-z0-9+#.]+$/.test(w)) {
    return new RegExp('(^|[^a-z0-9])' + w.replace(/[.+#]/g, '\\$&') + '([^a-z0-9]|$)').test(text);
  }
  return text.indexOf(w) >= 0;
}

/** 一段自由文本命中了哪些求职方向 */
export function fieldsOf(text: string): string[] {
  const t = (text || '').toLowerCase();
  if (!t) return [];
  const out: string[] = [];
  for (const g of FIELD_ALIASES) {
    if (g.words.some((w) => hasWord(t, w))) out.push(g.field);
  }
  return out;
}

/* ==================== 7. 岗位推荐 ==================== */

export interface OpeningRec {
  /** 用岗位 _id 当 wx:key */
  key: string;
  id: string;
  company: string;
  position: string;
  score: number;
  reasons: string[];
  status: OpeningStatus;
  statusLabel: string;
  dueText: string;
  /** 是否已投递过同一家公司（提示避免重复投递） */
  applied: boolean;
}

const STATUS_LABEL_CN: Record<OpeningStatus, string> = {
  open: '进行中', closing: '即将截止', upcoming: '未开始', tba: '待公布', closed: '已截止'
};

/**
 * 岗位推荐：把「我是谁（简历 + 意向）」和「岗位库在招什么」对上。
 * 升级前岗位库只有筛选与关注，用户得自己翻 272 条才知道哪些和自己有关。
 */
export function recommendOpenings(limit = 8, apps?: IApplication[]): OpeningRec[] {
  const goal = currentGoal(apps);
  const text = resumeText(draftToProfile(loadResumeDraft()));
  const applied = new Set((apps || loadApps()).map((a) => (a.company || '').trim()).filter(Boolean));
  // 我的方向：求职意向 + 简历技能词 + 简历正文，三者归一
  const myFields = fieldsOf(`${goal.target} ${goal.keywords.join(' ')} ${text}`);

  const out: OpeningRec[] = [];
  loadOpenings().forEach((o: JobOpening) => {
    const st = statusOf(o);
    if (st === 'closed') return;

    const reasons: string[] = [];
    let score = 0;

    // 1) 岗位类别 / 目标意向匹配（最高 40）
    const cat = (o.jobCategory || '').toLowerCase();
    const target = (goal.target || '').toLowerCase();
    const catFields = fieldsOf(o.jobCategory);
    const inter = myFields.filter((f) => catFields.indexOf(f) >= 0);
    if (inter.length > 0) {
      score += 40;
      reasons.push(
        target && (cat.indexOf(target) >= 0 || target.indexOf(cat) >= 0)
          ? `岗位类别与你的目标「${goal.target}」一致`
          : `岗位方向「${inter.join('、')}」与你的目标一致`
      );
    } else if (target && target.length >= 2 && cat.indexOf(target.slice(0, 2)) >= 0) {
      score += 24;
      reasons.push(`与目标「${goal.target}」方向相近`);
    }

    // 2) 简历技能命中岗位关键词（最高 20）
    const catKw = cat.split(/[\/、,，\s]/).filter((s) => s.length >= 2);
    const hitKw = catKw.filter((k) => text.indexOf(k.toLowerCase()) >= 0);
    if (hitKw.length > 0) {
      score += Math.min(20, hitKw.length * 10);
      reasons.push(`简历里已有相关积累：${hitKw.slice(0, 3).join('、')}`);
    }

    // 3) 状态：能投的优先（最高 25）
    if (st === 'closing') { score += 25; reasons.push('即将截止，优先处理'); }
    else if (st === 'open') { score += 20; reasons.push('正在开放报名'); }
    else if (st === 'upcoming') { score += 8; reasons.push('尚未开始，可先准备'); }
    else score += 4;

    // 4) 截止临近加权（最高 10）
    const dl = daysLeft(o);
    if (dl !== null && dl >= 0 && dl <= 14) {
      score += 10;
      reasons.push(`${dl} 天后截止`);
    }

    // 5) 同公司已投过：不重复推，但保留并标注
    const isApplied = applied.has((o.company || '').trim());
    if (isApplied) {
      score -= 15;
      reasons.push('你已经投过这家公司（同公司多投需谨慎）');
    }

    if (score <= 0) return;
    out.push({
      key: o._id,
      id: o._id,
      company: o.company,
      position: o.jobCategory,
      score: Math.max(0, Math.min(100, score)),
      reasons: reasons.slice(0, 3),
      status: st,
      statusLabel: STATUS_LABEL_CN[st],
      dueText: dueText(o),
      applied: isApplied
    });
  });

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/* ==================== 7.5 单岗位匹配度（时间线卡片用） ==================== */

export interface OpeningFit {
  /**
   * 是否有足够信息给出匹配度。
   * 没填简历 / 没填求职意向时一律 false —— 时间线上宁可不显示这个数字，
   * 也不能给一个看起来精确、实际是拍脑袋的百分比。
   */
  ready: boolean;
  /** 0-100 的契合度 */
  score: number;
  /** 为什么是这个分数（1-3 条，可直接展示） */
  reasons: string[];
}

/**
 * 单条岗位的「契合度」：只算「你和这个岗位像不像」，**不含紧迫度**。
 *
 * 为什么不直接复用 recommendOpenings 的分数：那个分数把「即将截止 +25」
 * 「正在开放 +20」也算进去了，用来排序推荐没问题；但时间线是逐条挂百分比的，
 * 一个完全不搭边、只是「今天截止」的岗位会被算成 45 分，用户会读成
 * 「和我匹配度 45%」—— 这是误导。所以这里只取方向与技能两类硬信号。
 */
export function openingFit(o: JobOpening, goal?: JobGoal): OpeningFit {
  return openingFitScorer(goal)(o);
}

export type OpeningFitFn = (o: JobOpening) => OpeningFit;

/**
 * 批量打分器：把「我是谁」只算一次，然后逐条岗位打分。
 * 时间线 / 推荐页一次要给 200+ 条岗位挂匹配度，若每条都调 openingFit，
 * resumeText + fieldsOf 会把整份简历重复解析 272 遍 —— 这里先固化 myFields。
 */
export function openingFitScorer(goal?: JobGoal): OpeningFitFn {
  const g = goal || currentGoal();
  const notReady: OpeningFit = { ready: false, score: 0, reasons: [] };
  if (!g.has) return () => notReady;

  const myFields = fieldsOf(`${g.target} ${g.keywords.join(' ')} ${resumeText(draftToProfile(loadResumeDraft()))}`);
  // 方向都认不出来（意向太偏门）→ 不编分数
  if (myFields.length === 0) return () => notReady;

  const target = (g.target || '').toLowerCase();
  return (o: JobOpening): OpeningFit => {
    const cat = (o.jobCategory || '').toLowerCase();
    const inter = myFields.filter((f) => fieldsOf(o.jobCategory).indexOf(f) >= 0);

    const reasons: string[] = [];
    let score: number;

    if (target && cat && (cat.indexOf(target) >= 0 || target.indexOf(cat) >= 0)) {
      // 最精确：岗位类别串里就有用户的目标词
      score = 92;
      reasons.push(`岗位类别就是「${o.jobCategory}」，与你的目标一致`);
    } else if (inter.length > 0) {
      score = Math.min(88, 70 + (inter.length - 1) * 8);
      reasons.push(`方向对口：你的「${inter.join('、')}」正是该岗位所在方向`);
    } else {
      score = 18;
      reasons.push('与你的目标方向不同，优先级可以往后放');
    }

    return { ready: true, score, reasons };
  };
}

/* ==================== 8. 看板诊断：数字 → 结论 ==================== */

export interface BoardFinding {
  tone: 'good' | 'warn' | 'bad' | 'info';
  text: string;
}

export interface BoardDiag {
  headline: string;
  findings: BoardFinding[];
  /** 优先行动（可点击跳转） */
  priorities: NextAction[];
  /** 关键转化率，供 UI 直接展示 */
  rates: { applied2written: number; written2interview: number; interview2offer: number };
}

/**
 * 看板诊断。
 * 升级前看板是一堆图（漏斗 / 趋势 / 内推对比）+ 几条固定话术的 tips；
 * 现在按用户自己的数据算出「卡在哪一环」，并给出能点进去的动作。
 */
export function diagnoseBoard(list?: IApplication[], now = Date.now()): BoardDiag {
  const apps = list || loadApps();
  const findings: BoardFinding[] = [];
  const priorities: NextAction[] = [];

  const idxOf = (a: IApplication): number => {
    const order = ['applied', 'written', 'interview', 'offer'];
    const i = order.indexOf(a.status);
    if (i >= 0) return i;
    // rejected / givenup 看历史到过哪一环
    const hist = (a.history || []).map((h) => order.indexOf(h.status)).filter((x) => x >= 0);
    return hist.length > 0 ? Math.max.apply(null, hist) : 0;
  };

  const nApplied = apps.filter((a) => idxOf(a) >= 0).length;
  const nWritten = apps.filter((a) => idxOf(a) >= 1).length;
  const nInterview = apps.filter((a) => idxOf(a) >= 2).length;
  const nOffer = apps.filter((a) => idxOf(a) >= 3).length;

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const rates = {
    applied2written: pct(nWritten, nApplied),
    written2interview: pct(nInterview, nWritten),
    interview2offer: pct(nOffer, nInterview)
  };

  if (apps.length === 0) {
    return {
      headline: '还没有投递数据，先建 3~5 张投递卡再来结论',
      findings: [{ tone: 'info', text: '在首页点「粘贴链接建卡」或「从剪贴板导入岗位」，30 秒就能建一张' }],
      priorities: [{
        key: 'first', icon: '➕', text: '新建第一张投递卡', reason: '有数据才有诊断', urgent: true,
        go: { kind: 'route', target: '/subpackages/recruit/pages/recruit/detail' }
      }],
      rates: { applied2written: 0, written2interview: 0, interview2offer: 0 }
    };
  }

  if (apps.length < 5) {
    findings.push({ tone: 'info', text: `样本只有 ${apps.length} 条，转化率先别当结论，先把量投上去` });
  }

  // 卡点一：网申 → 笔试
  if (nApplied >= 5 && rates.applied2written < 40) {
    findings.push({
      tone: 'bad',
      text: `投了 ${nApplied} 家只有 ${nWritten} 家进笔试（${rates.applied2written}%）：多半是简历与 JD 不对味，去详情页看「匹配度」按缺口改`
    });
    priorities.push({
      key: 'resume', icon: '📄', text: '去改简历：按 JD 缺口补关键词',
      reason: `网申→笔试转化 ${rates.applied2written}%，低于 40% 的参考线`, urgent: true,
      go: { kind: 'route', target: '/subpackages/recruit/pages/recruit/resume' }
    });
  } else if (nApplied >= 5) {
    findings.push({ tone: 'good', text: `网申→笔试 ${rates.applied2written}%，简历过关率正常` });
  }

  // 卡点二：笔试 → 面试
  if (nWritten >= 3 && rates.written2interview < 30) {
    findings.push({
      tone: 'warn',
      text: `${nWritten} 次笔试只换来 ${nInterview} 次面试（${rates.written2interview}%）：笔试环节是短板，刷行测 + 岗位真题`
    });
    priorities.push({
      key: 'resource', icon: '📚', text: '刷对应岗位的笔试真题',
      reason: `笔试→面试 ${rates.written2interview}%`, urgent: false,
      go: { kind: 'route', target: '/subpackages/recruit/pages/recruit/resource' }
    });
  }

  // 卡点三：面试准备度
  const inInterview = apps.filter((a) => a.status === 'interview');
  if (inInterview.length > 0) {
    const avg = Math.round(
      inInterview.reduce((s, a) => s + readiness(a).score, 0) / inInterview.length
    );
    if (avg < 60) {
      findings.push({ tone: 'warn', text: `${inInterview.length} 个在面岗位的平均准备度只有 ${avg}%：先补高频题再进下一轮` });
      const worst = inInterview
        .map((a) => ({ a, r: readiness(a).score }))
        .sort((x, y) => x.r - y.r)[0];
      if (worst) {
        priorities.push({
          key: `prep_${worst.a._id}`, icon: '🎯',
          text: `先补「${worst.a.company}」的准备（${worst.r}%）`,
          reason: '准备度最低的在面岗优先', urgent: true,
          go: { kind: 'app', target: worst.a._id }
        });
      }
    } else {
      findings.push({ tone: 'good', text: `在面岗位平均准备度 ${avg}%，状态不错` });
    }
  }

  // 卡点四：停滞投递
  const insights = apps.map((a) => appInsight(a, now)).filter((i) => i.silent);
  if (insights.length > 0) {
    findings.push({
      tone: 'warn',
      text: `${insights.length} 个投递超过阈值没动静（${insights.slice(0, 3).map((i) => i.company).join('、')}）：要么跟进，要么及时止损`
    });
    priorities.push({
      key: `follow_${insights[0].appId}`, icon: '📮',
      text: `跟进「${insights[0].company}」（${insights[0].idleDays} 天没动静）`,
      reason: '停滞越久，补录窗口越小', urgent: false,
      go: { kind: 'app', target: insights[0].appId }
    });
  }

  // 卡点五：Offer 决策
  if (nOffer >= 2) {
    findings.push({ tone: 'info', text: `已有 ${nOffer} 个 Offer：按薪资 / 城市 / 面试体感做对比，别拖过答复期限` });
  }

  if (findings.length === 0) {
    findings.push({ tone: 'good', text: '各环节转化率都在正常区间：保持每周固定投递量即可' });
  }

  const headline = nOffer > 0
    ? `已拿 ${nOffer} 个 Offer，进面率 ${pct(nInterview, nApplied)}%`
    : `投递 ${nApplied} 家，卡在${rates.applied2written < 40 ? '网申→笔试' : rates.written2interview < 30 ? '笔试→面试' : '面试环节'}`;

  return { headline, findings, priorities: priorities.slice(0, 4), rates };
}

/* ==================== 9. 资源库上下文推荐 ==================== */

export interface ResourceBoost {
  /** 来自该投递的 JD 关键词（命中这些词的资料优先） */
  keywords: string[];
  /** 简历里欠缺的关键词（对应资料优先） */
  gaps: string[];
  label: string;
}

/**
 * 给资源库用的上下文：进入资源库时如果带着某条投递（从详情页「从资源库导入」进来），
 * 就把这条投递的 JD 关键词与简历缺口交给它排序 —— 让推荐与「这场面试」有关，
 * 而不是每次都从 272 条里盲翻。
 */
export function resourceBoost(appId: string): ResourceBoost {
  const app = (loadApps().filter((a) => a._id === appId)[0]) as IApplication | undefined;
  if (!app) return { keywords: [], gaps: [], label: '' };
  const m = matchResumeToJob(app);
  return {
    keywords: m.hit,
    gaps: m.miss,
    label: `${app.company || '未命名公司'} · ${app.position || '岗位'}`
  };
}

/* ==================== 10. 首页 Copilot：本周建议 + 指令路由 ==================== */

export interface WeeklyAdvice {
  /** 一句话主建议（来自真实数据；无数据时为欢迎引导，绝不虚构进度） */
  headline: string;
  /** 建议点（最多 3 条），UI 用「 · 」拼接展示 */
  points: string[];
  /** 空数据欢迎态：true 时首页显示「开始规划」引导，而不是一条条建议 */
  fresh: boolean;
}

/**
 * 本周建议（首页 AI 助手卡的数据来源）。
 * 只说真实数据里站得住的事：临近的截止 / 面试 / 简历缺口 / 停滞投递；
 * 什么都没有时进入欢迎态引导用户开始规划 —— 不伪造「你已完成 XX」。
 */
export function weeklyAdvice(list?: IApplication[], now = Date.now()): WeeklyAdvice {
  const apps = list || loadApps();
  const profile = draftToProfile(loadResumeDraft());
  const hasResume = resumeText(profile).trim().length > 0;
  const live = apps.filter((a) => a.status !== 'rejected' && a.status !== 'givenup');

  if (live.length === 0) {
    return {
      headline: hasResume ? '简历已就绪，从第一个投递开始' : '欢迎使用秋招助手',
      points: hasResume
        ? ['粘贴一个心仪岗位的 JD，建立第一张投递卡', '我会按 JD 与你的简历给出匹配度和准备清单']
        : ['先告诉我你的目标岗位', '我会帮你制定第一份秋招计划'],
      fresh: true
    };
  }

  const points: string[] = [];

  // 1) 硬时间点：3 天内截止的最优先
  const dueSoon = live
    .filter((a) => a.dueDate && a.status !== 'offer')
    .map((a) => ({ a, days: Math.floor(((a.dueDate as number) - now) / 86400000) }))
    .filter((x) => x.days >= 0 && x.days <= 3)
    .sort((x, y) => x.days - y.days);
  if (dueSoon.length > 0) {
    const first = dueSoon[0];
    points.push(
      `「${first.a.company || '心仪岗位'}」${first.days === 0 ? '今天' : `${first.days} 天内`}截止` +
      (dueSoon.length > 1 ? `（3 天内共 ${dueSoon.length} 个）` : '') + '，优先补齐材料'
    );
  }

  // 2) 7 天内的下一场面试
  const ivPairs: { a: IApplication; iv: { round: string; at: number; done: boolean } }[] = [];
  live.forEach((a) => (a.interviews || []).forEach((iv) => {
    if (!iv.done && iv.at > now && iv.at <= now + 7 * 86400000) ivPairs.push({ a, iv });
  }));
  const nextIv = ivPairs.sort((x, y) => x.iv.at - y.iv.at)[0];
  if (nextIv) {
    points.push(`重点准备「${nextIv.a.company || '下一场面试'} · ${nextIv.iv.round}」，先过高频题`);
  }

  // 3) 简历缺口 / JD 缺口
  if (!hasResume) {
    points.push('完善简历：结构化填写后可自动诊断，并按岗位算匹配度');
  } else if (live.some((a) => !((a.prep && a.prep.jdKeywords) || []).length)) {
    points.push('给还没有 JD 关键词的投递补上 JD，解锁匹配度分析');
  }

  // 4) 停滞跟进（版面有限：建议位不足 3 条时才占位）
  const silent = live.filter((a) => appInsight(a, now).silent).length;
  if (silent > 0 && points.length < 3) {
    points.push(`${silent} 个投递多日没动静：跟进一次，或标记结束及时止损`);
  }

  if (points.length === 0) {
    points.push('关注心仪岗位，保持每周 2~3 个的投递节奏', '完成 1~2 次模拟面试保持手感');
  }
  return { headline: `进行中 ${live.length} 个投递`, points: points.slice(0, 3), fresh: false };
}

export interface CommandRoute {
  key: string;
  /** 指令名（快捷 chip 展示） */
  label: string;
  /** 一句话说明去哪、做什么 */
  desc: string;
  /** 目标页路径（真实存在的功能页 —— 不做假 AI，点了就直达对应工作台） */
  go: string;
}

/** 内置快捷指令（开发指令面板底部 chips，也是 parseCommand 的解析目标） */
export const COPILOT_COMMANDS: CommandRoute[] = [
  { key: 'resume', label: '优化我的简历', desc: '简历诊断 · 目标匹配', go: '/subpackages/recruit/pages/recruit/resume' },
  { key: 'job', label: '分析目标岗位', desc: '岗位画像 · 开放与截止', go: '/subpackages/recruit/pages/recruit/openings' },
  { key: 'interview', label: '准备面试', desc: '题库 · 面经 · 面试提纲', go: '/subpackages/recruit/pages/recruit/resource' },
  { key: 'plan', label: '生成投递计划', desc: '岗位时间线 · 黄金期节奏', go: '/subpackages/recruit/pages/recruit/openings?view=timeline' },
  { key: 'data', label: '分析我的秋招数据', desc: '转化漏斗 · 看板诊断', go: '/subpackages/recruit/pages/recruit/analysis' }
];

/**
 * 本地指令路由：把自然语言指令解析成「去哪个工作台」。
 * 全部离线确定性匹配，不调云端 —— 识别不了返回 null，UI 引导用户点快捷指令。
 * 规则按优先级排列：「分析我的秋招数据」要先于「岗位」类兜底词命中 data。
 */
export function parseCommand(text: string): CommandRoute | null {
  const q = (text || '').trim().toLowerCase();
  if (!q) return null;
  const rules: { key: string; kws: string[] }[] = [
    { key: 'resume', kws: ['简历', 'resume', '润色', '自我介绍'] },
    { key: 'interview', kws: ['面试', '面经', '模拟', 'interview', '刷题', '题库'] },
    { key: 'data', kws: ['分析我的', '秋招数据', '转化', '漏斗', '复盘', '通过率', 'offer率'] },
    { key: 'plan', kws: ['投递计划', '计划', '时间线', '黄金期', '节奏'] },
    { key: 'job', kws: ['岗位', '职位', '公司', 'job', '找', '投'] }
  ];
  for (const r of rules) {
    if (r.kws.some((k) => q.indexOf(k) >= 0)) {
      return COPILOT_COMMANDS.filter((c) => c.key === r.key)[0] || null;
    }
  }
  return null;
}
