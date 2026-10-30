'use strict';

/**
 * 小助手 AI 自检  ——  node scripts/check-helper-ai.js
 *
 * 验证对象：cloudfunctions/helperChat（小助手 AI 云函数）
 *
 * 做法：不碰真实接口。打桩 wx-server-sdk + 起一个**本地 mock 模型服务**，
 *       把 AI_API_BASE 指向它，然后 require 真实云函数并调用 main()。
 *       因此测到的是真实代码路径（提示词构建、模型候选链、ops 归一化、错误分级、多模态）。
 *
 * 用法：
 *   node scripts/check-helper-ai.js          跑离线用例（进 CI / preflight，零网络）
 *   node scripts/check-helper-ai.js --live   额外用真实 AI_API_KEY 探一次（需联网 + 消耗 token）
 *
 * 退出码：0 = 全部通过；1 = 有失败
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'cloudfunctions', 'helperChat', 'index.js');
const LIVE = process.argv.indexOf('--live') !== -1;
const BUILD_DIR = path.join(ROOT, '.tmp-helper-build');

/* -------------------- 前端 TS：编译后加载（用于测纯函数） -------------------- */

/** 找一个可用的 typescript 编译器；找不到就返回 null（此时跳过前端用例） */
function findTsc() {
  const cands = [
    process.env.TSC_JS,
    path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js'),
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'typescript', 'lib', 'tsc.js')
  ];
  for (let i = 0; i < cands.length; i++) {
    if (cands[i] && fs.existsSync(cands[i])) return cands[i];
  }
  return null;
}

/** 极简 wx 桩：cloud.ts / todo-shard.ts 顶层不干活，但保险起见给一个兜底对象 */
function makeWxStub() {
  const noop = function () { return undefined; };
  return new Proxy({}, {
    get: function (_t, k) {
      if (k === 'getStorageSync') return function () { return ''; };
      if (k === 'setStorageSync' || k === 'removeStorageSync') return noop;
      return noop;
    }
  });
}

