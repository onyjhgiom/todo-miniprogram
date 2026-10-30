// utils/astro-data.ts
// 星语星球共享数据：十二星座、运势生成、塔罗 78 牌、雷诺曼 36 牌、冥想主题、知心回复模板
// 所有数据为前端确定性生成（基于日期哈希 + key 哈希），保证同一日期同一星座输出稳定可复现
// 工程为离线环境，无外部星座/牌阵 API；样式数据已在生产素材（assets/astro/*）就位

export interface Zodiac {
  key: string;
  name: string;        // 中文名
  en: string;          // 英文名
  /** 离线素材路径（zodiac/<key>.png） */
  icon: string;
  /** 标识色（用于描述/微光） */
  tint: string;
  /** 元素 */
  element: 'fire' | 'earth' | 'air' | 'water';
  /** 守护星 */
  ruler: string;
  /** 月份起始日 [startMonth, startDay]（简化分组用） */
  range: string;
}

export const ZODIACS: Zodiac[] = [
  { key: 'aries', name: '白羊座', en: 'Aries', icon: '/subpackages/tools/assets/astro/zodiac/aries.png', tint: '#e85d64', element: 'fire', ruler: '火星', range: '3.21–4.19' },
  { key: 'taurus', name: '金牛座', en: 'Taurus', icon: '/subpackages/tools/assets/astro/zodiac/taurus.png', tint: '#d6a05a', element: 'earth', ruler: '金星', range: '4.20–5.20' },
  { key: 'gemini', name: '双子座', en: 'Gemini', icon: '/subpackages/tools/assets/astro/zodiac/gemini.png', tint: '#d6c86e', element: 'air', ruler: '水星', range: '5.21–6.21' },
  { key: 'cancer', name: '巨蟹座', en: 'Cancer', icon: '/subpackages/tools/assets/astro/zodiac/cancer.png', tint: '#96bedc', element: 'water', ruler: '月亮', range: '6.22–7.22' },
  { key: 'leo', name: '狮子座', en: 'Leo', icon: '/subpackages/tools/assets/astro/zodiac/leo.png', tint: '#eeaa5a', element: 'fire', ruler: '太阳', range: '7.23–8.22' },
  { key: 'virgo', name: '处女座', en: 'Virgo', icon: '/subpackages/tools/assets/astro/zodiac/virgo.png', tint: '#96c8aa', element: 'earth', ruler: '水星', range: '8.23–9.22' },
  { key: 'libra', name: '天秤座', en: 'Libra', icon: '/subpackages/tools/assets/astro/zodiac/libra.png', tint: '#c8a0dc', element: 'air', ruler: '金星', range: '9.23–10.23' },
  { key: 'scorpio', name: '天蝎座', en: 'Scorpio', icon: '/subpackages/tools/assets/astro/zodiac/scorpio.png', tint: '#dc6e82', element: 'water', ruler: '冥王星', range: '10.24–11.22' },
  { key: 'sagittarius', name: '射手座', en: 'Sagittarius', icon: '/subpackages/tools/assets/astro/zodiac/sagittarius.png', tint: '#a082e6', element: 'fire', ruler: '木星', range: '11.23–12.21' },
  { key: 'capricorn', name: '摩羯座', en: 'Capricorn', icon: '/subpackages/tools/assets/astro/zodiac/capricorn.png', tint: '#78aae6', element: 'earth', ruler: '土星', range: '12.22–1.19' },
  { key: 'aquarius', name: '水瓶座', en: 'Aquarius', icon: '/subpackages/tools/assets/astro/zodiac/aquarius.png', tint: '#6ec8dc', element: 'air', ruler: '天王星', range: '1.20–2.18' },
  { key: 'pisces', name: '双鱼座', en: 'Pisces', icon: '/subpackages/tools/assets/astro/zodiac/pisces.png', tint: '#8cbed2', element: 'water', ruler: '海王星', range: '2.19–3.20' }
];

export function zodiacByKey(key: string): Zodiac | null {
  for (let i = 0; i < ZODIACS.length; i++) if (ZODIACS[i].key === key) return ZODIACS[i];
  return null;
}

/** 字符串确定性哈希（用于生成稳定伪随机数据） */
function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface HoroscopeScores {
  /** 综合 / 爱情 / 事业 / 财富 / 健康，1-10 */
  overall: number; love: number; career: number; wealth: number; health: number;
}

export interface DailyHoroscope {
  date: string;       // YYYY-MM-DD
  period: 'today' | 'week' | 'month' | 'year';
  scores: HoroscopeScores;
  /** 5 维文段（与 scores 顺序对应） */
  texts: { overall: string; love: string; career: string; wealth: string; health: string };
  lucky: { number: number; color: string; colorName: string; match: string; avoid: string; starTip: string };
  /** 本周 7 日分数（period=today/week 才有） */
  weekSeries?: number[];
  /** 本月按日采样（period=month 才有） */
  monthSeries?: number[];
  /** 本年 12 月采样（period=year 才有） */
  yearSeries?: number[];
}

const PERIOD_FACTORS: Record<DailyHoroscope['period'], number> = { today: 1, week: 1.4, month: 1.8, year: 2.2 };

function clampScore(x: number): number { return Math.max(3, Math.min(10, Math.round(x))); }

/** 用 key+date+period 生成稳定的 1-10 分数 */
function genScore(key: string, seed: string, base: number, swing: number): number {
  const h = strHash(key + '|' + seed);
  const norm = ((h % 1000) / 1000 - 0.5) * swing;
  return clampScore(base + norm);
}

const LUCKY_COLORS: Array<[string, string]> = [
  ['#6366f1', '琉璃蓝'], ['#a78bfa', '雾紫'], ['#f472b6', '玫粉'], ['#fb923c', '蜜橙'],
  ['#fbbf24', '麦穗金'], ['#34d399', '翡翠'], ['#22d3ee', '天青'], ['#60a5fa', '湖蓝'],
  ['#f87171', '朱砂'], ['#e5e7eb', '银灰']
];
const AVOID_HINTS = ['不要太急躁，先听清楚再行动', '避免感情用事，凡事留三分余地', '今天适合独处，避免卷入是非', '少说多做，沉默是金', '不与他人比较，走自己的节奏', '远离不必要的消耗，多休息', '暂时回避冲突，先观察形势'];

