// pages/recruit/openings.ts
// 岗位开放：按「公司 × 招聘类型 × 岗位类别」三维度查看开放 / 截止日期。
// 数据为人工维护的参考信息，页面顶部固定展示免责声明与数据更新时间。
//
// 浏览体验：
//   · 三级筛选（状态 / 行业 / 企业性质 / 招聘类型）+ 关键词搜索
//   · 分组折叠（按行业 / 性质 / 招聘类型 / 状态 / 不分组），默认每组只渲染前 N 条
//   · 组内「加载更多」分段渲染，避免 200+ 条一次性 setData 造成卡顿
//   · 滚动超过一屏显示「回到顶部」
import { getCareerState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import {
  loadOpenings, searchOpenings, statusOf, dueText, daysLeft, groupOpenings,
  RECRUIT_TYPES, COMPANY_TYPES, OWNERSHIPS, STATUS_LABEL, OPENINGS_DATA_VERSION,
  GROUP_BY_LABEL
} from '../../utils/recruit-openings';
import type { JobOpening, OpeningStatus, GroupBy, OpeningGroup, Ownership } from '../../utils/recruit-openings';
import { buildPrepGuide } from '../../utils/recruit-prep';
import type { PrepGuide } from '../../utils/recruit-prep';
import { loadFollowedOpenings, toggleFollowOpening, loadApps } from '../../utils/recruit-store';
import { go } from '../../../../utils/nav';
import type { ThemeKey } from '../../../../types/index';
import { recommendOpenings, openingFitScorer } from '../../utils/recruit-intel';
import type { OpeningRec } from '../../utils/recruit-intel';

/** 企业性质 → 英文类名后缀（WXSS 选择器不支持中文，必须映射） */
const OWN_KEY: Record<Ownership, string> = {
  外资: 'foreign',
  国资: 'state',
  民营: 'private',
  合资: 'jv'
};
function ownKeyOf(o: Ownership): string { return OWN_KEY[o] || 'other'; }

/* ==================== 纵向智能时间线 ==================== */
// 不再是横向甘特图：按「行动日期」聚成节点（新→旧），每个节点下挂岗位卡，
// 卡上直接给「匹配度 + 下一步该做什么」。日期待公布的岗位收进底部折叠区，
// 不让 200+ 条无日期数据把有日期的节奏淹没。

const TODAY_TS = Date.now();

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function fmtDateLocal(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** 节点上用的短日期：M.D，如 9.12 */
function fmtShortDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}
function parseDateLocal(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return isNaN(t) ? null : t;
}
function parseDmy(s: string): number | null {
  const m = /^(\d{4})[年\/\.-](\d{1,2})[月\/\.-](\d{1,2})/.exec(String(s || '').trim());
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return isNaN(t) ? null : t;
}

/** 明年（2027）才开始的岗位在节点文案里标注，避免和今年节奏混淆 */
const NEXT_YEAR_YEAR = 2027;

/** 时间线上展示的岗位卡 */
export interface TlCard {
  _id: string;
  company: string;
  /** 岗位类别，如 财务/会计 */
  position: string;
  recruitType: string;
  status: OpeningStatus;
  statusLabel: string;
  /** 卡上展示的起止短文本，如 "9.1 → 10.31" / "9.1 开始" / "日期待公布" */
  dateText: string;
  /** 截止侧文本（dueText），如 "剩 3 天" / "招满即止" */
  dueText: string;
  /** AI 匹配度（简历/意向就绪才有值；null 时 UI 不显示，宁缺毋假） */
  fit: number | null;
  /** 下一步行动提示（卡片底部那句「现在该做什么」） */
  next: string;
  /** 紧急：即将截止 ≤7 天且还没投过 → 卡片橙色呼吸提示 */
  urgent: boolean;
  fav: boolean;
  /** 明年才开始的岗位 */
  isNextYear: boolean;
  /** 弹层详情文本 */
  detail: string;
}

/** 一个日期节点：同一天要行动的岗位归在一组 */
export interface TlNode {
  /** YYYY-MM-DD，作 wx:key */
  key: string;
  /** 节点短日期，如 9.12 */
  label: string;
  /** 相对今天：今天 / 明天 / 3 天后 / 5 天前 */
  rel: string;
  /** 节点主状态（决定圆点颜色；有即将截止就用橙） */
  status: OpeningStatus;
  items: TlCard[];
}

export interface TimelineVO {
  /** 有日期节点（新 → 旧） */
  nodes: TlNode[];
  /** 无日期待公布（折叠在底部） */
  tba: TlCard[];
  datedCount: number;
  undatedCount: number;
}

/** 节点圆点状态优先级：即将截止 > 进行中 > 未开始 > 已截止 */
function dominantStatus(items: TlCard[]): OpeningStatus {
  const order: OpeningStatus[] = ['closing', 'open', 'upcoming', 'closed'];
  for (const s of order) {
    if (items.some((c) => c.status === s)) return s;
  }
  return items.length ? items[0].status : 'tba';
}

/** 相对今天的自然语言：今天 / 明天 / N 天后 / N 天前 */
function relDay(ts: number): string {
  const day = 86400000;
  const a = new Date(ts); a.setHours(0, 0, 0, 0);
  const b = new Date(TODAY_TS); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a.getTime() - b.getTime()) / day);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  return diff > 0 ? `${diff} 天后` : `${-diff} 天前`;
}

