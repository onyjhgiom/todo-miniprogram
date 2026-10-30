// subpackages/danmaku/utils/danmaku-presets.ts
// 静态预设：色板 / 字体 / 特效 / 皮肤 / 粒子 / 常用弹幕模板
// 全部为纯数据，方便 UI 层直接 wx:for 渲染，也方便后续换成云端下发。
import type { FontKey, FontEffect, TextSize, SkinKey, ParticleKind, BgMode } from './danmaku-types';

/* ==================== 选项列表（UI 直接遍历） ==================== */

export interface Option<T> {
  value: T;
  label: string;
  /** 可选的附加说明，用于 helper / 无障碍朗读 */
  hint?: string;
}

export const FONT_OPTIONS: Option<FontKey>[] = [
  { value: 'default', label: '默认' },
  { value: 'hand', label: '手写体' },
  { value: 'cartoon', label: '卡通体' },
  { value: 'serif', label: '衬线体' }
];

export const EFFECT_OPTIONS: Option<FontEffect>[] = [
  { value: 'none', label: '纯色' },
  { value: 'gradient', label: '渐变字' },
  { value: 'glow', label: '发光字' },
  { value: 'pixel', label: '像素字' },
  { value: 'doodle', label: '涂鸦字' }
];

export const SIZE_OPTIONS: Option<TextSize>[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' }
];

export const BG_MODE_OPTIONS: Option<BgMode>[] = [
  { value: 'none', label: '无背景' },
  { value: 'solid', label: '纯色' },
  { value: 'translucent', label: '半透明' },
  { value: 'pill', label: '圆角标签' }
];

export const PARTICLE_OPTIONS: Option<ParticleKind>[] = [
  { value: 'none', label: '无' },
  { value: 'heart', label: '爱心' },
  { value: 'star', label: '星星' },
  { value: 'firework', label: '烟花' },
  { value: 'snow', label: '雪花' }
];

export const SKIN_OPTIONS: Option<SkinKey>[] = [
  { value: 'none', label: '无皮肤' },
  { value: 'spring', label: '春节红包' },
  { value: 'christmas', label: '圣诞雪花' },
  { value: 'valentine', label: '情人节' }
];

/* ==================== 颜色 ==================== */

/** 10 种预设常用色 */
export const COLOR_SWATCHES: string[] = [
  '#FFFFFF', // 白
  '#000000', // 黑
  '#FF4D6D', // 玫红
  '#FF8A3D', // 橙
  '#FFD166', // 暖黄
  '#5FD35F', // 草绿
  '#4CC9F0', // 天蓝
  '#7A6CF6', // 靛紫
  '#C084FC', // 淡紫
  '#B5714C'  // 陶土棕（品牌色）
];

/** 自定义取色器面板：每行 6 个，共 5 行 30 色 */
export const PICKER_MATRIX: string[][] = [
  ['#FFFFFF', '#F5F5F5', '#E0E0E0', '#9E9E9E', '#616161', '#000000'],
  ['#FFEBEE', '#FFCDD2', '#EF9A9A', '#E53935', '#B71C1C', '#7F0000'],
  ['#FFF8E1', '#FFECB3', '#FFD54F', '#FFB300', '#FF8F00', '#E65100'],
  ['#E8F5E9', '#C8E6C9', '#81C784', '#43A047', '#1B5E20', '#004D40'],
  ['#E3F2FD', '#BBDEFB', '#64B5F6', '#1E88E5', '#0D47A1', '#4A148C']
];

/* ==================== 字体 ==================== */

/**
 * 字体族字符串。
 * canvas 的 font 属性遵循 CSS font shorthand，family 列表会按平台逐个回退：
 * iOS 优先 PingFang / Kaiti / Yuanti，Android 落到系统默认也不至于崩。
 */
export const FONT_FAMILY: Record<FontKey, string> = {
  default: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  hand: '"Kaiti SC", "STKaiti", "KaiTi", -apple-system, sans-serif',
  cartoon: '"Yuanti SC", "STYuanti", "Comic Sans MS", cursive, sans-serif',
  serif: '"Songti SC", "STSong", Georgia, serif'
};

/** 字号档位对应的 px（CSS px，引擎内再乘 dpr） */
export const SIZE_PX: Record<TextSize, number> = {
  small: 14,
  medium: 18,
  large: 24
};

/* ==================== 皮肤 ==================== */

export interface SkinPreset {
  key: SkinKey;
  label: string;
  emoji: string;
  /** 皮肤自带的背景（kind=gradient 时 color→color2） */
  bgColor: string;
  bgColor2: string;
  /** 皮肤自带字体特效 */
  effect: FontEffect;
  effectColor: string;
  effectColor2: string;
  /** 皮肤自带粒子 */
  particle: ParticleKind;
  /** 建议动画模式 */
  mode: 'scroll' | 'pop' | 'blink' | 'random';
}

