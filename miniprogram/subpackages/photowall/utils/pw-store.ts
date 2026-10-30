// subpackages/photowall/utils/pw-store.ts
// 照片墙：本地存储层（作品 / 草稿 / 收藏形状 / 待办联动解锁）
//
// ── 为什么图片必须落盘 ────────────────────────────────────────
// wx.chooseMedia 给的是 **临时路径**，小程序一重启就失效（表现为「昨天做的照片墙今天全灰」）。
// 所以保存作品时要把每张图复制进 USER_DATA_PATH 下的作品目录，用永久路径入库。
//
// ── 为什么按作品分 key ────────────────────────────────────────
// 作品数量会随时间累积，若全塞进一个 key，迟早撞上单 key 1MB 上限（项目在待办上已踩过一次）。
// 这里改成：索引 key 只存卡片摘要，每个作品单独一个 key。

import type { PWWork } from './pw-types';
import { PW_THEMES, PW_ALGO } from './pw-types';
import { getShape, layout, templateFor, fillModeOf } from './pw-shapes';
import { stats as todoStats } from '../../../utils/todo-store';

/* ==================== 存储键 ==================== */

const K_INDEX = '__pw_index';
const K_WORK = '__pw_work_';
const K_FAV_SHAPES = '__pw_fav_shapes';
const K_RECENT = '__pw_recent_shapes';
const K_UNLOCK_SEEN = '__pw_unlock_seen';
const K_LAST = '__pw_last_work';

/** 作品图片根目录 */
const PHOTO_ROOT = (wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '') + '/photowall';

/** 文件系统：mkdir / copyFile / rmdir / readdir 未在项目 d.ts 声明，统一在这里兜住 */
function fsx(): any {
  return wx.getFileSystemManager() as any;
}

/* ==================== 卡片摘要 ==================== */

export interface PWIndexItem {
  id: string;
  title: string;
  shapeName: string;
  count: number;
  cover: string;
  updatedAt: number;
  draft: boolean;
  favorite: boolean;
}

/* ==================== 读写基础 ==================== */

function read<T>(key: string, fallback: T): T {
  try {
    const v = wx.getStorageSync(key);
    return v == null ? fallback : (v as T);
  } catch (e) {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    console.warn('[pw-store] write failed:', key, e);
  }
}

/* ==================== 作品列表 ==================== */

export function loadIndex(): PWIndexItem[] {
  const list = read<PWIndexItem[]>(K_INDEX, []);
  return Array.isArray(list) ? list : [];
}

function writeIndex(list: PWIndexItem[]): void {
  write(K_INDEX, list);
}

export function loadWork(id: string): PWWork | null {
  const w = read<PWWork | null>(K_WORK + id, null);
  if (!w || !w.id) return null;
  return migrate(w);
}

/**
 * 旧作品自愈：算法升级后，按当前算法重算点位与照片边长。
 *
 * 不做这一步的话，升级前保存的作品会一直沿用旧点位 —— 列表封面、详情大图都会
 * 继续显示「照片糊成一团、看不出形状」的错误排布，用户会以为没修。
 * 同样重要的是：算法 3 起默认「一张照片一格」，旧作品若继续沿用「铺满」的点位，
 * 画面上会重复出现同一张照片，因此这里统一收敛到不重复。
 * 只有解析形状能同步重算；文字 / 蒙版要异步栅格化，等用户在编辑器里打开时再自愈。
 *
 * 三种作品的处置（靠 tplCount 区分）：
 *   · `tplCount > 0` —— 算法 4 的固定模板作品：**按模板重算**，修掉算法 4 的上下颠倒；
 *   · `tplCount === undefined` —— 算法 ≤3 的老作品：标成 0（自由张数）+ 走 legacy 自适应，
 *     保持原来的一圈轮廓/实心排布，不被突然换成像素模板；
 *   · `tplCount === 0` —— 已标记的自由张数作品：继续 legacy 重算。
 */
