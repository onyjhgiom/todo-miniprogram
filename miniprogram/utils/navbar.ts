/**
 * utils/navbar.ts —— 自定义导航栏（navigationStyle: custom）的刘海区与胶囊避让
 *
 * 为什么不直接用 subpackages/tools/utils/navbar.ts：
 *   小程序分包是**单向隔离**的 —— 分包可以引用主包，主包**不能**引用分包代码。
 *   little-helper 位于主包，要用胶囊避让算法就必须在主包提供一份。
 *   两份实现保持一致（算法与注释同源），后续若统一可把此文件下沉到公共位置。
 *
 * 为什么需要胶囊避让：
 *   页面一旦用 `navigationStyle: "custom"`，微信右上角那枚**原生胶囊按钮**
 *   （「···」+「⊙」）依然存在，且**层级高于页面内容**。自绘的右上角按钮若落在
 *   胶囊覆盖区内，点击会被胶囊直接抢走 —— 表现就是「看得见、但按不动」。
 *
 * 两条约束：
 *   ① 垂直：与胶囊同一行。导航行高 = (胶囊上沿 - 状态栏高) × 2 + 胶囊高（微信官方算法）。
 *   ② 水平：停在胶囊**左侧**。右侧让出量 =「屏幕右边 → 胶囊左边」- 页面自身 padding - 呼吸间隙。
 *
 * 用法：
 * ```ts
 * const nav = getNavMetrics(32);           // 32 = 页面 .root 的左右 padding（rpx）
 * this.setData({
 *   padTop: nav.statusBarHeight,            // 内联 padding-top
 *   navTotal: nav.navTotalHeight,           // 内联 height（border-box 下含 padding-top）
 *   navRight: nav.rightGap                  // 内联 padding-right（让开胶囊）
 * });
 * ```
 * 关键坑：`box-sizing: border-box` 下 `height` **包含** `padding-top`，
 * 所以内联 height 必须是 `statusBarHeight + navHeight`，否则内容区被算成负数、整行压扁。
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
  /** 状态栏（刘海）高度，px —— 页面顶部第一段 padding */
  statusBarHeight: number;
  /** 导航内容行高度，px */
  navHeight: number;
  /** 页面顶部到导航内容区下沿的总高，px（border-box 下作为 height 使用） */
  navTotalHeight: number;
  /** 自绘操作区应额外让出的右侧 padding，px（不含页面自身左右 padding） */
  rightGap: number;
  /** 胶囊实测位置与尺寸（px），取不到时为按机型惯例的兜底值 */
  capsule: ICapsuleRect;
}

interface IWindowLike {
  windowWidth?: number;
  statusBarHeight?: number;
}

/** 取不到机型信息时的兜底（≈ iPhone 13/14 竖屏） */
const FALLBACK_WINDOW_WIDTH = 375;
const FALLBACK_STATUS_BAR = 20;
/** 胶囊惯例尺寸：宽 87、高 32、距屏幕右边 7 */
const CAPSULE_W = 87;
const CAPSULE_H = 32;
const CAPSULE_RIGHT_OFFSET = 7;
/** 自绘按钮与胶囊之间至少留出的呼吸间隙，px */
const CAPSULE_BREATH = 10;
/** 导航行高下限：至少容得下 72rpx 圆形按钮 */
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
  return { top, bottom: top + CAPSULE_H, left: right - CAPSULE_W, right, width: CAPSULE_W, height: CAPSULE_H };
}

/**
 * 计算自定义导航栏所需尺寸。
 * @param pagePadRpx 页面根节点左右 padding（rpx），用于扣除「屏幕右边 → 页面内容右边」这一段
 */
export function getNavMetrics(pagePadRpx: number = 40): INavMetrics {
  const win = readWindow();
  const winW = typeof win.windowWidth === 'number' && win.windowWidth > 0 ? win.windowWidth : FALLBACK_WINDOW_WIDTH;
  const sbh =
    typeof win.statusBarHeight === 'number' && win.statusBarHeight > 0 ? win.statusBarHeight : FALLBACK_STATUS_BAR;
  const rpx = winW / 750;

  const capsule = readCapsule(winW, sbh);

  // 官方推荐：导航行高 = 胶囊上下留白 × 2 + 胶囊高；再兜下限避免小屏圆钮被挤出行外
  const navHeight = Math.max(
    Math.round((capsule.top - sbh) * 2 + capsule.height),
    Math.ceil(MIN_ROUND_RPX * rpx) + MIN_ROUND_SLACK
  );

  // rightGap 已含页面自身 padding 之外的「多出来部分 + 呼吸间隙」
  const pagePad = pagePadRpx * rpx;
  const rightGap = Math.max(0, Math.round(winW - capsule.left + CAPSULE_BREATH - pagePad));

  return { statusBarHeight: sbh, navHeight, navTotalHeight: sbh + navHeight, rightGap, capsule };
}
