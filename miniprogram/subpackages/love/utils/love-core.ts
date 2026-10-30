// utils/love-core.ts
// 爱遇小栈 · 3D 爱情水晶球引擎（Canvas 2D 伪 3D 空间渲染）
//
// 为什么是 Canvas 而不是纯 CSS：
//   1) 三条倾斜轨道要做真实的 3D 遮挡（远半环在球后、近半环在球前），
//      CSS 的 rotate3d 在 WebView / Skyline 上表现不一致，也无法按深度排序；
//   2) 拖动球体要每帧改旋转角 —— CSS 方案每帧 setData 必然掉帧；
//   3) 粒子要按 z 做景深（大小 / 明暗），Canvas 一次遍历就够。
//
// 渲染顺序（画家算法，由远及近）：
//   近场辉光 → 远景粒子 → 轨道远半环 → 光基座 → 玻璃后壁 → 水晶爱心
//   → 玻璃前壁（高光 / 折射边 / 焦散） → 轨道近半环 → 近景粒子 → 脉冲波纹
//
// 性能约定（与项目既有 Canvas 组件一致）：
//   · dpr 上限 1.5，绝不 3x 铺满像素；
//   · 粒子数按机型性能档位取 22 / 46 / 74，低端机自动降档；
//   · 页面不可见时 setPaused(true) 直接停 rAF，回来再启；
//   · 辉光一律用 radial-gradient 画，不用 shadowBlur（低端机极慢）；
//   · 静态渐变对象缓存复用，destroy() 断开 canvas 引用并清定时器。
//
// 【边界】纯渲染层：不读不写任何业务数据，能量数字由页面自己算。
//
// 【视觉风格】配色 / 粒子 / 轨道 / 光效 / 动效节奏全部由 love-core-themes.ts 的
// CoreTheme 提供，本引擎只认数值不认风格名 —— 新增风格不用改这里一行代码。

import { getCoreTheme, DEFAULT_CORE_THEME } from './love-core-themes';
import type { CoreTheme } from './love-core-themes';

const TAU = Math.PI * 2;
/** 每条轨道环的细分段数：72 段足以骗过眼睛，再多只是白烧 GPU */
const SEG = 72;

export interface LoveCoreOpts {
  /** 判定为「点击球体」（而非拖动）时回调，页面据此做能量脉冲反馈 */
  onPulse?: () => void;
}

interface P3 {
  x: number;
  y: number;
  z: number;
  /** 透视缩放系数：越大越近 */
  s: number;
}

interface Particle {
  /** 到球心的半径（单位：球半径 R） */
  r: number;
  /** 绕轴角 */
  th: number;
  /** 极角 */
  ph: number;
  /** 自转速度 rad/s */
  spin: number;
  /** 基础像素大小 */
  size: number;
  /** 闪烁相位 */
  tw: number;
  /** 1 = 记忆节点（更亮更大） */
  kind: number;
}

interface Ring {
  /** 绕 X 轴倾角（rad） */
  tiltA: number;
  /** 绕 Z 轴倾角（rad） */
  tiltB: number;
  /** 环半径（单位：R） */
  radius: number;
  /** 当前相位 */
  spin: number;
  /** 相位角速度 rad/s */
  speed: number;
  /** 0 粉紫 / 1 淡蓝 / 2 银白 / >=3 自定义色（用 color 字段） */
  hue: number;
  /** hue >= 3 时的自定义环色 */
  color?: string;
  /** 线宽（相对 R） */
  width: number;
}

export class LoveCore {
  private cv: any;
  private ctx: any;
  private opts: LoveCoreOpts;

  /* —— 画布几何 —— */
  private W = 0;
  private H = 0;
  private dpr = 1;
  private cx = 0;
  private cy = 0;
  /** 球体半径（css px） */
  private R = 60;
  /** 透视焦距（css px），越大透视越弱 */
  private f = 300;

  /* —— 相机姿态 —— */
  private rotX = -0.15;
  private rotY = 0.6;
  private velY = 0;
  private spin = 0.055;
  private t = 0;
  private last = 0;
  private raf: any = 0;

  private running = false;
  private paused = false;
  private reduced = false;

  private parts: Particle[] = [];
  private rings: Ring[] = [];
  /** 实际参与绘制的轨道环数（由等级决定 1~3） */
  private ringCount = 3;
  private tier = 1;

