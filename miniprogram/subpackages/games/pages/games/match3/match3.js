import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

const R = 7, C = 7, COLORS = 5;

function randColor() { return Math.floor(Math.random() * COLORS); }

function findMatches(g) {
  const m = new Array(R * C).fill(false);
  for (let r = 0; r < R; r++) {
    let run = 1;
    for (let c = 1; c < C; c++) {
      if (g[r * C + c] === g[r * C + c - 1] && g[r * C + c] >= 0) run++;
      else { if (run >= 3) for (let k = c - run; k < c; k++) m[r * C + k] = true; run = 1; }
    }
    if (run >= 3) for (let k = C - run; k < C; k++) m[r * C + k] = true;
  }
  for (let c = 0; c < C; c++) {
    let run = 1;
    for (let r = 1; r < R; r++) {
      if (g[r * C + c] === g[(r - 1) * C + c] && g[r * C + c] >= 0) run++;
      else { if (run >= 3) for (let k = r - run; k < r; k++) m[k * C + c] = true; run = 1; }
    }
    if (run >= 3) for (let k = R - run; k < R; k++) m[k * C + c] = true;
  }
  return m;
}

function collapse(g) {
  for (let c = 0; c < C; c++) {
    let write = R - 1;
    for (let r = R - 1; r >= 0; r--) {
      if (g[r * C + c] >= 0) {
        if (write !== r) { g[write * C + c] = g[r * C + c]; g[r * C + c] = -1; }
        write--;
      }
    }
    for (let r = write; r >= 0; r--) g[r * C + c] = randColor();
  }
}

function resolve(g) {
  let total = 0;
  while (true) {
    const m = findMatches(g);
    const cnt = m.filter(Boolean).length;
    if (!cnt) break;
    for (let i = 0; i < g.length; i++) if (m[i]) g[i] = -1;
    collapse(g);
    total += cnt;
  }
  return total;
}

function makeGrid() {
  let g;
  do { g = []; for (let i = 0; i < R * C; i++) g.push(randColor()); } while (findMatches(g).some(Boolean));
  return g;
}

Page({
  data: {
    title: '极简消消乐', grid: [], score: 0, best: 0,
    statText: '得分 0', timeText: '00:00', paused: false, first: -1
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.setData({ best: store.getGame('match3').best });
    this.timer.start();
    this.setData({ grid: makeGrid(), first: -1 });
  },

  onTap(e) {
    if (this.data.paused) return;
    const i = e.currentTarget.dataset.index;
    let first = this.data.first;
    if (first < 0) { this.setData({ first: i }); return; }
    if (first === i) { this.setData({ first: -1 }); return; }
    const r1 = Math.floor(first / C), c1 = first % C, r2 = Math.floor(i / C), c2 = i % C;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) { this.setData({ first: i }); return; }
    const g = this.data.grid.slice();
    const t = g[first]; g[first] = g[i]; g[i] = t;
    if (findMatches(g).some(Boolean)) {
      const gained = resolve(g);
      const score = this.data.score + gained * 10;
      if (score > this.data.best) this.setData({ best: score });
      this.setData({ grid: g, score, statText: '得分 ' + score, first: -1 });
    } else {
      // 无消除，换回
      const t2 = g[first]; g[first] = g[i]; g[i] = t2;
      this.setData({ grid: g, first: -1 });
    }
  },

  onReset() { this.setData({ grid: makeGrid(), score: 0, statText: '得分 0', first: -1 }); },
  onHint() { wx.showToast({ title: '交换相邻方块，凑齐三连即消除', icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { store.recordPlay('match3', { score: this.data.score }); wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); store.recordPlay('match3', { score: this.data.score }); }
});
