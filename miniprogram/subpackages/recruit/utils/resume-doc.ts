// utils/resume-doc.ts
// 简历文档模型 + Canvas 分页排版渲染。
//
// 为什么走「canvas 渲染 → 图片 → 云函数封装成 PDF」这条链路：
//   小程序没有原生的 PDF 生成能力，而云函数里用 PDF 库直接写中文需要嵌入中文字体（数 MB 且要处理授权）。
//   canvas 用系统字体渲染中文，天然不乱码；再把整页图片以 DCTDecode 嵌进 PDF，
//   云函数零第三方依赖，产出的也是标准 PDF，可被 wx.openDocument 打开、可转发、可打印。
//   代价是文字不可选（本质是版式图），对「投递用的一页纸简历」这个场景是可接受的取舍。

/** 简历条目：一次实习 / 一段项目 / 一条教育经历 */
export interface ResumeItem {
  /** 主标题：公司名 / 学校名 / 项目名 */
  primary: string;
  /** 副标题：岗位 / 专业 / 角色 */
  secondary?: string;
  /** 右侧元信息：时间 / 地点 */
  meta?: string;
  /** 要点（STAR 描述） */
  bullets?: string[];
}

export interface ResumeSection {
  key: string;
  title: string;
  /** 纯文本段落（技能、自我评价这类没有条目的小节用） */
  text?: string;
  items?: ResumeItem[];
  /** 模块图片：证书 / 作品 / 截图等，渲染为统一方形网格插入本模块下方 */
  images?: ResumeImage[];
}

/** 单张简历图片：本地稳定路径（已落地 USER_DATA_PATH，非临时路径）+ 可选图注 */
export interface ResumeImage {
  id: string;
  path: string;
  caption?: string;
}

/** canvas 预加载后的可绘制图片（createImage 结果 + 原始尺寸） */
export interface LoadedImage {
  img: any;
  width: number;
  height: number;
}

export interface ResumeProfile {
  name: string;
  /** 求职意向，如「前后端工程师」 */
  headline: string;
  /** 期望薪资，如「4K-12K」 */
  expectedSalary?: string;
  /** 期望城市，如「上海」 */
  expectedCity?: string;
  /** 联系方式数组，如 ['138-0000-0000', 'a@b.com', '上海'] */
  contacts: string[];
  sections: ResumeSection[];
  /** 证件照（可选）：页面右上角方形照片 */
  photo?: string;
}

/* ==================== 页面尺寸与排版常量 ==================== */

/** 设计稿宽度（px），A4 比例 210:297 */
export const PAGE_W = 750;
export const PAGE_H = 1060;
export const PAD_X = 56;
export const PAD_Y = 58;
export const CONTENT_W = PAGE_W - PAD_X * 2;
/** 证件照方形边长（设计稿 px） */
export const PHOTO = 132;
/** 页眉与正文之间的距离（设计稿 px，含页眉细分隔线的留白） */
export const HEADER_BOTTOM = 38;
/** 页眉顶部主题色细条高度：只留一道细线做识别，不铺满色块（克制、打印友好） */
export const TOP_BAR = 6;
/** 时间线缩进：条目内容相对左边界的偏移，给「圆点 + 连接线」留出轨道 */
export const TIMELINE_INDENT = 22;
/** 要点相对条目内容的二次缩进（挂在时间线轨道内侧） */
export const BULLET_INDENT = 40;

/* ---------- 中性色板：正文配色固定，主题色只出现在「细条 / 标题 / 分隔线」上 ---------- */
/** 主文字：近黑而非纯黑，打印更柔和 */
const INK = '#111827';
/** 正文 / 要点 */
const INK_SOFT = '#374151';
/** 次要信息（时间、地点、联系方式） */
const MUTED = '#6b7280';
/** 中性细线（页眉分隔、极简版小节线） */
const HAIR = '#e5e7eb';
/** 图片边框 */
const BORDER = '#e2e8f0';

const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

/* ---------- 颜色工具：从主题色派生「页面淡彩」。
 * 背景层次一律用低饱和淡色（soft 与白按比例混），主题原色只留在细条 / 徽标 / 节点上 ——
 * 这是「层次丰富但不花哨」的关键：淡彩负责氛围，原色负责指点。 ---------- */
function hexToRgb(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** 把 a 以 t 的比例混到 b 上（t=1 纯 a、t=0 纯 b） */
export function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return b;
  return `#${hex2(pa[0] * t + pb[0] * (1 - t))}${hex2(pa[1] * t + pb[1] * (1 - t))}${hex2(pa[2] * t + pb[2] * (1 - t))}`;
}

/* ==================== 行模型 ==================== */

type LineKind = 'h1' | 'h2' | 'h3' | 'sec' | 'row' | 'bullet' | 'text' | 'gap' | 'img';

interface DocLine {
  kind: LineKind;
  a?: string;
  b?: string;
  c?: string;
  size?: number;
  /** bullet 自定义符号（classic 版式用 ■，默认 ·） */
  marker?: string;
  /** gap 行自定义高度（条目之间的呼吸留白，随版式变化） */
  lhOverride?: number;
  /** img 行：图片 id 列表（与 loaded map 对应） */
  imgIds?: string[];
  /** img 行：图片元数据（含图注），用于预留高度与绘制 */
  imgs?: ResumeImage[];
  /** 小节序号（1 起，用于编号徽标；只有渲染出来的小节才计数） */
  no?: number;
  /** 所属小节 key：时间线连接线只连同一小节内的相邻条目 */
  secKey?: string;
  /** 是否为时间线条目起点（画圆点 + 连接线） */
  tl?: boolean;
  /** 联系方式图标类型（h3 行）：电话 / 邮箱 / 链接 / 位置 / 通用点 */
  icon?: ContactIcon;
  /** 标题行前缀小方块（h2 求职意向用） */
  mark?: boolean;
}

interface Style {
  size: number;
  bold: boolean;
  color: string;
  lh: number;
}

const STYLES: Record<LineKind, Style> = {
  h1: { size: 42, bold: true, color: INK, lh: 56 },
  h2: { size: 24, bold: false, color: '#1e293b', lh: 36 },
  h3: { size: 21, bold: false, color: MUTED, lh: 32 },
  sec: { size: 25, bold: true, color: INK, lh: 42 },
  row: { size: 25, bold: true, color: INK, lh: 38 },
  bullet: { size: 23, bold: false, color: INK_SOFT, lh: 37 },
  text: { size: 23, bold: false, color: INK_SOFT, lh: 36 },
  gap: { size: 0, bold: false, color: '#000', lh: 18 },
  img: { size: 0, bold: false, color: '#000', lh: 0 }
};

/* ==================== 版式（参考用户提供的两份真实简历 PDF） ==================== */

export type ResumeLayout = 'sectioned' | 'classic' | 'minimal' | 'compact';

export interface ResumeLayoutDef {
  key: ResumeLayout;
  name: string;
  desc: string;
  color: string;
  /** 一句话版式定位（模板卡上展示，帮用户快速分辨风格） */
  style: string;
}

/**
 * 版式注册表：只描述「怎么画」，与内容（sections / 字段）完全解耦 ——
 * 切换版式不会动用户填的任何一段经历，切换岗位模板也不会改版式与配色。
 */
export const RESUME_LAYOUTS: ResumeLayoutDef[] = [
  {
    key: 'sectioned',
    name: '雅致分节版',
    desc: '默认推荐：渐变淡彩底 + 页眉通栏淡彩带、编号小节徽标、时间线圆点、技能面板，层次最丰富',
    color: '#0f766e',
    style: '编号徽标 · 时间线'
  },
  {
    key: 'classic',
    name: '经典一页纸',
    desc: '方点小节标题 + 通栏细线、方形要点、行距紧凑，保留传统一页纸气质，信息密度高',
    color: '#7c3aed',
    style: '细线标题 · 一页纸'
  },
  {
    key: 'minimal',
    name: '极简留白版',
    desc: '只留页面渐变与顶部细条，标题与要点零装饰，最克制、打印与 ATS 解析最友好',
    color: '#334155',
    style: '无装饰 · 留白克制'
  },
  {
    key: 'compact',
    name: '紧凑多页版',
    desc: '编号徽标与面板保留、底板与留白收紧，单页容量最大，内容多时页数最少',
    color: '#b45309',
    style: '高密度 · 省页数'
  }
];

/**
 * 版式细节调校：只描述「装饰怎么画」，不改任何内容。
 * 四套版式共用同一套优雅视觉语言（淡彩底 / 细线 / 时间线 / 单一主题色），差异仅在密度与装饰强弱 ——
 * 所以无论切到哪套，整体风格都是统一的，不会一张一个设计部门。
 */
interface LayoutTuning {
  /** 同一模块内相邻条目的留白 */
  itemGap: number;
  /** 小节标题徽标：编号方块 / 圆点 / 无 */
  secBadge: 'num' | 'dot' | 'none';
  /** 小节标题行是否铺淡彩底板 */
  secBand: boolean;
  /** 小节标题文字色：主题色 / 中性深色 */
  secTitle: 'accent' | 'ink';
  /** 小节标题右侧延伸细线：主题浅色 / 中性浅灰 */
  rule: 'soft' | 'hair';
  /** 要点符号：圆点 / 方点 */
  bullet: 'dot' | 'square';
  /** 时间线节点：圆点 / 方点 */
  tlDot: 'dot' | 'square';
  /** 小节纯文本段落（技能 / 自评）是否铺淡彩面板 */
  textPanel: boolean;
  /** 页眉是否铺通栏淡彩带（第 1 页） */
  headerBand: boolean;
}

