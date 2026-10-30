// components/danmaku-overlay/danmaku-overlay.ts
// 弹幕浮层：封装 danmaku-render，给宿主页面一个「开/关弹幕」的开关。
// 用法（在任意页面的 json.usingComponents 注册后）：
//   <danmaku-overlay config="{{dmConfig}}" show="{{true}}" />
import type { DanmakuConfig } from '../../subpackages/danmaku/utils/danmaku-types';

Component({
  properties: {
    config: { type: Object, value: null as DanmakuConfig | null },
    /** 初始是否显示弹幕 */
    show: { type: Boolean, value: true }
  },

  data: {
    visible: true
  },

  lifetimes: {
    attached() {
      this.setData({ visible: this.data.show !== false });
    }
  },

  observers: {
    show(v: boolean) {
      this.setData({ visible: !!v });
    }
  },

  methods: {
    onToggle() {
      const visible = !this.data.visible;
      this.setData({ visible });
      this.triggerEvent('toggle', { visible });
    }
  }
});