/** 按状态给「下一步」提示 —— 时间线从「数据展示」升级为「行动决策」的关键 */
function nextStepOf(o: JobOpening, st: OpeningStatus, applied: boolean): string {
  const dl = daysLeft(o);
  if (applied) {
    if (st === 'closing' && dl !== null && dl >= 0) return `已投递 · ${dl} 天后截止，重点转向笔试/面试准备`;
    return '已投递，等待反馈即可';
  }
  switch (st) {
    case 'closing':
      if (dl !== null && dl >= 0 && dl <= 3) return `仅剩 ${dl} 天截止，建议立即投递`;
      return `${dueText(o)}，尽快完成网申`;
    case 'open':
      return o.rolling ? '招满即止，建议尽早投递' : '开放报名中，可以投递';
    case 'upcoming':
      return '尚未开始，先按备战清单准备简历与笔试';
    case 'closed':
      return '本批次已截止，留意春招 / 下一批次';
    default:
      return '日期待公布，先按往年节奏准备';
  }
}

/** 把筛选后的岗位列表构建成纵向时间线数据 */
export function buildTimeline(list: JobOpening[]): TimelineVO {
  const scorer = openingFitScorer();
  const appliedSet = new Set(
    loadApps().map((a) => (a.company || '').trim()).filter(Boolean)
  );

  interface Dated extends TlCard { ts: number; }
  const dated: Dated[] = [];
  const tba: TlCard[] = [];
  let datedCount = 0;
  let undatedCount = 0;

  for (const o of list) {
    const st = statusOf(o);
    const s = parseDateLocal(o.openDate) || parseDmy(o.openDate);
    const e = parseDateLocal(o.deadline) || parseDmy(o.deadline);
    const applied = appliedSet.has((o.company || '').trim());
    const fit = scorer(o);
    const dl = daysLeft(o);

    let dateText = '';
    if (s && e) dateText = `${fmtShortDate(s)} → ${fmtShortDate(e)}`;
    else if (s) dateText = `${fmtShortDate(s)} 开始`;
    else if (e) dateText = `${fmtShortDate(e)} 截止`;
    else dateText = '日期待公布';

    const isNextYear = (s || e) !== null && new Date((s || e)!).getFullYear() >= NEXT_YEAR_YEAR;
    if (isNextYear) dateText += '（明年）';

    const startText = s ? fmtDateLocal(s) : '待公布';
    const endText = o.rolling && !e ? '招满即止' : e ? fmtDateLocal(e) : '待公布';
    const detail =
      `公司：${o.company}\n` +
      `岗位：${o.jobCategory}\n` +
      `招聘类型：${o.recruitType}\n` +
      `开始：${startText}\n` +
      `截止：${endText}\n` +
      `状态：${STATUS_LABEL[st]}\n` +
      `来源：${o.source}\n` +
      `更新：${o.updatedAt}` +
      (o.lastYearRef ? `\n往年参考：${o.lastYearRef}` : '') +
      (o.note ? `\n\n备注：${o.note}` : '');

    const card: TlCard = {
      _id: o._id,
      company: o.company,
      position: o.jobCategory,
      recruitType: o.recruitType,
      status: st,
      statusLabel: STATUS_LABEL[st],
      dateText,
      dueText: dueText(o),
      fit: fit.ready ? fit.score : null,
      next: nextStepOf(o, st, applied),
      urgent: st === 'closing' && !applied && dl !== null && dl >= 0 && dl <= 7,
      fav: favIdSet.has(o._id),
      isNextYear,
      detail
    };

    if (!s && !e) {
      undatedCount++;
      tba.push(card);
      continue;
    }
    datedCount++;
    // 节点锚定「行动日期」：有截止日用截止日（那是最后行动时点），否则用开放日
    dated.push({ ...card, ts: (e || s)! });
  }

  // 节点按日期新 → 旧；「即将截止优先」只在节点内部排序，不破坏节点时间序
  dated.sort((a, b) => b.ts - a.ts);
  const nodeMap = new Map<string, TlNode>();
  for (const c of dated) {
    const key = fmtDateLocal(c.ts);
    let nd = nodeMap.get(key);
    if (!nd) {
      nd = { key, label: fmtShortDate(c.ts), rel: relDay(c.ts), status: 'open', items: [] };
      nodeMap.set(key, nd);
    }
    const { ts, ...card } = c;
    void ts;
    nd.items.push(card);
  }
  const nodes = [...nodeMap.values()];
  nodes.forEach((nd) => {
    nd.status = dominantStatus(nd.items);
    nd.items.sort((a, b) => {
      if (a.status === 'closing' && b.status !== 'closing') return -1;
      if (b.status === 'closing' && a.status !== 'closing') return 1;
      return 0;
    });
  });

  // 待公布区：直接读关注清单（不依赖列表视图的 favIdSet 缓存），关注过的排前面
  const favSet = new Set(loadFollowedOpenings());
  for (const c of tba) c.fav = favSet.has(c._id);
  tba.sort((a, b) => (a.fav === b.fav ? 0 : a.fav ? -1 : 1));

  return { nodes, tba, datedCount, undatedCount };
}

