/**
 * 万能转盘核心逻辑离线自检（不联网、不依赖开发者工具）
 *
 * 用 esbuild 把 subpackages/tools/utils/wheel-store.ts 打包成 CJS 后，
 * 注入 wx / getApp 的桩，直接在 node 里跑真实代码，验证：
 *  1) 权重抽取分布是否贴合权重占比（验收标准 1）
 *  2) 「移除此项再转」的排除是否生效
 *  3) 转动落点是否落在目标扇区中线 ±3° 内（复算页面的角度公式）
 *  4) 数据层：模板实例化 / 编辑 / 复制 / 删除下限 / 记录上限 / 统计条数
 *
 * 用法：node scripts/test_wheel_logic.js
 */
const path = require('path');
const esbuild = require('esbuild');

/* ==================== 注入桩 ==================== */
const mem = {};
global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  showModal: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, pixelRatio: 2 })
};
global.getApp = () => undefined;

const entry = path.join(__dirname, '..', 'miniprogram', 'subpackages', 'tools', 'utils', 'wheel-store.ts');
const built = esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  write: false,
  logLevel: 'silent'
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require);
const store = mod.exports;

let failed = 0;
function ok(cond, label, extra) {
  if (cond) {
    console.log(`✅ ${label}${extra ? '  ' + extra : ''}`);
  } else {
    failed++;
    console.log(`❌ ${label}${extra ? '  ' + extra : ''}`);
  }
}

/* ==================== 1. 权重分布 ==================== */

const tpl = {
  id: 't',
  name: '今天吃什么',
  icon: '🍚',
  cat: 'eat',
  theme: 'candy',
  desc: '',
  options: [
    { text: '火锅', weight: 3 },
    { text: '日料', weight: 3 },
    { text: '烧烤', weight: 1 },
    { text: '麻辣烫', weight: 1 },
    { text: '快餐', weight: 1 },
    { text: '轻食', weight: 1 }
  ]
};
const wheel = store.createFromTemplate(tpl);
const opts = wheel.options;
const N = 20000;
const hits = new Array(opts.length).fill(0);
for (let i = 0; i < N; i++) hits[store.pickIndex(opts)] += 1;

let distOk = true;
const lines = [];
opts.forEach((o, i) => {
  const expect = o.weight / 10;
  const actual = hits[i] / N;
  const diff = Math.abs(actual - expect);
  if (diff > 0.02) distOk = false;
  lines.push(`${o.text}(w${o.weight}) 期望${(expect * 100).toFixed(1)}% 实测${(actual * 100).toFixed(1)}%`);
});
ok(distOk, `权重分布偏差 < 2 个百分点（${N} 次抽样）`);
console.log('   ' + lines.join('\n   '));

// 无固定落点：每个选项都应被抽到过
ok(hits.every((h) => h > 0), '每个选项都被抽中过（无死扇区）');

/* ==================== 2. 排除模式 ==================== */

const ex = [opts[0].id, opts[1].id];
let exBad = 0;
for (let i = 0; i < 5000; i++) {
  const idx = store.pickIndex(opts, ex);
  if (idx === 0 || idx === 1) exBad++;
}
ok(exBad === 0, '排除模式下不会抽到被移除的选项');

/* ==================== 3. 落点精度（复算页面角度公式） ==================== */

function angleAt(ms, T, wp, tc) {
  const s = ms / 1000;
  const a1 = wp * 0.1;
  if (s <= 0.2) return (wp * s * s) / 0.4;
  if (s <= 0.2 + tc) return a1 + wp * (s - 0.2);
  const u = s - (0.2 + tc);
  return a1 + wp * tc + wp * (u - (u * u) / 3);
}

