// utils/cloud.ts
// 统一封装云函数调用 + 本地回退（无云开发时自动 mock）
// Phase 1 升级：mock 支持 todos/subtasks/templates/export 全部 action
// Phase 3 升级：
//   - 写操作成功后广播事件（todo-events），使任意页面的新增/修改能在首页实时生效
//   - todos 本地存储改为分片（todo-shard），支持上万条数据且写入 O(1)
//   - 新增 getOne / count 与游标分页，替代旧版「全量 list + 内存 find」的 O(n) 取数
import type {
  ITodo,
  ISubtask,
  INote,
  CloudResult,
  TodoAction,
  TodoEventPayload,
  SubtaskAction,
  SubtaskEventPayload,
  TemplateAction,
  TemplateEventPayload,
  IAttachment,
  IReminder
} from '../types/index';
import { emitWrite, type WriteAction } from './todo-events';
import * as shard from './todo-shard';

/** 旧版单 key（仅保留常量用于 mock 清理与迁移识别） */
const TODO_KEY = '__todo_mock_todos__';
const SUB_KEY = '__todo_mock_subtasks__';
const TPL_KEY = '__todo_mock_templates__';
const POMO_LOG_KEY = '__todo_mock_pomo_logs__';
const NOTE_KEY = '__todo_mock_notes__';

function isCloudReady(envId: string | undefined): boolean {
  return (
    typeof wx !== 'undefined' &&
    !!wx.cloud &&
    !!envId &&
    envId !== 'your-env-id' &&
    !/^your-/.test(envId)
  );
}

/* ============== 云端故障自动降级 ============== */
// 云端系统级故障特征（函数未部署 / 网关无响应 / 轮询超时 / 环境异常）
// 命中时自动降级为本地 mock，调试不中断；下次云端调用成功自动恢复
let cloudDegraded = false;

/**
 * 数据库集合不存在：`collection.get:fail -502005 database collection not exists`
 * 触发场景：云开发控制台里从没建过 `todos` / `subtasks` / `templates` 集合
 * （集合不会自动创建，必须手动新建），或集合名拼写不一致。
 *
 * 这类错误和「云函数未部署」同级 —— 云端**确定不可用且会持续失败**：
 *   - 不降级 → 每次进首页 sync 都会失败，把这段技术原文原样 toast 给用户；
 *   - 导出等依赖云端的旧入口同样报错（现导出已改本地直读，不受影响）。
 * 故纳入自动降级：整体切本地模式，数据照样能读写、能导出。
 *
 * ⚠️ 必须定义在 DEGRADE_PATTERNS 之前：后者用展开运算符引用它。
 *    const 不参与变量提升，若写在后面，模块加载时就会抛
 *    「Cannot access 'DB_MISSING_PATTERNS' before initialization」，整个 cloud.ts 崩溃。
 */
const DB_MISSING_PATTERNS: string[] = [
  '-502005',
  'collection not exists',
  'db or table not exist',
  '集合不存在'
];

const DEGRADE_PATTERNS: string[] = [
  'no baseresponse',            // 云函数不存在或网关无响应
  'polling exceed max timeout', // 云端轮询超时 (-404012)
  '-404012',
  '-404011',                    // 函数不存在
  '-501000',                    // FunctionName parameter could not be found（云函数未部署）
  'FunctionName parameter could not be found',
  'FUNCTION_NOT_FOUND',
  'FUNCTIONS_NOT_FOUND',
  'resource function not found',
  'cloud function not found',
  ...DB_MISSING_PATTERNS        // 数据库集合不存在（-502005）
];

/** 错误对象 / 错误文案 → 是否属于「数据库集合不存在」 */
export function isDbMissing(err: unknown): boolean {
  if (!err) return false;
  const msg =
    typeof err === 'string'
      ? err
      : `${(err as { errMsg?: string }).errMsg || ''} ${(err as { message?: string }).message || ''}`;
  if (!msg) return false;
  return DB_MISSING_PATTERNS.some((p) => msg.toLowerCase().indexOf(p.toLowerCase()) >= 0);
}

function isCloudSystemError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { errMsg?: string; message?: string };
  const msg = `${e.errMsg || ''} ${e.message || ''}`;
  if (!msg) return false;
  return DEGRADE_PATTERNS.some((p) => msg.indexOf(p) >= 0);
}

/* ============== 入参过大识别（务必排在云端故障判定之前） ============== */
// wx.cloud.callFunction 的 data 存在链路传输大小限制（官方建议临界值 100KB）。
// 把 base64 图片塞进 data 超限时：
//   iOS      → errMsg: cloud.callFunction:fail Error: data exceed max size
//   安卓     → errCode: -404012 polling exceed max timeout（与「真·云端超时」同码）
//   老表现   → system error (Error: data no response)
// 这三类都**不是**云端故障。若按 DEGRADE_PATTERNS 降级为本地 mock，
// mock 会返回 AI_NOT_CONFIGURED，界面就会把「图片太大」谎报成「AI 未配置」——
// 这正是「上传图片后大模型识别不了」的假象来源。故此处单独识别并原样抛出。
const PAYLOAD_TOO_LARGE_PATTERNS: string[] = [
  'data exceed max size',
  'data no response',
  'exceed max size',
  'request data size',
  '数据超限',
  '数据过大'
];

function isPayloadTooLarge(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { errMsg?: string; message?: string };
  const msg = `${e.errMsg || ''} ${e.message || ''}`;
  if (!msg) return false;
  return PAYLOAD_TOO_LARGE_PATTERNS.some((p) => msg.indexOf(p) >= 0);
}

/** 本次调用是否携带了大字段（base64 图片） */
function hasLargePayload(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const v = data.imageBase64;
  return typeof v === 'string' && v.length > 64 * 1024;
}

/* ============== 云函数版本能力探测 ============== */
// 云函数改造后若未重新部署，线上仍是旧版本 → 新 action 会返回 { success:false, error:'未知 action: xxx' }。
// 这里把「不支持」缓存下来：调用方可以提前判断走降级路径，且同一 action 只提示一次，避免刷屏。

/** `函数名.action` → 云端不支持 */
const unsupportedActions = new Set<string>();
const unsupportedWarned = new Set<string>();
const UNSUPPORTED_RE = /未知\s*action|unknown\s*action/i;

/** 服务端没有这条记录（本地独有 / 云端已被删除 / 数据被清空过） */
const MISSING_PATTERNS: string[] = [
  '任务不存在',
  '不存在或无权限',
  '记录不存在',
  'record not exist',
  'document does not exist'
];

