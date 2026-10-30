/**
 * 「添加到桌面」能力封装：平台分流、手动引导内容、转化埋点。
 *
 * ============ 能力边界（2026-09 核实官方口径，改代码前先读这段）============
 * 1. 小程序**没有任何 API** 能把自身添加到手机桌面 —— 这件事只能由用户在微信菜单里手动做；
 * 2. 也**无法监听**用户是否添加成功（官方开放文档 FAQ 原文：「如何监听用户添加到桌面：不支持监听」）；
 * 3. **Android**：微信原生支持。小程序右上角胶囊 ··· → 「添加到桌面」。
 *    从桌面图标进入时场景值**固定为 1023**（官方 FAQ：不同系统桌面打开场景值均为 1023）。
 *    部分国产 ROM 需先给微信开「创建桌面快捷方式」权限，否则菜单里不出现该项；
 * 4. **iOS**：**不支持**。腾讯客服 FAQ 原文：「安卓用户可将小程序添加至手机桌面，iOS 系统暂不支持该功能」；
 *    微信开放社区官方回复：「iOS 系统没有这个系统接口，所以不支持，只有安卓可以」。
 *
 * 结论：本项目能做且只做三件合法的事 ——
 *   ① 引导用户手动添加（引导内容按平台分流）；
 *   ② 用 scene === 1023 统计「添加后真的从桌面打开了」的转化（这是唯一的可观测信号）；
 *   ③ iOS 给等效替代路径（「我的小程序」+ 微信聊天列表下拉，一步直达）。
 *
 * 注意：不要再试图找「一键添加」的 API，也不要在 iOS 上画假箭头骗用户去点菜单。
 */

export type DesktopPlatform = 'android' | 'ios' | 'devtools' | 'other';

export interface IDesktopStep {
  icon: string;
  title: string;
  desc: string;
}

export interface IAddDesktopState {
  /** 从桌面图标进入（scene 1023）的累计次数 */
  desktopOpenCount: number;
  /** 首次从桌面进入的时间戳 */
  firstDesktopAt: number;
  /** 最近一次从桌面进入的时间戳 */
  lastDesktopAt: number;
  /** 用户点过「我已添加好了」的时间戳（自述，不代表真的添加成功） */
  confirmedAt: number;
  /** 引导弹层展示次数 */
  guideShown: number;
}

/** 从桌面图标进入的固定场景值（官方 FAQ：各系统桌面打开场景值均为 1023） */
export const DESKTOP_SCENE = 1023;

const STORAGE_KEY = 'my_add_desktop_state';

const EMPTY: IAddDesktopState = {
  desktopOpenCount: 0,
  firstDesktopAt: 0,
  lastDesktopAt: 0,
  confirmedAt: 0,
  guideShown: 0
};

let cache: IAddDesktopState | null = null;

function read(): IAddDesktopState {
  if (cache) return cache;
  let raw: unknown = null;
  try {
    raw = wx.getStorageSync(STORAGE_KEY);
  } catch (e) {
    raw = null;
  }
  cache = Object.assign({}, EMPTY, raw && typeof raw === 'object' ? raw : {});
  return cache;
}

function write(next: IAddDesktopState): void {
  cache = next;
  try {
    wx.setStorageSync(STORAGE_KEY, next);
  } catch (e) {
    /* 本地存储写失败不影响功能，只是统计丢失 */
  }
}

/** 运行平台。iOS 与 Android 的「添加到桌面」能力完全不同，必须先分流 */
export function getPlatform(): DesktopPlatform {
  try {
    const anyWx = wx as unknown as {
      getDeviceInfo?: () => { platform?: string };
      getSystemInfoSync?: () => { platform?: string };
    };
    const info = typeof anyWx.getDeviceInfo === 'function' ? anyWx.getDeviceInfo() : anyWx.getSystemInfoSync!();
    const p = String((info && info.platform) || '').toLowerCase();
    if (p === 'android') return 'android';
    if (p === 'ios') return 'ios';
    if (p === 'devtools') return 'devtools';
    return 'other';
  } catch (e) {
    return 'other';
  }
}

/** 该平台是否支持把小程序添加到手机桌面（仅 Android） */
export function canAddToDesktop(): boolean {
  return getPlatform() === 'android';
}

