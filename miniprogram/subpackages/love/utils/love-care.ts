// utils/love-care.ts
// 自在养护 · 皮肤 / 头发 / 身体护理方案 + 体检疫苗提醒
//
// 【边界】全部是常识级护理建议，不做诊断、不推荐处方药。
// 出现「就医红线」时明确写「去看医生」，而不是继续给缓解办法。
import {
  getSkinProfile, getHairProfile, getBodyProfile, loadCareChecks,
  todayYmd, addDays, diffDays, fmtYmd
} from './love-store';
import { analyze } from './love-cycle';
import type { SkinProfile, HairProfile, BodyProfile, CareCheck } from './love-types';

export interface CareStep {
  title: string;
  detail: string;
}

/* ============================ 一、皮肤护理 ============================ */

export interface SkinPlan {
  /** 肤质一句话画像 */
  summary: string;
  am: CareStep[];
  pm: CareStep[];
  weekly: string[];
  /** 按诉求给出的专项方案 */
  focus: { concern: string; ingredients: string; freq: string; caution: string }[];
  sun: string[];
  caution: string[];
}

const SKIN_TYPE_TIP: Record<string, string> = {
  dry: '干皮：屏障偏薄、易起皮卡粉，核心是「补油 + 少折腾」',
  oil: '油皮：皮脂旺盛、毛孔易堵，核心是「温和清洁 + 控油不脱水」',
  comb: '混合皮：T 区油、两颊干，核心是「分区护理」',
  sensitive: '敏感肌：屏障受损、易泛红刺痛，核心是「做减法 + 修护」',
  normal: '中性皮：底子好但别挥霍，核心是「维稳 + 防晒」'
};

const CLEANSER: Record<string, string> = {
  dry: '氨基酸洁面（无泡或低泡），水温 32–34℃，早晚各一次即可，早上甚至可以只用清水',
  oil: '氨基酸复配少量皂基，重点洗 T 区；一天不超过 2 次，洗完不紧绷才是对的',
  comb: '全脸氨基酸洁面，T 区多打圈 5 秒，两颊一带而过',
  sensitive: '无香精无酒精的氨基酸洁面，早上清水、晚上洁面，水温偏凉',
  normal: '氨基酸洁面，按出油情况早晚各一次'
};

const MOISTURIZER: Record<string, string> = {
  dry: '面霜 > 乳液，选含神经酰胺 / 角鲨烷 / 胆固醇的修护型，秋冬加一滴护肤油',
  oil: '清爽凝露或乳液，含烟酰胺 / 泛醇，避开厚重矿脂',
  comb: '两颊用面霜、T 区用凝露，分两遍上',
  sensitive: '含神经酰胺 / 积雪草 / 泛醇的修护霜，成分表越短越好',
  normal: '按季节切换：春夏乳液、秋冬面霜'
};

const SUNSCREEN: Record<string, string> = {
  indoor: 'SPF30 PA+++ 通勤够用；靠窗坐或通勤超 20 分钟建议补一次',
  normal: 'SPF50 PA++++，早上一次，中午外出前补涂一次',
  outdoor: 'SPF50+ PA++++ 防水型，每 2 小时补涂，配合帽子墨镜'
};

