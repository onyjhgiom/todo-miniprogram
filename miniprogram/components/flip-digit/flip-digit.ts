// components/flip-digit/flip-digit.ts
// 3D 翻页数字组件：
//  - 值变化时执行「上半页翻落（0°→-90°）+ 下半页翻起（90°→0°）」的双段式立体动画
//  - 透视容器 + transform-origin 铰链 + 光影明暗关键帧，模拟真实翻页牌的厚度感
//  - 卡片尺寸由外部通过 class 控制，字号通过 CSS 变量 --fd-font 注入（组件样式隔离下变量可穿透）
// 用法：<flip-digit class="cell" style="--fd-font: 88rpx" value="{{digits[0]}}" />
const FLIP_MS = 700; // 与 wxss 中 top 320ms + delay 320ms + bottom 360ms 关键帧总时长匹配

Component({
  properties: {
    /** 当前显示的数字（单字符） */
    value: {
      type: String,
      value: '0',
      observer(next: string, prev: string) {
        const self = this as any;
        // 首次挂载（prev 为空）或值未变化时不翻页
        if (!prev || prev === next) return;
        self.startFlip(prev);
      }
    }
  },

  data: {
    /** 正在翻走的旧数字（翻页期间下半静止层显示它） */
    prev: '0',
    /** 是否处于翻页动画中（控制翻动层渲染与动画类名） */
    animating: false
  },

  lifetimes: {
    detached() {
      const timer = (this as any)._flipTimer as number | null;
      if (timer) {
        clearTimeout(timer);
        (this as any)._flipTimer = null;
      }
    }
  },

  methods: {
    /** 从 oldValue 翻到当前 value：先复位渲染旧数字，再下一拍启动动画，确保关键帧从头播放 */
    startFlip(oldValue: string) {
      const self = this as any;
      if (self._flipTimer) {
        clearTimeout(self._flipTimer);
        self._flipTimer = null;
      }
      this.setData({ prev: oldValue, animating: false }, () => {
        self.setData({ animating: true });
        self._flipTimer = setTimeout(() => {
          self.setData({ animating: false });
          self._flipTimer = null;
        }, FLIP_MS) as unknown as number;
      });
    }
  }
});
