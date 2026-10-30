// subpackages/travel/utils/trip-templates.ts
// 多模式模板库：行李模板（按场景）× 路线模板（按目的地 / 天数）
//
// 设计：
//   - 行李 = 通用必备底座（PACKING_BASE）+ 场景加料（SCENE_PACKING[scene]）合并去重。
//     这样每个场景都能稳定产出 30+ 项，同时不同场景之间不会重复造词。
//   - 路线 = 按目的地关键字模糊匹配目的地模板；没命中就退到按天数的通用骨架
//     （GENERIC_ROUTES[days]），保证任何目的地都有可导入的日程。

import type {
  IPackingTemplate,
  IPackingTemplateItem,
  IRouteTemplate,
  IRouteTemplateDay,
  PackingCategory,
  TravelScene
} from './travel-types';

/* ============================ 行李：通用必备底座 ============================ */

/** 速记构造器：减少模板里的重复字段噪音 */
function p(
  name: string,
  category: PackingCategory | string,
  count = 1,
  isEssential = false,
  reminderDaysBefore = 0
): IPackingTemplateItem {
  return { name, category, count, isEssential, reminderDaysBefore };
}

/** 不论什么场景都要带的东西（证件 / 电子 / 洗漱 / 药品 / 衣物基础） */
const PACKING_BASE: IPackingTemplateItem[] = [
  // 证件
  p('身份证', '证件', 1, true, 7),
  p('护照 / 通行证', '证件', 1, false, 7),
  p('银行卡 / 信用卡', '证件', 2, true, 3),
  p('现金零钱', '证件', 1, true, 1),
  p('机票 / 车票行程单', '证件', 1, true, 1),
  p('酒店预订单', '证件', 1, false, 1),
  p('驾驶证', '证件', 1, false, 3),
  p('紧急联系人卡片', '证件', 1, true, 3),
  p('保险单号 / 电子保单', '证件', 1, false, 3),
  // 电子
  p('手机', '电子', 1, true),
  p('充电器 / 数据线', '电子', 2, true),
  p('充电宝', '电子', 1, true),
  p('耳机', '电子', 1, false),
  p('转换插头', '电子', 1, false, 3),
  p('相机 / 存储卡', '电子', 1, false),
  p('自拍杆', '电子', 1, false),
  // 洗漱
  p('牙刷牙膏', '洗漱', 1, true),
  p('洗面奶', '洗漱', 1, true),
  p('毛巾', '洗漱', 1, true),
  p('洗发水 / 沐浴露', '洗漱', 1, false),
  p('梳子', '洗漱', 1, false),
  p('防晒霜', '洗漱', 1, false),
  p('唇膏', '洗漱', 1, false),
  // 药品
  p('创可贴', '药品', 5, true),
  p('感冒药', '药品', 1, true),
  p('肠胃药', '药品', 1, true),
  p('晕车药', '药品', 1, false),
  p('个人常用药', '药品', 1, true, 7),
  p('驱蚊液', '药品', 1, false),
  // 衣物
  p('内衣袜子', '衣物', 5, true),
  p('外套', '衣物', 1, true),
  p('睡衣', '衣物', 1, false),
  p('拖鞋', '衣物', 1, false),
  p('舒适步行鞋', '衣物', 1, true),
  // 其他
  p('随身双肩包', '其他', 1, true),
  p('水杯', '其他', 1, true),
  p('雨伞', '其他', 1, false),
  p('垃圾袋', '其他', 3, false),
  p('纸巾 / 湿巾', '其他', 3, true)
];

/* ============================ 行李：场景加料 ============================ */

