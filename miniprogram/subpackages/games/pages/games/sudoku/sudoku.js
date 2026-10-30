import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

const SIZES = {
  4: { boxR: 2, boxC: 2, remove: 8 },
  6: { boxR: 2, boxC: 3, remove: 22 },
  9: { boxR: 3, boxC: 3, remove: 45 }
};

function generate(size, boxR, boxC) {
  const g = new Array(size * size).fill(0);
  const ok = (r, c, v) => {
    for (let i = 0; i < size; i++) { if (g[r * size + i] === v) return false; if (g[i * size + c] === v) return false; }
    const br = Math.floor(r / boxR) * boxR, bc = Math.floor(c / boxC) * boxC;
    for (let i = 0; i < boxR; i++) for (let j = 0; j < boxC; j++) if (g[(br + i) * size + (bc + j)] === v) return false;
    return true;
  };
  const fill = (pos) => {
    if (pos === size * size) return true;
    const r = Math.floor(pos / size), c = pos % size;
    const cand = engine.shuffle([...Array(size).keys()].map((x) => x + 1));
    for (const v of cand) { if (ok(r, c, v)) { g[pos] = v; if (fill(pos + 1)) return true; g[pos] = 0; } }
    return false;
  };
  fill(0);
  return g;
}

Page({
  data: {
    title: '数独闯关', size: 9, board: [], given: [], solution: [], selected: -1,
    nums: [1, 2, 3, 4, 5, 6, 7, 8, 9], filled: 0, total: 81,
    statText: '已填 0', timeText: '00:00', paused: false, won: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.newGame(9);
  },

  newGame(size) {
    this.timer.stop(); this.timer.reset(); this.timer.start();
    const cfg = SIZES[size];
    const solution = generate(size, cfg.boxR, cfg.boxC);
    const board = solution.slice();
    const given = new Array(size * size).fill(true);
    let removed = cfg.remove;
    const idxs = engine.shuffle([...Array(size * size).keys()]);
    for (const i of idxs) { if (removed <= 0) break; board[i] = 0; given[i] = false; removed--; }
    const filled = board.filter((v) => v).length;
    this.setData({
      size, solution, board, given, selected: -1, nums: [...Array(size).keys()].map((x) => x + 1),
      filled, total: size * size, statText: '已填 ' + filled, timeText: '00:00', paused: false, won: false
    });
  },

  pick(e) { this.newGame(Number(e.currentTarget.dataset.size)); },

  onSelect(e) {
    const i = e.currentTarget.dataset.index;
    if (this.data.given[i]) { wx.showToast({ title: '题目给定不可改', icon: 'none' }); return; }
    this.setData({ selected: i });
  },

  onNum(e) {
    const v = Number(e.currentTarget.dataset.n);
    const i = this.data.selected;
    if (i < 0 || this.data.given[i]) return;
    const board = this.data.board.slice();
    board[i] = (board[i] === v) ? 0 : v;
    const filled = board.filter((x) => x).length;
    this.setData({ board, filled, statText: '已填 ' + filled });
    if (filled === this.data.total) this.check();
  },

  onErase() {
    const i = this.data.selected;
    if (i < 0 || this.data.given[i]) return;
    const board = this.data.board.slice(); board[i] = 0;
    const filled = board.filter((x) => x).length;
    this.setData({ board, filled, statText: '已填 ' + filled });
  },

  check() {
    if (this.data.board.join() === this.data.solution.join()) this.win();
    else wx.showToast({ title: '还有错误，继续检查', icon: 'none' });
  },

  win() {
    this.data.won = true; this.timer.stop();
    const sec = this.timer.get();
    store.recordPlay('sudoku', { timeSec: sec, win: true, score: Math.max(0, 1500 - sec) });
    wx.showModal({
      title: '数独完成', content: '用时 ' + store.formatTime(sec) + '。\n' + engine.blessing(),
      confirmText: '再来一局', cancelText: '返回',
      success: (res) => { if (res.confirm) this.newGame(this.data.size); else this.goHome(); }
    });
  },

  onReset() { this.newGame(this.data.size); },
  onHint() {
    const empties = [];
    this.data.board.forEach((v, i) => { if (!v) empties.push(i); });
    if (!empties.length) return;
    const i = empties[Math.floor(Math.random() * empties.length)];
    const board = this.data.board.slice(); board[i] = this.data.solution[i];
    const filled = board.filter((x) => x).length;
    this.setData({ board, filled, statText: '已填 ' + filled, selected: i });
    if (filled === this.data.total) this.check();
  },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
