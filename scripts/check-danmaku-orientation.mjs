// scripts/check-danmaku-orientation.mjs
// 弹幕「方向 / 全屏 / 安全区」适配冒烟测试：在 Node 里直接加载 TS 源码真跑一遍。
//
// 覆盖：
//   - 方向判定 detectOrientation（含正方形按竖屏的保守约定）
//   - safeArea → 窗口避让换算、画布局部折算、逐边并集、极端值收敛
//   - 引擎：安全区是否真的约束了「轨道范围」与「横向行程」
//   - 旋转连续性：视口变化后活动条目不闪断、滚动条目位置不跳变、行号/坐标合法
//   - 竖屏 vs 横屏差异：横屏轨道更少、同一条弹幕行程更长（看得更久）
//   - 旋转后继续播放仍不越界、不退化
//
// 用法：node scripts/check-danmaku-orientation.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(__dirname, 'lib/ts-resolve-hook.mjs')).href, import.meta.url);

const ts = (rel) => pathToFileURL(path.join(__dirname, rel)).href;

const ORIENT = ts('../miniprogram/subpackages/danmaku/utils/danmaku-orientation.ts');
const ENGINE = ts('../miniprogram/subpackages/danmaku/utils/danmaku-engine.ts');
const TYPES = ts('../miniprogram/subpackages/danmaku/utils/danmaku-types.ts');

const {
  detectOrientation,
  insetsFromSafeArea,
  toLocalInsets,
  maxInsets,
  clampInsets,
  orientationLabel,
  describeMetrics,
  MIN_BAND_V,
  MIN_BAND_H
} = await import(ORIENT);
const { DanmakuEngine } = await import(ENGINE);
const { DEFAULT_STYLE, DEFAULT_ANIM, DEFAULT_LAYOUT, DEFAULT_BG } = await import(TYPES);

let passed = 0;
let failed = 0;
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

