// utils/love-outfit.ts
// 穿搭与好物 · 成套搭配方案 + 商品推荐
//
// 【商品推荐的诚实边界】
//  本模块**不接任何电商 API**（比价/返利接口需要商务资质，且价格与库存实时变动）。
//  所以这里给的不是「某个商品链接」，而是：品类 + 材质 + 设计要点 + 参考价位区间 + 选购时的具体判断标准。
//  这五件事合起来，足以让用户在任何渠道（线下/电商/二手）自己挑对东西，且不会过期失效。
//  若后续部署了 cloudfunctions/love 的 goods action，可在云端补齐实时榜单，前端逻辑不变。
import { getWardrobe } from './love-store';
import type { WardrobePrefs, BudgetKey } from './love-types';

/* ============================ 风格库 ============================ */

export interface OutfitStyle {
  key: string;
  emoji: string;
  desc: string;
  /** 代表单品 */
  pieces: string[];
  /** 配色公式 */
  color: string;
  /** 鞋包方向 */
  shoes: string;
  bag: string;
  /** 首饰方向 */
  jewelry: string;
  /** 避雷 */
  avoid: string;
}

const STYLES: OutfitStyle[] = [
  {
    key: '温柔韩系', emoji: '🧸',
    desc: '低饱和 + 软糯材质 + 松弛廓形，最不挑人的日常风格',
    pieces: ['宽松针织开衫', '奶油色高腰直筒裤', '娃娃领衬衫', '软糯马海毛毛衣'],
    color: '主色奶白/燕麦 + 辅色雾蓝/灰粉，点缀一点点金属色',
    shoes: '厚底乐福鞋、玛丽珍、奶白色运动鞋',
    bag: '软质托特包、云朵包、腋下包',
    jewelry: '细链项链、小珍珠耳钉、细圈戒指',
    avoid: '全身上下都软塌塌没有一点结构，会显没精神；记得加一件有廓形的外套'
  },
  {
    key: '法式复古', emoji: '🥐',
    desc: '条纹、碎花、收腰、微露肤，慵懒但讲究',
    pieces: ['条纹针织', '茶歇裙', '高腰直筒牛仔', '方领泡泡袖上衣'],
    color: '藏蓝/米白/砖红三色为主，碎花选小朵密花',
    shoes: '芭蕾平底、粗跟玛丽珍、编织凉鞋',
    bag: '藤编包、复古方包、小马鞍包',
    jewelry: '金色硬币项链、贝母耳环、细手镯',
    avoid: '碎花 + 蕾丝 + 荷叶边全部叠一起，会变成「用力过猛」'
  },
  {
    key: '日系通勤', emoji: '☕',
    desc: '干净利落、版型合身、细节到位，上班最稳',
    pieces: ['白衬衫', '西装马甲', '锥形西裤', '针织背心'],
    color: '米白/藏青/深灰 + 一点点暖棕，避免全黑',
    shoes: '乐福鞋、低跟尖头鞋、干净的白色板鞋',
    bag: '结构感托特包、通勤单肩包（能装 A4）',
    jewelry: '简约腕表、小颗耳钉，夸张饰品收起来',
    avoid: '衣服太宽松显得像借来的；肩线与腰线要对'
  },
  {
    key: '辣妹甜酷', emoji: '🔥',
    desc: '露肤 + 收紧 + 金属/皮质元素，夜晚与拍照很有杀伤力',
    pieces: ['短款上衣', '工装/皮质半裙', '紧身连衣裙', '廓形西装外套'],
    color: '黑 + 银，或黑 + 亮色点缀，对比度要高',
    shoes: '厚底靴、尖头细高跟、马丁靴',
    bag: '链条包、腋下包、金属感小包',
    jewelry: 'choker、大耳环、层叠项链，可以夸张',
    avoid: '露肤点太多会失去重点——露肩就别露腿，露腿就收上身'
  },
  {
    key: '新中式', emoji: '🪷',
    desc: '立领、盘扣、真丝香云纱，东方感但不Cosplay',
    pieces: ['改良旗袍上衣', '真丝衬衫', '马面裙', '盘扣针织'],
    color: '月白/黛青/藕荷/墨绿，低饱和最出气质',
    shoes: '玛丽珍、绣花鞋、简约尖头平底',
    bag: '丝绸手拿包、竹编/漆器感小包',
    jewelry: '翡翠/珍珠耳饰、玉镯（或仿玉材质）',
    avoid: '立领 + 盘扣 + 旗袍 + 发髻全套上身会像参加演出，日常只取一个元素'
  },
  {
    key: '学院减龄', emoji: '🎒',
    desc: '格纹、百褶、针织背心，年轻感但不幼稚',
    pieces: ['百褶裙', '菱格针织背心', 'polo 领上衣', '格纹短裙'],
    color: '藏青/酒红/奶白 + 格纹，配白袜更到位',
    shoes: '厚底乐福、玛丽珍、老爹鞋',
    bag: '双肩包、剑桥包、小方包',
    jewelry: '极简，别抢戏，一对小耳钉足够',
    avoid: '袜子 + 鞋 + 裙长比例不对会显腿短：裙长在膝上 10cm 最佳'
  },
  {
    key: '极简高级', emoji: '🕊️',
    desc: '廓形 + 面料 + 配色，靠质感而不是设计说话',
    pieces: ['廓形西装', '真丝阔腿裤', '羊绒大衣', '基础款高领'],
    color: '同色系穿搭（全身一个色系深浅变化）最显贵',
    shoes: '尖头裸靴、极简小白鞋、细带凉鞋',
    bag: '无 Logo 结构包、大容量托特',
    jewelry: '只留一件：一块好表或一对耳钉',
    avoid: '极简最怕面料差——宁可少买一件，也要买材质好的'
  },
  {
    key: '户外机能', emoji: '🏕️',
    desc: '防风防水 + 多口袋 + 层次，周末出游与露营',
    pieces: ['冲锋衣', '工装裤', '抓绒内胆', '速干 T'],
    color: '大地色/军绿/黑灰，配一个亮色配件提亮',
    shoes: '登山鞋、老爹鞋、防水短靴',
    bag: '双肩机能包、腰包',
    jewelry: '运动手表、极简项链（避免勾挂）',
    avoid: '全身机能会像要去登山；日常混入一件基础款中和'
  }
];

