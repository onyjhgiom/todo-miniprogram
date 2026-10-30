// pages/civil/track.ts
// 赛道详情页：赛道介绍 + 招录流程 + 备考策略（阶段化） + 笔试科目 + 常见误区 + 岗位库（可筛选）
// type=gk|sk|sy|yg|strategy|all
import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { go } from '../../../../utils/nav';
import { toast } from '../../../../utils/cloud';
import type { ThemeKey } from '../../../../types/index';
import {
  CIVIL_TRACKS, CIVIL_JOBS, filterJobs, trackOf, compileOf, compileTone,
  difficultyLabel, hexA, COMPILE_TYPES
} from '../../utils/civil-data';
import type { CivilJob } from '../../utils/civil-data';

const PAGE_SIZE = 12;
const FRESH_CN: Record<string, string> = { only: '仅限应届', prefer: '应届优先', no: '不限应届' };

interface JobRow {
  id: string;
  title: string;
  unit: string;
  compileShort: string;
  tone: string;
  hasBian: boolean;
  difficulty: number;
  stars: string;
  diffLabel: string;
  ratio: string;
  salary: string;
  freshText: string;
  education: string;
  region: string;
  /** 官方报名入口域名 */
  applyHost: string;
  /** 官方报名入口短名（如「国考专题站」「国网招聘平台」） */
  applyName: string;
  /** 该岗位对应的官方报名入口 URL（列表层直接可复制） */
  applyUrl: string;
  level: string;
  direction: string;
}

interface TrackData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  type: string;
  isAll: boolean;
  isStrategy: boolean;
  hasTrack: boolean;
  track: {
    key: string; icon: string; name: string; short: string; tagline: string;
    desc: string; bian: string; color: string; soft: string; when: string;
  };
  highlights: string[];
  process: string[];
  strategy: { title: string; items: string[] }[];
  subjects: { name: string; weight: string; note: string }[];
  pitfalls: string[];
  strategyOpen: number;

  /* 岗位区 */
  jobs: JobRow[];
  total: number;
  matched: number;
  shown: number;
  keyword: string;
  compileFilter: string;
  freshOnly: boolean;
  bianOnly: boolean;
  tabs: { key: string; label: string; count: number }[];
  entries: { key: string; icon: string; title: string; desc: string }[];
}

function toRow(j: CivilJob): JobRow {
  const c = compileOf(j.compile);
  return {
    id: j.id,
    title: j.title,
    unit: j.unit,
    compileShort: c.short,
    tone: compileTone(j.compile),
    hasBian: c.hasBian,
    difficulty: j.difficulty,
    stars: '★'.repeat(j.difficulty),
    diffLabel: difficultyLabel(j.difficulty),
    ratio: j.ratio,
    salary: j.salary,
    freshText: FRESH_CN[j.fresh] || '不限',
    education: j.education,
    region: j.region,
    level: j.level,
    direction: j.direction,
    applyHost: j.apply ? j.apply.host : '',
    applyName: j.apply ? j.apply.short : '',
    applyUrl: j.apply ? j.apply.url : ''
  };
}