/** 搜索输入防抖：避免每次击键都对 272 条全量 decorate + 分组重算 */
let kwTimer: ReturnType<typeof setTimeout> | null = null;

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '进行中' },
  { key: 'closing', label: '即将截止' },
  { key: 'upcoming', label: '未开始' },
  { key: 'tba', label: '待公布' },
  { key: 'closed', label: '已截止' }
];

const GROUP_TABS: { key: GroupBy; label: string }[] = [
  { key: 'none', label: GROUP_BY_LABEL.none },
  { key: 'companyType', label: GROUP_BY_LABEL.companyType },
  { key: 'ownership', label: GROUP_BY_LABEL.ownership },
  { key: 'recruitType', label: GROUP_BY_LABEL.recruitType },
  { key: 'status', label: GROUP_BY_LABEL.status }
];

/** 筛选结果缓存：onShow 频繁触发，筛选条件没变就直接复用，省掉 272 条 isFinanceJob 正则 + 排序 */
interface FilterSig { kw: string; companyType: string; ownership: string; recruitType: string; status: string; }
let _sig = '';
let _list: JobOpening[] = [];
function cachedSearch(f: FilterSig): JobOpening[] {
  const sig = `${f.kw}|${f.companyType}|${f.ownership}|${f.recruitType}|${f.status}`;
  if (sig === _sig) return _list;
  _list = searchOpenings(f);
  _sig = sig;
  return _list;
}

/** 分组状态下每组首屏渲染条数 */
const GROUP_FIRST = 8;
/** 不分组状态首屏渲染条数 */
const FLAT_FIRST = 20;
/** 每次「加载更多」增量 */
const STEP = 20;

interface DecoOpening extends JobOpening {
  status: OpeningStatus;
  statusLabel: string;
  dueText: string;
  /** 是否招满即止且无明确截止日（需要额外提示） */
  rollingHint: boolean;
  /** 企业性质英文类名后缀（op__own--xxx），映射自 ownership */
  ownershipKey: string;
  /** 是否已关注（星标） */
  fav: boolean;
  expand: boolean;
  /** 备战指南：仅在展开时惰性生成，避免 272 条全量计算 */
  prep?: PrepGuide;
  /** 是否展开完整备战清单（默认只展示节奏与行动项） */
  prepOpen: boolean;
}

