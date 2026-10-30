import { replace } from '../../../utils/nav';
const store = require('../../../utils/store');
const engine = require('../../../utils/engine');

/* 关卡配置：行列数递增 → 方块数量与密度递增；球速与挡板宽度同步调整。
 *  - cols/rows : 砖块阵列规模，方块数 = cols × rows
 *  - speed     : 球的基础速度倍率
 *  - paddle    : 挡板宽度系数（越小越难接）
 *  - tough     : 需要打几次才碎的砖块比例（0~1，从第 5 关开始出现）
 */
const LEVELS = [
  { cols: 6, rows: 4,  speed: 1.0, paddle: 1.00, tough: 0 },
  { cols: 6, rows: 5,  speed: 1.08, paddle: 0.96, tough: 0 },
  { cols: 7, rows: 5,  speed: 1.16, paddle: 0.92, tough: 0 },
  { cols: 7, rows: 6,  speed: 1.24, paddle: 0.88, tough: 0 },
  { cols: 8, rows: 6,  speed: 1.32, paddle: 0.86, tough: 0.15 },
  { cols: 8, rows: 7,  speed: 1.40, paddle: 0.84, tough: 0.20 },
  { cols: 9, rows: 7,  speed: 1.50, paddle: 0.82, tough: 0.25 },
  { cols: 9, rows: 8,  speed: 1.60, paddle: 0.80, tough: 0.30 },
  { cols: 10, rows: 8, speed: 1.72, paddle: 0.78, tough: 0.35 },
  { cols: 10, rows: 9, speed: 1.85, paddle: 0.76, tough: 0.40 },
  { cols: 11, rows: 9, speed: 2.00, paddle: 0.74, tough: 0.45 },
  { cols: 12, rows: 10, speed: 2.15, paddle: 0.72, tough: 0.50 }
];
const MAX_LEVEL = LEVELS.length;

const TONES = ['#BE6F44', '#C9A25E', '#A6C9B5', '#8FB89E', '#B4835B', '#6F9E86'];