Page<TrackData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    type: 'all',
    isAll: true,
    isStrategy: false,
    hasTrack: false,
    track: { key: '', icon: '', name: '', short: '', tagline: '', desc: '', bian: '', color: '#6d28d9', soft: '', when: '' },
    highlights: [],
    process: [],
    strategy: [],
    subjects: [],
    pitfalls: [],
    strategyOpen: 0,

    jobs: [],
    total: 0,
    matched: 0,
    shown: 0,
    keyword: '',
    compileFilter: 'all',
    freshOnly: false,
    bianOnly: false,
    tabs: [],
    entries: [
      { key: 'timeline', icon: '🗓️', title: '全年考试时间轴', desc: '3-12 月所有节点排布，避免撞车与漏报' },
      { key: 'compare', icon: '⚖️', title: '编制科普对比库', desc: '9 种编制性质 · 三赛道横向对比' },
      { key: 'faq', icon: '🎓', title: '应届生身份科普', desc: '两年择业期 · 社保红线 · 档案去向' },
      { key: 'plan', icon: '🤖', title: 'AI 上岸规划', desc: '按专业学历生成专属报考组合' }
    ]
  },

  onLoad(q: Record<string, string>) {
    const type = (q && q.type) || 'all';
    const compileQ = (q && q.compile) || '';
    const strat = type === 'strategy';
    const all = type === 'all';
    this.applyTheme();

    const tabs = [{ key: 'all', label: '全部', count: CIVIL_JOBS.length }].concat(
      COMPILE_TYPES.map((c) => ({
        key: c.key,
        label: c.short,
        count: CIVIL_JOBS.filter((j) => j.compile === c.key).length
      })).filter((x) => x.count > 0)
    );

    if (!strat && !all) {
      const t = trackOf(type);
      const list = CIVIL_JOBS.filter((j) => j.track === type);
      this.setData({
        type,
        isAll: false,
        isStrategy: false,
        hasTrack: true,
        track: {
          key: t.key, icon: t.icon, name: t.name, short: t.short, tagline: t.tagline,
          desc: t.desc, bian: t.bian, color: t.color, soft: hexA(t.color, 0.14), when: t.when
        },
        highlights: t.highlights,
        process: t.process,
        strategy: t.strategy,
        subjects: t.subjects,
        pitfalls: t.pitfalls,
        tabs,
        compileFilter: compileQ || 'all',
        total: list.length
      });
      // 项目类型定义未含该 API（与 folklore / guaxiang 页保持一致的处理方式）
      (wx as any).setNavigationBarTitle({ title: t.name });
      this.refresh();
      return;
    }

    const t = trackOf('strategy');
    this.setData({
      type,
      isAll: all,
      isStrategy: strat,
      hasTrack: true,
      track: {
        key: t.key, icon: t.icon, name: all ? '全部岗位库' : t.name, short: all ? '全库' : t.short,
        tagline: all ? `四条赛道共 ${CIVIL_JOBS.length} 条岗位，支持按编制与应届筛选` : t.tagline,
        desc: all ? '把四条赛道的岗位放在一起横向比较，先看「有没有编」，再看专业与学历是否可报。' : t.desc,
        bian: all ? '逐条标注编制类型' : t.bian, color: t.color, soft: hexA(t.color, 0.14), when: t.when
      },
      highlights: all ? [] : t.highlights,
      process: all ? [] : t.process,
      strategy: all ? [] : t.strategy,
      subjects: all ? [] : t.subjects,
      pitfalls: all ? [] : t.pitfalls,
      tabs,
      compileFilter: compileQ || 'all',
      total: CIVIL_JOBS.length
    });
    (wx as any).setNavigationBarTitle({ title: all ? '全部岗位库' : t.name });
    this.refresh();
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  /* ---------- 岗位筛选 ---------- */
  refresh() {
    const d = this.data;
    const trackFilter = d.type === 'all' || d.isStrategy ? undefined : d.type;
    let list = filterJobs({
      track: trackFilter,
      keyword: d.keyword,
      freshOnly: d.freshOnly
    });
    if (d.compileFilter !== 'all') list = list.filter((j) => j.compile === d.compileFilter);
    if (d.bianOnly) list = list.filter((j) => compileOf(j.compile).hasBian);

    const matched = list.length;
    const shown = Math.min(PAGE_SIZE, matched);
    this.setData({
      jobs: list.slice(0, shown).map(toRow),
      matched,
      shown
    });
  },

  onSearch(e: WechatMiniprogram.InputEvent) {
    this.setData({ keyword: e.detail.value }, () => this.refresh());
  },
  onClearSearch() {
    if (!this.data.keyword) return;
    this.setData({ keyword: '' }, () => this.refresh());
  },
  onCompileTab(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    this.setData({ compileFilter: key }, () => this.refresh());
  },
  onToggleFresh() {
    this.setData({ freshOnly: !this.data.freshOnly }, () => this.refresh());
  },
  onToggleBian() {
    this.setData({ bianOnly: !this.data.bianOnly }, () => this.refresh());
  },
  onReset() {
    this.setData({ keyword: '', compileFilter: 'all', freshOnly: false, bianOnly: false }, () => this.refresh());
  },
  loadMore() {
    const d = this.data;
    const trackFilter = d.type === 'all' || d.isStrategy ? undefined : d.type;
    let list = filterJobs({ track: trackFilter, keyword: d.keyword, freshOnly: d.freshOnly });
    if (d.compileFilter !== 'all') list = list.filter((j) => j.compile === d.compileFilter);
    if (d.bianOnly) list = list.filter((j) => compileOf(j.compile).hasBian);
    const next = Math.min(d.shown + PAGE_SIZE, list.length);
    this.setData({ jobs: list.slice(0, next).map(toRow), shown: next });
  },

  onToggleStrategy(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ strategyOpen: this.data.strategyOpen === i ? -1 : i });
  },

  onJob(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    go(`/subpackages/tools/pages/civil/job?id=${id}`, { loading: true });
  },

  /**
   * 列表层一键复制该岗位对应的官方报名入口。
   * 模板里用 catchtap，避免连带触发卡片的 bindtap 跳详情页。
   */
  onCopyApply(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string;
    if (!url) {
      toast('该岗位暂无报名入口', 'none');
      return;
    }
    wx.setClipboardData({ data: url, success: () => toast('已复制报名入口，粘贴到浏览器打开') });
  },

  onEntry(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (key === 'timeline') go('/subpackages/tools/pages/civil/timeline', { loading: true });
    else if (key === 'compare') go('/subpackages/tools/pages/civil/compare', { loading: true });
    else if (key === 'faq') go('/subpackages/tools/pages/civil/compare?tab=faq', { loading: true });
    else if (key === 'plan') go('/subpackages/tools/pages/civil/plan', { loading: true });
  },

  /** 复制整条赛道的备考方案（流程 + 策略 + 科目 + 避坑） */
  onCopyStrategy() {
    const d = this.data;
    const L: string[] = [];
    L.push(`【${d.track.name}】${d.track.tagline}`);
    L.push(`编制：${d.track.bian}`);
    L.push(`时间：${d.track.when}`);
    L.push('');
    if (d.highlights.length) {
      L.push('【核心亮点】');
      d.highlights.forEach((h) => L.push(`· ${h}`));
      L.push('');
    }
    if (d.process.length) {
      L.push('【招录流程】');
      d.process.forEach((p, i) => L.push(`${i + 1}. ${p}`));
      L.push('');
    }
    if (d.strategy.length) {
      L.push('【备考策略】');
      d.strategy.forEach((s) => {
        L.push(`▸ ${s.title}`);
        s.items.forEach((x) => L.push(`  · ${x}`));
      });
      L.push('');
    }
    if (d.subjects.length) {
      L.push('【笔试科目】');
      d.subjects.forEach((s) => L.push(`· ${s.name}（${s.weight}）：${s.note}`));
      L.push('');
    }
    if (d.pitfalls.length) {
      L.push('【常见误区】');
      d.pitfalls.forEach((p) => L.push(`· ${p}`));
    }
    wx.setClipboardData({
      data: L.join('\n'),
      success: () => toast('已复制完整备考方案')
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const t = this.data.track;
    return {
      title: `${t.name} · ${t.tagline}`,
      path: `/subpackages/tools/pages/civil/track?type=${this.data.type}`
    };
  }
});
