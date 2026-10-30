// utils/countdown-store.ts
// 倒数日/正数日数据层：本地存储 CRUD + 置顶 + 完成归档 + 展示派生（天/时/分/秒）
// 设计与 ledger-store / memo-store 一致：本地优先，展示字段在 refresh 派生，不落盘
import { get, set } from './storage';
import type { CdEvent, CdDisplay, CdFilterKey, CdEmotion, CdCategory } from './countdown-types';

const KEY = 'countdown_events';

/* ==================== 情绪体系 ====================
   倒数日不只是计时工具，也是「人生重要时刻记录册」：
   期待 / 回忆 / 纪念 / 遗憾 / 想念 / 成长 各有一套视觉语言。
   低饱和、高级、克制，不做高饱和糖果色。 */

export interface CdEmotionDef {
  key: CdEmotion;
  label: string;
  icon: string;
  /** 标签底色 */
  bg: string;
  /** 标签文字色 */
  color: string;
  /** 一句引导语（分类条右侧 / Hero 贴纸） */
  hint: string;
}

export const CD_EMOTIONS: CdEmotionDef[] = [
  { key: 'expect', label: '期待', icon: '🌸', bg: '#FFF0F2', color: '#D97889', hint: '愿所有的等待，都有意义' },
  { key: 'memory', label: '回忆', icon: '📷', bg: '#EEF3F8', color: '#7189A3', hint: '那天光很轻，风也很轻' },
  { key: 'anniv',  label: '纪念', icon: '♡',  bg: '#FFF4DC', color: '#C5964A', hint: '认真记住的每一天' },
  { key: 'regret', label: '遗憾', icon: '☁',  bg: '#F0EDF2', color: '#887A8D', hint: '来不及说的，都留在心里' },
  { key: 'miss',   label: '想念', icon: '♡',  bg: '#F6EAF2', color: '#B46F9B', hint: '有些人住在很久以前' },
  { key: 'growth', label: '成长', icon: '🍃', bg: '#EAF4EB', color: '#729477', hint: '走过的路，都算数' }
];

export const CD_EMOTION_MAP: Record<string, CdEmotionDef> = CD_EMOTIONS.reduce(
  (acc, e) => { acc[e.key] = e; return acc; },
  {} as Record<string, CdEmotionDef>
);

/** 内置情绪配图池（本地压缩图，新建时一键选用 / 无图时稳定兜底） */
export const CD_PHOTO_POOL: { key: string; label: string; src: string }[] = [
  { key: 'sea',    label: '海边黄昏', src: '/subpackages/toolbox/assets/countdown/hero.jpg' },
  { key: 'sakura', label: '春日樱花', src: '/subpackages/toolbox/assets/countdown/cd-sakura.jpg' },
  { key: 'night',  label: '城市夜色', src: '/subpackages/toolbox/assets/countdown/cd-night.jpg' },
  { key: 'shore',  label: '清晨海面', src: '/subpackages/toolbox/assets/countdown/cd-sea.jpg' },
  { key: 'cat',    label: '午后猫咪', src: '/subpackages/toolbox/assets/countdown/cd-cat.jpg' },
  { key: 'diary',  label: '旧日手记', src: '/subpackages/toolbox/assets/countdown/cd-diary.jpg' }
];

