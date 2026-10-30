// subpackages/tools/pages/asset-ledger/asset-ledger.ts
// 资产账本：我的资产（日均成本）+ 每月支出（订阅 / 分期月供）
//
// 视觉按参考图 1:1 还原：自定义导航（页面内大字标题 + 搜索圆钮）、
// 概览卡、分类 Tab、筛选胶囊 + 排序、两列瀑布流卡片、底部三个圆矩形按钮 dock，
// 以及内容区右下角唯一的浮动新建按钮（右上角原本的加号已移除 —— 它要跟微信原生
// 胶囊抢横向空间，且离拇指最远）。
//
// 数据层见 subpackages/tools/utils/asset-store.ts（与收支流水账本完全独立）。

import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { replace, back, stackDepth } from '../../../../utils/nav';
import { getNavMetrics } from '../../utils/navbar';
import {
  ensureSeed, loadAssets, loadSpends, upsertAsset, upsertSpend,
  removeAsset, removeSpend, findAsset, findSpend,
  assetView, spendView, assetOverview, spendOverview,
  buildCategoryTabs, sortCards, splitColumns,
  newAsset, newSpend,
  ASSET_STATUS_CHIPS, SPEND_KIND_CHIPS, ASSET_SORTS, SPEND_SORTS,
  ASSET_STATUS_META
} from '../../utils/asset-store';
import type {
  IAsset, ISpend, ICardVM, IOverview, ICategoryDef, ISortOption, AssetStatus, SpendKind
} from '../../utils/asset-store';
import type { ThemeKey } from '../../../../types/index';

/* ==================== 常量 ==================== */

/**
 * 资产分类（Tab 由数据里真实出现过的分类动态生成，未分类不占 Tab）。
 * 括号里是各分类覆盖的子类，仅作归类说明（细类不单独建类，避免 Tab 过长）：
 *   vehicle    车        汽车、电动车、摩托车、自行车（与「车辆交通」同义，不重复建类）
 *   digital    数码电子  手机、电脑、平板、智能手表
 *   estate     房产不动产 住宅、公寓
 *   appliance  大家电    冰箱、洗衣机、空调、电视、净水器
 *   furniture  家具      沙发、桌椅、床垫、衣柜、书柜
 *   jewelry    首饰贵重品 金条、投资金饰、婚戒、名表
 *   collection 收藏爱好  手办、球鞋、邮票、钱币、潮玩
 *   books      书籍文具  教材、教辅、专业书、文具
 *   sports     运动器材  跑步机、自行车、哑铃、瑜伽垫
 *   toolkit    工具器械  电钻、工具箱、缝纫机
 *   textile    布艺服饰  名牌包、皮草、大衣、手表
 *   instrument 乐器      吉他、钢琴、电子琴、声卡、效果器
 */
const ASSET_CAT_DEFS: ICategoryDef[] = [
  { id: 'vehicle', name: '车辆交通' },
  { id: 'digital', name: '数码电子' },
  { id: 'estate', name: '房产不动产' },
  { id: 'appliance', name: '大家电' },
  { id: 'furniture', name: '家具' },
  { id: 'jewelry', name: '首饰贵重品' },
  { id: 'collection', name: '收藏爱好' },
  { id: 'books', name: '书籍文具' },
  { id: 'sports', name: '运动器材' },
  { id: 'toolkit', name: '工具器械' },
  { id: 'textile', name: '布艺服饰' },
  { id: 'instrument', name: '乐器' }
];

/** 本页深浅色偏好的存储键（底部第三个按钮写入，applyThemeToPage 读取） */
const SKIN_KEY = 'asset_ledger_skin';

