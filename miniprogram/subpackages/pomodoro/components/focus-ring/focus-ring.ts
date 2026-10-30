// components/focus-ring/focus-ring.ts
// 成长进度环：Canvas 2D 绘制「外圈进度环 + 刻度带 + 环内山峰剪影 + 末端光点」。
//
// 为什么不用 SVG：需求建议 SVG Circle，但小程序 WXML 不支持内联 <svg>
//   （<image> 只能加载 .svg 文件，不能内联渲染）；CSS 也画不出按角度填充的弧
//   （border 只能整圆、conic-gradient 在 Skyline 不支持）。
//   Canvas 2D 能精确控制 dashoffset / lineCap / 渐变 / 端点辉光，是等价且更可控的方案，
//   本项目 love-core、astro-sphere 同为 Canvas 2D，模式一致。
//
// 对外契约：
//   properties : progress(0~1) / mode / running / reduced / pulse / size
//   events     : ready（首帧就绪，页面据此做入场）
//
// 性能约定（对齐需求十）：
//   · dpr 上限 2（更高只会白烧 GPU，视觉无收益）；
//   · **不跑常驻 rAF**：只在 progress / mode 变化时重绘，即每秒最多一帧；
//     呼吸感交给 CSS transform（GPU 合成，不触发 canvas 重绘）；
//   · 完成时光环扩散也交给 CSS，canvas 零成本。

// 存在 Component 之外还需显式导出：组件 TS 若不含 import/export 会被编译器当全局脚本，
// 其内的 type 声明会泄漏到全局，与 todo-glyph.ts 的同名 type 撞出 TS2300。
export {};

const TAU = Math.PI * 2;
type Ctx = WechatMiniprogram.CanvasRenderingContext;

/** 各模式配色：低饱和蓝灰体系；休息模式用同族降饱和变体（需求二十） */
const PALETTE: Record<string, { a: string; b: string; track: string; dot: string }> = {
  focus: { a: '#7188D1', b: '#8EA6E8', track: '#E3EAF5', dot: '104,140,230' },
  short: { a: '#6FA78C', b: '#9AC7B2', track: '#E4EEE9', dot: '96,160,132' },
  long: { a: '#6E7FB0', b: '#9AA8CE', track: '#E5E8F1', dot: '100,116,176' }
};

/** 山脊折线 [x 比例, 高度比例]，高度 0 = 贴底；两排叠出层次 */
const RIDGE_BACK = [
  [0.0, 0.2], [0.13, 0.44], [0.29, 0.27], [0.45, 0.55],
  [0.61, 0.31], [0.79, 0.48], [1.0, 0.24]
];
const RIDGE_FRONT = [
  [0.0, 0.09], [0.17, 0.33], [0.33, 0.15], [0.51, 0.47],
  [0.67, 0.21], [0.84, 0.37], [1.0, 0.13]
];

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 在折线上按 x 线性插值取高度 */
function ridgeAt(pts: number[][], x: number): number {
  const last = pts[pts.length - 1];
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return last[1];
}

/** #RRGGBB + alpha → rgba() */
function hexA(hex: string, a: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.round(a * 1000) / 1000 + ')';
}

/** 画一排山脊：峰与峰之间用**直线**相连，峰顶成尖角（山形） */
function drawRidge(
  ctx: Ctx,
  cx: number,
  baseY: number,
  hMax: number,
  rIn: number,
  pts: number[][],
  alpha: number
): void {
  if (alpha <= 0.005) return;
  const left = cx - rIn * 1.05;
  const width = rIn * 2.1;
  ctx.beginPath();
  ctx.moveTo(left, baseY);
  for (let i = 0; i < pts.length; i++) {
    ctx.lineTo(left + pts[i][0] * width, baseY - pts[i][1] * hMax);
  }
  ctx.lineTo(left + width, baseY);
  ctx.closePath();
  ctx.fillStyle = hexA('#60749E', alpha);
  ctx.fill();
}