/**
 * 已关注岗位 id 集合。
 * 用模块级缓存而不是给 decorate 加参数 —— decorate 在 refresh / 折叠 / 加载更多 /
 * 展开备战清单等 5 处被调用，逐个传参会很容易漏掉一处导致星标状态不一致。
 */
let favIdSet = new Set<string>();
function refreshFavSet(): void {
  favIdSet = new Set(loadFollowedOpenings());
}

/** 备战指南缓存：同一条岗位反复折叠/展开、或在列表与时间线间切换时不必重算 */
const prepCache = new Map<string, PrepGuide>();
function prepFor(o: JobOpening): PrepGuide {
  const hit = prepCache.get(o._id);
  if (hit) return hit;
  const g = buildPrepGuide(o);
  prepCache.set(o._id, g);
  return g;
}

interface GroupVO {
  key: string;
  label: string;
  count: number;
  items: DecoOpening[];
  expand: boolean;
  /** 当前已渲染条数 */
  shown: number;
  hasMore: boolean;
}

interface OpeningsData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  dataVersion: string;
  keyword: string;
  companyType: string;
  ownership: string;
  recruitType: string;
  status: string;
  groupBy: GroupBy;
  companyTypeTabs: string[];
  ownershipTabs: string[];
  recruitTypeTabs: string[];
  statusTabs: { key: string; label: string }[];
  groupTabs: { key: string; label: string }[];
  groups: GroupVO[];
  total: number;
  counts: { open: number; closing: number; upcoming: number; tba: number; closed: number };
  showSource: boolean;
  curSource: string;
  showTop: boolean;
  /** 视图模式：list=列表 / timeline=纵向时间线 */
  view: 'list' | 'timeline';
  /** 只显示已关注的岗位 */
  followedOnly: boolean;
  /** 已关注的岗位数 */
  favCount: number;
  /** 时间线数据 */
  tl: TimelineVO;
  /** 待公布折叠区是否展开（默认收起，200+ 条不该淹没有日期的节奏） */
  tbaOpen: boolean;
  /** 时间线中点击某条后的详情弹层 */
  tlBar: TlCard | null;
  /** 时间线弹层内的备战指南 */
  tlPrep: PrepGuide | null;
  /** 时间线弹层内是否展开完整清单 */
  tlPrepOpen: boolean;
  /** 为我推荐：把简历/意向与岗位库对上，按相关度排序（升级前只能手动翻 272 条） */
  recos: OpeningRec[];
  /** 首屏骨架：首次进入时先占位，避免筛选 + 分组计算期间白屏 */
  loading: boolean;
}

function decorate(o: JobOpening): DecoOpening {
  const st = statusOf(o);
  return {
    ...o,
    status: st,
    statusLabel: STATUS_LABEL[st],
    dueText: dueText(o),
    // 只要标记了滚动招聘就提示：无论是否给了最迟收口日，都可能提前关岗
    rollingHint: o.rolling,
    ownershipKey: ownKeyOf(o.ownership),
    fav: favIdSet.has(o._id),
    expand: false,
    prepOpen: false
  };
}

