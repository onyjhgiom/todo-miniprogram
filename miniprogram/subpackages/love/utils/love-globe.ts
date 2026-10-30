// utils/love-globe.ts
// 回忆星球 · 真 3D 交互渲染（Canvas 2D，零 WebGL 依赖）
//
// 视觉（2026-10 升级）：深空星空 + 星尘视差粒子 + 玻璃折射球体（菲涅尔边缘光 / 镜面高光 /
// 体积 bloom）+ 环绕光带 + 呼吸辉光 + 记忆碎片卡片。
// 交互：单指拖拽旋转（松手带惯性衰减）、双指捏合 / 滚轮缩放、轻点星球弹回忆详情、
//       可选陀螺仪微视差（手机轻微倾斜时球体有立体浮动感）。
//
// 为什么不用 WebGL / three.js：
//   主包与分包都有体积红线，three.js 压缩后仍数百 KB；而本场景元素有限（球面节点 + 粒子），
//   用 Canvas 2D 手动做球面投影 + 深度排序完全够用，且 iOS / Android / 开发者工具表现一致。

export interface GlobeItem {
  id: string;
  emoji: string;
  /** 记忆卡片主调（调用方按标签给色；缺省用星球主色） */
  tint?: string;
}

interface P3 { x: number; y: number; z: number; }
type RGB = [number, number, number];

interface Projected {
  id: string;
  emoji: string;
  tint: string;
  sx: number;
  sy: number;
  scale: number;   // 含纵深的大小系数
  depth: number;   // 0(后) ~ 1(前)
}

interface Star { x: number; y: number; r: number; ph: number; sp: number; a: number; }
interface Heart { x: number; y: number; ph: number; sp: number; sz: number; a: number; }
interface Bokeh { x: number; y: number; r: number; a: number; }

/* ============================ 颜色工具 ============================ */

