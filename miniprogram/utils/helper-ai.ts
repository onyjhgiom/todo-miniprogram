// utils/helper-ai.ts
// 小助手 · AI 对话客户端封装（v2 全面智能版）
//
// 优先调用云端 helperChat 云函数（智谱 / DeepSeek / 任意 OpenAI 兼容端点），
// 失败或未配置时自动回退到本地规则引擎。
//
// 本层职责：
//   1) 组装请求：真实待办明细（todoBrief）、历史、图片、模式（chat/brief）；
//   2) 解析云端返回的结构化 ops（可执行操作），交给页面落地；
//   3) 提供纯函数工具（日期解析、ops 摘要），便于单测与复用。
//
// 不把小助手逻辑写死在本页，便于后续切换模型、缓存会话或接入流式响应。

import { callFn } from './cloud';
import type { HelperReply, HelperAction, HelperContext } from './helper-engine';

/** 单条历史消息（仅保存 user/assistant 文本，不上传本地动作状态） */
export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  text: string;
}

/** 注入提示词的单条待办摘要（只上传统计所需的字段，不含用户隐私细节） */
export interface TodoBriefItem {
  content: string;
  done?: boolean;
  overdue?: boolean;
  /** 已格式化的截止时间，如 "09-18 15:00" */
  due?: string;
  priority?: 'high' | 'medium' | 'low' | null;
}

/** 云端可执行操作（白名单与云函数 INDEX 保持一致） */
export type HelperOpType =
  | 'todo.add'
  | 'todo.addMany'
  | 'todo.complete'
  | 'todo.uncomplete'
  | 'todo.reschedule'
  | 'todo.remove'
  | 'todo.priority'
  | 'note.add'
  | 'ledger.add'
  | 'nav';

export interface HelperOpItem {
  content: string;
  dueDate?: string;
  priority?: 'high' | 'medium' | 'low';
  tags?: string[];
}

export interface HelperOp {
  type: HelperOpType;
  /** todo.add */
  content?: string;
  /** todo.addMany */
  items?: HelperOpItem[];
  /** todo.complete / uncomplete / reschedule / remove / priority —— 待办标题片段 */
  match?: string;
  /** 日期字符串 "YYYY-MM-DD HH:mm" */
  dueDate?: string;
  /** 优先级（todo.add / todo.priority） */
  priority?: 'high' | 'medium' | 'low';
  /** 标签（todo.add） */
  tags?: string[];
  /** note.add */
  text?: string;
  /** ledger.add */
  amount?: number;
  category?: string;
  note?: string;
  /** nav */
  module?: string;
}

export interface AIMeta {
  model?: string;
  provider?: string;
  ms?: number;
  vision?: boolean;
  mode?: string;
  degraded?: string;
  usage?: Record<string, number> | null;
}

export interface AIResult {
  success?: boolean;
  text?: string;
  ops?: HelperOp[];
  actions?: HelperAction[];
  createTodo?: string | null;
  meta?: AIMeta;
  error?: string;
  message?: string;
}

export interface AIError {
  error: string;
  message?: string;
}

export interface AskAIOptions {
  message: string;
  history?: ChatHistoryItem[];
  context?: HelperContext & { currentPage?: string };
  /** 真实待办明细，供模型回答「我还有哪些没做」 */
  todoBrief?: TodoBriefItem[];
  /** 图片（dataURL 或 https 链接），传入后走视觉模型 */
  images?: string[];
  /** chat = 正常对话；brief = 主动生成今日简报 */
  mode?: 'chat' | 'brief';
}

/** 单次请求：上下文 + 待办明细，云函数按供应商选模型并返回结构化结果 */
export async function askAI(opts: AskAIOptions): Promise<AIResult> {
  const ctx = opts.context || {};
  const brief = (opts.todoBrief || []).slice(0, 40);

  const res = await callFn<AIResult>('helperChat', {
    message: (opts.message || '').slice(0, 800),
    history: (opts.history || []).slice(-10),
    todayTotal: ctx.todayTotal ?? 0,
    todayDone: ctx.todayDone ?? 0,
    activeTodoCount: ctx.activeTodoCount ?? 0,
    currentPage: ctx.currentPage || '小助手',
    todoBrief: brief,
    images: opts.images && opts.images.length ? opts.images.slice(0, 3) : [],
    mode: opts.mode || 'chat'
  });

  if (!res || res.success === false) {
    const code = res?.error || 'AI_ERROR';
    const msg = res?.message || 'AI 对话失败';
    const err = new Error(msg) as Error & { code?: string };
    err.code = code;
    throw err;
  }
  return res;
}