  private primary = '#C084FC';
  private accent = '#F5A7D7';
  /** 心跳能量核高光色（风格可覆盖） */
  private sparkColor = '#FFFFFF';
  /** 玻璃后壁通透色 */
  private shellColor = 'rgba(214,200,255,0.10)';
  /** 当前视觉风格（配色 / 粒子 / 轨道 / 动效节奏的差异化来源） */
  private theme: CoreTheme = getCoreTheme(DEFAULT_CORE_THEME);
  /** 辉光半径倍率与强度（风格可覆盖） */
  private haloScale = 2.05;
  private haloPower = 0.34;
  /** 粒子闪烁频率 / 自转速度 / 亮星占比 / 底座光环转速（风格可覆盖） */
  private twinkleRate = 1.7;
  private particleSpinK = 1.0;
  private starRatio = 0.12;
  private baseSpinK = 0.5;
  /** 悬浮周期与心跳频率（风格可覆盖） */
  private floatDur = 6.2;
  private beatRate = 2.9;

  /** 脉冲进度：<0 表示未在播放 */
  private pulseT = -1;
  private pulseDur = 0.95;

  /* —— 拖动 —— */
  private drag = false;
  private lastX = 0;
  private lastY = 0;
  private moveAcc = 0;
  private downTs = 0;

  /** 静态渐变缓存（resize / 换色时失效重建） */
  private gc: any = null;

  /* —— 投影结果复用：轨道每帧要算 3×73 个点，绝不每帧 new 对象 —— */
  private tmp = { x: 0, y: 0, z: 0, s: 0 };
  private tmp2 = { x: 0, y: 0, z: 0, s: 0 };
  private rx = new Float32Array(SEG + 1);
  private ry = new Float32Array(SEG + 1);
  private rz = new Float32Array(SEG + 1);
  private rs = new Float32Array(SEG + 1);

  constructor(canvas: any, opts: LoveCoreOpts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.tier = LoveCore.detectTier();
    // 先落默认风格，setColors() 之后会再调 setTheme 覆盖
    const t = getCoreTheme(DEFAULT_CORE_THEME);
    this.theme = t;
    this.primary = t.primary;
    this.accent = t.accent;
    this.sparkColor = t.spark;
    this.shellColor = t.shell;
    this.spin = t.spin;
    this.beatRate = t.beat;
    this.floatDur = t.float;
    this.haloScale = t.haloScale;
    this.haloPower = t.haloPower;
    this.twinkleRate = t.twinkle;
    this.particleSpinK = t.particleSpin;
    this.starRatio = t.starRatio;
    this.baseSpinK = t.baseSpin;
    this.buildParticles();
    this.buildRings();
  }

  /* ============================ 外部配置 ============================ */

  resize(w: number, h: number, dpr: number) {
    this.W = Math.max(1, w);
    this.H = Math.max(1, h);
    // dpr 上限 1.5：玻璃球是渐变绘制，1.5x 与 3x 肉眼几乎无差，但像素量差 4 倍
    this.dpr = Math.min(Math.max(1, dpr || 1), 1.5);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.cx = this.W / 2;
    this.cy = this.H * 0.44;
    this.R = Math.max(28, Math.min(this.W * 0.34, this.H * 0.28));
    this.f = this.R * 3.2;
    this.gc = null;
    this.render(0);
  }

  setColors(primary: string, accent: string) {
    if (primary) this.primary = primary;
    if (accent) this.accent = accent;
    this.gc = null;
    if (!this.paused) this.render(0);
  }

  /**
   * 切换整套视觉风格：配色 / 粒子数量与节奏 / 轨道几何 / 光效 / 动效节奏。
   * 换风格会重建粒子与轨道，并让静态渐变缓存失效（颜色变了）。
   */
  setTheme(key: string) {
    const t = getCoreTheme(key);
    if (t.key === this.theme.key) return;
    this.theme = t;
    this.primary = t.primary;
    this.accent = t.accent;
    this.sparkColor = t.spark;
    this.shellColor = t.shell;
    this.spin = t.spin;
    this.beatRate = t.beat;
    this.floatDur = t.float;
    this.haloScale = t.haloScale;
    this.haloPower = t.haloPower;
    this.twinkleRate = t.twinkle;
    this.particleSpinK = t.particleSpin;
    this.starRatio = t.starRatio;
    this.baseSpinK = t.baseSpin;
    this.buildParticles();
    this.buildRings();
    this.gc = null;
    if (!this.paused) this.render(0);
  }

