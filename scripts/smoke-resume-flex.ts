// scripts/smoke-resume-flex.ts
// 简历生成模块「灵活性」冒烟测试：
//   1) 输入容错（缺失 / 多来源 / 格式不统一 / 占位符）
//   2) 内容自适应（资历 → 顺序；岗位 → 详略）
//   3) 篇幅可控 + 严禁虚构（只删不改，所有文本必须是原文子集）
// 运行：见 npm 同级命令，用 tsc 编译到 .tmp-smoke 后 node 执行（不依赖 wx 环境）。

import {
  sanitizeProfile, normalizeSectionKey, cleanContacts, cleanBullets, isPlaceholder, looksEmpty
} from '../miniprogram/subpackages/recruit/utils/resume-schema';
import { adaptProfile, inferSeniority } from '../miniprogram/subpackages/recruit/utils/resume-adapt';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

let pass = 0;
let fail = 0;
const fails: string[] = [];

function ok(cond: boolean, name: string, extra?: string): void {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' → ' + extra : '')); }
}

/* ==================== 1. 输入容错 ==================== */
console.log('\n[1] 输入容错');

// 1.1 占位符识别
ok(isPlaceholder('你的名字'), '占位：你的名字');
ok(isPlaceholder('XX 大学'), '占位：XX 大学');
ok(isPlaceholder('____'), '占位：____');
ok(isPlaceholder('（此处填写你的真实经历与量化结果）：建议写成…'), '占位：模板提示语');
ok(isPlaceholder('name@example.com'), '占位：示例邮箱');
ok(!isPlaceholder('腾讯科技有限公司'), '非占位：真实公司名不被误杀');
ok(!isPlaceholder('无纸化办公流程改造'), '非占位：含「无」的正常表述不被误杀');
ok(looksEmpty('   '), '空白视为空');

// 1.2 多来源 key 归一
ok(normalizeSectionKey('education', '学历') === 'edu', 'key 归一：education → edu');
ok(normalizeSectionKey('项目', '项目经历') === 'proj', 'key 归一：项目 → proj');
ok(normalizeSectionKey('weird', '开源贡献') === 'custom', '未知 key 归一为 custom（不丢模块）');
ok(normalizeSectionKey('work', '工作经历') === 'work', 'key 归一：work → work');

// 1.3 联系方式多格式
const cs = cleanContacts('电话：138-0000-0000\n邮箱 a@b.com，上海 | 微信 wxid');
ok(cs.length === 4, '联系方式：多分隔符拆分', JSON.stringify(cs));
ok(cs.indexOf('138-0000-0000') >= 0, '联系方式：去掉「电话：」标签前缀');
ok(cs.indexOf('a@b.com') >= 0, '联系方式：去掉「邮箱 」标签前缀');

// 1.4 bullets 清洗
const bs = cleanBullets('• 负责订单系统重构\n- 优化库存扣减\n1. 压测 QPS 提升\n\n重复内容\n重复内容');
ok(bs.length === 4, 'bullets：去符号 + 去空行 + 去重', JSON.stringify(bs));
ok(bs[0] === '负责订单系统重构', 'bullets：• 前缀已剥离');

// 1.5 整体清洗：占位与空壳
const dirty: Any = {
  name: '你的名字',
  headline: 'XX',
  expectedSalary: '面议',
  expectedCity: 'XX',
  contacts: ['138-0000-0000'],
  sections: [
    { key: 'edu', title: '', items: [{ primary: 'XX 大学', secondary: '', meta: '', bullets: ['____'] }] },
    { key: 'award', title: '荣誉奖项', items: [{ primary: '', secondary: '', meta: '', bullets: [] }] },
    { key: 'proj', title: '', items: [{ primary: '订单系统重构', meta: '2026.03 - 2026.06', bullets: ['引入本地消息表保证一致', 'QPS 提升'] }] },
    { key: 'skill', title: '技能与证书', text: '____' }
  ]
};
const cleaned = sanitizeProfile(dirty);
ok(cleaned.name === '', '清洗：占位姓名被剔除（不会印成「你的名字」）');
ok(cleaned.headline === '', '清洗：占位求职意向被剔除');
ok(cleaned.expectedCity === '', '清洗：占位城市被剔除');
ok(cleaned.expectedSalary === '面议', '清洗：合法值「面议」保留');
ok(cleaned.sections.length === 1, '清洗：占位段 + 空壳段 + 占位技能段全部剔除', JSON.stringify(cleaned.sections.map((s: Any) => s.key)));
ok(cleaned.sections[0].title === '项目经历', '清洗：空标题用注册表默认标题兜底');

/* ==================== 2. 内容自适应 ==================== */
console.log('\n[2] 内容自适应');

const eduSec: Any = { key: 'edu', title: '教育背景', items: [{ primary: '某大学', secondary: '计算机 / 本科', meta: '2023.09 - 2027.06', bullets: ['GPA 3.7'] }] };

// 2.1 资历判定
const freshP: Any = { name: '张三', headline: '', contacts: [], sections: [eduSec,
  { key: 'intern', title: '实习经历', items: [{ primary: 'A 公司', meta: '2026.03 - 2026.08', bullets: ['做了 X'] }] }] };
ok(inferSeniority(freshP) === 'fresh', '资历：在校 + 实习 → fresh');

