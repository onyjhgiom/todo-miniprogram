// utils/theme.ts
// 主题管理：5 套预设主题 + 自定义颜色主题（custom）
// 预设主题通过 .themed[data-theme='X'] 触发 CSS 变量切换；
// 自定义主题通过页面根 wrapper 的 inline style 注入 CSS 变量（级联到所有子元素/组件），
// 从而实现「用户选什么颜色，全局紫色强调色就被替换成什么颜色」。
import type { ThemeKey, IThemeSetting, ICustomTheme } from '../types/index';
import { SCENE_BG } from './scene-bg';

const STORAGE_KEY = 'theme';
const CUSTOM_KEY = 'theme_custom';

export const THEMES: Record<ThemeKey, IThemeSetting> = {
  light: {
    key: 'light',
    name: '暮金夜色',
    heroGradient: 'linear-gradient(135deg, #2A1D10 0%, #3D2C18 50%, #6B4A26 100%)'
  },
  dark: {
    key: 'dark',
    name: '墨韵深炭',
    heroGradient: 'linear-gradient(135deg, #3B362F 0%, #4A4038 50%, #96573A 100%)'
  },
  rose: {
    key: 'rose',
    name: '深邃暗夜',
    heroGradient: 'linear-gradient(135deg, #101828 0%, #1B2743 50%, #3B4A7E 100%)'
  },
  forest: {
    key: 'forest',
    name: '自然森系',
    heroGradient: 'linear-gradient(135deg, #3F7A52 0%, #6B9E74 50%, #AECDB0 100%)'
  },
  twilight: {
    key: 'twilight',
    name: '暮金旧纸',
    heroGradient: 'linear-gradient(135deg, #8C6E30 0%, #A98743 50%, #D8BC85 100%)'
  },
  scarlet: {
    key: 'scarlet',
    name: '艳红绯纸',
    heroGradient: 'linear-gradient(135deg, #8C2F2F 0%, #C0522F 50%, #E3A084 100%)'
  },
  jade: {
    key: 'jade',
    name: '翠玉青瓷',
    heroGradient: 'linear-gradient(135deg, #3E6B52 0%, #5C8E6E 50%, #A8CBB2 100%)'
  },
  indigo: {
    key: 'indigo',
    name: '靛蓝夜航',
    heroGradient: 'linear-gradient(135deg, #3A4A7C 0%, #5C6E9E 50%, #A8B4D8 100%)'
  },
  /* ===== 十大风格槽位（对齐效果图） ===== */
  minimal: {
    key: 'minimal',
    name: '极简白',
    heroGradient: 'linear-gradient(135deg, #60A5FA 0%, #3B82F6 50%, #93C5FD 100%)'
  },
  tech: {
    key: 'tech',
    name: '深色科技',
    heroGradient: 'linear-gradient(135deg, #0A1220 0%, #0F2038 50%, #1E3A5F 100%)'
  },
  healing: {
    key: 'healing',
    name: '治愈插画',
    heroGradient: 'linear-gradient(135deg, #F2B879 0%, #E8945A 50%, #F7D9AC 100%)'
  },
  noir: {
    key: 'noir',
    name: '暗黑渐变',
    heroGradient: 'linear-gradient(135deg, #171310 0%, #241E14 50%, #4A3B22 100%)'
  },
  candy: {
    key: 'candy',
    name: '潮流多彩',
    heroGradient: 'linear-gradient(135deg, #F472B6 0%, #EC4899 50%, #FBBF24 100%)'
  },
  retro: {
    key: 'retro',
    name: '复古怀旧',
    heroGradient: 'linear-gradient(135deg, #8C6239 0%, #A87F4F 50%, #D6BC8F 100%)'
  },
  morandi: {
    key: 'morandi',
    name: '莫兰迪',
    heroGradient: 'linear-gradient(135deg, #8A9B8E 0%, #A8B5A8 50%, #D5CFC2 100%)'
  },
  aurora: {
    key: 'aurora',
    name: '玻璃拟态',
    heroGradient: 'linear-gradient(135deg, #7C5CFC 0%, #A855F7 50%, #38BDF8 100%)'
  },
  ink: {
    key: 'ink',
    name: '国风水墨',
    heroGradient: 'linear-gradient(135deg, #4E6157 0%, #75897C 50%, #C9CDB9 100%)'
  },
  pixel: {
    key: 'pixel',
    name: '游戏像素',
    heroGradient: 'linear-gradient(135deg, #1A1E2E 0%, #262C48 50%, #3D3468 100%)'
  },
  liquid: {
    key: 'liquid',
    name: '液态金属',
    heroGradient: 'linear-gradient(135deg, #C9D2DE 0%, #9FB0C8 40%, #5B7CC4 100%)'
  },
  deepsea: {
    key: 'deepsea',
    name: '深海蓝金',
    // 蓝金双色：深海蓝黑 → 午夜蓝 → 香槟金（上海傍晚的电影级光线）
    heroGradient: 'linear-gradient(135deg, #08111F 0%, #16305A 52%, #8A6A3A 100%)'
  },
  career: {
    key: 'career',
    name: '求职工作台',
    // 秋招助手专用：深蓝 AI Dashboard（品牌蓝 + AI 青紫强调，专业招聘工作台气质）
    heroGradient: 'linear-gradient(165deg, #07152D 0%, #0B1B35 42%, #102746 74%, #123B78 100%)'
  },
  custom: {
    key: 'custom',
    name: '自定义',
    heroGradient: '' // 动态生成，见 buildHeroGradient
  }
};

