/**
 * 迷宫（路径迷宫）第 10 关手感冒烟 —— 离线可跑，不依赖真机与云。
 *
 * 背景：第 10 关是 20×20 + hard（完美迷宫），格子边长仅约 17px、小球约 10px，
 * 最短路径常在 80~200 步，且棋盘有 400 个格子。曾经的两类手感问题：
 *   ① 输入层：一次操作只走一格、滑动阈值比格子还宽、只在 touchend 判定、每步两次 setData；
 *   ② 渲染层（「小球移动时画面震荡」）：小球坐标挂在页面 data 上、wxml 对每格做
 *      trail/hintPath/demoPath 三次 indexOf 扫描、撞墙状态 bump 写进 400 个格子的 class
 *      （撞一下墙所有同向墙面一起抖）→ 走一步就整块棋盘重排，连走时持续掉帧发飘。
 *
 * 本脚本用桩加载真实 maze.js，断言这些问题都被修掉，并且难度没有被动过
 * （完美迷宫的树结构、墙判定、par / 提示次数均保持不变）。
 *
 * 用法：node scripts/check-maze-feel.js
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAZE_DIR = path.join(ROOT, 'miniprogram/subpackages/games/pages/games/maze');
const BALL_DIR = path.join(ROOT, 'miniprogram/subpackages/games/components/maze-ball');
const OUT = path.join(ROOT, '.tmp-check-maze');
const TSC = 'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';
const NODE = process.execPath;

/**
 * 拼接文件路径。
 * 注意：main() 内部有一个局部变量就叫 path（BFS 求出的路径数组），会遮蔽 path 模块，
 * 所以在模块顶层先捕获一份 join，供 main() 里做源码静态检查时使用。
 */
const joinPath = (...parts) => require('path').join(...parts);

let pass = 0;
const failures = [];
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 52 - t.length))); }
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✅ ' + name); }
  else { failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, actual, expect, extra) {
  ok(name, actual === expect, (extra || '') + '（实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expect) + '）');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function flush(n) {
  for (let i = 0; i < (n || 10); i += 1) await sleep(0);
}

/* ---------- 编译：把 ESM 的 maze.js 转成 CJS 以便 require ---------- */
function compile() {
  const src = path.join(ROOT, 'miniprogram/subpackages/games/pages/games/maze/maze.js');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(
    NODE,
    [
      TSC,
      src,
      '--allowJs',
      // 只编译 maze.js：utils/* 由下面的 stub 顶替，放进来编译反而会覆盖源文件（TS5055）
      '--noResolve',
      '--outDir', OUT,
      '--rootDir', path.dirname(src),
      '--module', 'commonjs',
      '--target', 'es2018',
      '--skipLibCheck'
    ],
    { stdio: 'pipe' }
  );
  const out = path.join(OUT, 'maze.js');
  if (!fs.existsSync(out)) throw new Error('编译未产出 ' + out);
  return out;
}

/* ---------- 小程序运行时桩 ---------- */
let vibrateCount = 0;
let toastCount = 0;
function makeWx() {
  return {
    getSystemInfoSync: () => ({ windowWidth: 375 }),
    getStorageSync: (k) => (k === 'maze_difficulty' ? 'hard' : ''),
    setStorageSync: () => {},
    showToast: () => { toastCount += 1; },
    vibrateShort: () => { vibrateCount += 1; },
    navigateBack: () => {},
    createSelectorQuery() {
      const api = {
        in() { return api; },
        select() { return api; },
        boundingClientRect() { return api; },
        exec(cb) { cb([{ width: 340 }]); } // 模拟 375px 屏上棋盘的可用宽度
      };
      return api;
    }
  };
}

let pageDef = null;
function makePage(def) { pageDef = def; }

/**
 * 小球组件桩：小球已经隔离进 maze-ball 组件，所以页面「移动 / 撞墙」的正确表现是
 * ——不 setData 页面，而是调用组件的 moveTo / bump。这里记录下来供断言。
 */
const ballStub = {
  setupArgs: null,
  moves: [],
  bumps: [],
  reset() { this.setupArgs = null; this.moves = []; this.bumps = []; },
  setup(cfg) { this.setupArgs = cfg; this.moves = []; this.bumps = []; },
  moveTo(left, top, moveMs) { this.moves.push({ left, top, moveMs }); },
  bump(dir) { this.bumps.push(dir); }
};

const stubs = {
  '../../../utils/nav': { replace: () => {} },
  '../../../utils/store': {
    getGame: () => ({ best: 0, unlocked: 10 }),
    finishRound: () => ({ isNewBest: false }),
    formatTime: () => '00:00'
  },
  '../../../utils/engine': {
    makeTimer: () => ({ start() {}, stop() {}, reset() {}, get: () => 0, toggle: () => true }),
    blessing: () => ''
  }
};

/** 造一个可驱动的页面实例；setData 同步合并（支持 'marks[i]' 路径键），回调排队等待 flush */
function instantiate(def) {
  const inst = {};
  const pending = [];
  Object.keys(def).forEach((k) => {
    if (typeof def[k] === 'function') inst[k] = def[k].bind(inst);
  });
  inst.data = JSON.parse(JSON.stringify(def.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      // 逐格标记是用 'marks[12]' 这类路径键下发的（单格更新），桩必须照做
      const m = /^([A-Za-z_$][\w$]*)\[(\d+)\]$/.exec(k);
      if (m && Array.isArray(inst.data[m[1]])) inst.data[m[1]][Number(m[2])] = patch[k];
      else inst.data[k] = patch[k];
    });
    setDataLog.push(patch);
    if (cb) pending.push(cb);
  };
  inst.selectComponent = () => ballStub;
  inst.__flushPending = function () {
    while (pending.length) pending.shift()();
  };
  return inst;
}
let setDataLog = [];

