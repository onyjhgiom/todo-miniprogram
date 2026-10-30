// utils/love-beauty.ts
// 妆造顾问 · 妆容步骤 + 美甲款式
//
// 结构：妆感(8) × 场合(8) 组合出具体步骤。
// 「妆感」决定色系与质地方向，「场合」决定浓淡、持久度与重点部位——
// 两者叠加而不是二选一，才能给出「面试版的奶杏妆」这种真正能用的答案。
import { getBeauty } from './love-store';
import type { BeautyPrefs } from './love-types';

export interface MakeupStep {
  part: string;
  emoji: string;
  steps: string[];
  /** 关键产品方向（不指定品牌，只给品类与色号方向） */
  product: string;
}

export interface MakeupPlan {
  styleName: string;
  occasionName: string;
  /** 一句话总结 */
  summary: string;
  /** 预计耗时 */
  minutes: number;
  steps: MakeupStep[];
  /** 补妆要点 */
  touchUp: string[];
  /** 避雷 */
  avoid: string[];
  /** 色板（用于页面展示色卡） */
  palette: string[];
}

/* ============================ 妆感库 ============================ */

interface StyleDef {
  key: string;
  emoji: string;
  desc: string;
  minutes: number;
  palette: string[];
  /** 各部位的打法 */
  base: string[];
  brow: string[];
  eye: string[];
  cheek: string[];
  lip: string[];
  set: string[];
}

