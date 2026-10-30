// scripts/check-photowall-shapes.js
// 照片墙 · 形状排点算法冒烟测试（离线，不联网、不依赖微信运行时）
//
// 排点算法是照片墙的「灵魂」：点排错了，照片再多也认不出形状。
// 这些断言全部是纯函数，不需要 canvas / wx，用 Node 直接跑。
//
// 用法：node scripts/check-photowall-shapes.js [--art]
//   --art 额外打印 ASCII 形状图，肉眼确认轮廓

const path = require('path');
const OUT = path.resolve(__dirname, '..', '.tmp-pw', 'subpackages', 'photowall', 'utils');
const S = require(path.join(OUT, 'pw-shapes.js'));
const B = require(path.join(OUT, 'pw-batch.js'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    fail++;
    console.log('  ❌ ' + name + (extra ? ' —— ' + extra : ''));
  }
}

/** 把点位画成 ASCII 图（每格 2 字符宽，纵向 24 行） */
function art(pts, w = 46, h = 23) {
  const grid = [];
  for (let r = 0; r < h; r++) grid.push(new Array(w).fill(' '));
  pts.forEach((p) => {
    const c = Math.min(w - 1, Math.max(0, Math.round(p.x * (w - 1))));
    const r = Math.min(h - 1, Math.max(0, Math.round(p.y * (h - 1))));
    grid[r][c] = '#';
  });
  return grid.map((r) => '    ' + r.join('')).join('\n');
}

const SHOW_ART = process.argv.includes('--art');

console.log('════════ 照片墙 · 形状排点算法冒烟 ════════\n');

/* ── 1. 全部内置形状：点数、值域、cell 合理 ── */
console.log('── 1. 内置形状基本约束 ──');
const analytic = S.SHAPES.filter((s) => s.kind === 'analytic');
ok('内置解析形状数量 ≥ 20', analytic.length >= 20, '实际 ' + analytic.length);

let badRange = [];
let badCount = [];
let badCell = [];
analytic.forEach((s) => {
  const n = s.suggest;
  const r = S.layout(s, n, { seed: 7 });
  if (r.pts.length !== n) badCount.push(s.id + ':' + r.pts.length + '/' + n);
  if (!(r.cell > 0.03 && r.cell <= 0.9)) badCell.push(s.id + ':' + r.cell.toFixed(3));
  for (const p of r.pts) {
    // 允许极小的越界（抖动可能把点推出边界一点点），但不能离谱
    if (!(p.x >= -0.03 && p.x <= 1.03 && p.y >= -0.03 && p.y <= 1.03)) {
      badRange.push(s.id);
      break;
    }
  }
});
ok('点位数恒等于照片数', badCount.length === 0, badCount.join(', '));
ok('点位落在 [0,1] 内容区内', badRange.length === 0, badRange.join(', '));
ok('建议照片边长在合理区间', badCell.length === 0, badCell.join(', '));

/* ── 2. 不同照片数下的稳定性 ── */
console.log('\n── 2. 极端照片数 ──');
const heart = S.SHAPES.find((s) => s.id === 'heart');
[1, 2, 3, 8, 40, 100].forEach((n) => {
  const r = S.layout(heart, n, { seed: 3 });
  ok('心形 n=' + n + ' → ' + r.pts.length + ' 点', r.pts.length === n);
});
const one = S.layout(heart, 1, { legacy: true });
ok('单张照片居中（legacy 自适应路径）', Math.abs(one.pts[0].x - 0.5) < 0.001 && Math.abs(one.pts[0].y - 0.5) < 0.001);
const oneT = S.layout(heart, 1, {});
ok('单张照片走模板部分填充（预览按阅读顺序）', oneT.pts.length === 1 && oneT.cell > 0.1, 'cell=' + oneT.cell.toFixed(3));

/* ── 3. 心形轮廓特征（这个模块的核心卖点） ── */
console.log('\n── 3. 心形轮廓特征 ──');
const hp = S.layout(heart, 60, { seed: 11 }).pts;
// 心形的辨识特征是「顶部两个凸起 + 中间凹口」：
// 两侧最高点必须明显高于正中最高点，否则排出来只是一坨圆。
const side = hp.filter((p) => p.x < 0.32 || p.x > 0.68);
const mid = hp.filter((p) => Math.abs(p.x - 0.5) <= 0.1);
const ySide = Math.min.apply(null, side.map((p) => p.y));
const yMid = Math.min.apply(null, mid.map((p) => p.y));
ok('顶部两侧凸起高于正中（凹口成立）', yMid - ySide > 0.02, `两侧最高 y=${ySide.toFixed(3)}，正中 y=${yMid.toFixed(3)}`);

