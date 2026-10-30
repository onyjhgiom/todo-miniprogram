// utils/recruit-library.ts
// 资源库「自动检索 + 自动归类 + 自动汇总」本地智能层（零依赖、纯前端、离线可用）。
//
// 设计目标：解决原来只能逐条手动浏览、子串匹配召回率低、无自动归纳的问题。
//   · 检索：离线条目索引（字段加权倒排 + BM25-lite 相关性排序），模糊/片段关键词也能召回并按相关度排；
//   · 归类：主题词典命中（从标题/正文/标签自动抽取「考点主题」），生成可一键筛选的 facet；
//   · 汇总：给定筛选条件，自动产出结构化摘要（分层 + 高频主题 TopK + 核心结论摘录 + 推荐阅读顺序），
//          继承并自动化了此前人工总结「方法论 → 公司专项 → 专业深度 → 实战」的四层框架。
//
// 与项目一致：不依赖云端、不依赖 LLM，全部为确定性的本地计算，保证在微信小程序里即时响应。

import type { IResourceItem, ResourceType } from '../../../types/index';

/* ============================================================
 * 1. 主题词典（关键信息提取规则，由分析人工资料归纳而来）
 * ============================================================
 * 每条人工资料本质是「某个 (公司 × 轮次) 的考点/框架/坑/建议」。
 * 这里把这些隐含主题抽象成可机器命中的词典——这是「自动提取关键信息」的规则来源。
 * layer 对应人工总结的四层框架，汇总时按此排序。
 */
export type TopicLayer = '方法论' | '公司专项' | '专业深度' | '实战';

export interface TopicDef {
  key: string;
  label: string;
  /** 命中词：标题/正文/标签任一包含即归到该主题 */
  aliases: string[];
  layer: TopicLayer;
}

export const TOPIC_DICT: TopicDef[] = [
  { key: 'rev', label: '收入确认', layer: '专业深度', aliases: ['收入确认', '新收入准则', '五步法', '履约义务', '递延收入', '时段确认', '总额法', '净额法', '主要责任人', '代理人', '确认收入'] },
  { key: 'lease', label: '租赁准则', layer: '专业深度', aliases: ['租赁准则', '使用权资产', '租赁负债', '经营租赁', '融资租赁'] },
  { key: 'goodwill', label: '合并报表与商誉', layer: '专业深度', aliases: ['合并报表', '商誉', '减值测试', '购买法', '权益结合法'] },
  { key: 'dtax', label: '递延所得税', layer: '专业深度', aliases: ['递延所得税', '暂时性差异', '递延所得税资产', '递延所得税负债'] },
  { key: 'wc', label: '营运资金管理', layer: '专业深度', aliases: ['营运资金', '现金转换周期', '应收账款', '存货周转', '应付账款', 'CCC'] },
  { key: 'cost', label: '降本增效/成本', layer: '专业深度', aliases: ['降本增效', '成本管控', '本量利', '标准成本', '差异分析', '成本结构'] },
  { key: 'ic', label: '内控与舞弊', layer: '专业深度', aliases: ['内控', '舞弊', '职业怀疑', '不相容职务', '舞弊三角'] },
  { key: 'audit', label: '审计实务', layer: '专业深度', aliases: ['审计', '监盘', '函证', '实质性程序', '控制测试', '底稿', '四大'] },
  { key: 'tax', label: '税务', layer: '专业深度', aliases: ['增值税', '企业所得税', '进项', '业务招待费', '税务'] },
  { key: 'tools', label: '财务工具(Excel/SQL/BI)', layer: '专业深度', aliases: ['Excel', 'SQL', 'Power BI', 'Tableau', 'BI', '透视表', 'VLOOKUP', 'SUMIFS', 'BI '] },
  { key: 'bank', label: '银行财务', layer: '公司专项', aliases: ['五级分类', '拨备', '净息差', '不良率', '资本充足率', '银行贷款', '银行财务'] },
  { key: 'fintech', label: '金融机构财务', layer: '公司专项', aliases: ['金融资产', '公允价值', 'FVTPL', 'FVOCI', '净资本', '券商', '基金'] },
  { key: 'soe', label: '国企/央企财务', layer: '公司专项', aliases: ['两利四率', '全面预算', '国资', '八项规定', '国企', '央企', '保值增值'] },
  { key: 'ue', label: 'UE模型/单位经济', layer: '公司专项', aliases: ['UE', '单位经济', '单均', '变现率', '履约成本率', 'LTV', 'CAC'] },
  { key: 'case', label: '现场案例/报表速读', layer: '方法论', aliases: ['三张报表', '杜邦', 'ROE', '速读', '案例分析', '现场建模'] },
  { key: 'fs', label: '财务报表分析', layer: '专业深度', aliases: ['财务报表', '资产负债表', '利润表', '现金流量表', '勾稽', '报表分析', '偿债能力', '盈利能力', '营运能力'] },
  { key: 'budget', label: '预算管理', layer: '专业深度', aliases: ['预算', '全面预算', '滚动预算', '预算编制', '两上两下', '经营计划', '预算执行', '预算调整'] },
  { key: 'cash', label: '资金管理', layer: '专业深度', aliases: ['资金', '现金池', '资金计划', '司库', '融资', '外汇', '流动性', '收付', '现金流管理'] },
  { key: 'intro', label: '自我介绍', layer: '实战', aliases: ['自我介绍', '一分钟', '三分钟'] },
  { key: 'salary', label: '谈薪/Offer', layer: '实战', aliases: ['谈薪', '期望薪资', 'offer', '薪酬', '总包', '股票', '比较 offer'] },
  { key: 'resume', label: '简历', layer: '实战', aliases: ['简历', '证书', 'CPA', 'ACCA', '简历模板'] },
  { key: 'timeline', label: '秋招时间线', layer: '实战', aliases: ['时间线', '秋招', '提前批', '春招', '网申', '节点'] },
  { key: 'pressure', label: '压力面/Par面', layer: '方法论', aliases: ['压力面', 'Par面', '合伙人', 'M面', 'Manager', 'par 面'] },
  { key: 'star', label: 'STAR/行为面', layer: '方法论', aliases: ['STAR', '八大问', '行为面', '宝洁', '快消'] }
];