const STYLES: StyleDef[] = [
  {
    key: '清透裸妆',
    emoji: '🫧',
    desc: '像没化妆但状态很好，通勤/上课最不容易出错',
    minutes: 12,
    palette: ['#F2D9C9', '#E8C4A0', '#D98E73', '#B87A63'],
    base: ['妆前保湿做到位，等 2 分钟吸收再上底妆', '选轻薄水润粉底液/气垫，用量「一颗黄豆」，从面中往外拍开', '黑眼圈与泛红局部遮瑕即可，别全脸厚涂', '定妆只在 T 区轻扫散粉，两颊保留光泽'],
    brow: ['顺着原生眉形补空缺，眉笔选比发色浅一号', '眉头不画，只画中段到眉尾，最后用眉刷刷开'],
    eye: ['大地色哑光打底铺满眼窝，深一号的同色系压在眼尾三角区', '卧蚕位置点一点珠光，眼神立刻有神', '内眼线填睫毛根部即可，眼尾不要拉长', '睫毛夹翘后刷一层纤长型睫毛膏，根根分明比浓密更重要'],
    cheek: ['杏色/奶茶色腮红，扫在苹果肌最高点往太阳穴带', '用量宁少勿多，是「好气色」不是「腮红」'],
    lip: ['先用润唇膏打底 1 分钟再擦掉', '豆沙/奶茶色唇泥点涂中间，手指晕开边缘', '唇峰提一点点亮，但不画明显唇线'],
    set: ['全脸薄喷一层定妆喷雾', '出门前用纸巾轻压 T 区']
  },
  {
    key: '温柔奶杏',
    emoji: '🍑',
    desc: '奶fufu的杏色系，显白又亲和，约会首选',
    minutes: 18,
    palette: ['#F7DCC8', '#E9A87C', '#D97C6A', '#A9654F'],
    base: ['保湿妆前 + 半哑光粉底（比裸妆遮瑕力高一档）', '面中提亮、外轮廓阴影轻轻扫一圈，脸会小一圈', '定妆：T 区散粉，两颊用定妆喷雾'],
    brow: ['柔和的平弯眉，眉峰不要太锐利', '眉色选浅棕/灰棕，比发色浅半号更柔和'],
    eye: ['杏色打底 + 蜜桃色铺在眼窝前 2/3', '眼尾用红棕加深，画出「无辜感」的下至', '珠光点在眼球正上方与卧蚕', '眼线只填内眼线，眼尾平拉 2mm 不挑眼'],
    cheek: ['杏桃色腮红打在苹果肌，横向扫到颧骨', '可以叠一点点细闪，皮肤看上去更嫩'],
    lip: ['唇部遮瑕打底，模糊唇线', '奶杏色唇泥涂满后，中间叠一点豆沙色', '边缘用指腹晕开，做「咬唇」的柔化版本'],
    set: ['定妆喷雾 + 局部散粉', '带一支唇釉补唇色']
  },
  {
    key: '元气果汁',
    emoji: '🍊',
    desc: '高饱和果汁感，显年轻、上镜，聚会出游很出片',
    minutes: 20,
    palette: ['#FFD9C0', '#FF9E7A', '#E8625C', '#C43C55'],
    base: ['控油妆前（T 区）+ 持妆粉底', '遮瑕重点在痘印与鼻翼泛红', '定妆要到位：散粉 + 定妆喷雾两层'],
    brow: ['野生眉：眉笔一根根画，保留毛流感', '用染眉膏把眉毛颜色统一'],
    eye: ['橘色/珊瑚色大面积铺开，范围可以比日常大', '眼尾叠砖红增加层次', '亮片色点在眼中与眼头，闪片要选细腻的', '眼线用棕色，眼尾微微上扬'],
    cheek: ['橘调腮红扫在苹果肌到颧骨，量可以多一点', '鼻尖与下巴带一点，会显得很元气'],
    lip: ['橘红/番茄色唇釉，饱满涂满', '中间叠一层透明唇蜜，果汁感立刻出来'],
    set: ['散粉压 T 区，定妆喷雾全脸', '带吸油纸 + 同色唇釉']
  },
  {
    key: '复古港风',
    emoji: '🌹',
    desc: '红唇 + 挑眉 + 雾面底妆，气场与氛围感拉满',
    minutes: 28,
    palette: ['#E8C7B0', '#C4745C', '#A82C3C', '#7A1F2B'],
    base: ['雾面持妆粉底，遮瑕要干净', '修容比日常重一号：下颌线、鼻侧、眼窝', '定妆：全脸散粉压到完全哑光'],
    brow: ['挑眉！眉峰明确、眉尾细长，是港风的灵魂', '眉色用深棕/灰黑，画出利落的边缘'],
    eye: ['大地色打底 + 深棕压眼尾，范围偏长不偏圆', '眼线：眼尾拉长上扬，可以稍微粗一点', '睫毛要明显：夹翘 + 浓密型睫毛膏，或贴自然款假睫毛', '下眼影从眼尾往前扫 1/3'],
    cheek: ['修容型腮红（砖红/暗玫瑰）扫在颧骨下方，往里斜扫', '不要打在苹果肌，会破坏复古感'],
    lip: ['正红/复古红，先用唇线笔勾出清晰唇峰', '唇刷填色，边缘干净利落', '纸巾轻抿后再薄涂一层，持久度翻倍'],
    set: ['定妆喷雾', '带唇线笔与口红补唇，红唇掉色最明显']
  },
  {
    key: '清冷疏离',
    emoji: '🩶',
    desc: '低饱和灰调 + 冷感，高级脸与「生人勿近」的氛围',
    minutes: 20,
    palette: ['#E4E1E4', '#B9BFC7', '#8C93A1', '#5A6070'],
    base: ['哑光雾面底妆，遮瑕干净，追求「无瑕但无光」', '修容走冷调灰棕，别用暖色修容', '定妆用透明散粉压到全哑光'],
    brow: ['平直的一字眉，眉尾不要下垂', '灰棕色眉笔，边缘略模糊不锐利'],
    eye: ['灰棕/冷调大地色铺眼窝，范围偏大', '眼尾与下眼睑后 1/3 用深灰棕加深，营造疏离感', '珠光选冷调银白，只点在眼头', '眼线极细，只填内眼线，眼尾平拉'],
    cheek: ['几乎不用腮红，或用灰调裸色轻扫颧骨', '重点在阴影而不是红润'],
    lip: ['裸棕/豆沙灰调，唇线模糊', '中间一点点冷调光泽即可'],
    set: ['散粉 + 定妆喷雾', '带散粉补 T 区']
  },
  {
    key: '氛围烟熏',
    emoji: '🌘',
    desc: '眼妆为主角的夜晚妆，适合派对、演出、拍照',
    minutes: 32,
    palette: ['#CFC7C0', '#8E7F78', '#4A3F3C', '#20191B'],
    base: ['持妆雾面底妆，遮瑕要更干净（眼妆重时底妆必须清透）', '修容加重，让五官在浓眼妆下还能立住', '定妆两层'],
    brow: ['眉形清晰但不抢戏，深棕即可', '眉尾干净收细'],
    eye: ['第一步就铺最深色在眼尾，由深到浅往前晕', '用「渐进晕染」：深棕→中棕→浅棕三段过渡，边界必须晕开', '下眼睑全框，用深棕压在睫毛根部', '眼线加粗并晕开，与眼影融合', '珠光选细闪香槟色，只点眼中一点点', '睫毛必浓，可贴自然加重款'],
    cheek: ['腮红弱化处理，用裸棕/暗玫瑰轻扫', '把注意力让给眼睛'],
    lip: ['裸色/豆沙，唇部边缘柔化', '可以让唇部稍微有光泽，平衡眼部的哑光'],
    set: ['定妆喷雾', '带棉签（晕开的烟熏很容易积线）+ 散粉']
  },
  {
    key: '纯欲白开水',
    emoji: '💧',
    desc: '水光肌 + 无辜眼 + 嘟嘟唇，伪素颜的顶配版',
    minutes: 22,
    palette: ['#F5E3DA', '#EFC3B4', '#D98F8A', '#B8636A'],
    base: ['水光妆前 + 光泽型粉底，用量要薄', '高光：鼻梁、眉骨、唇峰、眼头，四点就够', '几乎不定妆，只在鼻翼压一点点散粉', '关键是「皮肤会发光」而不是「油」'],
    brow: ['柔和的自然眉，染眉膏把颜色刷浅', '不要太规整，留一点杂毛更自然'],
    eye: ['粉色/蜜桃哑光打底，眼尾用淡红棕加深一点点', '卧蚕是重点：阴影线 + 珠光提亮，眼睛立刻变大变无辜', '下眼睑前半段点珠光', '眼线只填睫毛根部，睫毛刷纤长款'],
    cheek: ['粉调腮红打在苹果肌偏上的位置，圆形扫开', '鼻尖也带一点，楚楚可怜的关窍'],
    lip: ['唇部遮瑕模糊唇线', '水红色/草莓色唇釉涂在唇中，向外晕开', '最后叠一层透明唇油，嘟嘟唇完成'],
    set: ['不定妆或用极少量定妆喷雾', '带唇油补涂']
  },
  {
    key: '日杂通勤',
    emoji: '☕',
    desc: '干净、利落、有分寸感，上班见客户都合适',
    minutes: 15,
    palette: ['#EFDCC9', '#D9B48F', '#B98A63', '#7A5B45'],
    base: ['半哑光持妆粉底，遮瑕均匀即可', '轻修容 + 鼻影，五官更精神', 'T 区散粉，两颊保留一点自然光泽'],
    brow: ['标准眉：眉头浅、眉峰清晰、眉尾利落', '颜色与发色一致，边缘干净'],
    eye: ['米棕/浅咖打底，深咖压眼尾', '眼线：棕色眼线笔填内眼线，眼尾平拉 1–2mm', '睫毛夹翘 + 纤长睫毛膏，根根分明', '不要亮片，通勤场合闪片会显得不够稳重'],
    cheek: ['裸棕/奶茶色斜扫颧骨，显干净利落', '别用粉嫩色，会和通勤氛围冲突'],
    lip: ['豆沙/玫瑰豆沙色，唇线清晰但不锋利', '哑光或半哑光质地，持久不沾杯'],
    set: ['T 区散粉 + 定妆喷雾', '带一支口红与吸油纸']
  }
];