const CONCERN_LIB: Record<string, { ingredients: string; freq: string; caution: string }> = {
  美白提亮: {
    ingredients: 'VC 及其衍生物、烟酰胺（2–5%）、传明酸、熊果苷、377',
    freq: '白天 VC + 防晒，晚上烟酰胺或传明酸；8–12 周看效果',
    caution: '高浓度 VC 与酸类不要同晚用；烟酰胺不耐受就降到 2% 起步'
  },
  抗痘祛痘: {
    ingredients: '水杨酸（BHA 2%）、过氧化苯甲酰（点涂）、壬二酸、茶树精油（辅助）',
    freq: '水杨酸隔天或一周 2–3 次；过氧化苯甲酰点涂，别全脸糊',
    caution: '不要挤！挤了留印留坑；同时用两种酸会烂脸'
  },
  淡印去印: {
    ingredients: '壬二酸、烟酰胺、VC、积雪草、肝素钠类',
    freq: '每天坚持 + 严格防晒，红色痘印 4–8 周、褐色 3–6 个月',
    caution: '不防晒一切淡印都白做；炎症期先消炎再淡印'
  },
  抗老紧致: {
    ingredients: 'A 醇（视黄醇）、胜肽、玻色因、艾地苯',
    freq: 'A 醇从 0.1% 起步，一周 2 次 → 逐渐加到隔天；必须晚上用',
    caution: 'A 醇 + 酸不要同晚；孕期哺乳期禁用 A 醇；白天必须防晒'
  },
  保湿补水: {
    ingredients: '神经酰胺、玻尿酸、泛醇、角鲨烷、甘油',
    freq: '早晚都用；洗完脸 30 秒内上，锁水效果差一倍',
    caution: '干到脱皮就先修护屏障，别急着上功效型'
  },
  收缩毛孔: {
    ingredients: '水杨酸、烟酰胺、A 醇（长期）、壬二酸',
    freq: '酸类一周 2–3 次，配合清洁泥膜一周一次',
    caution: '毛孔不会「消失」只能视觉变小；撕拉鼻贴会让毛孔更大'
  },
  舒缓修护: {
    ingredients: '积雪草、泛醇、神经酰胺、马齿苋、β-葡聚糖',
    freq: '泛红期精简为「洁面 + 修护霜 + 防晒」，停用一切功效型 2 周',
    caution: '换季/刷酸后泛红，先停用再修护，别叠加更多产品'
  },
  控油: {
    ingredients: '烟酰胺、锌 PCA、水杨酸、控油散粉（物理）',
    freq: '烟酰胺早晚用，水杨酸一周 2–3 次',
    caution: '别用吸油纸狂吸、别频繁洗脸，越洗越油'
  }
};

export function skinPlan(p?: SkinProfile): SkinPlan {
  const s = p || getSkinProfile();
  const t = s.type || 'comb';
  const concerns = (s.concerns && s.concerns.length ? s.concerns : ['保湿补水']);
  const focus = concerns
    .map((c) => ({ concern: c, ...(CONCERN_LIB[c] || CONCERN_LIB['保湿补水']) }))
    .slice(0, 3);

  const am: CareStep[] = [
    { title: '① 清洁', detail: CLEANSER[t] },
    { title: '② 爽肤水', detail: t === 'oil' ? '清爽型化妆水轻拍，别用含酒精的收敛水' : '保湿型化妆水，手心温热后按压上脸' },
    { title: '③ 精华', detail: concerns.indexOf('美白提亮') >= 0 ? 'VC 类抗氧化精华（干皮可用 VC 衍生物更温和）' : (t === 'dry' ? '玻尿酸/神经酰胺精华打底' : '烟酰胺或保湿精华，薄薄一层') },
    { title: '④ 乳/霜', detail: MOISTURIZER[t] },
    { title: '⑤ 防晒（最关键一步）', detail: SUNSCREEN[s.sun || 'normal'] + '；全脸用量约一枚一元硬币，脖子再加一半' }
  ];

  const pm: CareStep[] = [
    { title: '① 卸妆', detail: '化妆就卸：卸妆膏/油干手干脸按摩 30 秒再加水乳化；只涂防晒可用卸妆乳或温和洁面' },
    { title: '② 洁面', detail: CLEANSER[t] },
    { title: '③ 水 / 精华', detail: s.active ? '功效型精华（酸 / A 醇）按频率上，不要每天都用' : '保湿精华打底' },
    { title: '④ 眼霜', detail: '20+ 就可以用，米粒大小点涂，无名指轻拍，别拉扯' },
    { title: '⑤ 面霜', detail: MOISTURIZER[t] + '；秋冬可叠一层薄薄的护肤油封住水分' }
  ];

  const weekly: string[] = [
    t === 'sensitive'
      ? '敏感期不做去角质与清洁面膜，只做修护面膜（一周 1–2 次）'
      : (t === 'oil' ? '清洁泥膜一周 1–2 次（只敷 T 区）；去角质一周 1 次' : '去角质一周 1 次；保湿面膜一周 2–3 次'),
    '面膜敷 10–15 分钟就够，敷到干会反吸水',
    '枕套一周换一次、化妆刷两周洗一次——很多人爆痘的真凶在这里'
  ];

  const sun: string[] = [
    '防晒是性价比最高的抗老 + 美白手段，比任何精华都重要',
    '阴天/室内靠窗也有 UVA，通勤日也建议涂',
    '补涂：户外每 2 小时，办公室中午一次；带防晒喷雾或防晒粉饼更方便',
    '硬防晒更狠：帽子 + 墨镜 + 遮阳伞，比补涂省事'
  ];

  const caution: string[] = [];
  if (s.allergy) caution.push(`你标注的避雷成分：${s.allergy} —— 买新产品前先看成分表`);
  caution.push('酸类 + A 醇不要同一次使用，至少隔天');
  caution.push('新护肤品先在耳后或下颌试 3 天，没问题再全脸');
  if (s.active) caution.push('在用功效型产品期间，经期与黄体期皮肤更敏感，可临时降频');
  caution.push('孕期 / 哺乳期：A 醇、水杨酸高浓度、氢醌都不建议用，请先问医生');

  return {
    summary: SKIN_TYPE_TIP[t] || SKIN_TYPE_TIP.comb,
    am, pm, weekly, focus, sun, caution
  };
}

