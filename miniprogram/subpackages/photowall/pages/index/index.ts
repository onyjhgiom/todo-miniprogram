// subpackages/photowall/pages/index/index.ts
// 照片墙：作品列表（我的作品 / 草稿 / 收藏模板）
//
// 三个 Tab 共用一份数据（按 draft / favorite 过滤），不做三套请求。
// 列表只渲染「分页窗口」内的卡片：作品存了几十张图后全量 setData 会明显掉帧。

import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { go } from '../../../../utils/nav';
import type { ThemeKey } from '../../../../types/index';
import type { PWTab } from '../../utils/pw-types';
import {
  loadIndex, loadWork, removeWork, duplicateWork, toggleFavorite,
  computeUnlock, markUnlockSeen, gcOrphanPhotos, loadFavShapes
} from '../../utils/pw-store';
import type { PWIndexItem } from '../../utils/pw-store';
import { HOT_SHAPE_IDS, getShape } from '../../utils/pw-shapes';

/** 每页卡片数 */
const PAGE_SIZE = 12;

interface CardVM extends PWIndexItem {
  /** 更新时间文案 */
  timeText: string;
  /** 无封面时显示的形状图标 */
  fallback: string;
  /** 收藏的形状模板（favs Tab 用） */
  favShape?: boolean;
}

interface IndexData {
  theme: ThemeKey;
  themeStyle: string;
  tab: PWTab;
  tabs: { key: PWTab; label: string }[];
  cards: CardVM[];
  counts: { works: number; drafts: number; favs: number };
  hasMore: boolean;
  loading: boolean;
  /** 左滑中的卡片 id */
  swipeId: string;
  swipeX: number;
  /** 待办联动：解锁提示条（unlockNum 非空时标题按「再完成 N 个…」大数字排版） */
  unlockNum: string;
  unlockTheme: string;
  unlockTitle: string;
  unlockSub: string;
  unlockNew: boolean;
  /** 推荐的形状模板（空状态引导） */
  recs: { id: string; name: string; icon: string; tpl: string }[];
}