Page<OpeningsData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    dataVersion: OPENINGS_DATA_VERSION,
    keyword: '',
    companyType: 'all',
    ownership: 'all',
    recruitType: 'all',
    status: 'all',
    groupBy: 'none',
    companyTypeTabs: COMPANY_TYPES,
    ownershipTabs: OWNERSHIPS,
    recruitTypeTabs: RECRUIT_TYPES,
    statusTabs: STATUS_TABS,
    groupTabs: GROUP_TABS,
    groups: [],
    total: 0,
    counts: { open: 0, closing: 0, upcoming: 0, tba: 0, closed: 0 },
    showSource: false,
    curSource: '',
    showTop: false,
    view: 'list',
    followedOnly: false,
    favCount: 0,
    tl: { nodes: [], tba: [], datedCount: 0, undatedCount: 0 },
    tbaOpen: false,
    tlBar: null,
    tlPrep: null,
    tlPrepOpen: false,
    recos: [],
    /** 首屏骨架：岗位库首次加载要跑筛选 + 分组 + 排序，先占位再换真实内容 */
    loading: true
  },

  /** 当前筛选下的全量结果（未切片），供分组与加载更多复用 */
  rawGroups: [] as OpeningGroup[],

  onLoad(options?: Record<string, string>) {
    this.applyTheme();
    const wantTimeline = options && options.view === 'timeline';
    if (wantTimeline) {
      this.setData({ view: 'timeline' });
    }
    // 从秋招首页「我关注的岗位」进来：直接只看关注
    if (options && options.followed === '1') {
      this.setData({ followedOnly: true });
    }
    this.refresh();
    // 骨架先渲染一帧再换成真实列表：既挡住白屏，又不至于让人觉得慢
    setTimeout(() => this.setData({ loading: false }), 80);
  },
  onShow() {
    this.applyTheme();
    this.refresh();
  },
  applyTheme() {
    const s = getCareerState(); // 秋招助手固定「求职工作台」深蓝视觉，不随全局主题漂移
    this.setData({ theme: s.theme, themeStyle: s.themeStyle, heroGradient: s.heroGradient });
    syncNavBar(s);
  },

  refresh() {
    refreshFavSet();
    let list = cachedSearch({
      kw: this.data.keyword,
      companyType: this.data.companyType,
      ownership: this.data.ownership,
      recruitType: this.data.recruitType,
      status: this.data.status
    });
    // 「只看关注」在筛选之后叠加：关注是用户的私人视图，不该影响其它筛选的记忆值
    if (this.data.followedOnly) list = list.filter((o) => favIdSet.has(o._id));

    this.rawGroups = groupOpenings(list, this.data.groupBy);
    const flat = this.data.groupBy === 'none';

    const groups: GroupVO[] = this.rawGroups.map((g, i) => {
      // 不分组时整组展开；分组时只展开第一组，其余折叠
      const expand = flat || i === 0;
      const shown = expand ? Math.min(g.items.length, flat ? FLAT_FIRST : GROUP_FIRST) : 0;
      return {
        key: g.key,
        label: g.label,
        count: g.count,
        items: g.items.slice(0, shown).map(decorate),
        expand,
        shown,
        hasMore: shown < g.items.length
      };
    });

    const all = loadOpenings();
    const counts = { open: 0, closing: 0, upcoming: 0, tba: 0, closed: 0 };
    all.forEach((o) => { counts[statusOf(o)] += 1; });

    const tl = this.data.view === 'timeline' ? buildTimeline(list) : this.data.tl;

    this.setData({
      groups,
      total: list.length,
      counts,
      tl,
      favCount: favIdSet.size,
      // 智能化：基于简历+意向的个性化推荐（列表视图才展示，时间线视图保持纯可视化）
      recos: this.data.view === 'list' ? recommendOpenings(8) : []
    });
  },

  /* ---------- 关注（星标）岗位 ---------- */

  /** 只显示关注的岗位 */
  toggleFollowedOnly() {
    this.setData({ followedOnly: !this.data.followedOnly }, () => this.refresh());
  },

  /** 切换单个岗位的关注状态 */
  toggleFav(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const now = toggleFollowOpening(id);
    refreshFavSet();
    toast(now ? '已关注，可在秋招首页「我关注的岗位」查看' : '已取消关注');
    // 时间线视图：卡片不在 groups 里，直接重建时间线以同步星标
    if (this.data.view === 'timeline') {
      this.refresh();
      return;
    }
    // 在「只看关注」下取消关注，需要立刻把它从列表里去掉
    if (this.data.followedOnly && !now) {
      this.refresh();
      return;
    }
    // 否则只更新星标，不必重建整个列表（保留展开状态）
    const groups = this.data.groups.map((g) => ({
      ...g,
      items: g.items.map((it) => (it._id === id ? { ...it, fav: now } : it))
    }));
    this.setData({ groups, favCount: favIdSet.size });
  },

  /* ---------- 筛选 ---------- */
  onSearch(e: WechatMiniprogram.InputEvent) {
    const kw = e.detail.value;
    // 立即回显输入，重算延迟到停顿后，避免逐键卡顿
    this.setData({ keyword: kw });
    if (kwTimer) clearTimeout(kwTimer);
    kwTimer = setTimeout(() => this.refresh(), 180);
  },
  onClearSearch() {
    this.setData({ keyword: '' }, () => this.refresh());
  },
  onCompanyType(e: WechatMiniprogram.TouchEvent) {
    this.setData({ companyType: e.currentTarget.dataset.key as string }, () => this.refresh());
  },
  onOwnership(e: WechatMiniprogram.TouchEvent) {
    this.setData({ ownership: e.currentTarget.dataset.key as string }, () => this.refresh());
  },
  onRecruitType(e: WechatMiniprogram.TouchEvent) {
    this.setData({ recruitType: e.currentTarget.dataset.key as string }, () => this.refresh());
  },
  onStatus(e: WechatMiniprogram.TouchEvent) {
    this.setData({ status: e.currentTarget.dataset.key as string }, () => this.refresh());
  },
  onGroup(e: WechatMiniprogram.TouchEvent) {
    this.setData({ groupBy: e.currentTarget.dataset.key as GroupBy }, () => this.refresh());
  },
  resetFilter() {
    this.setData({
      companyType: 'all', ownership: 'all', recruitType: 'all',
      status: 'all', keyword: '', followedOnly: false
    }, () => this.refresh());
  },

  /* ---------- 分组折叠与分段加载 ---------- */
  toggleGroup(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const gi = this.rawGroups.findIndex((g) => g.key === key);
    if (gi < 0) return;
    const raw = this.rawGroups[gi];
    const vo = this.data.groups[gi];
    if (!vo) return;

    if (vo.expand) {
      const next = this.data.groups.map((g) => (g.key === key ? { ...g, expand: false, items: [], shown: 0 } : g));
      this.setData({ groups: next });
      return;
    }
    const shown = Math.min(raw.items.length, this.data.groupBy === 'none' ? FLAT_FIRST : GROUP_FIRST);
    const next = this.data.groups.map((g) =>
      g.key === key ? { ...g, expand: true, items: raw.items.slice(0, shown).map(decorate), shown, hasMore: shown < raw.items.length } : g
    );
    this.setData({ groups: next });
  },

  /** 组内「加载更多」 */
  loadMore(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const gi = this.rawGroups.findIndex((g) => g.key === key);
    if (gi < 0) return;
    const raw = this.rawGroups[gi];
    const vo = this.data.groups[gi];
    if (!vo) return;
    const shown = Math.min(raw.items.length, vo.shown + STEP);
    const next = this.data.groups.map((g) =>
      g.key === key ? { ...g, items: raw.items.slice(0, shown).map(decorate), shown, hasMore: shown < raw.items.length } : g
    );
    this.setData({ groups: next });
  },

  toggleExpand(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const groups = this.data.groups.map((g) => ({
      ...g,
      items: g.items.map((it) => {
        if (it._id !== id) return it;
        const expand = !it.expand;
        // 仅展开这一条时才生成备战指南：折叠的条目永远不做这一步计算
        return { ...it, expand, prep: prepFor(it), prepOpen: false };
      })
    }));
    this.setData({ groups });
  },

  /** 展开 / 收起完整备战清单（列表内） */
  togglePrep(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (e.currentTarget.dataset.src === 'tl') {
      this.setData({ tlPrepOpen: !this.data.tlPrepOpen });
      return;
    }
    const groups = this.data.groups.map((g) => ({
      ...g,
      items: g.items.map((it) => (it._id === id ? { ...it, prepOpen: !it.prepOpen, prep: prepFor(it) } : it))
    }));
    this.setData({ groups });
  },

  /** 复制整份备战清单，可粘进备忘录或待办 */
  copyPrep(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const it = e.currentTarget.dataset.src === 'tl' ? null : this.findItem(id);
    const g = it ? (it.prep || prepFor(it)) : this.data.tlPrep;
    if (!g) { toast('没有可用数据'); return; }
    wx.setClipboardData({ data: g.text, success: () => toast('已复制备战清单') });
  },

  /** 从分组结构中定位某条记录 */
  findItem(id: string): DecoOpening | undefined {
    for (const g of this.data.groups) {
      const hit = g.items.find((x) => x._id === id);
      if (hit) return hit;
    }
    return undefined;
  },

  copyLink(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const it = this.findItem(id);
    if (!it || !it.applyUrl) { toast('该条暂无投递链接'); return; }
    wx.setClipboardData({
      data: it.applyUrl,
      success: () => toast('已复制投递入口，去浏览器打开')
    });
  },

  openSource(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const it = this.findItem(id);
    if (!it) return;
    this.setData({
      showSource: true,
      curSource: `来源：${it.source}\n链接：${it.sourceUrl}\n更新时间：${it.updatedAt}`
    });
  },
  closeSource() { this.setData({ showSource: false, curSource: '' }); },
  copySource() {
    wx.setClipboardData({ data: this.data.curSource, success: () => toast('已复制来源信息') });
  },

  /** 一键把这条岗位存成投递卡（复用秋招助手的投递详情） */
  addToApps(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const it = this.findItem(id) || this.findOpeningInTimeline(id);
    if (!it) { toast('没有可用数据'); return; }
    const q = encodeURIComponent(
      `${it.company}|${it.jobCategory}|${it.recruitType}|${it.applyUrl}`
    );
    // 走统一跳转层：栈深预检 + 防连点 + 三级兜底，避免「存为投递卡」在栈满时静默失败
    go(`/subpackages/recruit/pages/recruit/detail?fromOpening=${q}`, { title: '投递详情' });
  },

  /** 时间线模式下从节点/待公布区里定位记录 */
  findOpeningInTimeline(id: string): JobOpening | undefined {
    const hit =
      this.data.tl.nodes.some((nd) => nd.items.some((c) => c._id === id)) ||
      this.data.tl.tba.some((c) => c._id === id);
    if (!hit) return undefined;
    return loadOpenings().find((o) => o._id === id);
  },

  /** 「为我推荐」卡片的某条 → 直接存为投递卡（推荐结果不在分组/时间线里，需按 id 直查岗位库） */
  onRecoTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const o = loadOpenings().find((x) => x._id === id);
    if (!o) { toast('没有可用数据'); return; }
    const q = encodeURIComponent(`${o.company}|${o.jobCategory}|${o.recruitType}|${o.applyUrl}`);
    go(`/subpackages/recruit/pages/recruit/detail?fromOpening=${q}`, { title: '投递详情' });
  },

  onPageScroll(e: { scrollTop?: number }) {
    const show = (e && e.scrollTop ? e.scrollTop : 0) > 700;
    if (show !== this.data.showTop) this.setData({ showTop: show });
  },
  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 260 });
  },

  /* ---------- 视图切换：列表 / 时间线 ---------- */
  toggleView(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.view as 'list' | 'timeline';
    if (v === this.data.view) return;
    if (v === 'timeline') {
      const tl = buildTimeline(
        cachedSearch({
          kw: this.data.keyword, companyType: this.data.companyType,
          ownership: this.data.ownership, recruitType: this.data.recruitType, status: this.data.status
        })
      );
      this.setData({ view: 'timeline', tl, tbaOpen: false, tlBar: null, tlPrep: null, tlPrepOpen: false });
    } else {
      this.setData({ view: 'list', tlBar: null, tlPrep: null, tlPrepOpen: false });
    }
  },

  /** 待公布折叠区展开/收起 */
  toggleTba() {
    this.setData({ tbaOpen: !this.data.tbaOpen });
  },

  /** 点击某张时间线卡片 → 弹出详情（含该岗位的备战指南） */
  onBarTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const card =
      this.data.tl.nodes.flatMap((nd) => nd.items).find((c) => c._id === id) ||
      this.data.tl.tba.find((c) => c._id === id);
    if (!card) return;
    const opening = loadOpenings().find((o) => o._id === id);
    this.setData({
      tlBar: card,
      tlPrep: opening ? prepFor(opening) : null,
      tlPrepOpen: false
    });
  },
  closeBar() { this.setData({ tlBar: null, tlPrep: null, tlPrepOpen: false }); },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '岗位开放 · 大厂/外企/四大/八大秋招时间一览', path: '/subpackages/recruit/pages/recruit/openings' };
  }
});
