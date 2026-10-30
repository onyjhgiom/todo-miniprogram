import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

Page({
  data: {
    title: '经典拼图', size: 3, tiles: [], first: -1, moves: 0,
    statText: '步数 0', timeText: '00:00', paused: false, won: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.newGame(3);
  },

  newGame(size) {
    this.timer.stop(); this.timer.reset(); this.timer.start();
    const n = size * size;
    let order = engine.shuffle([...Array(n).keys()].map((x) => x + 1));
    if (order.join() === [...Array(n).keys()].map((x) => x + 1).join()) engine.shuffle(order);
    this.setData({ size, tiles: order, first: -1, moves: 0, statText: '步数 0', timeText: '00:00', paused: false, won: false });
  },

  pick(e) { this.newGame(Number(e.currentTarget.dataset.size)); },

  onTap(e) {
    if (this.data.won || this.data.paused) return;
    const i = e.currentTarget.dataset.index;
    let first = this.data.first;
    if (first < 0) { this.setData({ first: i }); return; }
    if (first === i) { this.setData({ first: -1 }); return; }
    const tiles = this.data.tiles.slice();
    const t = tiles[first]; tiles[first] = tiles[i]; tiles[i] = t;
    const moves = this.data.moves + 1;
    const solved = tiles.join() === [...Array(this.data.size * this.data.size).keys()].map((x) => x + 1).join();
    this.setData({ tiles, first: -1, moves, statText: '步数 ' + moves });
    if (solved) this.win();
  },

  win() {
    this.data.won = true; this.timer.stop();
    const sec = this.timer.get();
    store.recordPlay('puzzle', { steps: this.data.moves, timeSec: sec, win: true, score: Math.max(0, 500 - this.data.moves * 5) });
    wx.showModal({
      title: '拼好啦', content: '用时 ' + store.formatTime(sec) + '，步数 ' + this.data.moves + '。\n' + engine.blessing(),
      confirmText: '再来一局', cancelText: '返回',
      success: (res) => { if (res.confirm) this.newGame(this.data.size); else this.goHome(); }
    });
  },

  onReset() { this.newGame(this.data.size); },
  onHint() { wx.showToast({ title: '点两块互换，把数字按顺序拼好', icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
