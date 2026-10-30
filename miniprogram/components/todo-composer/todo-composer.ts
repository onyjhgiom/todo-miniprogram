// components/todo-composer/todo-composer.ts
// 全屏底部弹层：承载新增/编辑任务表单
//
// 截止时间：使用 5 列 multiSelector（年 / 月 / 日 / 时 / 分），
// 精确到当天的「几点几分」（已去掉秒的选择；微信原生 datetime/time 选择器最多只到分，故自实现）。
import type { ITodo, IAttachment, Priority } from '../../types/index';

/* ============================ 工具函数 ============================ */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 某年某月（1-12）有多少天，自动处理闰年 2 月 */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * 年份列：以「当前年份」为下界、+10 为上界；
 * 若编辑已有待办且其年份更早，则以该年份为下界锚点，保证老数据也能正确回显。
 */
function buildYearColumns(now: Date, anchorYear?: number): string[] {
  const base = now.getFullYear();
  const minY = Math.min(base, anchorYear ?? base) - 1;
  const maxY = base + 10;
  const arr: string[] = [];
  for (let y = minY; y <= maxY; y++) arr.push(String(y));
  return arr;
}

const buildMonthColumns = (): string[] => {
  const arr: string[] = [];
  for (let m = 1; m <= 12; m++) arr.push(`${m}月`);
  return arr;
};

function buildDayColumns(year: number, month: number): string[] {
  const n = daysInMonth(year, month);
  const arr: string[] = [];
  for (let d = 1; d <= n; d++) arr.push(`${d}日`);
  return arr;
}

const buildHourColumns = (): string[] => {
  const arr: string[] = [];
  for (let h = 0; h <= 23; h++) arr.push(`${pad2(h)}时`);
  return arr;
};

const buildMinuteColumns = (): string[] => {
  const arr: string[] = [];
  for (let m = 0; m <= 59; m++) arr.push(`${pad2(m)}分`);
  return arr;
};

/** 5 列全部建成（日列依据 year/month 推导） */
function buildAllColumns(years: string[], yearIdx: number, monthIdx: number): string[][] {
  const year = parseInt(years[yearIdx], 10);
  return [
    years,
    buildMonthColumns(),
    buildDayColumns(year, monthIdx + 1),
    buildHourColumns(),
    buildMinuteColumns()
  ];
}

/** Date → 5 列索引 [年,月(0-11),日(0-30),时,分] */
function dateToIndices(date: Date, years: string[]): number[] {
  const y = String(date.getFullYear());
  const yi = Math.max(0, years.indexOf(y));
  const mi = Math.min(11, Math.max(0, date.getMonth()));
  const di = Math.min(
    daysInMonth(date.getFullYear(), date.getMonth() + 1) - 1,
    Math.max(0, date.getDate() - 1)
  );
  return [yi, mi, di, date.getHours(), date.getMinutes()];
}

/** 列索引 + 列数据 → 'YYYY-MM-DD HH:mm' */
function indicesToDueStr(cols: string[][], idx: number[]): string {
  const y = parseInt(cols[0][idx[0]], 10);
  const m = parseInt(cols[1][idx[1]], 10); // '9月' → 9
  const d = parseInt(cols[2][idx[2]], 10); // '11日' → 11
  const hh = parseInt(cols[3][idx[3]], 10); // '14时' → 14
  const mm = parseInt(cols[4][idx[4]], 10);
  return `${y}-${pad2(m)}-${pad2(d)} ${pad2(hh)}:${pad2(mm)}`;
}

/**
 * 'YYYY-MM-DD HH:mm'（或兼容旧的 'YYYY-MM-DD HH:mm:ss'）→ 5 列索引；
 * 无法解析时回退到「现在」。
 */
function dueStrToIndices(str: string, years: string[]): number[] {
  if (!str) return dateToIndices(new Date(), years);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return dateToIndices(new Date(), years);
  const date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  return dateToIndices(date, years);
}

/* ============================ 类型 ============================ */

interface Form {
  content: string;
  priority: Priority | null;
  dueDateStr: string; // 'YYYY-MM-DD HH:mm'，空字符串表示未选
  location: string;
  people: string[];
  tags: string[];
  description: string;
  attachments: IAttachment[];
}

interface CompData {
  visible: boolean;
  isEdit: boolean;
  form: Form;
  personDraft: string;
  tagDraft: string;
  priorityOptions: { value: Priority; label: string }[];
  /** 5 列选择器数据：年 / 月 / 日 / 时 / 分 */
  dueColumns: string[][];
  /** 当前选中的 5 列索引 */
  dueColumnIdx: number[];
}

const EMPTY_FORM: Form = {
  content: '',
  priority: null,
  dueDateStr: '',
  location: '',
  people: [],
  tags: [],
  description: '',
  attachments: []
};

