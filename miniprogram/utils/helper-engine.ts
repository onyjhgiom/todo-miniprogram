// utils/helper-engine.ts
// 小助手 · 规则意图引擎（纯函数，无网络依赖，可在本页即时运行）。
// 把小助手理解为一个轻量对话式命令台：识别用户输入里的意图并产出「回答 + 建议动作」。
// 页面负责执行动作（读/写待办、跳转模块）。
//
// 覆盖意图（文字或语音转写后走同一入口）：
//   · 全局命令调度：说「去 / 打开 / 帮我打开 X」→ 匹配到任意功能模块，产出 nav 动作统一跳转；
//   · 专属意图：打招呼 / 帮助 / 日期时间 / 今日待办统计 / 倒计时多少天 /
//     新建待办 / 标记完成 / 记录/记账/备忘等跨功能联动引导 / 鼓励语。
//
// 模块落地统一收敛到 utils/module-router.ts（一份路由表，文字/语音共用）。
import { MODULES, MODULE_GROUPS, matchModule, getModule, type ModuleDef } from './module-router';

export type HelperActionKind =
  | 'none'
  | 'nav-tools'
  | 'nav-group'
  | 'nav-subscribe'
  | 'nav-important'
  | 'nav-todo-panel'
  | 'nav-pomodoro'
  | 'nav-module' // 通用：经 module-router 解析落地
  | 'todo-create' // 一键新建待办（payload=内容）
  | 'note-create' // 一键存便签（payload=内容）
  | 'todo-complete' // 一键标记完成（module=待办标题片段）
  | 'todo-reschedule'; // 一键改期（module=标题片段，due=目标时间戳）

export interface HelperAction {
  kind: HelperActionKind;
  label: string;
  /** nav-module 专用：模块 id（module-router 里定义） */
  module?: string;
  /** todo-create / note-create 携带的内容；todo-complete / todo-reschedule 复用 module 存标题片段 */
  payload?: string;
  /** todo-reschedule 专用：目标截止时间戳（ms） */
  due?: number;
}

export interface HelperReply {
  text: string;
  /** 附带展示的快捷动作 */
  actions: HelperAction[];
}

