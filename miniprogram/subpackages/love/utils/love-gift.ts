// utils/love-gift.ts
// 生日提醒 + 送礼建议（按 MBTI / 兴趣 / 预算）
//
// 送礼建议的逻辑：兴趣 > MBTI > 星座（星座只做语气调剂，不作为筛选主依据）。
//  理由很简单——兴趣是他真实花时间的东西，命中率最高；
//  MBTI 决定「体验型还是实用型」「惊喜还是稳妥」；
//  星座用来润色文案，让建议读起来更像你写的。
import { getRelation, getWardrobe, todayYmd, diffDays, fmtYmd } from './love-store';
import { BAND } from './love-outfit';
import type { BudgetKey } from './love-types';

/* ============================ 星座 ============================ */

const ZODIAC: { name: string; from: [number, number]; to: [number, number]; emoji: string; trait: string }[] = [
  { name: '白羊座', from: [3, 21], to: [4, 19], emoji: '♈', trait: '直接、行动派，喜欢有冲劲的东西' },
  { name: '金牛座', from: [4, 20], to: [5, 20], emoji: '♉', trait: '重质感、恋旧，吃和摸得到的都爱' },
  { name: '双子座', from: [5, 21], to: [6, 21], emoji: '♊', trait: '好奇、三分钟热度，喜欢新鲜好玩' },
  { name: '巨蟹座', from: [6, 22], to: [7, 22], emoji: '♋', trait: '恋家、重回忆，手工与陪伴最打动他' },
  { name: '狮子座', from: [7, 23], to: [8, 22], emoji: '♌', trait: '要面子、爱被重视，仪式感拉满' },
  { name: '处女座', from: [8, 23], to: [9, 22], emoji: '♍', trait: '细节控、实用主义，好用比好看重要' },
  { name: '天秤座', from: [9, 23], to: [10, 23], emoji: '♎', trait: '颜控、选择困难，审美优先' },
  { name: '天蝎座', from: [10, 24], to: [11, 22], emoji: '♏', trait: '深沉、重独占，有故事感的礼物加分' },
  { name: '射手座', from: [11, 23], to: [12, 21], emoji: '♐', trait: '爱自由、爱出门，旅行与体验类最合适' },
  { name: '摩羯座', from: [12, 22], to: [1, 19], emoji: '♑', trait: '务实、有规划，能长期用的东西最好' },
  { name: '水瓶座', from: [1, 20], to: [2, 18], emoji: '♒', trait: '独特、反套路，越奇怪越喜欢' },
  { name: '双鱼座', from: [2, 19], to: [3, 20], emoji: '♓', trait: '浪漫、敏感，氛围感与心意最关键' }
];

export function zodiacOf(birthday: string): string {
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(birthday || '');
  if (!m) return '';
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  for (let i = 0; i < ZODIAC.length; i++) {
    const z = ZODIAC[i];
    const afterStart = mm > z.from[0] || (mm === z.from[0] && dd >= z.from[1]);
    const beforeEnd = mm < z.to[0] || (mm === z.to[0] && dd <= z.to[1]);
    if (afterStart && beforeEnd) return z.name;
  }
  return '';
}

export function zodiacTrait(name: string): string {
  const z = ZODIAC.find((x) => x.name === name);
  return z ? z.trait : '';
}

export function zodiacEmoji(name: string): string {
  const z = ZODIAC.find((x) => x.name === name);
  return z ? z.emoji : '✨';
}

export function zodiacList(): string[] {
  return ZODIAC.map((z) => z.name);
}

/* ============================ 生日 ============================ */

export interface BirthdayStat {
  /** 距下次生日的天数 */
  days: number;
  /** 是否今天 */
  isToday: boolean;
  /** 生日当天的年龄（年份未知则空） */
  age: string;
  /** 下次生日日期 */
  next: string;
  text: string;
  /** 提前多久开始准备 */
  prepText: string;
}