export const THEME_ORDER: ThemeKey[] = [
  // 十二风格（对齐用户 12 套视觉提示词顺序）优先展示
  'minimal', 'tech', 'healing', 'noir', 'candy', 'retro', 'morandi', 'aurora', 'ink', 'pixel', 'forest', 'liquid',
  // 深海蓝金（上海城市主题：蓝金双色体系 + 城市天际线背景）
  'deepsea',
  // 原有侘寂系主题（保留为额外配色）
  'light', 'dark', 'rose', 'twilight', 'scarlet', 'jade', 'indigo',
  'custom'
];

/* ============ 颜色计算工具 ============ */

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function normalizeHex(hex: string): string {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return h;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex);
  const n = parseInt(h.length === 6 ? h : 'B5714C', 16);
  if (isNaN(n)) return [181, 113, 76];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const s = (v: number) => clampByte(v).toString(16).padStart(2, '0');
  return `#${s(r)}${s(g)}${s(b)}`;
}

/** 向白色 (pct>0) / 黑色 (pct<0) 混合，pct 范围 -100~100 */
export function shade(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = pct >= 0 ? 255 : 0;
  const k = Math.abs(pct) / 100;
  return rgbToHex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k);
}

/** 两种颜色按比例混合 (0~100 表示 hex2 占比) */
function mix(hex1: string, hex2: string, pct: number): string {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const k = pct / 100;
  return rgbToHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

/** hex → rgba() 字符串 */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ============ 自定义主题 ============ */

export const DEFAULT_CUSTOM: ICustomTheme = {
  primary: '#B5714C',
  bg: null,
  dark: false
};

/** 可选主题色色板（侘寂暖色系优先） */
export const PRIMARY_SWATCHES: string[] = [
  '#B5714C', // 陶土棕（默认主色）
  '#A98743', // 旧金
  '#5C7E5C', // 鼠尾草绿
  '#C08468', // 陶土粉
  '#8C5238', // 赭石
  '#6E8E6E', // 灰绿
  '#D8A05C', // 奶油黄
  '#749C84', // 青瓷
  '#3B362F', // 深炭墨
  '#64748b', // 石板灰
  '#10b981', // 翡翠绿
  '#6366f1'  // 靛蓝（经典可选）
];

/** 浅色模式可选背景色（侘寂暖色纸感） */
export const BG_SWATCHES_LIGHT: Array<string | null> = [
  null,       // 跟随默认（#F0EDE6）
  '#F0EDE6',  // 暖宣纸（默认）
  '#F7F5F0',  // 素白
  '#E9EFE7',  // 黛青
  '#F1EDE2',  // 暮金
  '#E7DFD0',  // 墨韵
  '#f5f6fb',  // 冷灰白
  '#faf5ff'   // 淡紫
];

/** 深色模式可选背景色 */
export const BG_SWATCHES_DARK: Array<string | null> = [
  null,       // 跟随默认（#2C2823）
  '#2C2823',  // 深炭墨（默认）
  '#1c1917',  // 碳黑
  '#14213d',  // 藏青
  '#0c1f1a',  // 墨绿
  '#1f2937',  // 石墨灰
  '#0f172a',  // 深海蓝
  '#2a1a2e'   // 暗酒红
];

/** 读取自定义主题颜色 */
export function loadCustomTheme(): ICustomTheme {
  try {
    const v = wx.getStorageSync(CUSTOM_KEY) as Partial<ICustomTheme> | undefined;
    if (v && typeof v === 'object' && typeof v.primary === 'string') {
      return { ...DEFAULT_CUSTOM, ...v };
    }
  } catch (_e) {
    /* 忽略 */
  }
  return { ...DEFAULT_CUSTOM };
}

/** 持久化自定义主题颜色 */
function saveCustomTheme(custom: ICustomTheme): void {
  try {
    wx.setStorageSync(CUSTOM_KEY, custom);
  } catch (_e) {
    /* 忽略 */
  }
}

/** 由主题色生成 hero 渐变（深→主色→浅） */
export function buildHeroGradient(primary: string): string {
  return `linear-gradient(135deg, ${shade(primary, -22)} 0%, ${primary} 50%, ${shade(primary, 18)} 100%)`;
}

/**
 * 生成自定义主题的 inline style（CSS 变量声明串）。
 * 挂在页面根 wrapper 的 style 上，变量级联到所有子节点与组件。
 */
export function buildCustomVars(custom: ICustomTheme): string {
  const p = normalizeHex(custom.primary).length === 6 ? custom.primary : '#B5714C';
  const dark = !!custom.dark;
  const bg = custom.bg || (dark ? '#2C2823' : '#F0EDE6');
  const dir = dark ? 1 : -1; // 深色向亮推，浅色向暗推

  // 背景体系：由背景色派生 elevated / soft / card / border
  const bgElevated = dark ? shade(bg, 14) : shade(bg, 100);
  const bgSoft = dark ? shade(bg, 8) : shade(bg, -4);
  const card = dark ? shade(bg, 6) : shade(bg, 100);
  const border = dark ? shade(bg, 24) : shade(bg, -8);

  // 文字体系：向主题色轻微偏色，保证整体风格统一
  const text = dark ? mix('#f1f5f9', shade(p, 30), 5) : mix('#1a1d29', p, 5);
  const textSoft = dark ? mix('#94a3b8', shade(p, 20), 6) : mix('#5b6478', p, 6);
  const textMute = dark ? '#64748b' : '#9ca3af';

  // 强调色体系
  const primaryDeep = shade(p, dark ? 12 : -12);
  /* 深色面板锚色：无论 light / dark 都向黑色推，保证白色衬线大字读得清；
   * dark theme 下原色已被深色页面底包裹，需要主色更深一档才能形成"墨色面板"感 */
  const primaryInk = shade(p, dark ? -38 : -45);
  const primaryInk2 = shade(p, dark ? -28 : -32);
  const accent = shade(p, dark ? 16 : -8);

  const lines: string[] = [
    `--color-primary: ${p}`,
    `--color-primary-deep: ${primaryDeep}`,
    `--color-primary-ink: ${primaryInk}`,
    `--color-primary-ink-2: ${primaryInk2}`,
    `--color-primary-soft: ${withAlpha(p, dark ? 0.24 : 0.12)}`,
    `--color-primary-shadow: ${withAlpha(p, dark ? 0.45 : 0.32)}`,
    `--color-accent: ${accent}`,
    `--color-bg: ${bg}`,
    `--color-bg-elevated: ${bgElevated}`,
    `--color-bg-soft: ${bgSoft}`,
    `--color-card: ${card}`,
    `--color-text: ${text}`,
    `--color-text-soft: ${textSoft}`,
    `--color-text-mute: ${textMute}`,
    `--color-border: ${border}`,
    `--color-overlay: ${dark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(15, 23, 42, 0.45)'}`,
    // 注意：不能写 var(--color-primary) 内嵌变量 —— WXSS 嵌套 var() 在声明处解析，
    // 会导致激活态胶囊/按钮恒为默认紫色。此处直接写入计算后的实色。
    `--gradient-primary: linear-gradient(135deg, ${p} 0%, ${primaryDeep} 100%)`,
    `--gradient-hero: ${buildHeroGradient(p)}`
  ];

  if (dark) {
    lines.push(
      `--shadow-md: 0 4px 16px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.2)`,
      `--shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3)`
    );
  }

  void dir; // 预留
  return lines.join('; ');
}

/* ============ 主题状态（页面渲染统一入口） ============ */

export interface ThemeState {
  /** 当前主题 key */
  theme: ThemeKey;
  /** inline CSS 变量串（仅 custom 主题非空），绑定到根 wrapper 的 style */
  themeStyle: string;
  /** hero 渐变背景 */
  heroGradient: string;
  /** 主题名 */
  themeName: string;
  /** 是否深色外观（用于导航栏前景色判断） */
  dark: boolean;
  /** 页面背景色（用于导航栏背景同步） */
  navBg: string;
  /** 电影级舞台背景模式（sunset/aurora/stardust/grid/ink/none） */
  fxMode: string;
  /** 舞台背景强度 0~10 */
  fxLevel: number;
  /** 舞台场景图路径（非空时铺真实照片背景） */
  fxSrc: string;
  /** 场景图是否全屏（true=全屏照片；false=顶部横幅渐隐） */
  fxFull: boolean;
  /** 场景照片背景样式（base64 数据 URI，绑到页面根容器 style，真机保证渲染） */
  bgStyle: string;
}

/**
 * 每套主题的「电影级舞台背景」配方：fx-stage 模式 + 强度。
 * 切主题时首页/工具页的整套氛围背景随之切换——一风格一场景：
 *   sunset    程序化暮色湖景（天空→落日→远山→水面金光）
 *   clean     极简玻璃球（左上空气光晕）
 *   grid      暗星行星 + 霓虹网格地平线（深色科技）
 *   meadow    暖阳黄绿山丘（治愈插画）
 *   eclipse   黑金星云日食（暗黑渐变）
 *   confetti  彩纸胶囊彩点（潮流多彩）
 *   polaroid  倾斜拍立得相纸（复古怀旧）
 *   leafshade 低饱和叶影（莫兰迪）
 *   aurora    幻彩渐变球 + 极光雾（玻璃拟态）
 *   ink       墨圈 + 远山 + 竹枝（国风水墨）
 *   pixelcamp 像素月亮星星 + 草地篝火（游戏像素）
 *   stardust  星尘夜空（侘寂深色系）
 *   none      关闭（纯净）
 */
export const THEME_FX: Record<ThemeKey, { mode: string; level: number; src?: string; full?: boolean }> = {
  // —— 原有侘寂系 ——
  light: { mode: 'sunset', level: 10, src: '/assets/scenes/dusk-full.jpg', full: true }, // 暮金夜色：全屏湖景照片
  dark: { mode: 'stardust', level: 6 },  // 墨韵深炭：星尘夜空
  rose: { mode: 'stardust', level: 7 },  // 深邃暗夜：更浓的星尘
  forest: { mode: 'meadow', level: 8 },  // 自然森系：暖阳黄绿山丘（森林/湖光自然感）
  twilight: { mode: 'sunset', level: 5 },// 暮金旧纸：低强度暖暮
  scarlet: { mode: 'aurora', level: 6 }, // 艳红绯纸：绯色流彩
  jade: { mode: 'aurora', level: 4 },    // 翠玉青瓷：青色微光
  indigo: { mode: 'stardust', level: 5 },// 靛蓝夜航：夜空星尘
  // —— 十大风格（对齐效果图一风格一场景图） ——
  minimal: { mode: 'clean', level: 10, src: '/assets/scenes/minimal.jpg' },
  tech: { mode: 'grid', level: 10, src: '/assets/scenes/tech.jpg' },
  healing: { mode: 'meadow', level: 10, src: '/assets/scenes/healing.jpg' },
  noir: { mode: 'eclipse', level: 10, src: '/assets/scenes/noir.jpg' },
  candy: { mode: 'confetti', level: 10, src: '/assets/scenes/candy.jpg' },
  retro: { mode: 'polaroid', level: 10, src: '/assets/scenes/retro.jpg' },
  morandi: { mode: 'leafshade', level: 10, src: '/assets/scenes/morandi.jpg' },
  aurora: { mode: 'aurora', level: 10, src: '/assets/scenes/aurora.jpg' },
  ink: { mode: 'ink', level: 10, src: '/assets/scenes/ink.jpg' },
  pixel: { mode: 'pixelcamp', level: 10, src: '/assets/scenes/pixel.jpg' },
  // 液态金属：全屏上海日景照片（明亮通透），配白纱压幕（见 buildSceneBgStyle）
  liquid: { mode: 'clean', level: 10, src: '/assets/scenes/liquid.jpg', full: true },
  // 深海蓝金：城市天际线场景（陆家嘴 + 黄浦江倒影 + 蓝金黄昏）——背景即「上海」环境
  deepsea: { mode: 'sunset', level: 10, src: '/assets/scenes/shanghai.jpg', full: true },
  // 求职工作台：与 deepsea 同款上海天际线（秋招助手首屏的城市语境），fx 仅主包页面消费
  career: { mode: 'sunset', level: 10, src: '/assets/scenes/shanghai.jpg', full: true },
  custom: { mode: 'aurora', level: 5 }   // 自定义：默认极光（dark 时下方覆盖为星尘）
};

const THEME_DARK: ThemeKey[] = ['light', 'dark', 'rose', 'tech', 'noir', 'pixel', 'deepsea', 'career']; // light 槽位已改造为深色「暮金夜色」
const THEME_BG: Record<ThemeKey, string> = {
  light: '#15110D',
  dark: '#2C2823',
  rose: '#0C1017',
  forest: '#EAF1E9',
  twilight: '#F1EDE2',
  scarlet: '#F4E9E2',
  jade: '#E8EFE9',
  indigo: '#E9EBF2',
  // 十大风格导航栏底色
  minimal: '#F7F8FA',
  tech: '#0A1220',
  healing: '#FBEFD8',
  noir: '#141210',
  candy: '#FDF7FB',
  retro: '#EFE6D4',
  morandi: '#EDEBE6',
  aurora: '#F2F0FC',
  ink: '#F5F2EA',
  pixel: '#191D2B',
  liquid: '#EEF1F5',
  deepsea: '#08111F', // 深海蓝黑（导航栏与页面底色，与城市天空衔接）
  career: '#07152D',  // 求职工作台深蓝（导航栏与页面底色，与秋招助手 Dashboard 衔接）
  custom: '#F0EDE6' // 实际值在 custom 分支动态计算
};

/**
 * 由场景图 id 生成页面根容器的背景样式（base64 数据 URI，真机保证渲染）。
 * 结构：顶部压暗渐变（保证导航/标题可读） + 底部淡入页面底色（消除 100vh 处硬边） + 照片。
 * 不用 position:fixed / <image> —— 组件内 fixed 在 glass-easel + iOS 真机下会「加载成功但不绘制」。
 */
function buildSceneBgStyle(sceneId: string, pageBg: string, lightScrim?: boolean): string {
  const uri = SCENE_BG[sceneId];
  if (!uri) return '';
  // 压暗幕：顶部最重（保证导航/标题可读），中段维持约 1/4 的薄纱
  // （筛选胶囊、列表小字都落在这一带，需要一层深色床），底部淡出到页面底色。
  // 总压暗控制在 25%~40%，照片本身仍然清晰可见。
  // lightScrim=true（明亮日景如 liquid）：改用白纱——深色幕会把明亮照片压灰发闷，
  // 白纱既保住日景的通透感，又给浅底深字的界面留出可读层。
  const scrim = lightScrim
    ? 'linear-gradient(180deg, rgba(255,255,255,.56) 0%, rgba(255,255,255,.38) 14%,' +
      'rgba(255,255,255,.34) 34%, rgba(255,255,255,.28) 54%, rgba(255,255,255,.16) 72%,' +
      `rgba(255,255,255,0) calc(100vh - 220rpx), ${pageBg} 100vh)`
    : 'linear-gradient(180deg, rgba(0,0,0,.42) 0%, rgba(0,0,0,.26) 14%,' +
      'rgba(0,0,0,.30) 34%, rgba(0,0,0,.24) 54%, rgba(0,0,0,.12) 72%,' +
      `rgba(0,0,0,0) calc(100vh - 220rpx), ${pageBg} 100vh)`;
  return (
    'background-image:' +
    scrim +
    `, url(${uri});` +
    'background-size:100vw 100vh, 100vw 100vh;' +
    'background-position:top left, top left;' +
    'background-repeat:no-repeat, no-repeat;'
  );
}

/** 读取当前完整主题状态（每次从 storage 现取，保证跨页面同步） */
export function getThemeState(): ThemeState {
  let key: ThemeKey = 'light';
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    if (typeof v === 'string' && v in THEMES) key = v as ThemeKey;
  } catch (_e) {
    /* 忽略 */
  }

  if (key === 'custom') {
    const custom = loadCustomTheme();
    const bg = custom.bg || (custom.dark ? '#2C2823' : '#F0EDE6');
    const fx = custom.dark
      ? { mode: 'stardust', level: 6 }
      : { mode: 'aurora', level: 5 };
    return {
      theme: 'custom',
      themeStyle: buildCustomVars(custom),
      heroGradient: buildHeroGradient(custom.primary),
      themeName: `自定义 · ${custom.primary}`,
      dark: !!custom.dark,
      navBg: bg,
      fxMode: fx.mode,
      fxLevel: fx.level,
      fxSrc: '',
      fxFull: false,
      bgStyle: ''
    };
  }

  const t = THEMES[key] || THEMES.light;
  const fx = THEME_FX[key] || THEME_FX.light;
  // fx.src 现在只作场景 id（/assets/scenes/dusk-full.jpg → dusk-full），图片本体走 SCENE_BG base64
  const sceneId = (fx.src || '').split('/').pop()!.replace(/\.jpg$/, '');
  const bgStyle = buildSceneBgStyle(sceneId, THEME_BG[key] || THEME_BG.light, key === 'liquid');
  return {
    theme: key,
    themeStyle: '',
    heroGradient: t.heroGradient,
    themeName: t.name,
    dark: THEME_DARK.indexOf(key) >= 0,
    navBg: THEME_BG[key] || THEME_BG.light,
    fxMode: fx.mode,
    fxLevel: fx.level,
    fxSrc: fx.src || '',
    fxFull: !!fx.full,
    bgStyle
  };
}

