// utils/attach.ts
// 待办附件（图片 / 视频）的云存储链路封装：
//   chooseMedia 拿到的是本地临时路径（wxfile:// / http://tmp/...），冷启动后即失效，
//   直接存库会导致「重进小程序附件全变灰块」。因此统一走：
//     先本地临时路径预览 → 上传云存储拿 fileID → 把 url 换成 cloud:// fileID 再落库
//   删除附件时同步清理云存储文件，避免存储空间泄漏。
//
// 视频与图片的差异：
//   1) 视频体积大，扩展名兜底用 mp4；上传耗时更久，状态与「上传中」提示更重要
//   2) 视频封面（thumbTempFilePath）同样是临时路径 → 必须一并上传，否则列表封面冷启动即失效
//   3) 预览视频要用 wx.previewMedia，而它对 cloud:// fileID 支持不稳 →
//      先用 cloudToTemp() 下载成本地文件再预览
//
// 说明：云存储上传/删除都失败不抛致命错误，降级为「仅本机可见」并由调用方提示用户。

const CLOUD_PREFIX = 'cloud://';
/** 云存储目录前缀，便于后台按目录清理 */
const DIR = 'todo-attach';

/** 是否为云存储 fileID（cloud:// 开头） */
export function isCloudFile(url?: string): boolean {
  return typeof url === 'string' && url.indexOf(CLOUD_PREFIX) === 0;
}

/** 生成附件 id（本地唯一即可，无需服务端分配） */
export function newAttachmentId(): string {
  return 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** 从本地路径里取扩展名，取不到用兜底值 */
function extOf(filePath: string, fallback: string): string {
  const m = filePath.match(/\.([A-Za-z0-9]{2,5})(?:\?|$)/);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * 上传单个文件到云存储，成功返回 fileID。
 * 云存储路径：todo-attach[/子目录]/{yyyyMM}/{时间戳}-{随机}.{ext}
 */
function uploadToCloud(filePath: string, extFallback: string, subdir = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      reject(new Error('文件路径为空'));
      return;
    }
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      reject(new Error('云开发未初始化，附件无法上传'));
      return;
    }
    const d = new Date();
    const mm = d.getMonth() + 1;
    const ym = '' + d.getFullYear() + (mm < 10 ? '0' + mm : mm);
    const dir = subdir ? DIR + '/' + subdir : DIR;
    const cloudPath =
      dir + '/' + ym + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + extOf(filePath, extFallback);

    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        if (res && res.fileID) resolve(res.fileID);
        else reject(new Error('上传返回为空'));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '附件上传失败'))
    });
  });
}

/**
 * 上传单张图片到云存储，成功返回 fileID。
 * subdir 可用于把「视频封面」这类派生资源分目录存放，便于后台批量清理。
 */
export function uploadAttachImage(filePath: string, subdir = ''): Promise<string> {
  return uploadToCloud(filePath, 'jpg', subdir);
}

/** 上传单个视频到云存储，成功返回 fileID（扩展名兜底 mp4） */
export function uploadAttachVideo(filePath: string): Promise<string> {
  return uploadToCloud(filePath, 'mp4');
}

/**
 * 云文件 → 本地临时路径（best-effort）。
 * 用于 `wx.previewMedia` 这类对 cloud:// 支持不稳的 API：先落地成本地文件再播。
 * 下载失败时回落为原 fileID（上层预览会失败，但不至于整个流程中断）。
 */
export function cloudToTemp(fileID: string): Promise<string> {
  return new Promise((resolve) => {
    if (!isCloudFile(fileID) || !wx.cloud || typeof wx.cloud.downloadFile !== 'function') {
      resolve(fileID);
      return;
    }
    wx.cloud.downloadFile({
      fileID,
      success: (res) => resolve((res && res.tempFilePath) || fileID),
      fail: () => resolve(fileID)
    });
  });
}

/**
 * 批量清理云存储文件（best-effort）：
 * 只处理 cloud:// 开头的，失败仅在控制台告警，绝不阻塞本地删除流程。
 */
export function removeAttachFiles(fileIDs: string[]): void {
  const list = (fileIDs || []).filter(isCloudFile);
  if (!list.length) return;
  if (!wx.cloud || typeof wx.cloud.deleteFile !== 'function') return;
  wx.cloud.deleteFile({
    fileList: list,
    fail: (err: { errMsg: string }) => {
      // 云文件残留只影响存储占用，不影响用户使用，因此不弹错
      console.warn('[attach] 云存储文件清理失败:', (err && err.errMsg) || err);
    }
  });
}
