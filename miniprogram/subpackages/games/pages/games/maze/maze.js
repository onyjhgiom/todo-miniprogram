import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

/* 关卡配置：尺寸随关递增，决定迷宫规模与难度 */
const LEVELS = [
  { n: 6,  label: '6×6' },
  { n: 7,  label: '7×7' },
  { n: 8,  label: '8×8' },
  { n: 9,  label: '9×9' },
  { n: 10, label: '10×10' },
  { n: 12, label: '12×12' },
  { n: 14, label: '14×14' },
  { n: 16, label: '16×16' },
  { n: 18, label: '18×18' },
  { n: 20, label: '20×20' }
];
const MAX_LEVEL = LEVELS.length;

/* 玩家小球尺寸：按格子大小自适应，确保在高难度（格子多）时也不遮挡通道 */
const BALL_RATIO = 0.62;      // 球直径占格子的比例
const BALL_MIN_PX = 10;       // 最小直径（px），再小看不清
const BALL_MAX_PX = 34;       // 最大直径（px），约等于 62rpx 在 375px 屏

function calcBallSize(cellPx) {
  const size = Math.round((cellPx || 0) * BALL_RATIO);
  const ballSize = Math.max(BALL_MIN_PX, Math.min(BALL_MAX_PX, size));
  return { ballSize, ballHalf: ballSize / 2 };
}

/* 滑动判定阈值：以 rpx 计，经系统 info 转为 px；避免 16px 过小而误触 */
const SWIPE_THRESHOLD_RPX = 34;
/* 滑动方向锁定比例：长边需 ≥ 短边 1.15 倍，避免斜向歧义。
   原为 1.4 —— 太严，斜着一点划就整笔被吞掉且不给任何反馈，在 20×20 关尤其难受。 */
const SWIPE_LOCK_RATIO = 1.15;

/**
 * —— 手感参数（针对第 10 关 20×20 这类「小格子 + 长通路」关卡调优）——
 *
 * 本关格子边长仅约 17px、小球直径约 10px，而最难处在于：通路长、死胡同多，
 * 一次「有效操作」的代价被放大（要点上百次方向键）。因此这里的调优原则是：
 *   ① 让一次手势能走多格（连续滑动 / 长按连发），而不是一格一抬手；
 *   ② 让判定阈值随格子大小自适应，而不是固定一个比格子还宽的阈值；
 *   ③ 让反馈即时（按下即走 + 触感节流），而不是等抬手、等震动回调。
 * 全部只作用于「输入与表现层」，不碰迷宫生成与墙判定 —— 难度不变。
 */
const SWIPE_RATIO = 0.6;          // 触发位移 = 格子边长 × 0.6（略小于一格，划半格就走）
const SWIPE_MIN_PX = 9;           // 下限：小格子（20×20 关约 17px）也划得动
const SWIPE_MAX_PX = 26;          // 上限：大格子（6×6 关约 53px）不至于滑 1px 就走一格
const SWIPE_TIMEOUT_MS = 700;     // 单笔滑动的有效时长（原 350ms 太短，慢划全被吞）
const MOVE_COOLDOWN_MS = 70;      // 两步之间的最小间隔：既防「一划瞬移十几格」，也是连发节奏
const DIR_HOLD_DELAY_MS = 260;    // 方向盘按住多久开始连发（短按 = 只走一格）
const DIR_HOLD_INTERVAL_MS = 105; // 连发间隔（略大于冷却，避免排队堆积）
const INPUT_QUEUE_MAX = 5;        // 冷却期最多缓存 5 个方向：连滑/连点不丢步（松手即清空）
const HAPTIC_MIN_MS = 130;        // 触感节流：低端机每次移动都震动会明显卡主线程
const ANIM_MS_SMALL = 80;         // 小格子（≤20px）移动补间：位移小，130ms 会显得黏
const ANIM_MS_BIG = 130;          // 大格子移动补间：位移大，保留原时长更顺

/** 方向 → 't'|'r'|'b'|'l'，用于撞墙记录与抖动防护比对 */
function dirKey(dr, dc) {
  if (dr === -1) return 't';
  if (dr === 1) return 'b';
  if (dc === -1) return 'l';
  if (dc === 1) return 'r';
  return '';
}

/** 由格子边长推导「滑动触发位移」与「移动补间时长」 */
function feelByCell(cellPx) {
  const cell = cellPx || 0;
  const step = cell
    ? Math.max(SWIPE_MIN_PX, Math.min(SWIPE_MAX_PX, cell * SWIPE_RATIO))
    : 16;
  return { step, moveMs: cell && cell <= 20 ? ANIM_MS_SMALL : ANIM_MS_BIG };
}

