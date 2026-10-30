const store = require('../../utils/store');

Component({
  properties: {
    title: { type: String, value: '小游戏' },
    timeText: { type: String, value: '00:00' },
    statText: { type: String, value: '' },
    paused: { type: Boolean, value: false },
    showHint: { type: Boolean, value: true },

    /* ---------- 通关庆祝层 ---------- */
    /** 是否显示通关层（由各游戏在判定通关后置为 true） */
    win: { type: Boolean, value: false },
    /** 副标题，如「3×3 · 数字华容道」 */
    winSub: { type: String, value: '' },
    /** 统计数据，形如 [{ label:'用时', value:'01:23' }, { label:'步数', value:'48' }] */
    winStats: { type: Array, value: [] },
    /** 是否刷新了个人纪录 */
    winNewBest: { type: Boolean, value: false },
    /** 通关寄语（取自典籍） */
    winQuote: { type: String, value: '' },

    /* ---------- 失败层（可选：只有传了 fail 的游戏才会出现） ---------- */
    /** 是否显示失败层 */
    fail: { type: Boolean, value: false },
    /** 失败副标题，如「步数已超出 3 倍最优」 */
    failSub: { type: String, value: '' },
    /** 失败统计，形如 [{ label:'步数', value:'132' }] */
    failStats: { type: Array, value: [] },
    /** 失败层主按钮文案（默认「再来一局」） */
    failBtnText: { type: String, value: '再来一局' }
  },
  data: {
    themeCls: 'theme-warm'
  },
  pageLifetimes: {
    show() {
      // 主题未变化时不重复 setData，减少每局游戏开始时的跨线程通信
      const cls = store.themeClass();
      if (cls !== this.data.themeCls) this.setData({ themeCls: cls });
    }
  },
  methods: {
    onBack() { this.triggerEvent('back'); },
    onReset() { this.triggerEvent('reset'); },
    onHint() { this.triggerEvent('hint'); },
    onHome() { this.triggerEvent('home'); },
    onPause() { this.triggerEvent('pause'); },
    onWinAgain() { this.triggerEvent('again'); },
    onWinHome() { this.triggerEvent('winhome'); },
    onFailRetry() { this.triggerEvent('failretry'); },
    onFailContinue() { this.triggerEvent('failcontinue'); },
    onFailHome() { this.triggerEvent('failhome'); }
  }
});