const bottom = hp.filter((p) => p.y > 0.9);
const tipCentered = bottom.length === 0 || bottom.every((p) => Math.abs(p.x - 0.5) < 0.25);
ok('底部尖点居中', tipCentered, JSON.stringify(bottom));

// 上宽下尖：上半部横向跨度应明显大于下半部
const upper = hp.filter((p) => p.y < 0.35);
const lower = hp.filter((p) => p.y > 0.75);
const span = (arr) => Math.max.apply(null, arr.map((p) => p.x)) - Math.min.apply(null, arr.map((p) => p.x));
ok('上宽下尖', span(upper) > span(lower) + 0.15, `上=${span(upper).toFixed(2)} 下=${span(lower).toFixed(2)}`);

// 左右对称：以 x=0.5 为轴，两侧点数应接近
const left = hp.filter((p) => p.x < 0.5).length;
const right = hp.filter((p) => p.x >= 0.5).length;
ok('左右大致对称', Math.abs(left - right) <= Math.max(4, hp.length * 0.2), `left=${left} right=${right}`);

/* ── 4. 圆形：所有点到圆心距离集中 ── */
console.log('\n── 4. 圆形 ──');
const cp = S.layout(S.SHAPES.find((s) => s.id === 'circle'), 40, { seed: 5 }).pts;
const ds = cp.map((p) => Math.hypot(p.x - 0.5, p.y - 0.5));
const dmax = Math.max.apply(null, ds);
ok('圆形不超出边界半径 0.5', dmax > 0.35 && dmax <= 0.51, 'max=' + dmax.toFixed(3));
// 内部要被填满（照片多时填满内部是需求明确要求的），中心附近必须有照片
const near = cp.filter((p) => Math.hypot(p.x - 0.5, p.y - 0.5) < 0.2).length;
ok('圆形内部被填满', near >= 3, '半径 0.2 内 ' + near + ' 张');
// 四象限均衡：偏在一侧说明排点算法有方向性偏差
const quad = [0, 0, 0, 0];
cp.forEach((p) => {
  quad[(p.x >= 0.5 ? 1 : 0) + (p.y >= 0.5 ? 2 : 0)]++;
});
const qmin = Math.min.apply(null, quad);
const qmax = Math.max.apply(null, quad);
ok('圆形四象限分布均衡', qmax - qmin <= 6, 'quad=' + quad.join('/'));

/* ── 5. 密度参数确实改变轮廓占比 ── */
console.log('\n── 5. 轮廓密度 ──');
function edgeRatio(pts) {
  // 粗略判定「靠边」：离形状中心远的点视为轮廓点
  let cx = 0;
  let cy = 0;
  pts.forEach((p) => {
    cx += p.x;
    cy += p.y;
  });
  cx /= pts.length;
  cy /= pts.length;
  const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => b - a);
  const cut = rs[Math.floor(rs.length * 0.35)];
  return pts.filter((p) => Math.hypot(p.x - cx, p.y - cy) >= cut).length / pts.length;
}
const lo = S.layout(heart, 60, { density: 0.7, seed: 9 }).pts;
const hi = S.layout(heart, 60, { density: 1.5, seed: 9 }).pts;
ok('密度大 → 轮廓点占比更高', edgeRatio(hi) >= edgeRatio(lo), `lo=${edgeRatio(lo).toFixed(2)} hi=${edgeRatio(hi).toFixed(2)}`);

/* ── 6. 同 seed 可复现 / 不同 seed 有差异 ── */
console.log('\n── 6. 可复现性 ──');
const a1 = S.layout(heart, 40, { seed: 42, jitter: 0.4 }).pts;
const a2 = S.layout(heart, 40, { seed: 42, jitter: 0.4 }).pts;
const a3 = S.layout(heart, 40, { seed: 43, jitter: 0.4 }).pts;
const same = a1.every((p, i) => Math.abs(p.x - a2[i].x) < 1e-9 && Math.abs(p.y - a2[i].y) < 1e-9);
const diff = a1.some((p, i) => Math.abs(p.x - a3[i].x) > 1e-6);
ok('同 seed 结果完全一致（撤销/重做可复现）', same);
ok('换 seed 结果不同（「重新排列」有效）', diff);

/* ── 7. 字母 / 数字 / 文字形状已注册 ── */
console.log('\n── 7. 字母 / 数字 ──');
ok('字母 26 个', S.LETTER_SHAPES.length === 26);
ok('数字 10 个', S.NUMBER_SHAPES.length === 10);
ok('字母 A 可取到', !!S.getShape('letter-A'));
ok('数字 0 可取到', !!S.getShape('num-0'));
ok('心形可取到', !!S.getShape('heart'));
ok('不存在的形状返回 null', S.getShape('not-exist') === null);

