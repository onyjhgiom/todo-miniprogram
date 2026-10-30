// utils/guaxiang.ts
// 卦象引擎：起卦 → 动爻 → 变卦 → 结合心境生成人生疏导
// 纯本地计算，无网络、无隐私采集。所有现代疏导文字过敏感词；古籍原文原样呈现。
// 合规边界：本引擎只做《周易》哲理科普与心理疏导，不预测吉凶、不断言祸福、不提供命理测算。

import {
  TRIGRAMS,
  HEXAGRAMS,
  LINE_POSITIONS,
  MOODS,
  Hexagram,
  Mood,
  Trigram
} from './guaxiang-data';
import { sanitize } from './folklore';

/* ============================== 基础查询 ============================== */

const TRIGRAM_MAP: { [key: string]: Trigram } = {};
TRIGRAMS.forEach((t) => { TRIGRAM_MAP[t.key] = t; });

/** 取八卦（按 key） */
export function getTrigram(key: string): Trigram {
  return TRIGRAM_MAP[key] || TRIGRAMS[0];
}

/** 六爻爻线：自下而上，1=阳 0=阴 */
export function hexLines(hex: Hexagram): number[] {
  const lower = getTrigram(hex.lower).lines;
  const upper = getTrigram(hex.upper).lines;
  return lower.concat(upper);
}

/** 爻线 → 卦（用于反查本卦、变卦） */
const HEX_BY_LINES: { [key: string]: Hexagram } = {};
HEXAGRAMS.forEach((h) => {
  const key = hexLines(h).join('');
  if (!HEX_BY_LINES[key]) HEX_BY_LINES[key] = h;
});

export function findByLines(lines: number[]): Hexagram | undefined {
  return HEX_BY_LINES[lines.join('')];
}

export function findByNum(num: number): Hexagram {
  return HEXAGRAMS.find((h) => h.num === num) || HEXAGRAMS[0];
}

/** 上卦 / 下卦名，如「水雷屯」的上下卦自然象 */
export function hexNature(hex: Hexagram): { upper: string; lower: string } {
  return {
    upper: getTrigram(hex.upper).nature,
    lower: getTrigram(hex.lower).nature
  };
}

/* ============================== 起卦 ============================== */

export interface CastResult {
  /** 六爻，自下而上，1=阳 0=阴 */
  lines: number[];
  /** 动爻位（1-6，自下而上），可为空 */
  moving: number[];
}

/** 先天八卦数：乾1 兑2 离3 震4 巽5 坎6 艮7 坤8 */
function numToTrigram(n: number): Trigram {
  let idx = n % 8;
  if (idx === 0) idx = 8;
  return TRIGRAMS[idx - 1];
}

/**
 * 铜钱起卦：模拟三枚铜钱掷六次。
 * 三枚取值 2(阴)/3(阳)，和为 6 老阴、7 少阳、8 少阴、9 老阳；6、9 为动爻。
 */
export function castByCoins(): CastResult {
  const lines: number[] = [];
  const moving: number[] = [];
  for (let i = 0; i < 6; i++) {
    // 阳的个数 0~3 → 和 6/7/8/9
    const yangCount = Math.floor(Math.random() * 4);
    const sum = 6 + yangCount;
    if (sum === 6) {
      lines.push(0);
      moving.push(i + 1);
    } else if (sum === 7) {
      lines.push(1);
    } else if (sum === 8) {
      lines.push(0);
    } else {
      lines.push(1);
      moving.push(i + 1);
    }
  }
  return { lines, moving };
}

/** 数字起卦：两数定上下卦，和定动爻 */
export function castByNumbers(a: number, b: number): CastResult {
  const upper = numToTrigram(a);
  const lower = numToTrigram(b);
  const lines = lower.lines.concat(upper.lines);
  let m = (a + b) % 6;
  if (m === 0) m = 6;
  return { lines, moving: [m] };
}

/** 时间起卦：以公历年月日时推算（同一时辰所得相同） */
export function castByTime(d: Date = new Date()): CastResult {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours();
  const upper = numToTrigram(year + month + day);
  const lower = numToTrigram(year + month + day + hour);
  const lines = lower.lines.concat(upper.lines);
  let m = (year + month + day + hour) % 6;
  if (m === 0) m = 6;
  return { lines, moving: [m] };
}

/** 随缘起卦 */
export function castByRandom(): CastResult {
  return castByNumbers(
    Math.floor(Math.random() * 100) + 1,
    Math.floor(Math.random() * 100) + 1
  );
}

/** 变卦：动爻阴阳互变 */
export function transformLines(lines: number[], moving: number[]): number[] {
  const out = lines.slice();
  moving.forEach((m) => {
    const i = m - 1;
    if (i >= 0 && i < 6) out[i] = out[i] === 1 ? 0 : 1;
  });
  return out;
}