/**
 * 每月支出分类 —— 与「我的资产」同级，涵盖「按月掏钱」的全部常见形态
 * （订阅会员、套餐宽带、房租房贷、分期月供、保费、学费……），
 * 而不是只有数码 / 通信两类。括号里是各分类覆盖的子项，仅作归类说明
 * （细类不单独建类，否则 Tab 会长到没法翻）：
 *   digital    数码电子  手机、电脑、平板、相机 的分期或租用
 *   telecom    通信网络  手机套餐、宽带、流量卡、eSIM
 *   media      影音娱乐  视频会员、音乐会员、流媒体、影院卡
 *   software   软件工具  云存储、AI 订阅、办公 / 设计 / 开发工具
 *   game       游戏充值  游戏月卡、点券、云游戏、加速器
 *   housing    房屋居住  房租、房贷、物业、水电燃气、供暖
 *   vehicle    车辆交通  车贷、油费 / 充电、停车、通勤月卡
 *   finance    金融借贷  消费贷、信用卡分期、花呗 / 白条
 *   insurance  保险保障  医疗险、寿险、意外险、车险、宠物险
 *   study      教育学习  网课、考证、知识付费、专栏订阅
 *   fitness    运动健康  健身房、运动 App、体检、理疗
 *   life       生活服务  外卖会员、快递、家政、洗护、宠物粮
 *   family     家庭人情  家用补贴、长辈赡养、红包礼金
 *   other      其他      不适合归到上面的偶发订阅
 * `esim` 已并入 `telecom`（手机套餐 / 流量卡统一归「通信网络」）。
 */
const SPEND_CAT_DEFS: ICategoryDef[] = [
  { id: 'digital', name: '数码电子' },
  { id: 'telecom', name: '通信网络' },
  { id: 'media', name: '影音娱乐' },
  { id: 'software', name: '软件工具' },
  { id: 'game', name: '游戏充值' },
  { id: 'housing', name: '房屋居住' },
  { id: 'vehicle', name: '车辆交通' },
  { id: 'finance', name: '金融借贷' },
  { id: 'insurance', name: '保险保障' },
  { id: 'study', name: '教育学习' },
  { id: 'fitness', name: '运动健康' },
  { id: 'life', name: '生活服务' },
  { id: 'family', name: '家庭人情' },
  { id: 'other', name: '其他' }
];

/**
 * 每个分类的推荐图标。
 * 订阅场景的图标按分类收窄 —— 选了「影音娱乐」就只出影视音乐类图标，
 * 比在 33 个混合图标里翻要快；分类没覆盖到的图标仍可在「未分类」里选。
 */
const SPEND_CAT_ICONS: Record<string, string[]> = {
  digital: ['📱', '💻', '🖥️', '⌚', '📷', '🎧', '⌨️', '🖱️', '📺', '🖨️', '💾', '🔌', '🎮', '📦'],
  telecom: ['📶', '🌐', '📡', '☎️', '🛰️', '💬', '🔌', '📱', '📩', '🧭', '📻', '🔗', '📞', '📦'],
  media: ['🎬', '🎵', '📺', '🎧', '🍿', '🎤', '📻', '🎞️', '🎭', '🎼', '📰', '🎙️', '🎨', '📖'],
  software: ['☁️', '🤖', '🧩', '📊', '🎨', '🛠️', '💾', '🔐', '🖥️', '📝', '📐', '🗂️', '⚙️', '🧠'],
  game: ['🎮', '🕹️', '👾', '🎲', '🃏', '🏆', '⚡', '💎', '🗡️', '🛡️', '🎯', '🧿', '🎰', '🚀'],
  housing: ['🏠', '🏢', '🔥', '💡', '🚿', '🧹', '🛏️', '🛠️', '🪑', '🧺', '🌡️', '🔑', '📦', '🚰'],
  vehicle: ['🚗', '⛽', '🔋', '🅿️', '🛵', '🚌', '🛞', '🧾', '🚙', '🛣️', '🔧', '🚿', '🚏', '⚡'],
  finance: ['🏦', '💳', '💰', '📉', '🧮', '💸', '📄', '⚖️', '🪙', '📊', '🗓️', '✍️', '🏧', '🧾'],
  insurance: ['🛡️', '⚕️', '🚑', '🏥', '📋', '❤️', '🧾', '🕊️', '🩺', '🏦', '📄', '👨👩👧', '🐾', '🚗'],
  study: ['📚', '🎓', '✏️', '🧠', '🖋️', '🔬', '🌍', '📝', '💡', '🗣️', '📐', '🎧', '📖', '🧑🏫'],
  fitness: ['🏋️', '🏃', '🧘', '💪', '⚽', '🎾', '⌚', '🩺', '🏊', '🚴', '🥗', '🧴', '🏸', '🧗'],
  life: ['🛒', '🍔', '📦', '🧺', '🐾', '💇', '🛵', '🧴', '🧼', '☕', '🍜', '🚚', '🎁', '🏪'],
  family: ['🧧', '👨👩👧', '🎁', '🏡', '🍚', '💝', '👵', '📮', '🧸', '🎂', '📱', '✉️', '💰', '❤️'],
  other: ['💳', '📦', '🧾', '⭐', '🔖', '🌀', '🏷️', '🧷', '📌', '🗒️', '🪄', '❓', '🎈', '🧭']
};