Page({
  data: {
    title: '打方块', statText: '生命 3 · 得分 0', timeText: '00:00', paused: false,
    level: 1, maxLevel: MAX_LEVEL, levelLabel: '6×4',
    /* 通关层 */
    win: false, winSub: '', winStats: [], winNewBest: false, winQuote: '',
    allClear: false
  },

  onLoad() {
    this.timer = engine.makeTimer((s) => this.setData({ timeText: store.formatTime(s) }));
    this.timer.start();
    this.running = false; this.paused = false;
    const rec = store.getGame('breakout');
    this.setData({ level: Math.min(rec.unlocked || 1, MAX_LEVEL) });
  },

  onReady() { this.initCanvas(); },

  initCanvas() {
    wx.createSelectorQuery().select('#cv').fields({ node: true, size: true, rect: true }).exec((res) => {
      const info = res[0];
      const canvas = info.node;
      const ctx = canvas.getContext('2d');
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
      canvas.width = info.width * dpr;
      canvas.height = info.height * dpr;
      ctx.scale(dpr, dpr);
      this.canvas = canvas; this.ctx = ctx; this.W = info.width; this.H = info.height;
      this.rectLeft = info.left; this.rectTop = info.top;
      this.reset();
      this.startLoop();
    });
  },

  cfg() { return LEVELS[Math.min(this.data.level, MAX_LEVEL) - 1]; },

  reset() {
    const W = this.W, H = this.H;
    const cfg = this.cfg();

    const pw = Math.min(140, W * 0.34) * cfg.paddle;
    this.paddle = { w: pw, h: 16, x: (W - pw) / 2, y: H - 44 };

    // 基础速度随关卡提升
    const base = 3.2 * cfg.speed;
    this.baseVx = base;
    this.baseVy = -base * 1.12;
    this.ball = { r: 8, x: W / 2, y: H - 70, vx: this.baseVx, vy: this.baseVy };

    this.bricks = [];
    const cols = cfg.cols, rows = cfg.rows, pad = 8;
    const bw = (W - pad * (cols + 1)) / cols;
    // 行数多时压缩砖高，保证全部装得下
    const areaH = H * 0.62;
    const bh = Math.max(14, Math.min(26, (areaH - pad * (rows + 1)) / rows));
    const toughCount = cfg.tough > 0 ? Math.round(cols * rows * cfg.tough) : 0;
    const toughFlags = [];
    for (let i = 0; i < cols * rows; i++) toughFlags.push(i < toughCount);
    engine.shuffle(toughFlags);

    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tough = toughFlags[k++];
        this.bricks.push({
          x: pad + c * (bw + pad),
          y: 56 + r * (bh + pad),
          w: bw, h: bh,
          color: TONES[r % TONES.length],
          alive: true,
          hp: tough ? 2 : 1,
          maxHp: tough ? 2 : 1
        });
      }
    }

    this.totalBricks = this.bricks.length;
    this.score = 0; this.lives = 3;
    this.setData({
      levelLabel: cfg.cols + '×' + cfg.rows,
      statText: '第 ' + this.data.level + ' 关 · 生命 3 · 得分 0',
      win: false
    });
    this.draw();
  },

  startLoop() {
    if (this.running) return;
    this.running = true;
    this.raf = () => { this.step(); if (this.running) this.canvas.requestAnimationFrame(this.raf); };
    this.canvas.requestAnimationFrame(this.raf);
  },

  step() {
    if (this.paused) return;
    const p = this.paddle, b = this.ball;
    b.x += b.vx; b.y += b.vy;
    if (b.x < b.r) { b.x = b.r; b.vx *= -1; }
    if (b.x > this.W - b.r) { b.x = this.W - b.r; b.vx *= -1; }
    if (b.y < b.r) { b.y = b.r; b.vy *= -1; }

    // 挡板反弹：命中点越靠边，水平分量越大
    if (b.y + b.r >= p.y && b.y - b.r <= p.y + p.h && b.x >= p.x && b.x <= p.x + p.w && b.vy > 0) {
      b.y = p.y - b.r; b.vy *= -1;
      b.vx += (b.x - (p.x + p.w / 2)) / (p.w / 2) * 0.7;
      // 限制水平速度上限，避免球贴着墙横飞
      const maxVx = Math.abs(this.baseVy) * 1.4;
      if (Math.abs(b.vx) > maxVx) b.vx = b.vx > 0 ? maxVx : -maxVx;
    }

    let hit = false;
    for (const br of this.bricks) {
      if (!br.alive) continue;
      if (b.x >= br.x - b.r && b.x <= br.x + br.w + b.r && b.y >= br.y - b.r && b.y <= br.y + br.h + b.r) {
        br.hp--;
        if (br.hp <= 0) { br.alive = false; this.score += 20; }
        else { this.score += 5; }
        b.vy *= -1;
        hit = true;
        this.setData({ statText: '第 ' + this.data.level + ' 关 · 生命 ' + this.lives + ' · 得分 ' + this.score });
        break;
      }
    }
    void hit;

    if (b.y > this.H + b.r) {
      this.lives--;
      this.setData({ statText: '第 ' + this.data.level + ' 关 · 生命 ' + this.lives + ' · 得分 ' + this.score });
      if (this.lives <= 0) { this.lose(); return; }
      b.x = this.W / 2; b.y = this.H - 70; b.vx = this.baseVx; b.vy = this.baseVy;
      p.x = (this.W - p.w) / 2;
    }

    if (this.bricks.every((br) => !br.alive)) {
      if (this.data.level >= MAX_LEVEL) this.win(true);
      else this.win(false);
      return;
    }
    this.draw();
  },

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  },

  draw() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    for (const br of this.bricks) {
      if (!br.alive) continue;
      ctx.fillStyle = br.color;
      this.roundRect(br.x, br.y, br.w, br.h, 6);
      ctx.fill();
      // 需要两下才碎的砖块：画一圈亮边作为提示
      if (br.maxHp > 1 && br.hp > 1) {
        ctx.strokeStyle = '#FFFCF3';
        ctx.lineWidth = 2;
        this.roundRect(br.x + 2, br.y + 2, br.w - 4, br.h - 4, 4);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#BE6F44';
    this.roundRect(this.paddle.x, this.paddle.y, this.paddle.w, this.paddle.h, 8);
    ctx.fill();
    ctx.fillStyle = '#6F9E86';
    ctx.beginPath(); ctx.arc(this.ball.x, this.ball.y, this.ball.r, 0, Math.PI * 2); ctx.fill();
  },

  onTouchMove(e) {
    if (this.paused || !this.paddle) return;
    const x = e.touches[0].x - this.rectLeft;
    this.paddle.x = Math.max(0, Math.min(this.W - this.paddle.w, x - this.paddle.w / 2));
  },

  /** 过关（allClear=true 表示已是最后一关，全部通关） */
  win(allClear) {
    this.running = false; this.timer.stop();
    const sec = this.timer.get();
    const score = this.score;
    const lv = this.data.level;

    let isNewBest = false;
    try {
      const res = store.finishRound('breakout', {
        win: true, score, timeSec: sec,
        unlock: Math.min(lv + 1, MAX_LEVEL)
      });
      isNewBest = res.isNewBest;
    } catch (e) { /* 统计失败不影响通关展示 */ }

    const cleared = this.bricks.filter((b) => !b.alive).length;
    this.setData({
      allClear: !!allClear,
      win: true,
      winSub: allClear
        ? '全部 ' + MAX_LEVEL + ' 关通关 · 恭喜'
        : '第 ' + lv + ' 关 · ' + this.totalBricks + ' 块全清',
      winStats: [
        { label: '得分', value: String(score) },
        { label: '方块', value: cleared + '/' + this.totalBricks },
        { label: '用时', value: store.formatTime(sec) }
      ],
      winNewBest: isNewBest,
      winQuote: engine.blessing()
    });
    if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light', fail: () => {} });
  },

  lose() {
    this.running = false; this.timer.stop();
    const score = this.score;
    store.recordPlay('breakout', { score });
    this.loseModal(score);
  },

  loseModal(score) {
    const lv = this.data.level;
    const need = this.bricks.filter((b) => b.alive).length;
    wx.showModal({
      title: '球漏光啦',
      content: '第 ' + lv + ' 关还剩 ' + need + ' 块没打完。\n本局得分 ' + score + '。再接再厉！',
      confirmText: '重打本关', cancelText: '返回',
      success: (r) => {
        if (r.confirm) { this.timer.reset(); this.timer.start(); this.reset(); this.startLoop(); }
        else this.goHome();
      }
    });
  },

  /** 通关层：下一关 */
  onAgain() {
    const next = this.data.allClear ? this.data.level : Math.min(this.data.level + 1, MAX_LEVEL);
    this.setData({ level: next, win: false });
    this.timer.reset(); this.timer.start();
    this.reset();
    this.startLoop();
  },
  onWinHome() { this.goHome(); },

  onPrevLevel() {
    if (this.data.level <= 1) { wx.showToast({ title: '已是第一关', icon: 'none' }); return; }
    this.setData({ level: this.data.level - 1, win: false });
    this.timer.reset(); this.timer.start();
    this.reset(); this.startLoop();
  },

  onNextLevel() {
    if (this.data.level >= MAX_LEVEL) { wx.showToast({ title: '已是最后一关', icon: 'none' }); return; }
    this.setData({ level: this.data.level + 1, win: false });
    this.timer.reset(); this.timer.start();
    this.reset(); this.startLoop();
  },

  onReset() { this.timer.reset(); this.timer.start(); this.reset(); this.startLoop(); },
  onHint() { wx.showToast({ title: '手指左右滑动控制挡板；带亮边的砖要打两下', icon: 'none' }); },
  onBack() { this.running = false; this.timer.stop(); wx.navigateBack({ delta: 1, fail: () => this.goHome() }); },
  onHome() { this.goHome(); },
  goHome() {
    this.running = false; this.timer.stop();
    store.recordPlay('breakout', { score: this.score || 0 });
    wx.navigateBack({ delta: 1, fail: function () { replace('/subpackages/games/pages/center/center'); } });
  },
  onPause() {
    const np = !this.data.paused;
    this.setData({ paused: np }); this.paused = np;
    if (!np) this.startLoop();
  },
  onUnload() { this.running = false; this.timer.stop(); }
});