/** 手账封面池：12 张，随手账风设计稿落地（编辑器可横向选卡） */
export const CD_COVERS: { key: string; src: string }[] = [
  { key: 'a1', src: '/subpackages/toolbox/assets/countdown/cd-ca1.jpg' },
  { key: 'a2', src: '/subpackages/toolbox/assets/countdown/cd-ca2.jpg' },
  { key: 'a3', src: '/subpackages/toolbox/assets/countdown/cd-ca3.jpg' },
  { key: 'a4', src: '/subpackages/toolbox/assets/countdown/cd-ca4.jpg' },
  { key: 'a5', src: '/subpackages/toolbox/assets/countdown/cd-ca5.jpg' },
  { key: 'a6', src: '/subpackages/toolbox/assets/countdown/cd-ca6.jpg' },
  { key: 'b1', src: '/subpackages/toolbox/assets/countdown/cd-cb1.jpg' },
  { key: 'b2', src: '/subpackages/toolbox/assets/countdown/cd-cb2.jpg' },
  { key: 'b3', src: '/subpackages/toolbox/assets/countdown/cd-cb3.jpg' },
  { key: 'b4', src: '/subpackages/toolbox/assets/countdown/cd-cb4.jpg' },
  { key: 'b5', src: '/subpackages/toolbox/assets/countdown/cd-cb5.jpg' },
  { key: 'b6', src: '/subpackages/toolbox/assets/countdown/cd-cb6.jpg' }
];

/** 情绪 → 封面色系（对应设计稿 tag.pink / yellow / blue / green / purple） */
export const CD_EMOTION_TONE: Record<CdEmotion, string> = {
  expect: 'pink',
  memory: 'yellow',
  anniv: 'purple',
  regret: 'green',
  miss: 'pink',
  growth: 'green'
};

/** 按 id 稳定挑一张内置图（同一条每次进入拿到同一张，不闪变） */
export function defaultPhotoFor(seed: string): string {
  let h = 0;
  const s = String(seed || 'x');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CD_COVERS[h % CD_COVERS.length].src;
}

/** 情绪归一：老数据没有该字段时按时间自动推断 */
export function normalizeEmotion(raw: unknown, isFuture: boolean, isToday: boolean): CdEmotion {
  const s = String(raw || '').trim();
  if (CD_EMOTION_MAP[s]) return s as CdEmotion;
  if (isToday) return 'anniv';
  return isFuture ? 'expect' : 'memory';
}

/* ==================== 读取 / 保存 ==================== */

export function loadEvents(): CdEvent[] {
  const list = get<CdEvent[]>(KEY, []);
  if (!Array.isArray(list)) return [];
  // 兼容旧数据：补默认字段
  return list.map((e) => ({
    ...e,
    type: e.type === 'countup' ? 'countup' : 'countdown',
    pinned: !!e.pinned,
    done: !!e.done,
    fav: !!e.fav,
    photo: e.photo ? String(e.photo) : undefined
  }));
}

export function saveEvents(list: CdEvent[]): void {
  set(KEY, list);
}

/* ==================== CRUD ==================== */

export function addEvent(
  list: CdEvent[],
  data: Omit<CdEvent, 'id' | 'pinned' | 'done' | 'createTime'>
): CdEvent[] {
  const next: CdEvent[] = [
    ...list,
    {
      ...data,
      id: 'cd_' + Date.now() + '_' + Math.floor(Math.random() * 1e4),
      pinned: false,
      done: false,
      createTime: Date.now()
    }
  ];
  saveEvents(next);
  return next;
}

export function updateEvent(
  list: CdEvent[],
  id: string,
  patch: Partial<Omit<CdEvent, 'id' | 'createTime'>>
): CdEvent[] {
  const next = list.map((e) => (e.id === id ? { ...e, ...patch } : e));
  saveEvents(next);
  return next;
}

export function removeEvent(list: CdEvent[], id: string): CdEvent[] {
  const next = list.filter((e) => e.id !== id);
  saveEvents(next);
  return next;
}

export function togglePin(list: CdEvent[], id: string): CdEvent[] {
  const next = list.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e));
  saveEvents(next);
  return next;
}

export function toggleDone(list: CdEvent[], id: string): CdEvent[] {
  // 归档时取消置顶（归档区不参与置顶排序）
  const next = list.map((e) =>
    e.id === id ? { ...e, done: !e.done, pinned: e.done ? e.pinned : false } : e
  );
  saveEvents(next);
  return next;
}