function hexToRgb(hex: string): RGB {
  let h = (hex || '#FF7F9C').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
function shade(c: RGB, k: number): RGB {
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}
/** 圆角矩形路径（不依赖 ctx.roundRect，兼容性更稳） */
function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ============================ 主体 ============================ */

export class LoveGlobe {
  private canvas: any;
  private ctx: any;
  private dpr = 1;
  private w = 300;
  private h = 300;
  private raf = 0;

  private items: GlobeItem[] = [];
  private base: P3[] = [];
  private yaw = -0.5;
  private pitch = 0.16;
  private velYaw = 0;      // 惯性角速度
  private velPitch = 0;
  private zoom = 1;
  private autoSpeed = 0.0026;
  private dragging = false;
  private pinching = false;
  private lastX = 0;
  private lastY = 0;
  private lastDist = 0;
  private movedDist = 0;

  private primary = '#FF7F9C';
  private accent = '#FFC77D';
  private rgb: RGB = [255, 127, 156];
  private rgbA: RGB = [255, 199, 125];

  private hoverId = '';
  private selectedId = '';
  private projected: Projected[] = [];
  private t = 0;

  private stars: Star[] = [];
  private dust: P3[] = [];
  private hearts: Heart[] = [];
  private bokeh: Bokeh[] = [];
  private spaceGrad: any = null;
  private bokehGrad: any[] = [];

  private tiltX = 0;
  private tiltY = 0;

  private onSelect: (id: string) => void = () => {};

  constructor(canvas: any, onSelect?: (id: string) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (onSelect) this.onSelect = onSelect;
    this.seedScene();
  }

  /** 场景元素只在构造时生成一次：随机位置固定下来，避免每帧抖动 / 闪烁 */
  private seedScene() {
    const rand = (n: number) => Math.random() * n;
    this.stars = [];
    for (let i = 0; i < 44; i++) {
      this.stars.push({
        x: rand(1), y: rand(1), r: 0.5 + rand(1.4),
        ph: rand(Math.PI * 2), sp: 0.015 + rand(0.03), a: 0.35 + rand(0.6)
      });
    }
    this.dust = fibonacci(48);
    this.hearts = [];
    for (let i = 0; i < 6; i++) {
      this.hearts.push({
        x: 0.1 + rand(0.8), y: rand(1), ph: rand(Math.PI * 2),
        sp: 0.0006 + rand(0.0011), sz: 11 + rand(9), a: 0.2 + rand(0.4)
      });
    }
    this.bokeh = [];
    for (let i = 0; i < 4; i++) {
      this.bokeh.push({ x: rand(1), y: rand(1), r: 26 + rand(46), a: 0.05 + rand(0.06) });
    }
  }

  setPrimary(hex: string) {
    this.primary = hex || '#FF7F9C';
    this.rgb = hexToRgb(this.primary);
    this.spaceGrad = null;
    this.bokehGrad = [];
  }
  setAccent(hex: string) {
    this.accent = hex || '#FFC77D';
    this.rgbA = hexToRgb(this.accent);
    this.spaceGrad = null;
    this.bokehGrad = [];
  }

  /** 设定画布像素尺寸（CSS 尺寸 * dpr）。用 setTransform 保证重复调用不叠加缩放 */
  resize(wCss: number, hCss: number, dpr: number) {
    this.w = Math.max(1, wCss);
    this.h = Math.max(1, hCss);
    this.dpr = dpr || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (this.ctx && this.ctx.setTransform) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.spaceGrad = null;
    this.bokehGrad = [];
  }

  setItems(items: GlobeItem[]) {
    this.items = items;
    this.base = fibonacci(items.length);
    if (this.selectedId && !items.some((i) => i.id === this.selectedId)) this.selectedId = '';
  }

  setSelected(id: string) { this.selectedId = id; }

  /** 滚轮缩放（PC / 开发者工具），delta<0 放大 */
  zoomBy(delta: number) {
    this.zoom = clamp(this.zoom * (delta < 0 ? 1.08 : 0.93), 0.55, 2.4);
  }

  /** 陀螺仪微视差：手机轻微倾斜时，球体整体有立体浮动感 */
  onDeviceMotion(e: any) {
    if (!e) return;
    if (typeof e.gamma === 'number') this.tiltX = clamp(e.gamma / 55, -1, 1);
    if (typeof e.beta === 'number') this.tiltY = clamp((e.beta - 40) / 55, -1, 1);
  }

  start() {
    const loop = () => {
      this.render();
      this.raf = this.canvas.requestAnimationFrame(loop);
    };
    this.raf = this.canvas.requestAnimationFrame(loop);
  }
  stop() {
    if (this.raf && this.canvas.cancelAnimationFrame) this.canvas.cancelAnimationFrame(this.raf);
  }

  /* ====================== 触摸交互 ====================== */

  onTouchStart(e: any) {
    const ts = e.touches || [];
    if (ts.length >= 2) {
      this.pinching = true;
      this.lastDist = dist2(ts[0], ts[1]);
    } else if (ts.length === 1) {
      this.dragging = true;
      this.lastX = ts[0].x;
      this.lastY = ts[0].y;
      this.movedDist = 0;
      this.velYaw = 0;
      this.velPitch = 0;
      this.hoverId = this.pick(ts[0].x, ts[0].y);
    }
  }

  onTouchMove(e: any) {
    const ts = e.touches || [];
    if (this.pinching && ts.length >= 2) {
      const d = dist2(ts[0], ts[1]);
      if (this.lastDist > 0) this.zoom = clamp(this.zoom * (d / this.lastDist), 0.55, 2.4);
      this.lastDist = d;
      return;
    }
    if (this.dragging && ts.length === 1) {
      const dx = ts[0].x - this.lastX;
      const dy = ts[0].y - this.lastY;
      this.lastX = ts[0].x;
      this.lastY = ts[0].y;
      this.movedDist += Math.abs(dx) + Math.abs(dy);
      this.yaw += dx * 0.008;
      this.pitch = clamp(this.pitch + dy * 0.006, -1.2, 1.2);
      // 记录瞬时角速度 → 松手后惯性继续转（见 render 的衰减）
      this.velYaw = dx * 0.008;
      this.velPitch = dy * 0.006 * 0.6;
      this.hoverId = this.pick(ts[0].x, ts[0].y);
    }
  }

  onTouchEnd(e: any) {
    const ts = e.touches || [];
    if (ts.length === 0) {
      this.pinching = false;
      // 单指轻点（没有明显拖动）= 选中最近星球
      if (this.dragging && this.movedDist < 9) {
        const id = this.pick(this.lastX, this.lastY);
        if (id) {
          this.selectedId = id;
          this.onSelect(id);
        }
      }
      this.dragging = false;
      this.hoverId = '';
    } else if (ts.length === 1) {
      // 从双指退回单指
      this.pinching = false;
      this.lastX = ts[0].x;
      this.lastY = ts[0].y;
      this.lastDist = 0;
    }
  }

  /** 开发者工具鼠标悬停（PC 端） */
  onHover(x: number, y: number) {
    this.hoverId = this.pick(x, y);
  }

  /* ====================== 渲染 ====================== */

  private render() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.t += 1;

    // 惯性 + 缓慢自转；松手后角速度指数衰减，并缓慢把俯仰角回正
    if (!this.dragging && !this.pinching) {
      this.yaw += this.autoSpeed + this.velYaw;
      this.velYaw *= 0.94;
      if (Math.abs(this.velYaw) < 0.00035) this.velYaw = 0;

      this.pitch += this.velPitch;
      this.velPitch *= 0.90;
      if (Math.abs(this.velPitch) < 0.0002) this.velPitch = 0;
      this.pitch += (0.16 - this.pitch) * 0.008;
      this.pitch = clamp(this.pitch, -1.2, 1.2);
    }

    const cx = this.w / 2 + this.tiltX * 6;
    const cy = this.h / 2 + this.tiltY * 5;
    const R = Math.min(this.w * 0.42, this.h * 0.44) * this.zoom;
    const breath = 1 + Math.sin(this.t * 0.022) * 0.022;

    this.drawSpace(cx, cy, R);
    this.drawRings(cx, cy, R, false);        // 后半环（在球体之后）
    this.drawCore(cx, cy, R);                // 球心爱心（球体内部）
    this.drawOrbBase(cx, cy, R * breath);    // 球体内部薄雾

    const pts = this.project(cx, cy, R);
    for (const p of pts) this.drawNode(p);   // 记忆碎片（按深度从后到前）

    this.drawOrbFront(cx, cy, R * breath);   // 玻璃前表面：折射 / 菲涅尔 / 镜面 / bloom
    this.drawRings(cx, cy, R, true);         // 前半环（在球体之前）
    this.drawHearts();
  }

  /** 深空背景：渐变星空 + 星云辉光 + 柔焦光斑 + 闪烁星点 + 星尘视差 */
  private drawSpace(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    if (!this.spaceGrad) {
      const top = mix(this.rgb, [7, 9, 28], 0.74);
      const bot = mix(this.rgbA, [18, 10, 42], 0.82);
      const g = ctx.createLinearGradient(0, 0, this.w * 0.35, this.h);
      g.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
      g.addColorStop(0.45, '#0A0A26');
      g.addColorStop(1, `rgb(${bot[0]},${bot[1]},${bot[2]})`);
      this.spaceGrad = g;
    }
    ctx.fillStyle = this.spaceGrad;
    ctx.fillRect(0, 0, this.w, this.h);

    // 球体后方的星云辉光
    const neb = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 2.3);
    neb.addColorStop(0, rgba(this.rgb, 0.26));
    neb.addColorStop(0.45, rgba(this.rgbA, 0.11));
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, this.w, this.h);

    // 柔焦光斑（景深）：渐变对象按位置缓存，避免每帧重建（低端机关键优化）
    if (!this.bokehGrad.length) {
      this.bokehGrad = this.bokeh.map((bk) => {
        const x = bk.x * this.w;
        const y = bk.y * this.h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, bk.r);
        g.addColorStop(0, rgba(this.rgbA, bk.a));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        return { x, y, r: bk.r, g };
      });
    }
    for (const bg of this.bokehGrad) {
      ctx.fillStyle = bg.g;
      ctx.beginPath();
      ctx.arc(bg.x, bg.y, bg.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 闪烁星点
    ctx.fillStyle = '#ffffff';
    for (const st of this.stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.t * st.sp + st.ph));
      ctx.globalAlpha = st.a * tw;
      ctx.beginPath();
      ctx.arc(st.x * this.w, st.y * this.h, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.drawDust(cx, cy, R);
  }

  /** 星尘：3D 球面分布，绕球更慢地漂移 → 天然视差与纵深感 */
  private drawDust(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    for (let i = 0; i < this.dust.length; i++) {
      const r3 = rotateY(rotateX(this.dust[i], this.pitch * 0.6), this.yaw * 0.5);
      const depth = (r3.z + 1) / 2;
      const rr = R * 1.55 * (1 / (1.7 - r3.z * 0.5));
      const x = cx + r3.x * rr;
      const y = cy - r3.y * rr;
      const sz = 0.7 + depth * 1.9;
      ctx.globalAlpha = 0.08 + depth * 0.5;
      ctx.fillStyle = i % 4 === 0 ? rgba(this.rgbA, 1) : 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** 环绕光带：三条倾斜椭圆环，前半段画在球体前、后半段画在球体后 */
  private drawRings(cx: number, cy: number, R: number, front: boolean) {
    const ctx = this.ctx;
    const rings = [
      { rx: R * 1.30, ry: R * 0.28, rot: -0.34, sp: 1.0, col: this.rgb, a: front ? 0.34 : 0.15 },
      { rx: R * 1.12, ry: R * 0.21, rot: 0.52, sp: -1.35, col: this.rgbA, a: front ? 0.26 : 0.11 },
      { rx: R * 1.44, ry: R * 0.36, rot: -0.12, sp: 0.72, col: this.rgb, a: front ? 0.17 : 0.09 }
    ];
    ctx.save();
    ctx.translate(cx, cy);
    for (const rg of rings) {
      ctx.save();
      ctx.rotate(rg.rot + this.t * 0.0016 * rg.sp);
      ctx.strokeStyle = rgba(rg.col, rg.a);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (front) ctx.ellipse(0, 0, rg.rx, rg.ry, 0, 0, Math.PI);
      else ctx.ellipse(0, 0, rg.rx, rg.ry, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /** 球心爱心：呼吸辉光 + 玻璃球核 */
  private drawCore(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const br = 0.92 + Math.sin(this.t * 0.03) * 0.08;
    const r = R * 0.30 * br;

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.8);
    g.addColorStop(0, rgba(this.rgb, 0.55));
    g.addColorStop(0.4, rgba(this.rgbA, 0.20));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.8, 0, Math.PI * 2);
    ctx.fill();

    const dark = shade(this.rgb, 0.55);
    const sg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.08, cx, cy, r);
    sg.addColorStop(0, 'rgba(255,255,255,0.95)');
    sg.addColorStop(0.35, rgba(this.rgb, 0.92));
    sg.addColorStop(1, rgba(dark, 0.88));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `${Math.round(r * 1.15)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💗', cx, cy + 1);
  }

  /** 球体内部薄雾（在碎片之后、玻璃前表面之前的透明底） */
  private drawOrbBase(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    g.addColorStop(0, rgba(this.rgb, 0.09));
    g.addColorStop(0.65, 'rgba(255,255,255,0.045)');
    g.addColorStop(1, 'rgba(255,255,255,0.015)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 玻璃前表面：体积 bloom + 菲涅尔边缘光 + 镜面高光 + 右下反光 + 高光点 */
  private drawOrbFront(cx: number, cy: number, R: number) {
    const ctx = this.ctx;

    const bloom = ctx.createRadialGradient(cx, cy, R * 0.84, cx, cy, R * 1.5);
    bloom.addColorStop(0, rgba(this.rgb, 0.26));
    bloom.addColorStop(0.5, rgba(this.rgbA, 0.10));
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 菲涅尔：中心透明，越靠边越亮
    const rim = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(0.60, rgba(this.rgb, 0.08));
    rim.addColorStop(0.86, 'rgba(255,255,255,0.34)');
    rim.addColorStop(1, rgba(this.rgb, 0.55));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 玻璃反射只出现在球内
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    const spec = ctx.createRadialGradient(
      cx - R * 0.40, cy - R * 0.44, 0, cx - R * 0.40, cy - R * 0.44, R * 0.66
    );
    spec.addColorStop(0, 'rgba(255,255,255,0.60)');
    spec.addColorStop(0.35, 'rgba(255,255,255,0.14)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    const refl = ctx.createRadialGradient(
      cx + R * 0.48, cy + R * 0.50, 0, cx + R * 0.48, cy + R * 0.50, R * 0.55
    );
    refl.addColorStop(0, rgba(this.rgbA, 0.30));
    refl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = refl;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx - R * 0.44, cy - R * 0.48, R * 0.10, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 记忆碎片卡片：圆角玻璃卡 + 外发光 + 逐深度缩放/透明度（近清晰远柔和） */
  private drawNode(p: Projected) {
    const ctx = this.ctx;
    const isSel = p.id === this.selectedId;
    const isHover = p.id === this.hoverId;
    const s = 30 * p.scale * ((isSel || isHover) ? 1.24 : 1);
    const tint = hexToRgb(p.tint);
    const x = p.sx;
    const y = p.sy;

    ctx.save();
    ctx.globalAlpha = 0.32 + p.depth * 0.68;

    if (p.depth > 0.44) {
      const g = ctx.createRadialGradient(x, y, s * 0.25, x, y, s * 1.75);
      g.addColorStop(0, rgba(tint, 0.5));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, s * 1.75, 0, Math.PI * 2);
      ctx.fill();
    }

    const w = s * 1.28;
    const h = s * 1.06;
    const rx = x - w / 2;
    const ry = y - h / 2;
    const rad = s * 0.36;

    roundRect(ctx, rx, ry, w, h, rad);
    const cg = ctx.createLinearGradient(rx, ry, rx + w, ry + h);
    cg.addColorStop(0, 'rgba(255,255,255,0.94)');
    cg.addColorStop(0.42, rgba(tint, 0.88));
    cg.addColorStop(1, rgba(shade(tint, 0.6), 0.92));
    ctx.fillStyle = cg;
    ctx.fill();

    ctx.lineWidth = Math.max(0.8, s * 0.055);
    ctx.strokeStyle = `rgba(255,255,255,${0.45 + p.depth * 0.45})`;
    ctx.stroke();

    if (p.depth > 0.4) {
      ctx.save();
      roundRect(ctx, rx, ry, w, h, rad);
      ctx.clip();
      const hl = ctx.createLinearGradient(rx, ry, rx, ry + h * 0.62);
      hl.addColorStop(0, 'rgba(255,255,255,0.8)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.fillRect(rx, ry, w, h * 0.62);
      ctx.restore();
    }

    ctx.font = `${Math.round(s * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, x, y + 1);

    if (isSel) {
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 2;
      roundRect(ctx, rx - 4, ry - 4, w + 8, h + 8, rad + 3);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** 漂浮小爱心（前景点缀） */
  private drawHearts() {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const hp of this.hearts) {
      hp.y -= hp.sp;
      if (hp.y < -0.08) {
        hp.y = 1.08;
        hp.x = 0.1 + Math.random() * 0.8;
      }
      const x = (hp.x + Math.sin(this.t * 0.02 + hp.ph) * 0.018) * this.w;
      const y = hp.y * this.h;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.t * 0.028 + hp.ph));
      ctx.globalAlpha = hp.a * tw;
      ctx.font = `${Math.round(hp.sz)}px sans-serif`;
      ctx.fillText('💗', x, y);
    }
    ctx.globalAlpha = 1;
  }

  /** 球面投影：绕 X/Y 旋转 + 透视缩放开近大远小，并按深度排序 */
  private project(cx: number, cy: number, R: number): Projected[] {
    const out: Projected[] = [];
    const n = this.base.length;
    const yaw = this.yaw + this.tiltX * 0.12;
    const pitch = this.pitch + this.tiltY * 0.10;
    for (let i = 0; i < n; i++) {
      const r3 = rotateY(rotateX(this.base[i], pitch), yaw);
      const depth = (r3.z + 1) / 2;
      const persp = 1 / (1.65 - r3.z * 0.55);
      const rr = R * 0.98 * persp;
      const item = this.items[i];
      out.push({
        id: item.id,
        emoji: item.emoji,
        tint: item.tint || this.primary,
        sx: cx + r3.x * rr,
        sy: cy - r3.y * rr,
        scale: 0.5 + depth * 0.8,
        depth
      });
    }
    out.sort((a, b) => a.depth - b.depth);
    this.projected = out;
    return out;
  }

  private pick(x: number, y: number): string {
    let best = '';
    let bestD = 9999;
    for (const p of this.projected) {
      const d = Math.hypot(p.sx - x, p.sy - y);
      const hitR = 30 * p.scale * 0.9 + 8;
      if (d < hitR && d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    return best;
  }
}

/* ====================== 数学 ====================== */

function fibonacci(n: number): P3[] {
  if (n <= 0) return [];
  if (n === 1) return [{ x: 0, y: 0, z: 1 }];
  const out: P3[] = [];
  const gold = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = gold * i;
    out.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r });
  }
  return out;
}

function rotateX(p: P3, a: number): P3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}
function rotateY(p: P3, a: number): P3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function dist2(a: any, b: any): number {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}