function buildHoroscope(signKey: string, date: string, period: DailyHoroscope['period']): DailyHoroscope {
  const seed = `${signKey}|${date}|${period}`;
  const f = PERIOD_FACTORS[period];
  const baseOverall = 6.5;
  const scores: HoroscopeScores = {
    overall: genScore(seed, 'overall', baseOverall, 3.2 * f),
    love: genScore(seed, 'love', 6.3, 3.4 * f),
    career: genScore(seed, 'career', 6.6, 3.0 * f),
    wealth: genScore(seed, 'wealth', 6.2, 3.6 * f),
    health: genScore(seed, 'health', 6.4, 2.8 * f)
  };
  const z = zodiacByKey(signKey);
  const element = (z && z.element) || 'fire';
  const elTip: Record<string, string> = {
    fire: '白羊/狮子/射手 元素宜推进',
    earth: '金牛/处女/摩羯 元素宜稳健',
    air: '双子/天秤/水瓶 元素宜沟通',
    water: '巨蟹/天蝎/双鱼 元素宜内观'
  };
  const matchNames = ['白羊座', '狮子座', '射手座', '金牛座', '双子座', '天秤座', '摩羯座', '天蝎座'];
  const luckColor = LUCKY_COLORS[strHash(seed) % LUCKY_COLORS.length];
  const avoid = AVOID_HINTS[strHash(seed + 'avd') % AVOID_HINTS.length];

  const score2star = (s: number): string => '★'.repeat(Math.round(s / 2)) + '☆'.repeat(5 - Math.round(s / 2));

  const texts = {
    overall: `今日整体能量${scores.overall >= 7 ? '充沛' : '平稳'}，${scores.overall >= 8 ? '可主动出击' : '宜稳中求进'}。`,
    love: `${scores.love >= 7 ? '桃花渐开，交流顺畅' : '关系需要耐心'}；${scores.love >= 8 ? '适合主动表达心意' : '先倾听再行动'}。`,
    career: `事业/学业层面${scores.career >= 7 ? '思路清晰' : '进展缓慢'}；建议${scores.career >= 8 ? '趁热打铁推进' : '集中精力逐一攻克'}。`,
    wealth: `${scores.wealth >= 7 ? '财运向好' : '注意支出'}；${scores.wealth >= 8 ? '可尝试稳健理财' : '量入为出'}。`,
    health: `${scores.health >= 7 ? '状态良好' : '需注意休息'}；${scores.health >= 8 ? '可适当运动' : '避免熬夜'}。`
  };

  const weekSeries = period === 'today' || period === 'week' ? Array.from({ length: 7 }).map((_, i) =>
    clampScore(genScore(seed, 'w' + i, scores.overall, 2.4))
  ) : undefined;
  const monthSeries = period === 'month' ? Array.from({ length: 30 }).map((_, i) =>
    clampScore(genScore(seed, 'm' + i, scores.overall, 2.6))
  ) : undefined;
  const yearSeries = period === 'year' ? Array.from({ length: 12 }).map((_, i) =>
    clampScore(genScore(seed, 'y' + i, scores.overall, 2.2))
  ) : undefined;

  const dh = strHash(seed + 'lucky');
  return {
    date, period, scores,
    texts,
    lucky: {
      number: (dh % 9) + 1,
      color: luckColor[0],
      colorName: luckColor[1],
      match: matchNames[dh % matchNames.length],
      avoid,
      starTip: `${elTip[element]} · ${score2star(scores.overall)}`
    },
    weekSeries, monthSeries, yearSeries
  };
}

/** 获取指定星座在指定日期某周期的运势；可附带最近一周历史供曲线绘制 */
export function getHoroscope(signKey: string, date: string, period: DailyHoroscope['period']): DailyHoroscope {
  return buildHoroscope(signKey, date, period);
}

/** 获取近 7 天日运势序列（用于 hub 主页今日大卡片展示） */
export function getWeekSeries(signKey: string, startDate: string): { date: string; score: number }[] {
  const out: { date: string; score: number }[] = [];
  const t = new Date(startDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(t.getTime() + i * 86400000);
    const ds = formatDate(d);
    const h = buildHoroscope(signKey, ds, 'today');
    out.push({ date: ds, score: h.scores.overall });
  }
  return out;
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
  const dd = (d.getDate() < 10 ? '0' : '') + d.getDate();
  return `${y}-${m}-${dd}`;
}

export function parseDate(s: string): Date {
  const a = s.split('-').map(Number);
  return new Date(a[0] || 2026, (a[1] || 1) - 1, a[2] || 1);
}

/* ============================================================
 * 塔罗 78 牌（22 大阿卡纳 + 56 小阿卡纳：4 花色 × 14 牌数）
 * 数据按 metadata 提供，正逆位词与解读按维度短模板拼接，保证确定性
 * ============================================================ */
export type TarotSuit = 'majors' | 'wands' | 'cups' | 'swords' | 'pentacles';
export interface TarotCard {
  id: string;            // 唯一 id
  suit: TarotSuit;
  rank: number;          // 大阿 0-21；小阿 1-14（A=1, J=11, N=13, Q=12, K=14）
  name: string;          // 中文名
  keywords: string[];     // 正位关键词
  upright: string;        // 正位短解读
  reversed: string;       // 逆位短解读
}

