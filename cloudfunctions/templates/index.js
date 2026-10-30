// 云函数 templates
// 系统预置 6 个场景模板（首次部署时自动 seed），用户可保存自定义模板
// 应用模板时批量插入 todos 集合
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const TPL_COL = 'templates';
const TODO_COL = 'todos';

function getOpenid() {
  const wxContext = cloud.getWXContext();
  if (!wxContext.OPENID) throw new Error('未拿到 OPENID');
  return wxContext.OPENID;
}
function normalizeText(v, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}
function normalizeItems(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 50).map((it) => ({
    content: normalizeText(it.content, 200) || '未命名',
    priority: ['high', 'medium', 'low'].includes(it.priority) ? it.priority : null,
    location: normalizeText(it.location, 60),
    tags: Array.isArray(it.tags) ? it.tags.filter((t) => typeof t === 'string').slice(0, 8) : [],
    description: normalizeText(it.description, 500),
    subtasks: Array.isArray(it.subtasks) ? it.subtasks.filter((s) => typeof s === 'string').slice(0, 20).map((s) => s.trim()).filter(Boolean) : [],
    dueOffsetDays: Number.isFinite(it.dueOffsetDays) ? Math.floor(it.dueOffsetDays) : null
  }));
}

/* ============ 系统模板 seed（14 个 · 5 大分类） ============ */
const SYSTEM_TEMPLATES = [
  /* ---- 工作计划 ---- */
  {
    name: '周工作计划', icon: '📅', category: '工作计划', isSystem: true,
    items: [
      { content: '梳理本周目标与优先级', priority: 'high', tags: ['规划'], dueOffsetDays: 0 },
      { content: '周一团队例会与任务分配', priority: 'high', tags: ['会议'], dueOffsetDays: 0 },
      { content: '推进核心项目进度', priority: 'high', tags: ['项目'], dueOffsetDays: 2, subtasks: ['同步协作方', '更新里程碑'] },
      { content: '整理本周工作周报', priority: 'medium', tags: ['复盘'], dueOffsetDays: 4 },
      { content: '清理邮箱与待办收件箱', priority: 'low', tags: ['整理'], dueOffsetDays: 5 }
    ]
  },
  {
    name: '会议准备', icon: '📋', category: '工作计划', isSystem: true,
    items: [
      { content: '发送会议议程', priority: 'high', dueOffsetDays: 0 },
      { content: '准备演示文稿', priority: 'high', dueOffsetDays: 0, subtasks: ['封面', '目录', '结论页'] },
      { content: '预订会议室', priority: 'medium', dueOffsetDays: 0 },
      { content: '通知参会人', priority: 'medium', dueOffsetDays: -1 }
    ]
  },
  {
    name: '项目上线', icon: '🚀', category: '工作计划', isSystem: true,
    items: [
      { content: '代码合并与审查', priority: 'high', tags: ['研发'], dueOffsetDays: 0 },
      { content: '测试用例执行', priority: 'high', tags: ['测试'], dueOffsetDays: 0, subtasks: ['冒烟', '回归', '压力'] },
      { content: '部署到生产环境', priority: 'high', tags: ['发布'], dueOffsetDays: 1 },
      { content: '发布公告', priority: 'medium', tags: ['运营'], dueOffsetDays: 1 }
    ]
  },
  {
    name: '求职面试准备', icon: '💼', category: '工作计划', isSystem: true,
    items: [
      { content: '更新简历', priority: 'high', tags: ['求职'], dueOffsetDays: 0, subtasks: ['工作经历', '项目亮点', '技能清单'] },
      { content: '研究目标公司与岗位', priority: 'high', tags: ['求职'], dueOffsetDays: 1 },
      { content: '准备自我介绍与常见问题', priority: 'medium', tags: ['面试'], dueOffsetDays: 2 },
      { content: '模拟面试练习', priority: 'medium', tags: ['面试'], dueOffsetDays: 3 },
      { content: '准备面试着装与路线', priority: 'low', tags: ['面试'], dueOffsetDays: 4 }
    ]
  },
  /* ---- 学习任务 ---- */
  {
    name: '开学准备清单', icon: '🎒', category: '学习任务', isSystem: true,
    items: [
      { content: '购买教材', priority: 'high', tags: ['学习'], dueOffsetDays: 0 },
      { content: '准备学习工具', priority: 'medium', tags: ['学习'], dueOffsetDays: 0, subtasks: ['笔', '笔记本', '计算器'] },
      { content: '调整作息时间', priority: 'medium', tags: ['生活'], dueOffsetDays: 1 },
      { content: '制定学期目标', priority: 'low', tags: ['规划'], dueOffsetDays: 3 }
    ]
  },
  {
    name: '考试复习计划', icon: '📖', category: '学习任务', isSystem: true,
    items: [
      { content: '整理考试范围与重点', priority: 'high', tags: ['复习'], dueOffsetDays: 0 },
      { content: '第一轮：通读教材', priority: 'high', tags: ['复习'], dueOffsetDays: 3 },
      { content: '第二轮：刷题与错题本', priority: 'high', tags: ['刷题'], dueOffsetDays: 7, subtasks: ['选择题', '大题', '错题复盘'] },
      { content: '第三轮：模拟卷计时训练', priority: 'medium', tags: ['模拟'], dueOffsetDays: 10 },
      { content: '考前知识点速览', priority: 'medium', tags: ['冲刺'], dueOffsetDays: 13 }
    ]
  },
  {
    name: '技能学习路线', icon: '🎓', category: '学习任务', isSystem: true,
    items: [
      { content: '明确学习目标与应用场景', priority: 'high', tags: ['规划'], dueOffsetDays: 0 },
      { content: '收集教程与学习资料', priority: 'medium', tags: ['资料'], dueOffsetDays: 1 },
      { content: '完成基础知识学习', priority: 'high', tags: ['基础'], dueOffsetDays: 7 },
      { content: '完成实战项目练习', priority: 'high', tags: ['实战'], dueOffsetDays: 14 },
      { content: '输出学习笔记与总结', priority: 'low', tags: ['复盘'], dueOffsetDays: 21 }
    ]
  },
  {
    name: '读书计划', icon: '📚', category: '学习任务', isSystem: true,
    items: [
      { content: '制定本月书单', priority: 'medium', tags: ['阅读'], dueOffsetDays: 0 },
      { content: '每天阅读 30 分钟', priority: 'medium', tags: ['阅读'] },
      { content: '写读书笔记与摘录', priority: 'low', tags: ['笔记'], dueOffsetDays: 7 },
      { content: '输出一篇读后感', priority: 'low', tags: ['输出'], dueOffsetDays: 28 }
    ]
  },
  /* ---- 生活管理 ---- */
  {
    name: '家庭清洁大扫除', icon: '🧹', category: '生活管理', isSystem: true,
    items: [
      { content: '整理换季衣物', priority: 'medium', tags: ['整理'], subtasks: ['外衣', '床品', '鞋帽'] },
      { content: '厨房深度去油污', priority: 'high', tags: ['厨房'], dueOffsetDays: 0 },
      { content: '卫生间消毒清洁', priority: 'high', tags: ['卫生间'], dueOffsetDays: 0 },
      { content: '擦拭门窗与玻璃', priority: 'medium', tags: ['门窗'], dueOffsetDays: 1 },
      { content: '处理闲置物品断舍离', priority: 'low', tags: ['整理'], dueOffsetDays: 2 }
    ]
  },
  {
    name: '每周采购清单', icon: '🛒', category: '生活管理', isSystem: true,
    items: [
      { content: '蔬菜水果', priority: 'high', tags: ['生鲜'], subtasks: ['叶菜', '水果', '鸡蛋'] },
      { content: '肉禽水产', priority: 'high', tags: ['生鲜'] },
      { content: '米面粮油', priority: 'medium', tags: ['主食'] },
      { content: '日用消耗品', priority: 'medium', tags: ['日用'], subtasks: ['纸巾', '洗护', '清洁用品'] },
      { content: '核对冰箱库存避免重复购买', priority: 'low', tags: ['整理'], dueOffsetDays: -1 }
    ]
  },
  {
    name: '月度理财记账', icon: '💰', category: '生活管理', isSystem: true,
    items: [
      { content: '导出本月账单流水', priority: 'high', tags: ['记账'], dueOffsetDays: 0 },
      { content: '分类统计各项支出', priority: 'high', tags: ['记账'], dueOffsetDays: 1, subtasks: ['固定支出', '弹性支出', '意外支出'] },
      { content: '核对预算执行情况', priority: 'medium', tags: ['预算'], dueOffsetDays: 2 },
      { content: '制定下月储蓄目标', priority: 'medium', tags: ['储蓄'], dueOffsetDays: 3 }
    ]
  },
  /* ---- 出行准备 ---- */
  {
    name: '旅行打包清单', icon: '✈️', category: '出行准备', isSystem: true,
    items: [
      { content: '身份证件', priority: 'high', tags: ['必备'] },
      { content: '充电器与转换插头', priority: 'high', tags: ['电子'] },
      { content: '换洗衣物', priority: 'medium', tags: ['衣物'], subtasks: ['内衣', '外套', '袜子'] },
      { content: '洗漱用品', priority: 'medium', tags: ['洗漱'] },
      { content: '机票/酒店确认', priority: 'high', tags: ['行程'], dueOffsetDays: 1 }
    ]
  },
  {
    name: '搬家清单', icon: '🏠', category: '出行准备', isSystem: true,
    items: [
      { content: '打包厨房用品', priority: 'medium', tags: ['打包'] },
      { content: '打包衣物', priority: 'medium', tags: ['打包'], subtasks: ['冬季', '夏季', '四季'] },
      { content: '联系搬家公司', priority: 'high', dueOffsetDays: 1 },
      { content: '变更地址登记', priority: 'high', tags: ['行政'], dueOffsetDays: 3 }
    ]
  },
  /* ---- 健康健身 ---- */
  {
    name: '健身计划', icon: '💪', category: '健康健身', isSystem: true,
    items: [
      { content: '晨跑 30 分钟', priority: 'medium', tags: ['运动'] },
      { content: '力量训练', priority: 'medium', tags: ['运动'], subtasks: ['深蹲', '俯卧撑', '平板支撑'] },
      { content: '拉伸放松', priority: 'low', tags: ['运动'], dueOffsetDays: 0 },
      { content: '记录体重', priority: 'low', tags: ['健康'], dueOffsetDays: 0 }
    ]
  },
  {
    name: '早睡早起挑战', icon: '😴', category: '健康健身', isSystem: true,
    items: [
      { content: '23:00 前放下手机', priority: 'high', tags: ['作息'] },
      { content: '睡前阅读 15 分钟', priority: 'medium', tags: ['作息'] },
      { content: '7:00 起床喝一杯温水', priority: 'high', tags: ['作息'] },
      { content: '午间小憩 20 分钟', priority: 'low', tags: ['作息'] }
    ]
  },
  /* ---- 工作计划（扩充） ---- */
  {
    name: '上班周一清单', icon: '💼', category: '工作计划', isSystem: true,
    items: [
      { content: '整理本周穿搭与通勤包', priority: 'low', tags: ['生活'] },
      { content: '备好工牌与通勤卡', priority: 'high', tags: ['准备'], dueOffsetDays: 0 },
      { content: '规划本周三餐', priority: 'medium', tags: ['生活'] },
      { content: '列出本周三项重点目标', priority: 'high', tags: ['规划'], dueOffsetDays: 0 },
      { content: '清理微信工作消息', priority: 'low', tags: ['整理'] }
    ]
  },
  /* ---- 生活管理（扩充） ---- */
  {
    name: '去医院带物清单', icon: '🏥', category: '生活管理', isSystem: true,
    items: [
      { content: '身份证 / 医保卡', priority: 'high', tags: ['必备'] },
      { content: '既往病历与检查单', priority: 'high', tags: ['资料'] },
      { content: '预约挂号截图', priority: 'medium', tags: ['预约'] },
      { content: '充电宝与耳机', priority: 'low', tags: ['电子'] },
      { content: '水杯与少量现金', priority: 'low', tags: ['日用'] }
    ]
  },
  {
    name: '租房入住清单', icon: '🔑', category: '生活管理', isSystem: true,
    items: [
      { content: '水电燃气过户登记', priority: 'high', tags: ['行政'], dueOffsetDays: 1 },
      { content: '宽带安装预约', priority: 'medium', tags: ['网络'], dueOffsetDays: 2 },
      { content: '全屋基础清洁', priority: 'medium', tags: ['清洁'], subtasks: ['厨房', '卫生间', '地面'] },
      { content: '采购日用品', priority: 'low', tags: ['日用'] },
      { content: '检查门锁与消防', priority: 'low', tags: ['安全'] }
    ]
  },
  {
    name: '断舍离整理', icon: '📦', category: '生活管理', isSystem: true,
    items: [
      { content: '划定一个整理区域', priority: 'medium', tags: ['整理'] },
      { content: '分出「留 / 捐 / 扔」三堆', priority: 'high', tags: ['整理'], subtasks: ['衣物', '书报', '小家电'] },
      { content: '拍照处理闲置二手', priority: 'low', tags: ['闲置'] },
      { content: '归位常用物品', priority: 'medium', tags: ['收纳'] }
    ]
  },
  /* ---- 家庭育儿（新增分类） ---- */
  {
    name: '宝宝入园准备', icon: '🍼', category: '家庭育儿', isSystem: true,
    items: [
      { content: '报名材料与入园体检', priority: 'high', tags: ['行政'], dueOffsetDays: 3 },
      { content: '姓名贴与水杯', priority: 'high', tags: ['用品'] },
      { content: '换洗衣物与室内鞋', priority: 'medium', tags: ['用品'] },
      { content: '安抚小玩具', priority: 'low', tags: ['情绪'] },
      { content: '和宝宝演练告别仪式', priority: 'medium', tags: ['陪伴'] }
    ]
  },
  {
    name: '宠物照顾日程', icon: '🐾', category: '家庭育儿', isSystem: true,
    items: [
      { content: '晨间遛狗喂粮', priority: 'high', tags: ['日常'] },
      { content: '清理猫砂 / 宠舍', priority: 'medium', tags: ['清洁'] },
      { content: '梳毛与互动玩耍', priority: 'low', tags: ['陪伴'] },
      { content: '周末洗澡护理', priority: 'medium', tags: ['护理'] },
      { content: '补货口粮与用品', priority: 'low', tags: ['采购'] }
    ]
  },
  /* ---- 社交活动（新增分类） ---- */
  {
    name: '婚礼筹备', icon: '💍', category: '社交活动', isSystem: true,
    items: [
      { content: '确定预算与宾客名单', priority: 'high', tags: ['统筹'], dueOffsetDays: 0 },
      { content: '预订酒店与婚庆', priority: 'medium', tags: ['预订'], dueOffsetDays: 14 },
      { content: '试妆与选定婚纱', priority: 'high', tags: ['造型'], dueOffsetDays: 21 },
      { content: '发送电子请柬', priority: 'medium', tags: ['通知'], dueOffsetDays: 30 },
      { content: '婚礼当天流程表', priority: 'low', tags: ['当天'], dueOffsetDays: 45 }
    ]
  },
  {
    name: '节日送礼筹备', icon: '🎁', category: '社交活动', isSystem: true,
    items: [
      { content: '列出收礼人清单', priority: 'high', tags: ['人际'] },
      { content: '挑选礼物并下单', priority: 'medium', tags: ['采购'] },
      { content: '准备手写贺卡', priority: 'low', tags: ['心意'] },
      { content: '包装与邮寄', priority: 'medium', tags: ['物流'] },
      { content: '节前提醒确保送达', priority: 'low', tags: ['提醒'] }
    ]
  },
  /* ---- 自我成长（新增分类） ---- */
  {
    name: '考试周冲刺', icon: '✏️', category: '自我成长', isSystem: true,
    items: [
      { content: '打印准考证 / 课表', priority: 'high', tags: ['考试'] },
      { content: '按科目做速记卡', priority: 'high', tags: ['复习'], subtasks: ['重点', '易错', '公式'] },
      { content: '每日模拟一套', priority: 'medium', tags: ['模拟'] },
      { content: '调整作息不熬夜', priority: 'medium', tags: ['状态'] },
      { content: '准备考试文具', priority: 'low', tags: ['考试'] }
    ]
  },
  {
    name: '减脂餐计划', icon: '🥗', category: '健康健身', isSystem: true,
    items: [
      { content: '备好一周食材', priority: 'high', tags: ['饮食'] },
      { content: '午餐便当备餐', priority: 'medium', tags: ['饮食'] },
      { content: '记录每日热量', priority: 'low', tags: ['记录'] },
      { content: '喝水 2000ml', priority: 'medium', tags: ['健康'] },
      { content: '周末轻断食', priority: 'low', tags: ['调节'] }
    ]
  }
];

