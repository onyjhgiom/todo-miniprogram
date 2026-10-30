import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

function hasEdge(edges, a, b) {
  return edges.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a));
}

/** 生成欧拉图：连通且奇度顶点 ≤ 2，保证一笔画可解 */
function genLevel(level) {
  const n = 4 + ((level - 1) % 6); // 4..9 个节点
  const edges = [];
  for (let i = 1; i < n; i++) { const p = Math.floor(Math.random() * i); edges.push([p, i]); }
  let deg = new Array(n).fill(0);
  edges.forEach(([a, b]) => { deg[a]++; deg[b]++; });
  let odds = [];
  for (let i = 0; i < n; i++) if (deg[i] % 2 === 1) odds.push(i);
  let guard = 0;
  while (odds.length > 2 && guard++ < 50) {
    const a = odds.shift();
    let bi = 0;
    for (let k = 0; k < odds.length; k++) { if (!hasEdge(edges, a, odds[k])) { bi = k; break; } }
    const b = odds.splice(bi, 1)[0];
    edges.push([a, b]); deg[a]++; deg[b]++;
    odds = [];
    for (let i = 0; i < n; i++) if (deg[i] % 2 === 1) odds.push(i);
  }
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    nodes.push({ x: 50 + 40 * Math.cos(ang), y: 50 + 40 * Math.sin(ang) });
  }
  return { nodes, edges, n };
}

/** 在剩余边中求从 start 出发的欧拉路径（Hierholzer） */
function eulerTrail(nodes, edges, start) {
  const adj = nodes.map(() => []);
  edges.forEach((e, idx) => { adj[e.a].push({ to: e.b, ei: idx }); adj[e.b].push({ to: e.a, ei: idx }); });
  const used = new Array(edges.length).fill(false);
  let s = start;
  if (s == null || s < 0) { for (let i = 0; i < nodes.length; i++) if (adj[i].length) { s = i; break; } }
  const path = [];
  function dfs(u) {
    while (adj[u].length) {
      const e = adj[u].pop();
      if (used[e.ei]) continue;
      used[e.ei] = true;
      dfs(e.to);
      path.push(u);
    }
  }
  dfs(s);
  path.reverse();
  return path;
}

function findEdgeIdx(edges, a, b) {
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return i;
  }
  return -1;
}

Page({
  data: {
    title: '一笔画', level: 1, unlocked: 1, total: 0, done: 0, points: 0,
    message: '点节点，沿未画的线一笔走完', msgType: 'info',
    timeText: '00:00', paused: false, showHint: true
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    const rec = store.getGame('onestroke');
    const lvl = Math.min(rec.unlocked || 1, 100);
    this.setData({ unlocked: lvl, points: store.getHintState().points });
    this.loadLevel(lvl);
  },

  onReady() {
    const q = wx.createSelectorQuery().in(this);
    q.select('#cv').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0]) return;
      const canvas = res[0].node; const ctx = canvas.getContext('2d');
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
      canvas.width = res[0].width * dpr; canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);
      this.canvas = canvas; this.ctx = ctx; this.cw = res[0].width; this.ch = res[0].height;
      this.draw();
    });
    q.select('#cv').boundingClientRect((r) => { this.rect = r; }).exec();
  },

  loadLevel(level) {
    const g = genLevel(level);
    this.edges = g.edges.map(([a, b]) => ({ a, b, done: false }));
    this.nodes = g.nodes;
    this.sel = -1; this.hint = -1;
    this.setData({
      level, total: this.edges.length, done: 0,
      message: '第 ' + level + ' 关 · 共 ' + this.edges.length + ' 条线', msgType: 'info'
    });
    this.draw();
  },

  px(p) { return { x: (p.x / 100) * this.cw, y: (p.y / 100) * this.ch }; },

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cw, this.ch);
    // 边
    this.edges.forEach((e, i) => {
      const A = this.px(this.nodes[e.a]); const B = this.px(this.nodes[e.b]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      ctx.lineWidth = i === this.hint ? 10 : 7;
      ctx.strokeStyle = e.done ? '#6F9E86' : (i === this.hint ? '#C9A25E' : '#C9B6A0');
      ctx.stroke();
    });
    // 节点
    this.nodes.forEach((nd, i) => {
      const P = this.px(nd);
      ctx.beginPath(); ctx.arc(P.x, P.y, this.cw * 0.055, 0, Math.PI * 2);
      ctx.fillStyle = (i === this.sel) ? '#BE6F44' : '#FFFCF5';
      ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#BE6F44'; ctx.stroke();
    });
  },

  onTouch(e) {
    if (!this.rect) return;
    const t = e.touches[0];
    const x = t.clientX - this.rect.left; const y = t.clientY - this.rect.top;
    let best = -1, bestD = 1e9;
    this.nodes.forEach((nd, i) => {
      const P = this.px(nd);
      const d = Math.hypot(P.x - x, P.y - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0 || bestD > this.cw * 0.09) return;
    this.tapNode(best);
  },

  tapNode(i) {
    if (this.sel < 0) { this.sel = i; this.hint = -1; this.draw(); return; }
    if (i === this.sel) return;
    const ei = findEdgeIdx(this.edges, this.sel, i);
    if (ei >= 0 && !this.edges[ei].done) {
      this.edges[ei].done = true;
      this.sel = i; this.hint = -1;
      const done = this.edges.filter((e) => e.done).length;
      this.setData({ done });
      this.draw();
      if (done === this.edges.length) this.win();
    } else {
      this.sel = i; this.draw(); // 切换起点，不画线
    }
  },

  win() {
    const pts = store.addPoints(5);
    const next = Math.min(this.data.level + 1, 100);
    if (next > this.data.unlocked) this.setData({ unlocked: next });
    store.recordPlay('onestroke', { win: true, unlock: next, steps: this.data.total });
    this.setData({ points: pts, message: '第 ' + this.data.level + ' 关完成！+5 积分', msgType: 'ok' });
    setTimeout(() => { if (this.data.level < this.data.unlocked) this.loadLevel(next); else this.loadLevel(this.data.level); }, 900);
  },

  onHint() {
    const st = store.consumeHint(5);
    if (st.result === 'none') { this.setData({ message: '积分不足，今天还有 ' + st.freeLeft + ' 次免费提示', msgType: 'warn' }); return; }
    const remain = this.edges.map((e, i) => ({ e, i })).filter((o) => !o.e.done).map((o) => o.e);
    const startNode = this.sel >= 0 ? this.sel : null;
    const trail = eulerTrail(this.nodes, remain, startNode);
    if (!trail || trail.length < 2) { this.setData({ message: '已无可走线路', msgType: 'warn' }); return; }
    const idx = findEdgeIdx(this.edges, trail[0], trail[1]);
    this.hint = idx; this.setData({ points: st.points }); this.draw();
    this.setData({ message: (st.result === 'free' ? '（免费）' : '（消耗 ' + st.cost + ' 积分）') + ' 沿高亮线走', msgType: 'ok' });
  },

  prevLevel() { if (this.data.level > 1) this.loadLevel(this.data.level - 1); },
  nextLevel() { if (this.data.level < this.data.unlocked) this.loadLevel(this.data.level + 1); },
  onReset() { this.loadLevel(this.data.level); },
  onBack() { wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() { wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } }); },
  onPause() { this.setData({ paused: this.timer.toggle() }); },
  onUnload() { this.timer.stop(); }
});
