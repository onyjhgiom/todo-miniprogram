// utils/civil-strategy.ts
// 「仕途衡鉴」策略引擎：把一条体制内岗位，推导成一份可执行的备考作战方案。
//
// 设计原则：
//   1. 纯函数、零网络依赖 —— 未配 AI Key 也能用，点开任意岗位立刻有结果；
//   2. 四维交叉：赛道(track) × 岗位方向(direction) × 编制类型(compile) × 剩余时间(节点)；
//   3. 只给「可执行的动作」，不编造具体年份的真题、不编造内部政策。
//
// 同时提供 AI 不可用时的本地兜底：赛道测评 assessLocal / 备考计划 buildPlanLocal。

import type { CivilJob, Fresh } from './civil-data';
import {
  CIVIL_TRACKS, COMPILE_TYPES, CIVIL_JOBS, compileOf, compileTone, freshLabel, trackOf, FRESH_FAQ
} from './civil-data';

/* ==================== 类型 ==================== */

export interface CivilBlock {
  key: string;
  icon: string;
  title: string;
  items: string[];
}

export interface CivilStage {
  when: string;
  todo: string[];
}

export interface CivilGuide {
  /** 一句话点出该岗位的备战重心 */
  focus: string;
  /** 节奏提示，如「距国考笔试约 68 天 · 距报名约 31 天」 */
  timing: string;
  /** 按时间倒推的行动阶段 */
  stages: CivilStage[];
  /** 分维度准备要点 */
  blocks: CivilBlock[];
  /** 容易踩的坑 */
  risks: string[];
  /** 纯文本版（复制用） */
  text: string;
}

/* ==================== 时间解析 ==================== */

/**
 * 从「11 月-次年 3 月」「3-5 月 / 9-11 月」这类文案里解析出所有可能的月份。
 * 策略：按分隔符切段，每段取第一个数字 → 得到「起报/起始」月份，避免把区间末端误当起点。
 */
export function parseMonths(text: string): number[] {
  const t = String(text || '');
  if (!t) return [];
  const segs = t.split(/[\/、；;]+/);
  const out: number[] = [];
  segs.forEach((seg) => {
    const m = seg.match(/(\d{1,2})/);
    if (!m) return;
    const n = Number(m[1]);
    if (n >= 1 && n <= 12 && out.indexOf(n) < 0) out.push(n);
  });
  return out;
}

