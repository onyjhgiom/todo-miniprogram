// subpackages/tools/pages/wheel/history.ts
// 万能转盘 · 历史记录页：抽奖流水 + 次数统计
//
// 两种视图：
//   list —— 每次抽奖的时间 / 转盘名 / 结果 / 选项池快照（删除转盘后标记「已删除的转盘」）；
//   stat —— 每个选项被抽中的次数条形图，并给出「权重期望占比」做对照，
//           让用户看出「其实每次都是它在赢」是不是错觉。

import { getThemeState, syncNavBar } from '../../../../utils/theme';
import { toast } from '../../../../utils/cloud';
import { go, back } from '../../../../utils/nav';
import * as todoStore from '../../../../utils/todo-store';
import * as store from '../../utils/wheel-store';
import { inkOn } from '../../utils/wheel-canvas';
import type { IWheelOption } from '../../utils/wheel-store';
import type { ThemeKey } from '../../../../types/index';

let wheelId = '';

interface IRecordVM {
  id: string;
  time: string;
  wheelName: string;
  deleted: boolean;
  result: string;
  resultIcon: string;
  color: string;
  ink: string;
  pool: string;
}

interface IStatVM {
  text: string;
  icon: string;
  color: string;
  count: number;
  /** 条形宽度百分比 */
  width: number;
  ratio: string;
  expect: string;
  /** 实际明显高于期望时给出提示 */
  hot: boolean;
}

interface IHistoryData {
  theme: ThemeKey;
  themeStyle: string;
  mode: 'list' | 'stat';
  filters: { key: string; label: string }[];
  activeFilter: string;
  records: IRecordVM[];
  stats: IStatVM[];
  total: number;
  statTotal: number;
  empty: boolean;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page<IHistoryData>({
  data: {
    theme: 'light',
    themeStyle: '',
    mode: 'list',
    filters: [{ key: '', label: '全部' }],
    activeFilter: '',
    records: [],
    stats: [],
    total: 0,
    statTotal: 0,
    empty: true
  },

  onLoad(query: Record<string, string>) {
    this.applyThemeToPage();
    wheelId = (query && query.id) || '';
    this.buildFilters();
    this.reload();
  },

  onShow() {
    this.applyThemeToPage();
    this.reload();
  },

  applyThemeToPage() {
    const state = getThemeState();
    this.setData({ theme: state.theme, themeStyle: state.themeStyle });
    syncNavBar(state);
  },

  buildFilters() {
    const wheels = store.listWheels();
    const filters = [{ key: '', label: '全部' }];
    wheels.forEach((w) => {
      if (filters.length >= 8) return; // 筛选胶囊太多会横向撑爆，取前几个
      filters.push({ key: w._id, label: w.name });
    });
    this.setData({ filters });
  },

  reload() {
    const id = this.data.activeFilter;
    const recs = store.listRecords(id);
    const wheels = store.listWheels();
    const nameOf = (wid: string): string => {
      const w = wheels.find((x) => x._id === wid);
      return w ? w.name : '';
    };
    const records: IRecordVM[] = recs.map((r) => {
      const snap = (r.optionSnapshot || []).find((s) => s.text === r.result);
      const color = (snap && snap.color) || '#C7B8A8';
      return {
        id: r._id,
        time: fmtTime(r.createdAt),
        wheelName: r.wheelName || nameOf(r.wheelId) || '未命名转盘',
        deleted: store.isWheelDeleted(r.wheelId),
        result: r.result,
        resultIcon: r.resultIcon || '',
        color,
        ink: inkOn(color),
        pool: (r.optionSnapshot || []).map((s) => s.text).join(' · ')
      };
    });

    // 统计模式：条形宽度按最大次数归一化
    const rows = store.statsOf(id || wheelId || (wheels[0] ? wheels[0]._id : ''));
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    const stats: IStatVM[] = rows.map((r) => ({
      text: r.text,
      icon: r.icon || '',
      color: r.color,
      count: r.count,
      width: Math.round((r.count / max) * 100),
      ratio: `${Math.round(r.ratio * 100)}%`,
      expect: `${Math.round(r.expect * 100)}%`,
      hot: r.count >= 3 && r.ratio > r.expect * 1.4
    }));
    const statTotal = rows.reduce((s, r) => s + r.count, 0);

    this.setData({
      records,
      stats,
      total: records.length,
      statTotal,
      empty: !records.length
    });
  },

  onFilter(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { key?: string };
    const key = ds.key || '';
    if (key === this.data.activeFilter) return;
    this.setData({ activeFilter: key }, () => this.reload());
  },

  onMode(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { v?: string };
    const v = ds.v === 'stat' ? 'stat' : 'list';
    if (v === this.data.mode) return;
    this.setData({ mode: v }, () => this.reload());
  },

  /* ==================== 单条操作 ==================== */

  onRecordTap(e: WechatMiniprogram.TouchEvent) {
    const ds = e.currentTarget.dataset as { id?: string };
    const id = ds.id;
    if (!id) return;
    const rec = store.listRecords().find((r) => r._id === id);
    if (!rec) return;
    wx.showActionSheet({
      itemList: ['用这个选项池再抽一次', '把结果转为待办', '删除这条记录'],
      success: (res) => {
        if (res.tapIndex === 0) this.reroll(rec.optionSnapshot);
        else if (res.tapIndex === 1) this.toTodo(rec.result);
        else this.delRecord(id);
      },
      fail: () => undefined
    });
  },

  /** 用历史快照再抽一次（不依赖转盘是否还存在） */
  reroll(snapshot: { text: string; color: string; icon?: string }[]) {
    const pool: IWheelOption[] = (snapshot || []).map((s, i) => ({
      id: `snap_${i}`,
      text: s.text,
      color: s.color,
      weight: 1,
      icon: s.icon || ''
    }));
    if (pool.length < 2) {
      toast('这个选项池不足 2 项');
      return;
    }
    const idx = store.pickIndex(pool);
    const hit = pool[idx];
    if (!hit) return;
    wx.showModal({
      title: '抽取结果',
      content: `${hit.icon ? `${hit.icon} ` : ''}${hit.text}`,
      confirmText: '转为待办',
      cancelText: '关闭',
      success: (res) => {
        if (res.confirm) this.toTodo(hit.text);
      }
    });
  },

  async toTodo(text: string) {
    const payload = store.resultToTodo(text);
    try {
      const created = await todoStore.addTodo({
        content: payload.content,
        tags: payload.tags,
        dueDate: payload.dueDate
      });
      toast('已加入待办');
      if (created && created._id) {
        setTimeout(() => go(`/pages/detail/detail?id=${created._id}`, { title: '待办详情' }), 500);
      }
    } catch (err) {
      toast('创建失败，请重试');
    }
  },

  delRecord(id: string) {
    store.removeRecord(id);
    this.reload();
    toast('已删除');
  },

  onClearAll() {
    wx.showModal({
      title: '清空记录',
      content: '将清空当前筛选下的全部抽奖记录，转盘配置不受影响。',
      success: (res) => {
        if (!res.confirm) return;
        store.clearRecords(this.data.activeFilter);
        this.reload();
        toast('已清空');
      }
    });
  },

  onGoWheel() {
    go(`/subpackages/tools/pages/wheel/index`, { title: '万能转盘' });
  },

  onBack() {
    back(1);
  }
});