const SCENE_PACKING: Record<TravelScene, IPackingTemplateItem[]> = {
  度假: [
    p('太阳镜', '其他', 1, true),
    p('遮阳帽', '衣物', 1, true),
    p('连衣裙 / 出片穿搭', '衣物', 2, false),
    p('凉鞋', '衣物', 1, false),
    p('面膜', '洗漱', 4, false),
    p('化妆品包', '洗漱', 1, false),
    p('首饰配饰', '其他', 1, false),
    p('纪念品购物袋', '其他', 1, false),
    p('折叠购物袋', '其他', 1, false),
    p('指甲刀', '其他', 1, false)
  ],
  出差: [
    p('笔记本电脑', '电子', 1, true),
    p('电脑充电器', '电子', 1, true),
    p('名片', '证件', 20, true, 3),
    p('商务正装', '衣物', 1, true),
    p('衬衫', '衣物', 3, true),
    p('皮鞋', '衣物', 1, true),
    p('领带 / 丝巾', '衣物', 1, false),
    p('会议资料 / U盘', '其他', 1, true, 2),
    p('笔记本与笔', '其他', 1, false),
    p('便携熨斗 / 挂烫', '其他', 1, false),
    p('公司工牌', '证件', 1, false)
  ],
  亲子: [
    p('儿童身份证 / 户口本', '证件', 1, true, 7),
    p('儿童常备药', '药品', 1, true, 7),
    p('退热贴', '药品', 4, true),
    p('奶瓶 / 奶粉', '母婴', 2, true),
    p('纸尿裤', '母婴', 20, true),
    p('湿巾 / 棉柔巾', '母婴', 5, true),
    p('儿童换洗衣物', '衣物', 5, true),
    p('儿童防晒', '洗漱', 1, true),
    p('婴儿推车', '母婴', 1, false),
    p('安抚玩具', '母婴', 2, false),
    p('儿童餐具', '母婴', 1, false),
    p('便携餐椅带', '母婴', 1, false),
    p('隔尿垫', '母婴', 2, false)
  ],
  户外: [
    p('登山鞋', '衣物', 1, true),
    p('冲锋衣', '衣物', 1, true),
    p('速干衣裤', '衣物', 2, true),
    p('登山杖', '其他', 2, false),
    p('护膝', '其他', 1, false),
    p('头灯 / 手电', '电子', 1, true),
    p('户外背包', '其他', 1, true),
    p('压缩袋', '其他', 3, false),
    p('多功能刀具', '其他', 1, false),
    p('急救包', '药品', 1, true),
    p('高热量零食', '其他', 5, true),
    p('保温壶', '其他', 1, true),
    p('防蚊虫喷雾', '药品', 1, true)
  ],
  海边: [
    p('泳衣', '衣物', 2, true),
    p('沙滩鞋', '衣物', 1, true),
    p('速干浴巾', '洗漱', 1, true),
    p('防水手机袋', '电子', 1, true),
    p('高倍防晒霜', '洗漱', 2, true),
    p('晒后修复', '洗漱', 1, true),
    p('浮潜面镜', '其他', 1, false),
    p('沙滩垫', '其他', 1, false),
    p('太阳镜', '其他', 1, true),
    p('遮阳帽', '衣物', 1, true),
    p('沙滩玩具', '母婴', 1, false),
    p('防水袋', '其他', 2, false)
  ],
  滑雪: [
    p('滑雪服', '衣物', 1, true),
    p('雪裤', '衣物', 1, true),
    p('滑雪手套', '衣物', 1, true),
    p('雪袜', '衣物', 3, true),
    p('护目镜', '其他', 1, true),
    p('头盔', '其他', 1, true),
    p('保暖内衣', '衣物', 2, true),
    p('围巾 / 面罩', '衣物', 1, true),
    p('滑雪板 / 雪鞋', '其他', 1, false),
    p('暖宝宝', '其他', 10, true),
    p('防冻面霜', '洗漱', 1, true),
    p('唇膏', '洗漱', 1, true)
  ],
  露营: [
    p('帐篷', '其他', 1, true),
    p('防潮垫', '其他', 1, true),
    p('睡袋', '其他', 1, true),
    p('营地灯', '电子', 1, true),
    p('便携炉具', '其他', 1, false),
    p('锅具餐具', '其他', 1, true),
    p('折叠桌椅', '其他', 1, false),
    p('垃圾袋', '其他', 8, true),
    p('防风打火机', '其他', 1, true),
    p('驱蛇驱虫粉', '药品', 1, false),
    p('厚外套', '衣物', 1, true),
    p('备用袜子', '衣物', 3, true)
  ]
};

/** 场景元信息（图标 / 说明），用于模板选择界面 */
const SCENE_META: Record<TravelScene | '通用', { name: string; icon: string; desc: string }> = {
  通用: { name: '通用必备', icon: '🎒', desc: '不论去哪儿都用得上的基础清单' },
  度假: { name: '度假休闲', icon: '🌴', desc: '城市漫游 · 拍照打卡 · 轻松逛吃' },
  出差: { name: '商务出差', icon: '💼', desc: '会议 · 拜访 · 正式场合着装' },
  亲子: { name: '亲子出行', icon: '👶', desc: '带娃出门，母婴用品优先' },
  户外: { name: '户外徒步', icon: '⛰️', desc: '登山 · 徒步 · 野外线路' },
  海边: { name: '海边度假', icon: '🏖️', desc: '游泳 · 浮潜 · 沙滩亲子' },
  滑雪: { name: '滑雪运动', icon: '🎿', desc: '雪场 · 防寒 · 护具' },
  露营: { name: '露营野餐', icon: '⛺', desc: '帐篷 · 炊具 · 过夜装备' }
};

/** 合并底座 + 场景加料（按名称去重，场景项优先，保留其数量） */
function mergePacking(scenes: TravelScene[]): IPackingTemplateItem[] {
  const out: IPackingTemplateItem[] = [];
  const seen = new Set<string>();
  const push = (it: IPackingTemplateItem) => {
    if (seen.has(it.name)) return;
    seen.add(it.name);
    out.push(it);
  };
  // 场景项先放，保证场景专属数量/必备标记生效
  for (const s of scenes) {
    (SCENE_PACKING[s] || []).forEach(push);
  }
  PACKING_BASE.forEach(push);
  return out;
}

