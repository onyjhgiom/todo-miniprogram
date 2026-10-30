// utils/export.ts
// 导出工具：直接读取【本地分片】生成备份，不依赖任何云端云函数。
//
// 设计取舍（对应「清缓存会丢数据」的焦虑）：
//   - 之前 runExport 走 callFn('export') 云端云函数。本地模式下虽会降级到 mock 读本地，
//     但一旦 envId 配了真云、而 export 云函数没部署，这次失败会把全局 cloudDegraded 置真，
//     连带把 todos/subtasks 也拖进本地模式 —— 副作用太大。
//   - 改为直接读本地 shard：导出永远可用（无论是否连云、无论哪个云函数没部署），
//     且不会误触发全局降级。备份的本质就是「把本机数据拿出来」，本就不该依赖网络。
import * as shard from './todo-shard';

/** 子任务本地存储 key（与 cloud.ts mock 保持一致） */
const SUB_KEY = '__todo_mock_subtasks__';

interface ExportPayload {
  format: 'json' | 'csv';
  filename: string;
  content: string;
  total: number;
  subtasks?: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildFilename(ext: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  return `todo-backup-${stamp}.${ext}`;
}

/** 读本地全量待办 + 子任务（本地模式 / 云端模式都能拿到当前本机数据） */
function loadLocalData(): { todos: any[]; subtasks: any[] } {
  let todos: any[] = [];
  try {
    todos = shard.loadAll();
  } catch (_e) {
    todos = [];
  }
  let subtasks: any[] = [];
  try {
    const raw = wx.getStorageSync(SUB_KEY);
    if (Array.isArray(raw)) subtasks = raw;
  } catch (_e) {
    subtasks = [];
  }
  return { todos, subtasks };
}

/**
 * 生成备份内容（纯本地，零网络）。
 * JSON 保留完整结构（便于日后导入恢复）；CSV 扁平化便于 Excel 分析。
 */
export async function runExport(action: 'json' | 'csv'): Promise<ExportPayload> {
  const { todos, subtasks } = loadLocalData();

  if (action === 'json') {
    const content = JSON.stringify(
      { exportedAt: Date.now(), version: 1, total: todos.length, todos, subtasks },
      null,
      2
    );
    return { format: 'json', filename: buildFilename('json'), content, total: todos.length, subtasks: subtasks.length };
  }

  // CSV
  const header = ['id', 'content', 'completed', 'priority', 'dueDate', 'createTime', 'updateTime', 'location', 'tags', 'people', 'archived'];
  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const lines = [header.join(',')];
  for (const t of todos) {
    lines.push(
      [
        esc(t._id),
        esc(t.content),
        t.completed ? 1 : 0,
        esc(t.priority),
        t.dueDate ? new Date(t.dueDate).toISOString() : '',
        t.createTime ? new Date(t.createTime).toISOString() : '',
        t.updateTime ? new Date(t.updateTime).toISOString() : '',
        esc(t.location),
        esc((t.tags || []).join('|')),
        esc((t.people || []).join('|')),
        t.archived ? 1 : 0
      ].join(',')
    );
  }
  return { format: 'csv', filename: buildFilename('csv'), content: lines.join('\n'), total: todos.length, subtasks: subtasks.length };
}

/**
 * 把内容写进小程序私有目录（wx.env.USER_DATA_PATH），供「转发 / 用其他应用打开」取出。
 * 真机下该目录用户不可直接浏览，需配合 wx.openDocument / wx.shareFileMessage 转发给自己。
 */
export function saveExportToLocal(filename: string, content: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/${filename}`;
    fs.writeFile({
      filePath,
      data: content,
      encoding: 'utf8',
      success: () => resolve(filePath),
      fail: (err) => reject(err)
    });
  });
}

/** 真正复制到系统剪贴板（最通用、跨设备的取回方式） */
export function copyToClipboard(text: string): void {
  wx.setClipboardData({
    data: text,
    success: () => wx.showToast({ title: '已复制，可粘贴保存', icon: 'none' }),
    fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
  });
}