/**
 * 秋招助手子包专用：固定返回「求职工作台」主题态。
 * 产品定位上秋招助手是独立的深蓝 AI 工作台（专业招聘 Copilot 气质），
 * 不随全局主题漂移 —— 用户即使全局用浅色主题，进入秋招也保持同一套工作台视觉。
 */
export function getCareerState(): ThemeState {
  const t = THEMES.career;
  const fx = THEME_FX.career;
  return {
    theme: 'career',
    themeStyle: '',
    heroGradient: t.heroGradient,
    themeName: t.name,
    dark: true,
    navBg: THEME_BG.career,
    fxMode: fx.mode,
    fxLevel: fx.level,
    fxSrc: fx.src || '',
    fxFull: !!fx.full,
    bgStyle: ''
  };
}

/** 读取本地主题 key，默认浅色 */
export function loadTheme(): ThemeKey {
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    if (typeof v === 'string' && v in THEMES) return v as ThemeKey;
  } catch (_e) {
    /* 忽略 */
  }
  return 'light';
}

/**
 * 上一次已应用的导航栏配色。
 * wx.setNavigationBarColor 是一次原生桥调用，会触发导航栏重绘；
 * 而每个页面 onLoad/onShow 都会调它，主题没变时这次调用纯属浪费，
 * 也是切页时「闷一下」的来源之一。这里做结果去重，配色没变就不再下发。
 */
