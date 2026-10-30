// utils/love-core-themes.ts
// 爱遇小栈 · 3D 爱情水晶球 —— 视觉风格库
//
// 【设计目标】
// 每种风格都要「绚丽震撼」，但差异化在四个维度同时成立，不能只是换个色相：
//   1) 配色方案  primary / accent / 环色 / 心跳色 —— 冷暖与明度对比
//   2) 粒子表现  数量档位 / 自转速度 / 闪烁频率 / 亮星占比 / 轨道倾角
//   3) 光效表现  辉光半径与强度 / 底座光色 / 高光锐度 —— 有的柔散、有的锐利
//   4) 动效节奏  自转速度 / 心跳频率 / 浮动周期 / 轨道转速 —— 有的舒缓、有的急促
//
// 【为什么用「参数对象」而不是给引擎写 if/else】
// 引擎（love-core.ts）只认数值，不认风格名。新增风格 = 往本文件加一条数据，
// 不用碰渲染代码，避免每加一种风格就往引擎里塞分支。
//
// 【性能约定】
// 粒子数走档位（tier 0/1/2 → 34/58/86），低端机自动降档；
// 亮星（kind=1）带径向渐变，比普通点贵，所以占比控制在 12%~20%。

const TAU = Math.PI * 2;

/** 一条轨道的几何与动效参数 */
export interface CoreRingStyle {
  /** 绕 X 轴倾角（rad） */
  tiltA: number;
  /** 绕 Z 轴倾角（rad） */
  tiltB: number;
  /** 环半径（单位：球半径 R） */
  radius: number;
  /** 角速度 rad/s */
  speed: number;
  /** 0 = 主强调色 / 1 = 辅色 / 2 = 纯白 / >=3 = 自定义色 */
  hue: number;
  /** 自定义色（hue >= 3 时生效） */
  color?: string;
  /** 线宽（相对 R） */
  width: number;
  /** 初始相位 */
  phase?: number;
}

export interface CoreTheme {
  key: string;
  name: string;
  /** 一句话人设，帮用户「凭感觉选」 */
  tag: string;
  emoji: string;
  /** 主色（水晶爱心主渐变 / 辉光） */
  primary: string;
  /** 强调色（爱心渐变中段 / 底座光） */
  accent: string;
  /** 心跳时的能量核高光色 */
  spark: string;
  /** 玻璃球体内壁的通透色（决定"玻璃"质感冷暖） */
  shell: string;
  /** 三条轨道 */
  rings: CoreRingStyle[];
  /** 球体整体自转速度 rad/s（负值 = 反向） */
  spin: number;
  /** 心跳频率（越大跳得越快） */
  beat: number;
  /** 悬浮浮动周期（秒），越大越慢 */
  float: number;
  /** 辉光半径倍率（相对 R） */
  haloScale: number;
  /** 辉光强度 0~1 */
  haloPower: number;
  /** 粒子自转速度倍率 */
  particleSpin: number;
  /** 粒子闪烁频率倍率 */
  twinkle: number;
  /** 亮星占比 0~1 */
  starRatio: number;
  /** 粒子层数倍率（越大越"满"） */
  particleScale: number;
  /** 底座光环转速倍率 */
  baseSpin: number;
}

