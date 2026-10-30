// subpackages/photowall/utils/pw-shapes.ts
// 照片墙：形状库 + 排列点位生成算法
//
// ── 整体思路 ──────────────────────────────────────────────────
// 所有形状最终统一成「一个判定函数 test(x, y) → 是否在形状内」，x/y ∈ [-1,1]（y 轴向上）。
// 这样做的好处是：
//   1) 新形状只要写一条不等式（或几个几何体的布尔组合），不用推导参数方程；
//   2) 文字 / 自定义 PNG 蒙版走「栅格化 → 二值图 → 同样的判定函数」，与解析形状共用同一套排点逻辑；
//   3) 排点算法只依赖 test，因此新增形状零适配成本。
//
// ── 排点算法 ──────────────────────────────────────────────────
// 目标：n 张照片排成一个「一眼能认出来」的形状，且**每张照片只用一次**。
// 做法是拆成三部分：
//   · 描边点：从形状轮廓上等距取点（按累计弧长，不是按角度）—— 形状的辨识度主要靠这一圈；
//   · 特征吸附：把离「尖角 / 凹口」最近的采样点挪到特征上。心形取 4~5 个点时，
//     等距采样会恰好跳过下尖与顶部凹口，排出来是个圆乎乎的四边形；吸附之后才是心形；
//   · 实心铺满：照片够多时改成「格点数 = 照片数」的格点阵把形状内部铺满（见 coverShape）。
//
// 照片数少（< solidMin）时全部排在轮廓上 —— 正是需求里「照片少时只取边界点」，
// 且内部只放一两个点既不成面、又会打乱轮廓节奏，一圈等距的点反而最像那个形状。
// 照片够多时改为**实心铺满**：在形状内部铺一层交错格点，格距 = 贴片边长，
// 相邻照片严丝合缝，整个形状内部被照片完整盖住（不是只有一圈轮廓的空心效果）。
//
// 「照片多到超过形状所需」时**绝不重复照片**：默认一张照片一格（点位数量 == 照片数）；
// 只有用户显式打开铺满模式，才会多排点位并循环复用照片。

import type { Pt, ShapeDef, ShapeCat, PWMask, ShapeMetrics, PWTemplateGrid, PWFillMode } from './pw-types';

/* ==================== 几何基础工具 ==================== */

/** 点是否落在多边形内（射线法，支持凹多边形，故六芒星/圣诞树可直接用） */
function polyTest(pts: Pt[]): (x: number, y: number) => boolean {
  return (x: number, y: number): boolean => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** 点到线段的距离（雪花侧枝等「细长部件」用） */
function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}

/** 圆 */
function circle(x: number, y: number, cx: number, cy: number, r: number): boolean {
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

/** 椭圆（rx / ry 为半轴，不旋转） */
function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const a = (x - cx) / rx;
  const b = (y - cy) / ry;
  return a * a + b * b <= 1;
}

/**
 * 经典心形隐式方程：(X² + Y² − 1)³ − X²·Y³ ≤ 0
 * 尖朝下、上方带凹口，就是最常见的 ♥。域约为 x∈[−1.2,1.2]、y∈[−1.3,1.05]，
 * 后面的包围盒归一化会把它自动居中放大到 [−1,1]。
 */
function heart(x: number, y: number): boolean {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
}

/* ==================== 形状判定函数 ==================== */

/** 五角星极坐标边界半径：周期内 1 → 内半径 → 1 */
function star5R(theta: number): number {
  const seg = Math.PI * 2 / 5;
  let t = theta % seg;
  if (t < 0) t += seg;
  const inner = 0.382; // 正五角星内外半径比
  return t < seg / 2
    ? 1 + (inner - 1) * (t / (seg / 2))
    : inner + (1 - inner) * ((t - seg / 2) / (seg / 2));
}

const TESTS: Record<string, (x: number, y: number) => boolean> = {
  /* ---- 基础形状 ---- */
  heart,
  circle: (x, y) => x * x + y * y <= 1,
  // 方形必须**比探测域略小**：判定域是 [-1,1]²，若方形正好铺满整个域，
  // 扫描网格就找不到任何「内→外」的跃变，轮廓候选点为空，方形会掉进兜底圆环。
  // 0.96 还有个附带好处：方形照片墙四周留一点边，比贴到画布边缘好看。
  square: (x, y) => Math.abs(x) <= 0.96 && Math.abs(y) <= 0.96,
  triangle: (x, y) => y >= -0.5 && y <= 1 && Math.abs(x) <= (1 - y) / 1.5,
  diamond: (x, y) => Math.abs(x) + Math.abs(y) <= 1,
  ellipse: (x, y) => (x / 1) * (x / 1) + (y / 0.68) * (y / 0.68) <= 1,
  star5: (x, y) => {
    const d = Math.sqrt(x * x + y * y);
    return d <= star5R(Math.atan2(y, x));
  },
  star6: polyTest((() => {
    // 两个正三角形叠加：12 个顶点，外接半径交替 1 与 0.5（凹点 = 三角形边中点）
    const pts: Pt[] = [];
    for (let i = 0; i < 12; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 6;
      const r = i % 2 === 0 ? 1 : 0.5;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  })()),

  /* ---- 情侣主题 ---- */
  doubleHeart: (x, y) =>
    heart((x + 0.52) / 0.62, (y - 0.08) / 0.62) || heart((x - 0.52) / 0.62, (y - 0.08) / 0.62),
  loveLock: (x, y) => {
    if (heart(x / 0.9, (y + 0.28) / 0.72)) return true;
    // 锁梁：上半环
    const d = Math.sqrt(x * x + (y - 0.5) * (y - 0.5));
    return d >= 0.22 && d <= 0.4 && y >= 0.25;
  },
  couple: (x, y) =>
    circle(x, y, -0.34, 0.32, 0.26) ||
    circle(x, y, 0.34, 0.32, 0.26) ||
    (Math.abs(x) <= 0.62 && y <= 0.06 && y >= -0.92 && Math.abs(x) <= 0.3 + (0.06 - y) * 0.42),

  /* ---- 节日主题 ---- */
  christmasTree: (x, y) => {
    // 三层锥体 + 树干
    const layer = (yc: number, yb: number, w: number): boolean =>
      y <= yc && y >= yb && Math.abs(x) <= (w * (yc - y)) / (yc - yb);
    if (layer(1, 0.16, 0.42)) return true;
    if (layer(0.5, -0.34, 0.68)) return true;
    if (layer(0, -0.82, 0.94)) return true;
    return Math.abs(x) <= 0.11 && y >= -1 && y <= -0.74;
  },
  snowflake: (x, y) => {
    if (Math.sqrt(x * x + y * y) > 1) return false;
    for (let k = 0; k < 6; k++) {
      const a = (-k * Math.PI) / 3;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px = x * ca - y * sa;
      const py = x * sa + y * ca;
      // 主枝
      if (Math.abs(py) <= 0.045 && px >= -0.02 && px <= 1) return true;
      // 两组 V 形侧枝
      const arms = [0.42, 0.7];
      for (let ai = 0; ai < arms.length; ai++) {
        const base = arms[ai];
        for (let s = -1; s <= 1; s += 2) {
          const ang = s * (Math.PI / 5);
          const ex = base + Math.cos(ang) * 0.24;
          const ey = Math.sin(ang) * 0.24;
          if (distToSeg(px, py, base, 0, ex, ey) <= 0.042) return true;
        }
      }
    }
    return false;
  },
  flower: (x, y) => {
    const d = Math.sqrt(x * x + y * y);
    // 五瓣玫瑰线 r = 0.62 + 0.38·cos(5θ)
    return d <= 0.62 + 0.38 * Math.cos(5 * Math.atan2(y, x));
  },
  gift: (x, y) => {
    // 盒体 + 顶部蝴蝶结
    if (Math.abs(x) <= 0.82 && y >= -0.92 && y <= 0.38) return true;
    return circle(x, y, -0.26, 0.55, 0.26) || circle(x, y, 0.26, 0.55, 0.26);
  },
  pumpkin: (x, y) =>
    ellipse(x, y, 0, -0.06, 0.98, 0.8) || (Math.abs(x) <= 0.08 && y >= 0.62 && y <= 1),
  rabbit: (x, y) =>
    circle(x, y, 0, -0.05, 0.42) ||
    ellipse(x, y, -0.25, 0.62, 0.15, 0.46) ||
    ellipse(x, y, 0.25, 0.62, 0.15, 0.46) ||
    ellipse(x, y, 0, -0.72, 0.46, 0.3),
  heartFestival: heart,

  /* ---- 家庭主题 ---- */
  house: (x, y) => {
    if (Math.abs(x) <= 0.68 && y >= -0.95 && y <= 0.12) return true;
    return y >= 0.1 && y <= 0.92 && Math.abs(x) <= (0.88 * (0.92 - y)) / 0.82;
  },
  familyTree: (x, y) =>
    circle(x, y, 0, 0.42, 0.42) ||
    circle(x, y, -0.42, 0.12, 0.33) ||
    circle(x, y, 0.42, 0.12, 0.33) ||
    (Math.abs(x) <= 0.12 && y >= -0.95 && y <= 0.15),
  holdingHands: (x, y) =>
    circle(x, y, -0.55, 0.28, 0.2) ||
    circle(x, y, 0, 0.42, 0.24) ||
    circle(x, y, 0.55, 0.28, 0.2) ||
    (Math.abs(y + 0.02) <= 0.055 && Math.abs(x) <= 0.78) ||
    (Math.abs(x) <= 0.72 && y >= -0.85 && y <= -0.05 && Math.abs(x) <= 0.3 + (-0.05 - y) * 0.55)
};

/* ==================== 形状清单 ==================== */

interface RawShape {
  id: string;
  name: string;
  cat: ShapeCat;
  icon: string;
  suggest: number;
  /**
   * 手工精修的网格模板（'█'=放照片，'·'=空）。
   * 只给「栅格化观感差」的旗舰形状用：心形底部圆弧在 7×7 栅格上会裂成两瓣、
   * 五角星栅格化会左右不对称 —— 这几个直接用经典像素画，比自动派生好看得多。
   */
  grid?: string[];
  /** 该形状推荐的填充风格（作品未指定时用它；见 PWFillMode） */
  fill?: PWFillMode;
}

/**
 * 填充风格的分配表（三档各 7 个，语义清晰、风格均衡）：
 *   · 实心 solid —— 团块型形状：实心最饱满、最像那个形状；
 *   · 描边 ring  —— 有厚度、有内部空间的形状：描边后轮廓更利落，和实心形成对比；
 *   · 渐变 fade  —— 细节多 / 枝条状的形状：内部照片半透明，形状更透气不糊。
 * 作品级可以覆盖（编辑器「填充风格」三选一），这里只是推荐值。
 */
const FILL_TABLE: Record<string, PWFillMode> = {
  // ── 实心（团块型）──
  heart: 'solid',
  heartFestival: 'solid',
  doubleHeart: 'solid',
  circle: 'solid',
  square: 'solid',
  diamond: 'solid',
  ellipse: 'solid',
  // ── 描边（有内部空间）──
  star5: 'ring',
  star6: 'ring',
  triangle: 'ring',
  house: 'ring',
  gift: 'ring',
  pumpkin: 'ring',
  christmasTree: 'ring',
  // ── 渐变（细节多 / 枝条状）──
  snowflake: 'fade',
  flower: 'fade',
  rabbit: 'fade',
  loveLock: 'fade',
  couple: 'fade',
  familyTree: 'fade',
  holdingHands: 'fade'
};

/** 经典 7×7 像素心：顶部凹口两瓣清晰、底部收成一点（自动栅格化底部会裂成两瓣） */
const HEART_GRID = [
  '·██·██·',
  '███████',
  '███████',
  '███████',
  '·█████·',
  '··███··',
  '···█···'
];

const RAW: RawShape[] = [
  {
    id: 'heart', name: '心形', cat: 'basic', icon: '❤️', suggest: 40,
    grid: HEART_GRID
  },
  { id: 'circle', name: '圆形', cat: 'basic', icon: '⭕', suggest: 36 },
  { id: 'square', name: '方形', cat: 'basic', icon: '⬜', suggest: 36 },
  {
    id: 'triangle', name: '三角形', cat: 'basic', icon: '🔺', suggest: 28,
    // 1-3-5-7-9 标准阶梯（自动栅格化会在中部出现重复行）
    grid: [
      '····█····',
      '···███···',
      '··█████··',
      '·███████·',
      '█████████'
    ]
  },
  {
    id: 'star5', name: '五角星', cat: 'basic', icon: '⭐', suggest: 36,
    // 自动栅格化会左右不对称，手工对齐中轴
    grid: [
      '····█····',
      '···███···',
      '█████████',
      '·███████·',
      '··█████··',
      '·███·███·',
      '·█·····█·'
    ]
  },
  { id: 'star6', name: '六芒星', cat: 'basic', icon: '✨', suggest: 42 },
  { id: 'diamond', name: '菱形', cat: 'basic', icon: '🔷', suggest: 32 },
  { id: 'ellipse', name: '椭圆', cat: 'basic', icon: '🥚', suggest: 34 },
  // 情侣
  { id: 'doubleHeart', name: '双心', cat: 'couple', icon: '💕', suggest: 60 },
  { id: 'loveLock', name: '爱心锁', cat: 'couple', icon: '🔒', suggest: 44 },
  { id: 'couple', name: '情侣剪影', cat: 'couple', icon: '👫', suggest: 52 },
  // 节日
  { id: 'christmasTree', name: '圣诞树', cat: 'festival', icon: '🎄', suggest: 48 },
  { id: 'snowflake', name: '雪花', cat: 'festival', icon: '❄️', suggest: 54 },
  { id: 'flower', name: '花朵', cat: 'festival', icon: '🌸', suggest: 42 },
  { id: 'gift', name: '礼物', cat: 'festival', icon: '🎁', suggest: 46 },
  { id: 'pumpkin', name: '南瓜', cat: 'festival', icon: '🎃', suggest: 44 },
  { id: 'rabbit', name: '兔子', cat: 'festival', icon: '🐰', suggest: 46 },
  { id: 'heartFestival', name: '爱心', cat: 'festival', icon: '💖', suggest: 40, grid: HEART_GRID },
  // 家庭
  { id: 'house', name: '房子', cat: 'family', icon: '🏠', suggest: 44 },
  { id: 'familyTree', name: '家庭树', cat: 'family', icon: '🌳', suggest: 50 },
  { id: 'holdingHands', name: '手牵手', cat: 'family', icon: '🤝', suggest: 50 }
];

/** 内置解析形状 */
export const SHAPES: ShapeDef[] = RAW.map((r) => ({
  id: r.id,
  name: r.name,
  cat: r.cat,
  icon: r.icon,
  kind: 'analytic',
  test: TESTS[r.id],
  suggest: r.suggest,
  gridMask: r.grid,
  fill: r.fill || FILL_TABLE[r.id] || 'solid'
}));

/** 字母形状 A-Z（栅格化） */
export const LETTER_SHAPES: ShapeDef[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) => ({
  id: 'letter-' + ch,
  name: ch,
  cat: 'letter' as ShapeCat,
  icon: ch,
  kind: 'text' as const,
  text: ch,
  suggest: 24
}));

