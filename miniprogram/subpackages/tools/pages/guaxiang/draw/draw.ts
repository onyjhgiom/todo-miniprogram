// pages/guaxiang/draw/draw.ts
// 六爻涂爻 · 自画成卦：点按六爻切换阴阳实时成卦，标记动爻推演变卦。
// 复用 guaxiang 引擎（buildReading / findByLines / toDisplayLines），纯本地计算，无网络、无隐私采集。
// 合规：只做《周易》哲理科普与互动学习，不预测吉凶、不断言祸福。
import { getThemeState, syncNavBar } from '../../../../../utils/theme';
import { DISCLAIMER_FULL, DISCLAIMER_SHORT } from '../../../utils/folklore';
import { HEXAGRAMS } from '../../../utils/guaxiang-data';
import {
  findByLines,
  buildReading,
  toDisplayLines,
  Reading,
  DisplayLine
} from '../../../utils/guaxiang';
import type { ThemeKey } from '../../../../../types/index';
import { go } from '../../../../../utils/nav';

interface EditRow {
  /** 爻位 1-6（自下而上） */
  pos: number;
  /** 1=阳 0=阴 */
  value: number;
  /** 是否为动爻 */
  moving: boolean;
}

interface DrawData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  lines: number[];          // 自下而上
  editRows: EditRow[];      // 自上而下（用于编辑器渲染）
  moving: number[];
  hasMoving: boolean;
  reading: Reading | null;
  benName: string;
  benNum: number;
  bianName: string;
  bianNum: number;
  bianLines: DisplayLine[];
  disclaimer: string;
  disclaimerShort: string;
}

/** 由 lines/moving 构造自上而下（上爻→初爻）的编辑器行 */
function toEditRows(lines: number[], moving: number[]): EditRow[] {
  const rows: EditRow[] = [];
  for (let pos = 6; pos >= 1; pos--) {
    rows.push({ pos, value: lines[pos - 1], moving: moving.indexOf(pos) >= 0 });
  }
  return rows;
}

Page<DrawData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    lines: [1, 1, 1, 1, 1, 1],
    editRows: [],
    moving: [],
    hasMoving: false,
    reading: null,
    benName: '',
    benNum: 0,
    bianName: '',
    bianNum: 0,
    bianLines: [],
    disclaimer: DISCLAIMER_FULL,
    disclaimerShort: DISCLAIMER_SHORT
  },

  onLoad() {
    this.applyTheme();
    this.rebuild();
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  /** 由当前 lines/moving 重新成卦并生成解读 */
  rebuild() {
    const lines = this.data.lines.slice();
    const moving = this.data.moving.slice();
    const ben = findByLines(lines) || HEXAGRAMS[0];
    const reading = buildReading({ lines, moving });
    this.setData({
      reading,
      benName: ben.fullName,
      benNum: ben.num,
      bianName: reading.bian ? reading.bian.fullName : '',
      bianNum: reading.bian ? reading.bian.num : 0,
      bianLines: reading.bianLines || [],
      hasMoving: !!reading.bian,
      editRows: toEditRows(lines, moving)
    });
  },

  /** 点按某爻：切换阴阳 */
  onToggleLine(e: WechatMiniprogram.TouchEvent) {
    const pos = parseInt(String(e.currentTarget.dataset.pos), 10);
    if (!pos) return;
    const lines = this.data.lines.slice();
    const idx = pos - 1;
    lines[idx] = lines[idx] === 1 ? 0 : 1;
    this.setData({ lines }, () => this.rebuild());
  },

  /** 标记 / 取消动爻 */
  onToggleMoving(e: WechatMiniprogram.TouchEvent) {
    const pos = parseInt(String(e.currentTarget.dataset.pos), 10);
    if (!pos) return;
    const moving = this.data.moving.slice();
    const i = moving.indexOf(pos);
    if (i >= 0) moving.splice(i, 1);
    else moving.push(pos);
    this.setData({ moving }, () => this.rebuild());
  },

  /** 随机成卦 */
  onRandom() {
    const lines: number[] = [];
    for (let i = 0; i < 6; i++) lines.push(Math.random() < 0.5 ? 1 : 0);
    this.setData({ lines, moving: [] }, () => this.rebuild());
  },

  /** 清空动爻 */
  onClearMoving() {
    this.setData({ moving: [] }, () => this.rebuild());
  },

  /** 重置为乾卦（全阳） */
  onReset() {
    this.setData({ lines: [1, 1, 1, 1, 1, 1], moving: [] }, () => this.rebuild());
  },

  onCopy() {
    const r = this.data.reading;
    if (!r) return;
    const text =
      `【${r.ben.fullName}】\n` +
      `卦辞：${r.benCi}\n` +
      `象传：${r.benXiang}\n` +
      `卦意今解：${r.benPhilosophy}` +
      (this.data.hasMoving && r.bian ? `\n变卦：${r.bian.fullName}——${r.bianPhilosophy}` : '') +
      `\n人生疏导：${r.guide}\n` +
      `可行之法：${r.advice}\n` +
      DISCLAIMER_SHORT;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  },

  onViewLibrary() {
    go('/subpackages/tools/pages/guaxiang/library');
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const r = this.data.reading;
    const title = r ? `${r.ben.fullName}｜六爻涂爻` : '六爻涂爻 · 自画成卦';
    return { title: `${title}｜${DISCLAIMER_SHORT}`, path: '/subpackages/tools/pages/guaxiang/draw' };
  }
});
