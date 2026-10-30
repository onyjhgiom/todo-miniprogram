// subpackages/travel/utils/travel-types.ts
// 「旅行模式」数据模型
//
// 与主包待办模型（types/index.d.ts 的 ITodo）相互独立，理由：
//   1) 主包体积已达 2.1M（接近 2MB 上限），把旅行塞进主包会挤压普通待办；
//   2) 行李 / 行程条目字段重，若混入 todos 集合会污染待办列表、日历、看板与四维视图，
//      违反「普通待办功能回归零影响」；
//   3) 底层能力是复用的：cloud 调用层、主题外壳、导航、订阅消息、本地存储 toolkit。
//
// 因此这里定义独立模型，但在语义与字段形态上尽量对齐 ITodo（content/completed/…），
// 让勾选、提醒、进度统计这些交互模式保持一致。

/* ============================ 枚举 ============================ */

/** 行李分类（支持自定义，这里给出预置值） */
export type PackingCategory =
  | '证件'
  | '衣物'
  | '洗漱'
  | '电子'
  | '药品'
  | '母婴'
  | '其他';

/** 行程条目类型 */
export type TripItemType = '交通' | '景点' | '餐厅' | '酒店' | '购物' | '自定义';

/** 旅行场景（决定行李模板推荐） */
export type TravelScene =
  | '度假'
  | '出差'
  | '亲子'
  | '户外'
  | '海边'
  | '滑雪'
  | '露营';

/** 行程状态 */
export type TripStatus = 'planning' | 'ongoing' | 'done';

/** 费用分类（与行程条目类型的映射见 travel-store） */
export type CostCategory = '交通' | '住宿' | '餐饮' | '门票' | '购物' | '其他';

/* ============================ 主体 ============================ */

