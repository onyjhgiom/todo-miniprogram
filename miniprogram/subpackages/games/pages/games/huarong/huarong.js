import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

const GAME_ID = 'huarong';

/* 滑动判定阈值：以 rpx 计，经系统 info 转为 px；避免 16px 过小而误触 */
const SWIPE_THRESHOLD_RPX = 34;
/* 滑动方向锁定比例：长边需 ≥ 短边 1.4 倍，避免斜向歧义 */
const SWIPE_LOCK_RATIO = 1.4;

/** 已归位格子数（除空格外，值恰为「下标+1」的个数） */
function countSolved(board, size) {
  let n = 0;
  for (let i = 0; i < size * size - 1; i++) if (board[i] === i + 1) n++;
  return n;
}

Page({
  data: {
    title: '数字华容道', size: 3, board: [], moves: 0,
    /* 由 layout() 按 windowWidth 精确计算的 px 尺寸，避免 4×4 在部分环境下的 grid 溢出 */
    boardPx: 0, cellPx: 0, numPx: 0, progressPct: 0,
    statText: '步数 0', timeText: '00:00', paused: false, won: false,
    /* 通关庆祝层 */
    win: false, winSub: '', winStats: [], winNewBest: false, winQuote: '',
    /* 反馈状态 */
    solvedIndex: -1,   // 刚归位的格子（瞬时高亮）
    movedTo: -1,       // 刚滑入数字的格子（入场微动效）
    shakeIndex: -1,    // 点击无效时抖动的格子
    progress: 0,       // 已归位格子数
    canUndo: false,
    history: []
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    // 根据屏幕宽度换算滑动阈值，保证不同机型手感一致
    try {
      const sys = wx.getSystemInfoSync();
      this.swipePx = (sys.windowWidth / 750) * SWIPE_THRESHOLD_RPX;
    } catch (e) {
      this.swipePx = 16;
    }
    this.newGame(3);
  },

  buildBoard(size) {
    const n = size * size;
    let board, blank, guard = 0;
    do {
      board = [];
      for (let i = 0; i < n; i++) board.push(i === n - 1 ? 0 : i + 1);
      blank = n - 1;
      const steps = size * size * 40;
      for (let k = 0; k < steps; k++) {
        const r = Math.floor(blank / size), c = blank % size;
        const neigh = [];
        if (r > 0) neigh.push(blank - size);
        if (r < size - 1) neigh.push(blank + size);
        if (c > 0) neigh.push(blank - 1);
        if (c < size - 1) neigh.push(blank + 1);
        const pick = neigh[Math.floor(Math.random() * neigh.length)];
        board[blank] = board[pick]; board[pick] = 0; blank = pick;
      }
      guard++;
    } while (this.isSolved(board, size) && guard < 10);
    return board;
  },

  isSolved(board, size) {
    const n = size * size;
    for (let i = 0; i < n - 1; i++) if (board[i] !== i + 1) return false;
    return board[n - 1] === 0;
  },

  /** 按窗口宽度精确计算棋盘 / 格子 / 数字的 px 尺寸（WXML 内联下发）。
   *  背景：grid 的 1fr（=minmax(auto,1fr)）+ aspect-ratio + max-width 组合，
   *  在部分环境（尤其 Windows 模拟器）渲染 4×4 时会把棋盘撑到 ~1000rpx 溢出屏幕；
   *  改为 JS 精确算 px 后不再依赖渲染环境对这几个 CSS 特性的实现。 */
  layout(size) {
    try {
      const sys = wx.getSystemInfoSync();
      const rpx = sys.windowWidth / 750;
      /* 棋盘总宽：620rpx 与「窗口宽 - 两侧 28rpx 边距」取小 */
      const boardPx = Math.floor(Math.min(620 * rpx, sys.windowWidth - 56 * rpx));
      /* 板内可用宽 = 总宽 - 板 padding 28rpx - 板边框 4rpx - 列间 gap 14rpx×(size-1) */
      const inner = boardPx - 32 * rpx - (size - 1) * 14 * rpx;
      const cellPx = Math.floor((inner / size) * 100) / 100;   // 保留 2 位小数防累积误差
      const numPx = Math.round(cellPx * 0.24 * 10) / 10;       // 数字字号随格子缩放（3×3≈44rpx）
      this.setData({ boardPx, cellPx, numPx });
    } catch (e) { /* 获取失败时回退到 CSS 自适应布局（aspect-ratio 兜底） */ }
  },

  /** 已归位进度百分比（WXML 里不能用 Math.round，必须在 JS 算好） */
  pctOf(board, size) {
    return Math.round(countSolved(board, size) / (size * size - 1) * 100);
  },

  newGame(size) {
    this.timer.stop(); this.timer.reset();
    this.layout(size);
    const board = this.buildBoard(size);
    this.timer.start();
    this.setData({
      size, board, moves: 0, statText: '步数 0', timeText: '00:00',
      paused: false, won: false,
      // 一并收起通关层，保证「再来一局」后不会残留
      win: false, winSub: '', winStats: [], winNewBest: false, winQuote: '',
      solvedIndex: -1, movedTo: -1, shakeIndex: -1,
      progress: countSolved(board, size),
      progressPct: this.pctOf(board, size),
      canUndo: false, history: []
    });
  },

  pick3() { this.newGame(3); },
  pick4() { this.newGame(4); },

  /** 方向键 / 手势统一入口：dr/dc 表示「方块要移动的方向」（右滑=方块往右，空格随之左移） */
  moveBlank(dr, dc, fromTap) {
    if (this.data.won || this.data.paused) return;
    const size = this.data.size, board = this.data.board.slice();
    const blank = board.indexOf(0);
    const br = Math.floor(blank / size), bc = blank % size;
    const nr = br + dr, nc = bc + dc;
    // 越界即「撞墙」：方向键给重反馈，点击无效块给抖动反馈
    if (nr < 0 || nr >= size || nc < 0 || nc >= size) {
      if (fromTap !== undefined) this.shake(fromTap);
      else this.bump();
      return;
    }
    const ni = nr * size + nc;            // 即将滑入空格的块原位置
    const history = this.data.history.slice();
    history.push(board.slice());          // 存移动前状态，供撤销
    board[blank] = board[ni]; board[ni] = 0;
    const moves = this.data.moves + 1;
    // 刚归位高亮：滑入后新空格位置（blank）的块若恰好落回正确位则高亮
    const solvedIndex = board[blank] === blank + 1 ? blank : -1;
    this.setData({
      board, moves, statText: '步数 ' + moves,
      solvedIndex, movedTo: blank, progress: countSolved(board, size),
      progressPct: this.pctOf(board, size),
      canUndo: true, history
    });
    this.haptic();
    if (this.isSolved(board, size)) this.win();
  },

  onDirTap(e) {
    const { dr, dc } = e.currentTarget.dataset;
    this.moveBlank(Number(dr), Number(dc));
  },

  /** 点击方块：若与空格相邻则滑入；否则抖动提示 */
  onTapTile(e) {
    if (this.data.won || this.data.paused) return;
    const idx = e.currentTarget.dataset.index;
    const size = this.data.size, board = this.data.board;
    const blank = board.indexOf(0);
    const r = Math.floor(idx / size), c = idx % size;
    const br = Math.floor(blank / size), bc = blank % size;
    if (Math.abs(r - br) + Math.abs(c - bc) !== 1) { this.shake(idx); return; }
    // 点击块滑入空格 == 空格朝 (r-br, c-bc) 方向
    this.moveBlank(r - br, c - bc);
  },

  onTouchStart(e) {
    const t = e.touches[0];
    this.sx = t.clientX; this.sy = t.clientY;
    this.st = Date.now();
  },
  onTouchMove(e) {
    if (this.sx !== undefined) e.preventDefault();
  },
  onTouchEnd(e) {
    if (this.sx === undefined) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this.sx, dy = t.clientY - this.sy;
    this.sx = this.sy = undefined;
    const thr = this.swipePx || 16;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < thr && ady < thr) return;
    if (Date.now() - this.st > 350) return;
    if (adx > ady) {
      if (ady * SWIPE_LOCK_RATIO > adx) return;
      this.moveBlank(0, dx > 0 ? 1 : -1);
    } else {
      if (adx * SWIPE_LOCK_RATIO > ady) return;
      this.moveBlank(dy > 0 ? 1 : -1, 0);
    }
  },

  /** 撤销上一步：恢复移动前棋盘，重算进度 */
  onUndo() {
    if (this.data.won || this.data.paused || !this.data.history.length) return;
    const history = this.data.history.slice();
    const prev = history.pop();
    const moves = Math.max(0, this.data.moves - 1);
    this.setData({
      board: prev, moves, statText: '步数 ' + moves,
      solvedIndex: -1, movedTo: -1,
      progress: countSolved(prev, this.data.size),
      progressPct: this.pctOf(prev, this.data.size),
      canUndo: history.length > 0, history
    });
  },

  /** 轻触感反馈（每步移动） */
  haptic() {
    if (typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type: 'light', fail: () => {} });
    }
  },
  /** 方向键无效操作的重反馈 */
  bump() {
    if (typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type: 'heavy', fail: () => {} });
    }
  },
  /** 点击无效块：抖动 + 轻反馈 */
  shake(index) {
    this.setData({ shakeIndex: index });
    if (typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type: 'heavy', fail: () => {} });
    }
    setTimeout(() => { this.setData({ shakeIndex: -1 }); }, 220);
  },

  /** 通关：停表 -> 记录成绩 -> 展示通关庆祝层 */
  win() {
    this.data.won = true;      // 用 data 直读防重入，避免 setData 异步窗口内重复触发
    this.setData({ won: true });
    this.timer.stop();
    const sec = this.timer.get();
    const moves = this.data.moves;
    const score = Math.max(0, 2000 - moves * 5);

    // finishRound 会写入成绩并回传是否刷新个人纪录
    let isNewBest = false;
    try {
      const res = store.finishRound(GAME_ID, { win: true, steps: moves, timeSec: sec, score });
      isNewBest = res.isNewBest;
    } catch (e) { /* 统计写入失败不影响通关展示 */ }

    this.setData({
      win: true,
      winSub: this.data.size + '×' + this.data.size + ' · 数字华容道',
      winStats: [
        { label: '用时', value: store.formatTime(sec) },
        { label: '步数', value: String(moves) },
        { label: '得分', value: String(score) }
      ],
      winNewBest: isNewBest,
      winQuote: engine.blessing()
    });

    // 通关的轻度触感反馈（仅此一处，不影响其他交互）
    if (typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type: 'light', fail: () => {} });
    }
  },

  /** 通关层：再来一局 */
  onAgain() { this.newGame(this.data.size); },
  /** 通关层：返回游戏大厅 */
  onWinHome() { this.goHome(); },

  onReset() { this.newGame(this.data.size); },
  onHint() { wx.showToast({ title: '把数字按顺序滑入 1~' + (this.data.size * this.data.size - 1), icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
