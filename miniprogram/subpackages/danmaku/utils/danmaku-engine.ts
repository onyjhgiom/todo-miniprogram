// subpackages/danmaku/utils/danmaku-engine.ts
// 弹幕引擎：纯计算层，负责「什么时候出、在哪出、怎么动、怎么花」。
//
// 分层约定：
//   - 本文件不引用任何 wx.* API，也不持有 Canvas 对象，可以直接被 Node 加载跑单测；
//   - 画什么由调用方（渲染组件）通过 DrawCtx 最小接口下发，引擎只管节奏与几何。
//
// 性能约定：
//   - measureText 结果按「文本+字体+字号+粗细」缓存，循环播放时命中率极高；
//   - 粒子走对象池，避免每帧产生上百个短命对象触发 GC 抖动；
//   - quality='low' 时关掉拖尾/粒子/发光，由渲染组件按实测帧率自动打开。
import type { DanmakuConfig, DanmakuItem, TextSize } from './danmaku-types';
import { SIZE_PX, FONT_FAMILY, SPEED_PX_PER_SEC } from './danmaku-presets';
import type { SafeInsets } from './danmaku-orientation';
import { ZERO_INSETS, mergeInsets, clampInsets } from './danmaku-orientation';

/* ==================== 最小绘图接口 ====================
 * 只声明引擎真正用到的成员。微信 CanvasRenderingContext2D 结构上完全兼容，
 * 单测时传一个记账用的假 ctx 即可。
 * ==================================================== */

export interface GradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface TextMetricsLike {
  width: number;
}

export interface EngineImage {
  width: number;
  height: number;
}

