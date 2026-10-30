// utils/love-orb.ts
// LoveOrb · 爱情能量球（可独立复用的渲染引擎，Canvas 2D，零第三方依赖）
//
// 它应该是一颗「属于两个人的小型爱情星球」：
//   透明水晶球体 + 内部发光爱心 + 照片记忆节点 + 星尘 + 粒子 + 轨道 + 光晕 + 玻璃折射 + 环境光
// 交互：
//   持续缓慢自转 / 拖拽跟随 + 松手惯性 / 点击节点自动转到该节点 → 放大 → 照片浮出
//   新增回忆时 flyIn()：粒子飞向球体 → 环绕 → 进入 → 成为新节点
//   升级时 playLevelUp()：快速旋转 → 内部光线增强 → 粒子爆发 → 爱心变形 → 新形态
//
// 为什么不用 WebGL / three.js：
//   小程序分包有体积红线（three.js 压缩后仍数百 KB），且 iOS / Android / 开发者工具的
//   WebGL 表现差异大、真机调试成本高。本场景元素有限（球面节点 + 粒子 + 光带），
//   Canvas 2D 手动做球面投影 + 深度排序完全够用，也更容易把移动端稳在 45-60 FPS。
//   若将来确需 WebGL，只需替换本文件的渲染层，对外 API 保持不变。
//
// 性能策略（移动端 45-60 FPS）：
//   · 自适应画质：连续采样 FPS，掉帧自动降级（粒子数 / 光斑 / 内层环境），回升再恢复
//   · 图片懒加载：只给「朝向镜头」的节点加载图，且并发受限、缓存有上限
//   · 渐变缓存：静态渐变（星云 / 光斑）只建一次，尺寸或配色变化才重建

/* ============================ 对外类型 ============================ */

export interface OrbItem {
  id: string;
  emoji: string;
  /** 记忆卡片主调（按标签给色；缺省用球体主色） */
  tint?: string;
  /** 记忆照片（cloud:// fileID 或本地路径） */
  photo?: string;
}

/** 球体的一种「材质 × 环境」形态 */
/* ============================ 回忆 → 球体节点 ============================ */

/** 回忆标签 → 节点 emoji（抽到此处，供回忆页与能量站共用一份映射） */
export const MEM_TAG_EMOJI: Record<string, string> = {
  '第一次': '🌟', '见面': '💋', '旅行': '✈️', '生日': '🎂', '纪念日': '💍',
  '吵架和好': '🌈', '日常': '🍬', '礼物': '🎁', '视频': '📹', '约定': '🤞'
};

/** 回忆标签 → 玻璃卡片主调 */
export const MEM_TAG_TINT: Record<string, string> = {
  '第一次': '#FFB3C8', '见面': '#FF8FB1', '旅行': '#8FB8FF', '生日': '#FFCF8F',
  '纪念日': '#C69BFF', '吵架和好': '#8FE3D0', '日常': '#FFD9A1', '礼物': '#FFA9D4',
  '视频': '#9BD5FF', '约定': '#D6B3FF'
};

export function memEmoji(tags?: string[]): string {
  return MEM_TAG_EMOJI[(tags || [])[0]] || '💗';
}
export function memTint(tags?: string[]): string {
  return MEM_TAG_TINT[(tags || [])[0]] || '';
}

/**
 * 回忆列表 → 球体节点列表。
 * 只依赖结构子集（id/tags/photos），页面传 Memory[] 也能直接用，
 * 这样能量站和回忆页不必各写一份转换。
 */
export function toOrbItems(
  list: { id: string; tags?: string[]; photos?: string[] }[]
): Required<OrbItem>[] {
  return (list || []).map((m) => ({
    id: m.id,
    emoji: memEmoji(m.tags),
    tint: memTint(m.tags),
    photo: (m.photos && m.photos[0]) || ''
  }));
}

export interface OrbForm {
  idx: number;
  name: string;
  env: string;
  /** 主色 / 辅色 / 高光色 */
  c1: string;
  c2: string;
  c3: string;
  /** 环绕光带数量 */
  rings: number;
  /** 星尘粒子数 */
  dust: number;
  /** 背景星点数 */
  stars: number;
  /** 水晶质感爱心（有切面） */
  crystal: boolean;
  /** 双心轨道（第二颗小心环绕） */
  twin: boolean;
  /** 内部星尘银河 */
  galaxy: boolean;
  /** 月光花瓣 */
  petal: boolean;
  /** 极光 */
  aurora: boolean;
  /** 月亮光晕 */
  moon: boolean;
  /** 完整爱情宇宙（全部特征叠加） */
  cosmos: boolean;
  desc: string;
}

/* ============================ 七种形态 ============================ */

export const ORB_FORMS: OrbForm[] = [
  {
    idx: 1, name: '透明粉色玻璃', env: '透明玻璃',
    c1: '#FFB3C8', c2: '#FF9EC4', c3: '#FFE7F0',
    rings: 1, dust: 34, stars: 40,
    crystal: false, twin: false, galaxy: false, petal: false, aurora: false, moon: false, cosmos: false,
    desc: '最开始的样子，通透、脆弱、需要被小心对待'
  },
  {
    idx: 2, name: '水晶爱心', env: '水晶折射',
    c1: '#FF8FC0', c2: '#C9A7FF', c3: '#FFEAF6',
    rings: 2, dust: 42, stars: 46,
    crystal: true, twin: false, galaxy: false, petal: false, aurora: false, moon: false, cosmos: false,
    desc: '心开始有了切面，每一面都映着你们'
  },
  {
    idx: 3, name: '双心轨道', env: '双心公转',
    c1: '#FF7FB0', c2: '#B98BE0', c3: '#FFD9A8',
    rings: 2, dust: 48, stars: 50,
    crystal: true, twin: true, galaxy: false, petal: false, aurora: false, moon: false, cosmos: false,
    desc: '两颗心各自转，却共用同一条轨道'
  },
  {
    idx: 4, name: '星尘银河', env: '银河旋臂',
    c1: '#A78BFA', c2: '#F07BC0', c3: '#FFE9B8',
    rings: 3, dust: 58, stars: 58,
    crystal: true, twin: true, galaxy: true, petal: false, aurora: false, moon: true, cosmos: false,
    desc: '回忆多到开始自转，聚成一条银河'
  },
  {
    idx: 5, name: '月光花瓣', env: '月华花雨',
    c1: '#FFD9E6', c2: '#C7B8FF', c3: '#FFF6DE',
    rings: 3, dust: 52, stars: 56,
    crystal: true, twin: true, galaxy: false, petal: true, aurora: false, moon: true, cosmos: false,
    desc: '月光下花瓣慢慢落在球里，很轻很轻'
  },
  {
    idx: 6, name: '极光星球', env: '极光帷幕',
    c1: '#6FE3C8', c2: '#7FB0F0', c3: '#DDFFF4',
    rings: 3, dust: 60, stars: 60,
    crystal: true, twin: true, galaxy: false, petal: false, aurora: true, moon: true, cosmos: false,
    desc: '冷色的极光把整颗球裹住，安静但很亮'
  },
  {
    idx: 7, name: '完整爱情宇宙', env: '宇宙全貌',
    c1: '#FF9AD5', c2: '#8E7BF0', c3: '#FFD86B',
    rings: 4, dust: 68, stars: 68,
    crystal: true, twin: true, galaxy: true, petal: true, aurora: true, moon: true, cosmos: true,
    desc: '银河、极光、花瓣都在里面了，这是你们的宇宙'
  }
];

