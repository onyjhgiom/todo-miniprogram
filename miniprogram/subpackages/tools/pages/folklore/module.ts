// pages/folklore/module.ts
// 通用模块页：按 type 渲染 生肖 / 家居风物 / 易理小观
// 纯选项选择 → 生成民俗文化解读卡（含古籍原文/解读/国风引言）→ 内嵌免责，分享卡片带免责。
// 注：面相/手相模块已按平台内容规范整体下线。
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { MODULES, FolkloreModule, FolkloreOption } from '../../utils/folklore-data';
import { buildResult, DISCLAIMER_FULL, DISCLAIMER_SHORT, FolkloreBlock } from '../../utils/folklore';
import type { ThemeKey } from '../../../../types/index';

interface PickedRef { groupLabel?: string; option: FolkloreOption; }

interface ModuleData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  module: FolkloreModule | null;
  /** 已选：groupKey|null -> optionKey */
  selected: { [groupKey: string]: string };
  pickedCount: number;
  results: FolkloreBlock[];
  hasResult: boolean;
  disclaimerFull: string;
  disclaimerShort: string;
}

Page<ModuleData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    module: null,
    selected: {},
    pickedCount: 0,
    results: [],
    hasResult: false,
    disclaimerFull: DISCLAIMER_FULL,
    disclaimerShort: DISCLAIMER_SHORT
  },

  onLoad(options: Record<string, string>) {
    this.applyTheme();
    const type = options && options.type;
    const mod = type && MODULES[type] ? MODULES[type] : MODULES.zodiac;
    (wx as any).setNavigationBarTitle({ title: mod.title });
    this.setData({ module: mod });
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  /** 选项点击：分组内单选；扁平模块单选（非多选）或多选 */
  onPick(e: WechatMiniprogram.TouchEvent) {
    const mod = this.data.module;
    if (!mod) return;
    const groupKey = (e.currentTarget.dataset.group as string) || '__flat__';
    const optKey = e.currentTarget.dataset.key as string;
    const selected = { ...this.data.selected };

    if (mod.groups) {
      // 分组：每组内单选（替换同组旧选）
      selected[groupKey] = optKey;
    } else if (mod.multi) {
      if (selected[groupKey] === optKey) delete selected[groupKey];
      else selected[groupKey] = optKey;
    } else {
      // 扁平单选：清空其它，仅留当前
      const next: { [k: string]: string } = {};
      next[groupKey] = optKey;
      this.setData({ selected: next }, () => this.syncCount());
      return;
    }
    this.setData({ selected }, () => this.syncCount());
  },

  syncCount() {
    this.setData({ pickedCount: Object.keys(this.data.selected).length });
  },

  /** 生成解读 */
  onGenerate() {
    const mod = this.data.module;
    if (!mod) return;
    if (Object.keys(this.data.selected).length === 0) {
      wx.showToast({ title: '请先选择一项', icon: 'none' });
      return;
    }

    const picked: PickedRef[] = [];
    const lookup = (gk: string, ok: string): FolkloreOption | undefined => {
      if (mod.groups) {
        const g = mod.groups!.find((x) => x.key === gk);
        return g ? g.options.find((o) => o.key === ok) : undefined;
      }
      return mod.options ? mod.options.find((o) => o.key === ok) : undefined;
    };

    Object.keys(this.data.selected).forEach((gk) => {
      const ok = this.data.selected[gk];
      const opt = lookup(gk, ok);
      if (opt) {
        const groupLabel = gk === '__flat__' ? undefined : (mod.groups!.find((x) => x.key === gk)?.label);
        picked.push({ groupLabel, option: opt });
      }
    });

    const raw = buildResult({
      title: mod.title,
      blocks: picked.map((p) => ({
        label: p.groupLabel || p.option.label,
        text: p.option.text,
        quote: p.option.quote
      }))
    });

    this.setData({ results: raw.blocks, hasResult: true });
  },

  /** 复制全部解读（长按/一键复制） */
  onCopy() {
    if (!this.data.hasResult) return;
    const lines = this.data.results.map((b) => {
      let s = b.label ? `【${b.label}】\n` : '';
      s += b.text + '\n';
      if (b.quote) s += `${b.quote}\n`;
      return s;
    });
    const text = lines.join('\n') + '\n' + DISCLAIMER_SHORT;
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'none' }) });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const title = this.data.module ? this.data.module.title : '国风卦相';
    return {
      title: `${title}｜${DISCLAIMER_SHORT}`,
      path: '/subpackages/tools/pages/folklore/index'
    };
  }
});
