import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');
const quiz = require('../../../utils/quiz');

Page({
  data: {
    title: '典籍常识问答', q: '', src: '', options: [], answer: 0, score: 0,
    statText: '答对 0', timeText: '00:00', paused: false, idx: 0
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.qs = engine.shuffle(quiz.CLASSIC_QA.slice());
    this.next();
  },

  next() {
    if (this.data.idx >= this.qs.length) this.data.idx = 0;
    const q = this.qs[this.data.idx];
    const options = engine.shuffle(q.options.slice());
    this.setData({ q: q.q, src: q.src, options, answer: options.indexOf(q.options[q.answer]), statText: '答对 ' + this.data.score });
    this.data.idx++;
  },

  onPick(e) {
    const i = e.currentTarget.dataset.i;
    if (i === this.data.answer) {
      this.data.score++;
      store.recordPlay('classicqa', { score: this.data.score });
      wx.showToast({ title: '答对啦', icon: 'success' });
    } else {
      wx.showToast({ title: '正确答案：' + this.data.options[this.data.answer], icon: 'none' });
    }
    setTimeout(() => this.next(), 650);
  },

  onReset() { this.data.idx = 0; this.data.score = 0; this.timer.reset(); this.next(); },
  onHint() { wx.showToast({ title: '出自「' + this.data.src + '」', icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
