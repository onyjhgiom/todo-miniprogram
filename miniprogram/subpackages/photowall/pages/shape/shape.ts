// subpackages/photowall/pages/shape/shape.ts
// 照片墙：形状模板库
//
// 覆盖需求的「形状模板库」：分类浏览 / 搜索 / 收藏 / 最近使用 / 一键使用，
// 以及两类需要现场生成的形状 —— 文字形状（栅格化）与自定义 PNG 蒙版（取非透明区域）。

import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { back, backAfter } from '../../../../utils/nav';
import type { ThemeKey } from '../../../../types/index';
import type { ShapeCat } from '../../utils/pw-types';
import { SHAPES, LETTER_SHAPES, NUMBER_SHAPES, SHAPE_CATS, getShape, templateFor, fillModeOf } from '../../utils/pw-shapes';
import {
  loadFavShapes, toggleFavShape, isFavShape, loadRecentShapes, pushRecentShape,
  setPendingShape, loadMasks, saveMask, removeMask, persistMask
} from '../../utils/pw-store';
import type { FavShape, MaskItem } from '../../utils/pw-store';
import type { ShapeDef } from '../../utils/pw-types';

interface ShapeCard {
  id: string;
  name: string;
  icon: string;
  fav: boolean;
  /** 固定张数文案：模板可得时是「N 张」，否则是「约 N 张」（栅格类要运行时才派生） */
  cnt: string;
}

/**
 * 形状的固定张数 + 风格文案。
 * 解析形状能同步派生出固定模板 → 直接给准确张数（按推荐风格算，描边/渐变张数不同）；
 * 字母/数字/文字/蒙版要等运行时栅格化，这里退化成形状的建议张数（约数）。
 */
function cntOf(def: ShapeDef): string {
  const mode = fillModeOf(def);
  const styleName = mode === 'ring' ? '描边' : mode === 'fade' ? '渐变' : '实心';
  const t = templateFor(def, mode);
  if (t && t.count > 0) return t.count + ' 张 · ' + styleName;
  return '约 ' + def.suggest + ' 张 · ' + styleName;
}

interface ShapeData {
  theme: ThemeKey;
  themeStyle: string;
  cats: { key: ShapeCat; label: string }[];
  cat: ShapeCat;
  kw: string;
  list: ShapeCard[];
  recent: ShapeCard[];
  /** 文字形状输入 */
  text: string;
  /** 自定义蒙版 */
  masks: MaskItem[];
  /** 蒙版密度（自定义形状可调） */
  maskDensity: number;
}

