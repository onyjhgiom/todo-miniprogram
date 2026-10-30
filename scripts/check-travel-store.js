// scripts/check-travel-store.js
// 旅行清单（travel 分包）离线冒烟：真加载 travel-store / travel-ai / 三个页面（tsc 编译后 require），
// 并把 cloudfunctions/travel 用内存版 wx-server-sdk 加载起来，验证「客户端 ↔ 云函数」整条链路。
//
// 为什么必须有：
//   tsc 只保证类型自洽。旅行模块的历史坑（AI 无法启用、清单删不掉）全是类型正确、行为死掉的：
//     · AI 能力开关被绑在「云端数据库同步」上，而 aiPlan 根本不需要数据库；
//     · aiPlan 没配 Key 时直接 ok:false，没有其他 AI 云函数的「上传即可用」兜底；
//     · 云端 addPacking 丢弃前端 _id（服务端另生成），导致前端删不掉、全量拉取还会复活/翻倍。
//
// 用法：node scripts/check-travel-store.js
// 退出码：0 = 全通过；1 = 有失败
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.tmp-check-travel');
const TSC = process.env.TSC_BIN ||
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';

/* ==================== 断言 ==================== */

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
function flush(n) {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 6); i += 1) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  return p;
}

/* ==================== 小程序运行时桩 ==================== */

const mem = new Map();
const toasts = [];
let modalConfirm = true;

/** 云端调用句柄：由场景决定是否接上真实云函数 */
let cloudCallFunction = null;

global.wx = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => { mem.set(k, v); },
  removeStorageSync: (k) => { mem.delete(k); },
  getStorageInfoSync: () => ({ keys: Array.from(mem.keys()), currentSize: 0, limitSize: 10240 }),
  clearStorageSync: () => mem.clear(),
  showToast: (o) => { toasts.push((o && o.title) || ''); },
  hideToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (o) => { if (o && o.success) o.success({ confirm: modalConfirm, cancel: !modalConfirm }); },
  showActionSheet: () => {},
  vibrateShort: () => {},
  stopPullDownRefresh: () => {},
  setNavigationBarColor: () => {},
  setNavigationBarTitle: () => {},
  requestSubscribeMessage: (o) => { if (o && o.success) o.success({}); },
  createSelectorQuery: () => ({
    select() { return this; },
    selectAll() { return this; },
    fields() { return this; },
    boundingClientRect(cb) { if (cb) cb([]); },
    exec(cb) { if (cb) cb([]); }
  }),
  getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 375 }),
  getSystemInfoSync: () => ({ pixelRatio: 2, windowWidth: 375 }),
  getStorage: () => {},
  get cloud() {
    return cloudCallFunction
      ? { callFunction: (o) => cloudCallFunction(o) }
      : undefined;
  }
};
/** 云环境 id：空 = 未配置（走本地 mock）；非空 = 真正调 wx.cloud.callFunction */
let currentEnvId = '';
global.getApp = () => ({ globalData: { envId: currentEnvId } });
global.getCurrentPages = () => [{ route: 'pages/index/index' }];

/** Page() 捕获器 */
let capturedPage = null;
global.Page = (obj) => { capturedPage = obj; };
global.Component = () => {};

/** 把页面模块加载成「页面实例」：data 深拷贝 + 同步 setData */
function loadPage(relPath) {
  const file = path.join(OUT, relPath);
  delete require.cache[require.resolve(file)];
  capturedPage = null;
  require(file);
  if (!capturedPage) throw new Error('未捕获到 Page 定义: ' + relPath);
  return capturedPage;
}

function instantiate(pageObj, extraData) {
  const inst = Object.create(pageObj);
  inst.data = JSON.parse(JSON.stringify(pageObj.data || {}));
  // 自定义属性（非 data）也要搬到实例上，页面逻辑会读写它们
  Object.keys(pageObj).forEach((k) => {
    if (k !== 'data') inst[k] = pageObj[k];
  });
  Object.assign(inst.data, extraData || {});
  inst.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach((k) => {
      // 支持 'a.b' 形式的路径（本项目页面暂未用到，但保持兼容）
      if (k.indexOf('.') > 0) {
        const segs = k.split('.');
        let cur = inst.data;
        for (let i = 0; i < segs.length - 1; i += 1) cur = cur[segs[i]] = cur[segs[i]] || {};
        cur[segs[segs.length - 1]] = patch[k];
      } else {
        inst.data[k] = patch[k];
      }
    });
    if (cb) cb();
  };
  inst.unsub = null;
  return inst;
}

/* ==================== 内存版 wx-server-sdk ==================== */

