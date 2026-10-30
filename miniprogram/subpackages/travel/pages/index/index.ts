// subpackages/travel/pages/index/index.ts
// 旅行模式首页：沉浸式旅行驾驶舱（目的地背景 + 玻璃 UI + CSS 旅行箱主视觉）
// 业务逻辑与旧版完全一致：行程卡片 / 概览 / 云端同步 / 归档 / 长按管理
import { toast } from '../../../../utils/cloud';
import { go } from '../../../../utils/nav';
import * as store from '../../utils/travel-store';
import { COVER_PRESETS } from '../../utils/trip-templates';

/** 视图层卡片：在数据卡片基础上补封面渲染信息 */
interface ViewCard {
  _id: string;
  title: string;
  destination: string;
  dateText: string;
  totalDays: number;
  countdownText: string;
  countdownKey: string;
  packingPercent: number;
  packedCount: number;
  packingTotal: number;
  budgetPercent: number;
  spentCost: number;
  budget: number;
  overBudget: boolean;
  itemCount: number;
  doneItemCount: number;
  /** 封面：预设渐变 / 图片 url */
  coverStyle: string;
  coverEmoji: string;
  coverIsImage: boolean;
  memberText: string;
}

interface InspireCard {
  name: string;
  season: string;
  budget: string;
  img: string;
}

interface TravelHomeData {
  /** 自定义导航栏：状态栏高度（px） */
  statusBarH: number;
  /** 正文让位高度：状态栏 + 导航行（px） */
  bodyPad: number;
  cards: ViewCard[];
  archived: ViewCard[];
  showArchived: boolean;
  /** 概览：总行程 / 行李完成度 */
  statTrips: number;
  statPackingPercent: number;
  statPackingText: string;
  /** 云端是否已联通（用于状态条展示，避免静默长轮询误导） */
  cloudSynced: boolean;
  /** 旅行灵感横滑卡 */
  inspire: InspireCard[];
}

/** cover 可能是预设 key，也可能是图片路径 —— 统一解析成可直接下发的样式 */
function coverOf(cover: string): { style: string; emoji: string; isImage: boolean } {
  if (!cover) {
    const p = COVER_PRESETS[0];
    return { style: `background:${p.gradient}`, emoji: p.emoji, isImage: false };
  }
  const preset = COVER_PRESETS.find((p) => p.key === cover);
  if (preset) return { style: `background:${preset.gradient}`, emoji: preset.emoji, isImage: false };
  if (cover.indexOf('cloud://') === 0 || cover.indexOf('http') === 0 || cover.indexOf('/') === 0) {
    return { style: '', emoji: '', isImage: true };
  }
  const p = COVER_PRESETS[0];
  return { style: `background:${p.gradient}`, emoji: p.emoji, isImage: false };
}

function decorate(c: ReturnType<typeof store.tripCard>): ViewCard {
  const t = c.trip;
  const cov = coverOf(t.cover);
  const members = t.members && t.members.length ? t.members.join('、') : '独自出行';
  return {
    _id: t._id,
    title: t.title,
    destination: t.destination || '未设目的地',
    dateText: `${t.startDate} ~ ${t.endDate}`,
    totalDays: c.totalDays,
    countdownText: c.countdownText,
    countdownKey: c.countdownKey,
    packingPercent: c.packingPercent,
    packedCount: c.packedCount,
    packingTotal: c.packingTotal,
    budgetPercent: c.budgetPercent,
    spentCost: c.spentCost,
    budget: Number(t.budget) || 0,
    overBudget: c.overBudget,
    itemCount: c.itemCount,
    doneItemCount: c.doneItemCount,
    coverStyle: cov.style,
    coverEmoji: cov.emoji,
    coverIsImage: cov.isImage,
    memberText: members
  };
}

/** 旅行灵感（本地内置，点击直达创建行程；不联网、零请求） */
const INSPIRE: InspireCard[] = [
  { name: '京都', season: '秋季最适合 · 红叶满城', budget: '¥3,200 起', img: '/subpackages/travel/assets/insp-kyoto.jpg' },
  { name: '冰岛', season: '极光季 · 9 月～次年 3 月', budget: '¥12,000 起', img: '/subpackages/travel/assets/insp-iceland.jpg' },
  { name: '海岛度假', season: '全年皆宜 · 潜水浮潜', budget: '¥5,800 起', img: '/subpackages/travel/assets/insp-island.jpg' }
];

/** 取状态栏高度：自定义导航栏需要自己让位 */
function statusBarHeight(): number {
  try {
    const info: any = (wx as any).getWindowInfo
      ? (wx as any).getWindowInfo()
      : wx.getSystemInfoSync();
    return (info && info.statusBarHeight) || 44;
  } catch (e) {
    return 44;
  }
}

