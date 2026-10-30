// utils/resume-schema.ts
// 简历「模块注册表 + 输入容错」层。
//
// 为什么要有这一层：
//   原来每新增一个模块（证书 / 语言 / 开源贡献…）都要同时改 ResumeDraft 接口、默认值、
//   读取兜底、draftToProfile、页面表单、AI 提示词 JSON schema——六处硬编码，加字段成本极高。
//   现在把「模块有哪些、叫什么、怎么排序、什么算空」集中到 SECTION_REGISTRY，
//   核心逻辑只认注册表，新增模块 = 表里加一行，不用碰渲染与排版。
//
// 容错目标（用户要求 1）：
//   兼容不完整、格式不统一或多来源的信息；缺失字段省略或用中性表述兜底；
//   绝不把占位符（XX 大学 / ____ / 你的名字 / 此处填写…）漏进最终 PDF。

import type { ResumeImage, ResumeItem, ResumeProfile, ResumeSection } from './resume-doc';

/** 模块渲染形态：items=条目列表（教育/实习/项目），text=纯文本段（技能/自评/语言） */
export type SectionKind = 'items' | 'text';

export interface SectionDef {
  /** 标准 key */
  key: string;
  /** 默认标题（用户输入为空时的中性兜底） */
  title: string;
  /** 别名：用于把多来源的 key/title 归一到标准 key */
  aliases: string[];
  kind: SectionKind;
  /** 基础排序权重（兜底用；自适应编排会按岗位/资历覆盖） */
  baseWeight: number;
  /** 内容为空时是否整体省略（默认省略） */
  dropWhenEmpty?: boolean;
}

/**
 * 模块注册表：顺序即「兜底优先级」——匹配别名时从上往下取第一个命中，
 * 所以教育 / 工作 / 实习排在前面，避免「实习 / 项目经历」这类混合标题被误判。
 */
export const SECTION_REGISTRY: SectionDef[] = [
  { key: 'edu', title: '教育背景', kind: 'items', baseWeight: 10,
    aliases: ['education', '教育', '教育经历', '学历', '学业', 'school', 'academic', 'edu'] },
  { key: 'work', title: '工作经历', kind: 'items', baseWeight: 20,
    aliases: ['job', 'employment', '工作', '全职', '工作经验', '任职', 'professional', 'career', 'work'] },
  { key: 'intern', title: '实习经历', kind: 'items', baseWeight: 30,
    aliases: ['internship', '实习', '实践', '实习经历', '见习', 'intern'] },
  { key: 'proj', title: '项目经历', kind: 'items', baseWeight: 40,
    aliases: ['project', '项目', '项目经验', '研究', '科研', 'research', 'proj'] },
  { key: 'award', title: '荣誉奖项', kind: 'items', baseWeight: 60,
    aliases: ['awards', 'honor', '获奖', '奖项', '荣誉', '奖学金', 'scholarship', 'award'] },
  { key: 'cert', title: '证书资质', kind: 'items', baseWeight: 62,
    aliases: ['certificate', 'certification', '证书', '资质', '资格', 'qualification', 'cert'] },
  { key: 'skill', title: '技能与证书', kind: 'text', baseWeight: 70,
    aliases: ['skills', '技能', '专业技能', '技术栈', '能力', 'skill'] },
  { key: 'lang', title: '语言能力', kind: 'text', baseWeight: 75,
    aliases: ['language', '语言', '外语', '英语', 'lang'] },
  { key: 'custom', title: '其它经历', kind: 'items', baseWeight: 80,
    aliases: ['other', '其他', '其它', '开源', '作品', 'custom'] },
  { key: 'summary', title: '自我评价', kind: 'text', baseWeight: 90,
    aliases: ['evaluation', 'self', '自我评价', '个人总结', '个人评价', '评价', '总结', 'profile', 'objective', 'summary'] }
];

const REG_BY_KEY: Record<string, SectionDef> = {};
SECTION_REGISTRY.forEach((d) => { REG_BY_KEY[d.key] = d; });

/** 未登记模块的兜底定义（保留用户自己的标题，不硬塞进已知分类） */
const FALLBACK_DEF: SectionDef = { key: 'custom', title: '其它经历', kind: 'items', baseWeight: 80, aliases: [] };

export function sectionDef(key: string): SectionDef {
  return REG_BY_KEY[key] || FALLBACK_DEF;
}

/* ==================== 文本归一化与清洗 ==================== */

