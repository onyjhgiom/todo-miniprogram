// components/todo-card/todo-card.ts
import type { DecoratedTodo } from '../../types/index';
import { cloudToTemp, isCloudFile } from '../../utils/attach';

Component({
  options: {
    multipleSlots: false,
    styleIsolation: 'apply-shared'
  },

  properties: {
    todo: {
      type: Object,
      value: {} as DecoratedTodo
    }
  },

  methods: {
    onCheckTap(): void {
      const t = (this.data as { todo: DecoratedTodo }).todo;
      this.triggerEvent('toggle', { id: t._id, completed: t.completed });
    },
    onContentTap(): void {
      const t = (this.data as { todo: DecoratedTodo }).todo;
      // 点击主体进入完整编辑（composer）
      this.triggerEvent('edit', { id: t._id, todo: t });
    },
    onDeleteTap(): void {
      const t = (this.data as { todo: DecoratedTodo }).todo;
      this.triggerEvent('delete', { id: t._id, content: t.content });
    },
    /**
     * 点击附件缩略图：图片 + 视频统一进预览器（wx.previewMedia）。
     * 视频的 cloud:// fileID 对 previewMedia 支持不稳 → 先 downloadFile 成本地文件再播；
     * 老基础库没有 previewMedia → 退化为只预览图片（视频提示升级微信）。
     */
    async onMediaTap(e: WechatMiniprogram.TouchEvent): Promise<void> {
      const t = (this.data as { todo: DecoratedTodo }).todo;
      const medias = (t.attachments || []).filter((a) => (a.type === 'image' || a.type === 'video') && a.url);
      if (!medias.length) return;

      const ds = (e.currentTarget.dataset || {}) as { src?: string; id?: string };
      let idx = ds.id ? medias.findIndex((m) => m.id === ds.id) : -1;
      if (idx < 0 && ds.src) idx = medias.findIndex((m) => m.url === ds.src);
      if (idx < 0) idx = 0;

      const needDownload = medias.some((m) => m.type === 'video' && isCloudFile(m.url));
      // 【遮罩必须一定会关】wx.showLoading({ mask: true }) 是**原生全屏遮罩**，
      // 一旦这里挂起（弱网 / 云文件下载不 settle）或抛错而没走到 hideLoading，
      // 整张页面就再也点不动了（用户描述：界面还在，什么都没反应）。
      // 所以：① 用 try/finally 保证异常路径也关；② 加 15s 看门狗兜底「永不 settle」。
      let watchdog = 0;
      if (needDownload) {
        wx.showLoading({ title: '加载中', mask: true });
        watchdog = setTimeout(() => {
          try { wx.hideLoading(); } catch (e) { /* 忽略 */ }
        }, 15000) as unknown as number;
      }

      try {
        const sources = await Promise.all(
          medias.map(async (m) => {
            if (m.type === 'video') {
              const url = isCloudFile(m.url) ? await cloudToTemp(m.url) : m.tempPath || m.url;
              return { url, type: 'video' as const, poster: m.poster || '' };
            }
            return { url: m.url, type: 'image' as const };
          })
        );

        if (typeof wx.previewMedia === 'function') {
          wx.previewMedia({ sources, current: idx });
          return;
        }
        const images = medias.filter((m) => m.type === 'image' && m.url);
        if (images.length) {
          const cur = medias[idx] && medias[idx].type === 'image' ? medias[idx].url : images[0].url;
          wx.previewImage({ urls: images.map((m) => m.url), current: cur });
          return;
        }
        wx.showToast({ title: '当前微信版本不支持预览视频，请升级微信', icon: 'none' });
      } catch (err) {
        // 预览失败不能让遮罩留在屏幕上，必须提示后收尾
        wx.showToast({ title: '预览失败，请重试', icon: 'none' });
        console.warn('[todo-card] 媒体预览失败', err);
      } finally {
        if (needDownload) {
          clearTimeout(watchdog);
          try { wx.hideLoading(); } catch (e) { /* 忽略 */ }
        }
      }
    }
  }
});
