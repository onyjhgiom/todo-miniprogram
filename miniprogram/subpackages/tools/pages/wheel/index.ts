// subpackages/tools/pages/wheel/index.ts
// 万能转盘 · 主页：canvas 转盘 + 转动动画 + 结果弹窗 + 模板库入口
//
// ★ 动画为什么按「时间」而不是按「帧」推进：
//   低端机一秒只能出 20 帧，若每帧固定加一个角度，转动总时长会被拉长、
//   且不同机型快慢不一。这里每帧都用 `Date.now() - t0` 反查当前应到的角度，
//   掉帧只影响流畅度，不影响落点与总时长（验收：时长误差 <100ms）。
//
// ★ 运行时状态（画布句柄 / 旋转角 / 动画 id）放在模块级变量里，不放 this：
//   一是避免 Page<T> 泛型里塞一堆非视图字段，二是绘制回调频繁触发，
//   少一层属性访问。注意这些变量的生命周期跟随页面实例，页面卸载时统一清理。

import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { go, back } from '../../../../utils/nav';
import * as todoStore from '../../../../utils/todo-store';
import * as store from '../../utils/wheel-store';
import { drawWheel, inkOn, drawPoster } from '../../utils/wheel-canvas';
import {
  TEMPLATES, TEMPLATE_CATEGORIES, getTemplate, templatesOf, PALETTES
} from '../../utils/wheel-templates';
import type { PaletteKey, IWheelTemplate } from '../../utils/wheel-templates';
import type { IWheel, IWheelOption, WheelDuration } from '../../utils/wheel-store';
import type { ThemeKey } from '../../../../types/index';

/* ==================== 运行时状态（模块级） ==================== */

let canvas: WechatMiniprogram.Canvas | null = null;
let ctx: WechatMiniprogram.CanvasRenderingContext | null = null;
let dpr = 2;
/** 当前转盘（内存态，视图数据由 buildVM 同步） */
let wheel: IWheel | null = null;
/** 当前旋转角（度，顺时针为正，累积不取模，保证动画连续） */
let rotation = 0;
/** 动画帧 id / 定时器 id */
let rafId: number | null = null;
/** 转动中标记（与 data.spinning 同步，动画回调里读它比读 data 快） */
let spinning = false;
/** 上一帧指针所在的扇区序号（用于滴答声去重） */
let lastSeg = -1;
/** 本轮被排除的选项 id（「移除此项再转一次」） */
let excluded: string[] = [];
/** 最近一次结果 */
let lastResult: { index: number; text: string; icon: string; color: string } | null = null;
/** 三个音效实例（懒创建） */
const audioMap: Record<string, WechatMiniprogram.InnerAudioContext> = {};
/** 摇一摇节流时间戳 */
let lastShakeAt = 0;
let lastAccMag = 0;
/** 是否低端机（降分辨率 + 简化撒花） */
let lowEnd = false;

/** 收藏的转盘 id 集合（本地持久化，仅本页消费） */
let favSet: Set<string> = new Set<string>();
try {
  const raw = wx.getStorageSync('wheel_favs');
  if (Array.isArray(raw)) favSet = new Set<string>(raw as string[]);
} catch (e) {
  /* 忽略 */
}
function persistFavs(): void {
  try { wx.setStorageSync('wheel_favs', Array.from(favSet)); } catch (e) { /* 忽略 */ }
}
function isFaved(id: string): boolean {
  return favSet.has(id);
}

/**
 * 加速度计 API：项目自带的 wx 类型声明里没有这一组方法（小程序基础库是有的），
 * 这里集中做一次带默认值的取用，既过类型检查，也保证老机型上不会崩。
 */
function accelApi(): {
  startAccelerometer?: (o: { interval: string }) => void;
  onAccelerometerChange?: (cb: (r: { x: number; y: number; z: number }) => void) => void;
  stopAccelerometer?: () => void;
  offAccelerometerChange?: () => void;
} {
  return wx as unknown as {
    startAccelerometer?: (o: { interval: string }) => void;
    onAccelerometerChange?: (cb: (r: { x: number; y: number; z: number }) => void) => void;
    stopAccelerometer?: () => void;
    offAccelerometerChange?: () => void;
  };
}

const AUDIO_SRC: Record<string, string> = {
  tick: '/subpackages/tools/assets/wheel/audio/tick.wav',
  ding: '/subpackages/tools/assets/wheel/audio/ding.wav',
  confetti: '/subpackages/tools/assets/wheel/audio/confetti.wav'
};

/** 当前帧调度方式：raf=画布自带的 requestAnimationFrame，timer=退化定时器 */
let rafMode: 'raf' | 'timer' = 'timer';

