// subpackages/tools/utils/asset-store.ts
// 资产账本数据层：实物资产（日均成本）+ 订阅支出（月均固定支出）
//
// 与主包 utils/ledger-store.ts（收支流水）刻意分开：定位不同 ——
//   · 流水记账答的是「钱花到哪去了」
//   · 资产账本答的是「一件东西每天/每月摊多少钱」
// 两者 storage key 独立，互不污染。分包页面引用主包 utils 是允许的，
// 反向不行，所以这里自带一份金额格式化，不依赖主包 money.ts。

const ASSET_KEY = 'al_assets_v1';
const SPEND_KEY = 'al_spends_v1';
const SEED_KEY = 'al_seed_v1';
/** 示例数据增量补种的哨兵键（详见 topUpSpendSeed） */
const SEED_TOPUP_KEY = 'al_seed_topup_v2';

const DAY = 86400000;

/* ==================== 类型 ==================== */

/** 服役中 / 已退役 / 已卖出 */
export type AssetStatus = 'serving' | 'retired' | 'sold';
/** 贷款月供 / 固定支出 */
export type SpendKind = 'loan' | 'fixed';

export interface IAsset {
  id: string;
  name: string;
  /** 产品图（emoji 占位，避免引入真实商品图版权素材） */
  icon: string;
  /** 价格，单位：分 */
  price: number;
  categoryId: string;
  status: AssetStatus;
  /** 购入日（当天 0 点时间戳） */
  purchaseAt: number;
  /** 预期使用年限，用于算折旧进度与目标日期 */
  lifeYears: number;
  /** 质保时长（月），0 = 无质保 / 未填写 */
  warrantyMonths: number;
  note: string;
  createTime: number;
}

export interface ISpend {
  id: string;
  name: string;
  /** 品牌 logo 用「色块 + 文字」还原，比图片素材更稳 */
  logoText: string;
  logoBg: string;
  logoFg: string;
  /** 无 logo 时的 emoji（贷款类用产品图） */
  icon: string;
  /** 总价（分），贷款类有意义 */
  amount: number;
  /** 周期费（分）：月供 或 订阅月费 */
  fee: number;
  kind: SpendKind;
  categoryId: string;
  /** 总期数，0 = 不限（订阅类） */
  periods: number;
  /** 已还/已付期数 */
  paidPeriods: number;
  /** 下次缴费日（当天 0 点时间戳） */
  nextDueAt: number;
  createTime: number;
}

/**
 * 卡片视图模型。
 * 资产卡与订阅卡在参考图里**结构完全一致**（图上：左产品图 + 右状态徽章 / 名称 /
 * 副信息 / 大金额 + 单位 / 进度条 / 底部两栏），只是字段含义不同，
 * 所以两种数据在 store 层就归一化成同一个 VM，WXML 只需一套模板。
 */
export interface ICardVM {
  id: string;
  domain: 'asset' | 'spend';
  name: string;
  /** 图片区形态：emoji 大图 / 品牌色块 */
  picKind: 'emoji' | 'logo';
  picEmoji: string;
  picText: string;
  picBg: string;
  picFg: string;
  /** 右上状态徽章 */
  badge: string;
  badgeColor: string;
  /** 名称下的副信息行 */
  meta: string;
  /** 大金额 + 单位（单位在后，如 ¥0 累计） */
  num: string;
  unit: string;
  /** 金额行右侧（标签在前，如「剩余 ¥162,180」） */
  sideLabel: string;
  sideNum: string;
  showBar: boolean;
  progress: number;
  footLeft: string;
  footRight: string;
  /** 底部左侧是否带日历小图标（订阅类） */
  footIcon: boolean;
  /** 质保行（资产专用）：空字符串表示无质保信息，模板据此隐藏该行 */
  warrantyLine: string;
  /** 质保行配色：质保中绿、已过保灰 */
  warrantyColor: string;
  /** 按质保剩余天数排序用（无质保置 +∞，排最后） */
  sortWarranty: number;
  categoryId: string;
  /** 筛选用：serving/retired/sold 或 loan/fixed */
  statusKey: string;
  sortMain: number;
  sortRemain: number;
  sortPrice: number;
  /** 搜索用（名称 + 分类名 + 副信息） */
  keyword: string;
}