/* ============================ 二、头发护理 ============================ */

export interface HairPlan {
  summary: string;
  /** 建议洗头频率 */
  freqText: string;
  wash: CareStep[];
  care: string[];
  concerns: { concern: string; steps: string[] }[];
  caution: string[];
}

const SCALP_TIP: Record<string, string> = {
  oil: '油性头皮：容易塌、一天就油，核心是「清洁到位但不刺激、少折腾」',
  dry: '干性头皮：易痒、有干屑，核心是「降低清洁力 + 补水」',
  sensitive: '敏感头皮：易红痒刺痛，核心是「无香精无酒精、少烫染」',
  dandruff: '有头屑：可能是脂溢性皮炎，核心是「抗真菌洗剂 + 规律作息」',
  normal: '中性头皮：底子不错，维持现在的节奏就好'
};

const HAIR_FREQ: Record<string, string> = {
  oil: '建议 1 天 1 次（夏天可早晚各一次，第二次只用清水或少量洗发水）',
  dry: '建议 2–3 天 1 次，洗太勤会更干',
  sensitive: '建议 2 天 1 次，选无香精无色素的温和洗发水',
  dandruff: '建议 1–2 天 1 次；用含吡硫翁锌 / 二硫化硒 / 酮康唑的洗剂，停留 3–5 分钟再冲',
  normal: '建议 1–2 天 1 次，按出油情况自己调'
};

const HAIR_CONCERN: Record<string, string[]> = {
  油塌: [
    '洗发水选清爽控油型，护发素只涂发中到发尾，绝对别碰头皮',
    '吹风机先吹发根、低头倒着吹，蓬松度立刻不一样',
    '少用手摸头发、刘海油了用散粉或免洗喷雾救急',
    '检查是不是护发素/发膜涂到头皮了——这是最常见的致塌原因'
  ],
  毛躁: [
    '洗完趁湿涂护发精油（发中到发尾），再吹',
    '吹风机温度别开最高，距离 15cm，顺着毛鳞片从上往下吹',
    '换成真丝枕套，摩擦少一半，早上起来不炸毛',
    '发膜一周 1–2 次，涂完包热毛巾 10 分钟效果翻倍'
  ],
  脱发: [
    '先判断：每天掉 50–100 根属正常代谢，超过且持续要重视',
    '扎头发别太紧，高马尾/丸子头长期牵拉会导致发际线后移（牵拉性脱发）',
    '检查铁蛋白、甲功、维生素 D——女生缺铁性脱发非常常见',
    '压力性休止期脱发多在事件后 2–3 个月出现，通常可自行恢复',
    '⚠️ 发际线明显后移、头顶稀疏、成块脱落 → 请去皮肤科/毛发门诊，别信生发洗发水'
  ],
  头屑: [
    '换抗屑洗剂（吡硫翁锌 / 二硫化硒 / 酮康唑），一周 2–3 次，停留 3–5 分钟',
    '洗头时用指腹按摩不要用指甲抓，抓破会加重',
    '少吃高糖高油，熬夜会让头屑明显加重',
    '⚠️ 大片红斑、厚痂、痒到睡不着 → 可能是脂溢性皮炎或银屑病，就医'
  ],
  分叉: [
    '分叉无法「修复」，只能剪掉；先修剪再保养',
    '发膜一周 1–2 次 + 每天护发精油，预防新的分叉',
    '减少高温造型：卷发棒温度 ≤180℃，每周不超过 2 次，上造型前用隔热喷雾'
  ],
  头顶稀疏: [
    '发型上：层次剪 + 头顶打薄反向、摩根烫或蓬松粉，视觉增厚',
    '避免中分贴头皮，改侧分或三七分',
    '⚠️ 持续加重请去毛发门诊，越早干预效果越好'
  ],
  染烫修复: [
    '烫染间隔至少 3 个月，漂发建议半年以上再做',
    '染后 48 小时不要洗头，让色素稳定',
    '用护色洗发水（无硫酸盐）+ 发膜，洗发水温调低',
    '⚠️ 头皮刺痛、红肿、大量掉发 → 立刻停用并就医'
  ]
};

