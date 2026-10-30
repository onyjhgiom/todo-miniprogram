// pages/astro/horoscope.ts
// 星座运势详情：四周期切换 + 原生 Canvas 雷达图/折线图 + 文字解读 + 幸运信息 + 浏览历史
// 图像绘制：基于 wx.createSelectorQuery 拿 canvas 节点 + Canvas 2d API 原生手绘
import {
  ZODIACS, zodiacByKey, getHoroscope, formatDate
} from '../../utils/astro-data';
import { NS, listAll, addRecord, readJson, writeJson } from '../../utils/astro-store';

type Period = 'today' | 'week' | 'month' | 'year';

interface HoroscopeFull {
  scores: { overall: number; love: number; career: number; wealth: number; health: number };
  texts: { overall: string; love: string; career: string; wealth: string; health: string };
  lucky: { number: number; color: string; colorName: string; match: string; avoid: string; starTip: string };
  weekSeries?: number[];
  monthSeries?: number[];
  yearSeries?: number[];
}

interface PageData {
  zodiacs: typeof ZODIACS;
  signKey: string;
  sign: ReturnType<typeof zodiacByKey> | { key: string; name: string; en: string; icon: string; range: string; element: string; ruler: string };
  period: Period;
  periodLabel: string;
  horoscope: HoroscopeFull;
  interprets: { key: string; label: string; score: number; text: string; tint: string; tint2: string }[];
  periods: { key: Period; label: string }[];
  switchOpen: boolean;
  history: { id: string; name: string; icon: string; periodLabel: string; timeLabel: string }[];
  placeholder: string;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' }
];

const TINT: Record<string, [string, string]> = {
  overall: ['#B5714C', '#D8A05C'],
  love: ['#f472b6', '#fb7185'],
  career: ['#60a5fa', '#3b82f6'],
  wealth: ['#fbbf24', '#f59e0b'],
  health: ['#34d399', '#10b981']
};

function blankHoroscope(): HoroscopeFull {
  return {
    scores: { overall: 0, career: 0, health: 0, love: 0, wealth: 0 },
    texts: { overall: '', career: '', health: '', love: '', wealth: '' },
    lucky: { number: 0, color: '#888', colorName: '', match: '', avoid: '', starTip: '' }
  };
}

Page<PageData>({
  data: {
    zodiacs: ZODIACS,
    signKey: 'aries',
    sign: { key: 'aries', name: '白羊座', en: 'Aries', icon: '', range: '', element: 'fire', ruler: '火星' },
    period: 'today',
    periodLabel: '今日',
    horoscope: blankHoroscope(),
    interprets: [],
    periods: PERIODS,
    switchOpen: false,
    history: [],
    placeholder: '/subpackages/tools/assets/astro/placeholder.jpg'
  },

  onLoad(q: Record<string, string | undefined>) {
    const fromQ = (q.sign as string) || '';
    const cfg = readJson<{ signKey: string }>(NS.zodiac, { signKey: 'aries' });
    const key = fromQ || cfg.signKey;
    this.setData({ signKey: key });
  },

  onShow() {
    this.applySign();
    this.applyHoroscope();
    this.applyHistory();
  },

  onReady() {
    this.drawCanvas();
  },

  applySign() {
    const z = zodiacByKey(this.data.signKey);
    if (!z) return;
    this.setData({ sign: z });
  },

  applyHoroscope() {
    const ds = formatDate(new Date());
    const h = getHoroscope(this.data.signKey, ds, this.data.period);
    const inter = [
      { key: 'overall', label: '综合', score: h.scores.overall, text: h.texts.overall, tint: TINT.overall[0], tint2: TINT.overall[1] },
      { key: 'love', label: '爱情', score: h.scores.love, text: h.texts.love, tint: TINT.love[0], tint2: TINT.love[1] },
      { key: 'career', label: '事业学业', score: h.scores.career, text: h.texts.career, tint: TINT.career[0], tint2: TINT.career[1] },
      { key: 'wealth', label: '财富', score: h.scores.wealth, text: h.texts.wealth, tint: TINT.wealth[0], tint2: TINT.wealth[1] },
      { key: 'health', label: '健康', score: h.scores.health, text: h.texts.health, tint: TINT.health[0], tint2: TINT.health[1] }
    ];
    this.setData({
      horoscope: h,
      periodLabel: (PERIODS.find((p) => p.key === this.data.period) || PERIODS[0]).label,
      interprets: inter
    }, () => this.drawCanvas());

    // 写浏览历史
    addRecord(NS.horoHis, {
      id: '',
      signKey: this.data.signKey,
      period: this.data.period,
      periodLabel: this.data.periodLabel
    } as unknown as { id: string; signKey: string; period: string; periodLabel: string; createdAt: number });
  },

  applyHistory() {
    const list = listAll<{ id: string; signKey: string; period: string; periodLabel: string; createdAt: number }>(NS.horoHis)
      .slice(0, 8)
      .map((r) => {
        const z = zodiacByKey(r.signKey);
        return {
          id: r.id,
          name: z ? z.name : r.signKey,
          icon: z ? z.icon : this.data.placeholder,
          periodLabel: r.periodLabel,
          timeLabel: relTime(r.createdAt)
        };
      });
    this.setData({ history: list });
  },

  onSwitchPeriod(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as Period;
    if (key === this.data.period) return;
    this.setData({ period: key }, () => this.applyHoroscope());
  },

  onOpenSwitch() { this.setData({ switchOpen: true }); },
  onCloseSwitch() { this.setData({ switchOpen: false }); },
  noop() {},

  onSelectSign(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!key) return;
    writeJson(NS.zodiac, { signKey: key });
    this.setData({ signKey: key, switchOpen: false }, () => {
      this.applySign();
      this.applyHoroscope();
    });
  },

  /** 点击雷达图：唤起弹窗（此处仅 toast 演示） */
  onCanvasTap(e: WechatMiniprogram.TouchEvent) {
    wx.showToast({ title: '该点分值已展示', icon: 'none' });
  },

  /** 原生 Canvas 2d 绘制：雷达图 + 折线图 */
  drawCanvas() {
    const that = this;
    const query = wx.createSelectorQuery();
    query.select('#radar').fields({ node: true, size: true });
    if (this.data.period !== 'today') query.select('#line').fields({ node: true, size: true });
    query.exec(function (res) {
      // 雷达
      const rItem = res && res[0];
      if (rItem && rItem.node) {
        const canvas = rItem.node;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = rItem.width * dpr;
        canvas.height = rItem.height * dpr;
        ctx.scale(dpr, dpr);
        drawRadar(ctx, rItem.width, rItem.height, that.data.interprets);
      }
      // 折线（仅非今日）
      const lItem = res && res[1];
      if (lItem && lItem.node) {
        const canvas = lItem.node;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = lItem.width * dpr;
        canvas.height = lItem.height * dpr;
        ctx.scale(dpr, dpr);
        drawLine(ctx, lItem.width, lItem.height, that.data.horoscope, that.data.period);
      }
    });
  },

  /** image 加载失败兜底 */
  onImgErr(e: WechatMiniprogram.CustomEvent) {
    const t = e.currentTarget as WechatMiniprogram.Image;
    if (t.src !== this.data.placeholder) t.setData({ src: this.data.placeholder });
  }
});