export function outfitStyles(): { key: string; emoji: string; desc: string }[] {
  return STYLES.map((s) => ({ key: s.key, emoji: s.emoji, desc: s.desc }));
}

/* ============================ 场合与季节 ============================ */

const OCCASION_OUTFIT: Record<string, { emoji: string; rule: string; key: string[] }> = {
  通勤: { emoji: '💼', rule: '正式度 3–4：肩线要对、长度过膝、配色不超过 3 个', key: ['日系通勤', '极简高级', '温柔韩系'] },
  约会: { emoji: '💗', rule: '正式度 2–3：露一个部位、加一处柔软元素（针织/真丝/香氛）', key: ['温柔韩系', '法式复古', '纯欲'] },
  面试: { emoji: '🎯', rule: '正式度 4：合身、低饱和、鞋子必须干净，饰品减到最少', key: ['日系通勤', '极简高级'] },
  婚礼: { emoji: '👰', rule: '正式度 3–4：避开纯白与大红（别抢新娘），米色/雾霾蓝/香槟色最安全', key: ['法式复古', '温柔韩系'] },
  聚会: { emoji: '🎉', rule: '正式度 2–3：可以有一点亮片/金属，但只留一个重点', key: ['辣妹甜酷', '极简高级'] },
  旅行: { emoji: '🧳', rule: '舒适度优先：一双能走 1 万步的鞋 + 一件抗温差外套', key: ['户外机能', '温柔韩系'] },
  日常: { emoji: '☀️', rule: '舒服为主，但别放弃腰线——腰线是「随便穿」和「随便」的分界', key: ['温柔韩系', '学院减龄'] },
  运动: { emoji: '🏃', rule: '功能优先：支撑型内衣 + 透气面料 + 减震鞋', key: ['户外机能'] }
};

