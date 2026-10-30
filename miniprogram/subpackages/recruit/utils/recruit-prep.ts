// utils/recruit-prep.ts
// 「如何为这个岗位做准备」——由岗位条目本地推导的备战指南。
//
// 设计原则：
//   1. 纯函数、零网络依赖：未配置 AI Key 也能用，点开任意岗位立刻有结果；
//   2. 三维交叉：岗位方向(jobCategory) × 行业/性质(companyType/ownership) × 剩余时间(deadline)；
//   3. 只给「可执行的动作」，不编造企业内部信息（如具体年份的笔试原题、内部政策）。
//
// 输出可直接渲染，也可拼成纯文本复制到备忘录。

import type { JobOpening } from './recruit-openings';
import { daysLeft } from './recruit-openings';

/* ==================== 类型 ==================== */

export interface PrepBlock {
  key: string;
  icon: string;
  title: string;
  items: string[];
}

export interface PrepStage {
  when: string;
  todo: string[];
}

export interface PrepGuide {
  /** 一句话点出该岗位的备战重心 */
  focus: string;
  /** 节奏提示，如「距最迟收口 42 天」 */
  timing: string;
  /** 按时间倒推的行动阶段 */
  stages: PrepStage[];
  /** 分维度准备要点 */
  blocks: PrepBlock[];
  /** 容易踩的坑 */
  risks: string[];
  /** 纯文本版（复制用） */
  text: string;
}

/* ==================== 岗位方向 ==================== */

type Track =
  | 'finance' | 'audit' | 'tax' | 'consulting' | 'ib' | 'risk' | 'actuary'
  | 'valuation' | 'tech' | 'product' | 'operation' | 'data' | 'supply'
  | 'marketing' | 'function' | 'mt' | 'medical' | 'general';

interface TrackRule {
  label: string;
  /** 硬技能与知识准备 */
  ability: string[];
  /** 面试/笔试高频考察点 */
  interview: string[];
}