const MAJOR_DATA: Array<{ rank: number; en: string; name: string; kw: string[]; up: string; rev: string }> = [
  { rank: 0, en: 'The Fool', name: '愚者', kw: ['自由', '新开始'], up: '踏上新的旅途吧，相信直觉。', rev: '过于冲动，请三思而行。' },
  { rank: 1, en: 'The Magician', name: '魔术师', kw: ['创造', '专注'], up: '集中意志，你能创造奇迹。', rev: '能力未被善用，需要警醒。' },
  { rank: 2, en: 'The High Priestess', name: '女祭司', kw: ['直觉', '隐秘'], up: '聆听内心的低语。', rev: '忽略直觉，需要内观。' },
  { rank: 3, en: 'The Empress', name: '皇后', kw: ['丰盛', '温柔'], up: '感受爱与创造的丰盈。', rev: '过度依赖，丧失边界。' },
  { rank: 4, en: 'The Emperor', name: '皇帝', kw: ['权威', '稳定'], up: '建立秩序与结构。', rev: '刚愎自用，需弹性。' },
  { rank: 5, en: 'The Hierophant', name: '教皇', kw: ['传统', '引导'], up: '寻求经验与教导。', rev: '教条束缚，活出自我。' },
  { rank: 6, en: 'The Lovers', name: '恋人', kw: ['选择', '爱情'], up: '遵循内心做出选择。', rev: '犹豫不决或偏离本心。' },
  { rank: 7, en: 'The Chariot', name: '战车', kw: ['意志', '胜利'], up: '驾驭矛盾，向前推进。', rev: '失去方向或动力。' },
  { rank: 8, en: 'Strength', name: '力量', kw: ['柔韧', '勇气'], up: '以柔克刚，展现内在力量。', rev: '软弱或被情绪左右。' },
  { rank: 9, en: 'The Hermit', name: '隐士', kw: ['内省', '指引'], up: '与自己对话。', rev: '过度孤立，寻求连接。' },
  { rank: 10, en: 'Wheel of Fortune', name: '命运之轮', kw: ['周期', '转折'], up: '接纳变化，把握时机。', rev: '抗拒改变或运气下行。' },
  { rank: 11, en: 'Justice', name: '正义', kw: ['公平', '真相'], up: '因果分明，诚实面对。', rev: '失衡或偏颇，需要自自自。' },
  { rank: 12, en: 'The Hanged Man', name: '倒吊人', kw: ['等待', '视角'], up: '换个角度看待问题。', rev: '固执或徒劳的牺牲。' },
  { rank: 13, en: 'Death', name: '死神', kw: ['蜕变', '结束'], up: '告别过去，迎接新生。', rev: '抗拒改变，停滞不前。' },
  { rank: 14, en: 'Temperance', name: '节制', kw: ['平衡', '调和'], up: '以平衡为美，慢慢来。', rev: '失衡或极端。' },
  { rank: 15, en: 'The Devil', name: '恶魔', kw: ['束缚', '欲望'], up: '看清欲望的根源。', rev: '挣脱束缚，重获自由。' },
  { rank: 16, en: 'The Tower', name: '高塔', kw: ['突变', '崩塌'], up: '接受突然的崩塌才能重建。', rev: '回避灾难或勉强维系。' },
  { rank: 17, en: 'The Star', name: '星星', kw: ['希望', '疗愈'], up: '希望降临，给自己时间。', rev: '失去信念或自我怀疑。' },
  { rank: 18, en: 'The Moon', name: '月亮', kw: ['幻象', '潜意识'], up: '看清潜意识中的真相。', rev: '走出迷惘或被假象误导。' },
  { rank: 19, en: 'The Sun', name: '太阳', kw: ['喜悦', '成功'], up: '阳光灿烂，享受当下。', rev: '暂时乌云，保持希望。' },
  { rank: 20, en: 'Judgement', name: '审判', kw: ['觉醒', '重生'], up: '听取内心召唤，升级自我。', rev: '自我批判或逃避召唤。' },
  { rank: 21, en: 'The World', name: '世界', kw: ['圆满', '完成'], up: '阶段性圆满，准备新篇章。', rev: '最后一里未达，需要坚持。' }
];

const SUIT_CN: Record<Exclude<TarotSuit, 'majors'>, string> = { wands: '权杖', cups: '圣杯', swords: '宝剑', pentacles: '星币' };
const RANK_CN: Record<number, string> = { 1: 'A', 11: '侍从', 12: '骑士', 13: '王后', 14: '国王' };
function rankName(r: number): string { return RANK_CN[r] || String(r); }

/** 小阿卡纳按 suit+rank 拼接关键词与解读（确定性模板） */
function buildMinor(suit: Exclude<TarotSuit, 'majors'>, rank: number): { kw: string[]; up: string; rev: string } {
  const baseKw: Record<typeof suit, string[]> = {
    wands: ['热情', '行动'],
    cups: ['情感', '直觉'],
    swords: ['思维', '抉择'],
    pentacles: ['物质', '实务']
  };
  const extra: Record<number, string> = {
    1: '开端', 2: '平衡', 3: '合作', 4: '稳固', 5: '试炼', 6: '丰盛', 7: '坚守', 8: '精进',
    9: '坚守信心', 10: '承担', 11: '学习', 12: '前行', 13: '关怀', 14: '担当'
  };
  const kw = [...baseKw[suit], extra[rank] || ''];
  const action = rank <= 5 ? '播种' : rank <= 10 ? '成长' : '收获';
  return {
    kw,
    up: `${SUIT_CN[suit]}${rankName(rank)}：${action}之意，宜主动出击。`,
    rev: `${SUIT_CN[suit]}${rankName(rank)}逆位：节奏受阻，宜放缓再议。`
  };
}

export const TAROT_CARDS: TarotCard[] = [];
for (let i = 0; i < MAJOR_DATA.length; i++) {
  const m = MAJOR_DATA[i];
  TAROT_CARDS.push({
    id: `majors_${m.rank}`,
    suit: 'majors', rank: m.rank,
    name: m.name,
    keywords: m.kw,
    upright: m.up,
    reversed: m.rev
  });
}
const SUITS: Exclude<TarotSuit, 'majors'>[] = ['wands', 'cups', 'swords', 'pentacles'];
SUITS.forEach((s) => {
  for (let r = 1; r <= 14; r++) {
    const built = buildMinor(s, r);
    TAROT_CARDS.push({
      id: `${s}_${r}`,
      suit: s, rank: r,
      name: `${SUIT_CN[s]}${rankName(r)}`,
      keywords: built.kw,
      upright: built.up,
      reversed: built.rev
    });
  }
});

