// pages/love/anniv/anniv.ts
// 纪念日 · 在一起的每一天都值得倒数
//
// 支持「每年重复」（生日、恋爱纪念日）和「一次性」（见面日、领证日）。
// 重复型过了今年自动顺延到明年，不会出现「纪念日过期了还挂在列表里」。
import { applySkin, watchSkin, guardTap, confirmDanger, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { isBound, getPair, refreshStatus } from '../../utils/love-pair';
import {
  listAnnivs, addAnniv, delAnniv, annivCountdown, dateKey, syncKind
} from '../../utils/love-duo';
import type { DuoAnniv } from '../../utils/love-duo';
import { go } from '../../../../utils/nav';

interface AnnivView {
  id: string;
  title: string;
  date: string;
  yearly: boolean;
  days: number;
  daysText: string;
  passed: boolean;
}

interface AnnivData {
  skin: SkinView;
  bound: boolean;
  list: AnnivView[];
  title: string;
  date: string;
  yearly: boolean;
  note: string;
}

Page<AnnivData>({
  data: {
    skin: { key: 'dream', style: '', dark: true, name: '', emoji: '' },
    bound: false,
    list: [],
    title: '',
    date: dateKey(new Date()),
    yearly: true,
    note: ''
  },

  onLoad() {
    this.setData({ skin: applySkin() });
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.render();
  },

  onShow() {
    this.render();
    if (getPair().pairId) {
      void refreshStatus().then(() => {
        if (isBound()) void syncKind('anniv').then(() => this.render());
      });
    }
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  unsub: null as (() => void) | null,

  render() {
    const list = listAnnivs()
      .map((a) => {
        const d = a.data as DuoAnniv;
        const days = annivCountdown(d);
        return {
          id: a.id,
          title: d.title || '纪念日',
          date: d.date,
          yearly: !!d.yearly,
          days,
          daysText: days === 0 ? '今天' : (days > 0 ? String(days) : '已过'),
          passed: days < 0
        };
      })
      // 还没到的排前面、最近的在最前；已过去的一次性纪念日沉到底部
      .sort((x, y) => {
        if (x.passed !== y.passed) return x.passed ? 1 : -1;
        return x.days - y.days;
      });
    this.setData({ bound: isBound(), list });
  },

  onTitle(e: WechatMiniprogram.InputEvent) {
    this.setData({ title: e.detail.value || '' });
  },

  onDate(e: WechatMiniprogram.PickerChangeEvent) {
    // picker 的 detail.value 可能是 string 也可能是 number，统一转成字符串再存
    this.setData({ date: String(e.detail.value || dateKey(new Date())) });
  },

  onYearly(e: WechatMiniprogram.SwitchChangeEvent) {
    this.setData({ yearly: !!e.detail.value });
  },

  onNote(e: WechatMiniprogram.InputEvent) {
    this.setData({ note: e.detail.value || '' });
  },

  onAdd() {
    if (!guardTap('add_anniv', 500)) return;
    const t = (this.data.title || '').trim();
    if (!t) { toast('给这个纪念日起个名字'); return; }
    if (!this.data.date) { toast('选个日期'); return; }
    addAnniv(t, this.data.date, this.data.yearly, this.data.note);
    toast(isBound() ? '已添加，TA 也会看到' : '已添加（未绑定，仅自己可见）');
    this.setData({ title: '', note: '' });
    this.render();
  },

  onDel(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('确定删除这个纪念日吗？', () => {
      delAnniv(id);
      toast('已删除');
      this.render();
    }, '删除纪念日');
  },

  onGoBind() {
    go('/subpackages/love/pages/couple/couple', { title: '双人空间', loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '爱遇小栈 · 纪念日',
      path: '/subpackages/love/pages/anniv/anniv'
    };
  }
});