/** 当前进入场景值：优先取「本次进入」（热启动也算），拿不到再退回冷启动参数 */
export function currentScene(): number {
  const anyWx = wx as unknown as {
    getEnterOptionsSync?: () => { scene?: number };
    getLaunchOptionsSync?: () => { scene?: number };
  };
  // getLaunchOptionsSync 只反映冷启动，热启动（小程序在后台时点桌面图标）必须用 getEnterOptionsSync
  if (typeof anyWx.getEnterOptionsSync === 'function') {
    try {
      const scene = Number((anyWx.getEnterOptionsSync() || {}).scene || 0);
      if (scene) return scene;
    } catch (e) {
      /* 个别基础库 / 工具下会抛错，退回冷启动参数 */
    }
  }
  try {
    const opt = typeof anyWx.getLaunchOptionsSync === 'function' ? anyWx.getLaunchOptionsSync() : null;
    return Number((opt && opt.scene) || 0);
  } catch (e) {
    return 0;
  }
}

/** 本次是否由桌面图标进入（scene 1023） */
export function isFromDesktop(): boolean {
  return currentScene() === DESKTOP_SCENE;
}

export function getState(): IAddDesktopState {
  return Object.assign({}, read());
}

/**
 * 记录一次进入，供 App.onShow 调用。
 * 从桌面图标进来时计数 +1 —— 这是「用户确实添加了桌面图标并点开了」的唯一可观测信号。
 */
export function trackEnter(): { fromDesktop: boolean; count: number } {
  const st = read();
  if (currentScene() !== DESKTOP_SCENE) {
    return { fromDesktop: false, count: st.desktopOpenCount };
  }
  const now = Date.now();
  const next: IAddDesktopState = Object.assign({}, st, {
    desktopOpenCount: st.desktopOpenCount + 1,
    firstDesktopAt: st.firstDesktopAt || now,
    lastDesktopAt: now
  });
  write(next);
  return { fromDesktop: true, count: next.desktopOpenCount };
}

export function markGuideShown(): void {
  const st = read();
  write(Object.assign({}, st, { guideShown: st.guideShown + 1 }));
}

/** 用户自述「已添加好了」。微信不给监听能力，所以这只是本地记录，不做任何成功承诺 */
export function markConfirmed(): void {
  const st = read();
  write(Object.assign({}, st, { confirmedAt: Date.now() }));
}

export function getDesktopOpenCount(): number {
  return read().desktopOpenCount;
}

/** 是否已经在桌面图标形态下打开过（用来在引导里给正向反馈） */
export function hasOpenedFromDesktop(): boolean {
  return read().desktopOpenCount > 0;
}

/** Android 手动添加步骤（微信菜单原生功能，代码无法代为触发） */
export function androidSteps(): IDesktopStep[] {
  return [
    { icon: '☝️', title: '点右上角的 ···', desc: '在小程序里点开右上角胶囊菜单' },
    { icon: '📲', title: '选「添加到桌面」', desc: '菜单里点这一项，系统会弹确认框' },
    { icon: '✅', title: '点「添加」完成', desc: '回到手机桌面就能看到专属图标' }
  ];
}

/** Android 常见机型授权路径：菜单里没有「添加到桌面」基本都是这个原因 */
export const ANDROID_PERMISSION_TIPS: string[] = [
  '华为 / 荣耀：设置 → 应用 → 权限管理 → 微信 → 打开「创建桌面快捷方式」',
  '小米 / 红米：设置 → 应用设置 → 授权管理 → 微信 → 打开「桌面快捷方式」',
  'OPPO / vivo 等：设置里搜「创建桌面快捷方式」，给微信开权限'
];

/** iOS 官方不支持添加到桌面，这里给等效替代路径（全程只用微信自身能力，稳定可用） */
export function iosAlternatives(): IDesktopStep[] {
  return [
    { icon: '⭐', title: '加进「我的小程序」', desc: '点右上角 ··· → 添加到「我的小程序」' },
    { icon: '👇', title: '下拉一步直达', desc: '之后在微信聊天列表下拉，顶部就是它，和桌面图标一样快' },
    { icon: '📌', title: '还能排到最前', desc: '「我的小程序」里长按图标可拖动排序，把本小程序放到第一格' }
  ];
}

/** 设置页入口右侧的状态小字 */
export function statusLabel(): string {
  const st = read();
  if (canAddToDesktop()) {
    if (st.desktopOpenCount > 0) return `已从桌面打开 ${st.desktopOpenCount} 次`;
    if (st.confirmedAt) return '已添加';
    return '可添加';
  }
  return 'iOS 暂不支持';
}

/** 供「使用技巧」等处复用的一句话说明 */
export function summaryLine(): string {
  return canAddToDesktop()
    ? '安卓手机可把本小程序添加到桌面，像 App 一样一键直达'
    : 'iPhone 暂不支持放桌面，「我的小程序」+ 聊天列表下拉同样一步直达';
}