/** 能量等级（1~10，见 love-energy.LEVELS）→ 球体形态（1~7） */
const LV_TO_FORM = [1, 2, 3, 4, 5, 5, 6, 6, 7, 7];

export function orbFormOf(lv: number): OrbForm {
  const l = Math.max(1, Math.min(10, Math.floor(Number(lv) || 1)));
  const f = LV_TO_FORM[l - 1] || 1;
  return ORB_FORMS[f - 1] || ORB_FORMS[0];
}

/* ============================ 内部类型 ============================ */

interface P3 { x: number; y: number; z: number; }

interface Projected {
  id: string;
  emoji: string;
  tint: string;
  photo: string;
  sx: number;
  sy: number;
  scale: number;
  depth: number;
}

interface Star { x: number; y: number; r: number; ph: number; sp: number; a: number; }
interface Heart { x: number; y: number; ph: number; sp: number; sz: number; a: number; }
interface Bokeh { x: number; y: number; r: number; a: number; }
interface Petal { ang: number; rr: number; sz: number; ph: number; sp: number; rot: number; }
interface Burst { x: number; y: number; vx: number; vy: number; life: number; max: number; sz: number; col: number[]; }
interface Comet {
  id: string;
  item: OrbItem;
  sx: number; sy: number;
  tx: number; ty: number;
  ang0: number;
  t: number;
  dur: number;
  trail: number[];
}

type RGB = [number, number, number];

const Q_HIGH = 2;
const Q_MID = 1;
const Q_LOW = 0;

