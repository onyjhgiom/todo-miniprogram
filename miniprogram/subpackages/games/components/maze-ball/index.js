// subpackages/games/components/maze-ball/index.js
// 迷宫小球：位置、尺寸、撞墙回弹全部自持。
//
// 为什么要独立成组件（渲染隔离）：
//   原来小球坐标（playerLeft/playerTop）、球径、撞墙状态都挂在页面 data 上，
//   每走一步页面都要 setData —— 而 wxml 里 400 个格子的 class 表达式引用了这些字段
//   （trail / hintPath / bump），于是「走一格 = 整块棋盘重渲染」。
//   在 20×20 关卡按住方向键连发时，一步一次全量重渲染，帧率撑不住，
//   表现就是小球移动时画面在抖 / 一顿一顿。
//
//   收进组件后：走一步只调用本组件的 setData，只更新组件内部 3 个节点，
//   棋盘节点完全不参与 diff —— 移动不再牵动整页。
Component({
  data: {
    left: 0,
    top: 0,
    size: 20,
    half: 10,
    moveMs: 130,
    bump: '',
    // 首次落位 / 换关时不做补间：否则小球会从上一位置「飞」过来，看起来像抖一下
    instant: true
  },

  lifetimes: {
    detached() {
      this._clearBumpTimer();
    }
  },

  methods: {
    /**
     * 落位（首次进入 / 重新量格子 / 换关）。
     * instant 固定为 true：位置瞬移到位，不播补间。
     */
    setup(cfg) {
      const c = cfg || {};
      this._clearBumpTimer();
      this.setData({
        left: c.left || 0,
        top: c.top || 0,
        size: c.size || 20,
        half: c.half || 10,
        moveMs: c.moveMs || 130,
        bump: '',
        instant: true
      });
    },

    /** 移动一格：补间时长由页面按格子大小下发 */
    moveTo(left, top, moveMs) {
      this.setData({ left, top, moveMs: moveMs || 130, instant: false });
    },

    /**
     * 撞墙回弹。
     * 同方向 150ms 内的重复撞击不重启动画 —— 按住方向键顶墙时会以 ~105ms 的节奏连撞，
     * 每次都重放动画反而抖得厉害；这里让它自然播完，反馈连续但不闪。
     */
    bump(dir) {
      if (!dir) return;
      const now = Date.now();
      if (this.data.bump === dir && now - (this._bumpAt || 0) < 150) return;
      this._bumpAt = now;
      this._clearBumpTimer();
      this.setData({ bump: dir });
      this._bumpTimer = setTimeout(() => {
        this._bumpTimer = null;
        if (this.data.bump === dir) this.setData({ bump: '' });
      }, 180);
    },

    _clearBumpTimer() {
      if (this._bumpTimer) {
        clearTimeout(this._bumpTimer);
        this._bumpTimer = null;
      }
    }
  }
});