/**
 * 帧调度：优先用画布自带的 rAF（贴合屏幕刷新率，更顺滑），
 * 取不到时退化为 16ms 定时器。注意即使退化，角度也是按时间反查的，
 * 所以只影响流畅度，不影响总时长与落点。
 */
function raf(cb: () => void): number {
  const c = canvas as unknown as {
    requestAnimationFrame?: (f: () => void) => number;
  };
  if (c && typeof c.requestAnimationFrame === 'function') {
    rafMode = 'raf';
    return c.requestAnimationFrame(cb);
  }
  rafMode = 'timer';
  return setTimeout(cb, 16) as unknown as number;
}

function cancelRaf(): void {
  if (rafId === null) return;
  if (rafMode === 'raf') {
    const c = canvas as unknown as { cancelAnimationFrame?: (id: number) => void };
    if (c && typeof c.cancelAnimationFrame === 'function') c.cancelAnimationFrame(rafId);
  } else {
    clearTimeout(rafId as unknown as ReturnType<typeof setTimeout>);
  }
  rafId = null;
}

/* ==================== 视图模型 ==================== */

interface IVMOption {
  id: string;
  text: string;
  color: string;
  icon: string;
  weight: number;
  ink: string;
  idx: number;
  done: boolean;
}

interface IVMTemplate {
  id: string;
  name: string;
  icon: string;
  desc: string;
  count: number;
  uses: number;
  colors: string[];
}

interface IIndexData {
  theme: ThemeKey;
  themeStyle: string;
  /** 状态栏高度（自定义导航栏时用来给头部留出空间） */
  statusBarHeight: number;
  /** 当前转盘是否已收藏 */
  faved: boolean;
  size: number;
  /** 中心「开始」按钮直径（跟随转盘尺寸，避免挡到扇区文字） */
  spinSize: number;
  wheelId: string;
  wheelName: string;
  wheelIcon: string;
  options: IVMOption[];
  optCount: number;
  canSpin: boolean;
  spinning: boolean;
  /** 结果弹窗 */
  showResult: boolean;
  resultText: string;
  resultIcon: string;
  resultColor: string;
  resultInk: string;
  /** 结果文案偏长（>6 字）时收字号，保证不换行溢出 */
  resultLong: boolean;
  /** 结果元信息，如「从 6 个选项中抽出 · 权重 ×3」 */
  resultMeta: string;
  canReroll: boolean;
  /** 结果弹窗期间隐藏画布（原生组件层级压不住弹窗） */
  canvasOff: boolean;
  confetti: { id: number; left: number; delay: number; dur: number; color: string; rot: number }[];
  /** 模板弹层 */
  showTpl: boolean;
  tplCats: { key: string; label: string; icon: string }[];
  tplActive: string;
  tplList: IVMTemplate[];
  /** 设置弹层 */
  showSet: boolean;
  setDuration: WheelDuration;
  setSound: boolean;
  setVibrate: boolean;
  setShake: boolean;
  setMuted: boolean;
  setReward: boolean;
  /** 转盘列表弹层（切换/新建/复制/删除） */
  showList: boolean;
  wheelList: { id: string; name: string; icon: string; count: number; current: boolean }[];
  themeName: string;
}

const CONFETTI_COLORS = ['#FF6B81', '#FFD32A', '#4ADE80', '#60A5FA', '#A78BFA', '#FF9F43'];

