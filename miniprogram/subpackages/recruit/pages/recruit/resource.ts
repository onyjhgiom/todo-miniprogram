// pages/recruit/resource.ts
// 秋招资源库（模块一·全局）：面试题库 / 简历模板 / 面经分享
//
// 浏览体验设计（针对「条目多、找得慢」）：
//   1) 吸顶筛选：搜索框 + 类型 / 岗位 / 轮次三组 tab 常驻顶部，滚到哪都能改条件；
//   2) 分组折叠：支持按「岗位 / 公司 / 轮次」分组，默认折叠，先扫结构再展开细节；
//   3) 分页加载：首屏 20 条，点「加载更多」继续，避免长列表一次性 setData 卡顿；
//   4) 回到顶部：滚动超过一屏出现悬浮按钮；
//   5) 关键词高亮：命中的搜索词在标题里标色，扫读更快；
//   6) 空态引导：无结果时给出「重置筛选」而不是干瞪眼。
import { getCareerState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { searchResources, addQuestion, shareResource, RESOURCE_CATEGORIES, RESOURCE_ROUNDS, loadFavResources, toggleFavResource } from '../../utils/recruit-store';
import { summarize, topicKeysOf } from '../../utils/recruit-library';
import type { LibrarySummary } from '../../utils/recruit-library';
import { resourceBoost } from '../../utils/recruit-intel';
import type { ResourceBoost } from '../../utils/recruit-intel';
import type { IResourceItem, ResourceType } from '../../../../types/index';
import type { ThemeKey } from '../../../../types/index';
import { go } from '../../../../utils/nav';

const TYPE_TABS: { key: ResourceType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'qa', label: '面试题库' },
  { key: 'resume', label: '简历模板' },
  { key: 'experience', label: '面经分享' }
];

/** 岗位筛选：全部 + 各岗位分类（与 recruit-store 的 category 保持一致） */
const CAT_TABS: { key: string; label: string }[] = [
  { key: 'all', label: '全部岗位' },
  ...(RESOURCE_CATEGORIES as readonly string[]).map((c) => ({ key: c, label: c }))
];

/** 面试轮次筛选：一面 / 二面 / Leader面 / HR面 / 通用 */
const ROUND_TABS: { key: string; label: string }[] = [
  { key: 'all', label: '全部轮次' },
  ...(RESOURCE_ROUNDS as readonly string[]).map((r) => ({ key: r, label: r }))
];

/** 分组维度 */
type GroupBy = 'none' | 'cat' | 'company' | 'round';
const GROUP_TABS: { key: GroupBy; label: string }[] = [
  { key: 'none', label: '不分组' },
  { key: 'cat', label: '按岗位' },
  { key: 'company', label: '按公司' },
  { key: 'round', label: '按轮次' }
];

/** 每页条数 */
const PAGE_SIZE = 20;

const TYPE_ICON: Record<ResourceType, string> = { qa: '❓', resume: '📄', experience: '💬' };

/** 搜索输入防抖：272 条资源每次击键都重算高亮片段，防抖避免逐键卡顿 */
let kwTimer: ReturnType<typeof setTimeout> | null = null;

/** 汇总 + 主题 chips 按「筛选范围」缓存：切换主题 / 分组 / 加载更多都不重跑全量 autoTopics + 汇总 */
let _sumCacheKey = '';
let _sumCache: { summary: LibrarySummary; topicChips: ResourceData['topicChips'] } | null = null;

/** 标题高亮片段 */
interface Seg { t: string; hit: boolean }

interface RelatedItem { id: string; title: string }

interface DecoItem extends IResourceItem {
  icon: string;
  expand: boolean;
  /** 标题切分后的高亮片段 */
  segs: Seg[];
  /** 自动主题 key（用于筛选/相关推荐） */
  topicKeys: string[];
  /** 是否已收藏（星标） */
  fav: boolean;
  /** 展开时计算的相关推荐 */
  related?: RelatedItem[];
}

