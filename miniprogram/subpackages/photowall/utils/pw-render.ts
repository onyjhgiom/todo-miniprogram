// subpackages/photowall/utils/pw-render.ts
// 照片墙：Canvas 2D 渲染引擎（预览与导出共用同一套绘制代码）
//
// 关键设计：预览画的图和导出画的图走 **同一个 paintWork()**，只是画布尺寸不同。
// 这样「预览看到的」和「保存下来的」必然一致 —— 拼图类功能最忌讳预览好看、导出错位。
//
// 图片统一走 IMG_POOL 缓存：预览加载过的图，导出时直接复用，不会二次解码。

import type { PWWork, PWPhoto, PWStyle, PWDecor, Pt } from './pw-types';

/* ==================== 图片缓存 ==================== */

const IMG_POOL: Record<string, WechatMiniprogram.Image> = {};
let poolSize = 0;
/** 缓存上限：超过就整体清空，避免 100 张大图常驻内存被系统杀掉 */
const POOL_MAX = 120;

/**
 * 「渐变」填充风格的透明度衰减深度：中心贴片的透明度 = 1 − FADE_DEPTH。
 * 0.45 是试出来的平衡点 —— 再深（>0.6）内部照片薄到看不清内容，
 * 再浅（<0.3）又和实心没区别、看不出「渐变」。
 */
const FADE_DEPTH = 0.45;

/** canvas 实例（用于 createImage，首次设置后复用） */
let hostCanvas: WechatMiniprogram.Canvas | null = null;

export function setHostCanvas(cv: WechatMiniprogram.Canvas): void {
  hostCanvas = cv;
}

function ensureHost(): WechatMiniprogram.Canvas {
  if (!hostCanvas) {
    hostCanvas = wx.createOffscreenCanvas({ type: '2d', width: 8, height: 8 }) as WechatMiniprogram.Canvas;
  }
  return hostCanvas;
}

export function clearImagePool(): void {
  Object.keys(IMG_POOL).forEach((k) => delete IMG_POOL[k]);
  poolSize = 0;
}