/** 收藏切换（卡片右上角小心心，不影响归档/置顶） */
export function toggleFav(list: CdEvent[], id: string): CdEvent[] {
  const next = list.map((e) => (e.id === id ? { ...e, fav: !e.fav } : e));
  saveEvents(next);
  return next;
}

/* ==================== 展示派生 ==================== */

const pad2 = (n: number) => (n < 10 ? '0' + n : '' + n);

/** 'YYYY-MM-DD HH:mm' → 时间戳（非法返回 0，排序沉底） */
export function parseTarget(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0).getTime();
}

/** 'YYYY-MM-DD HH:mm' → picker 用 date / time 两段 */
export function splitTarget(s: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(s || '');
  return { date: m ? m[1] : '', time: m ? m[2] : '09:00' };
}

/** date + time → 'YYYY-MM-DD HH:mm' */
export function joinTarget(date: string, time: string): string {
  return `${date || ''} ${time || '09:00'}`.trim();
}

/** 现在时刻偏移 n 天的默认目标（09:00） */
export function defaultTarget(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 864e5);
  d.setHours(9, 0, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} 09:00`;
}

/**
 * 单个事件派生展示数据：
 * - 倒数日：未来 → 距目标剩余；已过 → 已过去
 * - 正数日：统一显示已过去
 */
export function deriveDisplay(e: CdEvent, now = Date.now()): CdDisplay {
  const t = parseTarget(e.target);
  const diff = t - now; // >0 未来（倒数剩余），<0 过去
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 864e5);
  const hours = Math.floor((abs % 864e5) / 36e5);
  const mins = Math.floor((abs % 36e5) / 6e4);
  const secs = Math.floor((abs % 6e4) / 1000);
  const isFuture = diff > 0;
  const isToday = days === 0;
  const showRemain = e.type === 'countdown' && isFuture;

  /* 情绪：用户没选则按时间自动给一个默认倾向 */
  const emoKey = normalizeEmotion(e.emotion, isFuture, isToday);
  const emo = CD_EMOTION_MAP[emoKey] || CD_EMOTION_MAP.expect;
  const dayPhrase = isToday
    ? '就是今天 ♡'
    : (isFuture ? `还有 ${days} 天` : `已过 ${days} 天`);
  const photoFallback = `linear-gradient(160deg, ${emo.bg}, ${emo.bg} 55%, #FFFDFB)`;

  const sp = splitTarget(e.target);
  const dObj = new Date(sp.date + 'T00:00:00');
  const wk = Number.isNaN(dObj.getTime())
    ? ''
    : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dObj.getDay()];

  /* 手账角标：情绪名 + 对应色系；橡皮章：已过用灰、远期未来用蓝、近期用粉 */
  const tagTone = CD_EMOTION_TONE[emoKey] || 'pink';
  const stampTone = !isFuture ? 'gray' : (days > 180 ? 'blue' : 'pink');

  return {
    ...e,
    isFuture,
    bigNum: days,
    label: e.type === 'countdown' ? (isFuture ? '距目标还有' : '已过去') : '已经过去',
    days,
    hours,
    mins,
    secs,
    dText: `${days} 天 ${hours} 时 ${mins} 分`,
    expiredText: showRemain ? '' : '已到期',
    timeText: e.target,
    emotion: emoKey,
    emotionLabel: emo.label,
    emotionIcon: emo.icon,
    emotionBg: emo.bg,
    emotionColor: emo.color,
    dayPhrase,
    isToday,
    photo: e.photo || defaultPhotoFor(e.id),
    photoFallback,
    dateText: sp.date,
    weekdayText: wk,
    fav: !!e.fav,
    tagText: emo.label,
    tagTone,
    stampPre: isToday ? '就是' : (isFuture ? '还有' : '已过'),
    stampTone,
    dotDate: sp.date.replace(/-/g, '.')
  };
}

/**
 * 过滤 + 排序（返回展示数据）：
 * - 排序：置顶优先 → 目标日期升序（最近的最前面）
 * - 归档事件单独一组沉底
 */