/* ---------- 迷宫结构判定（与页面实现独立，用于交叉验证） ---------- */
function openEdges(cells, n) {
  let edges = 0;
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      const cell = cells[r * n + c];
      if (!cell.t && r > 0) edges += 1;
      if (!cell.b && r < n - 1) edges += 1;
      if (!cell.l && c > 0) edges += 1;
      if (!cell.r && c < n - 1) edges += 1;
    }
  }
  return edges / 2;
}
function reachableCount(cells, n) {
  const seen = new Array(n * n).fill(false);
  const q = [0];
  seen[0] = true;
  let cnt = 1;
  while (q.length) {
    const cur = q.shift();
    const r = Math.floor(cur / n), c = cur % n, cell = cells[cur];
    const go = (nr, nc, blocked) => {
      if (blocked) return;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) return;
      const ni = nr * n + nc;
      if (seen[ni]) return;
      seen[ni] = true; cnt += 1; q.push(ni);
    };
    go(r - 1, c, cell.t); go(r + 1, c, cell.b); go(r, c - 1, cell.l); go(r, c + 1, cell.r);
  }
  return cnt;
}
/** 找一段可连续走 minLen 格的直线（用于验证连发/连滑），返回起点与方向 */
function findStraightRun(page, n, minLen) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let i = 0; i < n * n; i += 1) {
    for (let d = 0; d < dirs.length; d += 1) {
      const dr = dirs[d][0], dc = dirs[d][1];
      let cur = i;
      let good = true;
      for (let k = 0; k < minLen; k += 1) {
        const nr = Math.floor(cur / n) + dr, nc = (cur % n) + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) { good = false; break; }
        const nxt = nr * n + nc;
        if (!connected(page.data.cells, n, cur, nxt)) { good = false; break; }
        cur = nxt;
      }
      if (good) return { from: i, dr, dc };
    }
  }
  return null;
}

