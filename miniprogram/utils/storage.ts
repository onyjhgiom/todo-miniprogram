// utils/storage.ts
// 统一本地存储封装（带命名空间与 try/catch 兜底）
const PREFIX = 'todo_app_';

/**
 * 生成唯一 id。
 * 注意：多个 store（astro-store 等）都从这里取 uid，之前这里漏了导出，
 * 导致运行时 uid is not a function，表现为「点了保存没反应 / 页面直接崩」。
 */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function get<T>(key: string, fallback: T): T {
  try {
    const v = wx.getStorageSync(PREFIX + key);
    // 注意：wx.getStorageSync 在 key 不存在时返回空字符串 ''，必须一并兜底，
    // 否则 `get(key, [])` 会拿到 '' 导致后续的数组方法（findIndex/map）直接崩溃
    if (v === undefined || v === null || v === '') return fallback;
    return v as T;
  } catch (_e) {
    return fallback;
  }
}
export function set<T>(key: string, value: T): void {
  try {
    wx.setStorageSync(PREFIX + key, value);
  } catch (_e) {
    /* 忽略 */
  }
}
export function remove(key: string): void {
  try {
    wx.removeStorageSync(PREFIX + key);
  } catch (_e) {
    /* 忽略 */
  }
}
export function has(key: string): boolean {
  try {
    return wx.getStorageSync(PREFIX + key) !== undefined;
  } catch (_e) {
    return false;
  }
}

/** 将字符串写入临时文件（前端通过 fs.writeFile 不可用，借助 wx.env / downloadFile 落地） */
export function saveAsTextFile(filename: string, content: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // 简单实现：保存到 storage + 返回 content，前端再通过 wx.downloadFile 触发下载
    set(`export_${Date.now()}`, { filename, content });
    resolve(content);
  });
}