/* ── 8. 照片边长（回归：曾因「周长重复计数」在少量照片时翻倍；自适应路径） ── */
console.log('\n── 8. 照片边长 ──');
const cellOf = (n, o) => S.layout(heart, n, Object.assign({ seed: 3, legacy: true }, o)).cell;

const c5 = cellOf(5);
ok('心形 5 张边长不爆炸（回归值：曾算出 0.82，单张占内容区 82%）', c5 > 0.25 && c5 < 0.45, 'cell=' + c5.toFixed(3));

const cSeq = [5, 6, 8, 12, 20, 40, 60, 100].map((n) => cellOf(n));
let cMono = true;
for (let i = 1; i < cSeq.length; i++) if (cSeq[i] > cSeq[i - 1] + 1e-9) cMono = false;
// 注意是「不增」而非「严格递减」：照片很少时边长会被面积上限 / 1/3 上限封顶，
// 相邻两档可能相等（如 4/5/6 张都是 0.32），但绝不允许出现「照片更多、贴片反而更大」。
ok('边长随照片数单调不增', cMono, cSeq.map((v) => v.toFixed(3)).join(' → '));
ok('少量照片的贴片不超过内容区 1/3（再大就只剩一坨色块）', cSeq[0] <= 0.321, 'cell=' + cSeq[0].toFixed(3));

const c20 = cellOf(20);
const c40 = cellOf(40);
ok('20 张边长落在已验证区间', c20 > 0.17 && c20 < 0.24, 'cell=' + c20.toFixed(3));
ok('40 张边长落在已验证区间', c40 > 0.11 && c40 < 0.18, 'cell=' + c40.toFixed(3));

// 贴片总面积不能把整块画布糊满 —— 糊满正是「看不出是什么形状」的直接成因
let worstCover = 0;
let worstCoverId = '';
S.SHAPES.filter((s) => s.kind === 'analytic').forEach((s) => {
  const r = S.layout(s, s.suggest, { seed: 7 });
  const cover = r.cell * r.cell * r.pts.length;
  if (cover > worstCover) {
    worstCover = cover;
    worstCoverId = s.id;
  }
});
ok('贴片总面积不糊满画布（≤1.25）', worstCover <= 1.25, `最大 ${worstCover.toFixed(3)} @ ${worstCoverId}`);

/* ── 9. 轮廓点均匀度（回归：按极角等角度取点会把点挤堆） ── */
console.log('\n── 9. 轮廓点均匀度 ──');
function nnRatio(pts) {
  const arr = pts.map((p, i) => {
    let b = Infinity;
    pts.forEach((q, j) => {
      if (i !== j) b = Math.min(b, Math.hypot(p.x - q.x, p.y - q.y));
    });
    return b;
  });
  return Math.max.apply(null, arr) / Math.max(1e-6, Math.min.apply(null, arr));
}
let worstRatio = 0;
let worstRatioAt = '';
['heart', 'circle', 'square'].forEach((id) => {
  const s = S.SHAPES.find((x) => x.id === id);
  [5, 6].forEach((n) => {
    const r = nnRatio(S.layout(s, n, { seed: 11, legacy: true }).pts);
    if (r > worstRatio) {
      worstRatio = r;
      worstRatioAt = id + ' n=' + n;
    }
  });
});
ok('纯轮廓排点间距均匀（max/min < 1.5）', worstRatio < 1.5, `最差 ${worstRatio.toFixed(2)} @ ${worstRatioAt}`);

/* ── 10. 铺满模式（显式开启才会重复照片；自适应路径） ── */
console.log('\n── 10. 铺满模式 ──');
const filled = S.layout(heart, 5, { seed: 7, repeat: true, slots: 40, legacy: true });
ok('repeat + slots 时点数 = slots（照片由渲染层循环复用）', filled.pts.length === 40, '实际 ' + filled.pts.length);
ok('铺满后尺寸与等量照片一致', Math.abs(filled.cell - S.layout(heart, 40, { seed: 7, legacy: true }).cell) < 1e-9, 'cell=' + filled.cell.toFixed(3));
ok('铺满后点位明显多于照片数（轮廓才清晰）', filled.pts.length > 5);
ok('铺满的点数不少于照片数', S.layout(heart, 50, { seed: 7, repeat: true, slots: 12, legacy: true }).pts.length >= 50);
ok('slots 被安全上限截断（防单帧绘制量失控）', S.layout(heart, 5, { seed: 7, repeat: true, slots: 9999, legacy: true }).pts.length <= 400);

