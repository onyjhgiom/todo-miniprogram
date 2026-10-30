// utils/astro-cosmos.ts
// 星语星球 · 3D 星球引擎（Canvas 2D 伪 3D）
//
// 【为什么是 Canvas 2D 而不是 WebGL / three.js】
// 本工程是原生微信小程序：WXML/WXSS/TS + Canvas 2D，**零外部依赖**。
// React / three.js / @react-three/fiber / drei / framer-motion / Tailwind 都是
// 浏览器 DOM 生态的库，在小程序运行时里没有 DOM、没有 webpack、也没有 npm 运行时，
// 一个都装不进来。小程序虽然提供 `canvas type="webgl"`，但要为此引入数百 KB 的
// WebGL 引擎（threejs-miniprogram 等），与「移动端必须优先性能」直接冲突。
// 因此这里沿用工程内已验证的做法（参见 subpackages/love/utils/love-core.ts）：
// **自己写最小 3D 投影 + 画家算法分层绘制**，用渐变模拟 MeshPhysicalMaterial 的
// 通透/粗糙/高光观感。好处是零依赖、体积极小、低端机也能跑。
//
// 【three.js 参数 → Canvas 2D 的等价映射】
//   transmission 0.65  → 球体基底用低 alpha 径向渐变 + 内部星云透出
//   roughness    0.18  → 高光锐利（小半径高亮度 specular）
//   metalness    0.05  → 几乎无金属反射，只有一道冷色边缘光
//   ior          1.45  → 边缘折射光晕（rim）强度与颜色
//   clearcoat    0.8   → 顶部叠一层额外高光（clearcoat 高光）
//   clearcoatRoughness 0.15 → 该高光小而亮，不糊开
//
// 【渲染分层（画家算法，由后往前）】
//   1 halo 外辉光
//   2 星尘（后半 z<0）
//   3 内部星云（裁剪进球内，随球自转）
//   4 玻璃球壳（基底 + 边缘压暗 + rim 边缘光 + specular + clearcoat）
//   5 星座连线
//   6 星座节点
//   7 轨道环（后半在球后、前半在球前，分两次画）
//   8 星尘（前半 z>0）
//   9 能量核心（呼吸）+ 脉冲涟漪
//
// 【性能约定】
//   * dpr 上限 1.5（移动端像素数 = w*h*dpr²，压到 1.5 可省 ~44% 填充）
//   * 粒子数按设备档位 100 / 60 / 30
//   * 渐变按尺寸缓存，只在 resize 时重建（每帧重建渐变是 Canvas 2D 最大开销之一）
//   * 页面 onHide 时 setPaused(true) 停 RAF，省电

/** 调色板：与页面 WXSS 的 --astro-* 变量一一对应（单一真相源） */
export const ASTRO_PALETTE = {
  bg: '#080A1C',
  primary: '#6D5CE7',
  secondary: '#8B7CF6',
  deep: '#30265C',
  gold: '#D8B66A',
  white: '#F7F7FF',
  textSub: '#9FA3C4',
  ringViolet: '109,92,231',
  ringBlue: '91,141,239',
  ringGold: '216,182,106'
} as const;

/** 星座节点（= 十二星座；energy 为 0~1，由当日运势分数派生） */
export interface SignNode {
  key: string;
  name: string;
  /** 0~1，决定节点大小与亮度 */
  energy: number;
}

export interface CosmosOpts {
  /** 首帧绘制完成 */
  onReady?: () => void;
  /** 能量脉冲触发（点击核心 / 外部调用 pulse） */
  onPulse?: () => void;
  /** 点到某个星座节点 */
  onNode?: (key: string) => void;
  /** 点到能量核心 */
  onCore?: () => void;
}

interface Vec3 { x: number; y: number; z: number; }

interface Particle {
  x: number; y: number; z: number;
  /** 尺寸系数 */
  r: number;
  /** 闪烁频率 */
  tw: number;
  /** 初始相位 */
  ph: number;
}

interface NebulaBlob {
  /** 球内单位方向 */
  x: number; y: number; z: number;
  /** 半径（相对 R） */
  r: number;
  /** rgba 前缀，如 '109,92,231' */
  rgb: string;
  a: number;
}

interface Orbit {
  /** 环半径（相对 R） */
  radius: number;
  /** 角速度 rad/s（负值反向） */
  speed: number;
  /** 绕 X 轴倾角 */
  tiltA: number;
  /** 绕 Z 轴倾角 */
  tiltB: number;
  /** 'r,g,b' */
  rgb: string;
  alpha: number;
  width: number;
  phase: number;
}