export type CloudErrorCode = 'UNSUPPORTED_ACTION' | 'MISSING_RECORD' | 'PAYLOAD_TOO_LARGE' | 'AI_TIMEOUT';

/**
 * 是否属于「AI 类调用」。
 *
 * AI 请求天然慢（大模型 3~30s 波动），超时是常态，**不代表云端坏了**。
 * 必须与数据类调用区别对待，否则 AI 一超时就会命中 DEGRADE_PATTERNS：
 *   · `cloudDegraded` 被置位 → 当次调用直接返回 mock（AI 拿到的是
 *     「云端不可达」，而不是「生成超时」，文案把用户带偏到「是不是没部署」）；
 *   · 同时弹出「云端暂不可用，已切换本地模式」—— 用户会以为整个模块坏了。
 * 注意 `cloudDegraded` 只影响**当次**降级与提示（不阻止后续再试云端），
 * 所以这里要防的是「误导性提示 + 错误文案」，而不是「永久降级」。
 */
function isAiCall(name: string, data: Record<string, unknown> | undefined): boolean {
  const action =
    data && typeof data.action === 'string' ? (data as { action: string }).action : '';
  if (/^ai[A-Z]/.test(action)) return true; // aiPlan / aiChat / aiStatus / aiAnalyze …
  return (
    name === 'goalPlanner' ||
    name === 'civilAI' ||
    name === 'helperChat'
  );
}

export interface CloudCallError extends Error {
  code?: CloudErrorCode;
}

/** 云端是否已支持该 action（未知的一律当作支持，先试一次） */
export function isActionSupported(name: string, action: string): boolean {
  return !unsupportedActions.has(`${name}.${action}`);
}

function markUnsupported(name: string, action: string): void {
  unsupportedActions.add(`${name}.${action}`);
  const key = `${name}.${action}`;
  if (unsupportedWarned.has(key)) return;
  unsupportedWarned.add(key);
  console.warn(
    `[cloud] 云端云函数版本过旧，不支持 action「${action}」，本次已走本地降级。` +
      `请在微信开发者工具右键 cloudfunctions/${name} → 上传并部署，否则分页/详情等新能力不生效。`
  );
}

export function isMissingMessage(msg: unknown): boolean {
  if (typeof msg !== 'string' || !msg) return false;
  return MISSING_PATTERNS.some((p) => msg.indexOf(p) >= 0);
}

/** 判断一次写失败是否属于「服务端没这条记录」——此时本地改动应当保留，不应回滚 */
export function isMissingOnServer(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'string') return isMissingMessage(err);
  const e = err as { code?: string; message?: string; errMsg?: string };
  if (e.code === 'MISSING_RECORD') return true;
  return isMissingMessage(e.message) || isMissingMessage(e.errMsg);
}

function makeCallError(code: CloudErrorCode, message: string): CloudCallError {
  const err = new Error(message) as CloudCallError;
  err.code = code;
  return err;
}

export interface ToastOptions {
  title: string;
  icon?: 'success' | 'error' | 'none' | 'loading';
  duration?: number;
}

/* ============== 写操作广播 ============== */
// 待办的写入口分散在首页 composer / 看板 / 小助手 / 待办面板 / 模板 / 详情页。
// 在这里统一「写成功后广播」，任意页面新增或修改，首页都能即时看到，无需手动刷新。
const WRITE_ACTIONS: Record<string, WriteAction> = {
  add: 'add',
  update: 'update',
  toggle: 'toggle',
  archive: 'archive',
  delete: 'delete',
  clearCompleted: 'clearCompleted',
  move: 'move'
};

function broadcastWrite(
  name: string,
  data: Record<string, unknown>,
  result: { success?: boolean; id?: string } | null | undefined
): void {
  if (!data) return;
  if (result && result.success === false) return;

  // 模板「一键应用」会批量创建待办：把生成的完整待办透传下去，
  // 订阅方（首页）即可乐观插入、零延迟可见，无需等待增量同步
  if (name === 'templates' && data.action === 'apply') {
    const items = (result && (result as { items?: unknown[] }).items) || [];
    emitWrite({ action: 'bulkAdd', params: { items } });
    return;
  }

  if (name !== 'todos') return;
  const action = typeof data.action === 'string' ? WRITE_ACTIONS[data.action] : undefined;
  if (!action) return;

  const params: Record<string, unknown> = {};
  Object.keys(data).forEach((k) => {
    if (k !== 'action') params[k] = data[k];
  });
  // add 的真实 id 由服务端返回，其余操作以入参 id 为准
  const id = action === 'add' ? result?.id : (data.id as string | undefined);
  emitWrite({ action, id, params });
}