/** 全部行李模板模式（供选择界面展示） */
export const PACKING_TEMPLATES: IPackingTemplate[] = (
  ['通用', '度假', '出差', '亲子', '户外', '海边', '滑雪', '露营'] as (TravelScene | '通用')[]
).map((scene) => {
  const meta = SCENE_META[scene];
  const scenes = scene === '通用' ? [] : [scene as TravelScene];
  return {
    key: scene === '通用' ? 'base' : `scene_${scene}`,
    name: meta.name,
    icon: meta.icon,
    scene,
    desc: meta.desc,
    items: mergePacking(scenes)
  };
});

/** 按场景组合生成行李清单（可多选场景） */
export function buildPackingItems(scenes: TravelScene[]): IPackingTemplateItem[] {
  return mergePacking(scenes);
}

/** 场景元信息查询（页面用） */
export function sceneMeta(scene: TravelScene | '通用'): { name: string; icon: string; desc: string } {
  return SCENE_META[scene] || SCENE_META['通用'];
}

/** 全部场景键（供多选器遍历） */
export const SCENE_KEYS: TravelScene[] = ['度假', '出差', '亲子', '户外', '海边', '滑雪', '露营'];

/* ============================ 路线模板 ============================ */

function day(
  n: number,
  label: string,
  items: { c: string; t: string; d: number; k: IRouteTemplateDay['items'][number]['itemType']; cost?: number; note?: string; loc?: string }[]
): IRouteTemplateDay {
  return {
    day: n,
    label,
    items: items.map((i) => ({
      content: i.c,
      startTime: i.t,
      duration: i.d,
      itemType: i.k,
      cost: i.cost || 0,
      note: i.note || '',
      locationName: i.loc || ''
    }))
  };
}