function makeConfig(items, overrides = {}) {
  return {
    id: 'test',
    name: 't',
    createdAt: 0,
    updatedAt: 0,
    favorite: false,
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
  for (let i = 0; i < n; i++) out.push({ id: 'i' + i, kind: 'text', text: '第' + i + '条弹幕内容测试' });
  return out;
}

/* ============ 1. 方向判定 ============ */
section('方向判定');
check('竖屏 375×667', detectOrientation(375, 667) === 'portrait');
check('横屏 667×375', detectOrientation(667, 375) === 'landscape');
check('正方形按竖屏处理（保守）', detectOrientation(400, 400) === 'portrait');
check('方向中文名', orientationLabel('landscape') === '横屏' && orientationLabel('portrait') === '竖屏');

/* ============ 2. 安全区换算 ============ */
section('安全区换算');
{
  // 竖屏刘海机：顶部 44 状态栏，底部 34 指示条
  const p = insetsFromSafeArea(375, 812, { left: 0, top: 44, right: 375, bottom: 778, width: 375, height: 734 });
  check('竖屏：顶部避让=状态栏高', p.top === 44, JSON.stringify(p));
  check('竖屏：底部避让=指示条高', p.bottom === 34, 'bottom=' + p.bottom);
  check('竖屏：左右无避让', p.left === 0 && p.right === 0);

  // 横屏左侧挖孔：safeArea.left=44
  const l = insetsFromSafeArea(812, 375, { left: 44, top: 0, right: 812, bottom: 375, width: 768, height: 375 });
  check('横屏：左侧挖孔→左避让 44', l.left === 44, JSON.stringify(l));
  check('横屏：右侧无挖孔→右避让 0', l.right === 0);

  check('缺省 safeArea 时零避让（宁可不动）', JSON.stringify(insetsFromSafeArea(375, 667, null)) === JSON.stringify({ top: 0, bottom: 0, left: 0, right: 0 }));

  // 画布局部折算：画布不从窗口 (0,0) 起
  const metrics = { width: 375, height: 812, insets: { top: 44, bottom: 34, left: 0, right: 0 }, pixelRatio: 3, orientation: 'portrait', statusBarHeight: 44, menuBottom: 82 };
  const local = toLocalInsets({ left: 0, top: 100, width: 375, height: 678 }, metrics);
  check('画布在顶部避让之下 → 局部顶部避让为 0', local.top === 0, JSON.stringify(local));
  check('画布底边正好落在安全区内 → 局部底部避让为 0', local.bottom === 0, JSON.stringify(local));
  const localHalf = toLocalInsets({ left: 0, top: 0, width: 375, height: 800 }, metrics);
  check('画布延伸到安全区之外 → 局部底部避让只算重叠那段', localHalf.bottom === 22, JSON.stringify(localHalf));
  const local2 = toLocalInsets({ left: 0, top: 0, width: 375, height: 812 }, metrics);
  check('全屏画布 → 局部避让等于窗口避让', local2.top === 44 && local2.bottom === 34);

  const merged = maxInsets({ top: 0, bottom: 0, left: 0, right: 0 }, { top: 44, bottom: 0, left: 0, right: 0 });
  check('逐边取较大值（并集）', merged.top === 44);

  const c = clampInsets({ top: 300, bottom: 300, left: 400, right: 400 }, 375, 375);
  check('极端纵向避让被收敛，仍留可用轨道', c.top + c.bottom <= 375 - MIN_BAND_V + 0.001, JSON.stringify(c));
  check('极端横向避让被收敛，仍留可用行程', c.left + c.right <= 375 - MIN_BAND_H + 0.001, JSON.stringify(c));

  const desc = describeMetrics(metrics);
  check('方向描述可用于 UI 提示', desc.indexOf('竖屏') === 0 && desc.indexOf('避让') > 0, desc);
}

/* ============ 3. 安全区是否真的约束了引擎 ============ */
section('安全区约束引擎轨道与行程');
const INSET_P = { top: 44, bottom: 34 };                     // 竖屏
const INSET_L = { top: 0, bottom: 21, left: 44, right: 44 }; // 横屏（左挖孔）
{
  const e = new DanmakuEngine({ width: 667, height: 375, insets: INSET_L });
  e.setConfig(makeConfig(makeItems(12), { layout: { density: 'normal' } }));
  e.play();
  for (let f = 0; f < 400; f++) e.update(1000 / 60);

  const info = e.viewportInfo();
  check('band.top 让出顶部避让', info.band.top === INSET_L.top, 'band.top=' + info.band.top);
  check('band.bottom 让出底部避让', Math.abs(info.band.bottom - (375 - INSET_L.bottom)) < 0.001, 'band.bottom=' + info.band.bottom);
  check('横向行程按左右避让收缩', info.travelLeft === 44 && info.travelRight === 667 - 44, `[${info.travelLeft}, ${info.travelRight}]`);

  let outVertical = 0;
  let outTravel = 0;
  for (let f = 0; f < 500; f++) {
    e.update(1000 / 60);
    const snap = e.getActiveSnapshot();
    for (const a of snap) {
      if (a.y < info.band.top - 0.5 || a.y > info.band.bottom + 0.5) outVertical++;
      if (a.mode === 'scroll' && a.x > info.travelRight + 1) outTravel++;
    }
  }
  check('全部弹幕落在安全区纵向范围内（不遮挡上下控件）', outVertical === 0, 'violations=' + outVertical);
  check('滚动弹幕不越出安全横向行程（避开左右挖孔）', outTravel === 0, 'violations=' + outTravel);
}

/* ============ 4. 旋转连续性（核心） ============ */
section('旋转连续性：不闪断 / 不跳变');
{
  const e = new DanmakuEngine({ width: 375, height: 667, insets: INSET_P });
  e.setConfig(makeConfig(makeItems(24), { layout: { density: 'normal' } }));
  e.play();
  for (let f = 0; f < 150; f++) e.update(1000 / 60);

  const before = e.getActiveSnapshot().map((a) => ({ id: a.item.id, x: a.x, y: a.y, mode: a.mode, life: a.life }));
  const infoBefore = e.viewportInfo();
  check('竖屏已正常出场若干条', before.length > 0, 'n=' + before.length);

  // ── 旋转 ──
  e.setViewport(667, 375, INSET_L);

  const after = e.getActiveSnapshot();
  check('旋转后活动条目未被清空（不闪断）', after.length > 0 && after.length === before.length, `${before.length} -> ${after.length}`);

  let maxJump = 0;
  let matched = 0;
  for (const a of after) {
    const b = before.find((p) => p.id === a.item.id);
    if (!b) continue;
    matched++;
    if (a.mode === 'scroll') maxJump = Math.max(maxJump, Math.abs(a.x - b.x));
  }
  check('原条目全部还在（同一批）', matched === before.length, `matched=${matched}/${before.length}`);
  check('滚动条目位置连续、无跳变', maxJump <= 2, 'maxJump=' + maxJump.toFixed(2) + 'px');

  const infoAfter = e.viewportInfo();
  let badRow = 0;
  let badY = 0;
  for (const a of after) {
    if (a.row < 0 || a.row >= infoAfter.rowCount) badRow++;
    if (a.y < infoAfter.band.top - 0.5 || a.y > infoAfter.band.bottom + 0.5) badY++;
  }
  check('旋转后行号落在新轨道数范围内', badRow === 0, 'bad=' + badRow);
  check('旋转后纵向坐标落在新安全区内', badY === 0, 'bad=' + badY);

  // 继续播放：不越界、仍在循环
  let out = 0;
  for (let f = 0; f < 400; f++) {
    e.update(1000 / 60);
    for (const a of e.getActiveSnapshot()) {
      if (a.y < infoAfter.band.top - 0.5 || a.y > infoAfter.band.bottom + 0.5) out++;
    }
  }
  check('旋转后继续播放仍不越界', out === 0, 'out=' + out);
  check('旋转后仍持续出场', e.activeCount > 0, 'n=' + e.activeCount);

  // 反复来回旋转不应累积异常
  for (let k = 0; k < 6; k++) {
    e.setViewport(k % 2 === 0 ? 375 : 667, k % 2 === 0 ? 667 : 375, k % 2 === 0 ? INSET_P : INSET_L);
    for (let f = 0; f < 30; f++) e.update(1000 / 60);
  }
  let out2 = 0;
  const fin = e.viewportInfo();
  for (const a of e.getActiveSnapshot()) {
    if (a.y < fin.band.top - 0.5 || a.y > fin.band.bottom + 0.5) out2++;
    if (a.row < 0 || a.row >= fin.rowCount) out2++;
  }
  check('连续来回旋转 6 次后依然合法', out2 === 0, 'bad=' + out2);
}

/* ============ 5. 竖屏 vs 横屏差异 ============ */
section('竖屏 vs 横屏显示差异');
{
  const ep = new DanmakuEngine({ width: 375, height: 667, insets: INSET_P });
  ep.setConfig(makeConfig(makeItems(6)));
  ep.play();
  for (let f = 0; f < 12; f++) ep.update(1000 / 60);
  const sp = ep.getActiveSnapshot().find((a) => a.mode === 'scroll');

  const el = new DanmakuEngine({ width: 667, height: 375, insets: INSET_L });
  el.setConfig(makeConfig(makeItems(6)));
  el.play();
  for (let f = 0; f < 12; f++) el.update(1000 / 60);
  const sl = el.getActiveSnapshot().find((a) => a.mode === 'scroll');

  check('两者都成功出场滚动弹幕', !!sp && !!sl);
  const rowsP = ep.viewportInfo().rowCount;
  const rowsL = el.viewportInfo().rowCount;
  check('横屏可用高度更小 → 轨道更少', rowsL < rowsP, `竖屏 ${rowsP} 行 / 横屏 ${rowsL} 行`);
  check(
    '横屏更宽 → 同一条滚动弹幕行程更远、剩余寿命更长（看得更久）',
    sl.life > sp.life,
    `竖屏 life=${sp.life.toFixed(0)}ms / 横屏 life=${sl.life.toFixed(0)}ms`
  );
  check(
    '滚动速度本身不随方向变化（px/s 恒定）',
    Math.abs(sp.vx - sl.vx) < 1e-6,
    `vx=${sp.vx.toFixed(4)} px/ms`
  );
}

/* ============ 6. inset 缺省时与旧行为一致 ============ */
section('兼容性：无 inset 时行为不变');
{
  const e = new DanmakuEngine({ width: 400, height: 800 });
  e.setConfig(makeConfig(makeItems(1)));
  const full = e.band();
  check('无 inset：full 区域仍占满画布', full.top === 0 && full.bottom === 800, JSON.stringify(full));

  const e2 = new DanmakuEngine({ width: 375, height: 600 });
  e2.setConfig(makeConfig(makeItems(1)));
  e2.setViewport(375, 600, { top: 0, bottom: 0, left: 0, right: 0 });
  const i2 = e2.viewportInfo();
  check('零 inset：行程等于整宽', i2.travelLeft === 0 && i2.travelRight === 375, JSON.stringify({ l: i2.travelLeft, r: i2.travelRight }));
}

console.log('\n==============================================');
console.log(` 弹幕方向适配自检：${passed} 通过 / ${failed} 失败`);
console.log('==============================================\n');
process.exit(failed ? 1 : 0);