export function getTarotById(id: string): TarotCard | null {
  for (let i = 0; i < TAROT_CARDS.length; i++) if (TAROT_CARDS[i].id === id) return TAROT_CARDS[i];
  return null;
}

export function tarotAll(): TarotCard[] { return TAROT_CARDS.slice(); }

/* ============================================================
 * 雷诺曼 36 牌
 * ============================================================ */
export const LENORMAND: { id: string; name: string; symbol: string; meaning: string }[] = [
  { id: 'rider', name: '骑士', symbol: '🐎', meaning: '消息、来访、动向' },
  { id: 'clover', name: '三叶草', symbol: '🍀', meaning: '小幸运、意外之喜' },
  { id: 'ship', name: '船', symbol: '🚢', meaning: '远行、迁移、情感漂泊' },
  { id: 'house', name: '房子', symbol: '🏠', meaning: '家庭、安全感、根基' },
  { id: 'tree', name: '树', symbol: '🌳', meaning: '健康、成长、长久' },
  { id: 'clouds', name: '云', symbol: '☁️', meaning: '困扰、迷雾、不确定' },
  { id: 'snake', name: '蛇', symbol: '🐍', meaning: '隐忧、复杂关系、背叛' },
  { id: 'coffin', name: '棺材', symbol: '⚰️', meaning: '结束、放下、低落' },
  { id: 'bouquet', name: '花束', symbol: '💐', meaning: '赞美、馈赠、喜悦' },
  { id: 'scythe', name: '镰刀', symbol: '⚔️', meaning: '切断、突变、风险' },
  { id: 'whip', name: '鞭', symbol: '⛓️', meaning: '冲突、纠葛、激情' },
  { id: 'birds', name: '鸟', symbol: '🐦', meaning: '消息、伴侣、闲谈' },
  { id: 'child', name: '孩子', symbol: '👶', meaning: '纯真、萌芽、新的开始' },
  { id: 'fox', name: '狐狸', symbol: '🦊', meaning: '狡黠、机敏、警觉' },
  { id: 'bear', name: '熊', symbol: '🐻', meaning: '力量、权威、长辈' },
  { id: 'stars', name: '星星', symbol: '⭐', meaning: '灵感、愿景、指引' },
  { id: 'stork', name: '鹳', symbol: '🦢', meaning: '变动、革新、新阶段' },
  { id: 'dog', name: '狗', symbol: '🐕', meaning: '忠诚、友伴、支持' },
  { id: 'tower', name: '高塔', symbol: '🗼', meaning: '权威、孤独、坚守' },
  { id: 'garden', name: '花园', symbol: '🏡', meaning: '公众、社群、外界' },
  { id: 'mountain', name: '山', symbol: '⛰️', meaning: '障碍、坚韧、长期' },
  { id: 'crossroad', name: '十字路', symbol: '🛣️', meaning: '抉择、分岔、机会' },
  { id: 'mice', name: '老鼠', symbol: '🐭', meaning: '损耗、焦虑、小失' },
  { id: 'heart', name: '心', symbol: '❤️', meaning: '爱情、热情、连接' },
  { id: 'ring', name: '戒指', symbol: '💍', meaning: '承诺、契约、循环' },
  { id: 'book', name: '书', symbol: '📖', meaning: '学识、秘密、启示' },
  { id: 'letter', name: '信', symbol: '✉️', meaning: '通讯、文件、消息' },
  { id: 'man', name: '男士', symbol: '👨', meaning: '当事人（男方）' },
  { id: 'woman', name: '女士', symbol: '👩', meaning: '当事人（女方）' },
  { id: 'lily', name: '百合', symbol: '🌸', meaning: '平静、长寿、纯净' },
  { id: 'sun', name: '太阳', symbol: '☀️', meaning: '成功、活力、清晰' },
  { id: 'moon', name: '月亮', symbol: '🌙', meaning: '情感、直觉、荣誉' },
  { id: 'key', name: '钥匙', symbol: '🔑', meaning: '答案、突破、关键' },
  { id: 'fish', name: '鱼', symbol: '🐟', meaning: '财富、流动、丰足' },
  { id: 'anchor', name: '锚', symbol: '⚓', meaning: '稳固、承诺、坚持' },
  { id: 'cross', name: '十字架', symbol: '✝️', meaning: '命运、学业、奉献' }
];

export function getLenormandById(id: string): typeof LENORMAND[number] | null {
  for (let i = 0; i < LENORMAND.length; i++) if (LENORMAND[i].id === id) return LENORMAND[i];
  return null;
}

/* ============================================================
 * 冥想主题与引导词（5 类）
 * ============================================================ */
export interface Meditation {
  id: string;
  name: string;
  desc: string;
  durations: number[];   // 可选时长（分钟）
  prompts: string[];      // 引导词
  ambience: 'rain' | 'forest' | 'wind' | 'silence' | 'star';
}

export const MEDITATIONS: Meditation[] = [
  {
    id: 'breath', name: '呼吸静心', desc: '回归呼吸，安住当下',
    durations: [3, 5, 10],
    ambience: 'wind',
    prompts: [
      '轻轻闭上眼睛，注意你的呼吸。',
      '吸气时，让气息缓缓充满腹部。',
      '呼气时，让身体慢慢放松下来。',
      '不去控制任何念头，只是觉察它们的来去。',
      '感受此刻的安静，你已与自己同在。'
    ]
  },
  {
    id: 'sleep', name: '睡前放松', desc: '卸下一天，安静入眠',
    durations: [5, 10, 15],
    ambience: 'rain',
    prompts: [
      '全身放松，肩膀沉下来。',
      '让眉头舒展，口腔放松。',
      '想象自己漂浮在温暖的水中。',
      '每一次呼吸都比上一次更深更慢。',
      '夜色温柔，世界慢慢安静。'
    ]
  },
  {
    id: 'anxiety', name: '焦虑缓解', desc: '拥抱不安，让它经过',
    durations: [3, 5, 10],
    ambience: 'forest',
    prompts: [
      '承认你正在焦虑，不与它对抗。',
      '深呼吸，把注意力带回此刻。',
      '让焦虑像云朵一样飘过。',
      '你知道，焦虑不是全部的你。',
      '你已在此刻，你是安全的。'
    ]
  },
  {
    id: 'self', name: '自我接纳', desc: '与内在和解，温柔以待',
    durations: [5, 10, 15],
    ambience: 'silence',
    prompts: [
      '对我自己温柔一些。',
      '我已经尽力，不必苛责。',
      '我的感受是真实而珍贵的。',
      '我可以选择原谅与放下。',
      '我已经够好了，我值得被爱。'
    ]
  },
  {
    id: 'focus', name: '专注力', desc: '清空杂念，回到当下',
    durations: [3, 5, 10],
    ambience: 'star',
    prompts: [
      '把注意力集中到一呼一吸。',
      '杂念经过，像风一样放手。',
      '回到呼吸，回到此刻。',
      '专注是温柔的，不带评判。',
      '你已回到此刻。'
    ]
  }
];

