// utils/love-skin.ts
// 爱遇小栈 · 皮肤系统
//
// 为什么不在 WXSS 里写死颜色、也不依赖全局主题：
//  1) 这是一个「私密小屋」性质的模块，用户需要的是**自成一套氛围**，
//     而不是跟着待办清单的 12 套主题一起变（跟着变会让私密感消失）；
//  2) 皮肤要能一键换、实时预览、可记忆，最稳的做法是把整套配色
//     作为 CSS 变量**内联注入到页面根节点**（与全局主题 themeStyle 同手法），
//     WXSS 里所有颜色写 var(--ay-xxx, 兜底)，切换皮肤只需改 data-skin + style；
//  3) 不依赖属性选择器，glass-easel / Skyline / WebView 三端表现一致。
//
// 九套皮肤按当代年轻女孩的主流审美分了四个取向：
//  梦幻夜（dream）· 奶油甜（peach / strawberry / caramel）· 梦幻 Y2K（lilac / aurora）
//  清爽盐系（mint / sakura）· 甜酷暗夜（berry）
import type { SkinKey } from './love-types';

export interface SkinDef {
  key: SkinKey;
  name: string;
  /** 一句话人设，用来帮用户「凭感觉选」 */
  tag: string;
  emoji: string;
  /** 取向标签，用于分类展示 */
  family: '奶油甜' | '梦幻系' | '清爽盐' | '甜酷暗';
  /** 是否深色（影响文字色与导航栏前景） */
  dark: boolean;
  /** 预览色卡（两色） */
  swatch: [string, string];
  vars: Record<string, string>;
}

/** 每套皮肤必须给全的变量（漏一个就会露出兜底色，很显眼） */
const VAR_KEYS = [
  'bg', 'bg2', 'card', 'card-soft', 'primary', 'primary-2', 'accent',
  'text', 'sub', 'faint', 'line', 'hero', 'shadow', 'chip', 'nav',
  /* 可选的氛围变量：不给就用兜底（星空 / 星尘层 / 玻璃卡描边） */
  'sky', 'bokeh', 'cardline'
];