export function hairPlan(p?: HairProfile): HairPlan {
  const h = p || getHairProfile();
  const scalp = h.scalp || 'normal';
  const concerns = (h.concerns && h.concerns.length ? h.concerns : ['毛躁']);

  const wash: CareStep[] = [
    { title: '① 预洗', detail: '先用温水冲 1 分钟，把表面灰尘冲掉——泡沫会更丰富，也能减少洗发水用量' },
    { title: '② 起泡', detail: '洗发水先在手心/起泡网打出泡沫再上头，别直接倒在头皮上' },
    { title: '③ 按摩', detail: '指腹打圈按摩 2–3 分钟，从头顶到后枕；指甲抓会抓伤头皮' },
    { title: '④ 护发素', detail: '只涂发中到发尾，避开头皮 5cm 以上，停留 3 分钟再冲（这 3 分钟很关键）' },
    { title: '⑤ 冲净', detail: '水温 38℃ 左右，冲到头发摸起来「咯吱」响才算干净；残留是头屑和痒的主因' },
    { title: '⑥ 擦干', detail: '毛巾按压吸水，不要搓！湿发毛鳞片张开，搓最容易毛躁分叉' },
    { title: '⑦ 吹干', detail: '先吹发根再吹发尾，距离 15cm、温度中档；吹到八成干转冷风定型，头皮一定要吹干' }
  ];

  const care: string[] = [
    '湿发不要马上扎起来，容易断且滋生细菌',
    '真丝枕套 + 松松的低马尾睡觉，对发质改善很明显',
    '梳子选宽齿或气垫梳，从发尾往上分段梳开，别从上一梳到底',
    h.damage === 'none'
      ? '目前无烫染损伤，保持就是最好的护理'
      : (h.damage === 'both' ? '烫 + 染双重损伤：发膜加强到一周 2 次，下次烫染至少隔 3 个月' : '有烫/染损伤：每周 1–2 次发膜，造型前用隔热/护色产品')
  ];

  const concernPlans = concerns
    .map((c) => ({ concern: c, steps: HAIR_CONCERN[c] || HAIR_CONCERN['毛躁'] }))
    .slice(0, 3);

  const caution: string[] = [
    '每天掉发 50–100 根是正常的，别被「一抓一把」吓到，先数一数再慌',
    '拉发自测：5 天不洗头，捏 50 根轻拉，掉超过 6 根建议就医',
    '⚠️ 斑秃（成块掉）、发际线快速后移、头皮红肿流脓 → 皮肤科就诊',
    '任何「7 天生发」的产品都别信'
  ];

  return {
    summary: SCALP_TIP[scalp] || SCALP_TIP.normal,
    freqText: `当前 ${h.washFreq || 2} 天洗一次 · ${HAIR_FREQ[scalp]}`,
    wash, care, concerns: concernPlans, caution
  };
}

/* ============================ 三、身体护理 ============================ */

export interface BodyPlan {
  summary: string;
  shower: CareStep[];
  lotion: string[];
  special: { title: string; steps: string[] }[];
  posture: string[];
  sleep: string[];
  habit: string[];
}

