// pages/love/skin/skin.ts
// 皮肤中心：8 套为年轻女孩设计的风格，一键换肤并记忆
import { applySkin, watchSkin, guardTap, toast } from '../../utils/love-page';
import type { SkinView } from '../../utils/love-page';
import { SKINS, skinFamilies, buildSkinStyle } from '../../utils/love-skin';
import type { SkinDef } from '../../utils/love-skin';
import { getSkinKey, setSkinKey } from '../../utils/love-store';
import type { SkinKey } from '../../utils/love-types';

interface SkinCard extends SkinDef {
  /** 该皮肤自身的变量串，用于卡片内做真实预览 */
  previewStyle: string;
  on: boolean;
}

interface SkinData {
  skin: SkinView;
  groups: { family: string; skins: SkinCard[] }[];
  current: SkinKey;
}

Page<SkinData>({
  data: {
    skin: { key: 'peach', style: '', dark: false, name: '蜜桃奶霜', emoji: '🍑' },
    groups: [],
    current: 'peach'
  },

  onLoad() {
    this.setData({ skin: applySkin() });
    this.unsub = watchSkin(() => {
      this.setData({ skin: applySkin() });
      this.build();
    });
    this.build();
  },

  onUnload() {
    if (this.unsub) this.unsub();
  },

  onShow() {
    this.setData({ skin: applySkin() });
  },

  unsub: null as (() => void) | null,

  build() {
    const cur = getSkinKey();
    const groups = skinFamilies().map((g) => ({
      family: g.family,
      skins: g.skins.map((s) => ({
        ...s,
        previewStyle: buildSkinStyle(s.key),
        on: s.key === cur
      }))
    }));
    this.setData({ groups, current: cur });
  },

  onPick(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.v as SkinKey;
    if (!key) return;
    if (!guardTap('skin_' + key, 400)) return;
    if (key === this.data.current) return;
    setSkinKey(key);
    this.setData({ skin: applySkin(), current: key });
    const def = SKINS.find((s) => s.key === key);
    toast(def ? def.name : '已换');
    this.build();
  },

  /** 随机换一套（选择困难症友好） */
  onRandom() {
    if (!guardTap('random', 600)) return;
    const pool = SKINS.filter((s) => s.key !== this.data.current);
    const pickItem = pool[Math.floor(Math.random() * pool.length)];
    setSkinKey(pickItem.key);
    this.setData({ skin: applySkin(), current: pickItem.key });
    toast('换成「' + pickItem.name + '」');
    this.build();
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    return { title: '爱遇小栈 · 8 套皮肤随心情换', path: '/subpackages/love/pages/skin/skin' };
  }
});
