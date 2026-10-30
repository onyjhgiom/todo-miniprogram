// components/focus-mode-tabs/focus-mode-tabs.ts
// 专注 / 短休息 / 长休息 三模式切换胶囊（需求十一）。
// 组件薄、页面决定 list 与当前值；只负责回抛 mode，不自行改状态。

Component({
  options: { addGlobalClass: false },

  properties: {
    /** 当前模式 key */
    value: { type: String, value: 'focus' },
    /** [{ key, label, emoji }]，由页面下发以便随时增删（如关闭长休） */
    list: { type: Array, value: [] },
    /** 计时中禁止切换（避免中途改时长导致本轮数据失真） */
    disabled: { type: Boolean, value: false }
  },

  methods: {
    onTap(e: WechatMiniprogram.TouchEvent) {
      if (this.data.disabled) return;
      const key = String((e.currentTarget.dataset as { key?: string }).key || '');
      if (!key || key === this.data.value) return;
      this.triggerEvent('change', { mode: key });
    }
  }
});
