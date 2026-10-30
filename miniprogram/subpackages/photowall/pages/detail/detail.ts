// subpackages/photowall/pages/detail/detail.ts
// 照片墙：作品详情（大图预览 / 再编辑 / 导出 / 分享 / 收藏 / 备注）

import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { go, back } from '../../../../utils/nav';
import type { ThemeKey } from '../../../../types/index';
import type { PWWork } from '../../utils/pw-types';
import { exportWork, makeCover } from '../../utils/pw-render';
import {
  loadWork, removeWork, toggleFavorite, setNote, setCover, duplicateWork
} from '../../utils/pw-store';

interface DetailData {
  theme: ThemeKey;
  themeStyle: string;
  id: string;
  img: string;
  title: string;
  shapeName: string;
  count: number;
  createdText: string;
  updatedText: string;
  note: string;
  favorite: boolean;
  draft: boolean;
  busy: boolean;
}

Page<DetailData>({
  data: {
    theme: 'light',
    themeStyle: '',
    id: '',
    img: '',
    title: '',
    shapeName: '',
    count: 0,
    createdText: '',
    updatedText: '',
    note: '',
    favorite: false,
    draft: false,
    busy: false
  },

  work: null as PWWork | null,

  onLoad(q: Record<string, string>) {
    this.applyTheme();
    const id = q.id || '';
    const w = loadWork(id);
    if (!w) {
      toast('作品不存在');
      setTimeout(() => back(), 800);
      return;
    }
    this.work = w;
    this.setData({
      id,
      title: w.title || '未命名',
      shapeName: w.shapeName || '自定义',
      count: (w.photos || []).length,
      createdText: fmt(w.createdAt),
      updatedText: fmt(w.updatedAt),
      note: w.note || '',
      favorite: !!w.favorite,
      draft: !!w.draft,
      img: w.cover || ''
    });
    if (!w.cover) this.buildCover();
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    const s = getThemeState();
    this.setData({ theme: s.theme, themeStyle: s.themeStyle });
    syncNavBar(s);
  },

  /** 没有封面时现生成一张并回写（列表卡片需要它） */
  async buildCover() {
    const w = this.work;
    if (!w) return;
    try {
      const p = await makeCover(w);
      this.setData({ img: p });
      setCover(w.id, p);
      if (this.work) this.work.cover = p;
    } catch (e) {
      console.warn('[photo-wall] cover failed:', e);
    }
  },

  onPreview() {
    if (!this.data.img) return;
    wx.previewImage({ urls: [this.data.img], current: this.data.img });
  },

  onEdit() {
    go(`/subpackages/photowall/pages/editor/editor?id=${this.data.id}`, { title: '照片墙' });
  },

  async onExport() {
    const w = this.work;
    if (!w || this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '正在生成', mask: true });
    try {
      const p = await exportWork(w, { shortPx: 1440, fileType: 'jpg', quality: 0.92 });
      wx.hideLoading();
      this.setData({ busy: false });
      wx.previewImage({ urls: [p], current: p });
    } catch (e) {
      wx.hideLoading();
      this.setData({ busy: false });
      toast('导出失败');
    }
  },

  async onSaveAlbum() {
    const w = this.work;
    if (!w || this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '正在生成', mask: true });
    try {
      const p = await exportWork(w, { shortPx: 1440, fileType: 'jpg', quality: 0.92 });
      wx.hideLoading();
      this.setData({ busy: false });
      wx.saveImageToPhotosAlbum({
        filePath: p,
        success: () => toast('已保存到相册', 'success'),
        fail: (err: { errMsg: string }) => {
          const m = String(err.errMsg || '');
          if (m.indexOf('deny') >= 0 || m.indexOf('authorize') >= 0) {
            wx.showModal({
              title: '需要相册权限',
              content: '去设置里开启「保存到相册」权限？',
              confirmText: '去设置',
              success: (r: { confirm: boolean }) => {
                if (r.confirm) wx.openSetting({});
              }
            });
            return;
          }
          toast('保存失败');
        }
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ busy: false });
      toast('导出失败');
    }
  },

  onFav() {
    const on = toggleFavorite(this.data.id);
    this.setData({ favorite: on });
    toast(on ? '已收藏' : '已取消收藏');
  },

  onCopy() {
    const c = duplicateWork(this.data.id);
    if (!c) return toast('复制失败');
    toast('已复制为草稿');
  },

  onNote() {
    wx.showModal({
      title: '添加备注',
      editable: true,
      placeholderText: '写给这张照片墙的一句话',
      content: this.data.note,
      success: (r: { confirm: boolean; content?: string }) => {
        if (!r.confirm) return;
        const v = (r.content || '').slice(0, 60);
        setNote(this.data.id, v);
        this.setData({ note: v });
      }
    });
  },

  onDelete() {
    wx.showModal({
      title: '删除作品',
      content: '删除后无法恢复（含已保存的图片），确定吗？',
      confirmText: '删除',
      confirmColor: '#C0522F',
      success: (r: { confirm: boolean }) => {
        if (!r.confirm) return;
        removeWork(this.data.id);
        toast('已删除');
        setTimeout(() => back(), 500);
      }
    });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: `我用 ${this.data.count} 张照片拼了一个${this.data.shapeName} · 照片墙`,
      path: '/subpackages/photowall/pages/index/index'
    };
  },

  onShareTimeline(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: `我用 ${this.data.count} 张照片拼了一个${this.data.shapeName} · 照片墙`,
      path: '/subpackages/photowall/pages/index/index'
    };
  }
});

function fmt(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number): string => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