const seniorP: Any = { name: '李四', headline: '', contacts: [], sections: [eduSec,
  { key: 'work', title: '工作经历', items: [
    { primary: 'B 公司', meta: '2018.07 - 2022.03', bullets: ['做了 A'] },
    { primary: 'C 公司', meta: '2022.04 - 2026.09', bullets: ['做了 B'] }
  ] },
  { key: 'proj', title: '项目经历', items: [{ primary: 'P1', meta: '2024.01 - 2024.06', bullets: ['做了 C'] }] }] };
ok(inferSeniority(seniorP) === 'experienced', '资历：多段全职 + 长跨度 → experienced');

// 2.2 顺序自适应：应届教育在前，资深教育在后
const aFresh = adaptProfile(sanitizeProfile(freshP), { target: '', keywords: [], has: false });
ok(aFresh.profile.sections[0].key === 'edu', '顺序：应届 → 教育背景排最前');

const aSenior = adaptProfile(sanitizeProfile(seniorP), { target: '', keywords: [], has: false });
const seniorOrder = aSenior.profile.sections.map((s: Any) => s.key);
ok(seniorOrder[0] === 'work', '顺序：资深 → 工作经历排最前', JSON.stringify(seniorOrder));
ok(seniorOrder.indexOf('edu') > seniorOrder.indexOf('proj'), '顺序：资深 → 教育退到项目之后');

// 2.3 详略自适应：按 JD 关键词裁剪不相关经历
const five = ['要点一', '要点二', '要点三', '要点四', '要点五'];
const mixP: Any = { name: '王五', headline: '应聘后端开发', contacts: [], sections: [
  eduSec,
  { key: 'intern', title: '实习经历', items: [
    { primary: 'Java 后端实习', meta: '2026.03 - 2026.08',
      bullets: ['用 Java + Redis 重构缓存', 'Kafka 削峰填谷', 'MySQL 索引优化', 'Spring Boot 接口开发', '第五条'] },
    { primary: '线下活动志愿者', meta: '2025.07 - 2025.08',
      bullets: ['布置场地', '引导嘉宾', '发放物资', '整理物料', '第五件'] }
  ] }
]};
const ctx = { target: '后端开发', keywords: ['Java', 'Redis', 'Kafka'], has: true };
const aMix = adaptProfile(sanitizeProfile(mixP), ctx);
const items = aMix.profile.sections.find((s: Any) => s.key === 'intern')!.items;
ok((items[0].bullets || []).length === 4, '详略：相关经历保留 4 条要点', String((items[0].bullets || []).length));
ok((items[1].bullets || []).length === 2, '详略：不相关经历压到 2 条要点', String((items[1].bullets || []).length));
ok(aMix.notes.length > 0, '自适应：产出可读的过程说明', JSON.stringify(aMix.notes));

// 2.4 无岗位上下文时不裁剪（避免误伤）
const aNoCtx = adaptProfile(sanitizeProfile(mixP), { target: '', keywords: [], has: false });
const items2 = aNoCtx.profile.sections.find((s: Any) => s.key === 'intern')!.items;
ok((items2[1].bullets || []).length === 5, '保守：无岗位上下文时不做相关性裁剪');

/* ==================== 3. 篇幅可控 + 严禁虚构 ==================== */
console.log('\n[3] 篇幅可控与严禁虚构');

// 3.1 篇幅预算：超量经历被压到预算内
const many: Any = { name: '赵六', headline: '', contacts: [], sections: [eduSec] };
for (let i = 0; i < 8; i++) {
  many.sections.push({ key: 'proj', title: '项目经历', items: [{ primary: '项目' + i, meta: '2026.0' + (i % 9 + 1), bullets: five.slice() }] });
}
const aMany = adaptProfile(sanitizeProfile(many), { target: '后端开发', keywords: ['Java'], has: true });
let total = 0;
for (const s of aMany.profile.sections) for (const it of (s.items || [])) total += (it.bullets || []).length;
ok(total <= 22, '篇幅：要点总数压到预算内（<=22）', String(total));

// 3.2 严禁虚构：输出文本必须是原文子集，且不新增字段
const original: string[] = [];
for (const s of mixP.sections) for (const it of (s.items || [])) (it.bullets || []).forEach((b: string) => original.push(b));
const produced: string[] = [];
for (const s of aMix.profile.sections) for (const it of (s.items || [])) (it.bullets || []).forEach((b: string) => produced.push(b));
ok(produced.every((b) => original.indexOf(b) >= 0), '严禁虚构：所有输出要点都来自用户原文（无新增文字）');
ok(produced.length <= original.length, '严禁虚构：只删不增');

// 3.3 头部中性兜底：无求职意向时用目标岗位补全（取用户自己的输入，非编造）
const noHead: Any = { name: '孙七', headline: '', contacts: [], sections: [eduSec] };
const aHead = adaptProfile(sanitizeProfile(noHead), { target: '数据分析师', keywords: [], has: true });
ok(aHead.profile.headline === '应聘数据分析师', '中性兜底：求职意向按目标岗位补全', aHead.profile.headline);

// 3.4 无意向时不硬补
const aHead2 = adaptProfile(sanitizeProfile(noHead), { target: '', keywords: [], has: false });
ok(!aHead2.profile.headline, '保守：没有目标岗位时不硬造求职意向');

/* ==================== 汇总 ==================== */
console.log('\n================ 汇总 ================');
console.log(`PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log('失败项：');
  fails.forEach((f) => console.log('  - ' + f));
  const p = (globalThis as Any).process;
  if (p && p.exit) p.exit(1);
}
console.log('全部通过');
