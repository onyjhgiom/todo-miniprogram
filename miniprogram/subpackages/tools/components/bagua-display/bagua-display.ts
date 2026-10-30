// components/tools/bagua-display/bagua-display.ts
// 八卦圆盘视觉组件：图片盘面 + CSS 光环动效
//
// 职责边界（与页面解耦）：
//   · 纯视觉组件，不持有任何卦象业务数据 —— 盘面是固定的先天八卦纹样（装饰），
//     不代表任何「测算结果」，因此不存在虚构实时数据的问题。
//   · 输入只有尺寸与动效开关；页面需要不同大小/静态展示时改属性即可复用。
//   · 动效全部 CSS（transform/opacity），外环缓旋 + 中心呼吸光；reduced 可整体关闭。
interface BaguaData {
  spinning: boolean;
}

Component({
  properties: {
    /** 盘面直径（rpx） */
    size: { type: Number, value: 420 },
    /** 是否播放缓旋/呼吸动效（无障碍或省电时可关） */
    reduced: { type: Boolean, value: false },
    /** 中心呼吸光的强调色（细金） */
    glow: { type: String, value: 'rgba(230, 210, 165, 0.5)' }
  },

  data: {
    spinning: true
  } as BaguaData,

  observers: {
    reduced(v: boolean) {
      this.setData({ spinning: !v });
    }
  }
});
