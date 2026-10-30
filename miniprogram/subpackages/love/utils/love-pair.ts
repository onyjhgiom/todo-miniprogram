// utils/love-pair.ts
// 情侣绑定 · 邀请码配对 / 解除 / 重新绑定
//
// 【和旧「房间号配对」的关系】
//  旧的 love-share 用 6 位房间号做快照同步，它依然保留、继续可用；
//  这里的新绑定是**唯一的关系真相源**：绑定成功后会把 pairId 写回 ShareState.room，
//  让旧的快照同步也走同一个关系，避免用户看到两套配对入口。
//
// 【降级原则】绑定本身必须有服务端（两个人要认识彼此），所以云端不可用时明确告知，
//  但不影响任何单人功能——未绑定时全部双人页面走「仅自己可见」的本地模式。
import { callFn } from '../../../utils/cloud';
import { getRelation } from './love-store';

export type PairStatus = 'none' | 'pending' | 'bound' | 'broken';
export type DuoRole = 'me' | 'him';

export interface PairState {
  /** 云端关系 ID；空串=从未绑定 */
  pairId: string;
  /** 邀请码（待配对时展示给别人扫） */
  code: string;
  /** 本机在关系中的角色：me=创建者，him=加入者 */
  role: DuoRole;
  status: PairStatus;
  /** 对方昵称 */
  partnerName: string;
  /** 我的昵称（同步给对方展示） */
  myName: string;
  boundAt: number;
  updatedAt: number;
  /** 云端是否真的可用（探测成功才置 true） */
  cloudOn: boolean;
  /** 最近一次操作的说明 */
  lastMsg: string;
}

const K_PAIR = 'love_pair_v1';

function def(): PairState {
  return {
    pairId: '', code: '', role: 'me', status: 'none',
    partnerName: '', myName: '', boundAt: 0, updatedAt: 0,
    cloudOn: false, lastMsg: ''
  };
}

export function getPair(): PairState {
  let s: PairState | null = null;
  try {
    s = wx.getStorageSync(K_PAIR) as PairState | '';
  } catch (e) { /* 忽略 */ }
  return Object.assign(def(), s || {});
}

export function setPair(patch: Partial<PairState>): PairState {
  const next = Object.assign(getPair(), patch, { updatedAt: Date.now() });
  try { wx.setStorageSync(K_PAIR, next); } catch (e) { /* 忽略 */ }
  return next;
}

export function isBound(): boolean {
  const p = getPair();
  return !!p.pairId && p.status === 'bound';
}

/** 对方展示名：优先用绑定时同步来的昵称，没有就退回关系档案里的「他/她」 */
export function partnerName(): string {
  const p = getPair();
  if (p.partnerName) return p.partnerName;
  try {
    return getRelation().him.nickname || 'TA';
  } catch (e) {
    return 'TA';
  }
}

export function myName(): string {
  const p = getPair();
  if (p.myName) return p.myName;
  try {
    return getRelation().me.nickname || '我';
  } catch (e) {
    return '我';
  }
}

export function myRole(): DuoRole {
  return getPair().role === 'him' ? 'him' : 'me';
}

/* ============================ 云端探测 ============================ */

/**
 * 探测云函数是否真的可用。
 * ⚠️ callFn 在云函数未部署时不会抛错（会被 cloud.ts 降级到 mock），
 * 所以必须确认返回了 ok:true，不能「没抛错就当可用」。
 */
export async function probeCloud(): Promise<boolean> {
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'probe' });
    const r = (res || {}) as { ok?: boolean; success?: boolean };
    const on = r.ok === true || (r.success === true && r.ok !== false);
    setPair({ cloudOn: on });
    return on;
  } catch (e) {
    setPair({ cloudOn: false });
    return false;
  }
}

/* ============================ 绑定动作 ============================ */

export interface PairResult {
  ok: boolean;
  msg: string;
  /** 是否要求用户确认「把已有本地内容上传到双人空间」 */
  needUploadConfirm?: boolean;
}

/** 生成邀请码（我已经在关系里则复用/续期） */
export async function createInvite(): Promise<PairResult> {
  if (!(await probeCloud())) {
    setPair({ lastMsg: '云端未连接' });
    return { ok: false, msg: '云端未连接，暂时无法邀请对方；单人功能不受影响' };
  }
  try {
    const res = await callFn<Record<string, unknown>>('love', {
      action: 'pair.create', name: myName()
    });
    const r = (res || {}) as { ok?: boolean; error?: string; pairId?: string; code?: string; role?: DuoRole; bound?: boolean };
    if (!r.ok) return { ok: false, msg: r.error || '生成失败，请稍后再试' };
    setPair({
      pairId: r.pairId || '', code: r.code || '', role: r.role || 'me',
      status: r.bound ? 'bound' : 'pending',
      boundAt: r.bound ? Date.now() : 0,
      cloudOn: true, lastMsg: '邀请码已生成'
    });
    return { ok: true, msg: '邀请码已生成，发给 TA 就能配对' };
  } catch (e) {
    return { ok: false, msg: '网络异常，请稍后再试' };
  }
}