const LAYER_ORDER: Record<TopicLayer, number> = { 方法论: 0, 公司专项: 1, 专业深度: 2, 实战: 3 };
/** 层的 ASCII 别名：WXSS 选择器不支持中文类名，汇总面板按 layerKey 上色 */
export const LAYER_KEYS: Record<TopicLayer, string> = { 方法论: 'method', 公司专项: 'company', 专业深度: 'depth', 实战: 'practice' };

/* ============================================================
 * 2. 分词器（中英混合、CJK 二元 gram）
 * ============================================================ */
const CJK = /[一-龥]/;
const EN = /[a-z0-9+#.]/i;

function isCjk(ch: string): boolean { return CJK.test(ch); }

/**
 * 把一个字符串切成检索词：
 *  - 英文/数字连续段：直接成词（小写）
 *  - 中文：在英文词之间，用二元 gram（相邻两字）补召回，避免要求用户输完整词
 * 返回词数组（不去重，保留频次语义）。
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const n = lower.length;
  let i = 0;
  while (i < n) {
    const ch = lower[i];
    if (EN.test(ch)) {
      let j = i;
      while (j < n && EN.test(lower[j])) j++;
      const w = lower.slice(i, j);
      if (w.length >= 2) tokens.push(w);
      i = j;
    } else if (isCjk(ch)) {
      let j = i;
      while (j < n && isCjk(lower[j])) j++;
      const seg = lower.slice(i, j);
      // 整段作为一词（命中别名用），同时二元 gram 提升部分召回
      if (seg.length >= 2) tokens.push(seg);
      for (let k = i; k < j - 1; k++) tokens.push(lower.slice(k, k + 2));
      i = j;
    } else {
      i++;
    }
  }
  return tokens;
}

/* ============================================================
 * 3. 检索索引（字段加权倒排 + BM25-lite）
 * ============================================================ */
export interface RankedItem {
  item: IResourceItem;
  score: number;
}

/**
 * 单条资源的加权词表：不同字段命中权重不同。
 * 标题/标签/公司/轮次 权重高，正文权重低——与人工标注的重点一致。
 */
function fieldTokens(r: IResourceItem): { term: string; w: number }[] {
  const out: { term: string; w: number }[] = [];
  const push = (text: string, w: number) => {
    for (const t of tokenize(text)) out.push({ term: t, w });
  };
  push(r.title, 3);
  (r.tags || []).forEach((t) => push(t, 2));
  if (r.company) push(r.company, 2);
  if (r.round) push(r.round, 2);
  push(r.category, 2);
  push(r.content, 1);
  return out;
}

export interface LibraryIndex {
  /** 倒排：term -> 文档 id 集合 */
  inv: Map<string, Set<string>>;
  /** 每篇文档的词权重累计 */
  docTf: Map<string, Map<string, number>>;
  /** 文档频率 df */
  df: Map<string, number>;
  n: number;
}

let _indexCache: { corpus: IResourceItem[]; idx: LibraryIndex } | null = null;

function buildIndex(corpus: IResourceItem[]): LibraryIndex {
  const inv = new Map<string, Set<string>>();
  const docTf = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  for (const r of corpus) {
    const tf = new Map<string, number>();
    for (const { term, w } of fieldTokens(r)) {
      tf.set(term, (tf.get(term) || 0) + w);
      if (!inv.has(term)) inv.set(term, new Set());
      (inv.get(term) as Set<string>).add(r._id);
    }
    docTf.set(r._id, tf);
  }
  for (const [, ids] of inv) df.set('', ids.size); // placeholder
  for (const [term, ids] of inv) df.set(term, ids.size);
  return { inv, docTf, df, n: corpus.length };
}

function getIndex(corpus: IResourceItem[]): LibraryIndex {
  if (_indexCache && _indexCache.corpus === corpus) return _indexCache.idx;
  const idx = buildIndex(corpus);
  _indexCache = { corpus, idx };
  return idx;
}

/**
 * BM25-lite 相关性打分：query 词命中倒排即累加 (词权重 × idf)，idf 抑制「的/了」这类常见词。
 * @returns 与输入同序的带分结果（仅在 kw 非空时有意义）。
 */
export function rankItems(corpus: IResourceItem[], kw: string): RankedItem[] {
  const q = (kw || '').trim();
  if (!q) return corpus.map((item) => ({ item, score: 0 }));
  const idx = getIndex(corpus);
  const qTokens = tokenize(q);
  const scored = corpus.map((item) => {
    const tf = idx.docTf.get(item._id) || new Map<string, number>();
    let score = 0;
    for (const t of qTokens) {
      const idf = Math.log((idx.n + 1) / ((idx.df.get(t) || 0) + 1)) + 1;
      score += (tf.get(t) || 0) * idf;
    }
    return { item, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
}

/* ============================================================
 * 4. 自动主题抽取（归类）
 * ============================================================ */
export interface ItemTopics {
  topics: TopicDef[];
  /** 命中的原始标签（补充主题词典未覆盖的长尾） */
  rawTags: string[];
}

/** 给定一条资料，自动抽取它属于哪些主题（词典命中）与哪些原始标签 */
export function autoTopics(r: IResourceItem): ItemTopics {
  const hay = `${r.title} ${(r.tags || []).join(' ')} ${r.content} ${r.company || ''} ${r.round || ''}`.toLowerCase();
  const topics: TopicDef[] = [];
  for (const td of TOPIC_DICT) {
    if (td.aliases.some((a) => hay.indexOf(a.toLowerCase()) >= 0)) topics.push(td);
  }
  return { topics, rawTags: r.tags || [] };
}

/** 仅取主题 key 集合（供筛选/汇总使用） */
export function topicKeysOf(r: IResourceItem): Set<string> {
  return new Set(autoTopics(r).topics.map((t) => t.key));
}

/* ============================================================
 * 5. 自动结构化汇总（继承并自动化人工的四层框架）
 * ============================================================ */
export interface SummaryTopic {
  key: string;
  label: string;
  layer: TopicLayer;
  /** 层的 ASCII 别名，用于 WXSS 选择器（避免中文类名导致编译失败） */
  layerKey: string;
  count: number;
  itemIds: string[];
  /** 该主题下最具代表性的一条结论摘录 */
  sample: string;
}

export interface KeyPoint {
  id: string;
  title: string;
  point: string;
}

export interface LibrarySummary {
  /** 当前筛选范围的人类可读描述，如「财务 · 一面」 */
  scopeLabel: string;
  total: number;
  byType: { qa: number; resume: number; experience: number };
  byCompany: { key: string; count: number }[];
  byRound: { key: string; count: number }[];
  /** 高频主题 Top8（按命中数，主题内的层序在前） */
  topics: SummaryTopic[];
  /** 全部命中主题（含低频，按层序 + 频次），供主题 chips 复用，避免二次遍历全量资料 */
  allTopics: { key: string; label: string; layer: TopicLayer; layerKey: string; count: number }[];
  /** 推荐阅读顺序（先方法论/通用，再公司专项，再专业深度，最后实战） */
  readingOrder: string[];
  /** 核心结论摘录（取 Top6 条资料的「首点/首句」） */
  keyPoints: KeyPoint[];
}

/** 取正文第一条带编号要点，或首句（截断到 ~46 字），作为「核心结论」摘录 */
export function firstPoint(content: string): string {
  if (!content) return '';
  const m = content.match(/[①-⑨⑩]\s*([^。；！？]{4,46})/);
  if (m) return m[1].trim();
  const end = content.indexOf('。');
  const seg = end > 0 ? content.slice(0, Math.min(end, 46)) : content.slice(0, 46);
  return seg.replace(/\s+/g, '').trim();
}

function layerOf(r: IResourceItem): number {
  const ks = topicKeysOf(r);
  let min = 3;
  for (const td of TOPIC_DICT) {
    if (ks.has(td.key)) min = Math.min(min, LAYER_ORDER[td.layer]);
  }
  // 无主题命中时：有公司名算公司专项，否则按类型（简历/offer 偏实战）
  if (min === 3) {
    if (r.company) return 1;
    if (r.type === 'resume' || r.round === 'HR面') return 3;
  }
  return min;
}

/**
 * 对一组已筛选资料生成结构化摘要。这是「自动汇总」的核心：
 * 它复刻了人工总结的四层框架（方法论→公司→专业→实战）与结构化输出（高频主题+核心结论+阅读顺序），
 * 但由代码在任意筛选下即时生成，无需人工逐条归纳。
 */
export function summarize(
  items: IResourceItem[],
  scopeLabel = '全部资料'
): LibrarySummary {
  const total = items.length;
  const byType = { qa: 0, resume: 0, experience: 0 };
  const companyCount = new Map<string, number>();
  const roundCount = new Map<string, number>();
  const topicHits = new Map<string, { def: TopicDef; ids: string[] }>();

  for (const r of items) {
    byType[r.type as ResourceType] = (byType[r.type as ResourceType] || 0) + 1;
    if (r.company) companyCount.set(r.company, (companyCount.get(r.company) || 0) + 1);
    if (r.round) roundCount.set(r.round, (roundCount.get(r.round) || 0) + 1);
    for (const td of autoTopics(r).topics) {
      if (!topicHits.has(td.key)) topicHits.set(td.key, { def: td, ids: [] });
      (topicHits.get(td.key) as { def: TopicDef; ids: string[] }).ids.push(r._id);
    }
  }

  const topics: SummaryTopic[] = Array.from(topicHits.entries())
    .map(([key, v]) => ({
      key,
      label: v.def.label,
      layer: v.def.layer,
      layerKey: LAYER_KEYS[v.def.layer],
      count: v.ids.length,
      itemIds: v.ids,
      sample: firstPoint((items.find((x) => x._id === v.ids[0]) || { content: '' }).content)
    }))
    .sort((a, b) => (LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]) || (b.count - a.count))
    .slice(0, 8);

  const allTopics = Array.from(topicHits.entries())
    .map(([key, v]) => ({ key, label: v.def.label, layer: v.def.layer, layerKey: LAYER_KEYS[v.def.layer], count: v.ids.length }))
    .sort((a, b) => (LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]) || (b.count - a.count));

  const byCompany = Array.from(companyCount.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const byRound = Array.from(roundCount.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  const readingOrder = [...items]
    .sort((a, b) => layerOf(a) - layerOf(b))
    .map((r) => r._id);

  const keyPoints: KeyPoint[] = readingOrder
    .slice(0, 6)
    .map((id) => {
      const r = items.find((x) => x._id === id);
      if (!r) return null as unknown as KeyPoint;
      return { id, title: r.title, point: firstPoint(r.content) };
    })
    .filter(Boolean);

  return { scopeLabel, total, byType, byCompany, byRound, topics, allTopics, readingOrder, keyPoints };
}
