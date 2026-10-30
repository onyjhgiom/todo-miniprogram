// scripts/test-push-reminder.js
// 离线冒烟：真实加载 cloudfunctions/pushReminder/index.js（stub 掉 wx-server-sdk），
// 验证「授权 → 配额 → 推送 → 降级」整条决策链与订阅消息字段格式。
// 运行：node scripts/test-push-reminder.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'cloudfunctions', 'pushReminder', 'index.js');
const TMP = path.join(os.tmpdir(), 'pr-smoke-' + Date.now());
const OPENID = 'openid-A';
const TMPL = 'TMPL_TEST_ID';

// ---------- 内存数据库 ----------
let store = [];
let seq = 0;
let sentCalls = [];
let failNext = null;

const db = {
  collection() {
    return {
      where(cond) {
        const q = {
          limit() { return q; },
          async get() {
            const keys = Object.keys(cond);
            return { data: store.filter((r) => keys.every((k) => r[k] === cond[k])) };
          }
        };
        return q;
      },
      doc(id) {
        return {
          async update({ data }) {
            const r = store.find((x) => x._id === id);
            if (!r) throw new Error('no such doc');
            Object.assign(r, data);
            return { stats: { updated: 1 } };
          }
        };
      },
      async add({ data }) {
        const _id = 'id' + ++seq;
        store.push(Object.assign({ _id }, data));
        return { _id };
      }
    };
  }
};

const cloudStub = {
  DYNAMIC_CURRENT_ENV: 'dyn',
  init() {},
  database: () => db,
  getWXContext: () => ({ OPENID }),
  openapi: {
    subscribeMessage: {
      async send(args) {
        if (failNext) {
          const e = new Error('mock');
          e.errCode = failNext.code;
          e.errMsg = failNext.msg || String(failNext.code);
          const f = failNext;
          failNext = null;
          throw e;
        }
        sentCalls.push(args);
        return { errCode: 0 };
      }
    }
  }
};

// ---------- 用 stub 加载云函数 ----------
fs.mkdirSync(path.join(TMP, 'node_modules', 'wx-server-sdk'), { recursive: true });
fs.writeFileSync(
  path.join(TMP, 'node_modules', 'wx-server-sdk', 'index.js'),
  'module.exports = global.__CLOUD_STUB__;'
);
fs.writeFileSync(path.join(TMP, 'index.js'), fs.readFileSync(SRC, 'utf8'));
global.__CLOUD_STUB__ = cloudStub;
const fn = require(path.join(TMP, 'index.js'));

// ---------- 断言 ----------
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('PASS  ' + name + (extra ? '  ' + extra : ''));
  } else {
    fail++;
    console.log('FAIL  ' + name + (extra ? '  ' + extra : ''));
  }
}
function eq(name, got, want) {
  ok(name, got === want, '(got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')');
}
const rec = () => store[store.length - 1];

/**
 * 官方参数值限制（严格版，见订阅消息「参数值内容限制说明」）：
 *   date 类 → `YYYY-MM-DD`（也允许 `YYYY-MM-DD hh:mm:ss`，但**必须带秒**）
 *   time 类 → `HH:mm` 或 `HH:mm:ss`  ← 关键：**time 类不允许带年月日**，
 *            传 `YYYY-MM-DD HH:mm` 会直接 47003（模板参数不准确）。
 * 这里刻意用严格正则，任何「看起来能跑但格式不对」的改动都会被卡住。
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_RE = /^\d{2}:\d{2}$/;
/** time 类字段绝不允许出现「-」（带日期）或空格 —— 这是最易犯的 47003 诱因 */
const NO_DATE_IN_TIME = (v) => !/[- ]/.test(v);

/**
 * 从 todos/index.js 抽出「纯函数区」离线执行。
 * 该文件 require('wx-server-sdk')，本机加载不起来，但字段构造部分是纯函数，
 * 按标记截取后 new Function 执行即可断言（比整文件 stub 轻得多）。
 */
function extractTodosBuilder() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'cloudfunctions', 'todos', 'index.js'),
    'utf8'
  );
  const start = src.indexOf('function clip20(');
  const end = src.indexOf('async function remind(');
  if (start < 0 || end <= start) throw new Error('todos 源码标记未找到，抽取失败');
  const box = {};
  new Function(
    'box',
    src.slice(start, end) + '\nbox.build = buildReminderData; box.K = KEY_MAP;'
  )(box);
  return box;
}