/** 主动服务：进入小助手时生成一条今日简报（失败时由页面静默忽略） */
export async function askBrief(opts: Omit<AskAIOptions, 'message' | 'mode'>): Promise<AIResult> {
  return askAI({ ...opts, message: '生成今日简报', mode: 'brief' });
}

/** 判断错误是否属于「AI 未配置」，以便前端切换到本地规则兜底 */
export function isAINotConfigured(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; message?: string; errMsg?: string };
  if (e.code === 'AI_NOT_CONFIGURED') return true;
  const msg = `${e.message || ''} ${e.errMsg || ''}`;
  return /AI_NOT_CONFIGURED|未配置|api key|apikey/i.test(msg);
}

/**
 * 判断错误是否属于「云函数超时」。
 *
 * 两类来源，指向同一个修法：
 *  1. 平台强杀 —— errCode `-504003` / `FUNCTIONS_TIME_LIMIT_EXCEEDED`。
 *     云函数超时设置太短（新版 CloudBase 默认只有 3 秒，模型根本来不及回）。
 *  2. 云函数自我保护 —— `AI_TIMEOUT_BUDGET`。函数发现剩余预算不够，主动放弃
 *     并附上修复指引，避免被强杀成一条没有指向性的错误。
 *
 * 所以前端可以把这两种都翻译成同一句人话：去控制台把超时改成 60 秒。
 */
export function isAITimeout(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; message?: string; errMsg?: string };
  if (e.code === 'AI_TIMEOUT_BUDGET' || e.code === 'AI_TIMEOUT') return true;
  const msg = `${e.message || ''} ${e.errMsg || ''}`;
  return /-504003|FUNCTIONS_TIME_LIMIT_EXCEEDED|timed out|AI_TIMEOUT_BUDGET|超时时间/i.test(msg);
}

/**
 * 把日期字符串 "YYYY-MM-DD HH:mm" 解析为毫秒时间戳。
 * 模型偶尔会给出 "2026/9/14 15:00" 或纯日期，这里统一容错；解析不出返回 null。
 * 注意：按「本地时间」构造，因为用户说的是本地时钟的点。
 */
export function parseDueDate(s?: string): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = m[4] ? Number(m[4]) : 0;
  const mm = m[5] ? Number(m[5]) : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const t = new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
  return Number.isFinite(t) ? t : null;
}

/** ops → 一行人类可读摘要（用于气泡下方的“已执行”说明与单测断言） */
export function describeOps(ops?: HelperOp[]): string[] {
  if (!ops || !ops.length) return [];
  const out: string[] = [];
  for (const op of ops) {
    switch (op.type) {
      case 'todo.add':
        if (op.content) out.push(`新建待办「${op.content}」`);
        break;
      case 'todo.addMany':
        if (op.items && op.items.length) out.push(`新建 ${op.items.length} 条待办`);
        break;
      case 'todo.complete':
        if (op.match) out.push(`标记完成「${op.match}」`);
        break;
      case 'todo.uncomplete':
        if (op.match) out.push(`取消完成「${op.match}」`);
        break;
      case 'todo.reschedule':
        if (op.match) out.push(`「${op.match}」改期到 ${op.dueDate || ''}`);
        break;
      case 'todo.remove':
        if (op.match) out.push(`删除「${op.match}」`);
        break;
      case 'todo.priority':
        if (op.match) out.push(`「${op.match}」设为 ${op.priority || ''}`);
        break;
      case 'note.add':
        out.push('新增便签');
        break;
      case 'ledger.add':
        out.push(`记一笔 ${op.amount ?? 0} 元`);
        break;
      case 'nav':
        out.push('打开功能页');
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * 把 AI 结果转换成与本地规则引擎一致的 HelperReply。
 * 若模型没给动作，就补一组默认入口（但若已执行了 ops，则不再堆砌跳转按钮）。
 */
export function toHelperReply(result: AIResult, _fallbackInput?: string): HelperReply {
  const text = result.text || '收到，正在处理中…';
  const hasOps = !!(result.ops && result.ops.length);
  const actions = result.actions && result.actions.length > 0
    ? result.actions
    : hasOps
      ? defaultActions(true)
      : defaultActions(false);
  return { text, actions };
}

function defaultActions(compact: boolean): HelperAction[] {
  if (compact) {
    return [{ kind: 'nav-todo-panel', label: '✅ 去待办清单', module: 'todo-panel' }];
  }
  return [
    { kind: 'nav-todo-panel', label: '✅ 待办四维', module: 'todo-panel' },
    { kind: 'nav-module', label: '🧰 工具中心', module: 'tools' }
  ];
}