/** 取最近一个「未来」的该月份日期（第 15 天）；都已过则顺延到明年 */
function nearestDate(months: number[], now: number): { month: number; days: number } | null {
  if (!months.length) return null;
  const d = new Date(now + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  let best: { month: number; days: number } | null = null;
  months.forEach((m) => {
    // 以「当月 15 日」为参考节点
    let target = Date.UTC(y, m - 1, 15, 4, 0, 0) - 8 * 3600 * 1000;
    if (target < now) target = Date.UTC(y + 1, m - 1, 15, 4, 0, 0) - 8 * 3600 * 1000;
    const days = Math.ceil((target - now) / 86400000);
    if (days >= 0 && (!best || days < best.days)) best = { month: m, days };
  });
  void mo;
  return best;
}

/* ==================== 岗位方向规则 ==================== */

type DirKey =
  | 'tax' | 'customs' | 'police' | 'judicial' | 'finReg' | 'statistics' | 'meteorology'
  | 'industry' | 'discipline' | 'foreign' | 'selection' | 'healthAdmin' | 'generalAdmin'
  | 'fiscal' | 'enforcement' | 'teacher' | 'counselor' | 'doctor' | 'nurse' | 'publicHealth'
  | 'library' | 'museum' | 'agri' | 'water' | 'buildSupervise' | 'planning' | 'news'
  | 'logistics' | 'tobacco' | 'mt' | 'transport' | 'rnd' | 'engineering' | 'marketing'
  | 'operations' | 'hr' | 'accounting' | 'legal' | 'tech' | 'general';

interface DirRule {
  key: DirKey;
  label: string;
  /** 岗位能力准备 */
  ability: string[];
  /** 笔试/面试高频考察点 */
  interview: string[];
}

const DIR_RULES: Record<DirKey, DirRule> = {
  tax: {
    key: 'tax',
    label: '税务',
    ability: [
      '把税收征管流程讲通：登记 → 申报 → 征收 → 稽查 → 服务',
      '熟悉增值税、企业所得税、个人所得税三大主税种的基本框架（不必到精算程度）',
      '了解金税四期、智慧税务等近年重点方向，面试常被问到',
      '准备 1 个「纳税服务/政策宣讲」的服务类案例'
    ],
    interview: [
      '「纳税人情绪激动要求退税」→ 先安抚、再核实政策、明确时限、留痕反馈',
      '「如何理解税收营商环境」→ 减税降费 + 便利化 + 精准监管三条线',
      '申论常考「优化营商环境」「减税降费落地」题材'
    ]
  },
  customs: {
    key: 'customs',
    label: '海关监管',
    ability: [
      '了解海关四大职能：监管、征税、缉私、统计',
      '熟悉通关一体化、跨境电商监管等近年改革方向',
      '准备「查验发现违规货物」的处置流程：扣留 → 立案 → 告知 → 复议',
      '英语读写能力是加分项（进出口单证）'
    ],
    interview: [
      '海关面试重「执法规范性」，答题要体现程序意识',
      '「企业申报不实如何处置」→ 区分主观故意与过失，依法分类处理',
      '常考涉外场景，注意表述的严谨性'
    ]
  },
  police: {
    key: 'police',
    label: '公安执法',
    ability: [
      '体能测试是硬门槛：1000 米（男）/800 米（女）、纵跳摸高、往返跑，提前 3 个月练',
      '了解《人民警察法》《治安管理处罚法》的基本原则与处罚种类',
      '政审严格：本人及直系亲属无违法犯罪记录',
      '准备 1 个「矛盾纠纷现场处置」的案例'
    ],
    interview: [
      '面试重「规范执法 + 群众工作」，答题要走「到场—控场—处置—回访」四步',
      '「执勤时遇围观起哄」→ 先隔离、再劝导、必要时调用支援、全程记录仪',
      '视力、身高、体能等前置条件要提前对照《公务员录用体检特殊标准》'
    ]
  },
  judicial: {
    key: 'judicial',
    label: '司法审判辅助',
    ability: [
      '法考 A 证是多数法官助理岗的硬门槛，没有证的不要投',
      '熟悉民事/刑事/行政三大诉讼法的主要程序节点',
      '练速录与卷宗整理，这是入职后最高频的工作',
      '准备「庭审记录与文书校对要点」的实操理解'
    ],
    interview: [
      '面试偏专业，可能现场给案例让分析法律关系',
      '「当事人对判决不满大闹法庭」→ 释法明理、维护秩序、必要时训诫',
      '文书写作能力是隐性考察项，申论与公文功底别荒废'
    ]
  },
  finReg: {
    key: 'finReg',
    label: '金融监管',
    ability: [
      '考专业科目：金融监管岗必加试，含宏观金融、银行监管、证券期货基础',
      '了解审慎监管框架：资本充足率、不良率、流动性比例三大约束',
      '准备对影子银行、地方债、房地产风险的基本认知',
      '竞争比极高（常 70:1 以上），要有长期备考心理准备'
    ],
    interview: [
      '专业面可能追问「如何识别一家银行的风险信号」',
      '「监管与发展的关系」→ 防风险是前提，服务实体是目的',
      '关注近年金融监管体制改革相关表述'
    ]
  },
  statistics: {
    key: 'statistics',
    label: '统计调查',
    ability: [
      '复习统计学基础：抽样方法、抽样误差、描述性统计',
      '了解 GDP 核算、CPI/PPI、住户调查等核心调查体系',
      'Excel 与统计软件（SPSS/R）是加分项',
      '准备对「数据造假」的治理理解（统计法）'
    ],
    interview: [
      '「入户调查被拒」→ 说明目的、承诺保密、择时再访、联动社区',
      '常考数据敏感度：看到异常数据如何处理',
      '申论可能涉及「数字政府」「数据要素」题材'
    ]
  },
  meteorology: {
    key: 'meteorology',
    label: '气象业务',
    ability: [
      '专业壁垒强，大气科学类对口岗位竞争比很低',
      '复习天气学原理、数值预报基础、气象观测规范',
      '了解气象灾害预警信号分级（蓝黄橙红）',
      '准备对「气象服务民生」的案例理解'
    ],
    interview: [
      '「台风预警发布后如何响应」→ 分级响应、信息发布、部门联动',
      '专业技术面会问预报业务与观测业务的基本流程',
      '气象局工作节奏较规律，面试重踏实稳重'
    ]
  },
  industry: {
    key: 'industry',
    label: '行业管理',
    ability: [
      '了解行业监管的基本框架与主要法规',
      '准备「行业安全监管」的常见场景处置',
      '公文写作能力重要，日常以文件往来为主',
      '熟悉行业近年政策热点'
    ],
    interview: [
      '面试综合性强，重政策理解与表达能力',
      '「发现企业违规经营」→ 取证、告知、依法处理、跟踪整改',
      '答题注意体现服务与管理并重'
    ]
  },
  discipline: {
    key: 'discipline',
    label: '纪检监察',
    ability: [
      '学习《监察法》《党纪处分条例》的基本框架',
      '了解监督执纪「四种形态」的运用',
      '政审最严的岗位之一，直系亲属情况也会核查',
      '文字表达能力要求高，日常以审查报告、谈话记录为主'
    ],
    interview: [
      '政治素质是首要考察项，答题必须立场清晰',
      '「同事违规如何处置」→ 按程序报告、不包庇不隐瞒、注意保密',
      '面试常考「原则与人情」的取舍场景'
    ]
  },
  foreign: {
    key: 'foreign',
    label: '外交外事',
    ability: [
      '外语是核心门槛，多数岗位要求专业八级或同等水平',
      '加试专业科目含外语笔试与口试，需单独准备',
      '了解我国外交基本立场与近年重大外交议程',
      '需接受驻外安排（多为 2-3 年一轮）'
    ],
    interview: [
      '面试含外语问答环节，注意表达的准确与得体',
      '「驻外期间遇突发情况」→ 报馆、联系当地、保护同胞',
      '政治素质与纪律意识是考察重点'
    ]
  },
  selection: {
    key: 'selection',
    label: '选调培养',
    ability: [
      '硬条件：党员 + 学生干部 + 获奖 + 特定高校毕业生，四项越全越好',
      '准备「为什么选择基层」这一必问题的真诚版本',
      '了解选调生的培养路径：基层锻炼 → 机关轮岗 → 遴选提拔',
      '关注目标省份的定向选调公告（9-12 月）'
    ],
    interview: [
      '面试重「理想信念」与「基层认知」，忌空喊口号',
      '「基层条件艰苦想离开怎么办」→ 讲清认知与坚持，别提条件',
      '建议准备一个自己在基层/志愿活动中的真实故事'
    ]
  },
  healthAdmin: {
    key: 'healthAdmin',
    label: '卫生健康管理',
    ability: [
      '了解医疗卫生体系：三级医疗网络、公共卫生应急体系',
      '熟悉医改重点：分级诊疗、DRG 付费、公立医院改革',
      '准备公共卫生突发事件的信息发布与协调逻辑',
      '公文与数据统计能力是日常刚需'
    ],
    interview: [
      '「突发疫情如何响应」→ 监测预警、分级响应、资源调配、信息发布',
      '常考对医患矛盾的调解思路',
      '答题要体现「以人民健康为中心」'
    ]
  },
  generalAdmin: {
    key: 'generalAdmin',
    label: '综合管理 / 文字',
    ability: [
      '公文写作是核心能力：通知、请示、报告、纪要四类必须会写',
      '练「三办」能力：办文、办会、办事',
      '熟悉机关运转逻辑：请示汇报、层级沟通、留痕归档',
      '准备 1 个组织协调类的真实案例（会议、活动、专项工作）'
    ],
    interview: [
      '「领导让你三天内完成一份没接触过的报告」→ 拆解任务、找资料、列框架、请核把关',
      '常考「同事不配合」「临时改需求」等沟通协调场景',
      '答题结构推荐：先表态 → 分析原因 → 具体措施 → 总结提升'
    ]
  },
  fiscal: {
    key: 'fiscal',
    label: '财政 / 审计',
    ability: [
      '复习预算管理流程：编制 → 审批 → 执行 → 决算 → 绩效评价',
      '了解政府会计准则与政府综合财务报告制度',
      '审计岗要懂审计程序：计划 → 实施 → 报告 → 整改',
      'Excel 与财务软件操作是加分项'
    ],
    interview: [
      '「发现预算执行率异常偏低」→ 查原因、督支出、提建议',
      '审计场景常考「发现违规如何处置」：报告、移送、跟踪整改',
      '答题体现「依法理财、绩效导向」'
    ]
  },
  enforcement: {
    key: 'enforcement',
    label: '行政执法',
    ability: [
      '核心是「程序合法」：亮证、告知、听取陈述申辩、送达、救济告知',
      '熟悉《行政处罚法》的处罚种类与听证程序',
      '准备执法记录仪使用、文书制作等实操理解',
      '体能要求不一，城管执法偶有体能测试'
    ],
    interview: [
      '「执法对象不配合」→ 释法说理、留存证据、依法处置、避免冲突',
      '答题必须体现「规范、公正、文明」执法三要素',
      '常考舆论关注下的执法方式选择'
    ]
  },
  teacher: {
    key: 'teacher',
    label: '教师',
    ability: [
      '教资是硬门槛（多数岗位要求持证，且学科要对应）',
      '教综三块：教育学（占比最高）、心理学、教育法规与师德',
      '学科知识按高考难度准备（中学岗），小学岗可降至中考难度',
      '普通话等级：语文教师需二级甲等，其他学科二级乙等'
    ],
    interview: [
      '试讲 10-15 分钟，必须练完整课时结构：导入-新授-巩固-小结-作业',
      '结构化常考：学生早恋、家长投诉、课堂纪律失控',
      '板书要练，工整的字迹直接加分'
    ]
  },
  counselor: {
    key: 'counselor',
    label: '高校辅导员',
    ability: [
      '多数岗位要求党员 + 硕士，这是硬门槛',
      '熟悉教育部辅导员职业能力标准与「四心」要求',
      '了解学生工作主线：思想引领、学业帮扶、心理健康、就业指导',
      '准备 1 个组织班级/社团活动的真实案例'
    ],
    interview: [
      '「学生出现心理危机」→ 及时报告、专业介入、家校联动、持续关注',
      '「宿舍矛盾激化」→ 分别谈话、共同协商、明确规则、回访跟踪',
      '面试重共情力与责任心，别只讲制度'
    ]
  },
  doctor: {
    key: 'doctor',
    label: '临床医师',
    ability: [
      '执业医师资格证 + 规培证是硬门槛',
      '复习专业知识按报考科室准备（内科/外科/影像/检验各有侧重）',
      '准备 1 个完整的病例分析：主诉-查体-辅助检查-诊断-处理',
      '三甲医院差额编绩效高，但需看清科室与工作量'
    ],
    interview: [
      '面试含病例分析与技能操作（心肺复苏、穿刺、体格检查）',
      '「医患沟通中家属情绪激动」→ 先共情、再解释、给方案、留记录',
      '专业面可能追问最新诊疗指南'
    ]
  },
  nurse: {
    key: 'nurse',
    label: '护理',
    ability: [
      '护士执业资格证是硬门槛',
      '复习基础护理学、内外科护理学的核心操作规范',
      '练技能操作：静脉输液、无菌技术、心肺复苏、导尿',
      '了解护士排班特点，做好夜班心理准备'
    ],
    interview: [
      '技能操作考核常占面试大头，手法规范比速度重要',
      '「患者家属质疑护理操作」→ 耐心解释、请资深同事协助、上报护士长',
      '面试重耐心、细心、情绪稳定'
    ]
  },
  publicHealth: {
    key: 'publicHealth',
    label: '公共卫生',
    ability: [
      '复习流行病学、卫生统计学、环境卫生学基础',
      '了解传染病报告流程与突发公共卫生事件分级',
      '熟悉免疫规划、慢病管理、健康促进等业务模块',
      '数据分析能力（SPSS/Excel）是加分项'
    ],
    interview: [
      '「发现聚集性病例」→ 核实、报告、流调、控制措施、信息发布',
      '常考「健康教育如何落地」的策划题',
      '疾控工作强调严谨与规范'
    ]
  },
  library: {
    key: 'library',
    label: '图书资料',
    ability: [
      '了解中图法分类体系与文献编目基础',
      '熟悉图书馆业务链条：采编-流通-参考咨询-数字资源',
      '准备对「全民阅读推广」的活动策划思路',
      '信息检索能力是核心技能'
    ],
    interview: [
      '「读者投诉资源不足」→ 倾听、调研、优化采购、公示改进',
      '常考阅读推广活动的策划题，要有具体方案',
      '面试氛围相对平和，重服务意识'
    ]
  },
  museum: {
    key: 'museum',
    label: '文博研究',
    ability: [
      '专业壁垒强，考古/文博/历史对口竞争比低',
      '复习文物学、博物馆学、考古学基础理论',
      '准备对某类文物的研究兴趣点（面试常问）',
      '了解文物保护法与新修订内容'
    ],
    interview: [
      '「讲解中观众提出专业质疑」→ 坦诚、记录、查证、回复',
      '常考展陈策划与社教活动设计',
      '专业面可能涉及具体文物断代与辨伪基础'
    ]
  },
  agri: {
    key: 'agri',
    label: '农业技术',
    ability: [
      '复习作物栽培、植物保护、土壤肥料学基础',
      '了解乡村振兴与高标准农田建设等政策',
      '准备田间实操理解：病虫害识别、测土配方施肥',
      '能接受下乡与农时节奏'
    ],
    interview: [
      '「推广新技术农户不接受」→ 示范田、算效益、找带头人、组织观摩',
      '常考农技推广的实际场景题',
      '答题要接地气，避免纯理论'
    ]
  },
  water: {
    key: 'water',
    label: '水利工程',
    ability: [
      '复习水文学、水力学、水利工程管理基础',
      '了解防汛抗旱体系与水利工程分级管理',
      '准备对河长制、水资源刚性约束的理解',
      '部分岗位需野外作业与汛期值守'
    ],
    interview: [
      '「汛期险情上报与处置」→ 立即报告、启动预案、组织转移、抢险加固',
      '常考水利工程安全巡查要点',
      '答题要体现责任意识与应急能力'
    ]
  },
  buildSupervise: {
    key: 'buildSupervise',
    label: '工程质量监督',
    ability: [
      '熟悉建设工程质量与安全管理条例',
      '了解验收流程：分部分项验收 → 竣工验收 → 备案',
      '看得懂施工图与规范条文，实操性要求高',
      '注册类证书（建造师/监理工程师）是加分项'
    ],
    interview: [
      '「施工单位偷工减料」→ 停工、取证、上报、依法处理、跟踪整改',
      '常考安全检查与隐患整改流程',
      '答题要体现「安全第一、依法监管」'
    ]
  },
  planning: {
    key: 'planning',
    label: '规划设计',
    ability: [
      '熟练掌握 CAD / GIS / SketchUp 等工具，作品集是硬通货',
      '了解国土空间规划体系的改革方向',
      '准备 1 个完整的规划项目作品（含分析逻辑）',
      '自收自支单位须确认收益与改革风险'
    ],
    interview: [
      '面试常要求现场快题或作品讲解，动手能力决定成败',
      '「规划方案被要求大幅修改」→ 理解诉求、评估影响、给出备选',
      '专业面深挖项目细节，别写没做过的项目'
    ]
  },
  news: {
    key: 'news',
    label: '新闻采编',
    ability: [
      '准备 3 篇不同体裁的作品（消息、通讯、评论）',
      '熟悉新闻采编流程与「三审三校」制度',
      '新媒体技能（短视频剪辑、图文排版）大幅加分',
      '融媒体中心岗位须确认编制性质（多为备案制）'
    ],
    interview: [
      '常考现场改稿或拟标题，动手能力是核心',
      '「采访对象拒绝配合」→ 换角度、找相关方、以理服人',
      '政治导向意识是必考项'
    ]
  },
  logistics: {
    key: 'logistics',
    label: '后勤辅助',
    ability: [
      '⚠️ 这类岗位多为合同制或劳务派遣，先确认签约主体',
      '了解后勤保障的基本模块：餐饮、物业、设备、安全',
      '准备服务意识与耐心沟通的案例',
      '若确无更好选择，把它当过渡而非目标'
    ],
    interview: [
      '面试门槛低，但更要把「稳定性」讲清楚',
      '常考服务投诉处置场景',
      '建议同步投递带编岗位，不要单点押注这类岗'
    ]
  },
  tobacco: {
    key: 'tobacco',
    label: '烟草专卖与营销',
    ability: [
      '烟草是国企待遇第一梯队，竞争激烈，笔试常含行测 + 专业常识',
      '了解烟草专卖制度与专卖法基本框架',
      '准备市场走访、终端维护的业务理解',
      '政审与体检严格，注意回避亲属从业要求'
    ],
    interview: [
      '「零售户违规经营」→ 宣传教育、依法查处、跟踪回访',
      '常考市场分析与客户服务场景',
      '面试重稳重与合规意识，忌过度激进'
    ]
  },
  mt: {
    key: 'mt',
    label: '管培生',
    ability: [
      '英语能力（CET-6 起步）与学习成绩是网申硬指标',
      '准备 2 段能讲透的实习或项目经历（STAR 结构）',
      '无领导小组讨论是必过关卡，提前练角色分工',
      '轮岗意味着可能异地，主动表达服从安排的意愿'
    ],
    interview: [
      '半结构化高频：为什么选我们、职业规划、能否接受异地',
      '群面评分重点在「是否推动团队往前走」，不是发言次数',
      '准备 1 个展现领导力的真实案例（社团/项目/比赛）'
    ]
  },
  transport: {
    key: 'transport',
    label: '铁路运输',
    ability: [
      '专科即可报名，是学历门槛最低的央企正式岗之一',
      '了解铁路运输组织：调度、车站作业、乘务、车辆',
      '能接受轮班与夜班，这是岗位的固有属性',
      '体检较严，色盲色弱多不可报'
    ],
    interview: [
      '面试重「稳定性」与「能否吃苦」，别抱怨作息',
      '常考安全规章类常识题',
      '答题朴实真诚比华丽表达更有效'
    ]
  },
  rnd: {
    key: 'rnd',
    label: '军工研发',
    ability: [
      '硕士起步，专业对口（航空航天/材料/自动化/核工程）',
      '梳理研究生期间的课题，要能讲清技术难点与自己的贡献',
      '政审最严：本人及家庭成员政治历史、社会关系都会核查',
      '保密意识是入职前提，社交账号内容要提前清理'
    ],
    interview: [
      '技术面深挖课题细节，任何写在简历上的都不能虚',
      '常问「为什么选择军工院所」→ 讲清事业认同与稳定诉求',
      '准备英文文献阅读能力的证明'
    ]
  },
  engineering: {
    key: 'engineering',
    label: '工程管理',
    ability: [
      '熟悉工程全流程：投标 → 施工组织 → 质量安全 → 竣工结算',
      '会用 CAD 与识图，这是基本功',
      '了解项目商务：造价、变更、索赔的基本概念',
      '⚠️ 多数岗位需驻项目，投递前想清楚能否长期在工地'
    ],
    interview: [
      '「工期紧张与质量冲突」→ 先保质量底线、再优化工序、必要时申请资源',
      '常考现场安全管理与团队协作场景',
      '面试会确认你能接受驻外与高强度'
    ]
  },
  marketing: {
    key: 'marketing',
    label: '市场营销 / 业务',
    ability: [
      '准备 1 个销售或客户拓展相关的真实经历',
      '了解目标行业的产品体系与客户结构',
      '抗压能力与沟通表达是核心考察项',
      '国企营销岗注意区分正式工与市场化用工'
    ],
    interview: [
      '「如何开发一个新客户」→ 目标筛选、需求挖掘、方案匹配、持续跟进',
      '「业绩指标未达成怎么办」→ 拆解原因、调整打法、争取资源',
      '答题要有数据意识，忌空谈态度'
    ]
  },
  operations: {
    key: 'operations',
    label: '运营管理',
    ability: [
      '准备 1 个流程优化或效率提升的案例（有数据最好）',
      '了解目标业务的核心指标（如电力的供电可靠性、银行的资产质量）',
      'Excel 数据分析能力是日常刚需',
      '国企运营岗偏规范执行，强调流程与合规'
    ],
    interview: [
      '「运营指标异常」→ 定位环节、分析原因、制定措施、跟踪验证',
      '常考跨部门协调场景：怎么推动不配合的部门',
      '答题要有闭环意识'
    ]
  },
  hr: {
    key: 'hr',
    label: '人力资源',
    ability: [
      '掌握六大模块基本框架：招聘、培训、绩效、薪酬、员工关系、规划',
      '了解国企人事制度特点：编制管理、职级序列、党员发展',
      '准备 1 个组织招聘或培训的实操案例',
      '沟通与保密意识是核心素质'
    ],
    interview: [
      '「部门要求紧急补人但预算不足」→ 内部调配、优化流程、分阶段招聘',
      '「员工调岗产生抵触」→ 讲清原因、倾听诉求、依法依规办理',
      '面试重亲和力与原则性的平衡'
    ]
  },
  accounting: {
    key: 'accounting',
    label: '财务 / 审计',
    ability: [
      '三张报表的勾稽关系要能徒手推导',
      'Excel 必须熟练：SUMIFS / INDEX-MATCH / 数据透视',
      '了解国企财务特点：资金集中管理、国资报表、预算刚性',
      'CPA 已过科目要写在简历上，国企很吃这一套'
    ],
    interview: [
      '「月末结账做什么」→ 计提摊销、往来核对、存货盘点、税金核对、出报表',
      '「预实差异怎么分析」→ 拆分价量、归因到部门、提出下月措施',
      '面试会确认你能否接受财务岗的重复性与合规约束'
    ]
  },
  legal: {
    key: 'legal',
    label: '法务合规',
    ability: [
      '法考 A 证是硬门槛，国企法务尤其看重',
      '熟悉合同审查要点：主体、标的、价款、违约、争议解决',
      '了解国资监管法规与合规体系建设要求',
      '准备 1 个合同风险识别的实操案例'
    ],
    interview: [
      '面试会现场给一份合同让找问题',
      '「业务部门要求先签后审」→ 说明风险、紧急预案、补齐程序',
      '答题要体现「既防风险，又促业务」的平衡'
    ]
  },
  tech: {
    key: 'tech',
    label: '技术岗',
    ability: [
      '专业基础要扎实：电气/通信/计算机按岗位方向复习核心课程',
      '准备 1 个能讲清技术细节的项目（自研或课程设计都行）',
      '国企技术岗更看重规范意识与文档能力，不只是写代码',
      '了解目标行业的技术体系（如电网的二次系统、运营商的网络架构）'
    ],
    interview: [
      '技术面会深挖简历上的项目，虚写的部分一定会被问穿',
      '「现场设备异常如何排查」→ 现象、定位、验证、处置、复盘',
      '空窗期与跨专业要有合理说明'
    ]
  },
  general: {
    key: 'general',
    label: '通用',
    ability: [
      '把简历按该岗位的关键词改一版，词要对得上岗位描述',
      '准备 3 段 STAR 结构经历，每段能讲 90 秒',
      '了解报考单位的主要职能与近年重点工作',
      '准备「为什么报考我们单位」的真诚版本'
    ],
    interview: [
      '结构化高频：动机、稳定性、抗压、团队协作、应急处突',
      '答题结构：先表态 → 分析原因 → 具体措施 → 总结提升',
      '所有问题都要落到具体行动，忌空喊口号'
    ]
  }
};

/** 关键词 → 方向（有序，先匹配更具体的） */
const DIR_ORDER: { kw: string[]; t: DirKey }[] = [
  { kw: ['税务'], t: 'tax' },
  { kw: ['海关'], t: 'customs' },
  { kw: ['公安'], t: 'police' },
  { kw: ['司法'], t: 'judicial' },
  { kw: ['金融监管'], t: 'finReg' },
  { kw: ['统计'], t: 'statistics' },
  { kw: ['气象'], t: 'meteorology' },
  { kw: ['行业管理'], t: 'industry' },
  { kw: ['纪检监察'], t: 'discipline' },
  { kw: ['外交', '外事'], t: 'foreign' },
  { kw: ['选调'], t: 'selection' },
  { kw: ['卫生管理', '卫生健康'], t: 'healthAdmin' },
  { kw: ['综合文字', '综合管理', '基层综合'], t: 'generalAdmin' },
  { kw: ['财政', '审计'], t: 'fiscal' },
  { kw: ['环保执法', '城管执法', '行政执法', '综合执法', '执法'], t: 'enforcement' },
  { kw: ['教师'], t: 'teacher' },
  { kw: ['辅导员'], t: 'counselor' },
  { kw: ['医师'], t: 'doctor' },
  { kw: ['护理'], t: 'nurse' },
  { kw: ['公共卫生'], t: 'publicHealth' },
  { kw: ['图书'], t: 'library' },
  { kw: ['文博', '文物'], t: 'museum' },
  { kw: ['农技'], t: 'agri' },
  { kw: ['水利'], t: 'water' },
  { kw: ['工程监督', '质量安全监督'], t: 'buildSupervise' },
  { kw: ['规划设计'], t: 'planning' },
  { kw: ['新闻', '采编'], t: 'news' },
  { kw: ['后勤'], t: 'logistics' },
  { kw: ['专卖'], t: 'tobacco' },
  { kw: ['管培'], t: 'mt' },
  { kw: ['运输'], t: 'transport' },
  { kw: ['研发'], t: 'rnd' },
  { kw: ['工程'], t: 'engineering' },
  { kw: ['营销', '市场', '业务'], t: 'marketing' },
  { kw: ['运营'], t: 'operations' },
  { kw: ['人力'], t: 'hr' },
  { kw: ['财务'], t: 'accounting' },
  { kw: ['法务'], t: 'legal' },
  { kw: ['技术'], t: 'tech' }
];

/** 从岗位方向文案解析方向规则 */
export function directionRule(direction: string): DirRule {
  const s = String(direction || '');
  for (const row of DIR_ORDER) {
    for (const kw of row.kw) {
      if (s.indexOf(kw) >= 0) return DIR_RULES[row.t];
    }
  }
  return DIR_RULES.general;
}

/** 方向中文标签 */
export function directionLabel(direction: string): string {
  return directionRule(direction).label;
}

/* ==================== 编制差异提醒 ==================== */

const COMPILE_ADVICE: Record<string, { items: string[]; risk: string }> = {
  admin: {
    items: [
      '确认是否受「最低服务年限」约束（乡镇岗多为 5 年），中途离职会计入诚信档案',
      '政审需提前准备：无犯罪记录、无失信记录、档案完整可查',
      '体检按《公务员录用体检通用标准》执行，提前自费做一次预检',
      '录用后办理公务员登记，这才是「真正的编制」'
    ],
    risk: '把「参公管理事业单位」当成行政编制 —— 参公是事业编，只是参照公务员管理，晋升与待遇仍有差异。'
  },
  careerFull: {
    items: [
      '签的是《事业单位聘用合同》，同时占事业编制，问清服务期年限',
      '在编人员的社保、公积金基数要确认是否按事业单位标准执行',
      '职称评定要走单位人事，入职后尽早问清评定时间表',
      '服务期内一般不得报考其他单位，注意公告里的限制条款'
    ],
    risk: '把「全额拨款的合同制岗」误认成在编岗 —— 编制只认人事部门的编制卡，不认「全额」二字。'
  },
  careerDiff: {
    items: [
      '绩效部分与单位/科室效益挂钩，谈 offer 时务必问清「近三年人均绩效」',
      '同为差额编，三甲与二级医院到手收入可能差一倍，别只看编制类型',
      '了解该单位是否有「备案制改革」计划，避免入职后身份变化',
      '关注绩效分配方案与考核规则，这是差额编收入的实际决定因素'
    ],
    risk: '只问「有没有编制」却忘了问「绩效怎么算」—— 差额编的收入差异全在绩效口径。'
  },
  careerSelf: {
    items: [
      '入职前查清该单位是否在「事业单位转企改革」名单中',
      '了解近三年经营状况与发薪是否及时（可问在职人员）',
      '收入弹性大：效益好的设计院/检测机构高于全额编',
      '保留工作痕迹与业绩证明，若转企后编制核销，能靠能力留任'
    ],
    risk: '⚠️ 自收自支是事业编改革的高风险区，单位效益差时可能发不出绩效甚至工资，务必先核实经营情况。'
  },
  record: {
    items: [
      '问清三件事：是否同工同酬、能否转为正式编制、社保基数是否一致',
      '「备案制」不是传统事业编，跨单位调动受限',
      '要求把待遇承诺写进聘用合同，口头承诺不具约束力',
      '了解本单位的备案人员转编政策与历史案例'
    ],
    risk: '⚠️ 「备案编制」「员额制」常被宣传成「有编制」，严格说不是。落地程度各地差异极大，务必电话核实。'
  },
  contract: {
    items: [
      '「同工同酬」必须看到写在合同里才算数',
      '问清合同期限与续签规则，避免到期不续签的风险',
      '社保与公积金缴纳基数要核对，部分单位按最低基数缴纳',
      '把这类岗位当跳板而非终点，同步备考带编岗位'
    ],
    risk: '招聘启事通篇不提「编制」二字的，基本就是合同制。别用「事业单位」的印象替它加分。'
  },
  soeFormal: {
    items: [
      '签约主体必须是国企本部或明确的分公司，看清营业执照名称',
      '问清「是否属于正式员工序列」—— 有些企业新员工也走市场化用工',
      '了解三年考核规则与转正条件，部分企业有隐性淘汰',
      '核对六险二金、企业年金、住房补贴等福利是否与老员工一致'
    ],
    risk: '⚠️ 国有企业的「子公司 / 外包公司」也挂着集团名号，但签下去就不是正式工。合同上签字盖章的那家公司，才是你的雇主。'
  },
  soeMarket: {
    items: [
      '明确「市场化用工」与「正式员工」是两套序列，待遇与晋升分开管理',
      '问清考核周期与末位调整规则，这类岗位有真实的淘汰压力',
      '起薪可能高于正式岗，但要算清长期福利与年功差距',
      '作为进入国企体系的跳板是可行的，但要设定期限'
    ],
    risk: '在同一家国企里，「正式工」和「市场化用工」的差距随年限拉大。谈 offer 时直接问：我算不算正式员工序列？'
  },
  dispatch: {
    items: [
      '⚠️ 签约方如果是「XX人力资源/劳务服务公司」，你就是派遣身份',
      '派遣人员不是国企员工，随时可能被退回，几乎没有晋升通道',
      '同工不同酬普遍存在，别被「在国企上班」的描述迷惑',
      '除非确无选择，否则不要把它当作主投方向'
    ],
    risk: '⚠️ 校招里最需要避雷的一类。识别特征：签约方是人力资源公司、岗位描述含糊、入职快、不设笔试。'
  }
};

/* ==================== 赛道级笔试/面试块 ==================== */

function trackBlocks(job: CivilJob): CivilBlock[] {
  const t = job.track;
  if (t === 'gk') {
    return [
      {
        key: 'written',
        icon: '📝',
        title: '笔试构成与备考方法（国考）',
        items: [
          '行测 130-135 题 / 120 分钟，拼速度与取舍；固定顺序：常识 → 资料 → 判断 → 言语 → 数量',
          '资料分析是必须拿高分的模块，目标 20 分钟全对，练速算（错位加减、截位直除）',
          '申论 5 题 / 180 分钟，材料 6000 字以上，先练概括题再练大作文',
          '近 5 年国考真题刷 3 遍，第 3 遍严格计时，比刷模拟题有效得多'
        ]
      },
      {
        key: 'special',
        icon: '🔍',
        title: '该岗位可能加试的专业科目',
        items: [
          '金融监管/证监类：加试金融监管专业科目（宏观金融、银行监管、证券期货）',
          '铁路公安：加试公安基础知识（执法程序、警务技能）',
          '外交外事：加试外语笔试与口试，需单独准备',
          '报名公告的「考试科目」一栏会写明是否加试，务必逐字看'
        ]
      }
    ];
  }
  if (t === 'sk') {
    return [
      {
        key: 'written',
        icon: '📝',
        title: '笔试构成与备考方法（省考）',
        items: [
          '先找近 5 年本省真题摸清题量与分值，自主命题省份（江苏/浙江/山东）差异大',
          '行测与国考知识 90% 通用，考前 2 周切到本省真题即可',
          '部分省份加试《公共基础知识》，含法律/时政/省情，需单独补',
          '乡镇岗申论偏「基层治理/乡村振兴」题材，提前积累案例'
        ]
      },
      {
        key: 'level',
        icon: '🧩',
        title: '本岗位层级对应的打法',
        items: [
          job.level === '乡镇' ? '乡镇岗竞争最小（约 20:1），但普遍有 5 年服务期，报名前想清楚' : '非乡镇岗竞争比通常更高，建议同时报一个乡镇岗兜底',
          '省直/市直岗更看重文字功底，申论与公文写作是关键',
          '区县岗事务性强，面试偏实务场景题',
          '入职后可通过遴选向上流动，不必一开始就死磕省直'
        ]
      }
    ];
  }
  if (t === 'sy') {
    return [
      {
        key: 'written',
        icon: '📝',
        title: '笔试构成与备考方法（事业编）',
        items: [
          '联考科目：职业能力倾向测验 + 综合应用能力（分 A/B/C/D/E 五类）',
          'A 类综合管理考公文写作与方案策划；B/C 类加考概念分析、科技实务',
          'D 类教师加考教育方案设计；E 类医疗加考医学基础知识与临床专项',
          '单招岗位常见《公共基础知识》，含时政、法律、公文、省情'
        ]
      },
      {
        key: 'industry',
        icon: '🎓',
        title: '本岗位所属行业的专业准备',
        items: job.industry
          ? [
            `${job.industry}类岗位专业壁垒明确，对口竞争比通常只有不限岗的 1/3`,
            '把专业核心课程过一遍，笔试专业科目占比往往过半',
            '行业证书（教资/执业医师/护士证/注册类）是硬门槛，先确认自己是否具备',
            '同一行业内不同单位差距大，优先选财政保障更强的单位'
          ]
          : [
            '综合类岗位专业限制宽松，竞争更激烈，靠笔试分数取胜',
            '重点准备公共基础知识与时政',
            '尽量选择有专业限制的岗位，规避「三不限」'
          ]
      }
    ];
  }
  return [
    {
      key: 'written',
      icon: '📝',
      title: '笔试与测评构成（央国企）',
      items: [
        '线上测评：性格测试 + 行测/职业能力，性格测试有一票否决权',
        '性格测试核心是「稳定、抗压、协作、服从管理」四项拉满，避免极端选项，测谎题要答得一致',
        '国企行测题量比公考少（60-100 题）、难度低，常识偏本行业知识',
        '部分国企加考英语与专业知识，需针对性准备'
      ]
    },
    {
      key: 'resume',
      icon: '📄',
      title: '国企简历与网申要点',
      items: [
        '结构务实：教育背景 → 政治面貌 → 学生工作 → 实习 → 技能证书，一页为宜',
        '突出「稳定」与「服从」：党员、学生干部、集体荣誉都是加分项',
        '避免互联网黑话（赋能/闭环/打法），用平实的政审文体',
        '网申是淘汰率最高的一关，专业对口度与成绩排名要写清楚'
      ]
    }
  ];
}

/* ==================== 阶段节奏 ==================== */

/**
 * 生成「行动节奏」阶段。
 *
 * ⚠️ 刻意不接收 DirRule：方向类内容（该专业/岗位要学什么）统一由「方向专项」块承载。
 *    早期版本把 dir.ability 的前两条塞进阶段里当"预习项"，结果与方向专项块逐字重复，
 *    用户看到同一条建议出现两遍。阶段只负责回答「什么时候做什么」，
 *    方向块只负责回答「这个方向要准备什么」，职责分开后不再重叠。
 */
function stagesFor(job: CivilJob, examDays: number | null, applyDays: number | null): CivilStage[] {
  const t = trackOf(job.track);
  const examName = job.track === 'gk' ? '国考笔试' : job.track === 'sk' ? '省考笔试' : job.track === 'sy' ? '事业编笔试' : '国企测评/笔试';
  // 纯执行类提醒（与方向专项块零重叠）
  const review = '每天留 30 分钟复盘：错题只记「为什么错」，不抄正确答案';
  const weekly = '每周日做一次周复盘：这周完成多少、卡在哪一环、下周怎么调';

  if (examDays === null && applyDays === null) {
    return [
      { when: '现在', todo: ['关注官方公告渠道（官网 + 官方公众号）并开启提醒', '把证件、成绩单、证书扫描件整理成一个材料包'] },
      { when: '公告发布后 3 天内', todo: ['确认编制类型与专业目录是否匹配', '完成网申/报名提交，不要拖到截止日'] },
      { when: '报名后', todo: ['立刻转入笔试准备，别等通知', review] },
      { when: '进入流程后', todo: ['准备 90 秒自我介绍与 3 段 STAR 经历', '并行投递 2-3 家同类单位，避免单点押注'] }
    ];
  }

  const d = examDays === null ? 999 : examDays;
  const a = applyDays === null ? 999 : applyDays;
  const applyStage: CivilStage[] = [
    {
      when: `报名节点（约 ${a} 天后）`,
      todo: [
        '提前 3 天完成报名，留足资格审核不通过后改报的时间',
        '逐字核对专业目录、学历、政治面貌、证书四项硬条件',
        '报名前打电话向招录单位确认编制类型与签约主体'
      ]
    }
  ];

  if (d <= 7) {
    return [
      { when: '今天到考前', todo: [`只看错题本与高频考点，不再刷新题`, `按考试时间做 1 套完整模考，调好生物钟`] },
      { when: `考前 2 天`, todo: ['确认考场、证件、文具，提前踩点或规划路线', '早睡，把状态调到最好'] },
      { when: `考后`, todo: ['当天复盘：哪些模块超时、哪些考点没复习到', '立刻转入面试准备，别等成绩'] }
    ];
  }
  if (d <= 21) {
    return [
      { when: '第 1 周', todo: ['过一遍高频考点清单，把弱项模块集中补 2 天', review] },
      { when: '第 2 周', todo: ['每天 1 套限时模块训练 + 隔天 1 套整卷', '开始背申论/综应的答题框架'] },
      { when: `考前 3 天`, todo: ['停刷新题，只复盘错题本', '按考试时间做最后一次全真模考'] }
    ];
  }
  if (d <= 45) {
    return [
      { when: '第 1 周', todo: ['把笔试科目按分值权重排优先级，先攻分值最高、提分最快的模块', review] },
      { when: '第 2-3 周', todo: ['每天固定 3 小时刷题 + 1 小时复盘，错题归因到考点', weekly] },
      { when: '第 4 周', todo: ['进入整卷训练，每周 2 套严格计时', '同步开始了解面试形式与真题类型'] }
    ];
  }
  if (d <= 90) {
    const head: CivilStage[] = a <= 90 ? applyStage : [];
    return [
      ...head,
      { when: '第 1 个月', todo: ['系统过一遍笔试全套知识，建立错题本', review] },
      { when: '第 2 个月', todo: ['模块化刷题 + 每周 1 套整卷，把速度提上来', weekly] },
      { when: '考前 2 周', todo: ['整卷冲刺：每周 2 套严格计时 + 申论/综应每周 2 篇', '开始准备面试素材与 90 秒自我介绍'] }
    ];
  }
  return [
    ...(a <= 60 ? applyStage : []),
    { when: '未来 1-2 个月', todo: ['打基础：把笔试科目系统过一遍，不做题海', review] },
    { when: '之后 1-2 个月', todo: ['刷题提分：模块训练 + 错题复盘', weekly] },
    { when: '考前 1 个月', todo: ['整卷模拟 + 申论/综应批改，进入冲刺节奏'] }
  ];
}

function timingText(job: CivilJob, examDays: number | null, applyDays: number | null): string {
  if (examDays === null && applyDays === null) {
    return `滚动招录（${job.applyTime}）· 公告一出立即行动`;
  }
  const bits: string[] = [];
  if (applyDays !== null && applyDays < 400) bits.push(`距报名节点约 ${applyDays} 天`);
  if (examDays !== null && examDays < 400) bits.push(`距${job.track === 'gk' ? '国考笔试' : job.track === 'sk' ? '省考笔试' : job.track === 'sy' ? '事业编笔试' : '国企笔试'}约 ${examDays} 天`);
  return `${bits.join(' · ')}（节奏按「${job.applyTime} / ${job.examTime}」的往年规律估算）`;
}

/* ==================== 主函数：生成岗位备战指南 ==================== */

export function buildCivilGuide(job: CivilJob, now = Date.now()): CivilGuide {
  const dir = directionRule(job.direction);
  const track = trackOf(job.track);
  const comp = compileOf(job.compile);
  const adv = COMPILE_ADVICE[job.compile] || COMPILE_ADVICE.contract;

  const applyMon = parseMonths(job.applyTime);
  const examMon = parseMonths(job.examTime);
  const applyNear = nearestDate(applyMon, now);
  const examNear = nearestDate(examMon, now);
  const applyDays = applyNear ? applyNear.days : null;
  const examDays = examNear ? examNear.days : null;

  const freshBit = job.fresh === 'only' ? '该岗位仅限应届生，务必抓住' : job.fresh === 'prefer' ? '该岗位应届优先，你的身份是优势' : '该岗位不限应届，需靠硬实力竞争';

  const focus = `${job.unit} · ${job.title}｜${track.short} · ${comp.short}${job.party ? ' · 要求党员' : ''}。核心竞争力在「${dir.label}」方向的专项准备 + 笔试分数，${job.fresh === 'no' ? '竞争面更广，' : ''}${freshBit}。`;

  const stages = stagesFor(job, examDays, applyDays);
  const timing = timingText(job, examDays, applyDays);

  const blocks: CivilBlock[] = [
    {
      key: 'subject',
      icon: '📚',
      title: `笔试科目（${track.short}）`,
      items: track.subjects.map((s) => `${s.name}｜${s.weight}：${s.note}`)
    },
    ...trackBlocks(job),
    {
      key: 'direction',
      icon: '🎯',
      title: `方向专项 · ${dir.label}`,
      items: dir.ability
    },
    {
      key: 'interview',
      icon: '🎤',
      title: '面试形式与高频考察点',
      items: [
        job.track === 'gk' || job.track === 'sk'
          ? '面试为结构化（部分岗位无领导），一般 4-5 题 / 20-25 分钟，含综合分析、组织协调、应急处突、人际关系'
          : job.track === 'sy'
            ? '面试形式因岗而异：综合岗结构化、教师岗试讲、医疗岗技能操作'
            : '国企多为半结构化面试 + 无领导小组讨论，重动机与稳定性',
        ...dir.interview
      ]
    },
    {
      key: 'material',
      icon: '🗂️',
      title: '报名 / 政审材料清单',
      items: [
        '身份证、学历学位证（应届生用就业推荐表）、报到证',
        '成绩单（加盖学校公章）、英语等级证、职业资格证',
        job.party ? '党员证明（由所在党组织开具，务必提前 2 周申请）' : '政治面貌证明材料（若非党员则无需）',
        '无犯罪记录证明、个人征信报告（政审环节需要）',
        '证件照（按公告要求的尺寸与底色准备电子版）'
      ]
    },
    {
      key: 'compile',
      icon: '🏷️',
      title: `编制与签约提醒 · ${comp.label}`,
      items: adv.items
    },
    {
      key: 'hard',
      icon: '📌',
      title: '本岗位硬条件自检',
      items: [
        `专业限制：${job.majorLimit}`,
        `学历要求：${job.education}`,
        `应届要求：${freshLabel(job.fresh)}`,
        `政治面貌：${job.party ? '要求中共党员' : '不限政治面貌'}`,
        `报录比参考：${job.ratio}｜难度评级：${'★'.repeat(job.difficulty)}（${job.difficulty}/5）`,
        `待遇参考：${job.salary}`
      ]
    }
  ];

  const risks: string[] = [];
  if (adv.risk) risks.push(adv.risk);
  if (job.fresh === 'only') risks.push('仅限应届岗位一旦错过就无法再报，不要因为「还没准备好」而放弃投递。');
  else if (job.fresh === 'no') risks.push('不限应届的岗位竞争更激烈（社会考生也会来抢），笔试分数必须拉开差距。');
  if (job.track === 'sy') risks.push('⚠️ 事业编最大陷阱：公告不写「编制」二字的多为合同制/备案制/派遣，报名前务必电话确认签约主体。');
  if (job.track === 'yg') risks.push('⚠️ 国企最大陷阱：签约方是「人力资源公司」即为劳务派遣，不是国企员工。');
  if (job.track === 'sk' && job.level === '乡镇') risks.push('乡镇岗普遍有 5 年服务期，中途离职会记入诚信档案，报名前想清楚能否待住。');
  if (job.difficulty >= 5) risks.push(`该岗位难度评级 ${job.difficulty}/5，报录比 ${job.ratio}，建议同时准备 1-2 个保底岗位，不要单点押注。`);

  const guide: CivilGuide = { focus, timing, stages, blocks, risks, text: '' };
  guide.text = guideToText(job, guide);
  return guide;
}

/* ==================== 纯文本版（复制用） ==================== */

export function guideToText(job: CivilJob, g: CivilGuide): string {
  const track = trackOf(job.track);
  const comp = compileOf(job.compile);
  const L: string[] = [];
  L.push(`【${job.unit} · ${job.title}】`);
  L.push(`${track.name}｜${comp.label}（${comp.hasBian ? '有编制' : '无编制'}）`);
  L.push(`地区：${job.region}（${job.level}）｜方向：${job.direction}`);
  L.push(`专业：${job.majorLimit}｜学历：${job.education}｜${freshLabel(job.fresh)}${job.party ? '｜党员' : ''}`);
  L.push(`报名：${job.applyTime}｜考试：${job.examTime}`);
  L.push(`报录比：${job.ratio}｜难度：${'★'.repeat(job.difficulty)}｜待遇：${job.salary}`);
  L.push('');
  L.push('【备战重心】');
  L.push(g.focus);
  L.push('');
  L.push(`【节奏】${g.timing}`);
  L.push('');
  L.push('【行动阶段】');
  g.stages.forEach((s) => {
    L.push(`▸ ${s.when}`);
    s.todo.forEach((x) => L.push(`  · ${x}`));
  });
  L.push('');
  g.blocks.forEach((b) => {
    L.push(`【${b.title}】`);
    b.items.forEach((x) => L.push(`· ${x}`));
    L.push('');
  });
  if (g.risks.length) {
    L.push('【容易踩的坑】');
    g.risks.forEach((r) => L.push(`· ${r}`));
  }
  return L.join('\n');
}

/* ==================== 本地兜底：赛道测评 ==================== */

export interface AssessInput {
  major: string;
  education: string;
  party: boolean;
  fresh: boolean;
  /** 偏好 */
  prefer: 'stability' | 'salary' | 'balance' | 'unknown';
}

export interface AssessItem {
  key: string;
  name: string;
  icon: string;
  score: number;
  level: string;
  reason: string;
  color: string;
}

export interface AssessResult {
  items: AssessItem[];
  combo: { role: string; text: string }[];
  priority: string[];
  avoid: string[];
  note: string;
}

type MajorCat = 'teacher' | 'medical' | 'power' | 'law' | 'finance' | 'tech' | 'engineering' | 'agri' | 'liberal' | 'science' | 'other';

const MAJOR_RULES: { kw: string[]; c: MajorCat; label: string }[] = [
  { kw: ['师范', '教育', '小学教育', '学前教育', '学科教学'], c: 'teacher', label: '师范 / 教育类' },
  { kw: ['临床', '医学', '护理', '药学', '中医', '口腔', '预防医学', '公共卫生', '影像'], c: 'medical', label: '医学类' },
  { kw: ['电气', '电力', '能源与动力'], c: 'power', label: '电气 / 能源类' },
  { kw: ['法学', '法律'], c: 'law', label: '法学类' },
  { kw: ['会计', '财务', '审计', '财政', '税收', '金融', '经济', '统计'], c: 'finance', label: '财经类' },
  { kw: ['计算机', '软件', '电子信息', '通信', '自动化', '人工智能', '大数据'], c: 'tech', label: '信息技术类' },
  { kw: ['土木', '建筑', '工程管理', '测绘', '城乡规划', '水利'], c: 'engineering', label: '土建 / 水利类' },
  { kw: ['农学', '植物保护', '园艺', '动物', '林学', '农业'], c: 'agri', label: '农学类' },
  { kw: ['中文', '汉语言', '新闻', '传播', '历史', '哲学', '思政', '公共管理', '行政管理', '马克思'], c: 'liberal', label: '文史 / 管理类' },
  { kw: ['数学', '物理', '化学', '生物', '大气', '地理', '环境'], c: 'science', label: '理学类' }
];

export function majorCategory(major: string): { c: MajorCat; label: string } {
  const s = String(major || '');
  for (const r of MAJOR_RULES) {
    for (const kw of r.kw) {
      if (s.indexOf(kw) >= 0) return { c: r.c, label: r.label };
    }
  }
  return { c: 'other', label: '其他 / 未识别专业' };
}

/** 本地版赛道测评（AI 不可用时的兜底） */
export function assessLocal(input: AssessInput): AssessResult {
  const mc = majorCategory(input.major);
  const edu = String(input.education || '本科');
  const isMaster = edu.indexOf('硕') >= 0 || edu.indexOf('博') >= 0;

  const score: Record<string, { s: number; reasons: string[] }> = {
    gk: { s: 50, reasons: [] },
    sk: { s: 55, reasons: [] },
    sy: { s: 55, reasons: [] },
    yg: { s: 55, reasons: [] }
  };
  const add = (k: string, v: number, r: string) => {
    score[k].s += v;
    if (r) score[k].reasons.push(r);
  };

  // 专业壁垒
  if (mc.c === 'teacher') {
    add('sy', 30, '师范类有教师岗专业壁垒，对口竞争比仅为不限岗的 1/3');
    add('sy', 5, '多数地区教师岗有编制且带寒暑假');
    add('yg', -10, '师范类专业在国企对口岗位较少');
  } else if (mc.c === 'medical') {
    add('sy', 28, '医学类专业对口医疗岗，专业壁垒高、竞争小');
    add('sy', 8, '三甲医院差额编收入显著高于同级公务员');
    add('yg', -5, '医疗类在国企对口面较窄');
  } else if (mc.c === 'power') {
    add('yg', 30, '电气/能源类是国家电网对口专业，待遇第一梯队');
    add('yg', 5, '电网、发电集团秋招名额大');
  } else if (mc.c === 'finance') {
    add('yg', 18, '财经类是银行、国企财务岗的核心对口专业');
    add('gk', 12, '税收/统计/金融监管类国考岗位明确要求财经专业');
    add('sk', 8, '省市财政、税务、审计岗位对口');
  } else if (mc.c === 'law') {
    add('gk', 15, '法学是国考法检、海关、纪检岗位的高频要求专业');
    add('sk', 12, '省市法检、公安、市场监管岗位对口');
    if (!isMaster) add('gk', -5, '部分法学岗位要求硕士或法考 A 证，本科可报岗位相对少');
  } else if (mc.c === 'tech') {
    add('yg', 18, '信息技术类在央企数字化、运营商、电网信通岗位需求旺盛');
    add('sy', 8, '事业单位信息技术岗竞争相对小');
  } else if (mc.c === 'engineering') {
    add('yg', 22, '土建/水利类在建筑央企、城投交投、水利局需求大');
    add('sy', 12, '住建、水利、交通下属事业单位对口');
  } else if (mc.c === 'agri') {
    add('sy', 22, '农学类在农业技术推广岗专业壁垒明显、竞争小');
    add('yg', 6, '中粮、供销集团等涉农央企有对口岗位');
  } else if (mc.c === 'liberal') {
    add('gk', 10, '文史/管理类是综合文字、宣传、党建岗位的主力专业');
    add('sk', 10, '省市机关综合岗需求大');
    add('yg', 10, '国企党建、人力、行政岗对口');
  } else if (mc.c === 'science') {
    add('gk', 8, '理学类是统计、气象、金融监管岗位的要求专业');
    add('sy', 6, '科研院所、质检机构有对口岗位');
  } else {
    add('sk', 6, '未识别专业建议优先考虑「不限专业」岗位，或按专业目录细类查找');
    add('sy', 8, '事业编综合岗有较多不限专业岗位');
  }

  // 学历
  if (isMaster) {
    add('gk', 8, '硕士学历可报更多高门槛岗位（省直、发改委、监管类）');
    add('sk', 6, '硕士可报定向选调生等高起点通道');
    add('sy', 4, '高校辅导员、科研院所普遍要求硕士');
  } else {
    add('yg', 6, '本科学历在国企校招中是绝对主力，名额最多');
    add('sk', 6, '乡镇与区县岗位对本科最友好');
  }

  // 党员
  if (input.party) {
    add('gk', 10, '党员身份在纪检监察、外交、办公厅等岗位是硬门槛或强加分');
    add('sk', 10, '选调生、公安、法检岗普遍要求党员');
    add('yg', 12, '党员在国企党建、办公室、人力岗权重极高');
    add('sy', 6, '高校辅导员等岗位要求党员');
  } else {
    if (mc.c === 'liberal') add('yg', -8, '非党员在国企党建/办公室岗竞争力明显下降');
    add('sk', -8, '无法报考选调生与多数公安岗，可用岗位减少');
  }

  // 应届
  if (input.fresh) {
    add('gk', 15, '国考应届岗位占比最高，是最该抓住的一场考试');
    add('sk', 12, '省考有大量限应届岗位，竞争比显著更低');
    add('sy', 12, '事业编对口岗与校招批次普遍限应届');
    add('yg', 18, '央国企秋招提前批几乎全部限应届，是名额最大的入口');
  } else {
    add('gk', -12, '非应届可报岗位大幅减少，竞争更激烈');
    add('yg', -15, '国企校招通道基本关闭，只能走社招');
  }

  // 偏好
  if (input.prefer === 'stability') {
    add('gk', 12, '求稳定 → 公务员是最优解（行政编制最有保障）');
    add('sy', 8, '全额事业编稳定性接近公务员');
    add('yg', -6, '国企受经营影响，稳定性弱于行政/事业编');
  } else if (input.prefer === 'salary') {
    add('yg', 14, '看收入 → 电网、烟草、银行属第一梯队，可能高于公务员');
    add('sy', 6, '差额编（医疗）效益好时收入可观');
    add('gk', -6, '公务员收入天花板明显，涨薪慢');
  } else if (input.prefer === 'balance') {
    add('sy', 10, '求工作生活平衡 → 教师岗有寒暑假，性价比突出');
    add('gk', 4, '机关岗作息相对规律');
    add('yg', -8, '国企一线岗位（施工/运营）强度较大');
  }

  const items: AssessItem[] = CIVIL_TRACKS.filter((t) => t.key !== 'strategy').map((t) => {
    const raw = score[t.key] ? score[t.key] : { s: 50, reasons: [] };
    const s = Math.max(10, Math.min(99, raw.s));
    const level = s >= 80 ? '首选' : s >= 62 ? '推荐' : s >= 45 ? '可作保底' : '优先度低';
    const reason = raw.reasons.slice(0, 3).join('；') || '条件适配度一般，可作为补充方向';
    return { key: t.key, name: t.name, icon: t.icon, score: s, level, reason, color: t.color };
  }).sort((a, b) => b.score - a.score);

  const top = items[0];
  const second = items[1];
  const mcLabel = mc.label;

  const combo: { role: string; text: string }[] = [
    { role: '主攻', text: `以「${top.name}」为主攻方向，把 70% 的备考时间投在这里` },
    { role: '并行', text: `同步准备「${second.name}」，行测与职测、申论与综应知识通用，一套复习打两场` },
    { role: '保底', text: `把「${items[2] ? items[2].name : '事业编'}」作为保底，避免单点押注` }
  ];

  const priority: string[] = [
    `专业（${mcLabel}）是你的第一决策依据 —— 有专业壁垒的岗位，竞争比能低一半以上`,
    input.party ? '党员身份要用足：优先投递要求党员的岗位，把竞争者筛掉一大半' : '政治面貌是短板，尽量避开明确要求党员的岗位，把时间投到不限政治面貌的岗位上',
    input.fresh ? '应届身份是最值钱的资产：优先投递「仅限应届」岗位，别为了先就业而随便缴社保' : '非应届身份下，重点关注不限应届的岗位与国企社招，笔试分数要拉开差距',
    isMaster ? '硕士学历可冲高门槛岗位（省直、监管类、高校），别浪费学历去抢本科岗' : '本科学历优先考虑国企校招、乡镇公务员与区县事业编，这些岗位本科是主力'
  ];

  const avoid: string[] = [];
  if (mc.c !== 'teacher' && mc.c !== 'medical') avoid.push('避开明确要求执业资格证的岗位（教资/执业医师/护士证），除非你已经持证');
  if (!isMaster) avoid.push('避开「硕士及以上」要求的岗位（高校辅导员、科研院所、省直部分岗）');
  if (!input.party) avoid.push('避开定向选调生与明确要求党员的岗位（报了也过不了资格审查）');
  avoid.push('避开劳务派遣与「签约主体不明」的岗位，优先确认签约方是哪个单位');
  if (!input.fresh) avoid.push('避开所有标注「仅限应届」的岗位');

  const note = `本结果由本地规则引擎生成（按专业类别 ${mcLabel} / 学历 ${edu} / ${input.party ? '党员' : '非党员'} / ${input.fresh ? '应届' : '非应届'} 综合计算）。配置 AI 后可获得更个性化的报考组合与避坑清单。`;

  return { items, combo, priority, avoid, note };
}

/* ==================== 本地兜底：备考计划 ==================== */

export interface PlanInput {
  track: string;
  /** 目标岗位名（可空） */
  target: string;
  /** 每周可投入小时数 */
  hours: number;
  now?: number;
}

export interface PlanWeek {
  week: string;
  focus: string;
  items: string[];
}

export interface PlanResult {
  title: string;
  summary: string;
  weeks: PlanWeek[];
  monthly: { month: string; goal: string }[];
  tips: string[];
  text: string;
}

/** 本地版备考计划（AI 不可用时的兜底）；按当前月份 + 赛道给出 4 周计划 */
export function buildPlanLocal(input: PlanInput, now = Date.now()): PlanResult {
  const t = trackOf(input.track);
  const d = new Date(now + 8 * 3600 * 1000);
  const month = d.getUTCMonth() + 1;
  const h = Math.max(5, Math.min(60, input.hours || 20));
  const perDay = Math.round((h / 7) * 10) / 10;

  const subjectText = t.subjects.map((s) => s.name).join(' + ');
  const target = input.target ? `（目标：${input.target}）` : '';

  const weeks: PlanWeek[] = [
    {
      week: '第 1 周',
      focus: '摸底 + 建体系',
      items: [
        `做 1 套完整真题摸底，记录各模块正确率与用时（这是后续所有安排的基准）`,
        `把「${subjectText}」的考纲与题型结构过一遍，画出知识框架图`,
        `建立错题本：只记「为什么错」，不抄正确答案`,
        `每天投入约 ${perDay} 小时，其中 60% 打基础、40% 做题`
      ]
    },
    {
      week: '第 2 周',
      focus: '主攻高权重模块',
      items: [
        `按分值权重排序，先攻提分最快的 2 个模块（${t.key === 'gk' || t.key === 'sk' ? '资料分析 + 判断推理' : t.key === 'sy' ? '职测的常识与资料 + 综应的公文题' : '性格测评的逻辑一致性 + 行业常识'}）`,
        '每天限时训练 1 个模块，记录正确率变化曲线',
        '整理高频考点清单，标注「已掌握 / 半懂 / 不会」三档'
      ]
    },
    {
      week: '第 3 周',
      focus: '整卷训练 + 弱项补齐',
      items: [
        '每周 2 套完整限时套卷，严格按考试时间做，训练生物钟',
        '针对摸底暴露的弱项，集中补 2 天，不贪多',
        t.key === 'gk' || t.key === 'sk' ? '申论每周 2 篇：1 篇概括 + 1 篇大作文，写完对照范文标差距' : '主观题每周 2 篇，重点练答题框架与书面表达'
      ]
    },
    {
      week: '第 4 周',
      focus: '复盘 + 定下一阶段节奏',
      items: [
        '把前三周的错题全部重做一遍，做对的划掉',
        '总结一套自己的做题顺序与时间分配方案，写到纸上固定下来',
        '确认报名节点与材料清单，提前备齐证件扫描件',
        '规划下个月的月度目标（写在待办里，按周拆解）'
      ]
    }
  ];

  const monthly: { month: string; goal: string }[] = [];
  const trackPlan: Record<string, string[]> = {
    gk: ['打基础：行测五模块 + 申论框架', '强化刷题：模块限时 + 错题复盘', '整卷冲刺：套卷模拟 + 时政突击'],
    sk: ['摸清本省考情：做近 5 年真题定策略', '分模块强化 + 乡镇岗申论专项', '整卷冲刺 + 面试素材准备'],
    sy: ['公基/职测基础 + 专业科目', '职测提分 + 综应五种题型', '整卷模拟 + 面试形式预演'],
    yg: ['网申材料 + 性格测评逻辑一致性', '行业常识 + 半结构化面试题', '群面实战 + offer 决策与签约']
  };
  const seq = trackPlan[t.key] || trackPlan.gk;
  for (let i = 0; i < 3; i++) {
    const mm = month + i > 12 ? month + i - 12 : month + i;
    monthly.push({ month: `${mm} 月`, goal: seq[i] });
  }

  const tips: string[] = [
    `每周固定投入约 ${h} 小时（日均 ${perDay} 小时）—— 稳定比突击有效`,
    '把学习计划同步到首页待办，每周日复盘一次完成率',
    t.pitfalls[0] || '不要只刷题不总结，错题本比刷题量更重要',
    '报名节点提前 3 天完成，留出审核不通过后改报的时间'
  ];

  const result: PlanResult = {
    title: `${t.name} · 4 周备考计划${target}`,
    summary: `按当前 ${month} 月与你的可用时间（每周 ${h} 小时）生成，覆盖 4 周冲刺 + 未来 3 个月目标。`,
    weeks,
    monthly,
    tips,
    text: ''
  };

  const L: string[] = [];
  L.push(`【${result.title}】`);
  L.push(result.summary);
  L.push('');
  weeks.forEach((w) => {
    L.push(`${w.week} · ${w.focus}`);
    w.items.forEach((x) => L.push(`· ${x}`));
    L.push('');
  });
  L.push('【未来 3 个月目标】');
  monthly.forEach((m) => L.push(`· ${m.month}：${m.goal}`));
  L.push('');
  L.push('【执行提醒】');
  tips.forEach((x) => L.push(`· ${x}`));
  result.text = L.join('\n');
  return result;
}

/* ==================== 本地兜底：面试自检 ==================== */

export interface InterviewComment {
  score: number;
  level: string;
  good: string[];
  improve: string[];
  sample: string;
}

/**
 * AI 不可用时的本地面试自检（启发式，**不冒充 AI 评分**）。
 *
 * 为什么需要：面试点评是纯 AI 能力，云端挂了就会「点了没反应」。
 * 这里用可解释的规则给出结构自查（篇幅 / 层次 / 对策 / 匹配度 / 落点），
 * 并在 improve 末尾明确标注这是本地自检，避免用户误以为是模型给出的分数。
 */
export function interviewLocalCheck(answer: string, kind = 'structured'): InterviewComment {
  const a = String(answer || '');
  const len = a.length;
  const good: string[] = [];
  const improve: string[] = [];
  let score = 40;

  // 1) 篇幅
  if (len >= 300) {
    score += 14;
    good.push(`作答篇幅 ${len} 字，信息量足够考官判断你的想法`);
  } else if (len >= 150) {
    score += 8;
    good.push(`作答篇幅 ${len} 字，基本能把观点说清`);
  } else {
    improve.push(`篇幅偏短（${len} 字）。体制内面试单题通常需要 2-3 分钟表达，建议扩到 250-350 字，否则易被判定「思考不够深入」`);
  }

  // 2) 结构层次
  const structKw = ['一是', '二是', '三是', '首先', '其次', '再次', '最后', '第一', '第二', '第三', '1.', '2.', '3.'];
  const structHits = structKw.filter((k) => a.indexOf(k) >= 0);
  if (structHits.length >= 2) {
    score += 16;
    good.push(`使用了「${structHits.slice(0, 3).join(' / ')}」这类层次词，结构清晰，考官容易抓点`);
  } else if (structHits.length === 1) {
    score += 8;
    improve.push('结构层次偏弱。建议用「一是…二是…三是…」或「首先…其次…最后」分点，让考官在 30 秒内听出你的逻辑');
  } else {
    improve.push('完全看不出结构。作答前先在心里分 2-3 层，用分点词明示；平铺直叙是结构化面试最常见的失分点');
  }

  // 3) 对策导向
  const actionKw = ['措施', '建议', '落实', '完善', '建立', '加强', '推动', '优化', '具体做法', '下一步'];
  const actionHits = actionKw.filter((k) => a.indexOf(k) >= 0);
  if (actionHits.length >= 2) {
    score += 12;
    good.push('有明确的对策表述，符合体制内「发现问题—解决问题」的答题偏好');
  } else {
    improve.push('对策偏少。考官最想听「你具体怎么做」，应急应变与组织管理题至少给 2 条可操作的举措');
  }

  // 4) 结合自身 / 岗位
  const selfKw = ['我', '实习', '经历', '岗位', '单位', '基层'];
  const selfHits = selfKw.filter((k) => a.indexOf(k) >= 0);
  if (selfHits.length >= 2) {
    score += 10;
    good.push('结合了自身经历或岗位实际，比纯讲道理更有说服力');
  } else {
    improve.push('缺少与自身经历或报考岗位的连接。加一句「在我的实习/学生工作中…」能显著提升匹配度');
  }

  // 5) 结尾落点（政治站位）
  const endKw = ['责任', '担当', '服务', '群众', '大局', '初心', '使命'];
  if (endKw.some((k) => a.indexOf(k) >= 0)) {
    score += 8;
  } else {
    improve.push('结尾可以点一句责任、担当或服务群众，让作答有「格局落点」，这是体制内面试的加分项');
  }

  score = Math.max(30, Math.min(88, score));
  const level = score >= 80 ? '良好' : score >= 65 ? '及格' : '需要重练';
  if (!good.length) good.push('已完成一次完整作答，这是提升的第一步');

  const kindText = kind === 'group' ? '无领导小组' : kind === 'semi' ? '半结构化' : '结构化';
  improve.push(`本次为「本地自检」（AI 未生效），仅按篇幅 / 结构 / 对策 / 匹配度四个维度给参考分；配置 AI 后可获得逐句点评与示范作答（当前形式：${kindText}）`);

  return { score, level, good, improve, sample: '' };
}

/* ==================== 决策引擎：分层组合 + 均衡资源调配 ====================
 *
 * 这两块把 assessLocal 的输出「升级」成可落地的决策：
 *   - recommendPortfolio：把四赛道评分转成「冲刺 / 匹配 / 保底」三层报考组合，
 *     直接从 CIVIL_JOBS 库里挑真实岗位，避免空谈；
 *   - buildResourcePlan：把每周可用时间按「主攻 50% / 并行 30% / 保底 20%」分配，
 *     并给出编制结构的均衡参考（带编占比），实现「精细、平衡的海量资源配置」。
 * 二者都是纯函数、零网络，可作为 AI 不可用时的本地兜底，也可被 AI 结果覆盖。
 * ========================================================================== */

/** 岗位精简视图（决策页卡片用） */
export interface JobLite {
  id: string;
  title: string;
  unit: string;
  trackShort: string;
  compileShort: string;
  tone: string;
  hasBian: boolean;
  difficulty: number;
  stars: string;
  region: string;
  level: string;
  salary: string;
  freshText: string;
  color: string;
  applyHost: string;
  applyName: string;
  applyUrl: string;
}

function jobToLite(j: CivilJob): JobLite {
  const t = trackOf(j.track);
  const c = compileOf(j.compile);
  return {
    id: j.id,
    title: j.title,
    unit: j.unit,
    trackShort: t ? t.short : '',
    compileShort: c.short,
    tone: compileTone(j.compile),
    hasBian: c.hasBian,
    difficulty: j.difficulty,
    stars: '★'.repeat(j.difficulty),
    region: j.region,
    level: j.level,
    salary: j.salary,
    freshText: freshLabel(j.fresh),
    color: t ? t.color : '#6d28d9',
    applyHost: j.apply ? j.apply.host : '',
    applyName: j.apply ? j.apply.short : '',
    applyUrl: j.apply ? j.apply.url : ''
  };
}

export interface PortfolioLayer {
  key: string;
  label: string;
  desc: string;
  color: string;
  jobs: JobLite[];
}

export interface PortfolioResult {
  layers: PortfolioLayer[];
  combo: { role: string; text: string }[];
  note: string;
  text: string;
}

/**
 * 分层报考组合：把测评结果转成「冲刺 / 匹配 / 保底」三档，并从库里挑真实岗位。
 *
 * 规则（确定性、可复现，绝不随机）：
 *   - 主赛道（评分第一）：难度 ≥4 进冲刺档，难度 ≤3 进匹配档；
 *   - 第二赛道：难度 ≥3 进匹配档，难度 ≤2 进保底档；
 *   - 第三赛道：难度 ≤3 全部进保底档；
 *   - 保底不足时，用「带编 + 低难度」岗位补齐，确保不空手。
 */
export function recommendPortfolio(input: AssessInput): PortfolioResult {
  const a = assessLocal(input);
  const ranked = a.items.slice().sort((x, y) => y.score - x.score);
  const topTracks = ranked.slice(0, 3).map((x) => x.key);

  const byTrack = (tk: string) => CIVIL_JOBS.filter((j) => j.track === tk);
  const reach: JobLite[] = [];
  const match: JobLite[] = [];
  const safe: JobLite[] = [];

  topTracks.forEach((tk, idx) => {
    const list = byTrack(tk).slice().sort((x, y) => y.difficulty - x.difficulty);
    if (idx === 0) {
      list.forEach((j) => {
        if (j.difficulty >= 4 && reach.length < 4) reach.push(jobToLite(j));
        else if (j.difficulty <= 3 && match.length < 4) match.push(jobToLite(j));
      });
    } else if (idx === 1) {
      list.forEach((j) => {
        if (j.difficulty >= 3 && match.length < 6) match.push(jobToLite(j));
        else if (j.difficulty <= 2 && safe.length < 4) safe.push(jobToLite(j));
      });
    } else {
      list.forEach((j) => {
        if (j.difficulty <= 3 && safe.length < 8) safe.push(jobToLite(j));
      });
    }
  });

  // 保底兜底：优先「带编 + 低难度」，避免保底档全是劳务派遣
  if (safe.length < 6) {
    CIVIL_JOBS
      .filter((j) => j.difficulty <= 2 && compileOf(j.compile).hasBian)
      .forEach((j) => { if (safe.length < 6) safe.push(jobToLite(j)); });
  }

  const layers: PortfolioLayer[] = [
    { key: 'reach', label: '冲刺档', desc: '难度高、竞争大，但平台与成长最优——用来冲更好的去向', color: '#b45309', jobs: reach.slice(0, 4) },
    { key: 'match', label: '匹配档', desc: '与你的条件最契合，是主力产出区间', color: '#166534', jobs: match.slice(0, 6) },
    { key: 'safe', label: '保底档', desc: '难度低、带编优先，确保有 offer 兜底，避免空手', color: '#1e3a8a', jobs: safe.slice(0, 6) }
  ];

  const combo = [
    { role: '主攻', text: `主投「${ranked[0].name}」—— 你的适配分最高（${ranked[0].score} 分）` },
    { role: '并行', text: `并行「${ranked[1].name}」—— 行测/职测、申论/综应知识通用，一套复习打两场` },
    { role: '保底', text: `用「${ranked[2] ? ranked[2].name : '事业编'}」兜底—— 低难度带编岗确保不空手` }
  ];

  const note = `基于本地规则引擎（专业/学历/党员/应届/偏好 综合测算）生成分层组合，共从岗位库挑选 ${reach.length + match.length + safe.length} 个真实岗位。配置 AI 后可获得个性化微调。`;
  const text = '【分层报考组合】\n' +
    layers.map((l) => `▸ ${l.label}：${l.jobs.map((j) => `${j.title}（${j.unit}）`).join('、')}`).join('\n');
  return { layers, combo, note, text };
}

export interface ResourceSplit {
  track: string;
  name: string;
  icon: string;
  pct: number;
  hours: number;
  color: string;
  focus: string;
}

export interface ResourcePlan {
  weeklyHours: number;
  perDay: number;
  splits: ResourceSplit[];
  compileMix: { bian: number; unbian: number };
  note: string;
  text: string;
}

/**
 * 均衡资源调配：把每周可用时间按「主攻 50% / 并行 30% / 保底 20%」分配，
 * 并给出覆盖赛道内的「编制结构」均衡参考（带编占比）。
 *
 * 这是把「海量岗位」收敛成「可执行的精力分配」的关键一步：
 * 不把鸡蛋放一个篮子，既冲高又不至于空手。
 */
export function buildResourcePlan(input: AssessInput, hours = 20): ResourcePlan {
  const a = assessLocal(input);
  const ranked = a.items.slice().sort((x, y) => y.score - x.score).slice(0, 3);
  const h = Math.max(5, Math.min(60, hours || 20));
  const weights = [0.5, 0.3, 0.2];
  const focuses = ['笔试攻坚 + 专业课突破', '知识复用，行测/职测通用，一套复习打两场', '低难度带编岗，保底产出，确保不空手'];

  const splits: ResourceSplit[] = ranked.map((it, i) => {
    const pct = Math.round(weights[i] * 100);
    return {
      track: it.key,
      name: it.name,
      icon: it.icon,
      pct,
      hours: Math.round(h * weights[i] * 10) / 10,
      color: it.color,
      focus: focuses[i]
    };
  });

  // 编制结构：取覆盖赛道内真实岗位的带编占比，作为均衡参考
  const recJobs = CIVIL_JOBS.filter((j) => ranked.some((r) => r.key === j.track));
  const bian = recJobs.filter((j) => compileOf(j.compile).hasBian).length;
  const bianPct = recJobs.length ? Math.round((bian / recJobs.length) * 100) : 50;
  const compileMix = { bian: bianPct, unbian: 100 - bianPct };

  const perDay = Math.round((h / 7) * 10) / 10;
  const note = `每周约 ${h} 小时（日均 ${perDay} 小时）。按「主攻 ${splits[0].pct}% / 并行 ${splits[1].pct}% / 保底 ${splits[2].pct}%」分配，确保精力不单点押注；覆盖赛道内带编岗位占比约 ${bianPct}%，可作为「编制结构」均衡的参考线。`;
  const text = '【均衡资源调配】\n' +
    splits.map((s) => `· ${s.name}：${s.pct}%（${s.hours} 小时/周）— ${s.focus}`).join('\n') +
    `\n编制结构：带编 ${compileMix.bian}% / 无编 ${compileMix.unbian}%`;
  return { weeklyHours: h, perDay, splits, compileMix, note, text };
}

/* ==================== 其他小工具 ==================== */

/** 编制类型列表（页面直接用） */
export function compileList() {
  return COMPILE_TYPES;
}

/** 应届身份科普 */
export function freshFaq() {
  return FRESH_FAQ;
}

/** 赛道列表（含策略中心） */
export function allTracks() {
  return CIVIL_TRACKS;
}

/** 把 fresh 值转文字（透出给页面，避免页面重复 import） */
export function freshText(f: Fresh): string {
  return freshLabel(f);
}
