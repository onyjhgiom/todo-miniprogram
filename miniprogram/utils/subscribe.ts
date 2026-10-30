// utils/subscribe.ts
// 微信订阅消息统一封装：授权请求 + 服务端推送（失败静默降级本地）。
//
// 设计要点：
//  1) requestSubscribe 只负责「请求用户授权一次」，返回精确状态（accept/reject/ban/empty/fail）；
//     调用方据此持久化授权标记，绝不假设「授权一次永久推送」。
//  2) 微信订阅消息只能由「服务端」推送（云函数 subscribeMessage.send），前端无法推送；
//     pushReminder 封装对云函数 pushReminder 的调用，失败（用户失效/模板无效）由调用方降级本地。
//  3) 一次性订阅：授权后仅在有效期内可推送 1 条；周期性提醒需在每轮用户交互时重新授权续期。
import { callFn } from './cloud';

/**
 * 订阅模板 ID：在「微信 MP 后台 → 功能 → 订阅消息 → 我的模板」申请
 * 「待办提醒 / 事项提醒」类目模板后填入。为空则订阅功能不可用
 * （前端不弹授权、仅本地提醒，避免 requestSubscribeMessage 报 tmplIds 空）。
 *
 * 当前模板：T4UwrfCq5J94JYAG1zucDiLN_OBvZeb58LNpfkHKnsg（日程提醒）
 * 关键词与字段的真实对应（见模板详情 {{xxx.DATA}}，序号不连续也不按类型排序）：
 *   提醒内容→thing2  到期时间→date9  开始时间→time6  截止时间→time38  提醒时间→time30
 * 云函数 pushReminder / todos.remind 的 KEY_MAP 已按此校准，换模板时必须同步改。
 */
export const SUB_TMPL_ID = 'T4UwrfCq5J94JYAG1zucDiLN_OBvZeb58LNpfkHKnsg';

/**
 * 订阅消息投递到的「小程序版本」——最容易被忽略的坑：
 * 小程序还没发布正式版时，发到 formal 用户永远收不到消息（云函数返回 success 但无感知）。
 *   developer = 开发版（开发者工具预览 / 真机调试，开发者本人可收）
 *   trial     = 体验版（需先把用户在「成员管理 → 体验成员」里加白名单）
 *   formal    = 正式版（已提交审核并发布）
 * 官方文档：`miniprogram_state` 省略时**默认 formal**，且需基础库 2.8.2+。
 *
 * 【配置位置】本常量是「前端强制覆盖」，默认 undefined —— 表示不传该字段，
 * 由云函数 pushReminder / todos 读取环境变量 `MP_STATE` 决定（缺省 'trial'）。
 * 之所以默认不传：前端一旦传值就会**盖掉**云函数环境变量，
 * 导致每次切换测试环境都要改代码 + 重传小程序。
 * 现在只需在「云开发控制台 → 云函数 → 配置 → 环境变量」给 todos 与 pushReminder
 * 两个函数各设一个 MP_STATE 即可立刻生效，前后端不必同步改。
 *
 * 仅在需要临时压过云端配置时才在此填 'developer' | 'trial' | 'formal'。
 */
export const MP_STATE: 'developer' | 'trial' | 'formal' | undefined = undefined;

export type SubState = 'accept' | 'reject' | 'ban' | 'empty' | 'fail';

/**
 * 请求用户授权订阅消息（手动触发，如点击「开启微信通知」）。
 * 返回授权结果状态，便于调用方做差异化处理：
 *  - accept：用户同意，可推送（有效期/次数受限）
 *  - reject：用户本次拒绝
 *  - ban：被微信后台封禁（多次拒绝/模板违规），不应再弹
 *  - empty：模板未配置，根本不该弹授权
 *  - fail：调起失败（用户取消/基础库过低）
 */
export function requestSubscribe(tmplId: string = SUB_TMPL_ID): Promise<SubState> {
  if (!tmplId) return Promise.resolve('empty');
  return new Promise<SubState>((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res: Record<string, 'accept' | 'reject' | 'ban'>) => {
        const s = res[tmplId];
        if (s === 'accept') resolve('accept');
        else if (s === 'ban') resolve('ban');
        else resolve('reject');
      },
      fail: () => resolve('fail')
    });
  });
}

export interface PushResult {
  ok: boolean;
  /** 服务端返回的错误码（如 43101=用户拒绝/未授权，NO_QUOTA=配额用尽，47003=模板无效） */
  code?: string;
}

/**
 * 把「用户已授权」写到云端 user_subs —— 这是服务端能推送的前提，漏了整条链路就是死的。
 *
 * 【为什么必须单独调】wx.requestSubscribeMessage 成功只代表用户点了「允许」，
 * 微信**不会**主动把这件事告诉你的服务端；云函数 send() 靠查 user_subs 判断能否推送。
 * 不调本函数 → 云端永远查不到授权 → 每次推送都返回 NO_QUOTA，用户觉得"授权了却收不到"。
 *
 * 【重复调用 = 配额 +1】一次性订阅的次数是累积的（点 N 次可推 N 条），
 * 所以每次用户在 UI 上点「开启微信通知」都应调用本函数续期，而不是只在首次调用。
 */
export async function grantSubscription(tmplId: string = SUB_TMPL_ID): Promise<boolean> {
  if (!tmplId) return false;
  try {
    const r = await callFn<{ success: boolean }>('pushReminder', { action: 'grant', tmplId });
    return !!(r && r.success);
  } catch {
    return false;
  }
}

/**
 * 派发一条订阅消息到服务端（云函数 pushReminder 内部调 subscribeMessage.send）。
 * 仅当订阅授权有效时由调度器调用；失败由调用方负责清除 subscribed 标记并降级本地。
 */
export async function pushReminder(payload: {
  tmplId: string;
  todoId?: string;
  title: string;
  desc?: string;
  at: number;
  /** 事项截止时间（待办 dueDate，ms）；缺省时云函数用 at 兜底填充「到期/截止」字段 */
  due?: number;
  /** 用户点击通知后跳转的页面路径（不带前导斜杠） */
  page?: string;
  /** 覆盖目标版本；一般不用传，交由云函数按环境变量 MP_STATE 决定 */
  mpState?: 'developer' | 'trial' | 'formal';
}): Promise<PushResult> {
  try {
    // 【关键】只在调用方「显式」传了 mpState 时才带上该字段。
    // 若默认塞 MP_STATE，会盖掉云函数的环境变量 —— 那样测试期每换一次版本
    // （开发版↔体验版↔正式版）都得改前端代码重传，极易漏改导致「云函数返回 success 但收不到」。
    const state = payload.mpState || MP_STATE;
    const req: Record<string, unknown> = { ...payload };
    if (state) req.mpState = state;
    else delete req.mpState; // 交给云函数环境变量
    const r = await callFn<{ success: boolean; code?: string }>('pushReminder', req);
    if (r && r.success) return { ok: true };
    return { ok: false, code: (r && r.code) || 'unknown' };
  } catch (e: unknown) {
    const err = (e || {}) as { code?: unknown; errCode?: unknown; errMsg?: string };
    const raw = err.code ?? err.errCode ?? (err.errMsg || '');
    return { ok: false, code: typeof raw === 'string' ? raw : 'net' };
  }
}

/** 截断订阅消息内容（模板关键词字段对长度敏感，超长会被服务端拒收） */
export function clip(text: string, max: number): string {
  const t = (text || '').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
