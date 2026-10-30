/**
 * utils/navbar.ts —— 自定义导航栏（navigationStyle: custom）的刘海区与胶囊避让
 *
 * 为什么需要它：
 * 页面一旦用 `navigationStyle: "custom"`，微信右上角那枚**原生胶囊按钮**（「···」+「⊙」）
 * 依然存在，而且**层级高于页面内容**。如果页面自绘的右上角按钮正好落在胶囊的覆盖区内，
 * 点击事件会被胶囊直接抢走 —— 表现就是「按钮看得见、但按不动 / 很难按」。
 *
 * 所以自绘的操作区必须同时满足两条约束：
 *   ① 垂直：与胶囊处在同一行。用 `(胶囊上沿 - 状态栏高) × 2 + 胶囊高` 推出导航行高，
 *      这样内容行的垂直中心正好落在胶囊中心上（微信官方推荐算法）。
 *   ② 水平：停在胶囊**左侧**。右侧让出的量 =「屏幕右边 → 胶囊左边」这段宽度，
 *      再扣掉页面自身已有的左右 padding 与一个呼吸间隙。
 *
 * 用法：
 * ```ts
 * const nav = getNavMetrics(40);            // 40 = 页面 .root 的左右 padding（rpx）
 * this.setData({
 *   padTop: nav.statusBarHeight,            // 内联 padding-top
 *   navTotal: nav.navTotalHeight,           // 内联 height（注意：box-sizing 是 border-box，height 要含 padding-top）
 *   navRight: nav.rightGap                  // 内联 padding-right（自绘操作区让开胶囊）
 * });
 * ```
 * wxml：
 * ```html
 * <view class="root__head" style="padding-top:{{padTop}}px;height:{{navTotal}}px;padding-right:{{navRight}}px;">
 * ```
 * 关键坑：`box-sizing: border-box` 下 `height` **包含** `padding-top`，
 * 所以内联的 height 必须是 `statusBarHeight + navHeight`，不能只写 navHeight，
 * 否则内容区会被算成负数、整行压扁。
 */

export interface ICapsuleRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface INavMetrics {
  /** 状态栏（刘海）高度，px —— 作为页面顶部的第一段 padding */
  statusBarHeight: number;
  /** 导航内容行高度，px —— 等于胶囊高度 + 上下两份等距留白 */
  navHeight: number;
  /** 页面顶部到导航内容区下沿的总高，px —— box-sizing:border-box 下应作为 height 使用 */
  navTotalHeight: number;
  /** 自绘操作区应额外让出的右侧 padding，px（**不含**页面自身已有的左右 padding） */
  rightGap: number;
  /** 胶囊按钮的实测位置与尺寸（px），取不到时为按机型惯例的兜底值 */
  capsule: ICapsuleRect;
}

interface IWindowLike {
  windowWidth?: number;
  statusBarHeight?: number;
}

/** 取不到机型信息时的兜底（≈ iPhone 13/14 竖屏） */
const FALLBACK_WINDOW_WIDTH = 375;
const FALLBACK_STATUS_BAR = 20;
/** 胶囊按钮的惯例尺寸：宽 87、高 32、距屏幕右边 7（Android 也基本一致） */
const CAPSULE_W = 87;
const CAPSULE_H = 32;
const CAPSULE_RIGHT_OFFSET = 7;
/** 自绘按钮与胶囊之间至少留出的呼吸间隙，px */
const CAPSULE_BREATH = 10;
/** 导航行高的下限：至少容得下 72rpx 的圆形按钮，并各留 2px 观感余量 */
const MIN_ROUND_RPX = 72;
const MIN_ROUND_SLACK = 4;

function readWindow(): IWindowLike {
  try {
    const w = wx as unknown as {
      getWindowInfo?: () => IWindowLike;
      getSystemInfoSync?: () => IWindowLike;
    };
    if (typeof w.getWindowInfo === 'function') return w.getWindowInfo() || {};
    if (typeof w.getSystemInfoSync === 'function') return w.getSystemInfoSync() || {};
  } catch (_e) {
    /* 走兜底 */
  }
  return {};
}

function readCapsule(winW: number, sbh: number): ICapsuleRect {
  try {
    const r = wx.getMenuButtonBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) {
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    }
  } catch (_e) {
    /* 走兜底 */
  }
  const top = sbh + 4;
  const right = winW - CAPSULE_RIGHT_OFFSET;
  return {
    top,
    bottom: top + CAPSULE_H,
    left: right - CAPSULE_W,
    right,
    width: CAPSULE_W,
    height: CAPSULE_H
  };
}

/**
 * 计算自定义导航栏所需的各项尺寸。
 * @param pagePadRpx 页面根节点的左右 padding（rpx），用于扣除「屏幕右边 → 页面内容右边」这一段
 */
export function getNavMetrics(pagePadRpx: number = 40): INavMetrics {
  const win = readWindow();
  const winW = typeof win.windowWidth === 'number' && win.windowWidth > 0 ? win.windowWidth : FALLBACK_WINDOW_WIDTH;
  const sbh =
    typeof win.statusBarHeight === 'number' && win.statusBarHeight > 0 ? win.statusBarHeight : FALLBACK_STATUS_BAR;
  const rpx = winW / 750;

  const capsule = readCapsule(winW, sbh);

  // 官方推荐：导航行高 = 胶囊上下留白 × 2 + 胶囊高
  // 再兜一个下限，避免小屏机型上 72rpx 的圆钮被挤到行外
  // （下限用 ceil：取整时向上取才不会算出「比实际需要还小」的值）
  const navHeight = Math.max(
    Math.round((capsule.top - sbh) * 2 + capsule.height),
    Math.ceil(MIN_ROUND_RPX * rpx) + MIN_ROUND_SLACK
  );

  // 「屏幕右边 → 胶囊左边」这段宽度里，已经包含了页面自身的左右 padding，
  // 所以只需让自绘操作区再额外让出「多出来的部分 + 呼吸间隙」
  const pagePad = pagePadRpx * rpx;
  const rightGap = Math.max(0, Math.round(winW - capsule.left + CAPSULE_BREATH - pagePad));

  return {
    statusBarHeight: sbh,
    navHeight,
    navTotalHeight: sbh + navHeight,
    rightGap,
    capsule
  };
}