/** 未分类时的兜底图标（订阅场景偏「账单 / 服务」，与资产的实物图标不同） */
const SPEND_ICON_FALLBACK = [
  '💳', '📦', '🧾', '☁️', '📶', '🛒', '🏠', '🚗',
  '🎬', '🎮', '🤖', '🛡️', '📚', '🏋️', '🐾', '🎵'
];

/** 分类下标（0 = 未分类）→ 该分类的推荐图标 */
function spendIconsFor(catIndex: number): string[] {
  const def = catIndex > 0 ? SPEND_CAT_DEFS[catIndex - 1] : null;
  const list = def ? SPEND_CAT_ICONS[def.id] : null;
  return list && list.length ? list : SPEND_ICON_FALLBACK;
}

const STATUS_KEYS: AssetStatus[] = ['serving', 'retired', 'sold'];
const STATUS_NAMES = STATUS_KEYS.map((k) => ASSET_STATUS_META[k].text);

const KIND_KEYS: SpendKind[] = ['loan', 'fixed'];
const KIND_NAMES = ['贷款月供', '固定支出'];

/** emoji 图标候选：按分类粗略归拢（车 / 数码 / 家电家具 / 贵重品 / 书籍运动 / 工具服饰乐器） */
const ICON_OPTIONS = [
  '📦', '🚗', '🚲', '🛵', '🖥️', '📱', '⌚', '💻',
  '⌨️', '🖨️', '📷', '🎧', '🎮', '📺', '🧊', '🧺',
  '🏠', '🛏️', '🛋️', '🪑', '💎', '💍', '🧸', '👟',
  '📚', '✏️', '🏋️', '🔧', '🔨', '👕', '👜', '🎹',
  '🎸'
];

const LOGO_COLORS = [
  '#FFD60A', '#1B4FD8', '#EA580C', '#16A34A',
  '#7C3AED', '#0EA5E9', '#E11D48', '#111827'
];

const DAY = 86400000;

/* ==================== 类型 ==================== */

interface AssetDraftVM {
  id: string;
  name: string;
  icon: string;
  priceText: string;
  catIndex: number;
  statusIndex: number;
  dateText: string;
  lifeText: string;
  warrantyText: string;
}

interface SpendDraftVM {
  id: string;
  name: string;
  logoText: string;
  logoBg: string;
  icon: string;
  feeText: string;
  kindIndex: number;
  catIndex: number;
  amountText: string;
  periodsText: string;
  paidText: string;
  dateText: string;
}

type SortKey = ISortOption['key'];

