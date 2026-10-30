// pages/civil/timeline.ts
// 全年考试时间轴：把国考 / 省考 / 事业编 / 央国企 / 通用策略 五条线按月整合到同一张轴
// 参数：month=<1-12>（从首页月份卡点进来时自动滚动定位）
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { go } from '../../../../utils/nav';
import { toast } from '../../../../utils/cloud';
import type { ThemeKey } from '../../../../types/index';
import { CIVIL_TIMELINE, CIVIL_TRACKS, hexA } from '../../utils/civil-data';

interface TlEvent {
  track: string;
  trackName: string;
  trackShort: string;
  icon: string;
  color: string;
  soft: string;
  title: string;
  desc: string;
  major: boolean;
}

interface TlMonth {
  month: number;
  label: string;
  theme: string;
  isNow: boolean;
  isPast: boolean;
  isFocus: boolean;
  count: number;
  majorCount: number;
  events: TlEvent[];
}

interface TimelineData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  months: TlMonth[];
  filters: { key: string; label: string; color: string; soft: string; count: number }[];
  filter: string;
  currentMonth: number;
  focusMonth: number;
  totalEvents: number;
  nextIdx: number;
  next: { month: number; label: string; theme: string; days: number } | null;
}

/** 把某条事件补上赛道视觉信息 */
function decorate(track: string, title: string, desc: string, major: boolean): TlEvent {
  const t = CIVIL_TRACKS.filter((x) => x.key === track)[0];
  return {
    track,
    trackName: t ? t.name : '通用策略',
    trackShort: t ? t.short : '全赛道',
    icon: t ? t.icon : '🎯',
    color: t ? t.color : '#6d28d9',
    soft: t ? hexA(t.color, 0.14) : 'rgba(109,40,217,0.14)',
    title,
    desc,
    major
  };
}

/** 从「今天」到某个未来月份 1 号的粗略天数（用于「距下个节点」提示） */
function daysUntilMonth(month: number, now: number): number {
  const d = new Date(now + 8 * 3600 * 1000);
  const curM = d.getUTCMonth() + 1;
  const curD = d.getUTCDate();
  let diff = month - curM;
  if (diff < 0) diff += 12;
  const daysInCur = new Date(Date.UTC(d.getUTCFullYear(), curM, 0)).getUTCDate();
  return diff * 30 - curD + Math.round(daysInCur / 2);
}

Page<TimelineData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    months: [],
    filters: [],
    filter: 'all',
    currentMonth: 9,
    focusMonth: 0,
    totalEvents: 0,
    nextIdx: 0,
    next: null
  },

  onLoad(q: Record<string, string>) {
    this.applyTheme();
    const focusMonth = Number((q && q.month) || 0) || 0;

    // 赛道筛选项：只保留时间轴上真实出现的赛道
    const present: Record<string, number> = {};
    let totalEvents = 0;
    CIVIL_TIMELINE.forEach((m) => {
      m.events.forEach((e) => {
        present[e.track] = (present[e.track] || 0) + 1;
        totalEvents++;
      });
    });
    const filters = [{ key: 'all', label: '全部', color: '#6d28d9', soft: 'rgba(109,40,217,0.14)', count: totalEvents }].concat(
      CIVIL_TRACKS.filter((t) => present[t.key]).map((t) => ({
        key: t.key,
        label: t.short,
        color: t.color,
        soft: hexA(t.color, 0.14),
        count: present[t.key] || 0
      }))
    );

    this.setData({ focusMonth, filters, totalEvents });
    this.build('all', focusMonth);
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  build(filter: string, focusMonth: number) {
    const now = Date.now();
    const d = new Date(now + 8 * 3600 * 1000);
    const curM = d.getUTCMonth() + 1;

    const months: TlMonth[] = CIVIL_TIMELINE.map((m) => {
      const raw = filter === 'all' ? m.events : m.events.filter((e) => e.track === filter);
      const events = raw.map((e) => decorate(e.track, e.title, e.desc, e.major));
      return {
        month: m.month,
        label: m.label,
        theme: m.theme,
        isNow: m.month === curM,
        isPast: m.month < curM,
        isFocus: m.month === focusMonth,
        count: events.length,
        majorCount: events.filter((e) => e.major).length,
        events
      };
    }).filter((m) => m.count > 0);

    // 下一个关键节点：从当前月往后找到第一条 major 事件
    let nextIdx = -1;
    for (let i = 0; i < months.length; i++) {
      if (months[i].month >= curM && months[i].majorCount > 0) {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx < 0 && months.length) nextIdx = 0;

    const nm = nextIdx >= 0 ? months[nextIdx] : null;
    this.setData({
      months,
      filter,
      currentMonth: curM,
      nextIdx,
      next: nm
        ? { month: nm.month, label: nm.label, theme: nm.theme, days: Math.max(0, daysUntilMonth(nm.month, now)) }
        : null
    });
  },

  onFilter(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === this.data.filter) return;
    this.build(key, this.data.focusMonth);
  },

  onEvent(e: WechatMiniprogram.TouchEvent) {
    const track = e.currentTarget.dataset.track as string;
    if (track === 'strategy') {
      go('/subpackages/tools/pages/civil/compare?tab=faq', { loading: true });
      return;
    }
    go(`/subpackages/tools/pages/civil/track?type=${track}`, { loading: true });
  },

  /** 复制全年时间轴（纯文本），用于做自己的备考日历 */
  onCopy() {
    const L: string[] = ['【体制内全年考试时间轴】', ''];
    this.data.months.forEach((m) => {
      L.push(`—— ${m.label} · ${m.theme} ——`);
      m.events.forEach((e) => {
        L.push(`${e.major ? '★' : '·'} [${e.trackShort}] ${e.title}`);
        L.push(`   ${e.desc}`);
      });
      L.push('');
    });
    L.push('★ = 关键节点');
    wx.setClipboardData({
      data: L.join('\n'),
      success: () => toast('已复制全年时间轴')
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '体制内全年考试时间轴｜3-12 月国考/省考/事业编/央国企一次看全',
      path: '/subpackages/tools/pages/civil/timeline'
    };
  }
});