/** 数字形状 0-9（栅格化） */
export const NUMBER_SHAPES: ShapeDef[] = '0123456789'.split('').map((ch) => ({
  id: 'num-' + ch,
  name: ch,
  cat: 'number' as ShapeCat,
  icon: ch,
  kind: 'text' as const,
  text: ch,
  suggest: 22
}));

/** 分类标签 */
export const SHAPE_CATS: { key: ShapeCat; label: string }[] = [
  { key: 'basic', label: '基础' },
  { key: 'letter', label: '字母' },
  { key: 'number', label: '数字' },
  { key: 'text', label: '文字' },
  { key: 'festival', label: '节日' },
  { key: 'couple', label: '情侣' },
  { key: 'family', label: '家庭' },
  { key: 'custom', label: '自定义' }
];

/** 常用形状（首屏推荐，省去翻找） */
export const HOT_SHAPE_IDS = ['heart', 'doubleHeart', 'circle', 'star5', 'heartFestival', 'flower'];

/** 按 id 取内置形状 */
export function getShape(id: string): ShapeDef | null {
  for (let i = 0; i < SHAPES.length; i++) if (SHAPES[i].id === id) return SHAPES[i];
  for (let i = 0; i < LETTER_SHAPES.length; i++) if (LETTER_SHAPES[i].id === id) return LETTER_SHAPES[i];
  for (let i = 0; i < NUMBER_SHAPES.length; i++) if (NUMBER_SHAPES[i].id === id) return NUMBER_SHAPES[i];
  return null;
}

/** 造一个文字形状（用户输入任意文字 / 多行） */
export function makeTextShape(text: string): ShapeDef {
  return {
    id: 'text',
    name: text.replace(/\n/g, ' ') || '文字',
    cat: 'text',
    icon: '🔤',
    kind: 'text',
    text: text,
    suggest: 40
  };
}

/** 造一个自定义蒙版形状 */
export function makeMaskShape(path: string): ShapeDef {
  return {
    id: 'mask',
    name: '自定义形状',
    cat: 'custom',
    icon: '🖼️',
    kind: 'mask',
    maskPath: path,
    suggest: 40
  };
}

/* ==================== 栅格化：文字 / 自定义蒙版 → 二值图 ==================== */

/** 取一块离屏 2D 画布（不占页面节点，纯计算用） */
function offscreen(w: number, h: number): WechatMiniprogram.Canvas {
  return wx.createOffscreenCanvas({ type: '2d', width: w, height: h }) as WechatMiniprogram.Canvas;
}

/**
 * 把文字栅格化成二值图：用离屏画布画黑字 → getImageData 取 alpha → 非透明即形状内。
 * 这是「字母 / 数字 / 任意文字」三个分类共用的实现，中英文、数字、符号都支持。
 */
export function rasterizeText(text: string, opt?: { bold?: boolean; family?: string }): PWMask {
  const W = 256;
  const H = 256;
  const cv = offscreen(W, H);
  const ctx = cv.getContext('2d');
  const family = (opt && opt.family) || 'sans-serif';
  const weight = opt && opt.bold ? 'bold ' : 'bold ';
  const lines = String(text || '').split('\n').filter((s) => s.length > 0);
  if (!lines.length) return { w: W, h: H, data: new Uint8Array(W * H) };

  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 自适应字号：先按 160px 量一次，再按「最宽行 ≤ 画布 86%」「总高 ≤ 80%」两个约束缩放
  let fs = 160;
  ctx.font = `${weight}${fs}px ${family}`;
  let maxW = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = ctx.measureText(lines[i]);
    if (m.width > maxW) maxW = m.width;
  }
  if (maxW > 0) fs = Math.min(fs, (fs * (W * 0.86)) / maxW);
  const lineH = fs * 1.22;
  if (lineH * lines.length > H * 0.8) fs = (fs * (H * 0.8)) / (lineH * lines.length);
  fs = Math.max(12, fs);

  ctx.font = `${weight}${fs}px ${family}`;
  const lh = fs * 1.22;
  const top = H / 2 - (lh * (lines.length - 1)) / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], W / 2, top + i * lh);
  }
  return readAlpha(ctx, W, H);
}

/** 读画布 alpha 通道 → 二值图 */
function readAlpha(ctx: WechatMiniprogram.CanvasRenderingContext, w: number, h: number): PWMask {
  const img = ctx.getImageData(0, 0, w, h);
  const data = new Uint8Array(w * h);
  const raw = img.data;
  for (let i = 0; i < w * h; i++) {
    // 取 alpha 通道（第 4 个字节）；部分基础库对未绘制区域返回全 0
    data[i] = raw[i * 4 + 3] > 100 ? 1 : 0;
  }
  return { w, h, data };
}

/** 加载图片（离屏画布用；本地临时路径与网络地址均可） */
function loadImage(cv: WechatMiniprogram.Canvas, src: string): Promise<WechatMiniprogram.Image> {
  return new Promise((resolve, reject) => {
    const img = cv.createImage();
    img.onload = () => resolve(img);
    img.onerror = (e: { errMsg: string }) => reject(e);
    img.src = src;
  });
}

/**
 * 自定义蒙版：把用户上传的 PNG 画到离屏画布，取非透明区域作为形状。
 * 缩到最长边 220 —— 蒙版只用于取点，再大纯属浪费（且 getImageData 是 O(w·h)）。
 */
export async function rasterizeMaskFile(path: string, maxSide = 220): Promise<PWMask> {
  const info = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    wx.getImageInfo({
      src: path,
      success: (res: { width: number; height: number }) => resolve(res),
      fail: (err: { errMsg: string }) => reject(err)
    });
  });
  const scale = Math.min(1, maxSide / Math.max(info.width, info.height));
  const W = Math.max(8, Math.round(info.width * scale));
  const H = Math.max(8, Math.round(info.height * scale));
  const cv = offscreen(W, H);
  const ctx = cv.getContext('2d');
  const img = await loadImage(cv, path);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  return readAlpha(ctx, W, H);
}