interface Constellation {
  key: string;
  name: string;
  energy: number;
  /** 单位球面坐标 */
  p: Vec3;
  /** 邻居索引（连线用） */
  near: number[];
}

/** 设备性能档位：0 低端 / 1 普通 / 2 高端 */
export type PerfTier = 0 | 1 | 2;

/**
 * 探测设备性能档位（粒子数 30 / 60 / 100）。
 * benchmarkLevel 是微信给的分（-1 未知，0 最低）。未知时按屏幕像素面积粗估。
 */
export function detectPerfTier(): PerfTier {
  try {
    const info: any = (wx as any).getDeviceInfo ? (wx as any).getDeviceInfo() : wx.getSystemInfoSync();
    const bench = Number(info.benchmarkLevel);
    if (Number.isFinite(bench) && bench >= 0) {
      if (bench >= 40) return 2;
      if (bench >= 10) return 1;
      return 0;
    }
    const win: any = (wx as any).getWindowInfo ? (wx as any).getWindowInfo() : wx.getSystemInfoSync();
    const px = (win.screenWidth || 375) * (win.screenHeight || 667) * (win.pixelRatio || 2) * (win.pixelRatio || 2);
    if (px > 3_000_000) return 2;
    if (px > 1_200_000) return 1;
    return 0;
  } catch (_e) {
    return 1;
  }
}

/** 系统是否开启「减弱动态效果」 */
export function detectReducedMotion(): boolean {
  try {
    const s: any = (wx as any).getSystemSetting ? (wx as any).getSystemSetting() : {};
    return s.reducedMotion === 'enable';
  } catch (_e) {
    return false;
  }
}

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = 2.399963229728653;

/** 自转基准速度（rad/s）；reducedMotion 时为 0 */
const SPIN_BASE = 0.16;
/** 呼吸周期 3s（需求：scale 1 → 1.08 → 1） */
const BREATH_PERIOD = 3.0;

export class AstroCosmos {
  private cv: any;
  private ctx: any;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** 球半径（CSS px） */
  private R = 100;
  private cx = 0;
  private cy = 0;

  /* —— 相机 / 旋转 —— */
  private rx = -0.36;
  private ry = 0.4;
  private vx = 0;
  private vy = 0;
  private autoSpin = true;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private moved = 0;

  /* —— 内容 —— */
  private signs: SignNode[] = [];
  private cons: Constellation[] = [];
  private activeKey = '';
  private particles: Particle[] = [];
  private nebula: NebulaBlob[] = [];
  private orbits: Orbit[] = [
    { radius: 1.5, speed: 0.08, tiltA: 1.13, tiltB: 0.18, rgb: ASTRO_PALETTE.ringViolet, alpha: 0.5, width: 1.6, phase: 0 },
    { radius: 1.78, speed: -0.05, tiltA: 1.92, tiltB: -0.5, rgb: ASTRO_PALETTE.ringBlue, alpha: 0.36, width: 1.3, phase: 1.1 },
    { radius: 2.06, speed: 0.03, tiltA: 0.5, tiltB: 0.9, rgb: ASTRO_PALETTE.ringGold, alpha: 0.25, width: 1.1, phase: 2.3 }
  ];

  /* —— 运行时 —— */
  private raf: number | null = null;
  private last = 0;
  private t = 0;
  /** 0~1，脉冲衰减（与 pulse() 方法区分命名） */
  private pulseAmt = 0;
  private coreScale = 1;
  private ripples: { p: number }[] = [];
  private reduced = false;
  private paused = false;
  private tier: PerfTier = 1;
  private running = false;
  /** 命中缓存：每帧记录节点/核心的屏幕位置 */
  private hit: { key: string; x: number; y: number; r: number }[] = [];
  private coreHit = { x: 0, y: 0, r: 0 };
  private opt: CosmosOpts;

  /* —— 渐变缓存（resize 时重建） —— */
  private cache: any = {};

  constructor(canvas: any, opts: CosmosOpts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.opt = opts;
    this.nebula = this.buildNebula();
  }

  /* ============================ 外部配置 ============================ */