/** 从 from 到 to 的 BFS 路径（含两端），用于驱动「沿最短路走到底」 */
function bfsPath(cells, n, from, to) {
  const prev = new Array(n * n).fill(-1);
  const seen = new Array(n * n).fill(false);
  const q = [from];
  seen[from] = true;
  while (q.length) {
    const cur = q.shift();
    if (cur === to) break;
    const r = Math.floor(cur / n), c = cur % n, cell = cells[cur];
    const go = (nr, nc, blocked) => {
      if (blocked) return;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) return;
      const ni = nr * n + nc;
      if (seen[ni]) return;
      seen[ni] = true; prev[ni] = cur; q.push(ni);
    };
    go(r - 1, c, cell.t); go(r + 1, c, cell.b); go(r, c - 1, cell.l); go(r, c + 1, cell.r);
  }
  const out = [];
  let cur = to;
  while (cur !== -1) { out.push(cur); cur = prev[cur]; }
  return out.reverse();
}

/** 两格之间是否连通（依据墙数据）—— 用来证明「没有穿墙」 */
function connected(cells, n, a, b) {
  const r = Math.floor(a / n), c = a % n;
  const nr = Math.floor(b / n), nc = b % n;
  if (Math.abs(r - nr) + Math.abs(c - nc) !== 1) return false;
  const cell = cells[a];
  if (nr === r - 1) return !cell.t;
  if (nr === r + 1) return !cell.b;
  if (nc === c - 1) return !cell.l;
  if (nc === c + 1) return !cell.r;
  return false;
}

