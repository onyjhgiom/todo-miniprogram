// utils/folklore.ts
// 国风民俗功能 · 合规底座
// 全部内容定位为「中国传统民俗文化科普」，不含命理测算、吉凶推断、人生/决策指导。
// 本文件提供：固定免责声明、敏感词拦截、结果包装助手，供所有模块页与分享卡片复用。

/** 短免责（结果卡内、分享标题后缀） */
export const DISCLAIMER_SHORT = '纯属娱乐，请勿过度相信；传统民俗文化科普，不代表人生定论';

/** 完整免责（页面底部永久固定） */
export const DISCLAIMER_FULL =
  '本功能为中国传统民俗文化科普，纯属娱乐行为，请勿过度相信，更不要据此做出任何现实决策。' +
  '内容属于传统文化趣味体验，不构成任何人生、决策、运势、健康或投资建议。';

/**
 * 敏感词拦截清单：任何生成结果命中即替换为「·」，从源头规避违规表述。
 * 命中词均为算命/改运/避灾/招财/吉凶祸福/精准测算类违规词汇。
 */
const SENSITIVE_WORDS: string[] = [
  '算命', '卜卦', '占卜', '占卦', '改运', '转运', '避灾', '消灾', '破煞', '挡煞', '化煞',
  '招财', '聚财', '旺财', '破财', '吉凶', '祸福', '命运注定', '命中注定', '前程',
  '批八字', '看相算命', '风水化煞', '趋吉避凶', '旺夫', '克夫', '克妻', '克子',
  '血光', '大凶', '大吉', '宜嫁娶', '忌出行', '命格', '八字精批', '取名打分',
  '姓名打分', '面相算命', '手相算命', '消业', '还阴债'
];

/** 对单段文本做敏感词替换（不修改原意，仅剔除违规词） */
export function sanitize(input: string): string {
  if (!input) return input;
  let out = input;
  for (const w of SENSITIVE_WORDS) {
    if (out.indexOf(w) >= 0) out = out.split(w).join('·');
  }
  return out;
}

export interface FolkloreBlock {
  /** 小标题（如「文化意象」「古籍原文」），可空 */
  label?: string;
  /** 正文 */
  text: string;
  /** 国风引言 / 古籍引文，可空 */
  quote?: string;
}

export interface FolkloreResult {
  title: string;
  blocks: FolkloreBlock[];
}

/** 生成结果前统一过审：过滤敏感词 + 保证结尾免责 */
export function buildResult(input: FolkloreResult): FolkloreResult {
  return {
    title: sanitize(input.title),
    blocks: input.blocks.map((b) => ({
      label: b.label ? sanitize(b.label) : undefined,
      text: sanitize(b.text),
      quote: b.quote ? sanitize(b.quote) : undefined
    }))
  };
}

/** 给分享标题追加短免责，保证分享卡片自带提示 */
export function shareTitle(base: string): string {
  return `${base}｜${DISCLAIMER_SHORT}`;
}
