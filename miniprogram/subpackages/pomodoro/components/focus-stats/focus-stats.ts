// components/focus-stats/focus-stats.ts
// 学习数据四联卡（需求十七）：今日完成 / 今日专注 / 连续坚持 / 累计完成。
// 纯展示：数字与标签由页面下发，组件不读 store —— 保持「视图薄、数据厚」。

Component({
  options: { addGlobalClass: false },

  properties: {
    /** [{ icon, value, unit, label }] */
    items: { type: Array, value: [] }
  }
});