function todayStr(): string {
  const d = new Date();
  const wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${wk}`;
}
function hasKw(text: string, kws: string[]): boolean {
  return kws.some((k) => text.indexOf(k) >= 0);
}

/** 从输入中提取新建待办的内容（去掉触发词与语气词） */
function extractTodo(text: string): string {
  let s = text;
  const trig = ['帮我', '帮我记住', '记一下', '记住', '添加', '加一个', '新增', '待办', '建一个', '记录', '提醒我', '别忘了', '去', '要', '记得', '把', '将', '让', '给'];
  for (const t of trig) s = s.split(t).join(' ');
  const verbs = ['完成', '处理', '做', '一下', '记下来', '记着', '记上', '下来'];
  for (const v of verbs) s = s.split(v).join(' ');
  s = s.replace(/[，。,.!！?？了吧呢啊呀哦嘛啦的]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/** 计算「到 X 还有多少天」里的日期短语 */
function parseDaysText(text: string): number | null {
  const d1 = text.match(/(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})日?/);
  const now = new Date();
  if (d1) {
    const t = new Date(Number(d1[1]), Number(d1[2]) - 1, Number(d1[3]));
    return Math.round((t.getTime() - now.getTime()) / 86400000);
  }
  const d2 = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (d2) {
    const year = now.getFullYear();
    let t = new Date(year, Number(d2[1]) - 1, Number(d2[2])).getTime();
    if (t - now.getTime() < 0) t = new Date(year + 1, Number(d2[1]) - 1, Number(d2[2])).getTime();
    return Math.round((t - now.getTime()) / 86400000);
  }
  const d3 = text.match(/(\d{1,2})日/);
  if (d3) {
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), Number(d3[1])).getTime();
    return Math.round((thisMonth - now.getTime()) / 86400000);
  }
  return null;
}

/** 把某模块转成通用 nav 动作 */
function moduleAction(m: ModuleDef): HelperAction {
  const label = m.kws && m.kws[0] ? `${m.key.split(' ')[1] || m.key} · ${m.desc}` : m.key;
  return { kind: 'nav-module', label, module: m.id };
}

function quick(label: string, kind: HelperActionKind, module?: string): HelperAction {
  return { kind, label, module };
}

/** 通用入口快捷集（新用户常用） */
function defaultActions(): HelperAction[] {
  return [
    { kind: 'nav-todo-panel', label: '✅ 待办四维', module: 'todo-panel' },
    { kind: 'nav-group', label: '👥 多人提醒', module: 'group-reminder' },
    { kind: 'nav-subscribe', label: '📮 订阅提醒', module: 'subscribe-reminder' },
    { kind: 'nav-important', label: '💖 重要日', module: 'important-day' },
    { kind: 'nav-pomodoro', label: '🍅 番茄时钟', module: 'pomodoro' },
    { kind: 'nav-module', label: '🧰 全部功能', module: 'tools' }
  ];
}

const DEFAULT_ACTIONS = defaultActions();
const IDLE: HelperReply = {
  text: '没太明白你的意思～你可以直接说“去日历 / 打开记账本 / 看多人提醒”等，我会帮你一键跳转；也可以说“今天有什么待办”“帮我建一条待办”“离国庆还有多少天”，或点下面的快捷指令。',
  actions: DEFAULT_ACTIONS
};

export interface HelperContext {
  /** 当前未完成待办数 */
  activeTodoCount?: number;
  /** 今日已完成数 */
  todayDone?: number;
  /** 今日总数 */
  todayTotal?: number;
}

/* ==================== 通用指令解析辅助 ==================== */

/** 是否像一句问句（问句不应被当成待办去建） */
function isQuestion(text: string): boolean {
  return /[?？]|吗|呢|怎么|怎样|如何|为什么|啥|什么|哪|谁|多少|是不是|能否|能不能|可以吗|什么时候|几点/.test(text);
}

/** 是否像一条「待记的事」：短、非问句、非纯寒暄 */
function looksLikeTask(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (isQuestion(t)) return false;
  if (/^(你好|您好|hi|hello|嗨|哈喽|在吗|谢谢|感谢|thank|拜拜|再见|晚安|加油|打气|哈哈|嗯|哦|呃|好的|行|可以)$/.test(t)) return false;
  if (t.length > 30) return false; // 太长更像一段描述/问题
  const core = t.replace(/[\s，。,.!！?？、~～…·：:；;]/g, '');
  return core.length >= 2;
}

/** 从一条指令里抽取「待办标题片段」：从开头剥触发词前缀，再清掉动作词与语气词 */
function extractTitle(text: string): string {
  let s = (text || '').trim();
  const prefixes = ['帮我把', '帮我记住', '帮我记', '帮我', '把那个', '把', '让', '将', '记一下', '记着', '记住', '记得', '提醒我', '别忘了', '去', '要', '待办', '记'];
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of prefixes) {
      if (s.indexOf(p) === 0) {
        s = s.slice(p.length).trim();
        changed = true;
        break;
      }
    }
  }
  s = s.replace(/(标记完成|打勾|勾掉|划掉|标完成|已完成|做完|做掉|搞定|做好|取消完成|恢复|未完成|的待办|待办|改到|移到|调到|延后到|提前到|推迟到|改期到|放到|定到|记下来|记着|记上|记下|：|:)/g, ' ');
  s = s.replace(/[，。,.!！?？了吧呢啊呀哦嘛啦的]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/** 截止时间戳 → 简短可读（今天只显示 HH:mm） */
function fmtDueShort(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return sameDay ? `今天 ${hm}` : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

/** 解析「X 改到 Y」：抽出标题与相对/绝对目标日期 */
function extractReschedule(text: string): { title: string; due: number | null } | null {
  const m = text.match(/(.+?)(?:改到|移到|调到|延后到|提前到|推迟到|改期到|放到|定到)(.+)/);
  if (!m) return null;
  const title = extractTitle(m[1]);
  const rest = m[2];
  const due = parseRelativeDate(rest) || parseDaysText(rest);
  return { title: title || null, due };
}

/** 中文小写数字 → 整数（支持 0-99，如 三/两/十二/二十/二十三） */
function cnToNum(s: string): number | null {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const d: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (s === '十') return 10;
  if (s.indexOf('十') >= 0) {
    const parts = s.split('十');
    const tens = parts[0] ? d[parts[0]] || 1 : 1;
    const ones = parts[1] ? d[parts[1]] || 0 : 0;
    return tens * 10 + ones;
  }
  let sum = 0;
  for (const ch of s) sum += d[ch] || 0;
  return sum || null;
}

/** 相对日期解析：今天/明天/后天/大后天/N天后/N周后/下周X（N 支持阿拉伯或中文数字） */
function parseRelativeDate(text: string): number | null {
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (days: number, h = 9) => new Date(today0.getTime() + days * 86400000 + h * 3600000).getTime();
  const rel: Record<string, number> = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 };
  for (const k of Object.keys(rel)) if (text.indexOf(k) >= 0) return at(rel[k]);
  const d = text.match(/([零一二两三四五六七八九十\d]+)\s*天[以之]?后/);
  if (d) { const n = cnToNum(d[1]); if (n !== null) return at(n); }
  const w = text.match(/([零一二两三四五六七八九十\d]+)\s*周[以之]?后/);
  if (w) { const n = cnToNum(w[1]); if (n !== null) return at(n * 7); }
  const wkMap: Record<string, number> = { 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const wk = text.match(/下?周([一二三四五六日])/);
  if (wk) {
    const target = wkMap[wk[1]];
    let days = (target - now.getDay() + 7) % 7;
    if (text.indexOf('下周') >= 0) days += 7;
    if (days === 0) days = 7;
    return at(days, 12);
  }
  return null;
}

/* ==================== 模糊工具路由 ==================== */
// 让「任何指令」都能路由到最相关的功能（即使措辞不在关键词表里）。
// 用「二元组重叠」打分：命中的关键词二元组权重更高，普通描述二元组权重低。

const FUZZY_AVOID = new Set(['tools', 'settings', 'little-helper']); // 太泛，不自动跳转
let _fzIndex: { m: ModuleDef; grams: Set<string>; kwGrams: Set<string> }[] | null = null;

function buildFuzzyIndex() {
  if (_fzIndex) return _fzIndex;
  _fzIndex = MODULES.filter((m) => !FUZZY_AVOID.has(m.id)).map((m) => {
    const name = (m.key.split(' ').slice(1).join(' ') || m.key).toLowerCase();
    const text = `${name} ${m.desc} ${m.kws.join(' ')}`.toLowerCase();
    const grams = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
    const kwGrams = new Set<string>();
    for (const k of m.kws) for (let i = 0; i < k.length - 1; i++) kwGrams.add(k.toLowerCase().slice(i, i + 2));
    return { m, grams, kwGrams };
  });
  return _fzIndex;
}

function bigrams(s: string): Set<string> {
  const t = (s || '').toLowerCase();
  const g = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}

/** 模糊匹配最相关模块；score < 2 视为不可信，返回 null */
export function fuzzyMatchModule(text: string): { m: ModuleDef; score: number } | null {
  const t = (text || '').trim();
  if (!t) return null;
  const tg = bigrams(t);
  let best: { m: ModuleDef; score: number } | null = null;
  for (const entry of buildFuzzyIndex()) {
    let score = 0;
    for (const g of tg) {
      if (entry.kwGrams.has(g)) score += 3;
      else if (entry.grams.has(g)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { m: entry.m, score };
  }
  return best && best.score >= 2 ? best : null;
}

export function replyTo(input: string, ctx: HelperContext = {}): HelperReply {
  const text = (input || '').trim().toLowerCase();
  if (!text) return IDLE;

  const r = (s: string, act?: HelperAction[]) => ({ text: s, actions: act || DEFAULT_ACTIONS });
  const round = (n: number) => (Number.isNaN(n) ? 0 : n);

  // ===== 1. 打招呼 =====
  if (/^(你好|您好|hi|hello|嗨|哈喽|hey|在吗|早上好|下午好|晚上好)/.test(text)) {
    return r(`你好呀，我是你的专属待办助理小琳 👩‍💼 现在我可以听懂你对「日历 / 看板 / 记账 / 备忘 / 提醒 / 专注…」等任意功能的指令，一句话就帮你跳转。现在是 ${todayStr()}，想做点什么？`, DEFAULT_ACTIONS);
  }

  // ===== 2. 帮助 / 我能做什么 / 有哪些功能 =====
  if (hasKw(text, ['帮助', 'help', '你能做什么', '会什么', '怎么用', '功能', '指令', '有啥功能', '有什么功能'])) {
    const lines = MODULE_GROUPS.map((g) => {
      const subs = MODULES.filter((m) => m.group === g.key).map((m) => m.key.split(' ').pop()).filter(Boolean);
      return `${g.label}：${subs.join(' / ')}`;
    });
    const caps: HelperAction[] = [
      { kind: 'nav-module', label: '🧰 打开工具中心', module: 'tools' },
      { kind: 'nav-todo-panel', label: '✅ 待办四维', module: 'todo-panel' },
      { kind: 'nav-group', label: '👥 多人提醒', module: 'group-reminder' },
      { kind: 'nav-subscribe', label: '📮 订阅提醒', module: 'subscribe-reminder' },
      { kind: 'nav-module', label: '💰 记账本', module: 'ledger' },
      { kind: 'nav-pomodoro', label: '🍅 番茄时钟', module: 'pomodoro' }
    ];
    return r(`我能一键帮你进入这些功能：\n${lines.join('\n')}\n也可以直接说“打开xx / 去xx / 帮我xx”。`, caps);
  }

  // ===== 3. 日期 / 时间 =====
  if (hasKw(text, ['今天是', '几号', '今天日期', '什么日子', '今夕', '日期'])) {
    return r(`今天是 ${todayStr()}。`, DEFAULT_ACTIONS);
  }
  if (hasKw(text, ['现在几点', '几点钟', '现在时间', '几点了'])) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return r(`现在是 ${p(d.getHours())}:${p(d.getMinutes())}。`, DEFAULT_ACTIONS);
  }

  // ===== 4. 今日待办统计 =====
  if (hasKw(text, ['今天有什么', '今日待办', '今天待办', '有哪些待办', '看看待办', '今天要做', '待办有哪些', '我有什么', '今天安排', '今天有哪些', '有哪些安排', '我还有什么', '还有哪些', '还有什么没', '还有啥没', '没做', '还没做', '剩下', '待办还剩', '未完成的有'])) {
    const total = round(ctx.todayTotal);
    const done = round(ctx.todayDone);
    const active = round(ctx.activeTodoCount);
    if (total === 0 && active === 0) {
      return r('你现在没有进行中的待办，很清爽 ✨ 要不要记一条？', [
        quick('✅ 去待办清单', 'nav-todo-panel', 'todo-panel'),
        quick('➕ 帮我建一条', 'nav-module', 'home')
      ]);
    }
    return r(`今日共 ${total} 条，已完成 ${done} 条；你还有 ${active} 条待办在处理中。可在「待办四维」里按 日/月/年 细看。`, [
      quick('✅ 查看待办清单', 'nav-todo-panel', 'todo-panel')
    ]);
  }

  // ===== 5. 标记完成 / 取消完成（可一键执行） =====
  if (hasKw(text, ['完成了', '做完', '标记完成', '标完成', '打勾', '帮我勾', '已完成', '划掉', '取消完成', '恢复', '未完成'])) {
    const title = extractTitle(input);
    const wantDone = !/取消完成|恢复|未完成/.test(text);
    if (title && title.length >= 2) {
      return r(
        `好的，我帮你把「${title}」${wantDone ? '标记完成' : '恢复为未完成'}（点下面按钮确认；若清单里找不到这条，会提示你去手点）。`,
        [{
          kind: 'todo-complete',
          label: wantDone ? `✔ 完成「${title.length > 8 ? title.slice(0, 8) + '…' : title}」` : `↩ 恢复「${title.length > 8 ? title.slice(0, 8) + '…' : title}」`,
          module: title,
          payload: wantDone ? '1' : '0'
        }]
      );
    }
    return r('好的，标记完成需要打开待办清单，在对应任务上点一下勾即可 ✔ 我帮你打开。', [quick('✅ 打开待办清单', 'nav-todo-panel', 'todo-panel')]);
  }

  // ===== 6. 新建待办（可直接一键建好） =====
  if (hasKw(text, ['帮我记', '记住', '添加待办', '加个待办', '建一个待办', '记一下', '记录', '新增待办', '提醒我', '建一条待办', '记个', '记一笔', '记下来', '记着', '记上', '待办：', '待办:'])) {
    const content = extractTodo(input) || extractTitle(input);
    if (content && content.length >= 2) {
      const due = parseRelativeDate(text) || parseDaysText(text);
      const dueHint = due ? `（约 ${fmtDueShort(due)}）` : '';
      return r(
        `收到！我帮你建好待办：\n「${content}」${dueHint}\n点下面按钮即可创建；要补更精确的时间，可在清单里改。`,
        [{ kind: 'todo-create', label: `✅ 建好「${content.length > 8 ? content.slice(0, 8) + '…' : content}」`, payload: content }]
      );
    }
    return r('想让我记点什么？直接说，比如「帮我记住：周五下午三点开会」。', [quick('✅ 去待办清单', 'nav-todo-panel', 'todo-panel')]);
  }

  // ===== 6b. 改期（“X 改到明天 / 移到周五”）—— 可一键执行 =====
  if (hasKw(text, ['改到', '移到', '调到', '延后到', '提前到', '推迟到', '改期到', '放到', '定到'])) {
    const m = extractReschedule(input);
    if (m && m.title && m.title.length >= 2) {
      if (m.due) {
        return r(
          `好的，我帮你把「${m.title}」改到 ${fmtDueShort(m.due)}（点下面按钮确认；找不到这条会提示去清单改）。`,
          [{ kind: 'todo-reschedule', label: `📅 改到 ${fmtDueShort(m.due)}`, module: m.title, due: m.due }]
        );
      }
      return r(`好的，要把「${m.title}」改到哪天？直接说，比如「${m.title} 改到周五」。`, [quick('✅ 打开待办清单', 'nav-todo-panel', 'todo-panel')]);
    }
  }

  // ===== 7. 倒计时（“离xx还有多少天”） —— 命中倒数日模块 =====
  if (hasKw(text, ['还有多少天', '还剩几天', '还有几天', '倒计时', '多久到', '还有几天到'])) {
    const days = parseDaysText(text);
    const relTs = days === null ? parseRelativeDate(text) : null;
    if (days !== null && days >= 0) {
      if (days === 0) return r('就是今天啦 🎉 别错过！', DEFAULT_ACTIONS);
      return r(`还有 ${days} 天～（按自然日估算，不含当天）。想常驻跟踪的话，可以用「倒数日 / 重要日」记下来。`, [
        quick('⏳ 打开倒数日', 'nav-module', 'countdown'),
        quick('💖 打开重要日', 'nav-important', 'important-day')
      ]);
    }
    if (relTs !== null) {
      const d = Math.round((relTs - Date.now()) / 86400000);
      if (d >= 0) {
        return r(`还有 ${d} 天（${fmtDueShort(relTs)}）～想常驻跟踪的话，可以用「倒数日 / 重要日」记下来。`, [
          quick('⏳ 打开倒数日', 'nav-module', 'countdown'),
          quick('💖 打开重要日', 'nav-important', 'important-day')
        ]);
      }
    }
    return r('听起来是个重要的日子！你可以说「离 2026-12-31 还有多少天」或「3天后还有几天」，我帮你算；或去「倒数日 / 重要日」工具里记下来。', [
      quick('⏳ 打开倒数日', 'nav-module', 'countdown'),
      quick('💖 打开重要日', 'nav-important', 'important-day')
    ]);
  }

  // ===== 8. 通用模块命令调度（核心：统一调度全部功能） =====
  //    放最后、匹配不到上面的专属意图才进入，命中任意功能模块则返回 nav 动作。
  const matched = matchModule(text);
  if (matched) {
    const friendly = hasKw(text, ['打开', '去', '到', '跳转', '进入', '看看', '查看', '想看', '带我去', '帮我打开', '进入']) ||
      hasKw(text, matched.kws);
    if (friendly) {
      const label = matched.key.split(' ')[0] + ' 打开';
      // 落地路径提示
      const verb = hasKw(text, ['记账', '记一笔']) ? '记一笔' : '看看';
      const mlabel = matched.desc || '';
      const acts: HelperAction[] = [moduleAction(matched)];
      // 附送相邻推荐，形成跨功能联动
      const rec = recommended(matched);
      if (rec) acts.push(quick(rec.key.split(' ')[0] + ' 顺便看看', 'nav-module', rec.id));
      return r(
        `好的，我帮你打开「${matched.key.split(' ').pop()}」→ ${mlabel}\n也可以${verb}更具体的内容，我帮你接着安排。`,
        acts
      );
    }
  }

  // ===== 9. 鼓励 / 感谢 =====
  if (hasKw(text, ['加油', '鼓励', '累', '坚持', '打气', '有点忙', '忙不过来', '压力'])) {
    return r('你已经做得很棒了 💪 把任务拆小、一个个完成就好。需要的话我可以帮你把大目标拆成待办，或用番茄钟进入专注。', [
      quick('✅ 待办四维', 'nav-todo-panel', 'todo-panel'),
      quick('🍅 番茄时钟', 'nav-pomodoro', 'pomodoro')
    ]);
  }
  if (/谢谢|感谢|thank/.test(text)) {
    return r('不客气～随时找我，想安排什么说一声就好 😊', DEFAULT_ACTIONS);
  }

  // ===== 10. 闲聊 / 情绪 / 元问题 / 受限能力说明 =====
  if (hasKw(text, ['你是谁', '你叫什么', '介绍一下自己', '介绍自己', '你的名字'])) {
    return r('我是小琳，你的专属待办助理 👩‍💼 我能统一调度这台小程序里的全部功能：日历、看板、记账、备忘、提醒、专注、星语星球…说“打开xx / 帮我xx”就能一键执行。', [
      { kind: 'nav-module', label: '🧰 看全部功能', module: 'tools' }
    ]);
  }
  if (/拜拜|再见|晚安|休息|下了|去睡了|88|bye/.test(text)) {
    const night = new Date().getHours() >= 22 || new Date().getHours() < 6;
    return r(night ? '晚安 🌙 今天辛苦了，明早再来安排新的一天吧。' : '好，忙完记得回来清一下待办～需要我做什么随时喊我 👋', [
      { kind: 'nav-todo-panel', label: '✅ 睡前看眼待办', module: 'todo-panel' }
    ]);
  }
  if (/你真棒|好厉害|真不错|太强|给你点赞|靠谱/.test(text)) {
    return r('被你夸得有点飘了 😄 不过能帮上忙就很开心——继续说吧，今天还想安排点什么？', DEFAULT_ACTIONS);
  }
  if (hasKw(text, ['笑话', '讲个笑话', '段子', '搞笑', '乐一乐'])) {
    const jokes = [
      '程序员最怕两件事：一是改需求，二是上一任没写注释。',
      '为什么手机越用越慢？因为它记住的烦恼太多了。',
      '别总说自己一事无成，至少你让待办清单每天都满过。',
      '我给自己定了个小目标：今天先做完三件小事——其实第一件是“开始”。'
    ];
    return r(jokes[Math.floor(Math.random() * jokes.length)] + '\n\n哈哈，笑完记得把待办清一清，我可帮你列好了快捷入口 😉', [
      { kind: 'nav-todo-panel', label: '✅ 去清待办', module: 'todo-panel' }
    ]);
  }
  // ===== 11. 简单计算 =====
  const calc = text.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/x×÷])\s*(-?\d+(?:\.\d+)?)/);
  if (calc && hasKw(text, ['算', '等于', '多少', '+', '-', '乘', '除']) && !hasKw(text, ['天', '号', '几点'])) {
    const a = parseFloat(calc[1]);
    const b = parseFloat(calc[3]);
    const op = calc[2];
    const map: Record<string, (x: number, y: number) => number> = {
      '+': (x, y) => x + y,
      '-': (x, y) => x - y,
      '*': (x, y) => x * y,
      'x': (x, y) => x * y,
      '×': (x, y) => x * y,
      '/': (x, y) => x / y,
      '÷': (x, y) => x / y
    };
    if (map[op] && !(op.indexOf('/') >= 0 && b === 0)) {
      const result = Math.round(map[op](a, b) * 10000) / 10000;
      return r(`算好了：${a} ${op} ${b} = ${result}`, DEFAULT_ACTIONS);
    }
  }
  // ===== 12. 天气 / 新闻等无实时源能力 =====
  if (hasKw(text, ['天气', '气温', '温度', '下雨', '晴', '新闻', '热搜', '直播', '音乐', '放首歌', '电影'])) {
    return r('这类需要联网实时数据的能力我暂时还没开通 🫥 不过你可以先“记一条待办/备忘”到点去查，我会帮你打开工具中心找替代。', [
      { kind: 'nav-module', label: '🧰 打开工具中心', module: 'tools' }
    ]);
  }
  // ===== 13. 星座 / 星语星球 导引 =====
  if (hasKw(text, ['星座', '运势', '塔罗', '占卜', '星语', '星象'])) {
    return r('想看星座与塔罗的话，工具中心里有「🔮 星语星球」：今日运势、塔罗牌阵、雷诺曼、冥想、星愿都在里面～我帮你打开。', [
      { kind: 'nav-module', label: '🔮 星语星球', module: 'astro-hub' }
    ]);
  }
  // ===== 14. 叹息 / 随口一句 =====
  if (/^嗯?[哦噢呃呵]+$|^好的?$|^在?的$/.test(text)) {
    return r('嗯嗯，我在听 👂 你可以直接说需求，例如“打开日历”“帮我建条待办”“今天有哪些安排”；或者点下面的快捷入口。', DEFAULT_ACTIONS);
  }

  // ===== 15. 永不冷场兜底：任何输入都给出回应 + 可执行动作 =====
  //   先模糊匹配最相关工具 → 打开；否则把输入当作“想记住/想做的事” → 一键存待办或便签。
  const fz = fuzzyMatchModule(text);
  if (fz) {
    const m = fz.m;
    const rec = recommended(m);
    const acts: HelperAction[] = [moduleAction(m)];
    if (rec) acts.push(quick(rec.key.split(' ')[0] + ' 顺便看看', 'nav-module', rec.id));
    return r(`我猜你想用「${m.key.split(' ').pop()}」——${m.desc}。点一下就帮你打开；要是理解错了，直接说“打开xx”也行。`, acts);
  }
  // 兜底：当作一条待记的内容，提供一键建待办 / 存便签
  const content = extractTitle(input);
  if (content && content.length >= 2) {
    return r(`收到～我把「${content}」先帮你存着：点下面一键建待办，或存成便签随时看。要打开某个功能，直接说“打开xx”即可。`, [
      { kind: 'todo-create', label: `✅ 建待办「${content.length > 8 ? content.slice(0, 8) + '…' : content}」`, payload: content },
      { kind: 'note-create', label: '📌 存便签', payload: content }
    ]);
  }
  return r('嗯嗯，我在听 👂 你可以说“打开日历 / 帮我记一条待办 / 今天有哪些安排”，或点下面入口看看全部功能。', DEFAULT_ACTIONS);
}

/** 该模块的“下一步”推荐（跨功能联动） */
function recommended(m: ModuleDef): ModuleDef | null {
  const map: Record<string, string> = {
    'todo-panel': 'calendar',
    calendar: 'todo-panel',
    kanban: 'todo-panel',
    'group-reminder': 'subscribe-reminder',
    'subscribe-reminder': 'group-reminder',
    'important-day': 'countdown',
    countdown: 'important-day',
    ledger: 'wish',
    memo: 'note',
    wish: 'ledger',
    pomodoro: 'time-progress',
    templates: 'todo-panel'
  };
  const id = map[m.id];
  return id ? getModule(id) || null : null;
}

/** 模块存在性/落地校验辅助（页面加载时可用） */
export function isModule(id: string): boolean {
  return !!getModule(id);
}
export { MODULES, MODULE_GROUPS };
