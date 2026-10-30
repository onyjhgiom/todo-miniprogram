// pages/guaxiang/library.ts
// 六十四卦速查：宫格列出全部卦象，点击查看详情（跳转 index?num=N）
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { DISCLAIMER_FULL } from '../../utils/folklore';
import { HEXAGRAMS } from '../../utils/guaxiang-data';
import { hexNature } from '../../utils/guaxiang';
import type { ThemeKey } from '../../../../types/index';
import { go } from '../../../../utils/nav';

interface LibItem {
  num: number;
  name: string;
  fullName: string;
  nature: string;
}

interface LibraryData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  all: LibItem[];
  list: LibItem[];
  keyword: string;
  disclaimer: string;
}

Page<LibraryData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    all: [],
    list: [],
    keyword: '',
    disclaimer: DISCLAIMER_FULL
  },

  onLoad() {
    const all: LibItem[] = HEXAGRAMS.map((h) => {
      const n = hexNature(h);
      return {
        num: h.num,
        name: h.name,
        fullName: h.fullName,
        nature: `上${n.upper}下${n.lower}`
      };
    });
    this.setData({ all, list: all });
    this.applyTheme();
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  onSearch(e: WechatMiniprogram.InputEvent) {
    const kw = (e.detail.value || '').trim();
    this.setData({ keyword: kw }, () => this.applyFilter());
  },

  onClearSearch() {
    this.setData({ keyword: '' }, () => this.applyFilter());
  },

  applyFilter() {
    const kw = this.data.keyword;
    if (!kw) {
      this.setData({ list: this.data.all });
      return;
    }
    const list = this.data.all.filter(
      (i) => i.name.indexOf(kw) >= 0 || i.fullName.indexOf(kw) >= 0 || String(i.num) === kw
    );
    this.setData({ list });
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const num = e.currentTarget.dataset.num;
    if (!num) return;
    go(`/subpackages/tools/pages/guaxiang/index?num=${num}`);
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '六十四卦速查｜传统哲学文化科普', path: '/subpackages/tools/pages/guaxiang/library' };
  }
});