/** 目的地路线模板 */
export const ROUTE_TEMPLATES: IRouteTemplate[] = [
  {
    key: 'chengdu4',
    name: '成都 4 日经典',
    destinations: ['成都', '四川', '天府'],
    days: 4,
    budgetHint: 3200,
    scenes: ['度假'],
    dayList: [
      day(1, '抵达 · 市井烟火', [
        { c: '抵达成都双流/天府机场', t: '10:00', d: 60, k: '交通', cost: 0, loc: '成都天府国际机场' },
        { c: '入住酒店（春熙路商圈）', t: '12:00', d: 60, k: '酒店', cost: 600, loc: '春熙路' },
        { c: '宽窄巷子逛吃', t: '14:00', d: 180, k: '景点', cost: 0, loc: '宽窄巷子' },
        { c: '火锅晚餐（蜀九香）', t: '18:30', d: 120, k: '餐厅', cost: 260, loc: '蜀九香火锅' }
      ]),
      day(2, '熊猫 · 千年水利', [
        { c: '成都大熊猫繁育研究基地', t: '08:30', d: 240, k: '景点', cost: 55, loc: '大熊猫繁育研究基地' },
        { c: '午餐：陈麻婆豆腐', t: '12:30', d: 90, k: '餐厅', cost: 120, loc: '陈麻婆豆腐' },
        { c: '都江堰景区', t: '14:30', d: 240, k: '景点', cost: 80, loc: '都江堰' },
        { c: '南桥夜景', t: '19:00', d: 90, k: '景点', cost: 0, loc: '南桥' }
      ]),
      day(3, '乐山大佛一日', [
        { c: '动车前往乐山', t: '08:00', d: 60, k: '交通', cost: 54, loc: '乐山站' },
        { c: '乐山大佛', t: '09:30', d: 210, k: '景点', cost: 80, loc: '乐山大佛' },
        { c: '跷脚牛肉午餐', t: '12:30', d: 80, k: '餐厅', cost: 90, loc: '跷脚牛肉' },
        { c: '峨眉山脚报国寺', t: '14:30', d: 150, k: '景点', cost: 0, loc: '报国寺' },
        { c: '返回成都', t: '17:30', d: 60, k: '交通', cost: 54, loc: '成都东站' }
      ]),
      day(4, '慢生活 · 返程', [
        { c: '人民公园鹤鸣茶社早茶', t: '09:30', d: 120, k: '餐厅', cost: 60, loc: '鹤鸣茶社' },
        { c: '武侯祠 · 锦里', t: '11:30', d: 150, k: '景点', cost: 50, loc: '武侯祠' },
        { c: '特产采买（伴手礼）', t: '14:00', d: 90, k: '购物', cost: 400, loc: '锦里' },
        { c: '前往机场返程', t: '16:30', d: 90, k: '交通', cost: 0, loc: '成都天府国际机场' }
      ])
    ]
  },
  {
    key: 'sanya5',
    name: '三亚 5 日海岛',
    destinations: ['三亚', '海南', '海棠湾', '亚龙湾'],
    days: 5,
    budgetHint: 6800,
    scenes: ['海边', '度假'],
    dayList: [
      day(1, '落地 · 海湾初见', [
        { c: '飞抵三亚凤凰机场', t: '11:00', d: 60, k: '交通', cost: 0, loc: '三亚凤凰国际机场' },
        { c: '入住亚龙湾酒店', t: '13:00', d: 60, k: '酒店', cost: 1200, loc: '亚龙湾' },
        { c: '亚龙湾沙滩日落', t: '17:00', d: 120, k: '景点', cost: 0, loc: '亚龙湾' },
        { c: '海鲜晚餐', t: '19:00', d: 120, k: '餐厅', cost: 380, loc: '第一市场' }
      ]),
      day(2, '潜水 · 海上项目', [
        { c: '亚龙湾潜水', t: '09:00', d: 180, k: '景点', cost: 480, loc: '亚龙湾潜水中心' },
        { c: '午餐：椰梦长廊', t: '12:30', d: 90, k: '餐厅', cost: 150, loc: '椰梦长廊' },
        { c: '摩托艇 / 香蕉船', t: '14:30', d: 120, k: '景点', cost: 320, loc: '亚龙湾' },
        { c: '泳池吧小酌', t: '19:00', d: 90, k: '餐厅', cost: 200, loc: '酒店泳池吧' }
      ]),
      day(3, '热带雨林', [
        { c: '呀诺达雨林', t: '09:00', d: 240, k: '景点', cost: 168, loc: '呀诺达雨林' },
        { c: '雨林午餐', t: '12:30', d: 80, k: '餐厅', cost: 120, loc: '呀诺达' },
        { c: '槟榔谷黎苗文化', t: '14:30', d: 180, k: '景点', cost: 120, loc: '槟榔谷' },
        { c: '温泉放松', t: '18:00', d: 120, k: '景点', cost: 180, loc: '南田温泉' }
      ]),
      day(4, '离岛 · 南山', [
        { c: '蜈支洲岛一日', t: '08:30', d: 420, k: '景点', cost: 260, loc: '蜈支洲岛' },
        { c: '岛上简餐', t: '12:30', d: 60, k: '餐厅', cost: 100, loc: '蜈支洲岛' },
        { c: '三亚湾海鲜市场', t: '18:00', d: 150, k: '购物', cost: 500, loc: '三亚湾' }
      ]),
      day(5, '免税 · 返程', [
        { c: '海棠湾免税店', t: '10:00', d: 210, k: '购物', cost: 1500, loc: '三亚国际免税城' },
        { c: '午餐', t: '13:00', d: 80, k: '餐厅', cost: 150, loc: '海棠湾' },
        { c: '前往机场返程', t: '15:00', d: 60, k: '交通', cost: 0, loc: '三亚凤凰国际机场' }
      ])
    ]
  },
  {
    key: 'xiamen3',
    name: '厦门 3 日小清新',
    destinations: ['厦门', '鼓浪屿', '福建'],
    days: 3,
    budgetHint: 2200,
    scenes: ['度假', '海边'],
    dayList: [
      day(1, '抵达 · 环岛路', [
        { c: '抵达厦门高崎机场', t: '10:00', d: 60, k: '交通', loc: '高崎机场' },
        { c: '入住曾厝垵民宿', t: '12:00', d: 60, k: '酒店', cost: 400, loc: '曾厝垵' },
        { c: '环岛路骑行', t: '15:00', d: 150, k: '景点', cost: 60, loc: '环岛路' },
        { c: '沙茶面晚餐', t: '18:30', d: 90, k: '餐厅', cost: 90, loc: '曾厝垵' }
      ]),
      day(2, '鼓浪屿一日', [
        { c: '轮渡前往鼓浪屿', t: '08:30', d: 40, k: '交通', cost: 35, loc: '东渡邮轮码头' },
        { c: '日光岩', t: '09:30', d: 120, k: '景点', cost: 60, loc: '日光岩' },
        { c: '菽庄花园', t: '11:30', d: 90, k: '景点', cost: 30, loc: '菽庄花园' },
        { c: '岛上小吃午餐', t: '13:00', d: 90, k: '餐厅', cost: 100, loc: '龙头路' },
        { c: '皓月园 · 钢琴博物馆', t: '15:00', d: 150, k: '景点', cost: 30, loc: '皓月园' }
      ]),
      day(3, '厦大 · 返程', [
        { c: '南普陀寺', t: '09:00', d: 90, k: '景点', loc: '南普陀寺' },
        { c: '厦门大学 / 芙蓉隧道', t: '10:30', d: 120, k: '景点', loc: '厦门大学' },
        { c: '中山路伴手礼', t: '13:00', d: 120, k: '购物', cost: 300, loc: '中山路' },
        { c: '前往机场返程', t: '15:30', d: 60, k: '交通', loc: '高崎机场' }
      ])
    ]
  },
  {
    key: 'xian4',
    name: '西安 4 日历史线',
    destinations: ['西安', '陕西', '长安'],
    days: 4,
    budgetHint: 2800,
    scenes: ['度假'],
    dayList: [
      day(1, '城墙 · 回民街', [
        { c: '抵达西安北站', t: '10:00', d: 60, k: '交通', loc: '西安北站' },
        { c: '入住钟楼商圈', t: '12:00', d: 60, k: '酒店', cost: 500, loc: '钟楼' },
        { c: '西安城墙骑行', t: '14:30', d: 150, k: '景点', cost: 54, loc: '西安城墙' },
        { c: '回民街小吃', t: '18:30', d: 120, k: '餐厅', cost: 150, loc: '回民街' }
      ]),
      day(2, '兵马俑一日', [
        { c: '前往临潼', t: '08:00', d: 60, k: '交通', cost: 30, loc: '临潼' },
        { c: '秦始皇兵马俑', t: '09:30', d: 240, k: '景点', cost: 120, loc: '兵马俑' },
        { c: '午餐', t: '12:30', d: 80, k: '餐厅', cost: 100, loc: '临潼' },
        { c: '华清宫', t: '14:30', d: 150, k: '景点', cost: 120, loc: '华清宫' },
        { c: '《长恨歌》演出', t: '19:30', d: 90, k: '景点', cost: 268, loc: '华清宫' }
      ]),
      day(3, '博物馆 · 大雁塔', [
        { c: '陕西历史博物馆', t: '09:00', d: 180, k: '景点', loc: '陕西历史博物馆' },
        { c: '午餐：biangbiang面', t: '12:30', d: 80, k: '餐厅', cost: 80, loc: '大雁塔' },
        { c: '大雁塔 · 大唐不夜城', t: '14:30', d: 240, k: '景点', cost: 50, loc: '大雁塔' },
        { c: '大唐不夜城夜游', t: '19:00', d: 120, k: '景点', loc: '大唐不夜城' }
      ]),
      day(4, '华山 / 返程', [
        { c: '华山一日（可选）', t: '07:30', d: 480, k: '景点', cost: 340, loc: '华山' },
        { c: '返回市区', t: '18:00', d: 120, k: '交通', cost: 60, loc: '西安北站' },
        { c: '特产采买', t: '20:00', d: 60, k: '购物', cost: 200, loc: '钟楼' }
      ])
    ]
  },
  {
    key: 'beijing3',
    name: '北京 3 日皇城线',
    destinations: ['北京', '北平', '京城'],
    days: 3,
    budgetHint: 2600,
    scenes: ['度假'],
    dayList: [
      day(1, '故宫 · 景山', [
        { c: '抵达北京', t: '09:00', d: 60, k: '交通', loc: '北京南站' },
        { c: '入住前门酒店', t: '11:00', d: 60, k: '酒店', cost: 600, loc: '前门' },
        { c: '故宫博物院', t: '13:00', d: 240, k: '景点', cost: 60, loc: '故宫' },
        { c: '景山看故宫全景', t: '16:00', d: 60, k: '景点', cost: 2, loc: '景山公园' },
        { c: '全聚德烤鸭', t: '18:30', d: 120, k: '餐厅', cost: 380, loc: '全聚德' }
      ]),
      day(2, '长城一日', [
        { c: '前往八达岭', t: '07:30', d: 90, k: '交通', cost: 30, loc: '八达岭' },
        { c: '八达岭长城', t: '09:30', d: 270, k: '景点', cost: 40, loc: '八达岭长城' },
        { c: '农家午餐', t: '13:00', d: 80, k: '餐厅', cost: 120, loc: '八达岭' },
        { c: '奥林匹克公园', t: '16:00', d: 120, k: '景点', loc: '奥林匹克公园' },
        { c: '王府井小吃街', t: '19:00', d: 90, k: '餐厅', cost: 150, loc: '王府井' }
      ]),
      day(3, '胡同 · 返程', [
        { c: '颐和园', t: '09:00', d: 210, k: '景点', cost: 30, loc: '颐和园' },
        { c: '南锣鼓巷', t: '13:00', d: 120, k: '景点', loc: '南锣鼓巷' },
        { c: '稻香村伴手礼', t: '15:00', d: 60, k: '购物', cost: 200, loc: '稻香村' },
        { c: '前往车站返程', t: '17:00', d: 60, k: '交通', loc: '北京南站' }
      ])
    ]
  },
  {
    key: 'tokyo5',
    name: '东京 5 日（境外）',
    destinations: ['东京', '日本', 'Tokyo', '大阪'],
    days: 5,
    budgetHint: 9800,
    scenes: ['度假'],
    dayList: [
      day(1, '抵达 · 新宿', [
        { c: '飞抵成田机场', t: '14:00', d: 90, k: '交通', loc: '成田国际机场' },
        { c: '入住新宿酒店', t: '16:30', d: 60, k: '酒店', cost: 900, loc: '新宿' },
        { c: '新宿夜景 · 思出横丁', t: '19:00', d: 120, k: '餐厅', cost: 300, loc: '新宿' }
      ]),
      day(2, '涩谷 · 原宿', [
        { c: '明治神宫', t: '09:30', d: 90, k: '景点', loc: '明治神宫' },
        { c: '原宿竹下通', t: '11:30', d: 150, k: '购物', cost: 800, loc: '原宿' },
        { c: '涩谷十字路口', t: '14:00', d: 90, k: '景点', loc: '涩谷' },
        { c: 'Shibuya Sky 观景', t: '16:00', d: 90, k: '景点', cost: 120, loc: '涩谷' }
      ]),
      day(3, '迪士尼一日', [
        { c: '东京迪士尼', t: '08:30', d: 600, k: '景点', cost: 480, loc: '东京迪士尼乐园' },
        { c: '园内晚餐', t: '19:00', d: 90, k: '餐厅', cost: 200, loc: '迪士尼' }
      ]),
      day(4, '浅草 · 秋叶原', [
        { c: '浅草寺', t: '09:30', d: 120, k: '景点', loc: '浅草寺' },
        { c: '秋叶原电器街', t: '12:00', d: 180, k: '购物', cost: 1500, loc: '秋叶原' },
        { c: '东京塔夜景', t: '18:00', d: 120, k: '景点', cost: 120, loc: '东京塔' }
      ]),
      day(5, '银座 · 返程', [
        { c: '筑地场外市场', t: '09:00', d: 120, k: '餐厅', cost: 200, loc: '筑地' },
        { c: '银座采买', t: '11:30', d: 180, k: '购物', cost: 2000, loc: '银座' },
        { c: '前往机场返程', t: '15:00', d: 90, k: '交通', loc: '成田国际机场' }
      ])
    ]
  }
];

