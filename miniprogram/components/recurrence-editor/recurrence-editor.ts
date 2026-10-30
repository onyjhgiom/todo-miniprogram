// components/recurrence-editor/recurrence-editor.ts
import type { IRecurrence } from '../../types/index';

interface RecurType { key: IRecurrence['type']; label: string }
interface Weekday { value: number; label: string }

const TYPES: RecurType[] = [
  { key: 'none', label: '不重复' },
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
  { key: 'custom', label: '自定义' }
];
const WEEKDAYS: Weekday[] = [
  { value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' },
  { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' },
  { value: 7, label: '日' }
];

Component({
  properties: {
    value: { type: Object, value: null as IRecurrence | null }
  },
  data: {
    types: TYPES,
    weekdays: WEEKDAYS,
    type: 'none' as IRecurrence['type'],
    interval: 1,
    intervalUnit: '天',
    selectedWeekdays: [] as number[],
    endDateStr: ''
  },
  observers: {
    'value': function (v: IRecurrence | null | undefined) {
      if (!v || !v.type) return;
      this.setData({
        type: v.type,
        interval: v.interval || 1,
        intervalUnit: v.type === 'weekly' ? '周' : v.type === 'monthly' ? '月' : '天',
        selectedWeekdays: v.weekdays || [],
        endDateStr: v.endDate ? this.formatYMD(v.endDate) : ''
      });
    }
  },
  methods: {
    formatYMD(ts: number) {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    emitChange(extra: Partial<IRecurrence> = {}) {
      const recur: IRecurrence = {
        type: this.data.type,
        ...extra
      };
      if (recur.type === 'custom') recur.interval = Math.max(1, this.data.interval);
      if (recur.type === 'weekly' && this.data.selectedWeekdays.length > 0) recur.weekdays = this.data.selectedWeekdays.slice();
      if (this.data.endDateStr) {
        const ts = new Date(this.data.endDateStr + 'T23:59:59').getTime();
        recur.endDate = ts;
      } else {
        recur.endDate = null;
      }
      this.triggerEvent('change', { value: recur });
    },
    onTypeChange(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as IRecurrence['type'];
      this.setData({
        type: key,
        intervalUnit: key === 'weekly' ? '周' : key === 'monthly' ? '月' : '天'
      });
      this.emitChange();
    },
    onIntervalChange(e: WechatMiniprogram.InputEvent) {
      const v = parseInt(e.detail.value, 10) || 1;
      this.setData({ interval: v });
      this.emitChange();
    },
    onWeekdayToggle(e: WechatMiniprogram.TouchEvent) {
      const value = e.currentTarget.dataset.value as number;
      const cur = this.data.selectedWeekdays.slice();
      const idx = cur.indexOf(value);
      if (idx >= 0) cur.splice(idx, 1); else cur.push(value);
      cur.sort((a, b) => a - b);
      this.setData({ selectedWeekdays: cur });
      this.emitChange();
    },
    onEndDateChange(e: WechatMiniprogram.PickerChangeEvent) {
      this.setData({ endDateStr: e.detail.value as string });
      this.emitChange();
    },
    onEndDateClear() {
      this.setData({ endDateStr: '' });
      this.emitChange();
    }
  }
});