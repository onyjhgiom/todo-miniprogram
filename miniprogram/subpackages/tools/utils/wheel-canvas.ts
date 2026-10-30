// subpackages/tools/utils/wheel-canvas.ts
// 转盘绘制：扇区 / 文字 / 图标 + 结果海报
//
// 为什么单独抽一层：转盘主页要画在屏幕 canvas 上，结果海报要画在离屏 canvas 上，
// 两处逻辑必须完全一致（否则海报里的转盘和刚转出来的不一致）。
// 所有坐标都以「传入 size 的左上角」为原点，调用方可先 translate/scale 再调用，
// 因此同一函数既能画 300px 的屏幕转盘，也能画 1080px 的海报。
//
// 关键约束（验收标准 6）：12 个选项时文字不溢出、不重叠。
// 做法是字号三重取小：① 按选项数的基准字号；② 扇区在文字半径处的弦宽；③ 径向可用长度 ÷ 字数。
// 还不够时按最小可读字号反推最多能放几个字，超出就截断加省略号。

import type { IWheelOption } from './wheel-store';

type Ctx = WechatMiniprogram.CanvasRenderingContext;

const DEG = Math.PI / 180;

export interface IDrawWheelParams {
  /** 画布边长（正方形） */
  size: number;
  options: IWheelOption[];
  /** 转盘当前旋转角（度，顺时针为正） */
  rotation: number;
  /** 高亮扇区下标（停下后） */
  highlight?: number;
  /** 中心是否留白（主页中心有「开始」按钮，需要留白；海报不需要） */
  centerHole?: boolean;
}

/** 文本截断：最多 max 个字符，超出用省略号 */
function clipText(text: string, max: number): string {
  const t = String(text || '');
  if (t.length <= max) return t;
  return max <= 1 ? t.slice(0, 1) : `${t.slice(0, max - 1)}…`;
}

/** 背景色亮度 → 黑字或白字，保证任意配色下文字都可读 */
export function inkOn(hex: string): string {
  const h = String(hex || '#CCCCCC').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.length === 6 ? full : 'CCCCCC', 16);
  if (isNaN(n)) return '#333333';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // 感知亮度（ITU-R BT.601）
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  return lum > 150 ? '#2A2118' : '#FFFFFF';
}

/** 按选项数的基准字号（相对 size） */
function baseFontRatio(n: number): number {
  if (n <= 2) return 0.085;
  if (n <= 4) return 0.075;
  if (n <= 6) return 0.065;
  if (n <= 8) return 0.055;
  return 0.048;
}

/**
 * 绘制转盘。
 * 角度约定：0° 指向 12 点方向，顺时针增大；扇区 i 覆盖 [i*sa, (i+1)*sa)。
 * 指针固定在 12 点，所以当转盘顺时针转 rotation 度后，
 * 位于指针处的转盘本地角度为 mod(-rotation, 360)。
 */