export function makeupStyles(): { key: string; emoji: string; desc: string }[] {
  return STYLES.map((s) => ({ key: s.key, emoji: s.emoji, desc: s.desc }));
}

/* ============================ 场合调整 ============================ */

interface OccasionDef {
  key: string;
  emoji: string;
  /** 强度系数：<1 收敛，>1 加强 */
  intensity: number;
  focus: string;
  tips: string[];
}

const OCCASIONS: OccasionDef[] = [
  { key: '通勤', emoji: '💼', intensity: 0.9, focus: '干净、持久、不抢戏', tips: ['避开大亮片与高饱和唇', '定妆做足，空调房 + 口罩很考验持妆', '眉毛整理干净比眼影重要'] },
  { key: '约会', emoji: '💗', intensity: 1.05, focus: '近距离看也好看', tips: ['底妆务必服帖，近距离会看到卡粉', '卧蚕 + 珠光，眼神更有吸引力', '唇部用持久度中等的质地，别用太干的哑光'] },
  { key: '面试', emoji: '🎯', intensity: 0.75, focus: '可信、利落、有分寸', tips: ['饱和度整体降一档，突出的应该是你的表达', '眉毛与底妆是重点，眼影能省就省', '唇色选自然豆沙，别用正红'] },
  { key: '婚礼', emoji: '👰', intensity: 1.15, focus: '上镜 + 抗泪 + 持久', tips: ['防水睫毛膏与眼线，仪式很容易哭', '定妆两层 + 带散粉补妆', '如果你是宾客：别比新娘白、别比新娘艳'] },
  { key: '聚会', emoji: '🎉', intensity: 1.2, focus: '灯光下好看、上镜', tips: ['灯光会吃掉颜色，饱和度可以比日常高', '亮片与高光在夜场很好用', '带一支唇釉补妆'] },
  { key: '旅行', emoji: '🧳', intensity: 0.85, focus: '轻装 + 防晒 + 抗汗', tips: ['底妆越薄越好，暴汗会花', '防晒是第一步也是最重要一步', '用膏状腮红/唇颊两用，一物多用省空间'] },
  { key: '拍照', emoji: '📸', intensity: 1.2, focus: '轮廓与对比度', tips: ['相机吃妆，修容可以比日常重', '哑光底妆比水光更上镜', '唇色可以比日常深一号'] },
  { key: '日常', emoji: '☀️', intensity: 0.8, focus: '快速、舒服、不费劲', tips: ['5–10 分钟搞定的简化版就够', '防晒 + 眉毛 + 唇，三件套出门'] }
];

