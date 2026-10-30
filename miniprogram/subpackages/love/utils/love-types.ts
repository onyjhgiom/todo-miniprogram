// utils/love-types.ts
// 爱遇小栈 · 全部数据模型
//
// 设计原则：
//  1) 本地优先 —— 所有结构都能直接落 wx.storage，云端只是「可选的第二份副本」，
//     云函数没部署 / 没网络时模块 100% 可用（这是私密数据，用户更不能接受「打不开」）。
//  2) 隐私分级 —— SHARE_SCOPE 决定哪些字段可以被共享，默认只同步「关系与互动」，
//     经期数据默认**不共享**，必须用户显式打开（私密中的私密）。
//  3) 可导出 —— 全部字段都是纯 JSON，快照导入导出不丢信息。

/* ============================ 一、经期呵护 ============================ */

/** 周期四阶段 */
export type CyclePhase = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';

export interface PeriodRecord {
  id: string;
  /** 开始日 yyyy-mm-dd */
  start: string;
  /** 结束日 yyyy-mm-dd；空串表示「还在经期中」 */
  end: string;
  /** 流量 */
  flow: '' | 'light' | 'normal' | 'heavy';
  /** 痛经等级 0~3 */
  pain: number;
  /** 情绪标签 */
  moods: string[];
  /** 身体症状标签 */
  symptoms: string[];
  note: string;
  createTime: number;
}

export interface CycleSettings {
  /** 平均周期长度（天），记录 ≥2 次后由实际数据覆盖 */
  cycleLen: number;
  /** 平均经期长度（天） */
  periodLen: number;
  /** 黄体期长度（天），排卵日 = 下次开始日 - lutealLen */
  lutealLen: number;
  /** 提前几天提醒 */
  remindBefore: number;
  /** 提醒时刻（小时，24h） */
  remindHour: number;
  /** 是否开启微信通知 */
  notify: boolean;
  /** 是否已授权订阅消息 */
  subscribed: boolean;
}

/* ============================ 一·b、自在养护（皮肤 / 头发 / 身体 / 体检） ============================ */

/** 肤质 */
export type SkinType = 'dry' | 'oil' | 'comb' | 'sensitive' | 'normal';

export interface SkinProfile {
  type: SkinType;
  /** 诉求（多选） */
  concerns: string[];
  /** 日晒强度：室内为主 / 正常通勤 / 户外多 */
  sun: 'indoor' | 'normal' | 'outdoor';
  /** 过敏 / 避雷成分 */
  allergy: string;
  /** 是否在用功效型产品（酸 / A 醇等） */
  active: boolean;
}

/** 头皮类型 */
export type ScalpType = 'oil' | 'dry' | 'sensitive' | 'dandruff' | 'normal';

export interface HairProfile {
  scalp: ScalpType;
  /** 发丝粗细 */
  texture: 'fine' | 'normal' | 'thick';
  /** 是否卷发 */
  curly: boolean;
  /** 烫染损伤 */
  damage: 'none' | 'color' | 'perm' | 'both';
  /** 困扰（多选） */
  concerns: string[];
  /** 当前洗头频率（天/次） */
  washFreq: number;
}

export interface BodyProfile {
  /** 身体皮肤干燥度 */
  dryness: 'none' | 'mild' | 'severe';
  /** 有鸡皮肤（毛周角化） */
  kp: boolean;
  /** 有后背痘 */
  backAcne: boolean;
  /** 困扰（多选） */
  concerns: string[];
  /** 运动频率 */
  exercise: 'none' | 'light' | 'regular';
  /** 平均睡眠时长（小时） */
  sleep: number;
  /** 每日饮水（杯） */
  water: number;
}

/** 体检 / 疫苗提醒项 */
export interface CareCheck {
  key: string;
  name: string;
  emoji: string;
  /** 建议间隔（月） */
  intervalMonths: number;
  /** 上次完成时间（ms），0=从未 */
  lastAt: number;
  /** 补充说明 */
  note: string;
}

/* ============================ 二、妆造顾问 ============================ */

