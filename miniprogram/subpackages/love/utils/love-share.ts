// utils/love-share.ts
// 共享与同步 · 配对码 + 云端同步 + 离线快照兜底
//
// 【为什么必须有离线兜底】
//  云函数没部署、云开发没开、断网——这三种情况在真实使用中都会发生。
//  如果共享只依赖云端，那用户点了「同步」就是转圈然后失败，体验极差。
//  所以这里做双通道：
//   通道 A（在线）：云函数 love 的 pair/push/pull，双方用同一个 6 位房间号双向同步；
//   通道 B（离线）：把数据打包成一段文本/二维码，通过微信发给对方，对方粘贴导入。
//  两条通道共用同一个「快照」结构与同一套合并策略（见 applySnapshot），
//  所以无论走哪条，结果一致。
//
// 【合并原则】私密数据不被动覆盖：本地已有内容优先，只补空缺字段；
//  互动/回忆/礼物按 id 去重合并，双方各自记录的内容都会保留。
import { callFn } from '../../../utils/cloud';
import {
  getShare, setShare, buildSnapshot, applySnapshot, loadInteractions
} from './love-store';
import type { LoveSnapshot } from './love-types';

/* ============================ 配对码 ============================ */

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉 I L O 0 1，避免抄错

export function makeRoomCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function validRoomCode(code: string): boolean {
  return /^[A-Z2-9]{6}$/.test((code || '').toUpperCase().trim());
}

/* ============================ 云端探测 ============================ */

/**
 * 探测云函数是否真的可用。
 *
 * ⚠️ 关键：callFn 在云函数「未部署」时**不会抛错**——它会被 cloud.ts 降级到 mock，
 * 返回一个 success:false 的占位结果。所以绝不能「没抛错就当可用」，
 * 必须确认返回了真实的业务字段（这里是 ok:true），否则后续每次同步都会白跑一趟。
 */
export async function probeCloud(): Promise<boolean> {
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'probe' });
    const r = (res || {}) as { ok?: boolean; success?: boolean };
    const ok = r.ok === true || (r.success === true && r.ok !== false);
    setShare({ cloudOn: ok, lastMsg: ok ? '云端已连接' : '云端未部署，已切换到离线同步' });
    return ok;
  } catch (e) {
    setShare({ cloudOn: false, lastMsg: '云端不可用，已切换到离线同步' });
    return false;
  }
}

/* ============================ 在线同步 ============================ */

export interface SyncResult {
  ok: boolean;
  msg: string;
  /** 本次拉到的新增条数 */
  added?: number;
}

/** 创建/加入房间 */
export async function pair(room: string, role: 'me' | 'him'): Promise<SyncResult> {
  const code = (room || '').toUpperCase().trim();
  if (!validRoomCode(code)) return { ok: false, msg: '房间号是 6 位字母数字组合' };
  const ok = await probeCloud();
  if (!ok) {
    // 云端不可用也要让本地配对生效——至少导出/导入能跑通
    setShare({ room: code, role, bound: true, lastMsg: '已配对（离线模式，请用导出/导入同步）' });
    return { ok: true, msg: '已配对，当前为离线模式，用导出/导入同步数据' };
  }
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'pair', room: code, role });
    const r = (res || {}) as { ok?: boolean; error?: string };
    if (r.ok) {
      setShare({ room: code, role, bound: true, lastMsg: '配对成功' });
      return { ok: true, msg: '配对成功！现在可以同步了' };
    }
    return { ok: false, msg: r.error || '配对失败，请检查房间号' };
  } catch (e) {
    setShare({ room: code, role, bound: true, lastMsg: '配对超时，已切离线模式' });
    return { ok: false, msg: '云端连接失败，已切到离线模式' };
  }
}

/** 上传本地快照 */
export async function push(): Promise<SyncResult> {
  const s = getShare();
  if (!s.room) return { ok: false, msg: '还没创建房间，先生成一个配对码' };
  const snap = buildSnapshot(s.room, s.role);
  const ok = await probeCloud();
  if (!ok) return { ok: false, msg: '云端不可用，请用「导出」把数据发给对方' };
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'push', room: s.room, role: s.role, snapshot: snap });
    const r = (res || {}) as { ok?: boolean; error?: string };
    if (r.ok) {
      setShare({ lastSync: Date.now(), lastMsg: `已上传（互动 ${(snap.interactions || []).length} 条）` });
      return { ok: true, msg: '已上传，让对方点「拉取」就能看到' };
    }
    return { ok: false, msg: r.error || '上传失败' };
  } catch (e) {
    return { ok: false, msg: '上传超时，请稍后再试' };
  }
}

