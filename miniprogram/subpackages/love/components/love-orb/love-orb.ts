// components/love-orb/love-orb.ts
// LoveOrb 爱情能量球 · 独立可复用的自定义组件
//
// 对外只暴露「数据进、事件出」，内部渲染与动画全部封装在 utils/love-orb.ts：
//   properties : items / level / primary / accent / reduced / paused / hint / height / showForm
//   events     : select(点击节点并转到位) / arrive(飞入粒子落进球体) / levelup(升级动画到新形态)
//   methods    : flyIn(item, viewportX, viewportY) / focus(id) / playLevelUp(lv) / getRect()
//
// 任何页面只要引入本组件并给 items，就能得到一完整的爱情球，不需要关心渲染细节。

import { LoveOrb, orbFormOf } from '../../utils/love-orb';
import type { OrbItem } from '../../utils/love-orb';

Component({
  options: {
    multipleSlots: true
  },

  properties: {
    /** 记忆节点列表：{ id, emoji, tint?, photo? } */
    items: { type: Array, value: [] },
    /** 爱情等级 1~10（内部映射成 7 种球体形态） */
    level: { type: Number, value: 1 },
    /** 主色（一般传皮肤 primary） */
    primary: { type: String, value: '#FF7F9C' },
    /** 强调色（一般传皮肤 accent） */
    accent: { type: String, value: '#FFC77D' },
    /** 无障碍：关闭动效（不自动旋转、不飘心、飞入直接落地） */
    reduced: { type: Boolean, value: false },
    /** 暂停渲染（页面不可见时省电） */
    paused: { type: Boolean, value: false },
    /** 底部提示文案 */
    hint: { type: String, value: '' },
    /** 舞台高度（rpx） */
    height: { type: Number, value: 620 },
    /** 左上角是否显示形态名 */
    showForm: { type: Boolean, value: false }
  },

  data: {
    formName: ''
  },

  /* —— 实例字段（非响应式，仅内部持有渲染器与几何信息） —— */
  orb: null as LoveOrb | null,
  rect: null as any,
  retryTimer: null as ReturnType<typeof setTimeout> | null,
  /** 布局未就绪时的重试次数上限，避免页面长期在后台时空转 */
  retryCount: 0,

  lifetimes: {
    ready() {
      this.initOrb();
    },
    detached() {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.orb) {
        this.orb.destroy();
        this.orb = null;
      }
    }
  },

  observers: {
    items(val: OrbItem[]) {
      if (this.orb) this.orb.setItems(val || []);
    },
    level(val: number) {
      const f = orbFormOf(val);
      this.setData({ formName: f.name });
      if (this.orb) this.orb.setLevel(val);
    },
    'primary, accent'(p: string, a: string) {
      if (this.orb) this.orb.setColors(p, a);
    },
    reduced(v: boolean) {
      if (this.orb) this.orb.setReducedMotion(v);
    },
    paused(v: boolean) {
      if (this.orb) this.orb.setPaused(v);
    }
  },

  methods: {
    /* ====================== 初始化 ====================== */

    initOrb() {
      if (this.orb) return;
      const q = wx.createSelectorQuery().in(this);
      q.select('#orbCv').fields({ node: true, size: true }).exec((res: any) => {
        const hit = res && res[0];
        if (!hit || !hit.node) {
          // 组件可能还没布局完（在 wx:if 里），下一帧再试
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.initOrb();
          }, 60);
          return;
        }
        if (hit.width <= 0 || hit.height <= 0) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.initOrb();
          }, 60);
          return;
        }
        const canvas = hit.node;
        const info: any = (wx as any).getWindowInfo ? (wx as any).getWindowInfo() : wx.getSystemInfoSync();
        const dpr = info.pixelRatio || 2;

        const orb = new LoveOrb(canvas, {
          onSelect: (id: string) => this.triggerEvent('select', { id }),
          onArrive: (id: string) => this.triggerEvent('arrive', { id }),
          onLevelUp: (lv: number, form: any) =>
            this.triggerEvent('levelup', { lv, name: form.name, desc: form.desc })
        });
        orb.resize(hit.width, hit.height, dpr);
        orb.setColors(this.data.primary, this.data.accent);
        orb.setLevel(this.data.level);
        orb.setItems(this.data.items || []);
        orb.setReducedMotion(!!this.data.reduced);
        orb.start();

        this.orb = orb;
        this.cacheRect();
        this.triggerEvent('ready', {});
      });
    },

    /** 缓存组件在视口中的位置，用于把页面坐标换算成画布坐标 */
    cacheRect() {
      const q = wx.createSelectorQuery().in(this);
      q.select('.orb-wrap').boundingClientRect().exec((res: any) => {
        if (res && res[0]) this.rect = res[0];
      });
    },

    /* ====================== 输入转发 ====================== */

    onTouchStart(e: any) { if (this.orb) this.orb.onTouchStart(e); },
    onTouchMove(e: any) { if (this.orb) this.orb.onTouchMove(e); },
    onTouchEnd(e: any) { if (this.orb) this.orb.onTouchEnd(e); },
    onMouseDown(e: any) { if (this.orb) this.orb.onMouseDown(e); },
    onMouseMove(e: any) { if (this.orb) this.orb.onMouseMove(e); },
    onMouseUp(e: any) { if (this.orb) this.orb.onMouseUp(e); },
    onWheel(e: any) {
      if (this.orb) this.orb.onWheel((e.detail && e.detail.deltaY) || -100);
    },

    /* ====================== 对外方法（页面通过 selectComponent 调用） ====================== */

    /**
     * 让一条新回忆飞进球体：页面传入视口坐标，组件换算成画布坐标后交给引擎。
     * 落地前回调 arrive，页面再决定何时把这条回忆真正写进数据源。
     */
    flyIn(item: OrbItem, vx: number, vy: number) {
      if (!this.orb) return;
      const r = this.rect;
      const x = r ? vx - (r.left || 0) : vx;
      const y = r ? vy - (r.top || 0) : vy;
      this.orb.flyIn(item, x, y);
    },

    /** 自动旋转到某个节点并放大 */
    focus(id: string) {
      if (this.orb) this.orb.focusTo(id);
    },

    /** 播放升级动画（新形态出现时回调 levelup） */
    playLevelUp(lv: number) {
      if (this.orb) this.orb.playLevelUp(lv);
    },

    /** 陀螺仪微视差：手机轻微倾斜时球体有立体浮动感；页面在不支持时可跳过 */
    onDeviceMotion(e: any) {
      if (this.orb) this.orb.onDeviceMotion(e);
    },

    /** 球体中心在视口中的坐标（页面做飞入动画的终点） */
    getCenter(): { x: number; y: number } {
      const r = this.rect;
      if (!r) return { x: 0, y: 0 };
      return { x: (r.left || 0) + (r.width || 0) / 2, y: (r.top || 0) + (r.height || 0) / 2 };
    }
  }
});