/** 二值图 → 判定函数（坐标 y 轴向上，图片行序向下，故 y 取反） */
function maskTest(m: PWMask): (x: number, y: number) => boolean {
  return (x: number, y: number): boolean => {
    const px = Math.round(((x + 1) / 2) * (m.w - 1));
    const py = Math.round(((1 - y) / 2) * (m.h - 1));
    if (px < 0 || py < 0 || px >= m.w || py >= m.h) return false;
    return m.data[py * m.w + px] === 1;
  };
}

/**
 * 确保形状可用：栅格类形状（文字 / 蒙版）先生成二值图并挂到 def.mask。
 * 解析形状直接返回。重复调用会复用已缓存的 mask。
 */
export async function ensureShape(def: ShapeDef): Promise<boolean> {
  if (def.kind === 'analytic') return !!def.test;
  if (def.mask) return true;
  try {
    if (def.kind === 'text') {
      def.mask = rasterizeText(def.text || '');
      return true;
    }
    if (def.kind === 'mask' && def.maskPath) {
      def.mask = await rasterizeMaskFile(def.maskPath);
      return true;
    }
  } catch (e) {
    console.warn('[pw-shapes] ensureShape failed:', e);
  }
  return false;
}

/* ==================== 排点 ==================== */

/** 可复现的伪随机数发生器（同一 seed 必然得到同一张排布） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从形状内的点出发沿 (ux,uy) 方向找精确边界（先步进找到在外点，再二分） */
function edgeAlong(
  raw: (x: number, y: number) => boolean,
  p: Pt,
  ux: number,
  uy: number
): Pt {
  let lo = 0; // 仍在内
  let hi = -1; // 已在外
  for (let i = 1; i <= 40; i++) {
    const t = i * 0.05;
    if (!raw(p.x + ux * t, p.y + uy * t)) {
      hi = t;
      break;
    }
    lo = t;
  }
  if (hi < 0) return { x: p.x + ux * lo, y: p.y + uy * lo };
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (raw(p.x + ux * mid, p.y + uy * mid)) lo = mid;
    else hi = mid;
  }
  return { x: p.x + ux * lo, y: p.y + uy * lo };
}

/**
 * 包围盒归一化：粗采样求出形状的包围盒，然后把它等比居中放大到 [-1,1]。
 * 这样新增形状时不必手工调参去凑坐标系，也不会出现「形状缩在画布一角」。
 *
 * 粗采样之后必须**沿四个方向各做一次二分细化**：采样网格的步长有 0.02，
 * 轴对齐形状（方形、房子、礼物盒）的边可能正好落在两格之间，包围盒就少算一格 ——
 * 归一化时形状会被推出坐标域、被裁掉整整两条边。实测方形周长因此只剩一半
 * （1.99 而不是 3.92），"实心铺满够不够料"的判断直接算错，方形被误判成
 * 「照片太少」退化成空心轮廓。二分细化把误差压到 1e-4，这类形状才稳。
 */
function normalizeTest(raw: (x: number, y: number) => boolean): (x: number, y: number) => boolean {
  const N = 160;
  let minX = 9;
  let maxX = -9;
  let minY = 9;
  let maxY = -9;
  let pMinX: Pt = { x: 0, y: 0 };
  let pMaxX: Pt = { x: 0, y: 0 };
  let pMinY: Pt = { x: 0, y: 0 };
  let pMaxY: Pt = { x: 0, y: 0 };
  let hit = 0;
  for (let i = 0; i <= N; i++) {
    const x = -1.6 + (3.2 * i) / N;
    for (let j = 0; j <= N; j++) {
      const y = -1.6 + (3.2 * j) / N;
      if (raw(x, y)) {
        hit++;
        if (x < minX) {
          minX = x;
          pMinX = { x, y };
        }
        if (x > maxX) {
          maxX = x;
          pMaxX = { x, y };
        }
        if (y < minY) {
          minY = y;
          pMinY = { x, y };
        }
        if (y > maxY) {
          maxY = y;
          pMaxY = { x, y };
        }
      }
    }
  }
  if (!hit) return () => false;
  // 细化四个方向（以粗扫命中的极值点为起点，沿轴向推到真实边界）
  maxX = edgeAlong(raw, pMaxX, 1, 0).x;
  minX = edgeAlong(raw, pMinX, -1, 0).x;
  maxY = edgeAlong(raw, pMaxY, 0, 1).y;
  minY = edgeAlong(raw, pMinY, 0, -1).y;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max((maxX - minX) / 2, (maxY - minY) / 2) || 1;
  // 略收一点，避免最外圈点正好压在画布边缘被裁掉
  const s = half * 1.02;
  return (x: number, y: number): boolean => raw(cx + x * s, cy + y * s);
}

interface GridInfo {
  /** 形状面积占比（相对 [-1,1]² 的 4） */
  area: number;
  /** 轮廓候选点（无序） */
  edges: Pt[];
}

/** 网格采样：一次算出面积占比与轮廓候选点 */
function scanGrid(test: (x: number, y: number) => boolean, N: number): GridInfo {
  const step = 2 / N;
  const val = new Uint8Array((N + 1) * (N + 1));
  let inside = 0;
  for (let i = 0; i <= N; i++) {
    const x = -1 + i * step;
    for (let j = 0; j <= N; j++) {
      const v = test(x, -1 + j * step) ? 1 : 0;
      val[i * (N + 1) + j] = v;
      if (v) inside++;
    }
  }
  const edges: Pt[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= N; j++) {
      if (val[i * (N + 1) + j] !== val[(i + 1) * (N + 1) + j]) {
        edges.push({ x: -1 + (i + 0.5) * step, y: -1 + j * step });
      }
    }
  }
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j < N; j++) {
      if (val[i * (N + 1) + j] !== val[i * (N + 1) + j + 1]) {
        edges.push({ x: -1 + i * step, y: -1 + (j + 0.5) * step });
      }
    }
  }
  return { area: (inside / ((N + 1) * (N + 1))) * 4, edges };
}

/**
 * 轮廓采样：从无序的边界候选点里挑出 k 个「沿轮廓等距」的点。
 * 分两步走 —— 先 contourRuns 追踪轮廓（顺带量出周长），再 sampleContour 按弧长取点。
 *
 *   1) 以质心为极点按极角排序 —— 对绝大多数形状（心形/星形/字母…）来说，
 *      极角相邻即沿轮廓相邻，省掉了麻烦的轮廓追踪；
 *   2) 排序序列里出现「大跳变」的地方就是轮廓断开（双心、礼物这类多组件形状），
 *      在此切成若干段，段间按长度比例分配点数；
 *   3) 每段按**累计弧长**等间隔取点，间隔的相位 φ 由特征点决定（见 chooseOutlinePhase）。
 *
 * 为什么必须按弧长而不是按角度均分：等角度在「半径随角度剧烈变化」处会挤堆 ——
 * 心形只有 5 个点时，顶部两个凸起会被塞进 3 个点，最近邻距离掉到 0.035，
 * 照片尺寸被算得极小、整幅稀稀拉拉。弧长是形状的内在量，疏密永远均匀。
 */

/** 轮廓追踪结果 */
export interface Contour {
  /** 分段（闭合轮廓已合并首尾，多组件形状会切成多段） */
  runs: Pt[][];
  /** 每段折线长度 */
  lens: number[];
  /** 折线总长 ≈ 形状周长，单位与输入坐标一致（[-1,1] 域里就是 2×归一化周长） */
  total: number;
  /** 极角排序后的候选点序列（退化形状的兜底） */
  seq: Pt[];
}

/**
 * 轮廓追踪：极角排序 → 跳变切段 → 丢弃伪短段，顺便量出周长。
 *
 * 抽出周长是有用途的：**实心填充**需要知道「沿轮廓摆一圈要几个贴片」，
 * 这等于 周长 / 格距。没有它就只能按比例拍脑袋分配轮廓点与内部点，
 * 结果就是「照片够多、中间却还是空的」。
 */
function contourRuns(pts: Pt[]): Contour {
  const n = pts.length;
  if (n === 0) return { runs: [], lens: [], total: 0, seq: [] };
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += pts[i].x;
    cy += pts[i].y;
  }
  cx /= n;
  cy /= n;

  const arr = pts.map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }));
  arr.sort((u, v) => u.a - v.a);
  const seq: Pt[] = arr.map((o) => o.p);

  // 相邻候选点的平均间距：候选点本身就按网格步长密铺在边界上，用它定「跳变」阈值
  let sum = 0;
  for (let i = 1; i < n; i++) sum += Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y);
  const avgStep = sum / Math.max(1, n - 1);
  const jump = avgStep * 6 + 1e-9;

  // 按跳变切段
  const runs: Pt[][] = [];
  let cur: Pt[] = [seq[0]];
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y);
    if (d > jump) {
      runs.push(cur);
      cur = [seq[i]];
    } else cur.push(seq[i]);
  }
  runs.push(cur);
  // 首尾若相邻则并成一段（闭合轮廓）
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    const d = Math.hypot(first[0].x - last[last.length - 1].x, first[0].y - last[last.length - 1].y);
    if (d <= jump) {
      runs[0] = last.concat(first);
      runs.pop();
    }
  }

  const lens = runs.map(runLength);

  // 丢弃「伪短段」：极角排序遇到凹角时半径会突变，切段偶发产生只有两三个候选点、
  // 长度极短的碎片段。它们各自白占 1 个名额，落点却由 `run[0]` 任意决定，
  // 结果经常贴着主轮廓上的点 —— 实测圣诞树 100 张时出现 0.01 的近重合对，
  // 画面上就是两张照片叠在一起（等同于重复内容）。断掉的真实部件（如字母 i 的点）
  // 周长远大于这个阈值，不会被误删。
  if (runs.length > 1) {
    const keep: Pt[][] = [];
    for (let r = 0; r < runs.length; r++) {
      const isFrag = lens[r] < jump && runs[r].length < 4;
      if (!isFrag) keep.push(runs[r]);
    }
    if (keep.length && keep.length < runs.length) {
      runs.length = 0;
      for (let i = 0; i < keep.length; i++) {
        runs.push(keep[i]);
        lens[i] = runLength(keep[i]);
      }
      lens.length = runs.length;
    }
  }

  let totalL = 0;
  for (let i = 0; i < lens.length; i++) totalL += lens[i];
  return { runs, lens, total: totalL, seq };
}