const TRACK_RULES: Record<Track, TrackRule> = {
  finance: {
    label: '财务 / 会计',
    ability: [
      '把三张报表的勾稽关系讲通：利润表 → 资产负债表 → 现金流量表，能徒手推一遍',
      'Excel 必须能打：SUMIFS / INDEX-MATCH / 数据透视 / Power Query，会做一版滚动预测',
      '准备 1 个「预实差异分析」案例：差异怎么拆、责任怎么归、下月怎么改',
      '熟悉新收入准则、租赁准则的落地影响，这是近几年校招高频追问',
      '了解 SAP / Oracle / 用友 / 金蝶任一 ERP 的凭证与关账流程',
    ],
    interview: [
      '「给一张报表你从哪看起」→ 先看利润表结构，再看应收与存货，最后对现金流',
      '「月末关账你做什么」→ 计提待摊、往来对账、存货盘点、税金核对、报表出数',
      '「发现同事的数据错了怎么办」→ 先核实再沟通，对事不对人，留痕',
    ],
  },
  audit: {
    label: '审计',
    ability: [
      '讲清审计程序：风险评估 → 控制测试 → 实质性程序（函证 / 盘点 / 穿行测试）',
      '理解重要性水平、审计风险模型，能解释「为什么抽样」',
      'Excel + 审计软件（如 eaudit / 鼎信诺）有实操最好；没有就先做一版底稿模板',
      '注会优先考《会计》《审计》两科，简历上写明已过科目与分数区间',
      '心理上接受出差与加班：年审 1-4 月强度高，面试一定会问',
    ],
    interview: [
      '「为什么选审计」→ 别只说稳定，讲清「看得多、成长快、职业路径清晰」',
      '「能否接受连续出差和加班」→ 给具体例子证明抗压（如带过项目/实习经历）',
      '群面常见 case：判断某笔交易该不该确认收入，考的是准则理解 + 表达',
    ],
  },
  tax: {
    label: '税务',
    ability: [
      '梳理增值税链条与进销项抵扣逻辑，能讲清留抵退税的基本条件',
      '企业所得税：收入确认、税前扣除限额（业务招待费/广告费/职工福利费）',
      '个人所得税综合所得汇算的基本口径，以及股权激励的常见处理',
      '熟悉纳税申报流程与发票风险点（虚开、失控票、三流一致）',
      '注会《税法》或税务师《税法一/二》有进度是加分',
    ],
    interview: [
      '「企业想少缴税你会怎么做」→ 只答合规口径：用足优惠政策，不做违规筹划',
      '「税务稽查来了你配合什么」→ 资料准备、口径一致、留痕',
    ],
  },
  consulting: {
    label: '咨询',
    ability: [
      'Case interview 两件套：Profitability（收入-成本拆解）与 Market Sizing（自上而下 + 自下而上互验）',
      '练「先说结论再展开」的表达结构，每个回答控制在 90 秒内',
      'PPT 能独立做一页「问题-洞察-建议」结构的图表页',
      '英语要能撑住 30 分钟的商业讨论（外企咨询必考）',
      '选 1 个目标行业，把产业链、主要玩家、盈利模式、当前痛点过一遍',
    ],
    interview: [
      'PEI / 行为面：准备 3 段「我推动了结果」的故事，每段都有量化结果',
      'Case 中一定要先问清目标与范围，别急着给方案',
      '准备一个「你最近读到的商业洞察」，能讲 2 分钟',
    ],
  },
  ib: {
    label: '投行 / 研究',
    ability: [
      '估值三法必须能讲透：DCF（WACC 与自由现金流推导）、可比公司、可比交易',
      '三张表联动：折旧加 10 元，三张表怎么变——这是经典笔试题',
      '会看招股书与年报，能快速抽出业务模式、财务亮点、风险因素',
      'Wind / 同花顺 iFinD 熟练，能自己拉一个行业数据底稿',
      'CPA（会计/财管）或 CFA 一级有进度，简历上要写清',
    ],
    interview: [
      '技术题准备：估值口径、摊薄（dilution）、并购增厚/摊薄 EPS',
      '讲一家你关注的公司：商业模式 + 估值 + 你为什么不看好或看好',
      '实习经历很重要，没有就做一份自己的行业研究报告当作品',
    ],
  },
  risk: {
    label: '风控 / 投顾',
    ability: [
      '搞清信用风险、市场风险、操作风险的边界，各自的指标怎么算',
      '监管指标要熟：资本充足率、不良率、拨备覆盖率、流动性覆盖率',
      'SQL 必会，Python（pandas/sklearn）会做基础评分卡是加分项',
      '了解反欺诈、反洗钱的常见规则引擎思路',
    ],
    interview: [
      '「给你一批客户数据，怎么判断该不该放款」→ 讲指标 + 策略 + 兜底',
      '「模型准确率高就够吗」→ 讲业务成本：误拒的流失成本 vs 误放的坏账成本',
    ],
  },
  actuary: {
    label: '精算',
    ability: [
      '精算数学与利息理论基础要扎实，能推寿险/年金的现值公式',
      '考试进度是硬指标：SOA / 中精已过科目写在最显眼处',
      'Excel + VBA 熟练，会 R 或 Python 做数据清洗',
      '理解产品定价三要素：预定利率、预定发生率、预定费用率',
    ],
    interview: [
      '「为什么做精算」要给出长期规划，而不是「数学好」',
      '准备一个用数据给出定价或准备金建议的小例子',
    ],
  },
  valuation: {
    label: '资产评估',
    ability: [
      '收益法 / 市场法 / 成本法各自适用场景与关键参数',
      '无形资产、企业价值评估的基本流程与报告结构',
      'Excel 建模 + 折现率取值逻辑要能自圆其说',
      '注会《资产评估》或资产评估师科目进度是加分',
    ],
    interview: [
      '「折现率为什么取这个数」→ 讲无风险利率 + 风险溢价 + 个别风险的取数来源',
    ],
  },
  tech: {
    label: '技术 / 研发',
    ability: [
      '算法与数据结构刷题：目标 200 题以上，覆盖数组、链表、二叉树、DP、图',
      '打磨 1-2 个能讲 10 分钟的项目：背景 → 你的方案 → 取舍 → 量化结果',
      '八股准备：计算机网络（TCP/HTTP）、操作系统（进程/内存）、数据库（索引/事务）',
      '至少熟悉一门语言的工程化：Git、单元测试、CI 流程',
      '投递前把简历上的技术名词都确认「能被追问三层」',
    ],
    interview: [
      '笔试多为在线选择题 + 2-3 道编程题，严格控制时间练手感',
      '手撕代码时先讲思路再写，写完主动说边界条件与复杂度',
      '面试官问「项目最难的点」时，讲决策而非流水账',
    ],
  },
  product: {
    label: '产品',
    ability: [
      '写一份真实可用的 PRD：需求背景、目标用户、功能清单、埋点与指标',
      '准备 1 份竞品分析：功能矩阵 + 差异点 + 你的改进方案',
      'Axure / Figma 至少会画可点击原型',
      '把「指标体系」讲清：北极星指标、过程指标、护栏指标',
    ],
    interview: [
      '「设计一个 XX 功能」→ 先问用户与目标，再拆场景，最后说怎么验证',
      '「你最喜欢的产品，改哪里」→ 给数据依据，不要凭感觉吐槽',
    ],
  },
  operation: {
    label: '运营 / 内容',
    ability: [
      '准备 1 个完整活动复盘：目标 → 玩法 → 数据 → 我改了什么',
      '会看基础数据看板，理解转化漏斗与留存曲线',
      '内容岗要有作品：帖子、视频、公众号、社群都可以量化',
      '了解 A/B 实验的最小必要知识',
    ],
    interview: [
      '「预算 10 万做一次拉新你怎么花」→ 先定目标人群与渠道，再算 ROI',
      '准备一个「数据不好时你怎么判断原因」的排查思路',
    ],
  },
  data: {
    label: '数据分析',
    ability: [
      'SQL 必须熟练：窗口函数、多表关联、复杂去重，现场手写不能卡',
      'Python：pandas 清洗 + matplotlib/seaborn 出图，会一点统计检验',
      '指标体系能自建：从业务目标倒推需要哪些指标',
      'AB 实验：假设、样本量、显著性、灰度与反转的判断',
    ],
    interview: [
      '「指标突然掉了 20% 怎么排查」→ 先确认口径，再拆维度，最后定位',
      '「怎么证明是这次改版带来的提升」→ 讲对照组与置信区间',
    ],
  },
  supply: {
    label: '供应链 / 采购',
    ability: [
      '搞清需求预测、S&OP、库存周转、安全库存的计算逻辑',
      '了解采购谈判与供应商管理的基本流程（寻源 → 比价 → 评估 → 考核）',
      'Excel 做一版库存健康度看板是很好的加分项',
      '理解精益与降本项目的常见抓手',
    ],
    interview: [
      '「库存高企怎么办」→ 分结构性/运营性原因，给分阶段动作',
      '「供应商涨价你怎么谈」→ 讲成本拆解 + 替代方案 + 长期协议',
    ],
  },
  marketing: {
    label: '市场 / 品牌',
    ability: [
      '准备一个你策划过的传播或校园活动，用数据说话（覆盖/转化/成本）',
      '理解 4P 与品牌资产的基本框架，能分析一个真实案例',
      '外企必看英语：简历英文版、口语能撑住 20 分钟',
      '熟悉主流平台（小红书/抖音/双微）的内容逻辑与投放口径',
    ],
    interview: [
      '宝洁八大问式的行为面试要按 STAR 写实，每段都有数字',
      '群面常见 case：给新产品做上市方案，重点是取舍与优先级',
    ],
  },
  function: {
    label: '职能（人力 / 法务 / 综合）',
    ability: [
      '人力岗：招聘全流程、绩效工具（KPI/OKR）、劳动法基础要说得清',
      '法务岗：合同法、公司法基础 + 一份自己写的合同审阅意见',
      '公文写作与会议纪要练到能直接上手',
      'Excel / PPT 的日常办公效率要高于平均',
    ],
    interview: [
      '「如何判断一个候选人合适」→ 岗位画像 + 结构化解法 + 背调意识',
      '「员工要仲裁你怎么处理」→ 先合规，再沟通，全程留痕',
    ],
  },
  mt: {
    label: '管培生',
    ability: [
      '想清楚「为什么是管培」：轮岗意味着不确定，要给出可接受的动机',
      '选一个目标行业，把商业模式与竞争格局讲明白',
      '练领导力故事：带团队、推动跨部门、拿到结果的完整案例',
      '商业 case 与英语是外企管培的常见组合关卡',
    ],
    interview: [
      '群面高频：资源分配、优先级排序、新品上市，考的是推动共识而非抢话',
      '终面常考「你希望 5 年后在什么位置」，答案要和轮岗逻辑自洽',
    ],
  },
  medical: {
    label: '医药 / 医学事务',
    ability: [
      '熟悉 GMP / GCP 基本要求，以及药品从研发到上市的主要环节',
      '能读懂临床试验的基本指标（主要终点、样本量、不良事件）',
      '医学事务岗要能快速做文献检索与综述',
      '英语文献阅读能力是硬门槛',
    ],
    interview: [
      '「怎么把专业内容讲给非专业人士」→ 现场演示一次通俗化表达',
    ],
  },
  general: {
    label: '通用岗位',
    ability: [
      '把简历改成一页：每段经历都有「我做了什么 + 带来什么结果（数字）」',
      '准备 3 段可深挖的经历，每段能撑住 10 分钟追问',
      '把目标公司近一年的业务动态过一遍，面试时能接得上话',
      '了解该岗位的日常工作流（JD 里的动词就是线索）',
    ],
    interview: [
      '行为面试统一用 STAR：情境 → 任务 → 行动 → 结果',
      '被问到短板时，讲一个你确实改进了的具体动作',
    ],
  },
};

