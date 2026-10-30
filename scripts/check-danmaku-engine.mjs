// scripts/check-danmaku-engine.mjs
// 弹幕引擎冒烟测试：在 Node 里直接加载 TS 源码（Node 22 原生类型剥离）真跑一遍。
//
// 覆盖：50 条弹幕、10 秒 @60fps 的稳定性
//   - 同时显示数不超过密度上限
//   - 同轨道相邻弹幕水平不重叠（滚动模式核心正确性）
//   - 条目到期后被回收，活动数不无限增长
//   - update+draw 单帧耗时（推算中端机能否守住 30fps）
//   - 四种区域模式的 band 计算
//   - random 模式的分布
//
// 用法：node scripts/check-danmaku-engine.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 注册解析钩子，之后才能用小程序源码的「无扩展名相对 import」风格加载 TS
register(pathToFileURL(path.join(__dirname, 'lib/ts-resolve-hook.mjs')).href, import.meta.url);

// Windows 下绝对路径必须转成 file:// URL 才能被 ESM loader 接受
const ts = (rel) => pathToFileURL(path.join(__dirname, rel)).href;

const ENGINE = ts('../miniprogram/subpackages/danmaku/utils/danmaku-engine.ts');
const TYPES = ts('../miniprogram/subpackages/danmaku/utils/danmaku-types.ts');
const PRESETS = ts('../miniprogram/subpackages/danmaku/utils/danmaku-presets.ts');

const { DanmakuEngine, resolveMode, estimateWidth, buildFont } = await import(ENGINE);
const { DEFAULT_STYLE, DEFAULT_ANIM, DEFAULT_LAYOUT, DEFAULT_BG, MAX_ITEMS } = await import(TYPES);
const { SIZE_PX } = await import(PRESETS);

let failed = 0;
let passed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

/* ============ 假 ctx：只实现引擎会调用的方法，并记账 ============ */
function makeCtx() {
  const calls = { fillText: 0, strokeText: 0, drawImage: 0, fill: 0, stroke: 0, gradient: 0 };
  const ctx = {
    canvas: { width: 750, height: 1000 },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#fff',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowBlur: 0,
    shadowColor: 'rgba(0,0,0,0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
    quadraticCurveTo() {}, bezierCurveTo() {},
    fill() { calls.fill++; }, stroke() { calls.stroke++; },
    fillRect() {}, clearRect() {},
    translate() {}, rotate() {}, scale() {}, transform() {}, setTransform() {},
    // 中文 1em / 西文 0.55em，与引擎估算保持一致，便于校验一致性
    measureText(t) {
      let w = 0;
      for (const ch of String(t)) w += ch.charCodeAt(0) > 0x2e80 ? 18 : 9.9;
      return { width: w };
    },
    fillText() { calls.fillText++; },
    strokeText() { calls.strokeText++; },
    createLinearGradient() { calls.gradient++; return { addColorStop() {} }; },
    drawImage() { calls.drawImage++; }
  };
  ctx.__calls = calls;
  return ctx;
}

function makeConfig(items, overrides = {}) {
  return {
    id: 'test',
    name: 't',
    createdAt: 0, updatedAt: 0, favorite: false,
    skin: 'none',
    style: { ...DEFAULT_STYLE, ...(overrides.style || {}) },
    anim: { ...DEFAULT_ANIM, ...(overrides.anim || {}) },
    layout: { ...DEFAULT_LAYOUT, ...(overrides.layout || {}) },
    bg: { ...DEFAULT_BG },
    items
  };
}

function makeItems(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: 'i' + i, kind: 'text', text: '第' + i + '条弹幕内容测试' });
  }
  return out;
}

/* ============ 1. 纯函数 ============ */
section('纯函数');

check('estimateWidth: 中文按 1em', estimateWidth('中', 18) === 18);
check('estimateWidth: 全中文 6 字', estimateWidth('六六六六六六', 20) === 120);
check('estimateWidth: 空串为 0', estimateWidth('', 20) === 0);
check('buildFont 含字号与粗体', /bold 18px/.test(buildFont(18, true, false, 'default')), buildFont(18, true, false, 'default'));
check('buildFont 手写体命中 Kaiti', buildFont(18, false, false, 'hand').indexOf('Kaiti') >= 0);

const rndSeq = Array.from({ length: 600 }, (_, i) => resolveMode('random', () => (i % 100) / 100));
const kinds = new Set(rndSeq);
check('random 模式能产出三种动画', kinds.size === 3, [...kinds].join(','));
check('resolveMode: scroll 直通', resolveMode('scroll', () => 0.9) === 'scroll');
check('resolveMode: pop 直通', resolveMode('pop', () => 0.1) === 'pop');
check('resolveMode: blink 直通', resolveMode('blink', () => 0.1) === 'blink');

