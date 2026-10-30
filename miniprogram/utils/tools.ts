// utils/tools.ts
// 工具中心注册表：定义分类 + 全量工具清单
// 每个工具分配独立 tint 辨识色（便于扫描），页面 chrome（搜索/Tab/阴影）统一吃主题 CSS 变量。
import type { ThemeKey } from '../types/index';

export type ToolCategory = 'time' | 'reminder' | 'life' | 'utility' | 'games' | 'job' | 'travel' | 'she';

export interface ToolCategoryDef {
  key: ToolCategory;
  label: string;
  icon: string;
}

export interface ToolDef {
  id: string;
  name: string;
  /** 副标题（简短的用途说明） */
  desc?: string;
  category: ToolCategory;
  /** emoji 图标 */
  icon: string;
  /** 辨识色（hex），用于图标底色，便于快速区分 */
  tint: string;
  /** 点击路由：home=回到首页；calendar=打开日历页；tool=打开工具详情页；note=便签；wish=愿望清单；ledger=记账本；memo=备忘录 */
  route?: 'home' | 'calendar' | 'tool' | 'note' | 'wish' | 'ledger' | 'memo' | 'group-reminder' | 'subscribe-reminder' | 'little-helper' | 'important-day' | 'todo-panel' | 'astro' | 'folklore' | 'games' | 'recruit' | 'asset-ledger' | 'goal-breakdown' | 'course-schedule' | 'travel' | 'photowall' | 'wheel' | 'danmaku' | 'love' | 'pomodoro';
  /** tool 详情页 type 参数 */
  widget?: string;
  /** 角标文案（内置 / NEW / 即将上线 / 去领取） */
  badge?: string;
  /** 是否占位（点击提示即将上线） */
  soon?: boolean;
  /** 小程序链接（#小程序://名称/路径），点击跳转其他小程序（如红包活动页） */
  shortLink?: string;
  /** 备选小程序链接：主链接跳转失败时自动重试（兼容名称分隔符等差异） */
  shortLinkAlt?: string;
}

export const TOOL_CATEGORIES: ToolCategoryDef[] = [
  { key: 'games', label: '闲趣', icon: '🎮' },
  { key: 'travel', label: '旅行出行', icon: '🧳' },
  { key: 'time', label: '时间进度', icon: '⏳' },
  { key: 'reminder', label: '提醒工具', icon: '🔔' },
  { key: 'job', label: '求职招聘', icon: '💼' },
  { key: 'she', label: '她的生活', icon: '🌸' },
  { key: 'life', label: '生活服务', icon: '🛒' },
  { key: 'utility', label: '实用工具', icon: '🧰' }
];

