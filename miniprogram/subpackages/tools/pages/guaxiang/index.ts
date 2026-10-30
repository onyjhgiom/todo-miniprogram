// pages/guaxiang/index.ts
// 卦象主页面：起卦（铜钱/数字/时间/随缘）→ 动爻变卦 → 结合心境生成人生疏导
// 支持 ?num=N 直接查看某一卦（卦象速查跳转过来），此时仍可选择心境补充疏导。
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { DISCLAIMER_FULL, DISCLAIMER_SHORT } from '../../utils/folklore';
import {
  CAST_METHODS,
  MOODS,
  CastMethod,
  Mood
} from '../../utils/guaxiang-data';
import {
  castByCoins,
  castByNumbers,
  castByTime,
  castByRandom,
  buildReading,
  buildReadingByNum,
  readingToText,
  CastResult,
  Reading
} from '../../utils/guaxiang';
import type { ThemeKey } from '../../../../types/index';
import { go } from '../../../../utils/nav';

interface HistoryItem {
  num: number;
  name: string;
  ts: number;
}

interface IndexData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  methods: CastMethod[];
  moods: Mood[];
  activeMethod: string;
  activeMethodLabel: string;
  activeMood: string;
  numA: string;
  numB: string;
  reading: Reading | null;
  hasResult: boolean;
  /** 最近一次起卦结果（切换心境时复用） */
  lastCast: CastResult | null;
  /** 直接查看某一卦 */
  readonly: boolean;
  viewNum: number;
  history: HistoryItem[];
  disclaimer: string;
  disclaimerShort: string;
}

const HISTORY_KEY = 'guaxiang_history';
const HISTORY_MAX = 8;

Page<IndexData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    methods: CAST_METHODS,
    moods: MOODS,
    activeMethod: 'coin',
    activeMethodLabel: '铜钱起卦',
    activeMood: '',
    numA: '',
    numB: '',
    reading: null,
    hasResult: false,
    lastCast: null,
    readonly: false,
    viewNum: 0,
    history: [],
    disclaimer: DISCLAIMER_FULL,
    disclaimerShort: DISCLAIMER_SHORT
  },

  onLoad(options: Record<string, string>) {
    this.applyTheme();
    this.loadHistory();
    const num = options && options.num ? parseInt(options.num, 10) : 0;
    if (num >= 1 && num <= 64) {
      this.setData({ readonly: true, viewNum: num }, () => this.rebuild());
      (wx as any).setNavigationBarTitle({ title: '卦象详解' });
    } else {
      (wx as any).setNavigationBarTitle({ title: '起卦·人生疏导' });
    }
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  /* ========== 起卦方式 ========== */
  onMethod(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key) return;
    const method = this.data.methods.find(m => m.key === key);
    this.setData({ activeMethod: key, activeMethodLabel: method?.label || '' });
  },

  onMood(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const next = this.data.activeMood === key ? '' : key;
    this.setData({ activeMood: next }, () => {
      if (this.data.hasResult) this.rebuild();
    });
  },

  onNumA(e: WechatMiniprogram.InputEvent) {
    this.setData({ numA: e.detail.value });
  },

  onNumB(e: WechatMiniprogram.InputEvent) {
    this.setData({ numB: e.detail.value });
  },

  /* ========== 起卦 ========== */
  onCast() {
    const method = this.data.activeMethod;
    let cast: CastResult;
    if (method === 'coin') {
      cast = castByCoins();
    } else if (method === 'number') {
      const a = parseInt(this.data.numA, 10);
      const b = parseInt(this.data.numB, 10);
      if (isNaN(a) || isNaN(b)) {
        wx.showToast({ title: '请先填两个数字', icon: 'none' });
        return;
      }
      cast = castByNumbers(a, b);
    } else if (method === 'time') {
      cast = castByTime(new Date());
    } else {
      cast = castByRandom();
    }
    this.setData({ readonly: false, viewNum: 0, lastCast: cast }, () => this.rebuild(cast));
    this.pushHistory(cast);
  },

  /** 重新生成解读（切换心境或重新起卦） */
  rebuild(cast?: CastResult) {
    const c = cast || this.data.lastCast;
    if (this.data.readonly && this.data.viewNum) {
      this.setData({
        reading: buildReadingByNum(this.data.viewNum, this.data.activeMood),
        hasResult: true
      });
      return;
    }
    if (!c) return;
    this.setData({
      reading: buildReading(c, this.data.activeMood),
      hasResult: true
    });
  },

  /* ========== 历史 ========== */
  loadHistory() {
    try {
      const h = wx.getStorageSync(HISTORY_KEY) as HistoryItem[] | '';
      if (h && Array.isArray(h)) this.setData({ history: h });
    } catch (_e) {
      /* 忽略 */
    }
  },

  pushHistory(cast: CastResult) {
    const r = buildReading(cast);
    const item: HistoryItem = {
      num: r.ben.num,
      name: r.ben.name,
      ts: Date.now()
    };
    const list = [item].concat(
      this.data.history.filter((x) => !(x.num === item.num))
    );
    const next = list.slice(0, HISTORY_MAX);
    this.setData({ history: next });
    try {
      wx.setStorageSync(HISTORY_KEY, next);
    } catch (_e) {
      /* 忽略 */
    }
  },

  onHistory(e: WechatMiniprogram.TouchEvent) {
    const num = parseInt(String(e.currentTarget.dataset.num), 10);
    if (!num) return;
    go(`/subpackages/tools/pages/guaxiang/index?num=${num}`);
  },

  /* ========== 结果操作 ========== */
  onCopy() {
    const r = this.data.reading;
    if (!r) return;
    const text = readingToText(r) + '\n' + DISCLAIMER_SHORT;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  },

  onAgain() {
    this.setData({ activeMood: '' });
    this.onCast();
  },

  onGoLibrary() {
    go('/subpackages/tools/pages/guaxiang/library');
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const r = this.data.reading;
    const title = r
      ? `${r.ben.fullName}｜${DISCLAIMER_SHORT}`
      : `起卦·人生疏导｜${DISCLAIMER_SHORT}`;
    return { title, path: '/subpackages/tools/pages/guaxiang/index' };
  }
});
