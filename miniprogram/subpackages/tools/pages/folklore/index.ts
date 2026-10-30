// pages/folklore/index.ts
// 国风民俗主页：每日国风雅集（模块1）+ 五大模块入口（模块2-6）+ 底部永久免责
// 视觉：新中式国风重构（深黛蓝舞台 + 宣纸卡 + 鎏金线 + 八卦盘组件），业务逻辑保持不变。
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { getDaily, HOME_MODULES, DailyEntry } from '../../utils/folklore-data';
import { DISCLAIMER_FULL } from '../../utils/folklore';
import type { ThemeKey } from '../../../../types/index';
import { go } from '../../../../utils/nav';

interface IndexData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  daily: DailyEntry | null;
  modules: typeof HOME_MODULES;
  disclaimer: string;
  /** 由当日五行派生的卦象三爻（自下而上，1=阳爻 0=阴爻）与卦名 —— 纯可视化，非测算结果 */
  guaName: string;
  guaLines: number[];
  /** 刷新按钮 loading 态（本地生成本无网络请求，只做防重复点击的视觉反馈） */
  refreshing: boolean;
}

const DAILY_CACHE_KEY = 'folklore_daily';

/**
 * 五行 → 三爻卦（先天取象，传统文化常识映射）：
 *   木-震☳（下阳中阴上阴）火-离☲（阳阴阳）土-坤☷（纯阴）
 *   金-乾☰（纯阳）水-坎☵（阴阳阴）
 * 数组为**自上而下**的显示顺序（传统爻序自下而上，此处已翻转，震卦等不对称卦才正确）。
 * 这只是把当日五行用八卦符号呈现，数据仍来自原 getDaily，不新增任何「测算」。
 */
const WUXING_GUA: Record<string, { name: string; lines: number[] }> = {
  '木': { name: '震', lines: [0, 0, 1] },
  '火': { name: '离', lines: [1, 0, 1] },
  '土': { name: '坤', lines: [0, 0, 0] },
  '金': { name: '乾', lines: [1, 1, 1] },
  '水': { name: '坎', lines: [0, 1, 0] }
};

Page<IndexData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    daily: null,
    modules: HOME_MODULES,
    disclaimer: DISCLAIMER_FULL,
    guaName: '',
    guaLines: [],
    refreshing: false
  },

  onLoad() {
    this.applyTheme();
    this.applyDaily(true);
  },

  onShow() {
    this.applyTheme();
    this.applyDaily(true);
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
    // 国风页视觉主题固定为深黛蓝 + 金字（与页面 json 的初始值一致）；
    // syncNavBar 会按全局主题覆盖导航色，这里把本页改回国风深色，避免白底导航破坏氛围。
    try {
      wx.setNavigationBarColor({
        frontColor: '#ffffff',
        backgroundColor: '#15110D',
        fail: () => { /* 忽略 */ }
      });
    } catch (_e) {
      /* 忽略 */
    }
  },

  /** 每日雅集：按日期生成并缓存（同日复用），支持手动刷新 */
  applyDaily(useCache: boolean) {
    const now = new Date();
    const dateLabel = getDaily(now).dateLabel;
    if (useCache) {
      const cached = wx.getStorageSync(DAILY_CACHE_KEY) as { dateLabel: string; entry: DailyEntry } | '';
      if (cached && cached.dateLabel === dateLabel) {
        this.setDaily(cached.entry);
        return;
      }
    }
    const entry = getDaily(now);
    try {
      wx.setStorageSync(DAILY_CACHE_KEY, { dateLabel, entry });
    } catch (_e) {
      /* 忽略 */
    }
    this.setDaily(entry);
  },

  /** 统一入口：写入当日雅集 + 派生卦爻可视化 */
  setDaily(entry: DailyEntry) {
    const gua = WUXING_GUA[entry.wuxing.element] || { name: '', lines: [] };
    this.setData({
      daily: entry,
      guaName: gua.name,
      guaLines: gua.lines
    });
  },

  onRefreshDaily() {
    // 本地生成、无网络；加 300ms loading 视觉反馈并防重复点击
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    const now = new Date();
    const entry = getDaily(now);
    const dateLabel = entry.dateLabel;
    try {
      wx.setStorageSync(DAILY_CACHE_KEY, { dateLabel, entry });
    } catch (_e) {
      /* 忽略 */
    }
    setTimeout(() => {
      this.setDaily(entry);
      this.setData({ refreshing: false });
    }, 300);
  },

  onOpenModule(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as string;
    if (!type) return;
    go(`/subpackages/tools/pages/folklore/module?type=${type}`);
  },

  /** 卦象：起卦 · 人生疏导 */
  onOpenGuaxiang() {
    go('/subpackages/tools/pages/guaxiang/index');
  },

  /** 卦象：六十四卦速查 */
  onOpenLibrary() {
    go('/subpackages/tools/pages/guaxiang/library');
  },

  /** 卦象：六爻涂爻 · 自画成卦 */
  onOpenDraw() {
    go('/subpackages/tools/pages/guaxiang/draw');
  },

  /** 卦象：每日一卦 · 卦历打卡 */
  onOpenDaily() {
    go('/subpackages/tools/pages/guaxiang/daily');
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '国风卦相｜传统民俗文化科普，仅供娱乐参考',
      path: '/subpackages/tools/pages/folklore/index'
    };
  }
});
