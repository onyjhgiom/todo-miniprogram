// pages/kanban/kanban.ts
// 四象限看板：重要 × 紧急
// 优化点（本版）：
//  1. 仅订阅一次数据源事件，任意位置写操作即时增量刷新，onShow 不再全量重建（秒开）
//  2. 首次才显示 loading；之后进入直接复用已有数据，仅靠订阅保持最新
//  3. 新增/编辑/移动/完成/删除均乐观更新 + 订阅幂等同步，绝不整页 reload
//  4. 卡片常驻「完成」按钮，标记完成一步到位
// - 手动设置的任务象限（t.quadrant）优先展示，否则按优先级 + 截止时间自动判定
// - 所有写操作乐观更新：本地先行上屏，云端后台确认，失败回滚重载
import { callFn, toast, handleError } from '../../utils/cloud';
import * as todoStore from '../../utils/todo-store';
import { getThemeState, syncNavBar } from '../../utils/theme';
import { computeCountdown, formatMD } from '../../utils/date';
import type { ITodo, ThemeKey } from '../../types/index';
import { go } from '../../utils/nav';

interface KanbanItem {
  _id: string;
  content: string;
  dueDateText: string;
  completed: boolean;
}

type QuadrantKey = 'q1' | 'q2' | 'q3' | 'q4';
type Columns = Record<QuadrantKey, KanbanItem[]>;

const QUADRANT_LABELS: Record<number, string> = {
  1: '🔥 重要 + 紧急',
  2: '📌 重要 + 不紧急',
  3: '⚡ 紧急 + 不重要',
  4: '☁️ 不重要 + 不紧急'
};

function emptyColumns(): Columns {
  return { q1: [], q2: [], q3: [], q4: [] };
}

function qKey(q: number): QuadrantKey {
  return ('q' + q) as QuadrantKey;
}

// 看板为 tabBar 单例页面，订阅句柄用模块级保存即可（不随 onShow 重复订阅）
let storeUnsub: (() => void) | null = null;
let lastRebuildAt = 0;