/* ============================ 工具 ============================ */

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
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function easeOut(t: number): number { return 1 - Math.pow(1 - t, 3); }
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
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
/** 心形路径（cx,cy 为中心，s 为半宽） */
function heartPath(ctx: any, cx: number, cy: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.92);
  ctx.bezierCurveTo(cx - s * 1.55, cy - s * 0.22, cx - s * 0.74, cy - s * 1.08, cx, cy - s * 0.30);
  ctx.bezierCurveTo(cx + s * 0.74, cy - s * 1.08, cx + s * 1.55, cy - s * 0.22, cx, cy + s * 0.92);
  ctx.closePath();
}
function dist2(a: any, b: any): number {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

/* ============================ 引擎 ============================ */

export interface OrbHooks {
  onSelect?: (id: string) => void;
  onArrive?: (id: string) => void;
  onLevelUp?: (lv: number, form: OrbForm) => void;
}

export class LoveOrb {
  private canvas: any;
  private ctx: any;
  private dpr = 1;
  private w = 300;
  private h = 300;
  private raf = 0;
  private running = false;

  /* —— 数据与形态 —— */
  private items: OrbItem[] = [];
  private base: P3[] = [];
  private form: OrbForm = ORB_FORMS[0];
  private primary = '#FF7F9C';
  private accent = '#FFC77D';
  private rgb1: RGB = [255, 127, 156];   // 形态主色
  private rgb2: RGB = [255, 158, 196];   // 形态辅色
  private rgb3: RGB = [255, 231, 240];   // 高光色
  private rgbA: RGB = [255, 199, 125];   // 皮肤强调色（用于星点/柔焦）

  /* —— 旋转状态 —— */
  private yaw = -0.5;
  private pitch = 0.16;
  private velYaw = 0;
  private velPitch = 0;
  private zoom = 1;
  private autoSpeed = 0.0026;
  private dragging = false;
  private pinching = false;
  private lastX = 0;
  private lastY = 0;
  private lastDist = 0;
  private movedDist = 0;

  /* —— 交互状态 —— */
  private hoverId = '';
  private selectedId = '';
  private projected: Projected[] = [];
  /** 自动旋转到某个节点的目标角度 */
  private spinTo: { yaw: number; pitch: number; t: number; dur: number; id: string } | null = null;
  /** 节点聚焦放大进度 0~1 */
  private focusT = 0;
  private focusId = '';

  /* —— 时间 —— */
  private t = 0;
  private lastTs = 0;

  /* —— 场景元素 —— */
  private stars: Star[] = [];
  private dust: P3[] = [];
  private hearts: Heart[] = [];
  private bokeh: Bokeh[] = [];
  private petals: Petal[] = [];
  private bursts: Burst[] = [];
  private comets: Comet[] = [];

  /* —— 缓存 —— */
  private gradCache: Record<string, any> = {};

  /* —— 陀螺仪 —— */
  private tiltX = 0;
  private tiltY = 0;

  /* —— 升级动画 —— */
  private lvu: { t: number; dur: number; emitted: boolean; lv: number } | null = null;

  /* —— 画质 —— */
  private quality = Q_HIGH;
  private fpsFrames = 0;
  private fpsAt = 0;
  private qualityLock = 0;

  /* —— 偏好 —— */
  private reduced = false;
  private paused = false;

  /* —— 图片懒加载 —— */
  private imgCache: Record<string, any> = {};
  private imgPending: Record<string, boolean> = {};
  private imgQueue: string[] = [];
  private imgLoading = 0;
  private imgOrder: string[] = [];

  private hooks: OrbHooks;

  constructor(canvas: any, hooks?: OrbHooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks || {};
    this.seedScene();
    this.applyForm(ORB_FORMS[0]);
  }

  /* ====================== 场景初始化 ====================== */

  private seedScene() {
    const rand = (n: number) => Math.random() * n;
    this.stars = [];
    for (let i = 0; i < 68; i++) {
      this.stars.push({
        x: rand(1), y: rand(1), r: 0.5 + rand(1.4),
        ph: rand(Math.PI * 2), sp: 0.015 + rand(0.03), a: 0.35 + rand(0.6)
      });
    }
    this.dust = fibonacci(68);
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
    this.petals = [];
    for (let i = 0; i < 10; i++) {
      this.petals.push({
        ang: rand(Math.PI * 2), rr: 0.25 + rand(0.62), sz: 5 + rand(7),
        ph: rand(Math.PI * 2), sp: 0.004 + rand(0.006), rot: rand(Math.PI * 2)
      });
    }
  }

  /* ====================== 对外配置 ====================== */

  setColors(primary: string, accent: string) {
    this.primary = primary || '#FF7F9C';
    this.accent = accent || '#FFC77D';
    this.rgbA = hexToRgb(this.accent);
    this.gradCache = {};
    if (!this.running) this.renderOnce();
  }

  setLevel(lv: number) {
    const f = orbFormOf(lv);
    if (f.idx === this.form.idx) return;
    this.applyForm(f);
    if (!this.running) this.renderOnce();
  }

  setItems(items: OrbItem[]) {
    this.items = items || [];
    this.base = fibonacci(this.items.length);
    if (this.selectedId && !this.items.some((i) => i.id === this.selectedId)) this.selectedId = '';
    if (!this.running) this.renderOnce();
  }

  /** 无障碍：关闭动效（不自动旋转、不飘心、粒子减半、按需重绘） */
  setReducedMotion(on: boolean) {
    this.reduced = !!on;
    if (this.reduced) {
      this.stop();
      this.renderOnce();
    } else if (!this.running) {
      this.start();
    }
  }

  setPaused(p: boolean) {
    this.paused = !!p;
    if (this.paused) this.stop();
    else if (!this.reduced && !this.running) this.start();
  }

  private applyForm(f: OrbForm) {
    this.form = f;
    this.rgb1 = hexToRgb(f.c1);
    this.rgb2 = hexToRgb(f.c2);
    this.rgb3 = hexToRgb(f.c3);
    this.gradCache = {};
  }

  resize(wCss: number, hCss: number, dpr: number) {
    this.w = Math.max(1, wCss);
    this.h = Math.max(1, hCss);
    this.dpr = dpr || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (this.ctx && this.ctx.setTransform) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.gradCache = {};
    if (!this.running) this.renderOnce();
  }

  /* ====================== 生命周期 ====================== */

  start() {
    if (this.running || this.reduced) return;
    this.running = true;
    this.lastTs = 0;
    const loop = (ts?: number) => {
      if (!this.running) return;
      const now = ts || Date.now();
      if (this.lastTs) {
        const dt = clamp(now - this.lastTs, 6, 48);
        this.t += dt / 16.667;
        if (!this.paused) this.measureFps(now, dt);
      }
      this.lastTs = now;
      this.render();
      this.raf = this.canvas.requestAnimationFrame(loop);
    };
    this.raf = this.canvas.requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf && this.canvas.cancelAnimationFrame) this.canvas.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.imgCache = {};
    this.imgPending = {};
    this.imgQueue = [];
    this.gradCache = {};
  }

  /** 停帧模式下手动重绘一帧（reduced motion / 暂停时用） */
  renderOnce() {
    this.lastTs = 0;
    this.render();
  }

  /* ====================== 自适应画质 ====================== */

  private measureFps(now: number, dt: number) {
    this.fpsFrames++;
    if (!this.fpsAt) { this.fpsAt = now; return; }
    if (this.fpsFrames < 45) return;
    const fps = (this.fpsFrames * 1000) / Math.max(1, now - this.fpsAt);
    this.fpsFrames = 0;
    this.fpsAt = now;
    if (now - this.qualityLock < 2500) return;   // 迟滞，避免来回抖动
    if (fps < 42 && this.quality > Q_LOW) {
      this.quality--;
      this.qualityLock = now;
      this.gradCache = {};
    } else if (fps > 56 && this.quality < Q_HIGH) {
      this.quality++;
      this.qualityLock = now;
      this.gradCache = {};
    }
  }

  private dustCount(): number {
    const n = this.form.dust;
    if (this.quality === Q_HIGH) return n;
    if (this.quality === Q_MID) return Math.round(n * 0.62);
    return Math.round(n * 0.35);
  }
  private starCount(): number {
    const n = this.form.stars;
    if (this.quality === Q_HIGH) return n;
    if (this.quality === Q_MID) return Math.round(n * 0.72);
    return Math.round(n * 0.5);
  }
  /** 昂贵的柔光/内层特效在降级时关掉 */
  private fancy(): boolean { return this.quality >= Q_MID; }

  /* ====================== 输入：触摸 / 鼠标 / 滚轮 / 陀螺仪 ====================== */

  onTouchStart(e: any) {
    const ts = (e && e.touches) || [];
    if (ts.length >= 2) {
      this.pinching = true;
      this.lastDist = dist2(ts[0], ts[1]);
    } else if (ts.length === 1) {
      this.beginDrag(ts[0].x, ts[0].y);
    }
  }

  onTouchMove(e: any) {
    const ts = (e && e.touches) || [];
    if (this.pinching && ts.length >= 2) {
      const d = dist2(ts[0], ts[1]);
      if (this.lastDist > 0) this.zoom = clamp(this.zoom * (d / this.lastDist), 0.55, 2.4);
      this.lastDist = d;
      this.gradCache = {};
      return;
    }
    if (this.dragging && ts.length === 1) this.moveDrag(ts[0].x, ts[0].y);
  }

  onTouchEnd(e: any) {
    const ts = (e && e.touches) || [];
    if (ts.length === 0) {
      this.pinching = false;
      if (this.dragging && this.movedDist < 9) this.tapAt(this.lastX, this.lastY);
      this.dragging = false;
      this.hoverId = '';
    } else if (ts.length === 1) {
      this.pinching = false;
      this.lastX = ts[0].x;
      this.lastY = ts[0].y;
      this.lastDist = 0;
    }
  }

  /** 桌面端（PC 微信 / 开发者工具）鼠标输入；不支持时这些事件根本不会触发 */
  onMouseDown(e: any) {
    const p = mousePt(e);
    if (!p) return;
    this.beginDrag(p.x, p.y);
  }
  onMouseMove(e: any) {
    const p = mousePt(e);
    if (!p) return;
    if (this.dragging) this.moveDrag(p.x, p.y);
    else this.hoverId = this.pick(p.x, p.y);
  }
  onMouseUp(e: any) {
    if (!this.dragging) return;
    const p = mousePt(e);
    if (this.movedDist < 9 && p) this.tapAt(p.x, p.y);
    this.dragging = false;
    this.hoverId = '';
  }
  onWheel(delta: number) {
    this.zoom = clamp(this.zoom * (delta < 0 ? 1.08 : 0.93), 0.55, 2.4);
    this.gradCache = {};
  }

  onDeviceMotion(e: any) {
    if (!e) return;
    if (typeof e.gamma === 'number') this.tiltX = clamp(e.gamma / 55, -1, 1);
    if (typeof e.beta === 'number') this.tiltY = clamp((e.beta - 40) / 55, -1, 1);
  }

  private beginDrag(x: number, y: number) {
    this.dragging = true;
    this.spinTo = null;          // 手指接管，取消自动旋转
    this.lastX = x;
    this.lastY = y;
    this.movedDist = 0;
    this.velYaw = 0;
    this.velPitch = 0;
    this.hoverId = this.pick(x, y);
  }

  private moveDrag(x: number, y: number) {
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    this.movedDist += Math.abs(dx) + Math.abs(dy);
    this.yaw += dx * 0.008;
    this.pitch = clamp(this.pitch + dy * 0.006, -1.2, 1.2);
    this.velYaw = dx * 0.008;      // 记录瞬时角速度 → 松手后惯性
    this.velPitch = dy * 0.006 * 0.6;
    this.hoverId = this.pick(x, y);
    if (this.reduced) this.renderOnce();
  }

  /** 轻点：命中节点则「转到该节点 → 放大 → 浮出详情」 */
  private tapAt(x: number, y: number) {
    const id = this.pick(x, y);
    if (id) this.focusTo(id);
  }

  /**
   * 自动旋转到指定节点，让它正对镜头；转到位后节点放大并回调 onSelect。
   * 命中判定用的是当前这一帧的投影结果，所以点哪颗就是哪颗。
   */
  focusTo(id: string) {
    const idx = this.indexOf(id);
    if (idx < 0) return;
    const b = this.base[idx];
    // 目标俯仰：让点的 y 分量归零；目标偏航：让 x 分量归零且 z 取正
    const targetPitch = Math.atan2(b.y, b.z);
    const s = Math.hypot(b.y, b.z);
    let targetYaw = Math.atan2(-b.x, s);
    // 取与当前角度最接近的等价角，保证走近路
    const twoPi = Math.PI * 2;
    while (targetYaw - this.yaw > Math.PI) targetYaw -= twoPi;
    while (targetYaw - this.yaw < -Math.PI) targetYaw += twoPi;
    this.selectedId = id;
    this.focusId = id;
    this.focusT = 0;
    this.spinTo = { yaw: targetYaw, pitch: clamp(targetPitch, -1.0, 1.0), t: 0, dur: 0.62, id };
    if (this.reduced) {
      this.yaw = targetYaw;
      this.pitch = clamp(targetPitch, -1.0, 1.0);
      this.focusT = 1;
      this.spinTo = null;
      this.renderOnce();
      if (this.hooks.onSelect) this.hooks.onSelect(id);
    }
  }

  private indexOf(id: string): number {
    for (let i = 0; i < this.items.length; i++) if (this.items[i].id === id) return i;
    return -1;
  }

  /* ====================== 飞入动画 ====================== */

  /**
   * 新增回忆：粒子从 (x,y) 飞向球体 → 环绕 → 进入内部 → 成为新节点。
   * @param item 即将成为节点的回忆（id 必须已存在，落地后由调用方决定何时写入数据源）
   * @param x,y 起点坐标（画布内坐标，由组件把视口坐标换算后传入）
   */
  flyIn(item: OrbItem, x: number, y: number) {
    if (!item || !item.id) return;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const R = this.orbRadius();
    const ang0 = Math.random() * Math.PI * 2;
    this.comets.push({
      id: item.id,
      item,
      sx: x, sy: y,
      tx: cx, ty: cy,
      ang0,
      t: 0,
      dur: 2.0,
      trail: []
    });
    if (this.reduced) {
      // 无障碍模式：不走动画，直接落地
      this.landComet(this.comets[this.comets.length - 1]);
      this.comets = [];
      return;
    }
    if (!this.running) this.start();
  }

  private orbRadius(): number {
    return Math.min(this.w * 0.42, this.h * 0.44) * this.zoom;
  }

  private landComet(c: Comet) {
    this.items = this.items.concat([c.item]);
    this.base = fibonacci(this.items.length);
    if (this.hooks.onArrive) this.hooks.onArrive(c.id);
    if (!this.running) this.renderOnce();
  }

  /* ====================== 升级动画 ====================== */

  /**
   * 升级：快速旋转 → 内部光线增强 → 粒子向外爆发 → 爱心变形 → 新形态出现。
   * 在「新形态出现」这一刻回调 onLevelUp，方便页面同步弹出等级横幅。
   */
  playLevelUp(lv: number) {
    const f = orbFormOf(lv);
    this.lvu = { t: 0, dur: 2.4, emitted: false, lv };
    this.pendingForm = f;
    if (this.reduced) {
      this.applyForm(f);
      this.lvu = null;
      this.pendingForm = null;
      if (this.hooks.onLevelUp) this.hooks.onLevelUp(lv, f);
      this.renderOnce();
      return;
    }
    if (!this.running) this.start();
  }

  private pendingForm: OrbForm | null = null;

  /* ====================== 渲染主循环 ====================== */

  private render() {
    const ctx = this.ctx;
    if (!ctx) return;

    if (!this.reduced) {
      this.updateMotion();
      this.updateComets();
      this.updateLevelUp();
    }

    const cx = this.w / 2 + this.tiltX * 6;
    const cy = this.h / 2 + this.tiltY * 5;
    const R = this.orbRadius();
    const breath = this.reduced ? 1 : 1 + Math.sin(this.t * 0.022) * 0.022;

    this.drawSpace(cx, cy, R);
    this.drawRings(cx, cy, R, false);
    this.drawInside(cx, cy, R * breath);
    this.drawNodes(cx, cy, R);
    this.drawGlass(cx, cy, R * breath);
    this.drawRings(cx, cy, R, true);
    this.drawForeground(cx, cy, R);
  }

  /** 自转 / 惯性 / 自动旋转到节点 */
  private updateMotion() {
    if (this.spinTo) {
      const s = this.spinTo;
      s.t += 1 / 60;
      const p = clamp(s.t / s.dur, 0, 1);
      const k = easeInOut(p);
      // 从按下目标那一刻的角度出发做缓动，保证轨迹连续、不会跳变
      this.yaw = this.spinFromYaw + (s.yaw - this.spinFromYaw) * k;
      this.pitch = this.spinFromPitch + (s.pitch - this.spinFromPitch) * k;
      if (p >= 1) {
        this.spinTo = null;
        this.spinK = 0;
        if (this.hooks.onSelect) this.hooks.onSelect(s.id);
      }
      return;
    }
    this.spinK = 0;
    this.spinFromYaw = this.yaw;
    this.spinFromPitch = this.pitch;

    if (!this.dragging && !this.pinching) {
      let spin = this.autoSpeed;
      if (this.lvu) spin += this.lvuSpin();
      this.yaw += spin + this.velYaw;
      this.velYaw *= 0.94;
      if (Math.abs(this.velYaw) < 0.00035) this.velYaw = 0;

      this.pitch += this.velPitch;
      this.velPitch *= 0.9;
      if (Math.abs(this.velPitch) < 0.0002) this.velPitch = 0;
      this.pitch += (0.16 - this.pitch) * 0.008;
      this.pitch = clamp(this.pitch, -1.2, 1.2);
    }

    if (this.focusId) this.focusT = Math.min(1, this.focusT + 0.05);

    // 升级时的粒子爆发
    if (this.bursts.length) {
      for (let i = this.bursts.length - 1; i >= 0; i--) {
        const b = this.bursts[i];
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= 0.965;
        b.vy *= 0.965;
        b.life -= 1;
        if (b.life <= 0) this.bursts.splice(i, 1);
      }
    }
  }

  private spinK = 0;
  private spinFromYaw = 0;
  private spinFromPitch = 0;

  /** 升级期间额外转速（前段极快，后段回落） */
  private lvuSpin(): number {
    if (!this.lvu) return 0;
    const p = clamp(this.lvu.t / this.lvu.dur, 0, 1);
    if (p > 0.62) return 0;
    return 0.075 * (1 - p / 0.62);
  }

  private updateComets() {
    if (!this.comets.length) return;
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.t += 1 / 60;
      if (c.t >= c.dur) {
        this.comets.splice(i, 1);
        this.landComet(c);
      }
    }
  }

  private updateLevelUp() {
    const L = this.lvu;
    if (!L) return;
    L.t += 1 / 60;
    const p = clamp(L.t / L.dur, 0, 1);

    // 内部光线增强（供内部渲染读取）
    this.lvuGlow = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5 * 0.35;

    // 粒子向外爆发
    if (p > 0.26 && p < 0.5 && Math.random() < 0.55) {
      const n = this.quality === Q_LOW ? 1 : 3;
      for (let i = 0; i < n; i++) this.spawnBurst();
    }
    // 新形态出现
    if (p >= 0.62 && this.pendingForm) {
      this.applyForm(this.pendingForm);
      this.pendingForm = null;
    }
    if (p >= 0.7 && !L.emitted) {
      L.emitted = true;
      if (this.hooks.onLevelUp) this.hooks.onLevelUp(L.lv, this.form);
    }
    if (p >= 1) {
      this.lvu = null;
      this.lvuGlow = 0;
      this.gradCache = {};
    }
  }

  private lvuGlow = 0;

  private spawnBurst() {
    const R = this.orbRadius();
    const a = Math.random() * Math.PI * 2;
    const sp = 1.6 + Math.random() * 4.2;
    const life = 34 + Math.random() * 26;
    this.bursts.push({
      x: 0, y: 0,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life,
      max: life,
      sz: 1.2 + Math.random() * 2.6,
      col: Math.random() < 0.5 ? this.rgb1 : this.rgb3
    });
    if (this.bursts.length > 90) this.bursts.shift();
    void R;
  }

  /* ====================== 背景：深空 / 星云 / 星点 / 星尘 ====================== */

  private drawSpace(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const key = 'space';
    let g = this.gradCache[key];
    if (!g) {
      const top = mix(this.rgb1, [7, 9, 28], 0.74);
      const bot = mix(this.rgb2, [18, 10, 42], 0.82);
      g = ctx.createLinearGradient(0, 0, this.w * 0.35, this.h);
      g.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
      g.addColorStop(0.45, '#0A0A26');
      g.addColorStop(1, `rgb(${bot[0]},${bot[1]},${bot[2]})`);
      this.gradCache[key] = g;
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // 球体后方星云辉光
    let neb = this.gradCache['neb'];
    if (!neb) {
      neb = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 2.3);
      neb.addColorStop(0, rgba(this.rgb1, 0.26));
      neb.addColorStop(0.45, rgba(this.rgb2, 0.11));
      neb.addColorStop(1, 'rgba(0,0,0,0)');
      this.gradCache['neb'] = neb;
    }
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, this.w, this.h);

    // 柔焦光斑（景深）：降级时跳过
    if (this.fancy()) {
      let bl = this.gradCache['bokeh'];
      if (!bl) {
        bl = this.bokeh.map((bk) => {
          const x = bk.x * this.w;
          const y = bk.y * this.h;
          const gg = ctx.createRadialGradient(x, y, 0, x, y, bk.r);
          gg.addColorStop(0, rgba(this.rgbA, bk.a));
          gg.addColorStop(1, 'rgba(0,0,0,0)');
          return { x, y, r: bk.r, g: gg };
        });
        this.gradCache['bokeh'] = bl;
      }
      for (let i = 0; i < bl.length; i++) {
        ctx.fillStyle = bl[i].g;
        ctx.beginPath();
        ctx.arc(bl[i].x, bl[i].y, bl[i].r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 闪烁星点
    const sn = this.starCount();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < sn && i < this.stars.length; i++) {
      const st = this.stars[i];
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.t * st.sp + st.ph));
      ctx.globalAlpha = st.a * tw;
      ctx.beginPath();
      ctx.arc(st.x * this.w, st.y * this.h, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.drawDust(cx, cy, R);
  }

  private drawDust(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const n = Math.min(this.dustCount(), this.dust.length);
    const drift = this.reduced ? 0 : this.t * 0.004;
    for (let i = 0; i < n; i++) {
      const d = this.dust[i];
      const r3 = rotateY(rotateX(d, this.pitch * 0.6), this.yaw * 0.5 + drift);
      const depth = (r3.z + 1) / 2;
      const rr = R * 1.55 * (1 / (1.7 - r3.z * 0.5));
      const x = cx + r3.x * rr;
      const y = cy - r3.y * rr;
      const sz = 0.7 + depth * 1.9;
      ctx.globalAlpha = 0.08 + depth * 0.5;
      ctx.fillStyle = i % 4 === 0 ? rgba(this.rgb3, 1) : 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ====================== 环绕光带 ====================== */

  private drawRings(cx: number, cy: number, R: number, front: boolean) {
    const ctx = this.ctx;
    const n = Math.min(this.form.rings, 3);
    const specs = [
      { rx: 1.30, ry: 0.28, rot: -0.34, sp: 1.0, col: this.rgb1 },
      { rx: 1.12, ry: 0.21, rot: 0.52, sp: -1.35, col: this.rgb2 },
      { rx: 1.44, ry: 0.36, rot: -0.12, sp: 0.72, col: this.rgb3 }
    ];
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < n; i++) {
      const rg = specs[i];
      ctx.save();
      ctx.rotate(rg.rot + (this.reduced ? 0 : this.t * 0.0016 * rg.sp));
      ctx.strokeStyle = rgba(rg.col, front ? 0.34 : 0.15);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (front) ctx.ellipse(0, 0, R * rg.rx, R * rg.ry, 0, 0, Math.PI);
      else ctx.ellipse(0, 0, R * rg.rx, R * rg.ry, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 第七形态：额外一圈更外层的宇宙环
    if (this.form.cosmos) {
      ctx.save();
      ctx.rotate(this.reduced ? 0.4 : this.t * 0.0011);
      ctx.strokeStyle = rgba(this.rgb2, front ? 0.2 : 0.1);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      if (front) ctx.ellipse(0, 0, R * 1.62, R * 0.44, 0, 0, Math.PI);
      else ctx.ellipse(0, 0, R * 1.62, R * 0.44, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ====================== 球体内部：环境 + 发光爱心 ====================== */

  private drawInside(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    // 内部薄雾底
    let baseG = this.gradCache['inbase'];
    if (!baseG) {
      baseG = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
      baseG.addColorStop(0, rgba(this.rgb1, 0.09 + this.lvuGlow * 0.22));
      baseG.addColorStop(0.65, 'rgba(255,255,255,0.045)');
      baseG.addColorStop(1, 'rgba(255,255,255,0.015)');
      this.gradCache['inbase'] = baseG;
    }
    ctx.fillStyle = baseG;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    if (this.form.moon) this.drawMoon(cx, cy, R);
    if (this.form.galaxy && this.fancy()) this.drawGalaxy(cx, cy, R);
    if (this.form.aurora && this.fancy()) this.drawAurora(cx, cy, R);
    if (this.form.petal && this.fancy()) this.drawPetals(cx, cy, R);

    this.drawCore(cx, cy, R);
    ctx.restore();
  }

  /** 月亮光晕 */
  private drawMoon(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const mx = cx - R * 0.46;
    const my = cy - R * 0.5;
    let g = this.gradCache['moon'];
    if (!g) {
      g = ctx.createRadialGradient(mx, my, 0, mx, my, R * 0.5);
      g.addColorStop(0, rgba(this.rgb3, 0.5));
      g.addColorStop(0.35, rgba(this.rgb3, 0.14));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      this.gradCache['moon'] = g;
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, my, R * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(this.rgb3, 0.55);
    ctx.beginPath();
    ctx.arc(mx, my, R * 0.085, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 银河旋臂（内部星尘） */
  private drawGalaxy(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const rot = this.reduced ? 0.6 : this.t * 0.01;
    const pts = this.quality === Q_LOW ? 26 : 46;
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < pts; i++) {
        const f = i / pts;
        const ang = rot + arm * Math.PI + f * 3.1;
        const rr = R * (0.14 + f * 0.82);
        const x = cx + Math.cos(ang) * rr;
        const y = cy + Math.sin(ang) * rr * 0.5 + Math.sin(f * 3 + arm) * R * 0.06;
        const a = (1 - f) * 0.55;
        ctx.globalAlpha = a;
        ctx.fillStyle = i % 3 === 0 ? rgba(this.rgb3, 1) : rgba(this.rgb2, 1);
        ctx.beginPath();
        ctx.arc(x, y, 0.7 + (1 - f) * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 极光帷幕 */
  private drawAurora(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const bands = this.quality === Q_LOW ? 1 : 3;
    for (let b = 0; b < bands; b++) {
      const ph = this.reduced ? b * 1.3 : this.t * 0.018 + b * 1.7;
      const yBase = cy - R * 0.35 + b * R * 0.32;
      const g = ctx.createLinearGradient(cx - R, yBase, cx + R, yBase);
      g.addColorStop(0, rgba(this.rgb1, 0));
      g.addColorStop(0.3, rgba(this.rgb1, 0.3));
      g.addColorStop(0.6, rgba(this.rgb3, 0.34));
      g.addColorStop(1, rgba(this.rgb2, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - R, yBase + R * 0.5);
      for (let i = 0; i <= 16; i++) {
        const x = cx - R + (i / 16) * R * 2;
        const y = yBase + Math.sin(ph + i * 0.42) * R * 0.14 + Math.sin(ph * 0.6 + i * 0.2) * R * 0.06;
        ctx.lineTo(x, y);
      }
      for (let i = 16; i >= 0; i--) {
        const x = cx - R + (i / 16) * R * 2;
        const y = yBase + R * 0.22 + Math.sin(ph + i * 0.42 + 0.6) * R * 0.12;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  /** 月光花瓣（在球内缓慢飘落） */
  private drawPetals(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const n = this.quality === Q_LOW ? 4 : this.petals.length;
    for (let i = 0; i < n; i++) {
      const p = this.petals[i];
      const ang = p.ang + (this.reduced ? 0 : this.t * p.sp);
      const rr = R * p.rr;
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr * 0.8 + Math.sin((this.reduced ? 0 : this.t) * 0.02 + p.ph) * R * 0.05;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot + (this.reduced ? 0 : this.t * 0.006));
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = rgba(this.rgb3, 0.85);
      ctx.beginPath();
      ctx.moveTo(0, -p.sz);
      ctx.bezierCurveTo(p.sz * 0.85, -p.sz * 0.5, p.sz * 0.7, p.sz * 0.6, 0, p.sz);
      ctx.bezierCurveTo(-p.sz * 0.7, p.sz * 0.6, -p.sz * 0.85, -p.sz * 0.5, 0, -p.sz);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** 球心：发光爱心（水晶切面 / 双心轨道 / 升级变形） */
  private drawCore(cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const glow = 1 + this.lvuGlow * 1.4;

    // 心跳呼吸 + 升级时的变形脉动
    let beat = 1;
    if (!this.reduced) {
      beat = 0.94 + Math.sin(this.t * 0.055) * 0.06;
      if (this.lvu) {
        const p = clamp(this.lvu.t / this.lvu.dur, 0, 1);
        if (p > 0.42 && p < 0.78) {
          const k = (p - 0.42) / 0.36;
          beat *= 1 + Math.sin(k * Math.PI) * 0.55;
        }
      }
    }
    const s = R * 0.30 * beat;

    // 外发光
    const gg = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 2.9 * glow);
    gg.addColorStop(0, rgba(this.rgb1, 0.5 * Math.min(1.6, glow)));
    gg.addColorStop(0.4, rgba(this.rgb2, 0.2 * Math.min(1.6, glow)));
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 2.9 * glow, 0, Math.PI * 2);
    ctx.fill();

    // 心体
    const sg = ctx.createRadialGradient(cx - s * 0.3, cy - s * 0.35, s * 0.08, cx, cy, s * 1.3);
    sg.addColorStop(0, 'rgba(255,255,255,0.95)');
    sg.addColorStop(0.35, rgba(this.rgb1, 0.95));
    sg.addColorStop(1, rgba(shade(this.rgb1, 0.55), 0.9));
    ctx.fillStyle = sg;
    heartPath(ctx, cx, cy, s);
    ctx.fill();

    // 水晶形态：切面高光
    if (this.form.crystal) {
      ctx.save();
      heartPath(ctx, cx, cy, s);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(0.7, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 1.0);
      ctx.lineTo(cx - s * 0.55, cy + s * 0.5);
      ctx.moveTo(cx, cy - s * 1.0);
      ctx.lineTo(cx + s * 0.55, cy + s * 0.5);
      ctx.moveTo(cx - s * 0.9, cy - s * 0.35);
      ctx.lineTo(cx + s * 0.9, cy - s * 0.35);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = rgba(this.rgb3, 0.7);
      ctx.lineWidth = Math.max(0.8, s * 0.06);
      heartPath(ctx, cx, cy, s);
      ctx.stroke();
    }

    // 双心轨道：第二颗小心绕着转
    if (this.form.twin || this.form.cosmos) {
      const a = this.reduced ? 1.2 : this.t * 0.03;
      const ox = cx + Math.cos(a) * R * 0.46;
      const oy = cy + Math.sin(a) * R * 0.3;
      const os = R * 0.11 * (0.9 + Math.sin(this.t * 0.055 + 0.8) * 0.1);
      const og = ctx.createRadialGradient(ox - os * 0.3, oy - os * 0.3, 0, ox, oy, os * 1.4);
      og.addColorStop(0, 'rgba(255,255,255,0.9)');
      og.addColorStop(1, rgba(this.rgb2, 0.9));
      ctx.fillStyle = og;
      heartPath(ctx, ox, oy, os);
      ctx.fill();
    }
  }

  /* ====================== 记忆节点 ====================== */

  private drawNodes(cx: number, cy: number, R: number) {
    const pts = this.project(cx, cy, R);
    // 背面节点先画，正面后画（近大远小 + 前后遮挡）
    for (let i = 0; i < pts.length; i++) this.drawNode(pts[i], cx, cy);
  }

  private project(cx: number, cy: number, R: number): Projected[] {
    const out: Projected[] = [];
    const n = this.base.length;
    const yaw = this.yaw + this.tiltX * 0.12;
    const pitch = this.pitch + this.tiltY * 0.1;
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
        photo: item.photo || '',
        sx: cx + r3.x * rr,
        sy: cy - r3.y * rr,
        scale: 0.5 + depth * 0.8,
        depth
      });
    }
    out.sort((a, b) => a.depth - b.depth);
    this.projected = out;
    this.pumpImages(out);
    return out;
  }

  /**
   * 图片懒加载：只给「朝向镜头 / 被选中」的节点请求图片，
   * 并发最多 2 个，缓存上限 24 张，超出淘汰最久未用的。
   */
  private pumpImages(pts: Projected[]) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p.photo) continue;
      if (this.imgCache[p.photo]) continue;
      const wanted = p.depth > 0.24 || p.id === this.selectedId || p.id === this.focusId;
      if (!wanted) continue;
      if (this.imgPending[p.photo]) continue;
      if (this.imgQueue.indexOf(p.photo) >= 0) continue;
      this.imgQueue.push(p.photo);
    }
    while (this.imgLoading < 2 && this.imgQueue.length) {
      const url = this.imgQueue.shift();
      if (url) this.loadImage(url);
    }
  }

  private loadImage(url: string) {
    if (this.imgPending[url]) return;
    this.imgPending[url] = true;
    this.imgLoading++;
    const done = (ok: boolean) => {
      this.imgLoading--;
      if (!ok) delete this.imgPending[url];
      if (!this.running) this.renderOnce();
    };
    const attach = (src: string) => {
      try {
        const img = this.canvas.createImage();
        img.onload = () => {
          this.imgCache[url] = img;
          this.imgOrder.push(url);
          if (this.imgOrder.length > 24) {
            const old = this.imgOrder.shift();
            if (old && old !== url) delete this.imgCache[old];
          }
          delete this.imgPending[url];
          done(true);
        };
        img.onerror = () => done(false);
        img.src = src;
      } catch (e) {
        done(false);
      }
    };
    // cloud:// 在部分基础库的 canvas 里不认，先落成本地临时文件
    if (typeof url === 'string' && url.indexOf('cloud://') === 0) {
      const wxc: any = typeof wx !== 'undefined' ? (wx as any) : null;
      if (wxc && wxc.cloud && typeof wxc.cloud.downloadFile === 'function') {
        wxc.cloud.downloadFile({
          fileID: url,
          success: (r: any) => attach((r && r.tempFilePath) || url),
          fail: () => done(false)
        });
        return;
      }
    }
    attach(url);
  }

  private drawNode(p: Projected, cx: number, cy: number) {
    const ctx = this.ctx;
    const isSel = p.id === this.selectedId;
    const isHover = p.id === this.hoverId;
    const isFocus = p.id === this.focusId;

    // 背面且未选中：走廉价路径（发光点 + 小图标），省掉渐变与高光
    if (p.depth < 0.16 && !isSel && !isFocus) {
      const s2 = 9 * p.scale;
      ctx.globalAlpha = 0.18 + p.depth * 0.5;
      ctx.fillStyle = rgba(hexToRgb(p.tint), 0.9);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, s2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    let boost = 1;
    if (isFocus) boost = 1 + this.focusT * 0.85;
    else if (isSel || isHover) boost = 1.22;

    const s = 30 * p.scale * boost;
    const tint = hexToRgb(p.tint);
    const x = p.sx;
    const y = p.sy;

    ctx.save();
    ctx.globalAlpha = 0.32 + p.depth * 0.68;

    // 外发光
    if (p.depth > 0.3 || isSel || isFocus) {
      const g = ctx.createRadialGradient(x, y, s * 0.25, x, y, s * 1.8);
      g.addColorStop(0, rgba(tint, isFocus ? 0.72 : 0.5));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, s * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 微微弯曲：按离球心的横向偏移做一点旋转，模拟贴在球面上
    const bend = ((x - cx) / Math.max(1, this.orbRadius())) * 0.38;
    ctx.translate(x, y);
    ctx.rotate(bend * 0.35);
    ctx.translate(-x, -y);

    const w = s * 1.28;
    const h = s * 1.06;
    const rx = x - w / 2;
    const ry = y - h / 2;
    const rad = s * 0.36;
    const img = p.photo ? this.imgCache[p.photo] : null;

    roundRect(ctx, rx, ry, w, h, rad);
    if (img && img.width) {
      // 照片节点：图片铺满卡片（cover），外加白边与柔光
      ctx.save();
      ctx.clip();
      const iw = img.width;
      const ih = img.height;
      const k = Math.max(w / iw, h / ih);
      const dw = iw * k;
      const dh = ih * k;
      ctx.drawImage(img, rx + (w - dw) / 2, ry + (h - dh) / 2, dw, dh);
      const hl = ctx.createLinearGradient(rx, ry, rx, ry + h * 0.5);
      hl.addColorStop(0, 'rgba(255,255,255,0.35)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.fillRect(rx, ry, w, h * 0.5);
      ctx.restore();
    } else {
      // 无图：玻璃碎片卡片 + emoji
      const cg = ctx.createLinearGradient(rx, ry, rx + w, ry + h);
      cg.addColorStop(0, 'rgba(255,255,255,0.94)');
      cg.addColorStop(0.42, rgba(tint, 0.88));
      cg.addColorStop(1, rgba(shade(tint, 0.6), 0.92));
      ctx.fillStyle = cg;
      ctx.fill();
      const emoji = p.emoji || '💗';
      ctx.font = `${Math.round(s * 0.8)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, x, y + 1);
      // 有图但还在加载：右下角一个小点提示
      if (p.photo) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(rx + w - rad * 0.6, ry + h - rad * 0.6, Math.max(1, s * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.lineWidth = Math.max(0.8, s * 0.055);
    ctx.strokeStyle = `rgba(255,255,255,${0.45 + p.depth * 0.45})`;
    ctx.stroke();

    if (isSel || isFocus) {
      ctx.strokeStyle = isFocus ? rgba(this.rgb3, 0.95) : 'rgba(255,255,255,0.92)';
      ctx.lineWidth = isFocus ? 2.4 : 2;
      roundRect(ctx, rx - 5, ry - 5, w + 10, h + 10, rad + 3);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ====================== 玻璃前表面 ====================== */

  private drawGlass(cx: number, cy: number, R: number) {
    const ctx = this.ctx;

    // 体积 bloom
    const bloom = ctx.createRadialGradient(cx, cy, R * 0.84, cx, cy, R * 1.5);
    bloom.addColorStop(0, rgba(this.rgb1, 0.26 + this.lvuGlow * 0.25));
    bloom.addColorStop(0.5, rgba(this.rgb2, 0.1));
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 菲涅尔：中心透明，越靠边越亮
    const rim = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(0.6, rgba(this.rgb1, 0.08));
    rim.addColorStop(0.86, 'rgba(255,255,255,0.34)');
    rim.addColorStop(1, rgba(this.rgb1, 0.55));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 玻璃反射（只出现在球内）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    const spec = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.44, 0, cx - R * 0.4, cy - R * 0.44, R * 0.66);
    spec.addColorStop(0, 'rgba(255,255,255,0.6)');
    spec.addColorStop(0.35, 'rgba(255,255,255,0.14)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    const refl = ctx.createRadialGradient(cx + R * 0.48, cy + R * 0.5, 0, cx + R * 0.48, cy + R * 0.5, R * 0.55);
    refl.addColorStop(0, rgba(this.rgbA, 0.3));
    refl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = refl;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx - R * 0.44, cy - R * 0.48, R * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ====================== 前景：漂浮爱心 / 飞入粒子 / 爆发 / 升级闪光 ====================== */

  private drawForeground(cx: number, cy: number, R: number) {
    const ctx = this.ctx;

    // 漂浮小爱心（无障碍模式下不飘）
    if (!this.reduced) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hn = this.quality === Q_LOW ? 3 : this.hearts.length;
      for (let i = 0; i < hn; i++) {
        const hp = this.hearts[i];
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

    // 飞入粒子
    for (let i = 0; i < this.comets.length; i++) this.drawComet(this.comets[i], cx, cy, R);

    // 升级爆发粒子
    if (this.bursts.length) {
      for (let i = 0; i < this.bursts.length; i++) {
        const b = this.bursts[i];
        const a = clamp(b.life / b.max, 0, 1);
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = rgba(b.col as RGB, 1);
        ctx.beginPath();
        ctx.arc(cx + b.x, cy + b.y, b.sz * (0.5 + a * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 升级白闪
    if (this.lvu) {
      const p = clamp(this.lvu.t / this.lvu.dur, 0, 1);
      if (p > 0.62 && p < 0.9) {
        const a = (1 - (p - 0.62) / 0.28) * 0.5;
        const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.2);
        fg.addColorStop(0, rgba(this.rgb3, a));
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, this.w, this.h);
      }
    }
  }

  private drawComet(c: Comet, cx: number, cy: number, R: number) {
    const ctx = this.ctx;
    const p = clamp(c.t / c.dur, 0, 1);
    let x = 0;
    let y = 0;
    let rOrb = 1.45 * R;
    let alpha = 1;
    let sz = 9;

    if (p < 0.42) {
      // 阶段一：从起点飞到轨道外圈（二次贝塞尔，走一条弧线）
      const k = easeOut(p / 0.42);
      const ang = c.ang0;
      const ex = cx + Math.cos(ang) * rOrb;
      const ey = cy + Math.sin(ang) * rOrb * 0.55;
      const mx = (c.sx + ex) / 2 + (cy - c.sy) * 0.25;
      const my = (c.sy + ey) / 2 - (ex - c.sx) * 0.25;
      const u = 1 - k;
      x = u * u * c.sx + 2 * u * k * mx + k * k * ex;
      y = u * u * c.sy + 2 * u * k * my + k * k * ey;
      sz = 12 - k * 5;
    } else if (p < 0.86) {
      // 阶段二：环绕球体旋转，同时收紧半径
      const k = (p - 0.42) / 0.44;
      const ang = c.ang0 + k * Math.PI * 2.2;
      const rr = rOrb + (R * 0.34 - rOrb) * k;
      x = cx + Math.cos(ang) * rr;
      y = cy + Math.sin(ang) * rr * 0.55 + Math.sin(k * 6) * R * 0.05;
      sz = 7 + k * 3;
    } else {
      // 阶段三：进入球体内部并消散
      const k = (p - 0.86) / 0.14;
      const ang = c.ang0 + Math.PI * 2.2;
      const rr = R * 0.34 * (1 - k);
      x = cx + Math.cos(ang) * rr;
      y = cy + Math.sin(ang) * rr * 0.55;
      alpha = 1 - k;
      sz = 10 + k * 14;
    }

    // 尾迹
    c.trail.push(x, y);
    if (c.trail.length > 16) c.trail.splice(0, 2);
    for (let i = 0; i < c.trail.length - 2; i += 2) {
      const f = i / Math.max(2, c.trail.length - 2);
      ctx.globalAlpha = alpha * f * 0.35;
      ctx.fillStyle = rgba(this.rgb3, 1);
      ctx.beginPath();
      ctx.arc(c.trail[i], c.trail[i + 1], sz * 0.35 * f, 0, Math.PI * 2);
      ctx.fill();
    }

    // 发光粒子本体
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 2.4);
    g.addColorStop(0, rgba(this.rgb3, 0.95));
    g.addColorStop(0.35, rgba(this.rgb1, 0.6));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, sz * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgba(this.rgb3, 0.98);
    ctx.beginPath();
    ctx.arc(x, y, sz * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    void R;
  }

  /* ====================== 命中测试 ====================== */

  private pick(x: number, y: number): string {
    let best = '';
    let bestD = 9999;
    for (let i = this.projected.length - 1; i >= 0; i--) {
      const p = this.projected[i];
      if (p.depth < 0.2) continue;      // 背面的点不响应点击
      const d = Math.hypot(p.sx - x, p.sy - y);
      const hitR = 30 * p.scale * 0.95 + 8;
      if (d < hitR && d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    return best;
  }
}

/* ====================== 鼠标事件坐标归一化 ====================== */

function mousePt(e: any): { x: number; y: number } | null {
  if (!e) return null;
  const d = e.detail || {};
  const x = typeof d.x === 'number' ? d.x : (typeof d.clientX === 'number' ? d.clientX : NaN);
  const y = typeof d.y === 'number' ? d.y : (typeof d.clientY === 'number' ? d.clientY : NaN);
  if (isNaN(x) || isNaN(y)) return null;
  return { x, y };
}