export const CORE_THEMES: CoreTheme[] = [
  /* ============ 1. 星河紫梦（保留：原视觉，作为基准） ============ */
  {
    key: 'galaxy',
    name: '星河紫梦',
    tag: '坠入紫色星云的深处，万物都在发光',
    emoji: '🔮',
    primary: '#C084FC',
    accent: '#F5A7D7',
    spark: '#FFFFFF',
    shell: 'rgba(214,200,255,0.10)',
    rings: [
      { tiltA: 1.13, tiltB: 0.22, radius: 1.20, speed: 0.16, hue: 0, width: 0.020, phase: 0.0 },
      { tiltA: 1.92, tiltB: -0.52, radius: 1.34, speed: 0.11, hue: 1, width: 0.017, phase: 1.2 },
      { tiltA: 0.44, tiltB: 0.92, radius: 1.48, speed: 0.085, hue: 2, width: 0.014, phase: 2.4 }
    ],
    spin: 0.055,
    beat: 2.9,
    float: 6.2,
    haloScale: 2.05,
    haloPower: 0.34,
    particleSpin: 1.0,
    twinkle: 1.7,
    starRatio: 0.12,
    particleScale: 1.0,
    baseSpin: 0.5
  },

  /* ============ 2. 极光幻彩 ============ */
  {
    key: 'aurora',
    name: '极光幻彩',
    tag: '青绿与玫红在极光里扭成一团多巴胺',
    emoji: '🌈',
    primary: '#5AC8FA',
    accent: '#FF7EB6',
    spark: '#E8FBFF',
    shell: 'rgba(198,244,255,0.12)',
    rings: [
      { tiltA: 0.95, tiltB: -0.34, radius: 1.16, speed: 0.24, hue: 0, width: 0.024, phase: 0.6 },
      { tiltA: 2.05, tiltB: 0.68, radius: 1.38, speed: 0.17, hue: 1, width: 0.019, phase: 2.0 },
      { tiltA: 0.30, tiltB: 1.15, radius: 1.52, speed: 0.13, hue: 0, width: 0.016, phase: 3.4 }
    ],
    spin: 0.085,
    beat: 3.6,
    float: 4.6,
    haloScale: 2.25,
    haloPower: 0.40,
    particleSpin: 1.45,
    twinkle: 2.6,
    starRatio: 0.16,
    particleScale: 1.15,
    baseSpin: 0.8
  },

  /* ============ 3. 熔金暗夜 ============ */
  {
    key: 'molten',
    name: '熔金暗夜',
    tag: '像岩浆在黑曜石里流动，滚烫而昂贵',
    emoji: '🔥',
    primary: '#FF9F45',
    accent: '#FF4E50',
    spark: '#FFF0C4',
    shell: 'rgba(255,208,160,0.12)',
    rings: [
      { tiltA: 1.30, tiltB: 0.10, radius: 1.18, speed: 0.10, hue: 0, width: 0.028, phase: 0.3 },
      { tiltA: 1.86, tiltB: -0.62, radius: 1.32, speed: 0.07, hue: 3, color: '#FFD36B', width: 0.020, phase: 1.7 },
      { tiltA: 0.52, tiltB: 0.88, radius: 1.46, speed: 0.05, hue: 1, width: 0.015, phase: 2.9 }
    ],
    spin: 0.038,
    beat: 2.2,
    float: 7.8,
    haloScale: 2.30,
    haloPower: 0.46,
    particleSpin: 0.72,
    twinkle: 1.1,
    starRatio: 0.20,
    particleScale: 0.95,
    baseSpin: 0.28
  },

  /* ============ 4. 深海秘境 ============ */
  {
    key: 'abyss',
    name: '深海秘境',
    tag: '沉到一万米以下，光只肯从身边经过',
    emoji: '🌊',
    primary: '#22D3EE',
    accent: '#3B82F6',
    spark: '#CFFAFE',
    shell: 'rgba(165,243,252,0.10)',
    rings: [
      { tiltA: 1.05, tiltB: 0.40, radius: 1.22, speed: 0.13, hue: 0, width: 0.019, phase: 0.9 },
      { tiltA: 2.00, tiltB: -0.30, radius: 1.40, speed: 0.09, hue: 1, width: 0.015, phase: 2.2 },
      { tiltA: 0.38, tiltB: 1.05, radius: 1.55, speed: 0.06, hue: 3, color: '#A5F3FC', width: 0.012, phase: 3.8 }
    ],
    spin: 0.046,
    beat: 2.0,
    float: 8.4,
    haloScale: 2.15,
    haloPower: 0.30,
    particleSpin: 0.62,
    twinkle: 0.9,
    starRatio: 0.18,
    particleScale: 1.25,
    baseSpin: 0.34
  },

  /* ============ 5. 甜樱绽放 ============ */
  {
    key: 'sakura',
    name: '甜樱绽放',
    tag: '粉色花瓣绕着心动打转，甜到不设防',
    emoji: '🌸',
    primary: '#FB8FB8',
    accent: '#FFC2D8',
    spark: '#FFF0F5',
    shell: 'rgba(255,214,230,0.14)',
    rings: [
      { tiltA: 1.20, tiltB: 0.30, radius: 1.18, speed: 0.20, hue: 0, width: 0.022, phase: 0.2 },
      { tiltA: 1.95, tiltB: -0.45, radius: 1.36, speed: 0.15, hue: 1, width: 0.018, phase: 1.5 },
      { tiltA: 0.42, tiltB: 0.98, radius: 1.50, speed: 0.11, hue: 3, color: '#FFE3EE', width: 0.014, phase: 2.8 }
    ],
    spin: 0.070,
    beat: 3.3,
    float: 5.4,
    haloScale: 2.00,
    haloPower: 0.32,
    particleSpin: 1.25,
    twinkle: 2.2,
    starRatio: 0.15,
    particleScale: 1.10,
    baseSpin: 0.62
  },

  /* ============ 6. 翡翠秘境 ============ */
  {
    key: 'emerald',
    name: '翡翠秘境',
    tag: '祖母绿切开一整个雨林，光在里面拐弯',
    emoji: '💚',
    primary: '#34D399',
    accent: '#059669',
    spark: '#D1FAE5',
    shell: 'rgba(167,243,208,0.12)',
    rings: [
      { tiltA: 1.08, tiltB: 0.50, radius: 1.24, speed: 0.12, hue: 0, width: 0.023, phase: 0.4 },
      { tiltA: 2.10, tiltB: -0.20, radius: 1.42, speed: 0.08, hue: 1, width: 0.017, phase: 1.9 },
      { tiltA: 0.35, tiltB: 1.20, radius: 1.56, speed: 0.055, hue: 3, color: '#A7F3D0', width: 0.013, phase: 3.1 }
    ],
    spin: 0.050,
    beat: 2.4,
    float: 7.2,
    haloScale: 2.10,
    haloPower: 0.36,
    particleSpin: 0.82,
    twinkle: 1.3,
    starRatio: 0.17,
    particleScale: 1.05,
    baseSpin: 0.42
  },

  /* ============ 7. 暗夜金砂 ============ */
  {
    key: 'gold',
    name: '暗夜金砂',
    tag: '黑金箔碎在夜里闪，每一帧都像珠宝广告',
    emoji: '👑',
    primary: '#F5C542',
    accent: '#B8860B',
    spark: '#FFF8DC',
    shell: 'rgba(255,240,200,0.11)',
    rings: [
      { tiltA: 1.15, tiltB: 0.18, radius: 1.20, speed: 0.09, hue: 0, width: 0.026, phase: 0.0 },
      { tiltA: 1.90, tiltB: -0.55, radius: 1.36, speed: 0.06, hue: 3, color: '#FFF3C4', width: 0.018, phase: 1.4 },
      { tiltA: 0.48, tiltB: 0.85, radius: 1.50, speed: 0.04, hue: 2, width: 0.012, phase: 2.6 }
    ],
    spin: 0.035,
    beat: 1.8,
    float: 9.0,
    haloScale: 2.35,
    haloPower: 0.44,
    particleSpin: 0.55,
    twinkle: 0.8,
    starRatio: 0.22,
    particleScale: 1.30,
    baseSpin: 0.22
  },

  /* ============ 8. 玫瑰石英 ============ */
  {
    key: 'quartz',
    name: '玫瑰石英',
    tag: '整颗都是透明粉晶，光在里面慢慢弯折',
    emoji: '💎',
    primary: '#E8A0BF',
    accent: '#B76E8C',
    spark: '#FFF0F6',
    shell: 'rgba(255,225,240,0.16)',
    rings: [
      { tiltA: 1.12, tiltB: 0.34, radius: 1.22, speed: 0.14, hue: 0, width: 0.021, phase: 0.5 },
      { tiltA: 1.98, tiltB: -0.42, radius: 1.38, speed: 0.10, hue: 1, width: 0.016, phase: 1.8 },
      { tiltA: 0.40, tiltB: 1.02, radius: 1.52, speed: 0.07, hue: 2, width: 0.011, phase: 3.0 }
    ],
    spin: 0.048,
    beat: 2.1,
    float: 7.6,
    haloScale: 2.05,
    haloPower: 0.28,
    particleSpin: 0.70,
    twinkle: 1.0,
    starRatio: 0.14,
    particleScale: 1.18,
    baseSpin: 0.36
  }
];

