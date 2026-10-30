// utils/astro-dashboard.ts
// 星语星球 · 仪表盘数据层（单一真相源）
//
// 【为什么单独一层】
// 需求明确要求「数据不能写死」，并把 currentZodiac / dailyEnergy / love / career /
// wealth / health / constellations / tarot / lenormand / moonPhase / aiInsight
// 集中交给一个 store 管理。页面只消费本层输出的结构体，不自己拼数据。
//
// 【离线优先 + 可接 API】
// 本工程是离线环境（无外部星座 API），当前所有字段由 astro-data 的**确定性**生成器派生
// （同一日期 + 同一星座 → 输出稳定可复现，不会每次刷新跳变）。
// 需要接后端时只需替换 fetchAstroDashboard 的内部实现 —— 页面 await 它即可，
// 因为页面只依赖 AstroDashboard 这个结构，字段不变则页面零改动。
//
// 【与本命星座的关系】
// currentZodiac 直接落在 astro-store 既有的 NS.zodiac（{ signKey }）上，
// 与 pages/astro/horoscope 共用同一个键 → 首页切星座，运势页也跟着变，不会各说各话。

import {
  ZODIACS, zodiacByKey, getHoroscope, formatDate, moonPhase, tarotAll, LENORMAND
} from './astro-data';
import { NS, readJson, writeJson } from './astro-store';

/** 星座节点（= 十二星座；energy 0~1，供 3D 场景决定节点大小/亮度） */
export interface ConstellationNode {
  id: string;
  name: string;
  energy: number;
}

export interface AiInsight {
  summary: string;
  love: number;
  career: number;
  wealth: number;
  health: number;
  /** 生成时间戳（接 API 后用于判断是否需要刷新） */
  updatedAt: number;
}

export interface AstroDashboard {
  /** 本命星座 key（= NS.zodiac.signKey） */
  currentZodiac: string;
  zodiacName: string;
  /** 综合能量 0~100（页面上显示 85/100） */
  dailyEnergy: number;
  /** 四维 0~10 */
  love: number;
  career: number;
  wealth: number;
  health: number;
  /** 十二星座节点 */
  constellations: ConstellationNode[];
  tarot: { cardId: string; name: string; image: string };
  lenormand: { id: string; name: string; symbol: string };
  moonPhase: { name: string; en: string; image: string; illumination: number; ageDays: number; tip: string };
  aiInsight: AiInsight;
  /** 数据归属日期 YYYY-MM-DD */
  date: string;
}

/** 仪表盘附加状态（与星座选择分开存，避免污染 NS.zodiac 的 {signKey} 契约） */
interface DashboardExtras {
  /** 归属日期，跨天自动清零 */
  date: string;
  /** 用户点击核心累积的能量加成（脉冲次数 → 数字增长） */
  bump: number;
}

/* ============================ 本命星座读写（与运势页共享） ============================ */

export function readSignKey(): string {
  const cfg = readJson<{ signKey: string }>(NS.zodiac, { signKey: '' });
  return cfg && cfg.signKey ? cfg.signKey : '';
}

export function writeSignKey(key: string): void {
  // 保持 { signKey } 结构不变：horoscope.ts 也读这个键
  writeJson(NS.zodiac, { signKey: key });
}

/* ============================ 能量加成（脉冲累积） ============================ */

function readExtras(date: string): DashboardExtras {
  const v = readJson<DashboardExtras>(NS.dashboard, { date: '', bump: 0 });
  // 跨天自动归零：昨天的加成不带进今天
  if (!v || v.date !== date) return { date, bump: 0 };
  return { date: v.date, bump: Math.max(0, Math.min(30, Number(v.bump) || 0)) };
}

function writeExtras(date: string, bump: number): void {
  writeJson(NS.dashboard, { date, bump } as DashboardExtras);
}

/** 记一次能量脉冲（点击核心时调用），返回累积后的 bump */
export function addEnergyBump(date: string, delta = 1): number {
  const ex = readExtras(date);
  const next = Math.max(0, Math.min(30, ex.bump + delta));
  writeExtras(date, next);
  return next;
}

/* ============================ 派生 ============================ */

/** 稳定哈希（同 astro-data 的实现，避免跨模块耦合） */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

/** 由综合分数生成「有温度」的一句话（不写死，随分数档位变化） */
function buildSummary(overall: number, top: { name: string; v: number }, low: { name: string; v: number }): string {
  let head: string;
  if (overall >= 8) head = '今日整体能量高涨，适合主动出击，会有意想不到的好机会。';
  else if (overall >= 6) head = '今日整体能量平稳，宜稳中求进。';
  else head = '今日能量偏低，宜放慢节奏，先照顾好自己。';

  // 维度补充：最高维顺势、最低维提醒（分数相同则不啰嗦）
  if (top.v - low.v >= 2) {
    return head + `${top.name}方面最顺（${top.v}/10），${low.name}上多留个心（${low.v}/10）。`;
  }
  return head;
}

