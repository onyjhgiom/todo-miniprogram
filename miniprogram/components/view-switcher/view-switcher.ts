// components/view-switcher/view-switcher.ts
import type { ViewKey } from '../../types/index';

interface ViewItem { key: ViewKey; icon: string; label: string }

const VIEWS: ViewItem[] = [
  { key: 'list', icon: '📋', label: '列表' },
  { key: 'calendar', icon: '📅', label: '日历' },
  { key: 'kanban', icon: '🗂️', label: '看板' }
];

Component({
  properties: {
    current: { type: String, value: 'list' }
  },
  data: {
    views: VIEWS,
    thumbX: 0,
    thumbWidth: '33.333%'
  },
  observers: {
    'current': function (cur: ViewKey) {
      const idx = VIEWS.findIndex((v) => v.key === cur);
      if (idx >= 0) {
        const wrapWidth = 100; // 容器百分比
        this.setData({
          thumbX: `${(idx * wrapWidth) / VIEWS.length}%`,
          thumbWidth: `${wrapWidth / VIEWS.length}%`
        });
      }
    }
  },
  methods: {
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as ViewKey;
      if (key !== this.data.current) {
        this.triggerEvent('change', { key });
      }
    }
  }
});