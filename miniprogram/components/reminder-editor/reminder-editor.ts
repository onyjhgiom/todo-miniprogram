// components/reminder-editor/reminder-editor.ts
import type { IReminder } from '../../types/index';
import { SUB_TMPL_ID, requestSubscribe, grantSubscription } from '../../utils/subscribe';

type RepeatType = NonNullable<IReminder['repeat']>;
type MethodType = NonNullable<IReminder['method']>;

interface DisplayItem {
  id: string;
  at: number;
  sent?: boolean;
  label: string;
  repeat: RepeatType;
  method: MethodType;
  repeatIndex: number;
  methodIndex: number;
}

const REPEAT_OPTIONS: Array<{ key: RepeatType; label: string }> = [
  { key: 'none', label: '不重复' },
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
  { key: 'yearly', label: '每年' }
];

const METHOD_OPTIONS: Array<{ key: MethodType; label: string }> = [
  { key: 'toast', label: '通知条' },
  { key: 'modal', label: '弹窗' }
];

function pad(n: number) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatLabel(at: number) {
  const d = new Date(at);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function indexOfKey(list: Array<{ key: string }>, key: string | undefined): number {
  const i = list.findIndex((o) => o.key === (key || list[0].key));
  return i >= 0 ? i : 0;
}

Component({
  properties: {
    items: { type: Array, value: [] as IReminder[] }
  },
  data: {
    // 注意：不可与 properties.items 同名（否则被属性覆盖，触发告警）
    list: [] as DisplayItem[],
    repeatLabels: REPEAT_OPTIONS.map((o) => o.label),
    methodLabels: METHOD_OPTIONS.map((o) => o.label),
    dateRange: [] as string[][],
    /** 是否已授权微信订阅消息（该待办任一提醒项授权即为已开启） */
    subOn: false,
    /** 模板是否已配置（未配置时不弹授权，避免 requestSubscribeMessage 报错） */
    tmplReady: SUB_TMPL_ID.length > 0,
    /** 授权请求进行中，防连点 */
    subBusy: false
  },
  observers: {
    'items': function (raw: IReminder[]) {
      // 准备 picker 数据：日期（今天 + 60 天）+ 时分（00-23 / 00-59）
      const dates: string[] = [];
      const now = new Date();
      for (let i = 0; i < 60; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      }
      const hours = Array.from({ length: 24 }, (_, i) => `${pad(i)}时`);
      const minutes = Array.from({ length: 60 }, (_, i) => `${pad(i)}分`);
      const list = raw || [];
      const display = list.map((r) => {
        const d = new Date(r.at);
        const repeat = (r.repeat || 'none') as RepeatType;
        const method = (r.method || 'toast') as MethodType;
        return {
          id: r.id,
          at: r.at,
          sent: r.sent,
          label: formatLabel(r.at),
          repeat,
          method,
          repeatIndex: indexOfKey(REPEAT_OPTIONS, repeat),
          methodIndex: indexOfKey(METHOD_OPTIONS, method)
        };
      });
      this.setData({
        list: display,
        dateRange: [dates, hours, minutes],
        subOn: list.some((r) => r.subscribed === true)
      });
    }
  },
  methods: {
    dateValueOf(item: DisplayItem) {
      const dates = this.data.dateRange[0] || [];
      const hours = this.data.dateRange[1] || [];
      const minutes = this.data.dateRange[2] || [];
      const di = Math.max(0, dates.indexOf(`${new Date(item.at).getFullYear()}-${pad(new Date(item.at).getMonth() + 1)}-${pad(new Date(item.at).getDate())}`));
      const h = new Date(item.at).getHours();
      const m = new Date(item.at).getMinutes();
      const hi = Math.max(0, hours.indexOf(`${pad(h)}时`));
      const mi = Math.max(0, minutes.indexOf(`${pad(m)}分`));
      return [di, hi, mi];
    },
    onAdd() {
      // 默认添加 1 小时后，通知条 + 不重复
      const at = Date.now() + 3600000;
      const newItem: IReminder = {
        id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        at,
        sent: false,
        channel: 'app',
        repeat: 'none',
        method: 'toast'
      };
      const next = [...(this.properties.items || []), newItem];
      this.triggerEvent('change', { items: next });
    },
    onItemChange(e: WechatMiniprogram.PickerChangeEvent) {
      const idx = e.currentTarget.dataset.index as number;
      const [di, hi, mi] = e.detail.value as unknown as number[];
      const dates = this.data.dateRange[0] || [];
      const hours = this.data.dateRange[1] || [];
      const minutes = this.data.dateRange[2] || [];
      const dateStr = dates[di] || todayStr();
      const hourStr = (hours[hi] || '08时').replace('时', '');
      const minuteStr = (minutes[mi] || '00分').replace('分', '');
      const at = new Date(`${dateStr}T${hourStr}:${minuteStr}:00`).getTime();
      const next = (this.properties.items || []).slice();
      const target = next[idx];
      if (target) {
        next[idx] = { ...target, at, sent: false };
        this.triggerEvent('change', { items: next });
      }
    },
    onRepeatChange(e: WechatMiniprogram.PickerChangeEvent) {
      const idx = e.currentTarget.dataset.index as number;
      const value = Number(e.detail.value);
      const repeat = (REPEAT_OPTIONS[value] || REPEAT_OPTIONS[0]).key;
      const next = (this.properties.items || []).slice();
      const target = next[idx];
      if (target) {
        next[idx] = { ...target, repeat };
        this.triggerEvent('change', { items: next });
      }
    },
    onMethodChange(e: WechatMiniprogram.PickerChangeEvent) {
      const idx = e.currentTarget.dataset.index as number;
      const value = Number(e.detail.value);
      const method = (METHOD_OPTIONS[value] || METHOD_OPTIONS[0]).key;
      const next = (this.properties.items || []).slice();
      const target = next[idx];
      if (target) {
        next[idx] = { ...target, method };
        this.triggerEvent('change', { items: next });
      }
    },
    onItemRemove(e: WechatMiniprogram.TouchEvent) {
      const idx = e.currentTarget.dataset.index as number;
      const next = (this.properties.items || []).slice();
      next.splice(idx, 1);
      this.triggerEvent('change', { items: next });
    },

    /**
     * 开启 / 关闭微信订阅消息通知（待办到期提醒的授权入口）。
     * 开启：requestSubscribeMessage 拿授权 → 调云函数 grant 写 user_subs → 本地标记 subscribed
     *       （微信侧不会通知服务端，这一步漏掉就会「授权了却永远收不到」）
     * 关闭：仅清本地 subscribed 标记，云端配额保留，不影响其它提醒。
     */
    async onToggleSubscribe() {
      if (this.data.subBusy) return;
      const items = this.properties.items || [];
      if (items.length === 0) {
        wx.showToast({ title: '请先添加提醒时间', icon: 'none' });
        return;
      }
      if (this.data.subOn) {
        const next = items.map((i) => ({ ...i, subscribed: false }));
        this.triggerEvent('change', { items: next });
        wx.showToast({ title: '已关闭微信通知', icon: 'none' });
        return;
      }
      if (!SUB_TMPL_ID) {
        wx.showModal({
          title: '尚未配置订阅模板',
          content: '请在微信 MP 后台「功能 → 订阅消息 → 我的模板」添加提醒类模板，并把模板 ID 填入代码 SUB_TMPL_ID（utils/subscribe.ts）。配置后即可在微信聊天列表收到待办到期的服务通知。',
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
      this.setData({ subBusy: true });
      try {
        const state = await requestSubscribe(SUB_TMPL_ID);
        if (state !== 'accept') {
          wx.showToast({
            title:
              state === 'reject' ? '未开启，仅本机提醒' : state === 'ban' ? '订阅功能受限，仅本机提醒' : '授权失败，仅本机提醒',
            icon: 'none'
          });
          return;
        }
        // 关键：把授权同步到云端 user_subs，否则云函数 send() 查不到记录 → 推送恒失败
        const granted = await grantSubscription(SUB_TMPL_ID);
        const next = items.map((i) => ({ ...i, subscribed: true, grantedAt: Date.now() }));
        this.triggerEvent('change', { items: next });
        wx.showToast({
          title: granted ? '已开启微信通知' : '已开启（云端同步失败，将仅本机通知）',
          icon: 'none'
        });
      } finally {
        this.setData({ subBusy: false });
      }
    }
  }
});