/* ── 11. 不重复保证（核心要求：每张照片只用一次） ── */
console.log('\n── 11. 不重复保证 ──');
const REP_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 33, 60, 100];
let countBad = '';
let dupBad = '';
let closeBad = '';
analytic.forEach((s) => {
  REP_COUNTS.forEach((n) => {
    const r = S.layout(s, n, { seed: 5, density: 1, jitter: 0.25 });
    if (r.pts.length !== n) countBad += ` ${s.id}/${n}→${r.pts.length}`;
    const seen = {};
    let dup = 0;
    let minD = Infinity;
    for (let i = 0; i < r.pts.length; i++) {
      const k = r.pts[i].x.toFixed(5) + ',' + r.pts[i].y.toFixed(5);
      if (seen[k]) dup++;
      seen[k] = 1;
      for (let j = i + 1; j < r.pts.length; j++) {
        const d = Math.hypot(r.pts[i].x - r.pts[j].x, r.pts[i].y - r.pts[j].y);
        if (d < minD) minD = d;
      }
    }
    if (dup) dupBad += ` ${s.id}/${n}×${dup}`;
    // 两个点重合会让渲染层画出两张完全重叠的照片 —— 视觉上就是「重复的照片」
    if (n > 1 && minD < 0.012) closeBad += ` ${s.id}/${n}:${minD.toFixed(3)}`;
  });
});
ok('默认模式点位数量严格等于照片数（渲染层一一对应，不会复用照片）', !countBad, countBad.slice(0, 120));
ok('不存在重合点位', !dupBad, dupBad.slice(0, 120));
ok('任意两点的最小间距 > 0.012（不会叠成一张）', !closeBad, closeBad.slice(0, 120));

// 心形：数量从 1 到 100 全覆盖，且每一档都不出现重复点位
let heartBad = '';
for (let n = 1; n <= 100; n++) {
  const r = S.layout(heart, n, { seed: 9 });
  const set = {};
  r.pts.forEach((p) => (set[p.x.toFixed(5) + ',' + p.y.toFixed(5)] = 1));
  if (r.pts.length !== n || Object.keys(set).length !== n) heartBad += ' ' + n;
}
ok('心形 1~100 张逐档检查：数量正确且点位互不重合', !heartBad, heartBad.slice(0, 120));

/* ── 12. 形状特征命中（照片少也能看出是心形） ── */
console.log('\n── 12. 形状特征命中 ──');
const HEART_NOTCH = { x: 0.5, y: 0.115 };  // 心形顶部凹口
const HEART_TIP = { x: 0.5, y: 0.985 };    // 心形下尖
const distTo = (pts, t) => Math.min.apply(null, pts.map((p) => Math.hypot(p.x - t.x, p.y - t.y)));
let notchBad = '';
let tipBad = '';
[4, 5, 6, 7, 8, 10, 12, 16, 20, 30, 40].forEach((n) => {
  const pts = S.layout(heart, n, { seed: 11, legacy: true }).pts;
  const dn = distTo(pts, HEART_NOTCH);
  if (dn > 0.085) notchBad += ` n=${n}:${dn.toFixed(3)}`;
  // 奇数张时下尖必然被两个点对称夹住（弧长等距，不可能同时命中凹口与下尖），
  // 偶数张则必须正好落在下尖上
  const dt = distTo(pts, HEART_TIP);
  if (n % 2 === 0 && dt > 0.085) tipBad += ` n=${n}:${dt.toFixed(3)}`;
});
ok('每档照片数都有一个点落在心形顶部凹口上', !notchBad, notchBad.slice(0, 120));
ok('偶数张时有一个点正好落在心形下尖上', !tipBad, tipBad.slice(0, 120));

const notchPts = S.layout(heart, 5, { seed: 11, legacy: true }).pts;
ok('5 张时凹口命中', distTo(notchPts, HEART_NOTCH) < 0.085, 'd=' + distTo(notchPts, HEART_NOTCH).toFixed(3));