/** 通用骨架（按天数 1-5，任何目的地都能用） */
const GENERIC_ROUTES: Record<number, IRouteTemplate> = {
  1: {
    key: 'generic1',
    name: '1 日轻旅行',
    destinations: [],
    days: 1,
    budgetHint: 800,
    scenes: ['度假'],
    dayList: [
      day(1, '当日往返', [
        { c: '出发前往目的地', t: '08:00', d: 90, k: '交通' },
        { c: '核心景点游览', t: '10:00', d: 240, k: '景点', cost: 100 },
        { c: '当地特色午餐', t: '12:30', d: 90, k: '餐厅', cost: 120 },
        { c: '下午自由活动', t: '14:30', d: 180, k: '自定义' },
        { c: '伴手礼采买', t: '17:30', d: 60, k: '购物', cost: 200 },
        { c: '返程', t: '19:00', d: 90, k: '交通' }
      ])
    ]
  },
  2: {
    key: 'generic2',
    name: '2 日周末游',
    destinations: [],
    days: 2,
    budgetHint: 1600,
    scenes: ['度假'],
    dayList: [
      day(1, '抵达 · 市区', [
        { c: '出发前往目的地', t: '08:30', d: 90, k: '交通' },
        { c: '入住酒店', t: '11:00', d: 60, k: '酒店', cost: 500 },
        { c: '市区景点', t: '13:30', d: 210, k: '景点', cost: 80 },
        { c: '特色晚餐', t: '18:30', d: 120, k: '餐厅', cost: 180 }
      ]),
      day(2, '深度游 · 返程', [
        { c: '早餐', t: '08:00', d: 60, k: '餐厅', cost: 50 },
        { c: '主打景点', t: '09:30', d: 240, k: '景点', cost: 120 },
        { c: '午餐', t: '12:30', d: 90, k: '餐厅', cost: 120 },
        { c: '伴手礼采买', t: '15:00', d: 90, k: '购物', cost: 300 },
        { c: '返程', t: '17:00', d: 90, k: '交通' }
      ])
    ]
  },
  3: {
    key: 'generic3',
    name: '3 日小长假',
    destinations: [],
    days: 3,
    budgetHint: 2400,
    scenes: ['度假'],
    dayList: [
      day(1, '抵达 · 初探', [
        { c: '出发前往目的地', t: '09:00', d: 90, k: '交通' },
        { c: '入住酒店', t: '12:00', d: 60, k: '酒店', cost: 600 },
        { c: '地标打卡', t: '14:00', d: 180, k: '景点', cost: 60 },
        { c: '当地晚餐', t: '18:30', d: 120, k: '餐厅', cost: 180 }
      ]),
      day(2, '主打一日', [
        { c: '早餐', t: '08:00', d: 60, k: '餐厅', cost: 50 },
        { c: '核心景区', t: '09:30', d: 300, k: '景点', cost: 150 },
        { c: '景区午餐', t: '13:00', d: 80, k: '餐厅', cost: 100 },
        { c: '博物馆 / 文化点', t: '15:00', d: 150, k: '景点', cost: 50 },
        { c: '夜市 / 夜游', t: '19:00', d: 120, k: '景点', cost: 100 }
      ]),
      day(3, '慢游 · 返程', [
        { c: '早市 / 公园', t: '09:00', d: 120, k: '景点' },
        { c: '伴手礼采买', t: '11:30', d: 90, k: '购物', cost: 400 },
        { c: '午餐', t: '13:00', d: 80, k: '餐厅', cost: 120 },
        { c: '返程', t: '15:00', d: 90, k: '交通' }
      ])
    ]
  },
  4: {
    key: 'generic4',
    name: '4 日深度游',
    destinations: [],
    days: 4,
    budgetHint: 3200,
    scenes: ['度假'],
    dayList: [
      day(1, '抵达', [
        { c: '出发前往目的地', t: '09:00', d: 90, k: '交通' },
        { c: '入住酒店', t: '12:00', d: 60, k: '酒店', cost: 700 },
        { c: '市区地标', t: '14:30', d: 180, k: '景点', cost: 80 },
        { c: '当地晚餐', t: '18:30', d: 120, k: '餐厅', cost: 200 }
      ]),
      day(2, '自然线', [
        { c: '自然景区一日', t: '09:00', d: 300, k: '景点', cost: 150 },
        { c: '景区午餐', t: '12:30', d: 80, k: '餐厅', cost: 100 },
        { c: '观景台 / 日落', t: '17:00', d: 120, k: '景点' },
        { c: '当地夜宵', t: '19:30', d: 90, k: '餐厅', cost: 120 }
      ]),
      day(3, '人文线', [
        { c: '博物馆 / 古迹', t: '09:30', d: 210, k: '景点', cost: 80 },
        { c: '特色午餐', t: '12:30', d: 90, k: '餐厅', cost: 120 },
        { c: '老城区漫步', t: '14:30', d: 180, k: '景点' },
        { c: '演出 / 体验', t: '19:00', d: 120, k: '景点', cost: 200 }
      ]),
      day(4, '慢游 · 返程', [
        { c: '公园早茶', t: '09:00', d: 90, k: '餐厅', cost: 60 },
        { c: '伴手礼采买', t: '11:00', d: 120, k: '购物', cost: 400 },
        { c: '午餐', t: '13:00', d: 80, k: '餐厅', cost: 120 },
        { c: '返程', t: '15:00', d: 90, k: '交通' }
      ])
    ]
  },
  5: {
    key: 'generic5',
    name: '5 日长假',
    destinations: [],
    days: 5,
    budgetHint: 4200,
    scenes: ['度假'],
    dayList: [
      day(1, '抵达', [
        { c: '出发前往目的地', t: '09:00', d: 90, k: '交通' },
        { c: '入住酒店', t: '12:00', d: 60, k: '酒店', cost: 800 },
        { c: '周边适应', t: '15:00', d: 150, k: '景点' },
        { c: '欢迎晚餐', t: '18:30', d: 120, k: '餐厅', cost: 220 }
      ]),
      day(2, '核心景点 A', [
        { c: '核心景区', t: '09:00', d: 300, k: '景点', cost: 180 },
        { c: '景区午餐', t: '12:30', d: 80, k: '餐厅', cost: 110 },
        { c: '近郊景点', t: '15:00', d: 180, k: '景点', cost: 80 },
        { c: '当地特色晚餐', t: '19:00', d: 120, k: '餐厅', cost: 180 }
      ]),
      day(3, '核心景点 B', [
        { c: '博物馆 / 文化区', t: '09:30', d: 210, k: '景点', cost: 90 },
        { c: '午餐', t: '12:30', d: 90, k: '餐厅', cost: 130 },
        { c: '购物街区', t: '14:30', d: 210, k: '购物', cost: 600 },
        { c: '夜景', t: '19:00', d: 120, k: '景点' }
      ]),
      day(4, '周边一日游', [
        { c: '周边小镇一日', t: '08:30', d: 420, k: '景点', cost: 200 },
        { c: '小镇午餐', t: '12:30', d: 80, k: '餐厅', cost: 110 },
        { c: '温泉 / 放松', t: '17:00', d: 150, k: '景点', cost: 180 }
      ]),
      day(5, '慢游 · 返程', [
        { c: '早餐', t: '08:30', d: 60, k: '餐厅', cost: 50 },
        { c: '最后采买', t: '10:00', d: 120, k: '购物', cost: 400 },
        { c: '午餐', t: '12:30', d: 80, k: '餐厅', cost: 120 },
        { c: '返程', t: '15:00', d: 90, k: '交通' }
      ])
    ]
  }
};