interface ALData {
  theme: ThemeKey;
  themeStyle: string;
  /** 页面内独立的深浅色档：底部第三个按钮切换，本地持久化（与全局主题互不影响） */
  skin: 'light' | 'dark';
  /** 状态栏（刘海）高度，px —— 顶部第一段 padding */
  padTop: number;
  /** 导航行总高，px —— box-sizing:border-box 下直接作为标题行的 height（已含 padTop） */
  navTotal: number;
  /** 标题行右侧额外留白，px —— 让开微信右上角原生胶囊，否则按钮会被胶囊抢走点击 */
  navRight: number;
  tab: 'asset' | 'spend';
  title: string;
  searchOpen: boolean;
  keyword: string;
  cats: ICategoryDef[];
  chips: ICategoryDef[];
  activeCat: string;
  activeChip: string;
  sortKey: SortKey;
  sortOptions: ISortOption[];
  sortOpen: boolean;
  overview: IOverview;
  colLeft: ICardVM[];
  colRight: ICardVM[];
  total: number;
  editorOpen: boolean;
  editorTitle: string;
  isAsset: boolean;
  iconOptions: string[];
  /** 订阅表单的图标候选：随所选分类切换（分类 → 推荐图标，见 spendIconsFor） */
  spendIcons: string[];
  logoColors: string[];
  assetCatNames: string[];
  spendCatNames: string[];
  statusNames: string[];
  kindNames: string[];
  assetDraft: AssetDraftVM;
  spendDraft: SpendDraftVM;
}

/* ==================== 辅助 ==================== */

const EMPTY_OVERVIEW: IOverview = {
  title: '资产总览',
  badge: '0 件',
  k1Label: '资产总额',
  k1Value: '¥0',
  k2Label: '日均成本',
  k2Value: '¥0',
  stats: []
};

/** 分类名（给搜索关键词与副信息用） */
function catNameOf(id: string, defs: ICategoryDef[]): string {
  const d = defs.find((x) => x.id === id);
  return d ? d.name : '';
}

/** 'YYYY-MM-DD' → 当天 0 点时间戳 */
function ymdToTs(s: string): number {
  const d = new Date(`${s.replace(/\//g, '-')}T00:00:00`);
  return isFinite(d.getTime()) ? d.getTime() : Date.now();
}

