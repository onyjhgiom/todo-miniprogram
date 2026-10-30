// components/motivation-card/motivation-card.ts
// 今日激励语（需求五）。纯展示：文案由页面按「日期 + 轮次」确定性选出后下发，
// 组件不取随机数 —— 否则每次 setData 都会换一句，反而显得廉价。

Component({
  options: { addGlobalClass: false },

  properties: {
    /** 激励语文案 */
    text: { type: String, value: '' }
  }
});