Page<TravelHomeData>({
  data: {
    statusBarH: 44,
    bodyPad: 100,
    cards: [],
    archived: [],
    showArchived: false,
    statTrips: 0,
    statPackingPercent: 0,
    statPackingText: '0/0',
    cloudSynced: false,
    inspire: INSPIRE
  },

  unsub: null as (() => void) | null,

  onLoad() {
    const sb = statusBarHeight();
    this.setData({ statusBarH: sb, bodyPad: sb + 52 });
    this.refresh();
    this.unsub = store.subscribe(() => this.refresh());
    // 云端拉取：未部署云函数时 pullFromCloud 内部直接返回（零云端调用、零长轮询），
    // 已联通时才真正同步，因此页面加载始终瞬时完成、不会 reLaunch 超时。
    void store.pullFromCloud().then(() => this.refresh());
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    void store.syncCloud().then((r) => {
      this.refresh();
      wx.stopPullDownRefresh();
      toast(r.msg, r.ok ? 'success' : 'none');
    });
  },

  /** 手动云端同步：显式探测并拉取，结果以 toast 反馈（不会在加载期静默长轮询） */
  onSync() {
    toast('正在同步…', 'loading');
    void store.syncCloud().then((r) => {
      this.refresh();
      toast(r.msg, r.ok ? 'success' : 'none');
    });
  },

  refresh() {
    const { active, archived } = store.splitCards();
    // 概览：所有未归档行程的行包总进度
    let packed = 0;
    let total = 0;
    active.forEach((c) => {
      packed += c.packedCount;
      total += c.packingTotal;
    });
    this.setData({
      cards: active.map(decorate),
      archived: archived.map(decorate),
      statTrips: active.length,
      statPackingPercent: total ? Math.round((packed / total) * 100) : 0,
      statPackingText: `${packed}/${total}`,
      cloudSynced: store.isCloudSynced()
    });
  },

  /** 自定义导航栏返回：栈空（分享进入）时兜底回首页 */
  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    });
  },

  onCreate() {
    go('/subpackages/travel/pages/trip-edit/trip-edit', { title: '新建行程' });
  },

  /** 快捷入口：行李清单 / 行程规划 / 旅行预算 —— 都挂在第一个进行中行程上 */
  onQuick(e: WechatMiniprogram.TouchEvent) {
    const act = (e.currentTarget.dataset.act as string) || '';
    const first = this.data.cards[0];
    if (!first) {
      toast('先创建一个行程吧', 'none');
      this.onCreate();
      return;
    }
    if (act === 'packing') {
      go(`/subpackages/travel/pages/packing/packing?id=${first._id}`, { title: '行李清单' });
    } else {
      // 行程规划 / 旅行预算 都在行程详情里继续
      go(`/subpackages/travel/pages/trip-detail/trip-detail?id=${first._id}`, { title: '行程详情' });
    }
  },

  /** 旅行灵感：进入沉浸式「目的地推荐 + 旅行计划 + 帖子」浏览页 */
  onInspire() {
    go('/subpackages/travel/pages/inspiration/inspiration', { title: '旅行灵感' });
  },

  onOpenCard(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    go(`/subpackages/travel/pages/trip-detail/trip-detail?id=${id}`, { title: '行程详情' });
  },

  /** 长按卡片：归档 / 复盘 / 删除 */
  onCardLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const trip = store.getTrip(id);
    if (!trip) return;
    const opts = ['查看复盘总结', trip.archived ? '取消归档' : '归档行程', '复制为新行程', '删除行程'];
    wx.showActionSheet({
      itemList: opts,
      success: (res) => {
        if (res.tapIndex === 0) {
          go(`/subpackages/travel/pages/trip-summary/trip-summary?id=${id}`, { title: '旅行复盘' });
        } else if (res.tapIndex === 1) {
          void store.archiveTrip(id, !trip.archived).then(() => {
            this.refresh();
            toast(trip.archived ? '已取消归档' : '已归档', 'success');
          });
        } else if (res.tapIndex === 2) {
          const start = store.toYMD(store.todayStart() + 30 * 86400000);
          void store.cloneTrip(id, start).then(() => {
            this.refresh();
            toast('已复制为新行程', 'success');
          });
        } else if (res.tapIndex === 3) {
          wx.showModal({
            title: '删除行程',
            content: `删除「${trip.title}」及其行李与行程条目？此操作不可恢复。`,
            confirmColor: '#C0522F',
            success: (m) => {
              if (!m.confirm) return;
              void store.removeTrip(id).then(() => {
                this.refresh();
                toast('已删除', 'success');
              });
            }
          });
        }
      },
      fail: () => {
        /* 用户取消 */
      }
    });
  },

  onToggleArchived() {
    this.setData({ showArchived: !this.data.showArchived });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '我的旅行清单', path: '/subpackages/travel/pages/index/index' };
  }
});