export function drawWheel(ctx: Ctx, p: IDrawWheelParams): void {
  const { size, options, rotation } = p;
  const n = options.length;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  ctx.clearRect(0, 0, size, size);
  if (!n) return;

  // 底盘（白圆 + 一圈细描边），让边缘更干净
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  const sa = 360 / n;
  const inner = p.centerHole ? r * 0.30 : r * 0.10;

  for (let i = 0; i < n; i++) {
    const start = (-90 + rotation + i * sa) * DEG;
    const end = start + sa * DEG;
    const color = options[i].color || '#CCCCCC';

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r - 2, start, end);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // 扇区分隔线：白色细线，避免相邻同色系糊在一起（参考稿用 2px 实白线）
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 高亮：叠一层半透明白（比换色更柔和，任何底色都适用）
    if (p.highlight === i) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r - 2, start, end);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.fill();
    }
  }

  // 中心留白（主页的「开始」按钮是 DOM 元素，盖在上面；这里只负责挖空）
  if (p.centerHole) {
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 顶部高光：径向白雾，模拟参考稿 .wheel:before 的微妙光泽（盖在扇区之上、文字之下）
  const sheen = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
  sheen.addColorStop(0.58, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = sheen as unknown as string;
  ctx.fill();

  // ===== 文字与图标 =====
  const minFont = Math.max(9, size * 0.032);
  const textR = r * 0.90;
  const radialAvail = textR - (p.centerHole ? r * 0.36 : r * 0.16);
  const baseFont = size * baseFontRatio(n);
  // 文字所在半径处的弦宽：扇区越窄、字必须越小，否则会压到相邻扇区上
  const chord = 2 * (textR * 0.78) * Math.sin((sa * DEG) / 2);

  for (let i = 0; i < n; i++) {
    const mid = (-90 + rotation + i * sa + sa / 2) * DEG;
    const icon = options[i].icon || '';
    let text = String(options[i].text || '');

    // 先按最小字号反推最多能放几个字，再做截断
    const maxChars = Math.max(2, Math.floor(radialAvail / (minFont * (icon ? 1.25 : 1.05))));
    text = clipText(text, maxChars);

    const chars = text.length + (icon ? 1.2 : 0);
    let fs = Math.min(baseFont, chord * 0.66, radialAvail / chars);
    fs = Math.max(minFont, fs);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mid);
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = inkOn(options[i].color);
    ctx.fillText(text, textR, 0);
    if (icon) {
      const w = ctx.measureText(text).width;
      ctx.font = `${fs * 1.05}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(icon, textR - w - fs * 0.35, 0);
    }
    ctx.restore();
  }
}

/* ==================== 结果海报 ==================== */

export interface IPosterParams {
  width: number;
  height: number;
  wheelName: string;
  wheelIcon: string;
  options: IWheelOption[];
  /** 停下时的旋转角，保证海报上的指针位置与真实结果一致 */
  rotation: number;
  highlight: number;
  result: string;
  resultIcon: string;
  /** 底部落款 */
  footer: string;
}

/**
 * 绘制结果海报（离屏画布）。
 * 结构：渐变底 → 转盘名 → 转盘（带指针）→ 结果大字 → 落款。
 * 小程序码需要服务端生成，这里留白并写落款，避免为了一张码多一次必须成功的网络请求。
 */
export function drawPoster(ctx: Ctx, p: IPosterParams): void {
  const W = p.width;
  const H = p.height;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#FFF7EC');
  bg.addColorStop(1, '#FFE9D6');
  ctx.fillStyle = bg as unknown as string;
  ctx.fillRect(0, 0, W, H);

  // 顶部转盘名
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#6B5B4B';
  ctx.font = `${Math.round(W * 0.045)}px sans-serif`;
  ctx.fillText(`${p.wheelIcon} ${p.wheelName}`, W / 2, H * 0.075);

  // 转盘主体（缩放绘制）
  const wheelSize = Math.round(W * 0.78);
  const wx = (W - wheelSize) / 2;
  const wy = H * 0.12;
  ctx.save();
  ctx.translate(wx, wy);
  const s = wheelSize / 600; // 以 600 为基准设计尺寸
  ctx.scale(s, s);
  drawWheel(ctx, {
    size: 600,
    options: p.options,
    rotation: p.rotation,
    highlight: p.highlight,
    centerHole: true
  });
  ctx.restore();

  // 指针（画在转盘上方，与页面上的指针同位置同形状）
  const pcx = wx + wheelSize / 2;
  const pTop = wy + wheelSize * 0.012;
  const pw = wheelSize * 0.075;
  ctx.beginPath();
  ctx.moveTo(pcx - pw / 2, pTop);
  ctx.lineTo(pcx + pw / 2, pTop);
  ctx.lineTo(pcx, pTop + wheelSize * 0.10);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 结果大字
  const resY = wy + wheelSize + H * 0.055;
  ctx.fillStyle = '#8A6A4F';
  ctx.font = `${Math.round(W * 0.038)}px sans-serif`;
  ctx.fillText('转盘结果', W / 2, resY);

  ctx.fillStyle = '#D2542F';
  ctx.font = `bold ${Math.round(W * 0.085)}px sans-serif`;
  const resText = `${p.resultIcon ? `${p.resultIcon} ` : ''}${p.result}`;
  ctx.fillText(clipText(resText, 12), W / 2, resY + H * 0.075);

  // 落款
  ctx.fillStyle = '#A89484';
  ctx.font = `${Math.round(W * 0.03)}px sans-serif`;
  ctx.fillText(p.footer, W / 2, H - H * 0.045);
}