/** 关键词 → 方向，顺序敏感：越具体的排在越前 */
const TRACK_KEYWORDS: { t: Track; kw: string[] }[] = [
  { t: 'finance', kw: ['财务', '会计', '财经', '计财', '项目财务', '信贷', '财富管理', '投顾', '零售', '监管'] },
  { t: 'audit', kw: ['审计', '年审'] },
  { t: 'tax', kw: ['税务', '纳税'] },
  { t: 'consulting', kw: ['咨询'] },
  { t: 'ib', kw: ['投行', '投研', '研究', '投资', '基金'] },
  { t: 'risk', kw: ['风控'] },
  { t: 'actuary', kw: ['精算'] },
  { t: 'valuation', kw: ['评估', '资产评估'] },
  { t: 'tech', kw: ['技术', '研发', '算法', '软件', '硬件', '芯片', '通信', 'IT', '实施', '生产', '工艺', '设备', '政企'] },
  { t: 'product', kw: ['产品'] },
  { t: 'operation', kw: ['运营', '内容', '商业化', '发行', '策划', '美术'] },
  { t: 'data', kw: ['数据', '分析'] },
  { t: 'supply', kw: ['供应链', '采购', '物流'] },
  { t: 'marketing', kw: ['市场', '品牌', '销售', '零售管培', '店长'] },
  { t: 'function', kw: ['人力', '法务', '职能', '综合', '行政'] },
  { t: 'mt', kw: ['管培'] },
  { t: 'medical', kw: ['医学', '临床', '医药', '农业', '应用'] }
];