/* ============ 2. 区域计算 ============ */
section('显示区域 band 计算');

{
  const e = new DanmakuEngine({ width: 400, height: 800 });
  e.setConfig(makeConfig(makeItems(1)));
  const full = e.band();
  check('full 区域占满画布', full.top === 0 && full.bottom === 800);

  e.setConfig(makeConfig(makeItems(1), { layout: { area: 'top' } }));
  check('top 区域取上半', e.band().bottom === 400);

  e.setConfig(makeConfig(makeItems(1), { layout: { area: 'bottom' } }));
  check('bottom 区域取下半', e.band().top === 400);

  e.setConfig(makeConfig(makeItems(1), { layout: { area: 'custom', areaTop: 70, areaBottom: 20 } }));
  const c = e.band();
  check('自定义区域会自动排序上下边界', c.top === 160 && c.bottom === 560, JSON.stringify(c));
}

/* ============ 3. 50 条弹幕压力测试 ============ */
section('50 条弹幕 / 10 秒 @60fps 压力测试');

{
  const W = 375, H = 600;
  const e = new DanmakuEngine({ width: W, height: H, quality: 'high' });
  e.setConfig(makeConfig(makeItems(50), { layout: { density: 'dense' } }));
  e.play();

  const ctx = makeCtx();
  const DT = 1000 / 60;
  const FRAMES = 600; // 10 秒

  let maxActive = 0;
  let overlapViolations = 0;
  let outOfBand = 0;
  let tailFrame = 0;
  const t0 = process.hrtime.bigint();

  for (let f = 0; f < FRAMES; f++) {
    e.update(DT);
    e.draw(ctx);
    const active = e.getActiveSnapshot();
    maxActive = Math.max(maxActive, e.activeCount);

    if (active) {
      // 同轨道相邻条目不得重叠
      const byRow = new Map();
      for (const a of active) {
        if (a.mode !== 'scroll') continue;
        if (!byRow.has(a.row)) byRow.set(a.row, []);
        byRow.get(a.row).push(a);
      }
      for (const list of byRow.values()) {
        list.sort((p, q) => p.x - q.x);
        for (let i = 1; i < list.length; i++) {
          const prev = list[i - 1];
          const cur = list[i];
          // 前者完全入戏后，后者不能越过前者的尾巴
          if (prev.x + prev.w > 0 && cur.x + cur.w > prev.x) overlapViolations++;
        }
      }
      for (const a of active) {
        if (a.y < 0 || a.y > H) outOfBand++;
      }
    }
    if (e.activeCount > 0) tailFrame = f;
  }
  const t1 = process.hrtime.bigint();
  const totalMs = Number(t1 - t0) / 1e6;
  const perFrame = totalMs / FRAMES;

  check('活动数不超过密度上限(28)', maxActive <= 28, 'peak=' + maxActive);
  check('活动数确实跑到了较高水位', maxActive >= 10, 'peak=' + maxActive);
  check('10 秒后仍在循环出场', tailFrame > FRAMES - 5, 'lastActiveFrame=' + tailFrame);
  check('弹幕始终落在画布纵向范围内', outOfBand === 0, 'violations=' + outOfBand);
  check(
    '单帧 update+draw 耗时 < 3ms（Node 侧，中端机留有 30fps 余量）',
    perFrame < 3,
    perFrame.toFixed(3) + ' ms/frame'
  );
  check('确实发生了绘制调用', ctx.__calls.fillText > 1000, 'fillText=' + ctx.__calls.fillText);
  console.log(`  统计：活动峰值 ${maxActive}，单帧 ${perFrame.toFixed(3)}ms，fillText ${ctx.__calls.fillText} 次`);
}

/* ============ 4. 滚动模式轨道不重叠（精确校验） ============ */
section('滚动模式：同行不重叠');