/**
 * 匹配路线模板：先按目的地关键字精确/包含匹配，再退到按天数取通用骨架。
 * 返回 null 表示天数超出 1-5 且没有目的地模板。
 */
export function matchRouteTemplate(destination: string, days: number): IRouteTemplate | null {
  const dest = (destination || '').trim();
  if (dest) {
    for (const tpl of ROUTE_TEMPLATES) {
      for (const d of tpl.destinations) {
        if (dest.indexOf(d) >= 0 || d.indexOf(dest) >= 0) {
          return tpl;
        }
      }
    }
  }
  const generic = GENERIC_ROUTES[days];
  return generic || null;
}

/** 通用骨架列表（创建页按天数展示） */
export function genericRoute(days: number): IRouteTemplate | null {
  return GENERIC_ROUTES[days] || null;
}

/** 全部路线模板（供「快速填充」选择面板展示） */
export function allRouteTemplates(): IRouteTemplate[] {
  return ROUTE_TEMPLATES.concat([
    GENERIC_ROUTES[1],
    GENERIC_ROUTES[2],
    GENERIC_ROUTES[3],
    GENERIC_ROUTES[4],
    GENERIC_ROUTES[5]
  ].filter(Boolean) as IRouteTemplate[]);
}

/* ============================ 预设封面 ============================ */