/** 在已追踪好的轮廓上按弧长等距取 k 个点（相位由特征点决定） */
function sampleContour(c: Contour, k: number, feats?: Feature[]): Pt[] {
  const runs = c.runs;
  const lens = c.lens;
  if (k <= 0) return [];
  // 候选点本来就比要的少（形状过小 / 栅格退化）→ 有多少用多少
  if (c.seq.length <= k) return c.seq.slice();
  let totalL = 0;
  for (let i = 0; i < lens.length; i++) totalL += lens[i];
  if (totalL <= 0) return c.seq.slice(0, k);

  // 按长度比例分配点数（每段至少 1 个），再增删到恰好 k 个
  const counts = lens.map((L) => Math.max(1, Math.round((k * L) / totalL)));
  let sumC = 0;
  for (let i = 0; i < counts.length; i++) sumC += counts[i];
  while (sumC > k) {
    let bi = -1;
    let bv = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > 1 && lens[i] > bv) {
        bv = lens[i];
        bi = i;
      }
    }
    if (bi < 0) break;
    counts[bi]--;
    sumC--;
  }
  while (sumC < k) {
    let bi = 0;
    let bv = -1;
    for (let i = 0; i < counts.length; i++) {
      if (lens[i] > bv) {
        bv = lens[i];
        bi = i;
      }
    }
    counts[bi]++;
    sumC++;
  }

  // 有特征点时，整圈点一起旋转到「最能命中特征」的相位；没有则退回取每段中点
  if (feats && feats.length) {
    const phased = chooseOutlinePhase(runs, counts, lens, feats);
    if (phased.length >= k) return phased.slice(0, k);
  }

  const out: Pt[] = [];
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const c = counts[r];
    if (c <= 0) continue;
    if (run.length === 1 || lens[r] <= 0) {
      out.push(run[0]);
      continue;
    }
    // 取每等份的中点，避免总是把点落在段端点上（端点容易与相邻段撞在一起）
    for (let j = 0; j < c; j++) out.push(pointAtLength(run, (lens[r] * (j + 0.5)) / c));
  }
  return out;
}

/** 折线总长 */
function runLength(run: Pt[]): number {
  let L = 0;
  for (let i = 1; i < run.length; i++) L += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
  return L;
}

/** 沿折线取弧长 target 处的点（线性插值） */
function pointAtLength(run: Pt[], target: number): Pt {
  let acc = 0;
  for (let i = 1; i < run.length; i++) {
    const seg = Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y);
    if (acc + seg >= target || i === run.length - 1) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (target - acc) / seg)) : 0;
      return {
        x: run[i - 1].x + (run[i].x - run[i - 1].x) * t,
        y: run[i - 1].y + (run[i].y - run[i - 1].y) * t
      };
    }
    acc += seg;
  }
  return run[run.length - 1];
}

/* ==================== 形状特征点（尖角 / 凹口）与吸附 ==================== */

/** 点集的凸包（Andrew monotone chain，逆时针、不含共线中间点） */
function convexHull(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts.slice();
  const arr = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (let i = 0; i < arr.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], arr[i]) <= 0) lower.pop();
    lower.push(arr[i]);
  }
  const upper: Pt[] = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], arr[i]) <= 0) upper.pop();
    upper.push(arr[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

interface Feature {
  p: Pt;
  /** 显著度（0~1，越大越先被吸附） */
  sal: number;
  /** true = 凹口（轮廓凹进凸包的位置），false = 尖角 */
  concave: boolean;
}

/**
 * 形状的特征点 = **尖角**（凸包上的锐利顶点：心形的下尖、五角星/三角/方形的角）
 *              + **凹口**（轮廓明显凹进凸包的位置：心形顶部中间那道凹、五角星的内角）。
 *
 * 为什么必须有它：弧长等距采样只保证「疏密均匀」，不保证落在特征上。
 * 实测心形取 5 个点时，采样点会**恰好跳过下尖和顶部凹口**，5 张照片排出来
 * 是个圆乎乎的四边形 —— 用户说的「看上去并不是心形」就是这个原因。
 */
export function shapeFeatures(edges: Pt[], scale: number): Feature[] {
  const out: Feature[] = [];
  const hullPts = convexHull(edges);
  if (hullPts.length < 3) return out;

  // 1) 尖角：凸包顶点的转角。圆 / 椭圆的凸包由许多小转角顶点构成，不会命中
  for (let i = 0; i < hullPts.length; i++) {
    const prev = hullPts[(i - 1 + hullPts.length) % hullPts.length];
    const cur = hullPts[i];
    const next = hullPts[(i + 1) % hullPts.length];
    const a1 = Math.atan2(cur.y - prev.y, cur.x - prev.x);
    const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    if (turn > 0.7) out.push({ p: cur, sal: Math.min(1, (turn / Math.PI) * 1.25), concave: false });
  }

  // 2) 凹口：轮廓点到凸包边界的距离（凸包上的点距离为 0，凹进去的点距离 = 凹陷深度）。
  //    深度按「形状尺寸的 6% 就算完全值得吸附」归一化 —— 心形那道凹只有约 13% 深，
  //    若按绝对深度排序会排在尖角后面，反而不被优先命中，而它恰恰是心形的标志。
  const thr = scale * 0.03;
  const deep: Feature[] = [];
  for (let i = 0; i < edges.length; i++) {
    const p = edges[i];
    let best = Infinity;
    for (let k = 0; k < hullPts.length; k++) {
      const a = hullPts[k];
      const b = hullPts[(k + 1) % hullPts.length];
      const d = distToSeg(p.x, p.y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    if (best > thr) deep.push({ p, sal: Math.min(1, best / (scale * 0.06)), concave: true });
  }
  deep.sort((u, v) => v.sal - u.sal);
  // 同一道凹口会有一大片候选点，按间距聚类后每个凹口只留最深的一个
  const sep = scale * 0.16;
  for (let i = 0; i < deep.length && out.length < 14; i++) {
    let dup = false;
    for (let j = 0; j < out.length; j++) {
      if (Math.hypot(out[j].p.x - deep[i].p.x, out[j].p.y - deep[i].p.y) < sep) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(deep[i]);
  }
  out.sort((u, v) => v.sal - u.sal);
  return out;
}

/** 判定「命中特征」的距离阈值（归一化，相对内容区） */
const HIT_R = 0.07;

/**
 * 挑轮廓采样的相位 φ：让等距采样点**尽量落在形状特征上**（心形的下尖与顶部凹口、
 * 星形的角…），同时保持「一圈点始终等距」。
 *
 * 为什么不是「把最近的采样点挪到特征上」：挪点会破坏等距 —— 实测心形 5 个点时
 * 挪完之后左右明显不对称（一侧 0.42、另一侧 0.82），仍然是四不像。
 * 相位法只是把一整圈点**整体旋转**一个角度，间距永远均匀，代价函数
 * 「特征到最近采样点的距离 × 显著度」最小的那个相位就是最佳取景。
 */
function chooseOutlinePhase(
  runs: Pt[][], counts: number[], lens: number[], feats: Feature[]
): Pt[] {
  const STEPS = 96;
  // 没有特征点时 φ 无意义，直接取中点相位（等价于旧行为）
  const phiOf = (s: number): number => 0.03 + (s / STEPS) * 0.94;
  let best: Pt[] = [];
  let bestCost = Infinity;
  const last = feats.length ? STEPS : 0;
  for (let s = 0; s <= last; s++) {
    const phi = phiOf(s);
    const pts: Pt[] = [];
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const c = counts[r];
      if (c <= 0) continue;
      if (run.length === 1 || lens[r] <= 0) {
        pts.push(run[0]);
        continue;
      }
      for (let j = 0; j < c; j++) pts.push(pointAtLength(run, (lens[r] * (j + phi)) / c));
    }
    if (!pts.length) break;
    // 代价函数带封顶：命中（距离 < HIT_R）才算真正「命中」，没命中的特征无论差多远
    // 都只记一个固定代价 —— 这样优化器会优先「把某个特征正好打中」，
    // 而不是把误差平摊到两个特征上（平摊的结果是下尖差 0.129、凹口也差一点，两个都不像）。
    let cost = 0;
    for (let f = 0; f < feats.length; f++) {
      let bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - feats[f].p.x, pts[i].y - feats[f].p.y);
        if (d < bestD) bestD = d;
      }
      cost += feats[f].sal * Math.min(bestD, HIT_R);
    }
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = pts;
    }
  }
  return best;
}

/**
 * 特征补刀：相位法只能在「整圈等距」的前提下取景，当轮廓点数与特征位置不整除时
 * （心形 16 张时轮廓只有 7 个点，下尖正好落在两个采样点中间）会差一点点命中。
 * 这里对**尚未命中的高显著度特征**做一次局部挪点，最多挪 2 个 —— 只动最关键的
 * 尖角/凹口，且挪完若与邻居挤在一起就撤销，因此不会像「全部特征都挪」那样把排布搞散。
 *
 * maxRatio 是「最近邻距离 max/min」的上限：方形取 5 个点时，把离角最近的点整个
 * 拽到角上会让一侧间距 1.9、另一侧 1.2（比值 2.76），画面上是一圈忽疏忽密的点，
 * 比「没压住角」更难看。因此挪动前后均匀度变差超过阈值就撤销这次挪动。
 */
function nudgeFeatures(pts: Pt[], feats: Feature[], maxMove: number, maxRatio: number): Pt[] {
  if (pts.length < 3 || !feats.length) return pts;
  const out = pts.slice();
  const base = medianNN(out);
  if (base <= 0) return pts;
  const before = spacingRatio(out);
  let moved = 0;
  for (let f = 0; f < feats.length && moved < maxMove; f++) {
    if (feats[f].sal < 0.45) continue;
    const t = feats[f].p;
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < out.length; i++) {
      const d = Math.hypot(out[i].x - t.x, out[i].y - t.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi < 0 || bd <= HIT_R || bd > base * 2.2) continue;
    const prev = out[bi];
    out[bi] = { x: t.x, y: t.y };
    let minD = Infinity;
    for (let i = 0; i < out.length; i++) {
      if (i === bi) continue;
      const d = Math.hypot(out[i].x - out[bi].x, out[i].y - out[bi].y);
      if (d < minD) minD = d;
    }
    if (minD < base * 0.45 || minD < MIN_GAP || spacingRatio(out) > Math.max(maxRatio, before)) {
      out[bi] = prev;
    } else moved++;
  }
  return out;
}

/** 点集的「最近邻距离 max/min」：衡量排布疏密是否均匀（越小越均匀） */
function spacingRatio(pts: Pt[]): number {
  const nn = nearestList(pts);
  let lo = Infinity;
  let hi = 0;
  for (let i = 0; i < nn.length; i++) {
    if (nn[i] < lo) lo = nn[i];
    if (nn[i] > hi) hi = nn[i];
  }
  return hi / Math.max(lo, 1e-6);
}

/** 每个点的最近邻距离表 */
function nearestList(pts: Pt[]): number[] {
  const n = pts.length;
  const nn: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = d2(pts[i], pts[j]);
      if (d < best) best = d;
    }
    nn[i] = Math.sqrt(best);
  }
  return nn;
}