/** 收藏 id 集合（模块级缓存，避免逐条读存储） */
let favIdSet = new Set<string>();

interface Group {
  key: string;
  label: string;
  count: number;
  items: DecoItem[];
  open: boolean;
}

interface ResourceData {
  theme: ThemeKey;
  themeStyle: string;
  heroGradient: string;
  keyword: string;
  type: ResourceType | 'all';
  tabs: { key: string; label: string }[];
  /** 当前岗位筛选，'all' 表示不限岗位 */
  cat: string;
  catTabs: { key: string; label: string }[];
  /** 当前面试轮次筛选，'all' 表示不限轮次 */
  round: string;
  roundTabs: { key: string; label: string }[];
  /** 分组维度 */
  groupBy: GroupBy;
  groupTabs: { key: string; label: string }[];
  groups: Group[];
  /** 未分组时的平铺列表 */
  flat: DecoItem[];
  /** 已加载条数 / 总匹配条数 */
  loaded: number;
  total: number;
  hasMore: boolean;
  /** 回到顶部按钮 */
  showTop: boolean;
  appId: string;
  showShare: boolean;
  shareCompany: string;
  shareTitle: string;
  shareContent: string;
  /** 上下文感知：从某条投递「导入」进来时，按该投递 JD + 简历缺口给资料加权排序 */
  boost: ResourceBoost | null;
  /** 智能汇总面板是否展开 */
  showSummary: boolean;
  /** 自动结构化汇总结果 */
  summary: LibrarySummary | null;
  /** 自动归类生成的高频主题 chips */
  topicChips: { key: string; label: string; layer: string; count: number }[];
  /** 当前选中的主题筛选（'all' 或空表示不限） */
  selTopic: string;
  /** 只看已收藏 */
  favOnly: boolean;
  /** 已收藏条数 */
  favCount: number;
}

