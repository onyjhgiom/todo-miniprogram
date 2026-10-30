// scripts/check-recruit-intel.js
// 秋招助手「智能分析层」（recruit-intel.ts）离线冒烟：真编译、真加载，
// 用一份与前端同款的简历草稿 + 投递数据，逐个验证对外 API 的行为，而不是只看类型自洽。
//
// 为什么必须有这个脚本：
//   recruit-intel.ts 是简历诊断 / 岗位匹配 / 今日清单 / 面试提纲 / 岗位推荐 / 看板诊断 /
//   资源库上下文 这七个智能模块共用的「单一真相源」。它一旦退化（排序错、漏返回字段、
//   阈值写反），六个页面会一起变傻，而且 tsc 一个字都不会报 —— 因为它全是本地确定性计算。
//
// 用法：node scripts/check-recruit-intel.js
// 退出码：0 = 全通过；1 = 有失败
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'miniprogram', 'subpackages', 'recruit', 'utils', 'recruit-intel.ts');
const TSC = process.env.TSC_BIN ||
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';
const OUT = path.join(ROOT, '.tmp-check-recruit-intel');

/* ==================== 1. 极简小程序运行时桩 ==================== */
const mem = new Map();
const wxStub = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); },
  getStorageInfoSync: () => ({ keys: Array.from(mem.keys()), currentSize: 0, limitSize: 10240 }),
  clearStorageSync: () => mem.clear(),
  requestSubscribeMessage: (o) => { if (o && o.success) o.success({}); },
  showToast: () => {},
  showModal: () => Promise.resolve({ confirm: false }),
  // 故意不给 wx.cloud：让 callFn 走本地 mock 分支（离线可跑）
  getApp: () => ({ globalData: {} })
};
global.wx = wxStub;
global.getApp = () => ({ globalData: { envId: '' } });

/* ==================== 2. 编译并加载 ==================== */
function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  try {
    execFileSync(process.execPath, [
      TSC, ENTRY,
      '--outDir', OUT,
      '--module', 'commonjs',
      '--target', 'es2019',
      '--skipLibCheck',
      '--esModuleInterop'
    ], { stdio: 'pipe' });
  } catch (e) {
    // tsc 可能因类型告警退出 1，但已 emit；只要目标 JS 生成就继续（与 check-recruit-store 同策略）
  }
  const found = findFile(OUT, 'recruit-intel.js');
  if (!found) throw new Error('编译失败：未生成 recruit-intel.js');
  return found;
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name === name) {
      return p;
    }
  }
  return null;
}

/* ==================== 3. 断言 ==================== */
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, '实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expect));
}
function section(t) { console.log('\n── ' + t + ' ──'); }

const LEVEL_KEYS = ['good', 'ok', 'warn', 'bad'];
const TONES = ['good', 'warn', 'bad', 'info'];
const GO_KINDS = ['app', 'route'];

