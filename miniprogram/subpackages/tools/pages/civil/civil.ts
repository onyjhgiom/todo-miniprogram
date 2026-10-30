// pages/civil/civil.ts
// 仕途衡鉴 · 体制内上岸通 —— 首页
// 结构：醒目欢迎横幅 + 四大赛道入口 + 编制速查 + 近期节点 + 精选岗位 + 工具入口
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { go } from '../../../../utils/nav';
import { toast } from '../../../../utils/cloud';
import type { ThemeKey } from '../../../../types/index';
import {
  CIVIL_META, CIVIL_TRACKS, JOB_TRACKS, CIVIL_JOBS, CIVIL_TIMELINE,
  COMPILE_TYPES, filterJobs, hexA, compileTone, compileOf
} from '../../utils/civil-data';

interface TrackCard {
  key: string;
  icon: string;
  name: string;
  short: string;
  tagline: string;
  bian: string;
  count: number;
  color: string;
  soft: string;
  isStrategy: boolean;
}

interface CompileChip {
  key: string;
  short: string;
  full: string;
  hasBian: boolean;
  tone: string;
  count: number;
  color: string;
  soft: string;
}

interface MonthPeek {
  month: number;
  label: string;
  theme: string;
  isNow: boolean;
  events: { track: string; title: string; desc: string; major: boolean; color: string; short: string }[];
}

interface HotJob {
  id: string;
  title: string;
  unit: string;
  trackShort: string;
  compileShort: string;
  tone: string;
  hasBian: boolean;
  difficulty: number;
  stars: string;
  salary: string;
  freshText: string;
  color: string;
  /** 官方报名入口域名（列表层就能看到去哪报名） */
  applyHost: string;
  /** 官方报名入口短名（如「国考专题站」「国网招聘平台」） */
  applyName: string;
  /** 该岗位对应的官方报名入口 URL（列表层直接可复制） */
  applyUrl: string;
}

interface CivilHomeData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  meta: typeof CIVIL_META;
  tracks: TrackCard[];
  compiles: CompileChip[];
  months: MonthPeek[];
  currentMonth: number;
  hotJobs: HotJob[];
  stats: { jobs: number; bian: number; compile: number; fresh: number };
  entries: { key: string; icon: string; title: string; desc: string }[];
  total: number;
}

const FRESH_CN: Record<string, string> = { only: '仅限应届', prefer: '应届优先', no: '不限' };

/** 编制速查：只保留库里真实存在的编制类型 */
function compileChips(): CompileChip[] {
  return COMPILE_TYPES.map((c) => ({
    key: c.key,
    short: c.short,
    full: c.label,
    hasBian: c.hasBian,
    tone: compileTone(c.key),
    count: CIVIL_JOBS.filter((j) => j.compile === c.key).length,
    color: c.color,
    soft: hexA(c.color, 0.14)
  }));
}

/** 未来 3 个月的关键节点（按当前月滚动） */
function monthPeeks(now: number): MonthPeek[] {
  const d = new Date(now + 8 * 3600 * 1000);
  const cur = d.getUTCMonth() + 1;
  const pick: MonthPeek[] = [];
  for (let i = 0; i < 3; i++) {
    let m = cur + i;
    if (m > 12) m -= 12;
    const found = CIVIL_TIMELINE.filter((x) => x.month === m)[0];
    if (!found) continue;
    pick.push({
      month: m,
      label: found.label,
      theme: found.theme,
      isNow: i === 0,
      events: found.events.map((e) => {
        const t = CIVIL_TRACKS.filter((x) => x.key === e.track)[0];
        return {
          track: e.track,
          title: e.title,
          desc: e.desc,
          major: e.major,
          color: t ? t.color : '#6d28d9',
          short: t ? t.short : '策略'
        };
      })
    });
  }
  return pick;
}

/** 精选岗位：每个赛道取难度最高的 1-2 条，做赛道多样性轮转 */
function pickHotJobs(): HotJob[] {
  const byTrack: Record<string, typeof CIVIL_JOBS> = {};
  CIVIL_JOBS.forEach((j) => {
    if (!byTrack[j.track]) byTrack[j.track] = [];
    byTrack[j.track].push(j);
  });
  Object.keys(byTrack).forEach((k) => byTrack[k].sort((a, b) => b.difficulty - a.difficulty));
  const order = ['gk', 'yg', 'sy', 'sk'];
  const out: HotJob[] = [];
  for (let round = 0; round < 2; round++) {
    order.forEach((k) => {
      const list = byTrack[k] || [];
      const j = list[round];
      if (!j || out.length >= 8) return;
      const t = CIVIL_TRACKS.filter((x) => x.key === j.track)[0];
      const c = compileOf(j.compile);
      out.push({
        id: j.id,
        title: j.title,
        unit: j.unit,
        trackShort: t ? t.short : '',
        compileShort: c.short,
        tone: compileTone(j.compile),
        hasBian: c.hasBian,
        difficulty: j.difficulty,
        stars: '★'.repeat(j.difficulty),
        salary: j.salary,
        freshText: FRESH_CN[j.fresh] || '不限',
        color: t ? t.color : '#6d28d9',
        applyHost: j.apply ? j.apply.host : '',
        applyName: j.apply ? j.apply.short : '',
        applyUrl: j.apply ? j.apply.url : ''
      });
    });
  }
  return out;
}