function splitHighlight(title: string, kw: string): Seg[] {
  const q = (kw || '').trim().toLowerCase();
  if (!q) return [{ t: title, hit: false }];
  const lower = title.toLowerCase();
  const segs: Seg[] = [];
  let i = 0;
  while (i < title.length) {
    const at = lower.indexOf(q, i);
    if (at < 0) { segs.push({ t: title.slice(i), hit: false }); break; }
    if (at > i) segs.push({ t: title.slice(i, at), hit: false });
    segs.push({ t: title.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  return segs.length ? segs : [{ t: title, hit: false }];
}

Page<ResourceData>({
  data: {
    theme: 'light',
    themeStyle: '',
    heroGradient: '',
    keyword: '',
    type: 'all',
    tabs: TYPE_TABS,
    cat: 'all',
    catTabs: CAT_TABS,
    round: 'all',
    roundTabs: ROUND_TABS,
    groupBy: 'none',
    groupTabs: GROUP_TABS,
    groups: [],
    flat: [],
    loaded: 0,
    total: 0,
    hasMore: false,
    showTop: false,
    appId: '',
    showShare: false,
    shareCompany: '',
    shareTitle: '',
    shareContent: '',
    boost: null,
    showSummary: false,
    summary: null,
    topicChips: [],
    selTopic: 'all',
    favOnly: false,
    favCount: 0
  },

  onLoad(query: Record<string, string | undefined>) {
    this.applyTheme();
    this.setData({ appId: query && query.appId ? (query.appId as string) : '' });
    this.refresh();
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
    const kw = this.data.keyword;
    const type = this.data.type;
    const cat = this.data.cat;
    const round = this.data.round;
    const sel = this.data.selTopic;
    favIdSet = new Set(loadFavResources());

    // 范围（类型/岗位/轮次/关键词）决定汇总与主题 chips；主题 chip、分组、加载更多都不改变范围，
    // 因此按范围做缓存，避免每次点主题都重跑全量 autoTopics + 汇总（实测可省数十 ms）。
    const scopeKey = `${type}|${cat}|${round}|${kw}`;
    let scopeAll = searchResources(kw, type, cat, round);

    // 上下文感知：从某条投递「导入」进来时，按该投递 JD 命中词 + 简历缺口给资料加权排序，
    // 让推荐与「这场面试」有关，而不是每次都从 272 条里盲翻。
    // keywords=JD 关键词（命中=岗位语料），gaps=简历缺口（更要补）→ 缺口权重 2 倍。
    const boost = this.data.appId ? resourceBoost(this.data.appId) : null;
    if (boost && (boost.keywords.length || boost.gaps.length)) {
      const hit = new Set(boost.keywords.map((k) => String(k).toLowerCase()));
      const gap = new Set(boost.gaps.map((k) => String(k).toLowerCase()));
      const weight = (s: string) => {
        let n = 0;
        hit.forEach((k) => { if (k && s.includes(k)) n += 1; });
        gap.forEach((k) => { if (k && s.includes(k)) n += 2; });
        return n;
      };
      const textOf = (r: IResourceItem) =>
        `${r.title} ${r.content || ''} ${(r.tags || []).join(' ')}`.toLowerCase();
      scopeAll = scopeAll.slice().sort((a, b) => weight(textOf(b)) - weight(textOf(a)));
    }

    let summary: LibrarySummary;
    let topicChips: ResourceData['topicChips'];
    if (_sumCache && _sumCacheKey === scopeKey) {
      summary = _sumCache.summary;
      topicChips = _sumCache.topicChips;
    } else {
      const scope: string[] = [];
      if (cat && cat !== 'all') scope.push(cat);
      if (round && round !== 'all') scope.push(round);
      if (type !== 'all') scope.push(type === 'qa' ? '面试题库' : type === 'resume' ? '简历模板' : '面经分享');
      if (kw && kw.trim()) scope.push(`"${kw.trim()}"`);
      summary = summarize(scopeAll, scope.length ? scope.join(' · ') : '全部资料');
      // 直接复用 summarize 一次遍历产出的 allTopics，避免再对全量资料跑一遍 autoTopics
      topicChips = summary.allTopics.slice(0, 12).map((t) => ({ key: t.key, label: t.label, layer: t.layer, count: t.count }));
      _sumCacheKey = scopeKey;
      _sumCache = { summary, topicChips };
    }

    // 列表：在范围结果上再按「选中主题 / 只看收藏」二次过滤（不影响汇总面板）
    let listAll = scopeAll;
    if (sel && sel !== 'all') listAll = scopeAll.filter((r) => topicKeysOf(r).has(sel));
    if (this.data.favOnly) listAll = listAll.filter((r) => favIdSet.has(r._id));
    const total = listAll.length;

    const loaded = Math.min(this.data.loaded || PAGE_SIZE, total);
    const slice = listAll.slice(0, loaded).map((r) => ({
      ...r,
      icon: TYPE_ICON[r.type],
      expand: false,
      topicKeys: Array.from(topicKeysOf(r)),
      fav: favIdSet.has(r._id),
      segs: splitHighlight(r.title, kw)
    }));

    const base = { loaded, total, hasMore: loaded < total, summary, topicChips, favCount: favIdSet.size, boost };
    if (this.data.groupBy === 'none') {
      this.setData({ ...base, flat: slice, groups: [] });
      return;
    }
    this.setData({ ...base, flat: [], groups: this.buildGroups(slice) });
  },

  buildGroups(items: DecoItem[]): Group[] {
    const by = this.data.groupBy;
    const map = new Map<string, DecoItem[]>();
    for (const it of items) {
      let key = '';
      if (by === 'cat') key = it.category || '其他';
      else if (by === 'company') key = it.company || '通用方法论';
      else if (by === 'round') key = it.round || '通用';
      if (!map.has(key)) map.set(key, []);
      (map.get(key) as DecoItem[]).push(it);
    }
    return Array.from(map.entries()).map(([key, list]) => ({
      key,
      label: key,
      count: list.length,
      items: list,
      // 结果少于 3 组时默认展开，减少一次点击
      open: map.size <= 3
    }));
  },

  loadMore() {
    if (!this.data.hasMore) return;
    this.setData({ loaded: this.data.loaded + PAGE_SIZE }, () => this.refresh());
  },

  onPageScroll(e: { scrollTop?: number }) {
    const show = (e && e.scrollTop ? e.scrollTop : 0) > 600;
    if (show !== this.data.showTop) this.setData({ showTop: show });
  },
  backToTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 260 });
  },

  onSearch(e: WechatMiniprogram.InputEvent) {
    const kw = e.detail.value;
    this.setData({ keyword: kw, loaded: PAGE_SIZE, selTopic: 'all' });
    if (kwTimer) clearTimeout(kwTimer);
    kwTimer = setTimeout(() => this.refresh(), 180);
  },
  onClearSearch() {
    if (!this.data.keyword) return;
    this.setData({ keyword: '', loaded: PAGE_SIZE, selTopic: 'all' }, () => this.refresh());
  },
  onType(e: WechatMiniprogram.TouchEvent) {
    this.setData({ type: e.currentTarget.dataset.key as ResourceType | 'all', loaded: PAGE_SIZE, selTopic: 'all' }, () => this.refresh());
  },
  onCat(e: WechatMiniprogram.TouchEvent) {
    this.setData({ cat: (e.currentTarget.dataset.key as string) || 'all', loaded: PAGE_SIZE, selTopic: 'all' }, () => this.refresh());
  },
  onRound(e: WechatMiniprogram.TouchEvent) {
    this.setData({ round: (e.currentTarget.dataset.key as string) || 'all', loaded: PAGE_SIZE, selTopic: 'all' }, () => this.refresh());
  },
  /** 智能汇总面板开关 */
  toggleSummary() {
    this.setData({ showSummary: !this.data.showSummary });
  },
  /** 退出「为某投递优先推荐」的上下文：还原到全库浏览（导入按钮随之隐藏） */
  clearBoost() {
    this.setData({ appId: '', boost: null }, () => this.refresh());
  },
  /** 点击主题 chip：按「自动归类」结果二次筛选 */
  onTopic(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset.key as string) || 'all';
    this.setData({ selTopic: this.data.selTopic === key ? 'all' : key, loaded: PAGE_SIZE }, () => this.refresh());
  },
  onGroupBy(e: WechatMiniprogram.TouchEvent) {
    this.setData({ groupBy: (e.currentTarget.dataset.key as GroupBy) || 'none' }, () => this.refresh());
  },
  /** 只看收藏 */
  toggleFavOnly() {
    this.setData({ favOnly: !this.data.favOnly, loaded: PAGE_SIZE }, () => this.refresh());
  },
  /** 切换单条收藏 */
  toggleFav(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const now = toggleFavResource(id);
    favIdSet = new Set(loadFavResources());
    toast(now ? '已收藏，可用「⭐ 收藏」快速回看' : '已取消收藏');
    if (this.data.favOnly && !now) {
      this.refresh();
      return;
    }
    // 局部更新，保留其它条目的展开状态
    const patch = (list: DecoItem[]) => list.map((it) => (it._id === id ? { ...it, fav: now } : it));
    if (this.data.groupBy === 'none') {
      this.setData({ flat: patch(this.data.flat), favCount: favIdSet.size });
    } else {
      this.setData({
        groups: this.data.groups.map((g) => ({ ...g, items: patch(g.items) })),
        favCount: favIdSet.size
      });
    }
  },
  resetAll() {
    this.setData({
      keyword: '', type: 'all', cat: 'all', round: 'all', loaded: PAGE_SIZE,
      selTopic: 'all', favOnly: false
    }, () => this.refresh());
  },

  toggleGroup(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const groups = this.data.groups.map((g) => (g.key === key ? { ...g, open: !g.open } : g));
    this.setData({ groups });
  },

  toggleExpand(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const toggle = (list: DecoItem[]) => list.map((it) => {
      if (it._id !== id) return it;
      const expand = !it.expand;
      return { ...it, expand, related: expand ? this.relatedFor(it) : undefined };
    });
    if (this.data.groupBy === 'none') {
      this.setData({ flat: toggle(this.data.flat) });
    } else {
      this.setData({
        groups: this.data.groups.map((g) => ({ ...g, items: toggle(g.items) }))
      });
    }
  },

  /** 自动相关推荐：与本条共享主题最多的其它资料（取 Top3） */
  relatedFor(it: DecoItem): RelatedItem[] {
    const pool = this.data.groupBy === 'none' ? this.data.flat : this.data.groups.flatMap((g) => g.items);
    const base = new Set(it.topicKeys);
    return pool
      .filter((x) => x._id !== it._id && x.topicKeys)
      .map((x) => ({ x, overlap: x.topicKeys.filter((k) => base.has(k)).length }))
      .filter((o) => o.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3)
      .map((o) => ({ id: o.x._id, title: o.x.title }));
  },

  /** 点击相关推荐：在列表中展开对应条目 */
  jumpRelated(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const toggle = (list: DecoItem[]) => list.map((it) => (it._id === id ? { ...it, expand: true, related: this.relatedFor(it) } : it));
    if (this.data.groupBy === 'none') {
      this.setData({ flat: toggle(this.data.flat) });
    } else {
      this.setData({ groups: this.data.groups.map((g) => ({ ...g, items: toggle(g.items) })) });
    }
  },

  /** 从投递详情「导入」进入时，点击直接导入到该投递 */
  onImport(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.findItem(id);
    const appId = this.data.appId;
    if (!appId || !item) return;
    const q = item.type === 'experience'
      ? `面经分享：${item.company || item.title}`
      : `${item.title}`;
    addQuestion(appId, q, item.content || '', 'imported');
    toast('已导入到该投递的面经准备');
    setTimeout(() => wx.navigateBack(), 400);
  },

  findItem(id: string): DecoItem | undefined {
    if (this.data.groupBy === 'none') return this.data.flat.find((x) => x._id === id);
    for (const g of this.data.groups) {
      const hit = g.items.find((x) => x._id === id);
      if (hit) return hit;
    }
    return undefined;
  },

  /** 简历模板类条目：带着岗位分类跳到简历页，直接套用对应模板并生成 PDF */
  onMakePdf(e: WechatMiniprogram.TouchEvent) {
    const cat = (e.currentTarget.dataset.cat as string) || '通用';
    go(`/subpackages/recruit/pages/recruit/resume?tpl=${encodeURIComponent(cat)}`);
  },

  /** 用户匿名分享面经（待审核） */
  openShare() { this.setData({ showShare: true }); },
  closeShare() { this.setData({ showShare: false }); },
  onShareCompany(e: WechatMiniprogram.InputEvent) { this.setData({ shareCompany: e.detail.value }); },
  onShareTitle(e: WechatMiniprogram.InputEvent) { this.setData({ shareTitle: e.detail.value }); },
  onShareContent(e: WechatMiniprogram.InputEvent) { this.setData({ shareContent: e.detail.value }); },
  submitShare() {
    if (!this.data.shareContent.trim()) { toast('请填写面经内容'); return; }
    shareResource({
      type: 'experience',
      category: this.data.shareCompany.trim() || '互联网',
      title: this.data.shareTitle.trim() || `${this.data.shareCompany || '某公司'}面经`,
      content: this.data.shareContent.trim(),
      tags: [],
      company: this.data.shareCompany.trim() || undefined,
      author: '匿名用户'
    });
    this.setData({ showShare: false, shareCompany: '', shareTitle: '', shareContent: '' });
    toast('已提交，审核通过后展示');
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '秋招资源库 · 面试题库 / 简历模板 / 面经', path: '/subpackages/recruit/pages/recruit/resource' };
  }
});