/** 时间戳 → 'YYYY-MM-DD'（picker 取值格式） */
function tsToYmd(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 元（字符串）→ 分 */
function yuanToCents(s: string): number {
  const n = Number(String(s || '').replace(/[^\d.]/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** 分 → 元（编辑回填用，去掉无意义的小数尾巴） */
function centsToYuan(cents: number): string {
  const v = Math.round(cents) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/* 刘海区与胶囊避让统一走 utils/navbar.ts 的 getNavMetrics()，
 * 页面内不再自行探测状态栏高度。 */

function emptyAssetDraft(): AssetDraftVM {
  return {
    id: '',
    name: '',
    icon: ICON_OPTIONS[0],
    priceText: '',
    catIndex: 0,
    statusIndex: 0,
    dateText: tsToYmd(Date.now()),
    lifeText: '3',
    warrantyText: '0'
  };
}

function emptySpendDraft(): SpendDraftVM {
  return {
    id: '',
    name: '',
    logoText: '',
    logoBg: LOGO_COLORS[0],
    icon: SPEND_ICON_FALLBACK[0],
    feeText: '',
    kindIndex: 1,
    catIndex: 0,
    amountText: '',
    periodsText: '60',
    paidText: '0',
    dateText: tsToYmd(Date.now() + 30 * DAY)
  };
}

/* ==================== 页面 ==================== */

Page<ALData>({
  data: {
    theme: 'light',
    themeStyle: '',
    skin: 'light',
    padTop: 20,
    navTotal: 64,
    navRight: 0,
    tab: 'asset',
    title: '我的资产',
    searchOpen: false,
    keyword: '',
    cats: [{ id: 'all', name: '全部' }],
    chips: ASSET_STATUS_CHIPS,
    activeCat: 'all',
    activeChip: 'all',
    sortKey: 'main',
    sortOptions: ASSET_SORTS,
    sortOpen: false,
    overview: EMPTY_OVERVIEW,
    colLeft: [],
    colRight: [],
    total: 0,
    editorOpen: false,
    editorTitle: '新增资产',
    isAsset: true,
    iconOptions: ICON_OPTIONS,
    spendIcons: spendIconsFor(0),
    logoColors: LOGO_COLORS,
    assetCatNames: ['未分类', ...ASSET_CAT_DEFS.map((c) => c.name)],
    spendCatNames: ['未分类', ...SPEND_CAT_DEFS.map((c) => c.name)],
    statusNames: STATUS_NAMES,
    kindNames: KIND_NAMES,
    assetDraft: emptyAssetDraft(),
    spendDraft: emptySpendDraft()
  },

  onLoad() {
    ensureSeed();
    this.applyThemeToPage();
    // 自定义导航：让出刘海区，并把右上角的搜索按钮挪到微信原生胶囊左侧，
    // 否则按钮正好压在胶囊底下，点击会被胶囊抢走（表现为「按不动」）。
    const nav = getNavMetrics(40);
    this.setData({
      padTop: nav.statusBarHeight,
      navTotal: nav.navTotalHeight,
      navRight: nav.rightGap
    });
    this.refresh();
  },

  onShow() {
    this.applyThemeToPage();
  },

  applyThemeToPage() {
    const state = getThemeState();
    // 本页独立的深浅色档：优先取用户在底部按钮里切过的偏好（本地持久化），
    // 没有偏好时跟随全局主题（dark / rose 视为深色）。
    // theme 字段喂给根节点 data-theme 驱动 --al-* 的深浅覆盖块，与全局主题解耦。
    let skin: 'light' | 'dark' = state.dark ? 'dark' : 'light';
    try {
      const stored = wx.getStorageSync(SKIN_KEY);
      if (stored === 'dark' || stored === 'light') skin = stored;
    } catch (_e) {
      /* 存储不可用时跟随全局 */
    }
    this.setData({
      skin,
      theme: (skin === 'dark' ? 'dark' : 'light') as ThemeKey,
      themeStyle: state.themeStyle
    });
    // 本页是 navigationStyle: custom（页面内自绘大字标题），没有导航栏，
    // 但 setNavigationBarColor 的 frontColor 仍决定状态栏文字颜色 ——
    // 深色外观下必须切成白色，否则刘海区的黑字会糊在深底上。
    syncNavBar({ ...state, dark: skin === 'dark' });
  },

  /** 底部第三个圆矩形按钮：切换深 / 浅色并持久化偏好 */
  onSkinToggle() {
    const next: 'light' | 'dark' = this.data.skin === 'dark' ? 'light' : 'dark';
    try {
      wx.setStorageSync(SKIN_KEY, next);
    } catch (_e) {
      /* 存储失败也不阻断本次切换 */
    }
    this.applyThemeToPage();
  },

  /* ==================== 刷新 ==================== */

  refresh() {
    const { tab, keyword, activeCat, activeChip, sortKey } = this.data;
    const kw = String(keyword || '').trim().toLowerCase();
    const isAsset = tab === 'asset';

    const defs = isAsset ? ASSET_CAT_DEFS : SPEND_CAT_DEFS;
    const chips = isAsset ? ASSET_STATUS_CHIPS : SPEND_KIND_CHIPS;
    const overview = isAsset
      ? assetOverview(loadAssets())
      : spendOverview(loadSpends());

    // 概览与分类 Tab 都取「全量」口径：参考图里概览是按状态分组的全体统计，
    // 不随当前筛选变化，这样切换筛选时顶部总账保持稳定。
    const all: ICardVM[] = isAsset
      ? loadAssets().map((a: IAsset) => assetView(a, catNameOf(a.categoryId, defs)))
      : loadSpends().map((s: ISpend) => spendView(s, catNameOf(s.categoryId, defs)));

    const cats = buildCategoryTabs(defs);

    let list = all.filter((v) => {
      if (activeCat !== 'all' && v.categoryId !== activeCat) return false;
      if (activeChip !== 'all' && v.statusKey !== activeChip) return false;
      if (kw && v.keyword.indexOf(kw) < 0) return false;
      return true;
    });
    list = sortCards(list, sortKey);

    const { left, right } = splitColumns(list);

    this.setData({
      cats,
      chips,
      overview,
      colLeft: left,
      colRight: right,
      total: list.length,
      title: isAsset ? '我的资产' : '每月支出',
      sortOptions: isAsset ? ASSET_SORTS : SPEND_SORTS
    });
  },

  /* ==================== Tab / 搜索 / 筛选 / 排序 ==================== */

  onTabTap(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as 'asset' | 'spend';
    if (tab === this.data.tab) return;
    // 两个 Tab 的分类体系不同，切换时把筛选条件归零，避免出现「筛完没有结果」的困惑
    this.setData({ tab, activeCat: 'all', activeChip: 'all', sortKey: 'main' }, () => this.refresh());
  },

  onSearchToggle() {
    const open = !this.data.searchOpen;
    this.setData({ searchOpen: open, keyword: open ? this.data.keyword : '' }, () => {
      if (!open) this.refresh();
    });
  },

  onSearchInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ keyword: e.detail.value }, () => this.refresh());
  },

  onSearchClear() {
    this.setData({ keyword: '' }, () => this.refresh());
  },

  onCatTap(e: WechatMiniprogram.TouchEvent) {
    this.setData({ activeCat: e.currentTarget.dataset.id as string }, () => this.refresh());
  },

  onChipTap(e: WechatMiniprogram.TouchEvent) {
    this.setData({ activeChip: e.currentTarget.dataset.id as string }, () => this.refresh());
  },

  onSortTap() {
    this.setData({ sortOpen: true });
  },
  onSortClose() {
    this.setData({ sortOpen: false });
  },
  onSortPick(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as SortKey;
    this.setData({ sortKey: key, sortOpen: false }, () => this.refresh());
  },

  /* ==================== 卡片操作 ==================== */

  onCardTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (this.data.tab === 'asset') this.assetActions(id);
    else this.spendActions(id);
  },

  assetActions(id: string) {
    const item = findAsset(id);
    if (!item) return;
    const isServing = item.status === 'serving';
    wx.showActionSheet({
      itemList: ['编辑资料', isServing ? '标记退役' : '恢复服役', '删除资产'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.openAssetEditor(item);
        } else if (res.tapIndex === 1) {
          upsertAsset(Object.assign({}, item, { status: (isServing ? 'retired' : 'serving') as AssetStatus }));
          this.refresh();
          toast(isServing ? '已标记退役' : '已恢复服役');
        } else if (res.tapIndex === 2) {
          wx.showModal({
            title: '删除资产',
            content: `确定删除「${item.name}」？删除后日均成本合计会同步变化。`,
            success: (r) => {
              if (!r.confirm) return;
              removeAsset(id);
              this.refresh();
              toast('已删除');
            }
          });
        }
      },
      fail: () => {}
    });
  },

  spendActions(id: string) {
    const item = findSpend(id);
    if (!item) return;
    wx.showActionSheet({
      itemList: ['编辑订阅', '记录一次缴费', '删除订阅'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.openSpendEditor(item);
        } else if (res.tapIndex === 1) {
          // 缴一期：已付期数 +1，下次缴费日顺推一个月（订阅与分期都适用）
          const next = new Date(item.nextDueAt);
          next.setMonth(next.getMonth() + 1);
          upsertSpend(Object.assign({}, item, {
            paidPeriods: item.paidPeriods + 1,
            nextDueAt: next.getTime()
          }));
          this.refresh();
          toast('已记录一期缴费');
        } else if (res.tapIndex === 2) {
          wx.showModal({
            title: '删除订阅',
            content: `确定删除「${item.name}」？月均固定支出会同步变化。`,
            success: (r) => {
              if (!r.confirm) return;
              removeSpend(id);
              this.refresh();
              toast('已删除');
            }
          });
        }
      },
      fail: () => {}
    });
  },

  /* ==================== 新增 / 编辑 ==================== */

  onCreate() {
    if (this.data.tab === 'asset') this.openAssetEditor(null);
    else this.openSpendEditor(null);
  },

  openAssetEditor(item: IAsset | null) {
    this.setData({
      editorOpen: true,
      isAsset: true,
      editorTitle: item ? '编辑资产' : '新增资产',
      assetDraft: item
        ? {
            id: item.id,
            name: item.name,
            icon: item.icon,
            priceText: centsToYuan(item.price),
            catIndex: item.categoryId ? ASSET_CAT_DEFS.findIndex((c) => c.id === item.categoryId) + 1 : 0,
            statusIndex: Math.max(0, STATUS_KEYS.indexOf(item.status)),
            dateText: tsToYmd(item.purchaseAt),
            lifeText: String(item.lifeYears),
            warrantyText: String(item.warrantyMonths || 0)
          }
        : emptyAssetDraft()
    });
  },

  openSpendEditor(item: ISpend | null) {
    const catIndex = item
      ? (item.categoryId ? SPEND_CAT_DEFS.findIndex((c) => c.id === item.categoryId) + 1 : 0)
      : 0;
    // 图标候选跟着分类走：编辑已有记录时也要按它自己的分类给出推荐图标，
    // 否则打开「影音娱乐」的条目却看到一串房子汽车图标。
    const icons = spendIconsFor(catIndex);
    this.setData({
      editorOpen: true,
      isAsset: false,
      editorTitle: item ? '编辑订阅' : '新增订阅',
      spendIcons: icons,
      spendDraft: item
        ? {
            id: item.id,
            name: item.name,
            logoText: item.logoText,
            logoBg: item.logoBg || LOGO_COLORS[0],
            icon: item.icon || icons[0],
            feeText: centsToYuan(item.fee),
            kindIndex: Math.max(0, KIND_KEYS.indexOf(item.kind)),
            catIndex,
            amountText: item.amount ? centsToYuan(item.amount) : '',
            periodsText: String(item.periods || 0),
            paidText: String(item.paidPeriods || 0),
            dateText: tsToYmd(item.nextDueAt)
          }
        : emptySpendDraft()
    });
  },

  onEditorClose() {
    this.setData({ editorOpen: false });
  },
  onSheetStop() {},

  /* ---------- 资产表单 ---------- */

  onAssetField(e: WechatMiniprogram.InputEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ [`assetDraft.${key}`]: e.detail.value });
  },
  onIconPick(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'assetDraft.icon': e.currentTarget.dataset.v as string });
  },
  /** 资产分类改胶囊选择：12 类用 picker 滚轮要转半天，胶囊一眼看全、一点就到 */
  onAssetCatPick(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'assetDraft.catIndex': Number(e.currentTarget.dataset.index) || 0 });
  },
  onAssetStatusChange(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ 'assetDraft.statusIndex': Number(e.detail.value) });
  },
  onAssetDateChange(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ 'assetDraft.dateText': String(e.detail.value) });
  },

  onEditorSave() {
    if (this.data.isAsset) this.saveAsset();
    else this.saveSpend();
  },

  saveAsset() {
    const d = this.data.assetDraft;
    const name = String(d.name || '').trim();
    if (!name) {
      toast('请填写名称');
      return;
    }
    const price = yuanToCents(d.priceText);
    if (price <= 0) {
      toast('请填写价格');
      return;
    }
    const life = Number(String(d.lifeText || '').replace(/[^\d.]/g, ''));
    const lifeYears = isFinite(life) && life > 0 ? life : 3;
    const warranty = Number(String(d.warrantyText || '').replace(/[^\d.]/g, ''));
    const warrantyMonths = isFinite(warranty) && warranty > 0 ? Math.round(warranty) : 0;
    const categoryId = d.catIndex > 0 ? ASSET_CAT_DEFS[d.catIndex - 1].id : '';
    const status = STATUS_KEYS[d.statusIndex] || 'serving';

    const prev = d.id ? findAsset(d.id) : null;
    const item: IAsset = newAsset({
      id: d.id || undefined,
      name,
      icon: d.icon || ICON_OPTIONS[0],
      price,
      categoryId,
      status,
      purchaseAt: ymdToTs(d.dateText),
      lifeYears,
      warrantyMonths,
      note: prev ? prev.note : '',
      createTime: prev ? prev.createTime : Date.now()
    });
    upsertAsset(item);
    this.setData({ editorOpen: false });
    this.refresh();
    toast(d.id ? '已更新' : '已添加');
  },

  /* ---------- 订阅表单 ---------- */

  onSpendField(e: WechatMiniprogram.InputEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ [`spendDraft.${key}`]: e.detail.value });
  },
  onSpendIconPick(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'spendDraft.icon': e.currentTarget.dataset.v as string });
  },
  onLogoPick(e: WechatMiniprogram.TouchEvent) {
    this.setData({ 'spendDraft.logoBg': e.currentTarget.dataset.v as string });
  },
  onSpendKindChange(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ 'spendDraft.kindIndex': Number(e.detail.value) });
  },
  /**
   * 订阅分类改胶囊选择，并顺手把图标候选切到该分类的推荐图标。
   * 换分类时如果当前图标不在新分类的推荐里，就换成新分类的首选 ——
   * 否则选了「房屋居住」还挂着个手机图标，用户得自己想起来去改。
   * 已经选了品牌 logo 文字的条目不参与（那时图标不参与展示）。
   */
  onSpendCatPick(e: WechatMiniprogram.TouchEvent) {
    const catIndex = Number(e.currentTarget.dataset.index) || 0;
    const icons = spendIconsFor(catIndex);
    const patch: any = { 'spendDraft.catIndex': catIndex, spendIcons: icons };
    const d = this.data.spendDraft;
    if (!String(d.logoText || '').trim() && icons.indexOf(d.icon) < 0) {
      patch['spendDraft.icon'] = icons[0];
    }
    this.setData(patch);
  },
  onSpendDateChange(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ 'spendDraft.dateText': String(e.detail.value) });
  },

  saveSpend() {
    const d = this.data.spendDraft;
    const name = String(d.name || '').trim();
    if (!name) {
      toast('请填写名称');
      return;
    }
    const fee = yuanToCents(d.feeText);
    if (fee <= 0) {
      toast('请填写周期费');
      return;
    }
    const kind = KIND_KEYS[d.kindIndex] || 'fixed';
    const categoryId = d.catIndex > 0 ? SPEND_CAT_DEFS[d.catIndex - 1].id : '';
    const logoText = String(d.logoText || '').trim().slice(0, 8);
    const periods = kind === 'loan' ? Math.max(0, parseInt(String(d.periodsText || '0'), 10) || 0) : 0;
    const paid = kind === 'loan'
      ? Math.min(periods || 9999, Math.max(0, parseInt(String(d.paidText || '0'), 10) || 0))
      : Math.max(0, parseInt(String(d.paidText || '0'), 10) || 0);

    const prev = d.id ? findSpend(d.id) : null;
    const item: ISpend = newSpend({
      id: d.id || undefined,
      name,
      logoText,
      logoBg: logoText ? (d.logoBg || LOGO_COLORS[0]) : '',
      logoFg: logoText ? logoTextColor(d.logoBg) : '',
      icon: logoText ? '' : (d.icon || SPEND_ICON_FALLBACK[0]),
      amount: kind === 'loan' ? yuanToCents(d.amountText) : 0,
      fee,
      kind,
      categoryId,
      periods,
      paidPeriods: paid,
      nextDueAt: ymdToTs(d.dateText),
      createTime: prev ? prev.createTime : Date.now()
    });
    upsertSpend(item);
    this.setData({ editorOpen: false });
    this.refresh();
    toast(d.id ? '已更新' : '已添加');
  },

  /* ==================== 其他 ==================== */

  /** 返回：栈里有上一页就返回，否则（分享卡片/扫码直接进入）回工具中心 */
  onBack() {
    if (stackDepth() > 1) {
      back();
    } else {
      replace('/pages/tools/tools');
    }
  },

  onShareAppMessage() {
    return { title: '我的资产账本', path: '/subpackages/tools/pages/asset-ledger/asset-ledger' };
  }
});

/**
 * 品牌色块上的字色。
 * 参考图里 Saily 是黄底黑字、Tello 是蓝底白字 —— 按底色亮度自动选黑或白，
 * 避免用户选了浅色底却配白字看不清。
 */
function logoTextColor(bg: string): string {
  const h = String(bg || '').replace('#', '');
  if (h.length !== 6) return '#FFFFFF';
  const n = parseInt(h, 16);
  if (isNaN(n)) return '#FFFFFF';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // 感知亮度（ITU-R BT.601）
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.62 ? '#161616' : '#FFFFFF';
}
