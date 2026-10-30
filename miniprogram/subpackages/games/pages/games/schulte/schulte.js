import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function rating(sec) {
  if (sec <= 35) return '优秀';
  if (sec <= 55) return '良好';
  if (sec <= 80) return '及格';
  return '继续加油';
}

Page({
  data: {
    title: '舒尔特方格', grid: [], next: 1, timeText: '00:00', bestText: '—',
    report: null, paused: false, showHint: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    const rec = store.getGame('schulte');
    this.setData({ bestText: rec.bestTime ? store.formatTime(rec.bestTime) : '—' });
    this.newRound();
  },

  newRound() {
    const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    this.timer.stop(); this.timer.reset();
    this.setData({ grid: nums.map((n) => ({ n, done: false })), next: 1, timeText: '00:00', report: null });
  },

  onTap(e) {
    if (this.data.report) return;
    const idx = e.currentTarget.dataset.index;
    const cell = this.data.grid[idx];
    if (cell.done) return;
    if (this.data.next === 1 && cell.n === 1) this.timer.start();
    if (cell.n === this.data.next) {
      const grid = this.data.grid.slice();
      grid[idx] = { n: cell.n, done: true };
      const next = this.data.next + 1;
      this.setData({ grid, next });
      if (next > 25) this.finish();
    } else {
      this.flashWrong(idx);
    }
  },

  flashWrong(idx) {
    const grid = this.data.grid.slice();
    grid[idx] = Object.assign({}, grid[idx], { wrong: true });
    this.setData({ grid });
    setTimeout(() => {
      const g2 = this.data.grid.slice();
      g2[idx] = Object.assign({}, g2[idx], { wrong: false });
      this.setData({ grid: g2 });
    }, 300);
  },

  finish() {
    this.timer.stop();
    const sec = this.timer.get();
    const rep = { time: store.formatTime(sec), sec, rating: rating(sec), per: (sec / 25).toFixed(2), best: store.formatTime(store.getGame('schulte').bestTime) };
    store.recordPlay('schulte', { win: true, timeSec: sec });
    const rec = store.getGame('schulte');
    this.setData({ report: rep, bestText: rec.bestTime ? store.formatTime(rec.bestTime) : '—' });
  },

  onReset() { this.newRound(); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