/** 刷新邀请码（待配对状态下换一个） */
export async function refreshCode(): Promise<PairResult> {
  const p = getPair();
  if (!p.pairId) return { ok: false, msg: '还没有创建关系' };
  if (!(await probeCloud())) return { ok: false, msg: '云端未连接' };
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'pair.code', pairId: p.pairId });
    const r = (res || {}) as { ok?: boolean; error?: string; code?: string };
    if (!r.ok) return { ok: false, msg: r.error || '刷新失败' };
    setPair({ code: r.code || '' });
    return { ok: true, msg: '已生成新邀请码' };
  } catch (e) {
    return { ok: false, msg: '网络异常' };
  }
}

/** 用对方的邀请码配对 */
export async function joinByCode(code: string): Promise<PairResult> {
  const c = (code || '').toUpperCase().trim();
  if (!/^[A-Z2-9]{6}$/.test(c)) return { ok: false, msg: '邀请码是 6 位字母数字组合' };
  if (!(await probeCloud())) return { ok: false, msg: '云端未连接，暂时无法配对' };
  try {
    const res = await callFn<Record<string, unknown>>('love', {
      action: 'pair.join', code: c, name: myName()
    });
    const r = (res || {}) as {
      ok?: boolean; error?: string; pairId?: string; role?: DuoRole; bound?: boolean; restored?: boolean;
    };
    if (!r.ok) return { ok: false, msg: r.error || '配对失败' };
    setPair({
      pairId: r.pairId || '', role: r.role || 'him',
      status: r.bound ? 'bound' : 'pending',
      boundAt: r.bound ? Date.now() : 0,
      code: '', cloudOn: true,
      lastMsg: r.restored ? '重新绑定成功，旧内容已恢复' : '配对成功'
    });
    return {
      ok: true,
      msg: r.restored ? '重新绑定成功，之前的双人内容已恢复' : '配对成功，你们现在是绑定的一对啦',
      needUploadConfirm: true
    };
  } catch (e) {
    return { ok: false, msg: '网络异常，请稍后再试' };
  }
}

/**
 * 查询关系状态。
 * 每次进双人空间都调：对方可能已经单方面解除绑定，本地状态必须跟着失效，
 * 否则会出现「本地显示已绑定，但内容其实同步不出去」的假象。
 */
export async function refreshStatus(): Promise<PairState> {
  const p = getPair();
  if (!p.pairId) return p;
  if (!(await probeCloud())) return p; // 云端不可用：保持本地状态，按已绑定走本地模式
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'pair.status', pairId: p.pairId });
    const r = (res || {}) as {
      ok?: boolean; bound?: boolean; status?: string; role?: DuoRole;
      partner?: { name?: string } | null;
    };
    if (!r.ok) return p;
    if (r.status === 'broken' || r.status === 'none' || !r.bound) {
      return setPair({
        status: 'broken', pairId: '', code: '', boundAt: 0, lastMsg: '关系已解除'
      });
    }
    return setPair({
      status: 'bound',
      role: r.role || p.role,
      partnerName: (r.partner && r.partner.name) || p.partnerName,
      cloudOn: true
    });
  } catch (e) {
    return p;
  }
}

/** 解除绑定：本地保留历史内容（不再同步），关系断开 */
export async function leavePair(): Promise<PairResult> {
  const p = getPair();
  if (!p.pairId) return { ok: false, msg: '当前没有绑定关系' };
  if (!(await probeCloud())) return { ok: false, msg: '云端未连接，无法解除' };
  try {
    const res = await callFn<Record<string, unknown>>('love', { action: 'pair.leave', pairId: p.pairId });
    const r = (res || {}) as { ok?: boolean; error?: string };
    if (!r.ok) return { ok: false, msg: r.error || '解除失败' };
    // 只断关系，不清本地内容：用户可以自己决定要不要删，避免误操作丢数据
    setPair({ status: 'broken', pairId: '', code: '', boundAt: 0, lastMsg: '已解除绑定' });
    return { ok: true, msg: '已解除绑定，双人内容停止同步（本地历史仍保留）' };
  } catch (e) {
    return { ok: false, msg: '网络异常，请稍后再试' };
  }
}

/** 修改自己在对方面前显示的名字 */
export async function renameSelf(name: string): Promise<PairResult> {
  const p = getPair();
  const n = (name || '').trim().slice(0, 20);
  setPair({ myName: n });
  if (!p.pairId || !(await probeCloud())) return { ok: true, msg: '已保存' };
  try {
    await callFn('love', { action: 'pair.rename', pairId: p.pairId, name: n });
  } catch (e) { /* 静默：名字不同步不影响使用 */ }
  return { ok: true, msg: '已保存' };
}
