// components/streak-card/streak-card.ts
// 坚持记录（需求十八）：连续天数 + 7 个进度点 + 里程碑文案。
// 文案与点位由页面算好后下发（里程碑规则在 utils/focus-copy.ts），组件纯展示。

Component({
  options: { addGlobalClass: false },

  properties: {
    /** 连续天数 */
    days: { type: Number, value: 0 },
    /** boolean[]：已达成 / 未达成 */
    dots: { type: Array, value: [] },
    /** 里程碑文案 */
    message: { type: String, value: '' }
  }
});
