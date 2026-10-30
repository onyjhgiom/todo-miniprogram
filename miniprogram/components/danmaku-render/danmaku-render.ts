// components/danmaku-render/danmaku-render.ts
// 弹幕渲染组件：把纯逻辑引擎（danmaku-engine）桥接到微信 Canvas 2D。
//
// 职责边界（与引擎严格分层）：
//   - 引擎：算「什么时候出 / 在哪出 / 怎么动 / 怎么花」，纯计算、不碰 wx；
//   - 本组件：只管「把画布准备好 + 每帧推进 + 自适应降级 + 响应旋转」，是引擎在端上的唯一驱动者。
//
// 三个使用方共用同一份组件：
//   1) 编辑器实时预览（drawBackground=true，常驻循环）；
//   2) 全屏投屏页 stage（drawBackground=true，隐藏 TabBar，支持横屏全屏）；
//   3) 嵌入其它页面时的浮层（由 danmaku-overlay 包一层，drawBackground=false）。
//
// 屏幕方向适配（本组件负责）：
//   - pageLifetimes.resize 监听页面尺寸变化（旋转 / 折叠 / 全屏切换）→ 重新测量画布 → 把新的
//     尺寸与「画布局部安全避让」下发给引擎 setViewport；引擎原地重排，**不销毁活动条目**；
//   - 安全区避让 = max(设备安全区折算到画布局部, 页面为浮层控件预留的 reserve* )，再收敛；
//   - 只在尺寸/方向真变化时才 setData，避免无谓渲染；rAF 循环全程不重启，保证动画连续。
import { DanmakuEngine } from '../../subpackages/danmaku/utils/danmaku-engine';
import type { DanmakuConfig } from '../../subpackages/danmaku/utils/danmaku-types';
import type { SafeInsets, ScreenOrientation, WindowMetrics } from '../../subpackages/danmaku/utils/danmaku-orientation';
import {
  readWindowMetrics,
  toLocalInsets,
  maxInsets,
  clampInsets,
  ZERO_INSETS
} from '../../subpackages/danmaku/utils/danmaku-orientation';

type Quality = 'auto' | 'high' | 'low';