/** 把 helper-ai.ts（及其依赖）编译成 CJS 并 require，失败返回 null */
function buildClient() {
  const tsc = findTsc();
  if (!tsc) return null;
  try { fs.rmSync(BUILD_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  try {
    execFileSync(process.execPath, [
      tsc,
      '--outDir', BUILD_DIR,
      '--module', 'commonjs',
      '--target', 'ES2018',
      '--moduleResolution', 'node',
      '--skipLibCheck',
      '--esModuleInterop',
      path.join('miniprogram', 'utils', 'helper-ai.ts')
    ], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    // 有类型错误时 tsc 退出码非 0，但通常已产出文件，继续尝试加载
  }
  const out = path.join(BUILD_DIR, 'helper-ai.js');
  if (!fs.existsSync(out)) return null;
  global.wx = global.wx || makeWxStub();
  try {
    return require(out);
  } catch (e) {
    return null;
  }
}

function cleanupBuild() {
  try { fs.rmSync(BUILD_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

/* -------------------- 现场生成测试图片（验证视觉链路） -------------------- */
// 不依赖任何外部图片源（外链随时可能失效），随手造一张「上红下蓝」的 PNG 交给模型读。

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** 生成 w×h 的 PNG：上半 topRGB、下半 bottomRGB */
function makeTestPng(w, h, topRGB, bottomRGB) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 3);
    raw[rowStart] = 0;
    const color = y < h / 2 ? topRGB : bottomRGB;
    for (let x = 0; x < w; x++) {
      const o = rowStart + 1 + x * 3;
      raw[o] = color[0]; raw[o + 1] = color[1]; raw[o + 2] = color[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* -------------------- 打桩 wx-server-sdk（本地无 node_modules） -------------------- */

const SDK_ID = 'wx-server-sdk';
const sdkMock = {
  init: function () {},
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  database: function () { return {}; },
  getWXContext: function () { return { OPENID: 'test-openid' }; }
};

/** 云函数 require('wx-server-sdk')，本地无 node_modules，这里把它替身掉 */
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === SDK_ID) return SDK_ID;
  return origResolve.apply(this, arguments);
};
require.cache[SDK_ID] = { id: SDK_ID, filename: SDK_ID, loaded: true, exports: sdkMock };

/* -------------------- 本地 mock 模型服务 -------------------- */

/** 当前响应策略：接收 (payload) 返回 { status, body } */
let handler = null;
/** 最近一次收到的请求（用于断言发出去的 payload） */
let lastReq = null;
/** 收到的全部请求（用于断言「顺延了几次」） */
let reqLog = [];

function startServer() {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      let raw = '';
      req.on('data', function (c) { raw += c; });
      req.on('end', function () {
        let payload = {};
        try { payload = JSON.parse(raw || '{}'); } catch (e) { payload = {}; }
        lastReq = { url: req.url, payload: payload, auth: req.headers.authorization || '' };
        reqLog.push(payload);
        let r;
        try {
          r = handler ? handler(payload) : okChat('默认回复');
        } catch (e) {
          r = { status: 500, body: { error: { message: String(e && e.message) } } };
        }
        const send = function () {
          try {
            res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(r.body));
          } catch (_e) { /* 客户端可能已超时断开 */ }
        };
        // handler 可带 delay（毫秒）模拟「上游很慢」，用于验证超时收敛；
        // unref 保证慢响应不会拖着脚本不退出。
        if (r.delay) setTimeout(send, r.delay).unref();
        else send();
      });
    });
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

/** 标准成功响应：content 为模型"输出"的字符串 */
function okChat(content) {
  return {
    status: 200,
    body: {
      id: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    }
  };
}

/** 标准错误响应 */
function errResp(status, code, message) {
  return { status: status, body: { error: { code: code || '', message: message || 'error' } } };
}

/* -------------------- 断言与统计 -------------------- */

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('  ✅ ' + name);
  } else {
    fail += 1;
    failures.push(name + (detail ? ' → ' + detail : ''));
    console.log('  ❌ ' + name + (detail ? ' → ' + detail : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, '实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected));
}

function section(title) {
  console.log('\n── ' + title + ' ──');
}

/* -------------------- 主流程 -------------------- */

async function main() {
  const started = await startServer();
  const base = 'http://127.0.0.1:' + started.port + '/api/paas/v4';

  const savedEnv = {
    key: process.env.AI_API_KEY,
    zhipu: process.env.ZHIPU_API_KEY,
    base: process.env.AI_API_BASE,
    provider: process.env.AI_PROVIDER,
    model: process.env.AI_MODEL,
    vision: process.env.AI_VISION_MODEL,
    thinking: process.env.AI_THINKING
  };

  process.env.AI_API_KEY = 'test-key';
  process.env.AI_API_BASE = base;
  // mock 服务在 127.0.0.1，按域名猜不出供应商 → 显式指定，走智谱候选链
  process.env.AI_PROVIDER = 'zhipu';
  delete process.env.ZHIPU_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.AI_VISION_MODEL;
  delete process.env.AI_THINKING;
  // 冷备同样指向 mock：否则主档案一旦被判为「供应商级失败」（401/402/403/404/429），
  // 代码会切到真实智谱，本脚本就变成联网用例（还白烧 token），且会把预期的错误码
  // 吞成一次真实成功响应 —— 「错误分级」那几条断言会全部拿不到 error。
  process.env.AI_BACKUP_BASE = base;
  process.env.AI_BACKUP_KEY = 'backup-test-key';
  process.env.AI_BACKUP_PROVIDER = 'zhipu';
  delete process.env.AI_BACKUP_DISABLE;

  const helper = require(FN);

  /* ============ 1. Key 优先级：环境变量 > 源码兜底 ============ */
  section('1. Key 优先级');
  delete process.env.AI_API_KEY;
  delete process.env.ZHIPU_API_KEY;
  reqLog = []; lastReq = null;
  let r = await helper.main({ message: '你好' });
  ok('未配环境变量时不报「未配置」（走源码兜底 Key）', r.error !== 'AI_NOT_CONFIGURED', 'error=' + r.error);
  ok('兜底 Key 会真实发起请求', lastReq !== null && reqLog.length === 1, 'reqLog=' + reqLog.length);
  ok('请求头带上了 Bearer 凭据', /^Bearer \S+/.test((lastReq && lastReq.auth) || ''), 'auth=' + ((lastReq && lastReq.auth) || ''));

  process.env.AI_API_KEY = 'env-key-wins';
  reqLog = []; lastReq = null;
  r = await helper.main({ message: '你好' });
  eq('环境变量覆盖兜底 Key', (lastReq && lastReq.auth) || '', 'Bearer env-key-wins');

  process.env.AI_API_KEY = 'test-key';

  /* ============ 2. 基本参数校验 ============ */
  section('2. 参数校验');
  r = await helper.main({});
  eq('空 message 返回 NO_MESSAGE', r.error, 'NO_MESSAGE');

  /* ============ 3. ping 自检 ============ */
  section('3. ping 自检');
  r = await helper.main({ action: 'ping' });
  eq('供应商识别为 zhipu', r.provider, 'zhipu');
  eq('候选链首位为 glm-4.6（实测最快且 JSON 合规）', r.candidates[0], 'glm-4.6');
  ok('候选链含 5 个模型', r.candidates.length >= 5, '实际 ' + r.candidates.length);
  eq('ping 默认不做真实调用', r.latencyMs, undefined);

  /* ============ 4. 正常对话 + ops 归一化 ============ */
  section('4. ops 归一化（含非法项过滤）');
  handler = function () {
    return okChat(JSON.stringify({
      text: '已帮你建好',
      ops: [
        { type: 'todo.add', content: '买牛奶', dueDate: '2026-9-14 15:00', priority: 'high' },
        { type: 'todo.add', content: '交电费', dueDate: '瞎写的日期', priority: '巨高' },
        { type: 'flying.kick', content: '非法类型应被丢弃' },
        { type: 'todo.add', content: '' },
        { type: 'todo.complete', match: '开会' },
        { type: 'todo.reschedule', match: '交电费', dueDate: '2026/9/20 09:00' },
        { type: 'ledger.add', amount: 32.5, category: '餐饮', note: '午饭' },
        { type: 'nav', module: 'ledger' }
      ],
      actions: [{ kind: 'nav-module', label: '💰 记账本', module: 'ledger' }]
    }));
  };
  r = await helper.main({ message: '帮我记点事' });
  eq('success 为 true', r.success, true);
  eq('text 透传', r.text, '已帮你建好');
  eq('非法类型/空内容被丢弃后剩 6 条 ops', r.ops.length, 6);
  eq('日期规整为补零格式', r.ops[0].dueDate, '2026-09-14 15:00');
  eq('priority 透传', r.ops[0].priority, 'high');
  eq('坏日期被丢弃（留 undefined）', r.ops[1].dueDate, undefined);
  eq('非法 priority 不写入', r.ops[1].priority, undefined);
  eq('斜杠日期被规整', r.ops[3].dueDate, '2026-09-20 09:00');
  eq('记账金额保留一位小数', r.ops[4].amount, 32.5);
  eq('记账分类透传', r.ops[4].category, '餐饮');
  eq('actions 透传', r.actions.length, 1);
  eq('meta 带回真实模型名', r.meta.model, 'glm-4.6');
  eq('meta.mode 为 chat', r.meta.mode, 'chat');

  /* ============ 5. 待办明细注入 & thinking 默认关闭 ============ */
  section('5. 上下文注入与 thinking');
  r = await helper.main({
    message: '我还有哪些没做？',
    todayTotal: 3,
    todayDone: 1,
    activeTodoCount: 2,
    todoBrief: [
      { content: '写周报', due: '今天 18:00', priority: 'high', overdue: true },
      { content: '买牛奶', done: true }
    ]
  });
  const sys = lastReq.payload.messages[0].content;
  ok('system 提示词含待办标题', sys.indexOf('写周报') >= 0);
  ok('system 提示词标注逾期', sys.indexOf('已逾期') >= 0);
  ok('system 提示词含统计数字', sys.indexOf('今日待办 3 条') >= 0);
  eq('thinking 默认 disabled', lastReq.payload.thinking && lastReq.payload.thinking.type, 'disabled');
  eq('模型名写入 payload', lastReq.payload.model, 'glm-4.6');

  process.env.AI_THINKING = 'enabled';
  await helper.main({ message: 'hi' });
  eq('AI_THINKING=enabled 时打开思考', lastReq.payload.thinking && lastReq.payload.thinking.type, 'enabled');
  delete process.env.AI_THINKING;

  /* ============ 6. 模型候选链顺延 ============ */
  section('6. 模型顺延（未开通 → 下一个）');
  reqLog = [];
  handler = function (payload) {
    if (payload.model === 'glm-4.6') {
      return errResp(404, 'ModelNotOpen', 'the model is not open');
    }
    return okChat(JSON.stringify({ text: '顺延成功', ops: [] }));
  };
  r = await helper.main({ message: 'hi' });
  eq('顺延后成功', r.success, true);
  eq('实际使用第二个候选模型', r.meta.model, 'glm-4-flash');
  eq('共发起 2 次请求', reqLog.length, 2);

  /* ============ 7. 全链不可用 ============ */
  section('7. 全链模型不可用');
  handler = function () { return errResp(404, 'InvalidEndpointOrModel.NotFound', 'model not found'); };
  r = await helper.main({ message: 'hi' });
  eq('返回 AI_MODEL_UNAVAILABLE', r.error, 'AI_MODEL_UNAVAILABLE');

  /* ============ 8. 错误分级 ============ */
  section('8. 错误分级');
  handler = function () { return errResp(402, '', 'Insufficient Balance'); };
  r = await helper.main({ message: 'hi' });
  eq('402 → AI_BALANCE', r.error, 'AI_BALANCE');

  handler = function () { return errResp(401, '', 'invalid api key'); };
  r = await helper.main({ message: 'hi' });
  eq('401 → AI_AUTH', r.error, 'AI_AUTH');

  handler = function () { return errResp(429, '', 'rate limit'); };
  r = await helper.main({ message: 'hi' });
  eq('429 → AI_RATE_LIMIT', r.error, 'AI_RATE_LIMIT');

  /* ============ 9. 非 JSON 输出的兜底 ============ */
  section('9. 纯文本兜底');
  handler = function () { return okChat('我今天说话忘了加 JSON 了，直接这么回你。'); };
  r = await helper.main({ message: 'hi' });
  eq('降级但仍成功', r.success, true);
  ok('保留纯文本内容', (r.text || '').indexOf('忘了加 JSON') >= 0);
  eq('标记 degraded', r.meta.degraded, 'plain-text');
  eq('ops 为空数组', r.ops.length, 0);

  /* ============ 10. 简报模式 ============ */
  section('10. 简报模式');
  handler = function () { return okChat(JSON.stringify({ text: '早上好，今天 2 件待办', ops: [] })); };
  r = await helper.main({ mode: 'brief', message: '生成今日简报', todoBrief: [{ content: '交电费', due: '今天 20:00' }] });
  const briefSys = lastReq.payload.messages[0].content;
  ok('简报提示词含"今日简报"', briefSys.indexOf('今日简报') >= 0);
  ok('简报提示词含待办明细', briefSys.indexOf('交电费') >= 0);
  eq('meta.mode 为 brief', r.meta.mode, 'brief');

  /* ============ 11. 多模态（图片） ============ */
  section('11. 多模态图片');
  handler = function () { return okChat(JSON.stringify({ text: '图里是购物清单', ops: [{ type: 'todo.add', content: '买鸡蛋' }] })); };
  const fakeImg = 'data:image/jpeg;base64,' + 'A'.repeat(200);
  r = await helper.main({ message: '看看这张图', images: [fakeImg] });
  const lastMsg = lastReq.payload.messages[lastReq.payload.messages.length - 1];
  ok('带图时 content 为数组', Array.isArray(lastMsg.content));
  eq('数组首项为 image_url', lastMsg.content[0].type, 'image_url');
  eq('数组末项为 text', lastMsg.content[lastMsg.content.length - 1].type, 'text');
  eq('meta.vision 为 true', r.meta.vision, true);
  ok('图片场景仍能产出 ops', r.ops.length === 1);

  handler = null;
  r = await helper.main({ message: '只有图', images: ['太短'] });
  ok('过短的图片串被过滤（content 退回字符串）', typeof lastReq.payload.messages[lastReq.payload.messages.length - 1].content === 'string');

  /* ============ 12. thinking 参数不被支持时降级 ============ */
  section('12. thinking 参数降级重试');
  reqLog = [];
  handler = function (payload) {
    if (payload.thinking) return errResp(400, '', 'thinking is not supported by this model');
    return okChat(JSON.stringify({ text: '去掉 thinking 后成功', ops: [] }));
  };
  r = await helper.main({ message: 'hi' });
  eq('降级后成功', r.success, true);
  eq('共 2 次请求（先带 thinking 再摘掉）', reqLog.length, 2);
  eq('首次带 thinking', !!reqLog[0].thinking, true);
  eq('二次已移除 thinking', reqLog[1].thinking, undefined);

  /* ============ 13. 向后兼容 createTodo ============ */
  section('13. 向后兼容 createTodo');
  handler = function () { return okChat(JSON.stringify({ text: '好的', createTodo: '周五开会' })); };
  r = await helper.main({ message: '记一下周五开会' });
  eq('createTodo 自动补成 ops', r.ops.length, 1);
  eq('补出的 op 类型为 todo.add', r.ops[0].type, 'todo.add');
  eq('内容一致', r.ops[0].content, '周五开会');

  /* ============ 14. 历史消息透传与截断 ============ */
  section('14. 历史消息');
  handler = function () { return okChat(JSON.stringify({ text: 'ok', ops: [] })); };
  const longHistory = [];
  for (let i = 0; i < 20; i++) longHistory.push({ role: i % 2 ? 'assistant' : 'user', text: 'h' + i });
  await helper.main({ message: 'hi', history: longHistory });
  eq('历史只保留最近 10 条 + system + 当前 = 12', lastReq.payload.messages.length, 12);

  /* ============ 15. 智谱「始终思考」模型降级 ============ */
  section('15. 智谱 1210（始终思考）模型降级');
  reqLog = [];
  handler = function (payload) {
    if (payload.thinking) {
      return errResp(400, '1210', '该模型始终思考，不支持关闭思考；请使用 low、high 或 max。');
    }
    return okChat(JSON.stringify({ text: '思考模型降级成功', ops: [] }));
  };
  process.env.AI_MODEL = 'glm-5.3';
  r = await helper.main({ message: 'hi' });
  eq('1210 后摘掉 thinking 重试成功', r.success, true);
  eq('共 2 次请求', reqLog.length, 2);
  eq('首次带 thinking', !!reqLog[0].thinking, true);
  eq('二次已移除 thinking', reqLog[1].thinking, undefined);
  eq('使用显式配置的模型', r.meta.model, 'glm-5.3');
  delete process.env.AI_MODEL;

  // 反向用例：同样是 1210，但文案与「思考」无关（如 glm-4.6 收到图片）
  // → 不应被误判成 thinking 问题，不该摘参数重试
  reqLog = [];
  handler = function () { return errResp(400, '1210', "messages.content.type 参数非法，取值范围 ['text']"); };
  r = await helper.main({ message: 'hi' });
  eq('非思考类 1210 不触发降级重试', reqLog.length, 1);
  eq('且原样报参数错误', r.error, 'AI_BAD_REQUEST');

  /* ============ 16. 前端纯函数（helper-ai.ts） ============ */
  /* ============ 16. 云函数超时预算保护 ============ */
  section('16. 云函数超时预算保护');

  // a) 预算充足：正常放行，并把本次预算透出给调用方（便于线上自查）
  reqLog = []; lastReq = null;
  r = await helper.main({ action: 'ping' }, { getRemainingTimeInMillis: function () { return 60000; } });
  eq('预算透出给调用方', r.budgetMs, 60000);
  ok('预算充足时不拦截', r.error !== 'AI_TIMEOUT_BUDGET', 'error=' + r.error);

  // b) 预算过低（平台默认 3 秒被下游耗时吃光时就是这个量级）：拒绝发起注定失败的请求
  reqLog = []; lastReq = null;
  r = await helper.main({ message: '你好' }, { getRemainingTimeInMillis: function () { return 800; } });
  eq('预算不足时快失败', r.error, 'AI_TIMEOUT_BUDGET');
  ok('错误信息给出改超时的修法', /超时时间[\s\S]*60\s*秒/.test(r.message || ''), 'message=' + r.message);
  ok('预算不足时不白白发起上游请求', lastReq === null && reqLog.length === 0, 'reqLog=' + reqLog.length);

  // c) 本次改造的核心：把上游超时收敛进剩余预算，这样能在被平台强杀之前
  //    拿到准确的「超时」，而不是让客户端只看到 -504003。
  handler = function () { const ok = okChat('迟到的回复'); ok.delay = 3000; return ok; };
  const budgetT0 = Date.now();
  r = await helper.main({ message: '你好' }, {
    getRemainingTimeInMillis: function () { return 1500 - (Date.now() - budgetT0); }
  });
  const budgetElapsed = Date.now() - budgetT0;
  eq('上游超时被识别为 AI_TIMEOUT', r.error, 'AI_TIMEOUT');
  ok('在预算内就返回了（没干等上游 3000ms）', budgetElapsed < 1500, '实际 ' + budgetElapsed + 'ms');

  // d) 没有 context（本地调试 / 旧版运行时）时降级：不拦截，按默认超时跑
  reqLog = []; lastReq = null;
  handler = function () { return okChat(JSON.stringify({ text: '降级正常', ops: [] })); };
  r = await helper.main({ message: '你好' });
  ok('无 context 时正常返回', r.success === true, JSON.stringify(r).slice(0, 120));

  section('17. 前端纯函数（helper-ai.ts）');
  const client = buildClient();
  if (!client) {
    console.log('  ⏭  跳过：未找到可用的 typescript（可用 TSC_JS 指定路径）');
  } else {
  const D = function (y, mo, d, h, mi) { return new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0).getTime(); };
  eq('标准日期解析', client.parseDueDate('2026-09-14 15:00'), D(2026, 9, 14, 15, 0));
  eq('斜杠日期解析', client.parseDueDate('2026/9/14'), D(2026, 9, 14));
  eq('T 分隔日期解析', client.parseDueDate('2026-09-14T08:30'), D(2026, 9, 14, 8, 30));
  eq('纯日期补零点', client.parseDueDate('2026-09-14'), D(2026, 9, 14));
  eq('乱写返回 null', client.parseDueDate('瞎写的日期'), null);
  eq('空值返回 null', client.parseDueDate(undefined), null);
  eq('13 月返回 null', client.parseDueDate('2026-13-01'), null);
  eq('32 日返回 null', client.parseDueDate('2026-09-32'), null);
  eq('25 点返回 null', client.parseDueDate('2026-09-14 25:00'), null);

  const desc = client.describeOps([
    { type: 'todo.add', content: '买牛奶' },
    { type: 'todo.addMany', items: [{ content: 'a' }, { content: 'b' }] },
    { type: 'todo.complete', match: '开会' },
    { type: 'ledger.add', amount: 32 },
    { type: 'nav', module: 'ledger' }
  ]);
  eq('ops 摘要条数', desc.length, 5);
  ok('摘要含新建待办', desc[0].indexOf('买牛奶') >= 0);
  ok('批量摘要含条数', desc[1].indexOf('2 条') >= 0);
  ok('摘要含完成动作', desc[2].indexOf('开会') >= 0);
  eq('空 ops 摘要为空数组', client.describeOps([]).length, 0);
  eq('undefined ops 不报错', client.describeOps(undefined).length, 0);

  eq('识别 AI_NOT_CONFIGURED', client.isAINotConfigured({ code: 'AI_NOT_CONFIGURED' }), true);
  eq('识别中文「未配置」', client.isAINotConfigured({ message: '未配置 AI_API_KEY' }), true);
  eq('普通错误不误判', client.isAINotConfigured({ code: 'AI_TIMEOUT' }), false);
  eq('null 不误判', client.isAINotConfigured(null), false);

  // 超时判定：平台强杀与云函数自我保护两种来源都要认，且不能反把「未配置」当成超时
  eq('识别平台强杀 -504003', client.isAITimeout({
    errMsg: 'cloud.callFunction:fail errCode: -504003 invoke task timed out after 3 seconds'
  }), true);
  eq('识别云函数自我保护码', client.isAITimeout({ code: 'AI_TIMEOUT_BUDGET' }), true);
  eq('识别中文超时提示', client.isAITimeout({ message: '请把超时时间改为 60 秒' }), true);
  eq('未配置不误判为超时', client.isAITimeout({ code: 'AI_NOT_CONFIGURED' }), false);
  eq('余额不足不误判为超时', client.isAITimeout({ code: 'AI_BALANCE' }), false);
  eq('null 不误判为超时', client.isAITimeout(null), false);

  const compact = client.toHelperReply({ text: '已建好', ops: [{ type: 'todo.add', content: 'a' }] });
  eq('有 ops 时不堆按钮', compact.actions.length, 1);
  eq('紧凑按钮为去待办清单', compact.actions[0].kind, 'nav-todo-panel');
  const noOps = client.toHelperReply({ text: '你好' });
  eq('无 ops 时给默认入口', noOps.actions.length, 2);
  }

  /* ============ 17. 可选：真实接口探测 ============ */
  if (LIVE) {
    section('18. 真实接口探测（--live）');
    const realKey = savedEnv.key || process.env.REAL_AI_API_KEY || '';
    if (!realKey) console.log('  ℹ️  未显式提供 Key → 改验云函数内置兜底 Key');
    {
      if (realKey) process.env.AI_API_KEY = realKey;
      else { delete process.env.AI_API_KEY; delete process.env.ZHIPU_API_KEY; }
      process.env.AI_API_BASE = savedEnv.base || 'https://open.bigmodel.cn/api/paas/v4';
      delete process.env.AI_PROVIDER; // 交给域名自动判定

      const pr = await helper.main({ action: 'ping', probe: true });
      ok('真实接口可调用', pr.success === true, JSON.stringify(pr).slice(0, 200));
      if (pr.success) {
        console.log('     模型=' + pr.model + '  延迟=' + pr.latencyMs + 'ms  样例=' + (pr.sample || ''));
      }

      /* --- 真实业务用例：验证模型在真实 prompt 下确实产出正确的 ops --- */

      // a) 一次交代三件事 → 应拆成 3 条待办
      r = await helper.main({ message: '帮我记三件事：买牛奶、交电费、给妈妈打电话', todayTotal: 0, activeTodoCount: 0 });
      const itemCount = (r.ops || []).reduce(function (n, o) {
        if (o.type === 'todo.addMany') return n + (o.items || []).length;
        if (o.type === 'todo.add') return n + 1;
        return n;
      }, 0);
      ok('「三件事」被拆成 3 条待办', itemCount === 3,
        '实际 ' + itemCount + ' 条；ops=' + JSON.stringify(r.ops || []).slice(0, 220));
      console.log('     ' + (r.meta ? r.meta.ms : '?') + 'ms  → ' + (r.text || '').slice(0, 60));

      // b) 打开记账本 → 应产出 nav/ledger
      r = await helper.main({ message: '打开记账本' });
      const navOk = (r.ops || []).some(function (o) { return o.type === 'nav' && o.module === 'ledger'; }) ||
        (r.actions || []).some(function (a) { return a.module === 'ledger'; });
      ok('「打开记账本」命中 ledger', navOk, 'ops=' + JSON.stringify(r.ops || []) + ' actions=' + JSON.stringify(r.actions || []));

      // c) 基于真实明细问答 → 必须引用明细里的标题
      r = await helper.main({
        message: '我还有哪些没做？',
        todayTotal: 2,
        todayDone: 0,
        activeTodoCount: 2,
        todoBrief: [
          { content: '写周报', due: '今天 18:00', priority: 'high', overdue: true },
          { content: '预约牙医', due: '09-20 10:00' }
        ]
      });
      ok('回答引用真实待办标题', /写周报|预约牙医/.test(r.text || ''), 'text=' + (r.text || '').slice(0, 120));
      console.log('     ' + (r.meta ? r.meta.ms : '?') + 'ms  → ' + (r.text || '').slice(0, 70));

      // d) 标记完成 → 应产出 todo.complete 且 match 指向明细
      r = await helper.main({
        message: '写周报我做完了，帮我标记一下',
        todayTotal: 1,
        todayDone: 0,
        activeTodoCount: 1,
        todoBrief: [{ content: '写周报', due: '今天 18:00', overdue: true }]
      });
      const doneOp = (r.ops || []).filter(function (o) { return o.type === 'todo.complete'; })[0];
      ok('「做完了」产出 todo.complete', !!doneOp, 'ops=' + JSON.stringify(r.ops || []).slice(0, 200));
      if (doneOp) ok('match 指向「写周报」', /写周报/.test(doneOp.match || ''), 'match=' + doneOp.match);

      // e) 简报模式
      r = await helper.main({ mode: 'brief', message: '生成今日简报', todayTotal: 3, todayDone: 1, activeTodoCount: 2, todoBrief: [{ content: '交电费', due: '今天 20:00' }] });
      ok('简报有内容', !!(r.text && r.text.length > 8), 'text=' + (r.text || '').slice(0, 100));
      console.log('     ' + (r.meta ? r.meta.ms : '?') + 'ms  → ' + (r.text || '').slice(0, 70));

      // f) 图片理解：现场生成「上红下蓝」的 PNG，验证 base64 → 视觉模型链路
      const imgBuf = makeTestPng(160, 160, [220, 20, 20], [20, 40, 220]);
      const imgDataUrl = 'data:image/png;base64,' + imgBuf.toString('base64');
      r = await helper.main({
        message: '这张图上下两部分分别是什么颜色？只回答颜色。',
        images: [imgDataUrl]
      });
      const said = r.text || '';
      ok('图片可被理解', !!(r.success && said), JSON.stringify(r).slice(0, 200));
      ok('正确读出了红/蓝', /红/.test(said) && /蓝/.test(said), 'text=' + said.slice(0, 100));
      console.log('     ' + (r.meta ? r.meta.ms : '?') + 'ms  model=' + (r.meta ? r.meta.model : '?') + '  → ' + said.slice(0, 70));
    }
  }

  /* -------------------- 收尾 -------------------- */
  started.server.close();
  cleanupBuild();

  console.log('\n' + '='.repeat(52));
  console.log('小助手 AI 自检：' + pass + ' 通过 / ' + fail + ' 失败');
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach(function (f) { console.log('  · ' + f); });
  }
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error('自检脚本异常：', e);
  process.exit(1);
});
