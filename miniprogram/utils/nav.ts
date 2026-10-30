// utils/nav.ts
// 统一页面跳转层：根治「点了没反应」
//
// 小程序里点击后毫无反应的三个真实原因，这里逐个兜住：
//  1) 页面栈上限 10 层 —— 达到后 wx.navigateTo 直接失败，且不给任何提示。
//     从首页 → 工具中心 → 功能页 → 子页 一路点下去极易触顶。
//  2) 目标页未注册 / 路径拼错 / 分包未下载 —— 同样静默失败。
//  3) 连点 —— 同一个卡片点两下会入栈两次，返回时要按很多次。
//
// 策略：防连点 → 栈深预检（接近上限自动改用 redirectTo）→ 三级兜底
//       （navigateTo 失败 → redirectTo 失败 → reLaunch）→ 终态 toast 提示。

/** 小程序页面栈硬上限 */
const MAX_STACK = 10;
/** 留一层余量，到这一层就改用 redirectTo，避免刚好触顶 */
const SAFE_STACK = MAX_STACK - 1;
/** 同一 URL 的重复点击间隔（ms） */
const THROTTLE_MS = 400;
/** 跳转耗时超过这个值才显示遮罩 —— 避免正常秒开时闪一下 loading */
const MASK_DELAY_MS = 220;

let lastUrl = '';
let lastAt = 0;

export interface NavOptions {
  /** 失败提示中展示的名字，如「番茄时钟」 */
  title?: string;
  /** true 时失败也不提示（调用方自己处理） */
  silent?: boolean;
  /** 跳过防连点节流（一般不用） */
  force?: boolean;
  /** 跳转前显示全屏 loading，传字符串可自定义文案（分包页面建议开启） */
  loading?: boolean | string;
}

/** 当前页面栈深度 */
export function stackDepth(): number {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    return Array.isArray(pages) ? pages.length : 0;
  } catch (e) {
    return 0;
  }
}

/** 当前页路由（不含 query），取不到返回空串 */
export function currentRoute(): string {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const cur = pages && pages[pages.length - 1];
    return cur && cur.route ? String(cur.route) : '';
  } catch (e) {
    return '';
  }
}

/** 防连点：同一地址短时间内重复触发直接忽略 */
function throttled(url: string, opts: NavOptions): boolean {
  if (opts.force) return false;
  const now = Date.now();
  if (url === lastUrl && now - lastAt < THROTTLE_MS) return true;
  lastUrl = url;
  lastAt = now;
  return false;
}

/**
 * 按需显示遮罩，返回「关闭遮罩」函数（幂等）。
 *
 * 关键：遮罩是「延迟出现」的。正常跳转 100ms 内就完成了，用户根本看不到遮罩，
 * 不会有 loading 闪烁；只有当分包下载 / 页面初始化真的慢（>220ms）时，
 * 遮罩才出现，把「点了没反应」的空白期换成明确的进度反馈。
 */
function openMask(opts: NavOptions): () => void {
  if (!opts.loading) return () => undefined;
  const title = typeof opts.loading === 'string' ? opts.loading : '正在打开';
  let closed = false;
  let shown = false;
  const timer = setTimeout(() => {
    if (closed) return;
    shown = true;
    try {
      wx.showLoading({ title, mask: true });
    } catch (e) {
      /* 页面已切换等场景，忽略 */
    }
  }, MASK_DELAY_MS);

  return () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    if (shown) {
      try {
        wx.hideLoading();
      } catch (e) {
        /* 忽略 */
      }
    }
  };
}

function tipFailure(opts: NavOptions, url: string, err?: unknown): void {
  const msg = err && (err as { errMsg?: string }).errMsg ? (err as { errMsg?: string }).errMsg : '';
  // 用户主动取消不做提示
  if (msg && msg.indexOf('cancel') >= 0) return;
  console.warn('[nav] 跳转失败:', url, msg || err || '');
  if (opts.silent) return;
  const name = opts.title || '页面';
  wx.showToast({ title: `${name}打开失败，请重试`, icon: 'none' });
}

/**
 * 打开新页面（保留当前页）。
 * 栈快满或跳转失败时自动降级，保证任何情况下用户都有反馈。
 */
export function go(url: string, opts: NavOptions = {}): void {
  if (!url) return;
  if (throttled(url, opts)) return;
  // 栈快满：直接替换当前页，避免触顶后彻底点不动
  if (stackDepth() >= SAFE_STACK) {
    replace(url, { ...opts, force: true });
    return;
  }
  const close = openMask(opts);
  wx.navigateTo({
    url,
    success: () => close(),
    fail: (err) => {
      // 常见失败：栈满、url 非法、目标是 tabBar 页、分包下载失败
      wx.redirectTo({
        url,
        success: () => close(),
        fail: (err2) => {
          wx.reLaunch({
            url,
            success: () => close(),
            fail: (err3) => {
              close();
              tipFailure(opts, url, err3 || err2 || err);
            }
          });
        }
      });
    }
  });
}

/** 替换当前页（不新增栈层） */
export function replace(url: string, opts: NavOptions = {}): void {
  if (!url) return;
  if (throttled(url, opts)) return;
  const close = openMask(opts);
  wx.redirectTo({
    url,
    success: () => close(),
    fail: (err) => {
      wx.reLaunch({
        url,
        success: () => close(),
        fail: (err2) => {
          close();
          tipFailure(opts, url, err2 || err);
        }
      });
    }
  });
}

/** 关闭所有页面并打开指定页 */
export function relaunch(url: string, opts: NavOptions = {}): void {
  if (!url) return;
  if (throttled(url, opts)) return;
  const close = openMask(opts);
  wx.reLaunch({
    url,
    success: () => close(),
    fail: (err) => {
      close();
      tipFailure(opts, url, err);
    }
  });
}

/** 回到首页（清空页面栈，顺带把过深的栈释放掉） */
export function home(): void {
  relaunch('/pages/index/index', { force: true, silent: true });
}

/** 返回上一页；已经在栈底时不做事，避免无效点击 */
export function back(delta = 1): void {
  const depth = stackDepth();
  if (depth <= 1) return;
  const step = Math.max(1, Math.min(delta, depth - 1));
  wx.navigateBack({ delta: step, fail: () => undefined });
}

/**
 * 延迟返回：ms 毫秒后回到上一页，但若期间页面已切走 / 已销毁则自动放弃。
 *
 * 适用于「保存成功 → toast → 自动返回」这类写法。直接用
 * `setTimeout(() => back(), 500)` 有真实缺陷：
 *  1) 用户在等待期内自己按了返回，定时器随后**再退一页**（多退一页，真机也会发生）；
 *  2) 页面被销毁（热重载、被 reLaunch 换掉）后，回调会对着已不存在的 webview 发起
 *     navigateBack，开发者工具报 `routeDone with a webviewId N is not found`。
 *
 * 守卫方式：记录发起时的路由，回调触发时若栈顶路由已变，说明本页不再是当前页，直接放弃。
 * 注意是 **fail-open**：两次都没取到路由时不拦截（宁可按原行为返回，也不让自动返回静默失效）。
 */
export function backAfter(ms: number, delta = 1): void {
  const from = currentRoute();
  setTimeout(() => {
    const now = currentRoute();
    if (from && now && now !== from) return;
    back(delta);
  }, ms);
}
