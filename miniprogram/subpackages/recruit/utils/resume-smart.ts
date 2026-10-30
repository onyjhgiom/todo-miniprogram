// utils/resume-smart.ts
// 简历「岗位智能匹配 + 本地结构化提炼」层。
//
// 定位：夹在「用户填的内容」与「生成排版」之间，负责回答三个问题：
//   1. 目标岗位到底要什么（关键词抽取）
//   2. 我的简历命中了多少、缺了什么（匹配报告 + 覆盖率）
//   3. 怎么把我已有的经历摆得更贴合岗位（按相关度重排，只排序不改写）
//
// 铁律（与 resume-adapt 一致）：
//   - 不新增、不虚构、不夸大任何事实：本地只做「排序 / 清洗 / 提示」；
//   - 措辞改写一律交给云端模型（云函数 resume action=enhance），本地绝不把「做了」改成「主导」；
//   - 缺失的关键词只给「怎么补」的建议，绝不替用户编一条经历出来。

import type { ResumeItem, ResumeProfile, ResumeSection } from './resume-doc';

/** 岗位上下文：目标岗位名 + 关键词（来自求职意向 / 投递 JD / 用户粘贴的 JD） */
export interface SmartJob {
  target: string;
  keywords: string[];
}

/* ==================== 1. 关键词抽取 ==================== */

/**
 * 领域词库：中文岗位描述里「成词」的技术 / 业务关键词。
 * 为什么用词库而不是无脑切词：中文 2 字滑窗会切出大量噪音词（如「工作经」「历要求」），
 * 直接拿去匹配会得出毫无意义的「命中」；词库命中才可靠，且能识别「MySQL」「Redis」这类整词。
 */
const KEYWORD_DICT: string[] = [
  // 语言 / 基础
  'Java', 'Go', 'Golang', 'Python', 'C++', 'JavaScript', 'TypeScript', 'Kotlin', 'Swift', 'Rust', 'C#', 'SQL', 'HTML', 'CSS', 'Shell',
  // 后端
  'Spring', 'Spring Boot', 'MyBatis', 'MySQL', 'PostgreSQL', 'Redis', 'MongoDB', 'Kafka', 'RabbitMQ', 'RocketMQ',
  'RPC', 'Dubbo', 'gRPC', 'Nginx', 'Docker', 'Kubernetes', 'K8s', '微服务', '分布式', '高并发', '高可用',
  '缓存', '消息队列', '索引', '事务', '锁', '线程池', 'JVM', '限流', '熔断', '降级', '分库分表', '读写分离',
  // 前端
  'Vue', 'React', 'Angular', 'Vite', 'Webpack', 'Node.js', '小程序', 'H5', '响应式', '组件化', '性能优化', '首屏', '埋点',
  // 算法 / 数据
  'PyTorch', 'TensorFlow', '机器学习', '深度学习', 'NLP', 'CV', '推荐系统', 'CTR', '大模型', 'LLM', 'RAG', 'Agent',
  '特征工程', 'A/B', 'ABTest', '假设检验', '回归', '聚类', '时序', 'Transformer', '微调', 'LoRA', '向量召回',
  'Hive', 'Spark', 'Flink', 'Hadoop', '数仓', '维度建模', 'ETL', 'Airflow', 'ClickHouse', 'Doris',
  // 数据 / 分析工具
  'Excel', 'Tableau', 'Power BI', 'pandas', 'sklearn', 'NumPy', '指标体系', '漏斗分析', '用户增长', '留存', '看板', '数据驱动',
  // 测试 / 运维
  '自动化测试', 'pytest', 'Appium', 'Selenium', 'JMeter', 'Postman', 'CI/CD', 'Jenkins', 'GitLab', 'Linux',
  'Prometheus', 'Grafana', 'ELK', 'Ansible', '监控告警', 'SRE', '故障排查', '容量规划', '压测',
  // 客户端 / 嵌入式
  'Android', 'iOS', 'Flutter', 'Compose', 'SwiftUI', 'OC', '组件化', '包体积', '内存优化', '启动优化',
  'STM32', 'FreeRTOS', 'RTOS', '嵌入式', '驱动', 'CAN', 'I2C', 'SPI', 'UART', 'OTA',
  // 产品 / 运营
  '需求分析', '竞品分析', '用户调研', '原型', 'PRD', 'Axure', 'Figma', 'Sketch', '增长', '转化',
  '活动策划', '社群运营', '内容运营', '用户分层', 'DAU', 'MAU', 'GMV', 'ROI', '投放', '复盘', 'SOP', '项目管理',
  // 通用职能
  '财务分析', '预算', '成本核算', '审计', 'CPA', 'ACCA', '税法', '报表', '三表联动',
  '招聘', '绩效', '薪酬', '劳动法', '组织发展', '培训', '员工关系',
  '供应链', '采购', '库存', '物流', '交付', '供应商管理', 'ERP', 'WMS',
  '法务', '合同审核', '合规', '诉讼', '知识产权', '风险',
  '教学设计', '班级管理', '教师资格', '课程研发', '教研',
  // 通用能力
  '沟通能力', '抗压能力', '团队合作', '学习能力', '自驱', '责任心', 'owner 意识', '英语', 'CET-6', '雅思', '托福'
];