/** 内存数据库：模拟云开发集合（含「集合不存在」这一真实错误） */
function makeCloudDB() {
  const cols = new Map(); // name -> Map(_id -> doc)
  let seq = 0;

  function ensure(name) {
    if (!cols.has(name)) cols.set(name, new Map());
    return cols.get(name);
  }
  function must(name) {
    if (!cols.has(name)) {
      const e = new Error('collection.get:fail -502005 database collection not exists');
      e.errCode = -502005;
      throw e;
    }
    return cols.get(name);
  }
  function match(doc, cond) {
    return Object.keys(cond || {}).every((k) => {
      const c = cond[k];
      if (c && typeof c === 'object' && c.$op === 'gt') return (doc[k] || 0) > c.v;
      if (c && typeof c === 'object' && c.$op === 'in') return c.v.indexOf(doc[k]) >= 0;
      return doc[k] === c;
    });
  }
  function clone(d) { return JSON.parse(JSON.stringify(d)); }

  const command = {
    gt: (v) => ({ $op: 'gt', v }),
    in: (arr) => ({ $op: 'in', v: arr })
  };

  function collection(name) {
    function query(cond) {
      const api = {
        limit() { return api; },
        orderBy() { return api; },
        async get() {
          const map = must(name);
          const out = [];
          map.forEach((d) => { if (match(d, cond)) out.push(clone(d)); });
          return { data: out };
        },
        async update({ data }) {
          const map = must(name);
          let n = 0;
          map.forEach((d, id) => {
            if (match(d, cond)) { map.set(id, Object.assign({}, d, data)); n += 1; }
          });
          return { stats: { updated: n } };
        },
        async remove() {
          const map = must(name);
          const del = [];
          map.forEach((d, id) => { if (match(d, cond)) del.push(id); });
          del.forEach((id) => map.delete(id));
          return { stats: { removed: del.length } };
        }
      };
      return api;
    }
    return {
      where: query,
      async add({ data }) {
        const map = ensure(name); // 真实 DB：集合不存在时 add 同样能成功（会自动建集合）
        // ⚠️ 真实云开发允许 add 时自带 _id（前端生成的 id 会原样落库），
        //    同 id 已存在则报 duplicate —— 云函数 putDoc 正是靠这个异常转 update 实现幂等。
        //    桩必须照抄这个语义：若桩无条件覆盖 _id，就会掩盖「云端丢弃前端 _id」
        //    这类真问题（历史上「清单删不掉 / 复活 / 翻倍」的根因）。
        const id = data && data._id ? String(data._id) : 'c' + (++seq);
        if (map.has(id)) {
          const e = new Error('collection.add:fail -502001 database request fail, duplicate key: ' + id);
          e.errCode = -502001;
          throw e;
        }
        map.set(id, Object.assign({}, clone(data), { _id: id }));
        return { _id: id };
      },
      doc(id) {
        return {
          async update({ data }) {
            const map = must(name);
            if (map.has(id)) map.set(id, Object.assign({}, map.get(id), data));
            return { stats: { updated: 1 } };
          },
          async remove() {
            const map = must(name);
            map.delete(id);
            return { stats: { removed: 1 } };
          },
          async get() {
            const map = must(name);
            return { data: map.has(id) ? [clone(map.get(id))] : [] };
          }
        };
      }
    };
  }

  return {
    command,
    collection,
    /** 预建集合（模拟「云开发控制台里已手动建过集合」） */
    __create(name) { ensure(name); },
    __raw() { return cols; }
  };
}

/**
 * 假 https：让 AI 调用不打真实网络。
 *
 * ⚠️ 必须在**整个进程生命周期**内生效，不能只在 require 云函数那一瞬间生效 ——
 *   云函数里的 `require('https')` 是写在 requestJSON() 内部、调用时才执行的，
 *   require 期装好的桩早被还原了，于是 AI 请求会真的打到火山方舟（联网 + 白烧 token）。
 *
 * ⚠️ 离线自检还必须把冷备也指向桩（AI_BACKUP_BASE / AI_BACKUP_KEY / AI_BACKUP_DISABLE）——
 *   否则主档案一旦被判为「供应商级失败」，云函数会自动切到真实厂商。
 *
 * responder: (opts, body) => string | { status, body } | null
 */
let aiHttpResponder = null;
function makeFakeHttps() {
  return {
    request(opts, cb) {
      const chunks = [];
      const req = {
        on(ev, fn) { if (ev === 'error') req.__err = fn; return req; },
        setTimeout() { return req; },
        write(c) { chunks.push(c); },
        end() {
          const out = aiHttpResponder ? aiHttpResponder(opts, chunks.join('')) : null;
          if (out === null || out === undefined) {
            const e = new Error('AI_HTTP_NOT_STUBBED');
            if (req.__err) req.__err(e);
            return;
          }
          const status = typeof out === 'string' ? 200 : out.status;
          const body = typeof out === 'string' ? out : String(out.body);
          const res = {
            statusCode: status,
            on(ev, fn) { if (ev === 'data') fn(Buffer.from(body, 'utf8')); if (ev === 'end') fn(); return res; }
          };
          cb(res);
        },
        destroy() {}
      };
      return req;
    }
  };
}

/** 全局模块拦截：https 永远走桩；wx-server-sdk 走「本次加载使用的内存版 SDK」 */
const FAKE_HTTPS = makeFakeHttps();
let currentSdk = null;
const origModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'https') return FAKE_HTTPS;
  if (request === 'wx-server-sdk' && currentSdk) return currentSdk;
  return origModuleLoad.call(this, request, parent, isMain);
};

/** 用假 SDK 加载真实云函数；返回 { main, db, restoreEnv } */
function loadCloudFunction(env) {
  const db = makeCloudDB();
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'openid-test' }),
    openapi: { subscribeMessage: { send: async () => ({}) } }
  };
  // 记录并覆盖环境变量
  const savedEnv = {};
  Object.keys(env || {}).forEach((k) => { savedEnv[k] = process.env[k]; process.env[k] = env[k]; });
  Object.keys(env || {}).forEach((k) => { if (env[k] === undefined) delete process.env[k]; });

  currentSdk = sdk;
  const file = path.join(ROOT, 'cloudfunctions', 'travel', 'index.js');
  delete require.cache[require.resolve(file)];
  const mod = require(file);

  return {
    main: mod.main,
    db,
    restoreEnv() { Object.keys(savedEnv).forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); }
  };
}