/**
 * 难度：控制「编织度」与提示/演示次数，与关卡尺寸共同决定体感难度。
 * 编织度 = 打通部分死胡同形成环路的概率：
 *   0    → 完美迷宫（唯一解，死胡同多，最绕，也最考验记忆）
 *   0.5  → 环路很多，多条路都能到终点，适合新手
 * 提示次数与演示次数随难度递减。
 */
const DIFFS = [
  { key: 'easy', label: '简单', braid: 0.5, hints: 5, demos: 2 },
  { key: 'normal', label: '普通', braid: 0.15, hints: 3, demos: 1 },
  { key: 'hard', label: '困难', braid: 0, hints: 2, demos: 1 }
];
const DIFF_INDEX = { easy: 0, normal: 1, hard: 2 };
const DIFF_KEY = 'maze_difficulty';

/** 失败判定：步数超过最少步数的 N 倍即视为迷路（仅提示一次，可继续走） */
const FAIL_STEP_RATIO = 3;

/**
 * 递归回溯生成迷宫。
 * @param {number} n 边长
 * @param {number} braid 编织度 0~1：生成完美迷宫后，按此概率打通死胡同的一面墙形成环路
 *
 * 说明：braid=0 时是完美迷宫（任意两点唯一通路，BFS 路径即最短且唯一）；
 * braid>0 会出现多解，此时 BFS 仍是最短解，只是不再唯一 —— par 依然成立。
 */
function genMaze(n, braid) {
  const cells = [];
  for (let i = 0; i < n * n; i++) cells.push({ t: true, r: true, b: true, l: true });
  const idx = (r, c) => r * n + c;
  const stack = [[0, 0]];
  cells[0].v = true;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const neigh = [];
    if (r > 0 && !cells[idx(r - 1, c)].v) neigh.push([r - 1, c, 't', 'b']);
    if (r < n - 1 && !cells[idx(r + 1, c)].v) neigh.push([r + 1, c, 'b', 't']);
    if (c > 0 && !cells[idx(r, c - 1)].v) neigh.push([r, c - 1, 'l', 'r']);
    if (c < n - 1 && !cells[idx(r, c + 1)].v) neigh.push([r, c + 1, 'r', 'l']);
    if (!neigh.length) { stack.pop(); continue; }
    const [nr, nc, wS, wN] = neigh[Math.floor(Math.random() * neigh.length)];
    cells[idx(r, c)][wS] = false; cells[idx(nr, nc)][wN] = false; cells[idx(nr, nc)].v = true;
    stack.push([nr, nc]);
  }

  // 编织：打通部分死胡同，把「只能原路返回」变成「还有别的岔路可走」
  const p = Number(braid) || 0;
  if (p > 0) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = cells[idx(r, c)];
        const walls = ['t', 'r', 'b', 'l'].filter((w) => cell[w]);
        if (walls.length < 3) continue; // 不是死胡同
        if (Math.random() > p) continue;
        // 只开朝向相邻格子的墙，绝不开边界（否则会走出棋盘）
        const dirs = [];
        if (cell.t && r > 0) dirs.push(['t', r - 1, c, 'b']);
        if (cell.b && r < n - 1) dirs.push(['b', r + 1, c, 't']);
        if (cell.l && c > 0) dirs.push(['l', r, c - 1, 'r']);
        if (cell.r && c < n - 1) dirs.push(['r', r, c + 1, 'l']);
        if (!dirs.length) continue;
        const [w, nr, nc, ow] = dirs[Math.floor(Math.random() * dirs.length)];
        cell[w] = false;
        cells[idx(nr, nc)][ow] = false;
      }
    }
  }
  return cells;
}

/** BFS 求最短路径（返回节点索引数组，含起点与终点），用于提示与最少步数统计 */
function solvePath(cells, n, from, to) {
  const prev = new Array(n * n).fill(-1);
  const seen = new Array(n * n).fill(false);
  const q = [from];
  seen[from] = true;
  while (q.length) {
    const cur = q.shift();
    if (cur === to) break;
    const r = Math.floor(cur / n), c = cur % n, cell = cells[cur];
    const tryMove = (nr, nc, blocked) => {
      if (blocked) return;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) return;
      const ni = nr * n + nc;
      if (seen[ni]) return;
      seen[ni] = true; prev[ni] = cur; q.push(ni);
    };
    tryMove(r - 1, c, cell.t);
    tryMove(r + 1, c, cell.b);
    tryMove(r, c - 1, cell.l);
    tryMove(r, c + 1, cell.r);
  }
  const path = [];
  let cur = to;
  while (cur !== -1) { path.push(cur); cur = prev[cur]; }
  return path.reverse();
}