export function meditationById(id: string): Meditation | null {
  for (let i = 0; i < MEDITATIONS.length; i++) if (MEDITATIONS[i].id === id) return MEDITATIONS[i];
  return null;
}

/* ============================================================
 * 知心姐姐回复模板（按情绪主题生成温柔治愈回复）
 * ============================================================ */
export interface SisterReply {
  patterns: string[];  // 同情/共情短句
  suggestions: string[]; // 温暖建议
  closings: string[];    // 收尾祝福
}

const SISTER_POOLS: Record<string, SisterReply> = {
  love: {
    patterns: [
      '感情里的纠结，往往不是因为不爱，而是因为太想好好爱。',
      '两个人的关系里，越想证明越容易错位。',
      '被拒绝不等于被否定，可能只是节奏不合。',
      '爱自己，是所有浪漫关系的地基。'
    ],
    suggestions: [
      '试着写下你最在意的 3 件事，告诉对方一次。',
      '给彼此一周不评价对方的时间，让关系透透气。',
      '允许自己先休息一下，再做决定。',
      '把你最柔软的担心，试着告诉最信任的朋友。'
    ],
    closings: [
      '愿你今夜安心入睡，明天会温柔地迎接你。',
      '被爱不需要完美，温柔就好。',
      '慢一点，没关系，你正在路上。',
      '不必比较，每段感情都有自己的季节。'
    ]
  },
  study: {
    patterns: [
      '学习低潮是再正常不过的事了，你不是唯一一个。',
      '不专注也许是因为害怕不完美。',
      '专注不等于无杂念，而是温和地把注意带回来。',
      '学习是长跑，今天的小停顿不影响大方向。'
    ],
    suggestions: [
      '把手机放到另一个房间 25 分钟，做一件最想完成的事。',
      '把大任务拆成 3 个小步骤，每完成一个奖励自己一次。',
      '告诉一个朋友你接下来要做什么，互相提醒。',
      '先写 5 分钟最烂的初稿，再回头修。'
    ],
    closings: [
      '慢慢来，你已经在路上了。',
      '明天的你，会感谢今天的微小努力。',
      '记得喝水和休息，你比分数重要。',
      '会越来越好的，给自己多一点耐心。'
    ]
  },
  doubt: {
    patterns: [
      '自我怀疑是内心在尝试保护你。',
      '看不清自己时，往往是太苛刻。',
      '你不需要等到足够好才被允许存在。',
      '每个人的价值不靠别人的眼光证明。'
    ],
    suggestions: [
      '写下今天做得好的 3 件小事。',
      '找一个信任的人，听听他们眼中的你。',
      '把"我不够好"改成"我正在成长"。',
      '做一件只为取悦自己的事，不为别人。'
    ],
    closings: [
      '你不需要完美，真实就已经很好。',
      '允许自己慢一点，生长需要时间。',
      '温柔地和今天的自己说一声晚安。',
      '我会在这里陪伴你。'
    ]
  },
  relation: {
    patterns: [
      '人际里的小别扭，常常是因为没被听见。',
      '你不必让所有人都舒服。',
      '拒绝也是一种关系上的诚实。',
      '先照顾自己，再去照顾世界。'
    ],
    suggestions: [
      '用"我的感受是..."代替"你总是..."。',
      '在重要对话前先写下 3 句你想表达的话。',
      '允许别人有自己的节奏。',
      '如果你累了，就让自己暂停。'
    ],
    closings: [
      '愿你的真心被温柔对待。',
      '真正的连接从不需要你委屈自己。',
      '愿你身边有温暖的人。',
      '你不必回应所有人。'
    ]
  },
  other: {
    patterns: [
      '愿意说出来，本身就是一种疗愈。',
      '你的情绪是真实的，不需要解释太多。',
      '混乱的时候，也是看清楚的时候。',
      '有些问题不需要答案，被听见就够了。'
    ],
    suggestions: [
      '试着深呼吸三次，让身体先慢下来。',
      '把此刻写在纸上，命名一种情绪。',
      '走出门呼吸一下空气，换个角度。',
      '今晚 11 点前放下手机，给自己一个安静的夜。'
    ],
    closings: [
      '愿你被温柔以待。',
      '陪伴是最长情的告白。',
      '我会一直在这里。',
      '晚安，明天会更好的。'
    ]
  }
};

export function sisterTopicByKey(key: string): SisterReply {
  return SISTER_POOLS[key] || SISTER_POOLS['other'];
}

export const SISTER_TOPICS: { key: string; label: string; emoji: string }[] = [
  { key: 'love', label: '感情内内', emoji: '💞' },
  { key: 'study', label: '学业压力', emoji: '📚' },
  { key: 'doubt', label: '自我怀疑', emoji: '🌫️' },
  { key: 'relation', label: '人际关系', emoji: '🤝' },
  { key: 'other', label: '其他心事', emoji: '🌸' }
];