/** 从文本里解析方向，并按关键词出现位置排序：位置越靠前，说明该岗位越是主打这个方向 */
function tracksFromText(text: string): Track[] {
  const cat = String(text || '');
  const hits: { t: Track; pos: number }[] = [];
  for (const row of TRACK_KEYWORDS) {
    let best = -1;
    for (const kw of row.kw) {
      const i = cat.indexOf(kw);
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    if (best >= 0) hits.push({ t: row.t, pos: best });
  }
  hits.sort((a, b) => a.pos - b.pos);
  return hits.map((h) => h.t);
}

/** 从 jobCategory 里解析方向（可能是「技术/产品/运营/财务」这类多方向拼接） */
export function tracksOf(jobCategory: string): Track[] {
  const out = tracksFromText(jobCategory);
  return out.length ? out : ['general'];
}

/* ==================== 行业 / 性质 ==================== */

interface EntityRule {
  key: string;
  label: string;
  /** 门槛与材料 */
  material: string[];
  /** 投递与考核策略 */
  strategy: string[];
}

/** 按行业/性质/公司名给规则；命中多条时合并 */
const ENTITY_RULES: EntityRule[] = [
  {
    key: 'firm',
    label: '会计师事务所',
    material: [
      'CPA 进度写在简历最前面（已过科目 + 分数段），这是事务所最看重的信号',
      '成绩单 + 六级成绩 + 实习证明提前扫描成 PDF，投递时一次性上传',
      '有会计/审计相关实习的，把底稿或项目清单整理成 3 行要点',
    ],
    strategy: [
      '四大与八大的流程差别大：四大节奏更快、笔试与面试更结构化，先各投一家保底',
      '务必勾选「接受调剂分所」，很多 offer 是从二线城市所里出来的',
      '寒假年审实习是转正主通道，比秋招正式批更值得争取',
    ],
  },
  {
    key: 'bank',
    label: '银行',
    material: [
      '笔试三件套：EPI（数理逻辑/言语）、英语、综合知识（经济金融时政）',
      '准备一张正装证件照与生活照，多数银行网申要求上传',
      '金融相关证书（银行从业/证券从业）有就写上',
    ],
    strategy: [
      '网申通过率低，建议按「冲刺行 + 匹配行 + 保底行」各投 2-3 家，别只盯一家',
      '无领导小组讨论是主要淘汰环节：抢角色没意义，重点是推动结论落地',
      '性格测评要前后一致，别为了「显得外向」而前后矛盾',
    ],
  },
  {
    key: 'soe',
    label: '央国企',
    material: [
      '统一笔试通常考行测 + 申论/英语/专业知识，提前 3 周刷行测最稳',
      '成绩单、党员或学生干部经历、校级以上奖项整理成一页「优势清单」',
      '部分单位需要政审材料与体检，报名时就要留意流程时长',
    ],
    strategy: [
      '校招信息多挂在集团官网与高校就业网，别只依赖第三方汇总',
      '结构化面试更看重表达稳重与价值观匹配，答案要具体、不要飘',
      '流程普遍偏长（2-4 个月），务必同时并行准备市场化企业',
    ],
  },
  {
    key: 'internet',
    label: '互联网',
    material: [
      '简历必须量化：DAU、转化率、耗时下降多少、覆盖多少用户',
      '项目复盘写成「问题-方案-取舍-结果」四段，防止被追问三层就崩',
      '技术岗刷题量要够，非技术岗准备 1 份能演示的作品',
    ],
    strategy: [
      '笔试基本是在线编程或行测型，限时训练比刷题量更重要',
      '面试节奏快，多轮技术面 + HR 面可能压缩在一周内，提前排好时间',
      '注意投递次数限制：有的公司一轮只允许选 1-2 个岗位，别浪费名额',
    ],
  },
  {
    key: 'fmcg',
    label: '快消',
    material: [
      '准备英文简历，且每一句都能用英文复述',
      '宝洁八大问式的行为面试：每问准备 2 个真实案例，都要有数字',
      '英语口语练到能撑 20 分钟商业对话（自我介绍 + 项目 + 观点）',
    ],
    strategy: [
      '管培流程通常含在线测评、群面 case、终面，跨 1-2 个月，早投早排期',
      '群面评分重点在「是否推动团队往前走」，不是发言次数',
    ],
  },
  {
    key: 'foreign',
    label: '外企',
    material: [
      '准备一份英文简历，每句都要能用英文复述',
      '练 1 分钟英文自我介绍 + 1 个英文项目讲述',
      '外企网申后通常先发在线测评，投递后每天留意邮箱与短信',
    ],
    strategy: [
      '外企流程规范但周期偏长（1-2 个月），早投早排期',
      '英文面试讲项目先给结论再给细节，避免绕圈',
    ],
  },
  {
    key: 'consult',
    label: '咨询',
    material: [
      'case 书练 20+ 个，练到能在 5 分钟内做出结构化拆解',
      'PPT 作品集：挑 3 页最能代表你思路的图表页',
      '英语：准备 1 分钟英文自我介绍与 1 个英文 case 小结',
    ],
    strategy: [
      'Pre-talk / 宣讲会能拿到内推与流程信息，尽量参加',
      '面试中「提问环节」也是考点，准备 2 个有深度的问题',
    ],
  },
  {
    key: 'securities',
    label: '证券 / 基金 / 保险',
    material: [
      '准备一份自己的行研报告或行业观察（10 页以内，有数据来源）',
      'CPA / CFA / FRM 考试进度要标注清楚',
      'Wind / iFinD 熟练度会直接被问',
    ],
    strategy: [
      '这类机构实习转正比例高，秋招前先争取一段对口实习比硬投更有效',
      '研究所与投行条线节奏差异大，投递前先确认岗位属于哪条线',
    ],
  },
  {
    key: 'manufacture',
    label: '制造 / 半导体',
    material: [
      '专业基础课（材料/电路/机械/工艺）要能应对笔试',
      '课程设计、竞赛、实验项目整理成 3 个可讲的技术点',
      '四六级与专业软件（AutoCAD / SolidWorks / Python）写清熟练度',
    ],
    strategy: [
      '宣讲会常现场收简历甚至初面，带够纸质简历',
      '产线/工艺岗会关注稳定性与倒班接受度，回答要真实',
    ],
  },
  {
    key: 'game',
    label: '游戏',
    material: [
      '作品集是入场券：策划案、美术集、Demo、拆解报告都行',
      '选 1 款目标品类的游戏做深度拆解（数值/关卡/商业化）',
      '非美术岗也要展示「你懂玩家」的证据',
    ],
    strategy: [
      '面试常问「你最近在玩什么，哪里设计得好」，准备 2 个能展开的答案',
      '投递时把作品集做成在线链接，比附件更容易被打开',
    ],
  },
  {
    key: 'medical',
    label: '医药',
    material: [
      'GMP / GCP 基础、临床试验流程要能讲清',
      '英语文献检索与综述能力准备一个样例',
      '相关实习（医学事务/注册/临床监查）是强加分',
    ],
    strategy: [
      '外企医药流程规范、周期长，网申后要留意测评邮件别漏',
      '专业面会深挖细节，务必复习核心课程的基础概念',
    ],
  },
  {
    key: 'estate',
    label: '地产',
    material: [
      '准备对行业现状的判断（不必乐观，但要逻辑自洽）',
      '项目测算与 Excel 能力会加分',
      '财务岗要熟悉地产特有的收入确认与预收模式',
    ],
    strategy: ['关注企业财务稳健度与业务结构，面试时能体现你的选择理由'],
  }
];

/** 行业 / 企业性质 → 命中的规则 */
export function entitiesOf(o: JobOpening): EntityRule[] {
  const ct = String(o.companyType || '');
  const own = String(o.ownership || '');
  const co = String(o.company || '');
  const hit: string[] = [];

  const push = (k: string) => { if (hit.indexOf(k) < 0) hit.push(k); };

  if (ct === '事务所' || co.indexOf('会计师事务所') >= 0) push('firm');
  if (ct === '银行' || co.indexOf('银行') >= 0) push('bank');
  if (ct === '央国企' || own === '国资') push('soe');
  if (ct === '互联网') push('internet');
  if (ct === '快消') push('fmcg');
  if (ct === '咨询') push('consult');
  if (ct === '金融') push('securities');
  if (co.indexOf('证券') >= 0 || co.indexOf('基金') >= 0 || co.indexOf('人寿') >= 0 || co.indexOf('保险') >= 0) push('securities');
  if (ct === '半导体' || ct === '制造') push('manufacture');
  if (ct === '游戏') push('game');
  if (ct === '医药') push('medical');
  if (ct === '地产') push('estate');
  if (co.indexOf('四大') >= 0 || co.indexOf('八大') >= 0) push('firm');
  if (co.indexOf('券商基金') >= 0) push('securities');
  if (co.indexOf('互联网大厂') >= 0) push('internet');
  if (co.indexOf('央国企') >= 0) push('soe');
  // 外资通用的「英文材料 + 测评节奏」放在最后：不覆盖上面更具体的行业规则
  if (own === '外资' || co.indexOf('外企') >= 0) push('foreign');

  const out: EntityRule[] = [];
  for (const k of hit) {
    const r = ENTITY_RULES.find((x) => x.key === k);
    if (r) out.push(r);
  }
  return out;
}

/* ==================== 时间节奏 ==================== */

function stagesFor(o: JobOpening, d: number | null): { timing: string; stages: PrepStage[] } {
  if (o.rolling && (d === null || d < 0)) {
    return {
      timing: '招满即止 · 官方未给明确截止日，实际关岗通常早于公告',
      stages: [
        { when: '72 小时内', todo: ['把简历按该岗位关键词改一版（词要对得上 JD 原词）', '完成网申并提交，别等「准备到完美」再投', '建一张投递跟踪表：公司 / 岗位 / 投递日 / 状态 / 下一步'] },
        { when: '一周内', todo: ['补齐材料：成绩单、四六级、证书、作品或报告链接', '按该行业的笔试类型做限时训练，而不是漫无目的地看'] },
        { when: '进入流程后', todo: ['收到测评或笔试立刻做完，很多系统按 48 小时核算成绩', '面试前把 3 段经历各写成 90 秒版本，录音回听删废话'] }
      ]
    };
  }
  if (d === null) {
    return {
      timing: '官方尚未公布日期 · 按往年节奏提前准备',
      stages: [
        { when: '现在', todo: ['关注企业官方招聘公众号与官网，开启消息提醒', '按往年时间点倒推，提前一个月把材料备齐'] },
        { when: '公告前后', todo: ['公告一出立刻投递，别等「再改一版简历」', '把证件、成绩单等扫描件统一放进一个文件夹'] },
        { when: '投递后', todo: ['立刻转入笔试准备，不等通知', '并行准备 2-3 家同类公司，避免单点押注'] }
      ]
    };
  }
  if (d <= 0) {
    return {
      timing: '该批次已过截止日 · 转入下一批次或春招 / 补录',
      stages: [
        { when: '本周', todo: ['确认是否还有补录或春招通道，盯紧官方公告', '把这次没投上的原因写下来：材料？节奏？匹配度？'] },
        { when: '两周内', todo: ['补齐最短板的那一项：证书科目、实习或作品集'] },
        { when: '下一批开启', todo: ['提前一周把材料准备好，公告当天就投', '把这次的目标公司清单扩充到 8-10 家'] }
      ]
    };
  }
  if (d <= 7) {
    return {
      timing: `距最迟收口仅剩 ${d} 天 · 进入冲刺档`,
      stages: [
        { when: '今天', todo: ['完成网申提交，不要拖到最后一天改简历', '把简历关键词对齐 JD 原词'] },
        { when: `剩余 ${Math.max(1, d - 1)} 天`, todo: ['集中刷该类岗位的笔试题型与常见 case，限时做', '把最拿得出手的 1 段经历打磨到能讲 10 分钟'] },
        { when: '提交后', todo: ['准备 90 秒自我介绍与 3 段 STAR 经历', '模拟面试录音一次，重点删掉铺垫和口头禅'] }
      ]
    };
  }
  if (d <= 21) {
    return {
      timing: `距最迟收口约 ${d} 天 · 两周作战窗口`,
      stages: [
        { when: '第 1 周', todo: ['把成绩单、证书、作品链接整理成一份投递材料包', '简历改到「能被追问三层也答得上」的程度'] },
        { when: '第 2 周', todo: ['完成网申提交，并同步投 2-3 家同类岗位', '开始笔试训练与面试模拟各至少一次'] },
        { when: '投递后', todo: ['按周复盘：投了几家、进了几个流程、卡在哪一环'] }
      ]
    };
  }
  if (d <= 45) {
    return {
      timing: `距最迟收口约 ${d} 天 · 一个月主场期`,
      stages: [
        { when: '第 1 周', todo: ['定位收窄：确定 2 个主投方向 + 1 个保底方向', '简历做成两版：主投版与相关方向版'] },
        { when: '第 2-3 周', todo: ['补齐一块硬短板：证书科目、实习或作品集任选其一', '把该岗位的笔试类型摸清并开始专项训练'] },
        { when: '第 4 周', todo: ['批量投递，并用表格跟踪每家的进度与下一步', '至少做 2 次完整模拟面试'] }
      ]
    };
  }
  return {
    timing: `距最迟收口约 ${d} 天 · 长线备战`,
    stages: [
      { when: '第 1 个月', todo: ['确定职业方向，并据此选课、选实习', '把简历从零建起来：一段实习 + 一个项目 + 一项技能'] },
      { when: '第 2 个月', todo: ['开始证书或技能储备（CPA / CFA / 雅思 / 编程任选）', '找一位目标行业的学长学姐做一次信息访谈'] },
      { when: '启动前 1 个月', todo: ['刷目标行业的笔试题与面试题，做 3 次模拟', '关注官方公告，一开放就投'] }
    ]
  };
}

/* ==================== 主入口 ==================== */

/** 生成某条岗位的备战指南 */
export function buildPrepGuide(o: JobOpening, now = Date.now()): PrepGuide {
  let tracks = tracksOf(o.jobCategory);
  // 岗位类别只写了批次名（如「暑期实习」「秋招补录」）时，用备注 / 往年参考 / 事业群再识别一次
  if (tracks.length === 1 && tracks[0] === 'general') {
    const extra = tracksFromText(`${o.note} ${o.lastYearRef} ${o.group}`);
    if (extra.length) tracks = extra;
  }
  const main = TRACK_RULES[tracks[0]];
  const ents = entitiesOf(o);
  const d = daysLeft(o, now);

  const focus = `这是一条「${o.company}·${o.jobCategory}」的${o.recruitType}，准备重心在${main.label}方向的硬技能 + ${ents.length ? ents[0].label + '的流程要求' : '基础材料完备度'}。`;

  const { timing, stages } = stagesFor(o, d);

  const blocks: PrepBlock[] = [];

  // 1) 门槛自检（所有岗位都适用，最容易被忽略）
  blocks.push({
    key: 'gate',
    icon: '🚪',
    title: '门槛自检（先确认能过筛）',
    items: [
      '届别与学历：确认自己是否在目标毕业区间内（本批次多为 2027 届）',
      '专业要求：看 JD 是否写「相关专业」，跨专业要用证书或实习补位',
      '硬性证书：四六级 / 雅思 / 从业资格 / CPA 科目，缺哪一项现在就补',
      '成绩与排名：部分企业网申要填排名，提前查好绩点与均分',
      o.recruitType === '暑期实习'
        ? '实习岗更看「可实习时长与到岗时间」，简历里直接写明每周可到岗天数'
        : '正式批看长期潜力与匹配度，简历要突出「能上手」的证据'
    ]
  });

  // 2) 岗位能力准备（主方向 + 次方向）
  const abilityItems: string[] = [];
  tracks.slice(0, 3).forEach((t, i) => {
    const r = TRACK_RULES[t];
    const picked = i === 0 ? r.ability.slice(0, 4) : r.ability.slice(0, 2);
    picked.forEach((s) => abilityItems.push(i === 0 ? s : `【${r.label}】${s}`));
  });
  blocks.push({ key: 'ability', icon: '🛠', title: `能力准备 · ${main.label}`, items: abilityItems });

  // 3) 行业 / 性质专属材料与策略
  ents.slice(0, 2).forEach((e, i) => {
    blocks.push({
      key: 'ent' + i,
      icon: '🏢',
      title: `${e.label} · 材料与流程`,
      items: e.material
    });
  });

  // 4) 简历与材料清单
  blocks.push({
    key: 'resume',
    icon: '📄',
    title: '简历与材料清单',
    items: [
      '一页纸：按「教育 → 技能 → 经历 → 荣誉」排，每段经历必须带数字结果',
      '关键词对齐：把 JD 里的动词与名词原样写进简历（系统初筛按词匹配）',
      '准备好 PDF 版成绩单、六级成绩、获奖证书、实习证明',
      '命名规范：姓名-学校-专业-岗位.pdf，HR 一眼能认',
      '有作品或报告就放一个在线链接（比附件更易被打开）'
    ]
  });

  // 5) 笔试面试重点
  const ivItems: string[] = [];
  tracks.slice(0, 2).forEach((t, i) => {
    const r = TRACK_RULES[t];
    r.interview.forEach((s) => ivItems.push(i === 0 ? s : `【${r.label}】${s}`));
  });
  ents.slice(0, 1).forEach((e) => e.strategy.forEach((s) => ivItems.push(`【${e.label}】${s}`)));
  blocks.push({ key: 'interview', icon: '🎤', title: '笔试 / 面试重点', items: ivItems });

  // 6) 加分项
  blocks.push({
    key: 'bonus',
    icon: '⭐',
    title: '能拉开差距的加分项',
    items: [
      '一段对口实习（对口比大厂更重要）',
      '一份自己做的报告 / 作品，能证明你「主动做过」',
      '一项硬证书或考试进度（写在最显眼的位置）',
      '英语能撑住业务对话（外企/咨询/银行是硬通货）',
      '内推渠道：学长学姐、宣讲会群、校友群，比自己硬投效率高得多'
    ]
  });

  // 7) 风险与坑
  const risks: string[] = [];
  if (o.rolling) risks.push('该条标注「招满即止」：公告日期只是最迟收口，实际关岗可能早很多，别拖到后期');
  if (tracks.length >= 3) risks.push(`该条目覆盖 ${tracks.length} 个岗位方向，投递时务必在系统里只选你最强的 1 个方向，避免分散`);
  risks.push('第三方汇总的时间表会有滞后，投递前一定用官方渠道二次确认');
  risks.push('一个岗位投递次数有限（有的公司一轮只允许 1-2 次），改好简历再点提交');
  ents.slice(0, 1).forEach((e) => risks.push(`${e.label}流程与考察重点见上文，别用同一份材料投所有公司`));
  if (d !== null && d > 0 && d <= 14) risks.push(`仅剩 ${d} 天，笔试与面试可能压缩在同一周，先保投递再补准备`);

  const guide: PrepGuide = { focus, timing, stages, blocks, risks, text: '' };
  guide.text = prepToText(o, guide);
  return guide;
}

/** 拼成可复制的纯文本 */
export function prepToText(o: JobOpening, g: PrepGuide): string {
  const lines: string[] = [];
  lines.push(`【${o.company} · ${o.jobCategory}】备战清单`);
  lines.push(`招聘类型：${o.recruitType}｜行业：${o.companyType}｜性质：${o.ownership}`);
  lines.push(`开放：${o.openDate}｜截止：${o.rolling && !o.deadline ? '招满即止' : o.deadline}`);
  lines.push('');
  lines.push(`🎯 ${g.focus}`);
  lines.push(`⏱ ${g.timing}`);
  lines.push('');
  lines.push('— 行动节奏 —');
  g.stages.forEach((s) => {
    lines.push(`▸ ${s.when}`);
    s.todo.forEach((t) => lines.push(`   · ${t}`));
  });
  g.blocks.forEach((b) => {
    lines.push('');
    lines.push(`— ${b.title} —`);
    b.items.forEach((t) => lines.push(`· ${t}`));
  });
  lines.push('');
  lines.push('— 容易踩的坑 —');
  g.risks.forEach((t) => lines.push(`! ${t}`));
  lines.push('');
  lines.push('（由秋招助手根据岗位信息生成的通用备战建议，具体以企业官方要求为准）');
  return lines.join('\n');
}