export function birthdayStat(birthday: string): BirthdayStat | null {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(birthday || '');
  if (!m) return null;
  const hasYear = !!m[1];
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const now = new Date();
  const today = todayYmd();

  let next = new Date(now.getFullYear(), mm - 1, dd);
  if (fmtYmd(next) < today) next = new Date(now.getFullYear() + 1, mm - 1, dd);
  const nextStr = fmtYmd(next);
  const days = diffDays(today, nextStr);
  const isToday = days === 0;
  const age = hasYear ? String(next.getFullYear() - Number(m[1])) : '';

  let text = '';
  if (isToday) text = `今天就是${age ? `他 ${age} 岁` : '他的'}生日！`;
  else if (days === 1) text = '明天是他生日';
  else if (days <= 7) text = `还有 ${days} 天是他生日`;
  else if (days <= 30) text = `还有 ${days} 天，可以开始准备了`;
  else text = `距他生日还有 ${days} 天`;

  let prepText = '';
  if (isToday) prepText = '今天：一句「生日快乐」要在零点说，礼物可以补，那句话不能晚';
  else if (days <= 3) prepText = '最后窗口：礼物还没到就改送电子券 / 外卖蛋糕，别空手';
  else if (days <= 14) prepText = '现在下单刚好：预留物流时间，异地最怕礼物迟到';
  else if (days <= 45) prepText = '可以慢慢挑：定制类礼物（刻字/相册）现在做来得及';
  else prepText = '时间充裕：可以先留意他最近想要什么，随口问的往往最准';

  return { days, isToday, age, next: nextStr, text, prepText };
}

/* ============================ 送礼建议 ============================ */

export interface GiftIdea {
  name: string;
  emoji: string;
  /** 参考价位 */
  price: string;
  /** 为什么适合他 */
  reason: string;
  /** 具体怎么买 / 怎么做 */
  how: string;
  /** 异地恋特别提示 */
  longDistance: string;
  score: number;
}

interface GiftDef {
  name: string;
  emoji: string;
  base: string;
  /** 兴趣命中标签 */
  hobbies: string[];
  /** MBTI 偏好：E/I、N/S、F/T、J/P 任意命中加分 */
  mbti: string[];
  /** 礼物性质 */
  kind: '实用' | '体验' | '纪念' | '仪式';
  how: string;
  longDistance: string;
}

