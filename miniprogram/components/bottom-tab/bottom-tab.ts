// components/bottom-tab/bottom-tab.ts

interface TabItem { key: string; icon: string; label: string; badge?: number }

Component({
  properties: {
    tabs: { type: Array, value: [] as TabItem[] },
    current: { type: String, value: '' }
  },
  methods: {
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as string;
      if (key !== this.data.current) {
        this.triggerEvent('change', { key });
      }
    }
  }
});