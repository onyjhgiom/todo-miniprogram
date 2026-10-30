// subpackages/danmaku/utils/danmaku-types.ts
// 弹幕模块的完整数据模型：样式 / 动画 / 布局 / 条目 / 配置
//
// 设计约束：
//   1. 所有枚举值都取字符串字面量并保留可读中文注释，方便直接落 storage 与 URL 传参；
//   2. 配置对象必须可 JSON 序列化（不能含 Image / Canvas 运行时对象），
//      这样「保存草稿 → 跳转全屏页 → 分享给好友」整条链路只需要传一个字符串。

/* ==================== 文字样式 ==================== */

/** 字体族：默认 / 手写 / 卡通 / 衬线 */
export type FontKey = 'default' | 'hand' | 'cartoon' | 'serif';

/**
 * 动态字体特效（高阶视觉）。
 * none     —— 纯色填充
 * gradient —— 渐变字，方向可调
 * glow     —— 描边发光字，发光强度可调
 * pixel    —— 像素字（离屏画布降采样后放大回绘）
 * doodle   —— 手写涂鸦字（逐字随机抖动旋转）
 */
export type FontEffect = 'none' | 'gradient' | 'glow' | 'pixel' | 'doodle';

/** 字号档位 */
export type TextSize = 'small' | 'medium' | 'large';

/** 背景样式 */
export type BgMode = 'none' | 'solid' | 'translucent' | 'pill';

export interface DanmakuStyle {
  font: FontKey;
  fontEffect: FontEffect;
  /** 发光强度 0~100（glow 特效用） */
  glow: number;
  /** 渐变方向角度 0~360（gradient 特效用） */
  gradientDeg: number;
  /** 渐变第二色 */
  gradientColor2: string;
  /** 主文字色 */
  color: string;
  size: TextSize;
  bold: boolean;
  italic: boolean;
  /** 背景模式 */
  bgMode: BgMode;
  /** 背景色 */
  bgColor: string;
  /** 背景不透明度 0~100（translucent 模式有效） */
  bgAlpha: number;
  /** 是否描边 */
  border: boolean;
  borderColor: string;
  /** 描边宽度 px */
  borderWidth: number;
  /** 是否投影 */
  shadow: boolean;
  shadowColor: string;
  /** 投影模糊半径 px */
  shadowBlur: number;
}

/* ==================== 动画 ==================== */

/** 动画模式：滚动 / 弹出 / 闪烁 / 随机混合 */
export type AnimMode = 'scroll' | 'pop' | 'blink' | 'random';

/** 滚动速度档位 */
export type ScrollSpeed = 'slow' | 'normal' | 'fast';

/** 弹出方向 */
export type PopFrom = 'bottom' | 'top' | 'left' | 'right';

/** 粒子类型 */
export type ParticleKind = 'none' | 'heart' | 'star' | 'firework' | 'snow';

export interface DanmakuAnim {
  mode: AnimMode;
  /** 滚动速度 */
  speed: ScrollSpeed;
  /** 弹出方向 */
  popFrom: PopFrom;
  /** 弹出模式停留时长 ms（1000~5000） */
  popHold: number;
  /** 闪烁模式的闪烁次数（2~8） */
  blinkCount: number;
  /** 是否开启拖尾 */
  trail: boolean;
  /** 拖尾长度 0~100 */
  trailLen: number;
  /** 拖尾不透明度 0~100 */
  trailAlpha: number;
  /** 粒子类型 */
  particle: ParticleKind;
  /** 粒子颜色是否跟随文字色 */
  particleFollowColor: boolean;
  /** 粒子密度 0~100 */
  particleCount: number;
}

/* ==================== 布局 ==================== */

/** 弹幕密度：稀疏 / 适中 / 密集 */
export type Density = 'sparse' | 'normal' | 'dense';

/** 显示区域：全屏 / 上半屏 / 下半屏 / 自定义 */
export type AreaMode = 'full' | 'top' | 'bottom' | 'custom';

export interface DanmakuLayout {
  density: Density;
  area: AreaMode;
  /** 自定义区域上边界百分比 0~100 */
  areaTop: number;
  /** 自定义区域下边界百分比 0~100 */
  areaBottom: number;
  /** 重要弹幕置顶 */
  pinImportant: boolean;
  /** 内容超出时是否在 UI 上提示（语音嘴巴场景下由调用方决定） */
  maxConcurrent: number;
}

/* ==================== 弹幕条目 ==================== */

/** 条目类型：文字 / 表情包 */
export type ItemKind = 'text' | 'sticker';

export interface DanmakuItem {
  id: string;
  kind: ItemKind;
  text: string;
  /** kind==='sticker' 时的图片地址（本地临时路径或已下载的网络图） */
  stickerUrl?: string;
  /** 表情包缩放百分比 50~200 */
  stickerScale?: number;
  /** 表情包是否旋转 */
  stickerSpin?: boolean;
  /** 是否重要（置顶显示） */
  pinned?: boolean;
  /** 单条覆盖色（空则跟随全局样式） */
  color?: string;
  /** 单条覆盖字号（空则跟随全局样式） */
  size?: TextSize;
  /** 单条覆盖特效（空则跟随全局样式） */
  effect?: FontEffect;
}

/* ==================== 预览底图 ==================== */

export type BgKind = 'solid' | 'gradient' | 'image';

export interface DanmakuBg {
  kind: BgKind;
  color: string;
  color2: string;
  imageUrl: string;
}

/* ==================== 皮肤 ==================== */

export type SkinKey = 'none' | 'spring' | 'christmas' | 'valentine';

/* ==================== 完整配置 ==================== */

export interface DanmakuConfig {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 是否已收藏 */
  favorite: boolean;
  skin: SkinKey;
  style: DanmakuStyle;
  anim: DanmakuAnim;
  layout: DanmakuLayout;
  bg: DanmakuBg;
  items: DanmakuItem[];
}

/* ==================== 出厂默认值 ==================== */

export const DEFAULT_STYLE: DanmakuStyle = {
  font: 'default',
  fontEffect: 'none',
  glow: 60,
  gradientDeg: 45,
  gradientColor2: '#D8A05C',
  color: '#FFFFFF',
  size: 'medium',
  bold: true,
  italic: false,
  bgMode: 'none',
  bgColor: '#000000',
  bgAlpha: 40,
  border: false,
  borderColor: '#000000',
  borderWidth: 2,
  shadow: true,
  shadowColor: 'rgba(0,0,0,0.55)',
  shadowBlur: 6
};

export const DEFAULT_ANIM: DanmakuAnim = {
  mode: 'scroll',
  speed: 'normal',
  popFrom: 'bottom',
  popHold: 2500,
  blinkCount: 4,
  trail: false,
  trailLen: 40,
  trailAlpha: 60,
  particle: 'none',
  particleFollowColor: true,
  particleCount: 50
};

export const DEFAULT_LAYOUT: DanmakuLayout = {
  density: 'normal',
  area: 'full',
  areaTop: 20,
  areaBottom: 80,
  pinImportant: false,
  maxConcurrent: 24
};

export const DEFAULT_BG: DanmakuBg = {
  kind: 'gradient',
  color: '#3B362F',
  color2: '#B5714C',
  imageUrl: ''
};

/** 单条弹幕字数上限 */
export const MAX_ITEM_TEXT = 50;

/** 一条配置最多容纳的弹幕条数（超出部分在 UI 层提示，不入引擎） */
export const MAX_ITEMS = 200;