/** 点集的典型间距（最近邻中位数），用于判断「挪点后会不会挤在一起」 */
function medianNN(pts: Pt[]): number {
  const n = pts.length;
  if (n < 2) return 0;
  const nn = nearestList(pts).sort((a, b) => a - b);
  return nn[Math.floor(n / 2)];
}

/** 点位之间的最小允许间距（归一化，相对内容区） */
const MIN_GAP = 0.03;

/**
 * 兜底分离：任何两个点靠得比 MIN_GAP 更近，画面上就是「两张几乎完全重叠的照片」，
 * 用户看到的就是重复内容。分两步修：
 *
 *   1) **推挤松弛**：沿两点连线各推开半格，重复若干轮。开销 O(轮数 × n²)，
 *      100 个点也只有几万次运算，且位移很小、不会破坏整体排布；
 *      形状外的落点直接放弃（不越出形状边界）。
 *   2) **网格搜索兜底**：松弛仍分不开的（长条形等极端形状，两侧都顶到边界）时，
 *      把靠后的那个点搬到「离其他所有点最远」的形状内部位置，最多搬 6 次。
 *
 * 为什么会出现近重合点：轮廓追踪是「极角排序 + 跳变切段」，细长部件（爱心锁的锁梁）
 * 或多组件形状上偶发切段不准，就会沿一条长线段插值出贴着另一个点的新点 ——
 * 实测爱心锁 12 张时出现过 0.016 的近重合对。
 */
function enforceMinGap(pts: Pt[], test: (x: number, y: number) => boolean): void {
  const n = pts.length;
  if (n < 3) return;
  const inside = (x: number, y: number): boolean => test((x - 0.5) * 2, (0.5 - y) * 2);

  for (let iter = 0; iter < 12; iter++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pts[j].x - pts[i].x;
        let dy = pts[j].y - pts[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= MIN_GAP) continue;
        if (d < 1e-6) {
          // 完全重合：给一个确定性的小偏移方向，避免除零
          dx = 0.001;
          dy = 0;
          d = 0.001;
        }
        const push = (MIN_GAP - d) / 2 + 0.0005;
        const ux = dx / d;
        const uy = dy / d;
        const ax = pts[i].x - ux * push;
        const ay = pts[i].y - uy * push;
        const bx = pts[j].x + ux * push;
        const by = pts[j].y + uy * push;
        let ok = false;
        if (inside(ax, ay)) {
          pts[i] = { x: ax, y: ay };
          ok = true;
        }
        if (inside(bx, by)) {
          pts[j] = { x: bx, y: by };
          ok = true;
        }
        if (ok) moved++;
      }
    }
    if (!moved) break;
  }

  // 兜底：仍贴在一起的点，直接搬到形状内「离其他点最远」的位置
  const G = 40;
  for (let round = 0; round < 6; round++) {
    let bj = -1;
    let bd = MIN_GAP;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d < bd) {
          bd = d;
          bj = j;
        }
      }
    }
    if (bj < 0) return;
    let bx = pts[bj].x;
    let by = pts[bj].y;
    let bv = -1;
    for (let a = 0; a <= G; a++) {
      const x = a / G;
      for (let b = 0; b <= G; b++) {
        const y = b / G;
        if (!inside(x, y)) continue;
        let m = Infinity;
        for (let i = 0; i < n; i++) {
          if (i === bj) continue;
          const d = Math.hypot(x - pts[i].x, y - pts[i].y);
          if (d < m) m = d;
        }
        if (m > bv) {
          bv = m;
          bx = x;
          by = y;
        }
      }
    }
    // 搬不到更好的位置（长条形等极端形状）就放弃，避免来回摆动
    if (bv <= bd) return;
    pts[bj] = { x: bx, y: by };
  }
}

export interface GenOptions {
  /** 轮廓密度 0.6~1.6：越大轮廓点数占比越高 → 形状轮廓越清晰 */
  density?: number;
  /** 抖动 0~1 */
  jitter?: number;
  /** 随机种子 */
  seed?: number;
  /**
   * 铺满模式：true 时点位数量可以多于照片数，由渲染层按下标循环复用照片。
   * **默认 false —— 点位数量严格等于照片数，一张照片一格，绝不重复。**
   */
  repeat?: boolean;
  /** 铺满模式下的目标格数（仅 repeat = true 生效，一般传形状的建议张数） */
  slots?: number;
  /**
   * 跳过固定模板、强制走旧的自适应排点。
   * 编辑器给 algo < 4 的旧作品重排时传 true，避免老排布被突然换成像素模板。
   */
  legacy?: boolean;
  /**
   * 填充风格（实心 / 描边 / 渐变）。缺省用形状的推荐风格。
   * 描边会改变张数（挖掉内部格），调用方重新算完要同步 UI 的「需 N 张」。
   */
  fill?: PWFillMode;
}

/** 归一化区间内两点的距离平方 */
function d2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** 把边长夹到安全范围：太小照片看不懂，太大会互相压住 */
function clampCell(v: number): number {
  if (!v || !isFinite(v)) return 0.12;
  return Math.max(0.03, Math.min(0.5, v));
}

/**
 * 由点集反推「单张照片边长」（归一化，相对内容区边长）。
 *
 * 为什么不用「周长 / 点数」估算：轮廓候选点由水平、垂直两套扫描共同产生，
 * 把候选点总数直接当周长会重复计一次。照片数少时这个误差会被放大成两倍 ——
 * 实测心形 5 张时 cell=0.82，单张占内容区 82%，整块糊成矩形，
 * 这就是「看上去并不是心形」的根因。
 *
 * 最近邻距离是纯几何量，与形状是否凹凸、是否栅格化都无关，
 * 解析形状、字母数字、文字、自定义蒙版一律适用。
 *
 * @param pct   取最近邻距离的第几分位（0~1）
 * @param bulge 在该分位上再乘的系数（略大于 1 让相邻贴片咬合、轮廓连续）
 */
function estimateCell(pts: Pt[], pct: number, bulge: number): number {
  const n = pts.length;
  if (n <= 1) return 0.6;
  if (n === 2) return clampCell(Math.sqrt(d2(pts[0], pts[1])) * bulge);
  const nn = nearestList(pts).sort((a, b) => a - b);
  // 取值说明：
  //  · 密集铺满（轮廓 + 内部混合）取高分位：六边形网格里同一行的近邻是 h、斜向是 1.118h，
  //    取 80 分位与旧版在 20~40 张时验证过的尺寸一致，不会把照片改小导致满屏缝隙；
  //  · 纯轮廓（照片少，一圈点）取中位偏上并略放大：相邻贴片互相咬住，轮廓才连续不断。
  return clampCell(nn[Math.min(n - 1, Math.floor(n * pct))] * bulge);
}

/**
 * 单张贴片边长上限（占内容区边长比例）。
 * 超过内容区 1/3 后，「一圈照片」就不再读得出形状，只剩一坨色块 ——
 * 这是照片很少时的硬约束：给不出实心，至少不能糊成一片。
 */
export const TILE_CAP = 0.32;

/**
 * 「算内部点」的最低探点分：9 个探点（中心 + 8 方向，都在 0.48 格距处）里至少 7 个
 * 落在形状内，等价于「贴片最多探出 16% 身位」。低于这个分的格子会明显压到形状外，
 * 正是把心形凹口、尖角糊掉的那批（实测心形 60 张时凹口斜坡上的一个内部贴片，
 * 直接把凹口深度从 0.07 压到 0.037），所以它们改走「压回轮廓」的边界路径。
 * 定 7 而不是 9：雪花、枝叶这类细长部件上，贴片本来就比部件宽，全内要求会让它们
 * 一个内部点都剩不下（实测雪花覆盖率从 90% 掉到 56%，手臂变成断续的点）。
 */
const SOLID_SCORE = 7;

/** 贴片之间的微小咬合系数：格距处的临界贴合在浮点与抗锯齿下会闪白线，放大 2% 盖掉 */
const TILE_FIT = 1.02;

export interface LayoutResult {
  /**
   * 归一化点位（x/y ∈ [0,1]，y 已翻转为屏幕方向）。
   * 默认模式长度 = 照片数（一一对应，绝不重复）；铺满模式才可能多于照片数。
   */
  pts: Pt[];
  /**
   * 建议单张照片边长（归一化，相对内容区边长）。
   * 默认模式下等于格距 —— 按这个值画，贴片正好拼满形状内部、不留缝（实心填充）。
   */
  cell: number;
}

/** 铺满模式下的单次格数上限（防呆：正常 100 张照片用不到这么多） */
export const MAX_TILES = 400;

/** 取形状的原始判定函数（解析形状自带 test；文字 / 蒙版走栅格化） */
function shapeTestOf(def: ShapeDef): ((x: number, y: number) => boolean) | null {
  if (def.kind === 'analytic') return def.test || null;
  if (def.mask) return maskTest(def.mask);
  return null;
}

/**
 * 形状度量（带缓存）：面积占比、周长、以及「实心填满所需的最少贴片数」。
 *
 * 抽出来是因为这几个量有两处用途：
 *   · 铺点算法要用它推贴片边长（见 layout 里的二次方程）；
 *   · 界面要用 solidMin 提示「再多传几张才能填满」。
 * 形状归一化与网格扫描都只做一次，缓存在 def 上。
 */
