// subpackages/tools/pages/wheel/edit.ts
// 万能转盘 · 选项编辑页：文字 / 图标 / 颜色 / 权重 / 排序 + 批量导入 + 从待办导入
//
// 编辑期间维护一份 draft，改动后防抖 1s 写回 store（意外退出也不丢），
// 点「保存」时立即落盘并返回主页。主页 onShow 会重新读一次，保证转盘同步刷新。

import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { back } from '../../../../utils/nav';
import * as todoStore from '../../../../utils/todo-store';
import * as store from '../../utils/wheel-store';
import { inkOn } from '../../utils/wheel-canvas';
import { PALETTES, WHEEL_ICONS, paletteColor } from '../../utils/wheel-templates';
import type { PaletteKey } from '../../utils/wheel-templates';
import type { IWheel, IWheelOption } from '../../utils/wheel-store';
import type { ThemeKey } from '../../../../types/index';

/** 草稿（编辑中的转盘） */
let draft: IWheel | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 从待办导入时选中的待办 id */
let pickedTodos: string[] = [];

interface IEditRow {
  id: string;
  text: string;
  color: string;
  icon: string;
  weight: number;
  ink: string;
  idx: number;
  /** 是否由待办导入（可打勾标记） */
  fromTodo: boolean;
  done: boolean;
}

interface ITodoPick {
  id: string;
  content: string;
  picked: boolean;
  meta: string;
}

interface IEditData {
  theme: ThemeKey;
  themeStyle: string;
  wheelId: string;
  name: string;
  themeKey: PaletteKey;
  paletteLabel: string;
  rows: IEditRow[];
  count: number;
  canAdd: boolean;
  /** 图标选择弹层 */
  showIcons: boolean;
  iconIdx: number;
  icons: string[];
  /** 颜色选择弹层 */
  showColors: boolean;
  colorIdx: number;
  colors: string[];
  /** 批量粘贴 */
  showPaste: boolean;
  pasteText: string;
  /** 待办导入 */
  showTodos: boolean;
  todoList: ITodoPick[];
  todoPicked: number;
}

const COLOR_POOL: PaletteKey[] = ['candy', 'morandi', 'festive', 'ocean'];

