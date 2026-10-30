// utils/ledger-store.ts
// 记账本数据层：本地优先 + 云端尽力同步
// 覆盖：多账户 / 无限层级分类 / 流水 CRUD / 多级预算与分级预警 / 报表统计 / 语音记账解析 / 分账
import { get, set } from './storage';
import { callFn } from './cloud';
import { extractAmount } from './money';
import type {
  IAccount, ILedgerCategory, ITransaction, IBudget, ILedgerReport, LedgerType
} from '../types/index';

const TX_KEY = 'ledger_tx';
const ACC_KEY = 'ledger_accounts';
const CAT_KEY = 'ledger_categories';
const BUDGET_KEY = 'ledger_budgets';

/* ==================== 默认数据 ==================== */

export const DEFAULT_ACCOUNTS: IAccount[] = [
  { id: 'acc_cash', name: '现金', type: 'personal', icon: '💵', color: '#10b981', balance: 0, members: [], createTime: 0, updateTime: 0 },
  { id: 'acc_wechat', name: '微信', type: 'personal', icon: '💬', color: '#22c55e', balance: 0, members: [], createTime: 0, updateTime: 0 },
  { id: 'acc_alipay', name: '支付宝', type: 'personal', icon: '🅰️', color: '#3b82f6', balance: 0, members: [], createTime: 0, updateTime: 0 },
  { id: 'acc_card', name: '银行卡', type: 'personal', icon: '💳', color: '#8b5cf6', balance: 0, members: [], createTime: 0, updateTime: 0 }
];

export const DEFAULT_CATEGORIES: ILedgerCategory[] = [
  { id: 'c_food', name: '餐饮', icon: '🍜', color: '#f97316', type: 'expense', parentId: '', order: 0 },
  { id: 'c_traffic', name: '交通', icon: '🚌', color: '#0ea5e9', type: 'expense', parentId: '', order: 1 },
  { id: 'c_shop', name: '购物', icon: '🛍️', color: '#ec4899', type: 'expense', parentId: '', order: 2 },
  { id: 'c_house', name: '住房', icon: '🏠', color: '#f59e0b', type: 'expense', parentId: '', order: 3 },
  { id: 'c_fun', name: '娱乐', icon: '🎮', color: '#8b5cf6', type: 'expense', parentId: '', order: 4 },
  { id: 'c_medical', name: '医疗', icon: '💊', color: '#ef4444', type: 'expense', parentId: '', order: 5 },
  { id: 'c_edu', name: '教育', icon: '📚', color: '#14b8a6', type: 'expense', parentId: '', order: 6 },
  { id: 'c_other_e', name: '其他支出', icon: '📦', color: '#94a3b8', type: 'expense', parentId: '', order: 7 },
  { id: 'c_salary', name: '工资', icon: '💰', color: '#10b981', type: 'income', parentId: '', order: 0 },
  { id: 'c_bonus', name: '红包', icon: '🧧', color: '#ef4444', type: 'income', parentId: '', order: 1 },
  { id: 'c_invest', name: '理财', icon: '📈', color: '#3b82f6', type: 'income', parentId: '', order: 2 },
  { id: 'c_other_i', name: '其他收入', icon: '✨', color: '#94a3b8', type: 'income', parentId: '', order: 3 }
];

/* ==================== 读写 ==================== */

export function loadAccounts(): IAccount[] {
  const list = get<IAccount[]>(ACC_KEY, []);
  return Array.isArray(list) && list.length ? list : DEFAULT_ACCOUNTS;
}
export function saveAccounts(list: IAccount[]): void {
  set(ACC_KEY, list);
}

export function loadCategories(): ILedgerCategory[] {
  const list = get<ILedgerCategory[]>(CAT_KEY, []);
  return Array.isArray(list) && list.length ? list : DEFAULT_CATEGORIES;
}
export function saveCategories(list: ILedgerCategory[]): void {
  set(CAT_KEY, list);
}

