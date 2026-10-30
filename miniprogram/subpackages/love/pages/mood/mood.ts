// pages/love/mood/mood.ts
// 心情打卡 · 一人一天一条，双方都能看到对方今天怎么样
//
// 未绑定时就是「自己的心情日记」，绑定后自动变成双人对照 + 近两周心情日历。
// 打卡 id 用 `${role}_${date}`，所以重复打卡是覆盖当天，不会产生一堆重复记录。
import { applySkin, watchSkin, guardTap, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { isBound, getPair, partnerName, myRole, refreshStatus } from '../../utils/love-pair';
import {
  listMoods, setMood, moodMeta, MOODS, dateKey, syncKind
} from '../../utils/love-duo';
import { go } from '../../../../utils/nav';

interface CalCell { d: string; e: string; none: boolean; }
interface CalRow { who: string; cells: CalCell[]; }

interface MoodData {
  skin: SkinView;
  bound: boolean;
  partner: string;
  moods: { key: string; emoji: string; label: string }[];
  picked: string;
  note: string;
  mine: { emoji: string; label: string } | null;
  ta: { emoji: string; label: string; note: string } | null;
  cal: CalRow[];
  todayText: string;
}

const CAL_DAYS = 14;

Page<MoodData>({
  data: {
    skin: { key: 'dream', style: '', dark: true, name: '', emoji: '' },
    bound: false,
    partner: 'TA',
    moods: MOODS,
    picked: '',
    note: '',
    mine: null,
    ta: null,
    cal: [],
    todayText: ''
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
        if (isBound()) void syncKind('mood').then(() => this.render());
      });
    }
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  unsub: null as (() => void) | null,

  render() {
    const me = myRole();
    const other = me === 'me' ? 'him' : 'me';
    const today = dateKey(new Date());
    const all = listMoods();

    const mine = all.find((m) => m.id === `${me}_${today}`);
    const ta = all.find((m) => m.id === `${other}_${today}`);

    // 近 CAL_DAYS 天，我和 TA 各一行
    const rows: CalRow[] = [
      { who: '我', cells: [] },
      { who: partnerName(), cells: [] }
    ];
    const base = new Date();
    for (let i = CAL_DAYS - 1; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const key = dateKey(d);
      const m1 = all.find((x) => x.id === `${me}_${key}`);
      const m2 = all.find((x) => x.id === `${other}_${key}`);
      rows[0].cells.push({ d: String(d.getDate()), e: m1 ? moodMeta(m1.data.mood).emoji : '·', none: !m1 });
      rows[1].cells.push({ d: String(d.getDate()), e: m2 ? moodMeta(m2.data.mood).emoji : '·', none: !m2 });
    }

    const dd = new Date();
    this.setData({
      bound: isBound(),
      partner: partnerName(),
      picked: mine ? mine.data.mood : '',
      note: mine ? mine.data.note : '',
      mine: mine ? moodMeta(mine.data.mood) : null,
      ta: ta ? { ...moodMeta(ta.data.mood), note: ta.data.note } : null,
      cal: rows,
      todayText: `${dd.getMonth() + 1} 月 ${dd.getDate()} 日`
    });
  },

  onPick(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as string;
    this.setData({ picked: this.data.picked === k ? '' : k });
  },

  onNote(e: WechatMiniprogram.InputEvent) {
    this.setData({ note: e.detail.value || '' });
  },

  onSave() {
    if (!guardTap('save_mood', 500)) return;
    const k = this.data.picked;
    if (!k) { toast('先选一个心情'); return; }
    setMood(k, this.data.note);
    toast(isBound() ? '打卡成功，TA 能看到啦' : '已记录（未绑定，仅自己可见）');
    this.render();
  },

  onGoBind() {
    go('/subpackages/love/pages/couple/couple', { title: '双人空间', loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '爱遇小栈 · 心情打卡',
      path: '/subpackages/love/pages/mood/mood'
    };
  }
});
