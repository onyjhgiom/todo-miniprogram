import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');
const quiz = require('../../../utils/quiz');

/* 飞花令（填空版）
 * 玩法：给出「令字」，玩家自己默写一句含该字的诗词，而不是做选择题。
 * 判定：只要所填句子包含令字即算过关（避免穷举所有诗词）；
 *       若命中题库里的示范名句，额外标记为「名句」，得分更高。
 * 完成一整轮全部令字 → 触发通关层。
 */

/** 诗句里是否含某字 */
function hasChar(s, ch) { return String(s || '').indexOf(ch) >= 0; }

/**
 * 判定玩家所填是否为题库中的示范名句。
 * 采用严格归一化比对：完全一致，或玩家所写是某示范句的完整子串且长度不短于其 2 字以内。
 * 这样「床前明月光」不会因为只说半句就被记为名句，而「床前明月光，疑是地上霜」的
 * 常见标点/空格差异仍能识别。
 */
function isFamous(input, pool) {
  const v = engine.normalize(input);
  if (!v) return false;
  for (let i = 0; i < pool.length; i++) {
    const n = engine.normalize(pool[i]);
    if (!n) continue;
    if (v === n) return true;
    if (v.length >= n.length - 2 && n.indexOf(v) >= 0) return true;
  }
  return false;
}

Page({
  data: {
    title: '国学飞花令', theme: '', src: '', score: 0, combo: 0, mult: 1,
    statText: '答对 0', timeText: '00:00', paused: false,
    input: '', locked: false, correct: false, famous: false,
    message: '', msgType: 'info', refAnswer: '',
    total: 0, solved: 0, wrongBook: [],
    /* 通关层 */
    win: false, winSub: '', winStats: [], winNewBest: false, winQuote: ''
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.setData({ wrongBook: store.getWrongBook('feihualing') });
    this.buildQueue();
  },

  buildQueue() {
    this.queue = engine.shuffleNew(quiz.FEIHUA);
    this.qpos = 0;
    this.passed = {};
    this.setData({ total: this.queue.length, solved: 0, score: 0, combo: 0, mult: 1 });
    this.next();
  },

  next() {
    if (!this.queue.length) return;
    this.qpos = (this.qpos || 0) % this.queue.length;
    const q = this.queue[this.qpos];
    this.qpos++;
    this.cur = q;
    this.setData({
      theme: q.char, src: '', input: '', locked: false, correct: false, famous: false,
      message: '', msgType: 'info', refAnswer: '', focusInput: true
    });
  },

  onInput(e) { this.setData({ input: e.detail.value }); },
  onClear() { this.setData({ input: '' }); },

  submit() {
    if (this.data.locked) return;
    const val = (this.data.input || '').trim();
    if (!val) { wx.showToast({ title: '请写一句含「' + this.data.theme + '」字的诗词', icon: 'none' }); return; }

    const q = this.cur;
    const ch = this.data.theme;

    // 核心判定：句子必须包含令字，且不能只写一个字
    const contains = hasChar(val, ch);
    const longEnough = engine.normalize(val).length >= 2;

    if (!contains || !longEnough) {
      store.addWrong('feihualing', { qid: q.char, q: '含「' + ch + '」字的诗句', a: q.best });
      this.setData({
        locked: true, correct: false, combo: 0, mult: 1,
        message: contains ? '太短啦，请写完整一句' : '这句里没有「' + ch + '」字哦',
        msgType: 'warn', refAnswer: q.best, src: q.src,
        wrongBook: store.getWrongBook('feihualing')
      });
      setTimeout(() => this.next(), 2000);
      return;
    }

    // 命中题库示范句 → 名句加成（严格比对，避免只说半句也算「名句」）
    const famous = isFamous(val, [q.best].concat(q.alt || []));

    const first = !this.passed[q.char];
    this.passed[q.char] = true;
    const solved = first ? this.data.solved + 1 : this.data.solved;
    const combo = this.data.combo + 1;
    const mult = Math.min(8, Math.pow(2, combo - 1));
    const gain = (famous ? 20 : 10) * mult;
    const score = this.data.score + gain;

    this.setData({
      locked: true, correct: true, famous, combo, mult, score, solved,
      src: q.src, refAnswer: q.best,
      message: (famous ? '好句！与「' + q.src + '」同源 · +' : '含「' + ch + '」字，过关 · +') + gain + ' 分',
      msgType: 'ok'
    });
    store.recordPlay('feihualing', { score });

    if (this.queue.length && solved >= this.queue.length) {
      setTimeout(() => this.win(), 900);
      return;
    }
    setTimeout(() => this.next(), 1200);
  },

  /** 认输：直接看一句示范 */
  giveUp() {
    if (this.data.locked) return;
    const q = this.cur;
    store.addWrong('feihualing', { qid: q.char, q: '含「' + this.data.theme + '」字的诗句', a: q.best });
    this.setData({
      locked: true, correct: false, famous: false, combo: 0, mult: 1,
      message: '示范一句', msgType: 'warn',
      refAnswer: q.best, src: q.src,
      wrongBook: store.getWrongBook('feihualing')
    });
    setTimeout(() => this.next(), 2200);
  },

  win() {
    this.timer.stop();
    const sec = this.timer.get();
    const score = this.data.score;

    let isNewBest = false;
    try {
      const res = store.finishRound('feihualing', { win: true, score, timeSec: sec });
      isNewBest = res.isNewBest;
    } catch (e) { /* 统计失败不影响通关展示 */ }

    this.setData({
      win: true,
      winSub: '飞花令一轮 · 全部 ' + this.queue.length + ' 个令字答满',
      winStats: [
        { label: '得分', value: String(score) },
        { label: '令字', value: this.data.solved + '/' + this.queue.length },
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

  toggleWrong() { this.setData({ showWrong: !this.data.showWrong, wrongBook: store.getWrongBook('feihualing') }); },
  clearWrong() {
    store.clearWrong('feihualing');
    this.setData({ wrongBook: [], showWrong: false });
    wx.showToast({ title: '已清空错题本', icon: 'none' });
  },

  onReset() { this.timer.reset(); this.timer.start(); this.buildQueue(); },

  /** 提示：给一句「不含令字」的干扰句，帮助玩家排除错误联想 */
  onHint() {
    const q = this.cur;
    if (!q) return;
    const bad = (q.no && q.no[0]) || '';
    wx.showToast({
      title: bad ? '想一句含「' + q.char + '」的；「' + bad + '」可不行' : '想一句含「' + q.char + '」字的诗词',
      icon: 'none', duration: 2600
    });
  },

  onBack() { this.timer.stop(); wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() {
    this.timer.stop();
    wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } });
  },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