export function shapeMetrics(def: ShapeDef): ShapeMetrics | null {
  const raw = shapeTestOf(def);
  if (!raw) return null;
  if (def.metrics) return def.metrics;
  const test = def.ntest || normalizeTest(raw);
  def.ntest = test; // 缓存，避免每次重排都重新采样包围盒
  const grid = scanGrid(test, 100);
  if (grid.area <= 0.0001 || grid.edges.length === 0) return null;
  const area = Math.min(grid.area / 4, 1);
  // 周长用**穿越点计数**估：每个边界穿越点对应约一个网格步长的边界长度。
  // 不用「轮廓折线总长」是因为轮廓追踪靠极角排序，遇到 V 形侧枝（雪花的小枝、
  // 手牵手的双臂）会在同一角度上反复横跳，路径长度会爆炸 —— 实测雪花算出 111.6，
  // 真值只有 10 左右，格距跟着被放大 4 倍、贴片直接顶到上限。
  // 穿越计数的误差来自斜边（斜 45° 时最多长 41%），对「算格距」这点影响可以接受。
  const step = 2 / 100;
  const perim = (grid.edges.length * step) / 2;
  const met: ShapeMetrics = {
    area,
    perim,
    // 边界上至少要有 12 个贴片，描出来的形状才认得出。实心铺满时贴片边长
    // t ≈ sqrt(A/n)（A 为形状面积占比），代入 P/t ≥ 12 得 n ≥ 144A/P²，
    // 再加上内部必需的几片，就是「少于这么多张就别铺实心、改描轮廓」的门槛。
    solidMin: Math.max(6, Math.ceil(6 + (144 * area) / Math.max(perim * perim, 1e-6))),
    edges: grid.edges
  };
  def.metrics = met;
  return met;
}

/**
 * 生成排列点位。
 * 返回归一化坐标 Pt[]（x/y ∈ [0,1]，y 已翻转为屏幕方向），可直接映射到画布内容区。
 */
export function generatePoints(def: ShapeDef, count: number, opt: GenOptions = {}): Pt[] {
  return layout(def, count, opt).pts;
}

/* ==================== 固定网格模板（参考图样式） ==================== */

/**
 * 固定网格模板：把形状栅格化成一张「像素画」。
 *
 * 这是参考图样式的核心 —— 所有照片都是**统一尺寸的正方形**、**严格网格对齐**、
 * **实心无缝**（内部格一片不缺，天然没有空洞），且**每种形状的张数固定**：
 * 同一形状永远派生出同一个模板，编辑器据此强制「照片数 == 模板张数」。
 *
 * 派生规则（完全确定，无随机成分）：
 *   1. 在 G×G 网格（G ∈ [5,15]）上逐格判定中心是否在形状内；
 *   2. 裁掉四周全空的行/列（保持格子正方形不变）；
 *   3. 选「格子数最接近形状建议张数」的那个 G（并列取更小的 G，马赛克块更大更有味道）。
 */
export function templateOf(def: ShapeDef): PWTemplateGrid | null {
  if (def.tpl !== undefined) return def.tpl;
  // 手工精修的像素画优先：观感远好于自动栅格化（心形底部、五角星对称性）
  if (def.gridMask && def.gridMask.length) {
    const rows = def.gridMask.length;
    const cols = def.gridMask[0].length;
    const cells: boolean[] = [];
    let count = 0;
    for (let j = 0; j < rows; j++) {
      const line = def.gridMask[j];
      for (let i = 0; i < cols; i++) {
        const on = line[i] === '█' || line[i] === 'X' || line[i] === '#';
        cells.push(on);
        if (on) count++;
      }
    }
    const tpl: PWTemplateGrid = { cols, rows, count, cells };
    def.tpl = tpl;
    return tpl;
  }
  const raw = shapeTestOf(def);
  if (!raw) {
    def.tpl = null;
    return null;
  }
  const test = def.ntest || normalizeTest(raw);
  def.ntest = test;
  let best: { cols: number; rows: number; count: number; cells: boolean[]; d: number } | null = null;
  for (let g = 5; g <= 15; g++) {
    const r = rasterizeGrid(test, g);
    if (!r || r.count < 6) continue;
    const d = Math.abs(r.count - def.suggest);
    if (!best || d < best.d) best = { cols: r.cols, rows: r.rows, count: r.count, cells: r.cells, d };
    if (d === 0) break;
  }
  const tpl: PWTemplateGrid | null = best
    ? { cols: best.cols, rows: best.rows, count: best.count, cells: best.cells }
    : null;
  def.tpl = tpl;
  return tpl;
}

/** 在 G×G 网格上栅格化形状，返回裁掉空边后的格子矩阵 */
function rasterizeGrid(test: (x: number, y: number) => boolean, g: number) {
  let minI = g;
  let maxI = -1;
  let minJ = g;
  let maxJ = -1;
  let count = 0;
  const all: boolean[] = [];
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const inside = test(-1 + (i + 0.5) * (2 / g), -1 + (j + 0.5) * (2 / g));
      all.push(inside);
      if (inside) {
        count++;
        if (i < minI) minI = i;
        if (i > maxI) maxI = i;
        if (j < minJ) minJ = j;
        if (j > maxJ) maxJ = j;
      }
    }
  }
  if (!count) return null;
  const cells: boolean[] = [];
  // **行序必须是「屏幕上到下」**：数学域里 j 越大 y 越高（越靠上），
  // 而屏幕 y 向下增长，所以发射时从 maxJ 往 minJ 倒着走，让 cells 第 0 行 = 画面顶行。
  // 这与手工 gridMask 的书写顺序（第一行字符串 = 顶行）保持一致 ——
  // 两条路径的行序一旦不一致，自动派生的形状就会和手绘形状上下相反。
  for (let j = maxJ; j >= minJ; j--) {
    for (let i = minI; i <= maxI; i++) cells.push(all[j * g + i]);
  }
  return { cols: maxI - minI + 1, rows: maxJ - minJ + 1, count, cells };
}

/* ==================== 填充风格 ==================== */

/**
 * 把「基础网格」按填充风格变换成最终模板。
 *
 *   · solid / fade —— 网格不动（fade 的透气感靠渲染层调透明度，张数不变）；
 *   · ring        —— 挖掉**内部格**：一个开格若「上下左右四邻也都是开格」，
 *                    说明它被形状包围、属于内部，描边时去掉；只剩边界那一圈。
 *
 * 为什么用「四邻」判内部而不是「距轮廓 N 格」：四邻判定天然贴合形状的拓扑 ——
 * 1 格宽的枝条（雪花的小枝、手牵手的双臂）本来就没有内部格，描边后**完整保留**；
 * 而团块状形状（五角星的中心、房子的墙体）会被挖空。不需要为每个形状调参数。
 *
 * 兜底：挖完少于 6 格、或不足原来的 1/4 时**原样返回实心** ——
 * 形状被挖得只剩两个点比实心更糟，宁可不动。
 */
export function applyFillMode(tpl: PWTemplateGrid, mode: PWFillMode): PWTemplateGrid {
  if (mode !== 'ring') return tpl;
  const { cols, rows, cells } = tpl;
  const at = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < cols && j < rows ? cells[j * cols + i] : false;
  const out: boolean[] = new Array(cells.length).fill(false);
  let count = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!cells[j * cols + i]) continue;
      const inner = at(i - 1, j) && at(i + 1, j) && at(i, j - 1) && at(i, j + 1);
      if (!inner) {
        out[j * cols + i] = true;
        count++;
      }
    }
  }
  if (count < 6 || count < tpl.count * 0.25) return tpl;
  return { cols, rows, count, cells: out };
}

/**
 * 取形状在指定填充风格下的模板。
 * mode 缺省用形状的推荐风格（ShapeDef.fill）；形状不支持时退回实心。
 */
export function templateFor(def: ShapeDef, mode?: PWFillMode): PWTemplateGrid | null {
  const base = templateOf(def);
  if (!base) return null;
  return applyFillMode(base, mode || def.fill || 'solid');
}

/** 形状推荐（或作品指定）的填充风格 */
export function fillModeOf(def: ShapeDef, override?: PWFillMode): PWFillMode {
  return override || def.fill || 'solid';
}

/**
 * 模板 → 点位。
 *
 * **行序约定：cells 第 0 行 = 屏幕第一行（顶部），列序第 0 列 = 最左列。**
 * 手工模板（gridMask）本来就按书写顺序从上到下写，自动栅格化也统一成这个顺序
 * （见 rasterizeGrid 的说明）。因此这里直接把矩阵映射到屏幕坐标，**不再经过
 * 「数学坐标 y 向上」的翻转** —— 早先版本在这里多做了一次翻转，结果所有模板形状
 * 都上下颠倒了（心形两瓣朝下、三角形尖朝上）。
 *
 * 格子边长 = 1/max(cols, rows)，整块在内容区居中；点位顺序 = 阅读顺序
 * （从上到下、从左到右），照片 slots[i] ↔ photos[i] 一一对应。
 *
 * 照片不足模板张数时只返回**前 n 个格子**：预览里形状从上往下逐渐被填满，
 * 用户一眼看出「还差几张」，也绝不出重复照片。
 */
function templateLayout(tpl: PWTemplateGrid, n: number): LayoutResult {
  const M = Math.max(tpl.cols, tpl.rows);
  const s = 1 / M; // 屏幕格距（内容区归一化，格子恒为正方形）
  const ox = (1 - tpl.cols * s) / 2;
  const oy = (1 - tpl.rows * s) / 2;
  const pts: Pt[] = [];
  for (let j = 0; j < tpl.rows; j++) {
    for (let i = 0; i < tpl.cols; i++) {
      if (!tpl.cells[j * tpl.cols + i]) continue;
      if (pts.length >= n) break;
      pts.push({ x: ox + (i + 0.5) * s, y: oy + (j + 0.5) * s });
    }
  }
  return { pts, cell: clampCell(s) };
}