/** 拉取对方快照 */
export async function pull(): Promise<SyncResult> {
  const s = getShare();
  if (!s.room) return { ok: false, msg: '还没配对' };
  const ok = await probeCloud();
  if (!ok) return { ok: false, msg: '云端不可用，请用「导入」粘贴对方发来的数据' };
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'pull', room: s.room, role: s.role });
    const r = (res || {}) as { ok?: boolean; snapshot?: LoveSnapshot; error?: string };
    if (r.ok && r.snapshot) {
      const out = applySnapshot(r.snapshot);
      setShare({ lastSync: Date.now(), lastMsg: `已同步：互动 +${out.interaction} 回忆 +${out.memory} 礼物 +${out.gift}` });
      return {
        ok: true,
        msg: `同步完成：互动 +${out.interaction}，回忆 +${out.memory}，礼物 +${out.gift}`,
        added: out.interaction + out.memory + out.gift
      };
    }
    return { ok: false, msg: r.error || '对方还没有上传过数据' };
  } catch (e) {
    return { ok: false, msg: '拉取超时，请稍后再试' };
  }
}

/* ============================ 离线通道：导出 / 导入 ============================ */

/** 生成可发送的快照文本 */
export function exportText(): { text: string; size: string } {
  const s = getShare();
  const room = s.room || makeRoomCode();
  if (!s.room) setShare({ room });
  const snap = buildSnapshot(room, s.role);
  const text = JSON.stringify(snap);
  return { text, size: `${(text.length / 1024).toFixed(1)} KB` };
}

/** 复制到剪贴板（微信里直接粘贴给对方） */
export function copySnapshot(): Promise<{ text: string; size: string }> {
  const { text, size } = exportText();
  return new Promise((resolve) => {
    try {
      wx.setClipboardData({
        data: text,
        success: () => resolve({ text, size }),
        fail: () => resolve({ text, size })
      });
    } catch (e) {
      resolve({ text, size });
    }
  });
}

/** 解析并应用一段快照文本 */
export function importText(text: string): { ok: boolean; msg: string } {
  if (!text || !text.trim()) return { ok: false, msg: '内容为空' };
  let snap: LoveSnapshot;
  try {
    snap = JSON.parse(text) as LoveSnapshot;
  } catch (e) {
    return { ok: false, msg: '格式不对，请确认粘贴的是完整的同步文本' };
  }
  if (!snap || snap.v !== 1) return { ok: false, msg: '不是爱遇小栈的同步数据' };
  const out = applySnapshot(snap);
  const s = getShare();
  // 导入即视为完成一次配对：把房间号对齐，方便后续双向同步
  if (snap.room && snap.room !== s.room) setShare({ room: snap.room, bound: true });
  else if (!s.bound) setShare({ bound: true });
  setShare({ lastSync: Date.now(), lastMsg: `导入成功：互动 +${out.interaction} 回忆 +${out.memory} 礼物 +${out.gift}` });
  return {
    ok: true,
    msg: `导入成功：互动 +${out.interaction}，回忆 +${out.memory}，礼物 +${out.gift}${out.relation ? '，档案已合并' : ''}`
  };
}

/** 从剪贴板导入 */
export function importFromClipboard(): Promise<{ ok: boolean; msg: string }> {
  return new Promise((resolve) => {
    try {
      // 项目自带的 wx 类型声明里没有 getClipboardData（只有 setClipboardData），
      // 这里按运行时存在性判断后调用，避免为一行调用去改全局声明。
      const w = wx as unknown as {
        getClipboardData?: (o: { success?: (r: { data?: string }) => void; fail?: () => void }) => void;
      };
      if (typeof w.getClipboardData !== 'function') {
        resolve({ ok: false, msg: '当前环境不支持读取剪贴板，请长按粘贴' });
        return;
      }
      w.getClipboardData({
        success: (r: { data?: string }) => resolve(importText((r && r.data) || '')),
        fail: () => resolve({ ok: false, msg: '读取剪贴板失败，请长按粘贴' })
      });
    } catch (e) {
      resolve({ ok: false, msg: '读取剪贴板失败' });
    }
  });
}

/* ============================ 同步状态展示 ============================ */

export interface ShareView {
  room: string;
  bound: boolean;
  cloudOn: boolean;
  roleText: string;
  lastSyncText: string;
  lastMsg: string;
  /** 本地条数概览 */
  counts: { interaction: number; memory: number; gift: number };
  /** 通道建议 */
  channelText: string;
}

export function shareView(): ShareView {
  const s = getShare();
  const counts = {
    interaction: loadInteractions().length,
    memory: 0,
    gift: 0
  };
  try {
    // 避免在 shareView 里再引一次 store 函数造成循环，这里直接读
    const mem = wx.getStorageSync('love_memories_v1');
    const gft = wx.getStorageSync('love_gifts_v1');
    counts.memory = Array.isArray(mem) ? mem.length : 0;
    counts.gift = Array.isArray(gft) ? gft.length : 0;
  } catch (e) { /* 忽略 */ }

  let lastSyncText = '从未同步';
  if (s.lastSync) {
    const d = new Date(s.lastSync);
    const p = (n: number) => (n < 10 ? '0' + n : '' + n);
    lastSyncText = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  return {
    room: s.room || '',
    bound: s.bound,
    cloudOn: s.cloudOn,
    roleText: s.role === 'him' ? '我是「他」' : '我是「我」',
    lastSyncText,
    lastMsg: s.lastMsg || '',
    counts,
    channelText: s.cloudOn
      ? '云端已连接：直接用「上传 / 拉取」同步'
      : '云端未连接：用「导出 → 微信发给对方 → 对方导入」同步，效果一样'
  };
}