  /** 当前风格 key（供页面回显，避免页面与引擎状态不一致） */
  getThemeKey(): string {
    return this.theme.key;
  }

  /**
   * 等级 → 轨道环数：Lv.1-3 一圈、Lv.4-7 两圈、Lv.8-10 三圈。
   * 用真实等级驱动视觉复杂度，升级时球体肉眼可见地「更盛大」，而不是纯装饰。
   */
  setLevel(lv: number) {
    const n = lv >= 8 ? 3 : (lv >= 4 ? 2 : 1);
    if (n === this.ringCount) return;
    this.ringCount = n;
    if (!this.paused) this.render(0);
  }

  setReducedMotion(v: boolean) {
    this.reduced = !!v;
    this.gc = null;
    if (this.reduced) this.velY = 0;
    if (!this.paused) this.render(0);
  }

  setPaused(v: boolean) {
    const next = !!v;
    if (next === this.paused) return;
    this.paused = next;
    if (next) this.stop();
    else if (!this.running) this.start();
  }

  start() {
    if (this.running || this.paused) return;
    this.running = true;
    this.last = 0;
    const step = (ts: number) => {
      if (!this.running) return;
      this.raf = this.cv.requestAnimationFrame(step);
      const now = ts || 0;
      const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 0.016;
      this.last = now;
      this.update(dt);
      // 减弱动效时画面是静止的，只在用户拖动 / 脉冲期间才重绘，省电省帧
      if (!this.reduced || this.drag || this.pulseT >= 0) this.render(dt);
    };
    this.raf = this.cv.requestAnimationFrame(step);
  }

  stop() {
    this.running = false;
    if (this.raf && this.cv && this.cv.cancelAnimationFrame) {
      this.cv.cancelAnimationFrame(this.raf);
    }
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.gc = null;
    this.parts = [];
    this.rings = [];
    this.ctx = null;
    this.cv = null;
  }

  /** 触发一次爱情脉冲（爱心放大 → 辉光增强 → 粒子外扩 → 波纹扩散） */
  pulse() {
    this.pulseT = 0;
    if (this.paused) this.render(0);
  }

  /* ============================ 输入 ============================ */

  onTouchStart(e: any) {
    const p = LoveCore.point(e);
    if (!p) return;
    this.drag = true;
    this.lastX = p.x;
    this.lastY = p.y;
    this.moveAcc = 0;
    this.downTs = Date.now();
    this.velY = 0;
  }

  onTouchMove(e: any) {
    if (!this.drag) return;
    const p = LoveCore.point(e);
    if (!p) return;
    const dx = p.x - this.lastX;
    const dy = p.y - this.lastY;
    this.lastX = p.x;
    this.lastY = p.y;
    this.moveAcc += Math.abs(dx) + Math.abs(dy);
    this.rotY += dx * 0.0085;
    this.rotX = Math.max(-0.95, Math.min(0.95, this.rotX + dy * 0.0055));
    // 松手后的惯性：按最后一段速度给角速度
    this.velY = dx * 9;
  }

  onTouchEnd() {
    if (!this.drag) return;
    this.drag = false;
    const quick = Date.now() - this.downTs < 360 && this.moveAcc < 12;
    if (quick) {
      this.pulse();
      if (this.opts.onPulse) this.opts.onPulse();
    }
    if (this.paused) this.render(0);
  }