export function makeupOccasions(): { key: string; emoji: string; focus: string }[] {
  return OCCASIONS.map((o) => ({ key: o.key, emoji: o.emoji, focus: o.focus }));
}

/* ============================ 方案生成 ============================ */

function skinAdjust(skin: string): { base: string[]; avoid: string[] } {
  const map: Record<string, { base: string[]; avoid: string[] }> = {
    dry: {
      base: ['干皮：妆前保湿加一步面霜，等 3 分钟吸收', '粉底选水润/光泽型，避开哑光控油款', '散粉只在鼻翼与眼下轻扫，全脸定妆会卡纹'],
      avoid: ['厚散粉', '哑光雾面粉底', '含酒精的控油妆前']
    },
    oil: {
      base: ['油皮：T 区用控油妆前，两颊照常保湿', '粉底选持妆/控油型，薄涂两层比厚涂一层持久', '定妆：散粉压 T 区 → 全脸定妆喷雾 → 出油再补'],
      avoid: ['过于滋润的粉底霜', '大量高光（会和出油混在一起）']
    },
    comb: {
      base: ['混合皮：分区处理，T 区控油、两颊保湿', '粉底可以两种混用，或 T 区多压一层散粉'],
      avoid: ['全脸统一控油导致两颊起皮']
    },
    sensitive: {
      base: ['敏感肌：妆前简化，避免叠加太多层', '选无香精、成分表短的粉底，新粉底先做耳后测试', '卸妆要温和，别用力摩擦'],
      avoid: ['含酒精/香精的妆前', '强效去角质后立即上妆', '防水型产品（卸妆负担大）']
    }
  };
  return map[skin] || map.comb;
}

function tonePaletteAdjust(tone: string, palette: string[]): string[] {
  // 不同肤色在同一妆感下的色号方向不同，这里只做「方向提示」，不改色卡本身
  return palette;
}

