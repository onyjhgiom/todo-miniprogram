import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

Page({
  data: {
    title: '数字速记', show: '', input: '', len: 3, level: 1, phase: 'show',
    statText: '长度 3', timeText: '00:00', paused: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.round(1);
  },

  round(level) {
    const len = Math.min(2 + level, 9);
    let s = '';
    for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
    this._answer = s;
    this.setData({ level, len, show: s, input: '', phase: 'show', statText: '长度 ' + len });
    setTimeout(() => { if (this.data.phase === 'show') this.setData({ show: '', phase: 'input' }); }, 1500);
  },

  onNum(e) {
    if (this.data.phase !== 'input' || this.data.paused) return;
    if (this.data.input.length >= this.data.len) return;
    const input = this.data.input + e.currentTarget.dataset.n;
    this.setData({ input });
    if (input.length === this.data.len) this.judge(input);
  },

  onDel() {
    if (this.data.phase !== 'input') return;
    this.setData({ input: this.data.input.slice(0, -1) });
  },

  judge(input) {
    if (input === this._answer) {
      store.recordPlay('nummem', { win: true, score: this.data.level * 50 });
      wx.showToast({ title: '记对啦！', icon: 'success' });
      setTimeout(() => this.round(this.data.level + 1), 600);
    } else {
      wx.showToast({ title: '差一点，再看一次', icon: 'none' });
      setTimeout(() => this.round(this.data.level), 700);
    }
  },

  onReset() { this.round(this.data.level); },
  onHint() { wx.showToast({ title: '看完数字，凭记忆依次输入', icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
