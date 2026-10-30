// scripts/check-recruit-store.js
// 秋招助手「数据层」离线冒烟：真加载 recruit-store.ts（tsc 编译后 require），
// 验证面试安排 / 提醒计划 / 待办同步 / 收藏关注 / 派生统计这一整条链路。
//
// 为什么必须有这个脚本：
//   tsc 只能保证类型自洽，保证不了「点了真的有反应」。秋招模块历史上翻过的车
//   （remindAt 只写不读、JD 不回显、点击无反馈）全都是类型正确、行为死掉。
//
// 用法：node scripts/check-recruit-store.js
// 退出码：0 = 全通过；1 = 有失败
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'miniprogram', 'subpackages', 'recruit', 'utils', 'recruit-store.ts');
const TSC = process.env.TSC_BIN ||
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';
const OUT = path.join(ROOT, '.tmp-check-recruit-store');

/* ==================== 1. 极简小程序运行时桩 ==================== */

/** 内存版 wx 存储（分片、命名空间都只是往这里塞 key） */
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
  // 故意不给 wx.cloud：走「云端未就绪」分支 → callFn 降级到本地 mock（离线可跑）
  getApp: () => ({ globalData: {} })
};
global.wx = wxStub;
global.getApp = () => ({ globalData: { envId: '' } });

/* ==================== 2. 编译并加载 ==================== */

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(process.execPath, [
    TSC, ENTRY,
    '--outDir', OUT,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
    '--esModuleInterop'
  ], { stdio: 'pipe' });

  const found = findFile(OUT, 'recruit-store.js');
  if (!found) throw new Error('编译失败：未生成 recruit-store.js');
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

/* ==================== 4. 主流程 ==================== */

