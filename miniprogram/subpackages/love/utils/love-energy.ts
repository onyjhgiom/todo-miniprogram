// utils/love-energy.ts
// 异地恋能量站 · 爱情能量 / 爱心等级 / 连续互动 / 升温成就
//
// 设计要点：
//  · 能量是**可解释的**：每次互动注入多少分写在记录里，用户能核对，不是黑盒；
//  · 等级阈值是**前紧后松再收紧**的曲线，前期升级快给正反馈，后期需要真正长期经营；
//  · 连续天数是「异地恋最真实的指标」——它不看你有多甜，看你们有没有断过；
//  · 彩蛋文案**未达成时打码**，揭晓才有惊喜感，这是产品上唯一值得保留的小心思。
import { loadInteractions, loadMemories, getRelation, todayYmd, diffDays, addDays, fmtYmd } from './love-store';
import type { Interaction } from './love-types';

/* ============================ 互动类型与能量 ============================ */

export interface InteractType {
  key: string;
  label: string;
  emoji: string;
  /** 基础能量 */
  base: number;
  /** 每 15 分钟额外能量 */
  per15: number;
  /** 单条上限 */
  max: number;
  /** 建议时长（分钟） */
  suggest: number;
}

export const INTERACTIONS: InteractType[] = [
  { key: 'chat', label: '文字聊天', emoji: '💬', base: 2, per15: 1, max: 8, suggest: 20 },
  { key: 'voice', label: '语音通话', emoji: '📞', base: 4, per15: 2, max: 14, suggest: 30 },
  { key: 'video', label: '视频通话', emoji: '📹', base: 8, per15: 2, max: 20, suggest: 45 },
  { key: 'movie', label: '一起看剧', emoji: '🎬', base: 10, per15: 1, max: 16, suggest: 90 },
  { key: 'game', label: '一起打游戏', emoji: '🎮', base: 8, per15: 1, max: 14, suggest: 60 },
  { key: 'cook', label: '云吃饭', emoji: '🍜', base: 10, per15: 1, max: 15, suggest: 40 },
  { key: 'walk', label: '云散步', emoji: '🚶', base: 6, per15: 1, max: 12, suggest: 30 },
  { key: 'read', label: '一起学习', emoji: '📖', base: 8, per15: 1, max: 14, suggest: 60 },
  { key: 'letter', label: '写长信', emoji: '✉️', base: 14, per15: 0, max: 18, suggest: 30 },
  { key: 'gift', label: '寄/收礼物', emoji: '🎁', base: 18, per15: 0, max: 22, suggest: 10 },
  { key: 'meet', label: '见面', emoji: '✈️', base: 35, per15: 0, max: 40, suggest: 480 },
  { key: 'plan', label: '一起规划', emoji: '🗺️', base: 12, per15: 1, max: 18, suggest: 40 },
  { key: 'care', label: '照顾对方', emoji: '🩹', base: 12, per15: 1, max: 16, suggest: 30 },
  { key: 'other', label: '其他', emoji: '⭐', base: 4, per15: 1, max: 10, suggest: 20 },
  // 「记录一段回忆」也会注入能量（爱情球飞入动画落地时写入）。
  // 它不出现在互动选择器里（见 PICKABLE_INTERACTIONS），否则和手动记互动重复计分。
  { key: 'memory', label: '记录回忆', emoji: '🕰️', base: 20, per15: 0, max: 20, suggest: 0 }
];

/** 可在互动表单里选择的类型（排除由其他入口自动写入的类型） */
export const PICKABLE_INTERACTIONS: InteractType[] = INTERACTIONS.filter((t) => t.key !== 'memory');

/** 写一条回忆注入的能量（爱情球 +20） */
export function memoryEnergy(): number {
  return energyOf('memory', 0);
}

const TYPE_MAP: Record<string, InteractType> = {};
INTERACTIONS.forEach((t) => { TYPE_MAP[t.key] = t; });

export function interactType(key: string): InteractType {
  return TYPE_MAP[key] || TYPE_MAP.other;
}

