// components/task-card/task-card.ts
// 「当前任务」卡（需求十二）：把番茄钟与待办系统接成闭环。
// 组件只负责两种意图的回抛 —— 换一个任务 / 新建任务 / 解绑，
// 真正的待办读写由页面调 utils 层完成（组件不碰业务数据源）。

Component({
  options: { addGlobalClass: false },

  properties: {
    /** 已关联任务标题（空串 = 未关联） */
    title: { type: String, value: '' },
    /** 今日目标完成数 */
    done: { type: Number, value: 0 },
    /** 今日目标总数，0 表示未设目标 */
    target: { type: Number, value: 0 },
    /** 计时中禁止改绑（避免本轮日志与任务对不上） */
    locked: { type: Boolean, value: false }
  },

  methods: {
    onPick() {
      if (this.data.locked) return;
      this.triggerEvent('pick');
    },
    onAdd() {
      this.triggerEvent('add');
    },
    onUnbind() {
      if (this.data.locked) return;
      this.triggerEvent('unbind');
    }
  }
});