/** 加载图片（带缓存；失败返回 null，绘制时用灰块占位而不是整张崩掉） */
export async function getImage(src: string): Promise<WechatMiniprogram.Image | null> {
  if (!src) return null;
  if (IMG_POOL[src]) return IMG_POOL[src];
  const cv = ensureHost();
  return new Promise((resolve) => {
    const img = cv.createImage();
    img.onload = () => {
      if (poolSize > POOL_MAX) clearImagePool();
      IMG_POOL[src] = img;
      poolSize++;
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ==================== 绘制工具 ==================== */

/** 圆角矩形路径（只依赖 moveTo/lineTo/arc，兼容性最好） */
function roundRectPath(
  ctx: WechatMiniprogram.CanvasRenderingContext,
  x: number, y: number, w: number, h: number, r: number
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** 滤镜：优先用系统 filter（黑白/褪色），其余用叠加色，兼容性最稳 */
function applyFilter(
  ctx: WechatMiniprogram.CanvasRenderingContext,
  filter: string,
  x: number, y: number, w: number, h: number
): void {
  if (!filter || filter === 'none') return;
  const prevOp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  if (filter === 'bw') {
    // saturation 混合 + 灰色填充 = 去色；不支持该混合模式的机型会静默降级为不变
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    ctx.fillRect(x, y, w, h);
  } else {
    const t: Record<string, string> = {
      warm: 'rgba(255,148,60,0.16)',
      cool: 'rgba(90,150,255,0.16)',
      retro: 'rgba(186,126,58,0.22)',
      film: 'rgba(46,34,22,0.14)',
      fresh: 'rgba(120,224,186,0.13)',
      dream: 'rgba(232,158,224,0.16)'
    };
    const c = t[filter];
    if (!c) return;
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevAlpha;
}

/** 画一张照片（cover 裁剪 + 圆角 + 边框 + 阴影 + 滤镜 + 翻转/旋转） */
function drawPhoto(
  ctx: WechatMiniprogram.CanvasRenderingContext,
  img: WechatMiniprogram.Image | null,
  cx: number, cy: number, size: number,
  photo: PWPhoto, style: PWStyle, canvasW: number,
  /** 贴片级透明度乘子（「渐变」填充风格用：内侧照片更透，形状透气） */
  alphaMul = 1
): void {
  const half = size / 2;
  const radius = size * style.radius;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(photo.rot || 0);
  ctx.scale(photo.flipH ? -1 : 1, photo.flipV ? -1 : 1);
  ctx.globalAlpha = Math.max(0.1, Math.min(1, (photo.opacity == null ? 1 : photo.opacity) * style.alpha * alphaMul));

  // 阴影：先填一次白底拿到阴影轮廓，再把阴影关掉画照片（否则阴影会透出照片边缘）
  if (style.shadow) {
    ctx.shadowColor = style.shadowColor || 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = style.shadowBlur || 10;
    ctx.shadowOffsetY = Math.max(1, size * 0.03);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    roundRectPath(ctx, -half, -half, size, size, radius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
  }

  roundRectPath(ctx, -half, -half, size, size, radius);
  ctx.clip();

  if (img) {
    const iw = (img.width || size) as number;
    const ih = (img.height || size) as number;
    // cover：短边贴满，长边居中裁掉
    const s = Math.max(size / iw, size / ih);
    const dw = iw * s;
    const dh = ih * s;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    applyFilter(ctx, style.filter, -half, -half, size, size);
  } else {
    ctx.fillStyle = '#D8D4CC';
    ctx.fillRect(-half, -half, size, size);
  }
  ctx.restore();

  // 边框画在裁剪之外（放在 clip 里会被裁掉一半线宽，看起来像没生效）
  if (style.borderW > 0) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(photo.rot || 0);
    ctx.scale(photo.flipH ? -1 : 1, photo.flipV ? -1 : 1);
    ctx.lineWidth = Math.max(0.5, style.borderW * canvasW);
    ctx.strokeStyle = style.borderColor || '#FFFFFF';
    roundRectPath(ctx, -half, -half, size, size, radius);
    ctx.stroke();
    ctx.restore();
  }
}

/** 画装饰元素（贴纸 / 文字） */
function drawDecor(
  ctx: WechatMiniprogram.CanvasRenderingContext,
  d: PWDecor, W: number, H: number
): void {
  ctx.save();
  ctx.translate(d.x * W, d.y * H);
  ctx.rotate(((d.rot || 0) * Math.PI) / 180);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = d.color || '#333333';
  const px = Math.max(10, d.size * W);
  ctx.font = `${px}px sans-serif`;
  ctx.fillText(d.value, 0, 0);
  ctx.restore();
}

/* ==================== 主绘制 ==================== */

export interface PaintOptions {
  /** 覆盖点位（不传则用 work.slots） */
  slots?: Pt[];
  /** 覆盖建议照片边长（不传则按 slots 数量反推一个保守值） */
  cell?: number;
  /** 只画到第 n 张（分帧渲染用） */
  limit?: number;
  /**
   * 铺满模式：允许贴片数多于照片数、照片被循环复用。
   * **默认 false —— 一张照片只画一次，画面上不会出现重复的照片内容。**
   */
  repeat?: boolean;
}

/** 绘制结果：命中测试 / 手势编辑需要知道每张贴片画在了哪里 */
export interface PaintLayout {
  /** 画布像素宽高 */
  W: number;
  H: number;
  /** 内容区边长（正方形，形状按它映射） */
  S: number;
  /** 内边距（像素） */
  pad: number;
  /** 单张贴片的基准边长（像素，未乘 photo.scale） */
  size: number;
  /** 每张贴片的中心坐标（像素），与 work.slots 同序 */
  tileCenters: Pt[];
  /** 每张贴片用的**照片下标**（与 tileCenters 同序）。默认模式下是 0..n-1 的一个排列 */
  tilePhoto: number[];
  /** 每张照片贴片的中心（与 work.photos 同序），供列表/调试参考 */
  centers: Pt[];
  /** 每个装饰元素的中心坐标（像素，与 style.decor 同序） */
  decorCenters: Pt[];
}

/**
 * 把作品画到指定画布。尺寸由调用方通过 cv.width / cv.height 决定。
 * 预览（屏幕尺寸）与导出（1080/1440/2160）共用此函数。
 */
export async function paintWork(
  cv: WechatMiniprogram.Canvas,
  work: PWWork,
  opt: PaintOptions = {}
): Promise<PaintLayout> {
  const W = cv.width;
  const H = cv.height;
  const ctx = cv.getContext('2d');
  const style = work.style;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = style.bg || '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // 背景图（cover 铺满）
  if (style.bgImage) {
    const bg = await getImage(style.bgImage);
    if (bg) {
      const iw = (bg.width || W) as number;
      const ih = (bg.height || H) as number;
      const s = Math.max(W / iw, H / ih);
      ctx.drawImage(bg, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    }
  }

  const layout: PaintLayout = {
    W, H, S: 0, pad: 0, size: 0,
    tileCenters: [], tilePhoto: [], centers: [],
    decorCenters: (style.decor || []).map((d) => ({ x: d.x * W, y: d.y * H }))
  };

  const photos = work.photos || [];
  if (!photos.length) {
    // 没有照片也要把装饰画出来（用户可能先放了贴纸/文字再加图）
    const decorOnly = style.decor || [];
    for (let i = 0; i < decorOnly.length; i++) drawDecor(ctx, decorOnly[i], W, H);
    return layout;
  }

  // 内容区：以画布短边为基准留白，形状始终按正方形映射，不会被比例拉变形
  const pad = Math.min(W, H) * (style.padding || 0);
  const S = Math.min(W - pad * 2, H - pad * 2);
  const n = photos.length;
  // 贴片序列：默认（一张照片一格）长度与照片数一致，slots[i] ↔ photos[i] 一一对应。
  // 铺满模式下 slots 会多于照片数，照片按下标循环复用。
  let tiles = (opt.slots && opt.slots.length ? opt.slots : work.slots) || [];
  if (!tiles.length) tiles = [{ x: 0.5, y: 0.5 }];
  // 贴片数：
  //  · 默认模式严格等于照片数 —— 每张照片只画一次，绝不会出现重复内容；
  //  · 铺满模式取 slots 与照片数的较大者，且不得少于照片数：刚加完照片、点位还没重算完
  //    就重绘时，兜底也要保证每张照片都画出来（否则会「少了几张」，看着像丢失）。
  const nTile = opt.repeat ? Math.max(tiles.length, n) : n;
  /** 取第 i 张贴片的点位；超出已算点位时排一个圆环兜底 */
  const slotAt = (i: number): Pt => {
    if (i < tiles.length) return tiles[i];
    const a = (i / nTile) * Math.PI * 2;
    return { x: 0.5 + Math.cos(a) * 0.32, y: 0.5 + Math.sin(a) * 0.32 };
  };
  // 优先用排点算出的尺寸（随作品保存），其次用调用方传入的，最后才是估算兜底
  const cell = opt.cell || work.cell || (n > 1 ? Math.max(0.05, Math.min(0.5, 1.35 / Math.sqrt(n))) : 0.6);
  const baseSize = cell * S * (1 - (style.gap || 0)) * (work.arrange.photoSize || 1) * (work.arrange.scale || 1);
  // 摆放跨度：形状的最外圈点位就在 [0,1] 边界上，贴片会向外伸出半个身位，
  // 不缩进的话「心形最左/最右/上下的那几张」会被画布边缘裁掉一半（照片少时尤其明显）。
  // 缩进量 = 一个贴片宽，即贴片外缘正好贴着内容区边缘；贴片很小时跨度过剩，
  // 此时以内容区为准（内边距仍然是用户设定的效果）。
  const span = Math.max(1, Math.min(S, Math.min(W, H) - baseSize));
  layout.S = span;
  layout.pad = pad;
  layout.size = baseSize;

  // 整体旋转：绕画布中心
  const rot = ((work.arrange.rotate || 0) * Math.PI) / 180;
  const cx0 = W / 2;
  const cy0 = H / 2;

  ctx.save();
  if (rot) {
    ctx.translate(cx0, cy0);
    ctx.rotate(rot);
    ctx.translate(-cx0, -cy0);
  }

  // 图片按「照片」去重加载一次（贴片只是复用，不重复解码）
  const imgs: (WechatMiniprogram.Image | null)[] = new Array(n);
  await Promise.all(
    photos.map(async (p, k) => {
      imgs[k] = await getImage(p.src);
    })
  );

  // 贴片 i 用照片[i % n]；绘制顺序按所属照片的 z 升序，
  // 「置顶/置底」对这张照片的所有贴片一起生效
  const order: number[] = new Array(nTile);
  for (let i = 0; i < nTile; i++) order[i] = i;
  order.sort((a, b) => (photos[a % n].z || 0) - (photos[b % n].z || 0));
  const limit = opt.limit == null ? nTile : Math.min(opt.limit, nTile);

  layout.tileCenters = new Array(nTile);
  layout.tilePhoto = new Array(nTile);
  layout.centers = new Array(n);
  // 「渐变」填充风格：照片透明度按「到内容区中心的距离」递增 ——
  // 外圈不透明（轮廓清晰、形状认得出来），越靠内越透（0.5 倍），整体透气不糊。
  // 用归一化半径（除以最远贴片距离）而不是绝对坐标，这样任何形状/张数下衰减幅度一致。
  const fade = work.fill === 'fade';
  let rmax = 0;
  if (fade) {
    for (let i = 0; i < nTile; i++) {
      const sp = slotAt(i);
      const r = Math.hypot(sp.x - 0.5, sp.y - 0.5);
      if (r > rmax) rmax = r;
    }
  }
  for (let k = 0; k < limit; k++) {
    const ti = order[k];
    const pi = ti % n;
    const p = photos[pi];
    const slot = slotAt(ti);
    const x = cx0 + (slot.x - 0.5) * span + (p.dx || 0) * span;
    const y = cy0 + (slot.y - 0.5) * span + (p.dy || 0) * span;
    // 整体旋转已经作用在 ctx 上，命中测试要用「旋转后」的坐标，故这里同步变换一次
    layout.tileCenters[ti] = rot ? rotatePoint(x, y, cx0, cy0, rot) : { x, y };
    layout.tilePhoto[ti] = pi;
    if (!layout.centers[pi]) layout.centers[pi] = layout.tileCenters[ti];
    const mul = fade && rmax > 0 ? 1 - FADE_DEPTH * Math.min(1, Math.hypot(slot.x - 0.5, slot.y - 0.5) / rmax) : 1;
    drawPhoto(ctx, imgs[pi], x, y, baseSize * (p.scale || 1), p, style, W, mul);
  }
  ctx.restore();

  // 装饰画在最上层，且不参与整体旋转（用户摆放的位置所见即所得）
  const decor = style.decor || [];
  for (let i = 0; i < decor.length; i++) drawDecor(ctx, decor[i], W, H);
  return layout;
}

/** 绕定点旋转（与绘制时的 ctx 变换保持一致，供命中测试使用） */
function rotatePoint(x: number, y: number, cx: number, cy: number, a: number): Pt {
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/* ==================== 尺寸与导出 ==================== */

/** 按画布比例算出目标像素尺寸（短边 = shortPx） */
export function canvasSizeByRatio(style: PWStyle, shortPx: number): { w: number; h: number } {
  let rw = 1;
  let rh = 1;
  if (style.ratio === 'custom') {
    rw = style.customW || 1;
    rh = style.customH || 1;
  } else {
    const parts = String(style.ratio || '1:1').split(':');
    rw = Number(parts[0]) || 1;
    rh = Number(parts[1]) || 1;
  }
  return rw >= rh
    ? { w: Math.round(shortPx * (rw / rh)), h: shortPx }
    : { w: shortPx, h: Math.round(shortPx * (rh / rw)) };
}

/** 离屏创建一块 2D 画布 */
function offscreen(w: number, h: number): WechatMiniprogram.Canvas {
  return wx.createOffscreenCanvas({ type: '2d', width: w, height: h }) as WechatMiniprogram.Canvas;
}

export interface ExportOptions {
  /** 导出短边像素（1080 / 1440 / 2160 …） */
  shortPx: number;
  fileType?: 'jpg' | 'png';
  /** 0 ~ 1，jpg 生效 */
  quality?: number;
}

/** 导出作品为图片文件，返回本地临时路径 */
export async function exportWork(work: PWWork, opt: ExportOptions): Promise<string> {
  const { w, h } = canvasSizeByRatio(work.style, opt.shortPx);
  const cv = offscreen(w, h);
  await paintWork(cv, work);
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: cv,
      x: 0,
      y: 0,
      width: w,
      height: h,
      destWidth: w,
      destHeight: h,
      fileType: opt.fileType || 'jpg',
      quality: opt.quality == null ? 0.92 : opt.quality,
      success: (res: { tempFilePath: string }) => resolve(res.tempFilePath),
      fail: (err: { errMsg: string }) => reject(err)
    });
  });
}

/** 生成封面缩略图（列表卡片用，短边 320 足够） */
export async function makeCover(work: PWWork): Promise<string> {
  return exportWork(work, { shortPx: 320, fileType: 'jpg', quality: 0.8 });
}