(async () => {
  // 1) 未授权直接推送 → NO_QUOTA，且不得真的发出消息
  let r = await fn.main({ action: 'send', tmplId: TMPL, title: 'A', at: Date.now() });
  eq('未授权 send 返回 NO_QUOTA', r.code, 'NO_QUOTA');
  eq('未授权 send 不触达微信接口', sentCalls.length, 0);

  // 2) 首次授权 → quota = 1，且必须写入 _openid（云函数端 add 不自动写）
  r = await fn.main({ action: 'grant', tmplId: TMPL });
  ok('grant 成功', r.success === true);
  eq('grant 后 quota', r.quota, 1);
  eq('grant 写入 _openid', rec()._openid, OPENID);
  ok('grant 写入 expireAt', typeof rec().expireAt === 'number' && rec().expireAt > Date.now());

  // 3) 推送成功 → 消费 1 条配额
  const at = new Date(2026, 8, 18, 9, 30, 0).getTime();
  r = await fn.main({ action: 'send', tmplId: TMPL, title: '交房租', desc: '本月', at, page: 'pages/index/index', mpState: 'trial' });
  ok('授权后 send 成功', r.success === true);
  eq('推送后 quota 递减为 0', r.quota, 0);
  eq('实际调用微信接口 1 次', sentCalls.length, 1);

  // 4) 字段 key 与值格式（严格贴官方参数限制）
  const d = sentCalls[0].data;
  const keys = Object.keys(d).sort();
  eq('字段 key 与模板一致', keys.join(','), 'date9,thing2,time30,time38,time6');
  ok('thing2 ≤20 字符', d.thing2.value.length <= 20, '(' + d.thing2.value + ')');
  ok('thing2 含标题', d.thing2.value.indexOf('交房租') >= 0);
  ok('thing2 含备注', d.thing2.value.indexOf('本月') >= 0);
  ok('date9 为「YYYY-MM-DD」', DATE_RE.test(d.date9.value), d.date9.value);
  ok('time6 为「HH:mm」', CLOCK_RE.test(d.time6.value), d.time6.value);
  ok('time38 为「HH:mm」', CLOCK_RE.test(d.time38.value), d.time38.value);
  ok('time30 为「HH:mm」且不带年月日', CLOCK_RE.test(d.time30.value) && NO_DATE_IN_TIME(d.time30.value), d.time30.value);
  ok('全部 time 类字段都不带日期', ['time6', 'time38', 'time30'].every((k) => NO_DATE_IN_TIME(d[k].value)), JSON.stringify(d));
  ok('5 字段无空值', Object.keys(d).every((k) => !!d[k].value), JSON.stringify(d));
  ok('5 字段无 NaN/undefined', Object.keys(d).every((k) => !/NaN|undefined|null/.test(d[k].value)));
  eq('不带 due 时到期时间回落提醒时刻', d.date9.value, '2026-09-18');

  // 5) 版本选择：mpState 生效
  eq('mpState=trial 生效', sentCalls[0].miniprogramState, 'trial');

  // 6) 配额用尽 → 再推返回 NO_QUOTA
  r = await fn.main({ action: 'send', tmplId: TMPL, title: 'B', at });
  eq('配额用尽返回 NO_QUOTA', r.code, 'NO_QUOTA');
  eq('配额用尽不再触达微信接口', sentCalls.length, 1);

  // 6b) 传 due → 「到期/截止」取 due，「开始/提醒」取 at（避免 4 个时间字段全同一个值）
  const due = new Date(2026, 8, 20, 18, 0, 0).getTime();
  await fn.main({ action: 'grant', tmplId: TMPL });
  r = await fn.main({ action: 'send', tmplId: TMPL, title: '交论文', at, due });
  ok('带 due 推送成功', r.success === true);
  const dDue = sentCalls[sentCalls.length - 1].data;
  eq('date9 取 due 的日期', dDue.date9.value, '2026-09-20');
  eq('time38 取 due 的时刻', dDue.time38.value, '18:00');
  eq('time6 取 at 的时刻', dDue.time6.value, '09:30');
  eq('time30 取 at 的时刻', dDue.time30.value, '09:30');
  ok('date9 与 time38 合起来即 due 的完整时刻', dDue.date9.value + ' ' + dDue.time38.value === '2026-09-20 18:00');

  // 7) 重复授权累积配额（微信一次性订阅次数可叠加）
  await fn.main({ action: 'grant', tmplId: TMPL });
  r = await fn.main({ action: 'grant', tmplId: TMPL });
  eq('两次重复授权后 quota', r.quota, 2);
  r = await fn.main({ action: 'send', tmplId: TMPL, title: 'C', at });
  ok('累积配额可连续推送 1/2', r.success === true, 'quota=' + r.quota);
  r = await fn.main({ action: 'send', tmplId: TMPL, title: 'D', at });
  ok('累积配额可连续推送 2/2', r.success === true, 'quota=' + r.quota);
  r = await fn.main({ action: 'send', tmplId: TMPL, title: 'E', at });
  eq('超额后拒绝', r.code, 'NO_QUOTA');

  // 8) 过期 → EXPIRED 且配额清零
  await fn.main({ action: 'grant', tmplId: TMPL });
  rec().expireAt = Date.now() - 1000;
  r = await fn.main({ action: 'send', tmplId: TMPL, title: 'F', at });
  eq('过期返回 EXPIRED', r.code, 'EXPIRED');
  eq('过期后配额清零', rec().quota, 0);

  // 9) 致命错误（授权真的失效）→ 配额清零，前端据此清 subscribed
  await fn.main({ action: 'grant', tmplId: TMPL });
  failNext = { code: 43101 };
  r = await fn.main({ action: 'send', tmplId: TMPL, title: 'G', at });
  ok('43101 返回失败', r.success === false, 'code=' + r.code);
  eq('43101 后配额清零', rec().quota, 0);

  // 9b) 47003（模板参数不准确 = 我们自己的字段/长度问题）→ **必须保留配额**
  //     授权是用户亲手点的，因为我们字段配错就把它作废，用户得重新授权，且修好代码后仍发不出去。
  await fn.main({ action: 'grant', tmplId: TMPL });
  const qBefore = rec().quota;
  failNext = { code: 47003, msg: 'argument invalid! data.time30.value invalid' };
  r = await fn.main({ action: 'send', tmplId: TMPL, title: 'G2', at });
  ok('47003 返回失败', r.success === false, 'code=' + r.code);
  eq('47003 后配额保留（不清零）', rec().quota, qBefore);
  eq('47003 回传剩余配额', r.quota, qBefore);

  // 10) 非法 mpState 需过白名单回落，不能原样透传给微信；缺模板报错
  await fn.main({ action: 'grant', tmplId: TMPL });
  await fn.main({ action: 'send', tmplId: TMPL, title: 'H', at, mpState: 'hack' });
  eq('非法 mpState 回落 trial', sentCalls[sentCalls.length - 1].miniprogramState, 'trial');
  await fn.main({ action: 'grant', tmplId: TMPL });
  await fn.main({ action: 'send', tmplId: TMPL, title: 'H2', at, mpState: 'developer' });
  eq('合法 mpState=developer 原样生效', sentCalls[sentCalls.length - 1].miniprogramState, 'developer');
  r = await fn.main({ action: 'send', title: 'I', at });
  eq('缺 tmplId 报 EMPTY_TMPL', r.code, 'EMPTY_TMPL');

  // 11) 未知 action 不崩
  r = await fn.main({ action: 'nope' });
  ok('未知 action 返回失败而非抛错', r.success === false);

  // 12) todos 云函数（定时器那条路）字段构造 —— 抽取纯函数区离线执行
  const { build: buildTodos, K: K2 } = extractTodosBuilder();
  eq(
    'todos 侧 KEY_MAP 与 pushReminder 完全一致',
    JSON.stringify(K2),
    JSON.stringify({
      content: 'thing2',
      expireTime: 'date9',
      startTime: 'time6',
      endTime: 'time38',
      remindTime: 'time30'
    })
  );
  const tTodo = {
    content: '答辩材料准备',
    description: '带上纸质版',
    dueDate: new Date(2026, 8, 21, 14, 0, 0).getTime()
  };
  const tRem = { at: new Date(2026, 8, 20, 8, 0, 0).getTime() };
  const td1 = buildTodos(tTodo, tRem);
  ok('todos 5 字段齐全', Object.keys(td1).sort().join(',') === 'date9,thing2,time30,time38,time6');
  ok('todos thing2 取到备注（description 修正生效）', /带上纸质版/.test(td1.thing2.value), td1.thing2.value);
  eq('todos date9 取 dueDate 的日期', td1.date9.value, '2026-09-21');
  eq('todos time38 取 dueDate 时刻', td1.time38.value, '14:00');
  eq('todos time6 取提醒时刻', td1.time6.value, '08:00');
  eq('todos time30 取提醒时刻', td1.time30.value, '08:00');
  const td2 = buildTodos({ content: '无截止待办' }, tRem);
  eq('无 dueDate 时到期时间回落提醒时刻', td2.date9.value, '2026-09-20');
  ok('无备注时 thing2 不出现空括号', td2.thing2.value.indexOf('（') < 0, td2.thing2.value);
  ok('todos date9 为「YYYY-MM-DD」', DATE_RE.test(td1.date9.value), td1.date9.value);
  ok(
    'todos 全部 time 类字段不带年月日',
    ['time6', 'time38', 'time30'].every((k) => CLOCK_RE.test(td1[k].value) && NO_DATE_IN_TIME(td1[k].value)),
    JSON.stringify(td1)
  );
  ok(
    'todos 值格式全合规',
    Object.keys(td1).every(
      (k) => DATE_RE.test(td1[k].value) || (CLOCK_RE.test(td1[k].value) && NO_DATE_IN_TIME(td1[k].value)) || td1[k].value.length <= 20
    )
  );

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE CRASH:', e);
  process.exit(1);
});