Page({
  data: {
    title: '路径迷宫', cols: 6, cells: [], player: 0, end: 35, steps: 0,
    statText: '步数 0', timeText: '00:00', paused: false,
    /* 关卡系统 */
    level: 1, maxLevel: MAX_LEVEL, levelLabel: '6×6', best: 0,
    /* 最少步数 / 评级 */
    par: 0, rating: '',
    /* 提示剩余次数（路径本身画在 marks 里，见下） */
    hintLeft: 3,
    /* 难度：easy / normal / hard（控制编织度 + 提示/演示次数） */
    diff: 'normal', diffList: DIFFS, diffIndex: 1,
    /* 最优路径演示：逐格点亮的 ghost 轨迹（同样画在 marks 里） */
    demoLeft: 1, demoing: false,
    /* 量出来的格子像素边长，用于坐标换算 */
    cellPx: 0,
    /* 步数进度 0~1：用 transform: scaleX 驱动，避免 width 动画触发每帧布局 */
    progressX: 0,
    /**
     * 每格标记：'' | 'hint' | 'demo' | 'crumb'。
     *
     * 这里用「逐格标记」取代原来的 hintPath / demoPath / trail 三个数组：
     * 原来 wxml 里每个格子都要跑 trail.indexOf(index)、hintPath.indexOf(index)、
     * demoPath.indexOf(index) —— 20×20 关一步移动就是 400 格 × 3 次数组成员扫描，
     * 提示路径上百项时更夸张，这是移动掉帧、画面发飘的直接来源之一。
     * 改成标记后，走一步只需 setData({'marks[3]': 'crumb'})，只碰一个格子。
     */
    marks: [],
    /* 交互反馈
       注意：history 改为实例属性 this._history，不再放进 data ——
       20×20 关常走 150+ 步，每步都把整条 history 回传会让 setData 越来越慢。
       同理，小球坐标 / 球径 / 撞墙状态已全部收进 maze-ball 组件内部，
       移动小球不再触发整页（400 格棋盘）重渲染。 */
    canUndo: false,
    /* 通关层 */
    win: false, winSub: '', winStats: [], winNewBest: false, winQuote: '',
    /* 失败层（迷路）：仅提示一次，可继续走 */
    fail: false, failSub: '', failStats: [], failBtnText: '再来一局', failShown: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    const rec = store.getGame('maze');
    // 难度持久化：换关卡/重进都保留玩家上次的选择
    let diff = 'normal';
    try {
      const saved = wx.getStorageSync(DIFF_KEY);
      if (saved && DIFF_INDEX[saved] !== undefined) diff = saved;
    } catch (e) { /* 忽略 */ }
    // 有历史进度则从上次解锁的关卡继续
    this.setData({
      best: rec.best,
      level: Math.min(rec.unlocked || 1, MAX_LEVEL),
      diff,
      diffIndex: DIFF_INDEX[diff]
    });
    // 根据屏幕宽度换算滑动阈值，保证不同机型手感一致（measureCell 会按格子再次校正）
    try {
      const sys = wx.getSystemInfoSync();
      this.swipePx = (sys.windowWidth / 750) * SWIPE_THRESHOLD_RPX;
    } catch (e) {
      this.swipePx = 16;
    }
    this.swipeStepPx = this.swipePx || 16;
    this._queue = [];
    this._history = [];
    this._lastMoveAt = 0;
    /** 撤销时还原格子标记用的栈：[{i, mark}] */
    this._markStack = [];
    /** 当前提示路径覆盖的格子（撤销时据此先清后重算） */
    this._hintCells = [];
    /** 当前演示点亮过的格子：[{i, prev}]，结束时原样还原 */
    this._demoCells = [];
    this.newGame();
  },

  /** 量出棋盘格子的像素边长，供玩家小球做平滑位移 */
  measureCell(cb) {
    if (typeof wx.createSelectorQuery !== 'function') {
      this.estimateCell();
      if (cb) cb();
      return;
    }
    wx.createSelectorQuery().in(this).select('#mzBoard').boundingClientRect().exec((res) => {
      const rect = res && res[0];
      const n = this.data.cols || 6;
      // 棋盘左右各 8rpx 内边距（≈4px），要扣掉再均分
      const cellPx = rect && rect.width ? (rect.width - 8) / n : 0;
      const { step } = feelByCell(cellPx);
      this.swipeStepPx = step;
      this.setData({ cellPx }, () => {
        if (!this.data.cellPx) this.estimateCell();
        // 量完立刻把小球的尺寸与落位一次性对齐（instant，不播补间）
        else this.placePlayer(true);
        if (cb) cb();
      });
    });
  },

  /** 量不到时的兜底估算：按 320px 可用宽度折算 */
  estimateCell() {
    const n = this.data.cols || 6;
    const cellPx = 320 / n;
    const { step } = feelByCell(cellPx);
    this.swipeStepPx = step;
    this.setData({ cellPx }, () => this.placePlayer(true));
  },

  /**
   * 把玩家小球放到当前格中心。
   * instant=true（首次落位 / 换关 / 重新测量）→ 瞬移，不播补间；
   * instant=false（撤销）→ 正常补间。
   */
  placePlayer(instant) {
    const n = this.data.cols || 6;
    const cell = this.data.cellPx || 320 / n;
    const r = Math.floor(this.data.player / n), c = this.data.player % n;
    const left = 4 + (c + 0.5) * cell;
    const top = 4 + (r + 0.5) * cell;
    const ball = this._ball();
    if (!ball) return;
    if (instant) {
      const { ballSize, ballHalf } = calcBallSize(cell);
      const { moveMs } = feelByCell(cell);
      ball.setup({ left, top, size: ballSize, half: ballHalf, moveMs });
    } else {
      ball.moveTo(left, top, feelByCell(cell).moveMs);
    }
  },

  /** 取小球组件实例（移动它的代价只落在组件内部，不牵动整页棋盘） */
  _ball() {
    try {
      return this.selectComponent('#mzBall');
    } catch (e) {
      return null;
    }
  },

  newGame() {
    const lv = Math.min(this.data.level, MAX_LEVEL);
    const cfg = LEVELS[lv - 1];
    const n = cfg.n;
    const dIdx = DIFF_INDEX[this.data.diff];
    const diff = DIFFS[dIdx === undefined ? 1 : dIdx];
    const cells = genMaze(n, diff.braid);
    const end = n * n - 1;

    this.timer.reset();
    this.timer.start();
    this.clearDemo();

    // 完美迷宫中 BFS 路径唯一，长度即最少步数；编织迷宫下 BFS 仍是最短解
    const path = solvePath(cells, n, 0, end);
    const { step } = feelByCell(this.data.cellPx || 320 / n);
    this.swipeStepPx = step;

    // 新一局：清空输入队列与方向键连发，避免上一局的残留输入「自己走」
    this._clearHold();
    this._queue = [];
    this._history = [];
    this._markStack = [];
    this._hintCells = [];
    this._lastMoveAt = 0;

    this.setData({
      cols: n, cells, player: 0, end, steps: 0, statText: '步数 0', paused: false,
      level: lv, levelLabel: cfg.label,
      par: Math.max(1, path.length - 1),
      rating: '', hintLeft: diff.hints,
      demoLeft: diff.demos, demoing: false,
      marks: new Array(n * n).fill(''),
      progressX: 0,
      canUndo: false,
      win: false, winSub: '', winStats: [], winNewBest: false, winQuote: '',
      fail: false, failSub: '', failStats: [], failShown: false
    }, () => {
      this.measureCell();
    });

    // 开始反馈：点开就能知道「这关多大、最少多少步」
    wx.showToast({
      title: '第 ' + lv + ' 关 · ' + cfg.label + ' · 出发',
      icon: 'none',
      duration: 1200
    });
  },

  onPrevLevel() {
    if (this.data.level <= 1) { wx.showToast({ title: '已是第一关', icon: 'none' }); return; }
    this.setData({ level: this.data.level - 1 });
    this.newGame();
  },

  onNextLevel() {
    if (this.data.level >= MAX_LEVEL) { wx.showToast({ title: '已是最后一关', icon: 'none' }); return; }
    this.setData({ level: this.data.level + 1 });
    this.newGame();
  },

  /** 方向键点击统一入口：从 dataset 取方向，修正 bindtap 直接传 event 的 bug */
  onDirTap(e) {
    const { dr, dc } = e.currentTarget.dataset;
    this.requestMove(Number(dr), Number(dc));
  },

  /**
   * 方向键改为「按下即走 + 长按连发」。
   *
   * 原来绑 bindtap，必须按下→抬手才响应，比 touchstart 晚一截；且一次点击只走一格，
   * 20×20 关最短路径常在 80~200 步，等于要点一百多次。现在：
   *   · touchstart 立刻走一格（按下就动，不等抬手）；
   *   · 按住 260ms 后以 105ms 的节奏连发，长通路按住即可；
   *   · 松手立刻停（touchcancel 也停），不会「松手后还在走」。
   */
  onDirStart(e) {
    const dr = Number(e.currentTarget.dataset.dr), dc = Number(e.currentTarget.dataset.dc);
    // 先清掉上一次的连发（换方向时），再记录本次方向 —— 顺序反了会把 _holdDir 一起清掉
    this._clearHold();
    this._holdDir = [dr, dc];
    this.requestMove(dr, dc);
    this._holdTimer = setTimeout(() => {
      this._holdTimer = null;
      this._holdInt = setInterval(() => {
        if (this._holdDir) this.requestMove(this._holdDir[0], this._holdDir[1]);
      }, DIR_HOLD_INTERVAL_MS);
    }, DIR_HOLD_DELAY_MS);
  },

  /**
   * 松手：连发立即停 —— 并且把「连发排进去但还没走」的队列清掉，
   * 否则松手后小球还会自己多走两格，在迷宫里很容易一头撞进死胡同。
   * 短按不在此列：那一步是玩家明确的意图，必须照常执行（不清队列）。
   */
  onDirEnd() {
    const wasRepeating = !!this._holdInt;
    this._clearHold();
    if (wasRepeating) this._queue = [];
  },

  /** 清掉方向键连发定时器（换方向 / 松手 / 重开 / 卸载时都要调） */
  _clearHold() {
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    if (this._holdInt) { clearInterval(this._holdInt); this._holdInt = null; }
    this._holdDir = null;
  },

  /** 撤销上一步：回到上一个玩家位置，步数回退，提示路径跟随新位置重新计算 */
  onUndo() {
    const history = this._history || [];
    if (this.data.paused || !history.length) return;
    const prev = history.pop();
    const steps = Math.max(0, this.data.steps - 1);
    const n = this.data.cols || 6;
    const patch = {
      player: prev,
      steps,
      statText: '步数 ' + steps,
      canUndo: history.length > 0,
      progressX: this.data.par ? Math.min(1, steps / this.data.par) : 0
    };

    // 面包屑还原：把「离开该格时盖上的 crumb」还原为之前的标记（'' 或 hint）
    const entry = (this._markStack || []).pop();

    if (this._hintCells && this._hintCells.length) {
      // 提示仍开着：整表重算（撤销是低频操作，一次批量下发即可）
      const marks = (this.data.marks || []).slice();
      if (entry && entry.i >= 0 && entry.i < marks.length) marks[entry.i] = entry.mark;
      this._hintCells.forEach((i) => {
        if (marks[i] === 'hint') marks[i] = '';
      });
      const hp = solvePath(this.data.cells, n, prev, this.data.end).slice(1, -1);
      this._hintCells = hp.slice();
      hp.forEach((i) => {
        if (marks[i] === '' || marks[i] === 'crumb') marks[i] = 'hint';
      });
      patch.marks = marks;
    } else if (entry) {
      // 单格路径更新：只碰返回的那一格
      patch['marks[' + entry.i + ']'] = entry.mark;
    }

    this.setData(patch);
    this.placePlayer(false);
  },

  /** 切换难度：只影响新一局的编织度与提示/演示次数 */
  onDiffTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || DIFF_INDEX[key] === undefined || key === this.data.diff) return;
    try { wx.setStorageSync(DIFF_KEY, key); } catch (err) { /* 忽略 */ }
    this.setData({ diff: key, diffIndex: DIFF_INDEX[key] }, () => this.newGame());
  },

  /** 重新生成：同关卡同难度换一张新图 */
  onRegenerate() {
    this.newGame();
  },

  /**
   * 最优路径演示：从当前位置沿最短路径逐格点亮 ghost 轨迹，播放完自动淡出。
   * 只演示不代走 —— 玩家位置与步数都不变，看完自己走。
   */
  onDemo() {
    if (this.data.paused || this.data.win || this.data.demoing) return;
    if (this.data.demoLeft <= 0) {
      wx.showToast({ title: '本局演示已用完', icon: 'none' });
      return;
    }
    const path = solvePath(this.data.cells, this.data.cols, this.data.player, this.data.end).slice(1);
    if (!path.length) return;
    this.setData({ demoing: true, demoLeft: this.data.demoLeft - 1 });

    // 逐格推进：每 90ms 点亮一格，节奏看得清但不拖沓
    this._demoCells = [];
    let i = 0;
    this._demoTimer = setInterval(() => {
      if (i >= path.length) {
        this.clearDemo();
        return;
      }
      const idx = path[i];
      // 记下原标记，结束时原样还原（演示可能盖住 hint / crumb）
      const prev = (this.data.marks && this.data.marks[idx]) || '';
      this._demoCells.push({ i: idx, prev });
      // 单格路径更新：点亮一格只碰一个节点，不重渲染整块棋盘
      this.setData({ ['marks[' + idx + ']']: 'demo' });
      i += 1;
    }, 90);

    // 播完停 1.2 秒再淡出，让最后一段轨迹看得完整
    this._demoEnd = setTimeout(() => this.clearDemo(), path.length * 90 + 1200);
  },

  /** 结束演示：清定时器 + 还原被演示盖住的格子标记 */
  clearDemo() {
    if (this._demoTimer) { clearInterval(this._demoTimer); this._demoTimer = null; }
    if (this._demoEnd) { clearTimeout(this._demoEnd); this._demoEnd = null; }
    const demoed = this._demoCells || [];
    if (!demoed.length) {
      if (this.data.demoing) this.setData({ demoing: false });
      return;
    }
    const marks = (this.data.marks || []).slice();
    demoed.forEach((d) => {
      if (marks[d.i] === 'demo') marks[d.i] = d.prev;
    });
    this._demoCells = [];
    this.setData({ marks, demoing: false });
  },

  /** 迷路判定：步数超过最少步数的 3 倍时提示一次（可继续走，随时重开） */
  checkFail(steps) {
    if (this.data.win || this.data.failShown) return;
    const limit = Math.ceil(this.data.par * FAIL_STEP_RATIO);
    if (steps < limit) return;
    this.setData({
      fail: true,
      failShown: true,
      failSub: '已走 ' + steps + ' 步，是最少步数的 ' + FAIL_STEP_RATIO + ' 倍',
      failStats: [
        { label: '已走', value: String(steps) },
        { label: '最少步', value: String(this.data.par) },
        { label: '用时', value: this.data.timeText }
      ]
    });
  },

  onFailRetry() { this.newGame(); },
  onFailContinue() { this.setData({ fail: false }); },
  onFailHome() { this.setData({ fail: false }, () => this.goHome()); },

  /** 注册一次有效移动，用于撤销与反馈（存在实例属性上，不参与 setData） */
  recordMove(from) {
    if (!this._history) this._history = [];
    this._history.push(from);
    return { canUndo: true };
  },

  /** 触发一次轻触感反馈（节流：连续移动时低端机的 vibrate 调用会明显卡主线程） */
  haptic(heavy) {
    const now = Date.now();
    const key = heavy ? '_lastHapticHeavy' : '_lastHaptic';
    if (now - (this[key] || 0) < HAPTIC_MIN_MS) return;
    this[key] = now;
    if (typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type: heavy ? 'heavy' : 'light', fail: () => {} });
    }
  },

  /**
   * 撞墙反馈：轻微顶墙回弹（小球往墙上顶一下再弹回，纯视觉，不改坐标）+ 触感。
   * 判定依旧是「硬挡住」——不做沿墙滑行 / 自动拐弯，否则等于替玩家做选择、降低难度。
   *
   * 这里刻意**不再 setData 页面**：原来 bump 字段被写进了 400 个格子的 class 表达式
   * （`{{bump==='t'&&item.t?...}}`），撞一下墙，所有同向有墙的格子都会加类并播放位移
   * 动画 —— 整块棋盘跟着抖，连撞就是持续震荡。回弹现在完全由 maze-ball 组件内部消化。
   */
  bumpWall(dir) {
    // 记下撞墙方向与时间：滑动/连发时同一方向短时间内的重复请求会被跳过（防贴墙抖动）
    this._lastBumpDir = dir;
    this._lastBumpAt = Date.now();
    const ball = this._ball();
    if (ball && ball.bump) ball.bump(dir);
    this.haptic(true);
  },

  /**
   * 移动排队：所有输入（方向键 / 滑动 / 点格子）都先进队列，再按冷却节奏依次执行。
   *
   * 为什么需要：① 移动补间只有 80~130ms，手指连点或连滑很容易在补间内塞进第二个方向，
   * 原来后一个输入会被 moveDir 的早退吞掉，表现为「点了没反应 / 丢步」；
   * ② 有了统一节奏，长按连发与连续滑动共用一个节拍，不会出现「有时快有时慢」。
   * 队列上限 3：再多就是手指糊上去了，超出丢弃，避免松手后小球还在自己走。
   */
  requestMove(dr, dc) {
    if (this.data.paused || this.data.win || this.data.fail) return;
    if (!this._queue) this._queue = [];
    if (this._queue.length >= INPUT_QUEUE_MAX) return;
    this._queue.push([dr, dc]);
    this._pump();
  },

  _pump() {
    if (this._pumping) return;
    this._pumping = true;
    const step = () => {
      const wait = Math.max(0, MOVE_COOLDOWN_MS - (Date.now() - (this._lastMoveAt || 0)));
      this._pumpTimer = setTimeout(() => {
        const next = (this._queue || []).shift();
        if (!next) { this._pumping = false; this._pumpTimer = null; return; }
        this.moveDir(next[0], next[1]);
        this._lastMoveAt = Date.now();
        if ((this._queue || []).length) step();
        else { this._pumping = false; this._pumpTimer = null; }
      }, wait);
    };
    step();
  },

  moveDir(dr, dc) {
    if (this.data.paused) return;
    const n = this.data.cols, p = this.data.player;
    const r = Math.floor(p / n), c = p % n;
    const nr = r + dr, nc = c + dc;
    // 撞到棋盘外沿：同样给顶墙反馈（原来这里直接 return，玩家看到的是「点了没反应」）
    if (nr < 0 || nr >= n || nc < 0 || nc >= n) { this.bumpWall(dirKey(dr, dc)); return; }
    const cell = this.data.cells[p];
    const blocked = (dr === -1 && cell.t) || (dr === 1 && cell.b) || (dc === -1 && cell.l) || (dc === 1 && cell.r);
    if (blocked) {
      this.bumpWall(dirKey(dr, dc));
      return;
    }
    const np = nr * n + nc, steps = this.data.steps + 1;
    const { canUndo } = this.recordMove(p);
    // 演示轨迹是「从当前位置出发」的，走一步就得清掉，否则与新位置不符
    this.clearDemo();
    // 坐标与状态合并成一次 setData（原来要跨两帧）。
    // 注意：上方 cell 是「当前格子对象」，这里是「格子像素边长」，两者别混用。
    const cellSize = this.data.cellPx || 320 / n;
    const { moveMs } = feelByCell(cellSize);
    const patch = {
      player: np,
      steps,
      statText: '步数 ' + steps,
      progressX: this.data.par ? Math.min(1, steps / this.data.par) : 0,
      canUndo
    };
    // 面包屑：给「离开的格子」盖一个 crumb 标记（单格路径更新，只碰一个节点）。
    // 不再需要原来 30 格上限 —— 标记是定长数组，更新成本 O(1)，不会随步数膨胀。
    const prevMark = (this.data.marks && this.data.marks[p]) || '';
    if (!this._markStack) this._markStack = [];
    this._markStack.push({ i: p, mark: prevMark });
    if (prevMark !== 'crumb') patch['marks[' + p + ']'] = 'crumb';
    this.setData(patch);
    // 小球位移交给组件内部 setData：只重渲染小球自己，棋盘零重排
    const ball = this._ball();
    if (ball && ball.moveTo) {
      ball.moveTo(4 + (nc + 0.5) * cellSize, 4 + (nr + 0.5) * cellSize, moveMs);
    }
    this.haptic();
    if (np === this.data.end) { this.win(); return; }
    this.checkFail(steps);
  },

  onTapCell(e) {
    const i = e.currentTarget.dataset.index;
    if (i === this.data.player) return;
    const n = this.data.cols;
    const r = Math.floor(i / n), c = i % n;
    const pr = Math.floor(this.data.player / n), pc = this.data.player % n;
    if (Math.abs(r - pr) + Math.abs(c - pc) !== 1) return;
    this.requestMove(r - pr, c - pc);
  },

  onTouchStart(e) {
    this.sx = e.touches[0].x;
    this.sy = e.touches[0].y;
    this.st = Date.now();
    this._strokeMoved = 0; // 本笔滑动已触发的移动次数
  },

  /**
   * 连续滑动：每划过「约一格」的距离就走一格，并重置起点 —— 手指不抬也能一路走下去。
   *
   * 原实现只在 touchend 判定一次，一划只走一格：20×20 关一条长通路要划十几次、
   * 每次还得抬手，这是「不跟手」最大的来源。现在：
   *   · 阈值随格子大小自适应（swipeStepPx），小格子不再要求划过一整格；
   *   · 单个 touchmove 最多触发一次移动，避免一次大位移「瞬移」多格而失控；
   *   · 刚撞过墙的同一方向 220ms 内不再重复请求，防止贴墙连撞抖动 + 连续震动。
   */
  onTouchMove(e) {
    if (this.sx === undefined) return false;
    if (e.preventDefault) e.preventDefault(); // 阻止页面滚动与 rubber-band 回弹
    const x = e.touches[0].x, y = e.touches[0].y;
    const dx = x - this.sx, dy = y - this.sy;
    const thr = this.swipeStepPx || 16;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < thr && ady < thr) return false;
    // 单笔拖太久多半是长按而不是走位：重置起点，不响应
    if (Date.now() - this.st > SWIPE_TIMEOUT_MS) {
      this.sx = x; this.sy = y; this.st = Date.now();
      return false;
    }
    let dr = 0, dc = 0;
    if (adx >= ady) {
      if (ady * SWIPE_LOCK_RATIO > adx) return false; // 斜得太厉害，方向不明确
      dc = dx > 0 ? 1 : -1;
    } else {
      if (adx * SWIPE_LOCK_RATIO > ady) return false;
      dr = dy > 0 ? 1 : -1;
    }
    // 重置起点：下一次达到阈值再走一格（连续滑动的关键）
    this.sx = x; this.sy = y;
    // 贴墙抖动防护：同一方向刚撞过就先不请求，避免连撞抖成一团
    if (this._lastBumpDir === dirKey(dr, dc) && Date.now() - (this._lastBumpAt || 0) < 220) return false;
    this._strokeMoved = (this._strokeMoved || 0) + 1;
    this.requestMove(dr, dc);
    return false;
  },

  /** 抬手兜底：短促快划（整笔没触发过连续移动）也要认，否则「小碎步」完全没反应 */
  onTouchEnd(e) {
    if (this.sx === undefined) return;
    const dx = e.changedTouches[0].x - this.sx, dy = e.changedTouches[0].y - this.sy;
    const moved = this._strokeMoved || 0;
    this.sx = this.sy = undefined;
    this._strokeMoved = 0;
    if (moved) return; // 已连续走过，不再重复判定
    const thr = this.swipeStepPx || 16;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < thr && ady < thr) return; // 只是点按
    if (Date.now() - this.st > 350) return; // 慢拖拽不当滑动
    if (adx >= ady) {
      if (ady * SWIPE_LOCK_RATIO > adx) return;
      this.requestMove(0, dx > 0 ? 1 : -1);
    } else {
      if (adx * SWIPE_LOCK_RATIO > ady) return;
      this.requestMove(dy > 0 ? 1 : -1, 0);
    }
  },

  /** 提示：点亮从当前位置到终点的最短路径，每局限 3 次 */
  onHint() {
    if (this.data.hintLeft <= 0) { wx.showToast({ title: '本局提示已用完', icon: 'none' }); return; }
    const path = solvePath(this.data.cells, this.data.cols, this.data.player, this.data.end).slice(1, -1);
    // 批量写标记：提示是低频操作，整表一次下发；单格路径更新留给每步移动
    const marks = (this.data.marks || []).slice();
    this._hintCells = path.slice();
    path.forEach((i) => {
      if (marks[i] === '' || marks[i] === 'crumb') marks[i] = 'hint';
    });
    this.setData({
      marks,
      hintLeft: this.data.hintLeft - 1
    });
    wx.showToast({ title: '已点亮最短路径 · 剩 ' + (this.data.hintLeft) + ' 次', icon: 'none' });
  },

  win() {
    this.timer.stop();
    this.clearDemo();
    const sec = this.timer.get();
    const steps = this.data.steps;
    const par = this.data.par;

    // 评级：与理论最少步数（完美迷宫 BFS 路径）比较
    let rating = '还行';
    if (steps <= par) rating = '完美';
    else if (steps <= Math.ceil(par * 1.2)) rating = '优秀';
    else if (steps <= Math.ceil(par * 1.6)) rating = '良好';
    else if (steps <= par * 2.5) rating = '还行';
    else rating = '迷路了';

    const score = Math.max(0, 1000 + this.data.level * 200 - steps * 5 - sec * 2);

    let isNewBest = false;
    try {
      const res = store.finishRound('maze', {
        win: true, steps, timeSec: sec, score,
        unlock: Math.min(this.data.level + 1, MAX_LEVEL)
      });
      isNewBest = res.isNewBest;
    } catch (e) { /* 统计失败不影响通关展示 */ }

    this.setData({
      rating,
      best: Math.max(this.data.best, score),
      win: true,
      winSub: '第 ' + this.data.level + ' 关 · ' + this.data.levelLabel + ' · ' + rating,
      winStats: [
        { label: '用时', value: store.formatTime(sec) },
        { label: '步数', value: String(steps) },
        { label: '最少步', value: String(par) }
      ],
      winNewBest: isNewBest,
      winQuote: engine.blessing()
    });

    if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light', fail: () => {} });
  },

  /** 通关层：下一关（已到上限则重玩本关） */
  onAgain() {
    if (this.data.level < MAX_LEVEL) this.setData({ level: this.data.level + 1 });
    this.newGame();
  },
  onWinHome() { this.goHome(); },

  onReset() { this.newGame(); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  /** 暂停/继续：连发与输入队列一并停住，避免暂停期间还在走 */
  onPause() {
    this._clearHold();
    this._queue = [];
    this.setData({ paused: this.timer.toggle() });
  },
  /** 卸载：清掉所有可能还在跑的定时器（连发 / 排队 / 演示） */
  onUnload() {
    this.timer.stop();
    this.clearDemo();
    this._clearHold();
    if (this._pumpTimer) { clearTimeout(this._pumpTimer); this._pumpTimer = null; }
    this._queue = [];
  }
});
