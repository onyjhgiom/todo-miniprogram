// components/todo-glyph/todo-glyph.ts
// 待办清单的线性图标：Canvas 2D 绘制「太阳 / 日历 / 年历 / 分层」四枚页签图标，
// 以及行尾的展开箭头。
//
// 为什么用 Canvas 而不是图片或字体图标：
//   · 参考稿用的是内联 <svg> 描边图标，小程序 WXML **不支持内联 <svg>**，
//     <image> 只能加载 .svg 文件（且无法跟随主题色换色）；
//   · 字体图标依赖特殊字体文件，包体积大且缺字会掉成豆腐块；
//   · Canvas 2D 可以精确控制线宽、圆角端点与颜色，跟着主题走。
//     同项目 focus-ring / love-core 已是同一方案，模式一致。
//
// 性能约定（对齐 focus-ring）：
//   · dpr 上限 2（更高只白烧 GPU）；
//   · 不跑常驻 rAF，只在 data 变化时重绘 —— 图标是静态的，一帧足够。

// 存在 Component 之外还需显式导出：组件 TS 若不含 import/export 会被编译器当全局脚本，
// 其内的 type 声明会泄漏到全局，与 focus-ring.ts 的同名 type 撞出 TS2300。
export {};

type Ctx = WechatMiniprogram.CanvasRenderingContext;

/** 图标语义 → 描边路径（24×24 坐标系，与主流图标库一致） */
const PATHS: Record<string, number[][][]> = {
  // 太阳（今日）：外圈 8 根光芒 + 中心圆
  sun: [
    [[12, 5], [12, 8]],
    [[12, 16], [12, 19]],
    [[5, 12], [8, 12]],
    [[16, 12], [19, 12]],
    [[7.05, 7.05], [9.2, 9.2]],
    [[14.8, 14.8], [16.95, 16.95]],
    [[7.05, 16.95], [9.2, 14.8]],
    [[14.8, 9.2], [16.95, 7.05]]
  ],
  // 日历（本月）：外框 + 顶栏分隔 + 两个挂耳 + 三点
  month: [
    [[4, 7], [4, 19], [20, 19], [20, 7], [4, 7]],
    [[4, 11], [20, 11]],
    [[8, 4.5], [8, 7]],
    [[16, 4.5], [16, 7]],
    [[8.5, 14.5], [8.6, 14.5]],
    [[12, 14.5], [12.1, 14.5]],
    [[15.5, 14.5], [15.6, 14.5]],
    [[8.5, 17.5], [8.6, 17.5]],
    [[12, 17.5], [12.1, 17.5]]
  ],
  // 年历（本年）：日历 + 勾选
  year: [
    [[4, 7], [4, 19], [20, 19], [20, 7], [4, 7]],
    [[4, 11], [20, 11]],
    [[8, 4.5], [8, 7]],
    [[16, 4.5], [16, 7]],
    [[9, 15.5], [11, 17.5], [15.5, 12.5]]
  ],
  // 分层（全部）：三条错层横线
  all: [
    [[12, 4.5], [20.5, 9], [12, 13.5], [3.5, 9], [12, 4.5]],
    [[3.5, 12.5], [12, 17], [20.5, 12.5]],
    [[3.5, 16.2], [12, 20.7], [20.5, 16.2]]
  ]
};

/** 圆形图标：sun 的中心圆 */
const CIRCLES: Record<string, number[][]> = {
  sun: [[12, 12, 3.4]]
};

/** 实心点（用短横线 + round cap 模拟，比 0.1 长度的线段更稳） */
function drawDot(ctx: Ctx, x: number, y: number, sw: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 0.01, y);
  ctx.stroke();
  void sw;
}

Component({
  options: { addGlobalClass: false },

  properties: {
    /** sun | month | year | all */
    name: { type: String, value: 'sun' },
    /** 边长（rpx），画布自适应容器 */
    size: { type: Number, value: 48 },
    /** 描边色 */
    color: { type: String, value: '#8a8da3' },
    /** 描边宽度相对边长的比例（参考稿约 1.7/24） */
    weight: { type: Number, value: 0.07 }
  },

  /* —— 实例字段（非响应式） —— */
  ctx: null as Ctx | null,
  cssW: 0,
  cssH: 0,
  inited: false,

  observers: {
    'name, color, weight': function onChange() {
      if (this.inited) this.draw();
    }
  },

  lifetimes: {
    ready() {
      this.initCanvas();
    },
    detached() {
      this.ctx = null;
      this.inited = false;
    }
  },

  pageLifetimes: {
    show() {
      if (this.ctx) this.initCanvas();
    }
  },

  methods: {
    initCanvas() {
      wx.createSelectorQuery()
        .in(this)
        .select('#glyphCv')
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node) return; // 拿不到节点静默降级
          const canvas = item.node;
          const ctx = canvas.getContext('2d') as Ctx;
          const w = item.width || 24;
          const h = item.height || w;
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const dpr = Math.min(2, info.pixelRatio || 1);
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          // 重设尺寸会重置上下文，scale 必须在之后
          ctx.scale(dpr, dpr);
          this.ctx = ctx;
          this.cssW = w;
          this.cssH = h;
          this.inited = true;
          this.draw();
        });
    },

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const w = this.cssW;
      const h = this.cssH;
      if (w <= 0 || h <= 0) return;

      ctx.clearRect(0, 0, w, h);

      const name = this.data.name;
      const paths = PATHS[name];
      if (!paths) return;

      // 24×24 坐标映射到实际尺寸，居中
      const S = Math.min(w, h);
      const k = S / 24;
      const ox = (w - S) / 2;
      const oy = (h - S) / 2;

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(k, k);
      ctx.strokeStyle = this.data.color;
      ctx.lineWidth = Math.max(1, this.data.weight * 24);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const circles = CIRCLES[name];
      if (circles) {
        circles.forEach((c) => {
          ctx.beginPath();
          ctx.arc(c[0], c[1], c[2], 0, Math.PI * 2);
          ctx.stroke();
        });
      }

      paths.forEach((pts) => {
        // 单点路径视为「实心小点」（日历里的日期点）
        if (pts.length === 2 && Math.abs(pts[0][0] - pts[1][0]) < 0.2 && Math.abs(pts[0][1] - pts[1][1]) < 0.2) {
          drawDot(ctx, pts[0][0], pts[0][1], ctx.lineWidth);
          return;
        }
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      });

      ctx.restore();
    }
  }
});