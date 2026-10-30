// components/focus-chart/focus-chart.ts
// 专注数据图表：Canvas 2D 自绘「柱状图（近 N 天）」与「面积曲线（24 小时分布）」，
// 两种形态共用同一个 canvas，切换只重绘、不重建。
//
// 为什么不用纯 WXML view 拼：
//   · 14 根柱子要圆角 + 顶部渐变 + 「今天」高亮 + 峰值参考线，纯 view 要几十个节点仍画不出参考线；
//   · 24 小时分布要平滑曲线 + 渐变填充 + 峰值点标注，WXSS 完全做不到。
//   同分包 focus-ring 也是 Canvas 2D，dpr 上限 2、不跑常驻 rAF，模式一致。
//
// 对外契约：
//   properties : type('bar'|'area') / points([{label,value,highlight}]) / height(rpx)
//                unit(文案后缀) / accent(主色) / emptyText
//   两种形态都不抛事件 —— 图表是纯展示，不该把交互复杂度往外扩散。
//
// 性能约定（对齐 focus-ring）：
//   · dpr 上限 2（更高只白烧 GPU，视觉无收益）；
//   · 不跑常驻 rAF：只在 type / points 变化时重绘；
//   · 数据为空时画居中提示文案，不抛错、不空白。

// 存在 import 之外还需显式导出：WXML 组件 TS 若不含 import/export 会被编译器当全局脚本，
// 其内的 type 声明会泄漏到全局，与 focus-ring.ts 的同名 type 撞出 TS2300。
export {};

type ChartCtx = WechatMiniprogram.CanvasRenderingContext;

interface ChartPoint {
  label: string;
  value: number;
  /** 高亮该柱（一般是「今天」），画主色渐变；其余用淡色 */
  highlight?: boolean;
}

/** 与 focus-ring PALETTE.focus 同族，保证整页色彩一致 */
const ACCENT = '#7188D1';
const ACCENT_SOFT = '#8EA6E8';
/** 网格线 / 轴标签：低饱和蓝灰，弱化不抢数据 */
const GRID = 'rgba(150,166,190,0.18)';
const LABEL = 'rgba(107,122,148,0.9)';
const EMPTY_TX = 'rgba(120,134,160,0.75)';
const FONT = '-apple-system,"PingFang SC","Helvetica Neue",sans-serif';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 顶部两角为圆角的柱子路径（底部贴基线，保持方脚） */
function barPath(ctx: ChartCtx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, Math.max(0, h));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

/** 在图区内画水平参考线（0% / 50% / 100%），返回线条 y 坐标 */
function gridLines(ctx: ChartCtx, x0: number, y0: number, w: number, h: number): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  [0, 0.5, 1].forEach((r) => {
    const y = Math.round(y0 + h - r * h) + 0.5; // +0.5 让 1px 线不发虚
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
  });
}

/** 底部 x 轴标签：按标签实际宽度抽稀，避免文字互相压住 */
function xLabels(
  ctx: ChartCtx,
  pts: ChartPoint[],
  x0: number,
  y: number,
  w: number
): void {
  const n = pts.length;
  if (!n) return;
  ctx.font = '10px ' + FONT;
  const labelW = ctx.measureText('00:00').width;
  ctx.fillStyle = LABEL;
  ctx.textBaseline = 'top';

  // 每个标签至少要 labelW + 12 的间距才不压字；末位永远保留（代表最新数据）
  const need = labelW + 12;
  const step = Math.max(1, Math.ceil((n * need) / Math.max(1, w)));
  const slot = w / n;

  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    if (i % step !== 0 && !isLast) continue;
    // 末位与前一个保留标签太近时，跳过前一个，避免挤在一起
    if (!isLast && n - 1 - i < step * 0.6) continue;
    // 首末标签贴边时改为左/右对齐，避免被卡片裁掉
    if (i === 0) ctx.textAlign = 'left';
    else if (isLast) ctx.textAlign = 'right';
    else ctx.textAlign = 'center';
    ctx.fillText(pts[i].label, x0 + slot * (i + 0.5), y);
  }
}

