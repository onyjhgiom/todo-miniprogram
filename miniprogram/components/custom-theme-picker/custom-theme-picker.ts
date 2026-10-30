// components/custom-theme-picker/custom-theme-picker.ts
// 自定义主题颜色选择器：主题色色板 + 浅色/深色模式 + 背景色选择，实时预览
// 选择结果通过 change 事件抛出完整 ICustomTheme，由页面调用 applyCustomTheme 生效
import { PRIMARY_SWATCHES, BG_SWATCHES_LIGHT, BG_SWATCHES_DARK, shade } from '../../utils/theme';
import type { ICustomTheme } from '../../types/index';

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 当前自定义主题配置 */
    custom: {
      type: Object,
      value: { primary: '#B5714C', bg: null, dark: false } as ICustomTheme
    }
  },

  data: {
    primarySwatches: PRIMARY_SWATCHES,
    bgSwatches: BG_SWATCHES_LIGHT,
    /** 预览用派生色 */
    previewDeep: '#96573A',
    previewSoft: 'rgba(181, 113, 76, 0.12)'
  },

  observers: {
    custom(c: ICustomTheme) {
      this.refreshDerived(c);
    }
  },

  lifetimes: {
    attached() {
      this.refreshDerived(this.data.custom as ICustomTheme);
    }
  },

  methods: {
    refreshDerived(c: ICustomTheme) {
      const primary = (c && c.primary) || '#B5714C';
      const dark = !!(c && c.dark);
      this.setData({
        previewDeep: shade(primary, dark ? 12 : -12),
        bgSwatches: dark ? BG_SWATCHES_DARK : BG_SWATCHES_LIGHT
      });
    },

    onPickPrimary(e: WechatMiniprogram.TouchEvent) {
      const primary = e.currentTarget.dataset.color as string;
      this.triggerEvent('change', { ...this.data.custom, primary } as ICustomTheme);
    },

    onToggleMode() {
      const next: ICustomTheme = { ...this.data.custom, dark: !(this.data.custom as ICustomTheme).dark };
      // 切换明暗后，原背景色大概率不适配，重置为跟随默认
      next.bg = null;
      this.triggerEvent('change', next);
    },

    onPickBg(e: WechatMiniprogram.TouchEvent) {
      const bg = e.currentTarget.dataset.color as string | null;
      this.triggerEvent('change', { ...this.data.custom, bg } as ICustomTheme);
    }
  }
});