/** 英文噪音词（抽取英文 token 时剔除） */
const STOP_EN = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'are', 'will', 'can', 'has', 'have', 'job', 'work', 'team',
  'this', 'that', 'from', 'your', 'who', 'what', 'how', 'all', 'any', 'not', 'but', 'its', 'was', 'were',
  'http', 'https', 'www', 'com', 'cn', 'org'
]);

/** 归一化：小写 + 去分隔符，用于「包含匹配」时忽略大小写与连字符差异 */
function norm(s: string): string {
  return String(s || '').toLowerCase().replace(/[\s_\-·、,，.。;；:：/\\()（）[\]【】]/g, '');
}

/**
 * 从 JD 文本 / 岗位名中抽取关键词（匹配专用）。
 * 与 recruit-store 的 extractKeywords 分工不同：那个按词频统计存进投递卡（会带 n-gram 噪音），
 * 这个只认「成词」，因为要拿去和简历做命中比对 —— 噪音词会让覆盖率虚高、结论失真。
 * 顺序：词库命中（最可靠）→ 英文 token。
 */
export function extractJobKeywords(raw: string, limit = 24): string[] {
  const text = String(raw || '');
  if (!text.trim()) return [];
  const lower = text.toLowerCase();
  const nk = norm(text);
  const out: string[] = [];
  const push = (w: string) => {
    const v = String(w || '').trim();
    if (!v || out.indexOf(v) >= 0) return;
    out.push(v);
  };

  // 1) 领域词库命中（长词优先，避免「Java 开发」只命中 Java 而漏掉更完整的表述）
  const dict = KEYWORD_DICT.slice().sort((a, b) => b.length - a.length);
  for (const w of dict) {
    if (nk.indexOf(norm(w)) >= 0) push(w);
    if (out.length >= limit) break;
  }

  // 2) 英文 token（技术名词常以英文出现，词库覆盖不全时兜底）
  const tokens = lower.match(/[a-z][a-z0-9+#.]{1,}/g) || [];
  for (const t of tokens) {
    if (t.length < 2 || STOP_EN.has(t)) continue;
    // 已被词库以原始大小写收录的不再重复（如 java / Java）
    if (out.some((w) => w.toLowerCase() === t)) continue;
    push(t);
    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}

/* ==================== 2. 匹配计算 ==================== */

/** 单条经历命中的关键词 */
export function hitWordsOf(it: ResumeItem, keywords: string[]): string[] {
  const text = [it.primary, it.secondary, it.meta].concat(it.bullets || []).join(' ');
  const ntext = norm(text);
  const out: string[] = [];
  for (const k of keywords) {
    const nk = norm(k);
    if (nk.length < 2) continue;
    if (ntext.indexOf(nk) >= 0) out.push(k);
  }
  return out;
}

/** 相关度打分：命中词越长越值钱（4 字以上记 2 分），命中条数越多分越高 */
export function scoreOf(it: ResumeItem, keywords: string[]): number {
  const hits = hitWordsOf(it, keywords);
  let s = 0;
  for (const h of hits) s += norm(h).length >= 4 ? 2 : 1;
  return s;
}

export type RelLevel = 'high' | 'mid' | 'low' | 'none';

export function levelOf(score: number): RelLevel {
  if (score >= 4) return 'high';
  if (score >= 2) return 'mid';
  if (score >= 1) return 'low';
  return 'none';
}

export const LEVEL_TEXT: Record<RelLevel, string> = {
  high: '高度相关',
  mid: '相关',
  low: '弱相关',
  none: '未命中'
};

export interface RankedExp {
  /** 稳定唯一标识（模块 key + 下标），可直接当 wxml 的 wx:key */
  id: string;
  /** 所属模块 key（edu / intern / proj …） */
  secKey: string;
  /** 模块内的条目下标（用于页面写回排序） */
  idx: number;
  primary: string;
  secondary: string;
  score: number;
  level: RelLevel;
  levelText: string;
  hitWords: string[];
}

export interface KeywordHit {
  word: string;
  count: number;
}

export interface MatchReport {
  /** 目标岗位 */
  target: string;
  /** 参与匹配的关键词 */
  keywords: string[];
  /** 简历已命中的关键词（按命中次数降序） */
  hits: KeywordHit[];
  /** JD 里有、简历里没有的关键词 */
  gaps: string[];
  /** 覆盖率 0-100 */
  coverage: number;
  /** 每段经历的相关度（含排序所需下标） */
  ranked: RankedExp[];
  /** 最值得突出的 3 段经历 */
  highlights: RankedExp[];
  /** 针对缺失关键词的「怎么补」建议（只提示，不代写） */
  tips: string[];
  /** 是否为「无岗位上下文」状态（此时只做展示，不做裁剪/重排） */
  noContext: boolean;
}

/**
 * 生成匹配报告。
 * 无关键词时 noContext=true：此时不该给「覆盖率 0%」这种吓人的结论，也不做任何排序建议。
 */
export function matchReport(p: ResumeProfile, job: SmartJob): MatchReport {
  const keywords = (job.keywords || []).filter((k) => norm(k).length >= 2);
  const items: { secKey: string; idx: number; it: ResumeItem }[] = [];
  (p.sections || []).forEach((s) => {
    (s.items || []).forEach((it, idx) => items.push({ secKey: s.key, idx, it }));
  });

  const ranked: RankedExp[] = items
    .map((x) => {
      const score = keywords.length ? scoreOf(x.it, keywords) : 0;
      const level = levelOf(score);
      return {
        id: `${x.secKey}#${x.idx}`,
        secKey: x.secKey,
        idx: x.idx,
        // 没填主标题的经历也要能在「最值得突出」列表里认出来，否则用户看到一片空白
        primary: x.it.primary || x.it.secondary || '（未命名经历）',
        secondary: x.it.secondary || '',
        score,
        level,
        levelText: LEVEL_TEXT[level],
        hitWords: keywords.length ? hitWordsOf(x.it, keywords) : []
      };
    })
    .sort((a, b) => b.score - a.score);

  // 命中统计：按「出现在几条经历里」计数，比全文出现次数更能反映「这条关键词有没有被撑起来」
  const hitMap: Record<string, number> = {};
  for (const r of ranked) for (const w of r.hitWords) hitMap[w] = (hitMap[w] || 0) + 1;
  // 技能 / 自我评价这类纯文本段落也算命中
  const extra = (p.sections || [])
    .filter((s) => s.text)
    .map((s) => norm(s.text || ''))
    .join(' ');
  for (const k of keywords) {
    if (hitMap[k]) continue;
    if (extra && extra.indexOf(norm(k)) >= 0) hitMap[k] = 1;
  }

  const hits = Object.keys(hitMap)
    .map((w) => ({ word: w, count: hitMap[w] }))
    .sort((a, b) => b.count - a.count);
  const gaps = keywords.filter((k) => !hitMap[k]);
  const coverage = keywords.length ? Math.round((hits.length / keywords.length) * 100) : 0;

  const tips: string[] = [];
  if (gaps.length) {
    tips.push(
      `简历里还没出现「${gaps.slice(0, 5).join('、')}」${
        gaps.length > 5 ? ` 等 ${gaps.length} 个关键词` : ''
      }：如果你确实做过，挑最硬的一段按「场景 + 动作 + 量化结果」写一条；没做过就不要硬凑。`
    );
  }
  const weak = ranked.filter((r) => r.score > 0 && r.level === 'low').length;
  if (weak) tips.push(`有 ${weak} 段经历只是弱相关：把要点里和「${job.target || '目标岗位'}」最贴的那条挪到第一条，HR 第一眼看到的就是它。`);
  if (!hits.length && keywords.length) {
    tips.push('一个关键词都没命中：先确认目标岗位是否填对，或把岗位 JD 粘进来重新抽词（关键词错了，后面所有排序都会跑偏）。');
  }
  const noQuant = ranked.length && !ranked.some((r) => /\d/.test(r.hitWords.join('')));
  if (noQuant) tips.push('要点里缺少数字：同义词命中不等于说服力，补上「提升 40%」「缩短 2 天」这类可核验的结果。');

  return {
    target: job.target || '',
    keywords,
    hits,
    gaps,
    coverage,
    ranked,
    highlights: ranked.filter((r) => r.score > 0).slice(0, 3),
    tips,
    noContext: keywords.length === 0
  };
}

/* ==================== 3. 按岗位重排（只排序，不改写） ==================== */

/**
 * 把命中最多的要点排到最前，其余保持原顺序（稳定排序）。
 * 这是「突出相关经历」最安全的一步：一个字都不改，只是让最相关的那条先被看到。
 */
export function reorderBullets(bullets: string[], keywords: string[]): string[] {
  const list = (bullets || []).slice();
  if (!keywords.length) return list;
  return list
    .map((b, i) => ({ b, i, s: scoreOf({ primary: '', bullets: [b] }, keywords) }))
    .sort((a, x) => (x.s - a.s) || (a.i - x.i))
    .map((x) => x.b);
}

/**
 * 结构化重排：按相关度重排每段经历内的要点，并按相关度重排模块内的条目顺序。
 * 契约：不新增、不改写、不删除任何文字；只调整顺序。
 */
export function smartArrange(p: ResumeProfile, job: SmartJob): { sections: ResumeSection[]; notes: string[] } {
  const notes: string[] = [];
  const keywords = (job.keywords || []).filter((k) => norm(k).length >= 2);

  const sections: ResumeSection[] = (p.sections || []).map((s) => {
    const out: ResumeSection = { key: s.key, title: s.title };
    if (s.text) out.text = s.text;
    if (s.images && s.images.length) out.images = s.images;
    if (!s.items || !s.items.length) return out;

    const decorated = s.items.map((it, idx) => ({
      it,
      idx,
      score: keywords.length ? scoreOf(it, keywords) : 0
    }));
    // 有明确岗位上下文时才按相关度排序；否则保持用户自己排的顺序（不擅自改动）
    const ordered = keywords.length
      ? decorated.slice().sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
      : decorated;

    out.items = ordered.map((x) => ({
      ...x.it,
      bullets: keywords.length ? reorderBullets(x.it.bullets || [], keywords) : (x.it.bullets || [])
    }));
    return out;
  });

  if (keywords.length) {
    const moved = sections.reduce((n, s) => {
      const scores = (s.items || []).map((it) => scoreOf(it, keywords));
      // 只要存在「前面分数低于后面」的情况，就说明顺序真的被改动过
      let c = 0;
      for (let i = 0; i < scores.length - 1; i++) if (scores[i] < scores[i + 1]) c++;
      return n + c;
    }, 0);
    if (moved) notes.push(`已把 ${moved} 处相关经历前置，命中「${job.target || '目标岗位'}」的要点排到了最前`);
    else notes.push('经历顺序已是最优（相关度高的本就在前面）');
  }

  return { sections, notes };
}

/* ==================== 4. 本地清洗（保守） ==================== */

/** 口语 / 冗余词清理：只删「明显口水话」，不动任何事实与数据 */
const FILLER = /(然后|还有就是|反正|就是说|差不多|大概也许|各种各样的|一些一些)/g;

/** 标点规范：中文后用中文标点、英文数字间补空格、去掉重复标点 */
export function tidyBullet(s: string): string {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.replace(FILLER, '');
  // 中文与英文 / 数字之间补一个空格（可读性，不改变语义）
  t = t.replace(/([\u4e00-\u9fa5])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([\u4e00-\u9fa5])/g, '$1 $2');
  // 重复标点收敛
  t = t.replace(/[。.]{2,}/g, '。').replace(/[，,]{2,}/g, '，');
  // 结尾无标点时补句号（简历惯例：要点以句号收尾更整齐）
  if (!/[。；;！!？?]$/.test(t)) t += '。';
  return t.trim();
}

/** 逐条清洗要点；返回是否发生过变化（用于提示用户「规范了 N 条」） */
export function tidyProfile(p: ResumeProfile): { profile: ResumeProfile; changed: number } {
  let changed = 0;
  const sections = (p.sections || []).map((s) => {
    const out: ResumeSection = { key: s.key, title: s.title };
    if (s.text) {
      const t = tidyBullet(s.text).replace(/。$/, '');
      if (t !== s.text) changed++;
      out.text = t;
    }
    if (s.images && s.images.length) out.images = s.images;
    if (s.items) {
      out.items = s.items.map((it) => {
        const bullets = (it.bullets || []).map((b) => {
          const t = tidyBullet(b);
          if (t !== b) changed++;
          return t;
        });
        return { ...it, bullets };
      });
    }
    return out;
  });
  return { profile: { ...p, sections }, changed };
}