/** 计算一次互动应注入的能量 */
export function energyOf(type: string, minutes: number): number {
  const t = interactType(type);
  const extra = Math.floor((Math.max(0, Number(minutes) || 0)) / 15) * t.per15;
  return Math.max(t.base, Math.min(t.max, t.base + extra));
}

/* ============================ 爱心等级 ============================ */

export interface HeartLevel {
  lv: number;
  name: string;
  /** 解锁的模式名 */
  mode: string;
  /** 达到该等级需要的累计能量 */
  need: number;
  /** 爱心主色（渐变两色） */
  c1: string;
  c2: string;
  /** 外发光色 */
  glow: string;
  /** 环绕装饰数量 */
  orbit: number;
  /** 呼吸动画周期（ms），越小跳得越快 */
  beat: number;
  /** 等级描述 */
  desc: string;
}

export const LEVELS: HeartLevel[] = [
  { lv: 1, name: '心动微光', mode: '心动呼吸', need: 0, c1: '#FFB8D9', c2: '#FFD9E8', glow: 'rgba(255,150,190,0.4)', orbit: 0, beat: 2200, desc: '刚刚开始，每一次消息都让它亮一下' },
  { lv: 2, name: '双心跳动', mode: '双人同步心跳', need: 60, c1: '#FF8FC8', c2: '#7FB8F0', glow: 'rgba(255,130,180,0.45)', orbit: 2, beat: 2000, desc: '你们开始同频了，解锁「双人同步心跳」' },
  { lv: 3, name: '星空缠绵', mode: '星轨模式', need: 180, c1: '#A78BFA', c2: '#D8B4FE', glow: 'rgba(170,140,250,0.5)', orbit: 4, beat: 1800, desc: '轨迹开始缠绕，解锁「星轨模式」' },
  { lv: 4, name: '花海环绕', mode: '花瓣模式', need: 400, c1: '#F5A96F', c2: '#FFC0A0', glow: 'rgba(245,170,120,0.5)', orbit: 6, beat: 1650, desc: '四周开满了花，解锁「花瓣模式」' },
  { lv: 5, name: '极光光晕', mode: '极光模式', need: 750, c1: '#7FD8E8', c2: '#6FC8F0', glow: 'rgba(130,215,235,0.5)', orbit: 8, beat: 1500, desc: '冷色极光笼罩，解锁「极光模式」' },
  { lv: 6, name: '烈火绽放', mode: '烈火模式', need: 1250, c1: '#FF6B5F', c2: '#F5B84B', glow: 'rgba(255,120,90,0.55)', orbit: 10, beat: 1350, desc: '像烈火一样挡不住，解锁「烈火模式」' },
  { lv: 7, name: '蝶恋花语', mode: '蝶舞模式', need: 1800, c1: '#C77FF0', c2: '#F07BD8', glow: 'rgba(200,130,240,0.55)', orbit: 12, beat: 1200, desc: '蝴蝶循着花香飞来，解锁「蝶舞模式」' },
  { lv: 8, name: '银河璀璨', mode: '银河模式', need: 2500, c1: '#7FB0F0', c2: '#F07BC0', glow: 'rgba(150,160,245,0.6)', orbit: 14, beat: 1080, desc: '整条银河都转起来了，解锁「银河模式」' },
  { lv: 9, name: '闪心耀世', mode: '王者模式', need: 3500, c1: '#F5C84B', c2: '#F08B4B', glow: 'rgba(245,190,90,0.6)', orbit: 16, beat: 960, desc: '王者加冕，光耀世间，解锁「王者模式」' },
  { lv: 10, name: '永恒挚爱', mode: '永恒模式', need: 5000, c1: '#E8F0FF', c2: '#B8D8F8', glow: 'rgba(200,225,255,0.65)', orbit: 18, beat: 860, desc: '最高形态：永恒挚爱，解锁「永恒模式」' }
];