/** 生成排列点位 + 建议照片边长（渲染层需要 cell 来决定照片画多大） */
export function layout(def: ShapeDef, count: number, opt: GenOptions = {}): LayoutResult {
  const n = Math.max(1, count | 0);
  // 点位数量：
  //   默认 = 照片数（一张照片一格，渲染层 slots[i] ↔ photos[i] 一一对应，绝不重复）；
  //   铺满模式 = 至少照片数、至多形状建议张数（由渲染层循环复用照片）。
  const want = opt.slots == null ? n : opt.slots | 0;
  const total = opt.repeat ? Math.max(n, Math.min(MAX_TILES, want)) : n;
  const rand = mulberry32(opt.seed || 1);
  const jitter = opt.jitter || 0;
  const density = opt.density || 1;

  // ── 固定网格模板（algo 4，默认路径）──────────────────────────────
  // 参考图样式：统一尺寸正方形 + 严格网格对齐 + 实心无缝 + 每种形状固定张数。
  // 照片数 == 模板张数 → 整张模板；照片不足 → 前 n 个格子（预览部分填充，
  // 编辑器会拦住「完成」直到传够）。照片多于模板张数或旧作品（编辑器传 legacy）
  // 走下方自适应路径 —— 点位数量 == 照片数这条不变量在任何路径下都成立。
  if (!opt.legacy) {
    const tpl = templateFor(def, opt.fill);
    if (tpl && n <= tpl.count) return templateLayout(tpl, n);
  }

  // 单张照片：直接居中（需求里的边界情况）
  if (total === 1) return { pts: [{ x: 0.5, y: 0.5 }], cell: 0.6 };

  const met = shapeMetrics(def);
  if (!met) return centerFallback(total);
  const test = def.ntest as (x: number, y: number) => boolean;

  // ── 实心填充的尺度模型 ─────────────────────────────────────────────
  // 把形状当成一整块要用 total 个正方形贴片**盖满**的区域。贴片按格点铺开、
  // 边长 = 格距 t 时相邻贴片严丝合缝，于是「贴片数」等于「覆盖面积 / t²」。
  // 覆盖面积不只是形状本身：想让形状的边也盖住，沿轮廓还要压一圈贴片
  // （每个贴片中心落在轮廓上、向内外各伸出半格），这一圈的数量约 P/t 个，
  // 其中一半落在形状外，落在内的那半补的是边缘带。于是：
  //
  //     total ≈  A/t²  +  0.5·P/t
  //              ↑         ↑
  //         完整在形状内   压轮廓的那一圈里落在形状内的部分
  //
  // 解出正根 t = [P + sqrt(P² + 16·total·A)] / (4·total)（A 用面积占比，P 用归一化周长）。
  // 只按 A/t² 反解（不带上边界那一圈）会得到偏小的格距：内部塞得满满的，
  // 边界只剩下零星几个名额，形状边缘反而盖不住（实测心形 40 张覆盖率掉到 88%）。
  const cont = contourRuns(met.edges);
  const area = met.area;
  const perim = met.perim;
  // 归一化格距 → 形状域格距（坐标域是 2×2，故 ×2）
  const hEst = ((perim + Math.sqrt(perim * perim + 16 * total * area)) / (4 * total)) * 2;

  if (total >= met.solidMin) {
    // 形状特征（尖角 / 凹口）先算出来：实心铺满时它们是补洞优先级最高的边界候选
    const feats = shapeFeatures(met.edges, 2);
    const res = coverShape(test, hEst, total, jitter, rand, feats);
    if (res.pts && res.pts.length >= total) {
      // 均匀格点阵未必有格子正好压在心形下尖 / 顶部凹口上，再做一次**轻微**吸附兜底
      if (feats.length) snapFeatures(res.pts, feats, res.h);
      // 数学坐标（y 向上）→ 屏幕坐标（y 向下），并归一化到 [0,1]
      const pts = res.pts.map((p) => ({ x: (p.x + 1) / 2, y: (1 - p.y) / 2 }));
      // 兜底：任何两个点都不允许贴在一起 —— 那在画面上就是两张几乎完全重叠的照片
      enforceMinGap(pts, test);
      return { pts, cell: clampCell(Math.min((res.h / 2) * TILE_FIT, TILE_CAP)) };
    }
    // 极瘦长 / 栅格退化的形状凑不够格点 → 落到下面的描轮廓分支：
    // 宁可退成空心轮廓，也绝不少画一张照片（点数必须等于照片数）
  }

  // ── 照片太少：只描轮廓 ─────────────────────────────────────────────
  // 一圈沿轮廓等距的点最像那个形状（内部只塞一两个点既不成面、又打乱轮廓节奏）。
  // 「轮廓密度」滑杆在这里生效：调大 = 轮廓点更密（默认 1 不偏置）。
  const bias = Math.max(0.5, Math.min(1.8, density));
  let k = Math.round(total * Math.max(0.5, Math.min(1, bias)));
  if (k < Math.min(3, total)) k = Math.min(3, total);
  if (k > total) k = total;

  // 形状特征（尖角 / 凹口）：轮廓采样会整体旋转到「最能命中特征」的相位，
  // 再对仍未命中的关键特征补一次局部挪点 —— 这是「照片少也认得出形状」的关键，
  // 否则 5 张照片排出来只是个圆乎乎的四边形。
  const feats = k >= 3 ? shapeFeatures(met.edges, 2) : [];
  let edgePts = sampleContour(cont, k, feats);
  // 1.45 = 相邻间距 max/min 的上限：方形 5 张时把点整个拽到角上会让间距比冲到 2.76，
  // 一圈忽疏忽密的点比「没压住角」更难看，所以这种挪动直接撤销。
  if (feats.length) edgePts = nudgeFeatures(edgePts, feats, 2, 1.45);
  // 特征点不够用时再从轮廓补：宁可轮廓疏一点，也要保证点数等于照片数
  if (edgePts.length < total) {
    const re = sampleContour(cont, total, feats);
    if (re.length > edgePts.length) edgePts = re;
  }

  // 数学坐标（y 向上）→ 屏幕坐标（y 向下），并归一化到 [0,1]
  const pts = edgePts.slice(0, total).map((p) => ({ x: (p.x + 1) / 2, y: (1 - p.y) / 2 }));
  // 兜底：任何两个点都不允许贴在一起 —— 那在画面上就是两张几乎完全重叠的照片
  enforceMinGap(pts, test);
  // 只描轮廓时，贴片边长取轮廓环的格距，让这一圈照片连成一条带
  return { pts, cell: clampCell(Math.min(perim / Math.max(total, 1), TILE_CAP)) };
}

/**
 * 实心铺满：在形状上铺一层格点，贴片边长 = 格距，相邻贴片严丝合缝盖满形状内部。
 *
 * 候选格点分三种命运：
 *   · **贴片完整落在形状内**（9 个探点全在内）→ 全部保留。这些贴片把内部铺满，
 *     一片都不能删 —— 贴片是按格距严丝合缝铺的，删掉一个就是一个贴片大小的方洞
 *     （旧版「随机截断 / 稀疏化」在画面上就是这么露馅的）。所以点数只能靠**调格距**来凑；
 *   · **压到形状边缘的**（有一角探出去）→ 作为边界候选，按「能补多少还没盖住的面积」
 *     挑选，再压回轮廓上（见 projectToShape）。形状特征点（尖角 / 凹口）在这里**优先占位**；
 *   · 压不回轮廓的（射线方向整条都在形状外）→ 丢弃。
 *
 * 为什么内部点要求「整片在内」而不是「中心在内」：中心在内、贴片探出去的那一圈，
 * 会把形状的凹口、尖角糊掉 —— 实测心形 60 张时，凹口斜坡上的一个内部贴片探进凹口，
 * 凹口深度从 0.07 掉到 0.037，整颗心就开始不像心了。让边界那一圈统一压在轮廓上，
 * 一半在内一半在外，凹口和尖角才能保持利落。
 *
 * 为什么中心必须压回轮廓、不能留在形状外：实测圆形最远照片中心到圆心 0.545 > 半径 0.5，
 * 曲边形状的轮廓会糊成一圈毛边。压在轮廓上则一半在内一半在外 —— 边界照样 crisp，也不越界。
 */
function coverShape(
  test: (x: number, y: number) => boolean,
  hEst: number,
  want: number,
  jitter: number,
  rand: () => number,
  feats: Feature[]
): { pts: Pt[] | null; h: number } {
  let h = hEst;
  let cells: Cell[] = [];
  let inner = 0;
  // 凹口附近的格子不算内部点：贴片压在凹口上必然把凹口糊掉（见下面的说明），
  // 它们统一走边界路径（压回轮廓或与凹口贴片合并）。
  const nearConcave = (c: Pt): boolean => {
    for (let i = 0; i < feats.length; i++) {
      if (!feats[i].concave) continue;
      if (Math.hypot(feats[i].p.x - c.x, feats[i].p.y - c.y) < h * 0.7) return true;
    }
    return false;
  };
  let near = 0;
  // 格距搜索：格点数 ∝ 1/格距²，缩小格距 → 内部格点与边界候选一起变多。
  // 目标是「内部格点数不超过照片数」（内部片一片不删）且「可用候选不少于照片数」
  // （差额用边界候选补），两个条件一起夹出格距。
  for (let it = 0; it < 16; it++) {
    cells = latticeCells(test, h);
    inner = 0;
    near = 0;
    for (let i = 0; i < cells.length; i++) {
      if (nearConcave(cells[i])) continue;
      near++;
      if (cells[i].score >= SOLID_SCORE) inner++;
    }
    if (inner > want) {
      h *= 1.08;
      continue;
    }
    if (near < want) {
      h *= 0.92;
      continue;
    }
    break;
  }
  // 兜不住（极瘦长 / 栅格退化）：交回上层退回描轮廓，宁可空心也绝不少画一张照片
  if (inner > want || near < want) return { pts: null, h };
  /** 该格点是否可用（凹口附近的直接不要） */
  const usableAt = (i: number): boolean => !nearConcave(cells[i]);
  /** 该格点是否算「内部点」：整片基本在形状内、且不在凹口附近 */
  const innerAt = (i: number): boolean => usableAt(i) && cells[i].score >= SOLID_SCORE;

  // 边界候选：**形状特征点优先**（心形下尖、顶部凹口这些地方永远是最大的一块空洞，
  // 贴片正好压在上面既补了洞又让尖角清晰），再是各格点压回轮廓的落点。
  // 压回来的点按分数（越「在形状里」越好）排序，并做一次最小间距去重：
  // 凹口、尖角处会有好几个格点被压到同一小块边界上，两个贴片叠在一起既像重复照片，
  // 又会让后面的特征吸附无处下脚。
  const anchor = insideAnchor(test);
  const sep = h * 0.5;
  const ring: Pt[] = [];
  // 全部落点（含被去重淘汰的）：边界候选万一被去重/投影淘汰到不够名额，
  // 就从这里按分数顺序补人 —— 宁可两张照片挨得近一点，也绝不少画一张照片。
  // 这条兜底对多组件形状是必需的：兔子（身体+两只耳朵+尾巴）、爱心锁这类形状，
  // 外部格点会大量投影到同一段边界上，去重后候选数掉到需求以下，
  // 整体退回描轮廓的后果是内部直接空掉（实测兔子覆盖率从 90% 掉到 38%）。
  const ringAll: Pt[] = [];
  const addPt = (p: Pt): boolean => {
    ringAll.push(p);
    for (let j = 0; j < ring.length; j++) {
      if (Math.hypot(ring[j].x - p.x, ring[j].y - p.y) < sep) return false;
    }
    ring.push(p);
    return true;
  };
  let nFeat = 0;
  for (let i = 0; i < feats.length; i++) {
    if (feats[i].sal >= 0.3 && addPt(feats[i].p)) nFeat++;
  }
  const cand: Cell[] = [];
  for (let i = 0; i < cells.length; i++) if (!innerAt(i)) cand.push(cells[i]);
  cand.sort((u, v) => v.score - u.score);
  for (let i = 0; i < cand.length; i++) {
    const p = projectToShape(test, cand[i], anchor);
    // 压回轮廓后落在凹口边上的同样不要：凹口斜坡上多一张照片，凹口就被啃掉一块
    // （实测心形 60 张时，斜坡上的落点让凹口深度从 0.07 掉到 0.037，又在边缘线徘徊）。
    if (!p || nearConcave(p)) continue;
    addPt(p);
  }

  const need = want - inner;
  const keepRing: Pt[] = [];
  if (need > 0 && ringAll.length > 0) {
    if (need >= ring.length) {
      // 名额装得下所有（去重后的）候选 → 不用算补洞价值，先到先得。
      // 形状采样 + 逐候选打分是这里最贵的一步（S×候选数 次测试），能省则省。
      for (let i = 0; i < ring.length; i++) keepRing.push(ring[i]);
      for (let i = 0; i < ringAll.length && keepRing.length < need; i++) {
        if (keepRing.indexOf(ringAll[i]) >= 0) continue;
        keepRing.push(ringAll[i]);
      }
    } else {
      // 形状内采样 + 标记「已被内部贴片盖住」的样本，边界候选按补洞能力排序
      const samples = sampleInside(test);
      const covered = new Uint8Array(samples.length);
      const half = h / 2;
      for (let i = 0; i < cells.length; i++) {
        if (!innerAt(i)) continue;
        for (let s = 0; s < samples.length; s++) {
          if (covered[s]) continue;
          if (Math.abs(samples[s].x - cells[i].x) <= half && Math.abs(samples[s].y - cells[i].y) <= half) {
            covered[s] = 1;
          }
        }
      }
      // 特征点（ring 开头那几个）**先占位**：心形的下尖、顶部凹口是「一眼认出形状」的关键，
      // 不能因为别处空洞更大就被挤掉；剩下的名额才按补洞能力分配。
      const taken: Pt[] = [];
      const featTake = Math.min(nFeat, need);
      for (let i = 0; i < featTake; i++) {
        keepRing.push(ring[i]);
        taken.push(ring[i]);
      }
      const rest: number[] = [];
      for (let i = nFeat; i < ring.length; i++) rest.push(i);
      const val = (i: number): number => {
        const p = ring[i];
        let v = 0;
        for (let s = 0; s < samples.length; s++) {
          if (covered[s]) continue;
          if (Math.abs(samples[s].x - p.x) <= half && Math.abs(samples[s].y - p.y) <= half) v++;
        }
        return v;
      };
      rest.sort((a, b) => val(b) - val(a));
      for (let i = 0; i < rest.length && keepRing.length < need; i++) {
        keepRing.push(ring[rest[i]]);
        taken.push(ring[rest[i]]);
      }
      // 名额还不够 → 从被去重淘汰的落点里按分数（原顺序，分数高的在前）补人：
      // 挨得近总好过少画一张照片，少了任何一张都是「照片丢了」的观感事故。
      for (let i = 0; i < ringAll.length && keepRing.length < need; i++) {
        if (taken.indexOf(ringAll[i]) >= 0) continue;
        keepRing.push(ringAll[i]);
        taken.push(ringAll[i]);
      }
    }
  }

  const pts: Pt[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (!innerAt(i)) continue;
    // 抖动只给内部格点：边界格点必须留在轮廓上，抖出去就成越界了
    pts.push({
      x: cells[i].x + (rand() - 0.5) * h * jitter * 0.5,
      y: cells[i].y + (rand() - 0.5) * h * jitter * 0.5
    });
  }
  for (let i = 0; i < keepRing.length; i++) pts.push(keepRing[i]);
  return { pts: pts.length >= want ? pts : null, h };
}

