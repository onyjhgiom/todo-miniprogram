import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

const SUITS = [
  { s: '♠', red: false }, { s: '♥', red: true },
  { s: '♦', red: true }, { s: '♣', red: false }
];
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** 24 点求解器：返回解的表达式或 null */
function solve24(nums) {
  function rec(list) {
    if (list.length === 1) return Math.abs(list[0].v - 24) < 1e-6 ? list[0].e : null;
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i], b = list[j];
        const rest = [];
        for (let k = 0; k < list.length; k++) if (k !== i && k !== j) rest.push(list[k]);
        const cands = [
          { v: a.v + b.v, e: '(' + a.e + '+' + b.e + ')' },
          { v: a.v - b.v, e: '(' + a.e + '-' + b.e + ')' },
          { v: a.v * b.v, e: '(' + a.e + '*' + b.e + ')' }
        ];
        if (b.v !== 0) cands.push({ v: a.v / b.v, e: '(' + a.e + '/' + b.e + ')' });
        for (const c of cands) {
          const r = rec(rest.concat([c]));
          if (r) return r;
        }
      }
    }
    return null;
  }
  return rec(nums.map((n) => ({ v: n, e: '' + n })));
}

/** 用户算式求值，并返回用到的数字集合 */
function evalExpr(s) {
  let pos = 0; const used = [];
  const peek = () => s[pos];
  function bad() { throw new Error('bad'); }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[pos++]; const r = term(); v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[pos++]; const r = factor(); v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function factor() {
    if (peek() === '(') { pos++; const v = expr(); if (peek() !== ')') bad(); pos++; return v; }
    if (peek() === '-') { pos++; return -factor(); }
    const start = pos;
    while (/[0-9]/.test(peek() || '')) pos++;
    if (start === pos) bad();
    const n = parseInt(s.slice(start, pos), 10); used.push(n); return n;
  }
  const v = expr();
  if (pos !== s.length) bad();
  return { v, used };
}

function genPuzzle() {
  for (let t = 0; t < 2000; t++) {
    const nums = [];
    for (let i = 0; i < 4; i++) nums.push(1 + Math.floor(Math.random() * 13));
    const sol = solve24(nums);
    if (sol) return { nums, sol };
  }
  return { nums: [4, 6, 1, 1], sol: '((4+6)-1)+1' };
}

Page({
  data: {
    title: '24 点', cards: [], expr: '', message: '用四张牌算出 24', msgType: 'info',
    solved: 0, points: 0, timeText: '00:00', paused: false, showHint: true
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.setData({ points: store.getHintState().points });
    this.newPuzzle();
  },

  newPuzzle() {
    const { nums, sol } = genPuzzle();
    this.answer = sol;
    const cards = nums.map((n, i) => ({
      label: RANKS[n],
      suit: SUITS[i % 4].s,
      red: SUITS[i % 4].red
    }));
    this.setData({ cards, expr: '', message: '用四张牌算出 24', msgType: 'info' });
  },

  onExprInput(e) { this.setData({ expr: e.detail.value }); },

  check() {
    const s = (this.data.expr || '').trim();
    if (!s) { this.flash('请先输入算式', 'warn'); return; }
    let r;
    try { r = evalExpr(s.replace(/\s+/g, '')); }
    catch (e) { this.flash('算式格式有误', 'warn'); return; }
    const want = this.data.cards.map((c) => RANKS.indexOf(c.label));
    const used = r.used.slice().sort((a, b) => a - b);
    const wantS = want.slice().sort((a, b) => a - b);
    if (used.join(',') !== wantS.join(',')) { this.flash('需恰好用这 4 张牌各一次', 'warn'); return; }
    if (Math.abs(r.v - 24) < 1e-6) {
      const solved = this.data.solved + 1;
      const pts = store.addPoints(10);
      store.recordPlay('point24', { score: solved });
      this.setData({ solved, points: pts });
      this.flash('正确！+10 积分，换一题', 'ok');
      setTimeout(() => this.newPuzzle(), 700);
    } else {
      this.flash('结果是 ' + Math.round(r.v * 100) / 100 + '，不是 24', 'warn');
    }
  },

  flash(msg, type) { this.setData({ message: msg, msgType: type }); },

  onHint() {
    const st = store.consumeHint(5);
    if (st.result === 'none') {
      this.flash('积分不足，今天还有 ' + st.freeLeft + ' 次免费提示', 'warn');
      return;
    }
    const tip = st.result === 'free' ? '（免费提示）' : '（消耗 ' + st.cost + ' 积分）';
    this.setData({ points: st.points, message: '参考答案：' + this.answer + ' ' + tip, msgType: 'ok' });
  },

  onReset() { this.newPuzzle(); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