/** 预设封面（避免用户没有图时页面空白；用渐变色 key 而不是图片，省分包体积） */
export interface CoverPreset {
  key: string;
  name: string;
  gradient: string;
  emoji: string;
}

export const COVER_PRESETS: CoverPreset[] = [
  { key: 'sea', name: '海岛', gradient: 'linear-gradient(135deg, #4C8DAE 0%, #7FB8D4 100%)', emoji: '🏖️' },
  { key: 'mountain', name: '山野', gradient: 'linear-gradient(135deg, #6E8E6E 0%, #9BB89B 100%)', emoji: '⛰️' },
  { key: 'city', name: '都市', gradient: 'linear-gradient(135deg, #4C5A8A 0%, #7C8CB8 100%)', emoji: '🌃' },
  { key: 'sunset', name: '日落', gradient: 'linear-gradient(135deg, #C0703F 0%, #D8A05C 100%)', emoji: '🌇' },
  { key: 'snow', name: '雪原', gradient: 'linear-gradient(135deg, #8FA3B8 0%, #C8D6E2 100%)', emoji: '🎿' },
  { key: 'forest', name: '森林', gradient: 'linear-gradient(135deg, #749C84 0%, #A8C4B2 100%)', emoji: '🌲' },
  { key: 'culture', name: '人文', gradient: 'linear-gradient(135deg, #96573A 0%, #C09A5E 100%)', emoji: '🏯' },
  { key: 'desert', name: '大漠', gradient: 'linear-gradient(135deg, #C09A5E 0%, #E0C79A 100%)', emoji: '🐪' }
];