export const TOOLS: ToolDef[] = [
  // ===== 闲趣游戏（分包加载，详见 subpackages/games）=====
  {
    id: 'fun-games',
    name: '闲趣游戏',
    desc: '18 款单机小游戏',
    category: 'games',
    icon: '🎮',
    tint: '#C09A5E',
    route: 'games',
    badge: 'NEW'
  },

  // ===== 旅行出行 =====
  {
    id: 'travel',
    name: '旅行清单',
    desc: '行程 · 行李 · 预算一站管',
    category: 'travel',
    icon: '🧳',
    tint: '#4C8DAE',
    route: 'travel',
    badge: 'NEW'
  },

  // ===== 时间进度 =====
  {
    id: 'life-progress',
    name: '人生进度',
    desc: '看你的人生余额',
    category: 'time',
    icon: '🧬',
    tint: '#6E8E6E',
    route: 'tool',
    widget: 'life'
  },
  {
    id: 'year-progress',
    name: '时间进度',
    desc: '时间在流逝',
    category: 'time',
    icon: '⏳',
    tint: '#B5714C',
    route: 'tool',
    widget: 'time'
  },
  {
    id: 'life-grid',
    name: '人生格子',
    desc: '人生只有900格',
    category: 'time',
    icon: '▦',
    tint: '#749C84',
    route: 'tool',
    widget: 'lifegrid'
  },
  {
    id: 'countdown-day',
    name: '倒数日',
    desc: '期待的日子还有多久',
    category: 'time',
    icon: '📅',
    tint: '#D8A05C',
    route: 'tool',
    widget: 'countdown'
  },
  {
    id: 'holiday',
    name: '节假日',
    desc: '距离节日还有多少天',
    category: 'time',
    icon: '🎈',
    tint: '#C0522F',
    route: 'tool',
    widget: 'favorites'
  },
  {
    id: 'todo-list',
    name: '待办清单',
    desc: '日 / 月 / 年 / 全部四维',
    category: 'time',
    icon: '✅',
    tint: '#B5714C',
    route: 'todo-panel',
    badge: '内置'
  },

  // ===== 提醒工具 =====
  {
    id: 'group-reminder',
    name: '多人提醒',
    desc: '转发好友、到点通知、全程留痕',
    category: 'reminder',
    icon: '👥',
    tint: '#3b82f6',
    route: 'group-reminder',
    badge: 'NEW'
  },
  {
    id: 'subscribe-reminder',
    name: '订阅提醒',
    desc: '定时订阅、到点通知',
    category: 'reminder',
    icon: '📮',
    tint: '#C09A5E',
    route: 'subscribe-reminder',
    badge: 'NEW'
  },
  {
    id: 'little-helper',
    name: '小助手',
    desc: '问它待办、帮你创建',
    category: 'reminder',
    icon: '👩‍💼',
    tint: '#749C84',
    route: 'little-helper',
    badge: 'NEW'
  },

  // ===== 生活服务 =====
  {
    id: 'astro-hub',
    name: '星语星球',
    desc: '星座·塔罗·冥想·星愿',
    category: 'life',
    icon: '🔮',
    tint: '#C09A5E',
    route: 'astro'
  },
  {
    id: 'jd-waimai',
    name: '京东外卖红包',
    desc: '点外卖领国补红包',
    category: 'life',
    icon: '🛍️',
    tint: '#A5664B',
    // 小程序链接：由目标小程序【菜单 → 复制链接】获取，微信客户端解析目标 appId 与页面
    shortLink: '#小程序://京东购物丨点外卖领国补/hRS2HMvIzfr656E',
    badge: '领红包'
  },
  {
    id: 'meituan',
    name: '美团外卖红包',
    desc: '天天领天天省',
    category: 'life',
    icon: '🧧',
    tint: '#C08468',
    // 小程序链接：由美团外卖小程序【菜单 → 复制链接】获取，微信客户端解析目标 appId 与页面
    shortLink: '#小程序://美团丨外卖团购特价美食酒店电影/Tn7TvvVDqdYaWTh',
    badge: '去领取'
  },
  {
    id: 'eleme',
    name: '饿了么红包',
    desc: '天天领天天省',
    category: 'life',
    icon: '🛵',
    tint: '#3b82f6',
    shortLink: '#小程序://淘宝闪购l饿了么外卖美食超市/ne5tMEbu2doSxIb',
    // 备选：名称分隔符可能是「丨」（与美团链接一致），主链接失败时自动重试
    shortLinkAlt: '#小程序://淘宝闪购丨饿了么外卖美食超市/ne5tMEbu2doSxIb',
    badge: '去领取'
  },
  {
    id: 'guoxiang',
    name: '国风卦相',
    desc: '六十四卦起卦·人生疏导·生肖面相',
    category: 'life',
    icon: '☯️',
    tint: '#b45309',
    route: 'folklore',
    badge: 'NEW'
  },

  // ===== 她的生活（面向女性用户的一站式私密小屋）=====
  {
    id: 'love-hub',
    name: '爱遇小栈',
    desc: '养护·妆造·衣橱·异地恋能量站',
    category: 'she',
    icon: '🌸',
    tint: '#E0607E',
    route: 'love',
    badge: 'NEW'
  },

  // ===== 求职招聘 =====
  {
    id: 'recruit',
    name: '秋招助手',
    desc: '投递追踪·数据看板·资源库',
    category: 'job',
    icon: '💼',
    tint: '#2563eb',
    route: 'recruit',
    badge: 'NEW'
  },

  // ===== 实用工具 =====
  {
    id: 'wheel',
    name: '万能转盘',
    desc: '吃什么/去哪玩/谁来选，一转搞定',
    category: 'utility',
    icon: '🎡',
    tint: '#C08552',
    route: 'wheel',
    badge: 'NEW'
  },
  {
    id: 'photo-wall',
    name: '照片墙',
    desc: '心形·文字·节日形状拼图',
    category: 'utility',
    icon: '💞',
    tint: '#E0607E',
    route: 'photowall',
    badge: 'NEW'
  },
  {
    id: 'danmaku',
    name: '弹幕特效',
    desc: '滚动·弹出·闪烁·随机弹幕',
    category: 'utility',
    icon: '🎉',
    tint: '#C0356B',
    route: 'danmaku',
    badge: 'NEW'
  },
  {
    id: 'course-schedule',
    name: '课程表',
    desc: '导入课表 · 周次视图 · 自然语言改课',
    category: 'utility',
    icon: '📚',
    tint: '#4C8DAE',
    route: 'course-schedule',
    badge: 'NEW'
  },
  {
    id: 'goal-breakdown',
    name: '目标拆解',
    desc: '一个大目标 → 可执行任务序列',
    category: 'utility',
    icon: '🎯',
    tint: '#4C8DAE',
    route: 'goal-breakdown',
    badge: 'NEW'
  },
  {
    id: 'pomodoro',
    name: '番茄时钟',
    desc: '专注 25 分钟',
    category: 'utility',
    icon: '🍅',
    tint: '#C0522F',
    route: 'pomodoro',
    badge: 'NEW'
  },
  {
    id: 'flip-clock',
    name: '翻页时钟',
    desc: '3D 立体翻页时钟',
    category: 'utility',
    icon: '🕒',
    tint: '#7ea4f0',
    route: 'tool',
    widget: 'flipclock'
  },
  {
    id: 'memo',
    name: '备忘录',
    desc: '语音速记·清单·文件夹',
    category: 'utility',
    icon: '🎙️',
    tint: '#D8A05C',
    route: 'memo',
    badge: 'NEW'
  },
  {
    id: 'bookkeeping',
    name: '记账本',
    desc: '收支·预算·报表一站记',
    category: 'utility',
    icon: '💰',
    tint: '#6E8E6E',
    route: 'ledger',
    badge: 'NEW'
  },
  {
    id: 'asset-ledger',
    name: '资产账本',
    desc: '日均成本·订阅月供',
    category: 'utility',
    icon: '📊',
    tint: '#EA580C',
    route: 'asset-ledger',
    badge: 'NEW'
  },
  {
    id: 'sticky-note',
    name: '便签',
    desc: '随手一贴，萌系便签',
    category: 'utility',
    icon: '📌',
    tint: '#C08468',
    route: 'note',
    badge: 'NEW'
  },
  {
    id: 'important-day',
    name: '重要日',
    desc: '生日、纪念日、到期日',
    category: 'utility',
    icon: '💖',
    tint: '#C08468',
    route: 'important-day',
    badge: '内置'
  },
  {
    id: 'wish-list',
    name: '愿望清单',
    desc: '自定义心愿与进度追踪',
    category: 'utility',
    icon: '✨',
    tint: '#C09A5E',
    route: 'wish',
    badge: 'NEW'
  }
];