/* ==================== 编译 ==================== */

function compile() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const entries = [
    'miniprogram/subpackages/travel/pages/packing/packing.ts',
    'miniprogram/subpackages/travel/pages/trip-edit/trip-edit.ts',
    'miniprogram/subpackages/travel/pages/trip-detail/trip-detail.ts',
    'miniprogram/types/index.d.ts'
  ];
  execFileSync(process.execPath, [
    TSC, ...entries,
    '--outDir', OUT,
    '--module', 'commonjs',
    '--target', 'es2018',
    '--skipLibCheck',
    '--esModuleInterop',
    '--noImplicitAny', 'false',
    '--strict', 'false'
  ], { stdio: 'pipe' });
}

function out(rel) { return path.join(OUT, rel); }

/** 把 wx.cloud.callFunction 接到（内存版）真实云函数上 */
function attachCloud(cfEnv, recorder) {
  cloudCallFunction = (o) => {
    if (recorder) recorder.push(o.data);
    Promise.resolve()
      .then(() => cfEnv.main(o.data))
      .then((res) => o.success({ result: res }))
      .catch((err) => o.fail({ errMsg: String((err && err.message) || err) }));
  };
}

/** 重新加载一份「全新的」store + ai 模块（等价于换设备 / 清缓存后冷启动） */
function freshStores() {
  [
    out('subpackages/travel/utils/travel-store.js'),
    out('subpackages/travel/utils/travel-ai.js'),
    out('utils/cloud.js')
  ].forEach((f) => { try { delete require.cache[require.resolve(f)]; } catch (_e) { /* 未加载过 */ } });
  return {
    store: require(out('subpackages/travel/utils/travel-store.js')),
    ai: require(out('subpackages/travel/utils/travel-ai.js'))
  };
}

/** 云函数 AI 档案：主档案走桩地址，冷备也必须指向桩（离线自检绝不联网） */
const AI_ENV_STUB = {
  TRAVEL_AI_KEY: 'test-key',
  TRAVEL_AI_BASE: 'https://primary.mock/v1',
  TRAVEL_AI_MODEL: 'mock-model',
  AI_BACKUP_DISABLE: '1'
};

/** 假 AI 返回：3 天 4 条，字段与 aiPlan 的解析约定一致 */
const PLAN_JSON = {
  plan: [
    {
      day: 1,
      items: [
        { startTime: '09:00', content: '宽窄巷子', type: '景点', place: '宽窄巷子', cost: 0, note: '' },
        { startTime: '12:00', content: '春熙路火锅', type: '餐厅', place: '春熙路', cost: 120, note: '微辣' }
      ]
    },
    { day: 2, items: [{ startTime: '10:00', content: '大熊猫基地', type: '景点', place: '熊猫基地', cost: 55, note: '' }] },
    { day: 3, items: [{ startTime: '09:30', content: '都江堰', type: '景点', place: '都江堰', cost: 80, note: '' }] }
  ]
};

/** 把 PLAN_JSON 包成 OpenAI 兼容的回复体 */
function aiReply(plan) {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan || PLAN_JSON) } }] });
}

/** 记录 AI 请求打到哪台主机（验证主档案 / 冷备的切换顺序） */
let aiHosts = [];
function useAIStub(handler) {
  aiHosts = [];
  aiHttpResponder = (opts, body) => {
    const host = opts.hostname || '';
    if (!/chat\/completions/.test(opts.path || '')) return null;
    aiHosts.push(host);
    return handler(host, body);
  };
}

/* ==================== 主流程 ==================== */

