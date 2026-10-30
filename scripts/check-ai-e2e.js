'use strict';

/**
 * 课程表 AI 端到端实测  ——  node scripts/check-ai-e2e.js
 *
 * 与 test/ai-assist.js 的区别：
 *   ai-assist.js  只测纯逻辑与调用契约（打桩 wx.cloud），不发网络请求，进 preflight 秒过。
 *   本脚本        **加载真实的云函数源码并真的打模型接口**，验证四类意图在真实模型下
 *                 确实成立。需要联网，会消耗 token，因此**不进 preflight**。
 *
 * 加载方式：云函数顶部 require('wx-server-sdk')，Node 本地没有这个包，
 * 所以先用 Module._load 打个桩，把云函数当普通模块 require 进来 ——
 * 好处是测的就是线上那份代码，不用在脚本里再抄一遍 prompt。
 *
 * 用法：
 *   node scripts/check-ai-e2e.js            跑全部用例
 *   node scripts/check-ai-e2e.js --raw      额外打印模型原始回复
 *
 * 退出码：0 = 全部用例拿到可解析结果；1 = 有失败
 */

const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const FN_DIR = path.join(ROOT, 'cloudfunctions', 'courseScheduleAI');
const FIXTURE = path.join(ROOT, 'miniprogram', 'course-schedule', 'test', 'fixtures', 'sample-entries.js');

const SHOW_RAW = process.argv.indexOf('--raw') !== -1;

/* -------------------- 打桩 wx-server-sdk -------------------- */

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return { init: function () { }, DYNAMIC_CURRENT_ENV: 'local' };
  }
  return origLoad.apply(this, arguments);
};

// 模拟平台：给足 60 秒预算，等价控制台把超时设成了 60 秒
const CONTEXT = { getRemainingTimeInMillis: function () { return 60000; } };

const fn = require(path.join(FN_DIR, 'index.js'));
const entries = require(FIXTURE);

/* -------------------- 用例 -------------------- */

const CASES = [
  {
    name: '改课表（edit）',
    text: '把周三的操作系统调到周五 5-6 节',
    expect: function (r) { return r.intent === 'edit' && r.edit && r.edit.operations.length > 0; },
    hint: '应识别为 edit，且 operations 非空',
  },
  {
    name: '问课表（ask）',
    text: '我周三下午有课吗？',
    expect: function (r) { return r.intent !== 'edit' && r.reply.length > 0; },
    hint: '应给出文字回答，且不应产出编辑操作',
  },
  {
    name: '课表分析（analyze）',
    text: '帮我分析一下这学期的课表安排怎么样',
    expect: function (r) { return r.reply.length > 20; },
    hint: '应给出有实质内容的分析文字',
  },
  {
    name: '学习建议（study）',
    text: '给我一个期末复习计划',
    expect: function (r) { return r.reply.length > 20; },
    hint: '应给出可执行的学习计划',
  },
];

/* -------------------- 主流程 -------------------- */

(async function main() {
  console.log('');
  console.log('课程表 AI 端到端实测（加载云函数源码，真实调用模型）');
  console.log('云函数    ：' + path.relative(ROOT, FN_DIR));
  console.log('样例课表  ：' + entries.length + ' 条');
  console.log('');

  // 先 ping 探活，避免 4 个用例都撞在同一个配置错误上
  const info = await fn.main({ action: 'ping', probe: true }, CONTEXT);
  console.log('[ping] provider=' + info.provider + ' model=' + info.model +
    ' hasKey=' + info.hasKey + ' budgetMs=' + info.budgetMs +
    (info.latencyMs !== undefined ? ' latency=' + info.latencyMs + 'ms' : ''));

  if (!info.success) {
    console.error('\n✗ 云函数自检未通过：' + (info.error || '') + ' ' + (info.message || ''));
    console.error('  若提示未配置 Key：在云开发控制台给云函数 courseScheduleAI 配环境变量 AI_API_KEY；');
    console.error('  本地跑本脚本时，会用云函数源码里的 FALLBACK_API_KEY 兜底。');
    process.exit(1);
  }
  console.log('');

  const scheduleText = require(path.join(ROOT, 'miniprogram', 'course-schedule', 'services', 'scheduleAI.js'))
    ._internal.formatEntriesForPrompt(entries);

  let pass = 0;
  let fail = 0;

  for (const c of CASES) {
    const started = Date.now();
    const r = await fn.main(
      { action: 'assist', text: c.text, scheduleText: scheduleText, currentWeek: 3, totalWeeks: 16 },
      CONTEXT
    );
    const ms = Date.now() - started;

    if (!r || !r.success) {
      fail += 1;
      console.log('  ✗ ' + c.name + ' → ' + ((r && r.error) || 'EMPTY') + ' ' + ((r && r.message) || '') + ' (' + ms + 'ms)');
      continue;
    }

    const ok = c.expect(r);
    if (ok) {
      pass += 1;
      console.log('  ✓ ' + c.name + ' → intent=' + r.intent +
        (r.edit ? ' ops=' + r.edit.operations.length : '') +
        ' model=' + (r.meta && r.meta.model) + ' ' + ms + 'ms');
      if (SHOW_RAW) console.log('     回复：' + r.reply);
    } else {
      fail += 1;
      console.log('  ✗ ' + c.name + '（' + c.hint + '）');
      console.log('     实际：intent=' + r.intent + ' reply=' + JSON.stringify(String(r.reply).slice(0, 120)));
    }
  }

  console.log('');
  console.log('————————————————————————');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail === 0 ? 0 : 1);
})();