export interface HeartState {
  /** 累计能量 */
  total: number;
  lv: number;
  cur: HeartLevel;
  next: HeartLevel | null;
  /** 本级的进度 0~100 */
  percent: number;
  /** 距下一级还差多少能量 */
  toNext: number;
  /** 环绕装饰（页面直接用） */
  orbits: { delay: number; emoji: string }[];
  /** 已解锁的模式列表 */
  modes: { lv: number; name: string; mode: string; unlocked: boolean }[];
}

const ORBIT_EMOJI = ['✨', '💫', '⭐', '🌙', '💖', '🫧', '🌟', '💕', '🪐', '☄️', '🌸', '🦋', '🍃', '💎', '🔮', '🕊️', '🌈', '👑'];

export function heartState(total?: number): HeartState {
  const t = typeof total === 'number' ? total : totalEnergy();
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (t >= LEVELS[i].need) idx = i;
  }
  const cur = LEVELS[idx];
  const next = idx + 1 < LEVELS.length ? LEVELS[idx + 1] : null;
  const span = next ? next.need - cur.need : 1;
  const got = t - cur.need;
  const percent = next ? Math.max(0, Math.min(100, Math.round((got / span) * 100))) : 100;
  const orbits: { delay: number; emoji: string }[] = [];
  for (let i = 0; i < cur.orbit; i++) {
    orbits.push({ delay: Math.round((i * 3000) / Math.max(1, cur.orbit)), emoji: ORBIT_EMOJI[i % ORBIT_EMOJI.length] });
  }
  return {
    total: t,
    lv: cur.lv,
    cur,
    next,
    percent,
    toNext: next ? next.need - t : 0,
    orbits,
    modes: LEVELS.map((l) => ({ lv: l.lv, name: l.name, mode: l.mode, unlocked: t >= l.need }))
  };
}

export function totalEnergy(): number {
  return loadInteractions().reduce((s, x) => s + (Number(x.energy) || 0), 0);
}

/* ============================ 爱心外观（任意等级） ============================ */
/* 图鉴用：给定等级即可渲染该等级爱心的颜色/光晕/环绕，与是否解锁无关。
   查看图鉴不会消耗也不会解锁任何能量——这里只是「外观预览」。 */

export interface HeartVisual {
  /** 直接挂到爱心容器 style 上的 CSS 变量串 */
  style: string;
  /** 环绕装饰（坐标基于 320x300 的爱心画布） */
  orbits: { emoji: string; left: string; top: string; delay: string }[];
  /** 视觉层级：1 简洁（Lv1-3）· 2 精致（Lv4-7）· 3 华丽（Lv8-10） */
  tier: 1 | 2 | 3;
  /** 视觉层级类名，直接拼到 class 上用 */
  tierCls: string;
  /** 星光粒子：等级越高越密（数量已按性能上限收敛） */
  sparks: { left: string; top: string; size: string; delay: string; dur: string; op: string }[];
}

