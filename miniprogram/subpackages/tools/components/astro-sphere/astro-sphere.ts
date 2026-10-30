// components/astro-sphere/astro-sphere.ts
// AstroSphere · 星语星球 3D 星球组件
//
// 职责：只做「画布托管 + 输入转发 + 属性同步」，所有绘制逻辑在 utils/astro-cosmos.ts，
// 与 love-core / love-orb 的分工方式一致（组件薄、引擎厚，便于单独测试引擎）。
//
// 对外契约：
//   properties : signs / active / reduced / paused / height / hint / autoSpin
//   events     : ready(首帧) / pulse(脉冲) / node(点到星座, detail.key) / core(点到核心)
//   methods    : pulse() 主动触发一次脉冲

import { AstroCosmos, detectPerfTier, detectReducedMotion, type PerfTier } from '../../utils/astro-cosmos';

Component({
  options: {
    multipleSlots: true,
    // 允许外部通过 class 传入尺寸/定位（页面里靠外层容器控制）
    addGlobalClass: false
  },

  properties: {
    /** 星座节点：[{ key, name, energy }]，energy 0~1 */
    signs: { type: Array, value: [] },
    /** 高亮的星座 key（本命星座） */
    active: { type: String, value: '' },
    /** 无障碍：关闭自转/闪烁/呼吸 */
    reduced: { type: Boolean, value: false },
    /** 页面不可见时暂停渲染，省电 */
    paused: { type: Boolean, value: false },
    /** 画布高度（页面缩放单位 --u 的倍数；手机端 --u = 1rpx，故 720 即 720rpx）。需要同时容纳星球 + 轨道环 */
    height: { type: Number, value: 720 },
    /** 底部提示文案（空则不显示） */
    hint: { type: String, value: '' },
    /** 是否自动旋转（reduced 优先） */
    autoSpin: { type: Boolean, value: true }
  },

  /* —— 实例字段（非响应式） —— */
  cosmos: null as AstroCosmos | null,
  retryTimer: null as ReturnType<typeof setTimeout> | null,
  tier: 1 as PerfTier,

  lifetimes: {
    attached() {
      // 设备档位只探测一次，整个页面生命周期复用
      this.tier = detectPerfTier();
    },
    ready() {
      this.initSphere();
    },
    detached() {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.cosmos) {
        this.cosmos.destroy();
        this.cosmos = null;
      }
    }
  },

  observers: {
    signs(list: any) {
      if (this.cosmos) this.cosmos.setSigns(this.normalizeSigns(list));
    },
    active(key: string) {
      if (this.cosmos) this.cosmos.setActiveSign(key || '');
    },
    reduced(v: boolean) {
      if (this.cosmos) this.cosmos.setReducedMotion(!!v);
    },
    paused(v: boolean) {
      if (this.cosmos) this.cosmos.setPaused(!!v);
    },
    autoSpin(v: boolean) {
      if (this.cosmos) this.cosmos.setAutoSpin(!!v && !this.data.reduced);
    }
  },

  methods: {
    /** 把 wxml 传入的数组规整成引擎需要的结构（容错：缺字段时给安全默认） */
    normalizeSigns(list: any): { key: string; name: string; energy: number }[] {
      if (!Array.isArray(list)) return [];
      const out: { key: string; name: string; energy: number }[] = [];
      for (let i = 0; i < list.length; i++) {
        const it = list[i] || {};
        if (!it.key) continue;
        out.push({
          key: String(it.key),
          name: String(it.name || ''),
          energy: typeof it.energy === 'number' ? it.energy : 0.5
        });
      }
      return out;
    },

    /* ====================== 初始化 ====================== */

    initSphere() {
      if (this.cosmos) return;
      const q = wx.createSelectorQuery().in(this);
      q.select('#sphereCv').fields({ node: true, size: true }).exec((res: any) => {
        const hit = res && res[0];
        // 组件可能未完成布局（在 wx:if / 入场动画里），下一帧重试；避免长驻空转
        if (!hit || !hit.node || hit.width <= 0 || hit.height <= 0) {
          if (this.retryTimer) return;
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.initSphere();
          }, 64);
          return;
        }
        const info: any = (wx as any).getWindowInfo ? (wx as any).getWindowInfo() : wx.getSystemInfoSync();
        const dpr = info.pixelRatio || 2;

        const cosmos = new AstroCosmos(hit.node, {
          onReady: () => this.triggerEvent('ready', {}),
          onPulse: () => this.triggerEvent('pulse', {}),
          onNode: (key: string) => this.triggerEvent('node', { key }),
          onCore: () => this.triggerEvent('core', {})
        });

        cosmos.setTier(this.tier);
        cosmos.setSigns(this.normalizeSigns(this.data.signs));
        cosmos.setActiveSign(this.data.active || '');
        // reduced 优先于 autoSpin
        cosmos.setReducedMotion(!!this.data.reduced || detectReducedMotion());
        cosmos.setAutoSpin(!!this.data.autoSpin && !this.data.reduced);
        cosmos.resize(hit.width, hit.height, dpr);
        cosmos.setPaused(!!this.data.paused);
        cosmos.start();

        this.cosmos = cosmos;
      });
    },

    /* ====================== 输入转发 ====================== */

    onTouchStart(e: any) { if (this.cosmos) this.cosmos.onTouchStart(e); },
    onTouchMove(e: any) { if (this.cosmos) this.cosmos.onTouchMove(e); },
    onTouchEnd() { if (this.cosmos) this.cosmos.onTouchEnd(); },

    /* ====================== 对外方法 ====================== */

    /** 主动触发一次能量脉冲（页面点击核心 / 数字增加动画时调用） */
    pulse() {
      if (this.cosmos) this.cosmos.pulse();
    },

    /** 当前设备性能档位（页面可据此决定是否展示重特效） */
    getTier() {
      return this.tier;
    }
  }
});