Component({
  options: { addGlobalClass: false },

  properties: {
    /** bar = 近 N 天柱状；area = 24 小时面积曲线 */
    type: { type: String, value: 'bar' },
    /** [{ label, value, highlight }] */
    points: { type: Array, value: [] },
    /** 画布高（rpx）。宽度自适应容器 */
    height: { type: Number, value: 190 },
    /** 峰值标签后缀，如「分钟」「次」 */
    unit: { type: String, value: '' },
    /** 空数据提示 */
    emptyText: { type: String, value: '暂无专注数据，先完成一轮番茄吧' }
  },

  /* —— 实例字段（非响应式，避免每帧 diff） —— */
  ctx: null as ChartCtx | null,
  cssW: 0,
  cssH: 0,
  inited: false,

  observers: {
    /** 数据可能早于 canvas 就绪到达；init 末尾会补一次 draw，两边都要能触发 */
    'type, points': function onDataChange() {
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
    /** 页面重新可见：旋转/分屏后尺寸可能变，重建一次最稳 */
    show() {
      if (this.ctx) this.initCanvas();
    }
  },

  methods: {
    initCanvas() {
      wx.createSelectorQuery()
        .in(this)
        .select('#fcCv')
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node) return; // 拿不到节点静默降级，页面其余部分照常
          const canvas = item.node;
          const ctx = canvas.getContext('2d') as ChartCtx;
          const cssW = item.width || 300;
          const cssH = item.height || 120;
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const dpr = Math.min(2, info.pixelRatio || 1);
          canvas.width = Math.round(cssW * dpr);
          canvas.height = Math.round(cssH * dpr);
          // 重设 width/height 会重置上下文状态，scale 必须在之后
          ctx.scale(dpr, dpr);
          this.ctx = ctx;
          this.cssW = cssW;
          this.cssH = cssH;
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

      const pts = (this.data.points || []) as ChartPoint[];
      const max = pts.reduce((m, p) => Math.max(m, Number(p.value) || 0), 0);

      // 空数据：画居中提示，不画空坐标系（空网格比空文案更让人困惑）
      if (!pts.length || max <= 0) {
        ctx.fillStyle = EMPTY_TX;
        ctx.font = '12px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.data.emptyText, w / 2, h / 2);
        return;
      }

      const padL = 6;
      const padR = 6;
      const padT = 20; // 留给峰值标签
      const padB = 18; // 留给 x 轴标签
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      if (plotW <= 0 || plotH <= 0) return;
      const baseY = padT + plotH;

      // 峰值上限取整，避免 37 分钟画成满格显得夸张
      const top = Math.max(1, Math.ceil(max * 1.15));

      gridLines(ctx, padL, padT, plotW, plotH);

      // 峰值参考线 + 数值（放在网格线上方，弱化不抢柱子）
      ctx.fillStyle = LABEL;
      ctx.font = '10px ' + FONT;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('峰值 ' + max + this.data.unit, padL + plotW, padT - 5);

      if (this.data.type === 'area') this.drawArea(ctx, pts, padL, padT, plotW, plotH, baseY, top);
      else this.drawBar(ctx, pts, padL, padT, plotW, baseY, top);

      xLabels(ctx, pts, padL, baseY + 5, plotW);
    },

    /** 近 N 天柱状图 */
    drawBar(
      ctx: ChartCtx,
      pts: ChartPoint[],
      x0: number,
      y0: number,
      plotW: number,
      baseY: number,
      top: number
    ) {
      const n = pts.length;
      const slot = plotW / n;
      const barW = Math.max(3, Math.min(slot * 0.56, 20));
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, Number(pts[i].value) || 0);
        const cx = x0 + slot * (i + 0.5);
        if (v <= 0) {
          // 0 值不画柱，但留一个 2px 的浅色基点，让「当天没学」也可见
          ctx.fillStyle = 'rgba(150,166,190,0.28)';
          ctx.beginPath();
          ctx.arc(cx, baseY - 1, 1.5, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const bh = Math.max(3, (v / top) * (baseY - y0));
        const y = baseY - bh;
        if (pts[i].highlight) {
          const g = ctx.createLinearGradient(0, y, 0, baseY);
          g.addColorStop(0, ACCENT);
          g.addColorStop(1, ACCENT_SOFT);
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = 'rgba(113,136,209,0.34)';
        }
        barPath(ctx, cx - barW / 2, y, barW, bh, Math.min(5, barW / 2));
        ctx.fill();
      }
    },

    /** 24 小时分布面积曲线（中点贝塞尔平滑 + 渐变填充 + 峰值点标注） */
    drawArea(
      ctx: ChartCtx,
      pts: ChartPoint[],
      x0: number,
      y0: number,
      plotW: number,
      plotH: number,
      baseY: number,
      top: number
    ) {
      const n = pts.length;
      const step = n > 1 ? plotW / (n - 1) : plotW;
      const px: number[] = [];
      const py: number[] = [];
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, Number(pts[i].value) || 0);
        px.push(x0 + step * i);
        py.push(baseY - (v / top) * plotH);
      }

      // 渐变填充（曲线下方）
      const fill = ctx.createLinearGradient(0, y0, 0, baseY);
      fill.addColorStop(0, 'rgba(113,136,209,0.34)');
      fill.addColorStop(1, 'rgba(113,136,209,0.03)');
      ctx.beginPath();
      ctx.moveTo(px[0], baseY);
      ctx.lineTo(px[0], py[0]);
      for (let i = 1; i < n; i++) {
        // 用相邻两点的中点作贝塞尔控制点，得到平滑而非折线的走势
        const mx = (px[i - 1] + px[i]) / 2;
        ctx.bezierCurveTo(mx, py[i - 1], mx, py[i], px[i], py[i]);
      }
      ctx.lineTo(px[n - 1], baseY);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // 曲线本体
      ctx.beginPath();
      ctx.moveTo(px[0], py[0]);
      for (let i = 1; i < n; i++) {
        const mx = (px[i - 1] + px[i]) / 2;
        ctx.bezierCurveTo(mx, py[i - 1], mx, py[i], px[i], py[i]);
      }
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 峰值点：白芯 + 主色环 + 顶端数值，一眼看出「几点最投入」
      let pi = 0;
      for (let i = 1; i < n; i++) {
        if ((Number(pts[i].value) || 0) > (Number(pts[pi].value) || 0)) pi = i;
      }
      if ((Number(pts[pi].value) || 0) > 0) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(px[pi], py[pi], 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.arc(px[pi], py[pi], 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = LABEL;
        ctx.font = '10px ' + FONT;
        ctx.textBaseline = 'bottom';
        // 峰值靠边时把标签翻到另一侧，防止溢出卡片
        const nearLeft = px[pi] < x0 + plotW * 0.22;
        const nearRight = px[pi] > x0 + plotW * 0.78;
        ctx.textAlign = nearLeft ? 'left' : nearRight ? 'right' : 'center';
        ctx.fillText(pts[pi].label, clamp(px[pi], x0 + 16, x0 + plotW - 16), py[pi] - 7);
      }
    }
  }
});