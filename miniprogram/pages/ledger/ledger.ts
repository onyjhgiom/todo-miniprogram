// pages/ledger/ledger.ts
// 记账本 · 高级商务金融仪表盘版
// 视觉体系：珍珠白底 + 深海军蓝主色 + 香槟金点缀；图表用 Canvas 2D 自绘（柱状 + 结余折线 + 分类环形），
// 600~800ms ease-out 入场动画；金额 count-up。业务逻辑（连续记账 / 语音 / 分账 / 票据 / 预算 / 导出）保持不变。
import { toast } from '../../utils/cloud';
import { formatMoney } from '../../utils/money';
import {
  loadTransactions, loadAccounts, loadCategories, saveCategories,
  loadBudgets, saveBudgets, upsertTransaction, removeTransaction,
  createTransaction, topCategories, childCategories, categoryPath, categoryOf,
  monthRange, txInRange, buildReport, budgetStats,
  parseVoiceTx, exportCsv, loadFromCloud
} from '../../utils/ledger-store';
import { isCloudFile, uploadAttachImage, removeAttachFiles } from '../../utils/attach';
import type { BudgetStat } from '../../utils/ledger-store';
import type {
  ITransaction, IAccount, ILedgerCategory, IBudget, LedgerType
} from '../../types/index';

/* ==================== 设计 Token（与 WXSS 保持一致） ==================== */
const C = {
  navy: '#14284A',
  incomeBar: '#3568B8',   // 柱：收入 · 金融蓝
  expenseBar: '#D7B985',  // 柱：支出 · 香槟沙金
  line: '#17233A',        // 结余折线
  grid: '#E9EDF2',
  axis: '#9AA3B1',
  track: '#EEF1F4'
};
/** 环形图低饱和高级配色（按排名取色，「其他」用香槟金） */
const DONUT_COLORS = ['#3568B8', '#42A88B', '#8171C9', '#8A9A5B', '#6C8FC7'];
const OTHER_COLOR = '#C9A66B';

/* ==================== 类型 ==================== */
type TrendRange = '7d' | '30d' | '6m' | '1y';

interface TrendBar {
  label: string;
  income: number;
  expense: number;
  balance: number;
}

interface DeltaInfo {
  text: string;
  dir: 'good' | 'bad' | 'flat';
  arrow: string;
}

interface CatRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  amountText: string;
  pct: number;
  pctText: string;
}

interface RecentItem {
  _id: string;
  icon: string;
  color: string;
  catDesc: string;
  dateText: string;
  timeText: string;
  type: LedgerType;
  sign: string;
  amountText: string;
}

interface TxGroup {
  date: string;
  weekday: string;
  expenseText: string;
  items: DecoratedTx[];
}

interface DecoratedTx extends ITransaction {
  amountText: string;
  sign: string;
  catIcon: string;
  catName: string;
  catPath: string;
  catColor: string;
  accName: string;
  timeText: string;
  merchant: string;
  hasImage: boolean;
}

interface SplitMember {
  id: string;
  name: string;
  amountText: string;
}

interface TxDraft {
  _id: string;
  amountText: string;
  type: LedgerType;
  categoryId: string;
  subCategoryId: string;
  accountId: string;
  note: string;
  dateText: string;
  tagsText: string;
  reimburse: boolean;
  merchant: string;
  images: string[];
  splitMode: 'none' | 'average' | 'amount';
  splitMembers: SplitMember[];
}

interface LedgerData {
  year: number;
  month: number;
  monthLabel: string;
  monthValue: string;
  /* 顶部金融数据卡（count-up 动画写这些字段） */
  heroExpense: string;
  heroIncome: string;
  heroBalance: string;
  heroSaving: string;
  expenseDelta: DeltaInfo;
  incomeDelta: DeltaInfo;
  balanceDelta: DeltaInfo;
  /* 账户 */
  accounts: IAccount[];
  activeAccount: string;
  /* 预算 */
  budgets: BudgetStat[];
  /* 趋势图 */
  trendRange: TrendRange;
  trendBars: { label: string }[];
  /* 分类分析 */
  catTotalText: string;
  catRows: CatRow[];
  donutEmpty: boolean;
  /* 近期记账 */
  recentItems: RecentItem[];
  monthTxCount: number;
  miniBars: { h: number }[];
  showAllRecords: boolean;
  /* 流水 */
  groups: TxGroup[];
  searchKeyword: string;
  filterType: 'all' | 'income' | 'expense';
  /* 编辑面板 */
  editorOpen: boolean;
  draft: TxDraft;
  categories: ILedgerCategory[];
  subCategories: ILedgerCategory[];
  /* 设置面板 */
  settingsOpen: boolean;
  settingsTab: 'account' | 'category' | 'budget';
  categoryType: LedgerType;
}

