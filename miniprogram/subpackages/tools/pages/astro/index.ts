// pages/astro/index.ts
// 星语星球主页 · 沉浸式 3D 星象仪表盘
//
// 【与旧版的关系】
// 视觉与结构全面重构，但**业务逻辑一条没删**：
//   * 本命星座选择（写 NS.zodiac，与星座运势页共享同一个键）
//   * 八大模块入口（星座运势/塔罗/雷诺曼/星象日历/知心姐姐/冥想/星愿/树洞）
//   * 最近足迹（合并塔罗/雷诺曼/星象笔记/星愿的历史）
//   * 图片加载失败兜底
// 新增的是「数据层 + 3D 场景 + 分期入场 + 能量脉冲」这套表现层。
//
// 【数据流】
//   utils/astro-dashboard.ts（单一真相源，可接 API）
//        ↓ fetchAstroDashboard()
//   本页 setData（dims / signs / dailyEnergy / aiSummary …）
//        ↓
//   ① astro-sphere 组件（Canvas 2D 画 3D 星球）  ② WXML 卡片
import { go } from '../../../../utils/nav';
import { ZODIACS, zodiacByKey, formatDate, parseDate } from '../../utils/astro-data';
import { NS, listAll, readJson } from '../../utils/astro-store';
import {
  fetchAstroDashboard, addEnergyBump, refreshDashboard, writeSignKey,
  type AstroDashboard, type ConstellationNode
} from '../../utils/astro-dashboard';

interface DimItem { key: string; label: string; icon: string; value: number; percent: number; }
interface FeatureItem {
  id: string; name: string; desc: string; icon: string; tone: string; route: string; badge?: string;
  /** 全局序号（0~7）：用于入场动画错峰，也体现「主次 = 阅读顺序」 */
  order: number;
}
interface FeatureGroup { label: string; hint: string; items: FeatureItem[]; }
interface NavItem { key: string; name: string; icon: string; route: string; }
interface RecentItem { id: string; icon: string; name: string; timeLabel: string; route: string; }
interface DetailData {
  key: string; name: string; energy: number; percent: number; hint: string;
}

/* ============================================================
 * 功能模块：单一卡片规格 + 显式分组
 * ============================================================
 * 【统一约定（八个模块完全一致）】
 *   统一入口结构：3D 图标 → 标题 → 描述（自上而下，顺序固定）
 *   统一卡片规格：同圆角 / 同内边距 / 同图标尺寸 / 同最小高度 / 同 hover 反馈
 *   统一网格：2 列（手机）→ 4 列（平板 / PC 宽窗），由 auto-fill 自动决定
 *   统一交互：整卡即热区（卡高 ≥ 236 个缩放单位，远大于 88rpx 的可点下限）
 *
 * 【为什么用「池 + 分组引用」而不是两个数组】
 *   早先把「星愿 / 树洞」放在次级 chip 行，导致同一类功能出现两套入口样式，
 *   视觉层级和点按体验都不一致。现在改为：所有模块都从 FEATURE_POOL 取，
 *   分组只决定「谁排在前面、和谁挨着」，**不再产生第二套样式**。
 *
 * 【分组与排序依据】
 *   第一组「星象与占卜」= 查询/占卜类（用户带着问题来要答案）
 *     星座运势 → 最高频、最核心，且是本页主卡的同源入口，放第一
 *     塔罗占卜 → 主动问卜，单张/多牌阵，使用频次次高
 *     雷诺曼   → 同属主动问卜，与塔罗共用一套抽牌心智，紧挨塔罗
 *     星象日历 → 仍是「看天象」，但属于被动查阅，放在本组末位做收尾
 *   第二组「陪伴与记录」= 情绪/练习/留痕类（用户是来安放自己）
 *     知心姐姐 → 情感陪伴最高频入口（NEW），领起本组
 *     冥想训练 → 由「聊」转向「静」，与知心姐姐形成情绪处理的两端
 *     星愿     → 记录型：写下来并期待
 *     树洞     → 记录型：写下来并封存；与星愿同为「落笔」，相邻最自然
 *
 *   两条通用规则贯穿：① 高频在前、低频在后；② 主动型（问卜/倾诉）在前，
 *   记录型（写下来）在后，于是两个记录型模块自然聚在末尾，不会有割裂感。
 * ============================================================ */