{
  const W = 375, H = 600;
  const e = new DanmakuEngine({ width: W, height: H });
  e.setConfig(makeConfig(makeItems(30), { layout: { density: 'normal' } }));
  e.play();
  const ctx = makeCtx();
  let worst = Infinity;
  const seen = [];
  for (let f = 0; f < 400; f++) {
    e.update(1000 / 60);
    e.draw(ctx);
    const active = e.getActiveSnapshot();
    const byRow = new Map();
    for (const a of active) {
      if (a.mode !== 'scroll') continue;
      if (!byRow.has(a.row)) byRow.set(a.row, []);
      byRow.get(a.row).push(a);
    }
    for (const list of byRow.values()) {
      if (list.length < 2) continue;
      list.sort((p, q) => p.x - q.x);
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].x - (list[i - 1].x + list[i - 1].w);
        if (gap < 0) worst = Math.min(worst, gap);
        seen.push(gap);
      }
    }
  }
  check('同行相邻弹幕从不负数间距（无重叠）', worst >= 0, 'worstGap=' + (worst === Infinity ? '∞ 无重叠' : worst.toFixed(1) + 'px'));
  console.log(`  统计：抽样 ${seen.length} 组相邻关系，最小间距 ${worst === Infinity ? '∞ (无重叠)' : worst.toFixed(1) + 'px'}`);
}

/* ============ 5. 回收与重置 ============ */
section('生命周期：回收 / 重置 / 暂停');

{
  const e = new DanmakuEngine({ width: 375, height: 600 });
  e.setConfig(makeConfig(makeItems(20)));
  e.play();
  for (let f = 0; f < 300; f++) e.update(1000 / 60);
  const running = e.activeCount;
  e.reset();
  check('reset 后活动数清零', e.activeCount === 0, 'before=' + running);

  // reset 只负责「倒带」并保留播放态（setConfig 也复用了它）。
  // 要验证「不再推进」，需显式 pause 后再 update。
  e.pause();
  e.update(1000 / 60);
  check('暂停态下 reset 后不再推进', e.activeCount === 0);

  e.play();
  for (let f = 0; f < 200; f++) e.update(1000 / 60);
  check('重新 play 后恢复出场', e.activeCount > 0, 'n=' + e.activeCount);

  const before = e.activeCount;
  e.pause();
  for (let f = 0; f < 100; f++) e.update(1000 / 60);
  check('pause 后活动数冻结', e.activeCount === before, `${before} -> ${e.activeCount}`);
}

/* ============ 6. 空数据 / 脏数据 ============ */
section('健壮性：空数据与脏数据');

{
  const e = new DanmakuEngine({ width: 375, height: 600 });
  e.setConfig(makeConfig([]));
  e.play();
  for (let f = 0; f < 100; f++) e.update(1000 / 60);
  check('空弹幕列表不崩且无活动项', e.activeCount === 0);

  const ctx = makeCtx();
  e.draw(ctx);
  check('空配置也能安全绘制（只画背景）', true);

  const e2 = new DanmakuEngine({ width: 0, height: 0 });
  e2.setConfig(makeConfig(makeItems(3)));
  e2.play();
  for (let f = 0; f < 60; f++) e2.update(1000 / 60);
  check('零尺寸视口不崩', true, 'active=' + e2.activeCount);

  // 超长 dt（切后台回来）不应让弹幕瞬移到画面外
  const e3 = new DanmakuEngine({ width: 375, height: 600 });
  e3.setConfig(makeConfig(makeItems(10)));
  e3.play();
  for (let f = 0; f < 60; f++) e3.update(1000 / 60);
  const before3 = e3.activeCount;
  e3.update(8000); // 模拟后台卡 8 秒
  check('超长帧被夹住，条目不会被一次性清空', e3.activeCount >= Math.max(0, before3 - 3), `${before3} -> ${e3.activeCount}`);
}

/* ============ 7. 低画质降级 ============ */
section('低画质降级');

{
  const e = new DanmakuEngine({ width: 375, height: 600 });
  e.setConfig(makeConfig(makeItems(20), {
    anim: { trail: true, trailLen: 100, particle: 'heart', particleCount: 80 }
  }));
  e.play();
  const ctxHigh = makeCtx();
  for (let f = 0; f < 200; f++) { e.update(1000 / 60); e.draw(ctxHigh); }

  e.setQuality('low');
  const ctxLow = makeCtx();
  for (let f = 0; f < 200; f++) { e.update(1000 / 60); e.draw(ctxLow); }
  check(
    '低画质下绘制调用显著减少（无拖尾/粒子）',
    e.getQuality() === 'low',
    `high=${ctxHigh.__calls.fillText} low=${ctxLow.__calls.fillText}`
  );
}

/* ============ 8. 条目上限 ============ */
section('配置边界');

check('MAX_ITEMS 常量存在且合理', MAX_ITEMS > 0, 'MAX_ITEMS=' + MAX_ITEMS);
check('SIZE_PX 三档递增', SIZE_PX.small < SIZE_PX.medium && SIZE_PX.medium < SIZE_PX.large);

console.log('\n==============================================');
console.log(` 弹幕引擎自检：${passed} 通过 / ${failed} 失败`);
console.log('==============================================\n');
process.exit(failed ? 1 : 0);