Page<{
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  fxMode: string;
  fxLevel: number;
  fxSrc: string;
  fxFull: boolean;
  bgStyle: string;
  columns: Columns;
  loading: boolean;
  __inited: boolean;
}>({
  data: {
    theme: 'light',
    fxMode: 'sunset',
    fxLevel: 8,
    fxSrc: '',
    fxFull: false,
    bgStyle: '',
    themeStyle: '',
    heroGradient: '',
    columns: emptyColumns(),
    loading: true,
    __inited: false
  },

  onLoad() {
    this.applyThemeToPage();
    // 仅订阅一次：数据源任何写操作都会经 todo-store -> StoreEvent 推送到此，做增量刷新
    if (!storeUnsub) {
      storeUnsub = todoStore.subscribe((e) => this.onStoreEvent(e));
    }
    this.firstLoad();
  },

  onShow() {
    this.applyThemeToPage();
    if (!this.data.__inited) {
      // 首次进入（或上次加载失败）：全量加载
      this.firstLoad();
    } else if (Date.now() - lastRebuildAt > 30000) {
      // 已进入过：订阅已维持最新，秒开不重建；仅 30s 以上才兜底一次，防长时间后台被外部改动
      this.rebuildColumns();
    }
  },

  onUnload() {
    if (storeUnsub) {
      storeUnsub();
      storeUnsub = null;
    }
  },

  applyThemeToPage() {
    const state = getThemeState();
    // 主题未变时不重复 setData，避免整页重渲染
    if (state.theme !== this.data.theme || state.themeStyle !== this.data.themeStyle || state.fxSrc !== this.data.fxSrc) {
      this.setData({
        theme: state.theme,
        themeStyle: state.themeStyle,
        heroGradient: state.heroGradient,
        fxMode: state.fxMode,
        fxLevel: state.fxLevel,
        fxSrc: state.fxSrc,
        fxFull: state.fxFull,
        bgStyle: state.bgStyle
      } as Record<string, unknown>);
    }
    syncNavBar(state);
  },

  async firstLoad() {
    try {
      if (!this.data.__inited) this.setData({ loading: true });
      await todoStore.ensureLoaded();
      this.rebuildColumns();
      this.setData({ loading: false, __inited: true });
    } catch (err) {
      handleError(err, '加载失败');
      this.setData({ loading: false });
    }
  },

  /** 数据源事件：reset=整体重建，item=单条增量（新增/更新/跨象限/移除），progress 忽略 */
  onStoreEvent(e: todoStore.StoreEvent) {
    if (e.type === 'reset') {
      this.rebuildColumns();
    } else if (e.type === 'item' && e.id) {
      this.upsertItem(e.id);
    }
    // progress（后台分页补齐）忽略，避免无意义重渲染
  },

  /** 纯本地重算四象限，无网络请求 */
  rebuildColumns() {
    const items = todoStore.rawList().filter((t) => !t.completed && !t.archived);
    const columns = emptyColumns();
    for (const t of items) {
      const q = this.resolveQuadrant(t);
      columns[qKey(q)].push({
        _id: t._id,
        content: t.content,
        dueDateText: t.dueDate ? formatMD(t.dueDate) : '',
        completed: false
      });
    }
    this.setData({ columns });
    lastRebuildAt = Date.now();
  },

  /** 单条增量刷新：以数据源为唯一真相，幂等（新增/更新/移动/移除都安全） */
  upsertItem(id: string) {
    const t = todoStore.getById(id);
    if (!t || t.completed || t.archived) {
      this.removeItemLocal(id);
      return;
    }
    const targetKey = qKey(this.resolveQuadrant(t));
    const newItem: KanbanItem = {
      _id: t._id,
      content: t.content,
      dueDateText: t.dueDate ? formatMD(t.dueDate) : '',
      completed: false
    };
    const curKey = this.locateItem(id);
    if (!curKey) {
      // 新增
      this.setData({ [`columns.${targetKey}`]: [newItem, ...this.data.columns[targetKey]] });
    } else if (curKey === targetKey) {
      // 同象限内容变更
      this.patchItem(id, newItem);
    } else {
      // 跨象限移动
      const fromList = this.data.columns[curKey].filter((it) => it._id !== id);
      this.setData({
        [`columns.${curKey}`]: fromList,
        [`columns.${targetKey}`]: [newItem, ...this.data.columns[targetKey]]
      });
    }
  },

  /** 手动象限优先；未设置时按优先级（重要）× 截止时间（紧急）自动判定 */
  resolveQuadrant(t: ITodo): number {
    if (t.quadrant === 1 || t.quadrant === 2 || t.quadrant === 3 || t.quadrant === 4) {
      return t.quadrant;
    }
    const due = computeCountdown(t.dueDate);
    const important = t.priority === 'high' || t.priority === 'medium';
    const urgent = due.key === 'overdue' || due.key === 'today' || due.key === 'tomorrow';
    if (important && urgent) return 1;
    if (important && !urgent) return 2;
    if (!important && urgent) return 3;
    return 4;
  },

  // ============ 添加：每个象限头部 + 快速录入 ============
  onAddTo(e: WechatMiniprogram.TouchEvent) {
    const q = Number(e.currentTarget.dataset.q);
    wx.showModal({
      title: `添加到「${QUADRANT_LABELS[q].replace(/^\S+\s/, '')}」`,
      editable: true,
      placeholderText: '输入任务内容…',
      success: (r) => {
        if (!r.confirm) return;
        const content = (r.content || '').trim();
        if (!content) {
          toast('内容不能为空', 'none');
          return;
        }
        this.quickAdd(content, q);
      }
    });
  },

  async quickAdd(content: string, q: number) {
    const key = qKey(q);
    // 乐观插入：本地立刻上屏
    const tempId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tempItem: KanbanItem = { _id: tempId, content, dueDateText: '', completed: false };
    const backup = this.data.columns[key].slice();
    this.setData({ [`columns.${key}`]: [tempItem, ...this.data.columns[key]] });
    try {
      const res = (await callFn('todos', { action: 'add', content, quadrant: q })) as {
        id?: string;
        data?: { id?: string };
        _id?: string;
      };
      const realId = res?.id || res?.data?.id || res?._id;
      // 真实卡片由订阅（callFn 写成功 -> todo-store -> item 事件）负责插入；
      // 这里只需移除乐观占位即可，避免整页 reload
      this.removeItemLocal(tempId);
      if (realId && !this.locateItem(realId)) {
        this.upsertItem(realId);
      } else if (!realId) {
        // 极端情况取不到真实 id，兜底重建
        this.rebuildColumns();
      }
      toast('已添加', 'success');
    } catch (err) {
      this.setData({ [`columns.${key}`]: backup });
      handleError(err, '添加失败');
    }
  },

  // ============ 点击卡片：操作菜单 / 常驻完成 ============
  /** 常驻「完成」按钮：一步标记完成，省去弹菜单 */
  onCompleteTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (id) this.completeItem(id);
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.findItem(id);
    if (!item) return;
    wx.showActionSheet({
      itemList: ['查看详情', '编辑内容', '移动到其它象限', '标记完成', '删除任务'],
      itemColor: '#1a1d29',
      success: (r) => {
        switch (r.tapIndex) {
          case 0: this.viewDetail(id); break;
          case 1: this.editItem(id); break;
          case 2: this.moveItem(id); break;
          case 3: this.completeItem(id); break;
          case 4: this.deleteItem(id); break;
        }
      },
      fail: () => { /* 用户取消 */ }
    });
  },

  viewDetail(id: string) {
    go('/pages/detail/detail?id=' + id);
  },

  editItem(id: string) {
    const item = this.findItem(id);
    if (!item) return;
    wx.showModal({
      title: '编辑任务',
      editable: true,
      content: item.content,
      placeholderText: '任务内容…',
      success: async (r) => {
        if (!r.confirm) return;
        const content = (r.content || '').trim();
        if (!content || content === item.content) return;
        // 乐观编辑
        this.patchItem(id, { content });
        try {
          await callFn('todos', { action: 'update', id, content });
          toast('已更新', 'success');
          // 订阅会在写成功后自动同步，无需整页 reload
        } catch (err) {
          this.rebuildColumns();
          handleError(err, '更新失败');
        }
      }
    });
  },

  moveItem(id: string) {
    const item = this.findItem(id);
    if (!item) return;
    const currentQ = this.locateItem(id); // 当前所在象限 key
    // 列出其它 3 个象限作为目标
    const targets: number[] = [1, 2, 3, 4].filter((q) => ('q' + q) !== currentQ);
    wx.showActionSheet({
      itemList: targets.map((q) => `移动到 ${QUADRANT_LABELS[q]}`),
      itemColor: '#1a1d29',
      success: async (r) => {
        const targetQ = targets[r.tapIndex];
        if (!targetQ) return;
        await this.doMove(id, targetQ);
      },
      fail: () => { /* 用户取消 */ }
    });
  },

  async doMove(id: string, targetQ: number) {
    // 乐观移动：先本地搬移
    const fromKey = this.locateItem(id);
    const item = this.findItem(id);
    if (!fromKey || !item) return;
    const toKey = qKey(targetQ);
    const fromList = this.data.columns[fromKey].filter((it) => it._id !== id);
    const toList = [item, ...this.data.columns[toKey]];
    const backup = JSON.parse(JSON.stringify(this.data.columns)) as Columns;
    this.setData({
      [`columns.${fromKey}`]: fromList,
      [`columns.${toKey}`]: toList
    });
    try {
      await callFn('todos', { action: 'update', id, quadrant: targetQ });
      toast('已移动', 'success');
    } catch (err) {
      this.setData({ columns: backup });
      handleError(err, '移动失败');
    }
  },

  async completeItem(id: string) {
    // 乐观完成：看板只展示未完成，直接移除
    const backup = JSON.parse(JSON.stringify(this.data.columns)) as Columns;
    this.removeItemLocal(id);
    try {
      await callFn('todos', { action: 'toggle', id, completed: true });
      toast('已完成 🎉', 'success');
    } catch (err) {
      this.setData({ columns: backup });
      handleError(err, '操作失败');
    }
  },

  deleteItem(id: string) {
    const item = this.findItem(id);
    if (!item) return;
    const name = item.content.length > 16 ? item.content.slice(0, 16) + '…' : item.content;
    wx.showModal({
      title: '删除任务',
      content: `确定删除「${name}」吗？`,
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: async (r) => {
        if (!r.confirm) return;
        const backup = JSON.parse(JSON.stringify(this.data.columns)) as Columns;
        this.removeItemLocal(id);
        try {
          await callFn('todos', { action: 'delete', id });
          toast('已删除', 'success');
        } catch (err) {
          this.setData({ columns: backup });
          handleError(err, '删除失败');
        }
      }
    });
  },

  // ============ 本地工具 ============
  findItem(id: string): KanbanItem | null {
    for (const key of ['q1', 'q2', 'q3', 'q4'] as QuadrantKey[]) {
      const hit = this.data.columns[key].find((it) => it._id === id);
      if (hit) return hit;
    }
    return null;
  },

  locateItem(id: string): QuadrantKey | null {
    for (const key of ['q1', 'q2', 'q3', 'q4'] as QuadrantKey[]) {
      if (this.data.columns[key].some((it) => it._id === id)) return key;
    }
    return null;
  },

  patchItem(id: string, patch: Partial<KanbanItem>) {
    const key = this.locateItem(id);
    if (!key) return;
    const list = this.data.columns[key].map((it) => (it._id === id ? { ...it, ...patch } : it));
    this.setData({ [`columns.${key}`]: list });
  },

  removeItemLocal(id: string) {
    const key = this.locateItem(id);
    if (!key) return;
    this.setData({ [`columns.${key}`]: this.data.columns[key].filter((it) => it._id !== id) });
  }
});
