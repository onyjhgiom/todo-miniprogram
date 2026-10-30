// subpackages/photowall/utils/pw-batch.ts
// 照片墙：批量选图的分批计划（纯计算、零依赖，方便离线单测）
//
// ── 为什么要这个模块 ──────────────────────────────────────────
// 微信的 wx.chooseMedia / wx.chooseImage **单次最多只能选 9 张**（平台硬限制，
// count 传更大也无效），而照片墙的固定模板动辄需要 20~60 张。想让用户「一次把
// 需要的照片全选完」，只有两条路：
//   1) **自动接力**：选完 9 张后立刻自动弹出下一次选择，直到凑够目标张数或用户取消；
//   2) **从聊天导入**：wx.chooseMessageFile 一次最多可选 100 个文件（相册没有这个能力），
//      让用户先把照片发到某个聊天（文件传输助手最方便），再一次性勾选。
// 本模块负责算出「接力时每一轮让用户选几张」，把平台限制集中成一个可测的纯函数。

/** 微信 wx.chooseMedia 单次选图上限（平台限制，唯一事实来源） */
export const PICK_PER_BATCH = 9;

/** wx.chooseMessageFile 从聊天一次可选的最大文件数 */
export const CHAT_PICK_MAX = 100;

/**
 * 把「还差 left 张」拆成每轮不超过 per 张的批次计划。
 * 例：left=34 → [9,9,9,7]；left=5 → [5]；left=0 → []
 * 用途：① 提示用户「要连续选 N 次」；② 接力循环按计划取每轮上限。
 */
export function planPhotoBatches(left: number, per = PICK_PER_BATCH): number[] {
  const step = Math.max(1, per | 0);
  const out: number[] = [];
  let rest = Math.floor(left);
  if (!isFinite(rest) || rest <= 0) return out;
  while (rest > 0) {
    const n = Math.min(step, rest);
    out.push(n);
    rest -= n;
  }
  return out;
}

/** 需要用户操作几轮（= 批次数量），用于提前告知「要选几次」 */
export function batchRounds(left: number, per = PICK_PER_BATCH): number {
  return planPhotoBatches(left, per).length;
}