let lastNavKey = '';

/** 同步当前页面导航栏颜色（frontColor 仅支持黑/白两种） */
export function syncNavBar(state?: ThemeState): void {
  const s = state || getThemeState();
  const frontColor = s.dark ? '#ffffff' : '#000000';
  const backgroundColor = s.navBg;
  const key = frontColor + '|' + backgroundColor;
  if (key === lastNavKey) return; // 配色未变，跳过原生调用
  lastNavKey = key;
  try {
    wx.setNavigationBarColor({
      frontColor,
      backgroundColor,
      fail: () => {
        // 下发失败（多为页面隐藏中）：清掉缓存，下次 onShow 再试一次
        if (lastNavKey === key) lastNavKey = '';
      }
    });
  } catch (_e) {
    if (lastNavKey === key) lastNavKey = '';
  }
}

/** 持久化主题 key 并同步 globalData（页面渲染由各页 onShow 调 getThemeState 完成） */
export function applyTheme(key: ThemeKey): ThemeState {
  try {
    wx.setStorageSync(STORAGE_KEY, key);
  } catch (_e) {
    /* 忽略 */
  }
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.theme = key;
    if (key === 'custom') app.globalData.customTheme = loadCustomTheme();
  }
  const state = getThemeState();
  syncNavBar(state);
  return state;
}

/**
 * 更新自定义主题颜色并立即生效（合并保存 + 切到 custom 主题）。
 * 返回最新主题状态，调用方直接 setData 即可实现「无刷新实时预览」。
 */
export function applyCustomTheme(patch: Partial<ICustomTheme>): ThemeState {
  const next: ICustomTheme = { ...loadCustomTheme(), ...patch };
  saveCustomTheme(next);
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.customTheme = next;
  }
  return applyTheme('custom');
}

/** 兼容旧调用：给当前页面 data 设置 theme + heroGradient 用的辅助 */
export function decorateTheme(key: ThemeKey): { theme: ThemeKey; heroGradient: string; themeName: string } {
  const state = getThemeState();
  return { theme: state.theme, heroGradient: state.heroGradient, themeName: state.themeName };
}