Component({
  properties: {
    /** 完整弹幕配置（DanmakuConfig）。缺字段时引擎会读到 undefined，这里做轻量兜底。 */
    config: { type: Object, value: null as DanmakuConfig | null },
    /** 是否播放（false 时冻结，仅显示当前帧） */
    playing: { type: Boolean, value: true },
    /** 是否绘制预览底图（浮层嵌入时关掉，避免盖住宿主页面内容） */
    drawBackground: { type: Boolean, value: true },
    /** 是否循环（投屏场景默认 true；一次性预览可设 false） */
    loop: { type: Boolean, value: true },
    /** 画质：auto=按实测帧率自动降级，high=强制高画质，low=强制低画质 */
    quality: { type: String, value: 'auto' as Quality },
    /** 页面为顶部浮层控件（如全屏页导航条）预留的高度，避免弹幕压在控件下面 */
    reserveTop: { type: Number, value: 0 },
    /** 页面为底部浮层控件预留的高度 */
    reserveBottom: { type: Number, value: 0 },
    reserveLeft: { type: Number, value: 0 },
    reserveRight: { type: Number, value: 0 }
  },

  data: {
    canvasReady: false,
    cssW: 300,
    cssH: 200,
    orientation: 'portrait' as ScreenOrientation
  },

  lifetimes: {
    attached() {
      this.engine = null;
      this.ctx = null;
      this.canvas = null;
      this.dpr = 2;
      this.lastTs = 0;
      this.rafId = 0;
      this.samples = [];
      this.effectiveQuality = 'high';
      this.insets = { ...ZERO_INSETS };
      this.metrics = null;
      this._settleTimer = 0;
      this._measureAndBind(true);
    },
    detached() {
      this._stopLoop();
      if (this._settleTimer) {
        clearTimeout(this._settleTimer);
        this._settleTimer = 0;
      }
    }
  },

  /**
   * 组件级「页面尺寸变化」生命周期。旋转（pageOrientation=auto）会触发它。
   * 注意：模拟器不触发该回调，方向相关行为需用「真机调试」验证。
   */
  pageLifetimes: {
    resize() {
      this._handleResize();
    }
  },

  observers: {
    config(cfg: DanmakuConfig | null) {
      this._syncConfig(cfg);
    },
    playing(p: boolean) {
      if (!this.engine) return;
      if (p) this.engine.play();
      else this.engine.pause();
    },
    quality(q: Quality) {
      if (!this.engine) return;
      if (q === 'high') {
        this.effectiveQuality = 'high';
        this.engine.setQuality('high');
      } else if (q === 'low') {
        this.effectiveQuality = 'low';
        this.engine.setQuality('low');
      } else {
        this.effectiveQuality = 'auto'; // 交给帧率监测
      }
    },
    // 页面改了浮层预留高度（如全屏页显示/隐藏导航）→ 重新折算安全区
    'reserveTop, reserveBottom, reserveLeft, reserveRight'() {
      if (this.engine) this._measureAndBind(false);
    }
  },

  methods: {
    /* ==================== 画布测量 / 绑定（初始化 + 旋转共用） ==================== */
    _measureAndBind(initial: boolean) {
      const q = wx.createSelectorQuery().in(this as any);
      q.select('#dmCanvas')
        .fields({ node: true, size: true, rect: true } as any)
        .exec((res) => {
          const info = res && res[0];
          if (!info || !info.node) {
            // 极少数情况（节点未就绪）延后一帧重试，避免空画布
            if (initial) setTimeout(() => this._measureAndBind(true), 60);
            return;
          }

          const canvas = info.node as WechatMiniprogram.Canvas;
          const cssW = Math.max(1, Math.round(info.width || 300));
          const cssH = Math.max(1, Math.round(info.height || 200));
          const metrics = readWindowMetrics();
          const dpr = metrics.pixelRatio || 2;

          // 缓冲区按 dpr 放大；setTransform 重置变换，避免多次 resize 后 scale 累积
          canvas.width = Math.round(cssW * dpr);
          canvas.height = Math.round(cssH * dpr);
          const ctx = canvas.getContext('2d') as WechatMiniprogram.CanvasRenderingContext;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          const insets = this._computeInsets(info, metrics, cssW, cssH);

          this.canvas = canvas;
          this.ctx = ctx;
          this.dpr = dpr;
          this.cssW = cssW;
          this.cssH = cssH;
          this.insets = insets;
          this.metrics = metrics;

          if (!this.engine) {
            // 首帧：建引擎 → 下配置 → 开跑
            this.engine = new DanmakuEngine({
              width: cssW,
              height: cssH,
              insets,
              drawBackground: this.data.drawBackground,
              loop: this.data.loop,
              quality: this.effectiveQuality === 'auto' ? 'high' : this.effectiveQuality
            });
            this._syncConfig(this.data.config);
            if (this.data.playing) this.engine.play();
            this._startLoop();
            this.triggerEvent('ready', {
              width: cssW,
              height: cssH,
              orientation: metrics.orientation,
              insets
            });
          } else {
            // 后续：原地换视口（引擎保留活动条目 → 旋转不闪断）
            this.engine.setViewport(cssW, cssH, insets);
          }

          const orientation = metrics.orientation;
          const changed =
            !this.data.canvasReady ||
            this.data.cssW !== cssW ||
            this.data.cssH !== cssH ||
            this.data.orientation !== orientation;
          if (changed) {
            const patch: { canvasReady: boolean; cssW: number; cssH: number; orientation: ScreenOrientation } = {
              canvasReady: true,
              cssW,
              cssH,
              orientation
            };
            this.setData(patch);
          }

          this.triggerEvent('orientationchange', {
            orientation,
            width: cssW,
            height: cssH,
            insets,
            windowWidth: metrics.width,
            windowHeight: metrics.height,
            statusBarHeight: metrics.statusBarHeight
          });
        });
    },

    /** 合并「设备安全区（折算到画布局部）」与「页面浮层预留」 */
    _computeInsets(rect: { left?: number; top?: number; width?: number; height?: number }, metrics: WindowMetrics, cssW: number, cssH: number): SafeInsets {
      const device = toLocalInsets(rect, metrics);
      const reserve: SafeInsets = {
        top: this.data.reserveTop || 0,
        bottom: this.data.reserveBottom || 0,
        left: this.data.reserveLeft || 0,
        right: this.data.reserveRight || 0
      };
      return clampInsets(maxInsets(device, reserve), cssW, cssH);
    },

    /**
     * 尺寸变化处理。
     * 立即测一次 + 120ms 后再补测一次：旋转/全屏后 CSS 尺寸常晚一帧才稳定，
     * 只测一次可能拿到中间态。setViewport 对相同尺寸是幂等的，补测不会造成额外重排。
     */
    _handleResize() {
      this._measureAndBind(false);
      if (this._settleTimer) clearTimeout(this._settleTimer);
      this._settleTimer = setTimeout(() => {
        this._settleTimer = 0;
        this._measureAndBind(false);
      }, 120);
    },

    /* ==================== 配置同步 ==================== */
    _syncConfig(cfg: DanmakuConfig | null) {
      if (!this.engine) return;
      this.engine.setViewport(this.cssW, this.cssH, this.insets);
      // 引擎对缺字段配置宽容（setConfig 内会用到 config.style 等），这里只确保非 null 才下发
      this.engine.setConfig(cfg || null);
    },

    /* ==================== 主循环 ==================== */
    _startLoop() {
      const canvas = this.canvas;
      if (!canvas) return;
      const tick = () => {
        const engine = this.engine;
        const ctx = this.ctx;
        if (!engine || !ctx || !canvas) return;
        const now = Date.now();
        const dt = this.lastTs ? now - this.lastTs : 16.7;
        this.lastTs = now;

        engine.update(dt);
        ctx.clearRect(0, 0, this.cssW, this.cssH);
        engine.draw(ctx);

        // 帧率监测：连续 30 帧低于 40fps 则降级（仅 auto 模式）
        if (this.effectiveQuality === 'auto') {
          this.samples.push(dt);
          if (this.samples.length > 30) this.samples.shift();
          if (this.samples.length === 30) {
            const avg = this.samples.reduce((a: number, b: number) => a + b, 0) / 30;
            if (1000 / avg < 40) {
              this.effectiveQuality = 'low';
              engine.setQuality('low');
            }
          }
        }

        this.rafId = canvas.requestAnimationFrame(tick);
      };
      this.rafId = canvas.requestAnimationFrame(tick);
    },

    _stopLoop() {
      if (this.canvas && this.rafId) {
        this.canvas.cancelAnimationFrame(this.rafId);
      }
      this.rafId = 0;
    },

    /* ==================== 对外控制 ==================== */
    /** 强制重绘（某些机型首帧不刷时手动补一帧） */
    repaint() {
      if (this.engine && this.ctx) {
        this.ctx.clearRect(0, 0, this.cssW, this.cssH);
        this.engine.draw(this.ctx);
      }
    },

    /** 供页面在「布局变化但未触发 resize」时手动调用（如收起/展开浮层控件） */
    resize() {
      this._handleResize();
    },

    /** 当前方向与视口信息，供页面显示方向徽标等 */
    getViewport() {
      const engine = this.engine;
      if (engine && engine.viewportInfo) return engine.viewportInfo();
      return null;
    },

    play() {
      this.engine?.play();
    },
    pause() {
      this.engine?.pause();
    },
    reset() {
      this.engine?.reset();
    }
  }
});
