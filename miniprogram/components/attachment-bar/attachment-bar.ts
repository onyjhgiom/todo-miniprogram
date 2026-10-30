// components/attachment-bar/attachment-bar.ts
// 待办附件：图片 / 视频（云存储）+ 链接
//
// 附件链路（图片与视频共用同一套状态机）：
//   1) chooseMedia 拿到本地临时路径 → 先落库 + 立刻显示缩略图（体验优先）
//   2) 后台逐个上传云存储 → 成功后 triggerEvent('update') 把 url 换成 cloud:// fileID，并清掉 tempPath
//   3) 上传失败 → 保留本地路径并标「仅本机」，避免用户以为文件已存好
// 视频额外两步：
//   · 封面（thumbTempFilePath）也是临时路径 → 视频传完后 best-effort 上传封面，写回 poster
//   · 预览必须走 wx.previewMedia，且它不认 cloud:// → 先 cloudToTemp() 落地再播
// 渲染地址统一由 rebuild() 计算：云 fileID 优先，其次本地临时路径。
import type { IAttachment } from '../../types/index';
import {
  cloudToTemp,
  isCloudFile,
  newAttachmentId,
  removeAttachFiles,
  uploadAttachImage,
  uploadAttachVideo
} from '../../utils/attach';

interface MediaItem {
  id: string;
  /** 媒体类型：图片 / 视频 */
  kind: 'image' | 'video';
  url: string;
  tempPath?: string;
  poster?: string;
  posterTemp?: string;
  /** 实际渲染地址：cloud:// fileID 优先，其次本地临时路径 */
  src: string;
  /** 视频封面渲染地址（图片为空） */
  posterSrc: string;
  /** 视频时长（秒） */
  duration: number;
  /** 时长展示文案 mm:ss */
  durationText: string;
  /** 上传状态：'' 正常 / uploading 上传中 / failed 上传失败（仅本机）/ stale 文件已失效 */
  state: '' | 'uploading' | 'failed' | 'stale';
}
interface LinkItem {
  id: string;
  url: string;
  title?: string;
}

type UploadState = Record<string, 'uploading' | 'failed' | 'stale'>;

const MAX_IMAGES = 9;
const MAX_VIDEOS = 3;
const MAX_LINKS = 5;

/** 单张图片大小上限（MB）：微信 chooseMedia 压缩后通常已较小，这里再兜底防大图 */
const MAX_IMAGE_MB = 10;
/** 单个视频大小上限（MB）：视频体积大且上传耗时，超过则拒绝并提示 */
const MAX_VIDEO_MB = 60;
/** 拍摄视频最长时长（秒）；chooseMedia 上限即 60 */
const MAX_VIDEO_SEC = 60;
/** 允许的图片格式校验（chooseMedia 已限制 mediaType=image，这里再兜底校验扩展名/类型） */
const ACCEPTED_IMG = /\.(jpe?g|png|gif|webp|bmp)$/i;
/** 允许的视频格式校验 */
const ACCEPTED_VIDEO = /\.(mp4|mov|m4v|3gp|avi|mkv|webm)$/i;

/** 秒 → mm:ss */
function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' + r : '' + r);
}

/**
 * 在途上传任务跟踪：父级（如 todo-composer）在提交前调用 flush() 等待全部完成，
 * 确保提交时附件 url 已是云存储 fileID，而非会失效的本地临时路径。
 * 用 WeakMap 以组件实例为 key，避免污染组件实例本身。
 */
const pendingMap = new WeakMap<object, Promise<void>[]>();
function getPending(ctx: object): Promise<void>[] {
  let arr = pendingMap.get(ctx);
  if (!arr) {
    arr = [];
    pendingMap.set(ctx, arr);
  }
  return arr;
}