/* === Canvas 绘图函数（手写原生 2d） === */
function drawRadar(ctx: WechatMiniprogram.CanvasContext, w: number, h: number, items: { key: string; label: string; score: number; tint: string; tint2: string }[]) {
  const cx = w / 2;
  const cy = h / 2 + 6;
  const R = Math.min(w, h) * 0.36;
  const sides = items.length;
  // 网格（5 圈 + 辐射线）
  ctx.lineWidth = 1;
  for (let layer = 1; layer <= 5; layer++) {
    const rr = (R * layer) / 5;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(190,200,230,0.16)';
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(190,200,230,0.16)';
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();
  }
  // 数据多边形（柔和填充）
  const pts = items.map((it, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
    const rr = (R * Math.min(10, Math.max(0, it.score))) / 10;
    return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
  });
  // 填充层
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
  grad.addColorStop(0, 'rgba(99,102,241,0.42)');
  grad.addColorStop(1, 'rgba(168,85,247,0.42)');
  ctx.fillStyle = grad;
  ctx.fill();
  // 描边
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.closePath();
  ctx.strokeStyle = 'rgba(190,200,255,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 顶点 + 标签
  items.forEach((it, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
    const p = pts[i];
    const lx = cx + Math.cos(a) * (R + 22);
    const ly = cy + Math.sin(a) * (R + 22);
    // 顶点圆
    ctx.beginPath();
    ctx.fillStyle = it.tint;
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    // 标签
    ctx.fillStyle = 'rgba(230,235,255,0.92)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.label, lx, ly);
    // 分值
    ctx.fillStyle = it.tint;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(it.score + '', lx, ly + 16);
  });
}

function drawLine(ctx: WechatMiniprogram.CanvasContext, w: number, h: number, hsc: HoroscopeFull, period: Period) {
  const series = period === 'week' ? hsc.weekSeries : period === 'month' ? hsc.monthSeries : hsc.yearSeries;
  if (!series || series.length === 0) return;
  const padL = 28, padR = 18, padT = 18, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  // 坐标轴
  ctx.strokeStyle = 'rgba(190,200,230,0.18)';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 5; g++) {
    const y = padT + (innerH * g) / 5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + innerW, y);
    ctx.stroke();
  }
  // 折线
  const stepX = innerW / Math.max(1, series.length - 1);
  ctx.beginPath();
  series.forEach((s, i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - ((s - 3) / 7) * innerH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(190,200,255,0.85)';
  ctx.stroke();
  // 填充面积
  const lastX = padL + (series.length - 1) * stepX;
  const firstX = padL;
  ctx.lineTo(lastX, padT + innerH);
  ctx.lineTo(firstX, padT + innerH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + innerH);
  grad.addColorStop(0, 'rgba(181,113,76,0.32)');
  grad.addColorStop(1, 'rgba(181,113,76,0.02)');
  ctx.fillStyle = grad;
  ctx.fill();
  // 节点
  series.forEach((s, i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - ((s - 3) / 7) * innerH;
    ctx.beginPath();
    ctx.fillStyle = '#B5714C';
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  // x 轴标签（首中末）
  ctx.fillStyle = 'rgba(90,74,56,0.7)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const labelCount = Math.min(series.length, 7);
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((series.length - 1) * (i / (labelCount - 1)));
    const x = padL + idx * stepX;
    ctx.fillText(String(idx + 1), x, h - 8);
  }
}

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return Math.floor(d / 60_000) + ' 分钟前';
  if (d < 86400_000) return Math.floor(d / 3600_000) + ' 小时前';
  if (d < 30 * 86400_000) return Math.floor(d / 86400_000) + ' 天前';
  return formatDate(new Date(ts));
}