/** 把颜色压暗，用于 3D 爱心的暗部/厚度 */
function darken(hex: string, f: number): string {
  let h = (hex || '#FF7F9C').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.round(r * f);
  g = Math.round(g * f);
  b = Math.round(b * f);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** 把颜色提亮（往白色混），用于 3D 爱心高光/次光晕 */
function lighten(hex: string, f: number): string {
  let h = (hex || '#FF7F9C').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (v: number) => Math.round(v + (255 - v) * f);
  return '#' + [mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** 视觉层级：低级简洁 / 中级精致 / 高级华丽（仅用于外观设计，与解锁无关） */
function tierOf(lv: number): 1 | 2 | 3 {
  if (lv <= 3) return 1;
  if (lv <= 7) return 2;
  return 3;
}

/** 星光粒子数量：按等级递增，上限 10（性能保护：图鉴 10 格同时渲染也不会爆节点） */
function sparkCount(lv: number): number {
  const t = tierOf(lv);
  if (t === 1) return 0;
  return Math.min(10, t === 2 ? 2 + lv : 6 + lv);
}

/** 取某一等级的外观（lv 越界时回落到首尾） */
export function heartVisual(lv: number): HeartVisual {
  const idx = Math.max(0, Math.min(LEVELS.length - 1, (lv | 0) - 1));
  const l = LEVELS[idx] || LEVELS[0];
  const tier = tierOf(l.lv);
  /* 多层配色：高光 c0 → 主色 c1 → 过渡 c2 → 暗部 c3 → 深影 c4，越高级层次越多 */
  const style = [
    `--ht-c1:${l.c1}`,
    `--ht-c2:${l.c2}`,
    `--ht-c3:${darken(l.c2, 0.7)}`,
    `--ht-c4:${darken(l.c1, 0.52)}`,
    `--ht-c0:${lighten(l.c1, 0.62)}`,
    `--ht-glow:${l.glow}`,
    `--ht-glow-2:${lighten(l.c2, 0.34)}`,
    `--ht-ring:${lighten(l.c1, 0.45)}`,
    `--ht-beat:${l.beat}ms`,
    `--ht-tilt:${tier === 3 ? 11 : 16}s`
  ].join(';');
  const orbits: { emoji: string; left: string; top: string; delay: string }[] = [];
  for (let i = 0; i < l.orbit; i++) {
    const ang = (i / Math.max(1, l.orbit)) * Math.PI * 2;
    const r = 132;
    const x = 160 + r * Math.sin(ang);
    const y = 140 - r * Math.cos(ang);
    orbits.push({
      emoji: ORBIT_EMOJI[i % ORBIT_EMOJI.length],
      left: x.toFixed(0) + 'rpx',
      top: y.toFixed(0) + 'rpx',
      delay: Math.round((i * 3000) / Math.max(1, l.orbit)) + 'ms'
    });
  }
  /* 星光粒子：固定角度 dispersion，避免随机导致每次渲染跳动 */
  const sparks: { left: string; top: string; size: string; delay: string; dur: string; op: string }[] = [];
  const sc = sparkCount(l.lv);
  for (let i = 0; i < sc; i++) {
    const gold = 2.399963; // 黄金角，布点均匀自然
    const t = (i + 1) / (sc + 1);
    const r = 60 + 78 * t;
    const ang = i * gold;
    sparks.push({
      left: (160 + r * Math.sin(ang)).toFixed(0) + 'rpx',
      top: (140 - r * Math.cos(ang) * 0.92).toFixed(0) + 'rpx',
      size: (i % 3 === 0 ? 10 : i % 3 === 1 ? 7 : 5) + 'rpx',
      delay: (i * 520 % 2600) + 'ms',
      dur: (2.2 + (i % 4) * 0.55).toFixed(1) + 's',
      op: (0.45 + (i % 3) * 0.18).toFixed(2)
    });
  }
  return { style, orbits, tier, tierCls: 'ay-heart--t' + tier, sparks };
}

/** 图鉴：列出全部等级的外观与解锁状态（不修改任何数据） */
export interface HeartGalleryItem extends HeartVisual {
  lv: number;
  name: string;
  mode: string;
  need: number;
  desc: string;
  unlocked: boolean;
  /** 未解锁时还差多少能量 */
  remain: number;
  /** 是否是当前所处等级（用于图鉴选中态高亮） */
  cur: boolean;
  /** 图鉴卡片专属装饰（环绕 emoji，按设计稿每级一套） */
  deco: string[];
  /** Lv 标签胶囊渐变（inline style，每级一个主题色） */
  tagStyle: string;
  /** 卡片主题光晕色（半透明，铺卡片背景） */
  aura: string;
}

/* 图鉴卡片装饰：按等级主题配一组环绕元素（纯展示，不碰解锁逻辑） */
const GALLERY_DECO: string[][] = [
  ['✨', '💫'],                 // Lv.1 心动微光
  ['💞', '✨'],                 // Lv.2 双心跳动
  ['⭐', '🌟', '✨'],           // Lv.3 星空缠绵
  ['🌸', '💮', '🌺'],           // Lv.4 花海环绕
  ['✨', '🌌'],                 // Lv.5 极光光晕
  ['🔥', '💥'],                 // Lv.6 烈火绽放
  ['🦋', '✨'],                 // Lv.7 蝶恋花语
  ['🪐', '💫', '⭐'],           // Lv.8 银河璀璨
  ['👑', '✨'],                 // Lv.9 闪心耀世
  ['💎', '🕊️', '✨']            // Lv.10 永恒挚爱
];
/* Lv 标签胶囊渐变（设计稿每级一个主题色） */
const GALLERY_TAG: string[] = [
  'linear-gradient(135deg,#FF9EC8,#FFC2DA)',   // 1 粉
  'linear-gradient(135deg,#FF8FC8,#7FB8F0)',   // 2 粉→蓝
  'linear-gradient(135deg,#A78BFA,#C9A7FF)',   // 3 紫
  'linear-gradient(135deg,#F5A96F,#FFC0A0)',   // 4 粉金
  'linear-gradient(135deg,#6FC8E8,#8FD8F0)',   // 5 冰蓝
  'linear-gradient(135deg,#FF6B5F,#F5A84B)',   // 6 红金
  'linear-gradient(135deg,#C77FF0,#F07BD8)',   // 7 幻彩紫
  'linear-gradient(135deg,#7FB0F0,#F07BC0)',   // 8 银河
  'linear-gradient(135deg,#F5C84B,#F08B4B)',   // 9 金
  'linear-gradient(135deg,#B8D8F8,#E8F0FF)'    // 10 白金
];

export function heartGallery(total: number): HeartGalleryItem[] {
  let curIdx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (total >= LEVELS[i].need) curIdx = i;
  }
  return LEVELS.map((l, i) => {
    const v = heartVisual(l.lv);
    return {
      ...v,
      lv: l.lv,
      name: l.name,
      mode: l.mode,
      need: l.need,
      desc: l.desc,
      unlocked: total >= l.need,
      remain: Math.max(0, l.need - total),
      cur: i === curIdx,
      deco: GALLERY_DECO[i] || [],
      tagStyle: `background:${GALLERY_TAG[i] || GALLERY_TAG[0]}`,
      aura: l.glow
    };
  });
}

/* ============================ 连续互动天数 ============================ */

export interface StreakState {
  /** 当前连续天数 */
  days: number;
  /** 最长纪录 */
  best: number;
  /** 今天是否已互动 */
  todayDone: boolean;
  /** 昨天是否已互动（决定今天断了没） */
  keptYesterday: boolean;
  /** 鼓励文案 */
  tip: string;
}

export function streakState(): StreakState {
  const list = loadInteractions();
  if (!list.length) {
    return { days: 0, best: 0, todayDone: false, keptYesterday: false, tip: '记录第一次互动，连续天数就从今天开始算' };
  }
  const days: string[] = [];
  list.forEach((x) => { if (x.date && days.indexOf(x.date) < 0) days.push(x.date); });
  days.sort();

  const today = todayYmd();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const ystr = fmtYmd(y);

  const todayDone = days.indexOf(today) >= 0;
  const keptYesterday = days.indexOf(ystr) >= 0;

  // 从今天（或昨天）往回数连续
  let cursor = todayDone ? today : (keptYesterday ? ystr : '');
  let count = 0;
  if (cursor) {
    const set: Record<string, boolean> = {};
    days.forEach((d) => { set[d] = true; });
    while (set[cursor]) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
  }

  // 最长纪录：扫一遍
  let best = count;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (diffDays(days[i - 1], days[i]) === 1) { run += 1; if (run > best) best = run; }
    else run = 1;
  }
  if (days.length === 1) best = Math.max(best, 1);

  let tip = '';
  if (!todayDone && count > 0) tip = `连续 ${count} 天了，今天还没记录——说句晚安就能续上`;
  else if (!todayDone) tip = '今天还没有互动记录，发一条消息就开始';
  else if (count >= 30) tip = `连续 ${count} 天，这已经不是坚持，是生活的一部分了`;
  else if (count >= 7) tip = `连续 ${count} 天，节奏很稳，继续保持`;
  else tip = `连续 ${count} 天，开头总是最容易断的时候`;

  return { days: count, best, todayDone, keptYesterday, tip };
}

/* ============================ 升温成就与隐藏彩蛋 ============================ */

export interface Achievement {
  days: number;
  name: string;
  emoji: string;
  unlocked: boolean;
  /** 解锁后揭晓的彩蛋文案；未解锁打码 */
  egg: string;
  /** 打码后的展示 */
  masked: string;
}

const ACHIEVEMENTS: { days: number; name: string; emoji: string; egg: string }[] = [
  { days: 3, name: '三日心动', emoji: '🌱', egg: '他比你以为的更想你——连续第三天，他的消息都赶在你睡前抵达。' },
  { days: 7, name: '一周不降温', emoji: '🔥', egg: '一周了。「早安」和「晚安」已经变成谁也不会先放下的约定。' },
  { days: 14, name: '双周恒温', emoji: '🌡️', egg: '两周。异地最难的不是距离，是把想念说出口的勇气——你们已经说了十四次。' },
  { days: 21, name: '习惯成自然', emoji: '🧩', egg: '习惯有了自己的形状：到点就想拨通那个号码，手比脑子快。' },
  { days: 30, name: '满月心动', emoji: '🌕', egg: '满月。月亮圆了一次，你们的想念也刚好攒够一整轮。' },
  { days: 50, name: '半百之约', emoji: '💯', egg: '五十天。你开始能准确说出他那边几点下雨。' },
  { days: 66, name: '路路通顺', emoji: '🛣️', egg: '六十六，路路顺。地图上那两个点，已经被你们走出了一条看不见的线。' },
  { days: 100, name: '百日炽热', emoji: '💞', egg: '一百天。你曾在深夜怀疑过这段距离，现在你可以把这一百天当作回答。' },
  { days: 180, name: '半年不熄', emoji: '🕯️', egg: '半年。所有「要不就算了」的念头，都被你们熬过去了。' },
  { days: 365, name: '一整年', emoji: '🎂', egg: '一年。等待终于有了具体的长度——是 365 天，也是余生的序章。' }
];

export function achievements(streakDays: number): Achievement[] {
  return ACHIEVEMENTS.map((a) => {
    const unlocked = streakDays >= a.days;
    return {
      days: a.days,
      name: a.name,
      emoji: a.emoji,
      unlocked,
      egg: unlocked ? a.egg : '',
      masked: maskText(a.egg)
    };
  });
}

/** 未解锁时把文案打码，保留字数与标点，制造「看得见摸不着」的感觉 */
function maskText(s: string): string {
  return (s || '').replace(/[\u4e00-\u9fa5A-Za-z0-9]/g, '?');
}

/** 下一个待解锁成就 */
export function nextAchievement(streakDays: number): Achievement | null {
  const list = achievements(streakDays);
  return list.find((a) => !a.unlocked) || null;
}

/** 刚刚跨越的成就（用于弹窗庆祝）：比较上次记录的 streak */
export function justUnlocked(prevDays: number, curDays: number): Achievement | null {
  for (let i = ACHIEVEMENTS.length - 1; i >= 0; i--) {
    const d = ACHIEVEMENTS[i].days;
    if (prevDays < d && curDays >= d) {
      return { days: d, name: ACHIEVEMENTS[i].name, emoji: ACHIEVEMENTS[i].emoji, unlocked: true, egg: ACHIEVEMENTS[i].egg, masked: '' };
    }
  }
  return null;
}

/* ============================ 在一起天数 ============================ */

export interface TogetherStat {
  days: number;
  /** 满多少天/月/年 */
  text: string;
  /** 下一个纪念日的天数差 */
  nextMilestone: { days: number; label: string; left: number } | null;
  /** 纪念日倒计时文本 */
  anniversaryText: string;
}

export function togetherStat(): TogetherStat {
  const r = getRelation();
  if (!r.togetherDate) {
    return { days: 0, text: '还没设置在一起的日子', nextMilestone: null, anniversaryText: '' };
  }
  const today = todayYmd();
  const days = diffDays(r.togetherDate, today) + 1; // 当天算第一天
  if (days < 0) {
    return { days: 0, text: '这个日期还在未来', nextMilestone: null, anniversaryText: '' };
  }
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  let text = `在一起 ${days} 天`;
  if (years >= 1) text += `（${years} 年 ${Math.floor((days - years * 365) / 30)} 个月）`;
  else if (months >= 1) text += `（${months} 个月）`;

  // 下一个百日/周年里程碑
  const marks: { days: number; label: string }[] = [
    { days: 100, label: '100 天' }, { days: 200, label: '200 天' }, { days: 365, label: '一周年' },
    { days: 500, label: '500 天' }, { days: 730, label: '两周年' }, { days: 1000, label: '1000 天' },
    { days: 1095, label: '三周年' }, { days: 1825, label: '五周年' }
  ];
  let next: { days: number; label: string; left: number } | null = null;
  for (let i = 0; i < marks.length; i++) {
    if (days < marks[i].days) { next = { ...marks[i], left: marks[i].days - days }; break; }
  }
  if (!next) {
    const ny = years + 1;
    next = { days: ny * 365, label: `${ny} 周年`, left: ny * 365 - days };
  }

  // 今年的周年日
  const d = new Date();
  const anchor = /^\d{4}-(\d{2})-(\d{2})$/.exec(r.togetherDate);
  let anniversaryText = '';
  if (anchor) {
    let ann = new Date(d.getFullYear(), Number(anchor[2]) - 1, Number(anchor[3]));
    if (ann.getTime() < new Date(fmtYmd(d)).getTime()) ann = new Date(d.getFullYear() + 1, Number(anchor[2]) - 1, Number(anchor[3]));
    const left = Math.round((ann.getTime() - new Date(fmtYmd(d)).getTime()) / 86400000);
    anniversaryText = left === 0 ? `今天就是${years + 1}周年！` : `距${years + 1}周年还有 ${left} 天`;
  }

  return { days, text, nextMilestone: next, anniversaryText };
}

/* ============================ 互动统计 ============================ */

export interface EnergyStat {
  total: number;
  count: number;
  /** 本周能量 */
  week: number;
  /** 今日能量 */
  today: number;
  /** 各类型占比 */
  byType: { key: string; label: string; emoji: string; energy: number; count: number; percent: number }[];
  /** 最近 7 天每日能量（用于柱状图） */
  daily: { date: string; label: string; energy: number }[];
}

export function energyStat(): EnergyStat {
  const list = loadInteractions();
  const total = list.reduce((s, x) => s + (Number(x.energy) || 0), 0);
  const today = todayYmd();
  const weekStart = addDays(today, -6);
  let week = 0;
  let todayE = 0;
  const typeMap: Record<string, { energy: number; count: number }> = {};
  const dailyMap: Record<string, number> = {};

  list.forEach((x) => {
    const e = Number(x.energy) || 0;
    if (x.date === today) todayE += e;
    if (x.date >= weekStart) week += e;
    const k = x.type || 'other';
    if (!typeMap[k]) typeMap[k] = { energy: 0, count: 0 };
    typeMap[k].energy += e;
    typeMap[k].count += 1;
    dailyMap[x.date] = (dailyMap[x.date] || 0) + e;
  });

  const byType = Object.keys(typeMap)
    .map((k) => {
      const t = interactType(k);
      return {
        key: k, label: t.label, emoji: t.emoji,
        energy: typeMap[k].energy, count: typeMap[k].count,
        percent: total ? Math.round((typeMap[k].energy / total) * 100) : 0
      };
    })
    .sort((a, b) => b.energy - a.energy);

  const daily: { date: string; label: string; energy: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    daily.push({ date: d, label: d.slice(5).replace('-', '/'), energy: dailyMap[d] || 0 });
  }

  return { total, count: list.length, week, today: todayE, byType, daily };
}

/** 最近互动列表（用于展示） */
export function recentInteractions(limit = 8): Interaction[] {
  return loadInteractions().slice(0, limit);
}

/** 回忆数量 */
export function memoryCount(): number {
  return loadMemories().length;
}
