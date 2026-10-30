// utils/note-presets.ts
// 便签个性化预设：丰富色板 + 背景样式 + 卡通动物图样
// 所有预设通过 buildNoteStyle 组合成最终 CSS，供列表卡片与编辑弹窗实时预览共用。

import type { NotePatternKey, NoteFigureKey, NoteCategoryKey } from '../types/index';

/* ============ 便签分类（手账式：生活 / 学习 / 工作 / 心情） ============ */

export interface NoteCategoryOption {
  key: NoteCategoryKey;
  label: string;
  /** 分类图标（emoji，零图片资源） */
  icon: string;
  /** chip 背景（低饱和糖果色） */
  bg: string;
  /** chip 文字色（与 bg 同色系深色，保证对比度） */
  ink: string;
  /** 该分类新建便签的默认底色 */
  defaultColorKey: string;
}

export const NOTE_CATEGORIES: NoteCategoryOption[] = [
  { key: 'life', label: '生活', icon: '☀', bg: '#FFF3C9', ink: '#A8863C', defaultColorKey: 'lemon' },
  { key: 'study', label: '学习', icon: '🌱', bg: '#E5F4DF', ink: '#6C9463', defaultColorKey: 'mint' },
  { key: 'work', label: '工作', icon: '💼', bg: '#E3EFFB', ink: '#5F82AE', defaultColorKey: 'sky' },
  { key: 'mood', label: '心情', icon: '♡', bg: '#F8E4ED', ink: '#B0728C', defaultColorKey: 'sakura' }
];

export function categoryOf(key?: string): NoteCategoryOption {
  return NOTE_CATEGORIES.find((c) => c.key === key) || NOTE_CATEGORIES[0];
}

/** 分类 → 便签色系分组（切换分类时判断是否需要换底色） */
export function categoryGroupOf(key?: string): NoteColorGroup {
  switch (key) {
    case 'study':
      return 'green';
    case 'work':
      return 'blue';
    case 'mood':
      return 'pink';
    default:
      return 'yellow';
  }
}

/**
 * 推断便签所属分类。
 * 新便签直接读category；老数据（无 category）按便签底色归类，
 * 避免升级后所有旧便签都堆在「生活」里。
 */
export function inferCategory(note: { category?: string; colorKey?: string }): NoteCategoryKey {
  if (note && note.category && NOTE_CATEGORIES.some((c) => c.key === note.category)) {
    return note.category as NoteCategoryKey;
  }
  switch (colorGroupOf((note && note.colorKey) || '')) {
    case 'green':
      return 'study';
    case 'blue':
      return 'work';
    case 'pink':
    case 'purple':
      return 'mood';
    default:
      return 'life';
  }
}

/* ============ 便签颜色 ============ */

export type NoteColorGroup = 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange' | 'neutral';

export interface NoteColorOption {
  key: string;
  label: string;
  /** 便签背景底（hex） */
  bg: string;
  /** 便签文字墨色（深色，用于正文，保证可读） */
  ink: string;
  /** 次强调色（置顶徽标/描边，通常比 bg 深一点） */
  accent: string;
  /** 所属筛选分组 */
  group: NoteColorGroup;
}

/** 简易颜色微调（向白/黑混合 pct：>0 提亮，<0 加深），仅用于派生 accent */
function shade(hex: string, pct: number): string {
  const h = (hex || '#ffffff').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.length === 6 ? full : 'ffffff', 16);
  if (isNaN(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = pct >= 0 ? 255 : 0;
  const k = Math.abs(pct) / 100;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + (t - v) * k)))
    .toString(16)
    .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** 统一正文墨色（便签底色均为浅色，深灰紫保证可读） */
const INK = '#4b4b5a';

function opt(key: string, label: string, bg: string, group: NoteColorGroup): NoteColorOption {
  return { key, label, bg, ink: INK, accent: shade(bg, group === 'neutral' ? -8 : -14), group };
}

/** 完整颜色色板（分组组织，rich palette） */
export const NOTE_COLORS: NoteColorOption[] = [
  // 黄
  opt('lemon', '柠檬黄', '#FFF9C4', 'yellow'),
  opt('cream', '奶油黄', '#FFF3B0', 'yellow'),
  opt('egg', '蛋黄', '#FFE082', 'yellow'),
  // 绿
  opt('mint', '薄荷绿', '#D7F5D9', 'green'),
  opt('matcha', '抹茶绿', '#C8E6C9', 'green'),
  opt('sprout', '嫩草绿', '#DCEFD6', 'green'),
  // 蓝
  opt('sky', '天空蓝', '#D6EAFB', 'blue'),
  opt('mist', '雾霾蓝', '#D0E4F5', 'blue'),
  opt('ocean', '海水蓝', '#C9E3F5', 'blue'),
  // 粉
  opt('sakura', '樱花粉', '#FDE2E9', 'pink'),
  opt('peach', '蜜桃粉', '#FFD9E0', 'pink'),
  opt('rose', '玫瑰粉', '#FAD2DC', 'pink'),
  // 紫
  opt('lavender', '薰衣草紫', '#E9DDF9', 'purple'),
  opt('taro', '香芋紫', '#E3D6F7', 'purple'),
  opt('grape', '葡萄紫', '#E0D0F0', 'purple'),
  // 橙
  opt('tangerine', '蜜橘橙', '#FFE0C7', 'orange'),
  opt('apricot', '暖杏', '#FFE3CC', 'orange'),
  opt('coral', '珊瑚橙', '#FDD5BC', 'orange'),
  // 中性
  opt('cloud', '云朵白', '#FFFFFF', 'neutral'),
  opt('grey', '浅灰', '#F1F3F5', 'neutral'),
  opt('milk', '奶油白', '#FFFDF6', 'neutral')
];

