import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

const CELLS = 16; // 4x4

Page({
  data: {
    title: '瞬间记忆', cells: new Array(CELLS).fill(false), count: 3, level: 1,
    phase: 'show', picked: [], statText: '第 1 关', timeText: '00:00', paused: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.round(1);
  },

  round(level) {
    const count = Math.min(2 + level, 8);
    const idxs = engine.shuffle([...Array(CELLS).keys()]).slice(0, count);
    const cells = new Array(CELLS).fill(false);
    idxs.forEach((i) => (cells[i] = true));
    this.setData({ level, count, cells, phase: 'show', picked: [] });
    this._target = idxs.slice().sort((a, b) => a - b);
    setTimeout(() => { if (this.data.phase === 'show') this.setData({ cells: new Array(CELLS).fill(false), phase: 'input' }); }, 950);
  },

  onTap(e) {
    if (this.data.phase !== 'input' || this.data.paused) return;
    const i = e.currentTarget.dataset.index;
    let picked = this.data.picked.slice();
    if (picked.indexOf(i) >= 0) return;
    picked.push(i);
    const cells = this.data.cells.slice(); cells[i] = true;
    this.setData({ picked, cells });
    if (picked.length === this.data.count) this.judge(picked);
  },

  judge(picked) {
    const ok = picked.slice().sort((a, b) => a - b).join() === this._target.join();
    if (ok) {
      store.recordPlay('flash', { win: true, score: this.data.level * 50 });
      this.setData({ phase: 'done' });
      wx.showToast({ title: '记对啦！', icon: 'success' });
      setTimeout(() => this.round(this.data.level + 1), 700);
    } else {
      wx.showToast({ title: '再看看~', icon: 'none' });
      setTimeout(() => this.round(this.data.level), 700);
    }
  },

  onReset() { this.round(this.data.level); },
  onHint() { wx.showToast({ title: '记住亮起的位置，再按顺序点出', icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