export function refreshView(
  list: CdEvent[],
  filter: CdFilterKey,
  now = Date.now()
): { active: CdDisplay[]; archived: CdDisplay[] } {
  const pinnedFirst = (a: CdEvent, b: CdEvent) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || parseTarget(a.target) - parseTarget(b.target);

  const live = list.filter((e) => !e.done);
  const archived = list.filter((e) => e.done);

  let filtered = live;
  if (filter === 'countdown') filtered = live.filter((e) => e.type === 'countdown');
  else if (filter === 'countup') filtered = live.filter((e) => e.type === 'countup');

  const active = [...filtered].sort(pinnedFirst).map((e) => deriveDisplay(e, now));
  // 归档区：全部/归档视图展示，按创建时间倒序（最近添加在前）
  const showArchived = filter === 'archive' || filter === 'all' ? archived : [];
  const archivedDisp = [...showArchived]
    .sort((a, b) => b.createTime - a.createTime)
    .map((e) => deriveDisplay(e, now));
  return { active, archived: archivedDisp };
}

/* ==================== 情绪分组（横向「我的倒数日」条） ====================
   把六个分类收成 5 组更柔和的主题，避免「工作/考试/生日」这种冷冰冰的清单感。 */

export interface CdGroupDef {
  key: string;
  label: string;
  icon: string;
  color: string;
  soft: string;
  cats: CdCategory[];
}

export const CD_EMOTION_GROUPS: CdGroupDef[] = [
  { key: 'love',   label: '爱情', icon: '♡', color: '#E4708E', soft: '#FDEDF3', cats: ['纪念日'] },
  { key: 'study',  label: '学习', icon: '🎓', color: '#8C86D8', soft: '#EFEEFB', cats: ['考试'] },
  { key: 'work',   label: '工作', icon: '💼', color: '#6E9CBF', soft: '#EDF5F9', cats: ['工作'] },
  { key: 'travel', label: '旅行', icon: '✈', color: '#5FB3C4', soft: '#EAF7F9', cats: ['旅行'] },
  { key: 'life',   label: '生活', icon: '☺', color: '#D9A45C', soft: '#FDF4E9', cats: ['生日', '自定义'] }
];

/** Hero 贴纸文案（按情绪给不同句子） */
export const CD_HERO_SCRIPT: Record<string, string[]> = {
  expect: ['有些日子很近，', '有些日子很远，', '但都值得期待。'],
  memory: ['那些回不去的日子，', '都被好好收着，', '偶尔翻一翻。'],
  anniv:  ['认真记住的每一天，', '都算数。'],
  regret: ['有些话来不及说，', '就把日期留在这里。'],
  miss:   ['有些人住在很久以前，', '也住在很久以后。'],
  growth: ['走过的路都算数，', '你比昨天更靠近一点。']
};

/**
 * Hero「未来可期」选哪一条：
 * 置顶优先 → 最近的未归档未来 → 最近的未归档（含今天）→ 最近任意未归档 → 最近归档。
 * 保证任何筛选下 Hero 都不为空。
 */
export function pickHero(
  all: CdEvent[],
  now = Date.now()
): CdDisplay | null {
  if (!all.length) return null;
  const live = all.filter((e) => !e.done);
  const pool = live.length ? live : all;
  const withTs = pool.map((e) => ({ e, ts: parseTarget(e.target) }));
  const pinned = withTs.filter((x) => x.e.pinned).sort((a, b) => a.ts - b.ts)[0];
  if (pinned) return deriveDisplay(pinned.e, now);
  const future = withTs.filter((x) => x.ts >= now).sort((a, b) => a.ts - b.ts)[0];
  if (future) return deriveDisplay(future.e, now);
  const past = withTs.sort((a, b) => b.ts - a.ts)[0];
  return past ? deriveDisplay(past.e, now) : null;
}