Component({
  options: { addGlobalClass: false },

  properties: {
    /** 进度 0~1（需求二十四：1 - remainingSeconds / totalSeconds） */
    progress: { type: Number, value: 0 },
    /** focus | short | long */
    mode: { type: String, value: 'focus' },
    /** 计时中：点亮刻度 + 允许呼吸 */
    running: { type: Boolean, value: false },
    /** 减弱动效（小程序不支持 prefers-reduced-motion，由页面探测后下发） */
    reduced: { type: Boolean, value: false },
    /** 完成一轮：触发一次光环扩散 */
    pulse: { type: Boolean, value: false },
    /** 环直径（rpx）。需求 250px → 500rpx */
    size: { type: Number, value: 500 }
  },

  /* —— 实例字段（非响应式） —— */
  ctx: null as Ctx | null,
  cssW: 0,
  cssH: 0,
  inited: false,

  observers: {
    /** 数据可能早于 canvas 就绪到达；init 完成后会补一次 draw，所以两边都要能触发 */
    'progress, mode': function onProgressOrMode() {
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
    // 页面重新可见：尺寸可能因旋转/分屏变化，重建一次最稳
    show() {
      if (this.ctx) this.draw();
    }
  },

  methods: {
    initCanvas() {
      wx.createSelectorQuery()
        .in(this)
        .select('#ringCv')
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node) return; // 拿不到节点就静默降级，页面其余部分照常
          const canvas = item.node;
          const ctx = canvas.getContext('2d') as Ctx;
          const cssW = item.width || 250;
          const cssH = item.height || cssW;
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          // dpr 上限 2：高密度屏再往上没有视觉收益，只增加填充率
          const dpr = Math.min(2, info.pixelRatio || 1);
          canvas.width = Math.round(cssW * dpr);
          canvas.height = Math.round(cssH * dpr);
          ctx.scale(dpr, dpr);
          this.ctx = ctx;
          this.cssW = cssW;
          this.cssH = cssH;
          this.inited = true;
          this.draw();
          this.triggerEvent('ready');
        });
    },

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const w = this.cssW;
      const h = this.cssH;
      const S = Math.min(w, h);
      if (S <= 0) return;
      const cx = w / 2;
      const cy = h / 2;
      const p = clamp01(this.data.progress);
      const pal = PALETTE[this.data.mode] || PALETTE.focus;
      const running = this.data.running;

      ctx.clearRect(0, 0, w, h);

      /* 1. 内盘余晖：**只在 r∈[0.42S, 0.46S] 画一圈极淡蓝白**，
         中心区（承载原生文字「🍅 / 状态 / 25:00 / 第 N 轮」的 r < 0.42S）保持**完全透明**。
         为什么必须让中心透明：小程序真机上 canvas 有可能压在中心文字之上（与浏览器
         compositing 不一致）。原先那层近乎不透明的内盘白盘（中心 alpha 0.96）会把
         中心文字整体罩白、发灰，正是「25:00 看起来很淡」的根因。
         中心透明后，无论 canvas 在上还是在下，原生文字都清晰。
         「环心不死白」的质感改由 .core__stage 的 CSS radial 背景承担（位于 canvas 与文字之下）。 */
      const disc = ctx.createRadialGradient(cx, cy, S * 0.42, cx, cy, S * 0.46);
      disc.addColorStop(0, 'rgba(233,240,252,0)');
      disc.addColorStop(1, 'rgba(226,235,250,0.5)');
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.46, 0, TAU);
      ctx.fill();

      /* 2. 刻度带：60 格，走过的点亮（对应参考图的表盘感） */
      const ringW = Math.max(6, S * 0.032);
      const rRing = S / 2 - ringW / 2 - S * 0.024;
      const rTickOut = rRing - ringW / 2 - S * 0.02;
      const tickLen = Math.max(5, S * 0.028);
      const tickW = Math.max(1, S * 0.0055);
      const TICKS = 60;
      ctx.lineCap = 'round';
      ctx.lineWidth = tickW;
      for (let i = 0; i < TICKS; i++) {
        // 从 12 点顺时针，与进度弧同起点：走过的刻度与走过的弧重合
        const ang = -Math.PI / 2 + (i / TICKS) * TAU;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const lit = i < p * TICKS;
        ctx.strokeStyle = lit ? hexA(pal.a, running ? 0.85 : 0.6) : 'rgba(150,166,190,0.32)';
        ctx.beginPath();
        ctx.moveTo(cx + cos * rTickOut, cy + sin * rTickOut);
        ctx.lineTo(cx + cos * (rTickOut - tickLen), cy + sin * (rTickOut - tickLen));
        ctx.stroke();
      }

      /* 3. 轨道环（第一层） */
      ctx.lineCap = 'round';
      ctx.lineWidth = ringW;
      ctx.strokeStyle = pal.track;
      ctx.beginPath();
      ctx.arc(cx, cy, rRing, 0, TAU);
      ctx.stroke();

      /* 4. 进度弧（第二层，渐变 + 圆头） */
      if (p > 0.0005) {
        const grad = ctx.createLinearGradient(cx - rRing, cy - rRing, cx + rRing, cy + rRing);
        grad.addColorStop(0, pal.a);
        grad.addColorStop(1, pal.b);
        ctx.strokeStyle = grad;
        ctx.lineWidth = ringW;
        ctx.beginPath();
        ctx.arc(cx, cy, rRing, -Math.PI / 2, -Math.PI / 2 + p * TAU);
        ctx.stroke();

        /* 5. 末端光点：白芯 + 蓝芯 + 外发光 → “正在不断前进” */
        const endAng = -Math.PI / 2 + p * TAU;
        const ex = cx + Math.cos(endAng) * rRing;
        const ey = cy + Math.sin(endAng) * rRing;
        const dotR = Math.max(4, S * 0.016);
        const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, dotR * 3.4);
        glow.addColorStop(0, 'rgba(' + pal.dot + ',0.55)');
        glow.addColorStop(0.45, 'rgba(' + pal.dot + ',0.18)');
        glow.addColorStop(1, 'rgba(' + pal.dot + ',0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(ex, ey, dotR * 3.4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(ex, ey, dotR, 0, TAU);
        ctx.fill();
        ctx.fillStyle = pal.b;
        ctx.beginPath();
        ctx.arc(ex, ey, dotR * 0.52, 0, TAU);
        ctx.fill();
      }

      /* 6. 环内山峰剪影：随进度「逐渐显现 + 长高」（需求九）
         高度刻意压低（hMax 取 rIn 的 0.62）：再高就会顶到中心「第 N/4 轮」那行字，
         山峰在字后面虽然好看，但压字就本末倒置了。 */
      const rIn = rTickOut - tickLen - S * 0.016;
      const baseY = cy + rIn * 0.94;
      const hMax = rIn * 0.62;
      const grow = 0.52 + 0.48 * p;   // 峰高随进度长高
      const alpha = 0.06 + 0.16 * p;  // 0% 几乎不可见 → 100% 明显
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rIn, 0, TAU);
      ctx.clip();
      ctx.save();
      ctx.translate(0, baseY);
      ctx.scale(1, grow);
      ctx.translate(0, -baseY);
      drawRidge(ctx, cx, baseY, hMax, rIn, RIDGE_BACK, alpha * 0.7);
      drawRidge(ctx, cx, baseY, hMax, rIn, RIDGE_FRONT, alpha);
      ctx.restore();
      // 攀登者：沿前排山脊随进度上移（“每完成一点，距离目标更近一步”）
      const rx = 0.14 + 0.72 * p;
      const px = cx - rIn * 1.05 + rx * rIn * 2.1;
      const py = baseY - ridgeAt(RIDGE_FRONT, rx) * hMax * grow;
      ctx.strokeStyle = hexA('#60749E', Math.min(0.5, alpha * 2.1));
      ctx.lineWidth = Math.max(1.4, S * 0.007);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - S * 0.026);
      ctx.stroke();
      ctx.fillStyle = hexA('#60749E', Math.min(0.62, alpha * 2.4));
      ctx.beginPath();
      ctx.arc(px, py - S * 0.032, Math.max(2, S * 0.009), 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
});
