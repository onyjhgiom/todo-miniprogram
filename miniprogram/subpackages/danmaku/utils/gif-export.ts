// subpackages/danmaku/utils/gif-export.ts
// 弹幕 → GIF 导出（端上流水线）。
//
// 小程序没有本地合成 mp4 的能力，但能把弹幕逐帧画到离屏 Canvas，取像素后用我们的
// 纯 TS 编码器打成 GIF89a：相册直接可播、能分享给微信好友，正好覆盖「录制 15 秒弹幕」的诉求。
//
// 性能取舍：导出分辨率与帧率都做了收敛（默认 320×180 @ 10fps），否则 getImageData
// 上百次会把中端机卡死；画质强制 low（关掉粒子/拖尾）进一步压低单帧绘制耗时。
import { DanmakuEngine } from './danmaku-engine';
import type { DanmakuConfig } from './danmaku-types';
import { encodeGIF, type GifFrame } from './gif-encoder';

export interface ExportOptions {
  /** 导出像素宽（CSS px） */
  width?: number;
  /** 导出像素高（CSS px） */
  height?: number;
  /** 帧率 */
  fps?: number;
  /** 时长（秒） */
  durationSec?: number;
  /** 进度回调（0~1） */
  onProgress?: (ratio: number) => void;
}

/**
 * 把一份弹幕配置导出为 15 秒循环 GIF，返回临时文件路径。
 * 调用方拿到路径后可 wx.saveImageToPhotosAlbum 或转发。
 */
export function exportDanmakuGIF(cfg: DanmakuConfig, opts: ExportOptions = {}): Promise<string> {
  const width = opts.width || 320;
  const height = opts.height || 180;
  const fps = opts.fps || 10;
  const durationSec = opts.durationSec || 15;
  const total = Math.max(1, Math.round(durationSec * fps));
  const dt = 1000 / fps;

  return new Promise((resolve, reject) => {
    try {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width, height }) as unknown as WechatMiniprogram.Canvas;
      const ctx = canvas.getContext('2d') as WechatMiniprogram.CanvasRenderingContext;
      const engine = new DanmakuEngine({ width, height, drawBackground: true, loop: true, quality: 'low' });
      engine.setConfig(cfg);
      engine.play();

      const frames: GifFrame[] = [];
      const delay = Math.round(100 / fps);
      for (let i = 0; i < total; i++) {
        engine.update(dt);
        ctx.clearRect(0, 0, width, height);
        engine.draw(ctx as any);
        const img = ctx.getImageData(0, 0, width, height);
        frames.push({ rgba: img.data, delay });
        if (opts.onProgress && (i % 5 === 0 || i === total - 1)) opts.onProgress((i + 1) / total);
      }

      const bytes = encodeGIF(frames, width, height, fps);
      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/danmaku_${Date.now()}.gif`;
      fs.writeFile({
        filePath,
        data: bytes as unknown as Uint8Array,
        encoding: 'binary',
        success: () => resolve(filePath),
        fail: (e) => reject(e)
      });
    } catch (err) {
      reject(err);
    }
  });
}

/** 保存 GIF 到相册（处理首次授权的二次引导） */
export function saveGifToAlbum(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => {
        const e = err as unknown as { errMsg?: string };
        // 用户拒绝授权：引导去设置页开启，而不是默默失败
        if (e && /auth|deny/i.test(e.errMsg || '')) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存 GIF 需要你授权访问相册',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting({ success: () => resolve(), fail: () => reject(err) });
              else reject(err);
            }
          });
        } else {
          reject(err);
        }
      }
    });
  });
}
