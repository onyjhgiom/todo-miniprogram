// pages/love/share/share.ts
// 共享与同步：配对码 + 云端双向同步 + 离线快照导出导入
import { applySkin, watchSkin, guardTap, toast, withLoading, confirmDanger } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import {
  makeRoomCode, probeCloud, pair, push, pull,
  copySnapshot, importText, importFromClipboard, exportText, shareView
} from '../../utils/love-share';
import type { SyncResult, ShareView } from '../../utils/love-share';
import { getShare, setShare, setShareScope, onTopic } from '../../utils/love-store';
import type { ShareScope } from '../../utils/love-types';

const SCOPE_META: { key: keyof ShareScope; label: string; desc: string; emoji: string }[] = [
  { key: 'relation', label: '关系档案', desc: '在一起日期、生日、星座、MBTI、故事', emoji: '📇' },
  { key: 'interaction', label: '互动与能量', desc: '互动记录与爱情能量', emoji: '💞' },
  { key: 'memory', label: '回忆时间线', desc: '共同回忆', emoji: '🕰️' },
  { key: 'gift', label: '礼物记录', desc: '互赠的礼物', emoji: '🎁' },
  { key: 'cycle', label: '经期数据', desc: '默认关闭——这是最私密的部分', emoji: '🌹' }
];

interface ShareData {
  skin: SkinView;
  view: ShareView | null;
  roomInput: string;
  scopeMeta: { key: keyof ShareScope; label: string; desc: string; emoji: string }[];
  scope: ShareScope;
  importText: string;
  busy: boolean;
}

Page<ShareData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    view: null,
    roomInput: '',
    scopeMeta: SCOPE_META,
    scope: { relation: true, interaction: true, memory: true, gift: true, cycle: false },
    importText: '',
    busy: false
  },

  onLoad() {
    this.setData({ skin: applySkin(), scope: getShare().scope });
    this.unsub = watchSkin(() => this.setData({ skin: applySkin() }));
    this.unsubData = onTopic('share', () => this.refresh());
    this.refresh();
    // 进入即探测一次云端，让用户立刻知道走哪条通道
    probeCloud().then(() => this.refresh());
  },

  onUnload() {
    if (this.unsub) this.unsub();
    if (this.unsubData) this.unsubData();
  },

  onShow() {
    this.setData({ skin: applySkin() });
  },

  unsub: null as (() => void) | null,
  unsubData: null as (() => void) | null,

  refresh() {
    this.setData({ view: shareView(), scope: getShare().scope });
  },

  /* ============================ 配对 ============================ */

  onCreateRoom() {
    if (!guardTap('create', 800)) return;
    const code = makeRoomCode();
    this.setData({ roomInput: code });
    this.doPair(code);
  },

  onRoomInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ roomInput: (e.detail.value || '').toUpperCase() });
  },

  onJoinRoom() {
    if (!guardTap('join', 800)) return;
    const code = (this.data.roomInput || '').toUpperCase().trim();
    if (code.length !== 6) { toast('请输入 6 位房间号'); return; }
    this.doPair(code);
  },

  doPair(code: string) {
    this.setData({ busy: true });
    withLoading(() => pair(code, getShare().role), '配对中', 300)
      .then((r: SyncResult) => {
        toast(r.msg);
        this.refresh();
      })
      .finally(() => this.setData({ busy: false }));
  },

  onRole(e: WechatMiniprogram.TouchEvent) {
    const v = e.currentTarget.dataset.v as 'me' | 'him';
    setShare({ role: v });
    toast(v === 'me' ? '已设为「我」' : '已设为「他」');
    this.refresh();
  },

  /* ============================ 同步 ============================ */

  onPush() {
    if (!guardTap('push', 1200)) return;
    this.setData({ busy: true });
    withLoading(() => push(), '上传中', 300)
      .then((r: SyncResult) => { toast(r.msg); this.refresh(); })
      .finally(() => this.setData({ busy: false }));
  },

  onPull() {
    if (!guardTap('pull', 1200)) return;
    this.setData({ busy: true });
    withLoading(() => pull(), '同步中', 300)
      .then((r: SyncResult) => { toast(r.msg); this.refresh(); })
      .finally(() => this.setData({ busy: false }));
  },

  /* ============================ 离线通道 ============================ */

  onExport() {
    if (!guardTap('export', 1200)) return;
    const { size } = exportText();
    copySnapshot().then(() => {
      toast(`已复制（${size}），去微信发给他`);
      this.refresh();
    });
  },

  onImportText(e: WechatMiniprogram.InputEvent) {
    this.setData({ importText: e.detail.value });
  },

  onImport() {
    if (!guardTap('import', 1200)) return;
    const t = this.data.importText;
    const r = importText(t);
    toast(r.msg);
    if (r.ok) this.setData({ importText: '' });
    this.refresh();
  },

  onImportClipboard() {
    if (!guardTap('import_cb', 1200)) return;
    importFromClipboard().then((r) => {
      toast(r.msg);
      this.refresh();
    });
  },

  /* ============================ 共享范围 ============================ */

  onToggleScope(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as keyof ShareScope;
    if (!k) return;
    const cur = getShare().scope;
    const next = { ...cur, [k]: !cur[k] };
    if (k === 'cycle' && next.cycle) {
      confirmDanger('经期数据非常私密，确定要同步给对方吗？', () => {
        setShareScope({ cycle: true });
        this.refresh();
      }, '确认开启');
      return;
    }
    setShareScope({ [k]: next[k] });
    this.refresh();
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const s = getShare();
    return {
      title: s.room ? `爱遇小栈 · 房间 ${s.room}` : '爱遇小栈 · 一起记录我们的事',
      path: '/subpackages/love/pages/share/share'
    };
  }
});