Page<ShapeData>({
  data: {
    theme: 'light',
    themeStyle: '',
    cats: SHAPE_CATS,
    cat: 'basic',
    kw: '',
    list: [],
    recent: [],
    text: '',
    masks: [],
    maskDensity: 1
  },

  onLoad() {
    this.applyTheme();
    this.buildRecent();
    this.setData({ masks: loadMasks() });
    this.applyFilter();
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle });
    syncNavBar(s);
  },

  /* ==================== 列表 ==================== */

  buildRecent() {
    const ids = loadRecentShapes();
    const out: ShapeCard[] = [];
    for (let i = 0; i < ids.length; i++) {
      const s = getShape(ids[i]);
      if (s) out.push({ id: s.id, name: s.name, icon: s.icon, fav: isFavShape(s.id), cnt: cntOf(s) });
    }
    this.setData({ recent: out });
  },

  applyFilter() {
    const cat = this.data.cat;
    const kw = (this.data.kw || '').trim().toLowerCase();
    let src = SHAPES;
    if (cat === 'letter') src = LETTER_SHAPES;
    else if (cat === 'number') src = NUMBER_SHAPES;
    else if (cat === 'custom') src = [];
    const list: ShapeCard[] = src
      .filter((s) => (cat === 'basic' || cat === 'letter' || cat === 'number' ? true : s.cat === cat))
      .filter((s) => !kw || s.name.toLowerCase().indexOf(kw) >= 0 || s.id.toLowerCase().indexOf(kw) >= 0)
      .map((s) => ({ id: s.id, name: s.name, icon: s.icon, fav: isFavShape(s.id, s.text || ''), cnt: cntOf(s) }));
    this.setData({ list });
  },

  onCat(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as ShapeCat;
    if (key === this.data.cat) return;
    this.setData({ cat: key }, () => this.applyFilter());
  },

  onSearch(e: WechatMiniprogram.InputEvent) {
    this.setData({ kw: e.detail.value }, () => this.applyFilter());
  },

  onClearSearch() {
    if (!this.data.kw) return;
    this.setData({ kw: '' }, () => this.applyFilter());
  },

  /* ==================== 选中形状 ==================== */

  onPick(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const s = getShape(id);
    if (!s) return;
    this.commit({
      id: s.id,
      name: s.name,
      kind: s.kind,
      text: s.text || '',
      maskPath: s.maskPath || '',
      icon: s.icon
    });
  },

  onPickRecent(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const s = getShape(id);
    if (!s) return;
    this.commit({ id: s.id, name: s.name, kind: s.kind, text: s.text || '', maskPath: '', icon: s.icon });
  },

  onFav(e: WechatMiniprogram.TouchEvent) {
    // 阻止冒泡：否则会同时触发选中并直接返回编辑器
    const id = e.currentTarget.dataset.id as string;
    const s = getShape(id);
    if (!s) return;
    const on = toggleFavShape({
      id: s.id,
      name: s.name,
      kind: s.kind,
      text: s.text || '',
      maskPath: s.maskPath || '',
      icon: s.icon
    });
    toast(on ? '已收藏' : '已取消收藏');
    this.applyFilter();
    this.buildRecent();
  },

  /** 确认选择：回写并退出本页（编辑器的 onShow 会取走） */
  commit(s: FavShape) {
    setPendingShape(s);
    pushRecentShape(s.id);
    toast(`已选择「${s.name}」`);
    backAfter(260);
  },

  /* ==================== 文字形状 ==================== */

  onTextInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ text: e.detail.value });
  },

  onUseText() {
    const raw = (this.data.text || '').trim();
    if (!raw) return toast('请输入文字');
    if (raw.length > 12) return toast('最多 12 个字符');
    this.commit({
      id: 'text',
      name: raw.replace(/\n/g, ' '),
      kind: 'text',
      text: raw,
      maskPath: '',
      icon: '🔤'
    });
  },

  /* ==================== 自定义蒙版 ==================== */

  onPickMask() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'],
      success: (res: { tempFiles: { tempFilePath: string }[] }) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        const path = persistMask(f.tempFilePath);
        const item: MaskItem = {
          id: 'm' + Date.now().toString(36),
          name: '蒙版 ' + new Date().toLocaleDateString('zh-CN'),
          path,
          createdAt: Date.now()
        };
        saveMask(item);
        this.setData({ masks: loadMasks() });
        toast('蒙版已保存，点它即可使用');
      },
      fail: (err: { errMsg: string }) => {
        if (String(err.errMsg).indexOf('cancel') >= 0) return;
        toast('选择图片失败');
      }
    });
  },

  onUseMask(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const m = loadMasks().find((x) => x.id === id);
    if (!m) return;
    this.commit({ id: 'mask', name: m.name, kind: 'mask', text: '', maskPath: m.path, icon: '🖼️' });
  },

  onDelMask(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除蒙版',
      content: '确定删除这个自定义形状吗？',
      success: (r: { confirm: boolean }) => {
        if (!r.confirm) return;
        removeMask(id);
        this.setData({ masks: loadMasks() });
      }
    });
  },

  onDensity(e: WechatMiniprogram.CustomEvent) {
    this.setData({ maskDensity: Number(e.detail.value) });
  },

  onBack() {
    back();
  }
});