export interface DrawCtx {
  canvas?: { width: number; height: number };
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, s?: number, e?: number, ccw?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  scale(x: number, y: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  measureText(t: string): TextMetricsLike;
  fillText(t: string, x: number, y: number): void;
  strokeText(t: string, x: number, y: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradientLike;
  drawImage(img: unknown, dx: number, dy: number, dw?: number, dh?: number): void;
}

/* ==================== 运行时数据结构 ==================== */

export type ResolvedMode = 'scroll' | 'pop' | 'blink';

export interface TrailPoint {
  x: number;
  y: number;
}

export interface Particle {
  alive: boolean;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  rot: number;
  spin: number;
  color: string;
}

export interface ActiveItem {
  item: DanmakuItem;
  /** 解析后的动画模式（random 已在生成期落定，避免每帧再随机） */
  mode: ResolvedMode;
  /** 文本宽高（CSS px） */
  w: number;
  h: number;
  fontSize: number;
  color: string;
  /** 当前左边界 x（动画过程中会变） */
  x: number;
  /** 当前基线中心 y（动画过程中会变） */
  y: number;
  /**
   * 滚动速度（px/ms）。用「位置增量」而不是「按总时长归一化」推进，
   * 这样屏幕旋转导致视口变化时，只改剩余寿命、不动当前位置与速度，画面不会跳变。
   */
  vx: number;
  /** 静止模式的锚点坐标：弹出位移以它为基准，避免每帧在原值上累加导致漂移 */
  homeX: number;
  homeY: number;
  /** 已存活 ms */
  age: number;
  /** 总寿命 ms */
  life: number;
  /** 行号 */
  row: number;
  /** 当前不透明度 0~1 */
  alpha: number;
  /** 表情包图片（已加载好才有值） */
  img: EngineImage | null;
  trails: TrailPoint[];
  particles: Particle[];
  done: boolean;
}

export interface Band {
  top: number;
  bottom: number;
}

export type Quality = 'high' | 'low';

export interface EngineOptions {
  width: number;
  height: number;
  /** 安全区避让（刘海/状态栏/页面浮层控件）。缺省为零避让，行为与旧版一致。 */
  insets?: Partial<SafeInsets> | null;
  /** 条件：渲染组件传入的背景图（已加载） */
  bgImage?: EngineImage | null;
  quality?: Quality;
  /** 是否显示背景（独立播放页 true，做页面浮层时 false） */
  drawBackground?: boolean;
  /** 是否循环（默认 true，投屏/聚会场景需要一直转） */
  loop?: boolean;
}

const DENSITY_MAX = { sparse: 6, normal: 14, dense: 28 };
const DENSITY_GAP = { sparse: 900, normal: 420, dense: 170 };

/** 行高系数：字号 * 1.75，保证大小字号都不粘行 */
const ROW_FACTOR = 1.75;
/** 同一行相邻两条的最小水平间距 */
const ROW_GAP = 36;

/* ==================== 简易可复现随机数 ====================
 * 用可播种的 LCG，便于单测里锁定行为；不追求密码学强度。
 * ==================================================== */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 88675123;
  return function next(): number {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class DanmakuEngine {
  private width = 0;
  private height = 0;
  /** 安全区避让（画布局部坐标） */
  private insets: SafeInsets = { ...ZERO_INSETS };
  private config: DanmakuConfig | null = null;
  private playing = false;
  private elapsed = 0;
  private quality: Quality = 'high';
  private drawBackground = true;
  private loop = true;
  private bgImage: EngineImage | null = null;

  /** 待出场队列游标 */
  private cursor = 0;
  /** 活动条目 */
  private active: ActiveItem[] = [];
  /** 条目池 */
  private pool: ActiveItem[] = [];
  /** 粒子池 */
  private particlePool: Particle[] = [];
  /** 滚动模式：每行下一次可接受同模式新条目的时间 */
  private rowFreeAt: number[] = [];
  /**
   * 每行的模式归属：'' 空闲 / 'scroll' / 'static'。
   * 滚动项按「上一条走够一个身位」的时间差依次入场；
   * 静止项（弹出/闪烁）靠 x 区间判重。两种规则互斥——
   * 若在同一个轨道里混用，滚动的会在飞过去的过程中压到静止的身上，
   * 所以这里给行打上模式标记：行内有活动项时只允许同模式进入，清空后才回收为公共行。
   */
  private rowMode: ('scroll' | 'static' | '')[] = [];
  /** 每行当前活动条数，用于判断该行是否彻底清空 */
  private rowAlive: number[] = [];
  private rowCount = 1;
  private lastSpawnAt = -99999;
  private rng: () => number = makeRandom(Date.now());

  /** measureText 缓存：key → 宽度 */
  private widthCache: Record<string, number> = {};

  constructor(opts?: Partial<EngineOptions>) {
    if (opts) {
      this.width = opts.width || 0;
      this.height = opts.height || 0;
      this.insets = mergeInsets(ZERO_INSETS, opts.insets || null);
      this.quality = opts.quality || 'high';
      this.drawBackground = opts.drawBackground !== false;
      this.loop = opts.loop !== false;
      this.bgImage = opts.bgImage || null;
    }
  }

  /* ---------- 配置与视口 ---------- */

  /**
   * 更新视口。`insets` 为可选的安全区避让（画布局部坐标）。
   *
   * 与旧版的关键差异：视口变化（旋转 / 全屏切换 / 键盘弹出）**不再清空**活动条目，
   * 而是原地重排轨道并保留每条弹幕的进度，从而做到「旋转前后渲染连续、不闪断」。
   */
  setViewport(width: number, height: number, insets?: Partial<SafeInsets> | null): void {
    const next = clampInsets(mergeInsets(this.insets, insets || null), width, height);
    const changed =
      width !== this.width ||
      height !== this.height ||
      next.top !== this.insets.top ||
      next.bottom !== this.insets.bottom ||
      next.left !== this.insets.left ||
      next.right !== this.insets.right;
    this.width = width;
    this.height = height;
    this.insets = next;
    if (changed) this.applyRows(true);
  }

  setBgImage(img: EngineImage | null): void {
    this.bgImage = img;
  }

  setQuality(q: Quality): void {
    if (this.quality === q) return;
    this.quality = q;
    if (q === 'low') {
      // 降级时立刻清掉高开销资产，避免用户在半帧里看到残影
      this.active.forEach((a) => {
        a.trails.length = 0;
        this.releaseParticles(a);
      });
    }
  }

  getQuality(): Quality {
    return this.quality;
  }

  setConfig(cfg: DanmakuConfig | null): void {
    const isSame = this.config && cfg && this.config.id === cfg.id;
    this.config = cfg;
    if (!isSame) this.reset();
    // 换配置意味着字号/区域可能变了，行高与行数必须重算
    this.widthCache = {};
    this.applyRows(true);
  }

  get activeCount(): number {
    return this.active.length;
  }

  /**
   * 只读快照，供自检脚本校验「同行不重叠 / 是否落在安全区」这类几何不变量。
   * 业务侧不要用它来改 DOM——拿到的是内部对象引用。
   */
  getActiveSnapshot(): readonly ActiveItem[] {
    return this.active;
  }

  /* ---------- 播放控制 ---------- */

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** 复位重新开跑 */
  reset(): void {
    this.active.forEach((a) => this.recycle(a));
    this.active.length = 0;
    this.cursor = 0;
    this.elapsed = 0;
    this.lastSpawnAt = -99999;
    this.widthCache = {};
    this.rowFreeAt = this.rowFreeAt.map(() => 0);
    this.rowAlive = this.rowAlive.map(() => 0);
    this.rowMode = this.rowMode.map(() => '');
  }

  /* ---------- 行排布 ---------- */

  private get styleMs(): number {
    return SIZE_PX[this.config?.style?.size || 'medium'] || SIZE_PX.medium;
  }

  private rowHeight(): number {
    return Math.max(18, this.styleMs * ROW_FACTOR);
  }

  /** 横向行程左界（= 左侧避让） */
  private get travelLeft(): number {
    return Math.max(0, this.insets.left);
  }

  /** 横向行程右界（= 画布宽 - 右侧避让），至少给 1px 以免退化成零宽 */
  private get travelRight(): number {
    return Math.max(this.travelLeft + 1, this.width - Math.max(0, this.insets.right));
  }

  /**
   * 重算行几何。
   * preserve=true 时**保留活动条目**（旋转/全屏切换路径），仅重排行号与坐标；
   * preserve=false 时清空重来（目前仅配置切换走这里，那时活动条目已被 reset 清空）。
   */
  private applyRows(preserve: boolean): void {
    if (!this.config || this.height <= 0) return;
    const band = this.band();
    const rowH = this.rowHeight();
    const n = Math.max(1, Math.floor((band.bottom - band.top) / rowH));
    const prevCount = this.rowCount;

    this.rowCount = n;
    this.rowFreeAt = new Array(n).fill(0);
    this.rowMode = new Array<('scroll' | 'static' | '')>(n).fill('');
    this.rowAlive = new Array(n).fill(0);

    if (!this.active.length) return;

    if (!preserve) {
      this.active.forEach((a) => this.recycle(a));
      this.active.length = 0;
      return;
    }
    this.reflowActive(prevCount, n, rowH, band);
  }

  /**
   * 视口变化后原地重排：行号按新旧轨道数比例映射，尽量保持「原来在上面的还在上面」；
   * 同轨模式冲突时向后找一条空轨；滚动项保持当前位置与速度、只重算剩余寿命，
   * 静止项则把横向锚点夹回新行程内。全程不销毁条目 —— 这是「旋转不闪断」的关键。
   */
  private reflowActive(prevCount: number, nextCount: number, rowH: number, band: Band): void {
    const now = this.elapsed;
    const travelLeft = this.travelLeft;
    const travelRight = this.travelRight;
    const speedPx = SPEED_PX_PER_SEC[this.config?.anim?.speed || 'normal'] / 1000;

    for (const a of this.active) {
      const want: 'scroll' | 'static' = a.mode === 'scroll' ? 'scroll' : 'static';

      // 1) 行号比例重映射（prevCount 可能是 0/1，兜底集中在第 0 行）
      let row = 0;
      if (prevCount > 1) row = Math.round(((a.row + 0.5) * nextCount) / prevCount - 0.5);
      if (!isFinite(row)) row = 0;
      row = Math.max(0, Math.min(nextCount - 1, row));

      // 2) 同轨模式冲突时向后找空轨；实在找不到就留在原轨（宁可轻微重叠，也不要让弹幕消失）
      let placed = -1;
      for (let k = 0; k < nextCount; k++) {
        const r = (row + k) % nextCount;
        const mode = this.rowMode[r] || '';
        if (mode === '' || mode === want) {
          placed = r;
          break;
        }
      }
      if (placed < 0) placed = row;

      a.row = placed;
      this.rowMode[placed] = want;
      this.rowAlive[placed] = (this.rowAlive[placed] || 0) + 1;

      // 3) 纵向重新落位
      const cy = band.top + rowH * (placed + 0.5);
      a.y = cy;
      a.homeY = cy;

      // 4) 横向
      if (a.mode === 'scroll') {
        a.vx = a.vx || Math.max(speedPx, 0.01);
        // 屏变窄导致条目落在可视右界之外时拉回，避免长时间「看不见但占着轨道」
        if (a.x > travelRight) a.x = travelRight;
        a.life = a.age + Math.max(200, (a.x + a.w - travelLeft) / Math.max(a.vx, 0.01));
        // 重算该轨道的「下一条可入场时刻」：等这一条尾巴让出 ROW_GAP
        const freeAt = now + Math.max(0, a.x + a.w + ROW_GAP - travelRight) / Math.max(a.vx, 0.01);
        this.rowFreeAt[placed] = Math.max(this.rowFreeAt[placed] || 0, freeAt);
      } else {
        const span = Math.max(0, travelRight - travelLeft - a.w - 16);
        const lo = travelLeft + 8;
        const hi = lo + span;
        a.homeX = Math.max(lo, Math.min(a.homeX, hi));
        a.x = a.homeX;
        this.rowFreeAt[placed] = 0;
      }
    }
  }

  /**
   * 计算可显示区域上下边界（已扣除安全区避让）。
   * 区域模式（full/top/bottom/custom）的百分比基于**安全区内的可用高度**，
   * 这样旋转后「上半屏」依旧是「安全区内的上半屏」，不会被刘海吃掉一截。
   */
  band(): Band {
    const h = this.height;
    const safeTop = Math.max(0, this.insets.top);
    const safeBottom = Math.max(safeTop, h - Math.max(0, this.insets.bottom));
    const layout = this.config?.layout;
    if (!layout) return { top: safeTop, bottom: safeBottom };
    const safeH = safeBottom - safeTop;
    if (layout.area === 'top') return { top: safeTop, bottom: safeTop + safeH / 2 };
    if (layout.area === 'bottom') return { top: safeTop + safeH / 2, bottom: safeBottom };
    if (layout.area === 'custom') {
      const t = safeTop + (safeH * layout.areaTop) / 100;
      const b = safeTop + (safeH * layout.areaBottom) / 100;
      return { top: Math.min(t, b), bottom: Math.max(t, b) };
    }
    return { top: safeTop, bottom: safeBottom };
  }

  private rowCenterY(row: number): number {
    const band = this.band();
    const rowH = this.rowHeight();
    return band.top + rowH * (row + 0.5);
  }

  /** 视口/安全区/轨道数的只读快照，供自检与「方向徽标」类 UI 使用 */
  viewportInfo(): {
    width: number;
    height: number;
    insets: SafeInsets;
    rowCount: number;
    band: Band;
    travelLeft: number;
    travelRight: number;
  } {
    return {
      width: this.width,
      height: this.height,
      insets: { ...this.insets },
      rowCount: this.rowCount,
      band: this.band(),
      travelLeft: this.travelLeft,
      travelRight: this.travelRight
    };
  }

  /* ---------- 主循环 ---------- */

  /**
   * 推进一帧。dt 为真实经过毫秒数（由调用方按 rAF 时间戳算，避免掉帧时动画整体变慢或跳变）。
   */
  update(dt: number): void {
    if (!this.playing || !this.config) return;
    // 单帧最大步长限制：切后台回来时 dt 可能是几秒，不夹住会让弹幕瞬移
    const step = Math.min(Math.max(dt, 0), 50);
    this.elapsed += step;

    this.spawnDue();

    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.age += step;
      this.advance(a, step);
      if (a.age >= a.life) {
        this.recycle(a);
        this.active.splice(i, 1);
      }
    }
  }

  private items(): DanmakuItem[] {
    return this.config?.items || [];
  }

  /** 是否还能继续出场（非 loop 模式下播完一轮即止） */
  private hasNext(): boolean {
    if (this.items().length === 0) return false;
    if (this.loop) return true;
    return this.cursor < this.items().length;
  }

  private nextItem(): DanmakuItem | null {
    const list = this.items();
    if (!list.length) return null;
    if (this.cursor >= list.length) {
      if (!this.loop) return null;
      this.cursor = 0;
    }
    const it = list[this.cursor];
    this.cursor++;
    return it;
  }

  private maxConcurrent(): number {
    const layout = this.config?.layout;
    const base = DENSITY_MAX[layout?.density || 'normal'] || DENSITY_MAX.normal;
    return Math.max(1, Math.min(base, layout?.maxConcurrent || base));
  }

  private spawnGap(): number {
    return DENSITY_GAP[this.config?.layout?.density || 'normal'] || DENSITY_GAP.normal;
  }

  private spawnDue(): void {
    if (!this.hasNext()) return;
    const now = this.elapsed;
    if (now - this.lastSpawnAt < this.spawnGap()) return;
    if (this.active.length >= this.maxConcurrent()) return;

    const it = this.nextItem();
    if (!it) return;

    const a = this.createActive(it, now);
    if (!a) return;
    this.active.push(a);
    this.lastSpawnAt = now;
  }

  /**
   * 挑一条可用轨道。
   * 规则：行内已有活动项时只允许同模式进入（见 rowMode 注释），
   *      同行清空后才回收为公共轨道；滚动模式额外要求到达 rowFreeAt 时间。
   * 返回值 -1 表示这一帧没有可用轨道，条目顺延到下一帧（不入队丢失）。
   */
  private pickRow(a: ActiveItem): number {
    const layout = this.config?.layout;
    const want: 'scroll' | 'static' = a.mode === 'scroll' ? 'scroll' : 'static';
    if (layout?.pinImportant && a.item.pinned) {
      // 置顶项固定占第一条轨道，且不受模式互斥限制（它本来就浮在最上层）
      const r = 0;
      if (this.rowMode[r] === '' || this.rowMode[r] === want) return r;
    }
    const now = this.elapsed;
    const sameMode: number[] = [];
    const empty: number[] = [];
    for (let i = 0; i < this.rowCount; i++) {
      const mode = this.rowMode[i] || '';
      if (mode === '' ) {
        empty.push(i);
        continue;
      }
      if (mode !== want) continue;
      if (want === 'scroll' && now < (this.rowFreeAt[i] || 0)) continue;
      if (!this.rowFits(i, a)) continue;
      sameMode.push(i);
    }
    // 优先复用同模式轨道（保持滚动队列连续），没有再启用空轨道
    if (sameMode.length) return sameMode[Math.floor(this.rng() * sameMode.length) % sameMode.length];
    if (empty.length) return empty[Math.floor(this.rng() * empty.length) % empty.length];
    return -1;
  }

  /** 静止模式辅助判断：候选位置与行内现有条目不得发生水平区间重叠 */
  private rowFits(row: number, a: ActiveItem): boolean {
    if (a.mode === 'scroll') return true;
    const x1 = a.x;
    const x2 = a.x + a.w;
    for (const cur of this.active) {
      if (cur.row !== row) continue;
      const c1 = cur.x;
      const c2 = cur.x + cur.w;
      if (x1 < c2 + ROW_GAP && c1 < x2 + ROW_GAP) return false;
    }
    return true;
  }

  private createActive(it: DanmakuItem, now: number): ActiveItem | null {
    const cfg = this.config;
    if (!cfg) return null;
    const style = cfg.style;
    const anim = cfg.anim;

    const mode = resolveMode(anim.mode, this.rng);
    const size: TextSize = it.size || style.size;
    const fontSize = SIZE_PX[size] || SIZE_PX.medium;
    const color = it.color || (it.pinned && cfg.layout.pinImportant ? style.gradientColor2 : style.color);

    const a = this.pool.pop() || newBlankItem();
    a.item = it;
    a.mode = mode;
    a.age = 0;
    a.alpha = 1;
    a.done = false;
    a.trails.length = 0;
    a.particles.length = 0;
    a.img = null;
    a.vx = 0;
    a.fontSize = fontSize;
    a.color = color;

    // 先估宽（行/位置计算要用），真实宽度等 draw 时带 ctx 再精确算一次
    if (it.kind === 'sticker') {
      const scale = (it.stickerScale || 100) / 100;
      a.w = fontSize * 2 * scale;
      a.h = fontSize * 2 * scale;
    } else {
      // 中文近似 1em / 字，西文 0.55em；够用来挑行，不追求像素级
      a.w = estimateWidth(it.text, fontSize);
      a.h = fontSize * 1.3;
    }

    const travelLeft = this.travelLeft;
    const travelRight = this.travelRight;
    const travelSpan = Math.max(1, travelRight - travelLeft);

    if (a.w > travelSpan) {
      // 超长文本不允许溢出可视行程：夹到行程宽度，画的时候由 ctx 自然截断
      a.w = travelSpan;
    }

    // 静止模式先定随机横向位置：挑行时要拿它做区间判重
    const staticLo = travelLeft + 8;
    const staticSpan = Math.max(0, travelSpan - a.w - 16);
    if (mode !== 'scroll') {
      a.homeX = staticLo + this.rng() * staticSpan;
      a.x = a.homeX;
    }

    // 允许重试：静止条目换个位置可能就塞得下了
    let row = -1;
    for (let attempt = 0; attempt < 3; attempt++) {
      row = this.pickRow(a);
      if (row >= 0) break;
      if (mode === 'scroll') break; // 滚动模式的位置固定在右边界外，重试没意义
      a.homeX = staticLo + this.rng() * staticSpan;
      a.x = a.homeX;
    }
    if (row < 0) {
      this.pool.push(a);
      return null;
    }

    a.row = row;
    a.y = this.rowCenterY(row);
    a.homeY = a.y;
    this.rowMode[row] = mode === 'scroll' ? 'scroll' : 'static';
    this.rowAlive[row] = (this.rowAlive[row] || 0) + 1;

    if (mode === 'scroll') {
      const speedPx = Math.max(SPEED_PX_PER_SEC[anim.speed || 'normal'] / 1000, 0.01);
      a.vx = speedPx;
      const dist = travelSpan + a.w;
      a.life = Math.max(1200, dist / speedPx);
      a.x = travelRight;
      // 下一条要等这一条走够「自身宽度 + GAP」才入场，这样同轨道永远差一个安全空隙
      this.rowFreeAt[row] = now + (a.w + ROW_GAP) / speedPx;
    } else if (mode === 'pop') {
      a.life = 320 + (anim.popHold || 2500) + 320;
    } else {
      a.life = Math.max(1200, (anim.blinkCount || 4) * 460);
    }

    if (anim.particle !== 'none' && this.quality === 'high') {
      this.emitParticles(a, anim);
    }
    return a;
  }

  private advance(a: ActiveItem, step: number): void {
    const anim = this.config?.anim;
    const t = a.age / a.life;
    if (a.mode === 'scroll') {
      // 位置增量推进（x -= vx·dt）。旧实现按 age/life 归一化算绝对位置，
      // 旋转改变宽度时会因分母突变而让弹幕「跳一下」；增量法天然规避。
      a.x -= Math.max(a.vx, 0.01) * step;
      a.alpha = 1;
      if (anim?.trail && this.quality === 'high') {
        const maxPts = Math.max(2, Math.round((anim.trailLen / 100) * 8));
        a.trails.push({ x: a.x, y: a.y });
        while (a.trails.length > maxPts) a.trails.shift();
      } else if (a.trails.length) {
        a.trails.length = 0;
      }
    } else if (a.mode === 'pop') {
      const enter = 320;
      const hold = anim?.popHold || 2500;
      const exit = 320;
      if (a.age < enter) {
        const p = easeOut(a.age / enter);
        const off = 80 * (1 - p);
        a.x = this.popX(a, off);
        a.y = this.popY(a, off);
        a.alpha = Math.min(1, p * 1.4);
      } else if (a.age < enter + hold) {
        a.alpha = 1;
      } else {
        const p = (a.age - enter - hold) / exit;
        const off = 40 * p;
        a.x = this.popX(a, off);
        a.y = this.popY(a, off);
        a.alpha = Math.max(0, 1 - p);
      }
    } else {
      const n = anim?.blinkCount || 4;
      const s = Math.abs(Math.sin((t * Math.PI * n) / 1));
      a.alpha = 0.18 + 0.82 * s;
      // 寿命末端收尾淡出，避免硬消失
      if (t > 0.88) a.alpha *= Math.max(0, (1 - t) / 0.12);
    }

    this.updateParticles(a);
  }

  private popX(a: ActiveItem, off: number): number {
    const from = this.config?.anim?.popFrom || 'bottom';
    if (from === 'left') return a.homeX - off;
    if (from === 'right') return a.homeX + off;
    return a.homeX;
  }

  private popY(a: ActiveItem, off: number): number {
    const from = this.config?.anim?.popFrom || 'bottom';
    if (from === 'bottom') return a.homeY + off;
    if (from === 'top') return a.homeY - off;
    return a.homeY;
  }

  /* ---------- 粒子 ---------- */

  private emitParticles(a: ActiveItem, anim: DanmakuConfig['anim']): void {
    if (this.quality !== 'high') return;
    const density = Math.max(8, Math.round((anim.particleCount / 100) * 26));
    const baseColor = anim.particleFollowColor ? a.color : '#FFFFFF';
    for (let i = 0; i < density; i++) {
      const p = this.particlePool.pop() || newBlankParticle();
      p.alive = true;
      p.kind = anim.particle;
      const ang = this.rng() * Math.PI * 2;
      const spd = 0.02 + this.rng() * 0.075;
      p.x = a.x + a.w * this.rng();
      p.y = a.y + (this.rng() - 0.5) * a.h;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd - 0.02;
      p.age = 0;
      p.life = 700 + this.rng() * 900;
      p.size = 3 + this.rng() * 5;
      p.rot = this.rng() * Math.PI * 2;
      p.spin = (this.rng() - 0.5) * 0.006;
      p.color = baseColor;
      a.particles.push(p);
    }
  }

  private updateParticles(a: ActiveItem): void {
    if (!a.particles.length) return;
    for (let i = a.particles.length - 1; i >= 0; i--) {
      const p = a.particles[i];
      p.age += 16.7;
      p.x += p.vx * 16.7;
      p.y += p.vy * 16.7;
      p.vy += 0.00035 * 16.7;
      p.rot += p.spin * 16.7;
      if (p.age >= p.life) {
        p.alive = false;
        this.particlePool.push(p);
        a.particles.splice(i, 1);
      }
    }
  }

  private releaseParticles(a: ActiveItem): void {
    for (const p of a.particles) {
      p.alive = false;
      this.particlePool.push(p);
    }
    a.particles.length = 0;
  }

  private recycle(a: ActiveItem): void {
    this.releaseParticles(a);
    a.trails.length = 0;
    a.img = null;
    const row = a.row;
    if (row >= 0 && row < this.rowAlive.length) {
      this.rowAlive[row] = Math.max(0, (this.rowAlive[row] || 0) - 1);
      // 行内清空即释放模式占用，之后滚动/静止都能进来
      if (!this.rowAlive[row]) this.rowMode[row] = '';
    }
    a.item = null as unknown as DanmakuItem;
    a.done = true;
    this.pool.push(a);
  }

  /* ---------- 绘制 ---------- */

  /**
   * 绘制一帧。调用方负责预处理画布变换（dpr scale）。
   * ctx 为最小接口，微信真实 ctx 与单测假 ctx 都能传。
   */
  draw(ctx: DrawCtx): void {
    if (!this.config) return;
    if (this.drawBackground) this.drawBackgroundLayer(ctx);
    // 置顶项画在最上层：先画普通项，再画 pinned
    const normal: ActiveItem[] = [];
    const pinned: ActiveItem[] = [];
    for (const a of this.active) {
      if (a.item.pinned && this.config.layout.pinImportant) pinned.push(a);
      else normal.push(a);
    }
    for (const a of normal) this.drawItem(ctx, a);
    for (const a of pinned) this.drawItem(ctx, a);
  }

  private drawBackgroundLayer(ctx: DrawCtx): void {
    const bg = this.config?.bg;
    const w = this.width;
    const h = this.height;
    if (!bg) return;
    if (bg.kind === 'image' && this.bgImage) {
      drawCover(ctx, this.bgImage, w, h);
      return;
    }
    if (bg.kind === 'solid') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, bg.color);
    g.addColorStop(1, bg.color2 || bg.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drawItem(ctx: DrawCtx, a: ActiveItem): void {
    const cfg = this.config;
    if (!cfg) return;
    const style = cfg.style;
    const anim = cfg.anim;

    // 精确宽度（带缓存）：估算值只用于挑行，绘制必须用真实宽度，
    // 否则行号对得上、背景边框却会对不上。
    if (a.item.kind === 'text') {
      const key = `${a.item.text}|${style.font}|${a.fontSize}|${style.bold ? 1 : 0}|${style.fontEffect}`;
      const cached = this.widthCache[key];
      if (cached) {
        a.w = cached;
      } else {
        ctx.font = buildFont(a.fontSize, style.bold, style.italic, style.font);
        const m = ctx.measureText(a.item.text);
        const wpx = Math.ceil(m.width) + (style.border ? style.borderWidth * 2 : 0);
        this.widthCache[key] = wpx;
        a.w = wpx;
      }
    }

    if (a.alpha <= 0.01) return;

    // 拖尾
    if (anim.trail && this.quality === 'high' && a.mode === 'scroll' && a.trails.length > 1) {
      const base = (anim.trailAlpha || 60) / 100;
      for (let i = 0; i < a.trails.length - 1; i++) {
        const pt = a.trails[i];
        const k = (i + 1) / a.trails.length;
        ctx.globalAlpha = a.alpha * base * k * 0.6;
        this.paint(ctx, a, pt.x, pt.y, true);
      }
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = a.alpha;
    this.paint(ctx, a, a.x, a.y, false);
    ctx.globalAlpha = 1;

    if (anim.particle !== 'none' && this.quality === 'high') {
      this.drawParticles(ctx, a);
    }
  }

  /** 真正的单条绘制：背景 → 描边 → 填充（含特效） */
  private paint(ctx: DrawCtx, a: ActiveItem, x: number, y: number, isTrail: boolean): void {
    const cfg = this.config;
    if (!cfg) return;
    const style = cfg.style;

    if (a.item.kind === 'sticker' && a.img) {
      const w = a.w;
      const h = a.h;
      ctx.save();
      ctx.translate(x + w / 2, y);
      if (a.item.stickerSpin) ctx.rotate((a.age / 1000) % (Math.PI * 2));
      ctx.drawImage(a.img, -w / 2, -h / 2, w, h);
      ctx.restore();
      return;
    }

    const text = a.item.text;
    if (!text) return;

    ctx.save();
    ctx.beginPath();
    ctx.font = buildFont(a.fontSize, style.bold, style.italic, style.font);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // 斜体：canvas font 的 italic 对中文经常无效，这里用剪切变换兜底，
    // 保证中文也能真正斜过来。
    const shear = style.italic ? Math.tan((12 * Math.PI) / 180) : 0;
    if (shear !== 0) {
      ctx.transform(1, 0, -shear, 1, shear * y, 0);
    }

    // ---- 背景 ----
    if (!isTrail && style.bgMode !== 'none') {
      const padX = 8;
      const padY = 6;
      const bx = x - padX;
      const by = y - a.h / 2 - padY;
      const bw = a.w + padX * 2;
      const bh = a.h + padY * 2;
      ctx.globalAlpha = ctx.globalAlpha * (style.bgMode === 'translucent' ? style.bgAlpha / 100 : 1);
      ctx.fillStyle = style.bgColor;
      if (style.bgMode === 'pill') roundRectPath(ctx, bx, by, bw, bh, bh / 2);
      else roundRectPath(ctx, bx, by, bw, bh, 6);
      ctx.fill();
      if (style.bgMode === 'translucent') ctx.globalAlpha = ctx.globalAlpha / (style.bgAlpha / 100);
    }

    // ---- 阴影 ----
    if (!isTrail && style.shadow) {
      ctx.shadowColor = style.shadowColor;
      ctx.shadowBlur = style.shadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.max(1, Math.round(style.shadowBlur / 3));
    }

    const effect = a.item.effect || style.fontEffect;

    if (effect === 'glow' && !isTrail) {
      drawGlow(ctx, text, x, y, a, style, this.quality);
    } else if (effect === 'gradient') {
      drawGradient(ctx, text, x, y, a, style);
    } else if (effect === 'doodle') {
      drawDoodle(ctx, text, x, y, a, style);
    } else if (effect === 'pixel') {
      drawPixelFallback(ctx, text, x, y, a, style);
    } else {
      ctx.fillStyle = a.color;
      ctx.fillText(text, x, y);
    }

    // ---- 描边（放在最后，压在填充色之上，保证边缘干净） ----
    if (!isTrail && style.border) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineWidth = style.borderWidth;
      ctx.strokeStyle = style.borderColor;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }

    ctx.restore();
  }

  private drawParticles(ctx: DrawCtx, a: ActiveItem): void {
    const prevAlpha = ctx.globalAlpha;
    for (const p of a.particles) {
      const t = p.age / p.life;
      ctx.globalAlpha = prevAlpha * Math.max(0, 1 - t) * 0.9;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      drawParticleShape(ctx, p.kind, p.size);
      ctx.restore();
    }
    ctx.globalAlpha = prevAlpha;
  }
}

/* ==================== 独立工具函数 ==================== */

/** random 模式 → 具体模式 */
export function resolveMode(mode: string, rnd: () => number): ResolvedMode {
  if (mode === 'pop') return 'pop';
  if (mode === 'blink') return 'blink';
  if (mode === 'random') {
    const r = rnd();
    if (r < 0.5) return 'scroll';
    if (r < 0.8) return 'pop';
    return 'blink';
  }
  return 'scroll';
}

/** 构造 canvas font 简写 */
export function buildFont(sizePx: number, bold: boolean, italic: boolean, fontKey: string): string {
  const weight = bold ? 'bold ' : '';
  // italic 不放进 font 串：中文大多无效，统一由剪切变换实现
  void italic;
  return `${weight}${sizePx}px ${FONT_FAMILY[fontKey as keyof typeof FONT_FAMILY] || FONT_FAMILY.default}`;
}

/** 估算文本宽度：中文按 1em、西文/数字按 0.55em */
export function estimateWidth(text: string, fontSize: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK / 全角标点 / emoji 近似一个字宽
    const wide = code > 0x2e80;
    w += wide ? fontSize : fontSize * 0.55;
  }
  return Math.ceil(w);
}

function easeOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

function newBlankItem(): ActiveItem {
  return {
    item: null as unknown as DanmakuItem,
    mode: 'scroll',
    w: 0,
    h: 0,
    fontSize: 18,
    color: '#fff',
    x: 0,
    y: 0,
    vx: 0,
    homeX: 0,
    homeY: 0,
    age: 0,
    life: 0,
    row: 0,
    alpha: 1,
    img: null,
    trails: [],
    particles: [],
    done: true
  };
}

function newBlankParticle(): Particle {
  return {
    alive: false,
    kind: 'none',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    life: 1,
    size: 4,
    rot: 0,
    spin: 0,
    color: '#fff'
  };
}

/** 圆角矩形路径（自己画，兼容没实现 roundRect 的低版本基础库） */
export function roundRectPath(ctx: DrawCtx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 背景图 cover 裁剪 */
export function drawCover(ctx: DrawCtx, img: EngineImage, w: number, h: number): void {
  if (!img || !img.width || !img.height) return;
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** 渐变字：沿 gradientDeg 方向做线性渐变填充 */
function drawGradient(ctx: DrawCtx, text: string, x: number, y: number, a: ActiveItem, style: DanmakuConfig['style']): void {
  const rad = ((style.gradientDeg - 90) * Math.PI) / 180;
  const dx = Math.cos(rad) * a.w;
  const dy = Math.sin(rad) * Math.max(a.h, a.fontSize);
  const g = ctx.createLinearGradient(x, y - dy / 2, x + dx, y + dy / 2);
  g.addColorStop(0, a.color);
  g.addColorStop(1, style.gradientColor2 || a.color);
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
}

/** 发光字：多层 shadowBlur 叠加，强度由 glow 控制；低画质下只画一层 */
function drawGlow(ctx: DrawCtx, text: string, x: number, y: number, a: ActiveItem, style: DanmakuConfig['style'], quality: Quality): void {
  const k = Math.max(0, Math.min(100, style.glow)) / 100;
  const blur = 6 + k * 18;
  ctx.shadowColor = style.gradientColor2 || a.color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = a.color;
  if (quality === 'high') {
    ctx.fillText(text, x, y);
    ctx.fillText(text, x, y);
  }
  ctx.shadowBlur = blur * 0.6;
  ctx.shadowColor = a.color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

/** 手写涂鸦字：逐字抖动旋转，制造手写的不规整感 */
function drawDoodle(ctx: DrawCtx, text: string, x: number, y: number, a: ActiveItem, style: DanmakuConfig['style']): void {
  ctx.fillStyle = a.color;
  let cursor = x;
  const chars = Array.from(text);
  const seed = hashString(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const n = pseudoRandom(seed + i * 97);
    const rot = (n - 0.5) * 0.28;
    const dy = (pseudoRandom(seed + i * 31) - 0.5) * a.fontSize * 0.18;
    const w = ctx.measureText(ch).width;
    ctx.save();
    ctx.translate(cursor, y + dy);
    ctx.rotate(rot);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    cursor += w;
  }
  void style;
}

/**
 * 像素字的无离屏画布兜底：量化到 3px 网格 + 硬阴影，视觉上接近点阵。
 * 真正的像素化（离屏降采样回绘）由渲染组件在支持 createOffscreenCanvas 时接管。
 */
function drawPixelFallback(ctx: DrawCtx, text: string, x: number, y: number, a: ActiveItem, style: DanmakuConfig['style']): void {
  const qx = Math.round(x / 3) * 3;
  const qy = Math.round(y / 3) * 3;
  ctx.fillStyle = a.color;
  ctx.fillText(text, qx, qy);
  if (!style.border) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = style.shadowColor || 'rgba(0,0,0,0.6)';
    ctx.strokeText(text, qx, qy);
  }
}

/** 粒子轮廓 */
function drawParticleShape(ctx: DrawCtx, kind: string, size: number): void {
  if (kind === 'star') {
    starPath(ctx, 0, 0, size, size / 2, 5);
    ctx.fill();
    return;
  }
  if (kind === 'heart') {
    heartPath(ctx, 0, 0, size);
    ctx.fill();
    return;
  }
  if (kind === 'snow') {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // firework：放射短线
  ctx.strokeStyle = ctx.fillStyle as string;
  ctx.lineWidth = Math.max(1, size * 0.22);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI * 2 * i) / 6;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(ang) * size, Math.sin(ang) * size);
  }
  ctx.stroke();
}

export function starPath(ctx: DrawCtx, cx: number, cy: number, r: number, ri: number, n: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 === 0 ? r : ri;
    const ang = (Math.PI * i) / n - Math.PI / 2;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function heartPath(ctx: DrawCtx, cx: number, cy: number, size: number): void {
  const s = size / 16;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 6 * s);
  ctx.bezierCurveTo(cx - 10 * s, cy - 3 * s, cx - 5 * s, cy - 11 * s, cx, cy - 5 * s);
  ctx.bezierCurveTo(cx + 5 * s, cy - 11 * s, cx + 10 * s, cy - 3 * s, cx, cy + 6 * s);
  ctx.closePath();
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** 由整数种子得到 0~1 的稳定伪随机 */
export function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
