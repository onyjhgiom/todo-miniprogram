// pages/love/profile/profile.ts
// 我们的档案：在一起的日子 · 结缘故事 · 双方信息 · 互赠礼物 · 生日送礼
import { applySkin, watchSkin, guardTap, confirmDanger, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import {
  getRelation, setRelation, setPerson, loadGifts, addGift, removeGift,
  todayYmd, onTopic, getWardrobe
} from '../../utils/love-store';
import { togetherStat } from '../../utils/love-energy';
import type { TogetherStat } from '../../utils/love-energy';
import {
  zodiacOf, zodiacList, birthdayStat, birthdayActions,
  giftIdeas, MBTI_LIST, HOBBY_LIST
} from '../../utils/love-gift';
import type { BirthdayStat } from '../../utils/love-gift';
import type { PersonProfile, GiftRecord } from '../../utils/love-types';

interface ProfileData {
  skin: SkinView;
  me: PersonProfile;
  him: PersonProfile;
  togetherDate: string;
  story: string;
  together: TogetherStat | null;

  zodiacs: string[];
  mbtiList: string[];
  hobbies: string[];

  bday: BirthdayStat | null;
  actions: string[];
  gifts2: { name: string; emoji: string; price: string; reason: string; how: string }[];

  /** 礼物记录 */
  giftList: GiftRecord[];
  showGift: boolean;
  gFrom: 'me' | 'him';
  gTitle: string;
  gDate: string;
  gPrice: string;
  gOccasion: string;
  gNote: string;

  /** 从距离卡带 focus=city 进来时，高亮城市字段， entry 更快 */
  focusCity: boolean;
}

Page<ProfileData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    me: { nickname: '', birthday: '', city: '', zodiac: '', mbti: '', hobbies: [], words: '' },
    him: { nickname: '', birthday: '', city: '', zodiac: '', mbti: '', hobbies: [], words: '' },
    togetherDate: '',
    story: '',
    together: null,
    zodiacs: zodiacList(),
    mbtiList: MBTI_LIST,
    hobbies: HOBBY_LIST,
    bday: null,
    actions: [],
    gifts2: [],
    giftList: [],
    showGift: false,
    gFrom: 'me',
    gTitle: '',
    gDate: '',
    gPrice: '',
    gOccasion: '',
    gNote: '',
    focusCity: false
  },

  onLoad(query?: Record<string, string>) {
    const r = getRelation();
    const focusCity = !!(query && query.focus === 'city');
    this.setData({
      skin: applySkin(),
      me: r.me,
      him: r.him,
      togetherDate: r.togetherDate,
      story: r.story,
      gDate: todayYmd(),
      focusCity
    });
    if (focusCity) toast('填好双方城市，这里的距离与天气会立刻更新');
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.unsubData = onTopic('relation', () => this.refresh());
    this.unsub2 = onTopic('gift', () => this.refresh());
    this.refresh();
  },

  onUnload() {
    if (this.unsub) this.unsub();
    if (this.unsubData) this.unsubData();
    if (this.unsub2) this.unsub2();
  },

  onShow() {
    this.setData({ skin: applySkin() });
  },

  unsub: null as (() => void) | null,
  unsubData: null as (() => void) | null,
  unsub2: null as (() => void) | null,

  refresh() {
    const r = getRelation();
    const bday = r.him.birthday ? birthdayStat(r.him.birthday) : null;
    const w = getWardrobe();
    const gifts2 = (r.him.mbti || r.him.hobbies.length)
      ? giftIdeas({ mbti: r.him.mbti, hobbies: r.him.hobbies, budget: w.budget, zodiac: r.him.zodiac || zodiacOf(r.him.birthday) })
        .map((g) => ({ name: g.name, emoji: g.emoji, price: g.price, reason: g.reason, how: g.how }))
      : [];
    this.setData({
      me: r.me,
      him: r.him,
      togetherDate: r.togetherDate,
      story: r.story,
      together: togetherStat(),
      bday,
      actions: bday ? birthdayActions(r.him.nickname, bday) : [],
      gifts2,
      giftList: loadGifts()
    });
  },

  /* ============================ 档案编辑 ============================ */

  onInput(e: WechatMiniprogram.InputEvent) {
    const who = e.currentTarget.dataset.who as 'me' | 'him';
    const f = e.currentTarget.dataset.f as string;
    if (!who || !f) return;
    if (f === 'story') {
      this.setData({ story: e.detail.value });
      return;
    }
    const cur = this.data[who];
    this.setData({ [who]: { ...cur, [f]: e.detail.value } } as unknown as Partial<ProfileData>);
  },

  onBlur(e: WechatMiniprogram.InputEvent) {
    // 失焦即存：用户不用找保存按钮
    const who = e.currentTarget.dataset.who as 'me' | 'him';
    const f = e.currentTarget.dataset.f as string;
    if (!who || !f) return;
    if (f === 'story') {
      setRelation({ story: e.detail.value });
      return;
    }
    const cur = this.data[who];
    setPerson(who, { [f]: (cur as unknown as Record<string, string>)[f] });
    // 生日改了就把星座跟着算出来
    if (f === 'birthday') {
      const z = zodiacOf((cur as unknown as Record<string, string>).birthday);
      if (z) setPerson(who, { zodiac: z });
    }
    this.refresh();
  },

  onPickTogether(e: WechatMiniprogram.TouchEvent) {
    setRelation({ togetherDate: e.detail.value as string });
    this.setData({ togetherDate: e.detail.value as string });
    this.refresh();
  },

  onPickBirthday(e: WechatMiniprogram.TouchEvent) {
    const who = e.currentTarget.dataset.who as 'me' | 'him';
    const v = e.detail.value as string;
    setPerson(who, { birthday: v, zodiac: zodiacOf(v) });
    this.refresh();
  },

  onZodiac(e: WechatMiniprogram.TouchEvent) {
    const who = e.currentTarget.dataset.who as 'me' | 'him';
    setPerson(who, { zodiac: e.currentTarget.dataset.v as string });
    this.refresh();
  },

  onMbti(e: WechatMiniprogram.TouchEvent) {
    const who = e.currentTarget.dataset.who as 'me' | 'him';
    const v = e.currentTarget.dataset.v as string;
    const cur = this.data[who];
    setPerson(who, { mbti: cur.mbti === v ? '' : v });
    this.refresh();
  },

  onHobby(e: WechatMiniprogram.TouchEvent) {
    const who = e.currentTarget.dataset.who as 'me' | 'him';
    const v = e.currentTarget.dataset.v as string;
    const cur = this.data[who].hobbies || [];
    const next = cur.indexOf(v) >= 0 ? cur.filter((x) => x !== v) : cur.concat([v]);
    setPerson(who, { hobbies: next.slice(0, 6) });
    this.refresh();
  },

  /* ============================ 礼物记录 ============================ */

  onToggleGift() {
    if (!guardTap('gform', 400)) return;
    this.setData({ showGift: !this.data.showGift });
  },

  onGFrom(e: WechatMiniprogram.TouchEvent) {
    this.setData({ gFrom: e.currentTarget.dataset.v as 'me' | 'him' });
  },

  onGTitle(e: WechatMiniprogram.InputEvent) {
    this.setData({ gTitle: e.detail.value });
  },

  onGDate(e: WechatMiniprogram.TouchEvent) {
    this.setData({ gDate: e.detail.value as string });
  },

  onGPrice(e: WechatMiniprogram.InputEvent) {
    this.setData({ gPrice: e.detail.value });
  },

  onGOccasion(e: WechatMiniprogram.InputEvent) {
    this.setData({ gOccasion: e.detail.value });
  },

  onGNote(e: WechatMiniprogram.InputEvent) {
    this.setData({ gNote: e.detail.value });
  },

  onSaveGift() {
    if (!guardTap('save_g', 800)) return;
    const d = this.data;
    if (!d.gTitle) { toast('礼物叫什么名字？'); return; }
    addGift({
      from: d.gFrom,
      title: d.gTitle,
      date: d.gDate || todayYmd(),
      price: d.gPrice || '',
      occasion: d.gOccasion || '',
      note: d.gNote || ''
    });
    this.setData({ gTitle: '', gPrice: '', gOccasion: '', gNote: '', showGift: false });
    toast('已记下');
    this.refresh();
  },

  onDelGift(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('删除这条礼物记录？', () => {
      removeGift(id);
      this.refresh();
    }, '删除记录');
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '我们的档案', path: '/subpackages/love/pages/profile/profile' };
  }
});