function migrate(w: PWWork): PWWork {
  if (w.algo === PW_ALGO) return w;
  w.algo = PW_ALGO;
  // 默认「每张照片只用一次」——旧版（算法 1/2）默认是铺满、会循环复用照片，
  // 升级后必须收敛，否则用户看到的心形里全是重复的照片
  w.autofill = false;
  const n = (w.photos || []).length;
  if (n && w.shapeKind === 'analytic') {
    const def = getShape(w.shapeId);
    if (def) {
      const a = w.arrange;
      const mode = fillModeOf(def, w.fill);
      w.fill = mode;
      const tpl = templateFor(def, mode);
      if (w.tplCount && tpl && n === tpl.count) {
        // 已保存的模板作品：张数没变，直接用（最新规则重算的）模板重建点位
        const r = layout(def, n, { fill: mode });
        w.slots = r.pts;
        w.cell = r.cell;
        w.tplCount = tpl.count;
      } else {
        // 老作品 / 张数对不上：标记成自由张数，走自适应排点，绝不改变既有观感
        if (w.tplCount === undefined) w.tplCount = 0;
        const r = layout(def, n, {
          jitter: a && a.jitter != null ? a.jitter : 0.25,
          density: a && a.density != null ? a.density : 1,
          seed: a && a.seed != null ? a.seed : 1,
          repeat: false,
          slots: n,
          legacy: true
        });
        w.slots = r.pts;
        w.cell = r.cell;
      }
    }
  } else if (w.tplCount === undefined) {
    // 没照片 / 非解析形状：仍要落一个明确的标记，避免下次又被当成「待初始化的新作品」
    w.tplCount = 0;
  }
  // 立刻回写，避免每次读列表都重算一遍；失败也不影响本次读取
  write(K_WORK + w.id, w);
  return w;
}

/** 摘要：由完整作品派生，避免索引与正文不同步 */
function toIndexItem(w: PWWork): PWIndexItem {
  return {
    id: w.id,
    title: w.title || '未命名',
    shapeName: w.shapeName || '自定义',
    count: (w.photos || []).length,
    cover: w.cover || '',
    updatedAt: w.updatedAt || Date.now(),
    draft: !!w.draft,
    favorite: !!w.favorite
  };
}

/**
 * 保存作品（新增 / 更新通用）。
 * 只更新索引里对应的那一条，其余顺序不动 —— 列表不会因为保存一次就重排。
 */
export function saveWork(w: PWWork): void {
  w.updatedAt = Date.now();
  write(K_WORK + w.id, w);
  const list = loadIndex();
  const item = toIndexItem(w);
  const i = list.findIndex((x) => x.id === w.id);
  if (i >= 0) list[i] = item;
  else list.unshift(item);
  writeIndex(list);
  write(K_LAST, w.id);
}

export function removeWork(id: string): void {
  try {
    wx.removeStorageSync(K_WORK + id);
  } catch (e) {
    /* 忽略 */
  }
  writeIndex(loadIndex().filter((x) => x.id !== id));
  removeWorkPhotos(id);
}

/** 取最近编辑过的作品 id（用于「继续编辑」入口） */
export function lastWorkId(): string {
  return read<string>(K_LAST, '');
}

export function setDraft(id: string, draft: boolean): void {
  const w = loadWork(id);
  if (!w) return;
  w.draft = draft;
  saveWork(w);
}

export function toggleFavorite(id: string): boolean {
  const w = loadWork(id);
  if (!w) return false;
  w.favorite = !w.favorite;
  saveWork(w);
  return w.favorite;
}

export function setNote(id: string, note: string): void {
  const w = loadWork(id);
  if (!w) return;
  w.note = note;
  saveWork(w);
}

export function setCover(id: string, cover: string): void {
  const w = loadWork(id);
  if (!w) return;
  w.cover = cover;
  saveWork(w);
}

/** 复制一份作品（列表长按「复制」） */
export function duplicateWork(id: string): PWWork | null {
  const w = loadWork(id);
  if (!w) return null;
  const copy: PWWork = JSON.parse(JSON.stringify(w));
  copy.id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  copy.title = (w.title || '照片墙') + ' 副本';
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.draft = true;
  copy.favorite = false;
  saveWork(copy);
  return copy;
}