export function outfitOccasions(): string[] {
  return Object.keys(OCCASION_OUTFIT);
}

export function occasionRule(occ: string): string {
  return (OCCASION_OUTFIT[occ] || OCCASION_OUTFIT['日常']).rule;
}

/* ============================ 身形适配 ============================ */

const BODY_TIP: Record<string, { label: string; do: string[]; dont: string[] }> = {
  pear: {
    label: '梨形（胯宽肩窄）',
    do: ['上装选有设计感的：泡泡袖、荷叶边、亮色、垫肩都可以', '下装选 A 字裙 / 直筒裤 / 阔腿裤，深色更稳', '把视觉重心往上移：项链、耳环、亮色上衣'],
    dont: ['紧身包臀裙、铅笔裤', '长度卡在小腿最粗处的裙子', '上深下浅的配色（会加重下半身）']
  },
  apple: {
    label: '苹果形（腰腹有肉）',
    do: ['上装选垂感好的宽松款 / V 领，拉长脖颈', '高腰下装 + 把上衣下摆塞进去一点，制造腰线', '外套敞开穿，纵向线条显瘦'],
    dont: ['腰部有褶皱/系带的收腰款', '紧身针织', '短上衣 + 低腰裤（会把腰腹完全暴露）']
  },
  hourglass: {
    label: '沙漏形（胸腰臀比例明显）',
    do: ['收腰！腰带、系带、收腰连衣裙都是你的武器', '选贴合但不紧绷的面料', '包臀裙、鱼尾裙可以大胆穿'],
    dont: ['oversize 茧型（会把优势全遮住）', '直筒无腰线的连衣裙']
  },
  rectangle: {
    label: 'H 形（腰线不明显）',
    do: ['用腰带 / 高腰下装 / 短上衣制造腰线', '叠穿造层次：衬衫 + 马甲、T + 开衫', '选有廓形的下装（伞裙、阔腿）'],
    dont: ['上下一般宽的直筒连衣裙', '低腰裤']
  },
  inverted: {
    label: '倒三角（肩宽胯窄）',
    do: ['下装加量感：A 字裙、百褶、阔腿、工装', '上装选 V 领 / 简单款，避开肩部装饰', '深色上装 + 浅色/有图案下装'],
    dont: ['垫肩、泡泡袖、一字领', '紧身铅笔裤（会显得头重脚轻）']
  }
};

export function bodyTip(body: string) {
  return BODY_TIP[body] || BODY_TIP.pear;
}

export function bodyOptions(): { key: string; label: string }[] {
  return Object.keys(BODY_TIP).map((k) => ({ key: k, label: BODY_TIP[k].label }));
}

/* ============================ 成套方案生成 ============================ */

export interface OutfitPiece {
  slot: string;
  emoji: string;
  name: string;
  detail: string;
  price: string;
}

export interface OutfitPlan {
  style: string;
  occasion: string;
  season: string;
  temp: string;
  summary: string;
  pieces: OutfitPiece[];
  color: string;
  bodyLines: string[];
  tips: string[];
  /** 总预算区间 */
  budget: string;
}

const SEASON_LAYER: Record<string, { coat: string; price: string }> = {
  春: { coat: '薄风衣 / 针织开衫 / 西装外套', price: '300–900' },
  夏: { coat: '真丝衬衫外搭 / 薄防晒开衫', price: '150–500' },
  秋: { coat: '西装外套 / 皮衣 / 针织开衫', price: '400–1200' },
  冬: { coat: '羊毛大衣 / 羽绒服 / 羊绒外套', price: '800–3000' }
};

const TEMP_NOTE: { max: number; text: string }[] = [
  { max: 5, text: '严寒：保暖优先，内薄外厚；亮色配件打破沉闷' },
  { max: 12, text: '偏冷：外套 + 中间层，围巾既保暖又是造型重点' },
  { max: 20, text: '凉爽：单穿 + 一件可脱外套最灵活' },
  { max: 26, text: '舒适：单层就够，面料可以玩起来' },
  { max: 99, text: '炎热：棉麻真丝优先，浅色比深色凉快很多' }
];