const TUNING: Record<ResumeLayout, LayoutTuning> = {
  // 雅致分节版：装饰最全 —— 编号徽标 + 淡彩底板 + 时间线圆点 + 文本面板，层次最丰富
  sectioned: { itemGap: 12, secBadge: 'num', secBand: true, secTitle: 'accent', rule: 'soft', bullet: 'dot', tlDot: 'dot', textPanel: true, headerBand: true },
  // 经典一页纸：保留传统气质（方点），但同样有时间线与页眉淡彩带，密度更高
  classic: { itemGap: 9, secBadge: 'dot', secBand: false, secTitle: 'accent', rule: 'soft', bullet: 'square', tlDot: 'square', textPanel: false, headerBand: true },
  // 极简留白版：只保留渐变底与顶部细条，其余装饰全部退场，打印与 ATS 最友好
  minimal: { itemGap: 12, secBadge: 'none', secBand: false, secTitle: 'ink', rule: 'hair', bullet: 'dot', tlDot: 'dot', textPanel: false, headerBand: false },
  // 紧凑多页版：徽标与面板保留（结构不丢），但去掉底板、收紧留白，把密度做到最大
  compact: { itemGap: 7, secBadge: 'num', secBand: false, secTitle: 'accent', rule: 'soft', bullet: 'dot', tlDot: 'dot', textPanel: true, headerBand: true }
};

/** 取某套版式的细节调校（导出只为自测可断言，页面层不需要关心） */
export function tuningOf(layout?: ResumeLayout): LayoutTuning {
  return TUNING[(layout || 'sectioned') as ResumeLayout] || TUNING.sectioned;
}

/** classic 版式：更紧凑的行距（参考一页纸简历的信息密度） */
const STYLES_CLASSIC: Record<LineKind, Style> = {
  ...STYLES,
  h1: { size: 38, bold: true, color: INK, lh: 50 },
  h2: { size: 23, bold: false, color: '#1e293b', lh: 33 },
  h3: { size: 20, bold: false, color: MUTED, lh: 30 },
  sec: { size: 24, bold: true, color: INK, lh: 38 },
  row: { size: 24, bold: true, color: INK, lh: 34 },
  bullet: { size: 22, bold: false, color: INK_SOFT, lh: 33 },
  text: { size: 22, bold: false, color: INK_SOFT, lh: 33 },
  gap: { size: 0, bold: false, color: '#000', lh: 14 }
};

/** minimal 极简版：留白更多、标题更轻，整体克制 */
const STYLES_MINIMAL: Record<LineKind, Style> = {
  ...STYLES,
  h1: { size: 42, bold: true, color: INK, lh: 56 },
  h2: { size: 23, bold: false, color: INK_SOFT, lh: 34 },
  h3: { size: 21, bold: false, color: MUTED, lh: 32 },
  sec: { size: 24, bold: true, color: INK, lh: 40 },
  row: { size: 24, bold: true, color: INK, lh: 36 },
  bullet: { size: 22, bold: false, color: INK_SOFT, lh: 36 },
  text: { size: 22, bold: false, color: INK_SOFT, lh: 36 },
  gap: { size: 0, bold: false, color: '#000', lh: 20 }
};

/** compact 紧凑多页版：字号与行距最紧，单页装得下更多内容 */
const STYLES_COMPACT: Record<LineKind, Style> = {
  ...STYLES,
  h1: { size: 36, bold: true, color: INK, lh: 48 },
  h2: { size: 22, bold: false, color: INK_SOFT, lh: 30 },
  h3: { size: 20, bold: false, color: MUTED, lh: 28 },
  sec: { size: 23, bold: true, color: INK, lh: 34 },
  row: { size: 23, bold: true, color: INK, lh: 32 },
  bullet: { size: 21, bold: false, color: INK_SOFT, lh: 31 },
  text: { size: 21, bold: false, color: INK_SOFT, lh: 31 },
  gap: { size: 0, bold: false, color: '#000', lh: 11 }
};

function stylesOf(layout?: ResumeLayout): Record<LineKind, Style> {
  if (layout === 'classic') return STYLES_CLASSIC;
  if (layout === 'minimal') return STYLES_MINIMAL;
  if (layout === 'compact') return STYLES_COMPACT;
  return STYLES;
}

/* ==================== 文本工具 ==================== */

/** 中英文混排分词：ASCII 连续串算一个词，CJK 逐字，便于正确换行 */
function tokenize(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of String(s || '')) {
    if (/[A-Za-z0-9@._+\-–—#()/·%]/.test(ch)) {
      buf += ch;
    } else {
      if (buf) { out.push(buf); buf = ''; }
      out.push(ch);
    }
  }
  if (buf) out.push(buf);
  return out;
}

interface Ctx {
  measureText(t: string): { width: number };
  font: string;
  [k: string]: any;
}

function setFont(ctx: Ctx, size: number, bold: boolean): void {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;
}

/** 行首禁则字符：这些标点出现在行首很难看，折行时把它们连同前一行的末字一起下移 */
const NO_LINE_START = '、。，；：？！）】》」』％%…·,,.;:?!';

/** 行首禁则修正（纯文本行）：若某行以标点开头，把上一行最后一个字挪下来，让标点跟在它后面 */
function fixKinsokuText(lines: string[]): void {
  for (let i = 1; i < lines.length; i++) {
    for (let guard = 0; guard < 2; guard++) {
      const fc = lines[i].charAt(0);
      if (!fc || NO_LINE_START.indexOf(fc) < 0) break;
      if (lines[i - 1].length <= 1) break;
      lines[i] = lines[i - 1].slice(-1) + lines[i];
      lines[i - 1] = lines[i - 1].slice(0, -1);
    }
  }
}

/** 行首禁则修正（分段行）：样式标记跟随末字一起下移，不影响逐段上色 */
function fixKinsokuRuns(lines: Run[][]): void {
  for (let i = 1; i < lines.length; i++) {
    for (let guard = 0; guard < 2; guard++) {
      const cur = lines[i];
      if (!cur.length) break;
      const fc = cur[0].text.charAt(0);
      if (!fc || NO_LINE_START.indexOf(fc) < 0) break;
      const lastRun = lines[i - 1][lines[i - 1].length - 1];
      if (!lastRun || lastRun.text.length <= 1) break;
      const ch = lastRun.text.slice(-1);
      const seg = lastRun.seg;
      lastRun.text = lastRun.text.slice(0, -1);
      if (!lastRun.text) lines[i - 1].pop();
      if (cur[0].seg === seg) cur[0].text = ch + cur[0].text;
      else cur.unshift({ text: ch, seg });
    }
  }
}

/** 按最大宽度折行，返回每行文本 */
function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const tokens = tokenize(s);
  const lines: string[] = [];
  let cur = '';
  for (const tk of tokens) {
    const next = cur + tk;
    if (cur && ctx.measureText(next).width > maxWidth) {
      lines.push(cur.replace(/\s+$/, ''));
      cur = tk === ' ' ? '' : tk;
    } else {
      cur = next;
    }
  }
  if (cur.replace(/\s+$/, '')) lines.push(cur.replace(/\s+$/, ''));
  fixKinsokuText(lines);
  return lines.length ? lines : [s];
}

/** 一段带样式标记的文本：seg=0 主文本（粗、深色），seg=1 次要文本（常规、灰色） */
interface Run {
  text: string;
  seg: number;
}

function trimEndRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ text: r.text.replace(/\s+$/g, ''), seg: r.seg }));
  return out.filter((r) => r.text.length > 0);
}

/**
 * 分段折行：把「公司名（粗体深色）· 岗位（常规灰色）」这样的两段文字按同一行折，
 * 折行结果仍保留每段的样式归属 —— 绘制时才能逐段上色，宽度与测量完全一致。
 * 宽度按每段的真实字体测（主文本粗体、次要常规），保证不溢出、不断错位置。
 */
function wrapRuns(ctx: Ctx, segs: { text: string; seg: number }[], maxWidth: number, size: number): Run[][] {
  const toks: { t: string; seg: number }[] = [];
  for (const s of segs) {
    for (const tk of tokenize(s.text)) toks.push({ t: tk, seg: s.seg });
  }
  const lines: Run[][] = [];
  let cur: Run[] = [];
  let curW = 0;
  let curSeg = -1;
  const fontOf = (seg: number) => { setFont(ctx, size, seg === 0); };
  const pushTok = (t: string, seg: number) => {
    const last = cur[cur.length - 1];
    if (last && last.seg === seg) last.text += t;
    else cur.push({ text: t, seg });
  };
  for (const tk of toks) {
    if (curSeg !== tk.seg) { fontOf(tk.seg); curSeg = tk.seg; }
    const w = ctx.measureText(tk.t).width;
    if (cur.length && curW + w > maxWidth) {
      const trimmed = trimEndRuns(cur);
      lines.push(trimmed.length ? trimmed : cur);
      cur = [];
      curW = 0;
      curSeg = -1;
      if (tk.t === ' ') continue; // 折行后行首不留空格
      fontOf(tk.seg);
      curSeg = tk.seg;
      pushTok(tk.t, tk.seg);
      curW = w;
      continue;
    }
    pushTok(tk.t, tk.seg);
    curW += w;
  }
  if (cur.length) {
    const trimmed = trimEndRuns(cur);
    lines.push(trimmed.length ? trimmed : cur);
  }
  fixKinsokuRuns(lines);
  return lines.length ? lines : [[{ text: '', seg: 0 }]];
}

/* ==================== 联系方式图标 ==================== */

export type ContactIcon = 'phone' | 'mail' | 'link' | 'pin' | 'dot';

/** 按内容猜联系方式类型：邮箱 / 链接 / 电话号段 / 其他。
 * 猜错也不难看 —— 兜底是个小圆点，绝不为了猜而猜。 */
export function iconOfContact(s: string): ContactIcon {
  const t = String(s || '');
  if (/@/.test(t)) return 'mail';
  if (/(https?:\/\/|www\.|github|gitee|博客|链接|\.com|\.cn|\.io|\.me)/i.test(t)) return 'link';
  if (/(^|[^\d])1[3-9]\d{9}([^\d]|$)/.test(t) || /^[\d\s\-+()]{7,}$/.test(t.trim())) return 'phone';
  return 'dot';
}

/* ==================== 文档 → 行 ==================== */