export const SISTER_MOODS: { key: string; label: string; emoji: string }[] = [
  { key: 'calm', emoji: '😌', label: '平静' },
  { key: 'happy', emoji: '😊', label: '开心' },
  { key: 'sad', emoji: '😔', label: '低落' },
  { key: 'anxious', emoji: '😟', label: '焦虑' },
  { key: 'angry', emoji: '😤', label: '烦躁' },
  { key: 'confused', emoji: '😕', label: '迷茫' }
];

/* ============================================================
 * 知心姐姐 · 可切换的“姐姐”人设
 * 每个姐姐都有独立头像 / 语气 / 关怀表达 / 拟人化细节 / 专属语音音色，
 * 切换即换一位“真实存在”的姐姐来陪你聊。
 * ============================================================ */

/**
 * 姐姐的专属语气池：让每位姐姐“说话像自己”而不是同一套模板。
 * 组合回复时优先取姐姐专属池，池子为空才回落到页面级通用池。
 */
export interface SisterStyle {
  /** 开场语气（替代通用时间问候，更贴人设） */
  openers: string[];
  /** 共情句（接住情绪时用，带个人经历感） */
  empathy: string[];
  /** 建议口吻（给具体建议时的说话方式） */
  advice: string[];
  /** 专属收尾（多句轮换，避免每次一样） */
  closings: string[];
  /** 语气小词 / 口头禅，随机点缀在句首或句尾 */
  fillers: string[];
}

/**
 * 声音来源登记：每条语音消息都带上这份元数据，
 * 前端语音条会显示「谁的声音 · 什么音色 · 由哪个引擎合成」。
 *
 * 说明：这里登记的是**合成引擎的真人质感音色**（腾讯云语音合成），
 * 属于角色配音音色，不是明星本人的声音授权；如需 100% 真人录音，
 * 把录音文件放进 assets/astro/voices/<姐姐key>/ 即可被优先播放（见 sister-voice.ts）。
 */
export interface SisterVoice {
  /** 声音来源的中文标识，如「甜系少女音」 */
  label: string;
  /** 合成引擎标识 */
  engine: 'tencent-tts';
  /** 引擎展示名 */
  engineName: string;
  /** 引擎音色 ID（腾讯云 VoiceType） */
  voiceType: number;
  /** 引擎音色名，如「智小柔」 */
  voiceName: string;
  /** 音色类型说明，如「超自然大模型音色 · 聊天女声」 */
  voiceKind: string;
  /** 支持语言 */
  lang: string;
  /** 采样率 */
  sampleRate: number;
  /** 语速（腾讯云 Speed 参数，0=1.0 倍） */
  speed: number;
  /** 音量（腾讯云 Volume 参数，0=正常） */
  volume: number;
  /** 音色情感（仅多情感音色可用，留空表示中性） */
  emotion?: string;
  /** 一句话来源说明，显示在语音条的来源标签上 */
  note: string;
}

export interface SisterPersona {
  key: string;
  name: string;        // 姐姐名字
  avatar: string;      // 头像（分包内路径）
  tagline: string;     // 一句话人设，显示在资料卡
  greet: string;       // 专属开场白（带拟人化生活细节）
  warmth: string[];    // 以“姐姐”自称的共情关怀句
  habit: string[];     // 拟人化生活小细节，随机穿插增强真实感
  closing: string;     // 专属收尾签名
  /** 人设标签：语音与文字统一按这几种语气走（显示在资料卡） */
  tone?: string;
  /** 专属语气池（可选：缺省则使用页面级通用池） */
  style?: SisterStyle;
  /** 专属语音音色（可选：缺省则不可发语音） */
  voice?: SisterVoice;
}


