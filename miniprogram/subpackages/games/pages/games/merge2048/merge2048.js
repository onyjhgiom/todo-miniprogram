import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

function slideLine(line) {
  const nums = line.filter((v) => v);
  const res = []; let gained = 0;
  for (let i = 0; i < nums.length; i++) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      const m = nums[i] * 2; res.push(m); gained += m; i++;
    } else res.push(nums[i]);
  }
  while (res.length < 4) res.push(0);
  return { line: res, gained };
}

Page({
  data: {
    title: '2048 合成', cells: [], score: 0, best: 0,
    statText: '得分 0', timeText: '00:00', paused: false, won: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.setData({ best: store.getGame('merge2048').best });
    this.newGame();
  },

  toCells(g) {
    return g.map((v) => ({ val: v, cls: v ? 'c' + v : 'c0' }));
  },

  newGame() {
    this.timer.stop(); this.timer.reset(); this.timer.start();
    const g = new Array(16).fill(0);
    this.spawn(g); this.spawn(g);
    this.setData({ cells: this.toCells(g), score: 0, statText: '得分 0', timeText: '00:00', paused: false, won: false, _g: g });
  },

  spawn(g) {
    const empty = [];
    g.forEach((v, i) => { if (!v) empty.push(i); });
    if (!empty.length) return;
    const i = empty[Math.floor(Math.random() * empty.length)];
    g[i] = Math.random() < 0.9 ? 2 : 4;
  },

  move(dir) {
    if (this.data.won || this.data.paused) return;
    const g = this.data._g.slice();
    let gained = 0;
    if (dir === 'left' || dir === 'right') {
      for (let r = 0; r < 4; r++) {
        let line = g.slice(r * 4, r * 4 + 4);
        if (dir === 'right') line.reverse();
        const sl = slideLine(line); if (dir === 'right') sl.line.reverse();
        for (let c = 0; c < 4; c++) g[r * 4 + c] = sl.line[c];
        gained += sl.gained;
      }
    } else {
      for (let c = 0; c < 4; c++) {
        let col = []; for (let r = 0; r < 4; r++) col.push(g[r * 4 + c]);
        if (dir === 'down') col.reverse();
        const sl = slideLine(col); if (dir === 'down') sl.line.reverse();
        for (let r = 0; r < 4; r++) g[r * 4 + c] = sl.line[r];
        gained += sl.gained;
      }
    }
    if (g.join() === this.data._g.join()) return; // 无移动
    this.spawn(g);
    const score = this.data.score + gained;
    const won = g.indexOf(2048) >= 0;
    this.setData({ cells: this.toCells(g), score, statText: '得分 ' + score, _g: g });
    if (score > this.data.best) { this.data.best = score; this.setData({ best: score }); }
    if (won && !this.data.won) { this.data.won = true; this.timer.stop(); this.finish(score); }
  },

  finish(score) {
    store.recordPlay('merge2048', { score, win: true });
    wx.showModal({
      title: '合成 2048！', content: '得分 ' + score + '。\n' + engine.blessing(),
      confirmText: '继续玩', cancelText: '返回主页',
      success: (res) => { if (!res.confirm) this.goHome(); }
    });
  },

  // 触摸滑动
  onTouchStart(e) { this.sx = e.touches[0].clientX; this.sy = e.touches[0].clientY; },
  onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - this.sx;
    const dy = e.changedTouches[0].clientY - this.sy;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? 'right' : 'left');
    else this.move(dy > 0 ? 'down' : 'up');
  },
  onDir(e) { this.move(e.currentTarget.dataset.dir); },

  onReset() { this.newGame(); },
  onHint() { wx.showToast({ title: '相同数字相撞即合并，凑出 2048', icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() {
    store.recordPlay('merge2048', { score: this.data.score });
    wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } });
  },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); store.recordPlay('merge2048', { score: this.data.score }); }
});
