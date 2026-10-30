// pages/index/index.ts
// 番茄时钟 · 高级智能自律学习中心（独立分包页面）
//
// 与旧版（工具中心 tool 页的 type=pomodoro 内嵌分支）的分工：
//   本页只负责「界面 + 编排」；计时状态机、统计、存储、音频全部复用 utils/pomo-*.ts，
//   不重复实现业务逻辑，也不改动旧分支（避免一次性大改影响工具页其它小工具）。
//
// 三条硬约束（写在这里，防止后续被改坏）：
//  1. **防漂移**：elapsed 一律由 Date.now() - session.startAt - pausedSec 算出，
//     绝不用「每 tick +1 秒」累加。切后台 / 息屏 / 小程序被回收后回来，时间依然准确。
//  2. **组件薄**：子组件只做展示与意图回抛，不读 store、不写 storage。
//  3. **完成闭环**：完成一轮 → 写日志 → 刷统计 → 更连续天数 → 刷目标进度，
//     让「番茄钟 → 待办 → 统计 → 成长」形成回路，而不是只跳个数字。
//
// 数据真实性（需求红线）：今日目标 / 三列统计 / 成长计划节点 / 成就徽章
// 全部由 utils/pomo-stats 与本地番茄日志推导，没有任何编造的比例或排名。

import type { IPomoLog, IPomoSettings, IPomoStats, PomoMode } from '../../../../types/index';
import {
  DEFAULT_POMO_SETTINGS,
  appendLocalLog,
  clearSession,
  dateKey as pomoDateKey,
  loadGoals,
  loadLocalLogs,
  loadSession,
  loadSettings,
  saveGoals,
  saveSession,
  saveSettings
} from '../../../../utils/pomo-storage';
import {
  adaptiveRestSec,
  buildLog,
  formatSec,
  modeSec,
  nextMode,
  pause as enginePause,
  resume as engineResume
} from '../../../../utils/pomo-engine';
import { computeStats, heatLevel } from '../../../../utils/pomo-stats';
import { playAmbient, playFinishTone, stopAmbient } from '../../../../utils/pomo-audio';
import { callFn, toast } from '../../../../utils/cloud';
import { back, relaunch, stackDepth } from '../../../../utils/nav';
import * as todoStore from '../../../../utils/todo-store';
import {
  completeTitle,
  modeLabelCn,
  pickDailyQuote,
  runningBanner,
  streakMessage
} from '../../utils/focus-copy';
import { POMO_BG } from '../../utils/pomo-bg';

/** 计时阶段 */
type Phase = 'idle' | 'running' | 'paused' | 'finished';

/** 统计空值：避免首屏 undefined.* 报错 */
const EMPTY_STATS: IPomoStats = {
  todayCount: 0,
  todayMinutes: 0,
  weekCount: 0,
  weekMinutes: 0,
  monthCount: 0,
  monthMinutes: 0,
  totalCount: 0,
  totalMinutes: 0,
  streak: 0,
  heatmap: [],
  hourHistogram: [],
  hourPeak: 0,
  timeline: [],
  bestWindow: null,
  efficientWindows: []
};

/** 模式基础信息（时长在 buildModeList 里按设置注入） */
const MODE_BASE: { key: PomoMode; label: string; emoji: string }[] = [
  { key: 'focus', label: '专注', emoji: '🍅' },
  { key: 'short', label: '短休息', emoji: '☕' },
  { key: 'long', label: '长休息', emoji: '🌙' }
];

interface ModeItem {
  key: PomoMode;
  label: string;
  emoji: string;
  minutes: number;
}

interface StatCard {
key: string;
  icon: string;
  label: string;
  value: string;
  unit: string;
  /** >=0 显示进度条；-1 显示 sub 文案 */
  bar: number;
  sub: string;
  tone: string;
  /**
   * 是否显示进度条。**必须由 TS 算好再下发**，不能在 WXML 里写
   * `wx:if="{{item.bar >= 0}}"` —— 属性值里的 '>' 会被 wcc 当成标签结束符，
   * 导致该标签之后的所有 </view> 连锁失配（报 end tag missing，且很难定位）。
   */
  showBar: boolean;
}

/** 图表数据点（喂给 focus-chart） */
interface ChartPoint {
  label: string;
  value: number;
  highlight?: boolean;
}

interface PlanNode {
  key: string;
  glyph: string;
  text: string;
  state: 'done' | 'active' | 'todo';
}

interface AchvSummary {
  count: number;
  minutes: number;
  streak: number;
}

interface AchvBadge {
  key: string;
  glyph: string;
  label: string;
  desc: string;
  on: boolean;
}

interface DoneInfo {
  title: string;
  minutes: number;
  rounds: number;
  nextText: string;
}

