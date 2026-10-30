// pages/detail/detail.ts
import { callFn, toast, handleError, isActionSupported } from '../../utils/cloud';
import { backAfter } from '../../utils/nav';
import { getThemeState, syncNavBar } from '../../utils/theme';
import * as todoStore from '../../utils/todo-store';
import { isCloudFile, removeAttachFiles } from '../../utils/attach';
import type {
  ITodo, ISubtask, IAttachment, IReminder, IRecurrence, Priority, ThemeKey, CloudResult
} from '../../types/index';

interface PriorityOption { key: Priority | null; label: string; color: string }
interface MetaRow { label: string; value: string; mono?: boolean }

const PRIORITIES: PriorityOption[] = [
  { key: 'high', label: '高', color: '#ef4444' },
  { key: 'medium', label: '中', color: '#f59e0b' },
  { key: 'low', label: '低', color: '#10b981' }
];

const PRIORITY_LABEL: Record<Priority, string> = { high: '高', medium: '中', low: '低' };
const WEEK_LABEL = ['一', '二', '三', '四', '五', '六', '日'];
const EMPTY = '—';

function pad(n: number) { return String(n).padStart(2, '0'); }
function tsToYMD(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTime(ts: number | null | undefined): string {
  if (!ts) return EMPTY;
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function recurrenceText(r?: IRecurrence | null): string {
  if (!r || !r.type || r.type === 'none') return '不重复';
  const n = r.interval && r.interval > 1 ? r.interval : 1;
  if (r.type === 'daily') return `每 ${n} 天`;
  if (r.type === 'weekly') {
    const wd = (r.weekdays || []).map((d) => WEEK_LABEL[d - 1] || '').filter(Boolean);
    return `每 ${n} 周${wd.length ? '（周' + wd.join('、') + '）' : ''}`;
  }
  if (r.type === 'monthly') return `每 ${n} 个月`;
  return `自定义（每 ${n} 个周期）`;
}
function nextReminderText(list?: IReminder[] | null): string {
  const arr = (list || []).filter((r) => !r.sent);
  if (!arr.length) return '无待发送提醒';
  const next = arr.reduce((min, r) => (r.at < min ? r.at : min), arr[0].at);
  return `${arr.length} 个待发送，最近 ${fmtTime(next)}`;
}

/** 归一化：组件属性声明了 Object / Array，传 undefined 会触发类型告警并被置空 */
function normalize(t: ITodo): ITodo {
  return {
    ...t,
    tags: Array.isArray(t.tags) ? t.tags : [],
    people: Array.isArray(t.people) ? t.people : [],
    reminders: Array.isArray(t.reminders) ? t.reminders : [],
    attachments: Array.isArray(t.attachments) ? t.attachments : [],
    recurrence: t.recurrence || null,
    description: t.description ?? ''
  };
}

Page<{
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  todo: Partial<ITodo>;
  subtasks: ISubtask[];
  priorities: PriorityOption[];
  dueDateStr: string;
  loading: boolean;
  id: string;
  meta: MetaRow[];
  subtaskProgress: string;
  /** 刚性(true) / 弹性(false)：弹性逾期自动顺延、不标红催促 */
  rigid: boolean;
  /** 预估耗时（分钟） */
  estimatedMinutes: number | null;
  /** 预估 > 2h 时提示拆分 */
  splitHint: boolean;
  /** 是否纳入今日聚焦 */
  focusToday: boolean;
}>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    todo: {},
    subtasks: [],
    priorities: PRIORITIES,
    dueDateStr: '',
    loading: true,
    id: '',
    meta: [],
    subtaskProgress: '',
    rigid: true,
    estimatedMinutes: null,
    splitHint: false,
    focusToday: false
  },
  onLoad(query) {
    this.applyThemeToPage();
    this.setData({ id: query.id || '' } as Record<string, unknown>);
    if (this.data.id) this.load();
  },
  onShow() {
    // 主题可能在设置页被修改，每次显示都刷新
    this.applyThemeToPage();
    if (this.data.id) this.load();
  },
  applyThemeToPage() {
    const state = getThemeState();
    this.setData({
      theme: state.theme,
      themeStyle: state.themeStyle,
      heroGradient: state.heroGradient
    } as Record<string, unknown>);
    syncNavBar(state);
  },

  /** 当前生效的 id（新建条目可能传进来的是临时 id，需要先解析别名） */
  realId(): string {
    return todoStore.resolveId(this.data.id);
  },

  /**
   * 加载详情：本地优先 + 云端刷新。
   * 旧版云函数没有 getOne（返回「未知 action」），此时完整保留本地数据，
   * 不再弹「任务不存在」——新建的待办本地一定有。
   */
  async load() {
    this.setData({ loading: true });
    if (!this.data.id) {
      this.setData({ loading: false });
      return;
    }

    try {
      // ① 本地数据源：刚新建、尚未同步到云端的条目也在这里，可以立刻上屏
      await todoStore.ensureLoaded();
      const local = todoStore.getById(this.realId());
      if (local) {
        this.applyTodo(local);
        this.setData({ loading: false });
      }

      // ② 云端刷新一次（拿到服务端最新的子任务数/字段）；失败静默，用本地数据继续
      if (isActionSupported('todos', 'getOne')) {
        try {
          const res = await callFn<CloudResult & { item?: ITodo }>('todos', {
            action: 'getOne',
            id: this.data.id
          });
          const remote = res && res.item;
          if (remote && remote._id) this.applyTodo(remote);
        } catch (err) {
          console.warn('[detail] 云端拉取详情失败，使用本地数据:', err);
        }
      }

      if (!(this.data.todo && this.data.todo._id)) {
        toast('任务不存在', 'none');
        backAfter(800);
        return;
      }

      this.setData({ loading: false });
      this.loadSubtasks();
    } catch (err) {
      handleError(err, '加载失败');
      this.setData({ loading: false });
    }
  },

  /** 上屏一条待办：字段归一化 + 生成「记录信息」 */
  applyTodo(t: ITodo): void {
    const norm = normalize(t);
    const done = norm.subtaskDoneCount || 0;
    const total = norm.subtaskCount || 0;
    const meta: MetaRow[] = [
      { label: '状态', value: norm.completed ? `已完成 · ${fmtTime(norm.completedTime)}` : '进行中' },
      { label: '创建时间', value: fmtTime(norm.createTime) },
      { label: '最近更新', value: fmtTime(norm.updateTime) },
      { label: '截止日期', value: norm.dueDate ? fmtTime(norm.dueDate) : '未设置' },
      { label: '优先级', value: norm.priority ? PRIORITY_LABEL[norm.priority] : '未设置' },
      { label: '标签', value: norm.tags && norm.tags.length ? norm.tags.join('、') : EMPTY },
      { label: '地点', value: norm.location || EMPTY },
      { label: '相关人', value: norm.people && norm.people.length ? norm.people.join('、') : EMPTY },
      { label: '四象限', value: norm.quadrant ? `第 ${norm.quadrant} 象限` : EMPTY },
      { label: '重复规则', value: recurrenceText(norm.recurrence) },
      { label: '提醒', value: nextReminderText(norm.reminders) },
      { label: '子任务', value: total ? `${done}/${total} 已完成` : '无' },
      { label: '附件', value: `${(norm.attachments || []).length} 个` },
      { label: '归档', value: norm.archived ? `已归档 · ${fmtTime(norm.archivedAt)}` : '否' },
      { label: '记录 ID', value: norm._id, mono: true }
    ];

    // 解析到真实 id 后回写，后续写操作直接用真实 id
    const estMin = typeof norm.estimatedMinutes === 'number' ? norm.estimatedMinutes : null;
    const patch: Record<string, unknown> = {
      todo: norm,
      dueDateStr: tsToYMD(norm.dueDate),
      meta,
      subtaskProgress: total ? `${done}/${total}` : '',
      rigid: norm.rigid !== false,
      estimatedMinutes: estMin,
      splitHint: !!estMin && estMin > 120,
      focusToday: !!norm.focusToday
    };
    if (norm._id && norm._id !== this.data.id) patch.id = norm._id;
    this.setData(patch);
  },

  /** 写操作后从数据源回读，保证页面与列表一致 */
  refreshFromStore(): void {
    const t = todoStore.getById(this.realId());
    if (t) this.applyTodo(t);
  },

  async loadSubtasks() {
    try {
      const res = await callFn<{ items?: ISubtask[] }>('subtasks', { action: 'listByTodo', todoId: this.realId() });
      this.setData({ subtasks: res.items || [], loading: false });
    } catch (err) {
      handleError(err, '加载子任务失败');
      this.setData({ loading: false });
    }
  },

  /* ==================== 编辑（统一走 store：本地立即生效 + 云端后台同步） ==================== */

  async onPriorityChange(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as Priority;
    const next = this.data.todo.priority === key ? null : key;
    this.setData({ 'todo.priority': next });
    await todoStore.updateTodo(this.realId(), { priority: next }, true);
    this.refreshFromStore();
  },
  async onDueDateChange(e: WechatMiniprogram.PickerChangeEvent) {
    const dateStr = e.detail.value as string;
    const ts = new Date(dateStr + 'T23:59:59').getTime();
    this.setData({ dueDateStr: dateStr, 'todo.dueDate': ts });
    await todoStore.updateTodo(this.realId(), { dueDate: ts }, true);
    this.refreshFromStore();
  },
  async onClearDueDate() {
    this.setData({ dueDateStr: '', 'todo.dueDate': null });
    await todoStore.updateTodo(this.realId(), { dueDate: null }, true);
    this.refreshFromStore();
  },
  async onRecurrenceChange(e: WechatMiniprogram.CustomEvent<{ value: IRecurrence }>) {
    this.setData({ 'todo.recurrence': e.detail.value });
    await todoStore.updateTodo(this.realId(), { recurrence: e.detail.value }, true);
    this.refreshFromStore();
  },
  async onRemindersChange(e: WechatMiniprogram.CustomEvent<{ items: IReminder[] }>) {
    this.setData({ 'todo.reminders': e.detail.items || [] });
    await todoStore.updateTodo(this.realId(), { reminders: e.detail.items || [] }, true);
    this.refreshFromStore();
  },
  async onDescriptionChange(e: WechatMiniprogram.InputEvent) {
    const v = e.detail.value;
    if (v === this.data.todo.description) return;
    this.setData({ 'todo.description': v });
    await todoStore.updateTodo(this.realId(), { description: v }, true);
    this.refreshFromStore();
  },

  /* ==================== 减压相关字段 ==================== */

  /** 刚性 / 弹性切换：弹性待办逾期不标红、自动顺延 */
  async onRigidToggle() {
    const nextRigid = !this.data.rigid;
    this.setData({ rigid: nextRigid });
    await todoStore.updateTodo(this.realId(), { rigid: nextRigid }, true);
    this.refreshFromStore();
    if (!nextRigid) {
      toast('已设为弹性 · 逾期不催促，自动顺延', 'none');
    } else {
      toast('已设为刚性 · 逾期将标红提醒', 'none');
    }
  },
  /** 预估耗时输入（分钟） */
  async onEstimatedInput(e: WechatMiniprogram.InputEvent) {
    const raw = parseInt(e.detail.value, 10);
    const next = Number.isFinite(raw) && raw > 0 ? raw : null;
    const splitHint = !!next && next > 120;
    this.setData({ estimatedMinutes: next, splitHint });
    await todoStore.updateTodo(this.realId(), { estimatedMinutes: next }, true);
  },
  /** 今日聚焦开关 */
  async onFocusToggle() {
    const nextFocus = !this.data.focusToday;
    this.setData({ focusToday: nextFocus });
    await todoStore.updateTodo(this.realId(), { focusToday: nextFocus }, true);
    this.refreshFromStore();
    if (nextFocus) toast('已加入今日聚焦', 'none');
  },

  /* ==================== 子任务 ==================== */

  async onSubAdd(e: WechatMiniprogram.CustomEvent<{ content: string }>) {
    try {
      await callFn('subtasks', { action: 'add', todoId: this.realId(), content: e.detail.content });
      this.loadSubtasks();
    } catch (err) {
      handleError(err, '添加失败');
    }
  },
  async onSubToggle(e: WechatMiniprogram.CustomEvent<{ id: string; completed: boolean }>) {
    try {
      await callFn('subtasks', { action: 'toggle', id: e.detail.id, completed: e.detail.completed });
      this.loadSubtasks();
    } catch (err) {
      handleError(err, '更新失败');
    }
  },
  async onSubUpdate(e: WechatMiniprogram.CustomEvent<{ id: string; content: string }>) {
    try {
      await callFn('subtasks', { action: 'update', id: e.detail.id, content: e.detail.content });
      this.loadSubtasks();
    } catch (err) {
      handleError(err, '更新失败');
    }
  },
  async onSubRemove(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    try {
      await callFn('subtasks', { action: 'delete', id: e.detail.id });
      this.loadSubtasks();
    } catch (err) {
      handleError(err, '删除失败');
    }
  },
  async onSubClearDone() {
    try {
      await callFn('subtasks', { action: 'clearDone', todoId: this.realId() });
      this.loadSubtasks();
    } catch (err) {
      handleError(err, '清除失败');
    }
  },

  /* ==================== 附件 ==================== */

  async onAttachmentChange(e: WechatMiniprogram.CustomEvent<{ added: IAttachment[] }>) {
    const next = [...(this.data.todo.attachments || []), ...e.detail.added];
    this.setData({ 'todo.attachments': next });
    await todoStore.updateTodo(this.realId(), { attachments: next }, true);
    this.refreshFromStore();
  },
  async onAttachmentRemove(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const next = (this.data.todo.attachments || []).filter((a) => a.id !== e.detail.id);
    this.setData({ 'todo.attachments': next });
    await todoStore.updateTodo(this.realId(), { attachments: next }, true);
    this.refreshFromStore();
  },
  /**
   * 图片上传完成后由 attachment-bar 回调：
   * 把该附件的 url 换成云存储 fileID（tempPath 同时清空），否则下次冷启动会读到失效的本地路径。
   * 这里不调 refreshFromStore，避免与其它附件的上传回调互相覆盖。
   */
  async onAttachmentUpdate(e: WechatMiniprogram.CustomEvent<{ id: string; patch: Partial<IAttachment> }>) {
    const { id, patch } = e.detail;
    const next = (this.data.todo.attachments || []).map((a) => (a.id === id ? { ...a, ...patch } : a));
    this.setData({ 'todo.attachments': next });
    await todoStore.updateTodo(this.realId(), { attachments: next }, true);
  },

  /* ==================== 状态操作 ==================== */

  async onToggleComplete() {
    const newCompleted = !this.data.todo.completed;
    this.setData({ 'todo.completed': newCompleted });
    await todoStore.toggleTodo(this.realId(), newCompleted);
    this.refreshFromStore();
    toast(newCompleted ? '已完成 🎉' : '已恢复', 'success');
  },
  async onArchiveToggle() {
    const newArchived = !this.data.todo.archived;
    this.setData({ 'todo.archived': newArchived });
    await todoStore.archiveTodo(this.realId(), newArchived);
    this.refreshFromStore();
  },
  onDelete() {
    wx.showModal({
      title: '删除任务？',
      content: '将同时删除其子任务，此操作不可恢复',
      success: async (res) => {
        if (!res.confirm) return;
        // 任务删除后附件不再可达，云存储文件一并清理（best-effort，失败不阻塞删除）
        // 图片/视频本体 + 视频封面都要清，否则封面会变成存储里的孤儿文件
        const fileIDs: string[] = [];
        (this.data.todo.attachments || []).forEach((a) => {
          if (a.url && isCloudFile(a.url)) fileIDs.push(a.url);
          if (a.poster && isCloudFile(a.poster)) fileIDs.push(a.poster);
        });
        removeAttachFiles(fileIDs);
        await todoStore.removeTodo(this.realId());
        toast('已删除', 'success');
        backAfter(600);
      }
    });
  },

  /** 点击「记录 ID」复制；其余行不响应 */
  onCopyId(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { mono?: boolean; value?: string };
    if (!ds.mono) return;
    const text = ds.value || this.data.todo._id;
    if (!text) return;
    wx.setClipboardData({ data: String(text) });
  }
});