const GIFTS: GiftDef[] = [
  {
    name: '定制手作相册 / 回忆册', emoji: '📖', base: '150–600',
    hobbies: ['摄影', '旅行', '手工', '画画'], mbti: ['F', 'N'], kind: '纪念',
    how: '挑 30–50 张你们的合照与聊天截图，按时间排，每一页写一句当时的心情',
    longDistance: '寄过去需要 3–7 天，务必提前；怕丢就走顺丰并保价'
  },
  {
    name: '一对情侣睡衣 / 家居服', emoji: '🛌', base: '200–800',
    hobbies: ['居家', '追剧'], mbti: ['I', 'S'], kind: '实用',
    how: '选纯棉或莫代尔，买同款不同码；别买印大Logo的，会很尴尬',
    longDistance: '可以各买一件同款，视频时穿——「云同步」本身就是仪式感'
  },
  {
    name: '情侣手链 / 对戒（刻字）', emoji: '💍', base: '300–3000',
    hobbies: ['穿搭', '首饰'], mbti: ['F', 'S'], kind: '纪念',
    how: '刻在一起那天的日期或经纬度（两地坐标各一个更有意义）；选 925 银或 18K 金，避开合金',
    longDistance: '尺寸一定要先问到（借朋友帮忙量，或用他现有戒指量内径）'
  },
  {
    name: '他念叨很久的那件数码产品', emoji: '🎧', base: '500–4000',
    hobbies: ['数码', '游戏', '音乐', '摄影'], mbti: ['T', 'S'], kind: '实用',
    how: '翻他最近三个月的购物车/收藏夹，「念叨过的」才是真的想要',
    longDistance: '走官方渠道，异地退换货太麻烦，别图便宜买非官方'
  },
  {
    name: '一次见面机票 / 高铁票', emoji: '✈️', base: '500–3000',
    hobbies: ['旅行'], mbti: ['E', 'P'], kind: '体验',
    how: '订他来你这边或你过去，附一张手写卡片写上日期；日期务必先确认他有空',
    longDistance: '异地恋最有效的礼物永远是一张票，没有之一'
  },
  {
    name: '提前录好的生日视频', emoji: '🎬', base: '0–200',
    hobbies: ['摄影', '音乐'], mbti: ['F', 'N'], kind: '纪念',
    how: '剪 3–5 分钟：你们的合照 + 你们各自说的话 + 一句「明年我一定在你身边」',
    longDistance: '零成本但杀伤力最大，零点整发给他'
  },
  {
    name: '他喜欢的香水 / 香氛', emoji: '🌷', base: '300–1500',
    hobbies: ['香氛', '穿搭', '护肤'], mbti: ['S', 'F'], kind: '仪式',
    how: '必须知道他偏好（木质/柑橘/海洋），不知道就买小样套装让他自己挑',
    longDistance: '液体类快递有限制，走陆运并提前下单'
  },
  {
    name: '定制星空图 / 那天的月亮', emoji: '🌌', base: '100–500',
    hobbies: ['天文', '摄影', '画画'], mbti: ['N', 'F'], kind: '纪念',
    how: '用你们在一起那天 + 地点生成一张星空图，装裱起来',
    longDistance: '可先发电子版，实体后寄——零点不能没有东西'
  },
  {
    name: '一场线上同步观影 + 零食包', emoji: '🎞️', base: '100–400',
    hobbies: ['电影', '追剧', '美食'], mbti: ['I', 'F'], kind: '体验',
    how: '约好时间同步播放同一部片子，提前寄一份零食到他那',
    longDistance: '异地恋的日常仪式，比一年一次的昂贵礼物更能维持温度'
  },
  {
    name: '机械键盘 / 外设', emoji: '⌨️', base: '300–2000',
    hobbies: ['游戏', '数码', '编程'], mbti: ['T', 'I'], kind: '实用',
    how: '先摸清轴体偏好（红轴安静/青轴清脆/茶轴折中），别盲买',
    longDistance: '易碎，包装要扎实'
  },
  {
    name: '一双他舍不得买的鞋', emoji: '👟', base: '500–2500',
    hobbies: ['运动', '穿搭', '跑步'], mbti: ['S', 'T'], kind: '实用',
    how: '鞋码必须确认（问朋友/看他现有鞋标）；选他风格里缺的那一类',
    longDistance: '异地退换麻烦，优先选支持免费退换的渠道'
  },
  {
    name: '亲手织的围巾 / 手工', emoji: '🧶', base: '50–300',
    hobbies: ['手工', '居家'], mbti: ['F', 'S'], kind: '纪念',
    how: '时间成本很高，至少提前一个月开始；手艺不好就换成手写的 100 件小事',
    longDistance: '「花时间」本身就是异地恋最稀缺的礼物'
  },
  {
    name: '写满 100 件小事的卡片', emoji: '💌', base: '20–100',
    hobbies: ['写作', '阅读'], mbti: ['N', 'F'], kind: '纪念',
    how: '写 100 条「我喜欢你的…」，可以一次写完，也可以做成 100 张小纸条分装',
    longDistance: '成本极低但最打动人，适合预算紧的时候'
  },
  {
    name: '他爱吃的零食 / 家乡味大礼包', emoji: '🍪', base: '100–500',
    hobbies: ['美食'], mbti: ['S'], kind: '实用',
    how: '挑你所在城市他吃不到的东西，附一句「这是我们这边的味道」',
    longDistance: '注意保质期与天气（夏天巧克力会化）'
  },
  {
    name: '一次他没体验过的项目', emoji: '🎢', base: '200–1500',
    hobbies: ['运动', '旅行', '摄影'], mbti: ['E', 'P'], kind: '体验',
    how: '滑雪/潜水/陶艺/烘焙课——买「两个人一起做」的版本，预约到见面那天',
    longDistance: '买可改期的，异地恋的日期永远有变数'
  },
  {
    name: '一块表', emoji: '⌚', base: '800–8000',
    hobbies: ['穿搭', '数码'], mbti: ['T', 'J'], kind: '实用',
    how: '看风格：运动选智能表、通勤选简约机械/石英；表盘大小按他手腕',
    longDistance: '贵重物品务必保价并当面签收'
  },
  {
    name: '一束花 + 蛋糕外卖', emoji: '💐', base: '150–600',
    hobbies: ['美食', '居家'], mbti: ['F'], kind: '仪式',
    how: '直接外卖下单到他地址，备注写上祝福语；选他所在城市能配送的店',
    longDistance: '当天必达，是最稳的「不会迟到」方案'
  },
  {
    name: '一套他喜欢的书 / 专辑', emoji: '📚', base: '100–600',
    hobbies: ['阅读', '音乐'], mbti: ['I', 'N'], kind: '实用',
    how: '选精装版或签名本，扉页写一段话——书的价值在于那句话',
    longDistance: '不易坏，物流最省心'
  }
];

