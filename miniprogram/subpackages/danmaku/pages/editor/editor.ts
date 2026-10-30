// subpackages/danmaku/pages/editor/editor.ts
// 弹幕编辑器：左侧/上方实时预览 + 下方编辑区。
//
// 数据来源：从工具中心进入时可能是「新建」或「带 id 打开历史配置」。
// 所有编辑都落在本地 config 对象上；弹幕条目列表单独用 items 镜像渲染（避免每次
// 改字都把整份 config 重新赋值导致输入框失焦），改完再同步回 config.items 触发预览刷新。
import {
  createConfig,
  normalizeConfig,
  saveConfig,
  getConfig,
  toggleFavorite,
  newId
} from '../../utils/danmaku-store';
import {
  DEFAULT_BG,
  DEFAULT_STYLE,
  MAX_ITEM_TEXT,
  MAX_ITEMS,
  type DanmakuConfig,
  type DanmakuItem
} from '../../utils/danmaku-types';
import {
  COLOR_SWATCHES,
  PICKER_MATRIX,
  FONT_OPTIONS,
  EFFECT_OPTIONS,
  SIZE_OPTIONS,
  BG_MODE_OPTIONS,
  PARTICLE_OPTIONS,
  SKIN_OPTIONS,
  SKIN_PRESETS,
  TEMPLATE_GROUPS,
  STICKER_PRESETS,
  BG_PRESETS,
  POP_FROM_LABEL,
  splitTemplateEmoji
} from '../../utils/danmaku-presets';
import { exportDanmakuGIF, saveGifToAlbum } from '../../utils/gif-export';
import { go, back, relaunch, stackDepth } from '../../../../utils/nav';

interface Option<T> {
  value: T;
  label: string;
}

const MODE_OPTIONS: Option<string>[] = [
  { value: 'scroll', label: '滚动' },
  { value: 'pop', label: '弹出' },
  { value: 'blink', label: '闪烁' },
  { value: 'random', label: '随机' }
];
const DENSITY_OPTIONS: Option<string>[] = [
  { value: 'sparse', label: '稀疏' },
  { value: 'normal', label: '适中' },
  { value: 'dense', label: '密集' }
];
const AREA_OPTIONS: Option<string>[] = [
  { value: 'full', label: '全屏' },
  { value: 'top', label: '上半屏' },
  { value: 'bottom', label: '下半屏' }
];
const SPEED_OPTIONS: Option<string>[] = [
  { value: 'slow', label: '慢' },
  { value: 'normal', label: '中' },
  { value: 'fast', label: '快' }
];
const POP_FROM_OPTIONS: Option<string>[] = Object.keys(POP_FROM_LABEL).map((k) => ({
  value: k,
  label: POP_FROM_LABEL[k]
}));