/* ============================ 场景 → 行李补充提示 ============================ */

/**
 * 清单联动：行程里出现某些关键词时，提示往行李清单补东西。
 * 行程详情页与行李页共用这一份规则。
 */
export const LINKED_PACKING_RULES: { kws: string[]; items: string[] }[] = [
  { kws: ['徒步', '登山', '爬山', '爬山', '户外'], items: ['登山鞋', '登山杖', '护膝', '冲锋衣'] },
  { kws: ['海', '沙滩', '潜水', '浮潜', '游泳'], items: ['泳衣', '防水手机袋', '速干浴巾', '高倍防晒霜', '浮潜面镜'] },
  { kws: ['滑雪', '雪场', '雪'], items: ['滑雪服', '护目镜', '头盔', '滑雪手套', '暖宝宝'] },
  { kws: ['露营', '帐篷', '野餐'], items: ['帐篷', '防潮垫', '营地灯', '睡袋'] },
  { kws: ['会议', '商务', '拜访', '客户'], items: ['笔记本电脑', '名片', '商务正装', '会议资料 / U盘'] },
  { kws: ['亲子', '儿童', '宝宝', '动物园'], items: ['纸尿裤', '儿童常备药', '湿巾 / 棉柔巾', '儿童换洗衣物'] },
  { kws: ['温泉', '泡汤'], items: ['泳衣', '速干浴巾'] },
  { kws: ['寺庙', '教堂', '古迹'], items: ['舒适的步行鞋', '遮阳帽'] }
];

/** 依据行程条目内容，给出建议补充的行李名（已去重） */
export function suggestPackingByItems(texts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    for (const rule of LINKED_PACKING_RULES) {
      if (rule.kws.some((k) => text.indexOf(k) >= 0)) {
        for (const it of rule.items) {
          if (!seen.has(it)) {
            seen.add(it);
            out.push(it);
          }
        }
      }
    }
  }
  return out;
}
