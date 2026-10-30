// utils/love-page.ts
// 爱遇小栈 · 页面初始化小工具（皮肤注入 + 导航栏同步 + 轻量交互守卫）
//
// 每个页面 onShow 都要做的事抽到这里，避免十个页面各写一遍导致不一致。
import { getSkinKey, onTopic } from './love-store';
import { buildSkinStyle, getSkin, isDarkSkin } from './love-skin';
import type { SkinKey } from './love-types';

export interface SkinView {
  key: SkinKey;
  style: string;
  dark: boolean;
  name: string;
  emoji: string;
}

/** 读取当前皮肤并生成可绑定的根节点 style */
export function skinView(): SkinView {
  const key = getSkinKey();
  const def = getSkin(key);
  return {
    key,
    style: buildSkinStyle(key),
    dark: !!def.dark,
    name: def.name,
    emoji: def.emoji
  };
}

/** 把皮肤应用到页面（data）并同步导航栏 */
export function applySkin(): SkinView {
  const v = skinView();
  syncLoveNavBar(v);
  return v;
}

/** 导航栏跟着皮肤走：深色皮肤用深色底 + 白色前景 */
export function syncLoveNavBar(v?: SkinView): void {
  const s = v || skinView();
  try {
    wx.setNavigationBarColor({
      frontColor: s.dark ? '#ffffff' : '#000000',
      backgroundColor: getSkin(s.key).vars['nav'] || getSkin(s.key).vars['primary'],
      fail: () => undefined
    });
  } catch (e) { /* 忽略 */ }
}

/** 订阅皮肤变化，页面 onLoad 里用；返回取消函数，onUnload 里调 */
export function watchSkin(fn: () => void): () => void {
  return onTopic('skin', fn);
}

/* ============================ 交互守卫 ============================ */

const tapAt: Record<string, number> = {};

/** 防连点：同一个 key 在 ms 内重复触发直接忽略 */
export function guardTap(key: string, ms = 500): boolean {
  const now = Date.now();
  if (tapAt[key] && now - tapAt[key] < ms) return false;
  tapAt[key] = now;
  return true;
}

/**
 * 带最小展示时长的 loading。
 * 太快的请求会让 loading 一闪而过，反而像 bug；这里保证至少展示 minMs。
 */
export async function withLoading<T>(fn: () => Promise<T>, title = '处理中', minMs = 260): Promise<T> {
  const t0 = Date.now();
  try {
    wx.showLoading({ title, mask: true });
  } catch (e) { /* 忽略 */ }
  try {
    const r = await fn();
    const wait = Math.max(0, minMs - (Date.now() - t0));
    if (wait > 0) await new Promise<void>((res) => setTimeout(() => res(), wait));
    return r;
  } finally {
    try {
      wx.hideLoading();
    } catch (e) { /* 忽略 */ }
  }
}

/** 危险操作二次确认 */
export function confirmDanger(content: string, onOk: () => void, title = '确认删除'): void {
  wx.showModal({
    title,
    content,
    confirmColor: '#E0486E',
    success: (r: { confirm?: boolean }) => {
      if (r.confirm) onOk();
    }
  });
}

export function toast(title: string, icon: 'none' | 'success' | 'loading' | 'error' = 'none'): void {
  wx.showToast({ title, icon, duration: 1800 });
}

/**
 * 轻量单行编辑：弹窗输入，返回去空白后的字符串；取消或失败返回 null。
 * 用于「点字段即改」——比在小输入框里精确定位光标更快，移动端友好。
 */
export function quickEdit(opts: { title: string; value?: string; placeholder?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      wx.showModal({
        title: opts.title,
        editable: true,
        placeholderText: opts.placeholder || '',
        content: opts.value || '',
        success: (r: { confirm?: boolean; content?: string }) => {
          if (r.confirm) resolve((r.content || '').trim());
          else resolve(null);
        },
        fail: () => resolve(null)
      });
    } catch (e) {
      resolve(null);
    }
  });
}