export function buildLines(profile: ResumeProfile, layoutOpt?: ResumeLayout): DocLine[] {
  const L: DocLine[] = [];
  const classic = layoutOpt === 'classic';
  const minimal = layoutOpt === 'minimal';
  // 姓名缺失时不再渲染「你的名字」这类兜底占位（占位符外泄等于把模板痕迹印进成品），
  // 直接省略该行；页面生成入口已强制校验姓名必填，正常不会出现。
  if (profile.name && profile.name.trim()) L.push({ kind: 'h1', a: profile.name });
  if (profile.headline) {
    // classic 版式头部带「求职意向：」标签（参考传统简历头部信息区）
    L.push({ kind: 'h2', a: classic ? `求职意向：${profile.headline}` : profile.headline, mark: !minimal });
  }
  const intent = [profile.expectedSalary, profile.expectedCity].filter(Boolean);
  if (intent.length) {
    L.push({
      kind: 'h3',
      a: classic
        ? `期望薪资：${profile.expectedSalary || '面议'}${profile.expectedCity ? '  ·  期望城市：' + profile.expectedCity : ''}`
        : intent.join('  ·  ')
    });
  }
  // 联系方式逐行 + 图标：比挤成一行更易读，也更有「设计过」的感觉
  const contacts = (profile.contacts || []).filter(Boolean);
  contacts.forEach((c) => {
    const t = String(c);
    L.push({ kind: 'h3', a: t, icon: iconOfContact(t) });
  });
  L.push({ kind: 'gap' });

  let secNo = 0;
  for (const sec of profile.sections || []) {
    if (!sec) continue;
    // 空壳模块（无条目、无文本、无图片）直接跳过：否则会渲染出一个孤零零的标题底板
    const hasItems = (sec.items || []).length > 0;
    const hasText = !!sec.text;
    const hasImgs = (sec.images || []).length > 0;
    if (!hasItems && !hasText && !hasImgs) continue;
    secNo++;
    L.push({ kind: 'sec', a: sec.title || '经历', no: secNo, secKey: sec.key });
    if (sec.text) L.push({ kind: 'text', a: sec.text, secKey: sec.key });
    const list = (sec.items || []).filter(Boolean);
    list.forEach((it, k) => {
      // tl=true：该行是时间线上的一个节点（画圆点 + 与上一节点的连接线）
      L.push({ kind: 'row', a: it.primary, b: it.secondary, c: it.meta, tl: true, secKey: sec.key });
      for (const b of it.bullets || []) {
        if (b && String(b).trim()) {
          L.push(classic ? { kind: 'bullet', a: String(b), marker: '■' } : { kind: 'bullet', a: String(b) });
        }
      }
      // 条目之间的呼吸留白（最后一条后面不加，交给模块间距）
      if (k < list.length - 1) L.push({ kind: 'gap', lhOverride: tuningOf(layoutOpt).itemGap });
    });
    // 模块图片：渲染为统一方形网格，插入本模块内容之下、模块间距之上
    const imgs = (sec.images || []).filter((x) => x && x.path);
    if (imgs.length) {
      L.push({
        kind: 'img',
        imgIds: imgs.map((x) => x.id),
        imgs: imgs.map((x) => ({ id: x.id, path: x.path, caption: x.caption }))
      });
    }
    L.push({ kind: 'gap' });
  }
  return L;
}

/* ==================== 测量与分页 ==================== */

interface Measured {
  line: DocLine;
  height: number;
  /** h2/text/row 主文本折行结果 */
  wa?: string[];
  /** row 的 meta 折行结果 */
  wc?: string[];
  /** row 的分段折行结果：主文本（粗、深色）与副标题（常规、灰色）分开上色 */
  runs?: Run[][];
  /** row 的 meta 是否与主文本同行（右侧对齐）；false 时 meta 独占一行排在主文本下方 */
  metaInline?: boolean;
}

/**
 * 每种行可用的文本宽度（页眉行传页眉列宽，正文行传 CONTENT_W）。
 * 测量与绘制必须同源：这里少算 1px，绘制时就会溢出 1px；
 * 徽标 / 时间线 / 面板的占位也全部在这里兑现，drawPage 不再自己减。
 */
function colWidthFor(line: DocLine, layoutOpt: ResumeLayout | undefined, headerW: number): number {
  const tune = tuningOf(layoutOpt);
  if (line.kind === 'sec') {
    return CONTENT_W - (tune.secBadge === 'num' ? 32 : tune.secBadge === 'dot' ? 14 : 0);
  }
  if (line.kind === 'row') return CONTENT_W - TIMELINE_INDENT;
  if (line.kind === 'bullet') return CONTENT_W - BULLET_INDENT;
  if (line.kind === 'text') return tune.textPanel ? CONTENT_W - 32 : CONTENT_W;
  // 页眉行：联系方式图标 / 求职意向前缀方块的占位
  if (line.kind === 'h3' && line.icon) return headerW - 24;
  if (line.kind === 'h2' && line.mark) return headerW - 14;
  return headerW;
}

function measureLines(ctx: Ctx, lines: DocLine[], layoutOpt: ResumeLayout | undefined, colW: number[], headerEnd: number, deficit: number): Measured[] {
  const stTable = stylesOf(layoutOpt);
  const out: Measured[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const st = stTable[line.kind];
    const w = colW[i];
    setFont(ctx, st.size, st.bold);
    if (line.kind === 'gap') {
      let h = line.lhOverride != null ? line.lhOverride : st.lh;
      // 页眉区结束处的间隔：页眉下方的留白（及照片所需竖向空间）必须预留，
      // 否则正文会与页眉 / 照片重叠
      if (i === headerEnd) h += deficit;
      out.push({ line, height: h });
      continue;
    }
    if (line.kind === 'sec') {
      const wa = wrapText(ctx, line.a || '', w);
      // 必须与 drawPage 的 sec 绘制消耗完全一致：6(段前) + 行高*行数 + 8(块内) + 8(段后)
      out.push({ line, height: wa.length * st.lh + 22, wa });
      continue;
    }
    if (line.kind === 'row') {
      // meta（右侧时间/地点）用小一号非粗体字测量，与绘制保持一致
      const meta = (line.c || '').trim();
      const metaSize = st.size - 3;
      setFont(ctx, metaSize, false);
      const metaW = meta ? ctx.measureText(meta).width : 0;
      // meta 与主文本同行的条件：不超过行宽的 44%（太长会挤压标题），否则独占一行
      const inlineOk = !!meta && metaW <= Math.max(160, w * 0.44);
      let runs: Run[][];
      let wc: string[];
      let h: number;
      // 主文本粗体深色 + 副标题常规灰色：分段折行，绘制时逐段上色（宽度与这里完全一致）
      const segs: { text: string; seg: number }[] = [{ text: line.a || '', seg: 0 }];
      if (line.b) { segs.push({ text: '  ·  ', seg: 1 }); segs.push({ text: line.b, seg: 1 }); }
      if (inlineOk) {
        const mainW = Math.max(120, w - metaW - 24);
        runs = wrapRuns(ctx, segs, mainW, st.size);
        wc = [meta];
        h = Math.max(runs.length, 1) * st.lh;
      } else {
        runs = wrapRuns(ctx, segs, w, st.size);
        wc = meta ? wrapText(ctx, meta, w) : [];
        h = Math.max(runs.length, 1) * st.lh + wc.length * (metaSize + 9);
      }
      const wa = runs.map((ln) => ln.map((r) => r.text).join(''));
      out.push({ line, height: h, wa, wc, runs, metaInline: inlineOk });
      continue;
    }
    if (line.kind === 'bullet') {
      // 列宽已含时间线二次缩进（BULLET_INDENT），这里直接用
      const wa = wrapText(ctx, line.a || '', w);
      out.push({ line, height: wa.length * st.lh, wa });
      continue;
    }
    if (line.kind === 'text') {
      const wa = wrapText(ctx, line.a || '', w);
      // 淡彩面板：上下各 10px 呼吸（必须与 drawPage 的面板绘制完全一致）
      const panel = tuningOf(layoutOpt).textPanel;
      out.push({ line, height: wa.length * st.lh + (panel ? 20 : 0), wa });
      continue;
    }
    if (line.kind === 'img') {
      const imgs = line.imgs || [];
      const hasCap = imgs.some((x) => !!x.caption);
      const L = imgLayout(imgs.length, hasCap);
      out.push({ line, height: L.height });
      continue;
    }
    const wa = wrapText(ctx, line.a || '', w);
    out.push({ line, height: wa.length * st.lh, wa });
  }
  return out;
}

