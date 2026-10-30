import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');
const bank = require('../../../utils/teaser-bank');

const { BANK, DIFFS, shuffle, checkAnswer } = bank;

Page({
  data: {
    title: '脑筋急转弯', diff: 1, diffs: DIFFS, q: null, answer: '',
    input: '', locked: false, correct: false,
    combo: 0, mult: 1, score: 0, best: 0, message: '', msgType: 'info',
    wrongBook: [], showWrong: false, timeText: '00:00', paused: false, showHint: false,
    /* 通关层 */
    win: false, winSub: '', winStats: [], winNewBest: false, winQuote: '',
    /* 本难度总题数 / 已答对数，答满即通关 */
    total: 0, solved: 0
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.setData({
      best: store.getGame('teaser').best,
      wrongBook: store.getWrongBook('teaser')
    });
    this.buildQueue();
  },

  buildQueue() {
    const pool = BANK.map((it, i) => ({ it, i })).filter((x) => x.it.d === this.data.diff);
    this.queue = shuffle(pool);
    this.qpos = 0;
    // 本题库内「答对一次」即计入进度，答满全部题目触发通关
    this.passed = {};
    this.setData({ total: this.queue.length, solved: 0, combo: 0, mult: 1, score: 0 });
    this.next();
  },

  next() {
    if (!this.queue.length) return;
    if (this.qpos >= this.queue.length) this.queue = shuffle(this.queue); // 循环练习
    const cur = this.queue[this.qpos % this.queue.length];
    this.qpos++;
    this.curBank = cur;
    this.setData({
      q: cur.it.q, answer: cur.it.a, input: '', locked: false, correct: false,
      message: '', msgType: 'info'
    });
    // 自动聚焦：直接开打字，少一次点击
    this.setData({ focusInput: true });
  },

  onInput(e) { this.setData({ input: e.detail.value }); },
  onClear() { this.setData({ input: '' }); },

  submit() {
    if (this.data.locked) return;
    const val = (this.data.input || '').trim();
    if (!val) { wx.showToast({ title: '先写下你的答案', icon: 'none' }); return; }

    const ok = checkAnswer(val, this.curBank.it);
    const cur = this.curBank;

    if (ok) {
      const first = !this.passed[cur.i];
      this.passed[cur.i] = true;
      const solved = first ? this.data.solved + 1 : this.data.solved;
      const combo = this.data.combo + 1;
      const mult = Math.min(8, Math.pow(2, combo - 1));
      const gain = 10 * mult;
      const score = this.data.score + gain;

      this.setData({
        locked: true, correct: true, combo, mult, score, solved,
        message: '答对！+' + gain + ' 分（' + mult + ' 倍）', msgType: 'ok'
      });
      if (score > this.data.best) { this.data.best = score; this.setData({ best: score }); }

      // 答满本难度全部题目 -> 视为通关
      if (this.queue.length && solved >= this.queue.length) {
        setTimeout(() => this.win(), 800);
        return;
      }
      setTimeout(() => this.next(), 900);
    } else {
      store.addWrong('teaser', { qid: cur.i, q: cur.it.q, a: cur.it.a });
      this.setData({
        locked: true, correct: false, combo: 0, mult: 1,
        message: '不太对，参考答案：' + cur.it.a, msgType: 'warn',
        wrongBook: store.getWrongBook('teaser')
      });
      setTimeout(() => this.next(), 1600);
    }
  },

  /** 放弃本题，直接看答案 */
  giveUp() {
    if (this.data.locked) return;
    const cur = this.curBank;
    store.addWrong('teaser', { qid: cur.i, q: cur.it.q, a: cur.it.a });
    this.setData({
      locked: true, correct: false, combo: 0, mult: 1,
      message: '参考答案：' + cur.it.a, msgType: 'warn',
      wrongBook: store.getWrongBook('teaser')
    });
    setTimeout(() => this.next(), 1600);
  },

  win() {
    this.timer.stop();
    const sec = this.timer.get();
    const score = this.data.score;

    let isNewBest = false;
    try {
      const res = store.finishRound('teaser', { win: true, score, timeSec: sec });
      isNewBest = res.isNewBest;
    } catch (e) { /* 统计失败不影响通关展示 */ }

    this.setData({
      win: true,
      winSub: DIFFS[this.data.diff] + ' · 全部 ' + this.queue.length + ' 题答对',
      winStats: [
        { label: '得分', value: String(score) },
        { label: '题数', value: String(this.data.solved) },
        { label: '用时', value: store.formatTime(sec) }
      ],
      winNewBest: isNewBest,
      winQuote: engine.blessing()
    });
    if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light', fail: () => {} });
  },

  onAgain() {
    this.setData({ win: false });
    this.timer.reset();
    this.timer.start();
    this.buildQueue();
  },
  onWinHome() { this.goHome(); },

  selectDiff(e) {
    const d = e.currentTarget.dataset.d;
    if (d === this.data.diff) return;
    this.setData({ diff: d, win: false });
    this.timer.reset();
    this.timer.start();
    this.buildQueue();
  },

  toggleWrong() { this.setData({ showWrong: !this.data.showWrong, wrongBook: store.getWrongBook('teaser') }); },
  clearWrong() {
    store.clearWrong('teaser');
    this.setData({ wrongBook: [], showWrong: false });
    wx.showToast({ title: '已清空错题本', icon: 'none' });
  },

  onReset() { this.timer.reset(); this.timer.start(); this.buildQueue(); },
  onHint() { wx.showToast({ title: '答案多为一个字或一句俏皮话，往「换个角度想」的方向猜', icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() {
    store.recordPlay('teaser', { score: this.data.score });
    wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } });
  },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); store.recordPlay('teaser', { score: this.data.score }); }
});