async function seed() {
  const OPENID = getOpenid();
  const now = Date.now();
  let created = 0;
  for (const tpl of SYSTEM_TEMPLATES) {
    const exist = await db.collection(TPL_COL).where({
      _openid: 'SYSTEM',
      name: tpl.name
    }).count();
    if (exist.total > 0) continue;
    await db.collection(TPL_COL).add({
      data: {
        _openid: 'SYSTEM',
        name: tpl.name,
        icon: tpl.icon,
        category: normalizeText(tpl.category, 12) || '通用',
        isSystem: true,
        items: normalizeItems(tpl.items),
        createTime: now,
        updateTime: now
      }
    });
    created += 1;
  }
  return { success: true, created };
}

async function list() {
  const OPENID = getOpenid();
  const res = await db.collection(TPL_COL)
    .where(_.or([{ _openid: 'SYSTEM' }, { _openid: OPENID }]))
    .orderBy('createTime', 'desc')
    .limit(200)
    .get();
  return { success: true, items: res.data || [] };
}

async function save({ template }) {
  const OPENID = getOpenid();
  if (!template || !template.name) throw new Error('模板名称必填');
  const now = Date.now();
  const data = {
    _openid: OPENID,
    name: normalizeText(template.name, 30),
    icon: normalizeText(template.icon, 4) || '📌',
    category: normalizeText(template.category, 12) || '我的模板',
    isSystem: false,
    items: normalizeItems(template.items),
    createTime: now,
    updateTime: now
  };
  if (template.id) {
    const r = await db.collection(TPL_COL).where({ _id: template.id, _openid: OPENID }).update({
      data: { name: data.name, icon: data.icon, category: data.category, items: data.items, updateTime: now }
    });
    if (r.stats.updated === 0) throw new Error('模板不存在或无权限');
    return { success: true, id: template.id, updated: r.stats.updated };
  }
  data._openid = OPENID;
  const r = await db.collection(TPL_COL).add({ data });
  return { success: true, id: r._id };
}