export function callFn<T extends CloudResult = CloudResult>(
  name: string,
  data: TodoEventPayload | SubtaskEventPayload | TemplateEventPayload | Record<string, unknown> = {}
): Promise<T> {
  const app = getApp && getApp();
  const envId = app?.globalData?.envId;

  if (!isCloudReady(envId)) {
    return mockCall<T>(name, data).then((r) => {
      broadcastWrite(name, data as Record<string, unknown>, r as { success?: boolean; id?: string });
      return r;
    });
  }

  return new Promise<T>((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: (data as Record<string, unknown>) || {},
      success: (res) => {
        const r = res.result as T;
        if (r && r.success === false) {
          const msg = r.error || '云函数业务失败';
          const action = (data as Record<string, unknown>).action;
          // 数据库集合不存在（-502005）：云函数「跑通了但降不了」——
          // 它把 SDK 报错包成 { success:false, error:'collection.get:fail -502005 …' } 正常返回，
          // 走不到下面的 fail 回调。若按普通业务失败处理，用户只会看到一长串技术原文。
          // 这类错误与「云函数未部署」同级：云端持续不可用 → 整体切本地模式，数据照样读写。
          if (isDbMissing(msg) && !isAiCall(name, data as Record<string, unknown>)) {
            if (!cloudDegraded) {
              cloudDegraded = true;
              console.warn('[cloud] 云数据库集合不存在，自动切换本地模式（数据暂存本机）:', msg);
              wx.showToast({
                title: '云端数据库未初始化，已切换本地模式',
                icon: 'none',
                duration: 2500
              });
            }
            mockCall<T>(
              name,
              data as TodoEventPayload | SubtaskEventPayload | TemplateEventPayload | Record<string, unknown>
            )
              .then((m) => {
                broadcastWrite(name, data as Record<string, unknown>, m as { success?: boolean; id?: string });
                resolve(m);
              })
              .catch(reject);
            return;
          }
          // 云函数版本过旧：新 action 在服务端落到 default 分支，返回「未知 action」
          if (UNSUPPORTED_RE.test(msg) && typeof action === 'string') {
            markUnsupported(name, action);
            reject(makeCallError('UNSUPPORTED_ACTION', msg));
          } else if (isMissingMessage(msg)) {
            reject(makeCallError('MISSING_RECORD', msg));
          } else {
            // 附带云端的 message：前端按 ':' 前的 code 匹配文案，多出来的诊断信息
            // 会显示在兜底提示里，便于用户 / 开发者定位真实原因
            const detail = (r as { message?: string } | null)?.message;
            reject(new Error(detail ? `${msg}:${detail}` : msg));
          }
        } else {
          // 写操作成功 → 广播，让所有订阅方（首页等）实时更新
          broadcastWrite(name, data as Record<string, unknown>, r as { success?: boolean; id?: string });
          // 云端调用成功，退出降级模式
          if (cloudDegraded) {
            cloudDegraded = false;
            console.warn('[cloud] 云端已恢复，切回云端模式');
          }
          resolve(r);
        }
      },
      fail: (err) => {
        // AI 类调用：超时 / 网络抖动都不算「云端故障」。
        // 若让它按下面的 DEGRADE_PATTERNS 整体降级，会把数据同步一起打成本地模式 ——
        // 「用过一次 AI 之后，保存的东西就不上云了」就是这么来的。
        // 这里单独给可读错误码，交由调用方（AI 页面）走自己的兜底提示。
        if (isAiCall(name, data as Record<string, unknown>)) {
          const e = err as { errMsg?: string; message?: string };
          const m = String(e?.errMsg || e?.message || '');
          if (/polling exceed max timeout|-404012|TIMEOUT|timeout/i.test(m)) {
            reject(makeCallError('AI_TIMEOUT', 'AI 生成较慢，本次未完成，请重试或减少天数'));
            return;
          }
          reject(err);
          return;
        }
        // 入参过大：不是云端故障，绝不能降级为本地 mock —— 否则「图片太大」会被
        // 谎报成「AI 未配置」。安卓的 -404012 与真·云端超时同码，
        // 因此仅当本次确实携带了 base64 大字段时才按「过大」处理。
        if (
          isPayloadTooLarge(err) ||
          (hasLargePayload(data as Record<string, unknown>) && isCloudSystemError(err))
        ) {
          reject(
            makeCallError(
              'PAYLOAD_TOO_LARGE',
              '图片数据过大，已被微信云调用链路拒绝。请改用更小的图片，或改走云存储 fileID 上传'
            )
          );
          return;
        }
        if (isCloudSystemError(err)) {
          // 云端系统级故障（函数未部署 / 网关无响应 / 轮询超时）：
          // 自动降级为本地 mock，保证调试不中断，数据暂存本机
          if (!cloudDegraded) {
            cloudDegraded = true;
            console.warn('[cloud] 云函数不可用，自动切换本地模式（数据暂存本机）:', err);
            wx.showToast({
              title: '云端暂不可用，已切换本地模式',
              icon: 'none',
              duration: 2500
            });
          }
          mockCall<T>(name, data)
            .then((r) => {
              broadcastWrite(name, data as Record<string, unknown>, r as { success?: boolean; id?: string });
              resolve(r);
            })
            .catch(reject);
          return;
        }
        reject(err);
      }
    });
  });
}

export function toast(
  title: string,
  icon: 'success' | 'error' | 'none' | 'loading' = 'none',
  duration = 1500
): void {
  wx.showToast({ title, icon, duration, mask: false });
}

export function handleError(err: unknown, fallbackTitle = '操作失败'): void {
  console.error('[cloud] error:', err);
  let msg: string = fallbackTitle;
  if (err && typeof err === 'object') {
    const e = err as { errMsg?: string; message?: string };
    msg = e.errMsg || e.message || fallbackTitle;
  } else if (typeof err === 'string') {
    msg = err;
  }
  wx.showToast({ title: msg, icon: 'none' });
}

/* ============== Mock 实现 ============== */

function readAll(key: string): unknown[] {
  const raw = wx.getStorageSync(key);
  return Array.isArray(raw) ? raw : [];
}
function writeAll(key: string, list: unknown[]): void {
  wx.setStorageSync(key, list);
}

function uid(prefix: string): string {
  return (
    prefix +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 8)
  );
}
function delay<T>(result: T, ms = 180): Promise<T> {
  return new Promise<T>((resolve) => setTimeout(() => resolve(result), ms));
}

/* ============== mock：todos 分片存储 ============== */
// 旧实现把全部待办塞进单个 storage key：单 key 上限 1MB、且每次写入都要全量序列化 O(n)，
// 数据量上千后 add 会直接写入失败（异常被吞 → 新条目"消失"）。
// 这里复用 utils/todo-shard 的分片实现：内存缓存 + 单条落盘 O(1)。
let mockTodoCache: ITodo[] | null = null;

function mockTodoAll(): ITodo[] {
  if (!mockTodoCache) mockTodoCache = shard.loadAll();
  return mockTodoCache;
}
function mockTodoReplace(list: ITodo[]): void {
  mockTodoCache = list;
  shard.replaceAll(list);
}
function mockTodoUpsert(it: ITodo): void {
  mockTodoAll();
  shard.upsert(it);
}
function mockTodoRemoveById(id: string): void {
  mockTodoAll();
  shard.removeById(id);
}

/** mock 模拟触发提醒 */
function mockRemind(todos: ITodo[], now: number): { scanned: number; sent: number } {
  let scanned = 0;
  let sent = 0;
  for (const t of todos) {
    if (t.completed || t.archived) continue;
    if (!Array.isArray(t.reminders)) continue;
    for (const r of t.reminders) {
      if (!r.sent && r.at <= now) {
        r.sent = true;
        sent += 1;
      }
      scanned += 1;
    }
  }
  return { scanned, sent };
}

