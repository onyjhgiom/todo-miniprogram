'use strict';

/**
 * 国风卦相 · 面相/手相 AI 识别自检  ——  node scripts/check-gua-ai.js
 *
 * 验证对象：cloudfunctions/faceReading、cloudfunctions/palmReading
 *
 * 做法：不碰真实接口。打桩 wx-server-sdk + 起一个**本地 mock 模型服务**，
 *       把 AI_API_BASE 指向它，然后 require 真实云函数并调用 main()。
 *       因此测到的是真实代码路径（提示词构建、供应商识别、模型候选链顺延、
 *       thinking 自适应、白名单过滤、错误分级）。
 *
 * 用法：
 *   node scripts/check-gua-ai.js          跑离线用例（进 CI / preflight，零网络）
 *   node scripts/check-gua-ai.js --live   额外用真实 Key + 现场生成的图片跑端到端
 *
 * 退出码：0 = 全部通过；1 = 有失败
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const FN_FACE = path.join(ROOT, 'cloudfunctions', 'faceReading', 'index.js');
const FN_PALM = path.join(ROOT, 'cloudfunctions', 'palmReading', 'index.js');
const LIVE = process.argv.indexOf('--live') !== -1;

/* -------------------- wx-server-sdk 打桩 -------------------- */

const SDK_ID = 'wx-server-sdk';
const sdkMock = {
  init: function () {},
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  database: function () { return {}; },
  getWXContext: function () { return { OPENID: 'test-openid' }; }
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === SDK_ID) return SDK_ID;
  return origResolve.apply(this, arguments);
};
require.cache[SDK_ID] = { id: SDK_ID, filename: SDK_ID, loaded: true, exports: sdkMock };

/* -------------------- 本地 mock 模型服务 -------------------- */

let handler = null;      // (payload, headers) => { status, body }
let lastReq = null;      // { payload, headers }
let reqLog = [];         // 全部请求

function startServer() {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      let raw = '';
      req.on('data', function (c) { raw += c; });
      req.on('end', function () {
        let payload = {};
        try { payload = JSON.parse(raw || '{}'); } catch (e) { payload = {}; }
        lastReq = { url: req.url, payload: payload, headers: req.headers };
        reqLog.push(lastReq);
        let r;
        try {
          r = handler ? handler(payload, req.headers) : okChat('{}');
        } catch (e) {
          r = { status: 500, body: { error: { message: String(e && e.message) } } };
        }
        res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
      });
    });
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

/** 模型"输出"某个字符串 */
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

function errResp(status, code, message) {
  return { status: status, body: { error: { code: code || '', type: code || '', message: message || 'error' } } };
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

/* -------------------- 现场生成测试图片 -------------------- */
// 不依赖任何外部图片源（外链随时可能失效）。生成两张风格化图：人脸 / 手掌。

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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const p = pixel(x, y);
      raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const IW = 448, IH = 560;

function faceImage() {
  const bg = [245, 243, 238], skin = [232, 190, 165], dark = [40, 35, 32];
  const browC = [60, 45, 38], lip = [190, 110, 105];
  const cx = IW / 2, cy = IH / 2 + 20, rx = 150, ry = 192;
  return makePng(IW, IH, function (x, y) {
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) return bg;
    if (y > cy - 108 && y < cy - 92 && ((x > cx - 92 && x < cx - 26) || (x > cx + 26 && x < cx + 92))) return browC;
    const eye = function (ex) { const dx = (x - ex) / 44, dy = (y - (cy - 62)) / 20; return dx * dx + dy * dy <= 1; };
    if (eye(cx - 60) || eye(cx + 60)) {
      const iris = (Math.abs(x - (cx - 60)) < 17 || Math.abs(x - (cx + 60)) < 17) && Math.abs(y - (cy - 62)) < 17;
      return iris ? [52, 40, 36] : [252, 250, 248];
    }
    if (Math.abs(x - cx) < 16 && y > cy - 46 && y < cy + 38) return [222, 176, 150];
    if (y > cy + 80 && y < cy + 104 && Math.abs(x - cx) < 62 - Math.abs(y - (cy + 92)) * 1.1) return lip;
    return skin;
  });
}