const FEATURE_POOL: Record<string, Omit<FeatureItem, 'order'>> = {
  horoscope: { id: 'horoscope', name: '星座运势', desc: '今日 / 本周 / 本月运势详解', icon: '🌟', tone: 'violet', route: '/subpackages/tools/pages/astro/horoscope' },
  tarot: { id: 'tarot', name: '塔罗占卜', desc: '78 种牌阵，抽牌看指引', icon: '🃏', tone: 'gold', route: '/subpackages/tools/pages/astro/tarot' },
  lenormand: { id: 'lenormand', name: '雷诺曼', desc: '36 张牌，组合式解读', icon: '🎴', tone: 'blue', route: '/subpackages/tools/pages/astro/lenormand' },
  calendar: { id: 'calendar', name: '星象日历', desc: '月相与天象笔记', icon: '🌒', tone: 'purple', route: '/subpackages/tools/pages/astro/starCalendar' },
  sister: { id: 'sister', name: '知心姐姐', desc: 'AI 情感对话 · 真人语音', icon: '💞', tone: 'rose', route: '/subpackages/tools/pages/astro/sisterChat', badge: 'NEW' },
  meditation: { id: 'meditation', name: '冥想训练', desc: '呼吸练习与正念', icon: '🌿', tone: 'green', route: '/subpackages/tools/pages/astro/meditation' },
  wish: { id: 'wish', name: '星愿', desc: '写下心愿，等它发生', icon: '✨', tone: 'violet', route: '/subpackages/tools/pages/astro/wish' },
  treehole: { id: 'treehole', name: '树洞', desc: '私密心事，只说给自己', icon: '🌳', tone: 'green', route: '/subpackages/tools/pages/astro/treehole' }
};

const FEATURE_GROUPS_SPEC: { label: string; hint: string; ids: string[] }[] = [
  { label: '星象与占卜', hint: '看运势 · 抽牌问卜', ids: ['horoscope', 'tarot', 'lenormand', 'calendar'] },
  { label: '陪伴与记录', hint: '聊一聊 · 静一静 · 写下来', ids: ['sister', 'meditation', 'wish', 'treehole'] }
];

/** 按分组规格展开成「分组 + 全局序号」，序号供入场错峰使用 */
function buildFeatureGroups(): FeatureGroup[] {
  let order = 0;
  const out: FeatureGroup[] = [];
  for (let g = 0; g < FEATURE_GROUPS_SPEC.length; g++) {
    const spec = FEATURE_GROUPS_SPEC[g];
    const items: FeatureItem[] = [];
    for (let i = 0; i < spec.ids.length; i++) {
      const base = FEATURE_POOL[spec.ids[i]];
      if (!base) continue; // 容错：id 写错时跳过，不让整页崩
      items.push({ ...base, order: order++ });
    }
    out.push({ label: spec.label, hint: spec.hint, items });
  }
  return out;
}

/* 底部导航（全部指向已注册的主包页，路由可达性由 check-routes.js 兜底） */
const NAVS: NavItem[] = [
  { key: 'home', name: '首页', icon: '🏠', route: '/pages/index/index' },
  { key: 'astro', name: '星语星球', icon: '🪐', route: '' },
  { key: 'record', name: '记录', icon: '📖', route: '/pages/calendar/calendar' },
  { key: 'tools', name: '工具', icon: '🧰', route: '/pages/tools/tools' },
  { key: 'me', name: '我的', icon: '👤', route: '/pages/profile/profile' }
];