const THEME_MAP: Record<string, CoreTheme> = {};
CORE_THEMES.forEach((t) => { THEME_MAP[t.key] = t; });

export const DEFAULT_CORE_THEME = 'galaxy';

export function getCoreTheme(key: string): CoreTheme {
  return THEME_MAP[key] || THEME_MAP[DEFAULT_CORE_THEME];
}

/* ============================================================
 * 二、整页设计语言（Page Design Language）
 * ============================================================
 * 【为什么需要这一层】
 * 早先「风格」只改水晶球（水晶球配色/粒子/光效），页面本体是另一套「皮肤」在管，
 * 结果用户切风格时只有那颗球变色，整页几乎没动 —— 换个风格像没换。
 *
 * 【现在】
 * 每种风格额外带一套「整页设计语言」，一次性把下面四件事全换掉，且对比强烈：
 *   1) 配色方案  bg / 光斑 / 玻璃面 / 文字层级 / 强调色 / 阴影
 *   2) 字体样式  font-family（衬线 ↔ 无衬线）/ 字重 / 字距
 *   3) 布局间距  卡片圆角 / 内边距 / 区块垂直间距
 *   4) 组件外观  玻璃面材质（磨砂 ↔ 通透）/ 描边 / 图标底座 / 面板实底
 *
 * 【怎么落到页面上】
 * 不写进 WXSS、也不用属性选择器，而是把这一整套**内联注入到页面根节点**的
 * CSS 变量（前缀 --t-），WXSS 里全部写 var(--t-xxx)。切风格 = 换一组变量 = 整页换装，
 * glass-easel / Skyline / WebView 三端一致。
 *
 * 【强对比约定】八套风格刻意在「明暗 / 方圆 / 疏密 / 衬线」四轴上拉开：
 *   明暗  aurora·sakura·quartz（浅底）  ↔  galaxy·molten·abyss·emerald·gold（深底）
 *   方圆  12rpx（gold 直角）           ↔  44rpx（quartz 大圆）
 *   疏密  gap 22rpx（molten 紧凑）      ↔  34rpx（gold 疏朗）
 *   字体  Songti/Georgia（molten·gold·sakura）↔ 无衬线（其余）
 */