export function bodyPlan(p?: BodyProfile): BodyPlan {
  const b = p || getBodyProfile();

  const shower: CareStep[] = [
    { title: '① 水温', detail: '≤40℃，太热的水会洗掉皮脂膜，是冬天皮肤痒的主因' },
    { title: '② 时长', detail: '淋浴 10–15 分钟以内；泡澡 20 分钟封顶' },
    { title: '③ 清洁', detail: b.dryness === 'severe' ? '用无皂基/氨基酸沐浴露，或隔天只用清水' : '日常用温和沐浴露，重点洗腋下/后背/褶皱处，四肢一带而过' },
    { title: '④ 去角质', detail: b.kp ? '鸡皮肤别用力搓！用含果酸/尿素的沐浴露，一周 2 次' : '一周 1 次身体磨砂，避开破损皮肤' },
    { title: '⑤ 擦干', detail: '毛巾按压吸干，保留一点湿气——下一步要抢时间' },
    { title: '⑥ 黄金 3 分钟', detail: '擦干后 3 分钟内涂身体乳，锁水效果差一倍，这一步比选什么身体乳更重要' }
  ];

  const lotion: string[] = [
    b.dryness === 'severe'
      ? '干燥明显：选含尿素（5–10%）、神经酰胺、乳木果油的身体霜，秋冬用膏状'
      : (b.dryness === 'mild' ? '轻度干燥：春夏用乳液、秋冬换霜，洗澡后立刻涂' : '皮肤状态不错：日常乳液维持，秋冬再升级'),
    '小腿前侧、手肘、膝盖最容易干，这几处多涂一遍',
    '夏天出汗多可以选清爽凝露，但别因为黏就不涂'
  ];

  const special: { title: string; steps: string[] }[] = [];
  if (b.kp) {
    special.push({
      title: '鸡皮肤（毛周角化）',
      steps: [
        '核心：保湿 + 温和去角质，长期坚持，无法根治但能明显改善',
        '含果酸（10%左右）或尿素（10%）的身体乳，每天涂',
        '绝对不要用搓澡巾猛搓，越搓越红越明显',
        '⚠️ 严重或伴随明显红斑 → 皮肤科，可开维 A 酸类外用药'
      ]
    });
  }
  if (b.backAcne) {
    special.push({
      title: '后背痘',
      steps: [
        '换含水杨酸或硫磺的沐浴露，涂在后背停留 2–3 分钟再冲',
        '运动出汗后尽快洗澡，湿衣服别穿着久坐',
        '床单枕套一周一换，后背接触时间最长',
        '洗发水/护发素一定要冲干净，残留流到后背是常见诱因',
        '⚠️ 红肿疼痛、留下疤痕 → 皮肤科'
      ]
    });
  }
  (b.concerns || []).forEach((c) => {
    if (c === '手足护理') {
      special.push({
        title: '手足护理',
        steps: [
          '手：每次洗完手都补涂护手霜（放在洗手台边），指缘油一天一次防倒刺',
          '脚：每周 1–2 次去角质 → 厚涂足霜 → 穿棉袜过夜，两周就能看到差别',
          '做家务/洗碗戴手套，洗洁精是手部皮肤的头号杀手'
        ]
      });
    }
    if (c === '私处护理') {
      special.push({
        title: '私处护理',
        steps: [
          '清水洗外阴就够，不要冲洗阴道内部——会破坏菌群',
          '不用香皂、沐浴露、私处洗液（除非医生开）',
          '内裤选纯棉、每天换、单独手洗、晒干或烘干',
          '⚠️ 异味、瘙痒、异常分泌物 → 妇科就诊，别自己买药洗'
        ]
      });
    }
    if (c === '口气牙齿') {
      special.push({
        title: '口腔与口气',
        steps: [
          '巴氏刷牙法 + 每天用牙线/冲牙器，牙缝才是口臭主要来源',
          '刷舌苔，力度轻一点',
          '每年洗牙 1–2 次，牙龈出血是牙周炎信号',
          '⚠️ 长期口气重也可能是扁桃体结石/幽门螺杆菌，可就医排查'
        ]
      });
    }
  });

  const posture: string[] = [
    '靠墙站立 3 分钟：后脑勺/肩/臀/脚跟贴墙，收下巴——改善圆肩驼背最省事的一招',
    '久坐 45 分钟起来活动 3 分钟，肩颈绕环 + 扩胸',
    '背包别长期单肩，双肩包或交替，高低肩很多是背出来的',
    '睡觉枕头高度：侧睡与肩同高，仰睡一拳高'
  ];

  const sleep: string[] = [
    b.sleep < 7
      ? `目前平均 ${b.sleep} 小时，低于 7 小时会明显影响皮肤修复与情绪——先从早睡 30 分钟开始`
      : `目前平均 ${b.sleep} 小时，节奏不错，保持就好`,
    '睡前一小时放下手机：蓝光 + 信息刺激是入睡困难的主因',
    '黄体期更容易失眠：少咖啡、睡前热水泡脚 10 分钟',
    '固定起床时间比固定入睡时间更重要'
  ];

  const habit: string[] = [
    b.water < 6 ? `每天约 ${b.water} 杯水偏少，建议 6–8 杯（1500–2000ml），把水杯放在手边最有效` : '饮水量达标，继续保持',
    b.exercise === 'none'
      ? '目前没有规律运动：不用一上来就跑 5 公里，饭后散步 20 分钟开始，对经期和情绪都有帮助'
      : (b.exercise === 'light' ? '轻度运动已有，可考虑一周加 1 次力量训练（对体态与基础代谢帮助最大）' : '运动习惯很好，注意经期降强度、黄体期别硬扛'),
    '补铁：月经量大的女生容易缺铁，红肉/动物血/菠菜 + 维 C 一起吃',
    '维生素 D：室内久坐普遍不足，可查一下再决定补不补'
  ];

  return {
    summary: `身体护理三件事：水温别太高、洗完 3 分钟内涂身体乳、坚持比贵重要`,
    shower, lotion, special, posture, sleep, habit
  };
}