const DIM_META: { key: keyof AstroDashboard; label: string; icon: string }[] = [
  { key: 'love', label: '爱情', icon: '💗' },
  { key: 'career', label: '事业', icon: '💼' },
  { key: 'wealth', label: '财富', icon: '🪙' },
  { key: 'health', label: '健康', icon: '💪' }
];

interface PageData {
  /* —— 数据层 —— */
  signKey: string;
  zodiacName: string;
  date: string;
  dailyEnergy: number;
  /** 数字累加用（显示值） */
  energyShown: number;
  dims: DimItem[];
  signs: { key: string; name: string; energy: number }[];
  aiSummary: string;
  moonName: string;
  aiInsight: string;

  /* —— 既有业务 —— */
  zodiacs: typeof ZODIACS;
  featureGroups: FeatureGroup[];
  recentList: RecentItem[];
  navs: NavItem[];
  navActive: string;

  /* —— 交互 / 动效 —— */
  stage: number;
  reducedMotion: boolean;
  spherePaused: boolean;
  pulseCount: number;
  detail: DetailData | null;
  /** 宽窗版式：JS 按真实窗口宽度判定，见 applyLayout() */
  wide: boolean;
  /** 超宽窗（内容列再放宽一档） */
  wideXl: boolean;
  /**
   * 根节点内联的 --u 值（px 字符串）。真机上 WXSS 自定义属性里的 rpx 可能
   * 不被转换（按 1px 生效），导致整页按 750 设计稿渲染、flex 行被挤爆 →
   * 文案单字竖排。由 applyLayout() 用 windowWidth/750 算真值内联绕开。
   */
  uUnit: string;
}

function blankDims(): DimItem[] {
  return DIM_META.map((m) => ({ key: String(m.key), label: m.label, icon: m.icon, value: 0, percent: 0 }));
}