function palmImage() {
  const bg = [246, 244, 240], skin = [226, 182, 155], line = [176, 118, 104];
  const pcx = IW / 2, pcy = IH / 2 + 70;
  return makePng(IW, IH, function (x, y) {
    const inPalm = ((x - pcx) / 132) ** 2 + ((y - pcy) / 152) ** 2 <= 1;
    let inFinger = false;
    [[-96, 40], [-34, 44], [26, 42], [80, 34]].forEach(function (f) {
      const top = pcy - 150 - (f[0] < 0 ? 26 : 0) - (f[0] > 60 ? 18 : 0) - (f[0] > 0 && f[0] < 40 ? 12 : 0);
      if (Math.abs(x - (pcx + f[0])) < f[1] / 2 && y > top && y < pcy - 60) inFinger = true;
    });
    if (((x - (pcx - 158)) / 44) ** 2 + ((y - (pcy + 6)) / 66) ** 2 <= 1) inFinger = true;
    if (!inPalm && !inFinger) return bg;
    const dx = x - pcx;
    if (Math.abs(y - (pcy - 66 - dx * dx * 0.00105 - 10)) < 5 && dx > -112 && dx < 96) return line;
    if (Math.abs(y - (pcy - 8 + dx * 0.10 + dx * dx * 0.00022)) < 5 && dx > -110 && dx < 104) return line;
    const lx = x - (pcx - 34), ly = y - (pcy - 52);
    if (Math.abs(Math.sqrt(lx * lx + ly * ly) - 112) < 5 && lx < 26 && ly > -34) return line;
    return skin;
  });
}

/* -------------------- 主流程 -------------------- */

