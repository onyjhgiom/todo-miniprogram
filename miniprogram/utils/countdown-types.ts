// utils/countdown-types.ts
// 倒数日/正数日类型定义

/** 事件类型：倒数日（剩余）/ 正数日（累计） */
export type CdType = 'countdown' | 'countup';

/** 列表筛选：全部 / 倒数日 / 正数日 / 归档 */
export type CdFilterKey = 'all' | 'countdown' | 'countup' | 'archive';

/** 事件分类 */
export type CdCategory = '生日' | '旅行' | '纪念日' | '工作' | '考试' | '自定义';

/** 情绪标签：决定卡片配色语言与文案语气（人生时刻记录册） */
export type CdEmotion = 'expect' | 'memory' | 'anniv' | 'regret' | 'miss' | 'growth';

/** 事件实体（落盘结构） */
export interface CdEvent {
  id: string;
  /** 标题 */
  title: string;
  /** 目标时间 'YYYY-MM-DD HH:mm'（精确到分） */
  target: string;
  /** 倒数日 / 正数日 */
  type: CdType;
  /** 分类 */
  category: CdCategory;
  /** 备注 */
  note: string;
  /** 置顶 */
  pinned: boolean;
  /** 已完成归档 */
  done: boolean;
  /** 情绪标签（可选，未填时按时间自动推断） */
  emotion?: CdEmotion;
  /** 卡片配图：本地路径 / 云端 fileID / 网络图 */
  photo?: string;
  /** 收藏（卡片右上角小心心） */
  fav?: boolean;
  createTime: number;
}

/** 派生展示数据（不落盘，每次渲染重算） */
export interface CdDisplay extends CdEvent {
  /** 目标是否在未来 */
  isFuture: boolean;
  /** 卡片大数字（天数） */
  bigNum: number;
  /** 动词标签：「距目标还有」/「已过去」/「已经过去」 */
  label: string;
  days: number;
  hours: number;
  mins: number;
  secs: number;
  /** 一行式天时分，如「23 天 5 时 12 分」 */
  dText: string;
  /** 倒数日已过期时的角标 */
  expiredText: string;
  /** 格式化目标时间 */
  timeText: string;
  /** ---- 情绪记录册派生 ---- */
  emotion: CdEmotion;
  emotionLabel: string;
  emotionIcon: string;
  emotionBg: string;
  emotionColor: string;
  /** 「还有 128 天」/「已过 654 天」/「就是今天 ♡」 */
  dayPhrase: string;
  /** 距今 0 天 */
  isToday: boolean;
  /** 卡片配图（可能为空 → 走情绪渐变占位） */
  photo: string;
  /** 无图时作占位渐变 */
  photoFallback: string;
  /** 目标日期 YYYY-MM-DD */
  dateText: string;
  /** 目标星期，如「周六」 */
  weekdayText: string;
  /** 收藏态 */
  fav: boolean;
  /** 卡片角标文字：手账风=情绪标签，简洁风=倒数日/正数日 */
  tagText: string;
  /** 角标配色类：pink / yellow / blue / green / purple */
  tagTone: string;
  /** 橡皮章前缀：还有 / 已过 / 就是 */
  stampPre: string;
  /** 橡皮章色调：pink / blue / gray */
  stampTone: string;
  /** 日期圆点版 YYYY.MM.DD */
  dotDate: string;
}