export const SKINS: SkinDef[] = [
  {
    key: 'dream',
    name: '星梦夜曲',
    tag: '深夜星空下的一间玻璃小屋',
    emoji: '🌌',
    family: '梦幻系',
    dark: true,
    swatch: ['#B79CFF', '#FF9FCB'],
    vars: {
      bg: '#151B36', bg2: '#221D48',
      /* 玻璃拟态：半透明卡面 + 白描边，让星空从卡片后透出来 */
      card: 'rgba(255,255,255,0.10)', 'card-soft': 'rgba(255,255,255,0.06)',
      primary: '#B79CFF', 'primary-2': '#FF9FCB', accent: '#F6D89B',
      text: '#F3F0FF', sub: '#C6BFE8', faint: '#8F88B8',
      line: 'rgba(255,255,255,0.14)',
      hero: 'linear-gradient(135deg,#8D7BFF 0%,#B79CFF 45%,#FF9FCB 100%)',
      shadow: 'rgba(9,12,34,0.5)', chip: 'rgba(255,255,255,0.10)',
      nav: '#151B36',
      /* 深夜：午夜蓝打底 + 紫/粉/香槟三团柔光（bokeh 感） */
      sky: 'radial-gradient(820rpx 560rpx at 88% -6%, rgba(141,123,255,0.38) 0%, rgba(141,123,255,0) 62%),'
        + 'radial-gradient(680rpx 480rpx at -12% 16%, rgba(255,159,203,0.22) 0%, rgba(255,159,203,0) 58%),'
        + 'radial-gradient(760rpx 540rpx at 52% 112%, rgba(246,216,155,0.12) 0%, rgba(246,216,155,0) 60%),'
        + 'linear-gradient(180deg,#18234A 0%,#1C1A40 52%,#281C48 100%)',
      /* 星尘：大小不一的光点 + 两颗亮星 */
      bokeh: 'radial-gradient(4rpx 4rpx at 14% 7%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 100%),'
        + 'radial-gradient(3rpx 3rpx at 32% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 100%),'
        + 'radial-gradient(3rpx 3rpx at 58% 9%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 74% 22%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 100%),'
        + 'radial-gradient(3rpx 3rpx at 88% 34%, rgba(255,214,235,0.55) 0%, rgba(255,214,235,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 22% 36%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 46% 30%, rgba(214,196,255,0.45) 0%, rgba(214,196,255,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 66% 46%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 9% 58%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 81% 66%, rgba(255,214,235,0.35) 0%, rgba(255,214,235,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 38% 74%, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 92% 84%, rgba(214,196,255,0.35) 0%, rgba(214,196,255,0) 100%),'
        + 'radial-gradient(2rpx 2rpx at 17% 90%, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 100%)',
      cardline: 'rgba(255,255,255,0.16)'
    }
  },
  {
    key: 'peach',
    name: '蜜桃奶霜',
    tag: '软软的，像被喜欢的人摸了摸头',
    emoji: '🍑',
    family: '奶油甜',
    dark: false,
    swatch: ['#FF9FB2', '#FFC2A1'],
    vars: {
      bg: '#FFF6F3', bg2: '#FFECE7', card: '#FFFFFF', 'card-soft': '#FFF1EC',
      primary: '#FF7F9C', 'primary-2': '#FFB199', accent: '#FFC77D',
      text: '#4A3238', sub: '#8A6E74', faint: '#B79AA1', line: '#F8E3DC',
      hero: 'linear-gradient(135deg,#FF9FB2 0%,#FFB199 55%,#FFD3A1 100%)',
      shadow: 'rgba(255,127,156,0.16)', chip: '#FFECE6', nav: '#FF9FB2'
    }
  },
  {
    key: 'lilac',
    name: '星河紫梦',
    tag: 'Y2K 梦核，紫到会发光',
    emoji: '🔮',
    family: '梦幻系',
    dark: false,
    swatch: ['#8B6FE8', '#C79BFF'],
    vars: {
      bg: '#F7F4FF', bg2: '#EDE6FF', card: '#FFFFFF', 'card-soft': '#F2EDFF',
      primary: '#8B6FE8', 'primary-2': '#B79BFF', accent: '#FF9BD2',
      text: '#332B4D', sub: '#6F648F', faint: '#A79CC4', line: '#E8E1FA',
      hero: 'linear-gradient(135deg,#8B6FE8 0%,#B79BFF 55%,#FF9BD2 100%)',
      shadow: 'rgba(139,111,232,0.18)', chip: '#EFE9FF', nav: '#8B6FE8'
    }
  },
  {
    key: 'mint',
    name: '薄荷气泡',
    tag: '清醒又甜，像第一口汽水',
    emoji: '🫧',
    family: '清爽盐',
    dark: false,
    swatch: ['#2FB8A0', '#7FDCC4'],
    vars: {
      bg: '#F1FBF9', bg2: '#E4F7F2', card: '#FFFFFF', 'card-soft': '#E9F7F3',
      primary: '#2FB8A0', 'primary-2': '#7FDCC4', accent: '#FFC96B',
      text: '#23423D', sub: '#5F8079', faint: '#9BB6B0', line: '#DCEEE9',
      hero: 'linear-gradient(135deg,#2FB8A0 0%,#7FDCC4 60%,#BFF0E4 100%)',
      shadow: 'rgba(47,184,160,0.16)', chip: '#E6F7F2', nav: '#2FB8A0'
    }
  },
  {
    key: 'sakura',
    name: '樱雾灰粉',
    tag: '莫兰迪高级感，安静地漂亮',
    emoji: '🌸',
    family: '清爽盐',
    dark: false,
    swatch: ['#C98C97', '#DDB3AE'],
    vars: {
      bg: '#F8F5F5', bg2: '#F0EAEC', card: '#FFFFFF', 'card-soft': '#F5EFEF',
      primary: '#C98C97', 'primary-2': '#DDB3AE', accent: '#A8929B',
      text: '#453B3E', sub: '#7E6E71', faint: '#AB9C9F', line: '#EBE2E4',
      hero: 'linear-gradient(135deg,#C98C97 0%,#DDB3AE 55%,#EFDCD8 100%)',
      shadow: 'rgba(201,140,151,0.14)', chip: '#F3EAEB', nav: '#C98C97'
    }
  },
  {
    key: 'berry',
    name: '甜酷黑莓',
    tag: '夜里会发光的甜酷女孩',
    emoji: '🖤',
    family: '甜酷暗',
    dark: true,
    swatch: ['#FF6BA8', '#B06BFF'],
    vars: {
      bg: '#191220', bg2: '#241A2E', card: '#2A2035', 'card-soft': '#342845',
      primary: '#FF6BA8', 'primary-2': '#B06BFF', accent: '#FFD36B',
      text: '#F7EFF9', sub: '#C6B5D1', faint: '#9C8BAA', line: '#3B2F49',
      hero: 'linear-gradient(135deg,#FF6BA8 0%,#B06BFF 100%)',
      shadow: 'rgba(255,107,168,0.24)', chip: '#352A44', nav: '#241A2E'
    }
  },
  {
    key: 'caramel',
    name: '焦糖奶咖',
    tag: '暖乎乎的秋冬限定',
    emoji: '🍮',
    family: '奶油甜',
    dark: false,
    swatch: ['#C08154', '#E0AA7C'],
    vars: {
      bg: '#FBF5EE', bg2: '#F5E9DC', card: '#FFFFFF', 'card-soft': '#F8EDE1',
      primary: '#C08154', 'primary-2': '#E0AA7C', accent: '#8C6A4F',
      text: '#4A3728', sub: '#866A55', faint: '#B09A87', line: '#F0E2D3',
      hero: 'linear-gradient(135deg,#C08154 0%,#E0AA7C 60%,#F0D3B4 100%)',
      shadow: 'rgba(192,129,84,0.16)', chip: '#F7E9DA', nav: '#C08154'
    }
  },
  {
    key: 'aurora',
    name: '极光幻彩',
    tag: '多巴胺开到最大，今天不低调',
    emoji: '🌈',
    family: '梦幻系',
    dark: false,
    swatch: ['#5AC8FA', '#FF7EB6'],
    vars: {
      bg: '#F5FBFF', bg2: '#EAF4FF', card: '#FFFFFF', 'card-soft': '#EEF7FF',
      primary: '#4FB8F0', 'primary-2': '#A78BFA', accent: '#FF7EB6',
      text: '#2C3A4A', sub: '#63758A', faint: '#9AA9BC', line: '#E3EEF7',
      hero: 'linear-gradient(120deg,#5AC8FA 0%,#A78BFA 48%,#FF7EB6 100%)',
      shadow: 'rgba(90,200,250,0.16)', chip: '#EAF4FF', nav: '#4FB8F0'
    }
  },
  {
    key: 'strawberry',
    name: '草莓牛乳',
    tag: '少女心不加掩饰，甜就甜到底',
    emoji: '🍓',
    family: '奶油甜',
    dark: false,
    swatch: ['#FF6E8A', '#FFC2CE'],
    vars: {
      bg: '#FFF5F7', bg2: '#FFE8ED', card: '#FFFFFF', 'card-soft': '#FFEDF1',
      primary: '#FF5C7C', 'primary-2': '#FF9FB2', accent: '#7FC8A9',
      text: '#4A2F36', sub: '#8C6873', faint: '#B8919C', line: '#FBE0E6',
      hero: 'linear-gradient(135deg,#FF6E8A 0%,#FF9FB2 55%,#FFD1DA 100%)',
      shadow: 'rgba(255,92,124,0.16)', chip: '#FFEAEF', nav: '#FF6E8A'
    }
  }
];