  private static point(e: any): { x: number; y: number } | null {
    const t = e && (e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : null));
    if (!t) return null;
    const x = typeof t.x === 'number' ? t.x : t.clientX;
    const y = typeof t.y === 'number' ? t.y : t.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    return { x, y };
  }

  /* ============================ 构建 ============================ */

  private static detectTier(): number {
    try {
      const info: any = (wx as any).getSystemInfoSync ? (wx as any).getSystemInfoSync() : {};
      const b = typeof info.benchmarkLevel === 'number' ? info.benchmarkLevel : -1;
      if (b >= 60) return 2;
      if (b >= 25) return 1;
      if (b > 0) return 0;
      return 1; // 拿不到档位时按中档走
    } catch (err) {
      return 1;
    }
  }

  private buildParticles() {
    // 基础档位 22/46/74，再乘风格的 particleScale（风格可加"满"或减"疏"）
    const base = [22, 46, 74][this.tier] || 46;
    const n = Math.max(12, Math.round(base * (this.theme.particleScale || 1)));
    this.parts = [];
    for (let i = 0; i < n; i++) {
      const th = Math.random() * TAU;
      const ph = Math.acos(2 * Math.random() - 1);
      this.parts.push({
        r: 1.06 + Math.pow(Math.random(), 0.7) * 1.0,
        th,
        ph,
        // 自转速度受风格倍率控制（有的急促、有的近乎静止）
        spin: (0.05 + Math.random() * 0.12) * this.particleSpinK * (Math.random() < 0.5 ? -1 : 1),
        size: 0.85 + Math.random() * 1.5,
        tw: Math.random() * TAU,
        // 亮星占比由风格决定（暗夜金砂 22% 显得更"沙"，星梦夜曲 12% 克制）
        kind: Math.random() < this.starRatio ? 1 : 0
      });
    }
  }

  private buildRings() {
    // 三条轨道几何全部来自风格定义（倾角 / 半径 / 转速 / 线宽 / 环色）
    this.rings = this.theme.rings.map((r) => ({
      tiltA: r.tiltA,
      tiltB: r.tiltB,
      radius: r.radius,
      spin: r.phase || 0,
      speed: r.speed,
      hue: r.hue,
      color: r.color,
      width: r.width
    }));
  }

  /* ============================ 每帧更新 ============================ */

  private update(dt: number) {
    if (!this.reduced) {
      this.t += dt;
      this.rotY += this.spin * dt;
      // 惯性衰减：约 2s 内自然停下，不做硬截断
      if (!this.drag && Math.abs(this.velY) > 0.0004) {
        this.rotY += this.velY * dt;
        this.velY *= Math.exp(-2.0 * dt);
      } else if (!this.drag) {
        this.velY = 0;
      }
      for (const p of this.parts) {
        p.th += p.spin * dt;
        if (p.th > TAU) p.th -= TAU;
        if (p.th < 0) p.th += TAU;
      }
      for (const r of this.rings) {
        r.spin += r.speed * dt;
        if (r.spin > TAU) r.spin -= TAU;
      }
    } else {
      this.t = 0;
    }

    if (this.pulseT >= 0) {
      this.pulseT += dt / this.pulseDur;
      if (this.pulseT >= 1) this.pulseT = -1;
    }
  }

  /* ============================ 数学 ============================ */

  /** 世界坐标（相对球心，单位 px）→ 屏幕坐标 + 深度；结果写进复用对象 tmp */
  private project(x: number, y: number, z: number): P3 {
    const cyw = Math.cos(this.rotY);
    const syw = Math.sin(this.rotY);
    const cxw = Math.cos(this.rotX);
    const sxw = Math.sin(this.rotX);
    const x1 = x * cyw - z * syw;
    const z1 = x * syw + z * cyw;
    const y2 = y * cxw - z1 * sxw;
    const z2 = y * sxw + z1 * cxw;
    const s = this.f / (this.f + z2);
    const o = this.tmp;
    o.x = this.cx + x1 * s;
    o.y = this.cy + y2 * s;
    o.z = z2;
    o.s = s;
    return o;
  }

  /** 轨道环上一点 → 写进 out（唯一取点入口，流光点与环线共用同一套数学） */
  private ringPointTo(rg: Ring, ang: number, out: { x: number; y: number; z: number; s: number }) {
    const rr = rg.radius;
    const x = Math.cos(ang) * rr;
    const zz = Math.sin(ang) * rr;
    // 绕 Z 轴 → 绕 X 轴，得到该环自己的姿态
    const cz = Math.cos(rg.tiltB);
    const sz = Math.sin(rg.tiltB);
    const x1 = x * cz;
    const y1 = x * sz;
    const ca = Math.cos(rg.tiltA);
    const sa = Math.sin(rg.tiltA);
    const y2 = y1 * ca - zz * sa;
    const z2 = y1 * sa + zz * ca;
    const p = this.project(x1 * this.R, y2 * this.R, z2 * this.R);
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    out.s = p.s;
  }

  /** 轨道环上一点：写入 rx/ry/rz/rs 的第 i 位（不产生临时对象） */
  private ringPointInto(rg: Ring, ang: number, i: number) {
    this.ringPointTo(rg, ang, this.tmp2);
    this.rx[i] = this.tmp2.x;
    this.ry[i] = this.tmp2.y;
    this.rz[i] = this.tmp2.z;
    this.rs[i] = this.tmp2.s;
  }

  /** 爱心路径（以 (0,0) 为中心，宽 w） */
  private heartPath(w: number) {
    const ctx = this.ctx;
    const h = w * 0.94;
    const top = -h * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, top + h * 0.30);
    ctx.bezierCurveTo(-w * 0.10, top + h * 0.03, -w * 0.50, top + h * 0.05, -w * 0.50, top + h * 0.35);
    ctx.bezierCurveTo(-w * 0.50, top + h * 0.63, -w * 0.24, top + h * 0.80, 0, top + h * 0.99);
    ctx.bezierCurveTo(w * 0.24, top + h * 0.80, w * 0.50, top + h * 0.63, w * 0.50, top + h * 0.35);
    ctx.bezierCurveTo(w * 0.50, top + h * 0.05, w * 0.10, top + h * 0.03, 0, top + h * 0.30);
    ctx.closePath();
  }

  /* ============================ 渐变缓存 ============================ */

  private buildCache() {
    const ctx = this.ctx;
    const R = this.R;
    const cx = this.cx;
    const cy = this.cy;
    this.gc = {
      /** 球外近场辉光（半径与强度由风格决定：有的柔散、有的浓烈） */
      halo: (() => {
        const hr = R * this.haloScale;
        const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, hr);
        g.addColorStop(0, LoveCore.rgba(this.primary, this.haloPower));
        g.addColorStop(0.45, LoveCore.rgba(this.primary, this.haloPower * 0.38));
        g.addColorStop(1, LoveCore.rgba(this.primary, 0));
        return g;
      })(),
      /** 玻璃后壁（球体本体，中心最透、边缘略实；通透色随风格冷暖变化） */
      shell: (() => {
        const g = ctx.createRadialGradient(cx - R * 0.22, cy - R * 0.3, R * 0.08, cx, cy, R * 1.02);
        g.addColorStop(0, 'rgba(255,255,255,0.07)');
        g.addColorStop(0.55, this.shellColor);
        g.addColorStop(0.85, LoveCore.rgba(this.primary, 0.20));
        g.addColorStop(1, LoveCore.rgba(this.accent, 0.30));
        return g;
      })(),
      /** 边缘折射：左上刺白 → 右下融色 */
      rim: (() => {
        const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
        g.addColorStop(0, 'rgba(255,255,255,0.92)');
        g.addColorStop(0.42, 'rgba(255,255,255,0.28)');
        g.addColorStop(0.72, LoveCore.rgba(this.accent, 0.42));
        g.addColorStop(1, LoveCore.rgba(this.primary, 0.55));
        return g;
      })(),
      /** 顶部大镜面高光 */
      spec: (() => {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.34);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        return g;
      })(),
      /** 底座透光台面 */
      base: (() => {
        const g = ctx.createLinearGradient(cx, cy + R * 1.10, cx, cy + R * 1.62);
        g.addColorStop(0, 'rgba(255,255,255,0.30)');
        g.addColorStop(0.5, 'rgba(226,214,255,0.14)');
        g.addColorStop(1, 'rgba(255,255,255,0.02)');
        return g;
      })(),
      /** 底座光晕 */
      baseGlow: (() => {
        const g = ctx.createRadialGradient(cx, cy + R * 1.46, 0, cx, cy + R * 1.46, R * 1.75);
        g.addColorStop(0, LoveCore.rgba(this.accent, 0.34));
        g.addColorStop(0.5, LoveCore.rgba(this.primary, 0.14));
        g.addColorStop(1, LoveCore.rgba(this.primary, 0));
        return g;
      })(),
      /** 球内底部焦散 */
      caustic: (() => {
        const g = ctx.createRadialGradient(cx, cy + R * 0.62, 0, cx, cy + R * 0.62, R * 0.72);
        g.addColorStop(0, 'rgba(255,255,255,0.30)');
        g.addColorStop(0.45, LoveCore.rgba(this.accent, 0.16));
        g.addColorStop(1, 'rgba(255,255,255,0)');
        return g;
      })()
    };
  }

  /* ============================ 绘制 ============================ */

  private render(dt: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.gc) this.buildCache();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);

    // 悬浮：按风格周期上下浮动 ±0.05R（不同风格节奏不同：极光急促、熔金舒缓）
    const bobY = this.reduced ? 0 : Math.sin(this.t * (TAU / this.floatDur)) * this.R * 0.05;
    const heartBeat = this.reduced
      ? 1
      : 1 + 0.028 * Math.max(0, Math.sin(this.t * this.beatRate)) + 0.016 * Math.max(0, Math.sin(this.t * this.beatRate - 1.1));
    const pulse = this.pulseT >= 0 ? Math.sin(Math.PI * Math.min(1, Math.max(0, this.pulseT))) : 0;

    ctx.save();
    ctx.translate(0, bobY);

    this.drawHalo(pulse);
    this.drawParticles(false, pulse);
    this.drawRings(false);
    this.drawBase();
    this.drawSphere(heartBeat, pulse);
    this.drawRings(true);
    this.drawParticles(true, pulse);
    if (pulse > 0.001) this.drawWave(pulse);

    ctx.restore();

    // 脉冲期间辉光溢出画布，额外补一层不随浮动位移的外圈光
    if (pulse > 0.001) {
      ctx.save();
      ctx.globalAlpha = pulse * 0.5;
      ctx.fillStyle = this.gc.halo;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy + bobY, this.R * this.haloScale, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  /** 球体背后的近场辉光（呼吸 + 脉冲增强） */
  private drawHalo(pulse: number) {
    const ctx = this.ctx;
    // 呼吸频率也随风格：熔金/暗夜金砂慢而沉，极光/甜樱快而灵动
    const breathe = this.reduced ? 1 : 0.92 + 0.08 * Math.sin(this.t * this.beatRate * 0.31);
    ctx.save();
    ctx.globalAlpha = Math.min(1, breathe + pulse * 0.5);
    ctx.fillStyle = this.gc.halo;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.R * this.haloScale, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** 玻璃穹顶 + 水晶爱心 + 折射细节 */
  private drawSphere(beat: number, pulse: number) {
    const ctx = this.ctx;
    const R = this.R;
    const cx = this.cx;
    const cy = this.cy;

    // 1) 后壁
    ctx.save();
    ctx.fillStyle = this.gc.shell;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 2) 球内底部焦散光斑
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.98, 0, TAU);
    ctx.clip();
    ctx.fillStyle = this.gc.caustic;
    ctx.beginPath();
    ctx.arc(cx, cy + R * 0.62, R * 0.72, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 3) 水晶爱心（脉冲时放大，常态随心跳微微起伏）
    const scale = beat * (1 + pulse * 0.22);
    this.drawHeart(scale, 1);

    // 4) 前壁高光与折射边
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.strokeStyle = this.gc.rim;
    ctx.lineWidth = Math.max(1.1, R * 0.022);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.955, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 顶部大镜面高光
    ctx.save();
    ctx.translate(cx - R * 0.33, cy - R * 0.38);
    ctx.rotate(-0.55);
    ctx.scale(1, 0.62);
    ctx.fillStyle = this.gc.spec;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.34, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 顶部小刺点（玻璃的「硬高光」，玻璃感的关键一笔）
    ctx.save();
    ctx.translate(cx - R * 0.30, cy - R * 0.50);
    ctx.rotate(-0.5);
    ctx.scale(1, 0.5);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.13);
    sg.addColorStop(0, 'rgba(255,255,255,0.95)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.13, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 右下反弹光（环境反射，让球「有厚度」）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    const bg = ctx.createRadialGradient(cx + R * 0.5, cy + R * 0.62, 0, cx + R * 0.5, cy + R * 0.62, R * 0.66);
    bg.addColorStop(0, LoveCore.rgba(this.accent, 0.34));
    bg.addColorStop(1, LoveCore.rgba(this.accent, 0));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx + R * 0.5, cy + R * 0.62, R * 0.66, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** 水晶爱心：多层渐变 + 内部能量核 + 玻璃描边 */
  private drawHeart(scale: number, alpha: number) {
    const ctx = this.ctx;
    const R = this.R;
    const w = R * 0.92;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.cx, this.cy + R * 0.03);
    ctx.scale(scale, scale);

    this.heartPath(w);

    const g = ctx.createLinearGradient(0, -w * 0.5, w * 0.2, w * 0.5);
    g.addColorStop(0, '#FFF1FA');
    g.addColorStop(0.28, this.accent);
    g.addColorStop(0.62, this.primary);
    g.addColorStop(1, '#6D4BE0');
    ctx.fillStyle = g;
    ctx.fill();

    // 内部能量核（风格高光色芯 + 主色外扩；熔金是暖金芯、深海是冷青芯）
    ctx.save();
    ctx.clip();
    const core = ctx.createRadialGradient(w * 0.06, w * 0.04, 0, w * 0.06, w * 0.04, w * 0.46);
    core.addColorStop(0, LoveCore.rgba(this.sparkColor, 0.92));
    core.addColorStop(0.36, LoveCore.rgba(this.sparkColor, 0.30));
    core.addColorStop(1, LoveCore.rgba(this.primary, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(w * 0.06, w * 0.04, w * 0.46, 0, TAU);
    ctx.fill();

    // 左下暗部：让爱心有体积而不是贴纸
    const dark = ctx.createRadialGradient(-w * 0.3, w * 0.26, 0, -w * 0.3, w * 0.26, w * 0.5);
    dark.addColorStop(0, 'rgba(88,44,150,0.34)');
    dark.addColorStop(1, 'rgba(88,44,150,0)');
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(-w * 0.3, w * 0.26, w * 0.5, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 玻璃描边 + 顶部棱面高光
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.lineWidth = Math.max(0.8, this.R * 0.012);
    ctx.stroke();

    ctx.save();
    ctx.clip();
    ctx.translate(-w * 0.24, -w * 0.22);
    ctx.rotate(-0.4);
    ctx.scale(1, 0.55);
    const hl = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.2);
    hl.addColorStop(0, 'rgba(255,255,255,0.85)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  /** 光基座：透光圆柱台面 + 旋转光环 + 地面辉光 */
  private drawBase() {
    const ctx = this.ctx;
    const R = this.R;
    const cx = this.cx;
    const y0 = this.cy + R * 1.12;
    const y1 = y0 + R * 0.44;

    // 地面辉光
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = this.gc.baseGlow;
    ctx.beginPath();
    ctx.ellipse(cx, this.cy + R * 1.46, R * 1.75, R * 0.6, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 圆柱侧壁
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.9, y0);
    ctx.lineTo(cx - R * 0.86, y1);
    ctx.ellipse(cx, y1, R * 0.86, R * 0.2, 0, 0, Math.PI);
    ctx.lineTo(cx + R * 0.9, y0);
    ctx.ellipse(cx, y0, R * 0.9, R * 0.21, 0, 0, Math.PI, true);
    ctx.closePath();
    ctx.fillStyle = this.gc.base;
    ctx.fill();
    ctx.restore();

    // 台面
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, y0, R * 0.9, R * 0.21, 0, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 台面上的旋转光环（缓慢自转，暗示「能量在转」；转速受风格控制）
    const rot = this.reduced ? 0 : this.t * this.baseSpinK;
    ctx.save();
    ctx.translate(cx, y0);
    ctx.scale(1, 0.23);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.72, 0, TAU);
    ctx.strokeStyle = LoveCore.rgba(this.accent, 0.34);
    ctx.lineWidth = Math.max(1.2, R * 0.02);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.72, rot, rot + 1.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.6, R * 0.028);
    ctx.stroke();
    ctx.restore();
  }

  /** 轨道环：按深度分远近两次绘制，形成真实的穿插遮挡 */
  private drawRings(near: boolean) {
    const ctx = this.ctx;
    const rx = this.rx;
    const ry = this.ry;
    const rz = this.rz;
    const n = Math.min(this.ringCount, this.rings.length);
    for (let ri = 0; ri < n; ri++) {
      const rg = this.rings[ri];
      for (let i = 0; i <= SEG; i++) {
        this.ringPointInto(rg, rg.spin + (i / SEG) * TAU, i);
      }
      const beadAng = rg.spin + (this.reduced ? 0 : this.t * 0.6) + ri * 1.7;
      this.ringPointTo(rg, beadAng, this.tmp2);
      const bx = this.tmp2.x;
      const by = this.tmp2.y;
      const bz = this.tmp2.z;
      const bs = this.tmp2.s;

      const base = this.ringColor(rg);
      const lw = Math.max(1, this.R * rg.width);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = lw;
      for (let i = 0; i < SEG; i++) {
        const zm = (rz[i] + rz[i + 1]) * 0.5;
        if ((zm < 0) !== near) continue;
        // 深度明暗：近亮远暗，才有「绕到球后面去」的错觉
        const depth = Math.max(-1, Math.min(1, zm / (this.R * rg.radius)));
        let alpha = 0.18 + 0.34 * (1 - (depth + 1) / 2);
        // 彗尾：靠近流光点的一小段显著提亮
        const ang = rg.spin + ((i + 0.5) / SEG) * TAU;
        const d = Math.abs((((ang - beadAng + Math.PI) % TAU) + TAU) % TAU - Math.PI);
        if (d < 0.95) alpha += Math.pow(1 - d / 0.95, 2) * 0.55;
        ctx.strokeStyle = LoveCore.rgba(base, Math.min(0.95, alpha));
        ctx.beginPath();
        ctx.moveTo(rx[i], ry[i]);
        ctx.lineTo(rx[i + 1], ry[i + 1]);
        ctx.stroke();
      }
      ctx.restore();

      // 轨道上的流光点（只在自己的那一遍里画，才会被球体正确遮挡）
      if ((bz < 0) === near) {
        const br = Math.max(1.8, this.R * 0.028) * bs;
        ctx.save();
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br * 3.4);
        bg.addColorStop(0, 'rgba(255,255,255,0.95)');
        bg.addColorStop(0.35, LoveCore.rgba(base, 0.6));
        bg.addColorStop(1, LoveCore.rgba(base, 0));
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(bx, by, br * 3.4, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  /** 轨道环色：hue 0=强调色 / 1=冷调辅色 / 2=纯白 / >=3=风格自定义色 */
  private ringColor(rg: Ring): string {
    if (rg.hue >= 3 && rg.color) return rg.color;
    if (rg.hue === 1) return '#9FD6FF';
    if (rg.hue === 2) return '#FFFFFF';
    return this.accent.charAt(0) === '#' ? this.accent : '#F5A7D7';
  }

  /** 星尘粒子（按深度分远近两次绘制） */
  private drawParticles(near: boolean, pulse: number) {
    const ctx = this.ctx;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const sp = Math.sin(p.ph);
      const cp = Math.cos(p.ph);
      const push = 1 + pulse * 0.22;
      const x = p.r * push * sp * Math.cos(p.th) * this.R;
      const y = p.r * push * cp * 0.72 * this.R;
      const z = p.r * push * sp * Math.sin(p.th) * this.R;
      const pos = this.project(x, y, z);
      if ((pos.z < 0) !== near) continue;

      const depth = Math.max(-1, Math.min(1, pos.z / (this.R * 2.1)));
      const fade = 0.42 + 0.5 * (1 - (depth + 1) / 2);
      const tw = this.reduced ? 0.85 : 0.72 + 0.28 * Math.sin(this.t * this.twinkleRate + p.tw);
      const size = p.size * (p.kind ? 1.5 : 1) * pos.s * (this.tier === 0 ? 0.9 : 1);
      const alpha = fade * tw;

      if (p.kind) {
        const gg = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, size * 3.2);
        gg.addColorStop(0, 'rgba(255,255,255,0.95)');
        gg.addColorStop(0.3, LoveCore.rgba(this.accent, 0.55 * alpha));
        gg.addColorStop(1, LoveCore.rgba(this.accent, 0));
        ctx.save();
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size * 3.2, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = LoveCore.rgba('#FFFFFF', alpha);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, Math.max(0.5, size), 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  /** 脉冲波纹：两圈由球面向外扩散的能量波 */
  private drawWave(p: number) {
    const ctx = this.ctx;
    for (let i = 0; i < 2; i++) {
      const t = p - i * 0.18;
      if (t <= 0 || t >= 1) continue;
      const r = this.R * (1.02 + t * 0.82);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.55;
      ctx.strokeStyle = i === 0 ? LoveCore.rgba(this.accent, 0.9) : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = Math.max(1, this.R * 0.022 * (1 - t) + 0.6);
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ============================ 颜色工具 ============================ */

  /** #RRGGBB → rgba(r,g,b,a)；非法输入退回白色，避免出现 undefined 色值 */
  static rgba(hex: string, a: number): string {
    const s = (hex || '').trim();
    if (s.charAt(0) === '#') {
      let h = s.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length >= 6) {
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
        }
      }
    }
    if (s.indexOf('rgba(') === 0) return s;
    if (s.indexOf('rgb(') === 0) return s.replace('rgb(', 'rgba(').replace(')', ',' + a + ')');
    return 'rgba(255,255,255,' + a + ')';
  }
}
