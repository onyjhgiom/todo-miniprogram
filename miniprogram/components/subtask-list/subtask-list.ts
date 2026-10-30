// components/subtask-list/subtask-list.ts
import type { ISubtask } from '../../types/index';

Component({
  properties: {
    items: { type: Array, value: [] as ISubtask[] }
  },
  data: {
    newContent: '',
    totalCount: 0,
    doneCount: 0,
    progressPercent: 0
  },
  observers: {
    'items': function (items: ISubtask[]) {
      const total = (items || []).length;
      const done = (items || []).filter((s) => s.completed).length;
      this.setData({
        totalCount: total,
        doneCount: done,
        progressPercent: total === 0 ? 0 : Math.round((done / total) * 100)
      });
    }
  },
  methods: {
    onInput(e: WechatMiniprogram.InputEvent) {
      this.setData({ newContent: e.detail.value });
    },
    onAdd() {
      const content = (this.data.newContent || '').trim();
      if (!content) return;
      this.triggerEvent('add', { content });
      this.setData({ newContent: '' });
    },
    onToggle(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      const completed = e.currentTarget.dataset.completed as boolean;
      this.triggerEvent('toggle', { id, completed });
    },
    onRemove(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      wx.showModal({
        title: '删除子任务？',
        success: (res) => {
          if (res.confirm) this.triggerEvent('remove', { id });
        }
      });
    },
    onClearDone() {
      this.triggerEvent('cleardone');
    },
    onEdit(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      const content = e.currentTarget.dataset.content as string;
      wx.showModal({
        title: '编辑子任务',
        editable: true,
        placeholderText: '子任务内容',
        content,
        success: (res) => {
          if (res.confirm && res.content) {
            this.triggerEvent('update', { id, content: res.content });
          }
        }
      });
    }
  }
});