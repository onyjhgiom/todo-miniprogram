// subpackages/photowall/pages/editor/editor.ts
// 照片墙：编辑器（选形状 → 传图 → 排列 → 调整 → 样式 → 导出）
//
// ── 为什么整套流程放在一个页面 ────────────────────────────────
// 六步之间共享「画布 + 作品数据」，拆成六个页面意味着每步都要重新加载图片、重排点位，
// 既慢又容易在返回时丢状态。这里用「步骤条切换底部面板」的方式，画布始终可见，
// 每一步改动立刻反映到画布上 —— 也符合需求里「实时预览」的要求。
//
// ── 性能约定 ──────────────────────────────────────────────────
// · work 只存在 this 上，不进 data：100 张照片的路径放进 setData 会明显掉帧；
// · 画布重绘统一走 redraw()，内部 120ms 节流，滑块连续拖动不会画爆；
// · 图片解码结果由 pw-render 的 IMG_POOL 缓存，重绘不重复解码。

import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { go, back, backAfter } from '../../../../utils/nav';
import type { ThemeKey } from '../../../../types/index';
import type { PWWork, PWPhoto, PWStep, PWDecor, Pt, PWFillMode } from '../../utils/pw-types';
import { PW_THEMES, FILTER_OPTIONS, RATIO_OPTIONS, STICKERS, FILL_MODES, newPhoto, newWork } from '../../utils/pw-types';
import { getShape, ensureShape, layout, makeTextShape, makeMaskShape, templateFor, fillModeOf } from '../../utils/pw-shapes';
import { PICK_PER_BATCH, CHAT_PICK_MAX, batchRounds } from '../../utils/pw-batch';
import type { ShapeDef } from '../../utils/pw-types';
import { paintWork, exportWork, getImage, setHostCanvas } from '../../utils/pw-render';
import type { PaintLayout } from '../../utils/pw-render';
import {
  loadWork, saveWork, persistPhotos, takePendingShape, pushRecentShape
} from '../../utils/pw-store';

/** 最多照片数（需求：100 张） */
const MAX_PHOTOS = 100;
/** 铺满模式下最多生成多少张贴片（贴片只是复用照片，不占存储，但要控制单帧绘制量） */
const MAX_TILES = 150;
/** 重绘节流间隔 */
const REDRAW_MS = 120;

interface PhotoVM {
  id: string;
  src: string;
  sel: boolean;
}

interface EditorData {
  theme: ThemeKey;
  themeStyle: string;
  steps: { key: PWStep; label: string }[];
  stepIdx: number;
  step: PWStep;
  canvasW: number;
  canvasH: number;
  shapeName: string;
  shapeIcon: string;
  shapeSuggest: number;
  /**
   * 固定模板张数（>0 = 该形状有固定模板）。
   * 照片数必须正好等于它才能组成完整图形；0 = 旧作品走自由张数。
   */
  needCount: number;
  /** 还差多少张（needCount - 已传，最小 0）：未凑齐时不允许生成 */
  needGap: number;
  /** 当前填充风格（solid / ring / fade），缺省取形状推荐值 */
  fillMode: string;
  /** 填充风格档位（实心 / 描边 / 渐变） */
  fillModes: { key: string; label: string; desc: string }[];
  photos: PhotoVM[];
  photoCount: number;
  /** 铺满模式：照片不足时重复使用照片把形状填满（默认关闭 → 每张照片只用一次） */
  autofill: boolean;
  /** 当前实际贴片数（铺满模式下会大于照片数，默认等于照片数） */
  tileCount: number;
  arrange: { jitter: number; density: number; scale: number; rotate: number; photoSize: number };
  style: {
    ratio: string; bg: string; bgImage: string; padding: number; gap: number;
    radius: number; borderW: number; borderColor: string; shadow: boolean;
    shadowColor: string; shadowBlur: number; filter: string; alpha: number; theme: string;
  };
  ratios: { label: string; value: string }[];
  themes: { id: string; name: string }[];
  filters: { label: string; value: string }[];
  stickers: string[];
  decors: PWDecor[];
  /** 当前选中的照片序号（-1 未选中） */
  selIndex: number;
  /** 当前选中的装饰序号 */
  selDecor: number;
  /** 色板 */
  swatches: string[];
  exporting: boolean;
  exportPath: string;
  exportPx: number;
  exportType: string;
  title: string;
  /** 提示文案（如「再上传 12 张效果更好」） */
  hint: string;
  loading: boolean;
}

const STEPS: { key: PWStep; label: string }[] = [
  { key: 'shape', label: '选形状' },
  { key: 'photos', label: '传图片' },
  { key: 'arrange', label: '自动排' },
  { key: 'edit', label: '调位置' },
  { key: 'style', label: '设样式' },
  { key: 'export', label: '导出' }
];

const SWATCHES = [
  '#FFFFFF', '#FFF1F4', '#F7EFE3', '#E8DCC4', '#F2F6F2', '#EAF0F7',
  '#0E5A3C', '#2B2B33', '#35302A', '#FFE9EE', '#E9F2EC', '#1F3A5F'
];