async function main() {
  let S;
  try {
    S = require(compile());
  } catch (e) {
    console.error('加载 recruit-store 失败：', e && e.stack || e);
    process.exit(1);
  }
  const now = Date.now();
  const H = 3600000;
  const D = 86400000;
  // 与前端同一条取数路径（callFn → 云未就绪则降级本地 mock）
  const cloud = require(findFile(OUT, 'cloud.js'));

  /* ---------- 面试安排 ---------- */
  section('1. 面试安排（增删改 / 派生）');
  const app = S.newApplication({ company: '示例科技', position: '后端开发' });
  S.upsertApp(app);
  ok('新建投递默认带 interviews 空数组（不是 undefined）', Array.isArray(app.interviews), '实际 ' + typeof app.interviews);
  eq('新建投递默认 remindAt 为空', app.remindAt.length, 0);

  const iv1 = S.addInterview(app._id, { round: '一面', mode: '线上', at: now + 2 * H, place: '腾讯会议 123' });
  ok('新增面试返回对象', !!(iv1 && iv1.id));
  const iv2 = S.addInterview(app._id, { round: '二面', mode: '现场', at: now + 26 * H, place: 'A 座 12F' });
  const reload = () => S.getAppById(app._id);
  eq('面试写入后能读回', S.getInterviews(reload()).length, 2);

  // 故意倒序写入，验证按时间升序排序
  const iv0 = S.addInterview(app._id, { round: 'HR面', mode: '电话', at: now + 50 * H });
  const sorted = S.getInterviews(reload()).map((x) => x.at);
  ok('面试按时间升序返回', sorted[0] <= sorted[1] && sorted[1] <= sorted[2], JSON.stringify(sorted));

  eq('nextInterview 取最近一轮', (S.nextInterview(reload()) || {}).id, iv1.id);

  S.updateInterview(app._id, iv1.id, { round: '一面（改）', note: '带作品集' });
  const after = S.getInterviews(reload()).find((x) => x.id === iv1.id);
  eq('改轮次生效', after.round, '一面（改）');
  eq('改备注生效', after.note, '带作品集');

  const vo = S.interviewVO(after, now);
  ok('countdown 有文案', !!vo.countdown, vo.countdown);
  eq('modeKey 映射线上', vo.modeKey, 'online');
  eq('未知形式回退 tbd', S.interviewVO(Object.assign({}, after, { mode: '别的' }), now).modeKey, 'tbd');

  /* ---------- 提醒计划 ---------- */
  section('2. 提醒计划（截止 + 面试）');
  let plan = S.reminderPlan(reload());
  eq('3 轮面试 → 3 个「提前 30 分钟」提醒', plan.length, 3);
  ok('每轮面试取 at-30min', plan.indexOf(iv1.at ? iv1.at - 30 * 60000 : -1) >= 0 ||
    plan.some((t) => Math.abs(t - (now + 2 * H - 30 * 60000)) < 1000), JSON.stringify(plan));
  ok('提醒时间升序', plan.every((t, i) => i === 0 || plan[i - 1] <= t), JSON.stringify(plan));

  S.toggleInterviewDone(app._id, iv2.id);
  plan = S.reminderPlan(reload());
  eq('已结束的面试不再提醒', plan.length, 2);

  const pa = S.getAppById(app._id);
  pa.remindAt = [now + 3 * H, now - 5 * H]; // 一个未来、一个已过（且在 1 小时容差外）
  S.upsertApp(pa);
  plan = S.reminderPlan(S.getAppById(app._id));
  eq('过期的 remindAt 被过滤', plan.length, 3, JSON.stringify(plan));

  /* ---------- 默认提醒时点 ---------- */
  section('2b. 默认提醒时点（改截止日会重排）');
  const due = new Date(now);
  due.setHours(23, 59, 0, 0);
  const dueTs = due.getTime() + 5 * D;
  const dr = S.defaultRemindAt(dueTs, now);
  eq('默认两个时点', dr.length, 2, JSON.stringify(dr));
  ok('含「前 3 小时」', dr.some((t) => t === dueTs - 3 * H), JSON.stringify(dr));
  const its = new Date(dr[0]);
  eq('另一条落在前一天 09:00', its.getHours() === 9 && its.getMinutes() === 0, true);
  eq('过去的截止日不再排提醒', S.defaultRemindAt(now - 10 * D, now).length, 0);
  eq('无截止日则无提醒', S.defaultRemindAt(null, now).length, 0);

  /* ---------- 待办同步（提醒真正能被触发的唯一通道） ---------- */
  section('3. 同步到主待办（reminders 落库）');
  const cur = S.getAppById(app._id);
  cur.dueDate = now + 3 * D;
  S.upsertApp(cur);

  const tid = await S.syncToTodo(S.getAppById(app._id));
  ok('syncToTodo 返回待办 id', !!tid, String(tid));

  const listed = await callTodos();
  const todo = listed.find((t) => t._id === tid);
  ok('待办已落库', !!todo);
  ok('待办标题含公司名与岗位', /示例科技/.test(todo.content) && /后端开发/.test(todo.content), todo.content);
  ok('待办带秋招标签', Array.isArray(todo.tags) && todo.tags.indexOf('秋招') >= 0, JSON.stringify(todo.tags));
  eq('待办截止日与投递一致', todo.dueDate, cur.dueDate);

  const want = S.reminderPlan(S.getAppById(app._id)).length;
  ok('待办写入了 reminders（这是提醒能弹的前提）', Array.isArray(todo.reminders) && todo.reminders.length === want,
    'reminders=' + JSON.stringify(todo.reminders && todo.reminders.length) + '，期望 ' + want);
  const rm = (todo.reminders || [])[0] || {};
  ok('reminder 结构完整（id/at/repeat/sent/method）',
    !!rm.id && typeof rm.at === 'number' && rm.repeat === 'none' && rm.sent === false && !!rm.method,
    JSON.stringify(rm));
  eq('未授权时 subscribed=false（避免调度器静默跳过）', rm.subscribed, false);

  // 再同步一次：应复用同一待办（update），不新增。
  // 这条曾经是死的：update 只回 { success:true } 不带 id，早先的实现据此返回 null，
  // 界面会误报「云未就绪，已本地保存」。
  const tid2 = await S.syncToTodo(S.getAppById(app._id));
  eq('二次同步复用同一待办（不是 null）', tid2, tid);
  const listed2 = await callTodos();
  eq('待办没有重复新增', listed2.length, listed.length);

  // 新增一轮面试 → 再同步，reminders 应变多
  S.addInterview(app._id, { round: '三面', mode: '线上', at: now + 80 * H });
  await S.syncToTodo(S.getAppById(app._id));
  const todo3 = (await callTodos()).find((t) => t._id === tid);
  eq('面试增加后 reminders 同步增加', todo3.reminders.length, want + 1,
    'reminders=' + todo3.reminders.length);

  // 用户在主列表里把待办删了 → 再点同步必须能自愈新建，而不是永远失败
  await cloud.callFn('todos', { action: 'delete', id: tid });
  const revived = await S.syncToTodo(S.getAppById(app._id));
  ok('待办被删后同步能自愈新建', !!revived && revived !== tid, '返回 ' + String(revived));
  ok('自愈后 linkedTodoId 已更新', S.getAppById(app._id).linkedTodoId === revived,
    String(S.getAppById(app._id).linkedTodoId));

  /* ---------- 关闭提醒 ---------- */
  section('4. 关闭提醒清空待办 reminders');
  const liveId = S.getAppById(app._id).linkedTodoId;
  const cleared = await S.clearTodoReminders({ _id: app._id, linkedTodoId: liveId });
  eq('clearTodoReminders 返回成功', cleared, true);
  const todo4 = (await callTodos()).find((t) => t._id === liveId);
  eq('待办 reminders 已清空', (todo4.reminders || []).length, 0, JSON.stringify(todo4.reminders));

  /* ---------- 本地兜底提醒 ---------- */
  section('5. 本地兜底提醒（去重 + 宽限）');
  const b = S.newApplication({ company: '兜底公司', position: '前端' });
  b.remindAt = [now - 2000];
  S.upsertApp(b);
  const notices1 = S.collectDueRecruitNotices();
  eq('刚过期的提醒被挑出', notices1.length, 1, JSON.stringify(notices1));
  ok('通知带公司名与提醒类型（页面按「公司 + 标题」拼文案）',
    (notices1[0] || {}).company === '兜底公司' && /截止提醒/.test((notices1[0] || {}).title || ''),
    JSON.stringify(notices1[0]));
  const notices2 = S.collectDueRecruitNotices();
  eq('同一提醒不重复弹', notices2.length, 0);

  const c = S.newApplication({ company: '古老公司' });
  c.remindAt = [now - 30 * D]; // 远超 12 小时宽限
  S.upsertApp(c);
  const notices3 = S.collectDueRecruitNotices();
  eq('超过宽限期不再翻旧账', notices3.length, 0);

  /* ---------- 收藏 / 关注 ---------- */
  section('6. 资源收藏与岗位关注');
  eq('初始无收藏', S.loadFavResources().length, 0);
  eq('收藏返回 true', S.toggleFavResource('res_1'), true);
  eq('isFavResource 命中', S.isFavResource('res_1'), true);
  eq('收藏列表含该 id', S.loadFavResources().indexOf('res_1') >= 0, true);
  eq('取消收藏返回 false', S.toggleFavResource('res_1'), false);
  eq('取消后不在列表', S.loadFavResources().length, 0);
  S.toggleFavResource('res_1'); S.toggleFavResource('res_2');
  eq('多收藏去重保序', S.loadFavResources().join(','), 'res_1,res_2');
  S.clearFavResources();
  eq('清空收藏', S.loadFavResources().length, 0);

  eq('初始无关注', S.loadFollowedOpenings().length, 0);
  eq('关注返回 true', S.toggleFollowOpening('op_1'), true);
  eq('isFollowedOpening 命中', S.isFollowedOpening('op_1'), true);
  eq('取消关注返回 false', S.toggleFollowOpening('op_1'), false);

  /* ---------- 状态流转与派生 ---------- */
  section('7. 状态流转 / 面试议程 / 概览');
  const d = S.newApplication({ company: '状态公司', position: '算法' });
  S.upsertApp(d);
  S.setStatus(d._id, 'interview');
  const dd = S.getAppById(d._id);
  ok('转面试自动挂载准备清单', (dd.checklist || []).length > 0, '清单 ' + (dd.checklist || []).length + ' 项');
  ok('转面试写入进度时间线', S.getHistory(dd).length >= 1, JSON.stringify(S.getHistory(dd)));

  const agenda = S.interviewAgenda(7, S.loadApps(), now);
  ok('面试议程升序', agenda.every((x, i) => i === 0 || agenda[i - 1].at <= x.at));
  ok('议程项字段完整', agenda.every((x) => !!x.key && !!x.dayKey && !!x.timeText && !!x.countdown && !!x.round),
    JSON.stringify(agenda[0] || null));
  // wx:key 重复会让同一条投递的多轮面试在列表里错位/丢项
  eq('议程 key 唯一（可安全用于 wx:key）', new Set(agenda.map((x) => x.key)).size, agenda.length);
  ok('7 天窗口内不含 50 小时后的面试以外项', agenda.every((x) => x.at <= now + 7 * D));

  const ov = S.overview(S.loadApps());
  ok('概览 total 是数字', typeof ov.total === 'number' && ov.total >= 4, JSON.stringify(ov));
  ok('offerRate 落在 0-100', ov.offerRate >= 0 && ov.offerRate <= 100, String(ov.offerRate));
  ok('weeklyTrend 不炸', !!S.weeklyTrend(6, S.loadApps()).buckets.length);
  ok('funnelStats 不炸', !!S.funnelStats(S.loadApps()).rows);
  ok('suggestions 非空', S.suggestions(S.loadApps()).length > 0);
  ok('readiness 有分数', typeof S.readiness(dd).score === 'number');

  /* ---------- 收尾 ---------- */
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log('\n' + '='.repeat(52));
  console.log('秋招数据层冒烟：' + pass + ' 通过 / ' + fail + ' 失败');
  if (failures.length) { console.log('\n失败项：'); failures.forEach((f) => console.log('  · ' + f)); }
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
}

/** 直接问本地待办库要全量（与前端同一条路径：callFn → mock 降级） */
async function callTodos() {
  const cloud = require(findFile(OUT, 'cloud.js'));
  const r = await cloud.callFn('todos', { action: 'list' });
  return (r && r.items) || [];
}

main().catch((e) => { console.error('冒烟脚本异常：', e && e.stack || e); process.exit(1); });
