import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

const COLS = 10, ROWS = 20;
const COLORS = ['#7FA9C4', '#D9B36B', '#A6C9B5', '#9CC39A', '#C98C8C', '#9AA9C9', '#D6A06A'];
const SHAPES = [
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[1,1],[1,1]],                             // O
  [[0,1,0],[1,1,1],[0,0,0]],                 // T
  [[0,1,1],[1,1,0],[0,0,0]],                 // S
  [[1,1,0],[0,1,1],[0,0,0]],                 // Z
  [[1,0,0],[1,1,1],[0,0,0]],                 // J
  [[0,0,1],[1,1,1],[0,0,0]]                  // L
];
function rotate(m) {
  const n = m.length, r = [];
  for (let i = 0; i < n; i++) { r.push([]); for (let j = 0; j < n; j++) r[i].push(m[n - 1 - j][i]); }
  return r;
}
function emptyBoard() { return Array.from({ length: ROWS }, () => new Array(COLS).fill(0)); }

Page({
  data: {
    title: '俄罗斯方块', score: 0, best: 0, lines: 0,
    timeText: '00:00', paused: false, over: false, showHint: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.setData({ best: store.getGame('tetris').best });
    this.start();
  },

  onReady() {
    const q = wx.createSelectorQuery().in(this);
    q.select('#cv').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0]) return;
      const canvas = res[0].node; const ctx = canvas.getContext('2d');
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
      canvas.width = res[0].width * dpr; canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);
      this.canvas = canvas; this.ctx = ctx; this.cw = res[0].width; this.ch = res[0].height;
      this.cell = this.cw / COLS;
      this.draw();
    });
  },

  start() {
    this.board = emptyBoard();
    this.score = 0; this.lines = 0; this.over = false;
    this.dropInterval = 800;
    this.cur = this.spawn();
    this.setData({ score: 0, lines: 0, over: false });
    this.loop();
  },

  spawn() {
    const type = Math.floor(Math.random() * 7);
    const mat = SHAPES[type].map((r) => r.slice());
    const w = mat[0].length;
    const x = Math.floor((COLS - w) / 2);
    const p = { type, mat, x, y: 0 };
    if (this.collide(p, 0, 0)) { this.gameOver(); }
    return p;
  },

  collide(p, dx, dy, mat) {
    const m = mat || p.mat;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const bx = p.x + c + dx, by = p.y + r + dy;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by >= 0 && this.board[by][bx]) return true;
      }
    }
    return false;
  },

  loop() {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = setInterval(() => {
      if (this.data.paused || this.data.over) return;
      this.step();
    }, this.dropInterval);
  },

  step() {
    if (!this.cur) return;
    if (!this.collide(this.cur, 0, 1)) {
      this.cur.y += 1;
    } else {
      this.lock();
    }
    this.draw();
  },

  softDrop() {
    if (this.data.paused || this.data.over) return;
    if (!this.collide(this.cur, 0, 1)) { this.cur.y += 1; this.score += 1; this.setData({ score: this.score }); }
    else this.lock();
    this.draw();
  },

  move(d) {
    if (this.data.paused || this.data.over) return;
    if (!this.collide(this.cur, d, 0)) { this.cur.x += d; this.draw(); }
  },

  rotatePiece() {
    if (this.data.paused || this.data.over) return;
    const m = rotate(this.cur.mat);
    if (!this.collide(this.cur, 0, 0, m)) { this.cur.mat = m; this.draw(); return; }
    if (!this.collide(this.cur, -1, 0, m)) { this.cur.x -= 1; this.cur.mat = m; this.draw(); return; }
    if (!this.collide(this.cur, 1, 0, m)) { this.cur.x += 1; this.cur.mat = m; this.draw(); }
  },

  lock() {
    const p = this.cur;
    for (let r = 0; r < p.mat.length; r++) {
      for (let c = 0; c < p.mat[r].length; c++) {
        if (p.mat[r][c]) {
          const by = p.y + r, bx = p.x + c;
          if (by >= 0) this.board[by][bx] = p.type + 1;
        }
      }
    }
    // 消行
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every((v) => v)) {
        this.board.splice(r, 1); this.board.unshift(new Array(COLS).fill(0)); cleared++; r++;
      }
    }
    if (cleared) {
      const add = [0, 100, 300, 500, 800][cleared] || 800;
      this.score += add; this.lines += cleared;
      this.setData({ score: this.score, lines: this.lines });
      const ni = Math.max(220, 800 - Math.floor(this.score / 500) * 60);
      if (ni !== this.dropInterval) { this.dropInterval = ni; this.loop(); }
    }
    if (this.score > this.data.best) { this.data.best = this.score; this.setData({ best: this.score }); }
    this.cur = this.spawn();
    if (this.over) { this.draw(); return; }
  },

  gameOver() {
    this.over = true;
    clearInterval(this.loopTimer); this.loopTimer = null;
    store.recordPlay('tetris', { score: this.score });
    this.setData({ over: true, best: store.getGame('tetris').best });
  },

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx, cell = this.cell;
    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.fillStyle = '#F3E9DA'; ctx.fillRect(0, 0, this.cw, this.ch);
    ctx.strokeStyle = 'rgba(190,150,110,0.12)'; ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * cell, 0); ctx.lineTo(c * cell, this.ch); ctx.stroke(); }
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * cell); ctx.lineTo(this.cw, r * cell); ctx.stroke(); }
    const drawCell = (x, y, color) => {
      const px = x * cell, py = y * cell;
      ctx.fillStyle = color; ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(px + 1, py + 1, cell - 2, (cell - 2) / 3);
    };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (this.board[r][c]) drawCell(c, r, COLORS[this.board[r][c] - 1]);
    if (this.cur) {
      const p = this.cur;
      for (let r = 0; r < p.mat.length; r++) for (let c = 0; c < p.mat[r].length; c++) {
        if (p.mat[r][c]) { const by = p.y + r; if (by >= 0) drawCell(p.x + c, by, COLORS[p.type]); }
      }
    }
    if (this.data.over) {
      ctx.fillStyle = 'rgba(53,48,42,0.72)'; ctx.fillRect(0, 0, this.cw, this.ch);
      ctx.fillStyle = '#FFFCF5'; ctx.textAlign = 'center'; ctx.font = 'bold ' + (cell * 1.1) + 'px serif';
      ctx.fillText('游戏结束', this.cw / 2, this.ch / 2 - cell);
      ctx.font = (cell * 0.7) + 'px sans-serif';
      ctx.fillText('得分 ' + this.score, this.cw / 2, this.ch / 2 + cell * 0.6);
    }
  },

  onTouchStart(e) { const t = e.touches[0]; this.sx = t.clientX; this.sy = t.clientY; },
  onTouchEnd(e) {
    if (this.data.paused || this.data.over) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this.sx, dy = t.clientY - this.sy;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { this.rotatePiece(); return; }
    if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? 1 : -1);
    else if (dy > 0) this.softDrop();
  },

  onReset() { this.start(); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { store.recordPlay('tetris', { score: this.score }); wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); if (this.ctx) this.draw(); },
  onUnload() { this.timer.stop(); if (this.loopTimer) clearInterval(this.loopTimer); store.recordPlay('tetris', { score: this.score }); }
});