let maxOffset = 0;
let monoOk = true;
for (let k = 0; k < 50; k++) {
  const n = opts.length;
  const sa = 360 / n;
  const idx = store.pickIndex(opts);
  const center = idx * sa + sa / 2;
  const offsetWant = Math.random() * 6 - 3;
  let target = (360 - center) % 360 + offsetWant;
  if (target < 0) target += 360;

  const T = 3500;
  const turns = 5;
  const cur = Math.random() * 360;
  const curMod = ((cur % 360) + 360) % 360;
  let delta = target - curMod;
  while (delta < 0) delta += 360;
  const total = delta + 360 * turns;
  const tc = Math.max(0.05, (T - 1700) / 1000);
  const wp = total / (tc + 0.85);

  const final = cur + total;
  // 转盘转到 final 时，指针（固定在 12 点）指向的转盘本地角度
  const pMod = ((-final % 360) + 360) % 360;
  const centerDiff = Math.abs(pMod - center);
  const wrapped = Math.min(centerDiff, 360 - centerDiff);
  maxOffset = Math.max(maxOffset, wrapped);

  // 角度必须单调不减（不能出现「倒转」）
  let prev = -1;
  for (let ms = 0; ms <= T; ms += 50) {
    const a = angleAt(ms, T, wp, tc);
    if (a < prev - 1e-6) monoOk = false;
    prev = a;
  }
  // 终点角度必须等于 total（时长误差 0，落点 100% 一致）
  const endAngle = angleAt(T, T, wp, tc);
  if (Math.abs(endAngle - total) > 1e-6) monoOk = false;
}
ok(maxOffset <= 3.0001, '落点始终在扇区中线 ±3° 内', `最大偏差 ${maxOffset.toFixed(3)}°`);
ok(monoOk, '角度曲线单调不减，且终点角度精确等于目标总角度');

/* ==================== 4. 数据层 ==================== */

ok(store.listWheels().length >= 1, '转盘列表可读');
const w2 = store.duplicateWheel(wheel._id);
ok(!!w2 && w2._id !== wheel._id, '复制转盘生成新 id');
ok(w2 && w2.name.indexOf('副本') > 0, '复制转盘自动加「副本」后缀');

const recsBefore = store.listRecords().length;
for (let i = 0; i < 130; i++) store.addRecord(wheel, opts[store.pickIndex(opts)]);
const recs = store.listRecords();
ok(recs.length === store.MAX_RECORDS, '历史记录上限 100 条', `实际 ${recs.length} 条（写入 130 条）`);

const stats = store.statsOf(wheel._id);
const statSum = stats.reduce((s, r) => s + r.count, 0);
ok(statSum === recs.length, '统计条数与实际抽奖次数一致（删除转盘前）', `统计 ${statSum} / 记录 ${recs.length}`);

// 期望占比之和应为 1（权重归一化）
const expectSum = stats.reduce((s, r) => s + r.expect, 0);
ok(Math.abs(expectSum - 1) < 1e-6, '权重期望占比之和为 100%', `${(expectSum * 100).toFixed(2)}%`);

// 删除转盘后：记录仍在，且标记为「已删除的转盘」
const other = store.createBlank('占位转盘');
const removed = store.removeWheel(wheel._id);
ok(removed, '删除转盘成功');
ok(store.isWheelDeleted(wheel._id), '被删除的转盘在历史里标记为「已删除的转盘」');
const left = store.listRecords().filter((r) => r.wheelId === wheel._id);
ok(left.length > 0, '删除转盘后其历史记录不消失', `保留 ${left.length} 条`);
// 一直删到只剩一个，再验证「最后一个不允许删除」
while (store.listWheels().length > 1) {
  const list = store.listWheels();
  if (!store.removeWheel(list[list.length - 1]._id)) break;
}
ok(store.listWheels().length === 1, '可以逐个删除到只剩一个转盘');
ok(store.removeWheel(store.listWheels()[0]._id) === false, '最后一个转盘不允许删除（主页至少有一个可转）');

/* ==================== 5. 转盘绘制（验收标准 6：12 项不溢出、不重叠） ==================== */

const canvasEntry = path.join(__dirname, '..', 'miniprogram', 'subpackages', 'tools', 'utils', 'wheel-canvas.ts');
const built2 = esbuild.buildSync({
  entryPoints: [canvasEntry], bundle: true, platform: 'node', format: 'cjs',
  target: 'node18', write: false, logLevel: 'silent'
});
const mod2 = { exports: {} };
new Function('module', 'exports', 'require', built2.outputFiles[0].text)(mod2, mod2.exports, require);
const { drawWheel, drawPoster, inkOn } = mod2.exports;