/** 主 mock 路由 */
async function mockCall<T extends CloudResult>(
  name: string,
  data: TodoEventPayload | SubtaskEventPayload | TemplateEventPayload | Record<string, unknown>
): Promise<T> {
  if (name === 'todos') {
    return mockTodos<T>(data as TodoEventPayload);
  }
  if (name === 'subtasks') {
    return mockSubtasks<T>(data as SubtaskEventPayload);
  }
  if (name === 'templates') {
    return mockTemplates<T>(data as TemplateEventPayload);
  }
  if (name === 'export') {
    return mockExport<T>(data as Record<string, unknown>);
  }
  if (name === 'pomoLogs') {
    return mockPomoLogs<T>(data as Record<string, unknown>);
  }
  if (name === 'notes') {
    return mockNotes<T>(data as Record<string, unknown>);
  }
  // 目标拆解：本地模式没有大模型可用，明确告知前端走「规则兜底拆解」，
  // 而不是返回看不懂的 mock 错误（前端据此提示用户：当前为通用模板）
  if (name === 'goalPlanner') {
    return {
      success: false,
      error: 'AI_NOT_CONFIGURED',
      message: '本地模式无法调用 AI 拆解，已使用通用模板'
    } as unknown as T;
  }
  // 小助手 AI 对话：本地模式没有大模型可用，明确告知前端走「本地规则引擎」
  if (name === 'helperChat') {
    return {
      success: false,
      error: 'AI_NOT_CONFIGURED',
      message: '本地模式无法调用 AI 对话，已切换本地规则引擎'
    } as unknown as T;
  }
  // 仕途衡鉴 AI（赛道测评 / 备考计划 / 面试点评 / 简历优化）：
  // 本地模式同样没有大模型，但离线仍能给出结果 —— civil 模块内置本地规则引擎
  // （assessLocal / buildPlanLocal）。这里必须给出可读原因，而不是
  // 「mock 未实现函数 civilAI」这种会让人误以为功能坏了的提示。
  if (name === 'civilAI') {
    return {
      success: false,
      error: 'AI_NOT_CONFIGURED',
      message: '本地模式无法调用 AI，已使用本地规则引擎给出结果'
    } as unknown as T;
  }
  // 旅行模式（travel 分包）：本地模式下既没有大模型、也没有云端存储。
  // 这里必须返回可读原因，而不是「mock 未实现函数 travel」——
  // 后者会让人误以为功能坏了（历史上「AI 规划点不动」就被这句话误导过。
  // 真实原因是云函数没部署 / 环境未配置，而不是 travel 模块不支持）。
  if (name === 'travel') {
    const action = (data as Record<string, unknown>).action;
    // AI 能力探测：本地模式直接判死，前端据此提示「配置云开发环境后可用」
    if (action === 'aiStatus') {
      return { success: true, ok: false, ai: false, message: '本地模式无法调用 AI' } as unknown as T;
    }
    return {
      success: false,
      error: 'CLOUD_DEGRADED',
      message: '云端不可达：未成功调用 travel 云函数（常见原因是未部署），已使用本地数据'
    } as unknown as T;
  }
  return { success: false, error: `mock 未实现函数 ${name}` } as unknown as T;
}

function mockTodos<T>(data: TodoEventPayload): Promise<T> {
  const list = mockTodoAll();
  const { action } = data;

  switch (action as TodoAction) {
    case 'list': {
      const sorted = list.slice().sort((a, b) => b.createTime - a.createTime);
      return delay({ success: true, items: sorted, total: sorted.length } as unknown as T);
    }
    case 'listPaged': {
      const page = data.page || 1;
      const pageSize = data.pageSize || 20;
      const showArchived = !!data.archived;
      const scoped = list
        .filter((t) => (showArchived ? !!t.archived : !t.archived))
        .sort((a, b) => b.createTime - a.createTime);
      // 优先使用显式 skip：首屏条数与后续分页条数不同时，用 page 换算会错位漏数据
      const start =
        typeof data.skip === 'number' ? Math.max(0, data.skip) : Math.max(0, (page - 1) * pageSize);
      const items = scoped.slice(start, start + pageSize);
      const nextCursor = items.length ? items[items.length - 1].createTime : 0;
      return delay({
        success: true,
        items,
        total: scoped.length,
        page,
        pageSize,
        cursor: nextCursor,
        hasMore: start + items.length < scoped.length
      } as unknown as T);
    }
    case 'listSince': {
      // 增量同步：按 updateTime 升序返回 since 之后发生变化的条目（与云函数语义一致）
      const since =
        typeof data.since === 'number'
          ? data.since
          : typeof data.cursor === 'number'
            ? data.cursor
            : 0;
      const pageSize = data.pageSize || 500;
      const scoped = list
        .filter((t) => !t.archived && (t.updateTime || 0) > since)
        .sort((a, b) => (a.updateTime || 0) - (b.updateTime || 0));
      const items = scoped.slice(0, pageSize);
      const nextSince = items.length ? items[items.length - 1].updateTime || since : since;
      return delay({
        success: true,
        items,
        since: nextSince,
        hasMore: scoped.length > items.length
      } as unknown as T);
    }
    case 'getOne': {
      const it = data.id ? list.find((t) => t._id === data.id) : undefined;
      return delay(
        (it ? { success: true, item: it } : { success: false, error: '任务不存在' }) as unknown as T
      );
    }
    case 'count': {
      const total = list.filter((t) => !t.archived).length;
      return delay({ success: true, total } as unknown as T);
    }
    case 'add': {
      const now = Date.now();
      const doc: ITodo = {
        _id: uid('mock_t_'),
        content: (data.content || '').trim(),
        completed: false,
        createTime: now,
        updateTime: now,
        dueDate: data.dueDate ?? null,
        reminded: false,
        priority: data.priority ?? null,
        location: data.location ?? null,
        people: Array.isArray(data.people) ? data.people : [],
        tags: Array.isArray(data.tags) ? data.tags : [],
        description: data.description ?? null,
        recurrence: data.recurrence ?? null,
        reminders: Array.isArray(data.reminders) ? data.reminders : [],
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
        quadrant: data.quadrant ?? null,
        archived: false,
        archivedAt: null,
        subtaskCount: 0,
        subtaskDoneCount: 0,
        order: data.order ?? now
      };
      if (!doc.content) {
        return delay({ success: false, error: 'content 不能为空' } as unknown as T);
      }
      list.push(doc);
      mockTodoUpsert(doc); // 只落盘 1 个分片，O(1)
      return delay({ success: true, id: doc._id } as unknown as T);
    }
    case 'update': {
      const idx = list.findIndex((t) => t._id === data.id);
      if (idx < 0) return delay({ success: false, error: '任务不存在' } as unknown as T);
      const t = list[idx];
      if (data.content !== undefined) t.content = (data.content || '').trim();
      if (data.dueDate !== undefined) { t.dueDate = data.dueDate; t.reminded = false; }
      if (data.priority !== undefined) t.priority = data.priority;
      if (data.location !== undefined) t.location = data.location;
      if (data.people !== undefined) t.people = data.people;
      if (data.tags !== undefined) t.tags = data.tags;
      if (data.description !== undefined) t.description = data.description;
      if (data.recurrence !== undefined) t.recurrence = data.recurrence;
      if (data.reminders !== undefined) t.reminders = data.reminders;
      if (data.attachments !== undefined) t.attachments = data.attachments;
      if (data.quadrant !== undefined) t.quadrant = data.quadrant;
      if (data.order !== undefined) t.order = data.order;
      t.updateTime = Date.now();
      mockTodoUpsert(t);
      return delay({ success: true, updated: 1 } as unknown as T);
    }
    case 'toggle': {
      const idx = list.findIndex((t) => t._id === data.id);
      if (idx < 0) return delay({ success: false, error: '任务不存在' } as unknown as T);
      list[idx].completed = !!data.completed;
      list[idx].completedTime = data.completed ? Date.now() : null;
      list[idx].updateTime = Date.now();
      mockTodoUpsert(list[idx]);
      return delay({ success: true, updated: 1 } as unknown as T);
    }
    case 'archive': {
      const idx = list.findIndex((t) => t._id === data.id);
      if (idx < 0) return delay({ success: false, error: '任务不存在' } as unknown as T);
      const flag = data.archived !== false;
      list[idx].archived = flag;
      list[idx].archivedAt = flag ? Date.now() : null;
      list[idx].updateTime = Date.now();
      mockTodoUpsert(list[idx]);
      return delay({ success: true, updated: 1 } as unknown as T);
    }
    case 'move': {
      const idx = list.findIndex((t) => t._id === data.id);
      if (idx < 0) return delay({ success: false, error: '任务不存在' } as unknown as T);
      list[idx].order = data.order || Date.now();
      list[idx].updateTime = Date.now();
      mockTodoUpsert(list[idx]);
      return delay({ success: true, updated: 1 } as unknown as T);
    }
    case 'delete': {
      const before = list.length;
      const next = list.filter((t) => t._id !== data.id);
      mockTodoCache = next;
      if (data.id) mockTodoRemoveById(data.id);
      // 同时删除子任务
      const subs = readAll(SUB_KEY) as ISubtask[];
      writeAll(SUB_KEY, subs.filter((s) => s.todoId !== data.id));
      return delay({ success: true, removed: before - next.length } as unknown as T);
    }
    case 'clearCompleted': {
      const before = list.length;
      const next = list.filter((t) => !t.completed);
      mockTodoReplace(next);
      return delay({ success: true, removed: before - next.length } as unknown as T);
    }
    case 'remind': {
      const r = mockRemind(list, Date.now());
      // 提醒状态有新变化才落盘
      if (r.sent > 0) {
        for (const t of list) {
          if (Array.isArray(t.reminders) && t.reminders.some((x) => x.sent)) mockTodoUpsert(t);
        }
      }
      return delay({ success: true, scanned: r.scanned, sent: r.sent } as unknown as T);
    }
    default:
      return delay({ success: false, error: `未知 action: ${action}` } as unknown as T);
  }
}

