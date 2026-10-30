// subpackages/danmaku/utils/danmaku-orientation.ts
// 弹幕「屏幕方向 / 全屏 / 安全区避让」适配层。
//
// 分层约定（和引擎一致）：
//   - 纯函数（detectOrientation / insetsFromSafeArea / toLocalInsets / maxInsets / clampInsets …）
//     不引用任何 wx.*，可以被 Node 直接加载做单测；
//   - readWindowMetrics() 是本模块唯一读 wx 的入口，且只在**函数体内**引用 wx，
//     所以整个模块仍可被 Node 安全 import（不调用就不碰 wx）。
//
// ── 支持的屏幕方向范围（受微信小程序平台能力约束）──────────────
//   portrait  竖屏      默认形态（pageOrientation 缺省值就是它）
//   landscape 横屏      含 landscape-left / landscape-right 两个横向
//   auto      跟随设备  竖屏 ⇄ 横屏自动切换（弹幕全屏页采用此值）
//
//   不在支持范围：
//   - 「倒置竖屏」(upside-down portrait)：iOS 不提供；部分 Android 机型也不回调，
//     强行依赖会导致布局在部分机型上永远不刷新，故不纳入。
//   - 「任意斜屏 / 中间角度」：小程序只在接近正交方向时才回调 resize 并给出新的
//     显示区域尺寸；介于竖横之间的倾斜角度不会产生新的尺寸，因此**实际生效的是
//     「竖屏 + 左横屏 + 右横屏」这三个正交方向**，而不是连续角度。
//
// ── 竖屏 vs 横屏 的显示差异（同一份弹幕配置）─────────────────
//   - 轨道数：横屏可用高度更小 → 轨道更少（行高 1.75×字号不变）；
//   - 单条可视时长：横屏更宽 + 速度(px/s)不变 → 同一条滚动弹幕行程更长、看得更久；
//   - 安全区：横屏刘海/挖孔常在左右两侧，需左右避让；竖屏避让集中在顶部状态栏；
//   - 控件：竖屏保留顶部导航条；横屏进入全屏、导航收成半透明浮层（点击呼出）。

/** 当前设备的实际屏幕方向（正交两态） */
export type ScreenOrientation = 'portrait' | 'landscape';

/** 页面可声明的方向策略，对应小程序 pageOrientation 配置 */
export type OrientationMode = 'portrait' | 'landscape' | 'auto';

/** 本模块声明支持的方向策略（顺序即 UI 展示顺序） */
export const SUPPORTED_ORIENTATIONS: OrientationMode[] = ['auto', 'portrait', 'landscape'];

/** 弹幕全屏页默认采用「跟随设备」 */
export const DEFAULT_ORIENTATION_MODE: OrientationMode = 'auto';

/** 四边避让距离（px，窗口坐标系或画布局部坐标系，由调用方保证一致） */
export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const ZERO_INSETS: SafeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** 未旋转时的最小可用纵向高度，避免 inset 把轨道压成 0 行 */
export const MIN_BAND_V = 72;
/** 最小可用横向行程，避免左右 inset 把滚动轨道压没 */
export const MIN_BAND_H = 120;