/* ============================== 展示结构 ============================== */

export interface DisplayLine {
  /** yang=阳爻实线，yin=阴爻断线 */
  type: 'yang' | 'yin';
  /** 是否为动爻 */
  moving: boolean;
  /** 爻位名（自下而上） */
  posName: string;
  /** 爻序号（自下而上 1-6） */
  index: number;
}

/** 生成自上而下的爻线数组（便于页面从上往下画卦） */
export function toDisplayLines(lines: number[], moving: number[] = []): DisplayLine[] {
  const out: DisplayLine[] = [];
  for (let i = 5; i >= 0; i--) {
    out.push({
      type: lines[i] === 1 ? 'yang' : 'yin',
      moving: moving.indexOf(i + 1) >= 0,
      posName: LINE_POSITIONS[i] ? LINE_POSITIONS[i].name : `第${i + 1}爻`,
      index: i + 1
    });
  }
  return out;
}

export interface Reading {
  /** 本卦 */
  ben: Hexagram;
  benLines: DisplayLine[];
  benCi: string;
  benXiang: string;
  benPhilosophy: string;
  /** 动爻提示（可能为空） */
  movingTips: { name: string; hint: string }[];
  /** 变卦（无动爻则为 null） */
  bian: Hexagram | null;
  bianLines: DisplayLine[];
  bianPhilosophy: string;
  /** 心境 */
  mood: Mood | null;
  moodOpener: string;
  moodTip: string;
  /** 疏导与建议（已过敏感词） */
  guide: string;
  advice: string;
  keywords: string[];
}

/**
 * 合成解读：本卦 + 动爻 + 变卦 + 心境 → 人生疏导
 * 古籍原文（卦辞/象传）不过滤；现代疏导文字全部过 sanitize。
 */
export function buildReading(cast: CastResult, moodKey?: string): Reading {
  const ben = findByLines(cast.lines) || HEXAGRAMS[0];
  const bianLinesRaw = cast.moving.length ? transformLines(cast.lines, cast.moving) : [];
  const bian = bianLinesRaw.length ? findByLines(bianLinesRaw) || null : null;
  const mood = moodKey ? MOODS.find((m) => m.key === moodKey) || null : null;

  const movingTips = cast.moving.map((m) => {
    const p = LINE_POSITIONS.find((x) => x.index === m);
    return {
      name: p ? p.name : `第${m}爻`,
      hint: p ? sanitize(p.hint) : ''
    };
  });

  return {
    ben,
    benLines: toDisplayLines(cast.lines, cast.moving),
    benCi: ben.ci,
    benXiang: ben.xiang,
    benPhilosophy: sanitize(ben.philosophy),
    movingTips,
    bian,
    bianLines: bian ? toDisplayLines(bianLinesRaw) : [],
    bianPhilosophy: bian ? sanitize(bian.philosophy) : '',
    mood,
    moodOpener: mood ? sanitize(mood.opener) : '',
    moodTip: mood ? sanitize(mood.tip) : '',
    guide: sanitize(ben.guide),
    advice: sanitize(ben.advice),
    keywords: ben.keywords.map((k) => sanitize(k))
  };
}

/** 按卦序直接查看（卦象速查用） */
export function buildReadingByNum(num: number, moodKey?: string): Reading {
  const hex = findByNum(num);
  return buildReading({ lines: hexLines(hex), moving: [] }, moodKey);
}

/** 导出为纯文本（复制/分享用） */
export function readingToText(r: Reading): string {
  const lines: string[] = [];
  lines.push(`【${r.ben.fullName}·${r.ben.name}卦】`);
  lines.push(`卦辞（古籍原文）：${r.benCi}`);
  lines.push(`象传（古籍原文）：象曰：${r.benXiang}`);
  lines.push(`卦意今解：${r.benPhilosophy}`);
  if (r.movingTips.length) {
    lines.push(`动爻：${r.movingTips.map((t) => t.name).join('、')}`);
    r.movingTips.forEach((t) => lines.push(`　${t.name}：${t.hint}`));
  }
  if (r.bian) {
    lines.push(`变卦：${r.bian.fullName}——${r.bianPhilosophy}`);
  }
  if (r.mood) {
    lines.push(`心境·${r.mood.label}：${r.moodOpener}`);
    lines.push(`　${r.moodTip}`);
  }
  lines.push(`人生疏导：${r.guide}`);
  lines.push(`可行之法：${r.advice}`);
  lines.push(`关键词：${r.keywords.join(' / ')}`);
  return lines.join('\n');
}

export { HEXAGRAMS, MOODS, LINE_POSITIONS };