export function buildOutfit(styleKey: string, occasionKey: string, season: string, tempText: string, prefs?: WardrobePrefs): OutfitPlan {
  const p = prefs || getWardrobe();
  const style = STYLES.find((s) => s.key === styleKey) || STYLES[0];
  const occ = OCCASION_OUTFIT[occasionKey] || OCCASION_OUTFIT['日常'];
  const seasonKey = season || currentSeason();
  const layer = SEASON_LAYER[seasonKey] || SEASON_LAYER['春'];
  const temp = parseInt(String(tempText || '').replace(/[^\d-]/g, ''), 10);
  const tNote = TEMP_NOTE.find((t) => (isNaN(temp) ? t.max === 99 : temp <= t.max)) || TEMP_NOTE[TEMP_NOTE.length - 1];
  const band = BAND[p.budget || 'entry'];
  const bt = bodyTip(p.body);

  const pieces: OutfitPiece[] = [
    { slot: '外套', emoji: '🧥', name: layer.coat, detail: `${style.key}取向：${seasonKey === '夏' ? '选薄款、透气面料' : '肩线要落得准，长度按身高选（小个子到腰臀之间最显高）'}`, price: scalePrice(layer.price, band.k) },
    { slot: '上装', emoji: '👚', name: style.pieces[0], detail: `材质建议：${seasonKey === '夏' ? '棉麻 / 真丝' : (seasonKey === '冬' ? '羊绒 / 厚针织' : '针织 / 衬衫')}`, price: scalePrice('200–600', band.k) },
    { slot: '下装', emoji: '👖', name: style.pieces[1], detail: `按身形选：${bt.do[1] || bt.do[0]}`, price: scalePrice('250–800', band.k) },
    { slot: '鞋', emoji: '👟', name: style.shoes, detail: `${occ.rule.split('：')[0]}场景；${p.height === 'petite' ? '小个子可选带跟或厚底，视觉拉长' : '以舒适与风格匹配为主'}`, price: scalePrice('300–1200', band.k) },
    { slot: '包', emoji: '👜', name: style.bag, detail: '通勤要能装 A4；约会/聚会可以换成小包，轻便更重要', price: scalePrice('300–2000', band.k) },
    { slot: '首饰', emoji: '💍', name: style.jewelry, detail: '首饰遵循「一个重点」原则：戴了耳环就别再戴项链叠层', price: scalePrice('100–800', band.k) }
  ];

  const tips: string[] = [
    occ.rule,
    tNote.text,
    style.avoid,
    `配色公式：${style.color}`
  ];
  if (p.avoid) tips.push(`你的避雷：${p.avoid}`);
  if (p.colors && p.colors.length) tips.push(`你偏好的色系：${p.colors.join('、')}，优先在这些色里挑`);

  return {
    style: style.key,
    occasion: occasionKey,
    season: seasonKey,
    temp: tempText,
    summary: `${style.desc}｜${occ.rule}`,
    pieces,
    color: style.color,
    bodyLines: bt.do.concat(bt.dont.map((d) => `少穿：${d}`)),
    tips,
    budget: band.totalText
  };
}

