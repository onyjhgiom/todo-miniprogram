// pages/love/letter/letter.ts
// 私密留言 · 只有绑定的两个人能看到的对话
//
// 未绑定时依然可以写（当私密日记用），但会明确提示「仅自己可见」，
// 且不上传到云端——等绑定后由用户自己决定要不要同步（见 couple 页的同步询问）。
import { applySkin, watchSkin, guardTap, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { isBound, getPair, partnerName, refreshStatus, myName } from '../../utils/love-pair';
import { listMsgs, addMsg, relTime, syncKind } from '../../utils/love-duo';
import { go } from '../../../../utils/nav';

interface MsgView {
  id: string;
  text: string;
  at: string;
  mine: boolean;
  who: string;
}

interface LetterData {
  skin: SkinView;
  bound: boolean;
  partner: string;
  msgs: MsgView[];
  draft: string;
  toView: string;
}

Page<LetterData>({
  data: {
    skin: { key: 'dream', style: '', dark: true, name: '', emoji: '' },
    bound: false,
    partner: 'TA',
    msgs: [],
    draft: '',
    toView: ''
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
        if (isBound()) void syncKind('msg').then(() => this.render());
      });
    }
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  unsub: null as (() => void) | null,

  render() {
    const me = myName();
    const ta = partnerName();
    const list = listMsgs().map((m) => ({
      id: m.id,
      text: m.data.text,
      at: relTime(m.data.at),
      mine: m.by === (getPair().role === 'him' ? 'him' : 'me'),
      who: m.by === (getPair().role === 'him' ? 'him' : 'me') ? me : ta
    }));
    this.setData({
      bound: isBound(),
      partner: ta,
      msgs: list,
      toView: list.length ? `m_${list[list.length - 1].id}` : ''
    });
  },

  onInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ draft: e.detail.value || '' });
  },

  onSend() {
    if (!guardTap('send_msg', 400)) return;
    const t = (this.data.draft || '').trim();
    if (!t) { toast('先写点什么吧'); return; }
    addMsg(t);
    this.setData({ draft: '' });
    this.render();
    if (!isBound()) toast('已保存到本地（绑定后 TA 才看得到）');
  },

  onGoBind() {
    go('/subpackages/love/pages/couple/couple', { title: '双人空间', loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '爱遇小栈 · 私密留言',
      path: '/subpackages/love/pages/letter/letter'
    };
  }
});
