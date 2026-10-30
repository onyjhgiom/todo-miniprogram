// components/love-core/love-core.ts
// LoveCore 3D 爱情水晶球 · 独立可复用的自定义组件
//
// 与 love-orb 的分工：
//   love-orb  = 回忆星球（球面挂记忆节点、可点节点、飞入动画），偏「内容」；
//   love-core = 品牌主视觉（玻璃穹顶 + 水晶爱心 + 三条轨道 + 星尘），偏「气氛」。
//   所以本组件画布**背景透明**，直接坐在页面的动态渐变上，不铺自己的舞台底色。
//
// 对外契约：
//   properties : level / primary / accent / reduced / paused / height / hint
//   events     : pulse(轻触球体) / ready(首帧就绪)
//   methods    : pulse() 主动触发一次脉冲

import { LoveCore } from '../../utils/love-core';

Component({
  options: {
    multipleSlots: true
  },

  properties: {
    /** 爱心等级 1~10：决定轨道环数（1~3 圈） */
    level: { type: Number, value: 1 },
    /** 视觉风格 key，见 utils/love-core-themes.ts 的 CORE_THEMES（如 galaxy / molten / abyss） */
    theme: { type: String, value: 'galaxy' },
    /** 主色（一般传爱遇小栈的旗舰紫；不传则用风格自带的） */
    primary: { type: String, value: '' },
    /** 强调色（粉） */
    accent: { type: String, value: '' },
    /** 无障碍：关闭自动旋转 / 浮动 / 心跳 / 粒子漂移 */
    reduced: { type: Boolean, value: false },
    /** 页面不可见时暂停渲染，省电 */
    paused: { type: Boolean, value: false },
    /** 画布高度（rpx） */
    height: { type: Number, value: 660 },
    /** 底部提示文案（空则不显示） */
    hint: { type: String, value: '' }
  },

  /* —— 实例字段（非响应式） —— */
  core: null as LoveCore | null,
  retryTimer: null as ReturnType<typeof setTimeout> | null,

  lifetimes: {
    ready() {
      this.initCore();
    },
    detached() {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.core) {
        this.core.destroy();
        this.core = null;
      }
    }
  },

  observers: {
    level(val: number) {
      if (this.core) this.core.setLevel(val);
    },
    // 风格先于颜色应用：setTheme 会写入风格自带配色，
    // 之后若页面显式传了 primary/accent，再覆盖上去（空串则保留风格色）
    theme(key: string) {
      if (!this.core) return;
      this.core.setTheme(key || 'galaxy');
      this.applyColors();
    },
    'primary, accent'() {
      this.applyColors();
    },
    reduced(v: boolean) {
      if (this.core) this.core.setReducedMotion(v);
    },
    paused(v: boolean) {
      if (this.core) this.core.setPaused(v);
    }
  },

  methods: {
    /** 把页面的 primary/accent 覆盖到引擎（空值时保留风格自带配色） */
    applyColors() {
      if (!this.core) return;
      const p = this.data.primary;
      const a = this.data.accent;
      if (p || a) this.core.setColors(p, a);
    },

    /* ====================== 初始化 ====================== */

    initCore() {
      if (this.core) return;
      const q = wx.createSelectorQuery().in(this);
      q.select('#coreCv').fields({ node: true, size: true }).exec((res: any) => {
        const hit = res && res[0];
        // 组件可能还没布局完（在 wx:if / 动画中），下一帧再试；避免长驻空转
        if (!hit || !hit.node || hit.width <= 0 || hit.height <= 0) {
          if (this.retryTimer) return;
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.initCore();
          }, 64);
          return;
        }
        const info: any = (wx as any).getWindowInfo ? (wx as any).getWindowInfo() : wx.getSystemInfoSync();
        const dpr = info.pixelRatio || 2;

        const core = new LoveCore(hit.node, {
          onPulse: () => this.triggerEvent('pulse', {})
        });
        // 顺序要紧：先应用风格（写入配色/轨道/粒子），再让页面传的颜色覆盖
        core.setTheme(this.data.theme || 'galaxy');
        core.setLevel(this.data.level);
        core.setReducedMotion(!!this.data.reduced);
        core.resize(hit.width, hit.height, dpr);
        const p = this.data.primary;
        const a = this.data.accent;
        if (p || a) core.setColors(p, a);
        core.setPaused(!!this.data.paused);
        core.start();

        this.core = core;
        this.triggerEvent('ready', {});
      });
    },

    /* ====================== 输入转发 ====================== */

    onTouchStart(e: any) { if (this.core) this.core.onTouchStart(e); },
    onTouchMove(e: any) { if (this.core) this.core.onTouchMove(e); },
    onTouchEnd(e: any) { if (this.core) this.core.onTouchEnd(); },

    /* ====================== 对外方法 ====================== */

    /** 主动触发一次脉冲（页面在数字累加、等级变化时调用） */
    pulse() {
      if (this.core) this.core.pulse();
    }
  }
});