function mockSubtasks<T>(data: SubtaskEventPayload): Promise<T> {
  const subs = readAll(SUB_KEY) as ISubtask[];
  const { action } = data;
  switch (action as SubtaskAction) {
    case 'listByTodo': {
      const items = subs.filter((s) => s.todoId === data.todoId).sort((a, b) => (a.order || 0) - (b.order || 0));
      return delay({ success: true, items } as unknown as T);
    }
    case 'countByTodo': {
      const items = subs.filter((s) => s.todoId === data.todoId);
      const done = items.filter((s) => s.completed).length;
      return delay({ success: true, total: items.length, done } as unknown as T);
    }
    case 'add': {
      const now = Date.now();
      const doc: ISubtask = {
        _id: uid('mock_s_'),
        todoId: data.todoId || '',
        content: (data.content || '').trim(),
        completed: false,
        order: data.order || now,
        createTime: now,
        updateTime: now
      };
      if (!doc.todoId || !doc.content) {
        return delay({ success: false, error: 'todoId / content 必填' } as unknown as T);
      }
      subs.push(doc);
      writeAll(SUB_KEY, subs);
      return delay({ success: true, id: doc._id } as unknown as T);
    }
    case 'update': {
      const idx = subs.findIndex((s) => s._id === data.id);
      if (idx < 0) return delay({ success: false, error: '子任务不存在' } as unknown as T);
      if (data.content !== undefined) subs[idx].content = data.content;
      if (data.order !== undefined) subs[idx].order = data.order;
      subs[idx].updateTime = Date.now();
      writeAll(SUB_KEY, subs);
      return delay({ success: true, updated: 1 } as unknown as T);
    }
    case 'toggle': {
      const idx = subs.findIndex((s) => s._id === data.id);
      if (idx < 0) return delay({ success: false, error: '子任务不存在' } as unknown as T);
      subs[idx].completed = !!data.completed;
      subs[idx].updateTime = Date.now();
      writeAll(SUB_KEY, subs);
      return delay({ success: true, updated: 1 } as unknown as T);
    }
    case 'delete': {
      const before = subs.length;
      const next = subs.filter((s) => s._id !== data.id);
      writeAll(SUB_KEY, next);
      return delay({ success: true, removed: before - next.length } as unknown as T);
    }
    case 'clearDone': {
      const before = subs.length;
      const next = subs.filter((s) => !(s.todoId === data.todoId && s.completed));
      writeAll(SUB_KEY, next);
      return delay({ success: true, removed: before - next.length } as unknown as T);
    }
    default:
      return delay({ success: false, error: `未知 action: ${action}` } as unknown as T);
  }
}

/* ============== Mock：系统模板（与云函数 templates 保持一致，14 个 · 5 类） ============== */
interface MockTplItem {
  content: string;
  priority?: 'high' | 'medium' | 'low' | null;
  tags?: string[];
  subtasks?: string[];
  dueOffsetDays?: number | null;
}
interface MockTpl {
  name: string;
  icon: string;
  category: string;
  items: MockTplItem[];
}

