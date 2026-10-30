// components/theme-switcher/theme-switcher.ts
// 18 套预设主题 + 自定义颜色主题的选择器（预览卡片式）
// 每张卡片 = 迷你界面预览（渐变底 + 迷你卡片/胶囊） + 风格名 + 标语 + 配色圆点，
// 对齐用户效果图「十宫格风格选择」的呈现方式。
// 点击仅派发 change 事件，由 settings 页直接换色。
import { loadCustomTheme, buildHeroGradient } from '../../utils/theme';
import type { ThemeKey } from '../../types/index';

interface ThemeDisplay {
  key: ThemeKey;
  /** 风格名（如「极简白」） */
  name: string;
  /** 一句话标语（如「清新简约」） */
  tag: string;
  /** 预览屏背景（渐变） */
  bg: string;
  /** 预览屏内迷你元素的强调色 */
  chip: string;
  /** 预览屏内迷你元素的次级色 */
  line: string;
  /** 底部配色圆点（3 个） */
  dots: string[];
}

const THEME_DISPLAY: ThemeDisplay[] = [
  // ===== 十大风格（效果图顺序） =====
  {
    key: 'minimal', name: '极简白', tag: '清新简约 · 专注效率',
    bg: 'linear-gradient(180deg, #FFFFFF 0%, #EDF1F6 100%)',
    chip: '#3B82F6', line: '#D6DEE8',
    dots: ['#3B82F6', '#93C5FD', '#1F2430']
  },
  {
    key: 'tech', name: '深色', tag: '科技未来 · 沉浸夜阑',
    bg: 'linear-gradient(180deg, #12233D 0%, #0A1220 100%)',
    chip: '#38BDF8', line: '#1E3A5F',
    dots: ['#38BDF8', '#22D3EE', '#0A1220']
  },
  {
    key: 'healing', name: '治愈插画', tag: '手绘风 · 温暖治愈',
    bg: 'linear-gradient(180deg, #FBEFD8 0%, #FDF6EA 100%)',
    chip: '#E8945A', line: '#EAD9B8',
    dots: ['#E8945A', '#F2C94C', '#8FBF9F']
  },
  {
    key: 'noir', name: '暗黑渐变', tag: '高级质感 · 低调奢华',
    bg: 'linear-gradient(180deg, #241E14 0%, #141210 100%)',
    chip: '#C9A25E', line: '#3A3226',
    dots: ['#C9A25E', '#8C6239', '#141210']
  },
  {
    key: 'candy', name: '潮流多彩', tag: '活力年轻 · 灵动个性',
    bg: 'linear-gradient(135deg, #FBC7E0 0%, #DDD1FE 100%)',
    chip: '#EC4899', line: '#FBBF24',
    dots: ['#EC4899', '#FBBF24', '#8B5CF6']
  },
  {
    key: 'retro', name: '复古怀旧', tag: '质感胶片 · 时光沉淀',
    bg: 'linear-gradient(180deg, #E2D3B4 0%, #EFE6D4 100%)',
    chip: '#8C6239', line: '#C9B68F',
    dots: ['#8C6239', '#B08D57', '#46301A']
  },
  {
    key: 'morandi', name: '莫兰迪', tag: '优雅柔和 · 高级温柔',
    bg: 'linear-gradient(180deg, #DCD8CE 0%, #EDEBE6 100%)',
    chip: '#8A9B8E', line: '#C5C1B5',
    dots: ['#8A9B8E', '#B5A896', '#6E6C64']
  },
  {
    key: 'aurora', name: '动态渐变', tag: '玻璃拟态 · 现代梦幻',
    bg: 'linear-gradient(135deg, #C7B8FF 0%, #9FDCFF 100%)',
    chip: '#7C5CFC', line: '#E6E1FF',
    dots: ['#7C5CFC', '#38BDF8', '#A855F7']
  },
  {
    key: 'ink', name: '国风水墨', tag: '东方美学 · 意境悠远',
    bg: 'linear-gradient(180deg, #FBF9F2 0%, #E7E3D3 100%)',
    chip: '#4E6157', line: '#C2BFA9',
    dots: ['#4E6157', '#B5544A', '#8C948B']
  },
  {
    key: 'pixel', name: '游戏像素', tag: '趣味互动 · 像素世界',
    bg: 'linear-gradient(180deg, #262C48 0%, #191D2B 100%)',
    chip: '#FFC53D', line: '#323A5C',
    dots: ['#FFC53D', '#FF6B9D', '#4ADE80']
  },
  {
    key: 'liquid', name: '液态金属', tag: '未来极简 · 精密冷感',
    bg: 'linear-gradient(135deg, #E4E9F1 0%, #C9D2DE 100%)',
    chip: '#5B7CC4', line: '#AEB9CC',
    dots: ['#5B7CC4', '#AEB9CC', '#3E5BA0']
  },
  {
    key: 'deepsea', name: '深海蓝金', tag: '上海蓝金 · 城市沉浸',
    bg: 'linear-gradient(165deg, #08111F 0%, #16305A 58%, #8A6A3A 100%)',
    chip: '#D3AC74', line: '#1C3352',
    dots: ['#4C7DE0', '#D3AC74', '#EDF2FA']
  },
  // ===== 原有侘寂系主题 =====
  {
    key: 'light', name: '暮金夜色', tag: '琥珀暮晖 · 沉浸夜阑',
    bg: 'linear-gradient(180deg, #3D2C18 0%, #15110D 100%)',
    chip: '#E2B273', line: '#4A3B22',
    dots: ['#E2B273', '#6B4A26', '#15110D']
  },
  {
    key: 'dark', name: '墨韵深炭', tag: '暖炭陶调 · 沉稳耐看',
    bg: 'linear-gradient(180deg, #45403A 0%, #2C2823 100%)',
    chip: '#D89A6A', line: '#4A443C',
    dots: ['#D89A6A', '#96573A', '#2C2823']
  },
  {
    key: 'rose', name: '深邃暗夜', tag: '冷蓝夜空 · 冷静专注',
    bg: 'linear-gradient(180deg, #1B2743 0%, #0C1017 100%)',
    chip: '#6F84CE', line: '#262F3E',
    dots: ['#6F84CE', '#3B4A7E', '#0C1017']
  },
  {
    key: 'forest', name: '自然森系', tag: '森林绿意 · 自然治愈',
    bg: 'linear-gradient(135deg, #DCE8DB 0%, #EAF1E9 100%)',
    chip: '#3F7A52', line: '#D5E2D4',
    dots: ['#3F7A52', '#7FA8C9', '#AECDB0']
  },
  {
    key: 'twilight', name: '暮金旧纸', tag: '旧金宣纸 · 温润雅致',
    bg: 'linear-gradient(180deg, #E5DBBF 0%, #F1EDE2 100%)',
    chip: '#A98743', line: '#D8CCAA',
    dots: ['#A98743', '#D8BC85', '#5D4A25']
  },
  {
    key: 'scarlet', name: '艳红绯纸', tag: '绯红陶土 · 热烈明快',
    bg: 'linear-gradient(180deg, #EFD5C5 0%, #F4E9E2 100%)',
    chip: '#B5502F', line: '#E3C6B4',
    dots: ['#B5502F', '#C08468', '#642C1A']
  },
  {
    key: 'jade', name: '翠玉青瓷', tag: '青瓷玉绿 · 温润如玉',
    bg: 'linear-gradient(180deg, #D8E5DA 0%, #E8EFE9 100%)',
    chip: '#3E6B52', line: '#C2D4C6',
    dots: ['#3E6B52', '#A8CBB2', '#223B2D']
  },
  {
    key: 'indigo', name: '靛蓝夜航', tag: '靛蓝青金 · 静谧深邃',
    bg: 'linear-gradient(180deg, #D5D9E8 0%, #E9EBF2 100%)',
    chip: '#4A5A8C', line: '#C0C6DA',
    dots: ['#4A5A8C', '#A8B4D8', '#29324D']
  }
];

Component({
  properties: {
    current: { type: String, value: 'light' }
  },
  data: {
    themes: THEME_DISPLAY,
    // 自定义主题色板（取当前保存的自定义颜色实时展示）
    customGradient: ''
  },
  lifetimes: {
    attached() {
      this.refreshCustom();
    }
  },
  observers: {
    current() {
      // 主题被外部修改时刷新自定义色板（比如用户改了自定义颜色后回到本组件）
      this.refreshCustom();
    }
  },
  methods: {
    refreshCustom() {
      const custom = loadCustomTheme();
      this.setData({ customGradient: buildHeroGradient(custom.primary) });
    },
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as ThemeKey;
      this.triggerEvent('change', { key });
    }
  }
});
