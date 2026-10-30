// subpackages/toolbox/pages/tool/tool.ts
// 工具详情页：?type= 路由承载若干轻量小工具
//  - pomodoro  番茄时钟（专业版：双模式/3 状态/时长可调/环境音/任务关联/统计/分享/云同步）
//  - countdown 倒数日（选日期实时倒计时）
//  - time      时间进度（当天 / 当月 / 当年 剩余百分比）
//  - life      人生进度（电池电量样式：900 个月 + 出生至今月数 + 换日期/清除记录 + 励志语录）
//  - lifegrid  人生格子（900 格点亮）
//  - flipclock 翻页时钟（3D 立体翻页动画 + 时段问候 + 今日进度）
import { getThemeState, syncNavBar, applyTheme } from '../../../../utils/theme';
import { getHolidayItemsForYear, getNextHolidayItem } from '../../../../utils/holidays';
import type { HolidayYearItem } from '../../../../utils/holidays';
import { callFn, toast, handleError } from '../../../../utils/cloud';
import { SUB_TMPL_ID, requestSubscribe, grantSubscription, pushReminder, clip } from '../../../../utils/subscribe';
import * as todoStore from '../../../../utils/todo-store';
import {
  loadSettings,
  saveSettings,
  loadSession,
  saveSession,
  clearSession,
  DEFAULT_POMO_SETTINGS,
  DEFAULT_POMO_GOALS,
  loadGoals,
  saveGoals,
  loadLocalLogs,
  replaceLocalLogs,
  appendLocalLog,
  dateKey as pomoDateKey
} from '../../../../utils/pomo-storage';
import {
  buildLog,
  nextMode,
  modeSec,
  formatSec,
  adaptiveRestSec,
  pause as enginePause,
  resume as engineResume
} from '../../../../utils/pomo-engine';
import { computeStats, goalProgress } from '../../../../utils/pomo-stats';
import {
  playAmbient,
  stopAmbient,
  setAmbientVolume,
  playFinishTone,
  AMBIENT_LIST,
  TONE_LIST
} from '../../../../utils/pomo-audio';
import type {
  ThemeKey,
  ITodo,
  IPomoSettings,
  IPomoLog,
  IPomoStats,
  IPomoGoals,
  PomoMode
} from '../../../../types/index';
import {
  loadEvents as cdLoad,
  saveEvents as cdSave,
  addEvent as cdAdd,
  updateEvent as cdUpdate,
  removeEvent as cdRemove,
  togglePin as cdTogglePin,
  toggleDone as cdToggleDone,
  refreshView as cdRefreshView,
  splitTarget as cdSplitTarget,
  joinTarget as cdJoinTarget,
  defaultTarget as cdDefaultTarget,
  parseTarget as cdParseTarget,
  pickHero as cdPickHero,
  toggleFav as cdToggleFav,
  CD_EMOTIONS,
  CD_EMOTION_GROUPS,
  CD_HERO_SCRIPT,
  CD_PHOTO_POOL,
  CD_COVERS,
  defaultPhotoFor as cdDefaultPhoto
} from '../../../../utils/countdown-store';
import type {
  CdEvent, CdDisplay, CdFilterKey, CdCategory, CdType, CdEmotion
} from '../../../../utils/countdown-types';
import { buildSeedEvents, reseedCovers } from '../../../../utils/countdown-seed';
import type { CdEmotionDef } from '../../../../utils/countdown-store';

type PomodoroMode = 'focus' | 'short' | 'long';
type PomoPhase = 'idle' | 'running' | 'paused' | 'finished';
/** 时间进度表盘风格：数字金属工艺 / 光点 / 辉光随风格联动 */
type ClockStyle = 'indigo' | 'rose' | 'emerald' | 'obsidian' | 'platinum' | 'porcelain' | 'amethyst' | 'sunset';
const CLOCK_STYLES: ClockStyle[] = ['indigo', 'rose', 'emerald', 'obsidian', 'platinum', 'porcelain', 'amethyst', 'sunset'];

/** 时间进度背景氛围：叠加在页面上的装饰层（与表盘风格相互独立，可自由组合） */
type ClockBg = 'plain' | 'aurora' | 'nebula' | 'dawn' | 'lattice' | 'dots';
const CLOCK_BGS: ClockBg[] = ['plain', 'aurora', 'nebula', 'dawn', 'lattice', 'dots'];

/** 倒数日页面全局风格：配色/圆角/间距/字体统一联动的视觉方案（仅调整外观，不涉逻辑） */
/** 倒数日页面风格：a=手账风（贴纸/胶带/橡皮章）b=简洁风（圆角卡片/横向分类） */

/* ============ 人生进度（life）整页皮肤 ============ */
/** 整页皮肤：只改变页面环境氛围，电池恒定绿色流体不随皮肤变化 */
type LifeSkin = 'mist' | 'ink' | 'garden' | 'midnight' | 'neon' | 'gilded';
const LIFE_SKINS: LifeSkin[] = ['mist', 'ink', 'garden', 'midnight', 'neon', 'gilded'];

/* ============ 翻页时钟（flipclock）模块化风格 ============ */
/** 配色：背景渐变 + 光斑 + 翻页卡面 */
type FcPalette = 'dawn' | 'noir' | 'rose' | 'mint';
const FC_PALETTES: FcPalette[] = ['dawn', 'noir', 'rose', 'mint'];
/** 数字字体 */
type FcFont = 'modern' | 'serif';
const FC_FONTS: FcFont[] = ['modern', 'serif'];
/** 背景氛围层 */
type FcBg = 'aurora' | 'plain' | 'grid';
const FC_BGS: FcBg[] = ['aurora', 'plain', 'grid'];

/* 倒数日 v2：筛选与分类常量 */
const CD_FILTERS: { key: CdFilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'countdown', label: '⏳ 倒数日' },
  { key: 'countup', label: '📅 正数日' },
  { key: 'archive', label: '📦 归档' }
];
const CD_CATEGORIES: CdCategory[] = ['生日', '旅行', '纪念日', '工作', '考试', '自定义'];

/* 节假日信息中心：分类筛选 chips（横向滚动，不换行） */
const FAV_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'legal', label: '法定节假日' },
  { key: 'traditional', label: '传统节日' },
  { key: 'memorial', label: '纪念日' },
  { key: 'coming', label: '即将到来' }
];

/** 节假日收藏 / 提醒的本地存储 key */
const FAV_FAV_STORAGE_KEY = 'tool_holiday_favs';
const FAV_REMIND_STORAGE_KEY = 'tool_holiday_reminds';

/** 节假日提醒档位（actionSheet 序号 → 提前天数） */
const FAV_REMIND_OPTIONS = [
  { label: '当天', days: 0 },
  { label: '提前1天', days: 1 },
  { label: '提前3天', days: 3 },
  { label: '提前7天', days: 7 }
];

/**
 * 番茄钟缩放基准：WXSS 里所有番茄钟尺寸都写成 calc(N * var(--u))，
 * --u 由 JS 按真实窗口宽下发（**不要用 @media**：小程序的 min-aspect-ratio
 * 等媒体特性会被当恒真，导致真机上整套尺寸被放大 1.5 倍以上）。
 * < 700px 手机：1rpx（随屏自适应）；>= 700px 宽窗：0.78px 固定，避免被 rpx 撑大。
 */
function pomoUnit(windowWidth: number): string {
  const w = windowWidth > 0 ? windowWidth : 375;
  return w >= 700 ? '0.78px' : '1rpx';
}

interface ToolData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  type: string;
  title: string;
  /** 番茄钟布局缩放基准（--u），随窗口宽变化 */
  uUnit: string;
  // 番茄钟（专业版）
  pomoSettings: IPomoSettings;
  pomoMode: PomodoroMode;
  pomoPhase: PomoPhase;
  pomoTotal: number;       // 本轮设计时长（秒）
  pomoElapsed: number;     // 已累计秒数
  pomoLeft: number;        // 倒计时剩余（正计时模式 = 0）
  pomoPct: number;         // 0-100
  pomoText: string;        // '25:00' / '00:25:00'
  pomoFocusCount: number;  // 累计完成的专注轮数
  pomoTodoId: string | null;
  pomoTodoTitle: string | null;
  /** 弹层：settings/bind/stats/list/share */
  pomoPanel: '' | 'settings' | 'bind' | 'stats' | 'list' | 'share';
  pomoTodos: { _id: string; content: string }[];
  pomoLogs: IPomoLog[];
  pomoStats: IPomoStats;
  pomoGoals: IPomoGoals;
  pomoAmbientList: { key: IPomoSettings['ambient']; label: string; emoji: string }[];
  pomoToneList: { key: IPomoSettings['finishTone']; label: string; emoji: string }[];
  /** 分享卡片文案（用于 onShareAppMessage） */
  pomoShareTitle: string;
  /** 弱提示：本轮是否标记为放弃 */
  pomoAbandonConfirm: boolean;
  /** 完成弹窗内容（弹窗态）；nextMin = 已按智能休息调整后的下一轮时长 */
  pomoJustCompleted: null | {
    mode: PomodoroMode;
    minutes: number;
    nextMode: PomodoroMode;
    nextMin?: number;
    adaptive?: boolean;
  };
  /** 下一轮按智能休息调整后的时长（秒）；0 表示沿用设置值 */
  pomoNextSec: number;
  /** 最近一次完成的日志，便于复用 todo 选择 */
  pomoLastLogId: string | null;
  /** 无干扰模式开关 */
  pomoZen: boolean;
  /** 后台恢复提示文案 */
  pomoResumeHint: string;
  // 倒数日（旧版单目标字段，保留兼容；新版为事件列表）
  cdTarget: number;
  cdTargetText: string;
  cdRemain: string;
  cdLabel: string;
  cdPreset: { key: string; label: string }[];
  cdMode: 'date' | 'time';
  cdDate: string;
  cdTime: string;
  // 倒数日 v2：事件列表
  cdList: CdEvent[];
  cdActive: CdDisplay[];
  cdArchived: CdDisplay[];
  cdFilter: CdFilterKey;
  cdFilters: { key: CdFilterKey; label: string }[];
  cdCategories: CdCategory[];
  /** 编辑弹层：null=关闭，''=新建，其他=编辑 id */
  cdEditorFor: string | null;
  cdFormTitle: string;
  cdFormType: CdType;
  cdFormCategory: CdCategory;
  cdFormNote: string;
  cdFormDate: string;
  cdFormTime: string;
  /** 当前聚焦的输入字段（title/note），用于聚焦高亮描边 */
  cdFocusField: string;
  cdEditorTitle: string;
  /* ---- 人生时刻记录册（情绪 / 照片 / Hero / 分组 / 双列） ---- */
  cdEmotions: CdEmotionDef[];
  cdPhotoPool: { key: string; label: string; src: string }[];
  cdFormEmotion: CdEmotion;
  cdFormPhoto: string;
  /** Hero「未来可期」 */
  cdHero: (CdDisplay & { script: string[] }) | null;
  /** Hero 空态默认配图（无任何事件时也保持完整情绪视觉） */
  cdHeroInitPhoto: string;
  /** 横向情绪分组条 */
  cdGroups: { key: string; label: string; icon: string; color: string; soft: string; count: number }[];
  cdGroupFilter: string;
  /** 三列照片卡（平铺列表，CSS 三列自动换行） */
  cdCards: CdDisplay[];
  /** 空态三行文案 */
  cdEmptyText: string;
  cdEmptySub: string;
  cdEmptyAction: string;
  // 时间进度（当天 / 当月 / 当年已过百分比，展示层派生）
  dayPassedPct: number;
  monthPassedPct: number;
  yearPassedPct: number;
  dayCap: string;
  monthCap: string;
  yearCap: string;
  dayRemainH: string;
  dayRemainM: string;
  dayRemainS: string;
  nowLabel: string;
  nowPct: number;
  yearDay: number;
  yearTotalDays: number;
  // 人生进度（电池版，与人生格子共用出生日期）
  lifePct: number;
  lifeText: string;
  birthDate: string;
  lifeTotalDays: number;
  lifeDays: number;
  lifeMonths: number;
  lifeMonthText: string;
  lifeQuote: string;
  lifeLifespanMonths: number;
  /** 今日 = 出生阳历月日，仅为 true 时显示生日豪华祝福专区 */
  isBirthday: boolean;
  /** 生日三种风格文案（走心/俏皮/正式，按当日稳定选取） */
  bdayHeartFull: string;
  bdayFun: string;
  bdayFormal: string;
  /** 走心寄语 · 打字机实时输出 */
  bdayType: string;
  // 人生格子（p=已点亮；now=当前所在月，呼吸高亮）
  lifegridCells: { p: boolean; now: boolean }[];
  lifegridPassed: number;
  // 人生格子 · 展示层增强（计算仍走 refreshLife 原逻辑，此处仅做展示派生）
  /** 年度时间进度（已过百分比，保留 1 位小数） */
  lgYearPct: number;
  lgYearPassedDays: number;
  lgYearRemainDays: number;
  /** 人生已过进度（按所选预期寿命，保留 1 位小数） */
  lgLifePct: number;
  lgTotalCells: number;
  /** 预期寿命（岁），切换后立即重算格子墙 */
  lgLifespanYears: number;
  lgLifespanOptions: number[];
  lgLifespanIndex: number;
  /** 页面内主题选择器（全局联动 + 持久化） */
  themeChips: { key: ThemeKey; name: string; dot: string }[];
  /** 时间进度表盘风格（仅本模块，持久化） */
  clockStyle: ClockStyle;
  clockStyleChips: { key: ClockStyle; name: string; dot: string }[];
  /** 时间进度背景氛围（与表盘风格独立组合，持久化） */
  clockBg: ClockBg;
  clockBgChips: { key: ClockBg; name: string; dot: string }[];
  /** 倒数日页面全局风格（整页组件联动，持久化，仅外观） */
  cdPageStyle: CdPageStyle;
  cdPageStyleChips: { key: CdPageStyle; name: string; dot: string }[];
  /** 人生进度：整页皮肤（仅页面环境氛围；电池恒定绿色流体） */
  lifeSkin: LifeSkin;
  lifeSkinChips: { key: LifeSkin; name: string; dot: string }[];
  /** 翻页时钟：配色 / 字体 / 背景氛围 三独立维度（均持久化） */
  fcPalette: FcPalette;
  fcPaletteChips: { key: FcPalette; name: string; dot: string }[];
  fcFont: FcFont;
  fcFontChips: { key: FcFont; name: string; dot: string }[];
  fcBg: FcBg;
  fcBgChips: { key: FcBg; name: string; dot: string }[];
  // 翻页时钟
  /** 6 位数字（时十分个分十分个秒个），逐位喂给 flip-digit 组件 */
  clockDigits: string[];
  clockGreet: string;
  clockIcon: string;
  clockNoon: string;
  clockDayPct: number;
  clockDate: string;
  // 节假日信息中心
  favHero: HolidayYearItem | null;
  favList: HolidayYearItem[];
  favFilters: { key: string; label: string }[];
  favFilter: string;
  favYear: number;
  favYearIndex: number;
  favYears: number[];
  favDetail: HolidayYearItem | null;
  favDetailFaved: boolean;
  favDetailRemind: string;
  favDetailPast: boolean;
  /** 「全部」筛选下已结束节日是否展开 */
  favShowPast: boolean;
  /** 「全部」筛选下已结束节日数量 */
  favPastCount: number;
}

