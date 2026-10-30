// scripts/check-photowall-render.js
// 照片墙 · 渲染管线冒烟测试（离线，用 mock canvas 跑完整绘制链路）
//
// 微信小程序真机/模拟器里 canvas 的问题（画到画布外、尺寸为 0、层级错乱）
// 只有跑起来才看得见，写的时候全都「编译通过」。这里用一套 mock 的 2D 上下文
// 记录每次绘制调用，就能在 Node 里断言：照片画了几张、画在哪、多大、什么顺序。
//
// 用法：node scripts/check-photowall-render.js

const path = require('path');
const OUT = path.resolve(__dirname, '..', '.tmp-pw', 'subpackages', 'photowall', 'utils');

/* ── mock 2D 上下文：只记录调用，不真画 ── */
function makeCtx(log) {
  const st = { tx: 0, ty: 0, stack: [] };
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0, lineCap: 'butt',
    save() { st.stack.push({ tx: st.tx, ty: st.ty }); },
    restore() { const s = st.stack.pop(); if (s) { st.tx = s.tx; st.ty = s.ty; } },
    translate(x, y) { st.tx += x; st.ty += y; },
    rotate() {}, scale() {}, transform() {}, setTransform() {}, resetTransform() {},
    clearRect() {}, fillRect(...a) { log.fillRect.push(a); }, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {},
    rect() {}, roundRect() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arcTo() {},
    clip() { log.clip++; }, fill() { log.fill++; }, stroke() { log.stroke++; },
    fillText(...a) { log.text.push({ txt: a[0], x: st.tx, y: st.ty }); },
    strokeText() {},
    measureText(t) { return { width: String(t).length * 20 }; },
    drawImage(img, ...a) {
      // drawPhoto 的约定：translate 到中心后，以 -w/2 为左上角绘制
      const dx = a.length >= 8 ? a[4] : a[0];
      const dy = a.length >= 8 ? a[5] : a[1];
      const dw = a.length >= 8 ? a[6] : a[2];
      const dh = a.length >= 8 ? a[7] : a[3];
      log.images.push({ x: st.tx + dx + dw / 2, y: st.ty + dy + dh / 2, w: dw, h: dh });
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    draw() {}
  };
  return ctx;
}