interface Cell {
  x: number;
  y: number;
  /** 落在形状内的探点数（1~9），越大说明这张贴片越「在形状里面」 */
  score: number;
}

/**
 * 铺一层格点（奇数行右移半格，比正方形网格更像自然堆叠），并给每个格子打分。
 * 打分用「中心 + 8 个方向探点」——9 个点都落在形状内是 9 分，贴着边缘是低分。
 * 中心落在形状外的格子也一并返回（score 会很低），由 coverShape 决定去留。
 * 坐标是 [-1,1] 域，与形状判定函数一致。
 */
function latticeCells(test: (x: number, y: number) => boolean, h: number): Cell[] {
  const out: Cell[] = [];
  const steps = Math.ceil(2 / h) + 3;
  const a = h * 0.48; // 轴向探点半径
  const d = h * 0.34; // 对角探点（半径 = 0.48h，落在正方形四角内侧）
  const ox = [0, a, -a, 0, 0, d, d, -d, -d];
  const oy = [0, 0, 0, a, -a, d, -d, d, -d];
  for (let j = 0; j < steps; j++) {
    const y = -1 + (j + 0.5) * h;
    if (y < -1 - h || y > 1 + h) continue;
    const off = j % 2 === 0 ? 0 : 0.5;
    for (let i = 0; i < steps; i++) {
      const x = -1 + (i + 0.5 + off) * h;
      if (x < -1 - h || x > 1 + h) continue;
      let score = 0;
      for (let s = 0; s < 9; s++) if (test(x + ox[s], y + oy[s])) score++;
      // 中心与探点全在形状外 → 这张贴片跟形状无关
      if (score === 0) continue;
      out.push({ x, y, score });
    }
  }
  return out;
}

/** 形状内的参考点（压边界时射线的起点）：取离原点最近的形状内点，环形等怪形状也不会踩空 */
function insideAnchor(test: (x: number, y: number) => boolean): Pt {
  let best: Pt = { x: 0, y: 0 };
  let bd = Infinity;
  const G = 40;
  for (let i = 0; i <= G; i++) {
    for (let j = 0; j <= G; j++) {
      const x = -1 + (2 * i) / G;
      const y = -1 + (2 * j) / G;
      if (test(x + 1e-4, y + 1e-4)) {
        const d = x * x + y * y;
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
    }
  }
  return best;
}

/**
 * 把形状外的格点「压」回轮廓：从形状内的参考点朝格点方向推进，找第一次由内变外的位置，
 * 再二分细化到边界上（留一点余量，落在形状内）。
 * 投影后贴片中心正好贴住轮廓 —— 一半压形状外、一半盖形状内，边界既 crisp 又不越界。
 */
function projectToShape(
  test: (x: number, y: number) => boolean,
  c: Pt,
  anchor: Pt
): Pt | null {
  const dx = c.x - anchor.x;
  const dy = c.y - anchor.y;
  if (dx === 0 && dy === 0) return { x: anchor.x, y: anchor.y };
  const at = (t: number): boolean => test(anchor.x + dx * t + 1e-4, anchor.y + dy * t + 1e-4);
  let lo = 0;
  let hi = -1;
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    if (!at(t)) {
      hi = t;
      break;
    }
    lo = t;
  }
  // 整条射线都在形状内（极凹形状）→ 这个格点本来就该算内部点，直接返回
  if (hi < 0) return { x: c.x, y: c.y };
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid)) lo = mid;
    else hi = mid;
  }
  return { x: anchor.x + dx * lo, y: anchor.y + dy * lo };
}

/** 形状内采样（-1..1 域，够细即可）：用来评估边界格点还能补多少没盖住的面积 */
function sampleInside(test: (x: number, y: number) => boolean, S = 56): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < S; i++) {
    const x = -1 + ((i + 0.5) * 2) / S;
    for (let j = 0; j < S; j++) {
      const y = -1 + ((j + 0.5) * 2) / S;
      if (test(x, y)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * 实心模式下的特征吸附：格点阵是均匀的，未必有格子正好落在心形下尖 / 顶部凹口上
 * （实测心形 20 张时顶部凹口差 0.091、下尖差 0.124，20 张的贴片已经很显眼，
 * 尖角糊掉整个心形就不像了）。
 *
 * 与轮廓模式的 nudgeFeatures 不同，这里**只挪到刚好命中就停**：
 * 位移上限 0.4 个格距 —— 贴片之间的吸附余量只有 2%，挪太多会在原位留下一个
 * 贴片大小的缺口。所以「能救则救，救不了宁可留个小偏差」。
 */
function snapFeatures(pts: Pt[], feats: Feature[], pitch: number): void {
  if (pts.length < 3 || !feats.length || pitch <= 0) return;
  const maxMove = pitch * 0.4;
  // 挪完与邻居的最小间距：贴片本身会互相咬合 2%，留 0.3 个格距就够，
  // 门槛定太高会让「轮廓压出来的挤点」一步都挪不动（尖角反而补不上）。
  const keepGap = Math.max(MIN_GAP, pitch * 0.3);
  let moved = 0;
  for (let f = 0; f < feats.length && moved < 2; f++) {
    if (feats[f].sal < 0.45) continue;
    const t = feats[f].p;
    // 按离特征由近到远逐个试：离得最近的那个往往正卡在凹口的拐角上（挪不动），
    // 它挤着就让位给下一个候选 —— 一个点挪不动不该让整个特征白丢。
    const order = pts
      .map((p, i) => ({ i, d: Math.hypot(p.x - t.x, p.y - t.y) }))
      .sort((a, b) => a.d - b.d);
    for (let k = 0; k < order.length; k++) {
      const bi = order[k].i;
      const bd = order[k].d;
      // 最近的都在 1.2 格距之外 → 这个特征附近根本没贴片，硬挪会拉出空洞
      if (bd > pitch * 1.2) break;
      // 只挪「差一点点就命中」的那些；已经命中的不用动（更远的更不需要）
      const need = Math.min(bd - HIT_R * 0.6, maxMove);
      if (need <= 0) break;
      const prev = pts[bi];
      const nx = prev.x + ((t.x - prev.x) / bd) * need;
      const ny = prev.y + ((t.y - prev.y) / bd) * need;
      let minD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        if (i === bi) continue;
        const d = Math.hypot(pts[i].x - nx, pts[i].y - ny);
        if (d < minD) minD = d;
      }
      if (minD < keepGap) continue;
      pts[bi] = { x: nx, y: ny };
      moved++;
      break;
    }
  }
}

/** 形状解析失败时的兜底：排成一个圆环，至少不会崩成白屏 */
function centerFallback(n: number): LayoutResult {
  const out: Pt[] = [];
  const r = 0.34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r });
  }
  return { pts: out, cell: estimateCell(out, 0.6, 1.15) };
}

/** 估算形状的建议照片数（形状很瘦长时适当加量，保证轮廓可辨） */
export function suggestCount(def: ShapeDef): number {
  return def.suggest || 36;
}