/* ── 13. 固定网格模板（参考图样式：统一尺寸正方形 + 网格对齐 + 实心 + 固定张数） ── */
console.log('\n── 13. 固定网格模板 ──');
// 派生确定性：同一形状多次派生结果完全一致
const tplA = S.templateOf(heart);
const tplB = S.templateOf(S.SHAPES.find((s) => s.id === 'heart'));
ok('templateOf 派生确定（缓存后恒等）', tplA === tplB && tplA.count === 34, 'count=' + tplA.count);
ok('心形模板 = 经典 7×7 像素心', tplA.cols === 7 && tplA.rows === 7, tplA.cols + 'x' + tplA.rows);
// 手工模板形状的张数固定
const triT = S.templateOf(S.SHAPES.find((s) => s.id === 'triangle'));
const starT = S.templateOf(S.SHAPES.find((s) => s.id === 'star5'));
ok('三角形模板 25 张（1-3-5-7-9 阶梯）', triT.count === 25, 'count=' + triT.count);
ok('五角星模板左右对称', (() => {
  for (let j = 0; j < starT.rows; j++) {
    for (let i = 0; i < starT.cols; i++) {
      const mir = starT.cells[j * starT.cols + (starT.cols - 1 - i)];
      if (starT.cells[j * starT.cols + i] !== mir) return false;
    }
  }
  return true;
})());
// 整张模板：点数 = 模板张数，cell 统一，严格网格对齐（任意相邻水平/垂直对 = 恰好一格）
const full = S.layout(heart, tplA.count, { seed: 3 });
ok('模板排点点数 = 模板张数', full.pts.length === tplA.count, full.pts.length + ' vs ' + tplA.count);
ok('模板贴片尺寸统一（cell = 1/7）', Math.abs(full.cell - 1 / 7) < 1e-9, 'cell=' + full.cell.toFixed(4));
(() => {
  // 网格对齐的独立验证：唯一 x 坐标数 = 列数、唯一 y 坐标数 = 行数，
  // 且相邻坐标间距恒等于 1/M（统一尺寸 + 严格对齐，与实现公式无关）
  const uni = (arr) => {
    const s = arr.map((v) => Math.round(v * 1e6)).sort((a, b) => a - b);
    const out = [s[0]];
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) out.push(s[i]);
    return out;
  };
  const xs = uni(full.pts.map((p) => p.x));
  const ys = uni(full.pts.map((p) => p.y));
  // 微单位（1e-6）下的期望间距；取整有 ±1 误差，用容差比较
  const stepU = Math.round((1 / 7) * 1e6);
  const even = (us) => us.every((v, i) => i === 0 || Math.abs(v - us[i - 1] - stepU) <= 2);
  ok('模板点位严格网格对齐（唯一坐标数 = 列/行数，间距恒定）',
    xs.length === tplA.cols && ys.length === tplA.rows && even(xs) && even(ys),
    'x:' + xs.length + ' y:' + ys.length + ' evenX=' + even(xs) + ' evenY=' + even(ys));
})();
// 实心无缺格：用上面求出的唯一坐标轴，逐格验证「模板开格 ↔ 点位」一一对应
// （独立于实现公式：xs 升序 = 列序，ys 升序 = 屏幕行序，两者方向一致）
(() => {
  const uni = (arr) => {
    const s = arr.map((v) => Math.round(v * 1e6)).sort((a, b) => a - b);
    const out = [s[0]];
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) out.push(s[i]);
    return out;
  };
  const xs = uni(full.pts.map((p) => p.x));
  const ys = uni(full.pts.map((p) => p.y));
  const seen = {};
  full.pts.forEach((p) => { seen[Math.round(p.x * 1e6) + ',' + Math.round(p.y * 1e6)] = 1; });
  let missing = 0;
  for (let j = 0; j < tplA.rows; j++) {
    for (let i = 0; i < tplA.cols; i++) {
      if (!tplA.cells[j * tplA.cols + i]) continue;
      if (!seen[xs[i] + ',' + ys[j]]) missing++;
    }
  }
  ok('模板整张输出与网格矩阵一致（行序=屏幕行序，实心无缺格）', missing === 0, '缺 ' + missing + ' 格');
})();

/* ── 13b. 朝向（回归：算法 4 曾把矩阵行号当数学坐标，导致所有形状上下颠倒） ── */
console.log('\n── 13b. 模板朝向 ──');
// 用真实点位反推 ASCII，第一行必须是矩阵第 0 行（画面顶行）
// 注意必须用 templateFor（含填充风格）—— 描边形状的网格尺寸与实心不同，
// 拿实心尺寸去反推会算出格号越界的点。
function artOf(id) {
  const def = S.SHAPES.find((s) => s.id === id);
  const t = S.templateFor(def);
  const r = S.layout(def, t.count, { seed: 3, fill: S.fillModeOf(def) });
  const M = Math.max(t.cols, t.rows);
  const s = 1 / M;
  const ox = (1 - t.cols * s) / 2;
  const oy = (1 - t.rows * s) / 2;
  const grid = [];
  for (let j = 0; j < t.rows; j++) grid.push(new Array(t.cols).fill('·'));
  r.pts.forEach((p) => {
    const i = Math.round((p.x - ox) / s - 0.5);
    const j = Math.round((p.y - oy) / s - 0.5);
    grid[j][i] = '█';
  });
  return grid.map((row) => row.join(''));
}
const rowCount = (grid, j) => grid[j].split('').filter((c) => c === '█').length;
const colOf = (grid, j) => grid[j].indexOf('█') + (grid[j].lastIndexOf('█') - grid[j].indexOf('█')) / 2;

