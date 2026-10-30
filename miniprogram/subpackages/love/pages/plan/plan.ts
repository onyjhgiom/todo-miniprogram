// pages/love/plan/plan.ts
// 共同心愿 + 共同约定 · 两个人的清单，进度互相可见
//
// 心愿：想一起做的事（旅行、看演唱会…），完成就打个勾。
// 约定：需要分步推进的事（一起存钱、一起健身…），带 0~100% 进度条，双方都能拖动更新。
// 两类都是共享条目：谁改的会在列表里标出来，避免「我以为你做了」的误会。
import { applySkin, watchSkin, guardTap, confirmDanger, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { isBound, getPair, myRole, myName, partnerName, refreshStatus } from '../../utils/love-pair';
import {
  listWishes, addWish, toggleWish, delWish,
  listTasks, addTask, setTaskProgress, toggleTask, delTask,
  dateKey, syncKind
} from '../../utils/love-duo';
import type { DuoWish, DuoTask } from '../../utils/love-duo';
import { go } from '../../../../utils/nav';

interface WishView {
  id: string; title: string; note: string; done: boolean; target: string; who: string; mine: boolean;
}
interface TaskView {
  id: string; title: string; note: string; progress: number; done: boolean; due: string; who: string; mine: boolean;
}

interface PlanData {
  skin: SkinView;
  bound: boolean;
  tab: 'wish' | 'task';
  wishes: WishView[];
  tasks: TaskView[];
  wTitle: string;
  wNote: string;
  wTarget: string;
  tTitle: string;
  tNote: string;
  tDue: string;
  doneCount: number;
  totalCount: number;
}

Page<PlanData>({
  data: {
    skin: { key: 'dream', style: '', dark: true, name: '', emoji: '' },
    bound: false,
    tab: 'wish',
    wishes: [],
    tasks: [],
    wTitle: '',
    wNote: '',
    wTarget: '',
    tTitle: '',
    tNote: '',
    tDue: '',
    doneCount: 0,
    totalCount: 0
  },

  onLoad() {
    this.setData({ skin: applySkin() });
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.render();
  },

  onShow() {
    this.render();
    if (getPair().pairId) {
      void refreshStatus().then(() => {
        if (!isBound()) return;
        void syncKind('wish').then(() => this.render());
        void syncKind('task').then(() => this.render());
      });
    }
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  unsub: null as (() => void) | null,

  render() {
    const me = myRole();
    const ta = partnerName();
    const wishes = listWishes().map((w) => {
      const d = w.data as DuoWish;
      return {
        id: w.id,
        title: d.title,
        note: d.note,
        done: !!d.done,
        target: d.target || '',
        who: w.by === me ? myName() : ta,
        mine: w.by === me
      };
    });
    const tasks = listTasks().map((t) => {
      const d = t.data as DuoTask;
      return {
        id: t.id,
        title: d.title,
        note: d.note,
        progress: d.progress || 0,
        done: !!d.done,
        due: d.due || '',
        who: t.by === me ? myName() : ta,
        mine: t.by === me
      };
    });
    const doneCount = wishes.filter((w) => w.done).length + tasks.filter((t) => t.done).length;
    this.setData({
      bound: isBound(),
      wishes,
      tasks,
      doneCount,
      totalCount: wishes.length + tasks.length
    });
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const t = e.currentTarget.dataset.t as string;
    this.setData({ tab: t === 'task' ? 'task' : 'wish' });
  },

  /* ============================ 心愿 ============================ */

  onWTitle(e: WechatMiniprogram.InputEvent) { this.setData({ wTitle: e.detail.value || '' }); },
  onWNote(e: WechatMiniprogram.InputEvent) { this.setData({ wNote: e.detail.value || '' }); },
  onWTarget(e: WechatMiniprogram.PickerChangeEvent) { this.setData({ wTarget: String(e.detail.value || '') }); },

  onAddWish() {
    if (!guardTap('add_wish', 500)) return;
    const t = (this.data.wTitle || '').trim();
    if (!t) { toast('写下想一起做的事'); return; }
    addWish(t, this.data.wNote, this.data.wTarget);
    toast(isBound() ? '已加入心愿清单' : '已添加（未绑定，仅自己可见）');
    this.setData({ wTitle: '', wNote: '', wTarget: '' });
    this.render();
  },

  onToggleWish(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    toggleWish(id);
    this.render();
  },

  onDelWish(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('确定删除这个心愿吗？', () => { delWish(id); this.render(); toast('已删除'); }, '删除心愿');
  },

  /* ============================ 约定 / 任务 ============================ */

  onTTitle(e: WechatMiniprogram.InputEvent) { this.setData({ tTitle: e.detail.value || '' }); },
  onTNote(e: WechatMiniprogram.InputEvent) { this.setData({ tNote: e.detail.value || '' }); },
  onTDue(e: WechatMiniprogram.PickerChangeEvent) { this.setData({ tDue: String(e.detail.value || '') }); },

  onAddTask() {
    if (!guardTap('add_task', 500)) return;
    const t = (this.data.tTitle || '').trim();
    if (!t) { toast('写下我们的约定'); return; }
    addTask(t, this.data.tNote, this.data.tDue);
    toast(isBound() ? '已创建约定，进度会同步' : '已添加（未绑定，仅自己可见）');
    this.setData({ tTitle: '', tNote: '', tDue: '' });
    this.render();
  },

  onProgress(e: WechatMiniprogram.CustomEvent<number>) {
    const id = e.currentTarget.dataset.id as string;
    const v = Number((e.detail && e.detail.value) || 0);
    if (!id) return;
    setTaskProgress(id, v);
    this.render();
  },

  onToggleTask(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    toggleTask(id);
    this.render();
  },

  onDelTask(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('确定删除这个约定吗？', () => { delTask(id); this.render(); toast('已删除'); }, '删除约定');
  },

  onGoBind() {
    go('/subpackages/love/pages/couple/couple', { title: '双人空间', loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '爱遇小栈 · 心愿与约定',
      path: '/subpackages/love/pages/plan/plan'
    };
  }
});