async function main() {
  const started = await startServer();
  const base = 'http://127.0.0.1:' + started.port;

  const savedEnv = {
    key: process.env.AI_API_KEY,
    base: process.env.AI_API_BASE,
    provider: process.env.AI_PROVIDER,
    model: process.env.AI_MODEL,
    thinking: process.env.AI_THINKING
  };

  process.env.AI_API_KEY = 'test-key';
  process.env.AI_API_BASE = base;
  process.env.AI_PROVIDER = 'ark'; // mock 服务在 127.0.0.1，按域名猜不出供应商 → 显式指定
  delete process.env.AI_MODEL;
  delete process.env.AI_THINKING;

  const face = require(FN_FACE);
  const palm = require(FN_PALM);

  const IMG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const faceOK = JSON.stringify({ isFace: true, attrs: { faceShape: 'oval', forehead: 'full', brow: 'thick', eye: 'bright', nose: 'high', lip: 'full', skin: 'fair' } });
  const palmOK = JSON.stringify({ isHand: true, attrs: { handShape: 'wood', lifeLine: 'clear', headLine: 'long', heartLine: 'clear', palmColor: 'ruddy', palmTexture: 'fine' } });

  /* ============ 1. 供应商识别与候选链 ============ */
  section('1. 供应商识别与候选链');

  handler = null;
  let r = await face.main({ action: 'ping' });
  eq('ping 成功', r.success, true);
  eq('供应商识别为 ark', r.provider, 'ark');
  eq('候选链首位为 doubao-seed-character-260628', r.candidates[0], 'doubao-seed-character-260628');
  eq('候选链第二位为 doubao-seed-evolving', r.candidates[1], 'doubao-seed-evolving');
  eq('候选链最多 3 个', r.candidates.length, 3);
  eq('ping 默认不做真实调用', r.latencyMs, undefined);

  delete process.env.AI_PROVIDER;
  process.env.AI_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
  r = await face.main({ action: 'ping' });
  eq('按域名自动判定为 ark', r.provider, 'ark');
  process.env.AI_API_BASE = base;

  process.env.AI_PROVIDER = 'openai';
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('无可用候选模型 → AI_NOT_CONFIGURED', r.error, 'AI_NOT_CONFIGURED');
  process.env.AI_PROVIDER = 'ark';

  /* ============ 2. 入参校验 ============ */
  section('2. 入参校验');

  r = await face.main({ action: 'analyze' });
  eq('缺图片 → NO_IMAGE', r.error, 'NO_IMAGE');
  r = await face.main({ action: 'analyze', imageBase64: '' });
  eq('空图片 → NO_IMAGE', r.error, 'NO_IMAGE');
  r = await face.main({ action: 'analyze', imageBase64: 'x'.repeat(6 * 1024 * 1024 + 10) });
  eq('超大图片 → IMAGE_TOO_LARGE', r.error, 'IMAGE_TOO_LARGE');
  r = await face.main({ action: 'nope' });
  eq('未知 action → BAD_ACTION', r.error, 'BAD_ACTION');

  /* ============ 3. 正常识别 ============ */
  section('3. 正常识别（面相）');

  reqLog = [];
  handler = function () { return okChat(faceOK); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('识别成功', r.success, true);
  eq('脸型识别为 oval', r.attrs.faceShape, 'oval');
  eq('气色识别为 fair', r.attrs.skin, 'fair');
  eq('recognized 计数为 7', r.recognized, 7);
  eq('带回真实模型名', r.model, 'doubao-seed-character-260628');
  eq('meta.provider 为 ark', r.meta.provider, 'ark');
  ok('meta.ms 为数字', typeof r.meta.ms === 'number', typeof r.meta.ms);
  eq('只发一次请求', reqLog.length, 1);
  eq('请求打到 /chat/completions', reqLog[0].url, '/chat/completions');
  eq('携带图片 data URL', reqLog[0].payload.messages[0].content[1].image_url.url.indexOf('data:image/png;base64,') === 0, true);
  eq('默认关闭思考', reqLog[0].payload.thinking && reqLog[0].payload.thinking.type, 'disabled');
  ok('提示词要求只输出 JSON', reqLog[0].payload.messages[0].content[0].text.indexOf('只输出一个 JSON 对象') >= 0);
  ok('提示词声明非角色扮演', reqLog[0].payload.messages[0].content[0].text.indexOf('不是角色扮演助手') >= 0);

  // data URL 前缀也应被正确处理
  r = await face.main({ action: 'analyze', imageBase64: 'data:image/jpeg;base64,' + IMG });
  eq('带 data URL 前缀也能识别', r.success, true);
  eq('前缀里的 mime 被沿用', reqLog[reqLog.length - 1].payload.messages[0].content[1].image_url.url.indexOf('data:image/jpeg') === 0, true);

  /* ============ 4. 白名单过滤 ============ */
  section('4. 白名单过滤（杜绝模型自由发挥）');

  handler = function () {
    return okChat(JSON.stringify({
      isFace: true,
      attrs: { faceShape: 'oval', forehead: 'very-wide-boss-like', brow: 'thick', eye: null, nose: 'straight', lip: 'thin', skin: 'pale' }
    }));
  };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('识别成功', r.success, true);
  eq('非法枚举值被丢弃', r.attrs.forehead, undefined);
  eq('null 值被丢弃', r.attrs.eye, undefined);
  eq('非法气色值被丢弃', r.attrs.skin, undefined);
  eq('剩余合法字段 4 个', r.recognized, 4);
  eq('合法字段保留', r.attrs.brow, 'thick');

  handler = function () {
    return okChat(JSON.stringify({ isFace: true, attrs: { faceShape: '天圆地方', forehead: '饱满有福' } }));
  };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('全部非法 → NO_FEATURE', r.error, 'NO_FEATURE');

  /* ============ 5. 负例与不可解析 ============ */
  section('5. 负例与不可解析');

  handler = function () { return okChat(JSON.stringify({ isFace: false })); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('无脸 → NO_FACE', r.error, 'NO_FACE');

  handler = function () { return okChat(JSON.stringify({ isHand: false })); };
  r = await palm.main({ action: 'analyze', imageBase64: IMG });
  eq('无掌 → NO_HAND', r.error, 'NO_HAND');

  handler = function () { return okChat('这张照片的面相非常好，你今年会发财。'); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('非 JSON 输出 → AI_UNPARSEABLE', r.error, 'AI_UNPARSEABLE');
  ok('raw 回带原文便于排查', String(r.raw).indexOf('发财') >= 0, r.raw);

  // markdown 代码块包裹也应能解析
  handler = function () { return okChat('```json\n' + faceOK + '\n```'); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('markdown 包裹也能解析', r.success, true);

  /* ============ 6. 候选链顺延 ============ */
  section('6. 候选链顺延（模型未开通）');

  reqLog = [];
  handler = function (p) {
    if (p.model === 'doubao-seed-character-260628') {
      return errResp(404, 'ModelNotOpen', 'Your account has not activated the model');
    }
    return okChat(faceOK);
  };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('顺延后成功', r.success, true);
  eq('使用第二个候选模型', r.model, 'doubao-seed-evolving');
  eq('共发 2 次请求', reqLog.length, 2);
  eq('tried 记录第一个不可用', r.meta.tried[0].status, 'unavailable');

  reqLog = [];
  handler = function () { return errResp(404, 'ModelNotOpen', 'not activated'); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('全部不可用 → AI_MODEL_NOT_OPEN', r.error, 'AI_MODEL_NOT_OPEN');
  eq('最多尝试 3 个候选', reqLog.length, 3);

  // InvalidEndpointOrModel.NotFound（模型 ID 失效）同样应顺延
  reqLog = [];
  handler = function (p) {
    if (p.model === 'doubao-seed-character-260628') {
      return errResp(404, 'InvalidEndpointOrModel.NotFound', 'The model or endpoint does not exist');
    }
    return okChat(palmOK);
  };
  r = await palm.main({ action: 'analyze', imageBase64: IMG });
  eq('ID 失效也顺延', r.success, true);
  eq('手相顺延到第二个候选', r.model, 'doubao-seed-evolving');

  /* ============ 7. thinking 自适应 ============ */
  section('7. thinking 自适应');

  reqLog = [];
  let rejectedOnce = false;
  handler = function (p) {
    // 第一次带 thinking 的请求 → 用「不支持该参数」拒绝；摘掉后重试应当成功
    if (p.thinking && !rejectedOnce) {
      rejectedOnce = true;
      return errResp(400, 'InvalidParameter', 'unsupported parameter: thinking');
    }
    return okChat(faceOK);
  };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('thinking 被拒后摘掉重试成功', r.success, true);
  eq('同一模型发了 2 次请求', reqLog.length, 2);
  ok('第一次带 thinking', !!(reqLog[0] && reqLog[0].payload.thinking), JSON.stringify(reqLog[0] && reqLog[0].payload.thinking));
  eq('第二次已摘掉 thinking', reqLog[1] && reqLog[1].payload.thinking, undefined);

  process.env.AI_THINKING = 'enabled';
  reqLog = [];
  handler = function () { return okChat(faceOK); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('AI_THINKING=enabled 时不发 thinking', reqLog[0].payload.thinking, undefined);
  delete process.env.AI_THINKING;

  /* ============ 8. 错误分级 ============ */
  section('8. 错误分级');

  handler = function () { return errResp(401, 'AuthenticationError', 'invalid api key'); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('401 → AI_AUTH', r.error, 'AI_AUTH');

  handler = function () { return errResp(402, 'InsufficientBalance', 'insufficient balance'); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('402 → AI_BALANCE', r.error, 'AI_BALANCE');

  handler = function () { return errResp(429, 'RateLimitExceeded', 'too many requests'); };
  r = await palm.main({ action: 'analyze', imageBase64: IMG });
  eq('429 → AI_RATE_LIMIT', r.error, 'AI_RATE_LIMIT');

  handler = function () { return errResp(400, 'InvalidParameter', 'image too small'); };
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('400（非 thinking）→ AI_BAD_REQUEST', r.error, 'AI_BAD_REQUEST');

  handler = function () { return errResp(500, 'InternalError', 'server exploded'); };
  r = await palm.main({ action: 'analyze', imageBase64: IMG });
  eq('500 → AI_ERROR', r.error, 'AI_ERROR');

  /* ============ 9. Key 取值优先级 ============ */
  section('9. Key 取值优先级');

  handler = function () { return okChat(faceOK); };

  delete process.env.AI_API_KEY;
  reqLog = [];
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('未配环境变量时用兜底 Key 仍可识别', r.success, true);
  ok('Authorization 携带兜底 Key', /^Bearer ark-/.test(reqLog[0].headers.authorization || ''), reqLog[0].headers.authorization);

  process.env.AI_API_KEY = 'env-key-wins';
  reqLog = [];
  r = await face.main({ action: 'analyze', imageBase64: IMG });
  eq('环境变量优先于兜底 Key', reqLog[0].headers.authorization, 'Bearer env-key-wins');
  process.env.AI_API_KEY = 'test-key';

  /* ============ 10. AI_MODEL 配置 ============ */
  section('10. AI_MODEL 配置');

  process.env.AI_MODEL = 'glm-4.6'; // 已知非视觉
  r = await face.main({ action: 'ping' });
  eq('非视觉模型被丢弃，候选链不变', r.candidates[0], 'doubao-seed-character-260628');
  ok('modelNote 说明已纠正', /不支持图片输入/.test(r.modelNote || ''), r.modelNote);

  process.env.AI_MODEL = 'doubao-seed-2-0-lite-260428';
  r = await face.main({ action: 'ping' });
  eq('显式配置的视觉模型排到首位', r.candidates[0], 'doubao-seed-2-0-lite-260428');
  delete process.env.AI_MODEL;

  /* ============ 11. 两张白名单互不污染 ============ */
  section('11. 面相 / 手相白名单互不污染');

  r = await face.main({ action: 'schema' });
  ok('面相白名单含 faceShape', !!r.schema.faceShape);
  eq('面相白名单不含 handShape', r.schema.handShape, undefined);
  r = await palm.main({ action: 'schema' });
  ok('手相白名单含 handShape', !!r.schema.handShape);
  eq('手相白名单不含 faceShape', r.schema.faceShape, undefined);

  // 手相提示词里不应出现「人脸」，反之亦然
  handler = function () { return okChat(palmOK); };
  reqLog = [];
  r = await palm.main({ action: 'analyze', imageBase64: IMG });
  const palmPrompt = reqLog[0].payload.messages[0].content[0].text;
  ok('手相提示词描述手掌', palmPrompt.indexOf('掌部外观特征测量工具') >= 0);
  eq('手相提示词不含「人脸」', palmPrompt.indexOf('人脸') >= 0, false);
  eq('手相识别成功', r.success, true);
  eq('手型识别为 wood', r.attrs.handShape, 'wood');

  /* ============ 12. 可选：真实端到端 ============ */
  if (LIVE) {
    section('12. 真实端到端（--live）');

    process.env.AI_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
    process.env.AI_PROVIDER = 'ark';
    // 恢复调用者真实传入的 Key（此前被换成测试占位）；没传则清空，走云函数内的兜底 Key
    if (savedEnv.key) process.env.AI_API_KEY = savedEnv.key;
    else delete process.env.AI_API_KEY;

    r = await face.main({ action: 'ping', probe: true });
    ok('真实接口可调用', r.success === true, JSON.stringify(r).slice(0, 220));
    if (r.success) console.log('     模型=' + r.model + '  延迟=' + r.latencyMs + 'ms  候选=' + r.candidates.join(' > '));

    const faceB64 = faceImage().toString('base64');
    const palmB64 = palmImage().toString('base64');

    r = await face.main({ action: 'analyze', imageBase64: faceB64 });
    if (r.success) {
      console.log('     面相 ' + r.meta.ms + 'ms  model=' + r.model + '  → ' + JSON.stringify(r.attrs));
      ok('面相真实识别出特征', r.recognized >= 4, '识别 ' + r.recognized + ' 项');
      ok('面相耗时在 30s 内', r.meta.ms < 30000, r.meta.ms + 'ms');
    } else {
      // 风格化测试图被判「无脸」也算链路通（说明模型确实收到了图）
      ok('面相链路通（判定无脸或识别成功）', r.error === 'NO_FACE' || r.error === 'NO_FEATURE', JSON.stringify(r).slice(0, 200));
      console.log('     面相返回：' + r.error + ' - ' + r.message);
    }

    r = await palm.main({ action: 'analyze', imageBase64: palmB64 });
    if (r.success) {
      console.log('     手相 ' + r.meta.ms + 'ms  model=' + r.model + '  → ' + JSON.stringify(r.attrs));
      ok('手相真实识别出特征', r.recognized >= 4, '识别 ' + r.recognized + ' 项');
      ok('手相耗时在 30s 内', r.meta.ms < 30000, r.meta.ms + 'ms');
    } else {
      ok('手相链路通（判定无掌或识别成功）', r.error === 'NO_HAND' || r.error === 'NO_FEATURE', JSON.stringify(r).slice(0, 200));
      console.log('     手相返回：' + r.error + ' - ' + r.message);
    }
  }

  /* -------------------- 收尾 -------------------- */
  started.server.close();

  ['key', 'base', 'provider', 'model', 'thinking'].forEach(function (k) {
    const envName = { key: 'AI_API_KEY', base: 'AI_API_BASE', provider: 'AI_PROVIDER', model: 'AI_MODEL', thinking: 'AI_THINKING' }[k];
    if (savedEnv[k] === undefined) delete process.env[envName];
    else process.env[envName] = savedEnv[k];
  });

  console.log('\n══════════════════════════════════');
  console.log('  通过 ' + pass + ' / ' + (pass + fail));
  if (fail) {
    console.log('  失败 ' + fail + ' 项：');
    failures.forEach(function (f) { console.log('    · ' + f); });
  } else {
    console.log('  🎉 全部通过');
  }
  console.log('══════════════════════════════════\n');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error('自检脚本异常：', e && e.stack || e);
  process.exit(1);
});
