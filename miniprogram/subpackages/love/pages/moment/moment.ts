// pages/love/moment/moment.ts
// 双人动态 · 图文动态 / 日记 / 回忆相册，按时间线浏览 + 评论互动
//
// 三种形态共用一个时间线：kind 决定标签，浏览时可按日期一路翻回去。
// 配图走云存储 fileID（<image> 支持 cloud:// 直出），云端不可用时退回本地临时路径并提示。
import { applySkin, watchSkin, guardTap, confirmDanger, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { isBound, getPair, myRole, myName, partnerName, refreshStatus } from '../../utils/love-pair';
import {
  listPosts, addPost, delPost, listComments, addComment, delComment,
  uploadImage, relTime, dateKey, syncKind
} from '../../utils/love-duo';
import type { DuoPost } from '../../utils/love-duo';
import { go } from '../../../../utils/nav';

interface CmtView { id: string; name: string; text: string; at: string; mine: boolean; }
interface PostView {
  id: string; kind: string; kindText: string;
  title: string; text: string; photos: string[];
  date: string; at: string; who: string; mine: boolean;
  cmtCount: number; open: boolean; cmts: CmtView[];
}

interface MomentData {
  skin: SkinView;
  bound: boolean;
  kind: DuoPost['kind'];
  kinds: { key: string; label: string; emoji: string }[];
  title: string;
  text: string;
  photos: string[];
  date: string;
  posts: PostView[];
  openId: string;
  cmtDraft: string;
  uploading: boolean;
}

const KIND_TEXT: Record<string, string> = { moment: '图文', diary: '日记', album: '相册' };

Page<MomentData>({
  data: {
    skin: { key: 'dream', style: '', dark: true, name: '', emoji: '' },
    bound: false,
    kind: 'moment',
    kinds: [
      { key: 'moment', label: '图文动态', emoji: '📷' },
      { key: 'diary', label: '日记', emoji: '📔' },
      { key: 'album', label: '回忆相册', emoji: '💿' }
    ],
    title: '',
    text: '',
    photos: [],
    date: dateKey(new Date()),
    posts: [],
    openId: '',
    cmtDraft: '',
    uploading: false
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
        if (!isBound()) return;
        void syncKind('post').then(() => this.render());
        void syncKind('comment').then(() => this.render());
      });
    }
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  unsub: null as (() => void) | null,

  render() {
    const me = myRole();
    const ta = partnerName();
    const posts = listPosts()
      .slice()
      .sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || (b.data.at || 0) - (a.data.at || 0))
      .map((p) => {
        const d = p.data as DuoPost;
        const mine = p.by === me;
        return {
          id: p.id,
          kind: d.kind || 'moment',
          kindText: KIND_TEXT[d.kind || 'moment'] || '动态',
          title: d.title || '',
          text: d.text || '',
          photos: d.photos || [],
          date: d.date || '',
          at: relTime(d.at || p.updatedAt),
          who: mine ? myName() : ta,
          mine,
          cmtCount: listComments(p.id).length,
          open: this.data.openId === p.id,
          cmts: this.data.openId === p.id
            ? listComments(p.id).map((c) => ({
                id: c.id,
                name: c.by === me ? myName() : ta,
                text: c.data.text,
                at: relTime(c.data.at),
                mine: c.by === me
              }))
            : []
        };
      });
    this.setData({ bound: isBound(), posts });
  },

  /* ============================ 发布 ============================ */

  onKind(e: WechatMiniprogram.TouchEvent) {
    const k = e.currentTarget.dataset.k as string;
    this.setData({ kind: (k === 'diary' || k === 'album' ? k : 'moment') as DuoPost['kind'] });
  },

  onTitle(e: WechatMiniprogram.InputEvent) { this.setData({ title: e.detail.value || '' }); },
  onText(e: WechatMiniprogram.InputEvent) { this.setData({ text: e.detail.value || '' }); },
  onDate(e: WechatMiniprogram.PickerChangeEvent) { this.setData({ date: String(e.detail.value || dateKey(new Date())) }); },

  async onPickImage() {
    if (!guardTap('pick_img', 600)) return;
    const left = 9 - this.data.photos.length;
    if (left <= 0) { toast('最多 9 张'); return; }
    try {
      const res = await wx.chooseMedia({
        count: left, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera']
      });
      const files = (res && res.tempFiles) || [];
      if (!files.length) return;
      this.setData({ uploading: true });
      const next = this.data.photos.slice();
      for (const f of files) {
        // 上传失败就用本地路径兜底：至少自己这边看得到，不会白选一场
        next.push(await uploadImage(f.tempFilePath));
      }
      this.setData({ photos: next.slice(0, 9), uploading: false });
    } catch (e) {
      this.setData({ uploading: false });
      // 用户取消选择会走这里，不提示
    }
  },

  onDelPhoto(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const next = this.data.photos.slice();
    if (isNaN(i) || i < 0 || i >= next.length) return;
    next.splice(i, 1);
    this.setData({ photos: next });
  },

  onPreview(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const list = this.data.photos;
    try {
      wx.previewImage({ current: list[i] || list[0], urls: list });
    } catch (err) { /* 忽略 */ }
  },

  onPublish() {
    if (!guardTap('publish', 600)) return;
    const title = (this.data.title || '').trim();
    const text = (this.data.text || '').trim();
    if (!title && !text && !this.data.photos.length) { toast('写点什么或选张图吧'); return; }
    addPost(this.data.kind, title || this.data.date, text, this.data.photos, this.data.date);
    toast(isBound() ? '已发布，TA 能看到' : '已保存（未绑定，仅自己可见）');
    this.setData({ title: '', text: '', photos: [] });
    this.render();
  },

  onDelPost(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    confirmDanger('删除后 TA 那边也会一起删除，确定吗？', () => {
      delPost(id);
      toast('已删除');
      this.render();
    }, '删除动态');
  },

  /* ============================ 评论 ============================ */

  onToggleCmt(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    this.setData({ openId: this.data.openId === id ? '' : id, cmtDraft: '' }, () => this.render());
  },

  onCmtInput(e: WechatMiniprogram.InputEvent) { this.setData({ cmtDraft: e.detail.value || '' }); },

  onSendCmt(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id || !guardTap('cmt_' + id, 400)) return;
    const t = (this.data.cmtDraft || '').trim();
    if (!t) { toast('说点什么吧'); return; }
    addComment(id, t);
    this.setData({ cmtDraft: '' });
    this.render();
  },

  onDelCmt(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    delComment(id);
    this.render();
  },

  onGoBind() {
    go('/subpackages/love/pages/couple/couple', { title: '双人空间', loading: true });
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return {
      title: '爱遇小栈 · 双人动态',
      path: '/subpackages/love/pages/moment/moment'
    };
  }
});