const POMO_MODES: { key: PomodoroMode; label: string; sec: number }[] = [
  { key: 'focus', label: '专注', sec: 25 * 60 },
  { key: 'short', label: '短休息', sec: 5 * 60 },
  { key: 'long', label: '长休息', sec: 15 * 60 }
];

const EMPTY_POMO_STATS: IPomoStats = {
  todayCount: 0,
  todayMinutes: 0,
  weekCount: 0,
  weekMinutes: 0,
  monthCount: 0,
  monthMinutes: 0,
  totalCount: 0,
  totalMinutes: 0,
  streak: 0,
  heatmap: Array.from({ length: 12 }, () => [0, 0, 0, 0, 0, 0, 0]),
  hourHistogram: new Array(24).fill(0),
  hourPeak: 1,
  timeline: [],
  bestWindow: null,
  efficientWindows: []
};

const LIFESPAN_DAYS = 80 * 365; // 按 80 岁估算
const LIFESPAN_MONTHS = 75 * 12; // 按 75 岁估算 = 900 个月

/* 人生格子：可选预期寿命（岁） */
const LIFESPAN_YEAR_OPTIONS = [60, 65, 70, 75, 80, 85, 90, 95, 100];

/* 人生格子：页面内主题选择器（切换 = 全局主题，持久化） */
const GRID_THEME_CHIPS: { key: ThemeKey; name: string; dot: string }[] = [
  { key: 'light', name: '暖陶侘寂', dot: '#B5714C' },
  { key: 'dark', name: '墨韵深炭', dot: '#3B362F' },
  { key: 'rose', name: '深邃暗夜', dot: '#6F84CE' },
  { key: 'forest', name: '晨光浅色', dot: '#6366F1' },
  { key: 'twilight', name: '暮金旧纸', dot: '#A98743' }
];

/* 时间进度：表盘风格选择器（仅本模块联动，持久化） */
const CLOCK_STYLE_CHIPS: { key: ClockStyle; name: string; dot: string }[] = [
  { key: 'indigo', name: '墨蓝夜光', dot: '#1c2650' },
  { key: 'rose', name: '玫瑰鎏金', dot: '#7c1d3a' },
  { key: 'emerald', name: '翡翠冷光', dot: '#14483a' },
  { key: 'obsidian', name: '曜石鎏金', dot: '#241a08' },
  { key: 'platinum', name: '铂银月白', dot: '#3f4a5c' },
  { key: 'porcelain', name: '青瓷月白', dot: '#12564f' },
  { key: 'amethyst', name: '紫晶幻光', dot: '#3b1f6e' },
  { key: 'sunset', name: '赤霞熔金', dot: '#7c2d12' }
];

/* 时间进度：背景氛围选择器（与表盘风格独立组合，各自持久化） */
const CLOCK_BG_CHIPS: { key: ClockBg; name: string; dot: string }[] = [
  { key: 'plain', name: '纯净底色', dot: '#e2e8f0' },
  { key: 'aurora', name: '极光流彩', dot: '#6366f1' },
  { key: 'nebula', name: '星尘光斑', dot: '#22d3ee' },
  { key: 'dawn', name: '暖晖光圈', dot: '#fbbf24' },
  { key: 'lattice', name: '月光栅格', dot: '#64748b' },
  { key: 'dots', name: '浮点粒子', dot: '#c084fc' }
];

/* 倒数日：页面风格选择器 —— 覆盖整页组件（容器/按钮/输入框/提示文字）的配色、圆角、间距、字体，持久化 */
type CdPageStyle = 'a' | 'b';
const CD_PAGE_STYLES: CdPageStyle[] = ['a', 'b'];
/** 风格切换按钮（头图右上角胶囊） */
const CD_PAGE_STYLE_CHIPS: { key: CdPageStyle; name: string; dot: string }[] = [
  { key: 'a', name: '手账风', dot: '#E0708A' },
  { key: 'b', name: '简洁风', dot: '#7F86C9' }
];

/* 人生进度：整页皮肤选择（仅改变页面环境氛围；电池恒定绿色流体，独立于皮肤） */
const LIFE_SKIN_CHIPS: { key: LifeSkin; name: string; dot: string }[] = [
  { key: 'mist', name: '晨雾绿意', dot: '#6ee7b7' },
  { key: 'ink', name: '水墨留白', dot: '#64748b' },
  { key: 'garden', name: '花园晨光', dot: '#fb7185' },
  { key: 'midnight', name: '暗夜星空', dot: '#1e293b' },
  { key: 'neon', name: '霓虹赛博', dot: '#22d3ee' },
  { key: 'gilded', name: '曜金黑金', dot: '#f59e0b' }
];

/* 翻页时钟：配色维度 */
const FC_PALETTE_CHIPS: { key: FcPalette; name: string; dot: string }[] = [
  { key: 'dawn', name: '晴空晨光', dot: '#7ea4f0' },
  { key: 'noir', name: '曜夜深空', dot: '#1e293b' },
  { key: 'rose', name: '玫瑰金晨', dot: '#e879a8' },
  { key: 'mint', name: '薄荷清晨', dot: '#34d399' }
];
/* 翻页时钟：数字字体维度 */
const FC_FONT_CHIPS: { key: FcFont; name: string; dot: string }[] = [
  { key: 'modern', name: '现代无衬线', dot: '#64748b' },
  { key: 'serif', name: '经典衬线', dot: '#b45309' }
];
/* 翻页时钟：背景氛围维度 */
const FC_BG_CHIPS: { key: FcBg; name: string; dot: string }[] = [
  { key: 'aurora', name: '柔光光斑', dot: '#a5d8ff' },
  { key: 'plain', name: '极简纯色', dot: '#e2e8f0' },
  { key: 'grid', name: '网格都市', dot: '#94a3b8' }
];

const LIFE_QUOTES = [
  '如果你想得到从未拥有过的东西，那么你必须去做从未做过的事情。',
  '种一棵树最好的时间是十年前，其次是现在。',
  '人生没有白走的路，每一步都算数。',
  '你现在的努力，是为了以后有更多的选择。',
  '别把最好的时光，浪费在无谓的等待与犹豫中。',
  '把每一天当作人生的最后一天来过，终有一天你会如愿以偿。'
];

const BDAY_HEART = [
  '愿新的一岁，你依然眼里有光、心中有海；所有美好都不期而遇，所有温柔都如约而至。',
  '岁月是一场有去无回的旅行，愿你把沿途的每一帧都过成风景；从今往后，请再多爱自己一点。',
  '愿你一生努力、一生被爱；想要的都拥有，得不到的都释怀。生日快乐，不止今天。'
];
const BDAY_FUN = [
  '叮！你的专属限量版新年龄已到货，请凭脸签收 🎁',
  '你又可爱了一岁，麻烦继续保持，让整个世界跟着你一起变甜 🍬',
  '呼叫地球！这里有一枚寿星即将发光，请备好蛋糕和掌声 🎂'
];
const BDAY_FORMAL = [
  '值此生辰之际，谨祝：新岁胜旧岁，所得皆所期，所行皆坦途。',
  '恭贺芳辰，愿君岁岁常欢愉，年年皆胜意；前程似锦，万事顺遂。',
  '衷心祝愿您在新的一岁里，身体健康、诸事顺遂、阖家幸福、喜乐绵长。'
];

const CD_PRESETS = [
  { key: 'tomorrow', label: '明天' },
  { key: 'week', label: '下周' },
  { key: 'month', label: '一个月后' },
  { key: 'year', label: '年底' }
];

let timer: ReturnType<typeof setInterval> | null = null;

/** 翻页时钟：上一次渲染的小时数（问候语/时段标签只在跨小时时更新） */
let clockHour = -1;