export const SISTERS: SisterPersona[] = [
  {
    key: 'jujingyi',
    name: '鞠婧祎',
    avatar: '/subpackages/tools/assets/astro/sisters/sister_jujingyi.jpg',
    tagline: '甜一点说也没关系，我一直在',
    tone: '软糯甜美 · 元气鼓励',
    greet: '你好呀，我是鞠婧祎——就是那个唱歌、也演戏的鞠婧祎。今天刚练完舞，头发还湿着就先跑来听你说话啦。这里没有舞台也没有镜头，你过得怎么样？开心的、不开心的，都可以讲给我听，我很有耐心的。',
    warmth: [
      '我太懂那种「已经拼尽全力，还是觉得不够」的委屈了，我也在练习室里偷偷哭过好多次。',
      '你不用在我面前撑着，软一点、慢一点，都可以。',
      '你愿意说给我听，我就一定会好好接着，不会敷衍你。',
      '别怕，我在呢，天大的事我们也先睡一觉再说。'
    ],
    habit: [
      '（她摘下耳返，往你这边凑近了一点）',
      '（她把碎发别到耳后，笑起来眼睛弯弯的）',
      '（她清了清嗓子，差点就要哼两句歌给你听）',
      '（她把手边的温水推到你手边，说「先喝一口」）'
    ],
    closing: '今天真的辛苦你啦。好好睡一觉，明天醒来我们又是元气满满的一天，晚安～',
    style: {
      openers: ['嗯，我听着呢，你慢慢说。', '诶～你说，我在。', '看到你的消息啦，先抱一下。'],
      empathy: [
        '你说的这种难受，我也经历过——明明已经很用力了，却被人轻飘飘地评价一句，那种无力感我记得特别清楚。',
        '被否定的时候，最该被抱住的人是你，不是那句评价。',
        '心里堵着的话说不出来很正常，你可以先在我这里断断续续地讲。',
        '你已经很棒了，这句话我不是哄你的。'
      ],
      advice: [
        '要不要先去做一件小小的、立刻能看到结果的事？我心情不好的时候会去对镜练十分钟，出点汗就舒服多了。',
        '今天先给自己留半小时，什么都不做，躺着听歌也行。',
        '试着把最难受的那件事写下来，写完折起来，明天再看。',
        '别急着处理所有事，挑最小的一件做完，剩下的明天再说。'
      ],
      closings: [
        '我一直都在，随时来找我，晚安 🌙',
        '记得好好吃饭，别学我忙起来就忘记。',
        '明天也要开开心心的，我等着听你的好消息。',
        '抱抱你，今天到此为止就好。'
      ],
      fillers: ['诶～', '真的真的，', '好啦，', '乖，']
    },
    voice: {
      label: '甜系少女音',
      engine: 'tencent-tts',
      engineName: '腾讯云语音合成',
      voiceType: 502001,
      voiceName: '智小柔',
      voiceKind: '超自然大模型音色 · 聊天女声',
      lang: '中英文',
      sampleRate: 24000,
      speed: 0.9,
      volume: 0,
      note: '甜软亲切的少女音色，语速略慢，贴合软糯撒娇的语气'
    }
  },
  {
    key: 'iu',
    name: '李知恩 IU',
    avatar: '/subpackages/tools/assets/astro/sisters/sister_iu.jpg',
    tagline: 'IU 在这儿，陪你轻轻放下心事',
    tone: '清澈温柔 · 平静治愈',
    greet: '안녕하세요～你好，我是李知恩，大家都叫我 IU，一个写歌也唱歌的人。刚把吉他放回琴盒，泡了杯热茶，想着这个时候也许有人在等一个可以说话的地方。我就是那个地方——你愿意的话，把今天发生的事慢慢讲给我听，我会一直在这儿。🌙',
    warmth: [
      '我写歌的时候也常常写到一半就崩溃，所以你不必假装没事。',
      '难过的时候不用坚强，我可以陪你把这段旋律调得又轻又慢。',
      '谢谢你愿意告诉我这些，我会好好收着，不会弄丢。',
      '（轻声）今晚我会在，等你说完。'
    ],
    habit: [
      '（她轻轻拨了一下琴弦，声音很轻）',
      '（她合上手里的书，认真看向你）',
      '（她把灯调暗了一点，说这样说话会更安心）',
      '（她在纸上写下一行词，念给你听）'
    ],
    closing: '오늘도 수고했어요。今天也辛苦了，好好睡吧，晚安 🌙',
    style: {
      openers: ['嗯，我在听。', '（轻声）不着急，你慢慢说。', '谢谢你愿意告诉我这些。'],
      empathy: [
        '那种「我很努力了却还是不行」的时刻，我也有过，它会让人一时看不见自己的光。',
        '你的感受不是想太多，它只是需要一个被安静听见的地方。',
        '有些事情本来就没有标准答案，你不用急着逼自己得出结论。',
        '你不需要那么多解释，在我这里，难过就是难过，没关系的。'
      ],
      advice: [
        '要不要试着用一句话写下此刻的心情？我写词的时候就是这样开始的。',
        '今晚早点关灯，把耳机戴上，让音乐替你把情绪慢慢铺平。',
        '给自己倒杯温热的茶，坐着什么都不做，五分钟也好。',
        '明天去做一件只为自己开心的小事，不用告诉任何人。'
      ],
      closings: [
        '夜深了，记得把被子盖好，知恩一直在这儿。',
        '愿你今晚睡个好觉，明天醒来心里轻一点。',
        '不用急着变好，我陪你慢慢来。',
        '如果还想说，我随时都在，晚安 🌙'
      ],
      fillers: ['嗯，', '其实呀，', '慢慢地，', '真的，']
    },
    voice: {
      label: '韩系爱豆音',
      engine: 'tencent-tts',
      engineName: '腾讯云语音合成',
      voiceType: 602003,
      voiceName: '爱小悠',
      voiceKind: '超自然大模型音色 · 聊天女声',
      lang: '中英文',
      sampleRate: 24000,
      speed: 0.9,
      volume: 0,
      note: '清亮甜美的气质女声，明亮优雅有偶像感，贴合韩系女爱豆的气质'
    }
  },
  {
    key: 'alian',
    name: '阿岚',
    avatar: '/subpackages/tools/assets/astro/sisters/sister_alian.jpg',
    tagline: '把心事写成诗，姐姐陪你慢慢读',
    greet: '我是阿岚。刚在窗边读完一首小诗，突然就想，要是能陪你坐一会儿多好。你心里现在下着什么样的雨呢？🌿',
    warmth: [
      '有些情绪像雾，看不清也正常，姐姐陪你等它慢慢散。',
      '你心里的那点光，别人看不见，姐姐看得见。',
      '慢慢来，好句子都是一行一行写出来的，人也一样。'
    ],
    habit: [
      '（阿岚把书合上，侧头听你说话）',
      '（她指了指窗外，一片叶子刚好落下）',
      '（姐姐在纸上轻轻画了个小太阳）'
    ],
    closing: '今晚的月色会替姐姐陪着你，晚安，也别忘了想我 🌿',
    tone: '诗意留白 · 缓慢低语',
    voice: {
      label: '月华低语音',
      engine: 'tencent-tts',
      engineName: '腾讯云语音合成',
      voiceType: 501004,
      voiceName: '月华',
      voiceKind: '大模型音色 · 聊天女声',
      lang: '中文',
      sampleRate: 24000,
      speed: 0.86,
      volume: 0,
      note: '情绪偏静的女声，语速放慢，贴合诗意低语的语气'
    }
  },
  {
    key: 'linghe',
    name: '张凌赫',
    avatar: '/subpackages/tools/assets/astro/sisters/sister_linghe.jpg',
    tagline: '收工之后，凌赫哥哥听你慢慢说',
    greet: '你好，我是张凌赫——就是那个演戏的张凌赫。今天刚收工，回到房间卸完妆，就想着找人说说话。这里没有镜头也没有剧本，你今天遇到的事，都可以慢慢讲给我听。🎬',
    warmth: [
      '我也遇到过背不下台词、躲在角落里焦虑的时候，所以你现在的慌，我懂。',
      '在我这里你不用演，累了就是累了，委屈就是委屈，都是真的。',
      '别一个人扛着，凌赫哥哥这儿永远有位置给你。'
    ],
    habit: [
      '（他把剧本放到一边，认真转向你）',
      '（刚收工的他嗓音低低的，带着一点疲惫的温柔）',
      '（凌赫给你倒了杯温水，轻轻推到你面前）'
    ],
    closing: '先好好休息，别的明天再说。凌赫哥哥随时在 🌙',
    tone: '清冷疏离 · 磁性低音（私下松弛大男孩）',
    voice: {
      label: '清冷疏离音',
      engine: 'tencent-tts',
      engineName: '腾讯云语音合成',
      voiceType: 501006,
      voiceName: '千嶂',
      voiceKind: '大模型音色 · 聊天男声',
      lang: '中文',
      sampleRate: 24000,
      speed: 0.9,
      volume: 0,
      note: '清冷疏离感最强的男声，低而干净，自带距离感与贵气，贴合帝师/隐忍男主声线'
    }
  },
  {
    key: 'wanqing',
    name: '婉清',
    avatar: '/subpackages/tools/assets/astro/sisters/sister_wanqing.jpg',
    tagline: '世间烦忧，婉清姐姐煮茶听你说',
    greet: '我是婉清。院中竹影轻摇，正宜闲话。你心中若有不平事，且与我说，清儿愿做你一程听客。🍵',
    warmth: [
      '人生起落如月之圆缺，姐姐陪你静看便好。',
      '你心里的委屈，清儿都记下了，莫要独自咽下。',
      '慢些走，路长着呢，姐姐在身后替你提着灯。'
    ],
    habit: [
      '（婉清执起茶盏，为你添了一杯）',
      '（她敛袖轻笑，目光温柔）',
      '（檐下风铃轻响，似在应你）'
    ],
    closing: '夜深了，记得添衣。婉清在此，随时等你来话 🍵',
    tone: '古雅温润 · 娓娓道来',
    voice: {
      label: '温润书卷音',
      engine: 'tencent-tts',
      engineName: '腾讯云语音合成',
      voiceType: 601013,
      voiceName: '爱小伊',
      voiceKind: '大模型音色 · 阅读女声',
      lang: '中文',
      sampleRate: 24000,
      speed: 0.88,
      volume: 0,
      note: '书卷气女声，语速偏慢，贴合古雅娓娓道来的语气'
    }
  }
];