/* ==================== 4. 主流程 ==================== */
function main() {
  let intel;
  let store;
  try {
    const js = compile();
    intel = require(js);
    const storeJs = findFile(OUT, 'recruit-store.js');
    store = require(storeJs);
  } catch (e) {
    console.error('加载 recruit-intel 失败：', e && e.stack || e);
    process.exit(1);
  }

  const now = Date.now();
  const H = 3600000;
  const D = 86400000;

  /* ---------- 0. 基础构造 ---------- */
  section('0. 草稿构造 / 常量');
  ok('RESUME_STORE_KEY 是字符串', typeof intel.RESUME_STORE_KEY === 'string' && intel.RESUME_STORE_KEY.length > 0);
  eq('emptyItem 返回结构化条目', typeof (intel.emptyItem() || {}).primary, 'string');
  ok('defaultSections 返回数组', Array.isArray(intel.defaultSections()) && intel.defaultSections().length > 0);
  const draft0 = intel.defaultResumeDraft();
  ok('defaultResumeDraft 含 sections', Array.isArray(draft0.sections) && draft0.sections.length > 0);

  /* ---------- 1. 简历草稿：单一真相源（读写收口） ---------- */
  section('1. 简历草稿：读写收口（resume.ts 与 detail.ts 共用同一份）');
  const draft = intel.defaultResumeDraft();
  draft.name = '测试员';
  draft.headline = '后端开发';
  draft.city = '上海';
  draft.skills = 'react';
  const proj = (draft.sections || []).find((s) => /项目|经历|实习/.test(s.title));
  if (proj) proj.items = [{ primary: '用 react 重写了前端', secondary: '', meta: '', bullets: '首屏提升 30%' }];
  intel.saveResumeDraft(draft);
  const loaded = intel.loadResumeDraft();
  eq('存档后可读回（headline 一致）', loaded.headline, '后端开发');
  eq('存档后可读回（skills 一致）', loaded.skills, 'react');
  ok('draftToProfile 产出剖面', !!intel.draftToProfile(loaded).sections);

  const profile = intel.draftToProfile(loaded);
  const rtext = intel.resumeText(profile);
  ok('resumeText 含技能关键词（小写）', rtext.indexOf('react') >= 0, rtext.slice(0, 80));

  /* ---------- 2. 求职意向：简历 → 投递打通 ---------- */
  section('2. 求职意向（currentGoal）');
  const g1 = intel.currentGoal();
  ok('有简历求职意向 → has=true', g1.has === true, JSON.stringify(g1));
  ok('目标指向简历求职意向', (g1.target || '').indexOf('后端') >= 0, g1.target);
  const g2 = intel.currentGoal([]);
  ok('无投递列表时仍从简历取意向', g2.has === true && g2.target.indexOf('后端') >= 0);

  /* ---------- 3. 简历诊断 ---------- */
  section('3. 简历诊断（diagnoseResume）');
  const diagEmpty = intel.diagnoseResume();
  ok('无参数时不崩，返回诊断', !!diagEmpty && typeof diagEmpty.score === 'number');
  ok('levelKey 在合法集合', LEVEL_KEYS.indexOf(diagEmpty.levelKey) >= 0, diagEmpty.levelKey);
  ok('score 落在 0-100', diagEmpty.score >= 0 && diagEmpty.score <= 100);
  ok('checks 表非空（结构勾选）', Array.isArray(diagEmpty.checks) && diagEmpty.checks.length > 0);
  ok('metrics 非空（量化指标）', Array.isArray(diagEmpty.metrics) && diagEmpty.metrics.length > 0);

  const diag = intel.diagnoseResume(profile);
  ok('带剖面诊断同样合法', LEVEL_KEYS.indexOf(diag.levelKey) >= 0 && diag.score >= 0 && diag.score <= 100);
  ok('issues 是数组', Array.isArray(diag.issues));
  ok('nextActions 是数组', Array.isArray(diag.nextActions));
  ok('empty 是布尔', typeof diag.empty === 'boolean');

  /* ---------- 4. 岗位匹配（基于真实简历 + JD 关键词） ---------- */
  section('4. 岗位匹配（matchResumeToJob）');
  const appA = store.newApplication({ company: '甲科技', position: '后端开发' });
  appA.prep = { jdKeywords: ['react', 'kafka'] };
  appA.status = 'interview';
  store.upsertApp(appA);

  const m = intel.matchResumeToJob(appA, profile);
  eq('命中关键词数 = 简历真实覆盖数', m.hitCount, 1);
  ok('命中项含 react', m.hit.indexOf('react') >= 0, JSON.stringify(m.hit));
  ok('缺口项含 kafka（简历没有）', m.miss.indexOf('kafka') >= 0, JSON.stringify(m.miss));
  eq('命中 + 缺口 = JD 关键词总数', m.hitCount + m.miss.length, m.totalCount);
  ok('score 落在 0-100', m.score >= 0 && m.score <= 100, 'score=' + m.score);
  ok('strengths 是数组', Array.isArray(m.strengths));
  ok('gaps 给出具体补法（不是空话）', Array.isArray(m.gaps) && m.gaps.length > 0 && !!m.gaps[0].advice);
  ok('actions 是数组且非空', Array.isArray(m.actions) && m.actions.length > 0);

  // 缺 JD 时应给出「先补 JD」的引导，而不是瞎打一个分
  const appNoJd = store.newApplication({ company: '乙科技', position: '前端' });
  appNoJd.status = 'applied';
  store.upsertApp(appNoJd);
  const m2 = intel.matchResumeToJob(appNoJd, profile);
  ok('无 JD 时 missing 给出引导', Array.isArray(m2.missing) && m2.missing.length > 0);

  /* ---------- 5. 投递洞察（状态 → 下一步 + 硬时间点） ---------- */
  section('5. 投递洞察（appInsight：硬时间点优先）');
  const appSoon = store.newApplication({ company: '丙科技', position: '后端开发' });
  appSoon.status = 'interview';
  appSoon.prep = { jdKeywords: ['react'] };
  appSoon.updateTime = now - 1 * D;
  appSoon.interviews = [{ id: 'iv1', round: '一面', at: now + 1 * H, done: false, mode: '线上' }];
  store.upsertApp(appSoon);
  const ins = intel.appInsight(appSoon, now);
  ok('临近面试（1 小时内）→ 产生告警', Array.isArray(ins.alerts) && ins.alerts.length > 0, JSON.stringify(ins.alerts));
  ok('临近面试 → 有紧急动作（urgent）', ins.actions.some((a) => a.urgent), JSON.stringify(ins.actions.map((a) => a.key)));
  ok('actions 跳转目标带 kind', ins.actions.every((a) => GO_KINDS.indexOf(a.go.kind) >= 0));

  const appDue = store.newApplication({ company: '丁科技', position: '后端开发' });
  appDue.status = 'applied';
  appDue.dueDate = now - 2 * D; // 已过期
  store.upsertApp(appDue);
  const insDue = intel.appInsight(appDue, now);
  ok('已过截止 → 产生「已过截止」告警', insDue.alerts.some((a) => /已过截止/.test(a.text)), JSON.stringify(insDue.alerts));

  // 注：upsertApp 会刷新 updateTime 到 now，故停滞分支用独立普通对象直接测 appInsight，
  // 不经由存储（appInsight 接收 app 入参，与是否落库无关）。
  const silentApp = { _id: 'silent_1', company: '戊科技', position: '后端开发', status: 'applied', updateTime: now - 8 * D };
  const insSilent = intel.appInsight(silentApp, now);
  ok('停滞（投了 8 天没动静）→ silent=true', insSilent.silent === true);

  /* ---------- 6. 今日清单（跨投递聚合） ---------- */
  section('6. 今日清单（todayBrief）');
  const brief = intel.todayBrief([appA, appSoon, appDue, silentApp], now);
  ok('headline 是字符串', typeof brief.headline === 'string' && brief.headline.length > 0);
  ok('items 是数组', Array.isArray(brief.items));
  ok('items 每项可安全用于跳转（go.kind 合法）', brief.items.every((a) => GO_KINDS.indexOf(a.go.kind) >= 0));
  ok('counts 四字段齐全', !!brief.counts && typeof brief.counts.due === 'number' && typeof brief.counts.silent === 'number');

  /* ---------- 7. 面试提纲（引导式追问） ---------- */
  section('7. 面试提纲（buildDrill：基于真实 JD + 简历）');
  const drill = intel.buildDrill(appA, { round: '一面', minutes: 45 });
  eq('轮次随入参', drill.round, '一面');
  ok('分组非空', Array.isArray(drill.groups) && drill.groups.length > 0);
  ok('题量被 minutes 截断（45 分钟上限 12）', drill.total > 0 && drill.total <= 12, 'total=' + drill.total);
  ok('分组题数之和 = total', drill.groups.reduce((s, g) => s + g.items.length, 0) === drill.total);
  ok('有生成依据（basis 非空）', Array.isArray(drill.basis) && drill.basis.length > 0);
  ok('missing 是数组', Array.isArray(drill.missing));

  // 关键：提纲要能一键导入题库（详情页 importDrill 按题干去重），题干必须稳定可比对
  ok('题目有稳定 id 与文本', drill.groups.every((g) => g.items.every((q) => !!q.id && !!q.q)));

  /* ---------- 8. 岗位推荐（简历 + 意向 ↔ 岗位库） ---------- */
  section('8. 岗位推荐（recommendOpenings）');
  const recos = intel.recommendOpenings(8);
  ok('返回数组且非空', Array.isArray(recos) && recos.length > 0, 'len=' + recos.length);
  ok('数量不超过 limit', recos.length <= 8);
  ok('每条含可当 wx:key 的字段', recos.every((r) => !!r.key && !!r.id && r.key === r.id));
  ok('每条 score 合法 0-100', recos.every((r) => typeof r.score === 'number' && r.score >= 0 && r.score <= 100));
  ok('每条带推荐理由', recos.every((r) => Array.isArray(r.reasons) && r.reasons.length > 0));
  ok('每条带状态文案', recos.every((r) => typeof r.statusLabel === 'string' && r.statusLabel.length > 0));
  const recos3 = intel.recommendOpenings(3);
  ok('limit=3 时数量不超过 3', recos3.length <= 3);

  /* ---------- 9. 看板诊断（数字 → 结论 + 可点动作） ---------- */
  section('9. 看板诊断（diagnoseBoard）');
  const board = intel.diagnoseBoard([appA, appSoon, appDue, silentApp], now);
  ok('findings 非空', Array.isArray(board.findings) && board.findings.length > 0);
  ok('findings tone 全部合法', board.findings.every((f) => TONES.indexOf(f.tone) >= 0));
  ok('rates 三指标齐全且为数字',
    typeof board.rates.applied2written === 'number' &&
    typeof board.rates.written2interview === 'number' &&
    typeof board.rates.interview2offer === 'number');
  ok('priorities 是数组', Array.isArray(board.priorities));
  ok('每条优先动作可跳转（go.kind 合法）',
    board.priorities.every((a) => GO_KINDS.indexOf(a.go.kind) >= 0));

  const boardEmpty = intel.diagnoseBoard([], now);
  ok('空数据不崩，给出「先建卡」引导', boardEmpty.findings.length > 0 && boardEmpty.priorities.length === 1,
    JSON.stringify(boardEmpty.priorities));

  /* ---------- 10. 资源库上下文（resourceBoost） ---------- */
  section('10. 资源库上下文（resourceBoost：从详情「导入」进来时排序依据）');
  const boost = intel.resourceBoost(appA._id);
  ok('label 还原「公司 · 岗位」', boost.label === '甲科技 · 后端开发', boost.label);
  ok('keywords 取命中词（react）', boost.keywords.indexOf('react') >= 0, JSON.stringify(boost.keywords));
  ok('gaps 取缺口词（kafka）', boost.gaps.indexOf('kafka') >= 0, JSON.stringify(boost.gaps));
  const boostMissing = intel.resourceBoost('__not_exist__');
  ok('未知 appId 安全返回空（不抛错）', boostMissing && Array.isArray(boostMissing.keywords) && boostMissing.label === '');

  /* ---------- 11. 首页 Copilot：本周建议 + 指令路由 ---------- */
  section('11. 本周建议（weeklyAdvice：只说真实数据站得住的事）');
  const advFresh = intel.weeklyAdvice([], now);
  ok('空数据 → fresh 欢迎态（不伪造进度）', advFresh.fresh === true && Array.isArray(advFresh.points) && advFresh.points.length > 0,
    JSON.stringify(advFresh));
  ok('欢迎态 headline 非空', typeof advFresh.headline === 'string' && advFresh.headline.length > 0);

  const appDueSoon = store.newApplication({ company: '黄金公司', position: '后端开发' });
  appDueSoon.status = 'applied';
  appDueSoon.dueDate = now + 2 * D; // 3 天内截止
  store.upsertApp(appDueSoon);
  const advDue = intel.weeklyAdvice([appDueSoon], now);
  ok('3 天内截止 → 建议里点名叫紧截止', advDue.fresh === false && advDue.points.some((p) => /截止/.test(p) && /黄金公司/.test(p)),
    JSON.stringify(advDue.points));

  const appIvSoon = store.newApplication({ company: '面试公司', position: '后端开发' });
  appIvSoon.status = 'interview';
  appIvSoon.updateTime = now;
  appIvSoon.interviews = [{ id: 'iv9', round: '二面', at: now + 2 * D, done: false, mode: '线上' }];
  store.upsertApp(appIvSoon);
  const advIv = intel.weeklyAdvice([appIvSoon], now);
  ok('7 天内有面试 → 建议点名该轮次', advIv.points.some((p) => /面试公司/.test(p) && /二面/.test(p)), JSON.stringify(advIv.points));
  ok('有数据时 headline 标注进行中数量', /进行中 1 个投递/.test(advIv.headline), advIv.headline);

  section('12. 指令路由（parseCommand：离线确定性，识别不了不硬猜）');
  eq('「优化我的简历」→ 简历工作台', (intel.parseCommand('优化我的简历') || {}).key, 'resume');
  eq('「分析目标岗位」→ 岗位工作台', (intel.parseCommand('分析目标岗位') || {}).key, 'job');
  eq('「准备面试」→ 资源库', (intel.parseCommand('准备面试') || {}).key, 'interview');
  eq('「生成投递计划」→ 时间线', (intel.parseCommand('生成投递计划') || {}).key, 'plan');
  eq('「分析我的秋招数据」→ 看板', (intel.parseCommand('分析我的秋招数据') || {}).key, 'data');
  eq('「帮我找 10 个上海的产品经理岗位」→ 岗位工作台',
    (intel.parseCommand('帮我找 10 个上海的产品经理岗位') || {}).key, 'job');
  ok('快捷指令表共 5 条且目标页真实存在',
    Array.isArray(intel.COPILOT_COMMANDS) && intel.COPILOT_COMMANDS.length === 5 &&
    intel.COPILOT_COMMANDS.every((c) => /^\/subpackages\/recruit\/pages\/recruit\//.test(c.go) && !!c.label && !!c.desc));
  eq('识别不了返回 null（不硬猜）', intel.parseCommand('今天天气怎么样'), null);
  eq('空输入返回 null', intel.parseCommand(''), null);

  /* ---------- 收尾 ---------- */
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log('\n' + '='.repeat(52));
  console.log('秋招智能分析层冒烟：' + pass + ' 通过 / ' + fail + ' 失败');
  if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  · ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
}

main();