export interface BeautyPrefs {
  /** 肤质 */
  skin: 'dry' | 'oil' | 'comb' | 'sensitive';
  /** 肤色 */
  tone: 'fair' | 'medium' | 'tan';
  /** 偏好妆感（可多选） */
  styles: string[];
  /** 常去场合（可多选） */
  occasions: string[];
  /** 甲型 */
  nailShape: string;
  /** 偏好美甲风格（可多选） */
  nailStyles: string[];
  /** 避雷（过敏成分 / 不用的颜色） */
  avoid: string;
}

/* ============================ 三、穿搭与好物 ============================ */

export interface WardrobePrefs {
  /** 偏好风格（可多选，第一个为主风格） */
  styles: string[];
  /** 身形 */
  body: 'pear' | 'apple' | 'hourglass' | 'rectangle' | 'inverted';
  /** 身高段 */
  height: 'petite' | 'average' | 'tall';
  /** 预算档（由月收入/生活费推导，也可手动改） */
  budget: BudgetKey;
  /** 月可支配金额（元），0 表示未填 */
  monthly: number;
  /** 偏好色系 */
  colors: string[];
  /** 避雷（不穿的版型/材质） */
  avoid: string;
}

export type BudgetKey = 'student' | 'entry' | 'mid' | 'upper' | 'lux';

export interface OutfitQuery {
  style: string;
  occasion: string;
  season: string;
  temp: string;
}

/* ---------- 我的衣橱（真实单品，用于自动搭配一周 OOTD） ---------- */

/** 衣橱品类 */
export type WardrobeCategory =
  | 'coat' | 'top' | 'bottom' | 'dress' | 'shoes' | 'bag' | 'earring' | 'necklace' | 'hat' | 'scarf' | 'other';

/** 一件真实单品 */
export interface WardrobeItem {
  id: string;
  /** 品类 */
  cat: WardrobeCategory;
  /** 单品名（用户自填，如「米白针织开衫」） */
  name: string;
  /** 主色（色系 key，见 love-outfit 的 COLOR_FAMILY） */
  color: string;
  /** 风格标签 */
  styles: string[];
  /** 适合季节 */
  seasons: string[];
  /** 厚度/保暖 1~5（薄→厚） */
  warmth: number;
  /** 正式度 1~5（休闲→正式） */
  formality: number;
  /** 图片：云存储 fileID（cloud://）优先 */
  image: string;
  /** 本地兜底图（data:image/...;base64,），云端不可用时用这张 */
  local: string;
  /** 是否常用（常用优先被搭配） */
  fav: boolean;
  note: string;
  createTime: number;
}

/** 一周 OOTD 中的某一天 */
export interface OotdDay {
  /** 周一…周日 */
  label: string;
  date: string;
  /** 场合（周一例会…周末约会） */
  occasion: string;
  /** 组成单品（按展示顺序） */
  items: WardrobeItem[];
  /** 搭配说明 */
  reason: string;
  /** 配色说明 */
  colorNote: string;
  /** 缺件提示（空数组表示齐了） */
  missing: string[];
}

export interface OotdPlan {
  days: OotdDay[];
  /** 整体提示（如「本周有 2 天无外套可配」） */
  tips: string[];
  /** 衣橱覆盖率 %（本周用到了多少件） */
  coverage: number;
}

/* ============================ 四、异地恋能量站 ============================ */

export interface PersonProfile {
  nickname: string;
  /** 生日 yyyy-mm-dd 或 mm-dd */
  birthday: string;
  city: string;
  /** 星座（留空时由生日自动推算） */
  zodiac: string;
  mbti: string;
  hobbies: string[];
  /** 一句话形容 TA */
  words: string;
}

export interface Relation {
  /** 在一起那天 yyyy-mm-dd */
  togetherDate: string;
  /** 结缘故事 */
  story: string;
  me: PersonProfile;
  him: PersonProfile;
}