Page<IIndexData>({
  data: {
    theme: 'light',
    themeStyle: '',
    statusBarHeight: 20,
    faved: false,
    size: 300,
    spinSize: 168,
    wheelId: '',
    wheelName: '',
    wheelIcon: '🎡',
    options: [],
    optCount: 0,
    canSpin: true,
    spinning: false,
    showResult: false,
    resultText: '',
    resultIcon: '',
    resultColor: '#FF6B81',
    resultInk: '#FFFFFF',
    resultLong: false,
    resultMeta: '',
    canReroll: false,
    canvasOff: false,
    confetti: [],
    showTpl: false,
    tplCats: TEMPLATE_CATEGORIES,
    tplActive: 'eat',
    tplList: [],
    showSet: false,
    setDuration: 'standard',
    setSound: true,
    setVibrate: true,
    setShake: false,
    setMuted: false,
    setReward: true,
    showList: false,
    wheelList: [],
    themeName: ''
  },

  /* ==================== 生命周期 ==================== */

  onLoad(query: Record<string, string>) {
    this.applyThemeToPage();
    this.setupSize();

    // 分享进来：?tpl=xxx → 使用同款，复制一份到自己的转盘列表
    const tplId = query && query.tpl;
    if (tplId) {
      const tpl = getTemplate(tplId);
      if (tpl && !store.isFull()) {
        const w = store.createFromTemplate(tpl);
        store.markTemplateUsed(tplId);
        store.setCurrent(w._id);
      }
    }

    // 首页彩蛋进来（?reward=1）：直接切到「幸运转盘」，没有就建一个
    const reward = query && query.reward === '1';
    if (reward) {
      const tpl = getTemplate('reward-lucky');
      if (tpl) {
        const exist = store.listWheels().find((w) => w.templateId === 'reward-lucky');
        const w = exist || (store.isFull() ? null : store.createFromTemplate(tpl));
        if (w) store.setCurrent(w._id);
      }
      // 彩蛋场景不再弹模板层，直接让用户转
      store.markSeen();
    }

    wheel = store.ensureCurrent();
    rotation = 0;
    excluded = [];
    this.buildVM();
    if (!reward) this.maybeFirstRun();
  },

  onReady() {
    this.initCanvas();
  },

  onShow() {
    this.applyThemeToPage();
    // 编辑页保存 / 历史页重抽后返回：重新取一次转盘，保证是最新的
    wheel = store.getWheel(this.data.wheelId) || store.ensureCurrent();
    this.buildVM();
    this.draw(-1);
    this.syncShake();
  },

  onHide() {
    this.stopShake();
    // 转动途中离开页面：立刻停掉动画并保持静止（验收：重新进入是静止状态）。
    // 不在这里补结果弹窗 —— 用户没看到停下过程，补一个结果反而莫名其妙。
    if (spinning) {
      cancelRaf();
      spinning = false;
      this.setData({ spinning: false, canSpin: true, showResult: false, canvasOff: false, confetti: [] });
    }
    // 离开页面时立即落盘，避免转动过程中断导致配置丢失
    store.saveNow();
  },

  onUnload() {
    cancelRaf();
    this.stopShake();
    store.saveNow();
    Object.keys(audioMap).forEach((k) => {
      try { audioMap[k].destroy(); } catch (e) { /* 忽略 */ }
      delete audioMap[k];
    });
    canvas = null;
    ctx = null;
  },

  /* ==================== 主题与尺寸 ==================== */

  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      themeName: state.themeName
    });
    syncNavBar(state);
  },

  setupSize() {
    let winW = 375;
    let pixelRatio = 2;
    let bench = -1;
    let statusBar = 20;
    try {
      const info = wx.getSystemInfoSync();
      winW = Number(info.windowWidth) || 375;
      pixelRatio = Number(info.pixelRatio) || 2;
      bench = Number((info as { benchmarkLevel?: number }).benchmarkLevel) || -1;
      statusBar = Number((info as { statusBarHeight?: number }).statusBarHeight) || 20;
    } catch (e) {
      /* 忽略 */
    }
    // 低端机（benchmarkLevel < 5）降分辨率 + 简化撒花，保证转动不掉帧
    lowEnd = bench > 0 && bench < 5;
    dpr = Math.min(pixelRatio, lowEnd ? 1.5 : 2.5);
    const size = Math.max(240, Math.min(Math.floor(winW - 56), 340));
    // 中心洞的直径 = 0.6 × 半径 = 0.3 × size，按钮再收一点，保证不压住扇区文字
    this.setData({ size, spinSize: Math.round(size * 0.52), statusBarHeight: statusBar });
  },

  initCanvas() {
    const that = this;
    const q = wx.createSelectorQuery();
    q.select('#wheelCanvas').fields({ node: true, size: true }).exec((res: unknown) => {
      const item = (res as { node?: WechatMiniprogram.Canvas; width?: number; height?: number }[])[0];
      if (!item || !item.node) return;
      const cv = item.node;
      const c = cv.getContext('2d');
      if (!c) return;
      canvas = cv;
      ctx = c;
      cv.width = Math.round((item.width || that.data.size) * dpr);
      cv.height = Math.round((item.height || that.data.size) * dpr);
      c.scale(dpr, dpr);
      that.draw(-1);
    });
  },

  /** 绘制转盘（highlight < 0 表示不高亮） */
  draw(highlight: number) {
    if (!ctx || !wheel) return;
    drawWheel(ctx, {
      size: this.data.size,
      options: wheel.options,
      rotation,
      highlight: highlight >= 0 ? highlight : undefined,
      centerHole: true
    });
  },

  /* ==================== 视图同步 ==================== */

  buildVM() {
    const w = wheel;
    if (!w) return;
    const options: IVMOption[] = w.options.map((o, i) => ({
      id: o.id,
      text: o.text,
      color: o.color,
      icon: o.icon || '',
      weight: o.weight,
      ink: inkOn(o.color),
      idx: i,
      done: !!o.done
    }));
    const cfg = store.globalCfgOf();
    this.setData({
      wheelId: w._id,
      wheelName: w.name,
      wheelIcon: w.icon,
      options,
      optCount: options.length,
      faved: isFaved(w._id),
      canSpin: options.length >= store.MIN_OPTIONS && !spinning,
      setDuration: w.settings.duration,
      setSound: w.settings.soundEnabled,
      setVibrate: w.settings.vibrateEnabled,
      setShake: w.settings.shakeEnabled,
      setMuted: cfg.muted,
      setReward: cfg.rewardEnabled
    });
  },

  maybeFirstRun() {
    if (!store.isFirstRun()) return;
    store.markSeen();
    // 首次进入直接把模板库铺开，让用户选一个就能转
    this.openTemplates();
  },

  /* ==================== 音效 / 震动 ==================== */

  muted(): boolean {
    const cfg = store.globalCfgOf();
    if (cfg.muted) return true;
    return !wheel || !wheel.settings.soundEnabled;
  },

  play(name: string) {
    if (this.muted()) return;
    try {
      let a = audioMap[name];
      if (!a) {
        a = wx.createInnerAudioContext();
        a.src = AUDIO_SRC[name];
        audioMap[name] = a;
      }
      a.stop();
      a.seek(0);
      a.play();
    } catch (e) {
      /* 音频不可用不影响主流程 */
    }
  },

  vibrate() {
    if (!wheel || !wheel.settings.vibrateEnabled) return;
    try {
      wx.vibrateShort({ type: 'light', fail: () => undefined });
    } catch (e) {
      try { wx.vibrateShort(); } catch (e2) { /* 忽略 */ }
    }
  },

  /* ==================== 转动 ==================== */

  onSpin() {
    if (spinning) return;
    if (!wheel) return;
    const opts = wheel.options;
    if (opts.length < store.MIN_OPTIONS) {
      toast(`至少添加 ${store.MIN_OPTIONS} 个选项`);
      return;
    }

    const idx = store.pickIndex(opts, excluded);
    if (idx < 0) return;

    const n = opts.length;
    const sa = 360 / n;
    const center = idx * sa + sa / 2;
    // 指针固定在 12 点：转盘本地角度 mod(-rotation,360) 落在扇区中线时即中该扇区。
    // 因此目标角 = 360 - center，再叠 ±3° 的随机偏移（验收：落点在中线 ±3° 内）。
    let target = (360 - center) % 360 + (Math.random() * 6 - 3);
    if (target < 0) target += 360;

    const T = store.DURATION_MS[wheel.settings.duration] || 3500;
    const turns = T >= 5000 ? 7 : T >= 3500 ? 5 : 3;
    const cur = rotation;
    const curMod = ((cur % 360) + 360) % 360;
    let delta = target - curMod;
    while (delta < 0) delta += 360;
    const total = delta + 360 * turns;

    // 时间曲线：0.2s 加速 → 匀速 → 1.5s 减速。
    // 三段积分得总角度 = ωp × (tc + 0.85)，反解出峰值角速度 ωp。
    const tc = Math.max(0.05, (T - 1700) / 1000);
    const wp = total / (tc + 0.85);
    const angleAt = (ms: number): number => {
      const s = ms / 1000;
      const a1 = wp * 0.1; // 加速段角度 = ½ × ωp × 0.2
      if (s <= 0.2) return (wp * s * s) / 0.4;
      if (s <= 0.2 + tc) return a1 + wp * (s - 0.2);
      const u = s - (0.2 + tc);
      return a1 + wp * tc + wp * (u - (u * u) / 3);
    };

    spinning = true;
    lastSeg = -1;
    this.setData({ spinning: true, canSpin: false, showResult: false, canvasOff: false });

    const t0 = Date.now();
    const step = () => {
      if (!spinning) return;
      const ms = Date.now() - t0;
      if (ms >= T) {
        rotation = cur + total;
        this.draw(idx);
        this.bounce(idx);
        return;
      }
      rotation = cur + angleAt(ms);
      this.draw(-1);
      // 滴答：指针扫过扇区边界时响一声（只在减速段播，越慢节奏越疏）
      const pMod = (((-rotation % 360) + 360) % 360);
      const seg = Math.floor(pMod / sa) % n;
      if (seg !== lastSeg) {
        lastSeg = seg;
        if (ms / 1000 > 0.2 + tc) this.play('tick');
      }
      rafId = raf(step);
    };
    rafId = raf(step);
  },

  /** 停下的回弹：过冲 2.6° 再回位，模拟指针被扇区边界「挡」了一下 */
  bounce(idx: number) {
    const base = rotation;
    const t0 = Date.now();
    const up = 130;
    const down = 170;
    const step = () => {
      const ms = Date.now() - t0;
      if (ms < up) {
        rotation = base + 2.6 * (ms / up);
      } else if (ms < up + down) {
        rotation = base + 2.6 * (1 - (ms - up) / down);
      } else {
        rotation = base;
        this.draw(idx);
        this.onStopped(idx);
        return;
      }
      this.draw(idx);
      rafId = raf(step);
    };
    step();
  },

  onStopped(idx: number) {
    spinning = false;
    if (!wheel) return;
    const opt = wheel.options[idx];
    if (!opt) return;
    lastResult = { index: idx, text: opt.text, icon: opt.icon || '', color: opt.color };

    store.markUsed(wheel._id);
    store.addRecord(wheel, opt);
    this.play('ding');
    this.vibrate();

    const remain = wheel.options.filter((o) => excluded.indexOf(o.id) < 0).length;
    this.setData({
      spinning: false,
      canSpin: true,
      showResult: true,
      // 画布先隐藏再显示弹窗，避免原生组件把弹窗压在下面
      canvasOff: true,
      resultText: opt.text,
      resultIcon: opt.icon || '',
      resultColor: opt.color,
      resultInk: inkOn(opt.color),
      resultLong: opt.text.length > 6,
      resultMeta: this.buildResultMeta(opt.id),
      // 池子里还有 3 个以上才允许「移除此项再转」
      canReroll: remain >= 3,
      confetti: this.makeConfetti()
    });
    this.play('confetti');
  },

  /** 结果卡下方那行小字：说清「这次是从多大的池子里抽的」，权重偏离时给一句解释 */
  buildResultMeta(optId: string): string {
    if (!wheel) return '';
    const pool = wheel.options.filter((o) => excluded.indexOf(o.id) < 0);
    const parts: string[] = [`从 ${pool.length} 个选项中抽出`];
    const opt = wheel.options.filter((o) => o.id === optId)[0];
    if (opt) {
      const others = pool.filter((o) => o.id !== optId);
      const avg = others.length
        ? others.reduce((s, o) => s + (o.weight || 1), 0) / others.length
        : 1;
      const w = opt.weight || 1;
      if (w > 1 && w >= avg * 1.05) parts.push(`权重 ×${w}，比平均更容易中`);
      else if (w < avg * 0.95) parts.push(`权重 ×${w}，比平均更难中`);
      else if (w > 1) parts.push(`权重 ×${w}`);
    }
    if (excluded.length) parts.push(`本轮已剔除 ${excluded.length} 项`);
    return parts.join(' · ');
  },

  makeConfetti() {
    const n = lowEnd ? 12 : 24;
    const out: { id: number; left: number; delay: number; dur: number; color: string; rot: number }[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        id: i,
        left: Math.round(Math.random() * 100),
        delay: Math.round(Math.random() * 500),
        dur: 1200 + Math.round(Math.random() * 900),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rot: Math.round(Math.random() * 360)
      });
    }
    return out;
  },

  /* ==================== 结果弹窗操作 ==================== */

  /** 关掉结果浮层并恢复画布。
   *  弹窗期间画布是 display:none，恢复显示后部分机型内容会被清空，
   *  所以等一帧再重绘一次；后续动作（再转一次等）放到 done 里执行。 */
  hideResult(done?: () => void) {
    this.setData({ showResult: false, confetti: [], canvasOff: false });
    setTimeout(() => {
      this.draw(-1);
      if (done) done();
    }, 80);
  },

  onResultClose() {
    this.hideResult();
  },

  /** 再来一次：不清空本轮已排除项（保持「抽过的不再抽」的连续体验） */
  onResultAgain() {
    this.hideResult(() => setTimeout(() => this.onSpin(), 40));
  },

  /** 移除此项并再转一次：只在本轮剔除，重启转盘后恢复 */
  onResultReroll() {
    if (!lastResult || !wheel) return;
    const opt = wheel.options[lastResult.index];
    if (opt && excluded.indexOf(opt.id) < 0) excluded.push(opt.id);
    this.hideResult(() => setTimeout(() => this.onSpin(), 40));
  },

  /** 结果转待办：本地立即落库（离线可用），再跳详情页可继续编辑 */
  async onResultToTodo() {
    if (!lastResult) return;
    const payload = store.resultToTodo(lastResult.text);
    try {
      const created = await todoStore.addTodo({
        content: payload.content,
        tags: payload.tags,
        dueDate: payload.dueDate
      });
      this.hideResult(() => {
        if (created && created._id) {
          wx.showModal({
            title: '已加入待办',
            content: `「${payload.content}」已创建，截止时间默认今天 18:00`,
            confirmText: '去查看',
            cancelText: '知道了',
            success: (res) => {
              if (res.confirm) go(`/pages/detail/detail?id=${created._id}`, { title: '待办详情' });
            }
          });
        } else {
          toast('已加入待办');
        }
      });
    } catch (err) {
      toast('创建失败，请重试');
    }
  },

  /** 生成结果海报（离屏画布 → 临时文件 → 预览） */
  onResultPoster() {
    if (!lastResult || !wheel) return;
    const W = 640;
    const H = 860;
    try {
      const cv = wx.createOffscreenCanvas({ type: '2d', width: W, height: H }) as unknown as WechatMiniprogram.Canvas;
      const c = cv.getContext('2d');
      if (!c) {
        toast('当前机型不支持生成海报');
        return;
      }
      drawPoster(c as unknown as WechatMiniprogram.CanvasRenderingContext, {
        width: W,
        height: H,
        wheelName: wheel.name,
        wheelIcon: wheel.icon,
        options: wheel.options,
        rotation,
        highlight: lastResult.index,
        result: lastResult.text,
        resultIcon: lastResult.icon,
        footer: '待办清单 · 万能转盘'
      });
      wx.canvasToTempFilePath({
        canvas: cv as unknown as WechatMiniprogram.Canvas,
        x: 0,
        y: 0,
        width: W,
        height: H,
        destWidth: W,
        destHeight: H,
        success: (res) => {
          wx.previewImage({ urls: [res.tempFilePath], current: res.tempFilePath });
        },
        fail: () => toast('生成海报失败')
      });
    } catch (err) {
      toast('生成海报失败');
    }
  },

  /* ==================== 选项操作 ==================== */

  onOptionTap(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { idx?: string };
    const i = Number(ds.idx);
    if (!wheel || isNaN(i) || !wheel.options[i]) return;
    const opt = wheel.options[i];
    wx.showModal({
      title: '修改选项',
      editable: true,
      placeholderText: '最多 10 个字',
      content: opt.text,
      success: (res) => {
        if (!res.confirm) return;
        const text = String(res.content || '').trim().slice(0, 10);
        if (!text) return;
        const next = wheel!.options.slice();
        next[i] = { ...opt, text };
        wheel = store.updateWheel(wheel!._id, { options: next }) || wheel;
        this.buildVM();
        this.draw(-1);
      }
    });
  },

  onOptionLongPress(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { idx?: string };
    const i = Number(ds.idx);
    if (!wheel || isNaN(i) || !wheel.options[i]) return;
    const opt = wheel.options[i];
    wx.showActionSheet({
      itemList: [
        opt.done ? '取消完成标记' : '标记已完成',
        '删除该选项',
        '权重 ×2',
        '权重 ×3',
        '权重 ×1'
      ],
      success: (res) => {
        const next = wheel!.options.slice();
        if (res.tapIndex === 0) {
          // 由待办导入的选项可在转盘页打勾，纯视觉标记，不回写原待办状态
          next[i] = { ...opt, done: !opt.done };
        } else if (res.tapIndex === 1) {
          if (next.length <= store.MIN_OPTIONS) {
            toast(`至少保留 ${store.MIN_OPTIONS} 个选项`);
            return;
          }
          next.splice(i, 1);
        } else {
          const w = res.tapIndex === 2 ? 2 : res.tapIndex === 3 ? 3 : 1;
          next[i] = { ...opt, weight: w };
        }
        wheel = store.updateWheel(wheel!._id, { options: next }) || wheel;
        excluded = [];
        this.buildVM();
        this.draw(-1);
      },
      fail: () => undefined
    });
  },

  onAddOption() {
    if (!wheel) return;
    if (wheel.options.length >= store.MAX_OPTIONS) {
      toast(`最多 ${store.MAX_OPTIONS} 个选项`);
      return;
    }
    wx.showModal({
      title: '添加选项',
      editable: true,
      placeholderText: '最多 10 个字',
      success: (res) => {
        if (!res.confirm) return;
        const text = String(res.content || '').trim().slice(0, 10);
        if (!text) return;
        const colors = (PALETTES[wheel!.theme] || PALETTES.candy).colors;
        const next = wheel!.options.slice();
        next.push({
          id: `wo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          text,
          color: colors[next.length % colors.length],
          weight: 1,
          icon: ''
        });
        wheel = store.updateWheel(wheel!._id, { options: next }) || wheel;
        this.buildVM();
        this.draw(-1);
      }
    });
  },

  onEditAll() {
    if (!wheel) return;
    go(`/subpackages/tools/pages/wheel/edit?id=${wheel._id}`, { title: '编辑转盘' });
  },

  onHistory() {
    if (!wheel) return;
    go(`/subpackages/tools/pages/wheel/history?id=${wheel._id}`, { title: '转盘记录' });
  },

  /* ==================== 转盘列表（切换 / 新建 / 复制 / 删除） ==================== */

  onOpenList() {
    const list = store.listWheels().map((w) => ({
      id: w._id,
      name: w.name,
      icon: w.icon,
      count: w.options.length,
      current: w._id === this.data.wheelId
    }));
    this.setData({ showList: true, wheelList: list });
  },

  onCloseList() {
    this.setData({ showList: false });
  },

  onPickWheel(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { id?: string };
    if (!ds.id) return;
    const w = store.getWheel(ds.id);
    if (!w) return;
    wheel = w;
    store.setCurrent(w._id);
    rotation = 0;
    excluded = [];
    this.setData({ showList: false });
    this.buildVM();
    this.draw(-1);
  },

  onNewWheel() {
    if (store.isFull()) {
      toast(`最多保存 ${store.MAX_WHEELS} 个转盘`);
      return;
    }
    const w = store.createBlank();
    store.setCurrent(w._id);
    wheel = w;
    rotation = 0;
    excluded = [];
    this.setData({ showList: false });
    this.buildVM();
    this.draw(-1);
    toast('已新建空白转盘');
  },

  onCopyWheel(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { id?: string };
    if (!ds.id) return;
    const w = store.duplicateWheel(ds.id);
    if (!w) {
      toast(`最多保存 ${store.MAX_WHEELS} 个转盘`);
      return;
    }
    store.setCurrent(w._id);
    wheel = w;
    this.setData({ showList: false, showTpl: false });
    this.buildVM();
    this.draw(-1);
  },

  onDelWheel(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { id?: string };
    if (!ds.id) return;
    wx.showModal({
      title: '删除转盘',
      content: '删除后历史记录会保留，但会标记为「已删除的转盘」。',
      success: (res) => {
        if (!res.confirm) return;
        if (!store.removeWheel(ds.id!)) {
          toast('至少保留一个转盘');
          return;
        }
        wheel = store.ensureCurrent();
        rotation = 0;
        excluded = [];
        this.onOpenList();
        this.buildVM();
        this.draw(-1);
        toast('已删除');
      }
    });
  },

  onRenameWheel() {
    if (!wheel) return;
    const that = this;
    wx.showModal({
      title: '重命名转盘',
      editable: true,
      content: wheel.name,
      success: (res) => {
        if (!res.confirm) return;
        const name = String(res.content || '').trim().slice(0, 16);
        if (!name) return;
        wheel = store.updateWheel(wheel!._id, { name }) || wheel;
        that.buildVM();
      }
    });
  },

  /* ==================== 模板库 ==================== */

  openTemplates() {
    this.setData({ showTpl: true });
    this.loadTpl(this.data.tplActive || 'eat');
  },

  onOpenTemplates() {
    this.openTemplates();
  },

  onCloseTpl() {
    this.setData({ showTpl: false });
  },

  onTplCat(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { key?: string };
    if (!ds.key || ds.key === this.data.tplActive) return;
    this.setData({ tplActive: ds.key }, () => this.loadTpl(ds.key!));
  },

  /** 分类切换时才渲染该分类的模板（懒加载，避免一次 setData 18 个模板） */
  loadTpl(cat: string) {
    const uses = store.templateUseCounts();
    const list: IVMTemplate[] = templatesOf(cat).map((t: IWheelTemplate) => ({
      id: t.id,
      name: t.name,
      icon: t.icon,
      desc: t.desc,
      count: t.options.length,
      uses: Number(uses[t.id]) || 0,
      colors: (PALETTES[t.theme] || PALETTES.candy).colors.slice(0, 5)
    }));
    // 热门模板前置（使用次数降序，同次数保持原始顺序）
    list.sort((a, b) => b.uses - a.uses);
    this.setData({ tplList: list });
  },

  onUseTemplate(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { id?: string };
    if (!ds.id) return;
    const tpl = getTemplate(ds.id);
    if (!tpl) return;
    if (store.isFull()) {
      toast(`最多保存 ${store.MAX_WHEELS} 个转盘`);
      return;
    }
    const w = store.createFromTemplate(tpl);
    store.markTemplateUsed(tpl.id);
    store.setCurrent(w._id);
    wheel = w;
    rotation = 0;
    excluded = [];
    this.setData({ showTpl: false });
    this.buildVM();
    this.draw(-1);
    toast(`已创建「${tpl.name}」`);
  },

  onBlankTemplate() {
    this.setData({ showTpl: false });
    this.onNewWheel();
  },

  /* ==================== 设置 ==================== */

  onOpenSet() {
    this.setData({ showSet: true });
  },

  onCloseSet() {
    this.setData({ showSet: false });
  },

  onSetDuration(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { v?: string };
    const v = (ds.v || 'standard') as WheelDuration;
    if (!wheel) return;
    wheel = store.updateWheel(wheel._id, { settings: { ...wheel.settings, duration: v } }) || wheel;
    this.setData({ setDuration: v });
  },

  onToggleSet(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { k?: string };
    const k = ds.k;
    if (!k || !wheel) return;
    if (k === 'muted') {
      const cfg = store.globalCfgOf();
      store.setGlobalCfg({ muted: !cfg.muted });
      this.setData({ setMuted: !cfg.muted });
      return;
    }
    if (k === 'reward') {
      const cfg = store.globalCfgOf();
      store.setGlobalCfg({ rewardEnabled: !cfg.rewardEnabled });
      this.setData({ setReward: !cfg.rewardEnabled });
      return;
    }
    const patch: Record<string, boolean> = {};
    if (k === 'sound') patch.soundEnabled = !wheel.settings.soundEnabled;
    else if (k === 'vibrate') patch.vibrateEnabled = !wheel.settings.vibrateEnabled;
    else if (k === 'shake') patch.shakeEnabled = !wheel.settings.shakeEnabled;
    else return;
    wheel = store.updateWheel(wheel._id, { settings: { ...wheel.settings, ...patch } }) || wheel;
    this.setData({
      setSound: wheel.settings.soundEnabled,
      setVibrate: wheel.settings.vibrateEnabled,
      setShake: wheel.settings.shakeEnabled
    });
    this.syncShake();
  },

  /* ==================== 摇一摇 ==================== */

  syncShake() {
    this.stopShake();
    if (!wheel || !wheel.settings.shakeEnabled) return;
    try {
      lastAccMag = 0;
      const accel = accelApi();
      if (!accel.startAccelerometer || !accel.onAccelerometerChange) return;
      accel.startAccelerometer({ interval: 'game' });
      accel.onAccelerometerChange((res) => {
        const mag = Math.abs(res.x) + Math.abs(res.y) + Math.abs(res.z);
        const diff = Math.abs(mag - lastAccMag);
        lastAccMag = mag;
        const now = Date.now();
        if (diff > 12 && now - lastShakeAt > 1200) {
          lastShakeAt = now;
          this.onSpin();
        }
      });
    } catch (e) {
      /* 设备不支持加速度计：忽略 */
    }
  },

  stopShake() {
    try {
      const accel = accelApi();
      if (accel.stopAccelerometer) accel.stopAccelerometer();
      if (accel.offAccelerometerChange) accel.offAccelerometerChange();
    } catch (e) {
      /* 忽略 */
    }
  },

  /* ==================== 其它 ==================== */

  onThemePalette() {
    if (!wheel) return;
    const keys: PaletteKey[] = ['candy', 'morandi', 'festive', 'ocean'];
    const labels = keys.map((k) => PALETTES[k].label);
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const key = keys[res.tapIndex];
        if (!key) return;
        const colors = PALETTES[key].colors;
        const options = wheel!.options.map((o, i) => ({ ...o, color: colors[i % colors.length] }));
        wheel = store.updateWheel(wheel!._id, { theme: key, options }) || wheel;
        this.buildVM();
        this.draw(-1);
      },
      fail: () => undefined
    });
  },

  onBack() {
    back(1);
  },

  /** 收藏 / 取消收藏当前转盘（底部栏「收藏模板」） */
  onToggleFav() {
    if (!wheel) return;
    const id = wheel._id;
    const next = !favSet.has(id);
    if (next) favSet.add(id);
    else favSet.delete(id);
    persistFavs();
    this.setData({ faved: next });
    wx.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'none' });
  },

  /** 空实现：弹层内部用它吃掉冒泡，避免点内容区把弹层关掉 */
  onNoop() {
    /* 阻止冒泡 */
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const name = wheel ? wheel.name : '万能转盘';
    return {
      title: `我正在用转盘决定「${name}」，来帮我看看`,
      path: `/subpackages/tools/pages/wheel/index${wheel && wheel.templateId ? `?tpl=${wheel.templateId}` : ''}`
    };
  }
});