/** 归一化：小写 + 去所有分隔符，便于别名包含匹配 */
function norm(s: string): string {
  return String(s || '').toLowerCase().replace(/[\s_\-·、,，.。;；:：/\\()（）[\]【】]/g, '');
}

/** 折叠空白：连续空格/换行压成一个空格 */
function squeeze(s: string): string {
  return String(s || '').replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * 多来源 key 归一：先用 key 精确匹配，再用别名匹配 key，最后用标题匹配。
 * 认不出来的保留为 custom，绝不丢模块（用户填的内容不能凭空消失）。
 */
export function normalizeSectionKey(key?: string, title?: string): string {
  const k = String(key || '').trim().toLowerCase();
  if (k && REG_BY_KEY[k]) return k;
  const nk = norm(key);
  if (nk) {
    for (const d of SECTION_REGISTRY) {
      if (norm(d.key) === nk) return d.key;
      if (d.aliases.some((a) => norm(a) === nk)) return d.key;
    }
  }
  const nt = norm(title);
  if (nt) {
    for (const d of SECTION_REGISTRY) {
      if (nt.includes(norm(d.key))) return d.key;
      if (d.aliases.some((a) => { const na = norm(a); return na.length >= 2 && nt.includes(na); })) return d.key;
    }
  }
  return 'custom';
}

/** 去掉行首的项目符号：• - * ▪ 1. 1) 等（用户从 Word / 网页粘贴常见） */
const BULLET_MARK = /^\s*(?:[•·▪◦‣*\-—–]+|\d+[.、)．]|[a-z][.)])\s*/i;

export function stripBulletMarker(s: string): string {
  return String(s || '').replace(BULLET_MARK, '').trim();
}

/** 通用文本清洗：去项目符号 + 折叠空白 */
export function cleanText(s: string): string {
  return squeeze(stripBulletMarker(s));
}

/** 联系方式常见标签前缀：电话：138… → 138… */
const CONTACT_LABEL = /^\s*(?:电话|手机|手机号码|联系方式|邮箱|邮箱地址|电子邮箱|e-?mail|微信|wechat|地址|所在地|现居|城市)\s*[:：]?\s*/i;

/** 联系方式拆分：兼容换行、逗号、顿号、竖线、分号等多种分隔习惯 */
export function cleanContacts(raw: string): string[] {
  const parts = String(raw || '').split(/[\n\r,，、;；|｜·]+/);
  const out: string[] = [];
  for (const p of parts) {
    // 一行里含多个空格分隔的联系方式时再拆一次（如「138-0000-0000 a@b.com」）
    for (const q of String(p).split(/\s{2,}|\t/)) {
      let t = String(q || '').replace(CONTACT_LABEL, '').trim();
      if (!t) continue;
      if (looksEmpty(t)) continue;
      if (out.indexOf(t) < 0) out.push(t);
    }
  }
  return out;
}

/* ==================== 占位符 / 脏值识别 ==================== */

/** 模板里写死的提示占位符，原样出现在 PDF 里就是事故 */
export const PLACEHOLDER_HINT = '（此处填写你的真实经历与量化结果）';

const PLACEHOLDER_RULES: RegExp[] = [
  /此处填写|待补充|待填写|请填写|请补充|自行补充|按需填写/,
  /\b(TBD|TODO|FIXME|N\/A|NA)\b/i,
  /_{2,}/,                      // ____ 填空线
  /(?:\bXX+\b|\bxx+\b)/,        // XX 公司 / XX 大学
  /你的名字|你的姓名|你的信息|姓名：?$|^姓名$/,
  /name@example|example\.com|example@|@example/i,
  /^[\s\-—－_·.。*#=+~]+$/,      // 纯符号占位
  /^(?:无|暂无|没有|待定|未知|不详|略)[.。,，]?$/,
  /示例|样例|举例说明/
];

/**
 * 是否占位符 / 无实质内容。
 * 保守原则：只在明确是占位或空壳时判 true，正常业务文字绝不误杀
 * （「无」单独一个字才算空，但「无纸化办公」不受影响，因为用了 ^…$ 锚定）。
 */
export function isPlaceholder(s: string): boolean {
  const t = String(s || '').trim();
  if (!t) return true;
  return PLACEHOLDER_RULES.some((re) => re.test(t));
}

/** 实质为空（空白或占位符） */
export function looksEmpty(s?: string): boolean {
  return isPlaceholder(String(s || ''));
}

/** 多行 bullets → 清洗后的要点数组（去符号、去空、去占位、去重） */
export function cleanBullets(raw: string): string[] {
  const out: string[] = [];
  const seen: Record<string, boolean> = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const t = cleanText(line);
    if (!t || looksEmpty(t)) continue;
    const k = norm(t);
    if (seen[k]) continue;
    seen[k] = true;
    out.push(t);
  }
  return out;
}

