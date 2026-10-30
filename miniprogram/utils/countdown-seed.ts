// utils/countdown-seed.ts
// 倒数日示例数据（12 条，与高保真设计稿一一对应）
//
// 首次进入倒数日且本地没有任何事件时，自动写入这批示例，
// 让首屏就是「有内容的样子」而不是空白。
// 设计稿的两套风格各用一组专属封面（A 风 a1-a6 / B 风 b1-b6），
// 与 seedA / seedB 的照片字段严格对应。

import type { CdEvent, CdCategory, CdEmotion } from './countdown-types';

/** 把「距今 n 天」转成 'YYYY-MM-DD 09:00'（负数=过去） */
function dateFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 09:00`;
}

export interface SeedDef {
  title: string;
  /** 一句话描述（可为两行，用 \n 分隔） */
  note: string;
  /** 距今天数，负数表示过去 */
  days: number;
  category: CdCategory;
  emotion: CdEmotion;
  /** 该风格下的封面文件名（不含路径前缀） */
  cover: string;
  pinned?: boolean;
  fav?: boolean;
}

/** 手账风示例：A 风专属封面 a1~a6，无 emoji、无收藏 */
export const CD_SEED_A: SeedDef[] = [
  { title: '去看樱花',     note: '希望今年能和喜欢的人\n一起看一场樱花。', days: 72,    category: '自定义', emotion: 'expect', cover: 'a1' },
  { title: '高考结束',     note: '那一年，风很轻，\n我们都很自由。',     days: -2162, category: '考试',   emotion: 'memory', cover: 'a2' },
  { title: '和你去看海',   note: '想和你一起看一场\n海边的日出。',       days: 312,   category: '纪念日', emotion: 'expect', cover: 'a3' },
  { title: '再见，我的猫', note: '希望你在另一个世界\n也能被温柔以待。', days: -654,  category: '自定义', emotion: 'regret', cover: 'a4' },
  { title: '第一次写下梦想', note: '从这一天开始，\n我为梦想努力。',      days: -1723, category: '考试',   emotion: 'anniv',  cover: 'a5' },
  { title: '去到喜欢的城市', note: '想去重庆，想去成都，\n想去更多地方。',   days: 449,   category: '旅行',   emotion: 'expect', cover: 'a6' }
];

/** 简洁风示例：B 风专属封面 b1~b6，带 emoji、含置顶与收藏 */
export const CD_SEED_B: SeedDef[] = [
  { title: '去看海的日子',   note: '期待那片蔚蓝的海',           days: 32,    category: '旅行',   emotion: 'expect', cover: 'b1', fav: true },
  { title: '大学毕业',       note: '和青春说再见，向未来出发',   days: 365,   category: '考试',   emotion: 'expect', cover: 'b2', pinned: true },
  { title: '来到这个世界',   note: '感谢所有的相遇与成长',       days: -7300, category: '生日',   emotion: 'anniv',  cover: 'b3' },
  { title: '和喜欢的人见面', note: '我想见你，想和你一起看世界', days: 128,   category: '纪念日', emotion: 'expect', cover: 'b4' },
  { title: '考研上岸',       note: '一切的努力都会有回报',       days: 210,   category: '工作',   emotion: 'expect', cover: 'b5' },
  { title: '遇见更好的自己', note: '慢慢来，你会更好',           days: -120,  category: '自定义', emotion: 'anniv',  cover: 'b6' }
];

/** 封面文件名 → 小程序内路径 */
export function seedCoverPath(file: string): string {
  return `/subpackages/toolbox/assets/countdown/cd-c${file}.jpg`;
}

/**
 * 构建要写入的示例事件数组。
 * @param style 'a' 手账风 / 'b' 简洁风
 */
export function buildSeedEvents(style: 'a' | 'b'): CdEvent[] {
  const defs = style === 'a' ? CD_SEED_A : CD_SEED_B;
  const base = Date.now();
  return defs.map((d, i) => ({
    id: `cd_seed_${style}_${i + 1}`,
    title: d.title,
    target: dateFromNow(d.days),
    // 过去的日子在数据层记为正数日，未来为倒数日
    type: d.days >= 0 ? 'countdown' : 'countup',
    category: d.category,
    note: d.note,
    emotion: d.emotion,
    photo: seedCoverPath(d.cover),
    pinned: !!d.pinned,
    done: false,
    fav: !!d.fav,
    // createTime 递增保证置顶相同时排序稳定
    createTime: base + i
  }));
}

/** 补齐另一种风格的示例（用户切换风格时，若当前是另一批示例则换封面） */
export function reseedCovers(list: CdEvent[], style: 'a' | 'b'): CdEvent[] {
  const map: Record<string, { a: string; b: string }> = {
    a1: { a: 'a1', b: 'b1' }, a2: { a: 'a2', b: 'b2' }, a3: { a: 'a3', b: 'b3' },
    a4: { a: 'a4', b: 'b4' }, a5: { a: 'a5', b: 'b5' }, a6: { a: 'a6', b: 'b6' },
    b1: { a: 'a1', b: 'b1' }, b2: { a: 'a2', b: 'b2' }, b3: { a: 'a3', b: 'b3' },
    b4: { a: 'a4', b: 'b4' }, b5: { a: 'a5', b: 'b5' }, b6: { a: 'a6', b: 'b6' }
  };
  return list.map((e) => {
    const m = /cd-c([ab][1-6])\.jpg$/.exec(e.photo || '');
    if (!m) return e;
    const next = map[m[1]];
    if (!next || next[style] === m[1]) return e;
    return { ...e, photo: seedCoverPath(next[style]) };
  });
}