Page<IEditData>({
  data: {
    theme: 'light',
    themeStyle: '',
    wheelId: '',
    name: '',
    themeKey: 'candy',
    paletteLabel: '糖果色',
    rows: [],
    count: 0,
    canAdd: true,
    showIcons: false,
    iconIdx: -1,
    icons: WHEEL_ICONS,
    showColors: false,
    colorIdx: -1,
    colors: PALETTES.candy.colors,
    showPaste: false,
    pasteText: '',
    showTodos: false,
    todoList: [],
    todoPicked: 0
  },

  onLoad(query: Record<string, string>) {
    this.applyThemeToPage();
    const id = query && query.id;
    const w = id ? store.getWheel(id) : null;
    if (!w) {
      toast('转盘不存在');
      setTimeout(() => back(1), 600);
      return;
    }
    draft = JSON.parse(JSON.stringify(w)) as IWheel;
    this.syncRows();
    this.setData({
      wheelId: w._id,
      name: w.name,
      themeKey: w.theme,
      paletteLabel: (PALETTES[w.theme] || PALETTES.candy).label,
      colors: (PALETTES[w.theme] || PALETTES.candy).colors
    });
  },

  onUnload() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // 直接返回（未点保存）也保留改动：与「自动保存」的预期一致
    if (draft) store.replaceWheel(draft);
  },

  applyThemeToPage() {
    const state = getThemeState();
    this.setData({ theme: state.theme, themeStyle: state.themeStyle });
    syncNavBar(state);
  },

  syncRows() {
    if (!draft) return;
    const rows: IEditRow[] = draft.options.map((o, i) => ({
      id: o.id,
      text: o.text,
      color: o.color,
      icon: o.icon || '',
      weight: o.weight,
      ink: inkOn(o.color),
      idx: i,
      fromTodo: !!o.todoId,
      done: !!o.done
    }));
    this.setData({
      rows,
      count: rows.length,
      canAdd: rows.length < store.MAX_OPTIONS
    });
  },

  /** 防抖写回（1s），避免每敲一个字都写盘 */
  commit() {
    if (!draft) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (draft) store.replaceWheel(draft);
    }, 1000);
  },

  /* ==================== 基础字段 ==================== */

  onNameInput(e: WechatMiniprogram.InputEvent) {
    const v = String(e.detail.value || '').slice(0, 16);
    this.setData({ name: v });
    if (draft) draft.name = v;
    this.commit();
  },

  onTextInput(e: WechatMiniprogram.InputEvent) {
    const ds = e.currentTarget.dataset as { idx?: string };
    const i = Number(ds.idx);
    if (!draft || isNaN(i) || !draft.options[i]) return;
    const v = String(e.detail.value || '').slice(0, 10);
    draft.options[i].text = v;
    this.commit();
  },

  onAddOption() {
    if (!draft) return;
    if (draft.options.length >= store.MAX_OPTIONS) {
      toast(`最多 ${store.MAX_OPTIONS} 个选项`);
      return;
    }
    const colors = (PALETTES[draft.theme] || PALETTES.candy).colors;
    const o: IWheelOption = {
      id: `wo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: `选项${draft.options.length + 1}`,
      color: colors[draft.options.length % colors.length],
      weight: 1,
      icon: ''
    };
    draft.options.push(o);
    this.syncRows();
    this.commit();
  },

  onDelOption(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { idx?: string };
    const i = Number(ds.idx);
    if (!draft || isNaN(i)) return;
    if (draft.options.length <= store.MIN_OPTIONS) {
      toast(`至少保留 ${store.MIN_OPTIONS} 个选项`);
      return;
    }
    draft.options.splice(i, 1);
    this.syncRows();
    this.commit();
  },

  /** 上移 / 下移（比拖拽排序稳，12 项以内点两下就够了） */
  onMove(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { idx?: string; dir?: string };
    const i = Number(ds.idx);
    const dir = Number(ds.dir);
    if (!draft || isNaN(i)) return;
    const j = i + dir;
    if (j < 0 || j >= draft.options.length) return;
    const arr = draft.options;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
    this.syncRows();
    this.commit();
  },

  /* ==================== 权重 ==================== */

  onWeight(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { idx?: string };
    const i = Number(ds.idx);
    if (!draft || isNaN(i) || !draft.options[i]) return;
    const items = ['1 倍', '2 倍', '3 倍', '4 倍', '5 倍', '6 倍', '7 倍', '8 倍', '9 倍'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const w = res.tapIndex + 1;
        draft!.options[i].weight = w;
        this.syncRows();
        this.commit();
      },
      fail: () => undefined
    });
  },

  /* ==================== 图标 / 颜色 ==================== */

  onPickIcon(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { idx?: string };
    this.setData({ showIcons: true, iconIdx: Number(ds.idx) });
  },

  onCloseIcons() {
    this.setData({ showIcons: false, iconIdx: -1 });
  },

  onChooseIcon(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { v?: string };
    const i = this.data.iconIdx;
    if (!draft || i < 0 || !draft.options[i]) return;
    draft.options[i].icon = ds.v === '__none__' ? '' : String(ds.v || '');
    this.setData({ showIcons: false, iconIdx: -1 });
    this.syncRows();
    this.commit();
  },

  onPickColor(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { idx?: string };
    this.setData({ showColors: true, colorIdx: Number(ds.idx) });
  },

  onCloseColors() {
    this.setData({ showColors: false, colorIdx: -1 });
  },

  onChooseColor(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { v?: string };
    const i = this.data.colorIdx;
    if (!draft || i < 0 || !draft.options[i]) return;
    draft.options[i].color = String(ds.v || draft.options[i].color);
    this.setData({ showColors: false, colorIdx: -1 });
    this.syncRows();
    this.commit();
  },

  /** 整体换色盘：一键把全部选项重排色 */
  onPalette() {
    if (!draft) return;
    const labels = COLOR_POOL.map((k) => PALETTES[k].label);
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const key = COLOR_POOL[res.tapIndex];
        if (!key) return;
        draft!.theme = key;
        draft!.options = draft!.options.map((o, i) => ({ ...o, color: paletteColor(key, i) }));
        this.setData({ themeKey: key, paletteLabel: PALETTES[key].label, colors: PALETTES[key].colors });
        this.syncRows();
        this.commit();
      },
      fail: () => undefined
    });
  },

  /* ==================== 批量导入 ==================== */

  onOpenPaste() {
    this.setData({ showPaste: true, pasteText: '' });
  },

  onClosePaste() {
    this.setData({ showPaste: false });
  },

  onPasteInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ pasteText: String(e.detail.value || '') });
  },

  onPasteConfirm() {
    if (!draft) return;
    const raw = this.data.pasteText || '';
    // 支持中文逗号 / 顿号 / 换行 / 分号混排
    const parts = raw
      .split(/[\n\r,，、;；]+/)
      .map((s) => s.trim())
      .filter((s) => !!s);
    if (!parts.length) {
      toast('没有识别到内容');
      return;
    }
    const colors = (PALETTES[draft.theme] || PALETTES.candy).colors;
    let added = 0;
    parts.forEach((text, k) => {
      if (draft!.options.length >= store.MAX_OPTIONS) return;
      draft!.options.push({
        id: `wo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${k}`,
        text: text.slice(0, 10),
        color: colors[draft!.options.length % colors.length],
        weight: 1,
        icon: ''
      });
      added += 1;
    });
    this.setData({ showPaste: false, pasteText: '' });
    this.syncRows();
    this.commit();
    toast(`已导入 ${added} 项`);
  },

  /** 从待办导入：把未完成的待办变成选项，用于「今日任务随机做」 */
  async onImportTodos() {
    try {
      await todoStore.ensureLoaded();
      const todos = todoStore
        .list()
        .filter((t) => !t.completed && !t.archived)
        .slice(0, 40);
      if (!todos.length) {
        toast('没有未完成的待办');
        return;
      }
      pickedTodos = [];
      const list: ITodoPick[] = todos.map((t) => ({
        id: t._id,
        content: t.content,
        picked: false,
        meta: t.dueDate ? '有截止' : '无截止'
      }));
      this.setData({ showTodos: true, todoList: list, todoPicked: 0 });
    } catch (err) {
      toast('读取待办失败');
    }
  },

  onCloseTodos() {
    this.setData({ showTodos: false });
  },

  onToggleTodoPick(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { id?: string; idx?: string };
    const i = Number(ds.idx);
    const list = this.data.todoList.slice();
    if (isNaN(i) || !list[i]) return;
    list[i].picked = !list[i].picked;
    const picked = list.filter((t) => t.picked).length;
    pickedTodos = list.filter((t) => t.picked).map((t) => t.id);
    this.setData({ todoList: list, todoPicked: picked });
  },

  onImportConfirm() {
    if (!draft) return;
    if (!pickedTodos.length) {
      toast('请先勾选待办');
      return;
    }
    const colors = (PALETTES[draft.theme] || PALETTES.candy).colors;
    let added = 0;
    pickedTodos.forEach((id) => {
      if (draft!.options.length >= store.MAX_OPTIONS) return;
      const t = todoStore.getById(id);
      if (!t) return;
      draft!.options.push({
        id: `wo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        text: String(t.content || '').slice(0, 10),
        color: colors[draft!.options.length % colors.length],
        weight: 1,
        icon: '✅',
        todoId: t._id
      });
      added += 1;
    });
    this.setData({ showTodos: false, todoList: [], todoPicked: 0 });
    pickedTodos = [];
    this.syncRows();
    this.commit();
    toast(`已导入 ${added} 项待办`);
  },

  /* ==================== 打乱 / 清空 / 保存 ==================== */

  onShuffle() {
    if (!draft) return;
    const arr = draft.options;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    // 重排后按新顺序重新配色，保持相邻不同色
    const colors = (PALETTES[draft.theme] || PALETTES.candy).colors;
    draft.options = draft.options.map((o, i) => ({ ...o, color: colors[i % colors.length] }));
    this.syncRows();
    this.commit();
    toast('已打乱顺序');
  },

  onClear() {
    wx.showModal({
      title: '清空全部选项',
      content: '清空后转盘将无法转动，需要重新添加选项。',
      success: (res) => {
        if (!res.confirm || !draft) return;
        draft.options = [];
        this.syncRows();
        this.commit();
      }
    });
  },

  onSave() {
    if (!draft) return;
    const name = String(draft.name || '').trim();
    if (!name) {
      toast('请填写转盘名称');
      return;
    }
    const valid = draft.options.filter((o) => String(o.text || '').trim());
    if (valid.length < store.MIN_OPTIONS) {
      wx.showModal({
        title: '选项不足',
        content: `至少需要 ${store.MIN_OPTIONS} 个选项才能转动，是否仍要保存？`,
        success: (res) => {
          if (res.confirm) this.doSave();
        }
      });
      return;
    }
    this.doSave();
  },

  doSave() {
    if (!draft) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    store.replaceWheel(draft);
    toast('已保存');
    setTimeout(() => back(1), 350);
  },

  onBack() {
    back(1);
  },

  onNoop() {
    /* 阻止冒泡 */
  }
});