export interface CorePageStyle {
  /** 整页是否深色（决定导航栏前景色） */
  dark: boolean;
  /** 导航栏底色（hex，wx.setNavigationBarColor 只认 hex） */
  nav: string;
  /** 页面背景（完整渐变栈，直接喂给 background） */
  bg: string;
  /** 四团游动光斑（各是一个完整 radial-gradient） */
  blobA: string; blobB: string; blobC: string; blobD: string;
  /** 顶部主光晕（完整 radial-gradient） */
  glow: string;
  /** 玻璃面 / 次级玻璃面 / 描边 / 内部分隔线 */
  glass: string; glass2: string; line: string; line2: string;
  /** 文字三级 */
  text: string; sub: string; faint: string;
  /** 强调三色 + 辉光色 */
  c1: string; c2: string; c3: string; glowc: string;
  /** 卡片阴影 / 交互高亮阴影 */
  shadow: string; shadow2: string;
  /** dock 底 / 浮层面板底 / 面板描边 */
  dock: string; panel: string; panelLine: string;
  /** 宫格图标底座渐变（完整 linear-gradient） */
  ico: string;
  /** 字体族 */
  font: string;
  /** 正文字距 / 标题字距 / 标题字重 */
  ls: string; lst: string; fw: string;
  /** 卡片圆角 / 小圆角 / 卡片内边距 / 区块垂直间距 / 玻璃模糊 */
  r: string; rs: string; pad: string; gap: string; blur: string;
}

const FONT_SANS = "-apple-system,'PingFang SC','Helvetica Neue',Arial,sans-serif";
const FONT_SERIF = "Georgia,'Songti SC','Times New Roman',serif";

