// utils/love-wardrobe.ts
// 我的衣橱：真实单品管理（拍照上传）+ 一周 OOTD 自动搭配
//
// 【图片为什么必须做双通道】
//  wx.chooseMedia 返回的是**临时路径**，小程序重启或隔一段时间就失效（表现为灰块/裂图）。
//  所以单品图必须持久化，这里做两条路：
//   1) 云存储（wx.cloud.uploadFile）→ 拿到 cloud:// fileID，永久有效、换设备也在；
//   2) 本地兜底：压缩成 base64 存 storage（约 30–80KB/张），云开发没开也照样能看。
//  展示时优先 fileID，取不到再用本地 base64——任何一条路断了都不会出现裂图。
//
// 【搭配为什么是规则引擎而不是 AI】
//  衣橱单品是用户的真实照片，本地即可完成；规则引擎结果**可复现、可解释**，
//  每一套都会给出「为什么这么搭」的理由，用户能自己判断要不要听——
//  比一句黑盒的 AI 输出更适合每天要穿的场景。
import { loadCloset } from './love-store';
import type { WardrobeItem, WardrobeCategory, OotdDay, OotdPlan } from './love-types';

/* ============================ 品类 ============================ */

export const CATEGORIES: { key: WardrobeCategory; label: string; emoji: string }[] = [
  { key: 'coat', label: '外套', emoji: '🧥' },
  { key: 'top', label: '上装', emoji: '👚' },
  { key: 'bottom', label: '下装', emoji: '👖' },
  { key: 'dress', label: '连衣裙', emoji: '👗' },
  { key: 'shoes', label: '鞋子', emoji: '👟' },
  { key: 'bag', label: '包袋', emoji: '👜' },
  { key: 'earring', label: '耳环', emoji: '💎' },
  { key: 'necklace', label: '项链', emoji: '📿' },
  { key: 'hat', label: '帽子', emoji: '🧢' },
  { key: 'scarf', label: '围巾', emoji: '🧣' },
  { key: 'other', label: '其他', emoji: '✨' }
];

export function catLabel(cat: string): string {
  const f = CATEGORIES.find((c) => c.key === cat);
  return f ? f.label : '其他';
}

export function catEmoji(cat: string): string {
  const f = CATEGORIES.find((c) => c.key === cat);
  return f ? f.emoji : '✨';
}

/** 主体槽位（必须有，缺了就算缺件） */
const CORE_CATS: WardrobeCategory[] = ['top', 'bottom', 'dress', 'shoes'];

/* ============================ 色系 ============================ */

export const COLOR_FAMILY: { key: string; label: string; family: 'neutral' | 'cool' | 'warm'; hex: string }[] = [
  { key: '白', label: '白', family: 'neutral', hex: '#F7F5F2' },
  { key: '黑', label: '黑', family: 'neutral', hex: '#2B2B2B' },
  { key: '灰', label: '灰', family: 'neutral', hex: '#9A9A9A' },
  { key: '米杏', label: '米杏', family: 'neutral', hex: '#E7D8C3' },
  { key: '驼棕', label: '驼棕', family: 'warm', hex: '#B08A63' },
  { key: '蓝', label: '蓝', family: 'cool', hex: '#5B7FA6' },
  { key: '绿', label: '绿', family: 'cool', hex: '#6E9077' },
  { key: '紫', label: '紫', family: 'cool', hex: '#8A7CA8' },
  { key: '粉', label: '粉', family: 'warm', hex: '#E9A7B0' },
  { key: '红', label: '红', family: 'warm', hex: '#C0524F' },
  { key: '橙黄', label: '橙黄', family: 'warm', hex: '#DDA45E' }
];

function colorInfo(key: string) {
  return COLOR_FAMILY.find((c) => c.key === key) || { key, label: key || '未知', family: 'neutral' as const, hex: '#CCCCCC' };
}

/* ============================ 图片：选择 → 压缩 → 双通道持久化 ============================ */

export interface PickedImage {
  /** 云存储 fileID（成功时非空） */
  image: string;
  /** 本地 base64 data URI（兜底，始终有值） */
  local: string;
  /** 是否走了云存储 */
  cloud: boolean;
}

/** 选一张图并持久化；失败时抛出，由页面提示 */
export async function pickClothImage(): Promise<PickedImage> {
  const temp = await new Promise<string>((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res: { tempFiles?: { tempFilePath?: string }[] }) => {
        const f = (res.tempFiles || [])[0];
        if (f && f.tempFilePath) resolve(f.tempFilePath);
        else reject(new Error('未选择图片'));
      },
      fail: () => reject(new Error('取消选择'))
    });
  });

  const small = await compressImage(temp);
  const local = await toDataUri(small);
  const cloud = await uploadToCloud(small);
  return { image: cloud || '', local, cloud: !!cloud };
}