export function loadTransactions(): ITransaction[] {
  const list = get<ITransaction[]>(TX_KEY, []);
  return Array.isArray(list) ? list : [];
}
export function saveTransactions(list: ITransaction[]): void {
  set(TX_KEY, list);
}

export function loadBudgets(): IBudget[] {
  const list = get<IBudget[]>(BUDGET_KEY, []);
  return Array.isArray(list) ? list : [];
}
export function saveBudgets(list: IBudget[]): void {
  set(BUDGET_KEY, list);
}

export function newTxId(): string {
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTransaction(patch?: Partial<ITransaction>): ITransaction {
  const now = Date.now();
  const accs = loadAccounts();
  const cats = loadCategories().filter((c) => c.type === 'expense');
  const base: ITransaction = {
    _id: newTxId(),
    accountId: (accs[0] && accs[0].id) || '',
    type: 'expense',
    amount: 0,
    categoryId: (cats[0] && cats[0].id) || '',
    note: '',
    occurredAt: now,
    payerId: 'me',
    payerName: '我',
    splitMode: 'none',
    splitDetail: [],
    tags: [],
    isReimbursable: false,
    images: [],
    wishId: '',
    subscriptionId: '',
    createTime: now,
    updateTime: now,
    version: 1
  };
  // 用 patch 覆盖默认值，但跳过 undefined 字段 —— 否则调用方常用的
  // `_id: d._id || undefined`（新建时 d._id 为空串）会把刚生成的 newTxId() 覆盖成 undefined，
  // 导致两笔新账 _id 都为 undefined，upsert 时第二笔误走「编辑替换」而覆盖第一笔。
  const out: ITransaction = { ...base };
  if (patch) {
    (Object.keys(patch) as (keyof ITransaction)[]).forEach((k) => {
      const v = patch[k];
      if (v !== undefined) {
        (out as unknown as Record<string, unknown>)[k] = v;
      }
    });
  }
  return out;
}

export function upsertTransaction(tx: ITransaction): ITransaction[] {
  const list = loadTransactions();
  const idx = list.findIndex((t) => t._id === tx._id);
  const next = Object.assign({}, tx, { updateTime: Date.now(), version: (tx.version || 1) + 1 });
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  saveTransactions(list);
  syncToCloudSilently({ action: 'upsert', tx: next });
  return list;
}

export function removeTransaction(id: string): ITransaction[] {
  const list = loadTransactions().filter((t) => t._id !== id);
  saveTransactions(list);
  syncToCloudSilently({ action: 'remove', _id: id });
  return list;
}

/* ==================== 分类树 ==================== */

/** 按 type 取顶级分类 */
export function topCategories(type: LedgerType): ILedgerCategory[] {
  return loadCategories()
    .filter((c) => c.type === type && !c.parentId)
    .sort((a, b) => a.order - b.order);
}

/** 取某分类的直接子级 */
export function childCategories(parentId: string): ILedgerCategory[] {
  return loadCategories()
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

/** 分类全路径名（用于展示「餐饮 / 午餐」） */
export function categoryPath(id: string): string {
  const cats = loadCategories();
  const names: string[] = [];
  let cur = cats.find((c) => c.id === id);
  let guard = 0;
  while (cur && guard < 10) {
    names.unshift(cur.name);
    cur = cur.parentId ? cats.find((c) => c.id === cur!.parentId) : undefined;
    guard++;
  }
  return names.join(' / ');
}

export function categoryOf(id: string): ILedgerCategory | undefined {
  return loadCategories().find((c) => c.id === id);
}

/* ==================== 统计与报表 ==================== */

export interface MonthRange {
  start: number;
  end: number;
}

/** 某月 1 日 00:00 ~ 次月 1 日 00:00 */
export function monthRange(year: number, month: number): MonthRange {
  const start = new Date(year, month, 1).getTime();
  const end = new Date(year, month + 1, 1).getTime();
  return { start, end };
}

export function txInRange(list: ITransaction[], range: MonthRange): ITransaction[] {
  return list.filter((t) => t.occurredAt >= range.start && t.occurredAt < range.end);
}

/** 生成报表：分类占比 / 近 6 月趋势 / Top5 / 收支结余 */
export function buildReport(list: ITransaction[], range: MonthRange, months = 6): ILedgerReport {
  const cats = loadCategories();
  const cur = txInRange(list, range);

  const income = cur.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = cur.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const map = new Map<string, number>();
  cur.filter((t) => t.type === 'expense').forEach((t) => {
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
  });

  const byCategory = Array.from(map.entries())
    .map(([id, amount]) => {
      const c = categoryOf(id);
      return {
        id,
        name: c ? c.name : '未分类',
        icon: c ? c.icon : '📦',
        color: c ? c.color : '#94a3b8',
        amount,
        pct: expense > 0 ? Math.round((amount / expense) * 1000) / 10 : 0
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const now = new Date(range.start);
  const trend: { month: string; income: number; expense: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const r = monthRange(d.getFullYear(), d.getMonth());
    const items = txInRange(list, r);
    trend.push({
      month: `${d.getMonth() + 1}月`,
      income: items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
      expense: items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    });
  }

  const top5 = byCategory.slice(0, 5).map((c) => ({ name: c.name, icon: c.icon, amount: c.amount }));

  return { byCategory, trend, top5, income, expense, balance: income - expense };
}

/** 账户余额 = 初始余额 + 收入 - 支出（转账同账户相抵） */
export function accountBalance(accountId: string, list?: ITransaction[]): number {
  const acc = loadAccounts().find((a) => a.id === accountId);
  const base = acc ? acc.balance : 0;
  const txs = (list || loadTransactions()).filter((t) => t.accountId === accountId);
  let delta = 0;
  txs.forEach((t) => {
    if (t.type === 'income') delta += t.amount;
    else if (t.type === 'expense') delta -= t.amount;
  });
  return base + delta;
}

/* ==================== 预算与预警 ==================== */

export interface BudgetStat {
  budget: IBudget;
  /** 展示名：总预算 / 分类全路径（如「餐饮 / 午餐」） */
  name: string;
  used: number;
  pct: number;
  /** 已触发的最高阈值（0 表示未触发） */
  level: number;
  left: number;
}

/** 统计本月各预算使用情况（总预算 = categoryId 为空） */
export function budgetStats(list: ITransaction[], range: MonthRange): BudgetStat[] {
  const monthTx = txInRange(list, range);
  return loadBudgets()
    .filter((b) => b.enabled)
    .map((b) => {
      const used = monthTx
        .filter((t) => t.type === 'expense' && (!b.categoryId || t.categoryId === b.categoryId))
        .reduce((s, t) => s + t.amount, 0);
      const pct = b.limit > 0 ? Math.round((used / b.limit) * 100) : 0;
      const thresholds = (b.thresholds && b.thresholds.length ? b.thresholds : [50, 80, 100])
        .slice()
        .sort((a, c) => a - c);
      let level = 0;
      thresholds.forEach((th) => {
        if (pct >= th) level = th;
      });
      const name = b.categoryId ? categoryPath(b.categoryId) || '未分类' : '总预算';
      return { budget: b, name, used, pct, level, left: b.limit - used };
    })
    .sort((a, b) => b.pct - a.pct);
}

/* ==================== 语音记账 ==================== */

export interface ParsedVoice {
  amount: number;
  type: LedgerType;
  categoryId: string;
  note: string;
}

const KEYWORDS: { key: string; type: LedgerType; cat: string }[] = [
  { key: '工资', type: 'income', cat: 'c_salary' },
  { key: '红包', type: 'income', cat: 'c_bonus' },
  { key: '理财', type: 'income', cat: 'c_invest' },
  { key: '午饭', type: 'expense', cat: 'c_food' },
  { key: '午餐', type: 'expense', cat: 'c_food' },
  { key: '晚饭', type: 'expense', cat: 'c_food' },
  { key: '早餐', type: 'expense', cat: 'c_food' },
  { key: '吃饭', type: 'expense', cat: 'c_food' },
  { key: '打车', type: 'expense', cat: 'c_traffic' },
  { key: '地铁', type: 'expense', cat: 'c_traffic' },
  { key: '公交', type: 'expense', cat: 'c_traffic' },
  { key: '加油', type: 'expense', cat: 'c_traffic' },
  { key: '买菜', type: 'expense', cat: 'c_food' },
  { key: '超市', type: 'expense', cat: 'c_shop' },
  { key: '衣服', type: 'expense', cat: 'c_shop' },
  { key: '房租', type: 'expense', cat: 'c_house' },
  { key: '水电', type: 'expense', cat: 'c_house' },
  { key: '电影', type: 'expense', cat: 'c_fun' },
  { key: '游戏', type: 'expense', cat: 'c_fun' },
  { key: '药', type: 'expense', cat: 'c_medical' },
  { key: '医院', type: 'expense', cat: 'c_medical' },
  { key: '书', type: 'expense', cat: 'c_edu' },
  { key: '课程', type: 'expense', cat: 'c_edu' }
];

/** 语音/自然语言解析：如「午餐三十五」→ { amount: 3500, type: 'expense', categoryId: 'c_food' } */
export function parseVoiceTx(text: string): ParsedVoice {
  const amount = extractAmount(text);
  let type: LedgerType = 'expense';
  let categoryId = '';
  for (const kw of KEYWORDS) {
    if (text.indexOf(kw.key) >= 0) {
      type = kw.type;
      categoryId = kw.cat;
      break;
    }
  }
  if (!categoryId) {
    const def = loadCategories().filter((c) => c.type === type).sort((a, b) => a.order - b.order)[0];
    categoryId = def ? def.id : '';
  }
  return { amount, type, categoryId, note: text };
}

/* ==================== 导入导出 ==================== */

export function exportCsv(list?: ITransaction[]): string {
  const cats = loadCategories();
  const accs = loadAccounts();
  const rows = [['日期', '类型', '金额(元)', '分类', '账户', '备注', '标签', '可报销']];
  (list || loadTransactions()).forEach((t) => {
    const d = new Date(t.occurredAt);
    const p = (n: number) => String(n).padStart(2, '0');
    const c = cats.find((x) => x.id === t.categoryId);
    const a = accs.find((x) => x.id === t.accountId);
    rows.push([
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      t.type === 'income' ? '收入' : t.type === 'expense' ? '支出' : '转账',
      (t.amount / 100).toFixed(2),
      c ? c.name : '',
      a ? a.name : '',
      (t.note || '').replace(/"/g, '""'),
      (t.tags || []).join(' '),
      t.isReimbursable ? '是' : '否'
    ]);
  });
  // 加 BOM 防止 Excel 打开乱码
  return `﻿${rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')}`;
}

/* ==================== 云同步 ==================== */

function syncToCloudSilently(payload: Record<string, unknown>): void {
  callFn('ledger', payload).catch(() => {});
}

export async function loadFromCloud(): Promise<ITransaction[]> {
  const res = await callFn<{ items?: ITransaction[] }>('ledger', { action: 'list' });
  const cloud = (res && res.items) || [];
  if (!cloud.length) return loadTransactions();
  const local = loadTransactions();
  const map = new Map<string, ITransaction>();
  local.forEach((t) => map.set(t._id, t));
  cloud.forEach((t) => {
    const exist = map.get(t._id);
    if (!exist || (t.updateTime || 0) > (exist.updateTime || 0)) map.set(t._id, t);
  });
  const merged = Array.from(map.values());
  saveTransactions(merged);
  return merged;
}
