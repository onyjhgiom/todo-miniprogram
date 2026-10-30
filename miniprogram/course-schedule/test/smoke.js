'use strict';

/**
 * 冒烟测试：node test/smoke.js
 * 覆盖 校验器 + entries/overrides 分离 + 按周 merge + 冲突 + 撤销
 */

const path = require('path');
const ScheduleStore = require(path.join(__dirname, '../store/scheduleStore'));
const validator = require(path.join(__dirname, '../utils/validator'));
const weekRule = require(path.join(__dirname, '../utils/weekRule'));
const { applyEdit } = require(path.join(__dirname, '../store/applyEdit'));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; console.log('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

const CTX = { totalWeeks: 16, semesterStart: '2026-09-01' };

/* 第 2 轮导入的真实课表（截图识别结果） */
const ENTRIES = [
  { _id: 'e101', title: '移动应用开发', weekday: 1, startTime: '08:20', endTime: '10:00', location: '新校区博奕北401', teacher: '陈桓', weekRule: { mode: 'range', ranges: [{ start: 1, end: 12 }], weeks: [] } },
  { _id: 'e102', title: '计算机网络', weekday: 1, startTime: '14:00', endTime: '15:40', location: '新校区公共教学楼北306', teacher: '吴璨', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
  { _id: 'e103', title: '嵌入式系统与应用', weekday: 2, startTime: '08:20', endTime: '10:00', location: '新校区公共教学楼北313', teacher: '孙晖', weekRule: { mode: 'range', ranges: [{ start: 1, end: 12 }], weeks: [] } },
  { _id: 'e104', title: '操作系统', weekday: 2, startTime: '14:00', endTime: '15:40', location: '新校区公共教学楼北303', teacher: '黄孝', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
  { _id: 'e105', title: '操作系统', weekday: 3, startTime: '08:20', endTime: '10:00', location: '新校区博文南实验室二', teacher: '黄孝', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
  { _id: 'e106', title: '习思想概论', weekday: 3, startTime: '10:20', endTime: '12:00', location: '新校区公共教学楼南109', teacher: '曹崇慧', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
  { _id: 'e107', title: '移动应用开发', weekday: 4, startTime: '08:20', endTime: '10:00', location: '新校区博奕北401', teacher: '陈桓', weekRule: { mode: 'range', ranges: [{ start: 1, end: 12 }], weeks: [] } },
  { _id: 'e108', title: '嵌入式系统与应用', weekday: 5, startTime: '08:20', endTime: '10:00', location: '新校区博文南401', teacher: '陈桓', weekRule: { mode: 'range', ranges: [{ start: 1, end: 12 }], weeks: [] } },
  { _id: 'e109', title: '习思想概论', weekday: 5, startTime: '10:20', endTime: '12:00', location: '新校区公共教学楼南109', teacher: '曹崇慧', weekRule: { mode: 'odd', ranges: [], weeks: [] } },
  { _id: 'e110', title: '计算机网络', weekday: 5, startTime: '14:00', endTime: '15:40', location: '新校区博文北302', teacher: '吴璨', weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } },
];

/* 第 4 轮确认执行的 edit payload */
const EDIT_PAYLOAD = {
  request_type: 'edit',
  operations: [
    { operation: 'update_entry', target_id: 'e105', target_ids: [], changes: { weekday: 5, startTime: '14:00', endTime: '15:40', start_date: '2026-10-20', note: '第8周起改至周五' } },
    { operation: 'weekly_override', target_id: 'e108', target_ids: [], week: 6, cancelled: true },
    { operation: 'batch_update', target_id: null, target_ids: ['e102', 'e110'], changes: { location: '博文北302' } },
    { operation: 'add_entry', target_id: null, target_ids: [], changes: { title: '操作系统实验课', weekday: 1, startTime: '16:00', endTime: '17:40', weekRule: { mode: 'every', ranges: [], weeks: [] }, note: '由节次换算（7-8节）' } },
    { operation: 'batch_update', target_id: null, target_ids: ['e101', 'e103', 'e107', 'e108'], changes: { weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] } } },
  ],
  conflicts: [],
  output_candidates: [],
  confirm_note: '下午默认取5-6节14:00-15:40',
};

console.log('\n[1] weekRule 基础能力');
check('every 展开 16 周', weekRule.expandWeeks({ mode: 'every' }, 16).length === 16);
check('odd 展开为奇数周', JSON.stringify(weekRule.expandWeeks({ mode: 'odd' }, 6)) === '[1,3,5]');
check('even 展开为偶数周', JSON.stringify(weekRule.expandWeeks({ mode: 'even' }, 6)) === '[2,4,6]');
check('odd 与 even 无交集', weekRule.weekIntersects({ mode: 'odd' }, { mode: 'even' }, 16) === false);
check('odd 与 every 有交集', weekRule.weekIntersects({ mode: 'odd' }, { mode: 'every' }, 16) === true);
check('range 颠倒自动纠正', JSON.stringify(weekRule.normalizeWeekRule({ mode: 'range', ranges: [{ start: 10, end: 3 }] }, 16)) === '{"mode":"range","ranges":[{"start":3,"end":10}],"weeks":[]}');
check('range 超学期被截断', JSON.stringify(weekRule.normalizeWeekRule({ mode: 'range', ranges: [{ start: 1, end: 30 }] }, 16).ranges) === '[{"start":1,"end":16}]');

console.log('\n[2] 校验器：非法数据必须被拦下');
const badImport = validator.validateImport({
  request_type: 'import',
  entries: [
    { title: '正常课程', weekday: 1, startTime: '08:20', endTime: '10:00', weekRule: { mode: 'every' } },
    { title: '', weekday: 3, startTime: '10:00', endTime: '12:00' },
    { title: '周次越界', weekday: 9, startTime: '08:00', endTime: '09:00' },
    { title: '时间颠倒自动纠正', weekday: 2, startTime: '15:40', endTime: '14:00', weekRule: { mode: 'every' } },
  ],
}, CTX);
check('整体结构可信 ok=true', badImport.ok === true);
check('剔除 2 条非法条目', badImport.value.entries.length === 2 && badImport.rejected.length === 2, { kept: badImport.value.entries.length, rejected: badImport.rejected.length });
check('时间颠倒被纠正为 14:00-15:40', badImport.value.entries[1].startTime === '14:00' && badImport.value.entries[1].endTime === '15:40');

const badEdit = validator.validateEdit({
  request_type: 'edit',
  operations: [
    { operation: 'update_entry', target_id: 'e999', target_ids: [], changes: { location: '教302' } },
    { operation: 'weekly_override', target_id: 'e108', target_ids: [], week: 99, cancelled: true },
    { operation: 'weekly_override', target_id: 'e108', target_ids: [], week: 6, cancelled: true },
  ],
}, Object.assign({}, CTX, { validIds: ENTRIES.map((e) => e._id) }));
check('伪造的 target_id 被置空', badEdit.value.operations[0].target_id === null);
check('越界的 week 被丢弃', badEdit.value.operations[1].week === undefined);
check('合法的 weekly_override 保留', badEdit.value.operations[2].week === 6 && badEdit.value.operations[2].cancelled === true);
check('错误被记录', badEdit.errors.length >= 2, badEdit.errors);

console.log('\n[3] 存储层：entries / overrides 分离');
const store = new ScheduleStore({ storage: null, totalWeeks: 16, semesterStart: '2026-09-01' });
store.replaceAll(ENTRIES);
check('导入 10 条', store.getEntries().length === 10);
check('第8周起始日 = 2026-10-20', store.weekStart(8) === '2026-10-20', store.weekStart(8));
check('2026-10-20 属于第8周', store.weekOfDate('2026-10-20') === 8);
check('2026-09-12 属于第2周', store.weekOfDate('2026-09-12') === 2);

const vEdit = validator.validateEdit(EDIT_PAYLOAD, Object.assign({}, CTX, { validIds: store.getIds() }));
check('edit payload 校验通过', vEdit.ok === true && vEdit.errors.length === 0, vEdit.errors);

const result = applyEdit(store, vEdit.value);
check('5 个操作全部应用', result.applied.length === 5, { applied: result.applied.length, skipped: result.skipped });
check('底表仍是 11 条（10 + 新增实验课）', store.getEntries().length === 11, store.getEntries().length);
check('e105 底表未被污染（仍为周三 08:20）', (() => {
  const e = store.getEntries().find((x) => x._id === 'e105');
  return e.weekday === 3 && e.startTime === '08:20';
})());
check('生成了 1 条 from 覆盖 + 1 条 week 覆盖', store.getOverrides().length === 2, store.getOverrides().length);

console.log('\n[4] 按周 merge');
const w3 = store.getWeek(3);
check('第3周：操作系统仍在周三 08:20', w3.some((e) => e._id === 'e105' && e.weekday === 3 && e.startTime === '08:20'));
check('第3周：无周五 14:00 的操作系统', !w3.some((e) => e._id === 'e105' && e.weekday === 5));

const w8 = store.getWeek(8);
check('第8周：操作系统已移到周五 14:00', w8.some((e) => e._id === 'e105' && e.weekday === 5 && e.startTime === '14:00'));
check('第8周：新增实验课出现（周一 16:00）', w8.some((e) => e.title === '操作系统实验课' && e.weekday === 1 && e.startTime === '16:00'));

const w6 = store.getWeek(6);
check('第6周：嵌入式(e108)已停课', !w6.some((e) => e._id === 'e108'));
const w7 = store.getWeek(7);
check('第7周：嵌入式(e108)正常上课', w7.some((e) => e._id === 'e108'));
check('延长后第13-16周 e101 仍有课', store.getWeek(14).some((e) => e._id === 'e101'));
check('批量改教室生效（e102 → 博文北302）', store.getWeek(8).find((e) => e._id === 'e102').location === '博文北302');

console.log('\n[5] 冲突检测');
const conflicts = store.conflicts();
const hit = conflicts.find((c) => (c.target_id === 'e105' && c.conflict_with_id === 'e110') || (c.target_id === 'e110' && c.conflict_with_id === 'e105'));
check('检出 e105 与 e110 冲突', !!hit, conflicts);
check('冲突周次为 8-16 周', hit && hit.weeks[0] === 8 && hit.weeks[hit.weeks.length - 1] === 16, hit && hit.weeks);

console.log('\n[6] 撤销');
check('可撤销', store.canUndo() === true);
store.undo();
check('撤销后 overrides 清空', store.getOverrides().length === 0);
check('撤销后第6周 e108 恢复', store.getWeek(6).some((e) => e._id === 'e108'));
check('撤销后 e105 回到周三', store.getWeek(8).some((e) => e._id === 'e105' && e.weekday === 3));

console.log('\n[7] 本地指令解析（无 AI 兜底）');
const parser = require(path.join(__dirname, '../services/parser'));
const parseCtx = {
  totalWeeks: 16,
  currentWeek: 2,
  entries: ENTRIES,
  weekOfDate: (d) => store.weekOfDate(d),
  year: 2026,
};

const p1 = parser.localParse('第6周周五嵌入式停课', parseCtx);
check('停课：weekly_override', p1.operations[0].operation === 'weekly_override');
check('停课：命中 e108 第6周', p1.operations[0].target_id === 'e108' && p1.operations[0].week === 6 && p1.operations[0].cancelled === true, p1.operations[0]);

const p2 = parser.localParse('周三操作系统调到周五 5-6 节', parseCtx);
check('调课：命中 e105', p2.operations[0].target_id === 'e105', p2.operations[0]);
check('调课：周五 14:00-15:40', p2.operations[0].changes.weekday === 5 && p2.operations[0].changes.startTime === '14:00' && p2.operations[0].changes.endTime === '15:40');

const p3 = parser.localParse('把所有计算机网络教室改成博文北302', parseCtx);
check('批量改地点：batch_update', p3.operations[0].operation === 'batch_update');
check('批量改地点：命中 e102/e110', JSON.stringify(p3.operations[0].target_ids) === '["e102","e110"]', p3.operations[0].target_ids);
check('批量改地点：地点 = 博文北302', p3.operations[0].changes.location === '博文北302', p3.operations[0].changes);

const p4 = parser.localParse('新增周二 7-8 节 美育课程 线上 林老师', parseCtx);
check('新增：add_entry', p4.operations[0].operation === 'add_entry');
check('新增：课程名 = 美育', p4.operations[0].changes.title === '美育', p4.operations[0].changes);
check('新增：周二 16:00-17:40', p4.operations[0].changes.weekday === 2 && p4.operations[0].changes.startTime === '16:00');
check('新增：地点线上 / 教师林老师', p4.operations[0].changes.location === '线上' && p4.operations[0].changes.teacher === '林老师');

const p5 = parser.localParse('把所有习思想概论改成每周', parseCtx);
check('批量改周次：命中 e106/e109', JSON.stringify(p5.operations[0].target_ids) === '["e106","e109"]', p5.operations[0].target_ids);
check('批量改周次：mode = every', p5.operations[0].changes.weekRule.mode === 'every');

const p6 = parser.localParse('删除操作系统', parseCtx);
check('删除：命中两条操作系统', p6.operations.length === 2 && p6.operations[0].operation === 'delete_entry');

const p7 = parser.localParse('高数停课', parseCtx);
check('匹配不到 → unknown + question', p7.operations[0].operation === 'unknown' && !!p7.operations[0].question, p7.operations[0]);

const p8 = parser.localParse('嵌入式停课', parseCtx);
check('停课无周次 → 两个候选', (p8.output_candidates || []).length === 2, p8.output_candidates);

const p9 = parser.localParse('操作系统调到周五下午', parseCtx);
check('模糊时段 → 回问具体节次', p9.operations.length === 0 && /节次/.test(p9.question || ''), p9.question);

const p10 = parser.localParse('明天天气怎么样', parseCtx);
check('完全无法理解 → unknown', p10.operations[0].operation === 'unknown');

console.log('\n[就地编辑 · 字段校验]');
const ie = require(path.join(__dirname, '../utils/inlineEdit'));

let r = ie.validateInlineEdit({ title: '操作系统', teacher: '黄孝', location: '博文北302' });
check('正常输入通过', r.ok && r.value.title === '操作系统');
check('保留教师与地点', r.value.teacher === '黄孝' && r.value.location === '博文北302');

r = ie.validateInlineEdit({ title: '   ', teacher: '', location: '' });
check('课程名全空格 → 失败', !r.ok && r.field === 'title');
check('空值提示点名字段', /课程名/.test(r.message), r.message);

r = ie.validateInlineEdit({ title: '一二三四五六七八九十一二三四五六' });   // 16 字
check('课程名超 15 字 → 失败', !r.ok && r.field === 'title');
check('超长提示带上限与当前字数', /15/.test(r.message) && /16/.test(r.message), r.message);

r = ie.validateInlineEdit({ title: '操作系统', teacher: '一二三四五六七八九十一二三四五六七八九十一' });
check('教师超 20 字 → 失败', !r.ok && r.field === 'teacher');
r = ie.validateInlineEdit({ title: '操作系统', location: '一二三四五六七八九十一二三四五六七八九十一' });
check('地点超 20 字 → 失败', !r.ok && r.field === 'location');

r = ie.validateInlineEdit({ title: '  操作系统  ', teacher: '', location: '  ' });
check('首尾空格被 trim', r.ok && r.value.title === '操作系统');
check('空教师 / 空地点 → null（不是空串）', r.value.teacher === null && r.value.location === null);

const base = { title: 'a', teacher: '', location: '' };
check('未改动 → isDirty false', ie.isDirty(base, { title: 'a', teacher: '', location: '' }) === false);
check('改了课程名 → isDirty true', ie.isDirty({ title: 'b', teacher: '', location: '' }, base) === true);
check('仅首尾空格差异 → 不算改动', ie.isDirty({ title: ' a ', teacher: '', location: '' }, base) === false);
check('清空地点也算改动', ie.isDirty({ title: 'a', teacher: '', location: '' }, { title: 'a', teacher: '', location: 'x' }) === true);

const d0 = ie.draftFromEntry({ title: '操作系统', teacher: null });
check('draftFromEntry：null → 空串', d0.title === '操作系统' && d0.teacher === '');
check('字段顺序：课程名在首位', ie.FIELDS[0].key === 'title');

console.log('\n[就地编辑 · 写入数据源]');

function newStore(entries, overrides) {
  const s = new ScheduleStore({ totalWeeks: 16, semesterStart: '2026-09-01' });
  s.state.entries = JSON.parse(JSON.stringify(entries));
  s.state.overrides = overrides ? JSON.parse(JSON.stringify(overrides)) : [];
  return s;
}

const ONE = [{
  _id: 'e1', title: '操作系统', weekday: 1, startTime: '08:00', endTime: '09:40',
  location: 'A101', teacher: '黄孝',
  weekRule: { mode: 'range', ranges: [{ start: 1, end: 16 }], weeks: [] },
}];

// ① 无覆盖 → 改底表，整学期生效
let s1 = newStore(ONE);
let tgt = s1.applyEntryEditForWeek('e1', 3, { title: '编译原理', teacher: '李', location: 'B202' });
check('无 override → 落到底表', tgt.type === 'entry');
check('底表已改', s1.getEntries()[0].title === '编译原理');
check('任意周都生效', s1.getWeek(5)[0].title === '编译原理');
check('撤销可回滚', s1.undo() && s1.getEntries()[0].title === '操作系统');

// ② 本周有 override → 只改这一周，底表不动
let s2 = newStore(ONE, [{ _id: 'o1', entryId: 'e1', kind: 'week', week: 6, changes: { location: '临时教室' } }]);
tgt = s2.applyEntryEditForWeek('e1', 6, { title: '本周改的名' });
check('本周 override → 落到 override', tgt.type === 'week');
check('底表未被污染', s2.getEntries()[0].title === '操作系统');
check('第 6 周看到新值', s2.getWeek(6)[0].title === '本周改的名');
check('第 6 周原有 override 字段仍在', s2.getWeek(6)[0].location === '临时教室');
check('第 7 周不受影响', s2.getWeek(7)[0].title === '操作系统');

// ③ 「从第 N 周起」的 override
let s3 = newStore(ONE, [{ _id: 'o2', entryId: 'e1', kind: 'from', fromWeek: 8, changes: { location: '新楼' } }]);
tgt = s3.applyEntryEditForWeek('e1', 10, { title: '八周后改的名' });
check('from override → 落到 from', tgt.type === 'from');
check('第 10 周生效', s3.getWeek(10)[0].title === '八周后改的名');
check('第 5 周（早于 fromWeek）不受影响', s3.getWeek(5)[0].title === '操作系统');
check('from override 原字段保留', s3.getWeek(10)[0].location === '新楼');

// ④ 条目不存在
const s4 = newStore(ONE);
check('条目不存在 → 返回 null 而不是报错', s4.applyEntryEditForWeek('nope', 1, { title: 'x' }) === null);

/* ══════════ 时间轴行：起止时间 ══════════ */
console.log('\n【时间轴行 buildRows】');
const { buildRows, SLOTS } = require(path.join(__dirname, '../utils/slots'));

// ① 预设节次：即便课表为空，也要有完整的起止时间
const rowsEmpty = buildRows([]);
check('无课时仍有 5 个预设节次行', rowsEmpty.length === SLOTS.length);
check('预设行带 end', rowsEmpty.every((r) => !!r.end));
check('第 1 行 08:20-10:00', rowsEmpty[0].start === '08:20' && rowsEmpty[0].end === '10:00', rowsEmpty[0]);
check('预设行 label 是节次名', rowsEmpty[0].label === '1-2节');
check('按开始时间升序', rowsEmpty.every((r, i) => i === 0 || rowsEmpty[i - 1].start <= r.start));

// ② 连排课（命不中预设节次）追加为独立行，且带真实结束时间
const rows = buildRows([
  { _id: 'x1', weekday: 1, startTime: '10:20', endTime: '14:00', title: '连排实验' },
]);
check('连排课不丢（仍为 5 个预设 + 0，10:20 命中预设）', rows.length === 5, rows.map((r) => r.start));

const rows2 = buildRows([
  { _id: 'x2', weekday: 1, startTime: '13:00', endTime: '17:00', title: '连排实验' },
]);
check('非预设开始时间 → 追加独立行', rows2.length === 6);
const extra = rows2.find((r) => r.start === '13:00');
check('追加行带 end', extra && extra.end === '17:00', extra);
check('追加行按时间排在第 3 位（13:00 在 10:20 与 14:00 之间）', rows2[2].start === '13:00', rows2.map((r) => r.start));

// ③ 同一开始时间多条课程 → 结束时间取最晚的一条
const rows3 = buildRows([
  { _id: 'y1', weekday: 1, startTime: '13:00', endTime: '15:00', title: 'A' },
  { _id: 'y2', weekday: 2, startTime: '13:00', endTime: '17:30', title: 'B' },
]);
const extra3 = rows3.find((r) => r.start === '13:00');
check('同起点多课程 → end 取最晚', extra3 && extra3.end === '17:30', extra3);

// ④ 结束时间缺失 → end 为空串，页面据此不显示（不会渲染成 13:00/13:00）
const rows4 = buildRows([{ _id: 'z1', weekday: 1, startTime: '13:00', title: '无结束时间' }]);
const extra4 = rows4.find((r) => r.start === '13:00');
check('缺 endTime → end 为空串', extra4 && extra4.end === '', extra4);

console.log('\n————————————————————————');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