export const MBTI_LIST = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'];

export const HOBBY_LIST = ['游戏', '摄影', '旅行', '美食', '音乐', '电影', '阅读', '运动', '跑步', '健身',
  '数码', '编程', '画画', '手工', '穿搭', '护肤', '香氛', '天文', '居家', '追剧', '写作', '咖啡', '宠物'];

export interface GiftQuery {
  mbti: string;
  hobbies: string[];
  budget: BudgetKey;
  zodiac: string;
  /** 在一起天数（决定礼物尺度） */
  days?: number;
}

export function giftIdeas(q: GiftQuery): GiftIdea[] {
  const band = BAND[q.budget || 'entry'];
  const k = band.k;
  const scored = GIFTS.map((g) => {
    let score = 0;
    (q.hobbies || []).forEach((h) => { if (g.hobbies.indexOf(h) >= 0) score += 5; });
    const m = (q.mbti || '').toUpperCase();
    g.mbti.forEach((x) => { if (m.indexOf(x) >= 0) score += 3; });
    if (q.zodiac) score += 1;
    // 认识时间越长，纪念型礼物越有价值
    if ((q.days || 0) > 365 && g.kind === '纪念') score += 2;
    if ((q.days || 0) < 100 && g.kind === '体验') score += 2;
    return { g, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6).map((x) => ({
    name: x.g.name,
    emoji: x.g.emoji,
    price: scale(x.g.base, k),
    reason: buildReason(x.g, q),
    how: x.g.how,
    longDistance: x.g.longDistance,
    score: x.score
  }));
}

function scale(base: string, k: number): string {
  const nums = base.match(/\d+/g);
  if (!nums || nums.length < 2) return base;
  const a = Math.round((Number(nums[0]) * k) / 50) * 50;
  const b = Math.round((Number(nums[1]) * k) / 50) * 50;
  return `${a}–${b} 元`;
}

function buildReason(g: GiftDef, q: GiftQuery): string {
  const parts: string[] = [];
  const hit = (q.hobbies || []).filter((h) => g.hobbies.indexOf(h) >= 0);
  if (hit.length) parts.push(`他喜欢${hit.join('、')}`);
  const m = (q.mbti || '').toUpperCase();
  const mh = g.mbti.filter((x) => m.indexOf(x) >= 0);
  if (mh.length && m) parts.push(`${m} 型更吃「${g.kind}型」礼物`);
  if (q.zodiac) {
    const t = zodiacTrait(q.zodiac);
    if (t) parts.push(t);
  }
  if (!parts.length) parts.push('通用稳妥款，不容易出错');
  return parts.join('｜');
}

/** 直接从关系档案推导一份送礼建议（页面一键用） */
export function giftForHim(): GiftIdea[] {
  const r = getRelation();
  const w = getWardrobe();
  const zodiac = r.him.zodiac || zodiacOf(r.him.birthday);
  return giftIdeas({
    mbti: r.him.mbti,
    hobbies: r.him.hobbies || [],
    budget: w.budget || 'entry',
    zodiac
  });
}

/** 生日当天的「今日行动清单」 */
export function birthdayActions(nickname: string, stat: BirthdayStat): string[] {
  const who = nickname || '他';
  const out: string[] = [];
  if (stat.isToday) {
    out.push(`零点整发一句「${who}，生日快乐」——异地恋最怕的就是这句晚了`);
    out.push('礼物如果还没到，立刻改送：外卖蛋糕 / 电子券 / 一封长信，别让他空着手过生日');
    out.push('约一个视频通话的时间，生日当天一定要看到脸');
    out.push('把你们的合照发一条朋友圈，配文别太长，一句就够');
  } else if (stat.days <= 7) {
    out.push('确认礼物物流，异地寄送至少留 3 天缓冲');
    out.push('提前订好蛋糕/鲜花外卖到他地址，当天配送最容易爆单');
    out.push('准备一段话或一段视频，生日当天发');
  } else if (stat.days <= 30) {
    out.push('现在下单刚好，定制类（刻字/相册）需要 7–15 天');
    out.push('悄悄问他最近想要什么——随口问到的答案通常最准');
  } else {
    out.push('时间充裕，可以先记下他最近提到过的东西');
  }
  return out;
}