const MOCK_SYSTEM_TEMPLATES: MockTpl[] = [
  // ---- 工作计划 ----
  {
    name: '周工作计划', icon: '📅', category: '工作计划',
    items: [
      { content: '梳理本周目标与优先级', priority: 'high', tags: ['规划'], dueOffsetDays: 0 },
      { content: '周一团队例会与任务分配', priority: 'high', tags: ['会议'], dueOffsetDays: 0 },
      { content: '推进核心项目进度', priority: 'high', tags: ['项目'], dueOffsetDays: 2, subtasks: ['同步协作方', '更新里程碑'] },
      { content: '整理本周工作周报', priority: 'medium', tags: ['复盘'], dueOffsetDays: 4 },
      { content: '清理邮箱与待办收件箱', priority: 'low', tags: ['整理'], dueOffsetDays: 5 }
    ]
  },
  {
    name: '会议准备', icon: '📋', category: '工作计划',
    items: [
      { content: '发送会议议程', priority: 'high', dueOffsetDays: 0 },
      { content: '准备演示文稿', priority: 'high', dueOffsetDays: 0, subtasks: ['封面', '目录', '结论页'] },
      { content: '预订会议室', priority: 'medium', dueOffsetDays: 0 },
      { content: '通知参会人', priority: 'medium', dueOffsetDays: -1 }
    ]
  },
  {
    name: '项目上线', icon: '🚀', category: '工作计划',
    items: [
      { content: '代码合并与审查', priority: 'high', tags: ['研发'], dueOffsetDays: 0 },
      { content: '测试用例执行', priority: 'high', tags: ['测试'], dueOffsetDays: 0, subtasks: ['冒烟', '回归', '压力'] },
      { content: '部署到生产环境', priority: 'high', tags: ['发布'], dueOffsetDays: 1 },
      { content: '发布公告', priority: 'medium', tags: ['运营'], dueOffsetDays: 1 }
    ]
  },
  {
    name: '求职面试准备', icon: '💼', category: '工作计划',
    items: [
      { content: '更新简历', priority: 'high', tags: ['求职'], dueOffsetDays: 0, subtasks: ['工作经历', '项目亮点', '技能清单'] },
      { content: '研究目标公司与岗位', priority: 'high', tags: ['求职'], dueOffsetDays: 1 },
      { content: '准备自我介绍与常见问题', priority: 'medium', tags: ['面试'], dueOffsetDays: 2 },
      { content: '模拟面试练习', priority: 'medium', tags: ['面试'], dueOffsetDays: 3 },
      { content: '准备面试着装与路线', priority: 'low', tags: ['面试'], dueOffsetDays: 4 }
    ]
  },
  // ---- 学习任务 ----
  {
    name: '开学准备清单', icon: '🎒', category: '学习任务',
    items: [
      { content: '购买教材', priority: 'high', tags: ['学习'], dueOffsetDays: 0 },
      { content: '准备学习工具', priority: 'medium', tags: ['学习'], dueOffsetDays: 0, subtasks: ['笔', '笔记本', '计算器'] },
      { content: '调整作息时间', priority: 'medium', tags: ['生活'], dueOffsetDays: 1 },
      { content: '制定学期目标', priority: 'low', tags: ['规划'], dueOffsetDays: 3 }
    ]
  },
  {
    name: '考试复习计划', icon: '📖', category: '学习任务',
    items: [
      { content: '整理考试范围与重点', priority: 'high', tags: ['复习'], dueOffsetDays: 0 },
      { content: '第一轮：通读教材', priority: 'high', tags: ['复习'], dueOffsetDays: 3 },
      { content: '第二轮：刷题与错题本', priority: 'high', tags: ['刷题'], dueOffsetDays: 7, subtasks: ['选择题', '大题', '错题复盘'] },
      { content: '第三轮：模拟卷计时训练', priority: 'medium', tags: ['模拟'], dueOffsetDays: 10 },
      { content: '考前知识点速览', priority: 'medium', tags: ['冲刺'], dueOffsetDays: 13 }
    ]
  },
  {
    name: '技能学习路线', icon: '🎓', category: '学习任务',
    items: [
      { content: '明确学习目标与应用场景', priority: 'high', tags: ['规划'], dueOffsetDays: 0 },
      { content: '收集教程与学习资料', priority: 'medium', tags: ['资料'], dueOffsetDays: 1 },
      { content: '完成基础知识学习', priority: 'high', tags: ['基础'], dueOffsetDays: 7 },
      { content: '完成实战项目练习', priority: 'high', tags: ['实战'], dueOffsetDays: 14 },
      { content: '输出学习笔记与总结', priority: 'low', tags: ['复盘'], dueOffsetDays: 21 }
    ]
  },
  {
    name: '读书计划', icon: '📚', category: '学习任务',
    items: [
      { content: '制定本月书单', priority: 'medium', tags: ['阅读'], dueOffsetDays: 0 },
      { content: '每天阅读 30 分钟', priority: 'medium', tags: ['阅读'] },
      { content: '写读书笔记与摘录', priority: 'low', tags: ['笔记'], dueOffsetDays: 7 },
      { content: '输出一篇读后感', priority: 'low', tags: ['输出'], dueOffsetDays: 28 }
    ]
  },
  // ---- 生活管理 ----
  {
    name: '家庭清洁大扫除', icon: '🧹', category: '生活管理',
    items: [
      { content: '整理换季衣物', priority: 'medium', tags: ['整理'], subtasks: ['外衣', '床品', '鞋帽'] },
      { content: '厨房深度去油污', priority: 'high', tags: ['厨房'], dueOffsetDays: 0 },
      { content: '卫生间消毒清洁', priority: 'high', tags: ['卫生间'], dueOffsetDays: 0 },
      { content: '擦拭门窗与玻璃', priority: 'medium', tags: ['门窗'], dueOffsetDays: 1 },
      { content: '处理闲置物品断舍离', priority: 'low', tags: ['整理'], dueOffsetDays: 2 }
    ]
  },
  {
    name: '每周采购清单', icon: '🛒', category: '生活管理',
    items: [
      { content: '蔬菜水果', priority: 'high', tags: ['生鲜'], subtasks: ['叶菜', '水果', '鸡蛋'] },
      { content: '肉禽水产', priority: 'high', tags: ['生鲜'] },
      { content: '米面粮油', priority: 'medium', tags: ['主食'] },
      { content: '日用消耗品', priority: 'medium', tags: ['日用'], subtasks: ['纸巾', '洗护', '清洁用品'] },
      { content: '核对冰箱库存避免重复购买', priority: 'low', tags: ['整理'], dueOffsetDays: -1 }
    ]
  },
  {
    name: '月度理财记账', icon: '💰', category: '生活管理',
    items: [
      { content: '导出本月账单流水', priority: 'high', tags: ['记账'], dueOffsetDays: 0 },
      { content: '分类统计各项支出', priority: 'high', tags: ['记账'], dueOffsetDays: 1, subtasks: ['固定支出', '弹性支出', '意外支出'] },
      { content: '核对预算执行情况', priority: 'medium', tags: ['预算'], dueOffsetDays: 2 },
      { content: '制定下月储蓄目标', priority: 'medium', tags: ['储蓄'], dueOffsetDays: 3 }
    ]
  },
  // ---- 出行准备 ----
  {
    name: '旅行打包清单', icon: '✈️', category: '出行准备',
    items: [
      { content: '身份证件', priority: 'high', tags: ['必备'] },
      { content: '充电器与转换插头', priority: 'high', tags: ['电子'] },
      { content: '换洗衣物', priority: 'medium', tags: ['衣物'], subtasks: ['内衣', '外套', '袜子'] },
      { content: '洗漱用品', priority: 'medium', tags: ['洗漱'] },
      { content: '机票/酒店确认', priority: 'high', tags: ['行程'], dueOffsetDays: 1 }
    ]
  },
  {
    name: '搬家清单', icon: '🏠', category: '出行准备',
    items: [
      { content: '打包厨房用品', priority: 'medium', tags: ['打包'] },
      { content: '打包衣物', priority: 'medium', tags: ['打包'], subtasks: ['冬季', '夏季', '四季'] },
      { content: '联系搬家公司', priority: 'high', dueOffsetDays: 1 },
      { content: '变更地址登记', priority: 'high', tags: ['行政'], dueOffsetDays: 3 }
    ]
  },
  // ---- 健康健身 ----
  {
    name: '健身计划', icon: '💪', category: '健康健身',
    items: [
      { content: '晨跑 30 分钟', priority: 'medium', tags: ['运动'] },
      { content: '力量训练', priority: 'medium', tags: ['运动'], subtasks: ['深蹲', '俯卧撑', '平板支撑'] },
      { content: '拉伸放松', priority: 'low', tags: ['运动'], dueOffsetDays: 0 },
      { content: '记录体重', priority: 'low', tags: ['健康'], dueOffsetDays: 0 }
    ]
  },
  {
    name: '早睡早起挑战', icon: '😴', category: '健康健身',
    items: [
      { content: '23:00 前放下手机', priority: 'high', tags: ['作息'] },
      { content: '睡前阅读 15 分钟', priority: 'medium', tags: ['作息'] },
      { content: '7:00 起床喝一杯温水', priority: 'high', tags: ['作息'] },
      { content: '午间小憩 20 分钟', priority: 'low', tags: ['作息'] }
    ]
  }
];