export interface DecoratedTool extends ToolDef {
  /** 图标底色（由 tint 派生的 rgba） */
  tintBg: string;
  /** 图标字色（由 tint 派生的实色） */
  tintText: string;
}

/** hex → rgba() 字符串 */
function rgba(hex: string, alpha: number): string {
  const h = (hex || '#B5714C').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.length === 6 ? full : 'B5714C', 16);
  if (isNaN(n)) return `rgba(181, 113, 76, ${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 为工具补充派生的图标底色/字色 */
export function decorateTool(t: ToolDef): DecoratedTool {
  return {
    ...t,
    tintBg: rgba(t.tint, 0.13),
    tintText: t.tint
  };
}

/**
 * 按关键字过滤工具（名称/描述/分类标签命中）。
 * 用泛型保留入参的具体类型——传入 DecoratedTool[] 时返回的也是 DecoratedTool[]，
 * 调用方不必再断言。
 */
export function searchTools<T extends ToolDef>(list: T[], kw: string): T[] {
  const q = (kw || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((t) => {
    const catLabel = TOOL_CATEGORIES.find((c) => c.key === t.category)?.label || '';
    const haystack = `${t.name} ${t.desc || ''} ${catLabel}`.toLowerCase();
    return haystack.indexOf(q) >= 0;
  });
}

export type ToolsThemeKey = ThemeKey;