Page<PageData>({
  data: {
    signKey: 'aries',
    zodiacName: '白羊座',
    date: '',
    dailyEnergy: 0,
    energyShown: 0,
    dims: blankDims(),
    signs: [],
    aiSummary: '正在读取今日星象…',
    moonName: '',
    aiInsight: '',

    zodiacs: ZODIACS,
    featureGroups: buildFeatureGroups(),
    recentList: [],
    navs: NAVS,
    navActive: 'astro',

    stage: 0,
    reducedMotion: false,
    spherePaused: false,
    pulseCount: 0,
    detail: null,
    wide: false,
    wideXl: false,
    uUnit: ''
  },

  /* —— 实例字段（非响应式） —— */
  _entered: false,
  _timers: [] as ReturnType<typeof setTimeout>[],
  _countTimer: null as ReturnType<typeof setTimeout> | null,
  _lastPulse: 0,

  onLoad() {
    const reduced = this.detectReduced();
    this.setData({ reducedMotion: reduced });
    if (reduced) {
      // 减弱动效：跳过分期入场，直接到末态（需求十）
      this.setData({ stage: 5 });
    } else {
      this.scheduleReveal();
    }
    this.applyLayout();
    this.loadDashboard();
  },

  onShow() {
    this.setData({ spherePaused: false, navActive: 'astro' });
    // 从子页返回时刷新数据（月相/日期可能已跨天）
    this.loadDashboard();
  },

  /** 分屏 / 横竖屏切换后窗口宽度会变，必须重算版式档位 */
  onResize() {
    this.applyLayout();
  },

  /**
   * 宽窗版式 + 根字号单位。
   *
   * 【为什么不能用 @media (min-width: 740px)】
   *   小程序 WXSS 的 @media 判定口径与浏览器不同：开发者工具按设备像素算，
   *   真机上也可能按物理像素算，同一台 375pt 宽的手机会被判成 ≥740px，
   *   于是「桌面 4 列 + --u 缩到 0.62px」的宽窗样式恒命中 —— 结果是
   *   flex 子项被压到极窄，「今日星象」「专属星盘」这类标题被挤成单字竖排。
   *   故改用 getWindowInfo 拿真实 CSS 像素宽度在 JS 侧判定，阈值取 600
   *   （远高于任何手机逻辑像素宽，也不会被误命中）。
   *
   * 【为什么 --u 也要在这里算】
   *   WXSS 里的 `--u: 1rpx` 在真机上可能不被转换（自定义属性里的 rpx 按
   *   1px 原值生效，开发者工具却正常），整页尺寸因此放大近一倍，运势环等
   *   固定宽元素挤爆 flex 行 → 右侧文案单字竖排（真机已复现）。
   *   这里用 windowWidth/750 直接算出 px 值内联到根节点 style，不依赖
   *   rpx 转换；宽窗档仍取 0.62px 与 WXSS 的 .is-wide 定义保持一致。
   */
  applyLayout() {
    let w = 0;
    try {
      const info: any = (wx as any).getWindowInfo
        ? (wx as any).getWindowInfo()
        : wx.getSystemInfoSync();
      w = (info && (info.windowWidth || info.screenWidth)) || 0;
    } catch (e) {
      w = 0;
    }
    const wide = w >= 600;
    const wideXl = w >= 1040;
    // w 拿不到时留空，回退 WXSS 里的 --u: 1rpx（至少工具里是对的）
    const uUnit = w > 0 ? (wide ? '0.62px' : `${(w / 750).toFixed(4)}px`) : '';
    this.setData({ wide, wideXl, uUnit });
  },

  onHide() {
    // 页面不可见 → 停 RAF，省电
    this.setData({ spherePaused: true });
    this.clearTimers();
  },

  onUnload() {
    this.clearTimers();
  },

  /* ============================ 动效编排 ============================ */

  /** 分期入场：1 背景+标题 → 2 星球 → 3 星座+今日能量 → 4 AI+功能 → 5 CTA+导航 */
  scheduleReveal() {
    const steps: [number, number][] = [
      [1, 60],
      [2, 380],
      [3, 900],
      [4, 1400],
      [5, 1850]
    ];
    for (let i = 0; i < steps.length; i++) {
      const stage = steps[i][0];
      const delay = steps[i][1];
      this._timers.push(setTimeout(() => this.setData({ stage }), delay));
    }
  },

  clearTimers() {
    for (let i = 0; i < this._timers.length; i++) clearTimeout(this._timers[i]);
    this._timers = [];
    if (this._countTimer) {
      clearTimeout(this._countTimer);
      this._countTimer = null;
    }
  },

  /** 系统「减弱动态效果」 */
  detectReduced(): boolean {
    try {
      const s: any = (wx as any).getSystemSetting ? (wx as any).getSystemSetting() : {};
      return s.reducedMotion === 'enable';
    } catch (_e) {
      return false;
    }
  },

  /* ============================ 数据 ============================ */

  loadDashboard() {
    const key = this.data.signKey;
    fetchAstroDashboard(key).then((d) => {
      this.applyDashboard(d);
    });
  },

  applyDashboard(d: AstroDashboard) {
    const dims: DimItem[] = [];
    for (let i = 0; i < DIM_META.length; i++) {
      const m = DIM_META[i];
      const v = Number(d[m.key]) || 0;
      dims.push({ key: String(m.key), label: m.label, icon: m.icon, value: v, percent: Math.max(0, Math.min(100, v * 10)) });
    }

    const signs = d.constellations.map((c: ConstellationNode) => ({
      key: c.id, name: c.name, energy: c.energy
    }));

    const first = !this._entered;
    this._entered = true;

    this.setData({
      signKey: d.currentZodiac,
      zodiacName: d.zodiacName,
      date: d.date,
      dailyEnergy: d.dailyEnergy,
      dims,
      signs,
      aiSummary: d.aiInsight.summary,
      moonName: d.moonPhase.name,
      aiInsight: d.aiInsight.summary
    });

    // 首次进入从 0 累加；之后按差值累加
    this.runEnergyCountUp(d.dailyEnergy, first ? 0 : this.data.energyShown);
    this.applyRecent();
  },

  /** 数字累加动画（reducedMotion 时直接落定） */
  runEnergyCountUp(to: number, fromOverride?: number) {
    const from = typeof fromOverride === 'number' ? fromOverride : this.data.energyShown;
    if (this.data.reducedMotion || from === to) {
      this.setData({ energyShown: to });
      return;
    }
    if (this._countTimer) clearTimeout(this._countTimer);
    const dur = 760;
    const t0 = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      this.setData({ energyShown: Math.round(from + (to - from) * e) });
      if (t < 1) this._countTimer = setTimeout(tick, 24);
      else this._countTimer = null;
    };
    tick();
  },

  /* ============================ 3D 场景交互 ============================ */

  /** 引擎内部/外部触发了一次脉冲 → 数字增长 + 轻震 */
  onSpherePulse() {
    const now = Date.now();
    if (now - this._lastPulse < 320) return; // 防连点刷数字
    this._lastPulse = now;

    try { (wx.vibrateShort as (o?: { type?: string }) => void)({ type: 'light' }); } catch (_e) { /* 忽略 */ }

    const bump = addEnergyBump(this.data.date, 1);
    const d = refreshDashboard(this.data.signKey);
    // 重算四维与综合（bump 只影响综合能量）
    this.setData({ dailyEnergy: d.dailyEnergy, pulseCount: bump });
    this.runEnergyCountUp(d.dailyEnergy);
  },

  /** 点击能量核心：触发脉冲 + 滚动到今日能量卡（需求六） */
  onTapCore() {
    const c: any = this.selectComponent('#sphere');
    if (c && typeof c.pulse === 'function') c.pulse();
    this.scrollToEnergy();
  },

  /** 点击星座节点：弹出 AstrologyDetail（需求三 / 六） */
  onTapNode(e: WechatMiniprogram.CustomEvent) {
    const key = (e.detail && (e.detail as { key?: string }).key) || '';
    if (!key) return;
    const c = this.data.signs.find((s) => s.key === key);
    if (!c) return;
    const z = zodiacByKey(key);
    const energy10 = Math.round(c.energy * 10);
    const hint = energy10 >= 8
      ? '今日这类能量很旺，适合主动推进想做的事。'
      : energy10 >= 6
        ? '今日能量平稳，按自己的节奏来就好。'
        : '今日能量偏低，先照顾好自己，别硬撑。';
    this.setData({
      detail: {
        key,
        name: z ? z.name : c.name,
        energy: energy10,
        percent: Math.max(4, Math.min(100, energy10 * 10)),
        hint
      }
    });
  },

  onCloseDetail() {
    this.setData({ detail: null });
  },

  /** 在详情里「设为本命星座」：复用既有切换逻辑 */
  onSetActiveFromDetail() {
    const d = this.data.detail;
    this.setData({ detail: null });
    if (d && d.key) this.pickSign(d.key);
  },

  noop() { /* 阻止弹层内容点击穿透到遮罩 */ },

  scrollToEnergy() {
    try {
      wx.pageScrollTo({ selector: '#energyCard', duration: 360 });
    } catch (_e) {
      try { wx.pageScrollTo({ scrollTop: 520, duration: 360 }); } catch (_e2) { /* 忽略 */ }
    }
  },

  /* ============================ 本命星座（既有业务） ============================ */

  onPickSign(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key) return;
    this.pickSign(key);
  },

  pickSign(key: string) {
    if (!key || key === this.data.signKey) return;
    // 与旧版完全一致：写 NS.zodiac 的 { signKey }，运势页读同一个键
    writeSignKey(key);
    const z = zodiacByKey(key);
    this.setData({ signKey: key, zodiacName: z ? z.name : '' });
    this.loadDashboard();
  },

  /* ============================ 路由（既有业务） ============================ */

  onOpenHoroscope() {
    go('/subpackages/tools/pages/astro/horoscope?sign=' + this.data.signKey);
  },

  onOpenAi() {
    go('/subpackages/tools/pages/astro/sisterChat', { title: '知心姐姐', loading: true });
  },

  onOpenModule(e: WechatMiniprogram.TouchEvent) {
    const route = e.currentTarget.dataset.route as string;
    if (!route) return;
    go(route);
  },

  onOpenRecent(e: WechatMiniprogram.TouchEvent) {
    const route = e.currentTarget.dataset.route as string;
    if (!route) return;
    go(route);
  },

  /** 底部导航 */
  onNav(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key) return;
    if (key === 'astro') {
      wx.pageScrollTo({ scrollTop: 0, duration: 260 });
      return;
    }
    const item = NAVS.find((n) => n.key === key);
    if (!item || !item.route) return;
    go(item.route, { force: true });
  },

  /* ============================ 最近足迹（既有业务） ============================ */

  applyRecent() {
    const his: RecentItem[] = [];
    const tarot = listAll<{ id: string; createdAt: number; layout: string }>(NS.tarotHis).slice(0, 3);
    tarot.forEach((t) => his.push({
      id: 'tarot_' + t.id, icon: '🃏', name: '塔罗：' + (t.layout || '单张指引'),
      timeLabel: relTime(t.createdAt), route: '/subpackages/tools/pages/astro/tarot'
    }));
    const lnr = listAll<{ id: string; createdAt: number; layout: string }>(NS.lenorHis).slice(0, 3);
    lnr.forEach((l) => his.push({
      id: 'lnr_' + l.id, icon: '🎴', name: '雷诺曼：' + (l.layout || '单张指引'),
      timeLabel: relTime(l.createdAt), route: '/subpackages/tools/pages/astro/lenormand'
    }));
    const notes = listAll<{ id: string; createdAt: number; content: string }>(NS.calNotes).slice(0, 3);
    notes.forEach((n) => his.push({
      id: 'note_' + n.id, icon: '🌒', name: '星象笔记',
      timeLabel: relTime(n.createdAt), route: '/subpackages/tools/pages/astro/starCalendar'
    }));
    const wishes = listAll<{ id: string; createdAt: number; title: string }>(NS.wish).slice(0, 3);
    wishes.forEach((w) => his.push({
      id: 'wish_' + w.id, icon: '✨', name: '心愿：' + (w.title || '未命名'),
      timeLabel: relTime(w.createdAt), route: '/subpackages/tools/pages/astro/wish'
    }));
    this.setData({ recentList: his.slice(0, 6) });
  },

  /** 点今日能量卡 → 也当作一次「注入」（给用户明确反馈） */
  onTapEnergyCard() {
    this.onTapCore();
  },

  /** image 加载失败兜底（既有业务） */
  onImgErr(e: WechatMiniprogram.CustomEvent) {
    const t = e.currentTarget as WechatMiniprogram.Image;
    if (t.dataset && (t.dataset as { fb?: string }).fb) {
      if ((t.dataset as { fb?: string }).fb === 'bg') {
        t.setData({ src: '' });
        return;
      }
    }
    if (t.src !== '/subpackages/tools/assets/astro/placeholder.jpg') {
      t.setData({ src: '/subpackages/tools/assets/astro/placeholder.jpg' });
    }
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '星语星球 · 星辰为你指引', path: '/subpackages/tools/pages/astro/index' };
  },

  onShareTimeline() {
    return { title: '星语星球 · 探索属于你的小宇宙' };
  }
});

/** 简单相对时间标签（沿用旧版实现） */
function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return Math.floor(d / 60_000) + ' 分钟前';
  if (d < 86400_000) return Math.floor(d / 3600_000) + ' 小时前';
  if (d < 30 * 86400_000) return Math.floor(d / 86400_000) + ' 天前';
  return formatDate(new Date(ts));
}

// 静默引用以保持代码结构清晰（防止未使用告警）
void parseDate;
void readJson;
