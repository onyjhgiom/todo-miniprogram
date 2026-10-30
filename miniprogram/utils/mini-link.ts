// utils/mini-link.ts
// 通过「小程序链接」跳转到其他小程序（美团外卖红包 / 饿了么红包等）
//
// 说明：
// - shortLink 为「#小程序://名称/路径」形式，通过目标小程序的【菜单 → 复制链接】获取，
//   由微信客户端解析目标 appId 与页面路径，因此无需在代码里写死 appId。
// - 该参数自基础库 2.18.1 起支持；低版本或跳转失败时退化为「复制链接」引导。
// - 必须在用户点击行为中调用（平台限制，非点击触发会直接失败）。

/** 依次尝试多个链接（主链接失败时自动尝试备选链接，兼容名称分隔符差异等场景） */
export function openMiniLink(links: (string | undefined)[], name: string): void {
  const list = (links || []).filter((l): l is string => !!l);
  if (!list.length) return;

  // 开发者工具不支持真实跳转，直接给出提示并复制链接
  if (isDevtools()) {
    copyLinkFallback(list[0], name, true);
    return;
  }
  if (!supportShortLink()) {
    copyLinkFallback(list[0], name, false);
    return;
  }
  tryLink(list, 0, name);
}

/** 复制小程序链接（长按卡片等场景） */
export function copyMiniLink(link: string, name: string): void {
  if (!link) return;
  wx.setClipboardData({
    data: link,
    success: () => {
      wx.showToast({ title: `已复制${name}链接`, icon: 'none' });
    },
    fail: () => {
      wx.showToast({ title: '复制失败，请重试', icon: 'none' });
    }
  });
}

function tryLink(links: string[], index: number, name: string): void {
  wx.navigateToMiniProgram({
    shortLink: links[index],
    envVersion: 'release',
    success: () => {
      // 跳转成功（开发者工具仅做校验，不会真实跳转）
    },
    fail: (err: { errMsg?: string }) => {
      const msg = (err && err.errMsg) || '';
      // 真机排查用：完整 errMsg 里通常带目标 appId（如白名单校验失败时），可在真机调试日志里查看
      console.warn('[mini-link] 跳转失败', name, msg);
      // 用户主动取消「是否跳转」确认弹窗，不做任何提示
      if (msg.indexOf('cancel') >= 0) return;
      // 还有备选链接则继续尝试
      if (index + 1 < links.length) {
        tryLink(links, index + 1, name);
        return;
      }
      copyLinkFallback(links[0], name, false);
    }
  });
}

/** 基础库版本是否达到 2.18.1（shortLink 的最低要求） */
function supportShortLink(): boolean {
  try {
    const info = wx.getSystemInfoSync();
    return compareVersion(info.SDKVersion || '', '2.18.1') >= 0;
  } catch (e) {
    return true; // 拿不到版本时按支持处理，失败再走兜底
  }
}

function isDevtools(): boolean {
  try {
    return wx.getSystemInfoSync().platform === 'devtools';
  } catch (e) {
    return false;
  }
}

/** 版本比较：v1 >= v2 返回 1，相等返回 0，否则 -1 */
function compareVersion(v1: string, v2: string): number {
  const a = String(v1 || '0.0.0').split('.');
  const b = String(v2 || '0.0.0').split('.');
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const n1 = parseInt(a[i] || '0', 10) || 0;
    const n2 = parseInt(b[i] || '0', 10) || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

/** 兜底：复制链接 + 弹窗引导用户粘贴到微信打开 */
function copyLinkFallback(link: string, name: string, devtools: boolean): void {
  wx.setClipboardData({
    data: link,
    success: () => {
      wx.showModal({
        title: `打开${name}`,
        content: devtools
          ? '开发者工具不支持跳转其他小程序，已复制链接，请在真机预览中点击，或粘贴到微信聊天/顶部搜索打开'
          : '已复制链接，可粘贴到微信聊天或顶部搜索框打开；若为旧版本微信请升级后重试',
        showCancel: false,
        confirmText: '知道了'
      });
    },
    fail: () => {
      wx.showToast({ title: '打开失败，请更新微信版本', icon: 'none' });
    }
  });
}