/** 地点（腾讯云位置服务 / wx.chooseLocation 的返回子集） */
export interface IPlace {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

/** 行程主表 */
export interface ITrip {
  _id: string;
  _openid?: string;
  /** 行程标题，如「成都 4 日游」 */
  title: string;
  /** 目的地（城市名） */
  destination: string;
  /** 出发日 yyyy-mm-dd */
  startDate: string;
  /** 返程日 yyyy-mm-dd */
  endDate: string;
  /** 封面图：cloud://fileID 或本地临时路径或预设封面 key */
  cover: string;
  /** 总预算（元） */
  budget: number;
  /** 同行者昵称列表 */
  members: string[];
  /** 场景标签（可多选，驱动行李推荐与路线模板匹配） */
  scenes: TravelScene[];
  /** 境外行程的货币信息 */
  currency: { code: string; symbol: string; rate: number } | null;
  /** 是否已归档（结束并复盘后） */
  archived: boolean;
  createTime: number;
  updateTime: number;
}

/** 行李物品（type=packing 语义） */
export interface IPackingItem {
  _id: string;
  _openid?: string;
  tripId: string;
  name: string;
  category: PackingCategory | string;
  /** 数量 */
  count: number;
  /** 所属人（同行者昵称；空表示公共） */
  owner: string;
  /** 是否必备 */
  isEssential: boolean;
  /** 是否已打包（对应待办 completed） */
  packed: boolean;
  /** 出发前 N 天提醒（如证件提前 7 天）；0/未设置表示不提醒 */
  reminderDaysBefore: number;
  /** 备注 */
  note: string;
  /** 排序号（数字小排前） */
  order: number;
  /** 来源模板名（用于复盘「哪些没用到」） */
  fromTemplate: string;
  createTime: number;
  updateTime: number;
}

/** 行程条目（type=trip 语义） */
export interface ITripPlanItem {
  _id: string;
  _openid?: string;
  /** 所属行程 */
  tripId: string;
  /** 标题，如「亚龙湾潜水」 */
  content: string;
  /** 第几天（从 1 开始） */
  day: number;
  /** 开始时间 "HH:mm" */
  startTime: string;
  /** 预计分钟数 */
  duration: number;
  /** 地点 */
  location: IPlace | null;
  itemType: TripItemType;
  /** 预算花费（元） */
  cost: number;
  note: string;
  /** 门票 / 订单链接 */
  ticketUrl: string;
  /** 是否已完成（对应待办 completed） */
  completed: boolean;
  /** 同天内排序号 */
  order: number;
  createTime: number;
  updateTime: number;
}

/** 旅行日记（复盘素材） */
export interface ITripNote {
  _id: string;
  tripId: string;
  /** 第几天 */
  day: number;
  text: string;
  /** 照片 fileID 列表 */
  photos: string[];
  createTime: number;
  updateTime: number;
}

/* ============================ 模板 ============================ */

/** 行李模板项 */
export interface IPackingTemplateItem {
  name: string;
  category: PackingCategory | string;
  count: number;
  isEssential: boolean;
  /** 建议提前提醒天数 */
  reminderDaysBefore?: number;
}

/** 行李模板（一种模式） */
export interface IPackingTemplate {
  /** 模板唯一键 */
  key: string;
  /** 模板名，如「海边度假」 */
  name: string;
  icon: string;
  /** 归属场景 */
  scene: TravelScene | '通用';
  desc: string;
  items: IPackingTemplateItem[];
}

/** 路线模板中的一天 */
export interface IRouteTemplateDay {
  day: number;
  label: string;
  items: {
    content: string;
    startTime: string;
    duration: number;
    itemType: TripItemType;
    cost?: number;
    note?: string;
    locationName?: string;
  }[];
}

/** 路线模板（按目的地匹配） */
export interface IRouteTemplate {
  key: string;
  /** 模板名，如「成都 4 日经典」 */
  name: string;
  /** 适配目的地关键字（模糊匹配） */
  destinations: string[];
  days: number;
  budgetHint: number;
  scenes: TravelScene[];
  dayList: IRouteTemplateDay[];
}

/* ============================ 派生展示 ============================ */

/** 行程卡片视图数据 */
export interface TripCard {
  trip: ITrip;
  /** 倒计时文案，如「距离出发还有 3 天」 */
  countdownText: string;
  /** 倒计时语义（用于配色） */
  countdownKey: 'traveling' | 'soon' | 'future' | 'past';
  /** 剩余天数（负数表示已结束） */
  daysLeft: number;
  totalDays: number;
  /** 行程条目数 */
  itemCount: number;
  doneItemCount: number;
  /** 行李进度 */
  packedCount: number;
  packingTotal: number;
  packingPercent: number;
  /** 已花/预算 */
  spentCost: number;
  budgetPercent: number;
  overBudget: boolean;
}

/** 按天分组后的行程（详情页用） */
export interface TripDayGroup {
  day: number;
  /** 该天日期 yyyy-mm-dd */
  date: string;
  dateText: string;
  weekdayText: string;
  items: ITripPlanItem[];
  cost: number;
  duration: number;
}

/** 费用统计 */
export interface CostStat {
  category: CostCategory;
  amount: number;
  percent: number;
  count: number;
}

/** 行李分类分组（清单页用） */
export interface PackingGroup {
  category: string;
  items: IPackingItem[];
  total: number;
  packed: number;
  percent: number;
  essentialLeft: number;
}

/** 复盘报告 */
export interface TripSummary {
  trip: ITrip;
  visitedPlaces: { name: string; count: number }[];
  totalDays: number;
  itemTotal: number;
  itemDone: number;
  completionPercent: number;
  costTotal: number;
  costByCategory: CostStat[];
  budgetLeft: number;
  overBudget: boolean;
  /** 勾了但整趟没派上用场（复盘页让用户勾选） */
  unusedItems: IPackingItem[];
  /** 必备但没勾 */
  missingItems: IPackingItem[];
  packingPercent: number;
  /** 计划 vs 实际：计划耗时 / 计划花费 */
  plannedMinutes: number;
  plannedCost: number;
  notes: ITripNote[];
  photoCount: number;
}