async function remove({ id }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  const r = await db.collection(TPL_COL).where({ _id: id, _openid: OPENID }).remove();
  if (r.stats.removed === 0) throw new Error('模板不存在或无权限');
  return { success: true, removed: r.stats.removed };
}

async function apply({ id }) {
  const OPENID = getOpenid();
  if (!id) throw new Error('id 必填');
  // 系统模板与用户模板均可套用
  const r = await db.collection(TPL_COL).where(
    _.or([{ _id: id, _openid: 'SYSTEM' }, { _id: id, _openid: OPENID }])
  ).get();
  const tpl = (r.data || [])[0];
  if (!tpl) throw new Error('模板不存在');

  const now = Date.now();
  const created = [];
  for (const it of tpl.items) {
    const dueMs = Number.isFinite(it.dueOffsetDays)
      ? now + it.dueOffsetDays * 86400000
      : null;
    const subtasks = Array.isArray(it.subtasks) ? it.subtasks : [];
    const todoDoc = {
      _openid: OPENID,
      content: it.content || '未命名',
      completed: false,
      createTime: now,
      updateTime: now,
      dueDate: dueMs,
      reminded: false,
      priority: it.priority || null,
      location: it.location || null,
      tags: it.tags || [],
      description: it.description || null,
      attachments: [],
      reminders: [],
      quadrant: null,
      archived: false,
      archivedAt: null,
      subtaskCount: subtasks.length,
      subtaskDoneCount: 0,
      order: now
    };
    const addRes = await db.collection(TODO_COL).add({ data: todoDoc });
    // 完整待办对象（含 _id）一并返回，前端可乐观插入、首页零延迟可见
    const fullDoc = Object.assign({}, todoDoc, { _id: addRes._id });
    // 模板子任务逐条落库
    for (let i = 0; i < subtasks.length; i++) {
      await db.collection('subtasks').add({
        data: {
          _openid: OPENID,
          todoId: addRes._id,
          content: subtasks[i],
          completed: false,
          order: now + i,
          createTime: now,
          updateTime: now
        }
      }).catch(() => null);
    }
    created.push(fullDoc);
  }
  return { success: true, count: created.length, items: created };
}

exports.main = async (event) => {
  const { action } = event || {};
  try {
    switch (action) {
      case 'list':   return await list();
      case 'save':   return await save(event);
      case 'delete': return await remove(event);
      case 'apply':  return await apply(event);
      case 'seed':   return await seed();
      default:       return { success: false, error: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[templates] error:', err);
    return { success: false, error: err.message || String(err) };
  }
};