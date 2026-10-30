// components/template-picker/template-picker.ts
import type { ITemplate } from '../../types/index';

Component({
  properties: {
    templates: { type: Array, value: [] as ITemplate[] }
  },
  methods: {
    onApply(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      this.triggerEvent('apply', { id });
    },
    onDelete(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      wx.showModal({
        title: '删除模板？',
        success: (res) => {
          if (res.confirm) this.triggerEvent('delete', { id });
        }
      });
    }
  }
});