/** 十二星座节点：energy = 该星座「今日综合」/10 */
function buildConstellations(date: string): ConstellationNode[] {
  const out: ConstellationNode[] = [];
  for (let i = 0; i < ZODIACS.length; i++) {
    const z = ZODIACS[i];
    const h = getHoroscope(z.key, date, 'today');
    const overall = h ? h.scores.overall : 5;
    out.push({ id: z.key, name: z.name, energy: Math.max(0, Math.min(1, overall / 10)) });
  }
  return out;
}

/** 今日塔罗指引牌（按日期确定性抽取，跨天换牌） */
function buildTarot(date: string): AstroDashboard['tarot'] {
  const all = tarotAll();
  if (!all.length) return { cardId: '', name: '', image: '' };
  const c = all[hash('tarot|' + date) % all.length];
  return { cardId: c.id, name: c.name, image: '/subpackages/tools/assets/astro/card_back.png' };
}

/** 今日雷诺曼指引牌 */
function buildLenormand(date: string): AstroDashboard['lenormand'] {
  if (!LENORMAND.length) return { id: '', name: '', symbol: '' };
  const c = LENORMAND[hash('lenor|' + date) % LENORMAND.length];
  return { id: c.id, name: c.name, symbol: c.symbol };
}

/* ============================ 对外：构建整个仪表盘 ============================ */

/**
 * 构建仪表盘数据（纯本地、同步、确定性）。
 * @param signKey 指定本命星座；不传则读 store
 * @param dateStr 指定日期 YYYY-MM-DD；不传则今天
 */
export function buildDashboard(signKey?: string, dateStr?: string): AstroDashboard {
  const date = dateStr || formatDate(new Date());
  let key = signKey || readSignKey();
  if (!key || !zodiacByKey(key)) {
    key = 'aries';
    writeSignKey(key); // 首次进入写入，保证 horoscope 页也能取到
  }
  const z = zodiacByKey(key);
  const h = getHoroscope(key, date, 'today');
  const sc = h ? h.scores : { overall: 5, love: 5, career: 5, wealth: 5, health: 5 };

  const ex = readExtras(date);
  const dailyEnergy = clamp(sc.overall * 10 + ex.bump, 0, 100);

  const dims = [
    { name: '爱情', v: sc.love },
    { name: '事业', v: sc.career },
    { name: '财富', v: sc.wealth },
    { name: '健康', v: sc.health }
  ];
  let top = dims[0];
  let low = dims[0];
  for (let i = 1; i < dims.length; i++) {
    if (dims[i].v > top.v) top = dims[i];
    if (dims[i].v < low.v) low = dims[i];
  }

  const moon = moonPhase(new Date(date + 'T12:00:00'));

  return {
    currentZodiac: key,
    zodiacName: z ? z.name : '',
    dailyEnergy,
    love: sc.love,
    career: sc.career,
    wealth: sc.wealth,
    health: sc.health,
    constellations: buildConstellations(date),
    tarot: buildTarot(date),
    lenormand: buildLenormand(date),
    moonPhase: {
      name: moon.name,
      en: moon.en,
      image: moon.image,
      illumination: moon.illumination,
      ageDays: moon.ageDays,
      tip: moon.tip
    },
    aiInsight: {
      summary: buildSummary(sc.overall, top, low),
      love: sc.love,
      career: sc.career,
      wealth: sc.wealth,
      health: sc.health,
      updatedAt: Date.now()
    },
    date
  };
}

/**
 * 【接 API 的位置】
 * 目前直接 resolve 本地构建结果（离线工程无外部星座 API）。
 *
 * 接后端时改成本函数内部即可，页面**零改动**：
 *
 *   export async function fetchAstroDashboard(signKey?: string) {
 *     const key = signKey || readSignKey();
 *     const res = await request<AstroDashboard>({
 *       url: '/astro/dashboard', method: 'GET', data: { sign: key }
 *     });
 *     return res.data;                       // 结构保持一致即可
 *   }
 *
 * 页面侧（pages/astro/index.ts）已经是 `await fetchAstroDashboard(...)` 的写法，
 * 因此切到远端只是把「假异步」换成「真请求」，渲染与交互逻辑完全不动。
 */
export function fetchAstroDashboard(signKey?: string): Promise<AstroDashboard> {
  return new Promise((resolve) => {
    // 用 0ms 微任务保持异步语义，避免页面日后切真接口时要改调用方式
    setTimeout(() => resolve(buildDashboard(signKey)), 0);
  });
}

/** 供页面在点击核心后刷新「数字增长」时复用 */
export function refreshDashboard(signKey: string): AstroDashboard {
  return buildDashboard(signKey);
}
