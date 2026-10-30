// utils/recruit-ui.ts
// 秋招助手 · 交互反馈工具层
//
// 只解决「操作手感」问题，不碰任何业务数据与存储：
//   1) 防连点：同一动作短时间内重复触发直接忽略，避免入栈两次 / 重复写库
//   2) 加载反馈：异步动作统一带遮罩，且不会一闪而过（有最小展示时长）
//   3) 确认框：危险操作统一走同一套文案与配色，减少误触
//   4) 触感：破坏性操作给一次轻振动，让「删掉了」这件事有实感
//   5) 防抖：输入类动作合并成一次计算，减少输入卡顿
//
// 所有函数都做了失败兜底（try/catch + 老版本兼容），
// 在不支持某个 API 的基础库上会静默降级，绝不影响主流程。

/** 防连点记录表：key → 上次触发时间 */
const _lastTap: Record<string, number> = {};

/**
 * 防连点：返回 true 表示「这次可以执行」。
 * @param key 动作标识，同一动作共用一个 key
 * @param ms  间隔，默认 600ms（覆盖「点两下」的典型间隔）
 */
export function guardTap(key: string, ms = 600): boolean {
  const now = Date.now();
  const last = _lastTap[key] || 0;
  if (now - last < ms) return false;
  _lastTap[key] = now;
  return true;
}

/** 手动清除某个动作的防连点记录（例如操作完成后允许立即再次执行） */
export function resetTap(key: string): void {
  delete _lastTap[key];
}

/**
 * 带遮罩地执行一个异步动作。
 * 遮罩有 180ms 最小展示时长 —— 太快完成时不闪，慢时给用户明确进度。
 */
export async function withLoading<T>(title: string, task: () => Promise<T> | T): Promise<T> {
  const started = Date.now();
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    try { wx.showLoading({ title, mask: true }); } catch (e) { /* 忽略 */ }
  }, 120);
  try {
    return await task();
  } finally {
    clearTimeout(timer);
    if (shown) {
      const rest = 180 - (Date.now() - started);
      if (rest > 0) await new Promise<void>((r) => setTimeout(() => r(), rest));
      try { wx.hideLoading(); } catch (e) { /* 忽略 */ }
    }
  }
}

/** 统一确认框，危险操作专用（确认色为红） */
export function confirmDanger(opts: {
  title: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: opts.title,
      content: opts.content,
      confirmText: opts.confirmText || '删除',
      cancelText: opts.cancelText || '取消',
      confirmColor: '#C0522F',
      success: (r) => {
        const ok = !!r.confirm;
        if (ok) haptic('medium');
        resolve(ok);
      },
      fail: () => resolve(false)
    });
  });
}

/** 轻振动反馈，让关键操作「有实感」；不支持时静默跳过 */
export function haptic(kind: 'light' | 'medium' | 'heavy' = 'light'): void {
  try {
    const w = wx as any;
    if (typeof w.vibrateShort === 'function') {
      w.vibrateShort({ type: kind, fail: () => undefined });
    }
  } catch (e) {
    /* 不支持振动的设备直接忽略 */
  }
}

/** 防抖：输入过程中只保留最后一次触发 */
export function debounce(key: string, ms: number, fn: () => void): void {
  const store: Record<string, number> = _debounceTimers;
  if (store[key]) clearTimeout(store[key]);
  store[key] = setTimeout(fn, ms) as unknown as number;
}

/** 取消尚未触发的防抖任务（例如清空搜索后立刻刷新，避免多余的重复计算） */
export function cancelDebounce(key: string): void {
  if (_debounceTimers[key]) {
    clearTimeout(_debounceTimers[key]);
    delete _debounceTimers[key];
  }
}
const _debounceTimers: Record<string, number> = {};

/**
 * 表单校验：返回「字段名 → 错误文案」。
 * 只做必填与格式校验，不做任何内容改写。
 */
export interface FieldRule {
  field: string;
  label: string;
  value: string;
  required?: boolean;
  /** 额外校验，返回错误文案；通过返回空串 */
  check?: (v: string) => string;
}

export function validateFields(rules: FieldRule[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const r of rules) {
    const v = (r.value || '').trim();
    if (r.required && !v) {
      errors[r.field] = `请填写${r.label}`;
      continue;
    }
    if (v && r.check) {
      const msg = r.check(v);
      if (msg) errors[r.field] = msg;
    }
  }
  return errors;
}

/** 把错误表转成「首个错误文案」，用于 toast 提示 */
export function firstError(errors: Record<string, string>): string {
  for (const k of Object.keys(errors)) return errors[k];
  return '';
}