/** 压缩到可接受的存储体积（storage 单 key 有配额，必须压） */
function compressImage(src: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof wx.compressImage !== 'function') return resolve(src);
    wx.compressImage({
      src,
      quality: 55,
      success: (r: { tempFilePath?: string }) => resolve(r.tempFilePath || src),
      fail: () => resolve(src)
    });
  });
}

/** 读成 base64 data URI，供离线展示 */
function toDataUri(src: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const fs = wx.getFileSystemManager && wx.getFileSystemManager();
      if (!fs) return resolve('');
      fs.readFile({
        filePath: src,
        encoding: 'base64',
        success: (r: { data?: string }) => resolve(r.data ? `data:image/jpeg;base64,${r.data}` : ''),
        fail: () => resolve('')
      });
    } catch (e) {
      resolve('');
    }
  });
}

/** 上传云存储；没开云开发就静默失败（本地 base64 已兜底） */
function uploadToCloud(src: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') return resolve('');
      const name = `love/closet/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      wx.cloud.uploadFile({
        cloudPath: name,
        filePath: src,
        success: (r: { fileID?: string }) => resolve(r.fileID || ''),
        fail: () => resolve('')
      });
    } catch (e) {
      resolve('');
    }
  });
}

/** 展示用图：云 fileID 优先，退回本地 base64 */
export function displaySrc(item: WardrobeItem): string {
  return (item && (item.image || item.local)) || '';
}

/* ============================ 一周 OOTD 自动搭配 ============================ */

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 七天默认场合（可覆盖） */
export const DEFAULT_OCCASIONS = ['通勤·例会', '通勤', '通勤·加班日', '通勤', '通勤·下班有约', '约会·出游', '休闲·宅家'];

const FORMALITY: Record<string, number> = {
  '通勤·例会': 4, '通勤': 3, '通勤·加班日': 3, '通勤·下班有约': 3, '约会·出游': 2, '休闲·宅家': 1
};

/** 温度 → 需要的整体保暖值（上装+下装/裙+外套） */
function warmthNeed(temp: number): number {
  if (temp >= 28) return 2;
  if (temp >= 22) return 3;
  if (temp >= 16) return 5;
  if (temp >= 10) return 7;
  if (temp >= 3) return 9;
  return 11;
}

export interface OotdQuery {
  /** 主风格 */
  style: string;
  /** 温度 ℃ */
  temp: number;
  /** 七天场合（长度 7） */
  occasions?: string[];
  /** 起始日期 yyyy-mm-dd（周一） */
  startDate?: string;
  /** 身形 */
  body?: string;
}

export function generateWeek(q: OotdQuery): OotdPlan {
  const closet = loadCloset();
  const occasions = (q.occasions && q.occasions.length === 7 ? q.occasions : DEFAULT_OCCASIONS).slice();
  const temp = typeof q.temp === 'number' ? q.temp : 22;
  const need = warmthNeed(temp);
  const body = q.body || 'pear';

  const pool: Record<string, WardrobeItem[]> = {};
  CATEGORIES.forEach((c) => { pool[c.key] = closet.filter((x) => x.cat === c.key); });

  const used: Record<string, number> = {};
  let prevCoat = '';
  let prevShoes = '';
  const days: OotdDay[] = [];
  const tips: string[] = [];

  for (let i = 0; i < 7; i++) {
    const occ = occasions[i] || '通勤';
    const target = FORMALITY[occ] || 3;
    const picked: WardrobeItem[] = [];

    // 1) 主体：连衣裙 或 上装+下装
    const useDress = (pool.dress || []).length > 0 && target >= 2 && temp >= 18 && i % 3 === 2;
    if (useDress) {
      const d = best(pool.dress, { q, target, temp, used, picked, role: 'dress' });
      if (d) picked.push(d);
    }
    if (!picked.length) {
      const t = best(pool.top, { q, target, temp, used, picked, role: 'top' });
      const b = best(pool.bottom, { q, target, temp, used, picked, role: 'bottom' });
      if (t) picked.push(t);
      if (b) picked.push(b);
    }

    // 2) 外套：按温度 + 保暖缺口决定
    const cur = picked.reduce((s, x) => s + (x.warmth || 0), 0);
    if (temp < 24 && (pool.coat || []).length) {
      const c = best(pool.coat, { q, target, temp, used, picked, role: 'coat', excludeId: prevCoat, needWarmth: need - cur });
      if (c) { picked.push(c); prevCoat = c.id; }
    }

    // 3) 鞋：正式度优先 + 不与昨天重样
    const s = best(pool.shoes, { q, target, temp, used, picked, role: 'shoes', excludeId: prevShoes });
    if (s) { picked.push(s); prevShoes = s.id; }

    // 4) 包 + 配饰
    const bag = best(pool.bag, { q, target, temp, used, picked, role: 'bag' });
    if (bag) picked.push(bag);
    if (target >= 3) {
      const e = best(pool.earring, { q, target, temp, used, picked, role: 'earring' });
      if (e) picked.push(e);
    } else {
      const n = best(pool.necklace, { q, target, temp, used, picked, role: 'necklace' });
      if (n) picked.push(n);
    }
    if (temp < 12) {
      const sc = best(pool.scarf, { q, target, temp, used, picked, role: 'scarf' });
      if (sc) picked.push(sc);
    }

    picked.forEach((x) => { used[x.id] = (used[x.id] || 0) + 1; });

    // 缺件检查
    const missing: string[] = [];
    const hasTop = picked.some((x) => x.cat === 'top' || x.cat === 'dress');
    const hasBottom = picked.some((x) => x.cat === 'bottom' || x.cat === 'dress');
    if (!hasTop) missing.push('上装 / 连衣裙');
    if (!hasBottom) missing.push('下装 / 连衣裙');
    if (!picked.some((x) => x.cat === 'shoes')) missing.push('鞋子');
    if (temp < 24 && !picked.some((x) => x.cat === 'coat')) missing.push('外套');

    days.push({
      label: WEEK_LABELS[i],
      date: q.startDate || '',
      occasion: occ,
      items: picked,
      reason: buildReason(picked, occ, temp, q.style, body),
      colorNote: buildColorNote(picked),
      missing
    });
  }

  // 整体提示
  CORE_CATS.forEach((c) => {
    if (!(pool[c] || []).length && c !== 'dress') {
      tips.push(`衣橱里还没有${catLabel(c)}，补一件基础款能立刻多出好几种搭配（${priceHint(c)}）`);
    }
  });
  const usedCount = Object.keys(used).length;
  const coverage = closet.length ? Math.round((usedCount / closet.length) * 100) : 0;
  if (closet.length && coverage < 50) {
    tips.push(`本周只用到 ${usedCount}/${closet.length} 件，很多单品可以互搭——试试把风格标签补全，搭配会更准`);
  }
  if (temp >= 28) tips.push('高温周：面料优先棉麻/真丝，颜色选浅色系，深吸热真的会热很多');
  if (temp < 10) tips.push('寒冷周：保暖优先，内搭薄、中层暖、外层防风，比一件巨厚更灵活');

  return { days, tips, coverage };
}

interface BestCtx {
  q: OotdQuery;
  target: number;
  temp: number;
  used: Record<string, number>;
  picked: WardrobeItem[];
  role: string;
  excludeId?: string;
  needWarmth?: number;
}

function best(list: WardrobeItem[], ctx: BestCtx): WardrobeItem | null {
  if (!list || !list.length) return null;
  let top: WardrobeItem | null = null;
  let topScore = -999;
  list.forEach((item) => {
    if (ctx.excludeId && item.id === ctx.excludeId) return;
    const s = scoreItem(item, ctx);
    if (s > topScore) { topScore = s; top = item; }
  });
  return top;
}

function scoreItem(item: WardrobeItem, ctx: BestCtx): number {
  let s = 0;
  const style = ctx.q.style || '';
  // 风格
  if (style && (item.styles || []).indexOf(style) >= 0) s += 4;
  // 正式度
  s -= Math.abs((item.formality || 3) - ctx.target) * 2;
  // 季节
  const season = currentSeason();
  if ((item.seasons || []).indexOf(season) >= 0) s += 2;
  if ((item.seasons || []).indexOf('四季') >= 0) s += 2;
  // 常用
  if (item.fav) s += 2;
  // 温度/保暖
  if (ctx.role === 'coat' && typeof ctx.needWarmth === 'number') {
    s -= Math.abs((item.warmth || 3) - Math.max(1, Math.min(5, ctx.needWarmth))) * 2;
  } else if (ctx.role !== 'shoes' && ctx.role !== 'bag' && ctx.role !== 'earring' && ctx.role !== 'necklace') {
    // 主体单品：太厚在热天/太薄在冷天都扣分
    const want = ctx.temp >= 26 ? 1 : (ctx.temp >= 20 ? 2 : (ctx.temp >= 14 ? 3 : (ctx.temp >= 8 ? 4 : 5)));
    s -= Math.abs((item.warmth || 3) - want) * 1.5;
  }
  // 一周不重复：用过越多扣分越狠，逼出一衣多穿而不是天天同一件
  s -= (ctx.used[item.id] || 0) * 6;
  // 配色协调
  s += colorScore(item, ctx.picked);
  // 身形
  s += bodyScore(item, ctx.q.body || '', ctx.role);
  return s;
}

function currentSeason(): string {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

/** 与已选单品的配色协调度 */
function colorScore(item: WardrobeItem, picked: WardrobeItem[]): number {
  if (!picked.length) return 0;
  const mine = colorInfo(item.color);
  let s = 0;
  const colors = picked.map((p) => colorInfo(p.color));
  colors.forEach((c) => {
    if (mine.family === 'neutral' || c.family === 'neutral') s += 2;      // 中性色最安全
    else if (mine.family === c.family) s += 2;                            // 同色系
    else s -= 1;                                                          // 冷暖混搭，敢穿才加分
  });
  // 全身彩色超过 2 个色系 → 明显扣分
  const chroma = colors.concat([mine]).filter((c) => c.family !== 'neutral');
  const fams: string[] = [];
  chroma.forEach((c) => { if (fams.indexOf(c.family) < 0) fams.push(c.family); });
  if (fams.length >= 2 && chroma.length >= 3) s -= 3;
  return Math.max(-4, Math.min(6, s));
}

/** 身形适配 */
function bodyScore(item: WardrobeItem, body: string, role: string): number {
  const name = item.name || '';
  const isTight = /紧身|包臀|铅笔|legging/i.test(name);
  const isWide = /阔腿|A字|伞裙|直筒|工装/i.test(name);
  const hasWaist = /收腰|腰带|系带|高腰/i.test(name);
  switch (body) {
    case 'pear': // 梨形：上繁下简
      if (role === 'bottom' && isWide) return 3;
      if (role === 'bottom' && isTight) return -3;
      if (role === 'top') return 1;
      return 0;
    case 'apple': // 苹果：遮腰腹、拉长
      if (role === 'top' && /宽松|垂感|V领/i.test(name)) return 3;
      if (hasWaist) return -1;
      return 0;
    case 'hourglass': // 沙漏：突出腰线
      if (hasWaist) return 3;
      if (/oversize|茧型|宽松/i.test(name)) return -1;
      return 0;
    case 'rectangle': // H 型：制造腰线与层次
      if (hasWaist) return 3;
      if (role === 'coat') return 2;
      return 0;
    case 'inverted': // 倒三角：下装加量感，上装减量感
      if (role === 'bottom' && isWide) return 3;
      if (role === 'top' && /垫肩|泡泡袖|oversize/i.test(name)) return -3;
      return 0;
    default:
      return 0;
  }
}

function buildReason(items: WardrobeItem[], occ: string, temp: number, style: string, body: string): string {
  if (!items.length) return '衣橱还是空的，先上传几件单品吧';
  const names = items.slice(0, 3).map((x) => x.name).join(' + ');
  const bodyTip: Record<string, string> = {
    pear: '下装选了有廓形的，胯和大腿的线条被藏住了',
    apple: '上装走垂感宽松，腰腹不贴身',
    hourglass: '用腰线把比例显出来',
    rectangle: '靠外套/腰线造出层次，避免直筒一片',
    inverted: '下装加量感，平衡肩宽'
  };
  const tempTip = temp >= 28 ? '轻薄透气优先' : (temp >= 20 ? '单层就够，早晚加件外套' : (temp >= 12 ? '内搭 + 外套，进出室内好脱' : '保暖优先，内薄外厚'));
  return `${occ}｜${tempTip}。${style ? `整体走${style}，` : ''}${bodyTip[body] || ''}。核心是 ${names}。`;
}

function buildColorNote(items: WardrobeItem[]): string {
  const list = items.filter((x) => x.cat !== 'bag' && x.cat !== 'earring' && x.cat !== 'necklace');
  if (!list.length) return '';
  const fams: string[] = [];
  list.forEach((x) => {
    const f = colorInfo(x.color).family;
    if (fams.indexOf(f) < 0) fams.push(f);
  });
  const chroma = list.filter((x) => colorInfo(x.color).family !== 'neutral');
  if (!chroma.length) return '全中性色：安全耐看，靠配饰提亮即可';
  if (fams.length === 1) return `同色系${chroma[0].color}为主：和谐显高级，注意材质差异造层次`;
  if (chroma.length <= 2) return `${list.map((x) => x.color).slice(0, 2).join(' + ')}：中性打底 + 一个彩色焦点，最稳妥的比例`;
  return '彩色偏多，建议压掉一件彩色、换成中性色，整体会更干净';
}

function priceHint(cat: WardrobeCategory): string {
  const map: Partial<Record<WardrobeCategory, string>> = {
    coat: '基础款风衣/西装外套 400–1200',
    top: '白衬衫 / 基础针织 150–500',
    bottom: '直筒裤 / A 字裙 200–600',
    shoes: '小白鞋 / 乐福鞋 300–900',
    bag: '通勤托特 / 腋下包 300–1500',
    earring: '基础款耳钉/耳线 100–500'
  };
  return map[cat] || '按预算选基础款最划算';
}

export { WEEK_LABELS };