interface CanvasRef {
  node: any;
  ctx: any;
  w: number;
  h: number;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const MAX_BILL = 9;
const TREND_RANGES: { key: TrendRange; label: string }[] = [
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
  { key: '6m', label: '近6个月' },
  { key: '1y', label: '近1年' }
];

function emptyDraft(type: LedgerType = 'expense'): TxDraft {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    _id: '',
    amountText: '',
    type,
    categoryId: '',
    subCategoryId: '',
    accountId: '',
    note: '',
    dateText: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    tagsText: '',
    reimburse: false,
    merchant: '',
    images: [],
    splitMode: 'none',
    splitMembers: []
  };
}

function parseDate(s: string, fallback: number): number {
  if (!s) return fallback;
  const t = new Date(`${s.replace(/\//g, '-')}T12:00:00`).getTime();
  return isFinite(t) ? t : fallback;
}

function parentOfCategory(childId: string): string {
  const c = categoryOf(childId);
  return c && c.parentId ? c.parentId : '';
}

/** 环形扇区角度（弧度） */
function donutSegs(rows: CatRow[]): { color: string; start: number; end: number }[] {
  const segs: { color: string; start: number; end: number }[] = [];
  let acc = -Math.PI / 2;
  rows.forEach((r) => {
    const sweep = (Math.min(100, r.pct) / 100) * Math.PI * 2;
    if (sweep <= 0) return;
    segs.push({ color: r.color, start: acc, end: acc + sweep });
    acc += sweep;
  });
  return segs;
}