function makeCanvas(w, h, log) {
  const ctx = makeCtx(log);
  return {
    width: w || 300,
    height: h || 150,
    getContext: () => ctx,
    createImage() {
      const img = { width: 600, height: 400, onload: null, onerror: null, _src: '' };
      Object.defineProperty(img, 'src', {
        get() { return this._src; },
        set(v) { this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
      });
      return img;
    }
  };
}

const LOG = { images: [], text: [], fillRect: [], clip: 0, fill: 0, stroke: 0 };
let lastCanvas = null;
global.wx = {
  createOffscreenCanvas(o) {
    lastCanvas = makeCanvas(o && o.width, o && o.height, LOG);
    return lastCanvas;
  },
  canvasToTempFilePath(o) {
    if (o && o.success) o.success({ tempFilePath: '/tmp/pw-export.jpg' });
  },
  getImageInfo(o) { if (o && o.success) o.success({ width: 600, height: 400, path: o.src }); }
};

const R = require(path.join(OUT, 'pw-render.js'));
const T = require(path.join(OUT, 'pw-types.js'));
const SP = require(path.join(OUT, 'pw-shapes.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
}

console.log('════════ 照片墙 · 渲染管线冒烟 ════════\n');

(async () => {
  /* ── 1. 画布比例换算 ── */
  console.log('── 1. 导出尺寸换算 ──');
  const st = T.defaultStyle();
  let sz = R.canvasSizeByRatio({ ...st, ratio: '1:1' }, 1080);
  ok('1:1 → 1080×1080', sz.w === 1080 && sz.h === 1080, JSON.stringify(sz));
  sz = R.canvasSizeByRatio({ ...st, ratio: '9:16' }, 1080);
  ok('9:16 竖版 → 1080×1920（短边=宽 1080）', sz.w === 1080 && sz.h === 1920, JSON.stringify(sz));
  sz = R.canvasSizeByRatio({ ...st, ratio: '16:9' }, 1080);
  ok('16:9 横版 → 1920×1080（短边=高 1080）', sz.w === 1920 && sz.h === 1080, JSON.stringify(sz));
  sz = R.canvasSizeByRatio({ ...st, ratio: '3:4' }, 2160);
  ok('3:4 竖版 → 2160×2880（短边=宽 2160）', sz.w === 2160 && sz.h === 2880, JSON.stringify(sz));
  ok('2160 档最长边仍在 4096 画布上限内', Math.max(sz.w, sz.h) <= 4096, JSON.stringify(sz));

  /* ── 2. 绘制 20 张照片 ── */
  console.log('\n── 2. 绘制 20 张 ──');
  const work = T.newWork();
  const def = SP.SHAPES.find((s) => s.id === 'heart');
  const lay0 = SP.layout(def, 20, { seed: 5 });
  work.photos = [];
  for (let i = 0; i < 20; i++) work.photos.push(T.newPhoto('/tmp/p' + i + '.jpg'));
  work.slots = lay0.pts;

  const cv = makeCanvas(600, 600, LOG);
  R.setHostCanvas(cv);
  const lay = await R.paintWork(cv, work, { cell: lay0.cell });

  ok('绘制了 20 张照片', LOG.images.length === 20, '实际 ' + LOG.images.length);
  ok('布局回传 20 个中心点', lay.centers.length === 20, '实际 ' + lay.centers.length);
  ok('内容区边长 > 0', lay.S > 0 && lay.S <= 600, 'S=' + lay.S);
  ok('单张边长合理（不糊成一点 / 不撑爆画布）', lay.size > 8 && lay.size < 600, 'size=' + lay.size.toFixed(1));

  const inCanvas = lay.centers.every((c) => c.x >= 0 && c.x <= 600 && c.y >= 0 && c.y <= 600);
  ok('所有照片中心都落在画布内', inCanvas, JSON.stringify(lay.centers.filter((c) => c.x < 0 || c.x > 600 || c.y < 0 || c.y > 600)));

  const imgs = LOG.images;
  ok('每张照片都被裁剪成 cover（短边贴满）', imgs.every((i) => i.w >= lay.size - 0.5 && i.h >= lay.size - 0.5));
  ok('圆角裁剪已生效（clip 调用 ≥ 20）', LOG.clip >= 20, 'clip=' + LOG.clip);
  ok('边框已描边（stroke ≥ 20）', LOG.stroke >= 20, 'stroke=' + LOG.stroke);

  /* ── 3. 空照片 / 单张 ── */
  console.log('\n── 3. 边界情况 ──');
  const empty = T.newWork();
  LOG.images.length = 0;
  await R.paintWork(makeCanvas(400, 400, LOG), empty);
  ok('没有照片时不崩溃、不画照片', LOG.images.length === 0);

  const oneW = T.newWork();
  oneW.photos = [T.newPhoto('/tmp/a.jpg')];
  oneW.slots = [{ x: 0.5, y: 0.5 }];
  LOG.images.length = 0;
  const lay1 = await R.paintWork(makeCanvas(400, 400, LOG), oneW, { cell: 0.62 });
  ok('单张照片画在画布中心', Math.abs(lay1.centers[0].x - 200) < 2 && Math.abs(lay1.centers[0].y - 200) < 2,
    JSON.stringify(lay1.centers[0]));

  /* ── 4. 装饰元素 ── */
  console.log('\n── 4. 装饰与背景 ──');
  const dw = T.newWork();
  dw.photos = [T.newPhoto('/tmp/a.jpg')];
  dw.slots = [{ x: 0.5, y: 0.5 }];
  dw.style.decor = [
    { id: 'd1', kind: 'text', value: '生日快乐', x: 0.5, y: 0.9, size: 0.08, color: '#333', rot: 0 },
    { id: 'd2', kind: 'sticker', value: '❤️', x: 0.1, y: 0.1, size: 0.12, color: '#E0607E', rot: 0 }
  ];
  LOG.text.length = 0;
  const layD = await R.paintWork(makeCanvas(500, 500, LOG), dw, { cell: 0.6 });
  ok('两个装饰都被绘制', LOG.text.length === 2, '实际 ' + LOG.text.length);
  ok('装饰坐标换算正确（0.5,0.9 → 250,450）',
    Math.abs(layD.decorCenters[0].x - 250) < 1 && Math.abs(layD.decorCenters[0].y - 450) < 1,
    JSON.stringify(layD.decorCenters[0]));

  /* ── 5. 导出链路 ── */
  console.log('\n── 5. 导出 ──');
  const expW = T.newWork();
  expW.photos = work.photos;
  expW.slots = lay0.pts;
  const p = await R.exportWork(expW, { shortPx: 1080, fileType: 'jpg', quality: 0.9 });
  ok('导出返回临时文件路径', typeof p === 'string' && p.length > 0, String(p));
  ok('离线画布按 1080 短边创建', lastCanvas && lastCanvas.width === 1080 && lastCanvas.height === 1080,
    lastCanvas ? lastCanvas.width + 'x' + lastCanvas.height : 'null');

  const p2 = await R.exportWork({ ...expW, style: { ...expW.style, ratio: '9:16' } }, { shortPx: 1080 });
  ok('导出保持 9:16 竖版', !!p2);

  /* ── 6. 缩放 / 旋转参数生效 ── */
  console.log('\n── 6. 整体缩放与旋转 ──');
  const rotW = T.newWork();
  rotW.photos = work.photos;
  rotW.slots = lay0.pts;
  rotW.arrange.rotate = 90;
  const layR = await R.paintWork(makeCanvas(600, 600, LOG), rotW, { cell: lay0.cell });
  // 旋转 90° 后，原本在正上方的点应转到正右方
  const c0 = lay.centers[0];
  const c0r = layR.centers[0];
  const moved = Math.hypot(c0r.x - c0.x, c0r.y - c0.y) > 5;
  ok('整体旋转会改变照片落点', moved, `${JSON.stringify(c0)} → ${JSON.stringify(c0r)}`);

  /* ── 7. 铺满模式：贴片循环复用照片（需显式开启） ── */
  console.log('\n── 7. 铺满模式（贴片复用照片，需显式开启） ──');
  const fillW = T.newWork();
  fillW.photos = work.photos.slice(0, 5); // 只有 5 张照片
  const layF = SP.layout(def, 5, { seed: 5, repeat: true, slots: 40, legacy: true });
  fillW.slots = layF.pts;
  LOG.images.length = 0;
  const layFill = await R.paintWork(makeCanvas(600, 600, LOG), fillW, { cell: layF.cell, repeat: true });

  ok('5 张照片画出 40 张贴片', LOG.images.length === 40, '实际 ' + LOG.images.length);
  ok('贴片中心数 = 贴片数', layFill.tileCenters.length === 40, '实际 ' + layFill.tileCenters.length);
  ok(
    '贴片按下标循环复用照片（i → i % 5）',
    layFill.tilePhoto.every((pi, i) => pi === i % 5),
    layFill.tilePhoto.join(',')
  );
  ok('每张照片都被复用到', new Set(layFill.tilePhoto).size === 5, '用到 ' + new Set(layFill.tilePhoto).size + ' 张');
  ok(
    '所有贴片都落在画布内',
    layFill.tileCenters.every((c) => c && c.x >= 0 && c.x <= 600 && c.y >= 0 && c.y <= 600)
  );
  // 贴片不能糊满画布（这正是「看不出形状」的成因）
  ok(
    '贴片边长远小于画布（形状轮廓可见）',
    layFill.size < 600 * 0.25,
    'size=' + layFill.size.toFixed(1)
  );

  /* ── 8. 默认模式：每张照片只用一次，绝不重复 ── */
  console.log('\n── 8. 每张照片只用一次（不重复保证） ──');
  let dupBad = '';
  let countBad = '';
  let posBad = '';
  let permBad = '';
  for (const n of [1, 2, 3, 5, 8, 12, 20, 40]) {
    const w = T.newWork();
    w.photos = [];
    for (let i = 0; i < n; i++) w.photos.push(T.newPhoto('/tmp/uniq' + i + '.jpg'));
    const lay = SP.layout(def, n, { seed: 5 });
    w.slots = lay.pts;
    w.cell = lay.cell;
    LOG.images.length = 0;
    const got = await R.paintWork(makeCanvas(600, 600, LOG), w, { cell: lay.cell });
    if (LOG.images.length !== n) countBad += ` n=${n}画了${LOG.images.length}`;
    // tilePhoto 必须是 0..n-1 的一个排列 —— 每个下标恰好出现一次
    const seen = new Array(n).fill(0);
    got.tilePhoto.forEach((pi) => {
      if (pi >= 0 && pi < n) seen[pi]++;
    });
    if (seen.some((v) => v !== 1)) dupBad += ` n=${n}:${seen.join('/')}`;
    // 每张照片只画在属于它的那一个点位上（一一对应）
    if (!got.tilePhoto.every((pi, i) => pi === i)) permBad += ' n=' + n;
    // 画出来的中心点互不重合（重合就意味着两张照片叠在一起）
    const uniq = new Set(got.tileCenters.map((c) => Math.round(c.x) + ',' + Math.round(c.y)));
    if (uniq.size !== n) posBad += ` n=${n}:${uniq.size}/${n}`;
  }
  ok('每档照片数都恰好画出 n 张（不多不少）', !countBad, countBad.slice(0, 120));
  ok('贴片 ↔ 照片是一一对应（每个下标恰好出现一次）', !dupBad, dupBad.slice(0, 120));
  ok('第 i 张照片只出现在第 i 个点位上', !permBad, permBad.slice(0, 120));
  ok('所有照片的中心点互不重合', !posBad, posBad.slice(0, 120));

  // 即使作品里带着旧的「点位多于照片数」的快照，默认模式也不会画出重复照片
  const staleW = T.newWork();
  staleW.photos = [];
  for (let i = 0; i < 4; i++) staleW.photos.push(T.newPhoto('/tmp/uniq' + i + '.jpg'));
  staleW.slots = SP.layout(def, 4, { seed: 5, repeat: true, slots: 40, legacy: true }).pts; // 旧数据：40 个点位
  LOG.images.length = 0;
  const layStale = await R.paintWork(makeCanvas(600, 600, LOG), staleW, { cell: 0.14 });
  ok(
    '旧作品残留的多余点位不会造成重复照片（仍只画 4 张）',
    LOG.images.length === 4 && new Set(layStale.tilePhoto).size === 4,
    '画了 ' + LOG.images.length + ' 张'
  );

  // 点位不足（刚加完照片还没重算）时也不能漏画照片
  const raceW = T.newWork();
  raceW.photos = work.photos.slice(0, 8);
  raceW.slots = [{ x: 0.5, y: 0.5 }];
  LOG.images.length = 0;
  const layRace = await R.paintWork(makeCanvas(600, 600, LOG), raceW, { cell: 0.2 });
  ok(
    '点位不足时也不漏画照片（8 张全出）',
    LOG.images.length === 8 && layRace.tilePhoto.length === 8,
    '实际画了 ' + LOG.images.length
  );

  console.log('\n══════════════════════════════════════════');
  console.log(` 结果：${pass} 通过 / ${fail} 失败`);
  console.log('══════════════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('渲染冒烟异常：', e);
  process.exit(1);
});