const SKIN_MAP: Record<string, SkinDef> = {};
SKINS.forEach((s) => { SKIN_MAP[s.key] = s; });

export const DEFAULT_SKIN: SkinKey = 'dream';

export function getSkin(key: string): SkinDef {
  return SKIN_MAP[key] || SKIN_MAP[DEFAULT_SKIN];
}

/**
 * 把皮肤变量展开成内联 style 串。
 * 输出形如 `--ay-bg:#FFF6F3;--ay-primary:#FF7F9C;...`，绑到页面根节点。
 */
export function buildSkinStyle(key: string): string {
  const skin = getSkin(key);
  const parts: string[] = [];
  VAR_KEYS.forEach((k) => {
    const v = skin.vars[k];
    if (v) parts.push(`--ay-${k}:${v}`);
  });
  // 深色皮肤额外给一个开关变量，供个别需要硬编码的场景使用
  parts.push(`--ay-dark:${skin.dark ? 1 : 0}`);
  return parts.join(';');
}

/** 皮肤是否深色（决定导航栏前景色） */
export function isDarkSkin(key: string): boolean {
  return getSkin(key).dark;
}

/** 皮肤取向分组，皮肤中心按组展示 */
export function skinFamilies(): { family: string; skins: SkinDef[] }[] {
  const order: SkinDef['family'][] = ['奶油甜', '梦幻系', '清爽盐', '甜酷暗'];
  return order.map((f) => ({ family: f, skins: SKINS.filter((s) => s.family === f) }));
}