export function buildMakeup(styleKey: string, occasionKey: string, prefs?: BeautyPrefs): MakeupPlan {
  const p = prefs || getBeauty();
  const style = STYLES.find((s) => s.key === styleKey) || STYLES[0];
  const occ = OCCASIONS.find((o) => o.key === occasionKey) || OCCASIONS[0];
  const adj = skinAdjust(p.skin || 'comb');

  const toneTip: Record<string, string> = {
    fair: '偏白肤色：几乎所有色号都能hold，注意别选过深的修容，会显脏',
    medium: '自然肤色：豆沙、奶茶、砖红最稳，荧光色与死亡芭比粉要避开',
    tan: '偏深肤色：选暖调、饱和度足够的颜色，太浅的粉会显灰'
  };

  const steps: MakeupStep[] = [
    { part: '底妆', emoji: '🫧', steps: style.base.concat(adj.base), product: '妆前 + 粉底 + 遮瑕 + 定妆' },
    { part: '眉毛', emoji: '🖌️', steps: style.brow, product: '眉笔 + 染眉膏' },
    { part: '眼妆', emoji: '👁️', steps: scaleEye(style.eye, occ.intensity), product: '眼影盘 + 眼线 + 睫毛膏' },
    { part: '腮红', emoji: '🌸', steps: scaleCheek(style.cheek, occ.intensity), product: '腮红（粉状/膏状）' },
    { part: '唇妆', emoji: '💋', steps: scaleLip(style.lip, occ.intensity), product: '唇部遮瑕 + 口红/唇釉' },
    { part: '定妆', emoji: '✨', steps: style.set, product: '定妆喷雾 + 散粉' }
  ];

  const palette = tonePaletteAdjust(p.tone, style.palette);

  return {
    styleName: style.key,
    occasionName: occ.key,
    summary: `${style.desc}｜${occ.focus}。${toneTip[p.tone || 'medium'] || ''}`,
    minutes: Math.round(style.minutes * occ.intensity),
    steps,
    touchUp: occ.tips,
    avoid: adj.avoid.concat(p.avoid ? [`你标注的避雷：${p.avoid}`] : []),
    palette
  };
}

function scaleEye(steps: string[], k: number): string[] {
  const out = steps.slice();
  if (k < 0.85) out.push('场合偏正式：珠光与亮片减量或省略，整体压到哑光');
  else if (k > 1.1) out.push('场合需要存在感：眼影范围可以比日常大，眼尾加深一档');
  return out;
}
function scaleCheek(steps: string[], k: number): string[] {
  const out = steps.slice();
  if (k < 0.85) out.push('腮红减量，远距离看不出但近看有气色就够了');
  else if (k > 1.1) out.push('腮红可以加重，配合灯光/镜头更有氛围');
  return out;
}
function scaleLip(steps: string[], k: number): string[] {
  const out = steps.slice();
  if (k < 0.85) out.push('唇色降一档饱和度，选自然色系');
  else if (k > 1.1) out.push('唇色可以比日常深/亮一号，增强整体完成度');
  return out;
}

/* ============================ 美甲 ============================ */

export interface NailDesign {
  key: string;
  emoji: string;
  name: string;
  /** 适合甲型 */
  shapes: string[];
  /** 风格标签 */
  tags: string[];
  colors: string[];
  pattern: string;
  /** 适合场合 */
  occasion: string[];
  /** 维持时长 */
  last: string;
  /** 参考价位 */
  price: string;
  /** 适配手型/肤色提示 */
  fit: string;
  /** 做法要点 */
  how: string[];
}

const NAIL_SHAPES = ['方圆', '椭圆', '尖圆', '方形', '杏仁'];

export function nailShapes(): string[] {
  return NAIL_SHAPES.slice();
}

