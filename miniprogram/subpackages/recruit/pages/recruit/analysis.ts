// subpackages/recruit/pages/recruit/analysis.ts
// 秋招数据看板：转化漏斗 / 投递节奏 / 内推对比 / 渠道来源 / Offer 对比 / 面试准备度 / 行动建议
import { getCareerState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import {
  loadApps, funnelStats, weeklyTrend, referralCompare, platformStats,
  readiness, offerList, suggestions
} from '../../utils/recruit-store';
import type {
  FunnelRow, TrendBucket, ReferralStat, PlatformStat, OfferCard
} from '../../utils/recruit-store';
import type { ThemeKey } from '../../../../types/index';
import { go, replace } from '../../../../utils/nav';
import { diagnoseBoard } from '../../utils/recruit-intel';
import type { BoardDiag } from '../../utils/recruit-intel';

/** 准备度表格行 */
interface ReadinessRow {
  _id: string;
  company: string;
  position: string;
  score: number;
  level: string;
  levelKey: 'good' | 'ok' | 'warn' | 'bad';
  tip: string;
}

function levelKeyOf(score: number): ReadinessRow['levelKey'] {
  if (score >= 85) return 'good';
  if (score >= 60) return 'ok';
  if (score >= 35) return 'warn';
  return 'bad';
}

interface AnalysisData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  hasData: boolean;
  total: number;
  active: number;
  closed: number;
  interviewRate: number;
  offerRate: number;
  // 漏斗
  funnel: (FunnelRow & { isTop: boolean })[];
  // 节奏
  trend: TrendBucket[];
  trendMax: number;
  trendTotal: number;
  // 内推 / 渠道
  referral: ReferralStat[];
  platform: PlatformStat[];
  // Offer
  offers: OfferCard[];
  // 准备度
  readinessRows: ReadinessRow[];
  avgReadiness: number;
  avgLevelKey: ReadinessRow['levelKey'];
  avgLevel: string;
  readinessHidden: number;
  // 建议
  tips: string[];
  /** 看板诊断：把数字变成「卡在哪一环 + 该干嘛」的结论与优先动作 */
  board: BoardDiag | null;
}

Page<AnalysisData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    hasData: false,
    total: 0,
    active: 0,
    closed: 0,
    interviewRate: 0,
    offerRate: 0,
    funnel: [],
    trend: [],
    trendMax: 0,
    trendTotal: 0,
    referral: [],
    platform: [],
    offers: [],
    readinessRows: [],
    avgReadiness: 0,
    avgLevelKey: 'bad',
    avgLevel: '',
    readinessHidden: 0,
    tips: [],
    board: null
  },

  onLoad() {
    this.applyTheme();
    this.refresh();
  },
  onShow() {
    this.applyTheme();
    // 从投递详情改完状态回来，看板要跟着变
    this.refresh();
  },
  applyTheme() {
    const s = getCareerState(); // 秋招助手固定「求职工作台」深蓝视觉，不随全局主题漂移
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  refresh() {
    const apps = loadApps();
    const f = funnelStats(apps);
    const trend = weeklyTrend(6, apps);
    const rows: ReadinessRow[] = apps
      .filter((a) => a.status !== 'givenup')
      .map((a) => {
        const r = readiness(a);
        return {
          _id: a._id,
          company: a.company || '未命名公司',
          position: a.position || '',
          score: r.score,
          level: r.level,
          levelKey: levelKeyOf(r.score),
          tip: r.tips[0] || '准备充分，保持手感'
        };
      })
      .sort((x, y) => x.score - y.score);

    const avg = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length)
      : 0;
    const LEVEL_TEXT: Record<ReadinessRow['levelKey'], string> = {
      good: '准备充分', ok: '基本就绪', warn: '还需补强', bad: '准备不足'
    };

    this.setData({
      hasData: apps.length > 0,
      total: f.total,
      active: f.active,
      closed: f.closed,
      interviewRate: f.interviewRate,
      offerRate: f.offerRate,
      funnel: f.rows.map((r, i) => ({ ...r, isTop: i === 0 })),
      trend: trend.buckets,
      trendMax: trend.max,
      trendTotal: trend.total,
      referral: referralCompare(apps),
      platform: platformStats(apps),
      offers: offerList(apps),
      readinessRows: rows.slice(0, 6),
      readinessHidden: Math.max(0, rows.length - 6),
      avgReadiness: avg,
      avgLevelKey: levelKeyOf(avg),
      avgLevel: rows.length > 0 ? LEVEL_TEXT[levelKeyOf(avg)] : '暂无数据',
      tips: suggestions(apps),
      board: diagnoseBoard(apps)
    });
  },

  /** 点准备度行 → 进对应投递详情补准备 */
  onOpenApp(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    go(`/subpackages/recruit/pages/recruit/detail?id=${id}`);
  },
  onOpenOffer(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    go(`/subpackages/recruit/pages/recruit/detail?id=${id}`);
  },

  /** 点看板诊断的优先动作 → 按 action.go 跳转到对应投递详情或固定页面 */
  onBoardActionTap(e: WechatMiniprogram.TouchEvent) {
    const kind = e.currentTarget.dataset.kind as string;
    const target = e.currentTarget.dataset.target as string;
    if (!target) return;
    if (kind === 'app') go(`/subpackages/recruit/pages/recruit/detail?id=${target}`);
    else go(target);
  },

  /** 回投递列表：栈里已有上一页就返回，直接从分享链接进来才替换当前页 */
  jumpList() {
    let depth = 0;
    try {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      depth = Array.isArray(pages) ? pages.length : 0;
    } catch (e) { depth = 0; }
    if (depth > 1) {
      wx.navigateBack({ fail: () => replace('/subpackages/recruit/pages/recruit/recruit') });
      return;
    }
    replace('/subpackages/recruit/pages/recruit/recruit');
  },
  jumpResource() { go('/subpackages/recruit/pages/recruit/resource'); },

  onCopySummary() {
    const d = this.data;
    const lines: string[] = [
      `📊 我的秋招进度（${new Date().getMonth() + 1}月${new Date().getDate()}日）`,
      `总投递 ${d.total} 家 · 进行中 ${d.active} · 已闭环 ${d.closed}`,
      `进面率 ${d.interviewRate}% · Offer 率 ${d.offerRate}%`,
      `近 6 周投递 ${d.trendTotal} 家`,
      `平均面试准备度 ${d.avgReadiness}%（${d.avgLevel}）`
    ];
    if (d.offers.length > 0) {
      lines.push(`已拿 Offer：${d.offers.map((o) => o.company).join('、')}`);
    }
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => toast('已复制，可发给同学 / 舍友互相对照进度'),
      fail: () => toast('复制失败')
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '秋招数据看板 · 投递漏斗与准备度', path: '/subpackages/recruit/pages/recruit/analysis' };
  }
});