Component({
  properties: {
    items: { type: Array, value: [] as IAttachment[] }
  },
  data: {
    /** 图片 + 视频（统一网格渲染） */
    medias: [] as MediaItem[],
    links: [] as LinkItem[],
    uploadState: {} as UploadState,
    imageCount: 0,
    videoCount: 0,
    maxImages: MAX_IMAGES,
    maxVideos: MAX_VIDEOS,
    maxVideoMb: MAX_VIDEO_MB,
    maxVideoSec: MAX_VIDEO_SEC,
    maxLinks: MAX_LINKS,
    /** 一次选多个时，上传失败只提示一次，避免连续弹 toast */
    failToastShown: false
  },
  observers: {
    'items': function () {
      this.rebuild();
    }
  },
  lifetimes: {
    attached() {
      this.rebuild();
    }
  },
  methods: {
    /* ==================== 渲染数据 ==================== */

    /** 从 items 属性派生媒体/链接列表（唯一的渲染数据来源） */
    rebuild() {
      const items = (this.data.items || []) as IAttachment[];
      const state = (this.data.uploadState || {}) as UploadState;
      const medias: MediaItem[] = [];
      const links: LinkItem[] = [];
      let imageCount = 0;
      let videoCount = 0;

      items.forEach((a) => {
        if (!a) return;
        if (a.type === 'image' || a.type === 'video') {
          const kind = a.type;
          const src = isCloudFile(a.url) ? a.url : a.tempPath || a.url || '';
          const posterSrc = isCloudFile(a.poster) ? a.poster : a.posterTemp || a.poster || '';
          if (kind === 'image') imageCount++;
          else videoCount++;
          medias.push({
            id: a.id,
            kind,
            url: a.url,
            tempPath: a.tempPath,
            poster: a.poster,
            posterTemp: a.posterTemp,
            src,
            posterSrc,
            duration: a.duration || 0,
            durationText: fmtDuration(a.duration || 0),
            state: state[a.id] || ''
          });
        } else if (a.type === 'link') {
          links.push({ id: a.id, url: a.url, title: a.title });
        }
      });
      this.setData({ medias, links, imageCount, videoCount });
    },

    setState(id: string, state: 'uploading' | 'failed' | 'stale') {
      this.setData({ ['uploadState.' + id]: state });
      this.rebuild();
    },

    clearState(id: string) {
      const next: UploadState = { ...(this.data.uploadState || {}) };
      delete next[id];
      this.setData({ uploadState: next });
      this.rebuild();
    },

    /* ==================== 图片 ==================== */

    onPickImage() {
      const left = MAX_IMAGES - this.data.imageCount;
      if (left <= 0) {
        wx.showToast({ title: '最多添加 ' + MAX_IMAGES + ' 张图片', icon: 'none' });
        return;
      }
      wx.chooseMedia({
        count: left,
        mediaType: ['image'],
        sizeType: ['compressed'],
        success: (res) => {
          const files = (res && res.tempFiles) || [];
          if (!files.length) return;
          this.setData({ failToastShown: false });
          let invalidFmt = 0;
          let invalidSize = 0;
          const maxBytes = MAX_IMAGE_MB * 1024 * 1024;
          const added: IAttachment[] = [];
          files.forEach((f) => {
            const path = (f && f.tempFilePath) || '';
            const okFmt = ACCEPTED_IMG.test(path) || (f && f.fileType === 'image');
            const okSize = (f && f.size ? f.size : 0) <= maxBytes;
            if (!okFmt) {
              invalidFmt++;
              return;
            }
            if (!okSize) {
              invalidSize++;
              return;
            }
            added.push({ id: newAttachmentId(), type: 'image', url: path, tempPath: path });
          });
          if (invalidFmt) {
            wx.showToast({ title: '仅支持 JPG/PNG/GIF/WebP', icon: 'none' });
          } else if (invalidSize) {
            wx.showToast({ title: `单张图片不超过 ${MAX_IMAGE_MB}MB`, icon: 'none' });
          }
          if (!added.length) return;
          // 1) 先交给父级落库，缩略图立刻可见
          this.triggerEvent('change', { added });
          // 2) 再逐张上传云存储
          added.forEach((it) => {
            this.uploadOne(it.id, it.tempPath as string, 'image');
          });
        },
        fail: () => {
          /* 用户取消选择，不提示 */
        }
      });
    },

    /* ==================== 视频 ==================== */

    onPickVideo() {
      const left = MAX_VIDEOS - this.data.videoCount;
      if (left <= 0) {
        wx.showToast({ title: '最多添加 ' + MAX_VIDEOS + ' 个视频', icon: 'none' });
        return;
      }
      wx.chooseMedia({
        count: left,
        mediaType: ['video'],
        sourceType: ['album', 'camera'],
        maxDuration: MAX_VIDEO_SEC,
        camera: 'back',
        success: (res) => {
          const files = (res && res.tempFiles) || [];
          if (!files.length) return;
          this.setData({ failToastShown: false });
          let invalidFmt = 0;
          let invalidSize = 0;
          const maxBytes = MAX_VIDEO_MB * 1024 * 1024;
          const added: IAttachment[] = [];
          files.forEach((f) => {
            const path = (f && f.tempFilePath) || '';
            const okFmt = ACCEPTED_VIDEO.test(path) || (f && f.fileType === 'video');
            const okSize = (f && f.size ? f.size : 0) <= maxBytes;
            if (!okFmt) {
              invalidFmt++;
              return;
            }
            if (!okSize) {
              invalidSize++;
              return;
            }
            added.push({
              id: newAttachmentId(),
              type: 'video',
              url: path,
              tempPath: path,
              // 封面同样只是临时路径：先用于即时展示，上传成功后写回 fileID
              posterTemp: f.thumbTempFilePath || '',
              duration: Math.round(f.duration || 0)
            });
          });
          if (invalidFmt) {
            wx.showToast({ title: '仅支持 MP4/MOV 等常见视频格式', icon: 'none' });
          } else if (invalidSize) {
            wx.showToast({ title: `单个视频不超过 ${MAX_VIDEO_MB}MB`, icon: 'none' });
          }
          if (!added.length) return;
          // 1) 先交给父级落库，封面立刻可见
          this.triggerEvent('change', { added });
          // 2) 视频体积大、耗时长，明确告知用户正在上传
          wx.showToast({ title: '视频上传中，可继续编辑', icon: 'none', duration: 2200 });
          added.forEach((it) => {
            this.uploadOne(it.id, it.tempPath as string, 'video', it.posterTemp || '');
          });
        },
        fail: () => {
          /* 用户取消选择，不提示 */
        }
      });
    },

    /* ==================== 上传 ==================== */

    /**
     * 上传单个附件：
     * 成功 → 通知父级把 url 换成 fileID 并清空 tempPath（避免冷启动读到失效路径）
     * 视频还会 best-effort 上传封面；封面失败不影响视频本体可用
     * 失败 → 标记「仅本机」，保留本地路径让本次会话仍可预览
     * 每次上传都登记到 pendingMap，供 flush() 在父级提交前等待全部完成。
     */
    async uploadOne(id: string, filePath: string, kind: 'image' | 'video', posterPath = ''): Promise<void> {
      if (!filePath) return;
      const pending = getPending(this);
      const p = (async () => {
        this.setState(id, 'uploading');
        try {
          if (kind === 'video') {
            const fileID = await uploadAttachVideo(filePath);
            this.triggerEvent('update', { id, patch: { url: fileID, tempPath: '' } });
            if (posterPath) {
              try {
                const posterID = await uploadAttachImage(posterPath, 'video-poster');
                this.triggerEvent('update', { id, patch: { poster: posterID, posterTemp: '' } });
              } catch (e2) {
                // 封面只是视觉辅助，失败不打扰用户（列表会退化为播放按钮占位）
                console.warn('[attachment-bar] 视频封面上传失败:', e2);
              }
            }
          } else {
            const fileID = await uploadAttachImage(filePath);
            this.triggerEvent('update', { id, patch: { url: fileID, tempPath: '' } });
          }
          this.clearState(id);
        } catch (err) {
          this.setState(id, 'failed');
          console.warn('[attachment-bar] 附件上传失败:', err);
          if (!this.data.failToastShown) {
            this.setData({ failToastShown: true });
            wx.showToast({
              title: kind === 'video' ? '视频上传失败，仅在本次可见' : '图片上传失败，仅在本次可见',
              icon: 'none'
            });
          }
        }
      })();
      pending.push(p);
      p.finally(() => {
        const arr = getPending(this);
        const i = arr.indexOf(p);
        if (i >= 0) arr.splice(i, 1);
      });
    },

    /**
     * 等待当前所有在途上传完成。父级（如 todo-composer）在提交前调用，
     * 确保提交时附件 url 已是云存储 fileID，而非冷启动后失效的本地临时路径。
     */
    flush(): Promise<void> {
      const list = getPending(this).slice();
      if (!list.length) return Promise.resolve();
      return Promise.all(list).then(() => undefined);
    },

    /* ==================== 链接 ==================== */

    onPickLink() {
      wx.showModal({
        title: '添加链接',
        editable: true,
        placeholderText: '链接地址（必填）',
        success: (res) => {
          if (!res.confirm || !res.content) return;
          const url = res.content.trim();
          if (!/^https?:\/\//.test(url)) {
            wx.showToast({ title: '链接需以 http(s) 开头', icon: 'none' });
            return;
          }
          // 简易 title
          let title = url;
          try {
            title = decodeURIComponent(url).split('?')[0].split('#')[0].split('/').pop() || url;
          } catch (_e) {
            /* ignore */
          }
          if (title.length > 30) title = title.slice(0, 30) + '…';
          wx.showModal({
            title: '链接标题',
            editable: true,
            placeholderText: '可选：链接标题',
            content: title,
            success: (r2) => {
              if (!r2.confirm) return;
              const finalTitle = r2.content || title;
              const item: LinkItem = { id: newAttachmentId(), url, title: finalTitle };
              this.triggerEvent('change', { added: [item] });
            }
          });
        }
      });
    },

    /* ==================== 通用操作 ==================== */

    onRemove(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      // 已上传云存储的附件（含视频封面）在删除时同步清理，避免残留占空间
      const att = ((this.data.items || []) as IAttachment[]).filter((a) => a && a.id === id)[0];
      if (att) {
        const fileIDs = [att.url, att.poster].filter((u): u is string => !!u && isCloudFile(u));
        if (fileIDs.length) removeAttachFiles(fileIDs);
      }
      this.clearState(id);
      this.triggerEvent('remove', { id });
    },

    /**
     * 点击媒体瓦片：图片 + 视频统一进预览器（wx.previewMedia）。
     * 视频的 cloud:// fileID 对 previewMedia 支持不稳 → 先 downloadFile 成本地文件再播。
     * 老基础库没有 previewMedia → 退化为「图片仍可预览，视频提示升级」。
     */
    async onPreview(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      const medias = this.data.medias as MediaItem[];
      if (!medias.length) return;
      const idx = Math.max(
        medias.findIndex((m) => m.id === id),
        0
      );
      const needDownload = medias.some((m) => m.kind === 'video' && isCloudFile(m.src));
      // 【遮罩必须一定会关】showLoading({ mask:true }) 是原生全屏遮罩：这里若抛错或
      // 永不 settle 而没走到 hideLoading，整页就点不动了。try/finally + 15s 看门狗双保险。
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
            if (m.kind === 'video') {
              const url = isCloudFile(m.src) ? await cloudToTemp(m.src) : m.src;
              return { url, type: 'video' as const, poster: m.posterSrc || '' };
            }
            return { url: m.src, type: 'image' as const };
          })
        );

        if (typeof wx.previewMedia === 'function') {
          wx.previewMedia({
            sources,
            current: idx,
            fail: () => this.previewFallback(medias, idx)
          });
          return;
        }
        this.previewFallback(medias, idx);
      } catch (err) {
        wx.showToast({ title: '预览失败，请重试', icon: 'none' });
        console.warn('[attachment-bar] 媒体预览失败', err);
      } finally {
        if (needDownload) {
          clearTimeout(watchdog);
          try { wx.hideLoading(); } catch (e) { /* 忽略 */ }
        }
      }
    },

    /** 降级预览：图片走 previewImage；纯视频场景只能提示升级微信 */
    previewFallback(medias: MediaItem[], idx: number) {
      const images = medias.filter((m) => m.kind === 'image' && m.src);
      const cur = medias[idx];
      if (images.length) {
        const current = cur && cur.kind === 'image' && cur.src ? cur.src : images[0].src;
        wx.previewImage({ urls: images.map((m) => m.src), current });
        return;
      }
      wx.showToast({ title: '当前微信版本不支持预览视频，请升级微信', icon: 'none' });
    },

    /**
     * 媒体加载失败：说明 url 指向的文件已不可达
     * （常见于本地临时路径冷启动后失效；或云文件被清理）
     * 标「已失效」，避免用户对着一个空白灰块不明所以。
     */
    onMediaError(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string;
      if (!id) return;
      if (this.data.uploadState && this.data.uploadState[id]) return; // 上传中/失败态优先
      this.setState(id, 'stale');
    },

    onOpenLink(e: WechatMiniprogram.TouchEvent) {
      const url = e.currentTarget.dataset.url as string;
      if (!url) return;
      wx.setClipboardData({ data: url, success: () => wx.showToast({ title: '已复制链接', icon: 'success' }) });
    }
  }
});