const NAIL_DESIGNS: NailDesign[] = [
  {
    key: '法式极简', emoji: '🤍', name: '极简法式',
    shapes: ['方圆', '椭圆', '杏仁'], tags: ['极简', '通勤', '干净'],
    colors: ['#F7EFE6', '#FFFFFF', '#E8D9C5'],
    pattern: '裸粉底 + 甲缘一条极细白/金线',
    occasion: ['通勤', '面试', '日常', '婚礼'],
    last: '美甲店 3–4 周 / 家用 5–7 天',
    price: '120–280 元',
    fit: '最不挑手型，短甲也能做，显手指修长',
    how: ['底胶薄涂两层，每层照灯 30–60 秒', '甲缘线用细笔刷画，宁细勿粗', '线条画歪就用洗甲水棉片擦掉重来', '封层要包边，能多撑一周']
  },
  {
    key: '奶油胶', emoji: '🍦', name: '奶油晕染',
    shapes: ['方圆', '椭圆', '杏仁'], tags: ['温柔', '日常', '奶油'],
    colors: ['#F6E7D8', '#EFC9B4', '#E5A98F'],
    pattern: '奶茶色底 + 同色系深浅晕染，无明确边界',
    occasion: ['日常', '约会', '通勤'],
    last: '美甲店 3–4 周 / 家用 5–7 天',
    price: '150–320 元',
    fit: '黄皮友好，暖色调能让手部显白一个度',
    how: ['底色照干后，取两色在未照灯时快速点涂', '用干净笔刷轻扫交界，制造雾感过渡', '晕染要「没画完」的感觉才高级', '哑光封层会更像奶油']
  },
  {
    key: '猫眼', emoji: '🐱', name: '猫眼磁石',
    shapes: ['方圆', '尖圆', '杏仁'], tags: ['氛围', '闪', '夜场'],
    colors: ['#7A5C8F', '#3E3A56', '#9C7CB0'],
    pattern: '磁石粉在灯光下形成一条流动光带',
    occasion: ['聚会', '约会', '拍照'],
    last: '美甲店 3–4 周',
    price: '180–380 元',
    fit: '深色更显白，浅色更温柔；手指偏短选竖向光带',
    how: ['涂猫眼胶后**先别照灯**，用磁铁停留 10–15 秒', '磁铁距离甲面 2–3mm，太近会把光吸散', '想要宽光带就把磁铁立起来、窄光带就平放', '照灯后再上一层封层']
  },
  {
    key: '镜面', emoji: '🪞', name: '镜面金属',
    shapes: ['尖圆', '杏仁', '方形'], tags: ['酷', 'Y2K', '金属'],
    colors: ['#C0C0C8', '#E6C79B', '#8F8FA0'],
    pattern: '整甲高反射金属质感（银/金/枪色）',
    occasion: ['聚会', '拍照', '派对'],
    last: '美甲店 2–3 周（易刮花）',
    price: '200–420 元',
    fit: '长甲更出效果，短甲会显得笨重',
    how: ['镜面粉要用专用免洗封层打底', '照灯 30 秒（时间决定镜面亮度，过久会雾）', '趁热用硅胶头蹭粉，力度要均匀', '封层必须包边，镜面最容易从边缘起翘']
  },
  {
    key: '手绘', emoji: '🎨', name: '手绘小花',
    shapes: ['方圆', '椭圆'], tags: ['少女', '春夏', '可爱'],
    colors: ['#FDE8EC', '#F7B7C3', '#8FB88F'],
    pattern: '透明/奶白底 + 手绘小花朵或波点',
    occasion: ['日常', '约会', '旅行'],
    last: '美甲店 2–3 周 / 家用 4–6 天',
    price: '180–400 元（手绘按复杂度加价）',
    fit: '浅色显手白，深皮选亮色花朵更跳',
    how: ['底色要完全照干再画，否则会晕', '用点珠笔点花瓣，五点成一朵最省事', '只做 2–3 个甲做主花，其余留白更高级', '最后厚封层，手绘部分要完全覆盖']
  },
  {
    key: '碎钻', emoji: '💎', name: '碎钻点缀',
    shapes: ['尖圆', '杏仁', '方形'], tags: ['精致', '婚礼', '贵气'],
    colors: ['#F2E6E9', '#D9A7B0', '#C8C8D0'],
    pattern: '单色底 + 甲根或甲缘一排碎钻/钢珠',
    occasion: ['婚礼', '聚会', '拍照'],
    last: '美甲店 2–3 周（钻容易掉）',
    price: '220–480 元',
    fit: '短甲只做一条细边，不要满钻会显手短',
    how: ['用专用粘钻胶，不要用封层粘（会掉）', '钻排列用镊子一颗颗放，先摆好再照灯', '只做 1–2 个甲做重点，全手满钻很廉价', '边缘的钻最容易被蹭掉，尽量靠内']
  },
  {
    key: '晕染', emoji: '🌫️', name: '雾面晕染',
    shapes: ['方圆', '椭圆', '杏仁'], tags: ['高级', '莫兰迪', '秋冬'],
    colors: ['#C9C0BC', '#A79C9E', '#7D7375'],
    pattern: '莫兰迪灰调双色晕染 + 哑光封层',
    occasion: ['通勤', '日常', '拍照'],
    last: '美甲店 3 周左右',
    price: '160–340 元',
    fit: '最显高级，适合不想太招摇但要精致的场合',
    how: ['两色在未照灯时交界处轻扫', '哑光封层会让颜色变深一号，选色时预留', '哑光面更容易沾灰，做家务戴手套']
  },
  {
    key: '节日', emoji: '🎄', name: '节日氛围',
    shapes: ['方圆', '椭圆', '尖圆'], tags: ['节日', '趣味', '拍照'],
    colors: ['#C0392B', '#2E6B4F', '#F5E6C8'],
    pattern: '红绿/圣诞元素或当季主题图案',
    occasion: ['聚会', '拍照', '节日'],
    last: '1–2 周（节令款，过了就换）',
    price: '200–420 元',
    fit: '节令款，重点是氛围和合照，不必追求耐看',
    how: ['先用贴纸/转印贴打底，效率最高', '手绘部分控制在 2 个甲以内', '节日款建议做可卸的，方便及时换掉']
  },
  {
    key: '职场', emoji: '💼', name: '职场裸色',
    shapes: ['方圆', '椭圆'], tags: ['通勤', '极简', '得体'],
    colors: ['#EBC9B8', '#D9AE9C', '#C4917E'],
    pattern: '与指甲床接近的裸色，光泽自然',
    occasion: ['通勤', '面试', '正式'],
    last: '美甲店 3–4 周',
    price: '100–240 元',
    fit: '选「比指甲床深半号」的裸色最自然，太浅会显手黑',
    how: ['裸色最考验甲面打磨，死皮必须推干净', '薄涂三层比厚涂一层均匀', '甲缘留 0.5–1mm 空隙，长出来更好看']
  }
];