function mockTemplates<T>(data: TemplateEventPayload): Promise<T> {
  const tpls = readAll(TPL_KEY) as Array<{
    _id?: string; _openid?: string; name?: string; icon?: string;
    category?: string; isSystem?: boolean; items?: MockTplItem[];
    createTime?: number; updateTime?: number;
  }>;
  const { action } = data;
  switch (action as TemplateAction) {
    case 'list':
      return delay({ success: true, items: tpls } as unknown as T);
    case 'save': {
      const now = Date.now();
      if (data.id) {
        const idx = tpls.findIndex((t) => t._id === data.id);
        if (idx < 0) return delay({ success: false, error: '模板不存在' } as unknown as T);
        tpls[idx] = { ...((tpls[idx] || {}) as object), ...((data.template || {}) as object), updateTime: now };
        writeAll(TPL_KEY, tpls);
        return delay({ success: true, id: data.id, updated: 1 } as unknown as T);
      }
      const newTpl = { _id: uid('mock_tpl_'), ...((data.template || {}) as object), createTime: now, updateTime: now };
      tpls.push(newTpl);
      writeAll(TPL_KEY, tpls);
      return delay({ success: true, id: newTpl._id } as unknown as T);
    }
    case 'delete': {
      const before = tpls.length;
      const next = tpls.filter((t) => t._id !== data.id);
      writeAll(TPL_KEY, next);
      return delay({ success: true, removed: before - next.length } as unknown as T);
    }
    case 'apply': {
      // 真正落地：按模板 items 批量创建 todo（含子任务 + 相对截止日）
      const tpl = tpls.find((t) => t._id === data.id);
      if (!tpl || !Array.isArray(tpl.items)) {
        return delay({ success: false, error: '模板不存在' } as unknown as T);
      }
      const todos = mockTodoAll();
      const subs = readAll(SUB_KEY) as ISubtask[];
      const now = Date.now();
      let count = 0;
      const created: ITodo[] = [];
      for (const it of tpl.items) {
        const itemSubs = Array.isArray(it.subtasks) ? it.subtasks : [];
        const todoId = uid('mock_t_');
        const doc: ITodo = {
          _id: todoId,
          content: it.content || '未命名',
          completed: false,
          createTime: now,
          updateTime: now,
          dueDate: Number.isFinite(it.dueOffsetDays) ? now + (it.dueOffsetDays as number) * 86400000 : null,
          reminded: false,
          priority: it.priority ?? null,
          location: null,
          people: [],
          tags: Array.isArray(it.tags) ? it.tags : [],
          description: null,
          recurrence: null,
          reminders: [],
          attachments: [],
          quadrant: null,
          archived: false,
          archivedAt: null,
          subtaskCount: itemSubs.length,
          subtaskDoneCount: 0,
          order: now
        };
        todos.push(doc);
        created.push(doc);
        for (let i = 0; i < itemSubs.length; i++) {
          subs.push({
            _id: uid('mock_s_'),
            todoId,
            content: itemSubs[i],
            completed: false,
            order: now + i,
            createTime: now,
            updateTime: now
          });
        }
        count += 1;
      }
      mockTodoReplace(todos);
      writeAll(SUB_KEY, subs);
      // 返回完整待办对象，前端可乐观插入、首页即时可见
      return delay({ success: true, count, items: created } as unknown as T);
    }
    case 'seed': {
      // 真正落地：把系统模板写入本地存储（按名称去重）
      const now = Date.now();
      const existNames = new Set(tpls.filter((t) => t.isSystem).map((t) => t.name));
      let created = 0;
      for (const tpl of MOCK_SYSTEM_TEMPLATES) {
        if (existNames.has(tpl.name)) continue;
        tpls.push({
          _id: uid('mock_tpl_'),
          _openid: 'SYSTEM',
          name: tpl.name,
          icon: tpl.icon,
          category: tpl.category,
          isSystem: true,
          items: tpl.items,
          createTime: now,
          updateTime: now
        });
        created += 1;
      }
      writeAll(TPL_KEY, tpls);
      return delay({ success: true, created } as unknown as T);
    }
    default:
      return delay({ success: false, error: `未知 action: ${action}` } as unknown as T);
  }
}

