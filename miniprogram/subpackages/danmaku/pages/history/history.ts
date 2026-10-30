// subpackages/danmaku/pages/history/history.ts
// 弹幕历史与收藏：复用 / 删除 / 收藏切换 / 分享。
//
// 数据来自本地 store（listHistory 已按 updatedAt 倒序）。这里只做「浏览 + 轻量操作」，
// 真正的编辑仍交回编辑器页；点「打开」即带 id 跳回 editor 复用整份配置。
import {
  listHistory,
  listFavorites,
  removeConfig,
  toggleFavorite,
  getConfig,
  normalizeConfig
} from '../../utils/danmaku-store';
import type { DanmakuConfig } from '../../utils/danmaku-types';
import { SKIN_PRESETS } from '../../utils/danmaku-presets';
import { go } from '../../../../utils/nav';

interface HistoryItem {
  id: string;
  name: string;
  itemCount: number;
  favorite: boolean;
  skinLabel: string;
  previewText: string;
  updatedAtLabel: string;
}

function fmt(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    list: [] as HistoryItem[],
    favCount: 0,
    total: 0,
    shareConfig: null as DanmakuConfig | null
  },

  onShow() {
    this.reload();
  },

  reload() {
    const all = listHistory();
    const favIds = new Set(listFavorites().map((c) => c.id));
    const list: HistoryItem[] = all.map((c) => ({
      id: c.id,
      name: c.name || '未命名弹幕',
      itemCount: (c.items || []).length,
      favorite: favIds.has(c.id),
      skinLabel: SKIN_PRESETS[c.skin] ? SKIN_PRESETS[c.skin].label : '无皮肤',
      previewText: (c.items || [])[0] ? (c.items[0].text || '') : '（空）',
      updatedAtLabel: fmt(c.updatedAt)
    }));
    this.setData({
      list,
      favCount: favIds.size,
      total: list.length,
      shareConfig: all.length ? normalizeConfig(all[0]) : null
    });
  },

  onNew() {
    go('/subpackages/danmaku/pages/editor/editor', { title: '弹幕编辑器' });
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    go(`/subpackages/danmaku/pages/editor/editor?id=${id}`, { title: '弹幕编辑器' });
  },

  onToggleFav(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    toggleFavorite(id);
    this.reload();
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    const item = this.data.list.find((it) => it.id === id);
    wx.showModal({
      title: '删除弹幕配置',
      content: `确定删除「${item ? item.name : '该配置'}」？此操作不可恢复。`,
      confirmText: '删除',
      confirmColor: '#E04848',
      success: (r) => {
        if (r.confirm) {
          removeConfig(id);
          this.reload();
          wx.showToast({ title: '已删除', icon: 'none' });
        }
      }
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const cfg = this.data.shareConfig;
    return {
      title: '我做的弹幕墙，快来看看',
      path: `/subpackages/danmaku/pages/stage/stage?config=${cfg ? encodeURIComponent(JSON.stringify(cfg)) : ''}`
    };
  }
});
