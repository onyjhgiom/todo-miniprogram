// subpackages/photowall/utils/pw-types.ts
// 照片墙：数据结构定义
//
// 设计要点：
//  - 作品（PWWork）是「可完整重建一张图」的最小闭包：形状 + 照片 + 排列参数 + 样式。
//    只要这几个字段在，就能在任何一台设备上重绘出一模一样的照片墙。
//  - slots 是「排列点位」的快照。生成后随作品一起保存 —— 用户手动微调过某张照片后，
//    下次打开不会因为重新计算点位而让照片跑回去（这是拼图类功能最常见的翻车点）。

/** 归一化坐标点：x / y ∈ [0,1]，相对画布内容区左上角 */
export interface Pt {
  x: number;
  y: number;
}

/** 单张照片 */
export interface PWPhoto {
  id: string;
  /** 图片路径（本地临时路径 / 永久路径 / 云文件 ID） */
  src: string;
  /** 手动位移（归一化，相对 slot 点位） */
  dx: number;
  dy: number;
  /** 缩放系数，1 = 跟随自动尺寸 */
  scale: number;
  /** 旋转弧度 */
  rot: number;
  flipH: boolean;
  flipV: boolean;
  /** 透明度 0.2 ~ 1 */
  opacity: number;
  /** 层级（越大越靠上） */
  z: number;
}

/** 排列参数 */
export interface PWArrange {
  /** 抖动 0 ~ 1：让排列更自然，0 = 严格网格 */
  jitter: number;
  /** 密度 0.6 ~ 1.6：越大点位越密（点位数量随之变化） */
  density: number;
  /** 整体缩放 0.6 ~ 1.4 */
  scale: number;
  /** 整体旋转角度（度） */
  rotate: number;
  /** 单张照片尺寸系数 0.5 ~ 1.5 */
  photoSize: number;
  /** 随机种子：同一 seed + 同一参数 = 同一结果（撤销/重做与重排可复现） */
  seed: number;
}

/** 装饰元素 */
export interface PWDecor {
  id: string;
  kind: 'sticker' | 'text';
  /** sticker 为 emoji/符号，text 为文字内容 */
  value: string;
  /** 归一化位置（画布） */
  x: number;
  y: number;
  /** 字号 / 贴纸尺寸：相对画布宽度的比例 */
  size: number;
  color: string;
  /** 旋转（度） */
  rot: number;
}

/** 样式设置 */
export interface PWStyle {
  /** 画布比例：'1:1' | '4:3' | '3:4' | '9:16' | '16:9' | 'custom' */
  ratio: string;
  /** 自定义比例宽高（ratio === 'custom' 时生效） */
  customW: number;
  customH: number;
  /** 背景色 */
  bg: string;
  /** 背景图路径（空 = 纯色） */
  bgImage: string;
  /** 内边距：占画布短边的比例 0 ~ 0.15 */
  padding: number;
  /** 照片间距：占单张照片边长的比例 0 ~ 0.3 */
  gap: number;
  /** 圆角：占单张照片边长的比例 0 ~ 0.5 */
  radius: number;
  /** 边框宽度（相对画布宽度，0 ~ 0.02） */
  borderW: number;
  borderColor: string;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  /** 滤镜：none / bw / warm / cool / retro / film / fresh / dream */
  filter: string;
  /** 照片整体透明度 0.5 ~ 1 */
  alpha: number;
  /** 主题模板 id */
  theme: string;
  decor: PWDecor[];
}