const heartArt = artOf('heart');
// 心形手绘模板每行格子数应为 [4,7,7,7,5,3,1]：顶行两瓣（4 格、中间留凹口）、底行 1 格居中
const heartRows = heartArt.map((r) => r.split('').filter((c) => c === '█').length);
ok('心形两瓣在上、尖在下（不上下颠倒）',
  heartRows.join(',') === '4,7,7,7,5,3,1' &&
  heartArt[0][(heartArt[0].length - 1) / 2] === '·' &&
  Math.abs(colOf(heartArt, heartArt.length - 1) - (heartArt[0].length - 1) / 2) < 0.6,
  '每行格子数 [' + heartRows.join(',') + '] 顶行 ' + heartArt[0] + ' 底行 ' + heartArt[heartArt.length - 1]);

const triArt = artOf('triangle');
ok('三角形尖在上、底边在下',
  rowCount(triArt, 0) === 1 && rowCount(triArt, triArt.length - 1) === triArt[0].length,
  '顶行 ' + rowCount(triArt, 0) + ' 底行 ' + rowCount(triArt, triArt.length - 1));

const treeArt = artOf('christmasTree');
ok('圣诞树尖在上、树干在下',
  rowCount(treeArt, 0) === 1 && rowCount(treeArt, treeArt.length - 1) <= 2,
  '顶行 ' + treeArt[0] + ' 底行 ' + treeArt[treeArt.length - 1]);

const starArt = artOf('star5');
ok('五角星尖在上（第一行只有中间一格）',
  rowCount(starArt, 0) === 1 && Math.abs(colOf(starArt, 0) - (starArt[0].length - 1) / 2) < 0.6,
  '顶行 ' + starArt[0]);

// 通用：手工模板的每一行都要映射到同样序号的屏幕行（自动栅格化路径同样适用）
// 遍历的是**生效风格**的模板（描边网格尺寸与实心不同）
let orientBad = '';
S.SHAPES.forEach((s) => {
  const t = S.templateFor(s);
  if (!t || t.rows < 2) return;
  const art = artOf(s.id);
  for (let j = 0; j < t.rows; j++) {
    for (let i = 0; i < t.cols; i++) {
      const on = t.cells[j * t.cols + i];
      if (on && art[j][i] !== '█') orientBad += ' ' + s.id + '(' + i + ',' + j + ')';
    }
  }
});
ok('所有形状：矩阵行序与画面行序一致（无翻转）', !orientBad, orientBad.slice(0, 140));

// 自动栅格化的形状（非手工模板）也要朝向正确 —— 抽说明型形状：房子屋顶在上、底座在下
const houseArt = artOf('house');
ok('房子屋顶在上、底座在下（自动栅格化路径朝向一致）',
  rowCount(houseArt, 0) < rowCount(houseArt, houseArt.length - 1),
  '顶行 ' + rowCount(houseArt, 0) + ' 底行 ' + rowCount(houseArt, houseArt.length - 1));
// 部分填充：n < 张数 → 前 n 个格子（阅读顺序），绝不重复照片
const part = S.layout(heart, 10, { seed: 3 });
ok('照片不足时按阅读顺序部分填充', part.pts.length === 10 && part.cell === full.cell, 'pts=' + part.pts.length);
// 部分填充的点必须是整张模板的前 10 个
ok('部分填充 = 整张模板的前缀', part.pts.every((p, i) => p.x === full.pts[i].x && p.y === full.pts[i].y));
// 全形状：模板张数全部落在合理区间且各不相同地固定
// 每种形状：按（生效风格的）张数排点，点数恒等且走的是模板路径
let tplBad = '';
S.SHAPES.forEach((s) => {
  const t = S.templateFor(s);
  if (!t || t.count < 6 || t.count > 90) tplBad += ' ' + s.id + '=' + (t ? t.count : 'null');
});
ok('全部内置形状都有固定模板且张数在 6~90 之间', !tplBad, tplBad.slice(0, 120));

// 固定张数是**用户可见契约**：形状库卡片、编辑器提示都按它告诉用户「准备多少张」。
// 一旦派生规则、填充风格或手工模板被改动导致张数漂移，老用户按提示备好的照片集
// 就会被门禁卡住，所以这里用快照锁死；改动张数必须是有意为之，并同步 UI 文案与文档。
// 快照值 = **按形状推荐填充风格**算出的张数（ring 会挖掉内部格，所以比实心少）。
const TPL_SNAPSHOT = {
  // 实心
  heart: 34, heartFestival: 34, doubleHeart: 62, circle: 37, square: 36, diamond: 25, ellipse: 34,
  // 描边
  star5: 22, star6: 26, triangle: 16, house: 20, gift: 22, pumpkin: 18, christmasTree: 25,
  // 渐变
  snowflake: 49, flower: 42, rabbit: 41, loveLock: 46, couple: 52, familyTree: 47, holdingHands: 42
};
let snapBad = '';
S.SHAPES.forEach((s) => {
  const t = S.templateFor(s);
  const want = TPL_SNAPSHOT[s.id];
  if (want == null) return;
  if (!t || t.count !== want) snapBad += ` ${s.id}:${t ? t.count : 'null'}≠${want}`;
});
ok('固定张数快照一致（张数是用户可见契约，漂移即报错）', !snapBad, snapBad.slice(0, 160));
ok('快照表覆盖全部内置形状（新增形状必须补进快照）',
  S.SHAPES.every((s) => TPL_SNAPSHOT[s.id] != null),
  S.SHAPES.filter((s) => TPL_SNAPSHOT[s.id] == null).map((s) => s.id).join(','));