/* ==================== 图片落盘 ==================== */

/**
 * 把临时图片复制进作品专属目录，返回永久路径。
 * 复制失败时不阻断保存 —— 退回原路径，至少本次会话内还能正常显示。
 */
export function persistPhotos(workId: string, srcs: string[]): string[] {
  if (!srcs.length) return [];
  const dir = PHOTO_ROOT + '/' + workId;
  const fs = fsx();
  try {
    fs.mkdirSync(dir, true);
  } catch (e) {
    /* 目录已存在时会抛，忽略即可 */
  }
  const out: string[] = [];
  for (let i = 0; i < srcs.length; i++) {
    const src = srcs[i];
    // 已经是本作品目录下的文件就直接复用，避免重复复制越存越多
    if (src.indexOf(dir) === 0) {
      out.push(src);
      continue;
    }
    const ext = src.lastIndexOf('.') >= 0 ? src.slice(src.lastIndexOf('.')) : '.jpg';
    const dst = dir + '/p' + i + '_' + Date.now().toString(36) + ext;
    try {
      fs.copyFileSync(src, dst);
      out.push(dst);
    } catch (e) {
      out.push(src);
    }
  }
  return out;
}

/** 删除作品图片目录 */
export function removeWorkPhotos(workId: string): void {
  try {
    fsx().rmdirSync(PHOTO_ROOT + '/' + workId, true);
  } catch (e) {
    /* 目录不存在 / 不支持递归删除时忽略 */
  }
}

/** 清理孤儿图片目录：作品已删但目录还在（异常退出会留下） */
export function gcOrphanPhotos(): void {
  try {
    const fs = fsx();
    const dirs: string[] = fs.readdirSync(PHOTO_ROOT) || [];
    const ids: Record<string, boolean> = {};
    loadIndex().forEach((x) => {
      ids[x.id] = true;
    });
    for (let i = 0; i < dirs.length; i++) {
      if (!ids[dirs[i]]) {
        try {
          fs.rmdirSync(PHOTO_ROOT + '/' + dirs[i], true);
        } catch (e) {
          /* 忽略 */
        }
      }
    }
  } catch (e) {
    /* 根目录不存在，忽略 */
  }
}

/* ==================== 形状收藏 / 最近使用 ==================== */

export interface FavShape {
  id: string;
  name: string;
  kind: 'analytic' | 'text' | 'mask';
  /** 文字形状的文本 */
  text: string;
  /** 自定义蒙版的永久路径 */
  maskPath: string;
  icon: string;
}

export function loadFavShapes(): FavShape[] {
  const v = read<FavShape[]>(K_FAV_SHAPES, []);
  return Array.isArray(v) ? v : [];
}

export function isFavShape(id: string, extra = ''): boolean {
  return loadFavShapes().some((s) => s.id === id && (s.text || '') === extra);
}

/** 收藏 / 取消收藏（文字与蒙版形状用 text/maskPath 区分，避免互相覆盖） */
export function toggleFavShape(s: FavShape): boolean {
  const list = loadFavShapes();
  const i = list.findIndex(
    (x) => x.id === s.id && (x.text || '') === (s.text || '') && (x.maskPath || '') === (s.maskPath || '')
  );
  if (i >= 0) {
    list.splice(i, 1);
    write(K_FAV_SHAPES, list);
    return false;
  }
  list.unshift(s);
  write(K_FAV_SHAPES, list.slice(0, 60));
  return true;
}

/* ==================== 形状选择：跨页面传递（仅内存） ==================== */

let pendingShape: FavShape | null = null;

/** 形状库选中后暂存；返回编辑器时由 takePendingShape 取走 */
export function setPendingShape(s: FavShape): void {
  pendingShape = s;
}

/** 取走暂存的形状（取完即清，避免下次进页面误用旧值） */
export function takePendingShape(): FavShape | null {
  const p = pendingShape;
  pendingShape = null;
  return p;
}

/* ==================== 自定义蒙版库 ==================== */