/** 时段问候语 */
function clockGreeting(hour: number): string {
  if (hour < 5) return '夜深了，注意休息';
  if (hour < 8) return '早安，新的一天';
  if (hour < 11) return '上午好，保持专注';
  if (hour < 13) return '午安，记得放松';
  if (hour < 17) return '下午好，稳步前行';
  if (hour < 19) return '傍晚好，收拾心情';
  if (hour < 23) return '晚上好，享受此刻';
  return '夜深了，注意休息';
}

/** 时段标签（凌晨/上午/午间/下午/晚间） */
function clockNoonLabel(hour: number): string {
  if (hour < 6) return '凌晨';
  if (hour < 12) return '上午';
  if (hour < 14) return '午间';
  if (hour < 18) return '下午';
  return '晚间';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page<ToolData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    type: 'pomodoro',
    title: '工具',
    uUnit: '1rpx',
    pomoSettings: DEFAULT_POMO_SETTINGS,
    pomoMode: 'focus',
    pomoPhase: 'idle',
    pomoTotal: 25 * 60,
    pomoElapsed: 0,
    pomoLeft: 25 * 60,
    pomoPct: 0,
    pomoText: '25:00',
    pomoFocusCount: 0,
    pomoTodoId: null,
    pomoTodoTitle: null,
    pomoPanel: '',
    pomoTodos: [],
    pomoLogs: [],
    pomoStats: EMPTY_POMO_STATS,
    pomoGoals: DEFAULT_POMO_GOALS,
    pomoAmbientList: AMBIENT_LIST,
    pomoToneList: TONE_LIST,
    pomoShareTitle: '🍅 今日专注数据卡',
    pomoAbandonConfirm: false,
    pomoJustCompleted: null,
    pomoNextSec: 0,
    pomoLastLogId: null,
    pomoZen: false,
    pomoResumeHint: '',
    cdTarget: 0,
    cdTargetText: '',
    cdRemain: '',
    cdLabel: '',
    cdPreset: CD_PRESETS,
    cdMode: 'date',
    cdDate: '',
    cdTime: '09:00',
    // 倒数日 v2：事件列表
    cdList: [] as CdEvent[],
    cdActive: [] as CdDisplay[],
    cdArchived: [] as CdDisplay[],
    cdFilter: 'all' as CdFilterKey,
    cdFilters: CD_FILTERS,
    cdCategories: CD_CATEGORIES,
    cdEditorFor: null,
    cdFormTitle: '',
    cdFormType: 'countdown' as CdType,
    cdFormCategory: '生日',
    cdFormNote: '',
    cdFormDate: '',
    cdFormTime: '09:00',
    cdFocusField: '',
    cdEditorTitle: '新建事件',
    cdEmotions: CD_EMOTIONS,
    cdPhotoPool: CD_COVERS.map((c) => ({ key: c.key, label: c.key.toUpperCase(), src: c.src })),
    cdFormEmotion: 'expect' as CdEmotion,
    cdFormPhoto: '',
    cdHero: null,
    cdHeroInitPhoto: cdDefaultPhoto('cd-init'),
    cdGroups: [],
    cdGroupFilter: 'all',
    cdCards: [],
    cdEmptyText: '',
    cdEmptySub: '',
    cdEmptyAction: '',
    dayPassedPct: 0,
    monthPassedPct: 0,
    yearPassedPct: 0,
    dayCap: '',
    monthCap: '',
    yearCap: '',
    dayRemainH: '00',
    dayRemainM: '00',
    dayRemainS: '00',
    nowLabel: '',
    nowPct: 0,
    yearDay: 0,
    yearTotalDays: 365,
    lifePct: 0,
    lifeText: '',
    birthDate: '',
    lifeTotalDays: LIFESPAN_DAYS,
    lifeDays: 0,
    lifeMonths: 0,
    lifeMonthText: '',
    lifeQuote: '',
    lifeLifespanMonths: LIFESPAN_MONTHS,
    isBirthday: false,
    bdayHeartFull: '',
    bdayFun: '',
    bdayFormal: '',
    bdayType: '',
    lifegridCells: [],
    lifegridPassed: 0,
    lgYearPct: 0,
    lgYearPassedDays: 0,
    lgYearRemainDays: 0,
    lgLifePct: 0,
    lgTotalCells: LIFESPAN_MONTHS,
    lgLifespanYears: 75,
    lgLifespanOptions: LIFESPAN_YEAR_OPTIONS,
    lgLifespanIndex: LIFESPAN_YEAR_OPTIONS.indexOf(75),
    themeChips: GRID_THEME_CHIPS,
    clockStyle: 'indigo' as ClockStyle,
    clockStyleChips: CLOCK_STYLE_CHIPS,
    clockBg: 'aurora' as ClockBg,
    clockBgChips: CLOCK_BG_CHIPS,
    cdPageStyle: 'a' as CdPageStyle,
    cdPageStyleChips: CD_PAGE_STYLE_CHIPS,
    lifeSkin: 'mist' as LifeSkin,
    lifeSkinChips: LIFE_SKIN_CHIPS,
    fcPalette: 'dawn' as FcPalette,
    fcPaletteChips: FC_PALETTE_CHIPS,
    fcFont: 'modern' as FcFont,
    fcFontChips: FC_FONT_CHIPS,
    fcBg: 'aurora' as FcBg,
    fcBgChips: FC_BG_CHIPS,
    clockDigits: ['0', '0', '0', '0', '0', '0'],
    clockGreet: '',
    clockIcon: '🌤️',
    clockNoon: '',
    clockDayPct: 0,
    clockDate: '',
    // 节假日信息中心
    favHero: null as HolidayYearItem | null,
    favList: [] as HolidayYearItem[],
    favFilters: FAV_FILTERS,
    favFilter: 'all',
    favYear: new Date().getFullYear(),
    favYearIndex: 0,
    favYears: [new Date().getFullYear(), new Date().getFullYear() + 1, new Date().getFullYear() + 2, new Date().getFullYear() + 3],
    favDetail: null as HolidayYearItem | null,
    favDetailFaved: false,
    favDetailRemind: '',
    favDetailPast: false,
    favShowPast: false,
    favPastCount: 0
  },

  onLoad(query: Record<string, string | undefined>) {
    const type = (query.type as string) || 'pomodoro';
    this.applyThemeToPage();
    this.applyPomoScale();
    this.initByType(type);
  },

  /** 把真实窗口宽换算成 --u 下发（番茄钟尺寸基准，见 pomoUnit 注释） */
  applyPomoScale() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const next = pomoUnit(info.windowWidth || 375);
      if (next !== this.data.uUnit) this.setData({ uUnit: next });
    } catch (_e) {
      /* 取不到窗口信息时沿用默认 1rpx */
    }
  },

  onShow() {
    this.applyThemeToPage();
    if (this.data.type === 'pomodoro') this.applyPomoScale();
    // 番茄钟：切后台期间计时基于时间戳，回前台要补算（可能已经走完一整轮）
    if (this.data.type === 'pomodoro') this.resumePomoOnShow();
    // 人生格子 / 时间进度：回到页面时重算（跨天/跨年后数据仍实时）
    if (this.data.type === 'lifegrid') this.refreshLifegrid();
    if (this.data.type === 'time') this.refreshTimeProgress();
    // 节假日：回前台必须重算（onHide 已停表，否则长时间停留后倒计时不再更新）
    if (this.data.type === 'favorites') {
      this.refreshHolidays();
      this.startTimer();
    }
  },

  /** 窗口尺寸变化（平板分屏 / PC 端拖拽）时重算番茄钟缩放基准 */
  onResize() {
    if (this.data.type === 'pomodoro') this.applyPomoScale();
  },

  onHide() {
    this.stopTimer();
  },

  onUnload() {
    this.stopTimer();
  },

  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient
    });
    syncNavBar(state);
  },

  initByType(type: string) {
    // 切换工具类型时停掉可能残留的生日打字机
    this.stopBdayType();
    const titleMap: Record<string, string> = {
      pomodoro: '番茄时钟',
      countdown: '倒数日',
      time: '时间进度',
      life: '人生进度',
      lifegrid: '人生格子',
      flipclock: '翻页时钟',
      favorites: '节假日倒计时'
    };
    this.setData({ type, title: titleMap[type] || '工具' });

    if (type === 'pomodoro') {
      this.bootstrapPomodoro();
      return;
    }
    if (type === 'countdown') {
      // 页面全局风格：持久化读取（空串/非法值回落简洁明亮）
      let ps: CdPageStyle = 'a';
      try {
        const v = wx.getStorageSync('tool_cd_page_style') as string;
        if (CD_PAGE_STYLES.indexOf(v as CdPageStyle) >= 0) ps = v as CdPageStyle;
      } catch (_e) { /* 忽略 */ }
      this.setData({ cdPageStyle: ps });
      this.setDefaultCountdown();
      this.cdLoadList();
      this.startTimer();
      return;
    }
    if (type === 'time') {
      // 表盘风格 + 背景氛围：双维度各自持久化读取（空串/非法值回落默认）
      this.setData({
        clockStyle: this.readStyle('tool_clock_style', CLOCK_STYLES, 'indigo') as ClockStyle,
        clockBg: this.readStyle('tool_clock_bg', CLOCK_BGS, 'aurora') as ClockBg
      });
      this.refreshTimeProgress();
      this.startTimer();
      return;
    }
    if (type === 'life') {
      const birth = wx.getStorageSync('tool_birth') as string || '1995-01-01';
      this.setData({
        birthDate: birth,
        lifeQuote: this.pickLifeQuote(),
        lifeSkin: this.readStyle('tool_life_skin', LIFE_SKINS, 'mist')
      });
      this.refreshLife();
      this.startTimer();
      return;
    }
    if (type === 'lifegrid') {
      const birth = wx.getStorageSync('tool_birth') as string || '1995-01-01';
      // 预期寿命：持久化读取（空串/非法值回落 75 岁）
      let years = 75;
      try {
        const v = Number(wx.getStorageSync('tool_lifespan_years'));
        if (LIFESPAN_YEAR_OPTIONS.indexOf(v) >= 0) years = v;
      } catch (_e) { /* 忽略 */ }
      this.setData({
        birthDate: birth,
        lgLifespanYears: years,
        lgLifespanIndex: Math.max(0, LIFESPAN_YEAR_OPTIONS.indexOf(years))
      });
      this.refreshLifegrid();
      return;
    }
    if (type === 'flipclock') {
      this.setData({
        fcPalette: this.readStyle('tool_fc_palette', FC_PALETTES, 'dawn'),
        fcFont: this.readStyle('tool_fc_font', FC_FONTS, 'modern'),
        fcBg: this.readStyle('tool_fc_bg', FC_BGS, 'aurora')
      });
      this.tickClock();
      this.startTimer();
      return;
    }
    if (type === 'favorites') {
      this.setData({ favYear: new Date().getFullYear(), favYearIndex: 0, favFilter: 'all', favDetail: null });
      this.refreshHolidays();
      // 每分钟检查一次，跨天时刷新倒计时
      this.startTimer();
      return;
    }
  },

  // ============ 番茄钟（专业版） ============

  /** 启动番茄：加载设置/恢复会话/拉取最近日志/拉取待办/刷新统计 */
  bootstrapPomodoro() {
    const settings = loadSettings();
    const session = loadSession();
    const logs = loadLocalLogs();
    const goals = loadGoals();
    const stats = computeStats(logs);
    // 设置上下文环境音（不自动开始）
    if (settings.ambient !== 'off') {
      playAmbient({ key: settings.ambient, volume: settings.ambientVolume });
    }
    this.setData({
      pomoSettings: settings,
      pomoMode: 'focus',
      pomoPhase: 'idle',
      pomoTotal: modeSec('focus', settings),
      pomoElapsed: 0,
      pomoLeft: modeSec('focus', settings),
      pomoPct: 0,
      pomoText: formatSec(settings.direction === 'down' ? modeSec('focus', settings) : 0),
      pomoFocusCount: 0,
      pomoTodoId: null,
      pomoTodoTitle: null,
      pomoPanel: '',
      pomoLogs: logs,
      pomoStats: stats,
      pomoGoals: goals,
      pomoZen: settings.zen,
      pomoAbandonConfirm: false,
      pomoJustCompleted: null,
      pomoNextSec: 0,
      pomoLastLogId: null,
      pomoResumeHint: ''
    });
    // 异步：拉取云端日志 / 待办 / 服务通知模板
    this.syncPomoLogsFromCloud();
    this.loadPomoTodos();
    // 恢复未结束的会话
    if (session && session.mode) {
      this.restorePomoSession(session);
    }
  },

  /** 从云端拉取最近 90 天日志，覆盖本地缓存 */
  async syncPomoLogsFromCloud() {
    try {
      const now = Date.now();
      const from = now - 90 * 86400000;
      const res = await callFn<{ items?: IPomoLog[]; total?: number }>('pomoLogs', {
        action: 'listRange',
        fromTs: from,
        toTs: now
      });
      if (Array.isArray(res.items)) {
        replaceLocalLogs(res.items);
        const stats = computeStats(res.items);
        this.setData({ pomoLogs: res.items.slice().sort((a, b) => b.startAt - a.startAt), pomoStats: stats });
      }
    } catch (_e) {
      // 弱网 / 降级 mock：使用本地缓存，不打扰用户
    }
  },

  /** 从云端拉取最近 30 条非已完成 todo 供绑定 */
  async loadPomoTodos() {
    try {
      await todoStore.ensureLoaded();
      const active = todoStore.rawList()
        .filter((t) => !t.completed && !t.archived)
        .slice(0, 30)
        .map((t) => ({ _id: t._id, content: t.content }));
      this.setData({ pomoTodos: active });
    } catch (_e) {
      this.setData({ pomoTodos: [] });
    }
  },

  /** 恢复未结束的会话（切后台/小程序重启后） */
  restorePomoSession(s: NonNullable<ReturnType<typeof loadSession>>) {
    const now = Date.now();
    // pausedSec 现在是「秒」（与字段名一致）
    let elapsed = Math.floor((now - s.startAt) / 1000) - s.pausedSec;
    if (s.pausedAt) {
      // 暂停中：从 startAt 算到 pausedAt 截止
      elapsed = Math.floor((s.pausedAt - s.startAt) / 1000) - s.pausedSec;
    }
    if (elapsed < 0) elapsed = 0;
    const settings = this.data.pomoSettings;
    const phase: PomoPhase = s.pausedAt ? 'paused' : 'running';
    const remaining = Math.max(0, s.plannedSec - elapsed);
    const direction = settings.direction;
    const showText = direction === 'down' ? formatSec(remaining) : formatSec(elapsed);
    const pct = Math.min(100, Math.round((elapsed / s.plannedSec) * 100));
    this.setData({
      pomoMode: s.mode,
      pomoPhase: phase,
      pomoTotal: s.plannedSec,
      pomoElapsed: elapsed,
      pomoLeft: remaining,
      pomoPct: pct,
      pomoText: showText,
      pomoFocusCount: s.focusCount,
      pomoTodoId: s.todoId,
      pomoTodoTitle: s.todoTitle,
      pomoResumeHint: '已从上次中断恢复'
    });
    if (phase === 'running') {
      this.startTimer();
    }
  },

  /**
   * 回到前台时补算番茄计时。
   * onHide 会停掉 setInterval（后台不跑空转），所以这里必须重新接上：
   *  - running：按 session 时间戳重算 elapsed；若期间已走完 → 立即结算（含提醒）
   *  - paused：只刷新显示，不启动计时
   */
  resumePomoOnShow() {
    const phase = this.data.pomoPhase;
    if (phase !== 'running' && phase !== 'paused') {
      // 事务性：不在计时态就不动，避免覆盖 finished 弹窗
      return;
    }
    const session = loadSession();
    if (!session) {
      // 会话丢失（日志清理/存储异常）：running 态就地续一个，paused 态保持
      if (phase === 'running') this.startTimer();
      return;
    }
    const now = Date.now();
    const pausedSec = session.pausedSec || 0;
    const elapsed = session.pausedAt
      ? Math.max(0, Math.floor((session.pausedAt - session.startAt) / 1000) - pausedSec)
      : Math.max(0, Math.floor((now - session.startAt) / 1000) - pausedSec);
    const total = session.plannedSec || this.data.pomoTotal;

    if (elapsed >= total) {
      // 后台期间已走完：补齐快照后直接结算，照常记日志 + 提醒
      this.setData({
        pomoElapsed: total,
        pomoLeft: 0,
        pomoPct: 100,
        pomoText: '00:00',
        pomoResumeHint: '后台已走完本轮'
      });
      this.finishPomoRound();
      return;
    }
    const remaining = total - elapsed;
    const settings = this.data.pomoSettings;
    const text = settings.direction === 'down' ? formatSec(remaining) : formatSec(elapsed);
    this.setData({
      pomoElapsed: elapsed,
      pomoLeft: remaining,
      pomoPct: Math.round((elapsed / total) * 100),
      pomoText: text,
      pomoResumeHint: '已从后台恢复'
    });
    if (phase === 'running') this.startTimer();
  },

  /** 切换专注/短休/长休（仅 idle 时切换） */
  onPomoModeTap(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as PomodoroMode;
    if (this.data.pomoPhase !== 'idle') {
      toast('当前计时中，无法切换模式');
      return;
    }
    this.resetPomodoro(mode);
  },

  /**
   * 重置当前 mode 到 idle（清空 elapsed，不打日志）
   * @param overrideSec 传入时用它作为本轮时长（智能休息调整的下一轮用）
   */
  resetPomodoro(mode: PomodoroMode, overrideSec?: number) {
    const sec = overrideSec && overrideSec > 0 ? overrideSec : modeSec(mode, this.data.pomoSettings);
    const settings = this.data.pomoSettings;
    this.stopTimer();
    this.setData({
      pomoMode: mode,
      pomoPhase: 'idle',
      pomoTotal: sec,
      pomoElapsed: 0,
      pomoLeft: settings.direction === 'down' ? sec : 0,
      pomoPct: 0,
      pomoText: formatSec(settings.direction === 'down' ? sec : 0),
      pomoAbandonConfirm: false,
      pomoJustCompleted: null,
      pomoResumeHint: ''
    });
  },

  /** 开始 / 继续 计时 */
  onPomoStart() {
    if (this.data.pomoPhase === 'running') return;
    const now = Date.now();
    let startAt = now;
    let pausedSec = 0;
    let pausedAt = 0;
    if (this.data.pomoPhase === 'paused') {
      // 继续：从 session 累加暂停秒数（本次暂停时长加入 pausedSec）
      const s = loadSession();
      if (s) {
        startAt = s.startAt;
        pausedSec = engineResume({ pausedAt: s.pausedAt, pausedSec: s.pausedSec }, now);
        pausedAt = 0;
      }
    }
    const session = {
      sid: `pomo_${startAt}_${this.data.pomoMode}`,
      mode: this.data.pomoMode,
      plannedSec: this.data.pomoTotal,
      startAt,
      pausedSec,
      pausedAt,
      todoId: this.data.pomoTodoId,
      todoTitle: this.data.pomoTodoTitle,
      focusCount: this.data.pomoFocusCount
    };
    saveSession(session);
    this.setData({
      pomoPhase: 'running',
      pomoAbandonConfirm: false,
      pomoResumeHint: ''
    });
    // 启动环境音（若已设置）
    const settings = this.data.pomoSettings;
    if (settings.ambient !== 'off') {
      playAmbient({ key: settings.ambient, volume: settings.ambientVolume });
    }
    this.startTimer();
  },

  /** 暂停 */
  onPomoPause() {
    if (this.data.pomoPhase !== 'running') return;
    const s = loadSession();
    const now = Date.now();
    const pausedSec = s ? enginePause(s.startAt, s.pausedSec, now).pausedSec : 0;
    if (s) {
      saveSession({ ...s, pausedAt: now, pausedSec });
    }
    this.stopTimer();
    this.setData({ pomoPhase: 'paused' });
    // 暂停时不关环境音（用户大概率继续）
  },

  /** 放弃：标记 abandoned 写入日志，进入 finished 态 */
  onPomoAbandon() {
    if (this.data.pomoPhase === 'idle' || this.data.pomoPhase === 'finished') return;
    if (!this.data.pomoAbandonConfirm) {
      this.setData({ pomoAbandonConfirm: true });
      setTimeout(() => {
        this.setData({ pomoAbandonConfirm: false });
      }, 3000);
      return;
    }
    this.stopTimer();
    const now = Date.now();
    const actualSec = Math.max(0, this.data.pomoElapsed);
    const session = loadSession();
    const startAt = session?.startAt || now - actualSec * 1000;
    const log = buildLog(
      {
        plannedSec: this.data.pomoTotal,
        actualSec,
        mode: this.data.pomoMode,
        startAt,
        endAt: now,
        todoId: this.data.pomoTodoId,
        todoTitle: this.data.pomoTodoTitle,
        status: 'abandoned'
      },
      pomoDateKey
    );
    appendLocalLog(log);
    this.persistLog(log);
    const newLogs = [log, ...this.data.pomoLogs];
    this.setData({
      pomoPhase: 'finished',
      pomoLogs: newLogs,
      pomoStats: computeStats(newLogs),
      pomoAbandonConfirm: false,
      pomoJustCompleted: null,
      pomoLastLogId: log._id
    });
    clearSession();
    stopAmbient();
    toast('已放弃本轮');
  },

  /** 完成一整轮 */
  finishPomoRound() {
    this.stopTimer();
    const now = Date.now();
    const session = loadSession();
    const startAt = session?.startAt || now - this.data.pomoTotal * 1000;
    const plannedSec = this.data.pomoTotal;
    const actualSec = plannedSec; // 倒计时到 0 = 完成
    const log = buildLog(
      {
        plannedSec,
        actualSec,
        mode: this.data.pomoMode,
        startAt,
        endAt: now,
        todoId: this.data.pomoTodoId,
        todoTitle: this.data.pomoTodoTitle,
        status: 'completed'
      },
      pomoDateKey
    );
    appendLocalLog(log);
    this.persistLog(log);
    const newLogs = [log, ...this.data.pomoLogs];
    const focusCount = this.data.pomoFocusCount + (this.data.pomoMode === 'focus' ? 1 : 0);
    const next = nextMode(this.data.pomoMode, focusCount - 1, this.data.pomoSettings);
    // 智能休息：下一轮是休息时，按「本轮专注时长 + 今日已完成番茄数」动态加长
    const todayCount = this.data.pomoStats.todayCount + (this.data.pomoMode === 'focus' ? 1 : 0);
    const nextSec = adaptiveRestSec(next, this.data.pomoSettings, this.data.pomoTotal, todayCount);
    const adaptiveOn = this.data.pomoSettings.adaptive && next !== 'focus' && nextSec !== modeSec(next, this.data.pomoSettings);
    this.setData({
      pomoPhase: 'finished',
      pomoFocusCount: focusCount,
      pomoNextSec: nextSec,
      pomoLogs: newLogs,
      pomoStats: computeStats(newLogs),
      pomoJustCompleted: {
        mode: this.data.pomoMode,
        minutes: Math.round(actualSec / 60),
        nextMode: next,
        nextMin: Math.round(nextSec / 60),
        adaptive: adaptiveOn
      },
      pomoLastLogId: log._id,
      pomoText: '00:00'
    });
    // 提醒
    const settings = this.data.pomoSettings;
    if (settings.vibrate) {
      try { wx.vibrateLong({}); } catch (_e) { /* 忽略 */ }
    }
    if (settings.sound) {
      playFinishTone(settings.finishTone, settings.toneVolume);
    }
    if (settings.subscribe && this.data.pomoMode === 'focus' && SUB_TMPL_ID) {
      // 微信服务通知：仅当后台已配置模板才请求授权，避免 tmplIds 空数组报错
      void requestSubscribe(SUB_TMPL_ID).then((s) => {
        if (s === 'accept') toast('已开启休息提醒');
        else if (s === 'reject' || s === 'fail') toast('未开启，仅本机提示');
      });
    }
    stopAmbient();
    clearSession();
  },

  /** 上传单条日志到云端（失败时静默） */
  async persistLog(log: IPomoLog) {
    try {
      await callFn('pomoLogs', { action: 'upsert', ...log });
    } catch (_e) {
      // 已写本地缓存，下次同步会补
    }
  },

  /** 重置按钮：回到当前模式 idle 态（wxml 多处 bindtap="onPomoReset"） */
  onPomoReset() {
    this.resetPomodoro(this.data.pomoMode);
    this.setData({ pomoJustCompleted: null });
    stopAmbient();
  },

  /** 进入下一轮（短/长/专注），时长沿用智能休息算出的结果 */
  onPomoNext() {
    const just = this.data.pomoJustCompleted;
    const nextModeKey: PomodoroMode = just ? just.nextMode : 'focus';
    const override = this.data.pomoNextSec > 0 ? this.data.pomoNextSec : undefined;
    this.resetPomodoro(nextModeKey, override);
    this.setData({ pomoJustCompleted: null, pomoNextSec: 0 });
    const settings = this.data.pomoSettings;
    if (settings.autoCycle) {
      // 自动开始下一轮
      setTimeout(() => this.onPomoStart(), 200);
    }
  },

  /** 跳过休息（短/长休 → 下一轮 focus） */
  onPomoSkipRest() {
    if (this.data.pomoMode === 'focus') {
      toast('专注中，请先暂停或放弃');
      return;
    }
    this.stopTimer();
    clearSession();
    const settings = this.data.pomoSettings;
    this.setData({ pomoPhase: 'idle', pomoMode: 'focus' });
    this.resetPomodoro('focus');
    if (settings.autoCycle) {
      setTimeout(() => this.onPomoStart(), 200);
    }
  },

  /** 每秒 tick：根据 elapsed 重算快照 */
  tickPomodoro() {
    if (this.data.pomoPhase !== 'running') return;
    const session = loadSession();
    const now = Date.now();
    let elapsed: number;
    if (session) {
      if (session.pausedAt) {
        // 不应发生在 running 状态
        return;
      }
      elapsed = Math.floor((now - session.startAt) / 1000) - session.pausedSec;
    } else {
      elapsed = this.data.pomoElapsed + 1;
    }
    if (elapsed < 0) elapsed = 0;
    if (elapsed >= this.data.pomoTotal) {
      this.setData({
        pomoElapsed: this.data.pomoTotal,
        pomoLeft: 0,
        pomoPct: 100,
        pomoText: '00:00'
      });
      this.finishPomoRound();
      return;
    }
    const remaining = this.data.pomoTotal - elapsed;
    const settings = this.data.pomoSettings;
    const text = settings.direction === 'down' ? formatSec(remaining) : formatSec(elapsed);
    const pct = Math.round((elapsed / this.data.pomoTotal) * 100);
    this.setData({
      pomoElapsed: elapsed,
      pomoLeft: remaining,
      pomoPct: pct,
      pomoText: text
    });
  },

  /** 打开/关闭 设置弹层 */
  onPomoPanel(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as '' | 'settings' | 'bind' | 'stats' | 'list' | 'share';
    this.setData({ pomoPanel: this.data.pomoPanel === key ? '' : key });
  },

  /** 关闭弹层 */
  onPomoPanelClose() {
    this.setData({ pomoPanel: '' });
  },

  /** 面板内部空白处：阻止冒泡到 mask（避免误关闭） */
  onPomoPanelStop() {
    /* noop - 仅作为 catchtap 注册锚点，截断事件冒泡 */
  },

  /** 修改设置项（segment / switch 共用入口） */
  onPomoSettingChange(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as keyof IPomoSettings;
    // switch 的 detail.value 是布尔；segment 通过 data-value 传字面量
    let value: unknown;
    if (e.detail && (e.detail as { value?: unknown }).value !== undefined) {
      value = (e.detail as { value: unknown }).value;
    } else {
      value = e.currentTarget.dataset.value;
    }
    if (!key) return;
    const next: IPomoSettings = { ...this.data.pomoSettings, [key]: value as never };
    saveSettings(next);
    const patch: Partial<ToolData> = { pomoSettings: next };
    if (this.data.pomoPhase === 'idle' && (key === 'focusSec' || key === 'shortSec' || key === 'longSec')) {
      const sec = modeSec(this.data.pomoMode, next);
      patch.pomoTotal = sec;
      patch.pomoLeft = next.direction === 'down' ? sec : 0;
      patch.pomoText = formatSec(next.direction === 'down' ? sec : 0);
    }
    if (key === 'zen') {
      patch.pomoZen = !!value;
    }
    this.setData(patch);
  },

  /** 试听结束音 */
  onPomoPreviewTone(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as IPomoSettings['finishTone'];
    playFinishTone(key, this.data.pomoSettings.toneVolume);
  },

  /** 选择环境音（off = 关闭） */
  onPomoAmbientTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as IPomoSettings['ambient'];
    const next: IPomoSettings = { ...this.data.pomoSettings, ambient: key };
    saveSettings(next);
    if (key === 'off') stopAmbient();
    else playAmbient({ key, volume: next.ambientVolume });
    this.setData({ pomoSettings: next });
  },

  /** 调整环境音音量 */
  onPomoAmbientVolume(e: WechatMiniprogram.TouchEvent) {
    const v = Math.max(0, Math.min(1, ((e.detail as { value: number }).value || 0) / 100));
    const next: IPomoSettings = { ...this.data.pomoSettings, ambientVolume: v };
    saveSettings(next);
    setAmbientVolume(v);
    this.setData({ pomoSettings: next });
  },

  /** 调整结束音音量 */
  onPomoToneVolume(e: WechatMiniprogram.TouchEvent) {
    const v = Math.max(0, Math.min(1, ((e.detail as { value: number }).value || 0) / 100));
    const next: IPomoSettings = { ...this.data.pomoSettings, toneVolume: v };
    saveSettings(next);
    this.setData({ pomoSettings: next });
  },

  /** 调整长休触发轮次（2-12） */
  onPomoLongEveryStep(e: WechatMiniprogram.TouchEvent) {
    if (this.data.pomoPhase !== 'idle') {
      toast('计时中无法调整');
      return;
    }
    const delta = Number(e.currentTarget.dataset.delta || 0);
    const cur = this.data.pomoSettings.longEvery;
    const next = Math.max(2, Math.min(12, cur + delta));
    const nextSettings: IPomoSettings = { ...this.data.pomoSettings, longEvery: next };
    saveSettings(nextSettings);
    this.setData({ pomoSettings: nextSettings });
  },

  /** 调整时长（分钟），step ±1 */
  onPomoDurationStep(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as 'focusSec' | 'shortSec' | 'longSec';
    const delta = Number(e.currentTarget.dataset.delta || 0);
    if (this.data.pomoPhase !== 'idle') {
      toast('计时中无法调整');
      return;
    }
    const cur = this.data.pomoSettings[key];
    const min = 60;     // 1 分钟
    const max = 90 * 60; // 90 分钟
    const next = Math.max(min, Math.min(max, cur + delta * 60));
    const nextSettings: IPomoSettings = { ...this.data.pomoSettings, [key]: next };
    saveSettings(nextSettings);
    const sec = modeSec(this.data.pomoMode, nextSettings);
    this.setData({
      pomoSettings: nextSettings,
      pomoTotal: sec,
      pomoLeft: nextSettings.direction === 'down' ? sec : 0,
      pomoText: formatSec(nextSettings.direction === 'down' ? sec : 0)
    });
  },

  /** 调整今日/本周番茄目标（±1） */
  onPomoGoalStep(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as 'dailyTarget' | 'weeklyTarget';
    const delta = Number(e.currentTarget.dataset.delta || 0);
    const min = 1;
    const max = key === 'dailyTarget' ? 30 : 200;
    const next = Math.max(min, Math.min(max, (this.data.pomoGoals?.[key] ?? 0) + delta));
    const nextGoals: IPomoGoals = { ...this.data.pomoGoals, [key]: next };
    saveGoals(nextGoals);
    this.setData({ pomoGoals: nextGoals });
  },

  /** 绑定待办：把 todoId/title 写入当前会话与下次开始 */
  onPomoBindTodo(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const t = this.data.pomoTodos.find((x) => x._id === id);
    if (!t) return;
    this.setData({ pomoTodoId: t._id, pomoTodoTitle: t.content, pomoPanel: '' });
    const session = loadSession();
    if (session) saveSession({ ...session, todoId: t._id, todoTitle: t.content });
    toast(`已绑定：${t.content}`);
  },

  /** 解绑 */
  onPomoUnbindTodo() {
    this.setData({ pomoTodoId: null, pomoTodoTitle: null });
    const session = loadSession();
    if (session) saveSession({ ...session, todoId: null, todoTitle: null });
  },

  /** 把当前会话标记的待办进度推进：completed=true + 时间戳 */
  async onPomoMarkTodoDone() {
    if (!this.data.pomoTodoId) return;
    try {
      await callFn('todos', {
        action: 'toggle',
        id: this.data.pomoTodoId,
        completed: true
      });
      toast('已标记完成');
      this.loadPomoTodos();
    } catch (err) {
      handleError(err, '标记失败');
    }
  },

  /** 切无干扰模式 */
  onPomoZenToggle() {
    const next = !this.data.pomoZen;
    const nextSettings: IPomoSettings = { ...this.data.pomoSettings, zen: next };
    saveSettings(nextSettings);
    this.setData({ pomoZen: next, pomoSettings: nextSettings });
  },

  /** 分享：触发系统分享面板（标题已预设） */
  onPomoShareAppMessage(): WxPageShareContent {
    const s = this.data.pomoStats;
    const title = `🍅 今日完成 ${s.todayCount} 个番茄 · ${s.todayMinutes} 分钟 · 连续打卡 ${s.streak} 天`;
    return {
      title,
      path: '/pages/tools/tools',
      imageUrl: ''
    };
  },

  /** 清空本地日志缓存（设置 → 重置） */
  onPomoClearLogs() {
    try {
      wx.removeStorageSync('pomo_logs_cache');
    } catch (_e) { /* 忽略 */ }
    this.setData({ pomoLogs: [], pomoStats: EMPTY_POMO_STATS });
    toast('本地日志已清空');
  },

  // ============ 倒数日 ============
  setDefaultCountdown() {
    // 默认目标：明天 09:00
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
    const cdDate = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
    const cdTime = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
    this.setData({ cdDate, cdTime });
    this.applyCountdownTarget(target.getTime());
  },

  applyCountdownTarget(ts: number) {
    const remain = this.remainText(ts);
    this.setData({
      cdTarget: ts,
      cdTargetText: fmtDate(ts),
      cdRemain: remain
    });
  },

  onCdPreset(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const now = new Date();
    let target: Date;
    if (key === 'tomorrow') target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
    else if (key === 'week') target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 9, 0, 0);
    else if (key === 'month') target = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate(), 9, 0, 0);
    else target = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    this.applyCountdownTarget(target.getTime());
  },

  onCdDateChange(e: WechatMiniprogram.PickerChangeEvent) {
    const v = e.detail.value as string;
    this.setData({ cdDate: v }, () => this.rebuildCountdown());
  },

  onCdTimeChange(e: WechatMiniprogram.PickerChangeEvent) {
    const v = e.detail.value as string;
    this.setData({ cdTime: v }, () => this.rebuildCountdown());
  },

  rebuildCountdown() {
    const { cdDate, cdTime } = this.data;
    if (!cdDate) return;
    const [y, m, d] = cdDate.split('-').map(Number);
    const [hh, mm] = (cdTime || '09:00').split(':').map(Number);
    const target = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
    this.applyCountdownTarget(target.getTime());
  },

  remainText(ts: number): string {
    if (!ts) return '';
    const diff = ts - Date.now();
    if (diff <= 0) return '⏰ 已经到了！';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (days > 0) return `${days} 天 ${hours} 小时 ${mins} 分`;
    if (hours > 0) return `${hours} 小时 ${mins} 分 ${secs} 秒`;
    if (mins > 0) return `${mins} 分 ${secs} 秒`;
    return `${secs} 秒`;
  },

  tickCountdown() {
    this.setData({ cdRemain: this.remainText(this.data.cdTarget) });
    // 事件列表：分钟级动态刷新（天/时/分推进）
    this.cdRefresh();
  },

  // ============ 倒数日 v2：事件列表（增删改 / 置顶 / 归档 / 筛选） ============

  /** 加载事件列表并渲染 */
  cdLoadList() {
    let list = cdLoad();
    // 首次进入（本地无任何事件）→ 写入 12 条示例，首屏就是「有内容的样子」
    if (!list.length) {
      list = buildSeedEvents(this.data.cdPageStyle);
      cdSave(list);
    }
    this.setData({ cdList: list });
    this.cdRefresh();
  },

  /** 过滤 + 排序 + 派生展示数据（tick 每秒调用，data 未变化的部分 setData 开销可忽略） */
  cdRefresh() {
    const all = this.data.cdList;
    const { active, archived } = cdRefreshView(all, this.data.cdFilter);

    // 情绪分组筛选（在六个分类之上的一层软分组）
    const gf = this.data.cdGroupFilter;
    let list = active;
    if (gf && gf !== 'all') {
      const g = CD_EMOTION_GROUPS.find((x) => x.key === gf);
      if (g) list = list.filter((v) => g.cats.indexOf(v.category) >= 0);
    }

    // 三列平铺：列表已按置顶+日期排好序，直接交给 CSS 三列换行
    const cards = list;

    // 横幅：任何筛选下都不为空（置顶 → 最近未来 → 最近任意）
    const h = cdPickHero(all);
    const hero = h
      ? { ...h, script: CD_HERO_SCRIPT[h.emotion] || CD_HERO_SCRIPT.expect }
      : null;

    // 横向分组条（未归档的活跃事件计数）
    const live = all.filter((e) => !e.done);
    const groups = CD_EMOTION_GROUPS.map((g) => ({
      key: g.key, label: g.label, icon: g.icon, color: g.color, soft: g.soft,
      count: live.filter((e) => g.cats.indexOf(e.category) >= 0).length
    }));

    // 空态三行文案（按当前筛选给出不同的引导）
    const filtered = !!this.data.cdGroupFilter && this.data.cdGroupFilter !== 'all';
    let emptyText = '';
    let emptySub = '';
    let emptyAction = '';
    if (!cards.length) {
      if (this.data.cdFilter === 'archive') {
        emptyText = '归档里还没有内容';
        emptySub = '在详情里点「归档」，旧的日子就会收到这里';
        emptyAction = '看看正在倒数的';
      } else if (filtered) {
        emptyText = '这个分类还没有日子';
        emptySub = '换个分类看看，或者记下一个新的';
        emptyAction = '清除筛选';
      } else {
        emptyText = '还没有值得等待的日子';
        emptySub = '也许下一场期待，就从今天开始';
        emptyAction = '＋ 创建第一个倒数日';
      }
    }

    this.setData({
      cdActive: list,
      cdArchived: archived,
      cdCards: cards,
      cdHero: hero,
      cdGroups: groups,
      cdEmptyText: emptyText,
      cdEmptySub: emptySub,
      cdEmptyAction: emptyAction
    });
  },

  /** 情绪分组筛选（再点一次取消） */
  onCdGroupTap(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || 'all');
    this.setData({ cdGroupFilter: this.data.cdGroupFilter === key ? 'all' : key });
    this.cdRefresh();
  },

  /** 点横幅：有事件 → 打开编辑；没事件 → 直接新建 */
  onCdBannerTap() {
    if (this.data.cdHero) this.onCdEdit({ currentTarget: { dataset: { id: this.data.cdHero.id } } } as unknown as WechatMiniprogram.TouchEvent);
    else this.onCdAdd();
  },

  /** 点卡片 → 编辑 */
  onCdCardTap(e: WechatMiniprogram.TouchEvent) {
    this.onCdEdit(e);
  },

  /** 空态按钮：清除筛选 / 看正在倒数的 / 创建第一个 */
  onCdEmptyAction() {
    const d = this.data;
    if (d.cdFilter === 'archive') {
      this.setData({ cdFilter: 'all' });
      this.cdRefresh();
      return;
    }
    if (d.cdGroupFilter && d.cdGroupFilter !== 'all') {
      this.setData({ cdGroupFilter: 'all' });
      this.cdRefresh();
      return;
    }
    this.onCdAdd();
  },

  /** 卡片右上角小心心：收藏 / 取消收藏（catchtap 不触发卡片点击） */
  onCdFavTap(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    const list = cdToggleFav(this.data.cdList, id);
    this.setData({ cdList: list });
    this.cdRefresh();
    const now = list.find((x) => x.id === id);
    toast(now && now.fav ? '已收藏 ♡' : '已取消收藏');
  },

  /** 选择情绪 */
  onCdFormEmotion(e: WechatMiniprogram.TouchEvent) {
    this.setData({ cdFormEmotion: e.currentTarget.dataset.key as CdEmotion });
  },

  /** 选内置情绪图 */
  onCdPickPhoto(e: WechatMiniprogram.TouchEvent) {
    const src = String(e.currentTarget.dataset.src || '');
    if (!src) return;
    this.setData({ cdFormPhoto: src });
  },

  /** 从相册选图：saveFile 落地持久化，避免 tempFilePath 重进失效 */
  onCdChoosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const temp = (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath) || '';
        if (!temp) return;
        try {
          const fs = wx.getFileSystemManager() as unknown as {
            saveFile(o: {
              tempFilePath: string;
              success(r: { savedFilePath: string }): void;
              fail(): void;
            }): void;
          };
          fs.saveFile({
            tempFilePath: temp,
            success: (r) => { this.setData({ cdFormPhoto: r.savedFilePath }); },
            fail: () => { this.setData({ cdFormPhoto: temp }); }
          });
        } catch (_e) {
          this.setData({ cdFormPhoto: temp });
        }
      },
      fail: () => { /* 用户取消 */ }
    });
  },

  /** 清除已选照片，回落到内置稳定图 */
  onCdClearPhoto() {
    const id = this.data.cdEditorFor;
    this.setData({ cdFormPhoto: id ? cdDefaultPhoto(id) : '' });
  },

  /** 筛选切换 */
  onCdFilterTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as CdFilterKey;
    if (!key || key === this.data.cdFilter) return;
    this.setData({ cdFilter: key });
    this.cdRefresh();
  },

  /** 打开新建弹层 */
  onCdAdd() {
    const d = cdSplitTarget(cdDefaultTarget(1));
    this.setData({
      cdEditorFor: '',
      cdEditorTitle: '记下这一天',
      cdFormTitle: '',
      cdFormType: 'countdown',
      cdFormCategory: '生日',
      cdFormNote: '',
      cdFormDate: d.date,
      cdFormTime: d.time,
      cdFormEmotion: 'expect',
      cdFormPhoto: ''
    });
  },

  /** 点击卡片 → 编辑 */
  onCdEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const ev = this.data.cdList.find((x) => x.id === id);
    if (!ev) return;
    const d = cdSplitTarget(ev.target);
    this.setData({
      cdEditorFor: ev.id,
      cdEditorTitle: '编辑这一天',
      cdFormTitle: ev.title,
      cdFormType: ev.type,
      cdFormCategory: ev.category,
      cdFormNote: ev.note,
      cdFormDate: d.date,
      cdFormTime: d.time,
      cdFormEmotion: ev.emotion || 'expect',
      cdFormPhoto: ev.photo || cdDefaultPhoto(ev.id)
    });
  },

  /** 弹层内表单 */
  onCdFormTitle(e: WechatMiniprogram.InputEvent) {
    this.setData({ cdFormTitle: e.detail.value });
  },
  onCdFormNote(e: WechatMiniprogram.InputEvent) {
    this.setData({ cdFormNote: e.detail.value });
  },
  /** 输入聚焦/失焦：高亮当前输入框的描边，让输入内容所在位置一眼可见 */
  onCdFocus(e: WechatMiniprogram.TouchEvent) {
    this.setData({ cdFocusField: e.currentTarget.dataset.field as string || '' });
  },
  onCdBlur() {
    this.setData({ cdFocusField: '' });
  },
  onCdFormTypeTap(e: WechatMiniprogram.TouchEvent) {
    this.setData({ cdFormType: e.currentTarget.dataset.type as CdType });
  },
  onCdFormCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ cdFormCategory: e.currentTarget.dataset.cat as CdCategory });
  },
  onCdFormDate(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ cdFormDate: e.detail.value as string });
  },
  onCdFormTime(e: WechatMiniprogram.PickerChangeEvent) {
    this.setData({ cdFormTime: e.detail.value as string });
  },

  /** 保存（新建 / 编辑） */
  onCdSave() {
    const {
      cdEditorFor, cdFormTitle, cdFormDate, cdFormTime, cdFormType,
      cdFormCategory, cdFormNote, cdFormEmotion, cdFormPhoto
    } = this.data;
    const title = cdFormTitle.trim();
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (!cdFormDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    const target = cdJoinTarget(cdFormDate, cdFormTime);
    if (cdParseTarget(target) === 0) {
      wx.showToast({ title: '日期时间不合法', icon: 'none' });
      return;
    }
    const data = {
      title, target, type: cdFormType, category: cdFormCategory,
      note: cdFormNote.trim(),
      emotion: cdFormEmotion,
      photo: cdFormPhoto || (cdEditorFor ? cdDefaultPhoto(cdEditorFor) : '')
    };
    const list = cdEditorFor
      ? cdUpdate(this.data.cdList, cdEditorFor, data)
      : cdAdd(this.data.cdList, data);
    this.setData({ cdList: list, cdEditorFor: null });
    this.cdRefresh();
    // 情绪反馈：按未来 / 过去 / 当天给不同的一句
    if (cdEditorFor) {
      wx.showToast({ title: '♡ 已记下这一天', icon: 'none' });
      return;
    }
    const ts = cdParseTarget(target);
    const diffDays = Math.round((ts - Date.now()) / 864e5);
    if (diffDays === 0) wx.showToast({ title: '♡ 就是今天', icon: 'none' });
    else if (diffDays > 0) wx.showToast({ title: '愿你的期待，如期而至', icon: 'none' });
    else wx.showToast({ title: '这段时光，值得被记住', icon: 'none' });
  },

  /** 关闭弹层 */
  onCdEditorClose() {
    this.setData({ cdEditorFor: null });
  },
  /** 阻止冒泡（弹层内容点击不关闭） */
  onCdSheetStop() { /* noop */ },

  /** 置顶 / 取消置顶 */
  onCdPin(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ cdList: cdTogglePin(this.data.cdList, id) });
    this.cdRefresh();
  },

  /** 完成归档 / 恢复 */
  onCdDone(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ cdList: cdToggleDone(this.data.cdList, id) });
    this.cdRefresh();
  },

  /** 删除（带确认） */
  onCdDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const ev = this.data.cdList.find((x) => x.id === id);
    wx.showModal({
      title: '删除事件',
      content: `确定删除「${ev ? ev.title : ''}」吗？不可恢复`,
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ cdList: cdRemove(this.data.cdList, id) });
        this.cdRefresh();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  // ============ 时间进度（当天 / 当月 / 当年，已过百分比为主视觉） ============
  refreshTimeProgress() {
    const now = new Date();
    const nowTs = now.getTime();
    const y = now.getFullYear();
    const mo = now.getMonth();
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    const round1 = (n: number) => Math.round(n * 10) / 10;

    // 当天：已过 / 剩余（毫秒级精确，时间轴标记随之每秒推进）
    const dayStart = new Date(y, mo, now.getDate(), 0, 0, 0).getTime();
    const dayEnd = new Date(y, mo, now.getDate() + 1, 0, 0, 0).getTime();
    const dayTotalMs = dayEnd - dayStart;
    const dayRemainMs = Math.max(0, dayEnd - nowTs);
    const dayPassedMs = dayTotalMs - dayRemainMs;
    const remainH = Math.floor(dayRemainMs / 3600000);
    const remainM = Math.floor((dayRemainMs % 3600000) / 60000);
    const remainS = Math.floor((dayRemainMs % 60000) / 1000);
    const passedH = Math.floor(dayPassedMs / 3600000);
    const passedM = Math.floor((dayPassedMs % 3600000) / 60000);

    // 当月
    const monthStart = new Date(y, mo, 1).getTime();
    const monthEnd = new Date(y, mo + 1, 1).getTime();
    const monthRemainMs = Math.max(0, monthEnd - nowTs);
    const monthTotalDays = new Date(y, mo + 1, 0).getDate();
    const monthPassedDays = now.getDate();
    const remainMonthDays = Math.ceil(monthRemainMs / 86400000);

    // 当年
    const yearStart = new Date(y, 0, 1).getTime();
    const yearEnd = new Date(y + 1, 0, 1).getTime();
    const yearRemainMs = Math.max(0, yearEnd - nowTs);
    const totalDays = Math.round((yearEnd - yearStart) / 86400000);
    const day = Math.floor((nowTs - yearStart) / 86400000) + 1;
    const remainYearDays = Math.ceil(yearRemainMs / 86400000);

    this.setData({
      dayPassedPct: round1((dayPassedMs / dayTotalMs) * 100),
      dayCap: `已过 ${passedH}:${pad(passedM)}\n剩 ${remainH}:${pad(remainM)}`,
      monthPassedPct: round1(((monthEnd - monthRemainMs - monthStart) / (monthEnd - monthStart)) * 100),
      monthCap: `已过 ${monthPassedDays} 天 / 剩 ${remainMonthDays} 天（共 ${monthTotalDays} 天）`,
      yearPassedPct: round1(((yearEnd - yearRemainMs - yearStart) / (yearEnd - yearStart)) * 100),
      yearCap: `已过 ${day} 天 / 剩 ${remainYearDays} 天（共 ${totalDays} 天）`,
      dayRemainH: pad(remainH),
      dayRemainM: pad(remainM),
      dayRemainS: pad(remainS),
      nowLabel: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      nowPct: round1((dayPassedMs / dayTotalMs) * 100),
      yearDay: day,
      yearTotalDays: totalDays
    });
  },

  // ============ 人生进度（电池电量样式） ============
  pickLifeQuote(): string {
    return LIFE_QUOTES[Math.floor(Math.random() * LIFE_QUOTES.length)] || LIFE_QUOTES[0];
  },

  refreshLife() {
    const birth = this.data.birthDate || '1995-01-01';
    const [y, m, d] = birth.split('-').map(Number);
    const now = new Date();
    const ny = now.getFullYear();
    const nm = now.getMonth() + 1;
    const nd = now.getDate();
    // 出生月 ~ 当前月的完整月数（当前月未过生日当天则减 1）
    let months = (ny - y) * 12 + (nm - m);
    if (nd < (d || 1)) months -= 1;
    if (months < 0) months = 0;
    const pct = Math.min(100, (months / LIFESPAN_MONTHS) * 100);
    const birthLabel = `${y}年${m}月`;
    const elapsedDays = Math.max(0, Math.floor((Date.now() - new Date(y, (m || 1) - 1, d || 1).getTime()) / 86400000));
    this.setData({
      lifeMonths: months,
      lifeMonthText: `${birthLabel}至今 ${months} 个月`,
      lifePct: Math.round(pct * 10) / 10,
      lifeText: `已走过人生 ${pct.toFixed(1)}%`,
      lifeLifespanMonths: LIFESPAN_MONTHS,
      lifeDays: elapsedDays,
      lifeTotalDays: LIFESPAN_DAYS,
      isBirthday: this.computeIsBirthday(birth, now)
    });
    // 生日专区联动：命中生日时选取当日三种文案并驱动走心打字机
    this.syncBirthdayShow(this.computeIsBirthday(birth, now));
  },

  /** 按当日日期稳定选取三条不同风格的生日祝福（同一天始终一致） */
  pickBirthdayLines(): { heart: string; fun: string; formal: string } {
    const now = new Date();
    const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    let h = 0;
    for (let i = 0; i < dayKey.length; i++) h = (h * 31 + dayKey.charCodeAt(i)) % 97;
    const heart = BDAY_HEART[h % BDAY_HEART.length];
    const fun = BDAY_FUN[(h + 1) % BDAY_FUN.length];
    const formal = BDAY_FORMAL[(h + 2) % BDAY_FORMAL.length];
    return { heart, fun, formal };
  },

  /** 生日专区联动：填充文案并驱动走心寄语打字机 */
  syncBirthdayShow(isBday: boolean): void {
    this.stopBdayType();
    if (!isBday || this.data.type !== 'life') return;
    const { heart, fun, formal } = this.pickBirthdayLines();
    this.setData({ bdayHeartFull: heart, bdayFun: fun, bdayFormal: formal });
    this.startBdayType(heart);
  },

  /** 走心寄语 · 打字机逐字输出 */
  startBdayType(full: string): void {
    const self = this as unknown as { bdayTimer?: ReturnType<typeof setInterval> | null };
    if (self.bdayTimer) clearInterval(self.bdayTimer);
    this.setData({ bdayType: '' });
    let idx = 0;
    self.bdayTimer = setInterval(() => {
      idx += 1;
      const chunk = full.slice(0, idx);
      try {
        this.setData({ bdayType: chunk });
      } catch (_e) {
        if (self.bdayTimer) { clearInterval(self.bdayTimer); self.bdayTimer = null; }
        return;
      }
      if (idx >= full.length && self.bdayTimer) {
        clearInterval(self.bdayTimer);
        self.bdayTimer = null;
      }
    }, 72);
  },

  stopBdayType(): void {
    const self = this as unknown as { bdayTimer?: ReturnType<typeof setInterval> | null };
    if (self.bdayTimer) {
      clearInterval(self.bdayTimer);
      self.bdayTimer = null;
    }
  },

  /** 判断今日（阳历）是否 = 用户填写的出生月/日。仅当天匹配才显示「生日快乐」 */
  computeIsBirthday(birth: string, now: Date): boolean {
    const parts = (birth || '').split('-').map(Number);
    const bm = parts[1];
    const bd = parts[2];
    if (!bm || !bd) return false;
    return now.getMonth() + 1 === bm && now.getDate() === bd;
  },

  // ============ 人生格子 ============
  refreshLifegrid() {
    // 基础月数计算仍复用 refreshLife 原逻辑（不做任何改动）
    this.refreshLife();
    // 展示层派生：按所选预期寿命点亮格子，当前所在月 = 最后一个已点亮格
    const total = this.data.lgLifespanYears * 12;
    const passed = Math.min(total, Math.max(0, this.data.lifeMonths));
    const nowIdx = passed > 0 ? passed - 1 : -1;
    const cells: { p: boolean; now: boolean }[] = [];
    for (let i = 0; i < total; i++) {
      cells.push({ p: i < passed, now: i === nowIdx });
    }
    // 年度时间进度（已过）：跨天由 onShow 重算覆盖
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const yearEnd = new Date(now.getFullYear() + 1, 0, 1).getTime();
    const totalDays = (yearEnd - yearStart) / 86400000;
    const passedDays = Math.min(totalDays, Math.floor((now.getTime() - yearStart) / 86400000));
    const remainDays = Math.max(0, Math.ceil((yearEnd - now.getTime()) / 86400000));
    this.setData({
      lifegridCells: cells,
      lifegridPassed: passed,
      lgTotalCells: total,
      lgLifePct: Math.round((passed / total) * 1000) / 10,
      lgYearPct: Math.round((passedDays / totalDays) * 1000) / 10,
      lgYearPassedDays: passedDays,
      lgYearRemainDays: remainDays
    });
  },

  /** 切换预期寿命：持久化并立即重算格子墙与人生进度 */
  onLifespanChange(e: WechatMiniprogram.PickerChangeEvent) {
    const idx = Number((e.detail as { value: number }).value) || 0;
    const years = this.data.lgLifespanOptions[idx] || 75;
    try {
      wx.setStorageSync('tool_lifespan_years', years);
    } catch (_e) { /* 忽略 */ }
    this.setData({ lgLifespanYears: years, lgLifespanIndex: idx });
    this.refreshLifegrid();
  },

  /** 主题选择器：切换全局主题（持久化 + 全页面联动 + 导航栏同步） */
  onGridThemeTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as ThemeKey;
    if (!key || key === this.data.theme) return;
    const state = applyTheme(key);
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient
    });
  },

  /** 读取持久化风格（空/非法回落默认） */
  readStyle(storeKey: string, valid: string[], fallback: string): string {
    try {
      const v = wx.getStorageSync(storeKey) as string;
      if (valid.indexOf(v) >= 0) return v;
    } catch (_e) { /* 忽略 */ }
    return fallback;
  },

  /**
   * 风格维度切换（整页皮肤 / 翻页时钟配色/字体/氛围 / 时间进度表盘/背景 通用）：
   * 校验合法 → 持久化 → 即时 setData 生效（wxss 根类联动，无刷新）。
   */
  applyStyleDim(
    storeKey: string,
    valid: string[],
    field: 'lifeSkin' | 'fcPalette' | 'fcFont' | 'fcBg' | 'clockStyle' | 'clockBg',
    key: string
  ) {
    if (!key || valid.indexOf(key) < 0) return;
    const cur = this.data[field];
    if (key === cur) return;
    try {
      wx.setStorageSync(storeKey, key);
    } catch (_e) { /* 忽略 */ }
    this.setData({ [field]: key } as unknown as Partial<never>);
  },

  /* ===== 人生进度：整页皮肤 ===== */
  onLifeSkinTap(e: WechatMiniprogram.TouchEvent) {
    this.applyStyleDim('tool_life_skin', LIFE_SKINS, 'lifeSkin', e.currentTarget.dataset.key as string);
  },

  /* ===== 翻页时钟三维度 ===== */
  onFcPaletteTap(e: WechatMiniprogram.TouchEvent) {
    this.applyStyleDim('tool_fc_palette', FC_PALETTES, 'fcPalette', e.currentTarget.dataset.key as string);
  },
  onFcFontTap(e: WechatMiniprogram.TouchEvent) {
    this.applyStyleDim('tool_fc_font', FC_FONTS, 'fcFont', e.currentTarget.dataset.key as string);
  },
  onFcBgTap(e: WechatMiniprogram.TouchEvent) {
    this.applyStyleDim('tool_fc_bg', FC_BGS, 'fcBg', e.currentTarget.dataset.key as string);
  },

  /** 表盘风格选择器：仅切换时间进度模块的金属工艺配色（持久化） */
  onClockStyleTap(e: WechatMiniprogram.TouchEvent) {
    this.applyStyleDim('tool_clock_style', CLOCK_STYLES, 'clockStyle', e.currentTarget.dataset.key as string);
  },

  /** 背景氛围选择器：仅切换时间进度模块的页面氛围层（持久化，与表盘风格独立组合） */
  onClockBgTap(e: WechatMiniprogram.TouchEvent) {
    this.applyStyleDim('tool_clock_bg', CLOCK_BGS, 'clockBg', e.currentTarget.dataset.key as string);
  },

  /** 页面风格切换（a=手账风 / b=简洁风，持久化，仅外观） */
  onCdPageStyleTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as CdPageStyle;
    if (!key || key === this.data.cdPageStyle) return;
    try {
      wx.setStorageSync('tool_cd_page_style', key);
    } catch (_e) { /* 忽略 */ }
    // 两套风格各用一组专属封面（a1-a6 / b1-b6）：只换内置示例图的封面，
    // 用户自己上传的照片（不在内置命名空间内）保持不动。
    const list = reseedCovers(this.data.cdList, key);
    cdSave(list);
    this.setData({ cdPageStyle: key, cdList: list });
    this.cdRefresh();
  },

  /** 简洁风分类条上的「全部」卡：清除分组筛选 */
  onCdGroupFilterAll() {
    if (!this.data.cdGroupFilter || this.data.cdGroupFilter === 'all') return;
    this.setData({ cdGroupFilter: 'all' });
    this.cdRefresh();
  },

  // 换一个日期（同时供人生进度 / 人生格子使用）
  onBirthChange(e: WechatMiniprogram.PickerChangeEvent) {
    const v = e.detail.value as string;
    wx.setStorageSync('tool_birth', v);
    this.setData({ birthDate: v, lifeQuote: this.pickLifeQuote() });
    this.refreshLife();
    const type = this.data.type;
    if (type === 'lifegrid') this.refreshLifegrid();
  },

  // 清除记录：恢复默认出生日期
  onClearLife() {
    wx.removeStorageSync('tool_birth');
    const birth = '1995-01-01';
    this.setData({ birthDate: birth, lifeQuote: this.pickLifeQuote() });
    this.refreshLife();
    const type = this.data.type;
    if (type === 'lifegrid') this.refreshLifegrid();
  },

  // ============ 翻页时钟 ============
  tickClock() {
    const now = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    // 逐位 diff：只有变化的数字才 setData，未变化的位不触发 flip-digit 翻页动画
    const patch: Record<string, string | number> = {};
    const old = this.data.clockDigits;
    for (let i = 0; i < 6; i++) {
      if (timeStr[i] !== old[i]) patch[`clockDigits[${i}]`] = timeStr[i];
    }

    // 问候语 / 时段 / 日月图标：跨小时才更新
    const hour = now.getHours();
    if (hour !== clockHour) {
      clockHour = hour;
      patch.clockGreet = clockGreeting(hour);
      patch.clockNoon = clockNoonLabel(hour);
      patch.clockIcon = hour >= 6 && hour < 18 ? '☀️' : '🌙';
    }

    // 今日已过百分比（取整，每 ~14.4 分钟变化一次）
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayPct = Math.min(100, Math.floor(((now.getTime() - dayStart) / 86400000) * 100));
    if (dayPct !== this.data.clockDayPct) patch.clockDayPct = dayPct;

    const dateText = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · 周${week}`;
    if (dateText !== this.data.clockDate) patch.clockDate = dateText;

    if (Object.keys(patch).length) this.setData(patch);
  },

  // ============ 定时器 ============
  startTimer() {
    if (timer) return;
    timer = setInterval(() => this.tick(), 1000);
  },

  stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  },

  tick() {
    const type = this.data.type;
    if (type === 'pomodoro') {
      this.tickPomodoro();
    } else if (type === 'countdown') {
      this.tickCountdown();
    } else if (type === 'time') {
      this.refreshTimeProgress();
    } else if (type === 'life') {
      this.refreshLife();
    } else if (type === 'flipclock') {
      this.tickClock();
    } else if (type === 'favorites') {
      // 每 60 秒检查一次跨天/今天命中
      this.favTickCounter = (this.favTickCounter || 0) + 1;
      if (this.favTickCounter >= 60) {
        this.favTickCounter = 0;
        this.refreshHolidays();
      }
    }
  },

  // ============ 节假日信息中心 ============

  /** 读取收藏 id 列表（wx.storage，结构：string[]） */
  readFavIds(): string[] {
    try {
      const v = wx.getStorageSync(FAV_FAV_STORAGE_KEY);
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch (_e) {
      return [];
    }
  },

  /** 读取提醒记录（结构：Record<id, { year, advance, label }>） */
  readFavReminds(): Record<string, { year: number; advance: number; label: string }> {
    try {
      const v = wx.getStorageSync(FAV_REMIND_STORAGE_KEY);
      return v && typeof v === 'object' ? (v as Record<string, { year: number; advance: number; label: string }>) : {};
    } catch (_e) {
      return {};
    }
  },

  /** 刷新 Hero + 列表（倒计时基于 holiday.date 实时计算，每天进入页面自动更新） */
  refreshHolidays() {
    const now = new Date();
    const hero = getNextHolidayItem(now);
    const favIds = this.readFavIds();
    const reminds = this.readFavReminds();
    const all = getHolidayItemsForYear(this.data.favYear, now).map((it) => ({
      ...it,
      faved: favIds.indexOf(it.id) >= 0,
      reminded: !!reminds[it.id]
    }));
    const f = this.data.favFilter;
    let list = all;
    let pastCount = 0;
    if (f === 'coming') {
      // 即将到来：未来 30 天内（仅对当前年份视图有意义，跨年视图自然为空）
      list = all.filter((it) => it.daysLeft >= 0 && it.daysLeft <= 30);
    } else if (f !== 'all') {
      list = all.filter((it) => it.kind === f);
    } else {
      // 「全部」默认只铺开未过期的（否则一进页面就是 20+ 张灰卡），已结束的折叠成一行
      pastCount = all.filter((it) => it.daysLeft < 0).length;
      if (!this.data.favShowPast) list = all.filter((it) => it.daysLeft >= 0);
    }
    this.setData({ favHero: hero, favList: list, favPastCount: pastCount });
  },

  /** 展开 / 收起已结束节日 */
  onFavTogglePast() {
    this.setData({ favShowPast: !this.data.favShowPast });
    this.refreshHolidays();
  },

  /** 分类筛选点击 */
  onFavFilterTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key || key === this.data.favFilter) return;
    this.setData({ favFilter: key });
    this.refreshHolidays();
  },

  /** 年份切换（picker：当前年 ~ 未来 3 年） */
  onFavYearChange(e: WechatMiniprogram.PickerChangeEvent) {
    const idx = Number(e.detail.value) || 0;
    const year = this.data.favYears[idx] || new Date().getFullYear();
    this.setData({ favYear: year, favYearIndex: idx });
    this.refreshHolidays();
  },

  /** 列表项点击 → 打开详情弹层 */
  onFavItemTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.data.favList.find((i) => i.id === id);
    if (item) this.openFavDetail(item);
  },

  /** Hero「查看详情」 */
  onFavHeroDetail() {
    if (this.data.favHero) this.openFavDetail(this.data.favHero);
  },

  openFavDetail(item: HolidayYearItem) {
    const favIds = this.readFavIds();
    const reminds = this.readFavReminds();
    const r = reminds[item.id];
    this.setData({
      favDetail: item,
      favDetailFaved: favIds.indexOf(item.id) >= 0,
      favDetailRemind: r ? `已设置：${r.label}提醒` : '',
      favDetailPast: item.daysLeft < 0
    });
  },

  /** 关闭详情弹层（点遮罩） */
  onFavDetailClose() {
    this.setData({ favDetail: null });
  },

  /** 阻止冒泡占位（弹层内容区 catchtap） */
  noop() { /* 仅用于阻止事件冒泡 */ },

  /** 列表星标：收藏 / 取消收藏（catchtap 防止触发详情） */
  onFavStarTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    this.toggleFavById(id);
    this.refreshHolidays();
  },

  /** 详情弹层里的收藏按钮 */
  onFavToggleFav() {
    const d = this.data.favDetail;
    if (!d) return;
    const faved = this.toggleFavById(d.id);
    this.setData({ favDetailFaved: faved });
    this.refreshHolidays();
  },

  /** 收藏切换（返回切换后的状态） */
  toggleFavById(id: string): boolean {
    const ids = this.readFavIds();
    const idx = ids.indexOf(id);
    let faved: boolean;
    if (idx >= 0) {
      ids.splice(idx, 1);
      faved = false;
    } else {
      ids.push(id);
      faved = true;
    }
    try {
      wx.setStorageSync(FAV_FAV_STORAGE_KEY, ids);
    } catch (_e) { /* 存储失败静默（收藏是增强功能） */ }
    return faved;
  },

  /**
   * 设置提醒：actionSheet 选档位（当天/提前1/3/7 天）
   *  - 先请求订阅消息授权，授权成功则同步云端配额（grantSubscription）
   *  - 并通过云函数 pushReminder 派发定时推送；失败降级本地记录（详情页展示已设置状态）
   */
  async onFavRemindTap() {
    const d = this.data.favDetail;
    if (!d || d.daysLeft < 0) {
      toast('该节日已结束，无需提醒');
      return;
    }
    wx.showActionSheet({
      itemList: FAV_REMIND_OPTIONS.map((o) => o.label),
      success: async (res) => {
        const opt = FAV_REMIND_OPTIONS[res.tapIndex];
        if (!opt) return;
        if (opt.days > d.daysLeft) {
          toast('所选提醒时间已过，请换个档位');
          return;
        }
        // 目标提醒时刻：节日当天 09:00 往前推 opt.days 天
        const holidayDate = new Date();
        holidayDate.setDate(holidayDate.getDate() + d.daysLeft);
        const target = new Date(
          holidayDate.getFullYear(),
          holidayDate.getMonth(),
          holidayDate.getDate() - opt.days,
          9, 0, 0
        );
        // 订阅授权（失败不阻塞，降级为仅本地记录）
        const sub = await requestSubscribe();
        if (sub === 'accept') {
          await grantSubscription();
          await pushReminder({
            tmplId: SUB_TMPL_ID,
            title: clip(`${d.name} ${opt.days === 0 ? '就是今天' : `还有${opt.days}天`}`, 20),
            desc: clip(`${d.monthDayText} · ${d.name}`, 20),
            at: target.getTime(),
            page: 'subpackages/toolbox/pages/tool/tool?type=favorites'
          });
          toast('已设置微信提醒');
        } else {
          toast('已在本地记录提醒');
        }
        // 无论授权与否都记录本地档位（详情页展示状态）
        const reminds = this.readFavReminds();
        reminds[d.id] = { year: new Date().getFullYear(), advance: opt.days, label: opt.label };
        try {
          wx.setStorageSync(FAV_REMIND_STORAGE_KEY, reminds);
        } catch (_e) { /* 忽略 */ }
        this.setData({ favDetailRemind: `已设置：${opt.label}提醒` });
      },
      fail: () => { /* 用户取消选择 */ }
    });
  }
});