interface PageData {
  /* —— 沉浸式布局 —— */
  headerPadTop: number;
  /** 标题右侧避让胶囊的内边距（px，由系统胶囊宽决定） */
  headerRightPad: number;
  reduced: boolean;
  /** 缩放基准单位：窄窗 1rpx（= 视口/750），宽窗固定 px。由 JS 按真实窗口宽计算后内联到 .pd 上 */
  uUnit: string;
  /** 宽窗双栏开关（替代不可靠的 @media aspect-ratio） */
  wide: boolean;
  zen: boolean;
  focusing: boolean;

  /** 场景背景 data URI（base64，WXSS 不支持本地路径） */
  bgUri: string;
  /** 进度环直径（rpx），与 .core__stage 同值避免外溢 */
  ringSize: number;
  /** 环境音是否开启 */
  ambientOn: boolean;
  /** 底部导航高亮项 */
  dockActive: 'home' | 'stats' | 'achv' | 'me';

  modeList: ModeItem[];

  /* —— 今日目标 —— */
  goalTarget: number;
  goalDone: number;
  goalPct: number;
  goalSideK: string;
  goalSideV: string;

  /* —— 计时 —— */
  mode: PomoMode;
  phase: Phase;
  totalSec: number;
  elapsedSec: number;
  remainingSec: number;
  progress: number;
  timeText: string;
  round: number;
  totalRounds: number;
  modeLabel: string;
  banner: string;
  pulse: boolean;

  /* —— 主按钮 —— */
  primaryText: string;
  primaryIcon: string;

  /* —— 激励 / 数据 —— */
  quote: string;
  /** 今日数据三列（真实统计推导） */
  statCards: StatCard[];
  /** 连续天数 + 文案 */
  streakDays: number;
  streakMsg: string;

  /* —— 专注数据图表（全部来自真实日志） —— */
  /** 当前图表页签：day = 近 14 天分钟，count = 近 14 天轮数，hour = 时段分布 */
  chartTab: 'day' | 'count' | 'hour';
  /** 近 14 天每日专注分钟（今天高亮） */
  chartDays: ChartPoint[];
  /** 近 14 天每日完成轮次 */
  chartDayCounts: ChartPoint[];
  /** 24 小时专注分布（番茄个数） */
  chartHours: ChartPoint[];
  /** 图表卡副标题：真实汇总文案 */
  chartSum: string;
  /** 最佳时段文案（无数据时明确说明） */
  bestWindowText: string;
  /** 高效时段候选（真实扫描结果，最多 3 个） */
  efficientWindows: { label: string; count: number }[];
  /** 图表区是否有任何数据（决定显示空状态还是图表） */
  chartHasData: boolean;
  /** 12 周热力图：每格完成数 + 强度等级 0-4 */
  heatCells: { key: string; count: number; level: number }[];
  /** 本周累计分钟（热力图上方汇总） */
  heatSum: string;

  /* —— 今日成长计划（真实日志推导） —— */
  planNodes: PlanNode[];
  planTip: string;

  /* —— 任务 —— */
  taskTitle: string;
  taskDone: number;
  taskTarget: number;
  taskPicker: boolean;
  todoOptions: { _id: string; content: string }[];

  /* —— 弹层 —— */
  panel: '' | 'stats' | 'settings' | 'achv';
  statsDetail: { label: string; value: string }[];
  settings: IPomoSettings;
  dailyTarget: number;
  weeklyTarget: number;

  /* —— 成就（真实统计推导） —— */
  achvSummary: AchvSummary;
  achvBadges: AchvBadge[];