/* ── 13c. 填充风格（实心 / 描边 / 渐变） ── */
console.log('\n── 13c. 填充风格 ──');
// 1) 三档分配齐全且合法
const modeCount = { solid: 0, ring: 0, fade: 0 };
let modeBad = '';
S.SHAPES.forEach((s) => {
  const m = S.fillModeOf(s);
  if (m !== 'solid' && m !== 'ring' && m !== 'fade') modeBad += ' ' + s.id + '=' + m;
  else modeCount[m]++;
});
ok('每个内置形状都有合法的填充风格', !modeBad, modeBad.slice(0, 120));
ok('三档风格都有形状（视觉风格均衡，不是一边倒）',
  modeCount.solid >= 3 && modeCount.ring >= 3 && modeCount.fade >= 3,
  JSON.stringify(modeCount));

// 2) 描边规则：不留「四邻全开」的内部格（这正是「空心」的定义），且张数 ≤ 实心
let ringBad = '';
S.SHAPES.forEach((s) => {
  const base = S.templateOf(s);
  const ring = S.applyFillMode(base, 'ring');
  const at = (i, j) => (i >= 0 && j >= 0 && i < ring.cols && j < ring.rows ? ring.cells[j * ring.cols + i] : false);
  for (let j = 0; j < ring.rows; j++) {
    for (let i = 0; i < ring.cols; i++) {
      if (!ring.cells[j * ring.cols + i]) continue;
      if (at(i - 1, j) && at(i + 1, j) && at(i, j - 1) && at(i, j + 1)) ringBad += ' ' + s.id + '(' + i + ',' + j + ')';
    }
  }
  if (ring.count > base.count) ringBad += ' ' + s.id + ':涨了';
});
ok('描边风格不留内部格（空心成立）且张数不增', !ringBad, ringBad.slice(0, 140));

// 3) 描边张数兜底：任何形状描边后都不能少于 6 格（少到看不出形状就退回实心）
let ringSmall = '';
S.SHAPES.forEach((s) => {
  const ring = S.applyFillMode(S.templateOf(s), 'ring');
  if (ring.count < 6) ringSmall += ' ' + s.id + '=' + ring.count;
});
ok('描边兜底生效：任何形状描边后都 ≥ 6 格', !ringSmall, ringSmall.slice(0, 120));

// 4) 多部件形状切到描边时，主干必须基本保留：
//    枝条交汇处、躯干加宽处、树冠这类「厚实块」会有内部格，挖掉是「描边」的正常语义
//    （树冠会变成空心轮廓），但不能挖塌 —— 保留率低于 40% 说明判定过于激进、形状会散架。
['snowflake', 'holdingHands', 'couple', 'familyTree', 'loveLock'].forEach((id) => {
  const s = S.SHAPES.find((x) => x.id === id);
  const base = S.templateOf(s);
  const ring = S.applyFillMode(base, 'ring');
  const keep = ring.count / base.count;
  ok('多部件形状（' + s.name + '）描边后主干保留（≥40%）', keep >= 0.4,
    ring.count + '/' + base.count + ' = ' + (keep * 100).toFixed(0) + '%');
});

// 5) 描边是「只减不增」的变换：ring 的每一格都必须来自实心网格（不会凭空长出新格）
let subsetBad = '';
S.SHAPES.forEach((s) => {
  const base = S.templateOf(s);
  const ring = S.applyFillMode(base, 'ring');
  for (let k = 0; k < ring.cells.length; k++) {
    if (ring.cells[k] && !base.cells[k]) subsetBad += ' ' + s.id + '#' + k;
  }
});
ok('描边是实心网格的子集（不会凭空长格）', !subsetBad, subsetBad.slice(0, 120));

// 5) 渐变风格：张数不变（透明度由渲染层处理，模板不动）
let fadeBad = '';
S.SHAPES.forEach((s) => {
  const base = S.templateOf(s);
  const fade = S.applyFillMode(base, 'fade');
  if (fade.count !== base.count || fade.cells !== base.cells) fadeBad += ' ' + s.id;
});
ok('渐变风格不改变张数与网格（只调透明度）', !fadeBad, fadeBad.slice(0, 120));