Page<IndexData>({
  data: {
    theme: 'light',
    themeStyle: '',
    tab: 'works',
    tabs: [
      { key: 'works', label: '我的作品' },
      { key: 'drafts', label: '草稿' },
      { key: 'favs', label: '收藏模板' }
    ],
    cards: [],
    counts: { works: 0, drafts: 0, favs: 0 },
    hasMore: true,
    loading: false,
    swipeId: '',
    swipeX: 0,
    unlockNum: '',
    unlockTheme: '',
    unlockTitle: '',
    unlockSub: '',
    unlockNew: false,
    recs: []
  },

  /** 当前 Tab 的全量数据（分页窗口从中切片） */
  _all: [] as CardVM[],
  _page: 0,
  _touchX: 0,
  _touchY: 0,
  _moved: false,

  onLoad() {
    this.applyTheme();
    gcOrphanPhotos();
    this.buildRecs();
  },

  onShow() {
    this.applyTheme();
    this.reload();
  },

  onPullDownRefresh() {
    this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return;
    this._page++;
    this.flushPage();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle });
    syncNavBar(s);
    // 本页为固定梦幻风格，导航栏不随主题切换
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: '#2E3B44',
      fail: () => undefined
    });
  },

  buildRecs() {
    const recs = HOT_SHAPE_IDS.map((id) => {
      const s = getShape(id);
      // 设计稿里 6 个热门形状都配了手绘预览卡（tpl-<id>.jpg）
      return s
        ? { id: s.id, name: s.name, icon: s.icon, tpl: '/subpackages/photowall/assets/tpl-' + s.id + '.jpg' }
        : null;
    }).filter((x) => !!x) as { id: string; name: string; icon: string; tpl: string }[];
    this.setData({ recs });
  },

  /* ==================== 数据 ==================== */

  reload() {
    const index = loadIndex();
    const all: CardVM[] = index.map((it) => this.toCard(it));
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    this._all = all;
    this._page = 0;
    this.setData({
      counts: {
        works: all.filter((x) => !x.draft).length,
        drafts: all.filter((x) => x.draft).length,
        favs: loadFavShapes().length
      },
      swipeId: '',
      swipeX: 0
    });
    this.flushPage();
    this.applyUnlock();
  },

  toCard(it: PWIndexItem): CardVM {
    return {
      ...it,
      timeText: fmtTime(it.updatedAt),
      fallback: shapeFallback(it.shapeName)
    };
  },

  /** 当前 Tab 的数据源 */
  source(): CardVM[] {
    const tab = this.data.tab;
    if (tab === 'works') return this._all.filter((x) => !x.draft);
    if (tab === 'drafts') return this._all.filter((x) => x.draft);
    return loadFavShapes().map((s) => ({
      id: 'fav-' + s.id,
      title: s.name,
      shapeName: s.kind === 'text' ? '文字形状' : s.kind === 'mask' ? '自定义' : '内置形状',
      count: 0,
      cover: s.maskPath || '',
      updatedAt: 0,
      draft: false,
      favorite: true,
      timeText: '',
      fallback: s.icon || '⭐',
      favShape: true
    }));
  },

  flushPage() {
    const src = this.source();
    const end = (this._page + 1) * PAGE_SIZE;
    this.setData({
      cards: src.slice(0, end),
      hasMore: end < src.length
    });
  },

  /* ==================== 待办联动 ==================== */

  applyUnlock() {
    const u = computeUnlock();
    if (u.fresh.length) {
      this.setData({
        unlockNum: '',
        unlockTheme: '',
        unlockTitle: '解锁新主题：' + u.fresh.map(themeLabel).join('、'),
        unlockSub: `已完成 ${u.done} 个待办，继续加油`,
        unlockNew: true
      });
      markUnlockSeen(u.fresh);
      return;
    }
    if (u.nextNeed > 0) {
      this.setData({
        unlockNum: String(u.nextNeed),
        unlockTheme: u.nextName,
        unlockTitle: '',
        unlockSub: `已完成 ${u.done} 个 · 连续打卡 ${u.streak} 天`,
        unlockNew: false
      });
      return;
    }
    this.setData({
      unlockNum: '',
      unlockTheme: '',
      unlockTitle: `全部主题已解锁（已完成 ${u.done} 个待办）`,
      unlockSub: `连续打卡 ${u.streak} 天`,
      unlockNew: false
    });
  },

  /* ==================== 交互 ==================== */

  onTab(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as PWTab;
    if (key === this.data.tab) return;
    this.setData({ tab: key, swipeId: '', swipeX: 0 });
    this._page = 0;
    this.flushPage();
  },

  onCreate() {
    go('/subpackages/photowall/pages/editor/editor', { title: '照片墙' });
  },

  onUseRec(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    go(`/subpackages/photowall/pages/editor/editor?shape=${id}`, { title: '照片墙' });
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    // 左滑展开时点击视为收起，避免误触发进入详情
    if (this.data.swipeId) {
      this.setData({ swipeId: '', swipeX: 0 });
      return;
    }
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    if (id.indexOf('fav-') === 0) {
      const shapeId = id.slice(4);
      go(`/subpackages/photowall/pages/editor/editor?shape=${shapeId}`, { title: '照片墙' });
      return;
    }
    go(`/subpackages/photowall/pages/detail/detail?id=${id}`, { title: '作品详情' });
  },

  onLongPress(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id || id.indexOf('fav-') === 0) return;
    wx.vibrateShort({ type: 'medium' });
    wx.showActionSheet({
      itemList: ['编辑', '复制', '收藏 / 取消收藏', '导出图片', '删除'],
      success: (res: { tapIndex: number }) => {
        if (res.tapIndex === 0) this.doEdit(id);
        else if (res.tapIndex === 1) this.doCopy(id);
        else if (res.tapIndex === 2) this.doFav(id);
        else if (res.tapIndex === 3) this.doExport(id);
        else if (res.tapIndex === 4) this.doDelete(id);
      },
      fail: () => undefined
    });
  },

  doEdit(id: string) {
    go(`/subpackages/photowall/pages/editor/editor?id=${id}`, { title: '照片墙' });
  },

  doCopy(id: string) {
    const c = duplicateWork(id);
    if (!c) return toast('复制失败');
    toast('已复制为草稿');
    this.reload();
  },

  doFav(id: string) {
    const on = toggleFavorite(id);
    toast(on ? '已收藏' : '已取消收藏');
    this.reload();
  },

  doExport(id: string) {
    const w = loadWork(id);
    if (!w) return toast('作品不存在');
    go(`/subpackages/photowall/pages/editor/editor?id=${id}&step=export`, { title: '照片墙' });
  },

  doDelete(id: string) {
    wx.showModal({
      title: '删除作品',
      content: '删除后无法恢复（含已保存的图片），确定删除吗？',
      confirmText: '删除',
      confirmColor: '#C0522F',
      success: (r: { confirm: boolean }) => {
        if (!r.confirm) return;
        removeWork(id);
        toast('已删除');
        this.reload();
      }
    });
  },

  /* ==================== 左滑删除 ==================== */

  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    this._touchX = e.touches[0].clientX;
    this._touchY = e.touches[0].clientY;
    this._moved = false;
  },

  onTouchMove(e: WechatMiniprogram.TouchEvent) {
    const dx = e.touches[0].clientX - this._touchX;
    const dy = e.touches[0].clientY - this._touchY;
    // 纵向滑动优先判定为滚动列表，不抢手势
    if (!this._moved && Math.abs(dy) > Math.abs(dx)) return;
    this._moved = true;
    const id = e.currentTarget.dataset.id as string;
    const x = Math.max(-76, Math.min(0, dx));
    if (this.data.swipeId !== id || Math.abs(this.data.swipeX - x) > 2) {
      this.setData({ swipeId: id, swipeX: x });
    }
  },

  onTouchEnd() {
    if (!this._moved) return;
    const x = this.data.swipeX;
    // 过半则保持展开，否则回弹
    this.setData({ swipeX: x < -38 ? -76 : 0, swipeId: x < -38 ? this.data.swipeId : '' });
  },

  onSwipeDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (id.indexOf('fav-') === 0) return;
    this.setData({ swipeId: '', swipeX: 0 }, () => this.doDelete(id));
  },

  onUnlockTap() {
    go('/subpackages/photowall/pages/editor/editor', { title: '照片墙' });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '把照片拼成心形 · 照片墙', path: '/subpackages/photowall/pages/index/index' };
  },

  onShareTimeline(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '把照片拼成心形 · 照片墙', path: '/subpackages/photowall/pages/index/index' };
  }
});

/* ==================== 工具 ==================== */

function fmtTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const p = (n: number): string => (n < 10 ? '0' + n : '' + n);
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (!sameYear) return `${d.getFullYear()}-${md}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= today) return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`;
  if (ts >= today - 86400000) return '昨天';
  return md;
}

function shapeFallback(name: string): string {
  if (name.indexOf('心') >= 0) return '❤️';
  if (name.indexOf('星') >= 0) return '⭐';
  if (name.indexOf('圆') >= 0) return '⭕';
  if (name.indexOf('花') >= 0) return '🌸';
  if (name.indexOf('树') >= 0) return '🎄';
  return '🖼️';
}

function themeLabel(id: string): string {
  const map: Record<string, string> = {
    romance: '浪漫', retro: '复古', festive: '节日', couple: '情侣', family: '家庭'
  };
  return map[id] || id;
}