export function nailDesigns(): NailDesign[] {
  return NAIL_DESIGNS.slice();
}

/** 按甲型 + 偏好风格 + 场合推荐美甲 */
export function recommendNails(shape: string, styles: string[], occasion: string, tone: string): NailDesign[] {
  const list = NAIL_DESIGNS.slice();
  const scored = list.map((d) => {
    let s = 0;
    if (shape && d.shapes.indexOf(shape) >= 0) s += 3;
    (styles || []).forEach((st) => { if (d.tags.indexOf(st) >= 0) s += 3; });
    if (occasion && d.occasion.indexOf(occasion) >= 0) s += 4;
    if (tone === 'tan') s += /显白|暖色调/.test(d.fit) ? 2 : 0;
    return { d, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.d);
}

export function nailStyleTags(): string[] {
  const tags: string[] = [];
  NAIL_DESIGNS.forEach((d) => d.tags.forEach((t) => { if (tags.indexOf(t) < 0) tags.push(t); }));
  return tags;
}

/** 美甲的通用护理建议（不论选哪款都要看） */
export const NAIL_CARE: string[] = [
  '做美甲前 2 周别咬甲、别撕甲油，甲面损伤会直接缩短维持时间',
  '甲缘死皮用死皮剪/推棒处理，不要用手撕',
  '每次卸甲后至少休息 1 周，涂护甲油 + 指缘油',
  '做家务、洗碗戴手套，水和洗洁精是美甲的头号杀手',
  '指甲出现变薄、分层、发黄、疼痛 → 停做并就医，可能是感染或过敏'
];
