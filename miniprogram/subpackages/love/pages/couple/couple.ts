// pages/love/couple/couple.ts
// 双人空间 · 情侣绑定中枢 + 关系概览 + 快捷互动
//
// 未绑定：引导生成 / 输入邀请码，同时所有双人功能仍可单人使用（仅自己可见）。
// 已绑定：展示在一起天数、最近纪念日、双方今日心情、TA 的最新留言与互动，并提供快捷「戳一戳」。
import { applySkin, watchSkin, guardTap, confirmDanger, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { getRelation } from '../../utils/love-store';
import {
  getPair, isBound, myRole, partnerName, refreshStatus,
  createInvite, refreshCode, joinByCode, leavePair
} from '../../utils/love-pair';
import {
  listMsgs, listMoods, listAnnivs, listSignals, listWishes, listTasks, listPosts,
  annivCountdown, moodMeta, relTime, sendSignal, syncAll, pendingCount, skipUpload,
  SIGNALS, dateKey
} from '../../utils/love-duo';
import type { DuoAnniv } from '../../utils/love-duo';
import { go } from '../../../../utils/nav';

interface Entry { key: string; icon: string; name: string; path: string; }

const ENTRIES: Entry[] = [
  { key: 'letter', icon: '💌', name: '私密留言', path: '/subpackages/love/pages/letter/letter' },
  { key: 'mood', icon: '😊', name: '心情打卡', path: '/subpackages/love/pages/mood/mood' },
  { key: 'anniv', icon: '🎂', name: '纪念日', path: '/subpackages/love/pages/anniv/anniv' },
  { key: 'plan', icon: '🌟', name: '心愿约定', path: '/subpackages/love/pages/plan/plan' },
  { key: 'moment', icon: '📷', name: '双人动态', path: '/subpackages/love/pages/moment/moment' }
];

interface CoupleData {
  skin: SkinView;
  bound: boolean;
  statusText: string;
  subTitle: string;
  cloudOn: boolean;
  code: string;
  tab: 'create' | 'join';
  inputCode: string;
  partner: string;
  togetherDays: number;
  nextAnniv: { title: string; days: number } | null;
  myMood: { emoji: string; label: string } | null;
  taMood: { emoji: string; label: string } | null;
  lastMsg: { text: string; at: string; mine: boolean } | null;
  lastSignal: { emoji: string; label: string; at: string } | null;
  signals: { key: string; emoji: string; label: string; tip: string }[];
  entries: Entry[];
  counts: { msg: number; wish: number; task: number; post: number };
}

interface AnnivLike { title?: string; date?: string; yearly?: boolean; }

/** 在一起天数：togetherDate 为空返回 -1（页面据此不展示） */
function togetherDays(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return -1;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  if (!t) return -1;
  return Math.floor((Date.now() - t) / 86400000) + 1;
}

Page<CoupleData>({
  data: {
    skin: { key: 'dream', style: '', dark: true, name: '', emoji: '' },
    bound: false,
    statusText: '未绑定',
    subTitle: '和 TA 绑定后，这里就是你们两个人的小世界',
    cloudOn: false,
    code: '',
    tab: 'create',
    inputCode: '',
    partner: 'TA',
    togetherDays: -1,
    nextAnniv: null,
    myMood: null,
    taMood: null,
    lastMsg: null,
    lastSignal: null,
    signals: SIGNALS,
    entries: ENTRIES,
    counts: { msg: 0, wish: 0, task: 0, post: 0 }
  },

  onLoad() {
    this.setData({ skin: applySkin() });
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.render();
  },

  onShow() {
    this.render();
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  unsub: null as (() => void) | null,

  render() {
    const p = getPair();
    const bound = isBound();
    const me = myRole();
    const other = me === 'me' ? 'him' : 'me';
    const today = dateKey(new Date());

    const myM = listMoods().find((m) => m.id === `${me}_${today}`);
    const taM = listMoods().find((m) => m.id === `${other}_${today}`);

    const msgs = listMsgs();
    const last = msgs.length ? msgs[msgs.length - 1] : null;

    const sig = listSignals().find((s) => s.by === other) || null;

    // 最近的纪念日：在还没过去的日子里挑最小的（含今天）
    let next: { title: string; days: number } | null = null;
    listAnnivs().forEach((a) => {
      const d = annivCountdown(a.data as DuoAnniv);
      if (d < 0) return;
      if (!next || d < next.days) next = { title: (a.data as AnnivLike).title || '纪念日', days: d };
    });

    this.setData({
      bound,
      cloudOn: p.cloudOn,
      code: p.code,
      partner: partnerName(),
      statusText: bound ? '已绑定' : (p.status === 'pending' ? '等待 TA 加入' : '未绑定'),
      subTitle: bound
        ? `和 ${partnerName()} 的第 ${Math.max(1, togetherDays(getRelation().togetherDate))} 天`
        : '和 TA 绑定后，这里就是你们两个人的小世界',
      togetherDays: togetherDays(getRelation().togetherDate),
      nextAnniv: next,
      myMood: myM ? moodMeta(myM.data.mood) : null,
      taMood: taM ? moodMeta(taM.data.mood) : null,
      lastMsg: last
        ? { text: last.data.text, at: relTime(last.data.at), mine: last.by === me }
        : null,
      lastSignal: sig
        ? {
            emoji: (SIGNALS.find((s) => s.key === sig.data.kind) || { emoji: '💗' }).emoji,
            label: (SIGNALS.find((s) => s.key === sig.data.kind) || { label: '互动' }).label,
            at: relTime(sig.data.at)
          }
        : null,
      counts: {
        msg: msgs.length,
        wish: listWishes().length,
        task: listTasks().length,
        post: listPosts().length
      }
    });

    // 后台刷新关系状态 + 同步：不阻塞首屏渲染
    if (p.pairId) {
      void refreshStatus().then(() => {
        const q = getPair();
        this.setData({
          bound: isBound(),
          cloudOn: q.cloudOn,
          code: q.code,
          partner: partnerName(),
          statusText: isBound() ? '已绑定' : (q.status === 'pending' ? '等待 TA 加入' : '未绑定')
        });
        if (isBound()) void syncAll().then(() => this.render());
      });
    }
  },

  /* ============================ 绑定 ============================ */

  onTab(e: WechatMiniprogram.TouchEvent) {
    const t = e.currentTarget.dataset.t as string;
    this.setData({ tab: t === 'join' ? 'join' : 'create' });
  },

  onInputCode(e: WechatMiniprogram.InputEvent) {
    this.setData({ inputCode: (e.detail.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '') });
  },

  async onCreateCode() {
    if (!guardTap('create_code', 800)) return;
    const r = await createInvite();
    toast(r.msg);
    if (r.ok) this.setData({ code: getPair().code });
  },

  async onRefreshCode() {
    if (!guardTap('refresh_code', 800)) return;
    const r = await refreshCode();
    toast(r.msg);
    if (r.ok) this.setData({ code: getPair().code });
  },

  onCopyCode() {
    if (!this.data.code) return;
    try {
      wx.setClipboardData({
        data: `我在「爱遇小栈」等你，双人空间邀请码：${this.data.code}`,
        success: () => toast('已复制，发给 TA 吧')
      });
    } catch (e) {
      toast('复制失败');
    }
  },

  async onJoin() {
    if (!guardTap('join', 800)) return;
    const code = this.data.inputCode;
    const r = await joinByCode(code);
    if (!r.ok) { toast(r.msg); return; }
    // 询问是否把绑定前已有的本地内容同步进双人空间——默认不偷偷上传
    const n = pendingCount();
    if (n > 0) {
      wx.showModal({
        title: '同步已有内容？',
        content: `你在绑定前已有 ${n} 条记录（留言/心愿/动态等）。要把它们同步到双人空间让 TA 看到吗？`,
        confirmText: '同步',
        cancelText: '暂不',
        success: (res: { confirm?: boolean }) => {
          if (res.confirm) void syncAll().then(() => this.render());
          else skipUpload();
          this.render();
        }
      });
    } else {
      void syncAll();
    }
    toast(r.msg);
    this.render();
  },

  onLeave() {
    confirmDanger('解除后双人内容停止同步，本地历史仍会保留。确定要解除吗？', async () => {
      const r = await leavePair();
      toast(r.msg);
      this.render();
    }, '解除绑定');
  },

  /* ============================ 快捷互动 ============================ */

  onSignal(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as string;
    if (!guardTap('sig_' + k, 600)) return;
    const one = SIGNALS.find((s) => s.key === k);
    if (!one) return;
    sendSignal(one.key as 'poke', '');
    toast(isBound() ? `已${one.label}，TA 会收到` : `已记录${one.label}（未绑定，仅自己可见）`);
    this.render();
  },

  onEntry(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    if (!guardTap('entry_' + key, 450)) return;
    const item = ENTRIES.find((x) => x.key === key);
    if (!item) return;
    go(item.path, { title: item.name, loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '爱遇小栈 · 双人空间',
      path: '/subpackages/love/pages/couple/couple'
    };
  }
});
