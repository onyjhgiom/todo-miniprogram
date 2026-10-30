import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

const SYMS = ['🍃', '🌸', '🌿', '🍂', '🌟', '🍁', '🌼', '☘️', '🪷', '🌙', '⭐', '🐾', '🍵', '📜', '🔔', '🧩'];
const LEVELS = [6, 8, 10, 12];

Page({
  data: {
    title: '翻翻乐记忆', cards: [], cols: 4, pairs: 8, matched: 0, level: 1,
    statText: '配对 0/8', timeText: '00:00', paused: false, locked: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.newLevel(1);
  },

  newLevel(level) {
    const pairs = LEVELS[Math.min(level - 1, LEVELS.length - 1)];
    const pool = engine.shuffle(SYMS.slice()).slice(0, pairs);
    let deck = engine.shuffle(pool.concat(pool).map((sym, i) => ({ sym, flipped: false, matched: false, key: i })));
    const cols = pairs <= 6 ? 3 : 4;
    this.timer.reset();
    this.setData({ cards: deck, cols, pairs, matched: 0, level, statText: '配对 0/' + pairs, locked: false, first: -1, second: -1 });
  },

  onTap(e) {
    const i = e.currentTarget.dataset.index;
    if (this.data.locked || this.data.paused) return;
    const card = this.data.cards[i];
    if (card.flipped || card.matched) return;
    const cards = this.data.cards.slice();
    cards[i].flipped = true;
    let { first, second } = this.data;
    if (first < 0) { this.setData({ cards, first: i }); return; }
    if (first === i) return;
    this.setData({ cards, second: i, locked: true });
    if (cards[first].sym === cards[i].sym) {
      setTimeout(() => {
        const c2 = this.data.cards.slice();
        c2[first].matched = true; c2[i].matched = true;
        const matched = this.data.matched + 1;
        this.setData({ cards: c2, matched, first: -1, second: -1, locked: false, statText: '配对 ' + matched + '/' + this.data.pairs });
        if (matched === this.data.pairs) this.win();
      }, 380);
    } else {
      setTimeout(() => {
        const c3 = this.data.cards.slice();
        c3[first].flipped = false; c3[i].flipped = false;
        this.setData({ cards: c3, first: -1, second: -1, locked: false });
      }, 720);
    }
  },

  win() {
    store.recordPlay('memory', { win: true, score: this.data.level * 100 });
    wx.showModal({
      title: '本关完成', content: '进入第 ' + (this.data.level + 1) + ' 关，卡片更多啦！\n' + engine.blessing(),
      confirmText: '下一关', cancelText: '返回',
      success: (res) => { if (res.confirm) this.newLevel(this.data.level + 1); else this.goHome(); }
    });
  },

  onReset() { this.newLevel(this.data.level); },
  onHint() { wx.showToast({ title: '记住翻开的图案，两两配对', icon: 'none' }); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
