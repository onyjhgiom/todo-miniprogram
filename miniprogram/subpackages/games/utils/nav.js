// subpackages/games/utils/nav.js
// 游戏分包内自包含的跳转封装（不依赖主包，避免跨包引用风险）。
// 解决：页面栈满 10 层后 wx.navigateTo 静默失败 → 点击毫无反应。
// 逻辑与主包 utils/nav.ts 保持一致，仅保留分包用到的能力。

var MAX_STACK = 10;
var SAFE_STACK = MAX_STACK - 1;
var THROTTLE_MS = 400;

var lastUrl = '';
var lastAt = 0;

function stackDepth() {
  try {
    var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    return Array.isArray(pages) ? pages.length : 0;
  } catch (e) {
    return 0;
  }
}

function throttled(url, force) {
  if (force) return false;
  var now = Date.now();
  if (url === lastUrl && now - lastAt < THROTTLE_MS) return true;
  lastUrl = url;
  lastAt = now;
  return false;
}

function tip(url, err) {
  console.warn('[games-nav] 跳转失败:', url, (err && err.errMsg) || err || '');
  wx.showToast({ title: '打开失败，请重试', icon: 'none' });
}

/** 打开新页面（栈将满时自动改为替换当前页） */
export function go(url, opts) {
  opts = opts || {};
  if (!url || throttled(url, opts.force)) return;
  if (stackDepth() >= SAFE_STACK) { replace(url, { force: true }); return; }
  wx.navigateTo({
    url: url,
    fail: function (err) {
      wx.redirectTo({
        url: url,
        fail: function (err2) {
          wx.reLaunch({ url: url, fail: function (err3) { tip(url, err3 || err2 || err); } });
        }
      });
    }
  });
}

/** 替换当前页 */
export function replace(url, opts) {
  opts = opts || {};
  if (!url || throttled(url, opts.force)) return;
  wx.redirectTo({
    url: url,
    fail: function (err) {
      wx.reLaunch({ url: url, fail: function (err2) { tip(url, err2 || err); } });
    }
  });
}

/** 返回上一页；已在栈底则回到游戏中心 */
export function back(delta) {
  var depth = stackDepth();
  if (depth <= 1) { replace('/subpackages/games/pages/center/center', { force: true }); return; }
  var step = Math.max(1, Math.min(delta || 1, depth - 1));
  wx.navigateBack({
    delta: step,
    fail: function () { replace('/subpackages/games/pages/center/center', { force: true }); }
  });
}