export const SKIN_PRESETS: Record<SkinKey, SkinPreset> = {
  none: {
    key: 'none', label: '无皮肤', emoji: '',
    bgColor: '#3B362F', bgColor2: '#B5714C',
    effect: 'none', effectColor: '#FFFFFF', effectColor2: '#D8A05C',
    particle: 'none', mode: 'scroll'
  },
  spring: {
    key: 'spring', label: '春节红包', emoji: '🧧',
    bgColor: '#7A0C0C', bgColor2: '#D42A1E',
    effect: 'glow', effectColor: '#FFD75E', effectColor2: '#FFF3B0',
    particle: 'firework', mode: 'pop'
  },
  christmas: {
    key: 'christmas', label: '圣诞雪花', emoji: '🎄',
    bgColor: '#0B2B3A', bgColor2: '#1E6B58',
    effect: 'glow', effectColor: '#FFFFFF', effectColor2: '#B7E4FF',
    particle: 'snow', mode: 'scroll'
  },
  valentine: {
    key: 'valentine', label: '情人节', emoji: '💖',
    bgColor: '#4A1030', bgColor2: '#C0356B',
    effect: 'gradient', effectColor: '#FF9DB4', effectColor2: '#FFFFFF',
    particle: 'heart', mode: 'random'
  }
};

/* ==================== 常用弹幕模板库 ==================== */

export interface TemplateGroup {
  label: string;
  items: string[];
}

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    label: '祝福',
    items: ['生日快乐 🎂', '旅途愉快 ✈️', '新年快乐 🧧', '万事如意 🍀', '岁岁平安 🕊️', '前程似锦 🌟']
  },
  {
    label: '打卡',
    items: ['打卡成功 ✅', '今日圆满 💪', '又进步了 📈', '坚持就是胜利 🏃', '完成任务 🎯', '一天没偷懒 😎']
  },
  {
    label: '表白',
    items: ['爱你哟 ❤️', '想你了 🥰', '余生请多指教 💍', '你最好看 ✨', '一直都在 🤝', '见字如面 💌']
  },
  {
    label: '应援',
    items: ['666 🔥', '给大佬跪了 🙇', '太强了 💯', '这波稳了 👍', '高手在民间 🎩', '学到了 📚']
  },
  {
    label: '搞笑',
    items: ['我什么都没看见 🙈', '弹幕护体 🛡️', '前方高能 ⚠️', '哈哈哈太好笑了 😂', '笑不活了 🤣', '此条五毛 💰']
  }
];

/** 内置表情包（用 emoji 字符代替贴纸，避免打包图片资源进分包） */
export const STICKER_PRESETS: string[] = [
  '😀', '🥳', '🎉', '🎊', '❤️', '👍', '🔥', '🌟', '🎂', '🍰',
  '✈️', '🏖️', '🎁', '🧧', '🎄', '💖', '☃️', '🚀'
];

/**
 * 把「生日快乐 🎂」这类模板文本拆成 { text, emoji } 两段，
 * 供模板瓦片做「emoji 大字 + 文字小字」的排版（对齐高级弹幕工作台设计稿）。
 * 没有尾部 emoji 时 emoji 返回空串、text 保持原文。
 */
export function splitTemplateEmoji(raw: string): { text: string; emoji: string } {
  const m = /([\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}]+)\s*$/u.exec(raw);
  if (!m) return { text: raw, emoji: '' };
  return { text: raw.slice(0, m.index).trim(), emoji: m[1] };
}

/* ==================== 预览背景预设 ==================== */

export interface BgPreset {
  label: string;
  color: string;
  color2: string;
}

export const BG_PRESETS: BgPreset[] = [
  { label: '墨夜', color: '#3B362F', color2: '#B5714C' },
  { label: '暗金', color: '#8C6E30', color2: '#D8BC85' },
  { label: '藏青', color: '#14213D', color2: '#3B4A7E' },
  { label: '纯黑', color: '#000000', color2: '#1A1A1A' },
  { label: '白墙', color: '#FFFFFF', color2: '#E9E9E9' },
  { label: '樱粉', color: '#FFE4EC', color2: '#FF9DB4' },
  { label: '晴空', color: '#E3F2FD', color2: '#64B5F6' },
  { label: '森野', color: '#E8EFE9', color2: '#5C8E6E' }
];

/* ==================== 动画参数映射 ==================== */

/** 滚动速度 → px/秒（CSS px） */
export const SPEED_PX_PER_SEC = { slow: 60, normal: 110, fast: 180 };

/** 弹出方向中文 */
export const POP_FROM_LABEL: Record<string, string> = {
  bottom: '从底部',
  top: '从顶部',
  left: '从左侧',
  right: '从右侧'
};