Page({
  data: {
    config: null as DanmakuConfig | null,
    items: [] as DanmakuItem[],
    name: '未命名弹幕',
    playing: true,
    saved: false,
    favorite: false,

    // 自定义导航（navigationStyle: custom）：状态栏高度 + 顶栏高度
    statusBarH: 20,

    colors: COLOR_SWATCHES,
    picker: PICKER_MATRIX,
    fonts: FONT_OPTIONS,
    effects: EFFECT_OPTIONS,
    sizes: SIZE_OPTIONS,
    bgModes: BG_MODE_OPTIONS,
    particles: PARTICLE_OPTIONS,
    skins: SKIN_OPTIONS,
    bgPresets: BG_PRESETS,

    // 模板分类 tabs + 当前分类的模板瓦片（emoji 大字 + 文字小字）
    tabList: TEMPLATE_GROUPS.map((g) => g.label),
    tplTiles: TEMPLATE_GROUPS.map((g) => ({
      label: g.label,
      tiles: g.items.map((t) => {
        const sp = splitTemplateEmoji(t);
        return { full: t, text: sp.text, emoji: sp.emoji };
      })
    })),
    activeTab: TEMPLATE_GROUPS.length ? TEMPLATE_GROUPS[0].label : '',

    stickers: STICKER_PRESETS,
    // 最近一次点击的表情（金框高亮，对应设计稿的 active 态）
    stickerActive: '',

    // 皮肤渐变色块（对齐设计稿的节日皮肤网格）
    skinsView: SKIN_OPTIONS.map((o) => {
      const p = SKIN_PRESETS[o.value];
      return { value: o.value, label: o.label, emoji: p ? p.emoji : '', bgColor: p ? p.bgColor : '#333', bgColor2: p ? p.bgColor2 : '#666' };
    }),

    modeOptions: MODE_OPTIONS,
    densityOptions: DENSITY_OPTIONS,
    areaOptions: AREA_OPTIONS,
    speedOptions: SPEED_OPTIONS,
    popFromOptions: POP_FROM_OPTIONS,

    // 弹幕内容编辑：当前正在编辑的条目标识（-1 表示新增）
    editIndex: -1,
    editText: '',
    showItemEditor: false,

    showColorPanel: false,
    exporting: false,
    progress: 0,
    exportHint: ''
  },

  onLoad(query: Record<string, string>) {
    let cfg: DanmakuConfig;
    if (query && query.id) {
      const found = getConfig(query.id);
      cfg = found ? normalizeConfig(found) : createConfig();
    } else if (query && query.preset === 'wish') {
      cfg = this._presetWish();
    } else {
      cfg = createConfig();
    }
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarH: info.statusBarHeight || 20 });
    this._applyConfig(cfg);
  },

  /* ==================== 自定义导航 ==================== */
  onBack() {
    if (stackDepth() > 1) back();
    else relaunch('/pages/tools/tools', { force: true, silent: true });
  },

  /* ==================== 模板分类 tab ==================== */
  onSelectTab(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as string;
    if (tab && tab !== this.data.activeTab) this.setData({ activeTab: tab });
  },

  /** 「更多 ›」入口：皮肤/表情扩展位，暂作占位提示 */
  onMore() {
    wx.showToast({ title: '更多样式敬请期待', icon: 'none' });
  },

  /* ==================== 配置装载 ==================== */
  _applyConfig(cfg: DanmakuConfig) {
    this.setData({
      config: cfg,
      items: cfg.items.map((it) => ({ ...it })),
      name: cfg.name,
      favorite: cfg.favorite,
      saved: false,
      playing: true
    });
  },

  /** 把当前 items 镜像同步回 config 并触发预览刷新（新引用，组件 observer 会重置引擎） */
  _commitItems() {
    const cfg = this.data.config;
    if (!cfg) return;
    const next: DanmakuConfig = { ...cfg, items: this.data.items.map((it) => ({ ...it })) };
    this.setData({ config: next });
  },

  /** 局部改样式/动画/布局：直接替换 config 对应字段并整体重赋值 */
  _patch(partial: Partial<DanmakuConfig>) {
    const cfg = this.data.config;
    if (!cfg) return;
    this.setData({ config: { ...cfg, ...partial } });
  },

  _presetWish(): DanmakuConfig {
    const cfg = createConfig('生日祝福');
    cfg.items = ['生日快乐 🎂', '岁岁平安 🕊️', '万事如意 🍀'].map((t) => ({
      id: newId(),
      kind: 'text',
      text: t
    }));
    cfg.skin = 'valentine';
    const skin = SKIN_PRESETS.valentine;
    cfg.style = { ...cfg.style, fontEffect: skin.effect, gradientColor2: skin.effectColor2 };
    cfg.anim = { ...cfg.anim, mode: 'random', particle: skin.particle };
    cfg.bg = { kind: 'gradient', color: skin.bgColor, color2: skin.bgColor2, imageUrl: '' };
    return cfg;
  },

  /* ==================== 名称 ==================== */
  onNameInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ name: e.detail.value });
    this._patch({ name: e.detail.value });
  },

  /* ==================== 弹幕内容 ==================== */
  onAddItem() {
    if (this.data.items.length >= MAX_ITEMS) {
      wx.showToast({ title: `最多 ${MAX_ITEMS} 条`, icon: 'none' });
      return;
    }
    this.setData({ showItemEditor: true, editIndex: -1, editText: '' });
  },

  onEditItem(e: WechatMiniprogram.TouchEvent) {
    const i = e.currentTarget.dataset.index as number;
    const it = this.data.items[i];
    if (!it) return;
    this.setData({ showItemEditor: true, editIndex: i, editText: it.text });
  },

  onItemEditorInput(e: WechatMiniprogram.InputEvent) {
    let v = e.detail.value || '';
    if (v.length > MAX_ITEM_TEXT) {
      v = v.slice(0, MAX_ITEM_TEXT);
      wx.showToast({ title: `单条最多 ${MAX_ITEM_TEXT} 字`, icon: 'none' });
    }
    this.setData({ editText: v });
  },

  onSaveItem() {
    const text = (this.data.editText || '').trim();
    if (!text) {
      wx.showToast({ title: '弹幕内容不能为空', icon: 'none' });
      return;
    }
    const items = this.data.items.slice();
    if (this.data.editIndex >= 0) {
      items[this.data.editIndex] = { ...items[this.data.editIndex], text };
    } else {
      items.push({ id: newId(), kind: 'text', text });
    }
    this.setData({ items, showItemEditor: false, editText: '' });
    this._commitItems();
  },

  onCancelItem() {
    this.setData({ showItemEditor: false, editText: '' });
  },

  onRemoveItem(e: WechatMiniprogram.TouchEvent) {
    const i = e.currentTarget.dataset.index as number;
    const items = this.data.items.slice();
    items.splice(i, 1);
    this.setData({ items });
    this._commitItems();
  },

  onTogglePin(e: WechatMiniprogram.TouchEvent) {
    const i = e.currentTarget.dataset.index as number;
    const items = this.data.items.slice();
    const it = items[i];
    if (it) {
      items[i] = { ...it, pinned: !it.pinned };
      this.setData({ items });
      this._commitItems();
    }
  },

  /** 模板库点击：直接追加一条 */
  onTemplate(e: WechatMiniprogram.TouchEvent) {
    const text = e.currentTarget.dataset.text as string;
    if (this.data.items.length >= MAX_ITEMS) {
      wx.showToast({ title: `最多 ${MAX_ITEMS} 条`, icon: 'none' });
      return;
    }
    const items = this.data.items.slice();
    items.push({ id: newId(), kind: 'text', text });
    this.setData({ items });
    this._commitItems();
  },

  /** 表情包：追加一条 sticker 类型的 emoji 弹幕，并高亮为最近使用 */
  onSticker(e: WechatMiniprogram.TouchEvent) {
    const text = e.currentTarget.dataset.text as string;
    if (this.data.items.length >= MAX_ITEMS) return;
    const items = this.data.items.slice();
    items.push({ id: newId(), kind: 'sticker', text });
    this.setData({ items, stickerActive: text });
    this._commitItems();
  },

  /** 批量粘贴导入：多行拆成多条 */
  onBatchImport() {
    (wx as any).getClipboardData({
      success: (res) => {
        const raw = (res.data || '').trim();
        if (!raw) {
          wx.showToast({ title: '剪贴板为空', icon: 'none' });
          return;
        }
        const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!lines.length) {
          wx.showToast({ title: '没有可用的内容', icon: 'none' });
          return;
        }
        const items = this.data.items.slice();
        let added = 0;
        for (const line of lines) {
          if (items.length >= MAX_ITEMS) break;
          items.push({ id: newId(), kind: 'text', text: line.slice(0, MAX_ITEM_TEXT) });
          added++;
        }
        this.setData({ items });
        this._commitItems();
        wx.showToast({ title: `已导入 ${added} 条`, icon: 'success' });
      }
    });
  },

  /* ==================== 文字样式 ==================== */
  onSelectColor(e: WechatMiniprogram.TouchEvent) {
    const color = e.currentTarget.dataset.color as string;
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ style: { ...cfg.style, color } });
  },

  onOpenColorPanel() {
    this.setData({ showColorPanel: true });
  },
  onCloseColorPanel() {
    this.setData({ showColorPanel: false });
  },
  onPickMatrix(e: WechatMiniprogram.TouchEvent) {
    const color = e.currentTarget.dataset.color as string;
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ style: { ...cfg.style, color } });
    this.setData({ showColorPanel: false });
  },

  _selectFromList(value: string, field: 'font' | 'fontEffect' | 'size' | 'bgMode' | 'particle' | 'mode' | 'speed' | 'popFrom') {
    const cfg = this.data.config;
    if (!cfg) return;
    if (field === 'mode' || field === 'speed' || field === 'popFrom') {
      this._patch({ anim: { ...cfg.anim, [field]: value } as DanmakuConfig['anim'] });
    } else if (field === 'particle') {
      this._patch({ anim: { ...cfg.anim, particle: value as DanmakuConfig['anim']['particle'] } });
    } else {
      this._patch({ style: { ...cfg.style, [field]: value } as DanmakuConfig['style'] });
    }
  },

  onSelectFont(e: WechatMiniprogram.TouchEvent) {
    this._selectFromList(e.currentTarget.dataset.value as string, 'font');
  },
  onSelectEffect(e: WechatMiniprogram.TouchEvent) {
    this._selectFromList(e.currentTarget.dataset.value as string, 'fontEffect');
  },
  onSelectSize(e: WechatMiniprogram.TouchEvent) {
    this._selectFromList(e.currentTarget.dataset.value as string, 'size');
  },
  onSelectBgMode(e: WechatMiniprogram.TouchEvent) {
    this._selectFromList(e.currentTarget.dataset.value as string, 'bgMode');
  },
  onSelectParticle(e: WechatMiniprogram.TouchEvent) {
    this._selectFromList(e.currentTarget.dataset.value as string, 'particle');
  },
  onSelectMode(e: WechatMiniprogram.TouchEvent) {
    this._selectFromList(e.currentTarget.dataset.value as string, 'mode');
  },
  onSelectSpeed(e: WechatMiniprogram.TouchEvent) {
    this._selectFromList(e.currentTarget.dataset.value as string, 'speed');
  },
  onSelectPopFrom(e: WechatMiniprogram.TouchEvent) {
    this._selectFromList(e.currentTarget.dataset.value as string, 'popFrom');
  },

  onToggleBold() {
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ style: { ...cfg.style, bold: !cfg.style.bold } });
  },
  onToggleItalic() {
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ style: { ...cfg.style, italic: !cfg.style.italic } });
  },
  onToggleBorder() {
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ style: { ...cfg.style, border: !cfg.style.border } });
  },
  onToggleShadow() {
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ style: { ...cfg.style, shadow: !cfg.style.shadow } });
  },

  /* ==================== 布局 / 密度 / 区域 ==================== */
  onSelectDensity(e: WechatMiniprogram.TouchEvent) {
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ layout: { ...cfg.layout, density: e.currentTarget.dataset.value as DanmakuConfig['layout']['density'] } });
  },
  onSelectArea(e: WechatMiniprogram.TouchEvent) {
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ layout: { ...cfg.layout, area: e.currentTarget.dataset.value as DanmakuConfig['layout']['area'] } });
  },
  onTogglePinImportant() {
    const cfg = this.data.config;
    if (!cfg) return;
    this._patch({ layout: { ...cfg.layout, pinImportant: !cfg.layout.pinImportant } });
  },

  /* ==================== 皮肤 ==================== */
  onSelectSkin(e: WechatMiniprogram.TouchEvent) {
    const cfg = this.data.config;
    if (!cfg) return;
    const key = e.currentTarget.dataset.value as DanmakuConfig['skin'];
    const skin = SKIN_PRESETS[key];
    const style = { ...cfg.style };
    if (key !== 'none') {
      style.fontEffect = skin.effect;
      style.gradientColor2 = skin.effectColor2;
    }
    const anim = { ...cfg.anim, mode: skin.mode as DanmakuConfig['anim']['mode'], particle: skin.particle };
    const bg = { kind: 'gradient' as const, color: skin.bgColor, color2: skin.bgColor2, imageUrl: '' };
    this.setData({ config: { ...cfg, skin: key, style, anim, bg } });
  },

  /* ==================== 背景 ==================== */
  onSelectBg(e: WechatMiniprogram.TouchEvent) {
    const cfg = this.data.config;
    if (!cfg) return;
    const p = e.currentTarget.dataset as { color: string; color2: string };
    this._patch({ bg: { ...cfg.bg, kind: 'gradient', color: p.color, color2: p.color2, imageUrl: '' } });
  },

  /* ==================== 播放控制 ==================== */
  onTogglePlay() {
    const playing = !this.data.playing;
    this.setData({ playing });
    const comp = this.selectComponent('#preview') as unknown as { play?: () => void; pause?: () => void } | null;
    if (comp) {
      if (playing) comp.play && comp.play();
      else comp.pause && comp.pause();
    }
  },
  onReset() {
    const comp = this.selectComponent('#preview') as unknown as { reset?: () => void } | null;
    comp && comp.reset && comp.reset();
  },

  /* ==================== 保存 / 收藏 ==================== */
  onSave() {
    const cfg = this.data.config;
    if (!cfg) return;
    const toSave: DanmakuConfig = { ...cfg, name: this.data.name || '未命名弹幕', items: this.data.items };
    saveConfig(toSave);
    this.setData({ saved: true });
    wx.showToast({ title: '已保存到历史', icon: 'success' });
  },

  onToggleFavorite() {
    const cfg = this.data.config;
    if (!cfg) return;
    const fav = toggleFavorite(cfg.id);
    this.setData({ favorite: fav });
    wx.showToast({ title: fav ? '已收藏' : '已取消收藏', icon: 'none' });
  },

  /* ==================== 导出 GIF ==================== */
  onExportGif() {
    const cfg = this.data.config;
    if (!cfg) return;
    if (!this.data.items.length) {
      wx.showToast({ title: '先添加弹幕内容', icon: 'none' });
      return;
    }
    this.setData({ exporting: true, progress: 0, exportHint: '正在生成帧…' });
    const start = Date.now();
    void start;
    exportDanmakuGIF(normalizeConfig(cfg), {
      width: 320,
      height: 180,
      fps: 10,
      durationSec: 15,
      onProgress: (r) => {
        this.setData({ progress: Math.round(r * 100), exportHint: r < 0.5 ? '正在生成帧…' : '正在编码…' });
      }
    })
      .then((filePath) => saveGifToAlbum(filePath))
      .then(() => {
        this.setData({ exporting: false });
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      })
      .catch((err) => {
        this.setData({ exporting: false });
        console.warn('[danmaku] 导出 GIF 失败:', err);
        wx.showToast({ title: '导出失败，请重试', icon: 'none' });
      });
  },

  /* ==================== 全屏播放 ==================== */
  onOpenStage() {
    const cfg = this.data.config;
    if (!cfg) return;
    const payload = encodeURIComponent(JSON.stringify(normalizeConfig(cfg)));
    go(`/subpackages/danmaku/pages/stage/stage?config=${payload}`, { loading: true, title: '弹幕全屏' });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const cfg = this.data.config;
    return {
      title: '我做的弹幕墙，快来看看',
      path: `/subpackages/danmaku/pages/stage/stage?config=${cfg ? encodeURIComponent(JSON.stringify(cfg)) : ''}`
    };
  },

  /** 弹窗遮罩内点击拦截（阻止冒泡到关闭） */
  noop() {}
});
