// components/stats-card/stats-card.ts
// 顶部 hero：展示今日完成、进行中、本周完成、累计完成、连续天数
import { SCENE_BG } from '../../utils/scene-bg';

interface CompData {
  greet: string;
  /** 日期文案，如「9月9日 · 周三」 */
  dateText: string;
  /** deepsea 主题下 hero 的城市夜景背景（内联 data URI）；其余主题为空，走 CSS 渐变 */
  heroBgStyle: string;
}

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    active: { type: Number, value: 0 },
    todayDone: { type: Number, value: 0 },
    weekDone: { type: Number, value: 0 },
    totalDone: { type: Number, value: 0 },
    streak: { type: Number, value: 0 },
    /** 当前主题 key：dark 时 hero 加 hero--dark 类（组件 wxss 不允许属性选择器，改走 class） */
    theme: { type: String, value: 'light' }
  },

  // 注意：active/todayDone/weekDone/totalDone/streak 均以 properties 为准，
  // 不要在 data 中重复声明（会触发 "overwritten by property" 警告）
  data: {
    greet: '你好',
    dateText: '',
    heroBgStyle: ''
  } as CompData,

  observers: {
    /** 主题切换时重算 hero 背景：deepsea 用陆家嘴夜景图（左侧自带渐暗，文字可读） */
    theme(v: string) {
      this.applyHeroBg(v);
    }
  },

  lifetimes: {
    attached() {
      this.setData({ greet: this.computeGreet(), dateText: this.computeDateText() });
      this.applyHeroBg((this.properties as any).theme as string);
    }
  },

  methods: {
    applyHeroBg(theme: string): void {
      const uri = (SCENE_BG as Record<string, string>).shanghaiHero || '';
      const heroBgStyle = theme === 'deepsea' && uri
        ? 'background-image:linear-gradient(90deg, rgba(8,15,34,.88) 0%, rgba(8,15,34,.52) 44%, rgba(8,15,34,.08) 100%), url(' + uri + ');background-size:cover;background-position:center;'
        : '';
      this.setData({ heroBgStyle });
    },

    computeGreet(): string {
      const h = new Date().getHours();
      if (h < 5) return '夜深了';
      if (h < 11) return '早上好';
      if (h < 14) return '中午好';
      if (h < 18) return '下午好';
      if (h < 22) return '晚上好';
      return '夜深了';
    },
    computeDateText(): string {
      const d = new Date();
      return `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK_CN[d.getDay()]}`;
    }
  }
});