export interface IOverview {
  title: string;
  badge: string;
  k1Label: string;
  k1Value: string;
  k2Label: string;
  k2Value: string;
  stats: Array<{ label: string; value: number; color: string }>;
}

export interface ICategoryDef {
  id: string;
  name: string;
}

/* ==================== 常量 ==================== */

export const ASSET_STATUS_META: Record<AssetStatus, { text: string; color: string }> = {
  serving: { text: '服役中', color: '#22C55E' },
  retired: { text: '已退役', color: '#9CA3AF' },
  sold: { text: '已卖出', color: '#9CA3AF' }
};

export const SPEND_KIND_META: Record<SpendKind, { text: string; color: string }> = {
  loan: { text: '月供中', color: '#22C55E' },
  fixed: { text: '使用中', color: '#22C55E' }
};

export const ASSET_STATUS_CHIPS: ICategoryDef[] = [
  { id: 'all', name: '全部' },
  { id: 'serving', name: '服役中' },
  { id: 'retired', name: '已退役' },
  { id: 'sold', name: '已卖出' }
];

export const SPEND_KIND_CHIPS: ICategoryDef[] = [
  { id: 'all', name: '全部' },
  { id: 'loan', name: '贷款月供' },
  { id: 'fixed', name: '固定支出' }
];

export interface ISortOption extends ICategoryDef {
  key: 'main' | 'remain' | 'warranty' | 'price' | 'name';
}

export const ASSET_SORTS: ISortOption[] = [
  { id: 'main', key: 'main', name: '按日均成本（高→低）' },
  { id: 'remain', key: 'remain', name: '按剩余天数（少→多）' },
  { id: 'warranty', key: 'warranty', name: '按质保剩余（少→多）' },
  { id: 'price', key: 'price', name: '按价格（高→低）' },
  { id: 'name', key: 'name', name: '按名称' }
];

export const SPEND_SORTS: ISortOption[] = [
  { id: 'main', key: 'main', name: '按月均支出（高→低）' },
  { id: 'remain', key: 'remain', name: '按距缴费天数（近→远）' },
  { id: 'price', key: 'price', name: '按周期费（高→低）' },
  { id: 'name', key: 'name', name: '按名称' }
];

/* ==================== 工具 ==================== */

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysAgo(n: number): number {
  return todayStart() - n * DAY;
}

function daysLater(n: number): number {
  return todayStart() + n * DAY;
}

/** 千分位 */
function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 分 → 金额串。
 * 整元不显示小数（¥315,597），有零头才补两位（¥1,580.58）——
 * 参考图里「资产总额」是整数、『日均成本』带小数，正是这个规则。
 */
export function money(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(Math.round(cents));
  const yuan = Math.floor(a / 100);
  const fen = a % 100;
  const body = fen === 0 ? group(yuan) : `${group(yuan)}.${String(fen).padStart(2, '0')}`;
  return (neg ? '-¥' : '¥') + body;
}