function currentSeason(): string {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

/* ============================ 好物推荐（按预算档） ============================ */

export interface BudgetBand {
  key: BudgetKey;
  label: string;
  /** 价格系数 */
  k: number;
  /** 单件预算建议 */
  single: string;
  totalText: string;
  /** 这一档的采购策略 */
  strategy: string;
}

export const BAND: Record<BudgetKey, BudgetBand> = {
  student: {
    key: 'student', label: '学生党（月支配 <1500）', k: 0.5,
    single: '单件 100–400，鞋包可到 600',
    totalText: '整套 600–1500',
    strategy: '少买、买基础款、买版型：一件好版型的白衬衫比三件花哨的上衣更值。二手平台与季末折扣是好朋友。'
  },
  entry: {
    key: 'entry', label: '入门（1500–4000）', k: 0.8,
    single: '单件 200–800，外套/包可到 1500',
    totalText: '整套 1500–3500',
    strategy: '把钱花在使用频率最高的三件上：外套、鞋、包。这三件决定了别人对你穿搭的第一印象。'
  },
  mid: {
    key: 'mid', label: '进阶（4000–9000）', k: 1.2,
    single: '单件 500–2000，大件可到 4000',
    totalText: '整套 3000–8000',
    strategy: '可以开始买材质：羊绒、真丝、头层牛皮。同价位里材质比设计更保值，也更耐穿。'
  },
  upper: {
    key: 'upper', label: '轻奢（9000–20000）', k: 2.0,
    single: '单件 1500–5000',
    totalText: '整套 8000–20000',
    strategy: '建立「少而精」的胶囊衣橱：30 件以内覆盖全年。经典款 + 少量设计师款，避免追趋势。'
  },
  lux: {
    key: 'lux', label: '高端（>20000）', k: 3.5,
    single: '单件 5000 以上',
    totalText: '整套 20000+',
    strategy: '优先投资能长期陪伴的单品：大衣、皮具、腕表、珠宝。注意保养成本与真伪渠道。'
  }
};

export function budgetBands(): BudgetBand[] {
  return ['student', 'entry', 'mid', 'upper', 'lux'].map((k) => BAND[k as BudgetKey]);
}

/** 把基准价位按预算档缩放（仅用于给出参考区间） */
function scalePrice(base: string, k: number): string {
  const nums = base.match(/\d+/g);
  if (!nums || nums.length < 2) return base;
  const a = Math.round((Number(nums[0]) * k) / 50) * 50;
  const b = Math.round((Number(nums[1]) * k) / 50) * 50;
  return `${a}–${b} 元`;
}

export interface GoodItem {
  cat: string;
  emoji: string;
  name: string;
  /** 材质/设计要点 */
  spec: string;
  /** 参考价位 */
  price: string;
  /** 选购时的具体判断标准 */
  how: string;
  /** 避雷 */
  trap: string;
}

const GOODS: GoodItem[] = [
  {
    cat: '包袋', emoji: '👜', name: '通勤托特包',
    spec: '头层牛皮或高密度尼龙，能装 A4 + 水杯，自重 <700g',
    price: '300–2500',
    how: '装满东西拎起来走两步，肩带不勒、底部不塌才算合格；检查五金开合 20 次顺不顺',
    trap: '自重超过 1kg 的包，通勤每天背是酷刑'
  },
  {
    cat: '包袋', emoji: '👛', name: '腋下包 / 法棍包',
    spec: '短肩带、贴腋下，长度到腰线最显比例',
    price: '200–2000',
    how: '肩带长度要让包体落在腰线附近，太高显壮、太低显矮',
    trap: '太宽的包体会把上半身横向拉宽'
  },
  {
    cat: '包袋', emoji: '🎒', name: '双肩 / 机能包',
    spec: '分区合理、背部有支撑、防泼水',
    price: '200–1500',
    how: '背上有电脑时看背部是否贴合、肩带是否加宽',
    trap: '只看颜值不看背负系统，背一天肩膀会抗议'
  },
  {
    cat: '首饰', emoji: '💍', name: '细链项链',
    spec: '18K 金 / 925 银镀金，链长 40–45cm 最百搭',
    price: '150–1800',
    how: '看扣头与焊接点；皮肤敏感选 18K 金或钛钢，避开合金',
    trap: '几十块的合金项链戴两周就掉色，不如买一条银的'
  },
  {
    cat: '首饰', emoji: '💎', name: '耳环（耳钉 / 耳线）',
    spec: '耳针要 925 银或 18K 金，防过敏；耳线长度按脸型选',
    price: '100–1200',
    how: '圆脸选长款耳线拉长脸型，长脸选耳钉或短款；敏感耳洞务必看材质',
    trap: '合金耳针是耳洞发炎的头号元凶'
  },
  {
    cat: '首饰', emoji: '⌚', name: '腕表',
    spec: '石英省心 / 机械有质感；表盘直径按手腕围选',
    price: '500–8000',
    how: '表盘直径 ≈ 手腕宽度的 1/2 最协调；日常选 28–34mm',
    trap: '盲目追大表盘，小手腕戴起来像借的'
  },
  {
    cat: '首饰', emoji: '📿', name: '珍珠 / 贝母饰品',
    spec: '淡水珍珠看光泽与圆度，贝母看厚度与虹彩',
    price: '200–3000',
    how: '珍珠对着光转动，光泽越锐越好；微微瑕疵是天然的证明',
    trap: '完美无瑕又极便宜的「珍珠」基本是塑料珠'
  },
  {
    cat: '配饰', emoji: '🧣', name: '真丝丝巾',
    spec: '真丝（桑蚕丝）含量 100%，尺寸 53×53cm 或 90×90cm',
    price: '150–1500',
    how: '揉成一团松开看回弹，真丝皱得慢且能恢复；燃烧法可验（真丝是毛发味）',
    trap: '「真丝感」= 聚酯纤维，闷且不透气'
  },
  {
    cat: '配饰', emoji: '🕶️', name: '墨镜',
    spec: 'UV400 是硬指标，镜框按脸型选',
    price: '150–2000',
    how: '必须有 UV400 标识；圆脸选方框，方脸选圆框/飞行员款',
    trap: '几十块的染色镜片没有防紫外线，反而伤眼（瞳孔放大让更多紫外线进入）'
  },
  {
    cat: '配饰', emoji: '🧢', name: '帽子（棒球帽 / 贝雷帽）',
    spec: '帽围可调节，帽檐按脸型宽窄选',
    price: '80–800',
    how: '帽檐略宽于颧骨最显脸小；试戴时看后脑是否空太多',
    trap: '材质太软的帽子洗一次就塌'
  },
  {
    cat: '香氛', emoji: '🌷', name: '香水',
    spec: '淡香水 EDT 日常、浓香精 EDP 夜晚；先买小样',
    price: '200–1500',
    how: '必须试在手腕上等 30 分钟看中后调，前调好闻不代表适合你',
    trap: '盲买正装是最容易踩的雷，先买 2ml 小样'
  },
  {
    cat: '鞋', emoji: '👟', name: '通勤鞋（乐福 / 尖头）',
    spec: '真皮内里，鞋跟 2–5cm，前掌有软垫',
    price: '300–1500',
    how: '下午脚微肿时试鞋；穿上走 20 步，脚趾前留 1cm 空间',
    trap: '新鞋「穿穿就松」只针对真皮，合成革不会松'
  },
  {
    cat: '鞋', emoji: '🥾', name: '短靴 / 长靴',
    spec: '靴筒贴合不勒小腿，鞋底防滑',
    price: '400–2500',
    how: '靴筒与小腿间留一指空隙最舒服；长靴要坐下试，看膝后是否卡',
    trap: '靴筒过紧会让小腿看起来更粗'
  },
  {
    cat: '服饰', emoji: '🧥', name: '大衣 / 外套',
    spec: '羊毛含量 ≥50%（大衣）；肩线、袖长是命门',
    price: '600–4000',
    how: '肩线落在肩端点、袖长到腕骨；抬手看背部是否绷',
    trap: '只看款式不看肩线，是「穿上就是不对劲」的根源'
  },
  {
    cat: '服饰', emoji: '👚', name: '针织衫',
    spec: '看成分：羊绒 > 美利奴羊毛 > 棉 > 普通羊毛 > 化纤',
    price: '150–1800',
    how: '拉开看回弹；起球程度捏一捏就能预判',
    trap: '「羊绒感」多为化纤，静电且不保暖'
  }
];

export function goodsCategories(): string[] {
  const list: string[] = [];
  GOODS.forEach((g) => { if (list.indexOf(g.cat) < 0) list.push(g.cat); });
  return list;
}

/** 按品类 + 预算档推荐好物 */
export function recommendGoods(cat: string, band: BudgetKey, style: string): GoodItem[] {
  const b = BAND[band] || BAND.entry;
  const list = GOODS.filter((g) => !cat || cat === '全部' || g.cat === cat);
  return list.map((g) => ({
    ...g,
    price: scalePrice(g.price, b.k),
    how: `${g.how}｜${b.strategy}`
  }));
}

export { STYLES };