Page<EditorData>({
  data: {
    theme: 'light',
    themeStyle: '',
    steps: STEPS,
    stepIdx: 0,
    step: 'shape',
    canvasW: 300,
    canvasH: 300,
    shapeName: '心形',
    shapeIcon: '❤️',
    shapeSuggest: 40,
    // 默认心形有固定模板（34 张）—— prepareShape 里按实际形状刷新
    needCount: 34,
    needGap: 34,
    fillMode: 'solid',
    fillModes: FILL_MODES as unknown as { key: string; label: string; desc: string }[],
    photos: [],
    photoCount: 0,
    // 默认关闭铺满：一张照片一格，每张照片只出现一次（不重复）
    autofill: false,
    tileCount: 0,
    arrange: { jitter: 25, density: 100, scale: 100, rotate: 180, photoSize: 100 },
    style: {
      ratio: '1:1', bg: '#FFFFFF', bgImage: '', padding: 6, gap: 6,
      radius: 4, borderW: 8, borderColor: '#FFFFFF', shadow: true,
      shadowColor: 'rgba(0,0,0,0.25)', shadowBlur: 12, filter: 'none', alpha: 100, theme: 'classic'
    },
    ratios: RATIO_OPTIONS.map((r) => ({ label: r.label, value: r.value })),
    themes: PW_THEMES.map((t) => ({ id: t.id, name: t.name })),
    filters: FILTER_OPTIONS,
    stickers: STICKERS,
    decors: [],
    selIndex: -1,
    selDecor: -1,
    swatches: SWATCHES,
    exporting: false,
    exportPath: '',
    exportPx: 1080,
    exportType: 'jpg',
    title: '我的照片墙',
    hint: '',
    loading: false
  },

  /* ==================== 非响应式状态 ==================== */
  work: null as PWWork | null,
  shapeDef: null as ShapeDef | null,
  canvas: null as WechatMiniprogram.Canvas | null,
  lay: null as PaintLayout | null,
  dpr: 2,
  rect: { left: 0, top: 0 } as { left: number; top: number },
  _redrawTimer: 0,
  _saving: false,
  _touch: null as null | {
    mode: 'photo' | 'decor' | 'pinch';
    index: number;
    sx: number; sy: number;
    /** 双指初始距离与角度 */
    dist: number; ang: number;
    baseScale: number; baseRot: number;
    baseDx: number; baseDy: number;
  },

  onLoad(q: Record<string, string>) {
    this.applyTheme();
    const winW = this.windowWidth();
    this.setData({ canvasW: winW - 32 });

    if (q.id) {
      const w = loadWork(q.id);
      if (w) this.work = w;
    }
    if (!this.work) {
      this.work = newWork();
      // 支持从列表页推荐模板 / 形状库直达：?shape=heart
      this.applyShapeId(q.shape || 'heart');
    } else {
      // 编辑已有作品：形状对象不会跟着数据一起持久化，要按作品里存的种类现场重建，
      // 否则改「轮廓密度」这类需要重算点位的参数时会因为没有形状而静默失效。
      this.restoreShape();
    }
    if (q.step === 'export') this.setData({ stepIdx: 5, step: 'export' });
    this.syncFromWork();
  },

  onReady() {
    this.initCanvas();
  },

  onShow() {
    this.applyTheme();
    // 从形状库选完回来：取走暂存的形状
    const picked = takePendingShape();
    if (picked) {
      this.applyPickedShape(picked.id, picked.name, picked.kind, picked.text, picked.maskPath, picked.icon);
      return;
    }
    // 兜底：首次 onReady 早于 onShow 时画布还没准备好
    if (!this.canvas) this.initCanvas();
  },

  onUnload() {
    if (this._redrawTimer) clearTimeout(this._redrawTimer);
    // 离开编辑器自动存草稿，避免误退出丢内容
    if (this.work && (this.work.photos || []).length) this.persist(true);
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle });
    syncNavBar(s);
  },

  windowWidth(): number {
    try {
      if (wx.getWindowInfo) return wx.getWindowInfo().windowWidth || 375;
    } catch (e) { /* 忽略 */ }
    try {
      return wx.getSystemInfoSync().windowWidth || 375;
    } catch (e) {
      return 375;
    }
  },

  /* ==================== 数据同步 ==================== */

  /** work → data（只搬 UI 需要的字段，避免整包 setData） */
  syncFromWork() {
    const w = this.work;
    if (!w) return;
    const a = w.arrange;
    const st = w.style;
    this.setData({
      title: w.title,
      shapeName: w.shapeName,
      photos: (w.photos || []).map((p) => ({ id: p.id, src: p.src, sel: false })),
      photoCount: (w.photos || []).length,
      autofill: w.autofill === true,
      tileCount: (w.slots || []).length,
      arrange: {
        jitter: Math.round(a.jitter * 100),
        density: Math.round(a.density * 100),
        scale: Math.round(a.scale * 100),
        rotate: Math.round(a.rotate) + 180,
        photoSize: Math.round(a.photoSize * 100)
      },
      style: {
        ratio: st.ratio,
        bg: st.bg,
        bgImage: st.bgImage,
        padding: Math.round(st.padding * 100),
        gap: Math.round(st.gap * 100),
        radius: Math.round(st.radius * 100),
        borderW: Math.round(st.borderW * 1000),
        borderColor: st.borderColor,
        shadow: st.shadow,
        shadowColor: st.shadowColor,
        shadowBlur: st.shadowBlur,
        filter: st.filter,
        alpha: Math.round(st.alpha * 100),
        theme: st.theme
      },
      decors: st.decor || []
    });
    this.updateCanvasSize();
    this.updateHint();
  },

  updateHint() {
    const n = (this.work && this.work.photos ? this.work.photos.length : 0);
    const need = this.data.needCount || 0;
    const fill = this.work ? this.work.autofill === true : false;
    const tiles = (this.work && this.work.slots ? this.work.slots.length : 0);
    let hint = '';
    if (need > 0) {
      // 固定模板：张数必须正好，达到后才算「组成完整图形」
      const styleName = this.data.fillMode === 'ring' ? '描边' : this.data.fillMode === 'fade' ? '渐变' : '实心';
      if (n === 0) hint = `${styleName}风格需要正好 ${need} 张照片，达到数量后自动组成完整图形`;
      else if (n < need) hint = `已传 ${n}/${need} 张 · 还差 ${need - n} 张才能组成完整图形`;
      else if (n === need) hint = `已传 ${n} 张 · 正好组成完整${this.data.shapeName || '图形'}（${styleName}风格），每张照片只用一次`;
      else hint = `已传 ${n} 张 · 该图形需要正好 ${need} 张，请删除 ${n - need} 张`;
    } else if (n === 0) hint = '还没有照片，下一步去添加';
    else if (n === 1) hint = '只有 1 张：会居中显示，建议多传几张';
    else if (fill) {
      hint = `已传 ${n} 张 · 铺满 ${tiles} 格（会重复使用照片），形状更完整`;
    } else if (n < (this.data.shapeSuggest || 40) * 0.6) {
      hint = `已传 ${n} 张 · 每张只用一次，共 ${tiles} 格。照片越多形状越清晰（建议 ${this.data.shapeSuggest || 40} 张）`;
    } else if (n > (this.data.shapeSuggest || 40) * 2.2) {
      hint = `已传 ${n} 张 · 每张只用一次。照片较多时可调低「轮廓密度」让排布更松`;
    } else {
      hint = `已传 ${n} 张 · 每张照片只出现一次`;
    }
    this.setData({ hint, needGap: need > 0 ? Math.max(0, need - n) : 0 });
  },

  /** 还差多少张照片（0 = 已凑齐或非模板作品） */
  countGap(): number {
    const need = this.data.needCount || 0;
    if (need <= 0) return 0;
    const n = this.work ? (this.work.photos || []).length : 0;
    return Math.max(0, need - n);
  },

  /**
   * 生成门禁：模板作品的张数没凑齐就一律拦住。
   * 「只有达到固定数量才能生成这个图形」—— 传图之后的每一步（排列/调位置/样式/导出）
   * 以及保存都走这里，凑不齐连图形都出不来。
   */
  blockIfNotReady(): boolean {
    const gap = this.countGap();
    if (gap <= 0) return false;
    toast(`还差 ${gap} 张照片，凑够 ${this.data.needCount} 张才能生成${this.data.shapeName || '该图形'}`);
    return true;
  },

  /** 按画布比例算出预览画布的显示尺寸 */
  updateCanvasSize() {
    const w = this.data.canvasW;
    const st = this.work ? this.work.style : null;
    const ratio = st ? st.ratio : '1:1';
    let rw = 1;
    let rh = 1;
    if (ratio === 'custom') {
      rw = st ? st.customW || 1 : 1;
      rh = st ? st.customH || 1 : 1;
    } else {
      const p = String(ratio).split(':');
      rw = Number(p[0]) || 1;
      rh = Number(p[1]) || 1;
    }
    // 预览区高度上限 440px，超宽比例会按宽度受限
    let h = Math.round((w * rh) / rw);
    const maxH = 440;
    if (h > maxH) {
      h = maxH;
      this.setData({ canvasW: Math.round((h * rw) / rh) });
    }
    this.setData({ canvasH: h });
  },

  /* ==================== 画布 ==================== */

  initCanvas() {
    const q = wx.createSelectorQuery();
    q.select('#pwCanvas')
      .fields({ node: true, size: true } as Record<string, boolean>)
      .exec((res: any) => {
        const item = res && res[0];
        if (!item || !item.node) {
          console.warn('[photo-wall] canvas node not found');
          return;
        }
        const cv = item.node as WechatMiniprogram.Canvas;
        this.canvas = cv;
        setHostCanvas(cv);
        let dpr = 2;
        try {
          dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio || 2 : wx.getSystemInfoSync().pixelRatio || 2;
        } catch (e) { /* 忽略 */ }
        // dpr 过高时导出/绘制成本陡增，这里封顶 3
        this.dpr = Math.min(3, dpr);
        this.rect = { left: item.left || 0, top: item.top || 0 };
        this.resizeCanvas();
        this.redraw();
      });
  },

  resizeCanvas() {
    const cv = this.canvas;
    if (!cv) return;
    const w = Math.round(this.data.canvasW * this.dpr);
    const h = Math.round(this.data.canvasH * this.dpr);
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
  },

  /** 重绘（节流）：所有会改变画面的操作最终都收敛到这里 */
  redraw() {
    if (this._redrawTimer) clearTimeout(this._redrawTimer);
    this._redrawTimer = setTimeout(() => {
      this._redrawTimer = 0;
      this.doRedraw();
    }, REDRAW_MS);
  },

  async doRedraw() {
    const cv = this.canvas;
    const w = this.work;
    if (!cv || !w) return;
    this.resizeCanvas();
    try {
      // 必须把排点算出的照片尺寸传进去：不传的话渲染层会按照片数瞎估一个，
      // 结果就是照片互相压住（估大了）或稀稀拉拉（估小了）。
      // repeat 只在铺满模式下为 true —— 默认模式渲染层会保证「一张照片只画一次」。
      const lay = await paintWork(cv, w, {
        cell: this._cell || undefined,
        repeat: w.autofill === true
      });
      this.lay = lay;
    } catch (e) {
      console.warn('[photo-wall] paint failed:', e);
    }
  },

  /** 重新计算点位（换形状 / 改照片数 / 改排列参数时调用） */
  async relayout() {
    const w = this.work;
    if (!w) return;
    const n = (w.photos || []).length;
    if (!n || !this.shapeDef) {
      w.slots = [];
      this.setData({ tileCount: 0 });
      this.updateHint();
      return this.redraw();
    }
    // 默认「一张照片一格」：点位数量 == 照片数，渲染层 slots[i] ↔ photos[i] 一一对应，
    // 每张照片只出现一次，绝不会重复。只有用户显式打开铺满，才会多排点位循环复用照片。
    // 固定模板作品（w.tplCount > 0）走模板排点：统一尺寸正方形 + 网格对齐 + 实心无缝；
    // 旧作品（algo < 4，无 tplCount）传 legacy，保持原来的自适应排布不被突然换掉。
    const suggest = this.data.shapeSuggest || 40;
    const repeat = w.autofill === true;
    const target = repeat ? Math.max(n, Math.min(suggest, MAX_TILES)) : n;
    const r = layout(this.shapeDef, n, {
      jitter: w.arrange.jitter,
      density: w.arrange.density,
      seed: w.arrange.seed,
      repeat,
      slots: target,
      legacy: !w.tplCount,
      fill: w.fill
    });
    w.slots = r.pts;
    w.cell = r.cell;
    this._cell = r.cell;
    this.setData({ tileCount: r.pts.length });
    this.updateHint();
    this.redraw();
  },

  onToggleAutofill() {
    const w = this.work;
    if (!w) return;
    const on = w.autofill !== false;
    w.autofill = !on;
    this.setData({ autofill: w.autofill });
    this.relayout();
    toast(w.autofill ? '已开启：会重复使用照片把形状铺满' : '已关闭：每张照片只用一次');
  },

  /**
   * 切换填充风格（实心 / 描边 / 渐变）。
   * 风格会**改变张数**（描边挖掉内部格 → 变少），所以切完要重算门禁张数并重排；
   * 照片数与新张数不符时，原有的「还差 N 张」提示会自然接管。
   */
  async onFillMode(e: WechatMiniprogram.TouchEvent) {
    const w = this.work;
    const key = e.currentTarget.dataset.key as PWFillMode;
    if (!w || !key || w.fill === key) return;
    w.fill = key;
    const label = (FILL_MODES.find((m) => m.key === key) || { label: key }).label;
    await this.prepareShape();
    const need = this.data.needCount;
    const gap = this.countGap();
    if (need > 0 && gap > 0) toast(`${label}风格需要 ${need} 张，还差 ${gap} 张`);
    else if (need > 0) toast(`${label}风格：${need} 张，正好组成完整图形`);
    else toast(`已切换为${label}风格`);
  },

  /** 当前排点给出的照片边长（渲染时回传给 paintWork） */
  _cell: 0,

  /* ==================== 步骤 1：形状 ==================== */

  applyShapeId(id: string) {
    const s = getShape(id);
    if (!s) return;
    this.shapeDef = s;
    this.setData({ shapeName: s.name, shapeIcon: s.icon, shapeSuggest: s.suggest });
    if (this.work) {
      this.work.shapeId = s.id;
      this.work.shapeName = s.name;
      this.work.shapeKind = s.kind;
    }
    this.prepareShape();
  },

  async applyPickedShape(
    id: string, name: string,
    kind: 'analytic' | 'text' | 'mask',
    text: string, maskPath: string, icon: string
  ) {
    const w = this.work;
    if (!w) return;
    w.shapeId = id;
    w.shapeName = name;
    w.shapeKind = kind;
    w.shapeText = text || '';
    w.shapeMask = maskPath || '';
    this.setData({ shapeName: name, shapeIcon: icon || '🖼️' });

    if (kind === 'analytic') {
      const s = getShape(id);
      this.shapeDef = s || getShape('heart');
      if (this.shapeDef) this.setData({ shapeSuggest: this.shapeDef.suggest });
    } else if (kind === 'text') {
      this.shapeDef = makeTextShape(text || '');
      this.setData({ shapeSuggest: 40 });
    } else {
      this.shapeDef = makeMaskShape(maskPath);
      this.setData({ shapeSuggest: 40 });
    }
    pushRecentShape(id);
    this.prepareShape();
  },

  /** 按作品里存的种类重建形状对象（文字 / 蒙版需要重新栅格化） */
  async restoreShape() {
    const w = this.work;
    if (!w) return;
    if (w.shapeKind === 'text') this.shapeDef = makeTextShape(w.shapeText || '');
    else if (w.shapeKind === 'mask') this.shapeDef = makeMaskShape(w.shapeMask || '');
    else this.shapeDef = getShape(w.shapeId) || getShape('heart');
    if (this.shapeDef) {
      this.setData({
        shapeIcon: this.shapeDef.icon,
        shapeSuggest: this.shapeDef.suggest,
        shapeName: w.shapeName || this.shapeDef.name
      });
    }
    await this.prepareShape();
  },

  /** 栅格类形状要先生成蒙版才能排点 */
  async prepareShape() {
    const def = this.shapeDef;
    if (!def) return;
    const ok = await ensureShape(def);
    if (!ok) {
      toast('形状解析失败，已回退为心形');
      this.applyShapeId('heart');
      return;
    }
    // 固定模板张数：新作品（tplCount 未初始化）与模板作品（tplCount > 0）都按模板走；
    // tplCount === 0 是存储层给老作品打的标记（自由张数），保持自适应排布不动它。
    // 填充风格：作品没指定就取形状的推荐值，并**落进作品** —— 渲染层要按它决定
    // 渐变风格的透明度衰减（work.fill === 'fade'），不能只存在页面上。
    const w = this.work;
    const mode = fillModeOf(def, w && w.fill ? w.fill : undefined);
    if (w) w.fill = mode;
    const tpl = templateFor(def, mode);
    let need = 0;
    if (tpl && w && w.tplCount !== 0) {
      w.tplCount = tpl.count;
      need = tpl.count;
    }
    this.setData({ needCount: need, fillMode: mode });
    await this.relayout();
  },

  onPickShape() {
    go('/subpackages/photowall/pages/shape/shape', { title: '形状库' });
  },

  /* ==================== 步骤 2：图片 ==================== */

  /**
   * 一次选满需要的照片。
   *
   * 微信选图**单次最多 9 张**（平台限制，无法调大），所以这里**自动接力**：
   * 每轮选完立刻弹下一轮，直到凑够目标张数或用户取消 ——
   * 用户视角就是「连着选几次就齐了」，不用选 9 张、回来点按钮、再选 9 张。
   */
  async onAddPhoto() {
    const w = this.work;
    if (!w) return;
    if (this.data.loading) return; // 接力进行中，避免重复触发
    // 固定模板：张数封顶在 needCount —— 多传的用不上（照片数必须正好等于模板张数）
    const need = this.data.needCount || 0;
    const cap = need > 0 ? Math.min(MAX_PHOTOS, need) : MAX_PHOTOS;
    let left = cap - (w.photos || []).length;
    if (left <= 0) {
      return toast(need > 0 ? `${this.data.shapeName || '该图形'}需要正好 ${need} 张，已选满` : `最多 ${MAX_PHOTOS} 张`);
    }
    // 要连选几轮：先告知用户，避免「怎么又弹出来了」的困惑
    const rounds = batchRounds(left, PICK_PER_BATCH);
    if (rounds > 1) toast(`还需 ${left} 张，将连续选 ${rounds} 次（每次最多 ${PICK_PER_BATCH} 张）`);

    let added = 0;
    this.setData({ loading: true });
    while (left > 0) {
      const files = await this.pickOnce(Math.min(PICK_PER_BATCH, left));
      if (!files || !files.length) break; // 用户取消 / 没选
      const before = (w.photos || []).length;
      // 压缩入库期间给个遮罩：几十张大图压缩要几秒，没反馈会让人以为卡住了。
      // 每轮结束必须先 hideLoading，否则下一轮的选图面板会被遮罩挡住。
      wx.showLoading({ title: `处理 ${files.length} 张…`, mask: true });
      await this.ingest(files);
      wx.hideLoading();
      added += (w.photos || []).length - before;
      this.syncFromWork();
      this.updateHint();
      await this.relayout(); // 每轮都刷新预览：看得到形状在一点点被填满
      left = cap - (w.photos || []).length;
    }
    this.setData({ loading: false });

    if (added <= 0) return;
    if (left <= 0) {
      toast(need > 0 ? `已添加 ${added} 张，正好组成完整${this.data.shapeName || '图形'}` : `已添加 ${added} 张，共 ${(w.photos || []).length} 张`, 'success');
    } else {
      toast(`已添加 ${added} 张，还差 ${left} 张，可再点「添加照片」继续`);
    }
  },

  /** 弹一次选图（最多 count 张），返回所选文件；用户取消返回 null */
  pickOnce(count: number): Promise<{ tempFilePath: string; size: number }[] | null> {
    return new Promise((resolve) => {
      wx.chooseMedia({
        count: Math.max(1, Math.min(PICK_PER_BATCH, count)),
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res: { tempFiles: { tempFilePath: string; size: number }[] }) => {
          resolve((res && res.tempFiles) || []);
        },
        fail: (err: { errMsg: string }) => {
          const m = String((err && err.errMsg) || '');
          if (m.indexOf('cancel') >= 0) return resolve(null);
          toast('选择图片失败');
          resolve(null);
        }
      });
    });
  },

  /**
   * 从聊天记录批量导入（**微信唯一支持「一次几十张」的官方途径**）。
   * wx.chooseMessageFile 上限 100 个，来源是聊天里的图片 ——
   * 引导：先把照片发到任意聊天（推荐「文件传输助手」），再在这里一次勾选。
   */
  onImportFromChat() {
    const w = this.work;
    if (!w) return;
    const need = this.data.needCount || 0;
    const cap = need > 0 ? Math.min(MAX_PHOTOS, need) : MAX_PHOTOS;
    const left = cap - (w.photos || []).length;
    if (left <= 0) {
      return toast(need > 0 ? `${this.data.shapeName || '该图形'}需要正好 ${need} 张，已选满` : `最多 ${MAX_PHOTOS} 张`);
    }
    wx.chooseMessageFile({
      count: Math.min(CHAT_PICK_MAX, left),
      type: 'image',
      success: (res: { tempFiles: { path: string; size: number }[] }) => {
        const list = ((res && res.tempFiles) || []).map((f) => ({ tempFilePath: f.path, size: f.size || 0 }));
        if (!list.length) return;
        this.setData({ loading: true });
        wx.showLoading({ title: `处理 ${list.length} 张`, mask: true });
        this.ingest(list)
          .then(() => {
            wx.hideLoading();
            this.setData({ loading: false });
            this.syncFromWork();
            this.updateHint();
            this.relayout();
            const total = (this.work as PWWork).photos.length;
            const gap = this.countGap();
            if (gap > 0) toast(`已导入 ${total} 张，还差 ${gap} 张`);
            else toast(`已导入，共 ${total} 张`, 'success');
          })
          .catch(() => {
            wx.hideLoading();
            this.setData({ loading: false });
            toast('部分图片处理失败');
          });
      },
      fail: (err: { errMsg: string }) => {
        const m = String((err && err.errMsg) || '');
        if (m.indexOf('cancel') >= 0) return;
        toast('导入失败：请在小程序的聊天记录里选择图片');
      }
    });
  },

  /** 图片入库：大图先压缩（拼图里每张最终只有几百像素，原图纯属浪费内存） */
  async ingest(files: { tempFilePath: string; size: number }[]): Promise<void> {
    const w = this.work;
    if (!w) return;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      let src = f.tempFilePath;
      // 超过 400KB 才压缩，小图直接用省一次 IO
      if (f.size && f.size > 400 * 1024) {
        const c = await compressImage(src);
        if (c) src = c;
      }
      if (w.photos.length >= MAX_PHOTOS) break;
      w.photos.push(newPhoto(src));
    }
  },

  /** 删除某张（图片网格右上角的 ×） */
  onDelPhoto(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.idx);
    const w = this.work;
    if (!w || isNaN(idx)) return;
    w.photos.splice(idx, 1);
    if (this.data.selIndex === idx) this.setData({ selIndex: -1 });
    else if (this.data.selIndex > idx) this.setData({ selIndex: this.data.selIndex - 1 });
    this.syncFromWork();
    this.relayout();
  },

  onShufflePhotos() {
    const w = this.work;
    if (!w) return;
    for (let i = w.photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = w.photos[i];
      w.photos[i] = w.photos[j];
      w.photos[j] = t;
    }
    // 打乱后清空手动微调，否则旧偏移会跟着照片乱跑
    w.photos.forEach((p) => {
      p.dx = 0;
      p.dy = 0;
    });
    this.syncFromWork();
    this.relayout();
    toast('已打乱顺序');
  },

  onClearPhotos() {
    const w = this.work;
    if (!w || !w.photos.length) return;
    wx.showModal({
      title: '清空照片',
      content: '确定移除全部照片吗？',
      success: (r: { confirm: boolean }) => {
        if (!r.confirm) return;
        (this.work as PWWork).photos = [];
        this.setData({ selIndex: -1 });
        this.syncFromWork();
        this.relayout();
      }
    });
  },

  /* ==================== 步骤 3：排列 ==================== */

  onArrangeSlider(e: WechatMiniprogram.CustomEvent) {
    const key = e.currentTarget.dataset.key as string;
    const v = Number(e.detail.value);
    const w = this.work;
    if (!w) return;
    if (key === 'jitter') w.arrange.jitter = v / 100;
    else if (key === 'density') w.arrange.density = v / 100;
    else if (key === 'scale') w.arrange.scale = v / 100;
    else if (key === 'rotate') w.arrange.rotate = v - 180;
    else if (key === 'photoSize') w.arrange.photoSize = v / 100;
    this.setData({
      arrange: {
        jitter: Math.round(w.arrange.jitter * 100),
        density: Math.round(w.arrange.density * 100),
        scale: Math.round(w.arrange.scale * 100),
        rotate: Math.round(w.arrange.rotate) + 180,
        photoSize: Math.round(w.arrange.photoSize * 100)
      }
    });
    // 旋转 / 缩放 / 照片大小只影响绘制，不必重算点位；密度和抖动要重排
    if (key === 'density' || key === 'jitter') this.relayout();
    else this.redraw();
  },

  onRelayout() {
    const w = this.work;
    if (!w) return;
    w.arrange.seed = Math.floor(Math.random() * 100000);
    w.photos.forEach((p) => {
      p.dx = 0;
      p.dy = 0;
    });
    this.relayout();
    toast('已重新排列');
  },

  onResetArrange() {
    const w = this.work;
    if (!w) return;
    w.arrange = { jitter: 0.25, density: 1, scale: 1, rotate: 0, photoSize: 1, seed: Math.floor(Math.random() * 100000) };
    w.photos.forEach((p) => {
      p.dx = 0;
      p.dy = 0;
      p.scale = 1;
      p.rot = 0;
      p.flipH = false;
      p.flipV = false;
    });
    this.syncFromWork();
    this.relayout();
    toast('已重置');
  },

  /* ==================== 步骤 4：单张编辑 ==================== */

  onCanvasTouchStart(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches;
    if (!t || !t.length) return;
    if (this.data.step === 'style') {
      const di = this.hitDecor(t[0].clientX, t[0].clientY);
      if (di >= 0) {
        this.setData({ selDecor: di });
        this._touch = {
          mode: 'decor', index: di, sx: t[0].clientX, sy: t[0].clientY,
          dist: 0, ang: 0, baseScale: 1, baseRot: 0,
          baseDx: this.work ? this.work.style.decor[di].x : 0,
          baseDy: this.work ? this.work.style.decor[di].y : 0
        };
        return;
      }
      this.setData({ selDecor: -1 });
      return;
    }
    if (this.data.step !== 'edit') return;

    // 双指：缩放 + 旋转
    if (t.length >= 2) {
      const pi = this.data.selIndex;
      if (pi < 0 || !this.work) return;
      const p = this.work.photos[pi];
      const dx = t[1].clientX - t[0].clientX;
      const dy = t[1].clientY - t[0].clientY;
      this._touch = {
        mode: 'pinch',
        index: pi,
        sx: 0, sy: 0,
        dist: Math.sqrt(dx * dx + dy * dy) || 1,
        ang: Math.atan2(dy, dx),
        baseScale: p.scale,
        baseRot: p.rot,
        baseDx: p.dx,
        baseDy: p.dy
      };
      return;
    }

    // 单指：拖动（先命中再选，命中即选中，符合直觉）
    const idx = this.hitPhoto(t[0].clientX, t[0].clientY);
    this.setData({ selIndex: idx });
    if (idx < 0 || !this.work) {
      this._touch = null;
      return;
    }
    const p = this.work.photos[idx];
    this._touch = {
      mode: 'photo', index: idx, sx: t[0].clientX, sy: t[0].clientY,
      dist: 0, ang: 0, baseScale: p.scale, baseRot: p.rot, baseDx: p.dx, baseDy: p.dy
    };
  },

  onCanvasTouchMove(e: WechatMiniprogram.TouchEvent) {
    const tc = this._touch;
    const t = e.touches;
    if (!tc || !t || !t.length || !this.work) return;
    const lay = this.lay;

    if (tc.mode === 'pinch' && t.length >= 2) {
      const p = this.work.photos[tc.index];
      const dx = t[1].clientX - t[0].clientX;
      const dy = t[1].clientY - t[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ang = Math.atan2(dy, dx);
      p.scale = Math.max(0.3, Math.min(3, tc.baseScale * (dist / tc.dist)));
      p.rot = tc.baseRot + (ang - tc.ang);
      this.redraw();
      return;
    }

    if (tc.mode === 'photo') {
      const dpr = this.dpr;
      const S = lay ? lay.S : 1;
      const p = this.work.photos[tc.index];
      p.dx = tc.baseDx + ((t[0].clientX - tc.sx) * dpr) / S;
      p.dy = tc.baseDy + ((t[0].clientY - tc.sy) * dpr) / S;
      this.redraw();
      return;
    }

    if (tc.mode === 'decor') {
      const d = this.work.style.decor[tc.index];
      const W = lay ? lay.W : 1;
      const H = lay ? lay.H : 1;
      d.x = Math.max(0, Math.min(1, tc.baseDx + (t[0].clientX - tc.sx) / (W / this.dpr)));
      d.y = Math.max(0, Math.min(1, tc.baseDy + (t[0].clientY - tc.sy) / (H / this.dpr)));
      this.redraw();
    }
  },

  onCanvasTouchEnd() {
    this._touch = null;
  },

  /** 命中测试：返回**照片**下标，未命中 -1（从上层往下找，符合视觉预期） */
  hitPhoto(clientX: number, clientY: number): number {
    const lay = this.lay;
    const w = this.work;
    if (!lay || !w) return -1;
    const x = (clientX - this.rect.left) * this.dpr;
    const y = (clientY - this.rect.top) * this.dpr;
    // 贴片级命中：铺满模式下同一张照片会有多个副本，命中任意副本都算选中这张照片
    const cs = lay.tileCenters || [];
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      if (!c) continue;
      const pi = lay.tilePhoto[i];
      if (pi == null || !w.photos[pi]) continue;
      const half = (lay.size * (w.photos[pi].scale || 1)) / 2;
      if (Math.abs(x - c.x) <= half && Math.abs(y - c.y) <= half) return pi;
    }
    return -1;
  },

  hitDecor(clientX: number, clientY: number): number {
    const lay = this.lay;
    const w = this.work;
    if (!lay || !w) return -1;
    const x = (clientX - this.rect.left) * this.dpr;
    const y = (clientY - this.rect.top) * this.dpr;
    const ds = w.style.decor || [];
    for (let i = ds.length - 1; i >= 0; i--) {
      const c = lay.decorCenters[i];
      if (!c) continue;
      const r = (ds[i].size * lay.W) / 2 + 10 * this.dpr;
      if (Math.abs(x - c.x) <= r && Math.abs(y - c.y) <= r) return i;
    }
    return -1;
  },

  onEditAction(e: WechatMiniprogram.TouchEvent) {
    const act = e.currentTarget.dataset.act as string;
    const w = this.work;
    const i = this.data.selIndex;
    if (!w || i < 0 || !w.photos[i]) return toast('先在画布上点一张照片');
    const p = w.photos[i];
    if (act === 'up') {
      const maxZ = w.photos.reduce((m, q) => Math.max(m, q.z || 0), 0);
      p.z = maxZ + 1;
      toast('已置顶');
      this.redraw();
    } else if (act === 'down') {
      const minZ = w.photos.reduce((m, q) => Math.min(m, q.z || 0), 0);
      p.z = minZ - 1;
      toast('已置底');
      this.redraw();
    } else if (act === 'flipH') {
      p.flipH = !p.flipH;
      this.redraw();
    } else if (act === 'flipV') {
      p.flipV = !p.flipV;
      this.redraw();
    } else if (act === 'reset') {
      p.dx = 0; p.dy = 0; p.scale = 1; p.rot = 0; p.flipH = false; p.flipV = false;
      this.redraw();
    } else if (act === 'replace') {
      this.replacePhoto(i);
    } else if (act === 'delete') {
      this.onDelPhotoByIndex(i);
    }
  },

  onDelPhotoByIndex(i: number) {
    const w = this.work;
    if (!w) return;
    w.photos.splice(i, 1);
    this.setData({ selIndex: -1 });
    this.syncFromWork();
    this.relayout();
  },

  replacePhoto(i: number) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['compressed'],
      success: (res: { tempFiles: { tempFilePath: string; size: number }[] }) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f || !this.work) return;
        const done = (src: string) => {
          (this.work as PWWork).photos[i].src = src;
          this.syncFromWork();
          this.redraw();
        };
        if (f.size && f.size > 400 * 1024) {
          compressImage(f.tempFilePath).then((c) => done(c || f.tempFilePath));
        } else {
          done(f.tempFilePath);
        }
      },
      fail: () => undefined
    });
  },

  /* ==================== 步骤 5：样式 ==================== */

  onStyleSlider(e: WechatMiniprogram.CustomEvent) {
    const key = e.currentTarget.dataset.key as string;
    const v = Number(e.detail.value);
    const w = this.work;
    if (!w) return;
    if (key === 'padding') w.style.padding = v / 100;
    else if (key === 'gap') w.style.gap = v / 100;
    else if (key === 'radius') w.style.radius = v / 100;
    else if (key === 'borderW') w.style.borderW = v / 1000;
    else if (key === 'alpha') w.style.alpha = v / 100;
    else if (key === 'shadowBlur') w.style.shadowBlur = v;
    this.syncStyle();
    this.redraw();
  },

  syncStyle() {
    const st = (this.work as PWWork).style;
    this.setData({
      style: {
        ratio: st.ratio,
        bg: st.bg,
        bgImage: st.bgImage,
        padding: Math.round(st.padding * 100),
        gap: Math.round(st.gap * 100),
        radius: Math.round(st.radius * 100),
        borderW: Math.round(st.borderW * 1000),
        borderColor: st.borderColor,
        shadow: st.shadow,
        shadowColor: st.shadowColor,
        shadowBlur: st.shadowBlur,
        filter: st.filter,
        alpha: Math.round(st.alpha * 100),
        theme: st.theme
      }
    });
  },

  onRatio(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    const w = this.work;
    if (!w) return;
    w.style.ratio = v;
    this.syncStyle();
    this.updateCanvasSize();
    // 画布尺寸变了要重建像素尺寸，等一帧让 WXML 应用新的 style 再量
    setTimeout(() => {
      this.initCanvas();
    }, 60);
  },

  onColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.c as string;
    const w = this.work;
    if (!w) return;
    w.style.bg = c;
    this.syncStyle();
    this.redraw();
  },

  onBorderColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.c as string;
    if (!this.work) return;
    (this.work as PWWork).style.borderColor = c;
    this.syncStyle();
    this.redraw();
  },

  onToggleShadow() {
    if (!this.work) return;
    (this.work as PWWork).style.shadow = !this.work.style.shadow;
    this.syncStyle();
    this.redraw();
  },

  onFilter(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    if (!this.work) return;
    (this.work as PWWork).style.filter = v;
    this.syncStyle();
    this.redraw();
  },

  onTheme(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const t = PW_THEMES.find((x) => x.id === id);
    const w = this.work;
    if (!t || !w) return;
    w.style.bg = t.bg;
    w.style.borderColor = t.borderColor;
    w.style.borderW = t.borderW;
    w.style.radius = t.radius;
    w.style.shadow = t.shadow;
    w.style.shadowColor = t.shadowColor;
    w.style.filter = t.filter;
    w.style.gap = t.gap;
    w.style.theme = t.id;
    this.syncStyle();
    this.redraw();
    toast(`已应用「${t.name}」`);
  },

  onBgImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['compressed'],
      success: (res: { tempFiles: { tempFilePath: string }[] }) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f || !this.work) return;
        (this.work as PWWork).style.bgImage = f.tempFilePath;
        this.syncStyle();
        this.redraw();
      },
      fail: () => undefined
    });
  },

  onClearBg() {
    if (!this.work) return;
    (this.work as PWWork).style.bgImage = '';
    this.syncStyle();
    this.redraw();
  },

  onAddSticker(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as string;
    this.pushDecor({ kind: 'sticker', value: v, color: '#E0607E', size: 0.1 });
  },

  onAddText() {
    wx.showModal({
      title: '添加文字',
      editable: true,
      placeholderText: '如：生日快乐',
      success: (r: { confirm: boolean; content?: string }) => {
        if (!r.confirm || !r.content) return;
        this.pushDecor({ kind: 'text', value: r.content.slice(0, 20), color: '#35302A', size: 0.07 });
      }
    });
  },

  pushDecor(d: { kind: 'sticker' | 'text'; value: string; color: string; size: number }) {
    const w = this.work;
    if (!w) return;
    const item: PWDecor = {
      id: 'd' + Date.now().toString(36),
      kind: d.kind,
      value: d.value,
      x: 0.5,
      y: d.kind === 'text' ? 0.92 : 0.12,
      size: d.size,
      color: d.color,
      rot: 0
    };
    w.style.decor.push(item);
    this.setData({ decors: w.style.decor, selDecor: w.style.decor.length - 1 });
    this.redraw();
    toast('已添加，可在画布上拖动');
  },

  onDelDecor() {
    const w = this.work;
    const i = this.data.selDecor;
    if (!w || i < 0) return toast('先点选一个装饰');
    w.style.decor.splice(i, 1);
    this.setData({ decors: w.style.decor, selDecor: -1 });
    this.redraw();
  },

  /* ==================== 步骤 6：导出 ==================== */

  onExportPx(e: WechatMiniprogram.TouchEvent) {
    this.setData({ exportPx: Number(e.currentTarget.dataset.px) });
  },

  onExportType(e: WechatMiniprogram.TouchEvent) {
    this.setData({ exportType: e.currentTarget.dataset.t as string });
  },

  async onDoExport() {
    const w = this.work;
    if (!w || !(w.photos || []).length) return toast('先添加照片');
    // 张数没凑齐不允许导出 —— 未完成的图形不算「生成」
    if (this.blockIfNotReady()) return;
    if (this.data.exporting) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成', mask: true });
    try {
      const path = await exportWork(w, {
        shortPx: this.data.exportPx,
        fileType: this.data.exportType === 'png' ? 'png' : 'jpg',
        quality: 0.92
      });
      this.setData({ exportPath: path });
      wx.hideLoading();
      toast('已生成');
    } catch (e) {
      wx.hideLoading();
      toast('生成失败，请重试');
      console.warn('[photo-wall] export failed:', e);
    }
    this.setData({ exporting: false });
  },

  onPreviewExport() {
    if (!this.data.exportPath) return;
    wx.previewImage({ urls: [this.data.exportPath], current: this.data.exportPath });
  },

  onSaveAlbum() {
    const path = this.data.exportPath;
    if (!path) return toast('请先生成图片');
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => {
        wx.vibrateShort({ type: 'light' });
        toast('已保存到相册', 'success');
      },
      fail: (err: { errMsg: string }) => {
        const m = String(err.errMsg || '');
        if (m.indexOf('auth deny') >= 0 || m.indexOf('authorize') >= 0 || m.indexOf('deny') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存图片需要「保存到相册」权限，去设置里开启？',
            confirmText: '去设置',
            success: (r: { confirm: boolean }) => {
              if (r.confirm) wx.openSetting({});
            }
          });
          return;
        }
        toast('保存失败：' + m.slice(0, 20));
      }
    });
  },

  /* ==================== 导航与保存 ==================== */

  onStepTap(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i);
    if (isNaN(i) || i === this.data.stepIdx) return;
    // 往回退随便看；往后跳到「自动排」及之后的步骤必须先凑齐固定张数
    if (i > this.data.stepIdx && i > 1 && this.blockIfNotReady()) return;
    this.gotoStep(i);
  },

  gotoStep(i: number) {
    const idx = Math.max(0, Math.min(STEPS.length - 1, i));
    this.setData({ stepIdx: idx, step: STEPS[idx].key });
    // 画布尺寸可能随比例变化，切步骤时重新量一次位置供命中测试用
    this.refreshRect();
  },

  refreshRect() {
    const q = wx.createSelectorQuery();
    q.select('#pwCanvas')
      .boundingClientRect((r: any) => {
        if (r) this.rect = { left: r.left || 0, top: r.top || 0 };
      })
      .exec();
  },

  onPrev() {
    if (this.data.stepIdx === 0) return back();
    this.gotoStep(this.data.stepIdx - 1);
  },

  onNext() {
    const idx = this.data.stepIdx;
    if (idx >= STEPS.length - 1) return this.onSave();
    // 「传图片」之后的每一步都要求张数已凑齐（只有达到固定数量才能生成图形）
    if (idx >= 1 && this.blockIfNotReady()) return;
    this.gotoStep(idx + 1);
  },

  onTitleInput(e: WechatMiniprogram.InputEvent) {
    const v = e.detail.value;
    this.setData({ title: v });
    if (this.work) this.work.title = v;
  },

  async onSave() {
    const w = this.work;
    if (!w) return;
    const n = (w.photos || []).length;
    if (!n) return toast('至少上传 1 张照片');
    // 固定模板：照片数必须正好等于模板张数，达不到就不算「组成完整图形」
    const need = this.data.needCount || 0;
    if (need > 0 && n !== need) {
      return toast(n < need ? `还差 ${need - n} 张照片才能组成完整图形` : `照片多了 ${n - need} 张，请删除后再保存`);
    }
    wx.showLoading({ title: '保存中', mask: true });
    await this.persist(false);
    wx.hideLoading();
    toast('已保存', 'success');
    backAfter(600);
  },

  onSaveDraft() {
    const w = this.work;
    if (!w) return;
    this.persist(true).then(() => toast('草稿已保存'));
  },

  /**
   * 落盘：图片固化到永久目录 + 写入作品库。
   * 图片必须先固化 —— 临时路径在小程序重启后失效，作品会变成一片灰块。
   */
  async persist(draft: boolean): Promise<void> {
    const w = this.work;
    if (!w || this._saving) return;
    this._saving = true;
    try {
      w.title = this.data.title || w.title || '我的照片墙';
      w.draft = draft;
      w.updatedAt = Date.now();
      const srcs = (w.photos || []).map((p) => p.src);
      const fixed = persistPhotos(w.id, srcs);
      for (let i = 0; i < w.photos.length; i++) w.photos[i].src = fixed[i] || w.photos[i].src;
      if (w.style.bgImage) {
        const bgs = persistPhotos(w.id, [w.style.bgImage]);
        w.style.bgImage = bgs[0] || w.style.bgImage;
      }
      saveWork(w);
    } finally {
      this._saving = false;
    }
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '我用照片拼了一个形状 · 照片墙', path: '/subpackages/photowall/pages/index/index' };
  }
});

/** 压缩图片到短边 720（拼图里单张最终只有几百像素，再大只是浪费内存） */
function compressImage(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    wx.compressImage({
      src,
      quality: 80,
      compressedWidth: 720,
      compressedHeight: 720,
      success: (res: { tempFilePath: string }) => resolve(res.tempFilePath),
      fail: () => resolve(null)
    });
  });
}