// 6) 三档都能排点，且点数恒等于该风格的张数
let styleBad = '';
['solid', 'ring', 'fade'].forEach((mode) => {
  S.SHAPES.forEach((s) => {
    const t = S.templateFor(s, mode);
    const r = S.layout(s, t.count, { fill: mode });
    if (r.pts.length !== t.count) styleBad += ' ' + s.id + '/' + mode + ':' + r.pts.length + '≠' + t.count;
  });
});
ok('三种风格 × 所有形状：排点数恒等于该风格张数', !styleBad, styleBad.slice(0, 140));
// 同一形状三种风格的点位互不相同（除非几何上等价，如描边兜底退回实心）
const heartTpl = { solid: S.templateFor(heart, 'solid').count, ring: S.templateFor(heart, 'ring').count, fade: S.templateFor(heart, 'fade').count };
ok('心形三档风格张数各自明确（实心=渐变 > 描边）',
  heartTpl.solid === heartTpl.fade && heartTpl.ring < heartTpl.solid,
  JSON.stringify(heartTpl));
// 每种形状：整张模板排点数恒等于模板张数
let fullBad = '';
S.SHAPES.forEach((s) => {
  const t = S.templateFor(s);
  const r = S.layout(s, t.count, { seed: 5, fill: S.fillModeOf(s) });
  if (r.pts.length !== t.count) fullBad += ' ' + s.id;
});
ok('每种形状按模板张数排点数量恒等', !fullBad, fullBad.slice(0, 120));
// legacy 标志：强制跳过模板走自适应
const lg = S.layout(heart, 20, { seed: 3, legacy: true });
ok('legacy 标志跳过模板走自适应排点', lg.pts.length === 20 && Math.abs(lg.cell - 1 / 7) > 1e-9, 'cell=' + lg.cell.toFixed(4));

/* ── 14. 批量选图的分批计划（微信单次上限 9 张 → 自动接力） ── */
console.log('\n── 14. 批量选图分批 ──');
ok('微信单次选图上限常量 = 9', B.PICK_PER_BATCH === 9, String(B.PICK_PER_BATCH));
ok('聊天一次导入上限 = 100', B.CHAT_PICK_MAX === 100, String(B.CHAT_PICK_MAX));
// 每批不超过 9、总和等于目标、批数 = ceil(left/9)
let batchBad = '';
[0, 1, 5, 8, 9, 10, 16, 18, 22, 25, 26, 34, 36, 42, 46, 49, 52, 62, 100].forEach((left) => {
  const plan = B.planPhotoBatches(left);
  const sum = plan.reduce((a, b) => a + b, 0);
  const over = plan.some((n) => n > B.PICK_PER_BATCH || n <= 0);
  if (sum !== left || over || plan.length !== Math.ceil(left / B.PICK_PER_BATCH)) {
    batchBad += ` left=${left}→[${plan.join(',')}]`;
  }
});
ok('分批计划：每批 ≤9、总和 = 目标、批数 = ⌈目标/9⌉', !batchBad, batchBad.slice(0, 140));
// 与真实形状张数对齐：34 张心形 → 4 轮（9+9+9+7）
ok('心形 34 张 → 4 轮（9/9/9/7）',
  B.planPhotoBatches(34).join(',') === '9,9,9,7',
  B.planPhotoBatches(34).join(','));
ok('满额 ≤9 张只需 1 轮（不弹多余的选图框）', B.batchRounds(9) === 1 && B.batchRounds(5) === 1);
ok('已选满（left=0）不再排批次', B.planPhotoBatches(0).length === 0 && B.batchRounds(0) === 0);
// 每种形状的批次数都不能失控（超过 12 轮说明单形状张数过多，用户会烦）
let roundBad = '';
S.SHAPES.forEach((s) => {
  const r = B.batchRounds(S.templateFor(s).count);
  if (r > 12) roundBad += ' ' + s.id + '=' + r;
});
ok('所有形状的接力轮数 ≤ 12（不会让用户选到手酸）', !roundBad, roundBad.slice(0, 120));
// 参数化：自定义每批张数（未来若微信放宽上限可直接改）
ok('分批函数支持自定义每批上限', B.planPhotoBatches(10, 4).join(',') === '4,4,2', B.planPhotoBatches(10, 4).join(','));


/* ── ASCII 预览 ── */
if (SHOW_ART) {
  console.log('\n── 形状预览（60 点） ──');
  ['heart', 'circle', 'star5', 'star6', 'christmasTree', 'flower', 'house', 'doubleHeart'].forEach((id) => {
    const s = S.SHAPES.find((x) => x.id === id);
    if (!s) return;
    console.log('\n  【' + s.name + '】');
    console.log(art(S.layout(s, 70, { seed: 11 }).pts));
  });
}

console.log('\n══════════════════════════════════════════');
console.log(` 结果：${pass} 通过 / ${fail} 失败`);
console.log('══════════════════════════════════════════');
process.exit(fail ? 1 : 0);