/** 按页面可用高度切片，返回每页包含的行索引数组 */
function paginate(measured: Measured[], maxH: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let h = 0;
  measured.forEach((m, i) => {
    if (h + m.height > maxH && cur.length) {
      pages.push(cur);
      cur = [];
      h = 0;
    }
    // 段前不留白：新页开头若遇到 gap 直接丢弃
    if (m.line.kind === 'gap' && cur.length === 0) return;
    cur.push(i);
    h += m.height;
  });
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

/** 模块图片网格布局：统一方形（封面裁剪）+ 等宽等距，保证「方正对齐」 */
export function imgLayout(n: number, hasCap: boolean): { cols: number; side: number; rows: number; height: number; gapI: number; capH: number } {
  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const gapI = 14;
  const maxSide = (CONTENT_W - (cols - 1) * gapI) / cols;
  const side = n === 1 ? Math.min(300, maxSide) : maxSide;
  const capH = hasCap ? 26 : 0;
  const rows = Math.ceil(n / cols);
  const height = rows * (side + capH + 10) - 10 + 8;
  return { cols, side, rows, height, gapI, capH };
}

/** 圆角矩形路径（兼容旧基础库，不依赖 ctx.roundRect） */
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 绘制单个图片框：浅灰底 + 圆角裁剪封面 + 统一边框 + 可选图注。
 * 未加载成功时画占位块，绝不让 canvas 因图片缺失而报错中断。
 */
function drawImageBox(ctx: Ctx, im: LoadedImage | undefined, x: number, y: number, w: number, h: number, caption?: string, layoutOpt?: ResumeLayout): void {
  // 图片底：极淡竖向渐变，比纯色更有质感（加载失败时就是一块体面的占位）
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#f8fafc');
  g.addColorStop(1, '#eef2f7');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  if (im && im.img) {
    // 封面裁剪（cover-fit）：等比缩放后居中裁切，保证框内图像方正填满
    const ir = im.width / im.height;
    const br = w / h;
    let dw = w, dh = h, dx = x, dy = y;
    if (ir > br) { dh = h; dw = h * ir; dx = x - (dw - w) / 2; }
    else { dw = w; dh = w / ir; dy = y - (dh - h) / 2; }
    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    ctx.drawImage(im.img, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = '#94a3b8';
    setFont(ctx, Math.round(Math.min(w, h) * 0.1), false);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('图片', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6);
  ctx.stroke();
  if (caption) {
    setFont(ctx, 17, false);
    ctx.fillStyle = '#64748b';
    const cw = wrapText(ctx, caption, w);
    let ct = cw[0] || '';
    if (cw.length > 1) ct += '…';
    // 图注居中于图片下方：网格里多张图并列时，居中也保持整齐
    ctx.textAlign = 'center';
    ctx.fillText(ct, x + w / 2, y + h + 7);
    ctx.textAlign = 'left';
  }
}

/** 联系方式小图标（约 14px 见方，画在文字左侧）：全部路径绘制，零图片资源 */
function drawContactIcon(ctx: Ctx, kind: ContactIcon, x: number, y: number, accent: string): void {
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'mail') {
    ctx.strokeRect(x - 6, y - 4.5, 12, 9);
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 4.5);
    ctx.lineTo(x, y + 1);
    ctx.lineTo(x + 6, y - 4.5);
    ctx.stroke();
  } else if (kind === 'phone') {
    roundRect(ctx, x - 4, y - 7, 8, 14, 2.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 4.5);
    ctx.lineTo(x + 2, y - 4.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 3.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'link') {
    ctx.beginPath(); ctx.arc(x - 2.8, y, 3.6, 0.5, 5.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 2.8, y, 3.6, 2.7, 4.4 + Math.PI); ctx.stroke();
  } else if (kind === 'pin') {
    ctx.beginPath(); ctx.arc(x, y - 2, 3.6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + 6.5); ctx.lineTo(x - 3, y - 0.6); ctx.lineTo(x + 3, y - 0.6);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* ==================== 绘制 ==================== */

/** 把某一页画到 canvas 上；ctx 需已完成 dpr 缩放。
 * 视觉体系（四套版式共用同一套语言，装饰强弱由 tuningOf 决定，整体风格永远统一）：
 *   背景：白 → 主题淡彩的整页渐变 + 右上角逐层圆环 + 左下角支架（极简版只留渐变与顶部细条）
 *   页眉：第 1 页通栏淡彩带 + 姓名下主题色短划线 + 联系方式图标；续页页眉带姓名与细线
 *   结构：小节编号徽标 / 淡彩底板 + 延伸到行尾的细线；技能与自评走淡彩面板
 *   条目：时间线圆点 + 连接线，要点缩进挂在轨道内侧，右侧时间/地点贴右对齐
 *   多页：每页顶部主题色细条 + 页脚姓名/页码
 * photoImg/photoCap/loaded 为预加载图片（本地优先，缺失时画占位块，绝不中断绘制）。 */
export function drawPage(ctx: Ctx, measured: Measured[], pageIdx: number[], pageNo: number, total: number, theme?: ResumeTheme, layoutOpt?: ResumeLayout, photoImg?: LoadedImage, photoCap?: string, loaded?: Record<string, LoadedImage>, runHead?: string): void {
  const stTable = stylesOf(layoutOpt);
  const tune = tuningOf(layoutOpt);
  const accent = (theme && theme.accent) || '#1d4ed8';
  const soft = (theme && theme.soft) || '#dbeafe';
  // 派生淡彩：主题色与白按比例混 —— 层次丰富但永远不抢正文，这是可读性的底线
  const tintPage = mixHex(soft, '#ffffff', 0.14);  // 页面底部淡彩
  const tintBand = mixHex(soft, '#ffffff', 0.42);  // 页眉带顶部
  const tintBand2 = mixHex(soft, '#ffffff', 0.08); // 页眉带底部
  const tintPanel = mixHex(soft, '#ffffff', 0.50); // 小节底板 / 文本面板
  const tintRule = mixHex(accent, soft, 0.45);     // 小节延伸细线
  const tintMount = mixHex(soft, '#ffffff', 0.45); // 照片卡座

  ctx.textBaseline = 'top';

  /* ---------- ① 背景层：渐变 + 顶部细条 + 角落装饰 ---------- */
  const bg = ctx.createLinearGradient(0, 0, 0, PAGE_H);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(1, tintPage);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  // 顶部主题色细条：每一页都有；右端横向渐隐，与右上角逐层圆环自然衔接
  const tg = ctx.createLinearGradient(0, 0, PAGE_W, 0);
  tg.addColorStop(0, accent);
  tg.addColorStop(1, mixHex(accent, '#ffffff', 0.30));
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, PAGE_W, TOP_BAR);

  if (layoutOpt !== 'minimal') {
    // 右上角逐层圆环：两圈 soft 色 + 一颗主题色小圆点，低透明度做「水印」层次
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = soft;
    ctx.lineWidth = 10;
    const cx = PAGE_W + 40, cy = -40;
    ctx.beginPath(); ctx.arc(cx, cy, 160, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 224, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx - 224 * Math.SQRT1_2, cy + 224 * Math.SQRT1_2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = soft;
    ctx.beginPath(); ctx.arc(cx - 160 * Math.SQRT1_2, cy + 160 * Math.SQRT1_2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // 左下角支架线：与右上角呼应，压住页面重心
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = soft;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, PAGE_H - 84); ctx.lineTo(0, PAGE_H); ctx.lineTo(72, PAGE_H);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(22, PAGE_H - 22); ctx.lineTo(29, PAGE_H - 29); ctx.lineTo(36, PAGE_H - 22); ctx.lineTo(29, PAGE_H - 15);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------- ② 续页页眉（第 2 页起）：姓名 + 细线，多页也有连续性 ---------- */
  if (pageNo > 1 && runHead) {
    ctx.fillStyle = accent;
    ctx.fillRect(PAD_X, 32, 5, 5);
    setFont(ctx, 17, false);
    ctx.fillStyle = MUTED;
    ctx.fillText(runHead, PAD_X + 12, 29);
    ctx.fillStyle = HAIR;
    ctx.fillRect(PAD_X, 48, CONTENT_W, 1);
  }

  /* ---------- ③ 第 1 页页眉：淡彩带 + 照片卡座 ---------- */
  let headerEnd = measured.findIndex((m) => m.line.kind === 'gap' || m.line.kind === 'sec');
  if (headerEnd < 0) headerEnd = measured.length;
  let bandH = 0;
  if (pageNo === 1) {
    let hh = 0;
    for (let i = 0; i < headerEnd; i++) {
      const st = stTable[measured[i].line.kind];
      const wa = measured[i].wa || [];
      if (measured[i].line.kind === 'gap') hh += st.lh;
      else if (measured[i].line.kind === 'sec') hh += wa.length * st.lh + 10;
      else hh += wa.length * st.lh;
    }
    bandH = PAD_Y + hh + HEADER_BOTTOM;
    // 证件照贴页眉顶部右侧：页眉高度必须容得下照片，否则会压到分隔线上
    if (photoImg) bandH = Math.max(bandH, PAD_Y + PHOTO + 26);
    if (tune.headerBand) {
      // 通栏淡彩带：与页面渐变形成第一层「上下层次」，底部一条主题色细线收口
      const hg = ctx.createLinearGradient(0, TOP_BAR, 0, bandH);
      hg.addColorStop(0, tintBand);
      hg.addColorStop(1, tintBand2);
      ctx.fillStyle = hg;
      ctx.fillRect(0, TOP_BAR, PAGE_W, bandH - TOP_BAR);
      // 收口线：主题色横向渐隐，右端化进页面底色，不生硬
      const rg = ctx.createLinearGradient(0, 0, PAGE_W, 0);
      rg.addColorStop(0, mixHex(accent, '#ffffff', 0.35));
      rg.addColorStop(1, mixHex(accent, '#ffffff', 0.75));
      ctx.fillStyle = rg;
      ctx.fillRect(0, bandH - 2, PAGE_W, 2);
    } else {
      ctx.fillStyle = HAIR;
      ctx.fillRect(PAD_X, bandH - 16, CONTENT_W, 1);
    }
    if (photoImg) {
      // 照片「卡座」：右下偏移一层淡彩底，营造叠放层次，再放照片本体
      ctx.fillStyle = tintMount;
      roundRect(ctx, PAGE_W - PAD_X - PHOTO + 9, PAD_Y + 7, PHOTO, PHOTO, 10);
      ctx.fill();
      drawImageBox(ctx, photoImg, PAGE_W - PAD_X - PHOTO, PAD_Y - 2, PHOTO, PHOTO, photoCap, layoutOpt);
    }
  }

  /* ---------- ④ 正文行 ---------- */
  let y = PAD_Y;
  // 时间线状态：只连同一小节、同一页内的相邻条目（跨页天然断开，正好顺势分段）
  const tl = { y: -1, sec: '' };

  for (const i of pageIdx) {
    const m = measured[i];
    const st = stTable[m.line.kind];
    const isHeader = pageNo === 1 && i < headerEnd;

    if (m.line.kind === 'gap') {
      // 页眉结束处的间隔：消耗页眉预留空间，并额外留一点呼吸空隙，正文不贴线
      if (pageNo === 1 && i === headerEnd) { y = bandH + 8; continue; }
      y += m.height;
      continue;
    }

    setFont(ctx, st.size, st.bold);

    // 页眉：姓名近黑 + 主题色短划线、求职意向主题色 + 前缀方块、联系方式图标 + 灰色文字
    if (isHeader) {
      if (m.line.kind === 'h1') {
        ctx.fillStyle = INK;
        for (const t of m.wa || []) { ctx.fillText(t, PAD_X, y); y += st.lh; }
        // 姓名下一道主题色短划线：头部唯一的强调，替代整块色
        if (tune.headerBand && (m.wa || []).length === 1) {
          ctx.fillStyle = accent;
          ctx.fillRect(PAD_X, y - 6, 34, 3);
        }
      } else if (m.line.kind === 'h2') {
        ctx.fillStyle = accent;
        if (m.line.mark) ctx.fillRect(PAD_X + 1, y + Math.round(st.lh / 2) - 3, 6, 6);
        for (const t of m.wa || []) { ctx.fillText(t, PAD_X + (m.line.mark ? 14 : 0), y); y += st.lh; }
      } else {
        if (m.line.icon) drawContactIcon(ctx, m.line.icon, PAD_X + 8, y + Math.round(st.lh / 2) - 1, accent);
        ctx.fillStyle = MUTED;
        for (const t of m.wa || []) { ctx.fillText(t, PAD_X + (m.line.icon ? 24 : 0), y); y += st.lh; }
      }
      continue;
    }

    if (m.line.kind === 'sec') {
      if (pageNo === 1 && i === headerEnd) y = Math.max(y, bandH + 8);
      y += 6;
      // 小节标题：淡彩底板（雅致版）+ 编号徽标/圆点 + 标题文字 + 右侧延伸到行尾的细线
      const rows = m.wa || [''];
      const barH = rows.length * st.lh + 8;
      if (tune.secBand) {
        ctx.fillStyle = tintPanel;
        roundRect(ctx, PAD_X, y - 3, CONTENT_W, barH + 6, 6);
        ctx.fill();
      }
      let textX = PAD_X;
      if (tune.secBadge === 'num' && m.line.no != null) {
        const bs = 22;
        const by = y + Math.round((barH - bs) / 2);
        // 徽标：主题色斜向渐变，比纯色方块更有质感
        const bgg = ctx.createLinearGradient(PAD_X, by, PAD_X + bs, by + bs);
        bgg.addColorStop(0, accent);
        bgg.addColorStop(1, mixHex(accent, soft, 0.35));
        ctx.fillStyle = bgg;
        roundRect(ctx, PAD_X, by, bs, bs, 6);
        ctx.fill();
        setFont(ctx, 13, true);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(m.line.no).padStart(2, '0'), PAD_X + bs / 2, by + bs / 2 + 1);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        textX = PAD_X + bs + 10;
      } else if (tune.secBadge === 'dot') {
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(PAD_X + 4, y + barH / 2, 4, 0, Math.PI * 2);
        ctx.fill();
        textX = PAD_X + 14;
      }
      ctx.fillStyle = tune.secTitle === 'ink' ? INK : accent;
      let ty = y + 2;
      for (const t of rows) { ctx.fillText(t, textX, ty); ty += st.lh; }
      // 右侧细线：从标题之后延伸到右边界，视觉上把小节「撑」成一条完整的行
      let titleW = 0;
      for (const t of rows) titleW = Math.max(titleW, ctx.measureText(t).width);
      const ruleX = textX + titleW + 14;
      const ruleW = PAD_X + CONTENT_W - ruleX;
      if (ruleW > 48) {
        ctx.fillStyle = tune.rule === 'hair' ? HAIR : tintRule;
        ctx.fillRect(ruleX, Math.round(y + barH / 2) - 1, ruleW, 1);
      }
      y += barH + 8;
      continue;
    }

    if (m.line.kind === 'row') {
      const metaTop = y;
      // 时间线节点：白晕 + 主题色圆点/方点；连接线只连同一小节的上一节点
      if (m.line.tl) {
        const dotY = metaTop + Math.round(st.lh / 2) - 2;
        if (tl.sec === m.line.secKey && tl.y >= 0) {
          const from = tl.y + 6, to = dotY - 6;
          if (to > from) {
            ctx.fillStyle = mixHex(accent, '#ffffff', 0.45);
            ctx.fillRect(PAD_X + 6, from, 1.5, to - from);
          }
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(PAD_X + 7, dotY, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = accent;
        if (tune.tlDot === 'square') {
          ctx.fillRect(PAD_X + 4, dotY - 3, 6, 6);
        } else {
          ctx.beginPath(); ctx.arc(PAD_X + 7, dotY, 3.2, 0, Math.PI * 2); ctx.fill();
        }
        tl.y = dotY; tl.sec = m.line.secKey || '';
      }
      // 主文本粗体深色 + 副标题常规灰色，逐段绘制（宽度与测量同源，不会错位）
      const runs = m.runs;
      const x0 = PAD_X + TIMELINE_INDENT;
      if (runs && runs.length) {
        for (const lineRuns of runs) {
          let x = x0;
          for (const r of lineRuns) {
            setFont(ctx, st.size, r.seg === 0);
            ctx.fillStyle = r.seg === 0 ? INK : MUTED;
            ctx.fillText(r.text, x, y);
            x += ctx.measureText(r.text).width;
          }
          y += st.lh;
        }
      } else {
        for (const t of m.wa || ['']) { ctx.fillText(t, x0, y); y += st.lh; }
      }
      if (m.wc && m.wc.length) {
        const metaSize = st.size - 3;
        setFont(ctx, metaSize, false);
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'right';
        // 与主文本同行时贴首行垂直居中；独占一行时排在主文本下方并推进 y（测量已计入，不会重叠）
        let yy = m.metaInline ? metaTop + Math.max(2, (st.lh - metaSize) / 2) : y + 2;
        for (const t of m.wc) { ctx.fillText(t, PAGE_W - PAD_X, yy); yy += metaSize + 9; }
        ctx.textAlign = 'left';
        if (!m.metaInline) y += m.wc.length * (metaSize + 9);
      }
      continue;
    }

    if (m.line.kind === 'bullet') {
      const wa = m.wa || [];
      const cy = Math.round(y + st.lh / 2) - 2;
      const bx = PAD_X + 28, tx = PAD_X + BULLET_INDENT;
      wa.forEach((t, k) => {
        if (k === 0) {
          // 用图形画符号（圆点 / 方点），比文本符号基线更稳、更精致；颜色取主题色淡彩
          if (tune.bullet === 'square') {
            ctx.fillStyle = mixHex(accent, '#ffffff', 0.25);
            ctx.fillRect(bx - 2, cy - 2, 6, 6);
          } else {
            ctx.fillStyle = mixHex(accent, '#ffffff', 0.35);
            ctx.beginPath(); ctx.arc(bx + 1, cy, 2.6, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.fillStyle = stTable.bullet.color;
        ctx.fillText(t, tx, y);
        y += st.lh;
      });
      continue;
    }

    if (m.line.kind === 'text') {
      const wa = m.wa || [''];
      if (tune.textPanel) {
        // 淡彩圆角面板 + 左侧主题色小竖条：技能/自评也有自己的层次
        const ph = wa.length * st.lh + 20;
        ctx.fillStyle = tintPanel;
        roundRect(ctx, PAD_X, y - 4, CONTENT_W, ph, 8);
        ctx.fill();
        ctx.fillStyle = mixHex(accent, '#ffffff', 0.3);
        roundRect(ctx, PAD_X + 8, y + 2, 3, ph - 12, 2);
        ctx.fill();
        ctx.fillStyle = st.color;
        let ty = y + 6;
        for (const t of wa) { ctx.fillText(t, PAD_X + 20, ty); ty += st.lh; }
        y += ph;
      } else {
        ctx.fillStyle = st.color;
        for (const t of wa) { ctx.fillText(t, PAD_X, y); y += st.lh; }
      }
      continue;
    }

    if (m.line.kind === 'img') {
      const imgs = m.line.imgs || [];
      const ids = m.line.imgIds || [];
      const hasCap = imgs.some((x) => !!x.caption);
      const L = imgLayout(imgs.length, hasCap);
      let row = 0, col = 0;
      for (let k = 0; k < imgs.length; k++) {
        const bx = PAD_X + col * (L.side + L.gapI);
        const by = y + row * (L.side + L.capH + 10);
        drawImageBox(ctx, loaded ? loaded[ids[k]] : undefined, bx, by, L.side, L.side, imgs[k].caption, layoutOpt);
        col++;
        if (col >= L.cols) { col = 0; row++; }
      }
      y += L.height;
      continue;
    }

    // h1/h2/h3（非页眉，理论上不会出现；兜底保持原逻辑）
    ctx.fillStyle = st.color;
    for (const t of m.wa || []) { ctx.fillText(t, PAD_X, y); y += st.lh; }
  }

  /* ---------- ⑤ 页脚：细线 + 左侧姓名 + 右侧页码 ---------- */
  if (total > 1) {
    ctx.fillStyle = HAIR;
    ctx.fillRect(PAD_X, PAGE_H - 58, CONTENT_W, 1);
    // 线左端一截主题色：与顶部细条首尾呼应
    ctx.fillStyle = accent;
    ctx.fillRect(PAD_X, PAGE_H - 58, 26, 1);
    setFont(ctx, 17, false);
    ctx.fillStyle = MUTED;
    const fn = (runHead || '').split('·')[0].trim();
    if (fn) ctx.fillText(fn, PAD_X, PAGE_H - 46);
    ctx.textAlign = 'right';
    ctx.fillText(`${pageNo} / ${total}`, PAGE_W - PAD_X, PAGE_H - 46);
    ctx.textAlign = 'left';
  }
}

/** 完整排版：测量 + 分页，返回分页索引；调用方据此逐页绘制并导出；layoutOpt 选择版式。
 * hasPhoto 表示草稿含证件照，用于收窄页眉右列宽度并预留照片竖向空间。 */
export function layout(ctx: Ctx, profile: ResumeProfile, layoutOpt?: ResumeLayout, hasPhoto = false): { measured: Measured[]; pages: number[][] } {
  const lines = buildLines(profile, layoutOpt);
  // 头部右列宽度（有照片时收窄），保证页眉文字不与照片重叠
  let headerEnd = lines.findIndex((l) => l.kind === 'gap' || l.kind === 'sec');
  if (headerEnd < 0) headerEnd = lines.length;
  const headerColW = hasPhoto ? (CONTENT_W - PHOTO - 16) : CONTENT_W;
  // 每种行的真实可用宽度（徽标 / 时间线 / 面板占位全部在这里兑现，测量与绘制同源）
  const colW = lines.map((l, i) => colWidthFor(l, layoutOpt, i < headerEnd ? headerColW : CONTENT_W));

  // 页眉装饰带所需下边距 + 照片所需竖向空间（不足时补偿到头部间隔）
  let hh = 0;
  for (let i = 0; i < headerEnd; i++) {
    const st = stylesOf(layoutOpt)[lines[i].kind];
    const wa = wrapText(ctx, lines[i].a || '', colW[i]);
    if (lines[i].kind === 'gap') hh += st.lh;
    else if (lines[i].kind === 'sec') hh += wa.length * st.lh + 10;
    else hh += wa.length * st.lh;
  }
  // bandH（页眉总高）的算法必须与 drawPage 完全一致，否则正文会压到页眉/照片上或留出大片空白；
  // deficit = 页眉结束处那一行 gap 需要吃掉的高度（把正文推到 bandH + 8）。
  let bandH = PAD_Y + hh + HEADER_BOTTOM;
  if (hasPhoto) bandH = Math.max(bandH, PAD_Y + PHOTO + 26);
  const deficit = bandH - PAD_Y - hh + 8;

  const measured = measureLines(ctx, lines, layoutOpt, colW, headerEnd, deficit);
  const pages = paginate(measured, PAGE_H - PAD_Y * 2);
  return { measured, pages };
}

/* ==================== 本地 PDF 组装（零云函数依赖） ==================== */
//
// 云函数未部署 / 云端不通时，前端同样能把页图拼成标准 PDF 存到本地打开，
// 避免「点了生成却永远失败」。逻辑与 cloudfunctions/resume 的 buildPdf 一致，
// 只是把 Node 的 Buffer 换成小程序可用的 Uint8Array。
//
// 同样只支持 JPEG（/DCTDecode），与 canvasToTempFilePath 的 fileType:'jpg' 配套。

/** latin1 字符串 → 字节（PDF 结构与内容流都是纯 ASCII/latin1） */
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** 从 JPEG 字节里读出宽高（解析 SOF 段）。
 * 真机兜底安全：字节对齐错位/没找到 SOF marker 时绝不返回 null，
 * 退回到「按 A4 比例 + dpr 缩放」导出尺寸，保证 buildPdfBytes 永远拿到合法正整数，
 * 不触发 wx.openDocument 对 width=0 的玄学报错。 */
export function jpegSizeOf(b: Uint8Array): { width: number; height: number } | null {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9) break;
    // SOF0~SOF15（排除 C4/DHT、C8/JPG、CC/DAC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    const segLen = (b[i + 2] << 8) | b[i + 3];
    if (!segLen || segLen < 2) break;
    i += 2 + segLen;
  }
  // 真机 fallback：解析失败时返回标准 A4 DPI 尺寸（750x1060 * dpr），绝不返回 null 让 PDF 写入 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sysInfo = wx.getSystemInfoSync?.() || {};
    const dpr = Number((sysInfo as any).pixelRatio || 2);
    return { width: Math.round(750 * dpr), height: Math.round(1060 * dpr) };
  } catch {
    return { width: 1500, height: 2120 };
  }
}

export interface PdfPageImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** 把若干张 JPEG 组装成一个 PDF（一图一页） */
export function buildPdfBytes(images: PdfPageImage[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = 0;
  const offsets: number[] = [];

  const push = (s: string) => {
    const b = latin1Bytes(s);
    parts.push(b);
    offset += b.length;
  };
  const pushBuf = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  const writeObj = (num: number, body: string, stream?: Uint8Array) => {
    offsets[num] = offset;
    push(`${num} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      pushBuf(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };

  const pageCount = images.length;
  const CATALOG = 1;
  const PAGES = 2;
  const firstPageObj = 3;

  push('%PDF-1.4\n');
  push('%\xe2\xe3\xcf\xd3\n'); // 二进制标记，避免被当成纯文本处理

  const pageObjNums: number[] = [];
  for (let p = 0; p < pageCount; p++) pageObjNums.push(firstPageObj + p * 3);

  writeObj(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R >>`);
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(' ');
  writeObj(PAGES, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);

  for (let p = 0; p < pageCount; p++) {
    const img = images[p];
    const pageObj = pageObjNums[p];
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;

    // 1px = 0.75pt（96dpi），保证与屏幕观感一致
    const pw = Math.round(img.width * 0.75);
    const ph = Math.round(img.height * 0.75);

    writeObj(
      pageObj,
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
        `/Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`
    );

    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q\n`;
    const contentBytes = latin1Bytes(content);
    writeObj(contentObj, `<< /Length ${contentBytes.length} >>`, contentBytes);

    writeObj(
      imageObj,
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`,
      img.bytes
    );
  }

  const maxObj = firstPageObj + pageCount * 3 - 1;
  const xrefOffset = offset;
  let xref = `xref\n0 ${maxObj + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let n = 1; n <= maxObj; n++) {
    const off = offsets[n] === undefined ? 0 : offsets[n];
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${maxObj + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/* ==================== 内置简历模板（资源库 PDF 用） ==================== */

export interface ResumeTemplate {
  key: string;
  title: string;
  /** 一句话定位（模板卡副标题，帮用户判断该不该套） */
  desc?: string;
  profile: ResumeProfile;
}

/** 简历 PDF 配色主题：仅影响小节标题与下划线，正文配色不变（保证可读性） */
export interface ResumeTheme {
  key: string;
  /** 主题名（页面展示） */
  name: string;
  /** 小节标题文字色 */
  accent: string;
  /** 小节下划线色 */
  soft: string;
}

// 主题色只用在「顶部细条 / 小节标题与装饰 / 延伸细线」三处，正文永远是中性深色 ——
// 所以选色偏沉稳（降低饱和），彩色一多就显廉价，这是简历观感最容易翻车的地方。
export const RESUME_THEMES: ResumeTheme[] = [
  { key: 'blue', name: '经典蓝', accent: '#1e40af', soft: '#dbeafe' },
  { key: 'slate', name: '商务灰', accent: '#475569', soft: '#e5e9ef' },
  { key: 'green', name: '墨绿', accent: '#0f766e', soft: '#ccfbf1' },
  { key: 'purple', name: '雅紫', accent: '#6d28d9', soft: '#ede9fe' },
  { key: 'navy', name: '藏青', accent: '#1e3a8a', soft: '#dbe6fe' },
  { key: 'wine', name: '酒红', accent: '#9f1239', soft: '#ffe4e6' },
  { key: 'amber', name: '暖橙', accent: '#c2410c', soft: '#ffedd5' },
  { key: 'teal', name: '青碧', accent: '#0e7490', soft: '#cffafe' },
  { key: 'pine', name: '松绿', accent: '#166534', soft: '#dcfce7' }
];

const PLACEHOLDER = '（此处填写你的真实经历与量化结果）';

export const RESUME_TEMPLATES: ResumeTemplate[] = [
  {
    key: '财务',
    title: '财务岗简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘财务分析（FP&A）· 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '上海'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '会计学 / 本科', meta: '2023.09 - 2027.06',
            bullets: ['GPA 3.7/4.0（专业前 10%）· 核心课程：中级财务会计、管理会计、审计学、税法', 'CPA 已通过：会计、税法（2026 年）'] }
        ] },
        { key: 'intern', title: '实习经历', items: [
          { primary: 'XX 公司', secondary: '财务分析实习生', meta: '2026.03 - 2026.08',
            bullets: ['独立完成 3 家子公司月度经营分析，输出差异归因报告，把出数时间从 5 天压缩到 2 天', '搭建费用预算跟踪模板，支持 8 个部门的月度预算复盘，定位超支项累计节约 XX 万元', '用 SQL + Excel 搭建销售毛利看板，替代原有手工报表，被团队沿用至今'] },
          { primary: 'XX 会计师事务所', secondary: '审计实习生', meta: '2025.07 - 2025.09',
            bullets: ['参与 2 家制造业年审，负责货币资金、往来款项底稿编制与函证', '独立完成 200+ 笔凭证抽样，发现 3 笔跨期收入并推动调整'] }
        ] },
        { key: 'skill', title: '技能与证书', text: 'Excel（SUMIFS / XLOOKUP / 透视表 / 三表联动建模）· SQL（窗口函数）· Power BI · SAP / 用友 · CPA 已过 2 科 · CET-6 580' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER + '：建议写成「数字敏感 + 业务理解 + 细致严谨」三选二，并配一个真实例子，避免空话。' }
      ]
    }
  },
  {
    key: '后端开发',
    title: '后端岗简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘后端开发工程师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '深圳'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '计算机科学与技术 / 本科', meta: '2023.09 - 2027.06',
            bullets: ['核心课程：数据结构、操作系统、计算机网络、数据库系统'] }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 订单系统重构', secondary: '主要负责人', meta: '2026.03 - 2026.06',
            bullets: ['针对大促下单超时，引入本地消息表保证库存扣减与订单创建的最终一致', '热点商品库存预热至 Redis 并用 Lua 原子扣减，下单 P99 从 800ms 降至 180ms，大促零超卖', '补充压测报告：单机 QPS 从 600 提升到 2100'] }
        ] },
        { key: 'skill', title: '技术栈', text: 'Java / Go · Spring Boot · MySQL（索引与事务）· Redis · Kafka · Docker · 熟悉分布式与高并发设计' },
        { key: 'summary', title: '其他', text: 'LeetCode 300+ · 有开源贡献 / 技术博客 / ACM 经历请在此列出并附链接' }
      ]
    }
  },
  {
    key: '产品经理',
    title: '产品经理简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘产品经理 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '北京'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '工商管理 / 本科', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX App 用户增长改版', secondary: '产品负责人', meta: '2026.02 - 2026.07',
            bullets: ['通过漏斗分析定位注册环节流失 42%， redesign 注册流程后次日留存提升 8pt', '输出完整需求文档与原型，推动 3 人开发团队 2 周内上线，上线后 DAU 提升 15%'] },
          { primary: '竞品分析报告', secondary: '独立完成', meta: '2025.11',
            bullets: ['对 3 款同类产品做功能、体验与商业化拆解，输出 20 页报告并附改版方案'] }
        ] },
        { key: 'skill', title: '技能与作品', text: 'Axure / Figma · SQL（会写基础查询与漏斗分析）· 数据分析 · 附作品集链接：____' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '数据分析',
    title: '数据分析岗简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘数据分析师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '杭州'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '统计学 / 本科', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 公司', secondary: '数据分析实习生', meta: '2026.01 - 2026.06',
            bullets: ['搭建用户留存指标体系，定位到新手引导环节流失最高，推动改版后次日留存提升 6pt', '设计并执行 A/B 实验，样本量估算与显著性检验齐全，结论被采纳并全量上线'] }
        ] },
        { key: 'skill', title: '技能', text: 'SQL（窗口函数、复杂查询）· Python（pandas / sklearn）· Excel · Tableau / Power BI · 统计基础（假设检验、回归）' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '前端开发',
    title: '前端岗简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘前端开发工程师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '上海'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '软件工程 / 本科', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 管理后台', secondary: '前端负责人', meta: '2026.03 - 2026.07',
            bullets: ['首屏加载从 3s 优化到 1.2s（路由懒加载 + 图片懒加载 + CDN + 打包拆包）', '抽离 15 个通用组件，团队复用率 60%，新页面开发工时下降约 40%'] }
        ] },
        { key: 'skill', title: '技术栈', text: 'HTML / CSS / JavaScript · TypeScript · Vue3 / React · Vite / Webpack · 熟悉性能优化与工程化' },
        { key: 'summary', title: '其他', text: 'GitHub / 技术博客 / 开源贡献请在此列出' }
      ]
    }
  },
  {
    key: '算法工程师',
    title: '算法岗简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘算法工程师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '北京'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '计算机 / 硕士', meta: '2025.09 - 2027.06' }
        ] },
        { key: 'proj', title: '研究与项目', items: [
          { primary: 'XX 推荐场景的 CTR 预估', secondary: '独立完成', meta: '2026.02 - 2026.06',
            bullets: ['从特征工程、模型选型到消融实验完整闭环，AUC 从 0.72 提升到 0.81', '完成模型部署与推理优化，线上 P99 延迟控制在 30ms 内'] }
        ] },
        { key: 'skill', title: '技能', text: 'Python / C++ · PyTorch · 熟悉特征工程、模型训练与部署 · 有 Kaggle / 天池名次或论文优先列出' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '运营',
    title: '运营岗简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘用户运营 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '广州'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '新闻传播 / 本科', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 活动运营', secondary: '执行负责人', meta: '2026.03 - 2026.08',
            bullets: ['策划并执行 X 活动，带动 DAU 提升 15%，获客成本下降 20%', '搭建 X 个社群、覆盖 Y 人，日均产出 Z 条内容，群内转化率 X%'] }
        ] },
        { key: 'skill', title: '技能与作品', text: '内容（选题 / 文案 / 排版 / 剪辑）· 用户（社群 / 分层 / 活动策划）· 数据（Excel / SQL 基础 / 看板）· 附作品集：____' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '通用',
    title: '通用简历模板（一页纸）',
    profile: {
      name: '你的名字',
      headline: '应聘岗位 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '城市'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '专业 / 学历', meta: '2023.09 - 2027.06', bullets: ['GPA / 排名 / 核心课程（若优秀才写）'] }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: '公司 / 项目名', secondary: '你的角色', meta: '2026.03 - 2026.08',
            bullets: ['【背景】一句话说清场景与难点', '【动作】你具体做了什么、用了什么方法', '【结果】量化结果，如「效率提升 60%」「成本下降 20 万」'] }
        ] },
        { key: 'skill', title: '技能与证书', text: '技能按熟练度分级，别轻易写「精通」；证书写清已通过科目与年份' },
        { key: 'summary', title: '自我评价', text: '用 STAR 写一段能讲 3 分钟的经历，比形容词更有说服力。控制在一页，导出 PDF 命名为「姓名-岗位-学校」。' }
      ]
    }
  },
  {
    key: '测试',
    title: '测试 / QA 简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘测试开发工程师（SDET）· 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '深圳'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '软件工程 / 本科', meta: '2023.09 - 2027.06', bullets: ['核心课程：软件测试、数据结构、计算机网络、数据库'] }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 电商 App 质量保障', secondary: '测试开发实习生', meta: '2026.03 - 2026.08',
            bullets: ['搭建 UI 自动化框架（pytest + Appium），覆盖核心交易链路 120+ 用例，回归耗时从 2 天降到 3 小时', '设计接口自动化（Postman + Python），冒烟转定时任务，漏测率下降 40%', '建立缺陷分级与复盘机制，推动修复 3 个高频崩溃，线上故障环比降 25%'] }
        ] },
        { key: 'skill', title: '技能', text: '功能 / 接口 / 性能 / 自动化测试体系 · Python / Java · pytest / Appium / JMeter / Postman · 缺陷管理（Jira）· 熟悉 CI/CD 与 Linux' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '客户端',
    title: '客户端开发简历模板（iOS / Android）',
    profile: {
      name: '你的名字',
      headline: '应聘客户端开发工程师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '北京'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '计算机 / 本科', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX App 端侧重构', secondary: '客户端开发', meta: '2026.03 - 2026.07',
            bullets: ['首页列表迁到自研复用组件，首屏白屏减少 30%', '接入图片懒加载与内存缓存，OOM 崩溃率从 0.8% 降到 0.15%', '封装统一路由与埋点，新功能接入工时下降约 35%'] },
          { primary: '跨端性能专项', secondary: '主要负责人', meta: '2025.10 - 2026.01',
            bullets: ['异步 + 防抖优化关键操作，帧率稳定 60fps', '包体积治理（资源压缩 + 无用 so 清理），APK 减小 18%'] }
        ] },
        { key: 'skill', title: '技术栈', text: 'Android（Kotlin / Java）· iOS（Swift / OC）· 熟悉渲染 / 线程 / 内存与启动优化 · 组件化与跨端（Flutter / Compose 可选）' },
        { key: 'summary', title: '其他', text: '有上架作品 / 开源 / 技术博客请列出并附链接' }
      ]
    }
  },
  {
    key: '游戏',
    title: '游戏客户端简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘游戏客户端开发 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '上海'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '数字媒体技术 / 软件工程', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'proj', title: '项目 / 实习经历', items: [
          { primary: 'XX 手游战斗系统', secondary: '客户端开发', meta: '2026.02 - 2026.07',
            bullets: ['用 Unity（C#）实现技能与帧同步，联机延迟从 120ms 优化到 60ms', '做对象池与合批，同屏 200 单位时帧率稳定 55fps 以上', '搭建热更新与资源加载管线，版本迭代效率提升 40%'] },
          { primary: '自研 Demo / GameJam', secondary: '独立开发', meta: '2025.07',
            bullets: ['48 小时独立完成一款解谜小游戏，入围校内 GameJam 决赛'] }
        ] },
        { key: 'skill', title: '技术栈', text: 'Unity（C#）· UE（C++ 可选）· 熟悉渲染 / 物理 / 动画 / 网络同步 · 图形学基础（Shader）· 性能 profiling' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '市场',
    title: '市场 / 商务（BD）简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘商务拓展（BD）· 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '广州'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '市场营销 / 国际经济与贸易', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 平台商家拓展', secondary: 'BD 实习生', meta: '2026.03 - 2026.08',
            bullets: ['独立拓展并签约 60+ 中小商家，季度新增 GMV 贡献 300 万', '搭建商家分层运营 SOP，重点客户续约率从 70% 提升到 88%', '策划行业沙龙 3 场，带来 25 个有效商机'] },
          { primary: '品牌联名活动', secondary: '执行负责人', meta: '2025.11',
            bullets: ['联动 5 个品牌做跨界营销，活动期间新增用户 12 万，ROI 1:4.2'] }
        ] },
        { key: 'skill', title: '技能与作品', text: '商务谈判 / 客户关系 / 行业研究 / 数据分析（Excel / SQL 基础）· 活动策划与项目管理 · 附案例集：____' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '人力',
    title: '人力资源（HR）简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘人力资源专员 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '杭州'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '人力资源管理 / 工商管理', meta: '2023.09 - 2027.06', bullets: ['核心课程：组织行为学、薪酬管理、劳动法、心理学'] }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 公司招聘模块', secondary: 'HR 实习生', meta: '2026.03 - 2026.08',
            bullets: ['独立负责技术岗全流程招聘，单月入职 18 人，平均到岗周期缩短 5 天', '搭建校招筛选漏斗，初筛通过率提升 20%', '运营内部推荐机制，内推占比从 15% 提升到 35%'] }
        ] },
        { key: 'skill', title: '技能', text: '招聘全流程 / 面试安排 / 薪酬绩效基础 / 劳动法合规 · 熟练使用 Moka / 北森等 ATS · Excel（数据透视）· 沟通与协调' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: 'UI',
    title: 'UI / UX 设计简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘 UI / UX 设计师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '成都'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '视觉传达 / 交互设计', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'proj', title: '项目 / 实习经历', items: [
          { primary: 'XX App 改版设计', secondary: 'UI 设计', meta: '2026.03 - 2026.07',
            bullets: ['主导信息架构与视觉规范重构，核心任务完成率提升 22%', '建立组件库（200+ 元件），设计到开发还原度达 95%', '可用性测试 8 场，关键路径操作时长降 30%'] }
        ] },
        { key: 'skill', title: '工具与作品', text: 'Figma / Sketch / Adobe 系列 · 设计规范 / 组件库 / 原型 / 可用性测试 · 作品集链接：____' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '运维',
    title: '运维 / SRE 简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘运维开发（SRE）· 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '南京'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '计算机 / 网络工程', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 平台稳定性建设', secondary: '运维开发实习生', meta: '2026.03 - 2026.08',
            bullets: ['搭建监控告警体系（Prometheus + Grafana），核心服务可用性从 99.5% 提升到 99.95%', '用 Ansible + Shell 自动化发布，发布耗时从 40 分钟降到 8 分钟', '定位缓存击穿雪崩根因，加熔断后同类故障零复发'] }
        ] },
        { key: 'skill', title: '技能', text: 'Linux / Shell / Python · K8s / Docker · Prometheus / Grafana / ELK · CI/CD（GitLab / Jenkins）· 网络与故障排查' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '数开',
    title: '数据开发（数仓）简历模板',
    profile: {
      name: '你的名字',
      headline: '应聘数据开发工程师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '武汉'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '数据科学 / 软件工程', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习 / 项目经历', items: [
          { primary: 'XX 公司数仓建设', secondary: '数据开发实习生', meta: '2026.03 - 2026.08',
            bullets: ['搭建用户域离线数仓（Hive + Spark），统一 30+ 数据源，取数效率提升 50%', '设计 DWS 汇总层，支撑 5 个业务线自助分析，报表开发工时降 40%', '做数据质量监控（唯一性 / 时效性），坏数率从 3% 降到 0.5%'] }
        ] },
        { key: 'skill', title: '技能', text: 'SQL（精通）· Hive / Spark / Flink · Kafka · Python · 维度建模（星型 / 雪花）· Airflow 调度' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '嵌入式',
    title: '嵌入式软件简历模板',
    desc: '嵌入式 / 物联网，突出驱动与实时性',
    profile: {
      name: '你的名字',
      headline: '应聘嵌入式软件工程师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '苏州'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '电子信息工程 / 自动化', meta: '2023.09 - 2027.06',
            bullets: ['核心课程：微机原理、嵌入式系统、数字电路、C 语言程序设计'] }
        ] },
        { key: 'proj', title: '项目经历', items: [
          { primary: 'XX 智能网关固件', secondary: '固件开发', meta: '2026.03 - 2026.07',
            bullets: ['基于 STM32 + FreeRTOS 实现多传感器采集与上报，采样周期抖动从 ±12ms 压到 ±2ms', '用 DMA + 环形缓冲重构串口驱动，CPU 占用从 46% 降到 18%', '设计 OTA 差分升级方案，升级包体积减少 65%，现场升级失败率为 0'] },
          { primary: '电赛 / 智能车竞赛', secondary: '主要负责人', meta: '2025.07',
            bullets: ['负责主控与 PID 调速，省赛一等奖'] }
        ] },
        { key: 'skill', title: '技能', text: 'C / C++ · STM32 / RT1052 · FreeRTOS · Linux 驱动基础 · 串口 / I2C / SPI / CAN · 示波器与逻辑分析仪 · 看懂原理图与 datasheet' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: 'AI应用',
    title: '大模型应用开发简历模板',
    desc: '大模型应用 / Agent，突出落地效果',
    profile: {
      name: '你的名字',
      headline: '应聘大模型应用开发工程师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '北京'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '计算机科学与技术 / 本科', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'proj', title: '项目经历', items: [
          { primary: 'XX 企业知识库问答', secondary: '主要负责人', meta: '2026.02 - 2026.07',
            bullets: ['搭建 RAG 检索链路（切片 + 向量召回 + 重排），答案命中率从 61% 提升到 87%', '设计多轮 Agent 流程（工具调用 + 结果校验），人工转接率下降 34%', '接入缓存与流式输出，首字延迟从 2.4s 降到 0.8s，单位调用成本下降 40%'] },
          { primary: '提示词与评测体系', secondary: '独立完成', meta: '2025.11',
            bullets: ['建立 200 条评测集与自动打分脚本，每次改动的回归时间从 1 天缩短到 20 分钟'] }
        ] },
        { key: 'skill', title: '技能', text: 'Python · LangChain / LlamaIndex · 向量库（Milvus / FAISS）· Prompt 工程与评测 · 大模型微调基础（LoRA）· Docker / FastAPI' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '供应链',
    title: '供应链 / 物流简历模板',
    desc: '供应链 / 物流，突出成本与交付',
    profile: {
      name: '你的名字',
      headline: '应聘供应链管理培训生 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '宁波'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '物流管理 / 工业工程', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'intern', title: '实习经历', items: [
          { primary: 'XX 制造企业', secondary: '供应链实习生', meta: '2026.03 - 2026.08',
            bullets: ['梳理 12 家供应商交期数据，推动安全库存重设，缺料停线次数下降 45%', '参与采购降本项目，比价与谈判覆盖 30 个料号，年度节约 XX 万元', '搭建到货及时率看板，到货及时率从 82% 提升到 94%'] }
        ] },
        { key: 'skill', title: '技能', text: 'ERP / WMS 操作 · Excel（透视表 / VLOOKUP）· SQL 基础 · 需求预测与库存模型基础 · 供应商管理' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '机械',
    title: '机械 / 制造简历模板',
    desc: '机械 / 制造，突出结构与工艺',
    profile: {
      name: '你的名字',
      headline: '应聘机械设计工程师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '重庆'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '机械设计制造及其自动化 / 本科', meta: '2023.09 - 2027.06' }
        ] },
        { key: 'proj', title: '项目经历', items: [
          { primary: 'XX 自动化装配线夹具设计', secondary: '结构设计', meta: '2026.03 - 2026.06',
            bullets: ['用 SolidWorks 完成 3 套夹具设计并出工程图，装配节拍从 45s 缩短到 32s', '做有限元静力校核，关键件最大应力下降 28%，样机一次通过寿命测试'] }
        ] },
        { key: 'skill', title: '技能', text: 'SolidWorks / AutoCAD / ANSYS · 公差与互换性 · 机械原理与材料力学 · 看懂工艺文件 · 车铣基础操作' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '法务',
    title: '法务简历模板',
    desc: '法务，突出合同与合规',
    profile: {
      name: '你的名字',
      headline: '应聘法务专员 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '上海'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '法学 / 本科', meta: '2023.09 - 2027.06',
            bullets: ['已通过法律职业资格考试（客观题 / 主观题：____）· 核心课程：合同法、公司法、劳动法'] }
        ] },
        { key: 'intern', title: '实习经历', items: [
          { primary: 'XX 律所 / 公司法务部', secondary: '法务实习生', meta: '2026.03 - 2026.08',
            bullets: ['独立审核各类合同 180+ 份，形成常用条款风险清单，平均审核时长缩短 40%', '参与 2 起劳动争议应诉，负责证据整理与答辩提纲，均以调解结案', '梳理个人信息合规要点，输出内部合规手册并被采用'] }
        ] },
        { key: 'skill', title: '技能', text: '合同审核 / 法律检索（威科 / 北大法宝）· 公司法与劳动法实务 · 法律文书写作 · CET-6 · 法律职业资格证' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  },
  {
    key: '教师',
    title: '教师 / 教育培训简历模板',
    desc: '教师 / 教育培训，突出教学成果',
    profile: {
      name: '你的名字',
      headline: '应聘中学教师 · 2027 届',
      contacts: ['138-0000-0000', 'name@example.com', '长沙'],
      sections: [
        { key: 'edu', title: '教育背景', items: [
          { primary: 'XX 大学', secondary: '学科教学 / 汉语言文学（师范）', meta: '2023.09 - 2027.06',
            bullets: ['已取得教师资格证（____学科）· 普通话二级甲等'] }
        ] },
        { key: 'intern', title: '实习 / 实践经历', items: [
          { primary: 'XX 中学教育实习', secondary: '实习教师 + 班主任助理', meta: '2026.03 - 2026.06',
            bullets: ['承担 2 个班共 96 人的授课，期末班级平均分提升 8.5 分，及格率提升 12pt', '设计分层作业方案，学困生作业完成率从 68% 提升到 91%', '组织主题班会 6 次，家长满意度问卷好评率 95%'] }
        ] },
        { key: 'skill', title: '技能', text: '教学设计 / 课件制作（PPT / 希沃）· 班级管理 · 普通话二级甲等 · 教师资格证 · 基础数据分析（成绩跟踪）' },
        { key: 'summary', title: '自我评价', text: PLACEHOLDER }
      ]
    }
  }
];

/* ==================== 模板分组（样式与内容解耦：分组只影响展示顺序） ==================== */

/** 分组注册表：新增模板只要把 key 写进某一组就会出现在对应分类下 */
export const TEMPLATE_GROUPS: { key: string; name: string; keys: string[] }[] = [
  { key: 'tech', name: '技术岗', keys: ['后端开发', '前端开发', '算法工程师', '客户端', '游戏', '测试', '运维', '数开', '嵌入式', 'AI应用'] },
  { key: 'pmops', name: '产品 / 运营 / 市场', keys: ['产品经理', '运营', '市场'] },
  { key: 'data', name: '数据 / 分析', keys: ['数据分析'] },
  { key: 'func', name: '职能 / 其他', keys: ['财务', '人力', '法务', '供应链', '机械', '教师'] },
  { key: 'design', name: '设计', keys: ['UI'] },
  { key: 'general', name: '通用', keys: ['通用'] }
];

/** 模板一句话定位（模板卡副标题；缺则只在卡片上显示标题） */
export const TEMPLATE_DESC: Record<string, string> = {
  财务: '财务分析 / FP&A，突出报表与预算',
  后端开发: 'Java / Go 后端，突出高并发与系统',
  产品经理: '产品经理，突出需求与增长',
  数据分析: '数据分析，突出指标与实验',
  前端开发: '前端工程化与性能优化',
  算法工程师: '算法 / 机器学习，突出模型与效果',
  运营: '用户 / 活动运营，突出增长数据',
  通用: '一页纸通用骨架，任何岗位都能套',
  测试: '测试开发 SDET，突出自动化体系',
  客户端: 'iOS / Android 客户端，突出性能',
  游戏: '游戏客户端，突出引擎与帧率',
  市场: '市场 / 商务 BD，突出拓展业绩',
  人力: 'HR，突出招聘交付与效率',
  UI: 'UI / UX，突出作品集与规范',
  运维: '运维 / SRE，突出稳定性建设',
  数开: '数仓 / 数据开发，突出建模与质量',
  嵌入式: '嵌入式软件，突出驱动与实时性',
  AI应用: '大模型应用 / Agent，突出落地效果',
  供应链: '供应链 / 物流，突出成本与交付',
  机械: '机械 / 制造，突出结构与工艺',
  法务: '法务，突出合同与合规',
  教师: '教师 / 教育培训，突出教学成果'
};

/** 按岗位分类取模板；认不出时回退「通用」骨架（兜底必须是最通用的那份） */
export function templateByCategory(cat: string): ResumeTemplate {
  const t = RESUME_TEMPLATES.find((x) => x.key === cat);
  if (t) return t;
  const general = RESUME_TEMPLATES.find((x) => x.key === '通用');
  return general || RESUME_TEMPLATES[RESUME_TEMPLATES.length - 1];
}