  resize(w: number, h: number, dpr: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.dpr = Math.max(1, Math.min(1.5, dpr || 1)); // 上限 1.5（需求：移动端省像素）
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 星球取画布短边的一半左右，给轨道环留出空间
    this.R = Math.min(this.w, this.h) * 0.285;
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.buildParticles();
    this.buildCache();
  }

  /** 设置星座节点（十二星座 + 当日能量） */
  setSigns(list: SignNode[]) {
    this.signs = list && list.length ? list.slice() : [];
    this.buildConstellations();
  }

  /** 高亮某个星座（切换本命星座时调用） */
  setActiveSign(key: string) {
    this.activeKey = key || '';
  }

  setReducedMotion(v: boolean) {
    this.reduced = !!v;
    if (v) {
      // 关闭自动旋转（需求：prefers-reduced-motion → 关自动旋转）
      this.autoSpin = false;
      this.vx = 0;
      this.vy = 0;
    } else {
      this.autoSpin = true;
    }
  }

  setPaused(v: boolean) {
    this.paused = !!v;
    if (v) this.stopRaf();
    else if (this.running) this.startRaf();
  }

  /** 设备档位 → 粒子数 30 / 60 / 100 */
  setTier(t: PerfTier) {
    this.tier = t;
    this.buildParticles();
  }

  setAutoSpin(v: boolean) {
    this.autoSpin = !!v;
  }

  /* ============================ 生命周期 ============================ */

  start() {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    if (!this.paused) this.startRaf();
    if (this.opt.onReady) this.opt.onReady();
  }

  private startRaf() {
    if (this.raf !== null) return;
    const loop = (ts: number) => {
      if (this.raf === null) return;
      const dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 0.016;
      this.last = ts;
      this.t += dt;
      this.update(dt);
      this.render();
      this.raf = this.cv.requestAnimationFrame(loop);
    };
    this.raf = this.cv.requestAnimationFrame(loop);
  }

  private stopRaf() {
    if (this.raf !== null) {
      try { this.cv.cancelAnimationFrame(this.raf); } catch (_e) { /* 忽略 */ }
      this.raf = null;
    }
    this.last = 0;
  }

  stop() {
    this.running = false;
    this.stopRaf();
  }

  destroy() {
    this.stop();
    this.cache = {};
    this.hit = [];
    this.ripples = [];
  }

  /** 触发一次能量脉冲（需求五：核心放大 + 粒子扩散 + 轨道波纹 + 数字增加） */
  pulse() {
    this.pulseAmt = 1;
    this.ripples.push({ p: 0 });
    if (this.ripples.length > 3) this.ripples.shift();
    if (this.opt.onPulse) this.opt.onPulse();
  }

  /* ============================ 输入 ============================ */