export const DEFAULT_SISTER_KEY = 'jujingyi';

/* ============================================================
 * 星象 / 月相工具
 * ============================================================ */
export interface MoonPhase {
  name: string;          // 中文名
  en: string;            // 英文
  image: string;         // /assets/astro/moon/moon_xx.png
  ageDays: number;       // 月龄
  illumination: number;  // 0-1
  tip: string;
}

export const MOON_NAMES: Record<number, { name: string; en: string }> = {
  0: { name: '新月', en: 'new' },
  1: { name: '娥眉月', en: 'wax_crescent' },
  2: { name: '上弦月', en: 'first_quarter' },
  3: { name: '盈凸月', en: 'wax_gibbous' },
  4: { name: '满月', en: 'full' },
  5: { name: '亏凸月', en: 'wan_gibbous' },
  6: { name: '下弦月', en: 'last_quarter' },
  7: { name: '残月', en: 'wan_crescent' }
};

/** 朔望周期（天数） */
const SYNODIC = 29.530588;
// 已知 2000-01-06 18:14 UTC 为新月；近似 epoch
const NEW_MOON_EPOCH = new Date('2000-01-06T18:14:00Z').getTime();

export function moonPhase(d: Date): MoonPhase {
  const days = ((d.getTime() - NEW_MOON_EPOCH) / 86400000) % SYNODIC;
  const norm = days < 0 ? days + SYNODIC : days;
  const phase = Math.floor((norm / SYNODIC) * 8) % 8;
  const illum = Math.round((1 - Math.cos((norm / SYNODIC) * Math.PI * 2)) * 50);
  const tips: Record<number, string> = {
    0: '新月宜播种许愿，设定新目标。',
    1: '娥眉月，力量萌芽，可从小事开始。',
    2: '上弦月，行动力强，宜推进计划。',
    3: '盈凸月，能量上扬，宜冲刺。',
    4: '满月，情绪高潮，宜内观/释放。',
    5: '亏凸月，能量回落，宜回顾与感恩。',
    6: '下弦月，宜放下、清理与取舍。',
    7: '残月，宜休息、疗愈与重启。'
  };
  const meta = MOON_NAMES[phase];
  return {
    name: meta.name,
    en: meta.en,
    image: '/subpackages/tools/assets/astro/moon/moon_' + meta.en + '.png',
    ageDays: Math.round(norm * 10) / 10,
    illumination: illum,
    tip: tips[phase]
  };
}

/** 重大天象事件（近似 2026） */
export interface AstroEvent {
  id: string;
  name: string;
  date: string;          // YYYY-MM-DD
  type: 'new-moon' | 'full-moon' | 'retrograde' | 'eclipse' | 'meteor';
  desc: string;
}

export const ASTRO_EVENTS: AstroEvent[] = [
  { id: 'new01', name: '新月许愿日', date: '2026-01-13', type: 'new-moon', desc: '新月能量启动，适合作新年心愿。' },
  { id: 'full01', name: '满月祈愿', date: '2026-01-28', type: 'full-moon', desc: '情绪高峰，可做内在观照与释放。' },
  { id: 'mer01', name: '水瓶座流星雨', date: '2026-05-06', type: 'meteor', desc: '夜间最佳观赏，注意保暖。' },
  { id: 'retro01', name: '水星逆行', date: '2026-04-15', type: 'retrograde', desc: '沟通、合同、交通谨慎。' },
  { id: 'new02', name: '新月许愿日', date: '2026-07-10', type: 'new-moon', desc: '夏日能量启动，适合短期目标。' },
  { id: 'eclipse01', name: '日偏食', date: '2026-08-12', type: 'eclipse', desc: '重要转折期，慢决策。' },
  { id: 'full02', name: '满月祈愿', date: '2026-12-04', type: 'full-moon', desc: '年末复盘，回望初心。' }
];

export function astroEventByDate(yyyyMMdd: string): AstroEvent[] {
  return ASTRO_EVENTS.filter((e) => e.date === yyyyMMdd);
}