Page<LedgerData>({
  data: {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    monthLabel: '',
    monthValue: '',
    heroExpense: '0.00',
    heroIncome: '0.00',
    heroBalance: '0.00',
    heroSaving: '0%',
    expenseDelta: { text: '较上月 持平', dir: 'flat', arrow: '—' },
    incomeDelta: { text: '较上月 持平', dir: 'flat', arrow: '—' },
    balanceDelta: { text: '较上月 持平', dir: 'flat', arrow: '—' },
    accounts: [],
    activeAccount: 'all',
    budgets: [],
    trendRange: '6m',
    trendBars: [],
    catTotalText: '¥0.00',
    catRows: [],
    donutEmpty: true,
    recentItems: [],
    monthTxCount: 0,
    miniBars: [],
    showAllRecords: false,
    groups: [],
    searchKeyword: '',
    filterType: 'all',
    editorOpen: false,
    draft: emptyDraft(),
    categories: [],
    subCategories: [],
    settingsOpen: false,
    settingsTab: 'budget',
    categoryType: 'expense'
  },

  /* 非渲染态内部缓存 */
  trendCache: { bars: [] as TrendBar[], maxBar: 1 },
  donutCache: [] as { color: string; start: number; end: number }[],
  trendRef: null as CanvasRef | null,
  donutRef: null as CanvasRef | null,
  trendToken: 0,
  donutToken: 0,
  heroTimer: 0 as ReturnType<typeof setTimeout> | 0 as unknown as number,

  onLoad() {
    this.refresh();
    loadFromCloud().then(() => this.refresh()).catch(() => {});
  },

  onReady() {
    this.renderCharts(true);
  },

  onUnload() {
    if (this.heroTimer) clearTimeout(this.heroTimer);
  },

  /* ==================== 数据刷新 ==================== */

  refresh() {
    const { year, month, activeAccount, searchKeyword, filterType, trendRange } = this.data;
    const range = monthRange(year, month);
    let list = loadTransactions();
    if (activeAccount !== 'all') list = list.filter((t) => t.accountId === activeAccount);

    const monthTx = txInRange(list, range);
    const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = income - expense;
    const budgets = budgetStats(list, range);

    // 上月同口径数据 → 较上月变化
    const prevRange = monthRange(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
    const prevTx = txInRange(list, prevRange);
    const prevIncome = prevTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const prevExpense = prevTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const prevBalance = prevIncome - prevExpense;
    const savingRate = income > 0 ? Math.round((balance / income) * 1000) / 10 : 0;

    // 分类排行（Top5 + 其他）
    const report6 = buildReport(list, range, 6);
    const catRows: CatRow[] = [];
    report6.byCategory.slice(0, 5).forEach((c, i) => {
      catRows.push({
        id: c.id,
        name: c.name,
        icon: c.icon,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
        amountText: formatMoney(c.amount),
        pct: c.pct,
        pctText: `${c.pct.toFixed(1)}%`
      });
    });
    const rest = report6.byCategory.slice(5);
    if (rest.length) {
      const restAmount = rest.reduce((s, c) => s + c.amount, 0);
      catRows.push({
        id: '__other__',
        name: '其他支出',
        icon: '•••',
        color: OTHER_COLOR,
        amountText: formatMoney(restAmount),
        pct: expense > 0 ? Math.round((restAmount / expense) * 1000) / 10 : 0,
        pctText: expense > 0 ? `${((restAmount / expense) * 100).toFixed(1)}%` : '0.0%'
      });
    }

    // 趋势数据（按所选时间范围）
    const trend = this.buildTrend(list, year, month, trendRange);

    // 本月流水 → 近期记账（最新 6 笔）+ 全部分组
    let display = monthTx.slice();
    if (filterType !== 'all') display = display.filter((t) => t.type === filterType);
    const kw = (searchKeyword || '').trim().toLowerCase();
    if (kw) {
      const accs = loadAccounts();
      display = display.filter((t) => {
        const c = categoryOf(t.categoryId);
        const a = accs.find((x) => x.id === t.accountId);
        const hay = [
          c ? c.name : '',
          c ? categoryPath(t.categoryId) : '',
          t.merchant || '',
          t.note || '',
          (t.tags || []).join(' '),
          a ? a.name : ''
        ].join(' ').toLowerCase();
        return hay.indexOf(kw) >= 0;
      });
    }
    display.sort((a, b) => b.occurredAt - a.occurredAt);

    const accsNow = loadAccounts();
    const decorate = (t: ITransaction): DecoratedTx => {
      const c = categoryOf(t.categoryId);
      const a = accsNow.find((x) => x.id === t.accountId);
      const d = new Date(t.occurredAt);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return Object.assign({}, t, {
        amountText: formatMoney(t.amount),
        sign: t.type === 'income' ? '+' : '-',
        catIcon: c ? c.icon : '📦',
        catName: c ? c.name : '未分类',
        catPath: categoryPath(t.categoryId),
        catColor: c ? c.color : '#94a3b8',
        accName: a ? a.name : '',
        merchant: t.merchant || '',
        hasImage: !!(t.images && t.images.length),
        timeText: `${hh}:${mm}`
      });
    };
    const recentItems: RecentItem[] = display.slice(0, 6).map((t) => {
      const d = decorate(t);
      const dt = new Date(t.occurredAt);
      return {
        _id: t._id,
        icon: d.catIcon,
        color: d.catColor,
        catDesc: d.catName + (d.merchant ? ` · ${d.merchant}` : ''),
        dateText: `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
        timeText: d.timeText,
        type: t.type,
        sign: d.sign,
        amountText: d.amountText
      };
    });

    const dayMap = new Map<string, ITransaction[]>();
    display.forEach((t) => {
      const d = new Date(t.occurredAt);
      const key = `${d.getMonth() + 1}月${d.getDate()}日`;
      if (!dayMap.has(key)) dayMap.set(key, []);
      dayMap.get(key)!.push(t);
    });
    const groups: TxGroup[] = Array.from(dayMap.entries()).map(([date, items]) => {
      const d = new Date(items[0].occurredAt);
      return {
        date,
        weekday: `周${WEEK[d.getDay()]}`,
        expenseText: formatMoney(items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)),
        items: items.map(decorate)
      };
    });

    // 统计卡迷你柱：近 6 个月支出
    const maxMini = Math.max(1, ...report6.trend.map((t) => t.expense));

    this.setData({
      year,
      month,
      monthLabel: `${year}年${month + 1}月`,
      monthValue: `${year}-${String(month + 1).padStart(2, '0')}`,
      accounts: accsNow,
      budgets,
      trendBars: trend.bars.map((b) => ({ label: b.label })),
      catTotalText: formatMoney(expense),
      catRows,
      donutEmpty: expense <= 0,
      recentItems,
      monthTxCount: monthTx.length,
      miniBars: report6.trend.map((t) => ({ h: Math.max(8, Math.round((t.expense / maxMini) * 100)) })),
      groups
    });

    // 图表数值缓存（Canvas 用）
    this.trendCache = { bars: trend.bars, maxBar: trend.maxBar };
    this.donutCache = donutSegs(catRows);

    // 数字 count-up
    this.animateHero(expense, income, balance, savingRate);
    // 图表入场动画
    this.renderCharts(true);
  },

  buildTrend(list: ITransaction[], year: number, month: number, range: TrendRange): { bars: TrendBar[]; maxBar: number } {
    const bars: TrendBar[] = [];
    const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (range === '7d' || range === '30d') {
      const days = range === '7d' ? 7 : 30;
      const buckets = range === '7d' ? 7 : 6;
      const per = days / buckets;
      const today = dayStart(new Date()) + 24 * 3600 * 1000; // 含今天
      for (let i = buckets - 1; i >= 0; i--) {
        const end = today - i * per * 24 * 3600 * 1000;
        const start = end - per * 24 * 3600 * 1000;
        const items = list.filter((t) => t.occurredAt >= start && t.occurredAt < end);
        const inc = items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const exp = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const e = new Date(end - 1);
        bars.push({ label: `${e.getMonth() + 1}/${e.getDate()}`, income: inc, expense: exp, balance: inc - exp });
      }
    } else {
      const months = range === '1y' ? 12 : 6;
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(year, month - i, 1);
        const r = monthRange(d.getFullYear(), d.getMonth());
        const items = txInRange(list, r);
        const inc = items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const exp = items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        bars.push({ label: `${d.getMonth() + 1}月`, income: inc, expense: exp, balance: inc - exp });
      }
    }
    const maxBar = Math.max(1, ...bars.map((b) => Math.max(b.income, b.expense)));
    return { bars, maxBar };
  },

  /* ==================== 数字 count-up ==================== */

  animateHero(expense: number, income: number, balance: number, savingRate: number) {
    if (this.heroTimer) clearTimeout(this.heroTimer);
    const dur = 800;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      const e = 1 - Math.pow(1 - t, 3); // ease-out
      this.setData({
        heroExpense: formatMoney(Math.round(expense * e), false),
        heroIncome: formatMoney(Math.round(income * e), false),
        heroBalance: formatMoney(Math.round(balance * e), false),
        heroSaving: `${(savingRate * e).toFixed(1)}%`
      });
      if (t < 1) this.heroTimer = setTimeout(tick, 32) as unknown as number;
    };
    tick();
  },

  deltaInfo(cur: number, prev: number, invert: boolean): DeltaInfo {
    if (prev <= 0) {
      if (cur <= 0) return { text: '较上月 持平', dir: 'flat', arrow: '—' };
      return invert
        ? { text: '较上月 新增', dir: 'bad', arrow: '↑' }
        : { text: '较上月 新增', dir: 'good', arrow: '↑' };
    }
    const p = ((cur - prev) / prev) * 100;
    if (Math.abs(p) < 0.05) return { text: '较上月 持平', dir: 'flat', arrow: '—' };
    const abs = Math.abs(p).toFixed(1) + '%';
    // invert=true（支出）：下降是好事
    const rising = p > 0;
    const dir: DeltaInfo['dir'] = (invert ? !rising : rising) ? 'good' : 'bad';
    return { text: `较上月 ${p > 0 ? '+' : '-'}${abs}`, dir, arrow: rising ? '↑' : '↓' };
  },

  /* ==================== Canvas 图表 ==================== */

  queryCanvas(sel: string): Promise<CanvasRef | null> {
    return new Promise((resolve) => {
      wx.createSelectorQuery().in(this).select(sel).fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return resolve(null);
        const { node, width, height } = res[0];
        if (!width || !height) return resolve(null);
        let dpr = 2;
        try {
          dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
        } catch (_e) { /* 保底 2 */ }
        node.width = width * dpr;
        node.height = height * dpr;
        const ctx = node.getContext('2d');
        ctx.scale(dpr, dpr);
        resolve({ node, ctx, w: width, h: height });
      });
    });
  },

  runAnim(ref: CanvasRef, token: number, isTrend: boolean, dur: number, onFrame: (p: number) => void) {
    const start = Date.now();
    const tick = () => {
      const cur = isTrend ? this.trendToken : this.donutToken;
      if (cur !== token) return; // 已被新一次刷新取代
      const t = Math.min(1, (Date.now() - start) / dur);
      onFrame(1 - Math.pow(1 - t, 3));
      if (t < 1) {
        if (ref.node.requestAnimationFrame) ref.node.requestAnimationFrame(tick);
        else setTimeout(tick, 16);
      }
    };
    tick();
  },

  async renderCharts(animate: boolean) {
    const [trendRef, donutRef] = await Promise.all([
      this.queryCanvas('#trendCanvas'),
      this.queryCanvas('#donutCanvas')
    ]);
    if (trendRef) {
      this.trendRef = trendRef;
      this.trendToken += 1;
      const token = this.trendToken;
      if (animate) this.runAnim(trendRef, token, true, 700, (p) => this.drawTrend(trendRef, p));
      else this.drawTrend(trendRef, 1);
    }
    if (donutRef) {
      this.donutRef = donutRef;
      this.donutToken += 1;
      const token = this.donutToken;
      if (animate) this.runAnim(donutRef, token, false, 600, (p) => this.drawDonut(donutRef, p));
      else this.drawDonut(donutRef, 1);
    }
  },

  fmtAxis(fen: number): string {
    const yuan = fen / 100;
    if (yuan >= 1000) return `${Math.round(yuan / 100) / 10}K`;
    return String(Math.round(yuan));
  },

  drawTrend(ref: CanvasRef, progress: number) {
    const { ctx, w, h } = ref;
    const { bars, maxBar } = this.trendCache;
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 42, r: 8, t: 12, b: 24 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const yOf = (v: number) => pad.t + ph * (1 - Math.min(v, maxBar) / maxBar);

    // 网格 + 轴标签
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = C.axis;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = (maxBar * i) / 4;
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(this.fmtAxis(v), pad.l - 6, y + 3);
    }

    const hasData = bars.some((b) => b.income > 0 || b.expense > 0 || b.balance !== 0);
    if (!hasData) {
      ctx.fillStyle = C.axis;
      ctx.textAlign = 'center';
      ctx.font = '12px sans-serif';
      ctx.fillText('暂无收支数据 · 开始记账后自动生成趋势', w / 2, pad.t + ph / 2);
      // 保留时间轴
      ctx.textAlign = 'center';
      ctx.fillStyle = C.axis;
      bars.forEach((b, i) => {
        const cx = pad.l + pw * ((i + 0.5) / bars.length);
        ctx.fillText(b.label, cx, h - 8);
      });
      return;
    }

    const n = bars.length;
    const gw = pw / n;
    const barW = Math.min(10, Math.max(4, gw * 0.26));
    const centers: number[] = [];

    // 柱状（收入 / 支出）
    bars.forEach((b, i) => {
      const cx = pad.l + gw * (i + 0.5);
      centers.push(cx);
      const inH = (b.income / maxBar) * ph * progress;
      const outH = (b.expense / maxBar) * ph * progress;
      ctx.fillStyle = C.incomeBar;
      this.roundBar(ctx, cx - barW - 1.5, yOf((b.income / maxBar) * (progress)) , barW, inH, barW / 2);
      ctx.fillStyle = C.expenseBar;
      this.roundBar(ctx, cx + 1.5, yOf((b.expense / maxBar) * (progress)), barW, outH, barW / 2);
      // x 标签（过密时隔一个）
      if (n <= 8 || i % 2 === 0) {
        ctx.fillStyle = C.axis;
        ctx.textAlign = 'center';
        ctx.font = '10px sans-serif';
        ctx.fillText(b.label, cx, h - 8);
      }
    });

    // 结余折线（左 → 右绘制）
    const pts = bars.map((b, i) => ({ x: centers[i], y: yOf(Math.max(0, b.balance)) }));
    const upto = progress * (n - 1);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) {
      if (i <= upto) ctx.lineTo(pts[i].x, pts[i].y);
      else {
        const f = upto - (i - 1);
        if (f > 0) ctx.lineTo(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f);
        break;
      }
    }
    ctx.stroke();
    // 节点
    for (let i = 0; i < n; i++) {
      if (i <= upto) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 3, 0, Math.PI * 2);
        ctx.fillStyle = C.line;
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  },

  /** 圆角顶柱体 */
  roundBar(ctx: any, x: number, yBottom: number, w: number, h: number, r: number) {
    const y = yBottom - h;
    const rr = Math.min(r, h, w / 2);
    ctx.beginPath();
    ctx.moveTo(x, yBottom);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, yBottom);
    ctx.closePath();
    ctx.fill();
  },

  drawDonut(ref: CanvasRef, progress: number) {
    const { ctx, w, h } = ref;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 8;
    const lw = 14;
    if (this.data.donutEmpty || !this.donutCache.length) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = C.track;
      ctx.lineWidth = lw;
      ctx.stroke();
      return;
    }
    const segs = this.donutCache;
    const gap = segs.length > 1 ? 0.03 : 0;
    segs.forEach((s) => {
      const end = s.start + (s.end - s.start) * progress;
      if (end - s.start <= gap) return;
      ctx.beginPath();
      ctx.arc(cx, cy, R, s.start + gap / 2, end - gap / 2);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = lw;
      ctx.lineCap = 'butt';
      ctx.stroke();
    });
  },

  /* ==================== 月份 / 账户 / 趋势范围 ==================== */

  onPrevMonth() {
    let { year, month } = this.data;
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
    this.setData({ year, month }, () => this.refresh());
  },
  onNextMonth() {
    let { year, month } = this.data;
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    this.setData({ year, month }, () => this.refresh());
  },
  onMonthPick(e: WechatMiniprogram.PickerChangeEvent) {
    const v = String(e.detail.value || '');
    const m = v.match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return;
    this.setData({ year: Number(m[1]), month: Number(m[2]) - 1 }, () => this.refresh());
  },
  onAccountSwitch(e: WechatMiniprogram.TouchEvent) {
    this.setData({ activeAccount: e.currentTarget.dataset.id as string }, () => this.refresh());
  },
  onTrendRange(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.v as TrendRange;
    if (key === this.data.trendRange) return;
    this.setData({ trendRange: key }, () => this.refresh());
  },

  /* ==================== 记账 ==================== */

  onFab() {
    const accs = loadAccounts();
    const cats = topCategories('expense');
    this.setData({
      editorOpen: true,
      draft: Object.assign(emptyDraft('expense'), {
        accountId: (accs[0] && accs[0].id) || '',
        categoryId: (cats[0] && cats[0].id) || ''
      }),
      categories: cats,
      subCategories: []
    });
  },

  onEditorClose() { this.setData({ editorOpen: false }); },
  onSheetStop() {},

  onDraftType(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.v as LedgerType;
    const cats = topCategories(type);
    this.setData({
      'draft.type': type,
      'draft.categoryId': (cats[0] && cats[0].id) || '',
      'draft.subCategoryId': '',
      categories: cats,
      subCategories: []
    });
  },

  onCategoryPick(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({
      'draft.categoryId': id,
      'draft.subCategoryId': '',
      subCategories: childCategories(id)
    });
  },

  onSubPick(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'draft.subCategoryId': e.currentTarget.dataset.id as string });
  },

  onAccountPick(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'draft.accountId': e.currentTarget.dataset.id as string });
  },

  onDraftInput(e: WechatMiniprogram.InputEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ [`draft.${key}`]: e.detail.value });
  },

  onDraftSwitch(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'draft.reimburse': !!e.detail.value });
  },

  onDatePick(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ 'draft.dateText': e.detail.value });
  },

  onVoiceInput() {
    wx.showModal({
      title: '说一句话记账',
      editable: true,
      placeholderText: '例如：午餐三十五',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const parsed = parseVoiceTx(String(res.content));
        if (!parsed.amount) {
          toast('没识别出金额，请手动输入');
          return;
        }
        const cats = topCategories(parsed.type);
        this.setData({
          'draft.amountText': String(parsed.amount / 100),
          'draft.type': parsed.type,
          'draft.note': parsed.note,
          'draft.categoryId': parsed.categoryId || ((cats[0] && cats[0].id) || ''),
          categories: cats,
          subCategories: []
        });
        toast(`已识别：${formatMoney(parsed.amount)}`);
      }
    });
  },

  /* ==================== 分账（多人 AA） ==================== */

  onSplitMode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'draft.splitMode': e.currentTarget.dataset.v as TxDraft['splitMode'] });
  },

  onAddMember() {
    const list = this.data.draft.splitMembers.slice();
    list.push({
      id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: '',
      amountText: ''
    });
    this.setData({ 'draft.splitMembers': list });
  },

  onMemberName(e: WechatMiniprogram.InputEvent) {
    const i = Number(e.currentTarget.dataset.index);
    const list = this.data.draft.splitMembers.slice();
    if (list[i]) {
      list[i].name = e.detail.value;
      this.setData({ 'draft.splitMembers': list });
    }
  },

  onMemberAmount(e: WechatMiniprogram.InputEvent) {
    const i = Number(e.currentTarget.dataset.index);
    const list = this.data.draft.splitMembers.slice();
    if (list[i]) {
      list[i].amountText = e.detail.value;
      this.setData({ 'draft.splitMembers': list });
    }
  },

  onRemoveMember(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index);
    const list = this.data.draft.splitMembers.slice();
    if (i >= 0 && i < list.length) {
      list.splice(i, 1);
      this.setData({ 'draft.splitMembers': list });
    }
  },

  /* ==================== 票据图片 ==================== */

  onPickBill() {
    const left = MAX_BILL - this.data.draft.images.length;
    if (left <= 0) {
      toast(`最多 ${MAX_BILL} 张票据`);
      return;
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).map((f: { tempFilePath: string }) => f.tempFilePath).filter(Boolean);
        if (!files.length) return;
        this.setData({ 'draft.images': this.data.draft.images.concat(files) });
      },
      fail: () => { /* 用户取消选择，不提示 */ }
    });
  },

  onRemoveBill(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index);
    const images = this.data.draft.images.slice();
    const removed = images[i];
    if (removed != null) {
      if (isCloudFile(removed)) removeAttachFiles([removed]);
      images.splice(i, 1);
      this.setData({ 'draft.images': images });
    }
  },

  onPreviewBill(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index);
    const urls = this.data.draft.images;
    const cur = urls[i];
    if (!cur) return;
    wx.previewImage({ urls, current: cur });
  },

  onPreviewTxImage(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { urls?: string[]; current?: string };
    const urls = (ds.urls || []).filter(Boolean);
    const cur = ds.current || urls[0];
    if (!cur) return;
    wx.previewImage({ urls, current: cur });
  },

  /* ==================== 流水搜索 / 筛选 / 展开 ==================== */

  onSearch(e: WechatMiniprogram.InputEvent) {
    this.setData({ searchKeyword: e.detail.value, showAllRecords: true }, () => this.refresh());
  },

  onClearSearch() {
    if (!this.data.searchKeyword) return;
    this.setData({ searchKeyword: '' }, () => this.refresh());
  },

  onFilterType(e: WechatMiniprogram.TouchEvent) {
    this.setData({ filterType: e.currentTarget.dataset.v as LedgerData['filterType'], showAllRecords: true }, () => this.refresh());
  },

  onToggleAll() {
    this.setData({ showAllRecords: !this.data.showAllRecords });
  },

  /* ==================== 保存（含连续记账） ==================== */

  onSave() { this.saveTx(false); },
  onSaveContinue() { this.saveTx(true); },

  async saveTx(keepOpen: boolean): Promise<void> {
    const d = this.data.draft;
    const amount = Math.round(Number(d.amountText || '0') * 100);
    if (!amount || amount <= 0) {
      toast('请输入金额');
      return;
    }
    const catId = d.subCategoryId || d.categoryId;
    if (!catId) {
      toast('请选择分类');
      return;
    }

    let images = d.images;
    let billFailed = false;
    if (images.some((u) => !isCloudFile(u))) {
      const uploaded = await Promise.all(
        images.map(async (u) => {
          if (isCloudFile(u)) return u;
          try {
            return await uploadAttachImage(u);
          } catch (_e) {
            return u;
          }
        })
      );
      billFailed = uploaded.some((u, i) => !isCloudFile(u) && u === images[i]);
      images = uploaded;
    }

    const split = this.buildSplit(d, amount);
    const tx = createTransaction({
      _id: d._id || undefined,
      accountId: d.accountId,
      type: d.type,
      amount,
      categoryId: catId,
      note: d.note,
      merchant: d.merchant || '',
      occurredAt: parseDate(d.dateText, Date.now()),
      tags: d.tagsText.split(/[\s,，]+/).filter(Boolean),
      isReimbursable: d.reimburse,
      images,
      splitMode: split.mode,
      splitDetail: split.detail,
      payerName: d.splitMembers.length ? (d.splitMembers[0].name || '我') : '我'
    });
    upsertTransaction(tx);

    if (!keepOpen) {
      this.setData({ editorOpen: false });
    } else {
      const cont = this.freshForContinue(d);
      this.setData({
        draft: cont,
        categories: topCategories(cont.type),
        subCategories: cont.categoryId ? childCategories(cont.categoryId) : []
      });
    }

    if (billFailed) toast('部分票据仅本机可见');
    else toast(keepOpen ? '已记录，继续记一笔' : '已记一笔');

    const stats = budgetStats(loadTransactions(), monthRange(this.data.year, this.data.month));
    const over = stats.find((s) => s.level >= 100);
    if (over) {
      const name = over.budget.categoryId ? categoryPath(over.budget.categoryId) : '总预算';
      wx.showModal({
        title: '预算提醒',
        content: `${name} 已用 ${over.pct}%，超出 ${formatMoney(Math.abs(over.left))}`,
        showCancel: false
      });
    }
    this.refresh();
  },

  buildSplit(d: TxDraft, amount: number): { mode: 'none' | 'average' | 'amount'; detail: { userId: string; name: string; amount: number }[] } {
    if (d.splitMode === 'none' || d.splitMembers.length < 2) {
      return { mode: 'none', detail: [] };
    }
    if (d.splitMode === 'average') {
      const n = d.splitMembers.length;
      const per = Math.round(amount / n);
      const detail = d.splitMembers.map((m, i) => ({
        userId: m.id,
        name: m.name || `成员${i + 1}`,
        amount: i === n - 1 ? amount - per * (n - 1) : per
      }));
      return { mode: 'average', detail };
    }
    const detail = d.splitMembers.map((m, i) => ({
      userId: m.id,
      name: m.name || `成员${i + 1}`,
      amount: Math.round(Number(m.amountText || '0') * 100)
    }));
    return { mode: 'amount', detail };
  },

  freshForContinue(d: TxDraft): TxDraft {
    const base = emptyDraft(d.type);
    base.accountId = d.accountId;
    base.categoryId = d.categoryId;
    base.dateText = d.dateText;
    base.reimburse = d.reimburse;
    return base;
  },

  onTxLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const tx = loadTransactions().find((t) => t._id === id);
    if (!tx) return;
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          const parentId = parentOfCategory(tx.categoryId);
          const subId = parentId ? tx.categoryId : '';
          const splitDetail = tx.splitDetail || [];
          this.setData({
            editorOpen: true,
            draft: {
              _id: tx._id,
              amountText: String(tx.amount / 100),
              type: tx.type,
              categoryId: parentId || tx.categoryId,
              subCategoryId: subId,
              accountId: tx.accountId,
              note: tx.note,
              dateText: new Date(tx.occurredAt).toISOString().slice(0, 10),
              tagsText: (tx.tags || []).join(' '),
              reimburse: tx.isReimbursable,
              merchant: tx.merchant || '',
              images: (tx.images || []).slice(),
              splitMode: splitDetail.length > 1 ? (tx.splitMode || 'average') : 'none',
              splitMembers: splitDetail.map((s, i) => ({
                id: s.userId || 'm_' + i,
                name: s.name || '',
                amountText: (s.amount / 100).toFixed(2)
              }))
            },
            categories: topCategories(tx.type),
            subCategories: parentId ? childCategories(parentId) : []
          });
        } else {
          wx.showModal({
            title: '删除流水',
            content: `确定删除 ${formatMoney(tx.amount)} 这笔记录？`,
            success: (r) => {
              if (r.confirm) {
                const imgs = (tx.images || []).filter(isCloudFile);
                if (imgs.length) removeAttachFiles(imgs);
                removeTransaction(id);
                this.refresh();
                toast('已删除');
              }
            }
          });
        }
      },
      fail: () => {}
    });
  },

  /* ==================== 设置：账户 / 分类 / 预算 ==================== */

  onSettingsOpen() {
    this.setData({ settingsOpen: true, settingsTab: 'budget' });
  },
  onSettingsTab(e: WechatMiniprogram.TouchEvent) {
    this.setData({ settingsTab: e.currentTarget.dataset.tab as LedgerData['settingsTab'] });
  },
  onSettingsClose() {
    this.setData({ settingsOpen: false });
    this.refresh();
  },

  onCatTypeSwitch(e: WechatMiniprogram.TouchEvent) {
    this.setData({ categoryType: e.currentTarget.dataset.v as LedgerType });
  },

  onAddCategory() {
    wx.showModal({
      title: '新建分类',
      editable: true,
      placeholderText: '分类名称',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const list = loadCategories();
        list.push({
          id: `lc_${Date.now().toString(36)}`,
          name: String(res.content).trim().slice(0, 8),
          icon: '📦',
          color: '#B5714C',
          type: this.data.categoryType,
          parentId: '',
          order: list.length
        });
        saveCategories(list);
        this.refresh();
        toast('已添加');
      }
    });
  },

  onAddBudget() {
    wx.showModal({
      title: '新建预算',
      editable: true,
      placeholderText: '每月限额（元）',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        const limit = Math.round(Number(res.content) * 100);
        if (!limit || limit <= 0) {
          toast('请输入有效金额');
          return;
        }
        const list = loadBudgets();
        list.push({
          id: `bg_${Date.now().toString(36)}`,
          accountId: '',
          categoryId: '',
          limit,
          period: 'month',
          thresholds: [50, 80, 100],
          enabled: true,
          createTime: Date.now(),
          updateTime: Date.now()
        });
        saveBudgets(list);
        this.refresh();
        toast('预算已创建');
      }
    });
  },

  onRemoveBudget(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    saveBudgets(loadBudgets().filter((b: IBudget) => b.id !== id));
    this.refresh();
  },

  /* ==================== 导出 ==================== */

  onExport() {
    const csv = exportCsv(loadTransactions());
    wx.setClipboardData({
      data: csv,
      success: () => {
        wx.showModal({
          title: '已复制 CSV',
          content: `${loadTransactions().length} 条流水已复制（带 BOM，Excel 直接粘贴不乱码）`,
          showCancel: false
        });
      },
      fail: () => toast('复制失败')
    });
  },

  /* ==================== 底部导航（页内定位） ==================== */

  scrollToCard(sel: string) {
    wx.pageScrollTo({ selector: sel, duration: 300, fail: () => {} } as never);
  },

  onTabHome() { wx.pageScrollTo({ scrollTop: 0, duration: 300 }); },
  onTabAssets() { this.scrollToCard('#accountCard'); },
  onTabReport() { this.scrollToCard('#trendCard'); },
  onTabMine() { this.onSettingsOpen(); },

  onShareAppMessage() {
    return { title: '我的记账本', path: '/pages/ledger/ledger' };
  }
});