export function colorOf(key: string): NoteColorOption {
  return NOTE_COLORS.find((c) => c.key === key) || NOTE_COLORS[0];
}

/** 首页顶部筛选 chips：全部 + 7 个分组 */
export interface NoteColorFilter {
  key: string; // 'all' | group
  label: string;
  /** 圆点背景色（用于 chip 显示） */
  bg: string;
}

export const NOTE_COLOR_FILTERS: NoteColorFilter[] = [
  { key: 'all', label: '全部', bg: '#d7dbe8' },
  { key: 'yellow', label: '黄色', bg: colorOf('lemon').bg },
  { key: 'green', label: '绿色', bg: colorOf('mint').bg },
  { key: 'blue', label: '蓝色', bg: colorOf('sky').bg },
  { key: 'pink', label: '粉色', bg: colorOf('sakura').bg },
  { key: 'purple', label: '紫色', bg: colorOf('lavender').bg },
  { key: 'orange', label: '橙色', bg: colorOf('tangerine').bg }
];

/* ============ 便签背景样式 ============ */

export interface NotePatternOption {
  key: NotePatternKey;
  label: string;
  desc: string;
  emoji: string;
}

export const NOTE_PATTERNS: NotePatternOption[] = [
  { key: 'solid', label: '纯色', desc: '干净简约', emoji: '🎨' },
  { key: 'dots', label: '圆点', desc: '波点小清新', emoji: '🔘' },
  { key: 'stripes', label: '斜纹', desc: '活力斜线', emoji: '〰️' },
  { key: 'grid', label: '网格', desc: '工整格纹', emoji: '🧇' },
  { key: 'waves', label: '波浪', desc: '柔和水波', emoji: '🌊' },
  { key: 'fade', label: '渐变', desc: '柔光过渡', emoji: '🌈' }
];

/** 覆盖层颜色（对所有浅底均可见） */
const DOT = 'rgba(255,255,255,0.6)';
const STRIPE = 'rgba(255,255,255,0.5)';
const LINE = 'rgba(0,0,0,0.055)';
const WAVE = 'rgba(255,255,255,0.5)';
const FADE = 'rgba(255,255,255,0.55)';

/** 每种 pattern 的 CSS（image / size / position），叠加在底色之上 */
function patternCss(p: NotePatternKey): { image: string; size: string; pos: string } | null {
  switch (p) {
    case 'dots':
      return { image: `radial-gradient(circle, ${DOT} 2.6rpx, transparent 3.2rpx)`, size: '34rpx 34rpx', pos: '0 0' };
    case 'stripes':
      return { image: `repeating-linear-gradient(45deg, ${STRIPE} 0 10rpx, transparent 10rpx 24rpx)`, size: 'auto', pos: '0 0' };
    case 'grid':
      return {
        image: `linear-gradient(${LINE} 0 1rpx, transparent 1rpx), linear-gradient(90deg, ${LINE} 0 1rpx, transparent 1rpx)`,
        size: '32rpx 32rpx, 32rpx 32rpx',
        pos: '0 0, 0 0'
      };
    case 'waves':
      return { image: `radial-gradient(circle at 50% 110%, ${WAVE} 0 9rpx, transparent 9rpx)`, size: '52rpx 34rpx', pos: '0 0' };
    case 'fade':
      return { image: `linear-gradient(150deg, rgba(255,255,255,0) 0%, ${FADE} 100%)`, size: 'auto', pos: '0 0' };
    default:
      return null;
  }
}

/* ============ 卡通动物图样 ============ */

export interface NoteFigureOption {
  key: NoteFigureKey;
  label: string;
  emoji: string;
}

export const NOTE_FIGURES: NoteFigureOption[] = [
  { key: 'none', label: '无', emoji: '∅' },
  { key: 'cat', label: '小猫', emoji: '🐱' },
  { key: 'dog', label: '小狗', emoji: '🐶' },
  { key: 'bear', label: '小熊', emoji: '🐻' },
  { key: 'rabbit', label: '小兔', emoji: '🐰' },
  { key: 'panda', label: '熊猫', emoji: '🐼' },
  { key: 'hamster', label: '仓鼠', emoji: '🐹' },
  { key: 'fox', label: '小狐', emoji: '🦊' },
  { key: 'chick', label: '小鸡', emoji: '🐥' },
  { key: 'pig', label: '小猪', emoji: '🐷' },
  { key: 'koala', label: '考拉', emoji: '🐨' }
];

export function figureEmoji(key: NoteFigureKey): string {
  if (key === 'none') return '';
  return NOTE_FIGURES.find((f) => f.key === key)?.emoji || '';
}

/* ============ 样式构建 ============ */

export interface NoteVisual {
  /** 完整背景 CSS（含 color + pattern），用于便签卡片/预览容器 */
  bgStyle: string;
  /** 正文墨色 */
  ink: string;
  /** 次强调色 */
  accent: string;
}

/**
 * 组合颜色 + 背景样式为一段可内联的 CSS。
 * 供列表卡片(较小)与编辑弹窗实时预览(较大)复用，保证所见即所得。
 */
export function buildNoteVisual(colorKey: string, patternKey: NotePatternKey): NoteVisual {
  const c = colorOf(colorKey);
  const overlay = patternCss(patternKey);
  let bgStyle = `background-color:${c.bg};`;
  if (overlay) {
    bgStyle += `background-image:${overlay.image};background-size:${overlay.size};background-position:${overlay.pos};`;
  }
  return { bgStyle, ink: c.ink, accent: c.accent };
}

/** 便于列表直接排序过滤时判断颜色分组 */
export function colorGroupOf(colorKey: string): NoteColorGroup {
  return colorOf(colorKey).group;
}