  onTouchStart(e: any) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    this.dragging = true;
    this.lastX = t.x;
    this.lastY = t.y;
    this.downX = t.x;
    this.downY = t.y;
    this.downT = Date.now();
    this.moved = 0;
    this.vx = 0;
    this.vy = 0;
  }

  onTouchMove(e: any) {
    if (!this.dragging) return;
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    const dx = t.x - this.lastX;
    const dy = t.y - this.lastY;
    this.lastX = t.x;
    this.lastY = t.y;
    this.moved += Math.abs(dx) + Math.abs(dy);
    // 只做旋转，**不实现双指缩放**（需求六：禁止缩放）
    this.ry += dx * 0.008;
    this.rx += dy * 0.006;
    // 限制上下翻转角度，避免翻转后方位感错乱
    this.rx = Math.max(-1.15, Math.min(1.15, this.rx));
    this.vx = dx * 0.008;
    this.vy = dy * 0.006;
  }

  onTouchEnd() {
    if (!this.dragging) return;
    this.dragging = false;
    const dt = Date.now() - this.downT;
    // 位移小且时间短 = 点按（不是拖动）→ 命中测试
    if (this.moved < 12 && dt < 420) {
      this.handleTap(this.downX, this.downY);
    }
  }

  private handleTap(x: number, y: number) {
    // 先测星座节点（半径内最近者优先）
    let best: { key: string; d: number } | null = null;
    for (let i = 0; i < this.hit.length; i++) {
      const n = this.hit[i];
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= Math.max(n.r, 22) && (!best || d < best.d)) best = { key: n.key, d };
    }
    if (best) {
      if (this.opt.onNode) this.opt.onNode(best.key);
      return;
    }
    // 再测核心
    const dc = Math.hypot(this.coreHit.x - x, this.coreHit.y - y);
    if (dc <= this.coreHit.r) {
      if (this.opt.onCore) this.opt.onCore();
    }
  }

  /* ============================ 构建 ============================ */

  private buildParticles() {
    const count = this.tier === 2 ? 100 : this.tier === 1 ? 60 : 30;
    const out: Particle[] = [];
    for (let i = 0; i < count; i++) {
      // 球壳上均匀取点（球面均匀：z 均匀 → 方位角等分）
      const z = 1 - (i / Math.max(1, count - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - z * z));
      const th = i * GOLDEN_ANGLE;
      out.push({
        x: Math.cos(th) * rad,
        y: z,
        z: Math.sin(th) * rad,
        r: 0.5 + ((i * 37) % 100) / 100 * 1.5,
        tw: 0.6 + ((i * 53) % 100) / 100 * 1.6,
        ph: ((i * 29) % 100) / 100 * TAU
      });
    }
    this.particles = out;
  }

  /** 球内星云团（4 团，冷暖对比；金色那团压低 alpha，否则会在球底显成一块脏橘斑） */
  private buildNebula(): NebulaBlob[] {
    return [
      { x: 0.42, y: -0.34, z: 0.72, r: 0.85, rgb: '109,92,231', a: 0.55 },
      { x: -0.62, y: 0.30, z: 0.52, r: 0.78, rgb: '139,124,246', a: 0.42 },
      { x: 0.10, y: 0.70, z: -0.66, r: 0.62, rgb: '216,182,106', a: 0.13 },
      { x: -0.30, y: -0.58, z: -0.62, r: 0.66, rgb: '91,141,239', a: 0.30 }
    ];
  }

  /** 十二星座节点：黄金角均匀铺在球面 + 连接最近邻成网 */
  private buildConstellations() {
    const list = this.signs;
    const n = list.length;
    const cons: Constellation[] = [];
    for (let i = 0; i < n; i++) {
      const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 1.75; // 收一点，避免两极过密
      const rad = Math.sqrt(Math.max(0.05, 1 - y * y));
      const th = i * GOLDEN_ANGLE;
      cons.push({
        key: list[i].key,
        name: list[i].name,
        energy: list[i].energy,
        p: { x: Math.cos(th) * rad, y, z: Math.sin(th) * rad },
        near: []
      });
    }
    // 连接最近 2 个邻居（用 3D 距离，一次性算好）
    for (let i = 0; i < cons.length; i++) {
      const ds: { j: number; d: number }[] = [];
      for (let j = 0; j < cons.length; j++) {
        if (i === j) continue;
        const a = cons[i].p;
        const b = cons[j].p;
        ds.push({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 });
      }
      ds.sort((m, k) => m.d - k.d);
      cons[i].near = ds.slice(0, 2).map((o) => o.j);
    }
    this.cons = cons;
  }

  /* ============================ 更新 ============================ */

  private update(dt: number) {
    // 自转（reducedMotion 时为 0）
    const spin = this.reduced ? 0 : SPIN_BASE;
    if (this.autoSpin && !this.dragging) this.ry += spin * dt;

    // 惯性：拖动松手后按速度继续，逐步衰减
    if (!this.dragging) {
      this.ry += this.vx;
      this.rx += this.vy;
      this.vx *= 0.94;
      this.vy *= 0.94;
      if (Math.abs(this.vx) < 0.00015) this.vx = 0;
      if (Math.abs(this.vy) < 0.00015) this.vy = 0;
      this.rx = Math.max(-1.15, Math.min(1.15, this.rx));
    }

    if (this.ry > TAU) this.ry -= TAU;
    if (this.ry < -TAU) this.ry += TAU;

    // 脉冲衰减
    if (this.pulseAmt > 0) {
      this.pulseAmt = Math.max(0, this.pulseAmt - dt * 1.6);
    }
    // 涟漪推进
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].p += dt * 0.85;
      if (this.ripples[i].p >= 1) this.ripples.splice(i, 1);
    }
    // 核心呼吸：1 → 1.08 → 1，周期 3s（reducedMotion 时锁 1）
    this.coreScale = this.reduced
      ? 1
      : 1 + 0.08 * (0.5 - 0.5 * Math.cos((this.t / BREATH_PERIOD) * TAU));

    // 轨道相位
    for (let i = 0; i < this.orbits.length; i++) {
      const o = this.orbits[i];
      const sp = this.reduced ? 0 : o.speed;
      o.phase += sp * dt;
    }
  }

  /* ============================ 数学 ============================ */

  /** 3D → 屏幕：先绕 Y 自转，再绕 X 俯仰，最后透视除法 */
  private project(p: Vec3): { x: number; y: number; z: number; s: number } {
    const cy = Math.cos(this.ry);
    const sy = Math.sin(this.ry);
    const x1 = p.x * cy + p.z * sy;
    const z1 = -p.x * sy + p.z * cy;
    const cx = Math.cos(this.rx);
    const sx = Math.sin(this.rx);
    const y1 = p.y * cx - z1 * sx;
    const z2 = p.y * sx + z1 * cx;

    const fov = this.R * 3.1;
    const s = fov / (fov + z2 * this.R);
    return { x: this.cx + x1 * this.R * s, y: this.cy + y1 * this.R * s, z: z2, s };
  }

  /* ============================ 渐变缓存 ============================ */

  private buildCache() {
    const ctx = this.ctx;
    const R = this.R;
    const c = this.cache;

    // 外辉光
    const halo = ctx.createRadialGradient(this.cx, this.cy, R * 0.6, this.cx, this.cy, R * 2.3);
    halo.addColorStop(0, 'rgba(109,92,231,0.34)');
    halo.addColorStop(0.45, 'rgba(139,124,246,0.14)');
    halo.addColorStop(1, 'rgba(48,38,92,0)');
    c.halo = halo;

    // 球体基底：左上偏亮（通透）+ 右下压暗（体积）
    const base = ctx.createRadialGradient(
      this.cx - R * 0.34, this.cy - R * 0.38, R * 0.06,
      this.cx, this.cy, R * 1.02
    );
    base.addColorStop(0, 'rgba(247,247,255,0.20)');
    base.addColorStop(0.34, 'rgba(139,124,246,0.20)');
    base.addColorStop(0.72, 'rgba(48,38,92,0.34)');
    base.addColorStop(1, 'rgba(8,10,28,0.62)');
    c.base = base;

    // 边缘光（rim：左上一次，右下补一道冷色反射）
    const rim = ctx.createLinearGradient(this.cx - R, this.cy - R, this.cx + R, this.cy + R);
    rim.addColorStop(0, 'rgba(247,247,255,0.72)');
    rim.addColorStop(0.34, 'rgba(139,124,246,0.30)');
    rim.addColorStop(0.72, 'rgba(91,141,239,0.14)');
    rim.addColorStop(1, 'rgba(216,182,106,0.26)');
    c.rim = rim;

    // 能量核心
    const core = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, R * 0.46);
    core.addColorStop(0, 'rgba(247,247,255,0.96)');
    core.addColorStop(0.22, 'rgba(216,182,106,0.72)');
    core.addColorStop(0.55, 'rgba(139,124,246,0.34)');
    core.addColorStop(1, 'rgba(109,92,231,0)');
    c.core = core;
  }

  /* ============================ 绘制 ============================ */

  private render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const R = this.R;
    const pulseE = this.pulseAmt * this.pulseAmt;

    // 1) 外辉光（脉冲时更强）
    ctx.save();
    ctx.globalAlpha = 0.85 + pulseE * 0.15;
    ctx.fillStyle = this.cache.halo;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R * 2.3, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 2) 星尘 · 后半
    this.drawParticles(-1);

    // 3) 内部星云（裁剪进球内）
    this.drawNebula();

    // 4) 玻璃球壳
    this.drawShell(pulseE);

    // 5) 星座连线 + 6) 节点
    this.drawConstellations();

    // 7) 轨道环：后半在球后已画过？—— 统一在球前画前半、球后画后半
    this.drawOrbits();

    // 8) 星尘 · 前半
    this.drawParticles(1);

    // 9) 能量核心 + 涟漪
    this.drawCore(pulseE);

    this.coreHit = { x: this.cx, y: this.cy, r: R * 0.34 };
  }

  /** 星尘：side = -1 后半 / 1 前半 */
  private drawParticles(side: number) {
    const ctx = this.ctx;
    const list = this.particles;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const pr = this.project(p);
      if ((pr.z < 0 ? -1 : 1) !== side) continue;
      const depth = (pr.z + 1) / 2; // 0 远 1 近
      // 闪烁（reducedMotion 时静止）
      const tw = this.reduced ? 1 : 0.62 + 0.38 * Math.sin(this.t * p.tw + p.ph);
      const a = (side > 0 ? 0.16 + depth * 0.6 : 0.06 + depth * 0.22) * tw;
      const rad = p.r * (side > 0 ? 1.5 : 1.1) * pr.s * 1.15;
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.fillStyle = ASTRO_PALETTE.white;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, Math.max(0.4, rad), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 球内星云：裁剪进圆，投影 4 团渐变 */
  private drawNebula() {
    const ctx = this.ctx;
    const R = this.R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R * 0.985, 0, TAU);
    ctx.clip();

    // 球内底色（透出「内部有东西」的深紫）
    ctx.fillStyle = 'rgba(48,38,92,0.5)';
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R, 0, TAU);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.nebula.length; i++) {
      const b = this.nebula[i];
      const pr = this.project(b);
      const rad = b.r * R;
      if (rad <= 0) continue;
      const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, rad);
      const depth = (pr.z + 1) / 2;
      const a = b.a * (0.42 + depth * 0.58);
      g.addColorStop(0, 'rgba(' + b.rgb + ',' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + b.rgb + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, rad, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 玻璃球壳：基底 + rim 边缘光 + specular + clearcoat 高光 */
  private drawShell(pulseE: number) {
    const ctx = this.ctx;
    const R = this.R;
    ctx.save();

    // 基底（transmission 观感）
    ctx.fillStyle = this.cache.base;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R, 0, TAU);
    ctx.fill();

    // rim 边缘光：用描边 + 线性渐变模拟 ior 折射亮边
    ctx.strokeStyle = this.cache.rim;
    ctx.lineWidth = Math.max(1.2, R * 0.022);
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R * 0.995, 0, TAU);
    ctx.stroke();

    // specular 主高光（roughness 0.18 → 小而锐）
    const sx = this.cx - R * 0.36;
    const sy = this.cy - R * 0.42;
    const sr = R * 0.30;
    const spec = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    spec.addColorStop(0, 'rgba(247,247,255,0.62)');
    spec.addColorStop(0.42, 'rgba(196,190,255,0.20)');
    spec.addColorStop(1, 'rgba(196,190,255,0)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, TAU);
    ctx.fill();

    // clearcoat 次高光（clearcoat 0.8 / roughness 0.15 → 更小更亮）
    const c2x = this.cx - R * 0.16;
    const c2y = this.cy - R * 0.66;
    const c2r = R * 0.16;
    const cc = ctx.createRadialGradient(c2x, c2y, 0, c2x, c2y, c2r);
    cc.addColorStop(0, 'rgba(255,255,255,0.78)');
    cc.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cc;
    ctx.beginPath();
    ctx.arc(c2x, c2y, c2r, 0, TAU);
    ctx.fill();

    // 脉冲：球壳额外一圈高光
    if (pulseE > 0.01) {
      ctx.strokeStyle = 'rgba(247,247,255,' + (0.5 * pulseE).toFixed(3) + ')';
      ctx.lineWidth = R * 0.03 * pulseE;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, R * (1 + 0.05 * pulseE), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 星座：先画后半连线/节点，再画前半，保证前后遮挡正确 */
  private drawConstellations() {
    const ctx = this.ctx;
    const cons = this.cons;
    if (!cons.length) return;

    const proj = cons.map((c) => this.project(c.p));

    // —— 后半（z<0）连线 ——
    ctx.save();
    ctx.lineWidth = 1;
    for (let pass = 0; pass < 2; pass++) {
      const back = pass === 0;
      ctx.strokeStyle = back ? 'rgba(159,163,196,0.14)' : 'rgba(139,124,246,0.42)';
      for (let i = 0; i < cons.length; i++) {
        if ((proj[i].z < 0) !== back) continue;
        const near = cons[i].near;
        for (let k = 0; k < near.length; k++) {
          const j = near[k];
          if (j <= i) continue; // 避免重复连线
          if ((proj[j].z < 0) !== back) continue;
          ctx.beginPath();
          ctx.moveTo(proj[i].x, proj[i].y);
          ctx.lineTo(proj[j].x, proj[j].y);
          ctx.stroke();
        }
      }
    }

    // —— 节点（后半先画、前半后画）——
    this.hit = [];
    for (let pass = 0; pass < 2; pass++) {
      const back = pass === 0;
      for (let i = 0; i < cons.length; i++) {
        const c = cons[i];
        const pr = proj[i];
        if ((pr.z < 0) !== back) continue;
        const isActive = c.key === this.activeKey;
        const depth = (pr.z + 1) / 2;
        const e = Math.max(0, Math.min(1, c.energy));
        // 尺寸：基础 + 能量 + 激活加成（刻意做小，细星点才像星图，大了会糊成白球）
        const rad = (1.5 + e * 2.2 + (isActive ? 2.2 : 0)) * pr.s * (back ? 0.8 : 1);
        const alpha = (back ? 0.32 : 0.95) * (0.5 + depth * 0.5);

        // 光晕
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, rad * 3.6);
        const col = isActive ? '216,182,106' : '139,124,246';
        g.addColorStop(0, 'rgba(' + col + ',' + (0.42 * alpha).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + col + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, rad * 3.6, 0, TAU);
        ctx.fill();

        // 星点
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = isActive
          ? 'rgba(216,182,106,' + alpha.toFixed(3) + ')'
          : 'rgba(247,247,255,' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, Math.max(1, rad), 0, TAU);
        ctx.fill();

        // 激活节点：加一圈环
        if (isActive) {
          ctx.strokeStyle = 'rgba(216,182,106,' + (0.6 * alpha).toFixed(3) + ')';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, rad * 2.2, 0, TAU);
          ctx.stroke();
        }

        // 命中缓存（前半优先，半径给足便于点按）
        this.hit.push({ key: c.key, x: pr.x, y: pr.y, r: Math.max(18, rad * 3) });
      }
    }
    ctx.restore();
  }

  /** 轨道环：采样圆上 72 点 → 投影 → 分前后半段描边 */
  private drawOrbits() {
    const ctx = this.ctx;
    const SEG = 72;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let oi = 0; oi < this.orbits.length; oi++) {
      const o = this.orbits[oi];
      const ca = Math.cos(o.tiltA);
      const sa = Math.sin(o.tiltA);
      const cb = Math.cos(o.tiltB);
      const sb = Math.sin(o.tiltB);

      const pts: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i <= SEG; i++) {
        const ang = (i / SEG) * TAU + o.phase;
        // 局部圆
        const lx = Math.cos(ang) * o.radius;
        const ly = Math.sin(ang) * o.radius;
        // 先绕 Z 倾斜
        const zx = lx * cb - ly * sb;
        const zy = lx * sb + ly * cb;
        // 再绕 X 倾斜
        const p: Vec3 = { x: zx, y: zy * ca, z: zy * sa };
        pts.push(this.project(p));
      }

      // 后半（z<0）与前半分别成段描边
      for (let pass = 0; pass < 2; pass++) {
        const back = pass === 0;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if ((p.z < 0) !== back) { started = false; continue; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
        const a = o.alpha * (back ? 0.5 : 1);
        ctx.strokeStyle = 'rgba(' + o.rgb + ',' + a.toFixed(3) + ')';
        ctx.lineWidth = o.width * (back ? 0.8 : 1);
        ctx.stroke();
      }

      // 轨道上的一个亮点（让「在转」更可感）
      const headAng = o.phase * 2.4;
      const hx = Math.cos(headAng) * o.radius;
      const hy = Math.sin(headAng) * o.radius;
      const pz: Vec3 = { x: hx * cb - hy * sb, y: (hx * sb + hy * cb) * ca, z: (hx * sb + hy * cb) * sa };
      const hp = this.project(pz);
      if (hp.z >= 0) {
        const hg = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 7 * hp.s);
        hg.addColorStop(0, 'rgba(' + o.rgb + ',0.9)');
        hg.addColorStop(1, 'rgba(' + o.rgb + ',0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 7 * hp.s, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** 能量核心：呼吸 + 脉冲扩散 + 轨道波纹 */
  private drawCore(pulseE: number) {
    const ctx = this.ctx;
    const R = this.R;
    const s = this.coreScale * (1 + pulseE * 0.42);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.translate(this.cx, this.cy);
    ctx.scale(s, s);
    ctx.translate(-this.cx, -this.cy);
    ctx.fillStyle = this.cache.core;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, R * 0.46, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 涟漪：脉冲时向外扩散的圆环（需求五：轨道产生波纹）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.ripples.length; i++) {
      const p = this.ripples[i].p;
      const rad = R * (0.3 + p * 2.0);
      const a = (1 - p) * 0.42;
      ctx.strokeStyle = 'rgba(216,182,106,' + a.toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, R * 0.02 * (1 - p));
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, rad, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}