/** 每套风格的整页设计语言；key 与 CORE_THEMES 一一对应 */
const PAGES: Record<string, CorePageStyle> = {
  /* 1. 星河紫梦 —— 深空玻璃拟态（基准：与重构前逐值一致） */
  galaxy: {
    dark: true, nav: '#1B1240',
    bg: 'radial-gradient(125% 85% at 50% -12%, #2A1C5E 0%, #1B1240 40%, #120E2E 100%)',
    blobA: 'radial-gradient(circle, #8B5CF6 0%, rgba(0,0,0,0) 70%)',
    blobB: 'radial-gradient(circle, #7DD3FC 0%, rgba(0,0,0,0) 70%)',
    blobC: 'radial-gradient(circle, #F5A7D7 0%, rgba(0,0,0,0) 70%)',
    blobD: 'radial-gradient(circle, #FFFFFF 0%, rgba(0,0,0,0) 70%)',
    glow: 'radial-gradient(circle, rgba(192,132,252,0.30) 0%, rgba(139,92,246,0.12) 38%, rgba(139,92,246,0) 68%)',
    glass: 'rgba(255,255,255,0.08)', glass2: 'rgba(255,255,255,0.10)',
    line: 'rgba(255,255,255,0.16)', line2: 'rgba(255,255,255,0.12)',
    text: '#FFFFFF', sub: 'rgba(255,255,255,0.72)', faint: 'rgba(255,255,255,0.56)',
    c1: '#F5A7D7', c2: '#C084FC', c3: '#7DD3FC',
    glowc: 'rgba(192,132,252,0.55)',
    shadow: 'rgba(8,6,26,0.45)', shadow2: 'rgba(139,92,246,0.34)',
    dock: 'rgba(18,14,46,0.82)', panel: 'rgba(28,22,62,0.92)', panelLine: 'rgba(192,132,252,0.28)',
    ico: 'linear-gradient(150deg, rgba(192,132,252,0.28) 0%, rgba(245,167,215,0.20) 100%)',
    font: FONT_SANS, ls: '0.5rpx', lst: '0.5rpx', fw: '700',
    r: '30rpx', rs: '28rpx', pad: '30rpx 28rpx', gap: '26rpx', blur: 'blur(18px)'
  },

  /* 2. 极光幻彩 —— 明亮多巴胺：浅底 + 高饱和 + 大圆角（与 galaxy 昼夜反差最大） */
  aurora: {
    dark: false, nav: '#EAF7FF',
    bg: 'linear-gradient(160deg, #EAF7FF 0%, #F3ECFF 46%, #FFEAF4 100%)',
    blobA: 'radial-gradient(circle, #5AC8FA 0%, rgba(0,0,0,0) 70%)',
    blobB: 'radial-gradient(circle, #A78BFA 0%, rgba(0,0,0,0) 70%)',
    blobC: 'radial-gradient(circle, #FF7EB6 0%, rgba(0,0,0,0) 70%)',
    blobD: 'radial-gradient(circle, #FFE066 0%, rgba(0,0,0,0) 72%)',
    glow: 'radial-gradient(circle, rgba(90,200,250,0.34) 0%, rgba(167,139,250,0.16) 40%, rgba(167,139,250,0) 68%)',
    glass: 'rgba(255,255,255,0.74)', glass2: 'rgba(255,255,255,0.56)',
    line: 'rgba(90,200,250,0.30)', line2: 'rgba(130,120,200,0.14)',
    text: '#22303F', sub: '#4A6076', faint: '#8296AB',
    c1: '#EF4C9A', c2: '#5AC8FA', c3: '#A78BFA',
    glowc: 'rgba(239,76,154,0.45)',
    shadow: 'rgba(90,140,220,0.18)', shadow2: 'rgba(239,76,154,0.30)',
    dock: 'rgba(255,255,255,0.88)', panel: 'rgba(255,255,255,0.96)', panelLine: 'rgba(90,200,250,0.35)',
    ico: 'linear-gradient(150deg, rgba(90,200,250,0.30) 0%, rgba(255,126,182,0.30) 100%)',
    font: FONT_SANS, ls: '1rpx', lst: '1.5rpx', fw: '800',
    r: '36rpx', rs: '30rpx', pad: '32rpx 30rpx', gap: '30rpx', blur: 'blur(16px)'
  },

  /* 3. 熔金暗夜 —— 暖黑 + 熔岩橙：直角硬朗 + 衬线，紧凑密排 */
  molten: {
    dark: true, nav: '#170C07',
    bg: 'radial-gradient(120% 80% at 50% -10%, #2A140A 0%, #170C07 45%, #0C0603 100%)',
    blobA: 'radial-gradient(circle, #FF9F45 0%, rgba(0,0,0,0) 68%)',
    blobB: 'radial-gradient(circle, #FF4E50 0%, rgba(0,0,0,0) 68%)',
    blobC: 'radial-gradient(circle, #FFD36B 0%, rgba(0,0,0,0) 70%)',
    blobD: 'radial-gradient(circle, #FFE0B0 0%, rgba(0,0,0,0) 72%)',
    glow: 'radial-gradient(circle, rgba(255,159,69,0.34) 0%, rgba(255,78,80,0.14) 38%, rgba(255,78,80,0) 66%)',
    glass: 'rgba(255,180,110,0.07)', glass2: 'rgba(255,180,110,0.11)',
    line: 'rgba(255,175,95,0.26)', line2: 'rgba(255,175,95,0.14)',
    text: '#FFF4E6', sub: 'rgba(255,228,196,0.74)', faint: 'rgba(255,228,196,0.5)',
    c1: '#FF9F45', c2: '#FFD36B', c3: '#FF4E50',
    glowc: 'rgba(255,159,69,0.55)',
    shadow: 'rgba(20,8,2,0.62)', shadow2: 'rgba(255,120,40,0.34)',
    dock: 'rgba(20,10,5,0.88)', panel: 'rgba(34,18,10,0.95)', panelLine: 'rgba(255,175,95,0.34)',
    ico: 'linear-gradient(150deg, rgba(255,159,69,0.30) 0%, rgba(255,78,80,0.22) 100%)',
    font: FONT_SERIF, ls: '1rpx', lst: '2rpx', fw: '600',
    r: '14rpx', rs: '10rpx', pad: '28rpx 26rpx', gap: '22rpx', blur: 'blur(14px)'
  },

  /* 4. 深海秘境 —— 墨蓝青：超大圆角 + 强磨砂，疏朗 */
  abyss: {
    dark: true, nav: '#062430',
    bg: 'radial-gradient(120% 80% at 50% -10%, #0A3346 0%, #062430 42%, #03151D 100%)',
    blobA: 'radial-gradient(circle, #22D3EE 0%, rgba(0,0,0,0) 70%)',
    blobB: 'radial-gradient(circle, #3B82F6 0%, rgba(0,0,0,0) 70%)',
    blobC: 'radial-gradient(circle, #0EA5E9 0%, rgba(0,0,0,0) 70%)',
    blobD: 'radial-gradient(circle, #A5F3FC 0%, rgba(0,0,0,0) 72%)',
    glow: 'radial-gradient(circle, rgba(34,211,238,0.30) 0%, rgba(59,130,246,0.14) 40%, rgba(59,130,246,0) 68%)',
    glass: 'rgba(120,220,255,0.08)', glass2: 'rgba(120,220,255,0.12)',
    line: 'rgba(130,225,255,0.20)', line2: 'rgba(130,225,255,0.12)',
    text: '#EAFBFF', sub: 'rgba(200,240,255,0.74)', faint: 'rgba(180,225,245,0.5)',
    c1: '#22D3EE', c2: '#60A5FA', c3: '#A5F3FC',
    glowc: 'rgba(34,211,238,0.5)',
    shadow: 'rgba(2,12,20,0.5)', shadow2: 'rgba(34,211,238,0.30)',
    dock: 'rgba(4,20,28,0.86)', panel: 'rgba(6,30,42,0.94)', panelLine: 'rgba(130,225,255,0.28)',
    ico: 'linear-gradient(150deg, rgba(34,211,238,0.28) 0%, rgba(59,130,246,0.24) 100%)',
    font: FONT_SANS, ls: '0.6rpx', lst: '1rpx', fw: '700',
    r: '40rpx', rs: '32rpx', pad: '34rpx 30rpx', gap: '32rpx', blur: 'blur(22px)'
  },

  /* 5. 甜樱绽放 —— 奶油浅粉 + 衬线：柔和圆润 */
  sakura: {
    dark: false, nav: '#FFF7FA',
    bg: 'linear-gradient(165deg, #FFF7FA 0%, #FFEFF5 50%, #FDEBF1 100%)',
    blobA: 'radial-gradient(circle, #FB8FB8 0%, rgba(0,0,0,0) 70%)',
    blobB: 'radial-gradient(circle, #FFC2D8 0%, rgba(0,0,0,0) 70%)',
    blobC: 'radial-gradient(circle, #F7A8C4 0%, rgba(0,0,0,0) 70%)',
    blobD: 'radial-gradient(circle, #FFE3EE 0%, rgba(0,0,0,0) 72%)',
    glow: 'radial-gradient(circle, rgba(251,143,184,0.34) 0%, rgba(255,194,216,0.16) 40%, rgba(255,194,216,0) 68%)',
    glass: 'rgba(255,255,255,0.80)', glass2: 'rgba(255,246,250,0.62)',
    line: 'rgba(251,143,184,0.28)', line2: 'rgba(230,150,180,0.14)',
    text: '#4A2B38', sub: '#8A5F70', faint: '#B994A3',
    c1: '#E8558E', c2: '#FF9EC4', c3: '#C77DA8',
    glowc: 'rgba(251,143,184,0.5)',
    shadow: 'rgba(220,140,175,0.20)', shadow2: 'rgba(232,85,142,0.28)',
    dock: 'rgba(255,255,255,0.90)', panel: 'rgba(255,250,252,0.96)', panelLine: 'rgba(251,143,184,0.34)',
    ico: 'linear-gradient(150deg, rgba(251,143,184,0.32) 0%, rgba(255,194,216,0.36) 100%)',
    font: FONT_SERIF, ls: '0.5rpx', lst: '1rpx', fw: '600',
    r: '34rpx', rs: '28rpx', pad: '32rpx 30rpx', gap: '30rpx', blur: 'blur(16px)'
  },

  /* 6. 翡翠秘境 —— 墨绿祖母绿：中等圆角 + 通透玻璃，清爽 */
  emerald: {
    dark: true, nav: '#072A1E',
    bg: 'radial-gradient(125% 85% at 50% -12%, #0B3A2A 0%, #072A1E 42%, #041710 100%)',
    blobA: 'radial-gradient(circle, #34D399 0%, rgba(0,0,0,0) 70%)',
    blobB: 'radial-gradient(circle, #059669 0%, rgba(0,0,0,0) 70%)',
    blobC: 'radial-gradient(circle, #A7F3D0 0%, rgba(0,0,0,0) 70%)',
    blobD: 'radial-gradient(circle, #6EE7B7 0%, rgba(0,0,0,0) 72%)',
    glow: 'radial-gradient(circle, rgba(52,211,153,0.30) 0%, rgba(5,150,105,0.14) 40%, rgba(5,150,105,0) 68%)',
    glass: 'rgba(140,255,200,0.07)', glass2: 'rgba(140,255,200,0.11)',
    line: 'rgba(150,255,205,0.20)', line2: 'rgba(150,255,205,0.12)',
    text: '#EAFBF3', sub: 'rgba(200,250,225,0.74)', faint: 'rgba(180,240,210,0.5)',
    c1: '#34D399', c2: '#6EE7B7', c3: '#A7F3D0',
    glowc: 'rgba(52,211,153,0.5)',
    shadow: 'rgba(2,16,10,0.55)', shadow2: 'rgba(52,211,153,0.28)',
    dock: 'rgba(5,26,18,0.86)', panel: 'rgba(7,34,24,0.94)', panelLine: 'rgba(150,255,205,0.26)',
    ico: 'linear-gradient(150deg, rgba(52,211,153,0.28) 0%, rgba(5,150,105,0.24) 100%)',
    font: FONT_SANS, ls: '0.5rpx', lst: '0.5rpx', fw: '700',
    r: '22rpx', rs: '18rpx', pad: '28rpx 26rpx', gap: '24rpx', blur: 'blur(16px)'
  },

  /* 7. 暗夜金砂 —— 黑金奢牌：最直角 + 衬线 + 宽字距 + 疏朗，编辑风 */
  gold: {
    dark: true, nav: '#140F07',
    bg: 'radial-gradient(120% 80% at 50% -10%, #241E10 0%, #140F07 46%, #080502 100%)',
    blobA: 'radial-gradient(circle, #F5C542 0%, rgba(0,0,0,0) 70%)',
    blobB: 'radial-gradient(circle, #B8860B 0%, rgba(0,0,0,0) 70%)',
    blobC: 'radial-gradient(circle, #FFF3C4 0%, rgba(0,0,0,0) 70%)',
    blobD: 'radial-gradient(circle, #F5E6B0 0%, rgba(0,0,0,0) 72%)',
    glow: 'radial-gradient(circle, rgba(245,197,66,0.30) 0%, rgba(184,134,11,0.13) 40%, rgba(184,134,11,0) 68%)',
    glass: 'rgba(245,197,66,0.06)', glass2: 'rgba(245,197,66,0.10)',
    line: 'rgba(245,197,66,0.32)', line2: 'rgba(245,197,66,0.16)',
    text: '#FBF3DC', sub: 'rgba(245,225,170,0.74)', faint: 'rgba(235,210,150,0.5)',
    c1: '#F5C542', c2: '#FFF3C4', c3: '#B8860B',
    glowc: 'rgba(245,197,66,0.5)',
    shadow: 'rgba(12,8,2,0.64)', shadow2: 'rgba(245,197,66,0.30)',
    dock: 'rgba(14,10,4,0.90)', panel: 'rgba(26,20,9,0.95)', panelLine: 'rgba(245,197,66,0.36)',
    ico: 'linear-gradient(150deg, rgba(245,197,66,0.30) 0%, rgba(184,134,11,0.22) 100%)',
    font: FONT_SERIF, ls: '2.5rpx', lst: '3rpx', fw: '600',
    r: '12rpx', rs: '8rpx', pad: '34rpx 32rpx', gap: '34rpx', blur: 'blur(14px)'
  },

  /* 8. 玫瑰石英 —— 浅玫瑰石英：最大圆角 + 通透温柔，疏朗 */
  quartz: {
    dark: false, nav: '#FDF3F7',
    bg: 'linear-gradient(165deg, #FDF3F7 0%, #F6EBF3 48%, #EEF2FA 100%)',
    blobA: 'radial-gradient(circle, #E8A0BF 0%, rgba(0,0,0,0) 70%)',
    blobB: 'radial-gradient(circle, #C9A7E8 0%, rgba(0,0,0,0) 70%)',
    blobC: 'radial-gradient(circle, #B8D4F0 0%, rgba(0,0,0,0) 70%)',
    blobD: 'radial-gradient(circle, #FFFFFF 0%, rgba(0,0,0,0) 72%)',
    glow: 'radial-gradient(circle, rgba(201,119,156,0.26) 0%, rgba(169,140,216,0.14) 40%, rgba(169,140,216,0) 68%)',
    glass: 'rgba(255,255,255,0.68)', glass2: 'rgba(255,255,255,0.50)',
    line: 'rgba(200,140,175,0.26)', line2: 'rgba(170,150,200,0.14)',
    text: '#40303A', sub: '#7A6472', faint: '#A896A4',
    c1: '#C9779C', c2: '#A98CD8', c3: '#7FA8D8',
    glowc: 'rgba(201,119,156,0.4)',
    shadow: 'rgba(150,120,160,0.16)', shadow2: 'rgba(201,119,156,0.24)',
    dock: 'rgba(255,252,254,0.88)', panel: 'rgba(255,252,254,0.96)', panelLine: 'rgba(200,140,175,0.32)',
    ico: 'linear-gradient(150deg, rgba(232,160,191,0.32) 0%, rgba(169,140,216,0.28) 100%)',
    font: FONT_SANS, ls: '0.6rpx', lst: '1rpx', fw: '700',
    r: '44rpx', rs: '34rpx', pad: '34rpx 32rpx', gap: '32rpx', blur: 'blur(20px)'
  }
};

