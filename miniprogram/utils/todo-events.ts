// utils/todo-events.ts
// 待办「写操作」跨层广播总线（零依赖，避免与 cloud.ts / todo-store.ts 形成循环引用）
//
// 背景：小程序里待办的写入口分散在首页 composer、看板、小助手、待办面板、模板、详情页等多个地方。
// 若每个入口各自维护刷新逻辑，首页就无法「实时」感知其它页面的新增/修改。
// 这里提供一个极简发布订阅：cloud.ts 在写操作成功后广播，todo-store.ts 订阅并增量更新内存数据源，
// 首页再订阅 store 变化即时重绘 —— 任意位置新建待办，首页立刻可见，无需手动下拉刷新。

export type WriteAction =
  | 'add'
  | 'update'
  | 'toggle'
  | 'archive'
  | 'delete'
  | 'clearCompleted'
  | 'move'
  /** 批量写入（如模板一键应用），无法逐条广播 id，订阅方按需增量重同步 */
  | 'bulkAdd';

export interface WriteEvent {
  /** 写操作类型 */
  action: WriteAction;
  /** 目标条目 id（add 时为服务端返回的真实 id） */
  id?: string;
  /** 原始调用参数，便于本地无请求地回填字段 */
  params?: Record<string, unknown>;
}

type WriteListener = (e: WriteEvent) => void;

const listeners: WriteListener[] = [];

/** 写操作成功回调（返回取消订阅函数） */
export function onWrite(fn: WriteListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** 广播写操作；用 try/catch 隔离，任一订阅者异常不影响其它订阅者与主流程 */
export function emitWrite(e: WriteEvent): void {
  if (!e || !e.action) return;
  // 复制一份再遍历，防止回调中增删订阅导致索引错乱
  const snapshot = listeners.slice();
  for (const fn of snapshot) {
    try {
      fn(e);
    } catch (err) {
      console.error('[todo-events] listener error:', err);
    }
  }
}