/** 时间戳 → 2036/1/8 */
export function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function clampPct(v: number): number {
  if (!isFinite(v) || v <= 0) return 0;
  return v > 100 ? 100 : v;
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function read<T>(key: string): T[] {
  try {
    const v = wx.getStorageSync(key);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch (_e) {
    return [];
  }
}

function write(key: string, list: unknown[]): void {
  try {
    wx.setStorageSync(key, list);
  } catch (_e) {
    /* 忽略：本地存储写失败不应影响已上屏的数据 */
  }
}

/* ==================== 示例数据 ==================== */

/**
 * 首次进入灌一份示例数据，让页面一打开就是「有内容、可计算」的状态。
 * 天数用「相对今天」生成而不是写死绝对日期 —— 这样无论哪一天首次打开，
 * 已用天数都与参考图一致，日均成本自然也对得上。
 */
function seedAssets(): IAsset[] {
  const mk = (
    name: string, icon: string, yuan: number, categoryId: string,
    usedDays: number, lifeYears: number, warrantyMonths: number, status: AssetStatus
  ): IAsset => ({
    id: uid('as'),
    name,
    icon,
    price: yuan * 100,
    categoryId,
    status,
    purchaseAt: daysAgo(usedDays),
    lifeYears,
    warrantyMonths,
    note: '',
    createTime: Date.now()
  });

  return [
    // 质保时长按常见口径：整车 4 年 / 苹果 1 年（Apple Watch 已用 960 天 → 演示「已过保」）
    mk('特斯拉', '🚗', 300000, 'vehicle', 207, 10, 48, 'serving'),
    mk('Mac mini m4', '🖥️', 3799, 'digital', 127, 5, 12, 'serving'),
    mk('iphone air', '📱', 5299, 'digital', 56, 1, 12, 'serving'),
    mk('Applewatch Ultra2', '⌚', 6499, 'digital', 960, 5, 12, 'serving')
  ];
}

/**
 * 每月支出示例数据 —— 刻意铺满十几个分类。
 *
 * 为什么不再只灌 3 条：这一侧的「可记录范围」全靠分类体现，示例数据只覆盖
 * 数码 / 通信两类时，用户看不出这个账本能记什么（房租、保险、会员、分期都记不了）。
 * 现在每个主要分类至少有一条，打开页面就能对照着删改。
 *
 * 前三项与 v1 示例**逐字段保持一致**（特斯拉 / Saily / Tello）：
 * 既方便跟最初的参考图对账，也保证老数据补种（见 ensureSeed）前后口径不变。
 *
 * `paidPeriods` 对订阅类是「已缴期数」，配合 createTime 落在半年前，
 * 卡片上的「累计 / 月均」才有内容 —— createTime 若等于今天，已用月数被夹到 1，
 * 月均会等于累计，看起来像算错了。前三项刻意留 0，与参考图一致。
 */
function seedSpends(): ISpend[] {
  /** 订阅：emoji 图标 */
  const fx = (name: string, categoryId: string, feeYuan: number, dueDays: number, icon: string): ISpend => ({
    id: uid('sp'),
    name,
    logoText: '',
    logoBg: '',
    logoFg: '',
    icon,
    amount: 0,
    fee: feeYuan * 100,
    kind: 'fixed',
    categoryId,
    periods: 0,
    paidPeriods: 0,
    nextDueAt: daysLater(dueDays),
    createTime: Date.now()
  });

  /** 订阅：品牌色块（logo 文字 + 底色 + 字色，字色按底色亮度取黑或白） */
  const fxLogo = (
    name: string, categoryId: string, feeYuan: number, dueDays: number,
    logoText: string, logoBg: string, logoFg: string,
    paidPeriods = 0, createdDaysAgo = 0
  ): ISpend => ({
    id: uid('sp'),
    name,
    logoText,
    logoBg,
    logoFg,
    icon: '',
    amount: 0,
    fee: feeYuan * 100,
    kind: 'fixed',
    categoryId,
    periods: 0,
    paidPeriods,
    nextDueAt: daysLater(dueDays),
    createTime: createdDaysAgo ? daysAgo(createdDaysAgo) : Date.now()
  });

  /** 分期 / 月供 */
  const loan = (
    name: string, categoryId: string, icon: string, totalYuan: number,
    feeYuan: number, periods: number, paidPeriods: number, dueDays: number
  ): ISpend => ({
    id: uid('sp'),
    name,
    logoText: '',
    logoBg: '',
    logoFg: '',
    icon,
    amount: totalYuan * 100,
    fee: feeYuan * 100,
    kind: 'loan',
    categoryId,
    periods,
    paidPeriods,
    nextDueAt: daysLater(dueDays),
    createTime: Date.now()
  });

  return [
    /* ---- v1 的三条，保持原样（与参考图逐项对得上）---- */
    loan('特斯拉', 'vehicle', '🚗', 300000, 3060, 60, 7, 23),
    fxLogo('Saily', 'telecom', 7, 28, 'Saily', '#FFD60A', '#161616'),
    fxLogo('Tello', 'telecom', 39, 26, 'tello', '#1B4FD8', '#FFFFFF'),

    /* ---- 分期：数码电子 ---- */
    loan('iPhone 17 Pro', 'digital', '📱', 8999, 750, 12, 3, 12),

    /* ---- 影音娱乐 ---- */
    fxLogo('Netflix', 'media', 75, 9, 'Netflix', '#E50914', '#FFFFFF', 6, 183),
    fxLogo('Spotify', 'media', 15, 18, 'Spotify', '#1DB954', '#FFFFFF', 6, 183),

    /* ---- 软件工具 ---- */
    fxLogo('ChatGPT', 'software', 140, 20, 'ChatGPT', '#10A37F', '#FFFFFF', 6, 183),
    fx('iCloud+', 'software', 21, 15, '☁️'),

    /* ---- 游戏充值 ---- */
    fx('原神月卡', 'game', 30, 11, '🎮'),

    /* ---- 房屋居住 / 车辆交通 ---- */
    fx('房租', 'housing', 3200, 3, '🏠'),

    /* ---- 运动健康 / 保险保障 ---- */
    fx('健身房月卡', 'fitness', 299, 25, '🏋️'),
    fx('百万医疗险', 'insurance', 58, 5, '🛡️'),

    /* ---- 生活服务 / 家庭人情 ---- */
    fx('外卖会员', 'life', 15, 8, '🍔'),
    fx('家用生活费', 'family', 1000, 1, '🧧')
  ];
}

/** 首次进入灌示例数据；已有数据（哪怕是空数组）不再重复灌 */
export function ensureSeed(): void {
  let seeded = false;
  try {
    seeded = !!wx.getStorageSync(SEED_KEY);
  } catch (_e) {
    seeded = false;
  }
  if (!seeded) {
    write(ASSET_KEY, seedAssets() as unknown[]);
    write(SPEND_KEY, seedSpends() as unknown[]);
    try {
      wx.setStorageSync(SEED_KEY, 1);
    } catch (_e) {
      /* 忽略 */
    }
    return;
  }
  topUpSpendSeed();
}

/** v1 示例数据的 3 条（按月费识别）—— 用来判断用户是否原封没动过 */
const SEED_V1_SPENDS: Array<{ name: string; fee: number }> = [
  { name: '特斯拉', fee: 3060 * 100 },
  { name: 'Saily', fee: 7 * 100 },
  { name: 'Tello', fee: 39 * 100 }
];

/**
 * 示例数据增量补种（只补一次）。
 *
 * 背景：v1 的「每月支出」只灌了 3 条示例，分类也只有两个。分类扩到十几个之后，
 * 老用户进去会看到一堆空分类 —— 他们并不会因此丢掉数据，但也看不到新分类长什么样。
 *
 * 安全性是这里的硬约束：**只在用户原封没动过 v1 示例数据时才补**（条数一致 +
 * 逐条名称与月费都对得上）。用户哪怕只加过一条、删过一条，或者换过任意字段，
 * 都直接跳过 —— 宁可看不到新示例，也绝不覆盖真实数据。
 */
function topUpSpendSeed(): void {
  try {
    if (wx.getStorageSync(SEED_TOPUP_KEY)) return;
  } catch (_e) {
    return; // 存储不可用时不做任何写入
  }
  const list = loadSpends();
  const untouched =
    list.length === SEED_V1_SPENDS.length &&
    SEED_V1_SPENDS.every((sample, i) => list[i].name === sample.name && list[i].fee === sample.fee);
  if (untouched) write(SPEND_KEY, seedSpends() as unknown[]);
  try {
    wx.setStorageSync(SEED_TOPUP_KEY, 1);
  } catch (_e) {
    /* 忽略 */
  }
}

/* ==================== 读写 ==================== */

/**
 * 历史分类 id 迁移表。
 * `esim` 这个分类已从「每月支出」的分类清单里移除，手机套餐类统一归到 `telecom`（通信网络）——
 * 已经落过本地存储的旧数据要靠这张表接住，否则旧记录会掉成「未分类」。
 */
const LEGACY_CAT: Record<string, string> = { esim: 'telecom' };

/** 把历史分类 id 迁到当前分类体系；没有需要迁移的项时原样返回（引用不变，省一次写盘） */
function migrateCat<T extends { categoryId: string }>(list: T[]): T[] {
  let dirty = false;
  const out = list.map((it) => {
    const next = LEGACY_CAT[it.categoryId];
    if (!next) return it;
    dirty = true;
    return Object.assign({}, it, { categoryId: next });
  });
  return dirty ? out : list;
}

export function loadAssets(): IAsset[] {
  const list = read<IAsset>(ASSET_KEY);
  const fixed = migrateCat(list);
  if (fixed !== list) write(ASSET_KEY, fixed);
  return fixed;
}
export function saveAssets(list: IAsset[]): void {
  write(ASSET_KEY, list);
}
export function loadSpends(): ISpend[] {
  const list = read<ISpend>(SPEND_KEY);
  const fixed = migrateCat(list);
  if (fixed !== list) write(SPEND_KEY, fixed);
  return fixed;
}
export function saveSpends(list: ISpend[]): void {
  write(SPEND_KEY, list);
}

export function newAsset(patch?: Partial<IAsset>): IAsset {
  return Object.assign(
    {
      id: uid('as'),
      name: '',
      icon: '📦',
      price: 0,
      categoryId: '',
      status: 'serving' as AssetStatus,
      purchaseAt: todayStart(),
      lifeYears: 3,
      warrantyMonths: 0,
      note: '',
      createTime: Date.now()
    },
    patch || {}
  );
}

export function newSpend(patch?: Partial<ISpend>): ISpend {
  return Object.assign(
    {
      id: uid('sp'),
      name: '',
      logoText: '',
      logoBg: '#2B2D31',
      logoFg: '#FFFFFF',
      icon: '💳',
      amount: 0,
      fee: 0,
      kind: 'fixed' as SpendKind,
      categoryId: '',
      periods: 0,
      paidPeriods: 0,
      nextDueAt: daysLater(30),
      createTime: Date.now()
    },
    patch || {}
  );
}

/* ==================== 派生：资产 ==================== */

/** 单个资产的日均成本（分，未舍入）—— 合计时必须用未舍入值再舍入，否则误差累积 */
export function assetDailyCents(a: IAsset): number {
  const used = Math.max(1, Math.round((todayStart() - a.purchaseAt) / DAY));
  return a.price / used;
}

export function assetUsedDays(a: IAsset): number {
  return Math.max(0, Math.round((todayStart() - a.purchaseAt) / DAY));
}

export function assetTotalDays(a: IAsset): number {
  return Math.max(1, Math.round(a.lifeYears * 365.25));
}

/** 质保到期日（0 / 负数时长视为无质保，返回 0） */
export function assetWarrantyExpireAt(a: IAsset): number {
  if (!a.warrantyMonths || a.warrantyMonths <= 0) return 0;
  return a.purchaseAt + Math.round(a.warrantyMonths * 30.44 * DAY);
}

/**
 * 质保剩余天数：>=0 在保，<0 已过保，null 表示无质保信息。
 * 用「相对今天」算而非存绝对日期，所以种子数据无论哪天打开都对得上。
 */
export function assetWarrantyRemainDays(a: IAsset): number | null {
  const exp = assetWarrantyExpireAt(a);
  if (!exp) return null;
  return Math.round((exp - todayStart()) / DAY);
}

export function assetView(a: IAsset, catName: string): ICardVM {
  const used = Math.max(1, assetUsedDays(a));
  const total = assetTotalDays(a);
  const remain = Math.max(0, total - used);
  const statusMeta = ASSET_STATUS_META[a.status] || ASSET_STATUS_META.serving;

  // 质保行：无质保则不显示；有过保 / 在保两种状态，配色与状态徽章一致
  const wRemain = assetWarrantyRemainDays(a);
  let warrantyLine = '';
  let warrantyColor = '';
  if (wRemain !== null) {
    const exp = assetWarrantyExpireAt(a);
    if (wRemain >= 0) {
      warrantyLine = `质保至 ${ymd(exp)} · 剩 ${wRemain} 天`;
      warrantyColor = '#22C55E';
    } else {
      warrantyLine = `质保至 ${ymd(exp)} · 已过保 ${-wRemain} 天`;
      warrantyColor = '#9CA3AF';
    }
  }

  return {
    id: a.id,
    domain: 'asset',
    name: a.name || '未命名资产',
    picKind: 'emoji',
    picEmoji: a.icon || '📦',
    picText: '',
    picBg: '',
    picFg: '',
    badge: statusMeta.text,
    badgeColor: statusMeta.color,
    meta: `${money(a.price)} · 已用 ${used} 天`,
    num: money(assetDailyCents(a)),
    unit: '/天',
    sideLabel: '',
    sideNum: '',
    showBar: true,
    progress: clampPct((used / total) * 100),
    footLeft: `已用 ${used} 天`,
    footRight: `可用 ${remain} 天`,
    footIcon: false,
    warrantyLine,
    warrantyColor,
    sortWarranty: wRemain === null ? Number.POSITIVE_INFINITY : wRemain,
    categoryId: a.categoryId,
    statusKey: a.status,
    sortMain: assetDailyCents(a),
    sortRemain: remain,
    sortPrice: a.price,
    keyword: `${a.name} ${catName}`.toLowerCase()
  };
}

/* ==================== 派生：订阅 ==================== */

/** 周期费折算到「每月」（当前只支持按月，预留后续扩展） */
export function spendMonthlyCents(s: ISpend): number {
  return s.fee;
}

/** 已使用月数（至少 1），用于算「实际月均」 */
function usedMonths(s: ISpend): number {
  return Math.max(1, Math.round((todayStart() - s.createTime) / (DAY * 30.44)) || 1);
}

export function spendDaysToDue(s: ISpend): number {
  return Math.max(0, Math.round((s.nextDueAt - todayStart()) / DAY));
}

export function spendView(s: ISpend, catName: string): ICardVM {
  const kindMeta = SPEND_KIND_META[s.kind] || SPEND_KIND_META.fixed;
  const due = spendDaysToDue(s);
  const isLoan = s.kind === 'loan';

  const remainPeriods = Math.max(0, s.periods - s.paidPeriods);
  const remainCents = remainPeriods * s.fee;
  const accumulated = s.paidPeriods * s.fee;
  const monthlyAvg = Math.round(accumulated / usedMonths(s));

  // 贷款卡：主金额 = 月供；右侧 = 剩余未还金额
  // 订阅卡：主金额 = 累计已付；右侧 = 实际月均
  const vm: ICardVM = {
    id: s.id,
    domain: 'spend',
    name: s.name || '未命名订阅',
    picKind: s.logoText ? 'logo' : 'emoji',
    picEmoji: s.icon || '💳',
    picText: s.logoText,
    picBg: s.logoBg,
    picFg: s.logoFg,
    badge: kindMeta.text,
    badgeColor: kindMeta.color,
    meta: isLoan
      ? `${money(s.amount)} · 已还 ${s.paidPeriods}/${s.periods} 期`
      : `周期费 ${money(s.fee)} · 每月`,
    num: money(isLoan ? s.fee : accumulated),
    unit: isLoan ? '/月' : '累计',
    sideLabel: isLoan ? '剩余' : '月均',
    sideNum: money(isLoan ? remainCents : monthlyAvg),
    showBar: isLoan && s.periods > 0,
    progress: isLoan && s.periods > 0 ? clampPct((s.paidPeriods / s.periods) * 100) : 0,
    footLeft: isLoan ? `已还 ${s.paidPeriods}/${s.periods} 期` : `距缴费还有 ${due} 天`,
    footRight: isLoan ? `还有 ${due} 天` : '',
    footIcon: !isLoan,
    warrantyLine: '',
    warrantyColor: '',
    sortWarranty: 0,
    categoryId: s.categoryId,
    statusKey: s.kind,
    sortMain: isLoan ? spendMonthlyCents(s) : monthlyAvg,
    sortRemain: due,
    sortPrice: s.fee,
    keyword: `${s.name} ${catName}`.toLowerCase()
  };
  return vm;
}

/* ==================== 分类与聚合 ==================== */

/** 分类 Tab 由数据里真实出现过的分类去重生成，未分类不占位 */
/** 分类 Tab：固定展示**全部**分类（「全部」置顶），尚未录入资产的分类也显示，
 *  让录入口在 Tab 上一目了然。早期版本只展示数据中出现过的分类，
 *  导致新增分类在录完第一件之前在 Tab 上不可见。 */
export function buildCategoryTabs(defs: ICategoryDef[]): ICategoryDef[] {
  return [{ id: 'all', name: '全部' }, ...defs];
}

/**
 * 资产总览。日均成本合计用**未舍入值求和后舍入**：
 * 逐项先舍入再相加会累积误差（参考图 1,580.58 就是未舍入求和的结果）。
 */
export function assetOverview(list: IAsset[]): IOverview {
  const totalPrice = list.reduce((s, a) => s + a.price, 0);
  const sumDaily = list.reduce((s, a) => s + assetDailyCents(a), 0);
  const count = (st: AssetStatus) => list.filter((a) => a.status === st).length;
  return {
    title: '资产总览',
    badge: `${list.length} 件`,
    k1Label: '资产总额',
    k1Value: money(totalPrice),
    k2Label: '日均成本',
    k2Value: money(sumDaily),
    stats: [
      { label: '服役中', value: count('serving'), color: ASSET_STATUS_META.serving.color },
      { label: '已退役', value: count('retired'), color: ASSET_STATUS_META.retired.color },
      { label: '已卖出', value: count('sold'), color: ASSET_STATUS_META.sold.color }
    ]
  };
}

/** 支出总览。本月待支付 = 各订阅的月费合计 */
export function spendOverview(list: ISpend[]): IOverview {
  const monthlyTotal = list.reduce((s, x) => s + spendMonthlyCents(x), 0);
  const countKind = (k: SpendKind) => list.filter((x) => x.kind === k).length;
  const near7 = list.filter((x) => spendDaysToDue(x) <= 7).length;
  return {
    title: '支出总览',
    badge: `${list.length} 项`,
    k1Label: '月均固定支出',
    k1Value: money(monthlyTotal),
    k2Label: '本月待支付',
    k2Value: money(monthlyTotal),
    stats: [
      { label: '贷款月供', value: countKind('loan'), color: '#F59E0B' },
      { label: '固定支出', value: countKind('fixed'), color: ASSET_STATUS_META.serving.color },
      { label: '近 7 天', value: near7, color: ASSET_STATUS_META.retired.color }
    ]
  };
}

/* ==================== 排序 / 过滤 / 分列 ==================== */

export function sortCards(list: ICardVM[], key: ISortOption['key']): ICardVM[] {
  const out = list.slice();
  if (key === 'name') {
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return out;
  }
  if (key === 'remain') {
    out.sort((a, b) => a.sortRemain - b.sortRemain);
    return out;
  }
  if (key === 'price') {
    out.sort((a, b) => b.sortPrice - a.sortPrice);
    return out;
  }
  if (key === 'warranty') {
    out.sort((a, b) => a.sortWarranty - b.sortWarranty);
    return out;
  }
  out.sort((a, b) => b.sortMain - a.sortMain);
  return out;
}

/**
 * 瀑布流分列。
 * 参考图两列卡片高度不一（左列第 1 张明显比右列第 1 张高），
 * 说明不是等高 grid，而是各列独立排布。这里按索引奇偶分列，
 * 顺序确定、可预期，不用 column-count（那会变成竖向填充，顺序不可控）。
 */
export function splitColumns(list: ICardVM[]): { left: ICardVM[]; right: ICardVM[] } {
  const left: ICardVM[] = [];
  const right: ICardVM[] = [];
  list.forEach((item, i) => {
    if (i % 2 === 0) left.push(item);
    else right.push(item);
  });
  return { left, right };
}

/* ==================== 增删改 ==================== */

export function upsertAsset(item: IAsset): void {
  const list = loadAssets();
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
  saveAssets(list);
}

export function removeAsset(id: string): void {
  saveAssets(loadAssets().filter((x) => x.id !== id));
}

export function upsertSpend(item: ISpend): void {
  const list = loadSpends();
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
  saveSpends(list);
}

export function removeSpend(id: string): void {
  saveSpends(loadSpends().filter((x) => x.id !== id));
}

export function findAsset(id: string): IAsset | undefined {
  return loadAssets().find((x) => x.id === id);
}

export function findSpend(id: string): ISpend | undefined {
  return loadSpends().find((x) => x.id === id);
}