function pageOf(key: string): CorePageStyle {
  return PAGES[key] || PAGES[DEFAULT_CORE_THEME];
}

/**
 * 把某风格的整页设计语言展开成内联 style 串（前缀 --t-），
 * 绑到页面根节点即可让整页换装。缺省风格已兜底，不会返回空串。
 */
export function buildCorePageStyle(key: string): string {
  const p = pageOf(key);
  return [
    '--t-bg:' + p.bg,
    '--t-blob-a:' + p.blobA,
    '--t-blob-b:' + p.blobB,
    '--t-blob-c:' + p.blobC,
    '--t-blob-d:' + p.blobD,
    '--t-glow:' + p.glow,
    '--t-glass:' + p.glass,
    '--t-glass-2:' + p.glass2,
    '--t-line:' + p.line,
    '--t-line-2:' + p.line2,
    '--t-text:' + p.text,
    '--t-sub:' + p.sub,
    '--t-faint:' + p.faint,
    '--t-1:' + p.c1,
    '--t-2:' + p.c2,
    '--t-3:' + p.c3,
    '--t-glowc:' + p.glowc,
    '--t-shadow:' + p.shadow,
    '--t-shadow-2:' + p.shadow2,
    '--t-dock:' + p.dock,
    '--t-panel:' + p.panel,
    '--t-panel-line:' + p.panelLine,
    '--t-ico:' + p.ico,
    '--t-font:' + p.font,
    '--t-ls:' + p.ls,
    '--t-lst:' + p.lst,
    '--t-fw:' + p.fw,
    '--t-r:' + p.r,
    '--t-rs:' + p.rs,
    '--t-pad:' + p.pad,
    '--t-gap:' + p.gap,
    '--t-blur:' + p.blur,
    '--t-dark:' + (p.dark ? '1' : '0')
  ].join(';');
}

/** 风格是否深色（首页据此同步导航栏前景/底色，避免浅底配深栏） */
export function isDarkCoreTheme(key: string): boolean {
  return pageOf(key).dark;
}

/** 风格对应的导航栏底色（hex） */
export function coreThemeNav(key: string): string {
  return pageOf(key).nav;
}

/** 给 WXML 用的精简列表（只要展示字段，别把 rings 也塞进 setData）
 *  sw 额外带上该风格的整页主色对，让面板上就能一眼看出「这几套真的不一样」 */
export function coreThemeViews(): { key: string; name: string; tag: string; emoji: string; sw: string[] }[] {
  return CORE_THEMES.map((t) => {
    const p = pageOf(t.key);
    return { key: t.key, name: t.name, tag: t.tag, emoji: t.emoji, sw: [p.c1, p.c2] };
  });
}
