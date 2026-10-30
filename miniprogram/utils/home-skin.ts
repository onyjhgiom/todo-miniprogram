// utils/home-skin.ts
// 主页「风格 + 背景氛围」双维度皮肤 —— 与全局主题（utils/theme.ts）正交。
//
// 三维职责划分（互相独立，可自由组合）：
//   · 主题 themes       → 决定「颜色」（暖陶侘寂 / 墨韵深炭 / 深邃暗夜 …）
//   · 主页风格 homeStyle → 决定「工艺」（圆角 / 描边 / 阴影形状 / 玻璃质感）
//   · 主页背景 homeBg    → 决定「氛围装饰层」（暖晖光斑 / 极光 / 星尘 / 栅格 / 粒子）
//
// 组合数：9 主题 × 6 风格 × 7 背景 = 378 种，两个维度各自独立持久化。
//
// 落点约定：
//   · 风格：本模块的 key 直接拼成根节点类名 home-style-{{key}}，
//           由 pages/index/index.wxss 的 .themed.home-style-X 覆盖 --home-* / --glass-* /
//           --shadow-* 等 token（只改工艺，不动颜色，故与任意主题兼容）。
//   · 背景：拼成 home-bg-{{key}}，由 index.wxss 驱动 .ambient-layer--{{key}} 装饰层。
//
// ⚠️ 新增/删除一个风格或背景时，必须同步四处（四元组一致性）：
//   ① 本文件的联合类型  ② 本文件的 XXXS 常量数组
//   ③ 选择器 chips      ④ index.wxss 里的 .home-style-X / .ambient-layer--X 规则

export type HomeStyle = 'jicha' | 'frosted' | 'inkwash' | 'brutal' | 'neumorph' | 'retro';
export type HomeBg = 'warm' | 'plain' | 'aurora' | 'nebula' | 'lattice' | 'dots' | 'liquid';

export const HOME_STYLES: HomeStyle[] = ['jicha', 'frosted', 'inkwash', 'brutal', 'neumorph', 'retro'];
export const HOME_BGS: HomeBg[] = ['warm', 'plain', 'aurora', 'nebula', 'lattice', 'dots', 'liquid'];

/** 主页风格选择器（工艺维度） */
export const HOME_STYLE_CHIPS: { key: HomeStyle; name: string; dot: string }[] = [
  { key: 'jicha', name: '侘寂纸感', dot: '#F0EDE6' },
  { key: 'frosted', name: '冰肌玻璃', dot: '#DCE7F2' },
  { key: 'inkwash', name: '水墨宣纸', dot: '#EDEAE2' },
  { key: 'brutal', name: '硬边几何', dot: '#4A443C' },
  { key: 'neumorph', name: '柔光拟物', dot: '#E4E0D8' },
  { key: 'retro', name: '复古套印', dot: '#C08468' }
];

/** 主页背景选择器（氛围维度，与风格独立组合） */
export const HOME_BG_CHIPS: { key: HomeBg; name: string; dot: string }[] = [
  { key: 'warm', name: '暖晖流云', dot: '#D8A05C' },
  { key: 'plain', name: '纯净底色', dot: '#FFFFFF' },
  { key: 'aurora', name: '极光流彩', dot: '#6366F1' },
  { key: 'nebula', name: '星尘夜空', dot: '#22D3EE' },
  { key: 'lattice', name: '月光栅格', dot: '#8FA0B8' },
  { key: 'dots', name: '浮点粒子', dot: '#C084FC' },
  { key: 'liquid', name: '液态琉璃', dot: '#7C9CFF' }
];

const STYLE_KEY = 'home_style';
const BG_KEY = 'home_bg';

const DEFAULT_STYLE: HomeStyle = 'jicha';
const DEFAULT_BG: HomeBg = 'warm';

/** 读取持久化值并校验合法性（脏数据 / 旧版本 key 一律回落默认） */
function readKey<T extends string>(storageKey: string, valid: T[], fallback: T): T {
  try {
    const v = wx.getStorageSync(storageKey) as string;
    if (typeof v === 'string' && valid.indexOf(v as T) >= 0) return v as T;
  } catch (_e) {
    /* 忽略 */
  }
  return fallback;
}

function writeKey(storageKey: string, key: string): void {
  try {
    wx.setStorageSync(storageKey, key);
  } catch (_e) {
    /* 忽略 */
  }
}

export function readHomeStyle(): HomeStyle {
  return readKey<HomeStyle>(STYLE_KEY, HOME_STYLES, DEFAULT_STYLE);
}

export function readHomeBg(): HomeBg {
  return readKey<HomeBg>(BG_KEY, HOME_BGS, DEFAULT_BG);
}

/** 一次读取两个维度（页面 onLoad/onShow 用，避免多次 storage 调用） */
export function readHomeSkin(): { style: HomeStyle; bg: HomeBg } {
  return { style: readHomeStyle(), bg: readHomeBg() };
}

/** 持久化主页风格，返回校验后的最终值（非法输入保持原值不变请自行判断） */
export function applyHomeStyle(key: string): HomeStyle {
  const next = readKey<HomeStyle>(STYLE_KEY, HOME_STYLES, DEFAULT_STYLE);
  if (HOME_STYLES.indexOf(key as HomeStyle) < 0) return next;
  writeKey(STYLE_KEY, key);
  return key as HomeStyle;
}

/** 持久化主页背景氛围 */
export function applyHomeBg(key: string): HomeBg {
  const cur = readHomeBg();
  if (HOME_BGS.indexOf(key as HomeBg) < 0) return cur;
  writeKey(BG_KEY, key);
  return key as HomeBg;
}

/** 名称查询（用于设置页展示当前值） */
export function homeStyleName(key: HomeStyle): string {
  const hit = HOME_STYLE_CHIPS.filter((c) => c.key === key)[0];
  return hit ? hit.name : HOME_STYLE_CHIPS[0].name;
}

export function homeBgName(key: HomeBg): string {
  const hit = HOME_BG_CHIPS.filter((c) => c.key === key)[0];
  return hit ? hit.name : HOME_BG_CHIPS[0].name;
}