export interface RectLike {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export interface SafeAreaLike {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
}

export interface WindowMetrics {
  /** 显示区域宽（CSS px） */
  width: number;
  /** 显示区域高（CSS px） */
  height: number;
  pixelRatio: number;
  orientation: ScreenOrientation;
  statusBarHeight: number;
  /** 相对窗口四边的安全避让（顶部含状态栏/刘海，横屏含左右挖孔） */
  insets: SafeInsets;
  /** 竖屏下右上角胶囊底边 y（用于避让「···」，横屏为 0） */
  menuBottom: number;
}

/**
 * wx.getWindowInfo() / getSystemInfoSync() 的结构子集。
 * 本项目自带的 types/index.d.ts 没有声明这些全局类型，故此处用本地结构类型承接，
 * 只声明真正要读的字段，避免依赖不存在的 WechatMiniprogram.* 命名空间成员。
 */
interface WindowInfoLike {
  windowWidth?: number;
  windowHeight?: number;
  pixelRatio?: number;
  statusBarHeight?: number;
  safeArea?: SafeAreaLike;
}

/* ==================== 纯函数 ==================== */

/** 由显示区域宽高判定方向：宽 > 高 即横屏（正方形按竖屏处理，更保守） */
export function detectOrientation(width: number, height: number): ScreenOrientation {
  return width > height ? 'landscape' : 'portrait';
}

/**
 * 把 wx 的 `safeArea` 换算成「相对窗口四边的避让量」。
 * 没给 safeArea（老基础库 / 部分机型）时返回零避让 —— 宁可不避让，也不要错误避让。
 */
export function insetsFromSafeArea(
  windowWidth: number,
  windowHeight: number,
  safeArea?: SafeAreaLike | null
): SafeInsets {
  if (!safeArea || !safeArea.width || !safeArea.height) return { ...ZERO_INSETS };
  const left = Math.max(0, safeArea.left || 0);
  const top = Math.max(0, safeArea.top || 0);
  const right = Math.max(0, windowWidth - (safeArea.right != null ? safeArea.right : windowWidth));
  const bottom = Math.max(0, windowHeight - (safeArea.bottom != null ? safeArea.bottom : windowHeight));
  return { top, bottom, left, right };
}

/**
 * 把「窗口坐标系的避让」折算成「画布局部坐标系的避让」。
 * 画布通常不等于整窗（例如全屏页画布铺满，编辑器画布在导航栏下方），
 * 只有真正与画布重叠的那部分避让才需要下发给引擎。
 */
export function toLocalInsets(rect: RectLike | null | undefined, m: WindowMetrics): SafeInsets {
  if (!rect) return { ...m.insets };
  const rl = rect.left || 0;
  const rt = rect.top || 0;
  const rw = rect.width || 0;
  const rh = rect.height || 0;
  const rr = rl + rw;
  const rb = rt + rh;
  return {
    top: Math.max(0, m.insets.top - rt),
    left: Math.max(0, m.insets.left - rl),
    right: Math.max(0, m.insets.right - (m.width - rr)),
    bottom: Math.max(0, m.insets.bottom - (m.height - rb))
  };
}

/** 逐边取较大值：页面预留（导航/按钮）与设备安全区取并集 */
export function maxInsets(a: SafeInsets, b: SafeInsets): SafeInsets {
  return {
    top: Math.max(a.top || 0, b.top || 0),
    bottom: Math.max(a.bottom || 0, b.bottom || 0),
    left: Math.max(a.left || 0, b.left || 0),
    right: Math.max(a.right || 0, b.right || 0)
  };
}

/**
 * 收敛避让量，保证中间仍留有可用区域。
 * 极端机型（横屏 + 双侧挖孔）可能给出过大的左右避让，这里兜住，
 * 避免轨道数为 0 或滚动行程为负导致的「一条弹幕都看不到」。
 */
export function clampInsets(insets: SafeInsets, width: number, height: number): SafeInsets {
  const i: SafeInsets = {
    top: Math.max(0, insets.top || 0),
    bottom: Math.max(0, insets.bottom || 0),
    left: Math.max(0, insets.left || 0),
    right: Math.max(0, insets.right || 0)
  };
  const maxV = Math.max(0, height - MIN_BAND_V);
  i.top = Math.min(i.top, maxV);
  i.bottom = Math.min(i.bottom, Math.max(0, maxV - i.top));

  const maxH = Math.max(0, width - MIN_BAND_H);
  i.left = Math.min(i.left, maxH);
  i.right = Math.min(i.right, Math.max(0, maxH - i.left));
  return i;
}

/** 合并：以 from 为底，用 patch 覆盖（patch 里 undefined 的边保留 from） */
export function mergeInsets(from: SafeInsets, patch?: Partial<SafeInsets> | null): SafeInsets {
  if (!patch) return { ...from };
  return {
    top: patch.top != null ? patch.top : from.top,
    bottom: patch.bottom != null ? patch.bottom : from.bottom,
    left: patch.left != null ? patch.left : from.left,
    right: patch.right != null ? patch.right : from.right
  };
}

/** 方向中文名 */
export function orientationLabel(o: ScreenOrientation): string {
  return o === 'landscape' ? '横屏' : '竖屏';
}

/** 一行式描述，供页面/编辑器提示文案使用 */
export function describeMetrics(m: WindowMetrics): string {
  const i = m.insets;
  const pad =
    i.top || i.bottom || i.left || i.right
      ? ` · 避让 上${Math.round(i.top)}/下${Math.round(i.bottom)}/左${Math.round(i.left)}/右${Math.round(i.right)}`
      : '';
  return `${orientationLabel(m.orientation)} · ${Math.round(m.width)}×${Math.round(m.height)}${pad}`;
}

/* ==================== wx 读取入口 ==================== */

/**
 * 读取当前窗口度量。任何一步失败都退回到安全默认值，绝不抛异常。
 * 注意：模拟器不会触发 resize，方向相关的真机行为需用「真机调试」验证。
 */
export function readWindowMetrics(): WindowMetrics {
  let width = 375;
  let height = 667;
  let pixelRatio = 2;
  let statusBarHeight = 20;
  let safeArea: SafeAreaLike | undefined;
  try {
    const anyWx = wx as unknown as {
      getWindowInfo?: () => WindowInfoLike;
      getSystemInfoSync?: () => WindowInfoLike;
    };
    const info = anyWx.getWindowInfo ? anyWx.getWindowInfo() : anyWx.getSystemInfoSync && anyWx.getSystemInfoSync();
    if (info) {
      width = info.windowWidth || width;
      height = info.windowHeight || height;
      pixelRatio = info.pixelRatio || pixelRatio;
      statusBarHeight = info.statusBarHeight || statusBarHeight;
      safeArea = info.safeArea;
    }
  } catch (_e) {
    /* 用默认值 */
  }

  const orientation = detectOrientation(width, height);
  const insets = insetsFromSafeArea(width, height, safeArea);

  // 竖屏才需要避让右上角胶囊；横屏导航收成浮层，胶囊不再是问题
  let menuBottom = 0;
  if (orientation === 'portrait') {
    try {
      const anyWx = wx as unknown as {
        getMenuButtonBoundingClientRect?: () => { bottom?: number };
      };
      const r = anyWx.getMenuButtonBoundingClientRect ? anyWx.getMenuButtonBoundingClientRect() : null;
      if (r && r.bottom) menuBottom = Math.max(0, r.bottom);
    } catch (_e) {
      /* ignore */
    }
  }

  return { width, height, pixelRatio, orientation, statusBarHeight, insets, menuBottom };
}