/** 作品 */
export interface PWWork {
  id: string;
  title: string;
  /** 形状 id（内置形状）或 'text' / 'mask' */
  shapeId: string;
  shapeName: string;
  shapeKind: 'analytic' | 'text' | 'mask';
  /** 文字形状的文本（多行用 \n） */
  shapeText: string;
  /** 自定义蒙版图片路径 */
  shapeMask: string;
  /** 蒙版密度（自定义形状可调） */
  maskDensity: number;
  photos: PWPhoto[];
  arrange: PWArrange;
  style: PWStyle;
  /**
   * 排列点位快照（归一化）。
   * **默认（铺满关闭）时长度严格等于照片数**，slots[i] ↔ photos[i] 一一对应，
   * 每张照片在画面上只出现一次、绝不重复。
   * 只有铺满模式（autofill = true）下才允许多于照片数，由渲染层按下标循环复用。
   */
  slots: Pt[];
  /**
   * 铺满模式（默认 false）。
   * false = 一张照片一格，每张只用一次（默认，绝不出现重复内容）；
   * true  = 照片不足形状建议张数时多排几格、循环复用照片把形状填满 ——
   *         形状更完整，但同一张照片会出现多次。
   */
  autofill: boolean;
  /**
   * 单张照片边长（归一化，相对内容区）。
   * 必须随作品保存：预览、封面、导出三处都靠它算出同一个尺寸，
   * 否则会出现「预览看着正好、导出后照片互相压住」。
   */
  cell: number;
  /**
   * 固定模板张数（algo ≥ 4 的作品必有）。
   * 编辑器强制 photos.length === tplCount 才允许完成；
   * 旧作品（algo < 4）没有这个字段，重排时走 legacy 自适应路径。
   */
  tplCount?: number;
  /**
   * 填充风格（solid / ring / fade）。缺省 = 用形状的推荐风格。
   * 张数随风格变化（ring 会挖掉内部格），所以切换风格后要重排并重新核对张数。
   */
  fill?: PWFillMode;
  /** true = 草稿 */
  draft: boolean;
  favorite: boolean;
  note: string;
  /** 封面缩略图（导出的临时/永久路径） */
  cover: string;
  /** 排点算法版本（用于旧作品自愈，见 pw-store 的 migrate） */
  algo: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 排点算法版本。
 * 1 = 初版（少量照片时「周长重复计数」导致边长翻倍、照片糊成一团）
 * 2 = 弧长等距轮廓采样 + 最近邻边长 + 智能填充（slots 可多于照片数）
 * 3 = 默认「一张照片一格」（点位 == 照片数，绝不重复）+ 形状特征点相位对齐 + 近重合点分离
 * 4 = **固定模板模式**（参考图样式）：每种形状一个固定的网格模板 —— 所有照片都是
 *     统一尺寸的正方形、严格网格对齐、实心无缝；每种形状的模板张数固定
 *     （编辑器强制照片数 == 模板张数才允许完成）。旧作品（algo < 4 或无 tplCount）
 *     重排时走 legacy 自适应路径，不影响已有排布。
 * 5 = **修正模板朝向**：算法 4 把模板矩阵的行号当成数学坐标（y 向上）又翻转了一次，
 *     导致**所有模板形状上下颠倒**（心形两瓣朝下、三角形尖朝上）。
 *     现在统一约定「矩阵第 0 行 = 画面顶行」，两条派生路径（手工模板 / 自动栅格化）一致。
 *     migrate 会把算法 4 的模板作品按新规则重算，修回正确朝向。
 * 6 = **填充风格**：形状不再一律实心 —— 按形状语义分为实心 / 描边（挖空内部）/
 *     渐变（内侧半透明），张数随风格变化（描边会减少格数）。作品可覆盖形状默认值。
 * 版本不一致的作品在 loadWork 时会用当前算法重算点位，避免旧数据继续显示错误排布
 * （算法 1/2 的作品默认是「铺满、循环复用照片」，也会在这一步收敛到不重复）。
 */
export const PW_ALGO = 6;

/**
 * 固定网格模板：一个形状的「像素画」。
 * cells 行优先存储（j 从上到下），true = 该格放一张照片。
 * 同一形状永远派生出同一个模板 → 张数、排布完全确定。
 */
export interface PWTemplateGrid {
  /** 裁剪后的列数 / 行数（去掉四周全空的行和列） */
  cols: number;
  rows: number;
  /** 固定张数 = 格子数，编辑器据此强制照片数量 */
  count: number;
  cells: boolean[];
}

/** 形状分类 */
export type ShapeCat = 'basic' | 'letter' | 'number' | 'text' | 'festival' | 'couple' | 'family' | 'custom';

/** 栅格化蒙版 */
export interface PWMask {
  w: number;
  h: number;
  /** 0 = 透明（形状外），1 = 不透明（形状内） */
  data: Uint8Array;
}

/** 形状度量（都归一化到内容区 [0,1]²） */
export interface ShapeMetrics {
  /** 形状面积占内容区面积的比例 */
  area: number;
  /** 形状周长 */
  perim: number;
  /** 能「实心填满」所需的最少贴片数 = P²/(2A)：再少就只能描出轮廓、中间填不满 */
  solidMin: number;
  /** 轮廓候选点（铺点算法内部用，顺序无意义） */
  edges: { x: number; y: number }[];
}

/**
 * 填充风格：决定一个形状「铺多少、怎么铺」。
 * 统一的三档，全形状共用同一套含义，避免每个形状各有一套观感：
 *   · solid 实心 —— 所有格子都放照片，形状最饱满（块面型形状：心形/方形/圆形…）
 *   · ring  描边 —— 只留形状边界那一圈格子，内部挖空（线型/分支型形状：
 *                   五角星/雪花/情侣剪影…，实心会把细枝糊成一坨）
 *   · fade  渐变 —— 格子不删（张数不变），但照片透明度按「到中心的距离」递增：
 *                   外圈 100% → 中心 55%，形状轮廓实、内部透气（精细形状：锁/文字/自定义蒙版）
 */
export type PWFillMode = 'solid' | 'ring' | 'fade';

/** 填充风格档位（编辑器 UI 用） */
export const FILL_MODES: { key: PWFillMode; label: string; desc: string }[] = [
  { key: 'solid', label: '实心', desc: '所有格子都放照片，形状最饱满' },
  { key: 'ring', label: '描边', desc: '只留边界一圈，内部留白，轮廓更清晰' },
  { key: 'fade', label: '渐变', desc: '张数不变，内侧照片半透明，形状更透气' }
];

/** 形状定义 */
export interface ShapeDef {
  id: string;
  name: string;
  cat: ShapeCat;
  /** 列表展示的 emoji */
  icon: string;
  /** 解析形状：判定点 (x,y) ∈ [-1,1]² 是否在形状内（y 轴向上） */
  test?: (x: number, y: number) => boolean;
  /** 栅格形状标记 */
  kind: 'analytic' | 'text' | 'mask';
  /** kind='text' 时的文本内容（多行用 \n） */
  text?: string;
  /** kind='mask' 时的蒙版图片路径 */
  maskPath?: string;
  /** 建议照片数 */
  suggest: number;
  /** 缓存的栅格结果（kind !== 'analytic' 时运行时填充） */
  mask?: PWMask;
  /** 缓存的归一化判定函数（运行时填充，避免每次重排都重新采样求包围盒） */
  ntest?: (x: number, y: number) => boolean;
  /**
   * 手工精修的网格模板（'█'/'X'/'#' = 放照片，'·'/'.' = 空）。
   * 只给栅格化观感差的旗舰形状用（心形 / 三角形 / 五角星）；
   * 有这个字段时 templateOf 直接采用，不再自动栅格化。
   */
  gridMask?: string[];
  /** 该形状推荐的填充风格（作品未指定时用它；见 PWFillMode） */
  fill?: PWFillMode;
  /** 形状度量缓存（面积 / 周长），首次 layout 时算好，之后直接复用 */
  metrics?: ShapeMetrics;
  /** 固定网格模板缓存（首次 templateOf 时派生；同一形状张数与排布永远一致） */
  tpl?: PWTemplateGrid | null;
}

/** 编辑器步骤 */
export type PWStep = 'shape' | 'photos' | 'arrange' | 'edit' | 'style' | 'export';

/** 列表 Tab */
export type PWTab = 'works' | 'drafts' | 'favs';

/** 导出分辨率档位 */
export interface ExportSize {
  label: string;
  px: number;
}

export const EXPORT_SIZES: ExportSize[] = [
  { label: '1080 · 标准', px: 1080 },
  { label: '1440 · 高清', px: 1440 },
  { label: '2160 · 超清', px: 2160 }
];

/** 画布比例档位 */
export const RATIO_OPTIONS: { label: string; value: string; w: number; h: number }[] = [
  { label: '1:1', value: '1:1', w: 1, h: 1 },
  { label: '4:3', value: '4:3', w: 4, h: 3 },
  { label: '3:4', value: '3:4', w: 3, h: 4 },
  { label: '9:16', value: '9:16', w: 9, h: 16 },
  { label: '16:9', value: '16:9', w: 16, h: 9 }
];

/** 滤镜档位 */
export const FILTER_OPTIONS: { label: string; value: string }[] = [
  { label: '原图', value: 'none' },
  { label: '黑白', value: 'bw' },
  { label: '暖色', value: 'warm' },
  { label: '冷色', value: 'cool' },
  { label: '复古', value: 'retro' },
  { label: '胶片', value: 'film' },
  { label: '清新', value: 'fresh' },
  { label: '梦幻', value: 'dream' }
];

/** 主题模板：一键套用一组样式 */
export interface PWTheme {
  id: string;
  name: string;
  bg: string;
  borderColor: string;
  borderW: number;
  radius: number;
  shadow: boolean;
  shadowColor: string;
  filter: string;
  gap: number;
}

export const PW_THEMES: PWTheme[] = [
  { id: 'classic', name: '经典', bg: '#FFFFFF', borderColor: '#FFFFFF', borderW: 0.008, radius: 0.04, shadow: true, shadowColor: 'rgba(0,0,0,0.25)', filter: 'none', gap: 0.06 },
  { id: 'romance', name: '浪漫', bg: '#FFF1F4', borderColor: '#FFFFFF', borderW: 0.012, radius: 0.5, shadow: true, shadowColor: 'rgba(233,90,122,0.35)', filter: 'warm', gap: 0.05 },
  { id: 'retro', name: '复古', bg: '#E8DCC4', borderColor: '#F5EFE0', borderW: 0.014, radius: 0.06, shadow: true, shadowColor: 'rgba(90,66,40,0.3)', filter: 'retro', gap: 0.09 },
  { id: 'minimal', name: '极简', bg: '#FAFAF8', borderColor: '#FFFFFF', borderW: 0, radius: 0.02, shadow: false, shadowColor: 'rgba(0,0,0,0.2)', filter: 'none', gap: 0.16 },
  { id: 'festive', name: '节日', bg: '#0E5A3C', borderColor: '#F5D16B', borderW: 0.01, radius: 0.08, shadow: true, shadowColor: 'rgba(0,0,0,0.4)', filter: 'none', gap: 0.04 },
  { id: 'couple', name: '情侣', bg: '#FFE9EE', borderColor: '#FF9BB3', borderW: 0.01, radius: 0.35, shadow: true, shadowColor: 'rgba(255,120,150,0.35)', filter: 'dream', gap: 0.05 },
  { id: 'family', name: '家庭', bg: '#F7EFE3', borderColor: '#C9A87C', borderW: 0.009, radius: 0.1, shadow: true, shadowColor: 'rgba(120,90,60,0.28)', filter: 'warm', gap: 0.07 }
];

/** 贴纸候选 */
export const STICKERS: string[] = ['❤️', '⭐', '🌸', '🦋', '🎈', '🎀', '✨', '🌙', '🍀', '🎁', '💌', '☁️'];

/** 新建默认排列参数 */
export function defaultArrange(): PWArrange {
  return { jitter: 0.25, density: 1, scale: 1, rotate: 0, photoSize: 1, seed: Math.floor(Math.random() * 100000) };
}

/** 新建默认样式 */
export function defaultStyle(): PWStyle {
  const t = PW_THEMES[0];
  return {
    ratio: '1:1',
    customW: 1,
    customH: 1,
    bg: t.bg,
    bgImage: '',
    padding: 0.06,
    gap: t.gap,
    radius: t.radius,
    borderW: t.borderW,
    borderColor: t.borderColor,
    shadow: t.shadow,
    shadowColor: t.shadowColor,
    shadowBlur: 12,
    filter: t.filter,
    alpha: 1,
    theme: t.id,
    decor: []
  };
}

/** 新建默认照片条目 */
export function newPhoto(src: string): PWPhoto {
  return {
    id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
    src,
    dx: 0,
    dy: 0,
    scale: 1,
    rot: 0,
    flipH: false,
    flipV: false,
    opacity: 1,
    z: 0
  };
}

/** 新建空作品 */
export function newWork(): PWWork {
  const now = Date.now();
  return {
    id: 'w' + now.toString(36) + Math.floor(Math.random() * 1000).toString(36),
    title: '我的照片墙',
    shapeId: 'heart',
    shapeName: '心形',
    shapeKind: 'analytic',
    shapeText: '',
    shapeMask: '',
    maskDensity: 1,
    photos: [],
    arrange: defaultArrange(),
    style: defaultStyle(),
    slots: [],
    // 默认「一张照片一格」：每张照片只出现一次，绝不重复
    autofill: false,
    cell: 0.12,
    draft: true,
    favorite: false,
    note: '',
    cover: '',
    algo: PW_ALGO,
    createdAt: now,
    updatedAt: now
  };
}