Page<CivilHomeData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    meta: CIVIL_META,
    tracks: [],
    compiles: [],
    months: [],
    currentMonth: 9,
    hotJobs: [],
    stats: { jobs: 0, bian: 0, compile: 0, fresh: 0 },
    entries: [
      { key: 'compare', icon: '⚖️', title: '编制科普对比库', desc: '9 种编制性质一次讲透 · 三赛道横向对比' },
      { key: 'timeline', icon: '🗓️', title: '全年考试时间轴', desc: '3-12 月国考/省考/事业编/国企排布' },
      { key: 'plan', icon: '🤖', title: 'AI 上岸规划', desc: '赛道测评 · 备考计划 · 面试模拟' },
      { key: 'decision', icon: '🧠', title: '仕途衡鉴 · 决策台', desc: '智能分层组合 · 均衡资源调配' },
      { key: 'faq', icon: '🎓', title: '应届生身份科普', desc: '两年择业期 · 社保影响 · 档案去向避坑' }
    ],
    total: 0
  },

  onLoad() {
    this.applyTheme();
    this.build();
  },
  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  build() {
    const now = Date.now();
    const d = new Date(now + 8 * 3600 * 1000);

    const tracks: TrackCard[] = CIVIL_TRACKS.map((t) => {
      const count = t.key === 'strategy' ? CIVIL_JOBS.length : CIVIL_JOBS.filter((j) => j.track === t.key).length;
      return {
        key: t.key,
        icon: t.icon,
        name: t.name,
        short: t.short,
        tagline: t.tagline,
        bian: t.bian,
        count,
        color: t.color,
        soft: hexA(t.color, 0.14),
        isStrategy: t.key === 'strategy'
      };
    });

    this.setData({
      tracks,
      compiles: compileChips(),
      months: monthPeeks(now),
      currentMonth: d.getUTCMonth() + 1,
      hotJobs: pickHotJobs(),
      total: CIVIL_JOBS.length,
      stats: {
        jobs: CIVIL_JOBS.length,
        bian: filterJobs({ bianOnly: true }).length,
        compile: COMPILE_TYPES.length,
        fresh: filterJobs({ freshOnly: true }).length
      }
    });
  },

  /* ---------- 交互 ---------- */
  onTrack(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    go(`/subpackages/tools/pages/civil/track?type=${key}`, { loading: '正在打开' });
  },
  onCompile(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    go(`/subpackages/tools/pages/civil/compare?tab=compile&focus=${key}`, { loading: true });
  },
  onEntry(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === 'compare') go('/subpackages/tools/pages/civil/compare', { loading: true });
    else if (key === 'timeline') go('/subpackages/tools/pages/civil/timeline', { loading: true });
    else if (key === 'plan') go('/subpackages/tools/pages/civil/plan', { loading: true });
    else if (key === 'decision') go('/subpackages/tools/pages/civil/decision', { loading: true });
    else if (key === 'faq') go('/subpackages/tools/pages/civil/compare?tab=faq', { loading: true });
  },
  onMonth(e: WechatMiniprogram.TouchEvent) {
    const m = Number(e.currentTarget.dataset.month) || 0;
    go(`/subpackages/tools/pages/civil/timeline?month=${m}`, { loading: true });
  },
  onJob(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    go(`/subpackages/tools/pages/civil/job?id=${id}`, { loading: true });
  },
  onAllJobs() {
    go('/subpackages/tools/pages/civil/track?type=all', { loading: true });
  },

  /**
   * 列表层一键复制该岗位对应的官方报名入口。
   * 用 catchtap 接（模板里写 catchtap），否则会连带触发卡片的 bindtap 跳详情页。
   * 小程序内不能直跳外部政务站，与详情页/recruit 模块一致：复制链接 → 粘贴到浏览器。
   */
  onCopyApply(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string;
    if (!url) {
      toast('该岗位暂无报名入口', 'none');
      return;
    }
    wx.setClipboardData({ data: url, success: () => toast('已复制报名入口，粘贴到浏览器打开') });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '仕途衡鉴 · 体制内上岸通｜考公·考编·央国企全覆盖',
      path: '/subpackages/tools/pages/civil/civil'
    };
  }
});