export interface Interaction {
  id: string;
  /** 互动类型 key（见 love-energy.INTERACTIONS） */
  type: string;
  /** 归属日 yyyy-mm-dd */
  date: string;
  at: number;
  /** 时长（分钟） */
  minutes: number;
  title: string;
  note: string;
  /** 本次注入的能量（写入时算好，避免每次重算） */
  energy: number;
  /** 谁发起 */
  from: 'me' | 'him';
  createTime: number;
}

export interface Memory {
  id: string;
  date: string;
  title: string;
  place: string;
  note: string;
  tags: string[];
  /**
   * 回忆配图（爱情球里的照片记忆节点）。
   * 存的是云存储 fileID（cloud://）或本地持久化路径；
   * 为空则球里退化成「emoji 玻璃卡片」，所以老数据不需要迁移。
   */
  photos?: string[];
  createTime: number;
}

export interface GiftRecord {
  id: string;
  /** me=我送他，him=他送我 */
  from: 'me' | 'him';
  title: string;
  date: string;
  price: string;
  occasion: string;
  note: string;
  createTime: number;
}

/* ============================ 四·b、想要准备的事 ============================ */

/**
 * 「想要准备的事」——给女孩子的「待办前置清单」。
 * 既可以手动添加（如「给他挑生日礼物」），也可以由生日 / 纪念日自动建议生成；
 * 每条都能一键同步到全站首页待办（todo-store.addTodo），把生活里的小惊喜落到主待办里不遗漏。
 */
export interface PrepareItem {
  id: string;
  /** 想准备的事（如「给他挑生日礼物」） */
  content: string;
  /** 打算在 yyyy-mm-dd 前准备好；空串表示不限时间 */
  due: string;
  /** 关联的人（默认对方昵称），同步到待办后作为协作人字段，一目了然是为谁准备 */
  person: string;
  /** 是否已同步到首页待办 */
  synced: boolean;
  /** 同步后首页待办的真实 id（用于撤回同步 / 去重） */
  todoId: string;
  /** 本地是否已准备好（勾选） */
  done: boolean;
  createTime: number;
}

/* ============================ 五、共享 ============================ */

export interface ShareState {
  /** 配对房间号（6 位） */
  room: string;
  /** 本机角色 */
  role: 'me' | 'him';
  bound: boolean;
  lastSync: number;
  /** 云端是否真的可用（探测成功后才置 true） */
  cloudOn: boolean;
  /** 共享范围 */
  scope: ShareScope;
  /** 最近一次同步的结果文案 */
  lastMsg: string;
}

export interface ShareScope {
  /** 关系档案（在一起天数 / 生日 / 星座 / MBTI / 故事） */
  relation: boolean;
  /** 互动与能量 */
  interaction: boolean;
  /** 回忆时间线 */
  memory: boolean;
  /** 礼物记录 */
  gift: boolean;
  /** 经期数据（默认关闭——私密） */
  cycle: boolean;
}

/** 一份可导出的共享快照 */
export interface LoveSnapshot {
  v: number;
  at: number;
  room: string;
  from: 'me' | 'him';
  relation?: Relation;
  interactions?: Interaction[];
  memories?: Memory[];
  gifts?: GiftRecord[];
  cycle?: { records: PeriodRecord[]; settings: CycleSettings };
}

/* ============================ 六、皮肤 ============================ */

export type SkinKey =
  | 'dream'
  | 'peach' | 'lilac' | 'mint' | 'sakura'
  | 'berry' | 'caramel' | 'aurora' | 'strawberry';

/* ============================ 七、天气（可降级） ============================ */

export interface CityWeather {
  /** true=真实天气；false=本地季节估算 */
  live: boolean;
  city: string;
  text: string;
  temp: string;
  icon: string;
  /** 出行/穿衣建议 */
  tip: string;
  /** 恶劣天气预警（空串表示无） */
  warning: string;
  /** 预警级别 none/notice/severe */
  level: 'none' | 'notice' | 'severe';
  /** 给他/给她的具体行动建议 */
  actions: string[];
  /** 数据来源说明（对用户透明） */
  source: string;
}