/* ==================== 整体清洗（生成前哨兵） ==================== */

/** 标题兜底：空标题用注册表默认标题，认不出的模块用中性的「其它经历」 */
export function fallbackTitle(key: string, title?: string): string {
  const t = cleanText(title || '');
  if (t && !looksEmpty(t)) return t;
  return sectionDef(normalizeSectionKey(key, t)).title;
}

function cleanItem(it: ResumeItem): ResumeItem | null {
  const primary = cleanText(it.primary || '');
  const secondary = cleanText(it.secondary || '');
  const meta = cleanText(it.meta || '');
  const bullets = Array.isArray(it.bullets)
    ? it.bullets.map((b) => cleanText(String(b))).filter((b) => b && !looksEmpty(b))
    : [];
  // 主标题是占位符（XX 公司）时整条丢弃：留着只会让 PDF 里出现「XX 公司」
  if (primary && looksEmpty(primary)) return null;
  if (!primary && !secondary && !meta && !bullets.length) return null;
  return { primary, secondary, meta, bullets };
}

/**
 * 生成前哨兵：把任何来源（表单 / 模板 / AI 回填 / 旧存档）的 profile 清洗成可安全渲染的形态。
 * 契约：
 *   - 不新增任何内容（严禁虚构），只做删减与归一；
 *   - 缺失字段整体省略，不做「未提供」这类补白（补白等于给读者添噪音）；
 *   - 空壳模块、占位符文本一律剔除。
 */
export function sanitizeProfile(p: ResumeProfile): ResumeProfile {
  const sections: ResumeSection[] = [];
  for (const sec of p.sections || []) {
    if (!sec) continue;
    const key = normalizeSectionKey(sec.key, sec.title);
    const images: ResumeImage[] = (sec.images || []).filter((x) => x && x.path).map((x) => ({
      id: x.id, path: x.path, caption: cleanText(x.caption || '') || undefined
    }));

    const items: ResumeItem[] = [];
    for (const it of sec.items || []) {
      if (!it) continue;
      const c = cleanItem(it);
      if (c) items.push(c);
    }

    const text = cleanText(sec.text || '');
    const hasText = !!text && !looksEmpty(text);

    if (!items.length && !hasText && !images.length) continue; // 空壳模块整体省略

    const s: ResumeSection = { key, title: fallbackTitle(key, sec.title) };
    if (items.length) s.items = items;
    if (hasText) s.text = text;
    if (images.length) s.images = images;
    sections.push(s);
  }

  // 头部字段同样要防占位：「你的名字」「XX」这类值一旦漏进 PDF 就是事故，宁可留空
  const head = (s?: string): string => {
    const t = cleanText(s || '');
    return t && !looksEmpty(t) ? t : '';
  };

  return {
    name: head(p.name),
    headline: head(p.headline),
    expectedSalary: head(p.expectedSalary),
    expectedCity: head(p.expectedCity),
    contacts: Array.isArray(p.contacts) ? p.contacts.map((c) => cleanText(c)).filter(Boolean) : [],
    sections,
    photo: p.photo
  };
}

/** 模块去重：同 key 的多个模块合并（AI 回填常出现 edu 出现两次） */
export function mergeSameKeySections(sections: ResumeSection[]): ResumeSection[] {
  const order: string[] = [];
  const bucket: Record<string, ResumeSection[]> = {};
  for (const s of sections) {
    const k = s.key || 'custom';
    if (!bucket[k]) { bucket[k] = []; order.push(k); }
    bucket[k].push(s);
  }
  return order.map((k) => {
    const list = bucket[k];
    if (list.length === 1) return list[0];
    const def = sectionDef(k);
    const merged: ResumeSection = { key: k, title: fallbackTitle(k, list[0].title) };
    const items: ResumeItem[] = [];
    const texts: string[] = [];
    const images: ResumeImage[] = [];
    for (const s of list) {
      (s.items || []).forEach((it) => items.push(it));
      if (s.text) texts.push(s.text);
      (s.images || []).forEach((im) => images.push(im));
    }
    if (items.length) merged.items = items;
    if (texts.length) merged.text = def.kind === 'text' ? texts.join(' · ') : texts.join(' ');
    if (images.length) merged.images = images;
    return merged;
  });
}