  /* —— 完成庆祝 —— */
  done: DoneInfo | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 按设置构造模式列表（注入实时时长，分钟数随设置变化） */
function buildModeList(s: IPomoSettings): ModeItem[] {
  return MODE_BASE.map((m) => ({
    ...m,
    minutes: m.key === 'focus' ? s.focusSec / 60 : m.key === 'short' ? s.shortSec / 60 : s.longEvery ? s.longSec / 60 : 15
  }));
}

/**
 * 版式基准（替代原先的 @media 媒体查询）。
 *
 * 尺度改由 **JS 读真实窗口宽**决定并内联到 .pd 上，不依赖任何媒体特性。
 * 规则（按**逻辑像素** windowWidth）：
 *   < 700px  手机竖屏：1rpx（= windowWidth/750，随屏自适应）
 *   ≥ 700px  宽窗：0.78px，让 340u 的环落在 ~265px，舒适不撑破
 *   ≥ 1080px 额外开双栏（左计时器 / 右任务与数据）
 */
function layoutScale(windowWidth: number): { uUnit: string; wide: boolean } {
  const w = windowWidth > 0 ? windowWidth : 375;
  return {
    uUnit: w >= 700 ? '0.78px' : '1rpx',
    wide: w >= 1080
  };
}

Page<PageData>({
  data: {
    headerPadTop: 64,
    headerRightPad: 24,
    reduced: false,
    uUnit: '1rpx',
    wide: false,
    zen: false,
    focusing: false,

    bgUri: POMO_BG,
    ringSize: 340,
    ambientOn: false,
    dockActive: 'home',

    modeList: [],

    goalTarget: 4,
    goalDone: 0,
    goalPct: 0,
    goalSideK: '本周',
    goalSideV: '0 轮',

    mode: 'focus',
    phase: 'idle',
    totalSec: 25 * 60,
    elapsedSec: 0,
    remainingSec: 25 * 60,
    progress: 0,
    timeText: '25:00',
    round: 1,
    totalRounds: 4,
    modeLabel: '专注学习',
    banner: '',
    pulse: false,

    primaryText: '开始专注',
    primaryIcon: '▶',

    quote: '',
    statCards: [],
    streakDays: 0,
    streakMsg: '',

    chartTab: 'day',
    chartDays: [],
    chartDayCounts: [],
    chartHours: [],
    chartSum: '',
    bestWindowText: '数据还不够',
    efficientWindows: [],
    chartHasData: false,
    heatCells: [],
    heatSum: '',

    planNodes: [],
    planTip: '',

    taskTitle: '',
    taskDone: 0,
    taskTarget: 0,
    taskPicker: false,
    todoOptions: [],

    panel: '',
    statsDetail: [],
    settings: DEFAULT_POMO_SETTINGS,
    dailyTarget: 4,
    weeklyTarget: 20,

    achvSummary: { count: 0, minutes: 0, streak: 0 },
    achvBadges: [],

    done: null
  },

  /* —— 非响应式实例字段（不进 data，避免每 tick 触发无谓 diff） —— */
  timer: null as ReturnType<typeof setInterval> | null,
  pulseTimer: null as ReturnType<typeof setTimeout> | null,
  logs: [] as IPomoLog[],
  stats: EMPTY_STATS,
  todoId: null as string | null,
  todoTitle: '' as string,
  nextModeKey: 'focus' as PomoMode,
  nextSec: 0,

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const statusBarH = info.statusBarHeight || 20;
    const settings = loadSettings();
    const goals = loadGoals();
    this.setData({
      // 自定义导航栏：状态栏高度 + 一行胶囊高度，标题不会被系统胶囊压住
      headerPadTop: statusBarH + 44,
      // 右侧避让胶囊：标题行已在胶囊下方，只需常规外边距
      headerRightPad: 24,
      settings,
      dailyTarget: goals.dailyTarget,
      weeklyTarget: goals.weeklyTarget,
      totalRounds: settings.longEvery || 4,
      zen: !!settings.zen,
      ambientOn: !!settings.ambient && settings.ambient !== 'off',
      modeList: buildModeList(settings),
      quote: pickDailyQuote(),
      ...layoutScale(info.windowWidth || 375)
    });
    this.logs = loadLocalLogs();
    this.refreshStats();
    this.resetMode('focus');
    this.restoreSession();
    this.loadTodos();
  },

  onShow() {
    // 回到前台立刻按时间戳重算：后台 setInterval 被节流，误差只可能来自这里
    if (this.data.phase === 'running') this.tick();
    // 旋转 / 分屏 / iPad 浮动窗口会改窗口宽，重算一次基准（--u 与双栏）
    this.applyLayoutScale();
  },

  /** 按当前窗口宽重算缩放基准与分栏（详见 layoutScale 注释） */
  applyLayoutScale() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const next = layoutScale(info.windowWidth || 375);
      if (next.uUnit !== this.data.uUnit || next.wide !== this.data.wide) {
        this.setData(next);
      }
    } catch (_e) {
      /* 取不到窗口信息就沿用 onLoad 的默认值 */
    }
  },

  onHide() {
    this.persistSession();
  },

  onUnload() {
    this.stopTimer();
    this.persistSession();
    stopAmbient();
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
  },

  /* ==================== 计时核心（防漂移） ==================== */

  /** elapsed = (now - startAt)/1000 - 累计暂停秒数；暂停时停在暂停那一刻 */
  elapsedNow(): number {
    const s = loadSession();
    if (!s) return this.data.elapsedSec;
    if (s.pausedAt) {
      return Math.max(0, Math.floor((s.pausedAt - s.startAt) / 1000) - s.pausedSec);
    }
    return Math.max(0, Math.floor((Date.now() - s.startAt) / 1000) - s.pausedSec);
  },

  tick() {
    if (this.data.phase !== 'running') return;
    const total = this.data.totalSec;
    const elapsed = clamp(this.elapsedNow(), 0, total);
    const remaining = Math.max(0, total - elapsed);
    this.setData({
      elapsedSec: elapsed,
      remainingSec: remaining,
      progress: total > 0 ? elapsed / total : 0,
      timeText: formatSec(remaining)
    });
    if (elapsed >= total) this.finishRound();
  },

  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), 1000);
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  persistSession() {
    if (this.data.phase === 'running' || this.data.phase === 'paused') {
      const s = loadSession();
      if (s) saveSession(s);
    }
  },

  /** 恢复未结束的会话（小程序重启 / 冷启动 / 跨天回来） */
  restoreSession() {
    const s = loadSession();
    if (!s) return;
    const settings = this.data.settings;
    const total = s.plannedSec || modeSec(s.mode, settings);
    const elapsed = clamp(this.elapsedNow(), 0, total);
    const paused = !!s.pausedAt;
    this.todoId = s.todoId || null;
    this.todoTitle = s.todoTitle || '';
    this.setData({
      mode: s.mode,
      totalSec: total,
      elapsedSec: elapsed,
      remainingSec: Math.max(0, total - elapsed),
      progress: total > 0 ? elapsed / total : 0,
      timeText: formatSec(Math.max(0, total - elapsed)),
      phase: paused ? 'paused' : 'running',
      round: clamp((s.focusCount || 0) + 1, 1, settings.longEvery || 4),
      totalRounds: settings.longEvery || 4,
      modeLabel: modeLabelCn(s.mode),
      banner: paused ? '专注已暂停' : runningBanner(s.mode),
      primaryText: paused ? '继续专注' : '暂停专注',
      primaryIcon: paused ? '▶' : '❚❚',
      focusing: !paused,
      taskTitle: s.todoTitle || '',
      done: null
    });
    if (!paused) this.startTimer();
  },

  /** 切换模式：重置为 idle 并按模式取时长 */
  resetMode(mode: PomoMode, overrideSec?: number) {
    const total = overrideSec && overrideSec > 0 ? overrideSec : modeSec(mode, this.data.settings);
    this.stopTimer();
    clearSession();
    this.setData({
      mode,
      phase: 'idle',
      totalSec: total,
      elapsedSec: 0,
      remainingSec: total,
      progress: 0,
      timeText: formatSec(total),
      modeLabel: modeLabelCn(mode),
      banner: '',
      primaryText: '开始专注',
      primaryIcon: '▶',
      focusing: false,
      done: null
    });
  },

  /* ==================== 主按钮 ==================== */

  onPrimary() {
    if (this.data.phase === 'running') {
      this.pauseRound();
      return;
    }
    if (this.data.phase === 'finished') {
      this.nextRound();
      return;
    }
    this.startRound();
  },

  startRound() {
    const now = Date.now();
    const mode = this.data.mode;
    let startAt = now;
    let pausedSec = 0;
    let elapsed = 0;
    if (this.data.phase === 'paused') {
      const s = loadSession();
      if (s) {
        startAt = s.startAt;
        // 继续专注：把本次暂停时长累加进 pausedSec，时间轴才连续
        pausedSec = engineResume({ pausedAt: s.pausedAt, pausedSec: s.pausedSec }, now);
        elapsed = clamp(Math.floor((now - startAt) / 1000) - pausedSec, 0, this.data.totalSec);
      }
    }
    saveSession({
      sid: `pomo_${startAt}_${mode}`,
      mode,
      plannedSec: this.data.totalSec,
      startAt,
      pausedSec,
      pausedAt: 0,
      todoId: this.todoId,
      todoTitle: this.todoTitle,
      focusCount: this.data.round - 1
    });
    this.setData({
      phase: 'running',
      elapsedSec: elapsed,
      remainingSec: Math.max(0, this.data.totalSec - elapsed),
      progress: this.data.totalSec > 0 ? elapsed / this.data.totalSec : 0,
      timeText: formatSec(Math.max(0, this.data.totalSec - elapsed)),
      banner: runningBanner(mode),
      primaryText: '暂停专注',
      primaryIcon: '❚❚',
      focusing: true,
      done: null
    });
    const st = this.data.settings;
    if (st.ambient !== 'off') playAmbient({ key: st.ambient, volume: st.ambientVolume });
    this.startTimer();
  },

  pauseRound() {
    if (this.data.phase !== 'running') return;
    const s = loadSession();
    const now = Date.now();
    if (s) {
      saveSession({ ...s, pausedAt: now, pausedSec: enginePause(s.startAt, s.pausedSec, now).pausedSec });
    }
    this.stopTimer();
    this.setData({
      phase: 'paused',
      banner: '专注已暂停',
      primaryText: '继续专注',
      primaryIcon: '▶',
      focusing: false
    });
    this.persistSession();
  },

  /** 放弃本轮：记 abandoned，不计入完成数 */
  onAbandon() {
    if (this.data.phase !== 'running' && this.data.phase !== 'paused') return;
    this.stopTimer();
    const now = Date.now();
    const s = loadSession();
    const log = buildLog(
      {
        plannedSec: this.data.totalSec,
        actualSec: this.data.elapsedSec,
        mode: this.data.mode,
        startAt: s ? s.startAt : now - this.data.elapsedSec * 1000,
        endAt: now,
        todoId: this.todoId,
        todoTitle: this.todoTitle,
        status: 'abandoned'
      },
      pomoDateKey
    );
    this.commitLog(log);
    clearSession();
    stopAmbient();
    this.setData({ phase: 'finished', focusing: false, done: null, banner: '' });
    toast('已放弃本轮');
  },

  /** 完成一轮（需求十六 + 二十六）：日志 → 统计 → 连续天数 → 目标进度 → 克制奖励 */
  finishRound() {
    this.stopTimer();
    const now = Date.now();
    const planned = this.data.totalSec;
    const s = loadSession();
    const wasFocus = this.data.mode === 'focus';
    const log = buildLog(
      {
        plannedSec: planned,
        actualSec: planned,
        mode: this.data.mode,
        startAt: s ? s.startAt : now - planned * 1000,
        endAt: now,
        todoId: this.todoId,
        todoTitle: this.todoTitle,
        status: 'completed'
      },
      pomoDateKey
    );
    this.commitLog(log);
    clearSession();
    stopAmbient();

    const minutes = Math.round(planned / 60);
    const totalRounds = this.data.totalRounds || 4;
    const round = wasFocus ? this.data.round + 1 : this.data.round;
    const next = nextMode(this.data.mode, round - 1, this.data.settings);
    // 智能休息：下一轮是休息时，按「本轮时长 + 今日已完成数」动态加长
    const nextSec = adaptiveRestSec(
      next,
      this.data.settings,
      planned,
      this.stats.todayCount + (wasFocus ? 1 : 0)
    );
    this.nextModeKey = next;
    this.nextSec = nextSec;

    this.setData({
      phase: 'finished',
      elapsedSec: planned,
      remainingSec: 0,
      progress: 1,
      timeText: '00:00',
      round: clamp(round, 1, totalRounds),
      primaryText: '开始下一轮',
      primaryIcon: '▶',
      banner: '',
      focusing: false,
      // 换一句激励语：同一句连续出现两遍会显得敷衍
      quote: pickDailyQuote(Date.now(), wasFocus ? round : 0),
      done: {
        title: completeTitle(this.data.mode),
        minutes,
        rounds: wasFocus ? 1 : 0,
        nextText:
          next === 'focus'
            ? '开始下一轮专注'
            : '去' + (next === 'short' ? '短休息' : '长休息') + ' ' + Math.round(nextSec / 60) + ' 分钟'
      }
    });

    const st = this.data.settings;
    if (st.vibrate) {
      try {
        wx.vibrateLong({});
      } catch (_e) {
        /* 部分机型不支持，忽略 */
      }
    }
    if (st.sound) {
      try {
        playFinishTone(st.finishTone, st.toneVolume);
      } catch (_e) {
        /* 音频初始化失败不影响主流程 */
      }
    }
    this.firePulse();
  },

  nextRound() {
    const mode = this.nextModeKey || 'focus';
    const sec = this.nextSec || 0;
    this.resetMode(mode, sec);
    if (this.data.settings.autoCycle) {
      setTimeout(() => {
        if (this.data.phase === 'idle') this.startRound();
      }, 400);
    }
  },

  onDismissDone() {
    this.setData({ done: null });
  },

  /** 一次性光环扩散（canvas 不参与，纯 CSS） */
  firePulse() {
    this.setData({ pulse: true });
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.pulseTimer = setTimeout(() => this.setData({ pulse: false }), 1000);
  },

  /* ==================== 数据闭环 ==================== */

  /** 写本地 + 同步云端 + 刷统计（完成/放弃共用，保证口径一致） */
  commitLog(log: IPomoLog) {
    appendLocalLog(log);
    this.logs = [log, ...this.logs];
    this.refreshStats();
    callFn('pomoLogs', { action: 'upsert', ...log }).catch(() => {
      /* 云端失败不打扰：本地已写，下次同步会补 */
    });
  },

  refreshStats() {
    const stats = computeStats(this.logs);
    this.stats = stats;
    const goals = loadGoals();
    const target = goals.dailyTarget;
    const done = stats.todayCount;
    const pct = target > 0 ? clamp(Math.round((done / target) * 100), 0, 100) : 0;
    const half = Math.max(1, Math.ceil(target / 2));

    // 今日目标卡
    const goalSideK = '本周';
    const goalSideV = `${stats.weekCount} 轮`;

    // 今日数据三列（全真实）
    const statCards: StatCard[] = [
      {
        key: 'focus',
        icon: '🍅',
        label: '今日专注',
        value: String(stats.todayMinutes),
        unit: '分钟',
        bar: -1,
        showBar: false,
        sub: `完成 ${done} 轮`,
        tone: ''
      },
      {
        key: 'streak',
        icon: '🔥',
        label: '连续坚持',
        value: String(stats.streak),
        unit: '天',
        bar: -1,
        showBar: false,
        sub: stats.streak > 0 ? streakMessage(stats.streak) : '尚未开始',
        tone: ''
      },
      {
        key: 'goal',
        icon: '🎯',
        label: '今日目标',
        value: String(done),
        unit: `/ ${target} 轮`,
        bar: pct,
        showBar: true,
        sub: '',
        tone: ''
      }
    ];

    // 今日成长计划（真实日志推导的进度节点）
    const planNodes: PlanNode[] = [
      {
        key: 'start',
        glyph: done > 0 ? '✔' : '①',
        text: '开启今日第一段专注',
        state: done > 0 ? 'done' : 'active'
      },
      {
        key: 'half',
        glyph: done >= half ? '✔' : '②',
        text: `完成今日目标一半（${half} 轮）`,
        state: done >= half ? 'done' : done > 0 ? 'active' : 'todo'
      },
      {
        key: 'goal',
        glyph: done >= target ? '✔' : '③',
        text: `达成今日 ${target} 轮目标`,
        state: done >= target ? 'done' : done >= half ? 'active' : 'todo'
      },
      {
        key: 'streak',
        glyph: stats.streak > 0 ? '✔' : '④',
        text: '连续打卡不间断',
        state: stats.streak > 0 ? 'done' : done >= target ? 'active' : 'todo'
      }
    ];
    const remain = Math.max(0, target - done);
    const planTip =
      done >= target
        ? '今日目标已达成，超额也是进步'
        : `已完成 ${done} 轮，还差 ${remain} 轮达成今日目标`;

    // 成就（真实统计推导，绝不编造比例）
    const achvSummary: AchvSummary = {
      count: stats.totalCount,
      minutes: stats.totalMinutes,
      streak: stats.streak
    };
    const achvBadges: AchvBadge[] = [
      { key: 'first', glyph: '🌱', label: '初次专注', desc: '完成第一轮', on: stats.totalCount > 0 },
      { key: 'ten', glyph: '🔟', label: '十轮达成', desc: '累计 10 轮', on: stats.totalCount >= 10 },
      { key: 'hundred', glyph: '💯', label: '百轮大师', desc: '累计 100 轮', on: stats.totalCount >= 100 },
      { key: 'streak7', glyph: '🔥', label: '七日不断', desc: '连续 7 天', on: stats.streak >= 7 },
      { key: 'streak30', glyph: '🏔', label: '月月坚持', desc: '连续 30 天', on: stats.streak >= 30 },
      { key: 'm500', glyph: '⏳', label: '专注 500 分', desc: '累计 500 分钟', on: stats.totalMinutes >= 500 },
      { key: 'm2000', glyph: '🕰', label: '专注 2000 分', desc: '累计 2000 分钟', on: stats.totalMinutes >= 2000 },
      { key: 'perfect', glyph: '⭐', label: '完美一日', desc: '单日达成目标', on: done >= target }
    ];

    /* ============ 专注数据图表（全部真实日志，无任何估算占位） ============ */

    // 近 14 天：分钟柱状图 + 轮次柱状图（今天高亮）
    const chartDays: ChartPoint[] = stats.timeline.map((d) => ({
      label: String(Number(d.dateKey.slice(8, 10))),
      value: d.minutes,
      highlight: d.isToday
    }));
    const chartDayCounts: ChartPoint[] = stats.timeline.map((d) => ({
      label: String(Number(d.dateKey.slice(8, 10))),
      value: d.count,
      highlight: d.isToday
    }));

    // 24 小时分布：把 24 根柱子并成 8 个 3 小时段，曲线才读得出趋势
    // （24 点太密，x 轴标签必然重叠；聚成段后既清晰又是真实求和，不是估算）
    const chartHours: ChartPoint[] = [];
    for (let seg = 0; seg < 8; seg++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += stats.hourHistogram[seg * 3 + k] || 0;
      chartHours.push({
        // 只写起始小时数（如 "9"）而不是 "09:00"：8 段时短标签才不会被抽稀掉
        label: String(seg * 3),
        value: sum
      });
    }

    const hasDays = stats.timeline.some((d) => d.minutes > 0);
    const hasHours = stats.hourHistogram.some((v) => v > 0);
    const chartHasData = hasDays || hasHours;
    const rangeMinutes = stats.timeline.reduce((s, d) => s + d.minutes, 0);
    const rangeCount = stats.timeline.reduce((s, d) => s + d.count, 0);
    const chartSum = hasDays
      ? `近 14 天 ${rangeCount} 轮 · ${rangeMinutes} 分钟`
      : '还没有完成的专注记录';
    const bestWindowText = stats.bestWindow
      ? `${stats.bestWindow.label}（${stats.bestWindow.count} 轮）`
      : '至少完成一轮后才会出现';
    const efficientWindows = stats.efficientWindows.map((w) => ({
      label: w.label,
      count: w.count
    }));

    // 12 周热力图：与 stats3/plan 同一套蓝灰玻璃质感，强度 0-4 分级
    const heatCells = stats.heatmap.map((week, w) =>
      week.map((n, d) => ({
        key: w + '-' + d,
        count: n,
        level: heatLevel(n)
      }))
    ).reduce((acc, cur) => acc.concat(cur), [] as { key: string; count: number; level: number }[]);

    this.setData({
      goalTarget: target,
      goalDone: done,
      goalPct: pct,
      goalSideK,
      goalSideV,
      statCards,
      streakDays: stats.streak,
      streakMsg: streakMessage(stats.streak),
      planNodes,
      planTip,
      achvSummary,
      achvBadges,
      chartDays,
      chartDayCounts,
      chartHours,
      chartSum,
      bestWindowText,
      efficientWindows,
      chartHasData,
      heatCells,
      heatSum: `本周 ${stats.weekCount} 轮 · ${stats.weekMinutes} 分钟`,
      taskDone: done,
      taskTarget: target,
      statsDetail: [
        { label: '今日完成', value: stats.todayCount + ' 轮 / ' + stats.todayMinutes + ' 分钟' },
        { label: '本周完成', value: stats.weekCount + ' 轮 / ' + stats.weekMinutes + ' 分钟' },
        { label: '本月完成', value: stats.monthCount + ' 轮 / ' + stats.monthMinutes + ' 分钟' },
        { label: '累计完成', value: stats.totalCount + ' 轮 / ' + stats.totalMinutes + ' 分钟' },
        { label: '连续坚持', value: stats.streak + ' 天' },
        { label: '最佳时段', value: stats.bestWindow ? stats.bestWindow.label : '数据还不够' }
      ]
    });
  },

  /** 图表页签切换（近14天分钟 / 近14天轮数 / 时段分布） */
  onChartTab(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '');
    if (key !== 'day' && key !== 'count' && key !== 'hour') return;
    if (this.data.chartTab === key) return;
    this.setData({ chartTab: key });
  },

  /* ==================== 交互 ==================== */

  onModeChange(e: WechatMiniprogram.CustomEvent<{ mode: PomoMode }>) {
    if (this.data.phase === 'running' || this.data.phase === 'paused') {
      toast('计时中，先暂停再切换');
      return;
    }
    this.resetMode(e.detail.mode);
  },

  onTapTaskAdd() {
    this.setData({ taskPicker: true });
    this.loadTodos();
  },

  onTapTaskPick() {
    this.setData({ taskPicker: true });
    this.loadTodos();
  },

  onPickTodo(e: WechatMiniprogram.TouchEvent) {
    const id = String((e.currentTarget.dataset as { id?: string }).id || '');
    const t = this.data.todoOptions.find((x) => x._id === id);
    this.todoId = t ? t._id : null;
    this.todoTitle = t ? t.content : '';
    this.setData({ taskTitle: this.todoTitle, taskPicker: false });
    this.persistSession();
  },

  onUnbindTask() {
    this.todoId = null;
    this.todoTitle = '';
    this.setData({ taskTitle: '' });
    this.persistSession();
  },

  onClosePicker() {
    this.setData({ taskPicker: false });
  },

  async loadTodos() {
    try {
      await todoStore.ensureLoaded();
      const active = todoStore
        .rawList()
        .filter((t) => !t.completed && !t.archived)
        .slice(0, 30)
        .map((t) => ({ _id: t._id, content: t.content }));
      this.setData({ todoOptions: active });
    } catch (_e) {
      this.setData({ todoOptions: [] });
    }
  },

  onZenToggle() {
    const zen = !this.data.zen;
    const settings = { ...this.data.settings, zen };
    saveSettings(settings);
    this.setData({ settings, zen });
  },

  /**
   * 自定义导航栏的返回键（navigationStyle:custom，系统不画返回箭头）。
   *
   * 两个真实边界必须处理，否则会出现「点了没反应」：
   *  1. **栈底**：从分享卡片 / 快捷方式直接进入时页面栈只有自己，
   *     nav.back() 会静默失败 → 回退到本页真正的来源页「工具中心」兜底。
   *  2. **专注进行中**：直接退出会丢上下文（用户不一定知道计时还在跑），
   *     故先确认；确认后只退页面，**不结束计时** —— 计时基于时间戳 + 本地 session，
   *     回来时 onShow/restoreSession 会接着走。
   */
  onBack() {
    const leave = () => {
      if (stackDepth() > 1) back();
      else relaunch('/pages/tools/tools', { force: true, silent: true });
    };
    if (this.data.phase !== 'running') {
      leave();
      return;
    }
    wx.showModal({
      title: '专注进行中',
      content: '离开后本轮计时仍会继续，回来可接着看。要离开吗？',
      confirmText: '离开',
      cancelText: '继续专注',
      success: (res) => {
        if (res.confirm) leave();
      },
      fail: () => undefined
    });
  },

  onOpenPanel(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '') as PageData['panel'];
    // 底部导航高亮跟随打开的面板
    const dock: PageData['dockActive'] =
      key === 'stats' ? 'stats' : key === 'achv' ? 'achv' : key === 'settings' ? 'me' : 'home';
    this.setData({ panel: key, dockActive: dock });
  },

  onClosePanel() {
    this.setData({ panel: '', dockActive: 'home' });
  },

  onStepDuration(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { key?: string; delta?: string };
    const key = ds.key as 'focusSec' | 'shortSec' | 'longSec';
    const delta = Number(ds.delta || 0);
    if (!key || !delta) return;
    const next = clamp(this.data.settings[key] + delta * 60, 60, 180 * 60);
    const settings = { ...this.data.settings, [key]: next };
    saveSettings(settings);
    this.setData({ settings, modeList: buildModeList(settings) });
    // 空闲态立即生效，避免「改了设置但要等下一轮」
    const match =
      (key === 'focusSec' && this.data.mode === 'focus') ||
      (key === 'shortSec' && this.data.mode === 'short') ||
      (key === 'longSec' && this.data.mode === 'long');
    if (this.data.phase === 'idle' && match) this.resetMode(this.data.mode, next);
  },

  onStepLongEvery(e: WechatMiniprogram.TouchEvent) {
    const delta = Number((e.currentTarget.dataset as { delta?: string }).delta || 0);
    const next = clamp(this.data.settings.longEvery + delta, 2, 8);
    const settings = { ...this.data.settings, longEvery: next };
    saveSettings(settings);
    this.setData({ settings, totalRounds: next, modeList: buildModeList(settings) });
  },

  onStepGoal(e: WechatMiniprogram.TouchEvent) {
    const delta = Number((e.currentTarget.dataset as { delta?: string }).delta || 0);
    const daily = clamp(this.data.dailyTarget + delta, 1, 30);
    const weekly = Math.max(1, Math.round((daily * 7) / 2));
    saveGoals({ dailyTarget: daily, weeklyTarget: weekly });
    this.setData({ dailyTarget: daily, weeklyTarget: weekly });
    this.refreshStats();
  },

  onToggleSetting(e: WechatMiniprogram.TouchEvent) {
    const key = String((e.currentTarget.dataset as { key?: string }).key || '') as
      | 'autoCycle'
      | 'autoBreak'
      | 'adaptive'
      | 'vibrate'
      | 'sound';
    if (!key) return;
    const settings = { ...this.data.settings, [key]: !this.data.settings[key] };
    saveSettings(settings);
    this.setData({ settings });
  },

  /** 环境音开关：开启用默认雨声，关闭写入 'off' */
  onToggleAmbient() {
    const s = this.data.settings;
    const nextKey = s.ambient && s.ambient !== 'off' ? 'off' : 'rain';
    const settings = { ...s, ambient: nextKey };
    saveSettings(settings);
    this.setData({ settings, ambientOn: nextKey !== 'off' });
    if (this.data.phase === 'running') {
      if (nextKey !== 'off') playAmbient({ key: nextKey, volume: s.ambientVolume });
      else stopAmbient();
    }
  },

  /* —— 底部导航（全部是真实去向，不留死链） —— */
  onDockHome() {
    this.setData({ panel: '', dockActive: 'home' });
    try {
      wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    } catch (_e) {
      /* 不支持时忽略 */
    }
  },
  onDockStats() {
    this.setData({ panel: 'stats', dockActive: 'stats' });
  },
  onDockAchv() {
    this.setData({ panel: 'achv', dockActive: 'achv' });
  },
  onDockMe() {
    this.setData({ panel: 'settings', dockActive: 'me' });
  },

  /** 空实现：配合 catchtap 阻止「点面板内部」冒泡到遮罩的关闭手势 */
  noop() {
    /* 占位 */
  }
});
