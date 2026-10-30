// subpackages/danmaku/pages/stage/stage.ts
// 全屏弹幕播放页（投屏 / 聚会场景）。
//
// 入口：编辑器「全屏播放」跳转，或分享卡片直接进入。config 以 JSON 字符串经 URL 传入，
// 用 normalizeConfig 兜底，避免脏数据让引擎读到 undefined。
//
// ── 屏幕方向策略（stage.json: pageOrientation = "auto"）────────────────
//   竖屏：导航条常显；为弹幕预留「状态栏 + 导航条」高度，弹幕不会压在控件下面。
//   横屏：自动进入全屏（导航收起）；导航变成半透明浮层，点击画面呼出/收起。
//         横屏**不**为导航预留高度 → 弹幕铺满可用安全区；因为浮层显隐不改变画布尺寸，
//         所以「呼出/收起控件」不会触发引擎重排，画面零闪断。
//   支持范围：竖屏 + 左横屏 + 右横屏（详见 utils/danmaku-orientation.ts 顶部说明）。
//
// 注意：模拟器不触发 onResize，方向相关行为需用「真机调试」验证。
import type { DanmakuConfig } from '../../utils/danmaku-types';
import { DEFAULT_BG, DEFAULT_STYLE, DEFAULT_ANIM, DEFAULT_LAYOUT } from '../../utils/danmaku-types';
import { normalizeConfig } from '../../utils/danmaku-store';
import { readWindowMetrics } from '../../utils/danmaku-orientation';
import type { ScreenOrientation } from '../../utils/danmaku-orientation';
import { back, relaunch, stackDepth } from '../../../../utils/nav';

/** 导航条高度（px）：横屏更矮，尽量少占用画面 */
const NAV_H_PORTRAIT = 44;
const NAV_H_LANDSCAPE = 36;

Page({
  data: {
    config: null as DanmakuConfig | null,
    /** 当前方向（正交两态） */
    orientation: 'portrait' as ScreenOrientation,
    /** 安全区（用于浮层控件避开刘海/状态栏/挖孔） */
    safeTop: 20,
    safeBottom: 0,
    safeLeft: 0,
    safeRight: 0,
    /** 导航条内容高度 */
    navH: NAV_H_PORTRAIT,
    /** 浮层控件是否可见：竖屏常显；横屏自动隐藏、点击呼出 */
    navVisible: true,
    /** 下发给渲染组件的「顶部预留」（仅竖屏需要，避免弹幕被导航遮挡） */
    reserveTop: 0,
    /** 进入横屏后短暂提示 */
    hint: ''
  },

  onLoad(query: Record<string, string>) {
    let cfg: DanmakuConfig | null = null;
    if (query && query.config) {
      try {
        const raw = JSON.parse(decodeURIComponent(query.config));
        cfg = normalizeConfig(raw);
      } catch (_e) {
        cfg = null;
      }
    }
    if (!cfg) {
      cfg = normalizeConfig({
        id: 'stage-default',
        name: '示例弹幕',
        createdAt: 0,
        updatedAt: 0,
        favorite: false,
        skin: 'none',
        style: { ...DEFAULT_STYLE },
        anim: { ...DEFAULT_ANIM },
        layout: { ...DEFAULT_LAYOUT },
        bg: { ...DEFAULT_BG },
        items: [
          { id: 's1', kind: 'text', text: '弹幕墙来啦 🎉' },
          { id: 's2', kind: 'text', text: '祝你天天开心' },
          { id: 's3', kind: 'text', text: '666 🔥' }
        ]
      });
    }
    this.setData({ config: cfg });
    this._applyMetrics(true);
  },

  /**
   * 页面显示区域变化（旋转 / 折叠屏 / iPad 分栏）。
   * 这里只负责「页面级」的东西：方向、安全区、浮层显隐与预留高度。
   * 画布的重新测量与引擎重排由 danmaku-render 组件的 pageLifetimes.resize 负责。
   */
  onResize() {
    this._applyMetrics(false);
  },

  _applyMetrics(initial: boolean) {
    const m = readWindowMetrics();
    const isLandscape = m.orientation === 'landscape';
    const orientationChanged = this._orientation !== m.orientation;
    this._orientation = m.orientation;

    const navH = isLandscape ? NAV_H_LANDSCAPE : NAV_H_PORTRAIT;

    // 竖屏：导航常显；横屏：进入全屏，导航自动隐藏（用户点击画面可呼出）
    let navVisible = this.data.navVisible;
    if (initial || orientationChanged) navVisible = !isLandscape;

    // 只有竖屏为导航预留高度；横屏导航是浮层，不预留 → 弹幕铺满，切显隐也不重排
    const reserveTop = isLandscape ? 0 : (m.statusBarHeight || 20) + navH;

    const patch: Record<string, unknown> = {
      orientation: m.orientation,
      safeTop: m.statusBarHeight || 20,
      safeBottom: m.insets.bottom,
      safeLeft: m.insets.left,
      safeRight: m.insets.right,
      navH,
      navVisible,
      reserveTop
    };
    if (!initial && orientationChanged) {
      patch.hint = isLandscape ? '已进入横屏全屏 · 点击画面呼出控件' : '已回到竖屏';
    }
    this.setData(patch, () => {
      if (patch.hint) this._flashHint();
      // 兜底：布局落定后请渲染组件再测一次（组件自身 resize 回调也会触发）
      const render = this.selectComponent('#render') as { resize?: () => void } | null;
      if (render && render.resize) render.resize();
    });
  },

  _flashHint() {
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this._hintTimer = 0;
      this.setData({ hint: '' });
    }, 2400);
  },

  /** 点击画面：横屏下呼出/收起浮层控件（竖屏导航常显，忽略点击） */
  onToggleChrome() {
    if (this.data.orientation !== 'landscape') return;
    this.setData({ navVisible: !this.data.navVisible });
  },

  onClose() {
    // 分享直达时页面栈里只有本页，back() 会无事发生；这种情况直接回工具中心
    if (stackDepth() <= 1) {
      relaunch('/pages/tools/tools');
      return;
    }
    back();
  },

  onUnload() {
    if (this._hintTimer) {
      clearTimeout(this._hintTimer);
      this._hintTimer = 0;
    }
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const cfg = this.data.config;
    return {
      title: '我做的弹幕墙，快来看看',
      path: `/subpackages/danmaku/pages/stage/stage?config=${cfg ? encodeURIComponent(JSON.stringify(cfg)) : ''}`
    };
  }
});