(async function main() {
  const compiled = compile();

  global.wx = makeWx();
  global.Page = makePage;
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return origLoad.call(this, request, parent, isMain);
  };
  require(compiled);
  Module._load = origLoad;

  if (!pageDef) { console.error('未捕获到 Page 定义'); process.exit(1); }

  /* ---------- 1. 第 10 关基线 ---------- */
  section('1. 第 10 关（20×20 · hard）的基线参数');
  const p = instantiate(pageDef);
  p.onLoad();
  for (let i = 0; i < 6; i += 1) { p.__flushPending(); await flush(4); }

  eq('关卡号 = 10', p.data.level, 10);
  eq('棋盘边长 = 20', p.data.cols, 20);
  eq('难度 = hard', p.data.diff, 'hard');
  eq('hard 的提示次数 = 2（未被改动）', p.data.hintLeft, 2);
  eq('hard 的演示次数 = 1（未被改动）', p.data.demoLeft, 1);

  const n = p.data.cols;
  const cellPx = p.data.cellPx;
  console.log('     cellPx=' + cellPx.toFixed(1) +
    '  ballSize=' + (ballStub.setupArgs && ballStub.setupArgs.size) +
    '  swipeStepPx=' + (p.swipeStepPx || 0).toFixed(1) +
    '  moveMs=' + (ballStub.setupArgs && ballStub.setupArgs.moveMs));
  ok('格子边长落在 20×20 的真实区间（12~22px）', cellPx >= 12 && cellPx <= 22, 'cellPx=' + cellPx.toFixed(1));
  ok('滑动触发位移 < 一格（小碎步也能走，原来阈值 ≈17px 比一格还宽）',
    p.swipeStepPx < cellPx, 'swipeStepPx=' + (p.swipeStepPx || 0).toFixed(1) + ' vs cellPx=' + cellPx.toFixed(1));
  ok('滑动触发位移不小于 9px 下限（防误触）', p.swipeStepPx >= 9, 'swipeStepPx=' + (p.swipeStepPx || 0).toFixed(1));
  ok('小球已交给独立组件（落位时拿到尺寸与补间时长）',
    !!ballStub.setupArgs && ballStub.setupArgs.size > 0, JSON.stringify(ballStub.setupArgs));
  eq('小格子用 80ms 补间（原固定 130ms 显得黏）', ballStub.setupArgs && ballStub.setupArgs.moveMs, 80);

  /* 渲染隔离的结构保证：页面 data 不再持有任何「画布级」字段。
     这些字段一旦留在 data，任何一次 setData 都会让 400 个格子的表达式重算。 */
  ['playerLeft', 'playerTop', 'ballSize', 'ballHalf', 'moveMs', 'bump', 'trail', 'hintPath', 'demoPath']
    .forEach((k) => eq('页面 data 已移除画布级字段 ' + k, p.data[k], undefined));
  ok('页面 data 改用逐格标记数组 marks（空 / hint / demo / crumb 四态）',
    Array.isArray(p.data.marks) && p.data.marks.length === n * n,
    'marks.length=' + ((p.data.marks && p.data.marks.length) || 0));

  /* ---------- 2. 难度护栏：迷宫仍是完美迷宫 ---------- */
  section('2. 难度护栏：迷宫结构与最少步数未被改动');
  eq('20×20 全连通（可达 400 格）', reachableCount(p.data.cells, n), 400);
  eq('完美迷宫边数 = 399（braid=0，无额外环路）', openEdges(p.data.cells, n), 399);
  const mine = bfsPath(p.data.cells, n, 0, n * n - 1);
  eq('par 与独立 BFS 算出的最短步数一致', p.data.par, mine.length - 1, 'par=' + p.data.par);
  console.log('     本局最短路径 = ' + p.data.par + ' 步');

  /* ---------- 3. 单步开销（跟手的硬指标） ---------- */
  section('3. 单步移动的开销量（原来一步要两次 setData + 整块棋盘重排）');
  const first = bfsPath(p.data.cells, n, 0, n * n - 1);
  const dr0 = Math.floor(first[1] / n) - Math.floor(first[0] / n);
  const dc0 = (first[1] % n) - (first[0] % n);
  setDataLog = [];
  ballStub.moves = [];
  p.moveDir(dr0, dc0);
  eq('一步只调用 1 次 setData（原为 2 次：主 setData + placePlayer）', setDataLog.length, 1,
    '实际 ' + setDataLog.length + ' 次');
  ok('setData 不再回传 history（20×20 关越走越大的元凶）',
    setDataLog[0] && setDataLog[0].history === undefined,
    'keys=' + JSON.stringify(Object.keys(setDataLog[0] || {})));
  ok('setData 不再回传整条面包屑数组 trail',
    !!setDataLog[0] && setDataLog[0].trail === undefined,
    'keys=' + JSON.stringify(Object.keys(setDataLog[0] || {})));
  ok('setData 不再回传提示路径 hintPath',
    !!setDataLog[0] && setDataLog[0].hintPath === undefined);
  ok('面包屑改为「只碰离开的那一格」的单格路径更新',
    !!setDataLog[0] && setDataLog[0]['marks[' + first[0] + ']'] === 'crumb',
    'pathKeys=' + JSON.stringify(Object.keys(setDataLog[0] || {}).filter((k) => k.indexOf('marks[') === 0)));
  ok('小球坐标 / 撞墙状态不进页面 setData（已收进组件）',
    !!setDataLog[0] && setDataLog[0].playerLeft === undefined &&
    setDataLog[0].playerTop === undefined && setDataLog[0].bump === undefined);
  eq('位移改由组件 moveTo 承担（本次 1 次）', ballStub.moves.length, 1);
  if (ballStub.moves.length) {
    const to = first[1];
    const expLeft = 4 + ((to % n) + 0.5) * cellPx;
    const expTop = 4 + (Math.floor(to / n) + 0.5) * cellPx;
    const mv = ballStub.moves[0];
    ok('小球目标坐标 = 目标格中心',
      Math.abs(mv.left - expLeft) < 0.01 && Math.abs(mv.top - expTop) < 0.01,
      'move=(' + mv.left.toFixed(1) + ',' + mv.top.toFixed(1) + ') 期望=(' + expLeft.toFixed(1) + ',' + expTop.toFixed(1) + ')');
    eq('小球补间时长随格子大小下发', mv.moveMs, 80);
  }
  const earlySize = JSON.stringify(setDataLog[0]).length;

  /* ---------- 4. 沿最短路走完：不穿墙 / 不越界 / 能通关 ---------- */
  section('4. 沿最短路径走到底：不穿墙、不越界、不卡住');
  // 回到起点重开一局，保证下面从 0 开始
  p.newGame();
  p.__flushPending();
  await flush(6);
  const path = bfsPath(p.data.cells, n, 0, n * n - 1);
  let bad = '';
  for (let i = 1; i < path.length; i += 1) {
    const from = p.data.player;
    const to = path[i];
    if (!connected(p.data.cells, n, from, to)) { bad = '第 ' + i + ' 步从 ' + from + ' 到 ' + to + ' 不连通'; break; }
    p.moveDir(Math.floor(to / n) - Math.floor(from / n), (to % n) - (from % n));
    if (p.data.player !== to) { bad = '第 ' + i + ' 步没走到目标格（期望 ' + to + '，实际 ' + p.data.player + '）'; break; }
    if (p.data.player < 0 || p.data.player >= n * n) { bad = '第 ' + i + ' 步越界：' + p.data.player; break; }
  }
  ok('全程每一步都合法（无穿墙 / 无越界 / 无卡住）', !bad, bad);
  eq('走完最短路径的步数 = par', p.data.steps, p.data.par);
  eq('每一步小球都收到了一次 moveTo（步数与位移次数一一对应）',
    ballStub.moves.length, p.data.steps, 'moves=' + ballStub.moves.length + ' steps=' + p.data.steps);
  eq('到达终点即判定通关', p.data.win, true);

  const late = setDataLog[setDataLog.length - 1];
  const lateSize = JSON.stringify(late).length;
  console.log('     首步 payload ' + earlySize + ' 字节 → 末步 ' + lateSize + ' 字节（走了 ' + p.data.steps + ' 步）');
  ok('走满全程后单次 payload 没有随步数膨胀（history 已移出 data）',
    lateSize < earlySize * 2, earlySize + ' → ' + lateSize);

  /* ---------- 5. 撞墙：位置不动 + 有反馈 + 不抖 ---------- */
  section('5. 撞墙：判定仍然挡住，但要有反馈且不抖');
  p.newGame();
  p.__flushPending();
  await flush(6);
  const cells2 = p.data.cells;
  // 找一个当前位置被挡住的方向
  // 优先挑「内部墙」（不越界）的方向；挑不到就用边界方向（边界也应有顶墙反馈）
  let blocked = null;
  const dirs = [['t', -1, 0], ['b', 1, 0], ['l', 0, -1], ['r', 0, 1]];
  for (let i = 0; i < dirs.length && !blocked; i += 1) {
    const [key, dr, dc] = dirs[i];
    if (!cells2[0][key]) continue;
    const inBoard = Math.floor(0 / n) + dr >= 0 && Math.floor(0 / n) + dr < n && (0 % n) + dc >= 0 && (0 % n) + dc < n;
    if (inBoard) blocked = { key, dr, dc };
  }
  if (!blocked) blocked = { key: 't', dr: -1, dc: 0 };
  const startWalls = ['t', 'b', 'l', 'r'].filter((k) => cells2[0][k]).length;
  ok('起点确有多面墙（完美迷宫的角落必有）', startWalls > 0, 'walls=' + startWalls);
  if (blocked) {
    const before = { player: p.data.player, steps: p.data.steps };
    ballStub.bumps = [];
    ballStub.moves = [];
    vibrateCount = 0;
    setDataLog = [];
    p.moveDir(blocked.dr, blocked.dc);
    eq('撞墙后位置不变（判定没被放宽）', p.data.player, before.player);
    eq('撞墙后步数不变', p.data.steps, before.steps);
    eq('撞墙反馈转交小球组件（顶墙回弹用）',
      ballStub.bumps[ballStub.bumps.length - 1], blocked.key);
    eq('撞墙不再 setData 整页 —— 棋盘零重排（震荡的主来源被掐掉）',
      setDataLog.length, 0, '实际 ' + setDataLog.length + ' 次');
    eq('撞墙不产生小球位移（只是原地回弹）', ballStub.moves.length, 0);

    // 连续 6 次撞同一面墙：震动被节流；页面依旧零 setData（原来每次都要改 400 格 class）
    vibrateCount = 0;
    setDataLog = [];
    for (let i = 0; i < 6; i += 1) p.moveDir(blocked.dr, blocked.dc);
    ok('连撞同一面墙时触感被节流（≤2 次）', vibrateCount <= 2, 'vibrate=' + vibrateCount);
    eq('连撞后位置依然不动', p.data.player, before.player);
    eq('连撞 6 次仍然零整页 setData', setDataLog.length, 0, '实际 ' + setDataLog.length + ' 次');
    eq('每次撞墙都如实转交组件（是否重放动画由组件内的节流决定）',
      ballStub.bumps.length, 7, 'bumps=' + ballStub.bumps.length);
  }

  /* ---------- 6. 连续输入：不丢步、有上限 ---------- */
  section('6. 连续输入：排队不丢步，队列有上限');
  p.newGame();
  p.__flushPending();
  await flush(6);
  const run = findStraightRun(p, n, 5);
  ok('能找到一段 ≥5 格的直线通路（20×20 完美迷宫必有）', !!run);
  if (run) {
    p.setData({ player: run.from, steps: 0 });
    for (let i = 0; i < 5; i += 1) p.requestMove(run.dr, run.dc); // 模拟极快连滑/连点
    await sleep(700);
    eq('快速连发 5 次全部兑现（不丢步）', p.data.steps, 5, '实际走 ' + p.data.steps);
    eq('执行完队列已清空', (p._queue || []).length, 0);
  }

  // 队列上限：手指糊上去一大串也不会无限排队
  p.newGame();
  p.__flushPending();
  await flush(6);
  const run2 = findStraightRun(p, n, 5) || { from: 0, dr: 1, dc: 0 };
  p.setData({ player: run2.from, steps: 0 });
  for (let i = 0; i < 20; i += 1) p.requestMove(run2.dr, run2.dc);
  ok('输入队列有上限（防手指糊上去后小球停不下来）', (p._queue || []).length <= 5,
    'queue=' + (p._queue || []).length);
  await sleep(900);

  /* ---------- 7. 方向键：按下即走、短按一格、松手停 ---------- */
  section('7. 方向键：按下即走 + 长按连发 + 松手即停');
  p.newGame();
  p.__flushPending();
  await flush(6);
  const run3 = findStraightRun(p, n, 4) || { from: 0, dr: 1, dc: 0 };
  p.setData({ player: run3.from, steps: 0 });
  const s0 = p.data.steps;
  p.onDirStart({ currentTarget: { dataset: { dr: String(run3.dr), dc: String(run3.dc) } } });
  await sleep(120); // 还没松手
  ok('还没抬手就已经走了一格（原来 bindtap 必须松手才响应）', p.data.steps >= s0 + 1,
    'steps=' + p.data.steps);
  p.onDirEnd();
  const afterTap = p.data.steps;
  await sleep(400);
  eq('短按（立即松手）只在按下时走一格，不会连发', p.data.steps, afterTap);
  ok('松手后连发定时器已清理', !p._holdInt, '_holdInt=' + p._holdInt);
  eq('松手后方向状态已清空', p._holdDir, null);

  // 长按：260ms 后开始连发；松手要立刻停，且清掉还没走的排队
  p.setData({ player: run3.from, steps: 0 });
  p._queue = [];
  const s1 = p.data.steps;
  p.onDirStart({ currentTarget: { dataset: { dr: String(run3.dr), dc: String(run3.dc) } } });
  await sleep(700); // 越过 260ms 门槛，按 105ms 节奏连发
  const held = p.data.steps - s1;
  p.onDirEnd();
  ok('按住不放会连发（>1 步）', held > 1, '按住 700ms 走了 ' + held + ' 步（受墙限制）');
  await sleep(300);
  eq('松手后不再继续走', p.data.steps, s1 + held);

  /* ---------- 8. 撤销与 history ---------- */
  section('8. 撤销：history 移出 data 后仍可回退');
  p.newGame();
  p.__flushPending();
  await flush(6);
  eq('data 里不再有 history 字段', p.data.history, undefined);
  const pp = bfsPath(p.data.cells, n, 0, n * n - 1);
  const a = pp[0], b = pp[1];
  p.moveDir(Math.floor(b / n) - Math.floor(a / n), (b % n) - (a % n));
  const atB = p.data.player;
  p.onUndo();
  p.__flushPending();
  eq('撤销回到上一格', p.data.player, a, '当前 ' + p.data.player + '（撤销前 ' + atB + '）');
  eq('撤销后步数回退', p.data.steps, 0);
  eq('撤销后 canUndo = false', p.data.canUndo, false);

  /* ---------- 9. 暂停 / 卸载不残留输入 ---------- */
  section('9. 暂停与卸载：不残留排队输入');
  p.newGame();
  p.__flushPending();
  await flush(6);
  p.requestMove(run3.dr, run3.dc);
  p.onPause();
  const pausedAt = p.data.player;
  await sleep(300);
  eq('暂停后队列被清空，不再继续走', (p._queue || []).length, 0);
  eq('暂停后位置不变', p.data.player, pausedAt);
  p.onUnload();
  eq('卸载后连发定时器已清理', p._holdInt, null);
  eq('卸载后排队定时器已清理', p._pumpTimer, null);

  /* ---------- 10. 结构护栏：移动不再牵动整块棋盘（源码级） ---------- */
  section('10. 结构护栏（源码级）：移动 / 撞墙不再牵动 400 格棋盘');
  const mazeWxml = fs.readFileSync(joinPath(MAZE_DIR, 'maze.wxml'), 'utf8');
  const mazeJsSrc = fs.readFileSync(joinPath(MAZE_DIR, 'maze.js'), 'utf8');
  const mazeWxss = fs.readFileSync(joinPath(MAZE_DIR, 'maze.wxss'), 'utf8');
  const ballJs = fs.readFileSync(joinPath(BALL_DIR, 'index.js'), 'utf8');
  const ballWxml = fs.readFileSync(joinPath(BALL_DIR, 'index.wxml'), 'utf8');

  ok('棋盘不再对每格做 indexOf 扫描（trail/hintPath/demoPath 三个数组已下线）',
    mazeWxml.indexOf('indexOf(') === -1,
    '仍存在 indexOf：' + (mazeWxml.match(/[^\s]*indexOf\([^\s]*/g) || []).slice(0, 3).join(' '));
  ok('撞墙样式不再挂在格子上（原来一次撞墙要让所有同向墙面一起位移）',
    mazeWxml.indexOf('mz__cell--bump') === -1 && mazeWxss.indexOf('mz__cell--bump') === -1);
  ok('小球由独立组件承载', mazeWxml.indexOf('<maze-ball') >= 0);
  ok('组件的页面对接点齐全（setup / moveTo / bump）',
    mazeJsSrc.indexOf('ball.setup(') >= 0 && mazeJsSrc.indexOf('ball.moveTo(') >= 0 &&
    mazeJsSrc.indexOf('ball.bump(') >= 0);
  ok('组件内对「同向连撞」做了节流（避免顶墙时动画反复重放）',
    ballJs.indexOf('_bumpAt') >= 0 && ballJs.indexOf('150') >= 0);
  ok('组件支持 instant 落位（换关瞬移，不播补间）',
    ballJs.indexOf('instant') >= 0 && ballWxml.indexOf('instant ? 0 : moveMs') >= 0 &&
    mazeJsSrc.indexOf('placePlayer(true)') >= 0);
  ok('小球位移层独立合成（will-change: transform）', ballWxml.indexOf('translate3d') >= 0);
  ok('进度条改由 transform 驱动（width 过渡会每帧触发布局）',
    mazeWxss.indexOf('transition: width') === -1 && mazeWxml.indexOf('scaleX') >= 0);

  /* ---------- 汇总 ---------- */
  console.log('\n' + '='.repeat(60));
  console.log('通过 ' + pass + ' / 失败 ' + failures.length);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  console.log('='.repeat(60));
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error('冒烟脚本自身异常：', err);
  try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  process.exit(1);
});