(async function main() {
  console.log('编译旅行模块 …');
  compile();

  const store = require(out('subpackages/travel/utils/travel-store.js'));
  const travelAI = require(out('subpackages/travel/utils/travel-ai.js'));
  const templates = require(out('subpackages/travel/utils/trip-templates.js'));

  /* ---------- 1. 本地模式：AI 探测 + 清单本地生成 / 删除 ---------- */
  section('1. 本地模式（未配置云环境）：AI 探测给可读原因，清单本地可生成可删除');

  const packPageDef = loadPage('subpackages/travel/pages/packing/packing.js');
  const editPageDef = loadPage('subpackages/travel/pages/trip-edit/trip-edit.js');
  const detailPageDef = loadPage('subpackages/travel/pages/trip-detail/trip-detail.js');

  eq('默认 AI 未就绪', travelAI.aiAvailable(), false);
  eq('默认云端同步也未开启', store.isCloudSynced(), false);

  let probe = await travelAI.enableAI();
  eq('本地模式下 probeAI.ok = false', probe.ok, false);
  console.log('     probeAI.msg = ' + probe.msg);
  ok('失败提示可读（不是 "mock 未实现函数 travel" 这类内部文案）',
    probe.msg.indexOf('mock') < 0 && probe.msg.indexOf('未实现') < 0, probe.msg);
  eq('探测失败后 AI 仍不可用', travelAI.aiAvailable(), false);
  eq('AI 探测不污染云端同步开关（两者互相独立）', store.isCloudSynced(), false);

  const t1 = await store.addTrip({
    title: '成都 4 日游', destination: '成都',
    startDate: '2026-09-25', endDate: '2026-09-28', scenes: ['度假']
  });
  const packing = instantiate(packPageDef, {});
  packing.onLoad({ id: t1._id });

  packing.data.scenes.forEach((s, i) => { s.on = i === 0; });
  packing.onGenerate();
  await flush(10);
  const genCount = packing.data.total;
  ok('模板生成出清单（total > 0）', genCount > 0, 'total=' + genCount);

  // 单品删除
  const firstId = packing.data.groups[0].items[0]._id;
  packing.onEditItem({ currentTarget: { dataset: { id: firstId } } });
  ok('进入编辑态拿到草稿 _id', !!packing.data.draft && packing.data.draft._id === firstId);
  modalConfirm = true;
  packing.onDeleteDraft();
  await flush(10);
  eq('单品删除后清单条数 -1', packing.data.total, genCount - 1);
  eq('单品删除后底层也没了', store.listPacking(t1._id).length, genCount - 1);

  // 批量删除
  packing.onToggleBatch();
  packing.onSelectAll();
  eq('全选拿到全部可见条目', packing.data.selected.length, packing.data.total);
  packing.onBatchDelete();
  await flush(10);
  eq('批量删除后清单为空', store.listPacking(t1._id).length, 0);

  // 清空
  packing.data.scenes.forEach((s, i) => { s.on = i === 0; });
  packing.onGenerate();
  await flush(10);
  ok('二次生成成功', packing.data.total > 0, 'total=' + packing.data.total);
  packing.onClearAll();
  await flush(10);
  eq('清空后清单为空', store.listPacking(t1._id).length, 0);
  ok('删除动作都留下了墓碑（离线删除靠它挡复活）',
    Object.keys(mem.get('todo_app_travel_tomb') || {}).length > 0,
    'tomb=' + JSON.stringify(Object.keys(mem.get('todo_app_travel_tomb') || {}).slice(0, 3)));

  /* ---------- 2. 页面层：AI 启用按钮的可见结果 ---------- */
  section('2. 新建行程页「启用并生成」的真实结果');

  const edit = instantiate(editPageDef, {});
  edit.onLoad({});
  eq('aiOn 初始为 false（显示「启用并生成」按钮）', edit.data.aiOn, false);
  toasts.length = 0;
  edit.onAiEnable();
  await flush(10);
  eq('本地模式下点击后 aiOn 仍为 false', edit.data.aiOn, false);
  eq('没有生成任何内容', edit.data.aiItems.length, 0, 'aiItems=' + edit.data.aiItems.length);
  console.log('     toast = ' + JSON.stringify(toasts));
  ok('给出了可读的失败原因', toasts.join('|').indexOf('本地模式') >= 0 || toasts.join('|').indexOf('云开发') >= 0,
    'toast=' + JSON.stringify(toasts));

  /* ---------- 3. 云函数 aiPlan：内置兜底 Key ---------- */
  section('3. 云函数 aiPlan：不配任何环境变量也能用（内置兜底 Key，与其他 AI 云函数一致）');

  useAIStub((host) => aiReply());
  let cf = loadCloudFunction({
    TRAVEL_AI_KEY: undefined, TRAVEL_AI_BASE: undefined, TRAVEL_AI_MODEL: undefined,
    AI_API_KEY: undefined, AI_API_BASE: undefined, AI_MODEL: undefined,
    AI_BACKUP_DISABLE: '1'
  });
  // 故意不建任何集合：AI 与数据库无关，必须照常可用
  let st = await cf.main({ action: 'aiStatus' });
  console.log('     aiStatus = ' + JSON.stringify(st));
  eq('未配任何环境变量时 aiStatus.ai = true（兜底 Key 生效）', st.ai, true);
  eq('aiStatus 不需要数据库（集合缺失也不报错）', st.success, true);

  let ai = await cf.main({ action: 'aiPlan', destination: '成都', days: 3, budget: 3000, members: [] });
  console.log('     aiPlan = ok=' + ai.ok + ' days=' + ai.days + ' items=' + ((ai.items || []).length));
  eq('未配任何环境变量时 aiPlan.ok = true（问题一：云已部署就该能用）', ai.ok, true);
  ok('aiPlan 返回结构化条目', (ai.items || []).length > 0, 'items=' + ((ai.items || []).length));
  eq('主档案 = 火山方舟（豆包）', aiHosts[0], 'ark.cn-beijing.volces.com');
  eq('冷备关闭时不发第二跳', aiHosts.length, 1);
  cf.restoreEnv();

  /* ---------- 4. 主档案失败 → 自动切冷备 ---------- */
  section('4. 主档案 401 时自动切冷备（AI_BACKUP_* 可配置，离线自检必须指向桩）');

  useAIStub((host) => {
    if (host === 'primary.mock') return { status: 401, body: '{"error":"invalid api key"}' };
    if (host === 'backup.mock') return aiReply();
    return null;
  });
  cf = loadCloudFunction({
    TRAVEL_AI_KEY: 'primary-key', TRAVEL_AI_BASE: 'https://primary.mock/v1', TRAVEL_AI_MODEL: 'm1',
    AI_BACKUP_BASE: 'https://backup.mock/v1', AI_BACKUP_KEY: 'backup-key', AI_BACKUP_DISABLE: '0'
  });
  ai = await cf.main({ action: 'aiPlan', destination: '成都', days: 3, budget: 3000, members: [] });
  console.log('     访问顺序 = ' + JSON.stringify(aiHosts) + '，ok=' + ai.ok);
  eq('主档案 401 → 自动切冷备并成功', ai.ok, true);
  eq('访问顺序：primary → backup', aiHosts.join('→'), 'primary.mock→backup.mock');
  cf.restoreEnv();

  /* ---------- 5. 集合缺失：同步挂掉，AI 不受影响 ---------- */
  section('5. 集合缺失时：同步探测失败，但 AI 完全不受影响（问题一的根因验证）');

  cf = loadCloudFunction(AI_ENV_STUB);
  useAIStub(() => aiReply()); // 换回「正常返回」的桩（上一段是故意 401 的）
  // 故意不建 trips / travel_items / travel_notes
  const listRes = await cf.main({ action: 'list' });
  console.log('     list（集合缺失）= ' + JSON.stringify(listRes).slice(0, 140));
  eq('集合缺失时 list.success = false', listRes.success, false);

  attachCloud(cf);
  mem.clear();
  currentEnvId = 'cloud1-test-env';
  let s = freshStores();
  const store5 = s.store;
  const syncFail = await store5.syncCloud();
  console.log('     syncCloud = ' + JSON.stringify(syncFail));
  eq('集合缺失时 syncCloud.ok = false', syncFail.ok, false);
  eq('云端同步开关没有打开', store5.isCloudSynced(), false);

  const probe2 = await store5.probeAI();
  console.log('     probeAI = ' + JSON.stringify(probe2));
  eq('AI 探测依然成功（旧实现这里被数据库连坐，永远开不了 AI）', probe2.ok, true);
  const gen2 = await s.ai.generatePlan({ destination: '成都', days: 3, budget: 3000, members: [] });
  eq('AI 直接生成成功', gen2.ok, true);
  ok('AI 生成的条目数 > 0', gen2.items.length > 0, 'items=' + gen2.items.length);

  /* ---------- 6. 云端可用：删掉的物品会不会复活 ---------- */
  section('6. 云端可用（集合已建）：删除是否真的生效（问题二）');

  const cloudEnv = loadCloudFunction(AI_ENV_STUB);
  ['trips', 'travel_items', 'travel_notes'].forEach((c) => cloudEnv.db.__create(c));
  const calls = [];
  attachCloud(cloudEnv, calls);

  mem.clear();
  currentEnvId = 'cloud1-test-env';
  s = freshStores();
  const store6 = s.store;
  const sync = await store6.syncCloud();
  eq('云端可用时 syncCloud.ok = true', sync.ok, true);
  eq('云端可用时 isCloudSynced = true', store6.isCloudSynced(), true);

  const trip2 = await store6.addTrip({
    title: '云端行程', destination: '三亚', startDate: '2026-10-01', endDate: '2026-10-03'
  });
  await flush(12);
  const p1 = await store6.addPackingItem(trip2._id, { name: '泳衣', category: '衣物' });
  const p2 = await store6.addPackingItem(trip2._id, { name: '防晒霜', category: '洗漱' });
  await flush(12);

  const cloudRows = (kind, tripId) =>
    Array.from(cloudEnv.db.__raw().get('travel_items').values())
      .filter((d) => d.kind === kind && (!tripId || d.tripId === tripId));
  const cloudNames = () => cloudRows('packing').map((d) => d.name);

  console.log('     本地 _id = ' + JSON.stringify([p1._id, p2._id]));
  console.log('     云端 _id = ' + JSON.stringify(cloudRows('packing').map((d) => d._id)));
  eq('云端条数 = 本地条数', cloudRows('packing').length, 2);
  ok('云端保留前端 _id（删除才能对上号）',
    cloudRows('packing').map((d) => d._id).indexOf(p1._id) >= 0,
    '本地 id 与云端 id 不一致 → 云端 remove 按前端 id 匹配不到任何文档');

  // 6b. 删除一个 → 云端有没有真的删掉
  await store6.removePackingItem(p1._id);
  await flush(12);
  console.log('     删掉本地「泳衣」后，云端剩余 = ' + JSON.stringify(cloudNames()));
  eq('删除后云端也少一条（否则就是「删不掉」）', cloudRows('packing').length, 1,
    '云端仍有 ' + cloudRows('packing').length + ' 条，删掉的那条在云端从未被删');

  // 6c. 同设备：删完只要拉一次云端（进详情页就会拉）→ 物品会不会原地复活
  await store6.pullFromCloud();
  await flush(12);
  const revived = store6.listPacking(trip2._id).map((x) => x.name);
  console.log('     删除后拉一次云端 → 清单 = ' + JSON.stringify(revived));
  ok('删除后同步不会把物品带回来', revived.indexOf('泳衣') < 0,
    '实际清单：' + revived.join('、') + '（删掉的又回来了）');

  // 6d. 同步游标被清（重装 / 清缓存 / 首次开启同步）→ 全量拉取 → 会不会翻倍
  const dupBefore = store6.listPacking(trip2._id).length;
  mem.delete('todo_app_travel_sync_at');
  await store6.syncCloud();
  await flush(12);
  const dupAfter = store6.listPacking(trip2._id);
  console.log('     全量同步前 ' + dupBefore + ' 条 → 后 ' + dupAfter.length + ' 条：' +
    JSON.stringify(dupAfter.map((x) => x.name)));
  eq('全量同步不应让同一件物品出现两份', dupAfter.length, dupBefore,
    '云端另生成 _id → mergeDown 按 _id 合并会把同一件物品当成两条');

  // 6e. 换设备 / 清缓存后重新开启同步 → 已删除的物品会不会复活
  mem.clear();
  mem.set('todo_app_travel_cloud_on', true); // 用户在新设备上再次点「云端同步」
  s = freshStores();
  const storeE = s.store;
  const sync3 = await storeE.syncCloud();
  await flush(12);
  const back = storeE.listPacking(trip2._id).map((x) => x.name);
  console.log('     新设备同步 ok=' + sync3.ok + '，清单 = ' + JSON.stringify(back));
  ok('新设备不该看到已删除的「泳衣」', back.indexOf('泳衣') < 0, '实际清单：' + back.join('、'));

  /* ---------- 7. 删除墓碑：离线删除 / 云端残留 ---------- */
  section('7. 删除墓碑：云端残留的记录不会在同步时复活，并会被补删');

  // 造一条「云端残留」：本地已删过、但云端删除没送出去
  // （离线删除 / 云函数还是旧版本按前端 id 匹配不到文档时，就是这个状态）
  cloudEnv.db.__raw().get('travel_items').set('ghost_pack_1', {
    _id: 'ghost_pack_1', kind: 'packing', tripId: trip2._id, name: '幽灵牙刷', category: '洗漱',
    count: 1, owner: '', isEssential: false, packed: false, reminderDaysBefore: 0, note: '', order: 1,
    fromTemplate: '', _openid: 'openid-test', createTime: Date.now(), updateTime: Date.now()
  });
  mem.set('todo_app_travel_tomb', { ghost_pack_1: Date.now() });

  s = freshStores();
  const store8 = s.store;
  await store8.syncCloud();
  await flush(12);
  const names8 = store8.listPacking(trip2._id).map((x) => x.name);
  console.log('     同步后清单 = ' + JSON.stringify(names8));
  ok('墓碑挡住云端残留（已删除的不会回来）', names8.indexOf('幽灵牙刷') < 0, '实际：' + names8.join('、'));
  ok('同步成功后补发 purge：云端残留被真删',
    !cloudEnv.db.__raw().get('travel_items').has('ghost_pack_1'), '云端仍留着 ghost_pack_1');
  eq('墓碑已清空（云端已确认删除）', Object.keys(mem.get('todo_app_travel_tomb') || {}).length, 0);

  /* ---------- 8. 模板清单 / 行程条目：落云端 + 删除生效 ---------- */
  section('8. 模板生成的清单与路线条目：原样落云端，删除同样生效');

  const t4 = await store8.addTrip({ title: '模板行程', destination: '西安', startDate: '2026-12-01', endDate: '2026-12-03' });
  await flush(10);
  const tplCount = await store8.applyPackingTemplate(t4._id, ['度假']);
  await flush(12);
  const tplLocal = store8.listPacking(t4._id);
  const tplCloud = cloudRows('packing', t4._id);
  console.log('     模板生成 ' + tplLocal.length + ' 条（返回 ' + tplCount + '），云端 = ' + tplCloud.length + ' 条');
  ok('模板生成的清单要原样落云端（否则换设备就没了）',
    tplCount > 0 && tplLocal.length === tplCount && tplCloud.length === tplLocal.length,
    '本地 ' + tplLocal.length + ' / 云端 ' + tplCloud.length);
  const tplCloudIds = tplCloud.map((d) => d._id);
  ok('模板清单的 _id 一一对应（删除才对得上号）',
    tplLocal.every((x) => tplCloudIds.indexOf(x._id) >= 0),
    '匹配 ' + tplLocal.filter((x) => tplCloudIds.indexOf(x._id) >= 0).length + ' / ' + tplLocal.length);

  await store8.removePackingItem(tplLocal[0]._id);
  await flush(12);
  console.log('     删掉一条模板物品后，云端 = ' + cloudRows('packing', t4._id).length + ' 条');
  eq('模板清单删一条 → 云端也少一条', cloudRows('packing', t4._id).length, tplLocal.length - 1);

  // 路线模板：整程覆盖式导入
  const t3 = await store8.addTrip({ title: '路线行程', destination: '成都', startDate: '2026-11-01', endDate: '2026-11-03' });
  await flush(10);
  const allRoutes = templates.allRouteTemplates();
  const route1 = await store8.applyRouteTemplate(t3._id, allRoutes[0].key);
  await flush(12);
  eq('路线模板生成条目', route1 > 0, true);
  console.log('     第一套路线：本地 ' + store8.listItems(t3._id).length + ' 条，云端 ' +
    cloudRows('tripItem', t3._id).length + ' 条');
  eq('路线条目录云端', cloudRows('tripItem', t3._id).length, store8.listItems(t3._id).length);

  // 换成另一套路线 → 旧条目必须真删（否则「换了路线，旧行程又回来了」）
  const route2 = await store8.applyRouteTemplate(t3._id, allRoutes[1].key);
  await flush(12);
  const afterSwap = store8.listItems(t3._id).length;
  console.log('     换成第二套路线（' + route2 + ' 条）：本地 ' + afterSwap + ' 条，云端 ' +
    cloudRows('tripItem', t3._id).length + ' 条');
  eq('覆盖导入后云端条目数 = 本地（旧条目真删）', cloudRows('tripItem', t3._id).length, afterSwap);

  // 条目删除 → 云端同步删掉
  await store8.removeTripItem(store8.listItems(t3._id)[0]._id);
  await flush(12);
  eq('条目删除 → 云端 -1', cloudRows('tripItem', t3._id).length, afterSwap - 1);

  // 云函数对批量写条目的支持（旧版本会返回 UNSUPPORTED_ACTION，表现为「AI 行程换设备就没了」）
  const probeTrip = 'probe_trip_x';
  const bulkRes = await cloudEnv.main({
    action: 'bulkAddTripItems', tripId: probeTrip,
    items: [{ _id: 'probe_titem_1', tripId: probeTrip, content: '探针条目', day: 1, startTime: '09:00' }]
  });
  console.log('     bulkAddTripItems = ' + JSON.stringify(bulkRes));
  eq('云函数支持 bulkAddTripItems', bulkRes.success, true);
  ok('bulkAddTripItems 保留前端 _id',
    cloudRows('tripItem', probeTrip).map((d) => d._id).indexOf('probe_titem_1') >= 0);

  /* ---------- 9. 删除行程 / 复制行程 ---------- */
  section('9. 删除行程（墓碑覆盖子项）与复制行程（副本不污染源行程）');

  const t5 = await store8.addTrip({ title: '待删行程', destination: '重庆', startDate: '2027-01-01', endDate: '2027-01-03' });
  await flush(10);
  await store8.applyPackingTemplate(t5._id, ['度假']);
  const t5packIds = store8.listPacking(t5._id).map((x) => x._id);
  await store8.applyRouteTemplate(t5._id, allRoutes[0].key);
  await flush(12);
  const t5itemIds = store8.listItems(t5._id).map((x) => x._id);
  ok('待删行程已备好子项', t5packIds.length > 0 && t5itemIds.length > 0,
    'pack=' + t5packIds.length + ' item=' + t5itemIds.length);

  await store8.removeTrip(t5._id);
  await flush(12);
  const tomb = mem.get('todo_app_travel_tomb') || {};
  ok('删行程后墓碑覆盖行程 id', !!tomb[t5._id]);
  ok('删行程后墓碑覆盖它的行李 id', t5packIds.every((id) => !!tomb[id]), t5packIds.length + ' 条');
  ok('删行程后墓碑覆盖它的条目 id', t5itemIds.every((id) => !!tomb[id]), t5itemIds.length + ' 条');
  eq('云端同步清了该行程的条目', cloudRows('tripItem', t5._id).length, 0);
  eq('云端同步清了该行程的行李', cloudRows('packing', t5._id).length, 0);

  // 复制行程：副本必须重新生成 id，绝不能把源条目原样发上云
  // （发源条目 → 云端按同 _id 落库 → 反而把源行程的条目 tripId 改成副本 id，等于搬空源行程）
  const t6 = await store8.addTrip({ title: '源行程', destination: '杭州', startDate: '2027-02-01', endDate: '2027-02-03' });
  await flush(10);
  await store8.applyPackingTemplate(t6._id, ['度假']);
  await store8.applyRouteTemplate(t6._id, allRoutes[0].key);
  await flush(12);
  const srcPack = store8.listPacking(t6._id).map((x) => x._id);
  const srcItem = store8.listItems(t6._id).map((x) => x._id);
  const srcBefore = srcPack.length;
  const copy = await store8.cloneTrip(t6._id, '2027-03-01');
  await flush(12);
  eq('源行程行李条数不变（副本不搬空源行程）', store8.listPacking(t6._id).length, srcBefore);
  eq('源行程条目条数不变', store8.listItems(t6._id).length, srcItem.length);
  const cloneCall = calls.filter((c) => c.action === 'cloneTrip').pop();
  const sentPacks = cloneCall ? (cloneCall.packing || []).map((x) => x._id) : [];
  const sentItems = cloneCall ? (cloneCall.items || []).map((x) => x._id) : [];
  ok('cloneTrip 送云端的是副本（行李 id 与源完全不重叠）',
    !!cloneCall && sentPacks.length === srcPack.length && sentPacks.every((id) => srcPack.indexOf(id) < 0),
    '源 ' + srcPack.length + ' 条 / 送云端 ' + sentPacks.length + ' 条 / 重叠 ' +
      sentPacks.filter((id) => srcPack.indexOf(id) >= 0).length + ' 条');
  ok('cloneTrip 送云端的条目也是副本（不是源条目）',
    sentItems.length === srcItem.length && sentItems.every((id) => srcItem.indexOf(id) < 0),
    '源 ' + srcItem.length + ' 条 / 送云端 ' + sentItems.length + ' 条 / 重叠 ' +
      sentItems.filter((id) => srcItem.indexOf(id) >= 0).length + ' 条');
  const copyCloudIds = cloudRows('packing', copy._id).map((d) => d._id);
  ok('副本也在云端落了库（含 _id）',
    store8.listPacking(copy._id).length > 0 &&
      store8.listPacking(copy._id).every((x) => copyCloudIds.indexOf(x._id) >= 0),
    '副本本地 ' + store8.listPacking(copy._id).length + ' / 云端 ' + copyCloudIds.length);

  /* ---------- 10. AI 调用：快、抗截断、不拖垮整个模块 ---------- */
  section('10. AI 调用稳定性（问题一续：延迟 / 截断 / 降级连带损伤）');

  // 10a. 请求参数：关思考（提速）、token 预算随天数、仍约束 JSON
  const cf10 = loadCloudFunction(AI_ENV_STUB);
  ['trips', 'travel_items', 'travel_notes'].forEach((c) => cf10.db.__create(c));
  let sent = null;
  useAIStub((host, body) => {
    sent = JSON.parse(body);
    return aiReply();
  });
  let ai10 = await cf10.main({ action: 'aiPlan', destination: '成都', days: 3, budget: 3000, members: [] });
  eq('aiPlan 成功', ai10.ok, true);
  ok('主档案带 thinking=disabled（关思考提速，实测平均 12.8s → 3.2s）',
    !!(sent && sent.thinking && sent.thinking.type === 'disabled'),
    'thinking=' + JSON.stringify(sent && sent.thinking));
  ok('max_tokens 随天数增长且封顶（长行程不至于吃光时间预算）',
    !!sent && sent.max_tokens >= 260 + 3 * 260 && sent.max_tokens <= 3200,
    'max_tokens=' + (sent && sent.max_tokens));
  ok('仍用 response_format=json_object 约束输出',
    !!(sent && sent.response_format && sent.response_format.type === 'json_object'));

  // 10b. 截断抢救：模型输出长度极不稳定（实测同一提示词 620~4800 字），
  //      超长会被 max_tokens 截断。截断若直接判失败，用户看到的就是「AI 用不了」，
  //      必须能救回截断前已写好的部分。
  const fullPlan = JSON.stringify(PLAN_JSON);
  const clipped = fullPlan.slice(0, Math.floor(fullPlan.length * 0.8));
  useAIStub(() => JSON.stringify({ choices: [{ message: { content: clipped } }] }));
  ai10 = await cf10.main({ action: 'aiPlan', destination: '成都', days: 3, budget: 3000, members: [] });
  ok('被截断的返回能救回大部分行程（不再整块失败）',
    ai10.ok === true && (ai10.items || []).length >= 2,
    'ok=' + ai10.ok + ' items=' + ((ai10.items || []).length) + ' / 截断后原始长度 ' + clipped.length);

  // 10c. AI 超时绝不能触发「整体降级」
  //      -404012（客户端只等 20s）原本命中 DEGRADE_PATTERNS，会把整个 travel 模块
  //      （含数据同步）打成本地 mock —— 表现为「用过一次 AI 之后，保存的东西就不上云了」。
  //      ⚠️ 本段刻意**不重载** utils/cloud.js：cloudDegraded 是模块级状态，
  //         重载会把它重置，就测不出「污染」了。
  mem.clear();
  currentEnvId = 'cloud1-test-env';
  let cloudHits = 0;
  cloudCallFunction = (o) => {
    cloudHits += 1;
    const act = o.data && o.data.action;
    if (act === 'aiStatus') {
      o.success({ result: { success: true, ok: true, ai: true } });
      return;
    }
    if (act === 'aiPlan') {
      o.fail({ errMsg: 'cloud.callFunction:fail Error: errCode: -404012 polling exceed max timeout' });
      return;
    }
    Promise.resolve()
      .then(() => cloudEnv.main(o.data))
      .then((r) => o.success({ result: r }))
      .catch((e) => o.fail({ errMsg: String((e && e.message) || e) }));
  };

  const probeA = await travelAI.enableAI();
  eq('AI 探测成功（能力开关已与数据同步解耦）', probeA.ok, true);
  toasts.length = 0;
  const genA = await travelAI.generatePlan({ destination: '成都', days: 3, budget: 2000, members: [] });
  eq('AI 超时时 generatePlan.ok = false', genA.ok, false);
  ok('超时给出可自救的文案（提示重试 / 减少天数）',
    /较慢|重试|天数/.test(genA.message || ''), 'message=' + genA.message);
  ok('AI 超时不弹「已切换本地模式」',
    !toasts.some((t) => String(t).indexOf('本地模式') >= 0), 'toasts=' + JSON.stringify(toasts));

  // 验证「cloudDegraded 未被 AI 超时污染」：数据类调用失败时**仍应正常提示降级**。
  // 被污染的话那句提示已经弹过，`if (!cloudDegraded)` 会跳过 → 不再提示。
  // ⚠️ 不要用「数据同步还能走云端」来判断：cloudDegraded 只影响当次降级，
  //    不阻止后续调用再试云端 —— 那样写断言恒真，抓不到任何回归。
  toasts.length = 0;
  cloudCallFunction = (o) => {
    o.fail({ errMsg: 'cloud.callFunction:fail Error: errCode: -404012 polling exceed max timeout' });
  };
  await store.syncCloud();
  await flush(12);
  ok('AI 超时后，数据类调用失败仍能正常提示降级（cloudDegraded 未被污染）',
    toasts.some((t) => String(t).indexOf('本地模式') >= 0), 'toasts=' + JSON.stringify(toasts));

  /* ---------- 汇总 ---------- */
  fs.rmSync(OUT, { recursive: true, force: true }); // 临时编译产物不留仓
  console.log('\n' + '='.repeat(60));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (fail) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  console.error('冒烟脚本自身异常：', err);
  process.exit(1);
});
