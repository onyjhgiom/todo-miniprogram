// components/fx-stage/fx-stage.ts
// 电影级「舞台」背景层：给任意页面叠加体积光轴 / 环境光晕 / 浮尘微粒 / 顶部柔光。
//
// 设计原则
//   1. 纯装饰、零业务：这一层不承载任何交互（pointer-events:none），
//      只是往页面里注入「光」和「动势」，因此所有页面都能安全引入。
//   2. 性能红线：同屏常驻动画元素控制在 10 个以内，且只动 transform / opacity，
//      不触发 layout / paint，低端机也不掉帧。
//   3. 主题联动：颜色全部走 var(--*) 变量，跟随 .themed[data-theme] 自动切换明暗。
//
// 用法（已全局注册，页面无需再写 usingComponents）：
//   <view class="xx themed" data-theme="{{theme}}">
//     <fx-stage mode="aurora" />
//     <view class="xx__content">…真实内容…</view>
//   </view>
//   ⚠ 本层是 position:fixed 且 z-index:0，请把内容层设为 position:relative; z-index:1
//     （或直接复用页面里已有的 .ambient-content），否则内容会被压在氛围层之下。
Component({
  options: { multipleSlots: true },
  properties: {
    /** 氛围模式：sunset 暮色湖景｜clean 极简玻璃球｜grid 霓虹网格｜meadow 山丘｜eclipse 日食｜confetti 彩纸｜polaroid 拍立得｜leafshade 叶影｜aurora 极光｜ink 墨韵｜pixelcamp 像素｜stardust 星尘｜none 关闭 */
    mode: { type: String, value: 'aurora' },
    /** 场景图（非空时铺真实图片背景，CSS 场景块自动隐藏；如 /assets/scenes/tech.jpg） */
    src: { type: String, value: '' },
    /** 场景图是否全屏铺满（true=全屏照片；false=顶部横幅渐隐进页面底色） */
    full: { type: Boolean, value: false },
    /** 是否绘制斜向体积光轴（厅堂射光，最出「电影感」的一层） */
    rays: { type: Boolean, value: true },
    /** 是否绘制漂浮微粒 */
    dust: { type: Boolean, value: false },
    /** 整体强度 0~10；0 关闭。用来给不同页面做分寸差异 */
    level: { type: Number, value: 6 },
    /** 是否绘制顶部柔光带 */
    topglow: { type: Boolean, value: true }
  },
  data: {
    /** 微粒样式表：位置 / 大小 / 延时一次性随机好，避免每帧抖动 */
    motes: [] as string[]
  },
  lifetimes: {
    attached() {
      this.setData({ motes: this.buildMotes(9) });
    }
  },
  methods: {
    /** 生成微粒的 inline style：位置、尺寸、透明度、动画延时与周期都错开 */
    buildMotes(n: number): string[] {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const left = 4 + Math.random() * 92;
        const size = 4 + Math.round(Math.random() * 7);
        const delay = (Math.random() * 14).toFixed(1);
        const dur = (13 + Math.random() * 12).toFixed(1);
        const op = (0.18 + Math.random() * 0.4).toFixed(2);
        out.push(
          `left:${left.toFixed(1)}%;width:${size}rpx;height:${size}rpx;` +
            `opacity:${op};animation-delay:-${delay}s;animation-duration:${dur}s;`
        );
      }
      return out;
    }
  }
});