Component({
  options: {
    multipleSlots: false,
    styleIsolation: 'apply-shared'
  },

  data: {
    visible: false,
    isEdit: false,
    form: { ...EMPTY_FORM },
    personDraft: '',
    tagDraft: '',
    priorityOptions: [
      { value: 'high', label: '高' },
      { value: 'medium', label: '中' },
      { value: 'low', label: '低' }
    ],
    dueColumns: [[], [], [], [], []],
    dueColumnIdx: [0, 0, 0, 0, 0]
  } as CompData,

  methods: {
    /* ============ 打开 / 关闭 ============ */
    open(payload?: { id?: string; todo?: ITodo }): void {
      let form: Form;
      let isEdit = false;
      let idx: number[];
      const now = new Date();
      if (payload && payload.todo) {
        const t = payload.todo;
        form = {
          content: t.content || '',
          priority: (t.priority as Priority | null) || null,
          dueDateStr: t.dueDate ? this.tsToDateStr(t.dueDate) : '',
          location: t.location || '',
          people: Array.isArray(t.people) ? t.people.slice() : [],
          tags: Array.isArray(t.tags) ? t.tags.slice() : [],
          description: t.description || '',
          attachments: Array.isArray(t.attachments) ? t.attachments.slice() : []
        };
        isEdit = true;
        const years = buildYearColumns(now, t.dueDate ? new Date(t.dueDate).getFullYear() : undefined);
        idx = dueStrToIndices(form.dueDateStr, years);
        const cols = buildAllColumns(years, idx[0], idx[1]);
        this.setData({ visible: true, isEdit, form, personDraft: '', tagDraft: '', dueColumns: cols, dueColumnIdx: idx });
        return;
      }
      form = { ...EMPTY_FORM };
      const years = buildYearColumns(now);
      idx = dateToIndices(now, years); // 新建默认落在「现在」，方便微调
      const cols = buildAllColumns(years, idx[0], idx[1]);
      this.setData({ visible: true, isEdit, form, personDraft: '', tagDraft: '', dueColumns: cols, dueColumnIdx: idx });
    },

    close(): void {
      this.setData({ visible: false });
    },

    /* ============ 输入处理 ============ */
    onInputContent(e: WechatMiniprogram.InputEvent): void {
      this.patchForm({ content: e.detail.value });
    },
    onInputLocation(e: WechatMiniprogram.InputEvent): void {
      this.patchForm({ location: e.detail.value });
    },
    onInputDescription(e: WechatMiniprogram.InputEvent): void {
      this.patchForm({ description: e.detail.value });
    },
    onPickPriority(e: WechatMiniprogram.TouchEvent): void {
      const v = e.currentTarget.dataset.value as Priority;
      const next = this.data.form.priority === v ? null : v;
      this.patchForm({ priority: next });
    },

    /** 某一列滚动时触发：年/月变化时需重建「日」列并夹紧越界索引 */
    onDueColumnChange(e: WechatMiniprogram.CustomEvent<{ column: number; value: number }>): void {
      const { column, value } = e.detail;
      const cols = this.data.dueColumns.map((c) => c.slice());
      const idx = this.data.dueColumnIdx.slice();
      idx[column] = value;
      if (column === 0 || column === 1) {
        const year = parseInt(cols[0][idx[0]], 10);
        const month = parseInt(cols[1][idx[1]], 10); // '9月' → 9
        const days = buildDayColumns(year, month);
        cols[2] = days;
        if (idx[2] > days.length - 1) idx[2] = days.length - 1;
      }
      this.setData({ dueColumns: cols, dueColumnIdx: idx });
    },

    /** 点击「确定」提交选择：把 5 列索引翻译成完整时间串 */
    onPickDue(e: WechatMiniprogram.CustomEvent<{ value: number[] }>): void {
      const idx = e.detail.value;
      const str = indicesToDueStr(this.data.dueColumns, idx);
      this.setData({ dueColumnIdx: idx });
      this.patchForm({ dueDateStr: str });
    },

    onClearDue(): void {
      const years = this.data.dueColumns[0];
      const idx = years.length ? dateToIndices(new Date(), years) : [0, 0, 0, 0, 0];
      this.setData({ dueColumnIdx: idx });
      this.patchForm({ dueDateStr: '' });
    },

    /* ============ 人物 ============ */
    onInputPersonDraft(e: WechatMiniprogram.InputEvent): void {
      this.setData({ personDraft: e.detail.value });
    },
    onAddPerson(): void {
      const name = (this.data.personDraft || '').trim();
      if (!name) return;
      const people = this.data.form.people.slice();
      if (people.length >= 8) {
        wx.showToast({ title: '最多 8 位', icon: 'none' });
        return;
      }
      if (people.indexOf(name) >= 0) {
        wx.showToast({ title: '已存在', icon: 'none' });
        return;
      }
      people.push(name);
      this.patchForm({ people });
      this.setData({ personDraft: '' });
    },
    onRemovePerson(e: WechatMiniprogram.TouchEvent): void {
      const idx = Number(e.currentTarget.dataset.index);
      const people = this.data.form.people.slice();
      if (idx >= 0 && idx < people.length) people.splice(idx, 1);
      this.patchForm({ people });
    },

    /* ============ 标签 ============ */
    onInputTagDraft(e: WechatMiniprogram.InputEvent): void {
      this.setData({ tagDraft: e.detail.value });
    },
    onAddTag(): void {
      const name = (this.data.tagDraft || '').trim();
      if (!name) return;
      const tags = this.data.form.tags.slice();
      if (tags.length >= 8) {
        wx.showToast({ title: '最多 8 个', icon: 'none' });
        return;
      }
      if (tags.indexOf(name) >= 0) {
        wx.showToast({ title: '已存在', icon: 'none' });
        return;
      }
      tags.push(name);
      this.patchForm({ tags });
      this.setData({ tagDraft: '' });
    },
    onRemoveTag(e: WechatMiniprogram.TouchEvent): void {
      const idx = Number(e.currentTarget.dataset.index);
      const tags = this.data.form.tags.slice();
      if (idx >= 0 && idx < tags.length) tags.splice(idx, 1);
      this.patchForm({ tags });
    },

    /* ============ 图片附件（复用 attachment-bar 的选图+上传+展示） ============ */

    /** attachment-bar 选好图片并落库后回调：合并进表单附件 */
    onAttachChange(e: WechatMiniprogram.CustomEvent<{ added: IAttachment[] }>): void {
      const added = (e.detail && e.detail.added) || [];
      if (!added.length) return;
      const attachments = this.data.form.attachments.concat(added);
      this.patchForm({ attachments });
    },
    /** 单图上传完成（url 换成云 fileID）后回调：就地更新该附件 */
    onAttachUpdate(e: WechatMiniprogram.CustomEvent<{ id: string; patch: Partial<IAttachment> }>): void {
      const { id, patch } = e.detail || ({} as { id: string; patch: Partial<IAttachment> });
      if (!id) return;
      const attachments = this.data.form.attachments.map((a) => (a.id === id ? { ...a, ...patch } : a));
      this.patchForm({ attachments });
    },
    /** 删除附件后回调：从表单移除 */
    onAttachRemove(e: WechatMiniprogram.CustomEvent<{ id: string }>): void {
      const id = (e.detail && e.detail.id) || '';
      if (!id) return;
      const attachments = this.data.form.attachments.filter((a) => a.id !== id);
      this.patchForm({ attachments });
    },

    /* ============ 提交 / 取消 ============ */
    onCancel(): void {
      this.close();
      this.triggerEvent('cancel');
    },
    async onSubmit(): Promise<void> {
      const f = this.data.form;
      const content = (f.content || '').trim();
      if (!content) {
        wx.showToast({ title: '请输入任务内容', icon: 'none' });
        return;
      }
      if (content.length > 200) {
        wx.showToast({ title: '内容不能超过 200 字', icon: 'none' });
        return;
      }
      // 等待图片上传完成：避免提交瞬间还带着本地临时路径（冷启动后会失效）
      const bar = this.selectComponent('#attBar') as { flush?: () => Promise<void> } | null;
      if (bar && typeof bar.flush === 'function') {
        wx.showLoading({ title: '上传中…', mask: true });
        try {
          await bar.flush();
        } finally {
          wx.hideLoading();
        }
      }
      // iOS 兼容：new Date 解析 'YYYY-MM-DD HH:mm' 需用 'T' 分隔，不能用空格
      const dueTs = f.dueDateStr
        ? new Date(f.dueDateStr.replace(' ', 'T')).getTime()
        : null;
      const payload = {
        content,
        priority: f.priority,
        dueDate: dueTs,
        location: (f.location || '').trim() || null,
        people: f.people.slice(),
        tags: f.tags.slice(),
        description: (f.description || '').trim() || null,
        attachments: (this.data.form.attachments || []).slice()
      };
      this.triggerEvent('submit', payload);
    },

    /* ============ 工具 ============ */
    patchForm(patch: Partial<Form>): void {
      const form = { ...this.data.form, ...patch };
      this.setData({ form });
    },
    /** 时间戳 → 'YYYY-MM-DD HH:mm'（含时分，用于编辑回显） */
    tsToDateStr(ts: number): string {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
        d.getHours()
      )}:${pad2(d.getMinutes())}`;
    },
    noop(): void {
      // 阻止冒泡
    }
  }
});