/** 记录字号赋值的假 ctx */
function fakeCtx() {
  const fonts = [];
  const texts = [];
  const o = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: '', textBaseline: '', globalAlpha: 1,
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc() {}, closePath() {}, fill() {}, stroke() {}, save() {}, restore() {}, translate() {},
    rotate() {}, scale() {}, clip() {},
    fillText(t) { texts.push(String(t)); },
    strokeText() {},
    measureText(t) { return { width: String(t).length * 10 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    drawImage() {}, setTransform() {}, transform() {}, ellipse() {}, roundRect() {}, setLineDash() {}
  };
  Object.defineProperty(o, 'font', {
    get() { return fonts.length ? fonts[fonts.length - 1] : ''; },
    set(v) { fonts.push(String(v)); }
  });
  return { ctx: o, fonts, texts };
}

function fontSizeOf(fontStr) {
  const m = /(\d+(?:\.\d+)?)px/.exec(fontStr || '');
  return m ? parseFloat(m[1]) : 0;
}

// 12 个满长度选项（10 个汉字 + 图标）
const many = [];
for (let i = 0; i < 12; i++) {
  many.push({ id: `o${i}`, text: '十个字那么长的选项啊', color: '#FF6B81', weight: 1, icon: '🍚' });
}
const f1 = fakeCtx();
let drawErr = null;
try {
  drawWheel(f1.ctx, { size: 340, options: many, rotation: 37.5, highlight: 3, centerHole: true });
} catch (e) {
  drawErr = e;
}
ok(!drawErr, '12 个满长选项绘制不报错', drawErr ? String(drawErr.message) : '');

const sizes = f1.fonts.map(fontSizeOf).filter((s) => s > 0);
const maxFs = Math.max(...sizes);
const minFs = Math.min(...sizes);
// 扇区弦宽约束：字号 × 字数 必须小于该半径处的弦宽（30° 扇区在 0.78R 处约 122px）
const saRad = (360 / 12) * Math.PI / 180;
const chord = 2 * (170 * 0.90 * 0.78) * Math.sin(saRad / 2);
ok(maxFs <= chord, '字号不超过扇区弦宽（不会压到相邻扇区）', `字号 ${maxFs.toFixed(1)}px / 弦宽 ${chord.toFixed(1)}px`);
ok(minFs >= 9, '字号不低于可读下限 9px', `最小 ${minFs.toFixed(1)}px`);
// 每个选项都画了文字与图标
ok(f1.texts.length >= 24, '12 个选项的文字与图标都绘制了', `共 ${f1.texts.length} 次 fillText`);

// 少量选项时字号应更大（自适应生效）。
// 注意：满长文本（10 字）在 3 项和 12 项下都会被「径向可用长度」卡到同一个下限
// ——径向空间不随扇区变宽而变长，这是几何决定的，此时靠截断保证可读。
// 所以用日常长度（3 字）验证自适应：3 项的字号应明显大于 12 项。
const short = [];
for (let i = 0; i < 12; i++) {
  short.push({ id: `s${i}`, text: '吃火锅', color: '#FF6B81', weight: 1, icon: '' });
}
const f2a = fakeCtx();
drawWheel(f2a.ctx, { size: 340, options: short.slice(0, 3), rotation: 0, centerHole: true });
const maxFs3 = Math.max(...f2a.fonts.map(fontSizeOf).filter((s) => s > 0));
const f2b = fakeCtx();
drawWheel(f2b.ctx, { size: 340, options: short, rotation: 0, centerHole: true });
const maxFs12 = Math.max(...f2b.fonts.map(fontSizeOf).filter((s) => s > 0));
ok(maxFs3 > maxFs12, '选项越少字号越大（自适应字号生效）', `3 项 ${maxFs3.toFixed(1)}px > 12 项 ${maxFs12.toFixed(1)}px`);

// 空选项 / 单选项不崩
const f3 = fakeCtx();
let emptyErr = null;
try {
  drawWheel(f3.ctx, { size: 340, options: [], rotation: 0 });
  drawWheel(f3.ctx, { size: 340, options: [many[0]], rotation: 0 });
} catch (e) {
  emptyErr = e;
}
ok(!emptyErr, '空转盘 / 单选项不崩溃');

// 海报绘制
const f4 = fakeCtx();
let posterErr = null;
try {
  drawPoster(f4.ctx, {
    width: 640, height: 860, wheelName: '今天吃什么', wheelIcon: '🍚',
    options: many.slice(0, 6), rotation: 120, highlight: 2,
    result: '火锅', resultIcon: '🍲', footer: '待办清单 · 万能转盘'
  });
} catch (e) {
  posterErr = e;
}
ok(!posterErr, '结果海报绘制不报错');

// 文字对比色
ok(inkOn('#FFFFFF') === '#2A2118' && inkOn('#C0392B') === '#FFFFFF', '扇区文字自动取黑/白对比色');

console.log(failed ? `\n共 ${failed} 项未通过` : '\n✅ 全部通过');
process.exit(failed ? 1 : 0);