export interface MaskItem {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

const K_MASKS = '__pw_masks';

export function loadMasks(): MaskItem[] {
  const v = read<MaskItem[]>(K_MASKS, []);
  return Array.isArray(v) ? v : [];
}

export function saveMask(m: MaskItem): void {
  const list = loadMasks();
  list.unshift(m);
  write(K_MASKS, list.slice(0, 20));
}

export function removeMask(id: string): void {
  write(K_MASKS, loadMasks().filter((x) => x.id !== id));
}

/**
 * 把蒙版图片复制到永久目录（自定义形状要能反复使用，不能留在临时路径）。
 * 复用作品图片的落盘逻辑，只是挂在 _masks 这个固定子目录下。
 */
export function persistMask(src: string): string {
  const out = persistPhotos('_masks', [src]);
  return out[0] || src;
}

export function loadRecentShapes(): string[] {
  const v = read<string[]>(K_RECENT, []);
  return Array.isArray(v) ? v : [];
}

export function pushRecentShape(id: string): void {
  let list = loadRecentShapes().filter((x) => x !== id);
  list.unshift(id);
  if (list.length > 8) list = list.slice(0, 8);
  write(K_RECENT, list);
}

/* ==================== 与待办联动：解锁 ==================== */

export interface UnlockInfo {
  /** 已完成待办总数 */
  done: number;
  /** 连续打卡天数 */
  streak: number;
  /** 已解锁的主题 id */
  unlocked: string[];
  /** 本次新解锁（尚未提示过）的主题 id */
  fresh: string[];
  /** 下一个解锁还差几个 */
  nextNeed: number;
  nextName: string;
}

/** 解锁门槛：完成 N 个待办 → 解锁一个主题模板 */
const UNLOCK_RULES: { need: number; theme: string }[] = [
  { need: 10, theme: 'romance' },
  { need: 30, theme: 'retro' },
  { need: 60, theme: 'festive' },
  { need: 100, theme: 'couple' },
  { need: 150, theme: 'family' }
];

function themeName(id: string): string {
  const t = PW_THEMES.find((x) => x.id === id);
  return t ? t.name : id;
}

/**
 * 读取待办完成情况，算出解锁状态。
 * 用 todo-store 的 stats()（已完成数 / 连续打卡），不重复实现统计逻辑。
 * 「极简」「经典」默认解锁，不设门槛。
 */
export function computeUnlock(): UnlockInfo {
  let done = 0;
  let streak = 0;
  try {
    // 主包 store：与首页共享同一份内存数据，无需额外加载
    const s = todoStats();
    done = s.doneCount || 0;
    streak = s.streak || 0;
  } catch (e) {
    /* 主包 store 不可用时按 0 处理，不影响照片墙本体 */
  }
  const unlocked: string[] = ['classic', 'minimal'];
  const fresh: string[] = [];
  const seen = read<string[]>(K_UNLOCK_SEEN, []);
  for (let i = 0; i < UNLOCK_RULES.length; i++) {
    const r = UNLOCK_RULES[i];
    if (done >= r.need) {
      unlocked.push(r.theme);
      if (seen.indexOf(r.theme) < 0) fresh.push(r.theme);
    }
  }
  let nextNeed = 0;
  let nextName = '';
  for (let i = 0; i < UNLOCK_RULES.length; i++) {
    if (done < UNLOCK_RULES[i].need) {
      nextNeed = UNLOCK_RULES[i].need - done;
      nextName = themeName(UNLOCK_RULES[i].theme);
      break;
    }
  }
  return { done, streak, unlocked, fresh, nextNeed, nextName };
}

/** 标记解锁提示已看过（避免每次进列表都弹） */
export function markUnlockSeen(ids: string[]): void {
  if (!ids.length) return;
  const seen = read<string[]>(K_UNLOCK_SEEN, []);
  ids.forEach((id) => {
    if (seen.indexOf(id) < 0) seen.push(id);
  });
  write(K_UNLOCK_SEEN, seen);
}

/** 主题是否可用（未解锁的主题在选择时给出明确提示） */
export function isThemeUnlocked(themeId: string, info: UnlockInfo): boolean {
  return info.unlocked.indexOf(themeId) >= 0;
}