function mockExport<T>(data: Record<string, unknown>): Promise<T> {
  const todos = mockTodoAll();
  const subs = readAll(SUB_KEY) as ISubtask[];
  if (data.action === 'csv') {
    const lines = ['id,content,completed,priority,dueDate,createTime,subtaskCount,subtaskDone,archived'];
    for (const t of todos) {
      lines.push([
        t._id,
        '"' + (t.content || '').replace(/"/g, '""') + '"',
        t.completed ? 1 : 0,
        t.priority || '',
        t.dueDate || '',
        new Date(t.createTime).toISOString(),
        t.subtaskCount || 0,
        t.subtaskDoneCount || 0,
        t.archived ? 1 : 0
      ].join(','));
    }
    return delay({
      success: true,
      format: 'csv',
      filename: `todos-export-${new Date().toISOString().slice(0, 10)}.csv`,
      content: lines.join('\n'),
      total: todos.length
    } as unknown as T);
  }
  return delay({
    success: true,
    format: 'json',
    filename: `todos-export-${new Date().toISOString().slice(0, 10)}.json`,
    content: JSON.stringify({ exportedAt: Date.now(), todos, subtasks: subs }, null, 2),
    total: todos.length,
    subtasks: subs.length
  } as unknown as T);
}

export const __mock = {
  readTodos: () => mockTodoAll(),
  readSubs: () => readAll(SUB_KEY) as ISubtask[],
  readPomoLogs: () => readAll(POMO_LOG_KEY),
  readNotes: () => readAll(NOTE_KEY) as INote[],
  clearAll: () => {
    mockTodoCache = null;
    shard.clearBuckets();
    wx.removeStorageSync(TODO_KEY);
    wx.removeStorageSync(SUB_KEY);
    wx.removeStorageSync(TPL_KEY);
    wx.removeStorageSync(POMO_LOG_KEY);
    wx.removeStorageSync(NOTE_KEY);
  }
};

/* ============== Mock：番茄日志 ============== */
function mockPomoLogs<T>(data: Record<string, unknown>): Promise<T> {
  const list = readAll(POMO_LOG_KEY) as Array<Record<string, unknown>>;
  const action = data.action as string;
  switch (action) {
    case 'upsert': {
      const id = data._id as string;
      if (!id) return delay({ success: false, error: '_id 必填' } as unknown as T);
      const idx = list.findIndex((x) => x._id === id);
      const norm: Record<string, unknown> = {
        _id: id,
        mode: data.mode,
        plannedSec: data.plannedSec || 0,
        actualSec: data.actualSec || 0,
        status: data.status || 'completed',
        startAt: data.startAt,
        endAt: data.endAt,
        todoId: data.todoId || null,
        todoTitle: data.todoTitle || null,
        dateKey: data.dateKey,
        updateTime: Date.now()
      };
      if (idx >= 0) list[idx] = norm;
      else list.push(norm);
      writeAll(POMO_LOG_KEY, list);
      return delay({ success: true, id, updated: 1 } as unknown as T);
    }
    case 'listRange': {
      const from = (data.fromTs as number) || 0;
      const to = (data.toTs as number) || Date.now();
      const items = list
        .filter((x) => (x.startAt as number) >= from && (x.startAt as number) <= to)
        .sort((a, b) => (a.startAt as number) - (b.startAt as number));
      return delay({ success: true, items, total: items.length } as unknown as T);
    }
    case 'listSince': {
      const since = (data.sinceTs as number) || 0;
      const items = list
        .filter((x) => (x.startAt as number) > since)
        .sort((a, b) => (a.startAt as number) - (b.startAt as number));
      return delay({ success: true, items, total: items.length } as unknown as T);
    }
    case 'dailyStats': {
      const keys = Array.isArray(data.dateKeys) ? (data.dateKeys as string[]) : [];
      const stats: Record<string, { count: number; minutes: number }> = {};
      for (const k of keys) stats[k] = { count: 0, minutes: 0 };
      for (const it of list) {
        if (it.status !== 'completed') continue;
        const k = it.dateKey as string;
        if (!stats[k]) continue;
        stats[k].count += 1;
        stats[k].minutes += Math.round(((it.actualSec as number) || 0) / 60);
      }
      return delay({ success: true, stats } as unknown as T);
    }
    case 'remove': {
      const id = data._id as string;
      if (!id) return delay({ success: false, error: '_id 必填' } as unknown as T);
      const before = list.length;
      const next = list.filter((x) => x._id !== id);
      writeAll(POMO_LOG_KEY, next);
      return delay({ success: true, removed: before - next.length } as unknown as T);
    }
    default:
      return delay({ success: false, error: `未知 action: ${action}` } as unknown as T);
  }
}

/* ============== Mock：便签 ============== */
function mockNotes<T>(data: Record<string, unknown>): Promise<T> {
  const list = readAll(NOTE_KEY) as INote[];
  const action = data.action as string;
  switch (action) {
    case 'list': {
      const items = list
        .slice()
        .sort((a, b) => (a.pinned === b.pinned ? b.updateTime - a.updateTime : a.pinned ? -1 : 1));
      return delay({ success: true, items, total: items.length } as unknown as T);
    }
    case 'upsert': {
      const note = data.note as INote | undefined;
      if (!note || !note._id) return delay({ success: false, error: 'note 必填' } as unknown as T);
      const idx = list.findIndex((n) => n._id === note._id);
      if (idx >= 0) list[idx] = note;
      else list.push(note);
      writeAll(NOTE_KEY, list);
      return delay({ success: true, id: note._id, updated: 1 } as unknown as T);
    }
    case 'remove': {
      const id = data._id as string;
      if (!id) return delay({ success: false, error: '_id 必填' } as unknown as T);
      const before = list.length;
      const next = list.filter((n) => n._id !== id);
      writeAll(NOTE_KEY, next);
      return delay({ success: true, removed: before - next.length } as unknown as T);
    }
    case 'clear': {
      writeAll(NOTE_KEY, []);
      return delay({ success: true, removed: list.length } as unknown as T);
    }
    default:
      return delay({ success: false, error: `未知 action: ${action}` } as unknown as T);
  }
}