/* ============================ 四、体检 / 疫苗提醒 ============================ */

export interface DecoCheck extends CareCheck {
  /** 下次建议时间（yyyy-mm-dd），长期项目为空 */
  nextDate: string;
  /** 距下次的天数（负=已逾期） */
  days: number;
  status: 'never' | 'ok' | 'soon' | 'overdue';
  statusText: string;
  /** 最近可做的时间窗说明（与经期联动） */
  windowTip: string;
}

export function careReminders(list?: CareCheck[]): DecoCheck[] {
  const checks = list || loadCareChecks();
  const today = todayYmd();
  const cyc = analyze();

  return checks.map((c) => {
    if (!c.intervalMonths) {
      // 疫苗这类「按需/按剂次」的项目
      return {
        ...c, nextDate: '', days: 0,
        status: c.lastAt ? 'ok' : 'never',
        statusText: c.lastAt ? `已记录 ${fmtYmd(new Date(c.lastAt))}，按剂次推进` : '未接种 / 未记录',
        windowTip: c.note
      } as DecoCheck;
    }
    if (!c.lastAt) {
      return { ...c, nextDate: '', days: 0, status: 'never', statusText: '还没做过', windowTip: c.note } as DecoCheck;
    }
    const last = new Date(c.lastAt);
    const next = new Date(last.getTime());
    next.setMonth(next.getMonth() + c.intervalMonths);
    const nextDate = fmtYmd(next);
    const days = diffDays(today, nextDate);
    let status: DecoCheck['status'] = 'ok';
    let statusText = `下次建议 ${nextDate}`;
    if (days < 0) { status = 'overdue'; statusText = `已逾期 ${-days} 天`; }
    else if (days <= 30) { status = 'soon'; statusText = `还有 ${days} 天`; }

    let windowTip = c.note;
    if (c.key === 'breast' && cyc.hasData && cyc.lastStart) {
      const w1 = addDays(cyc.lastStart, Math.max(1, cyc.avgPeriod || 5) + 7);
      const w2 = addDays(cyc.lastStart, Math.max(1, cyc.avgPeriod || 5) + 10);
      windowTip = `${c.note}｜按你的周期，本月最佳窗口是 ${w1} ~ ${w2}`;
    }
    return { ...c, nextDate, days, status, statusText, windowTip } as DecoCheck;
  });
}

/** 综合健康提示：把经期阶段 + 皮肤/头发/身体连起来给一条「今天该做什么」 */
export function todayCareLine(): string {
  const cyc = analyze();
  const skin = getSkinProfile();
  const body = getBodyProfile();
  if (!cyc.hasData) {
    return '先记录一次经期，之后每天这里会给你一句「今天该照顾自己什么」。';
  }
  if (cyc.phase === 'menstrual') {
    return `经期第 ${cyc.dayIndex} 天：护肤做减法（${skin.type === 'sensitive' ? '你本就敏感，' : ''}停酸停 A 醇），暖饮 + 早睡，别安排高强度的事。`;
  }
  if (cyc.phase === 'ovulation') {
    return '排卵期：皮脂开始上升，T 区加一次清洁；状态最好的几天，把难的事排进来。';
  }
  if (cyc.phase === 'luteal') {
    return `黄体期：控盐控糖防水肿爆痘，${body.sleep < 7 ? '你这周更容易失眠，睡前一小时放下手机' : '保持睡眠节奏'}，重要决定往后挪。`;
  }
  return '卵泡期：皮肤耐受度最高，美白/刷酸/医美安排在这两周；也最适合开始一件新事。';
}
