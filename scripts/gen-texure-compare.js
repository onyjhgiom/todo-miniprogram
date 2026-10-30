// scripts/gen-texure-compare.js
// 质感对比预览：把「页面质感 × 背景风格」并排渲染成一张对照图，
// 用来肉眼验证**切换后差异是否一眼可辨**（用户 2026-10-07 反馈：切了像没切）。
//
// 做法：读真实 tool-shell.wxss + 真实页面 wxss → rpx→px → 生成对照页。
// 卡片样式不手抄，直接用页面里真实的类名，让预览= 真实渲染。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'miniprogram/pages/todo-panel');
const OUT = path.join(ROOT, 'preview');

const W = 402;
const U = W / 750;

function wxss2css(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(-?[\d.]+)rpx/g, (_, n) => (parseFloat(n) * U).toFixed(3) + 'px')
    .replace(/env\(safe-area-inset-bottom\)/g, '0px');
}

const pageWxss = fs.readFileSync(path.join(PAGE, 'todo-panel.wxss'), 'utf8');
const shellWxss = fs.readFileSync(path.join(ROOT, 'miniprogram/styles/tool-shell.wxss'), 'utf8');
const css = wxss2css(pageWxss.replace(/@import[^;]+;/g, '') + '\n' + shellWxss);

const vars = {
  '--color-text': '#22243a',
  '--color-text-soft': '#5b5f75',
  '--color-text-mute': '#8a8da3',
  '--color-border': '#e4e6f0',
  '--color-bg-soft': '#f3f4f9',
  '--color-bg-elevated': '#ffffff',
  '--color-overlay': 'rgba(20,21,28,.45)',
  '--color-ring': '#c9ccdc',
  '--color-primary': '#5c72e8',
  '--color-primary-soft': '#eef1ff',
  '--color-primary-shadow': 'rgba(92,114,232,.32)',
  '--color-success': '#6fa384',
  '--color-success-soft': '#e6f1ea',
  '--color-danger': '#c35c66',
  '--color-danger-soft': '#fbebed',
  '--color-warning': '#b9742f',
  '--color-warning-soft': '#fbf0e3',
  '--color-card': '#ffffff',
  '--color-bg': '#f4f6fb',
  '--color-bar': 'rgba(92,114,232,.22)',
  '--shadow-md': '0 1px 2px rgba(34,36,58,.05), 0 10px 28px rgba(34,36,58,.08)',
  '--u': U + 'px',
  '--u-fs-xs': 26 * U + 'px',
  '--u-fs-sm': 24 * U + 'px'
};
const varsCss = Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('');

const PAGE_STYLES = [
  { key: 'glass', name: '立体玻璃' },
  { key: 'frost', name: '柔雾磨砂' },
  { key: 'relief', name: '丝绒浮雕' }
];
const BG_STYLES = [
  { key: 'none', name: '纯净' },
  { key: 'aurora', name: '暖晖' },
  { key: 'mesh', name: '纸纹' },
  { key: 'halo', name: '光圈' },
  { key: 'lattice', name: '栅格' },
  { key: 'dots', name: '粒子' }
];

// 每个样张只渲染关键结构：Hero 卡 + 页签 + 两条任务，足够看出质感差异
function sample() {
  return `
  <div class="tl tl-hero tl-card" style="margin-bottom:10px">
    <div class="tl-hero__top">
      <div class="tl-ring" style="width:88px;height:88px;position:relative;flex:none">
        <canvas class="tl-ring__cv" width="176" height="176"></canvas>
        <div class="tl-ring__tx"><span class="tl-ring__n">62<span class="tl-ring__s">%</span></span><span class="tl-ring__l">完成率</span></div>
      </div>
      <div class="tl-hero__tx">
        <span class="tl-eye">今日进度</span>
        <div class="tl-big"><span class="tl-big__a">5</span><span class="tl-big__b">/ 8</span><span class="tl-big__em">件</span></div>
        <span class="tl-hint">还剩 3 件</span>
      </div>
    </div>
    <div class="tl-stats">
      <div class="tl-stats__c"><span class="tl-stats__n tl-stats__n--pend">14</span><span class="tl-stats__l">待处理</span></div>
      <div class="tl-stats__c"><span class="tl-stats__n tl-stats__n--done">23</span><span class="tl-stats__l">已完成</span></div>
      <div class="tl-stats__c"><span class="tl-stats__n">3</span><span class="tl-stats__l">今日</span></div>
      <div class="tl-stats__c"><span class="tl-stats__n tl-stats__n--late">2</span><span class="tl-stats__l">已逾期</span></div>
    </div>
  </div>
  <div class="tl tl-tabs" style="--i:0;margin-bottom:10px">
    <div class="tl-tabs__ind"></div>
    <div class="tl-tab is-on"><span class="tl-tab__l">日待办</span></div>
    <div class="tl-tab"><span class="tl-tab__l">月待办</span></div>
    <div class="tl-tab"><span class="tl-tab__l">全部</span></div>
  </div>
  <div class="tl tl-task tl-card" style="margin-bottom:8px">
    <div class="tl-task__check"></div>
    <div class="tl-task__bd">
      <span class="tl-task__title">完成产品方案整理</span>
      <div class="tl-task__meta">
        <div class="tl-task__cat"><i class="tl-task__cdot" style="background:#7B8CD0"></i><span class="tl-task__cat-l">工作</span></div>
        <span class="tl-task__due">今天 14:30</span>
        <span class="tl-task__pri">重要</span>
      </div>
    </div>
  </div>
  <div class="tl tl-task tl-card is-late" style="margin-bottom:0">
    <div class="tl-task__check"></div>
    <div class="tl-task__bd">
      <span class="tl-task__title">回复重要工作邮件</span>
      <div class="tl-task__meta">
        <div class="tl-task__cat"><i class="tl-task__cdot" style="background:#7B8CD0"></i><span class="tl-task__cat-l">工作</span></div>
        <span class="tl-task__due is-late">逾期 1 天</span>
      </div>
    </div>
  </div>`;
}

function ringScript() {
  return `
  var dpr=2, cv=document.querySelector('.tl-ring__cv');
  var S=cv.width/dpr; cv.style.width=S+'px'; cv.style.height=S+'px';
  var ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
  var p=0.62, cx=S/2, cy=S/2, lw=Math.max(5,S*0.08), r=S/2-lw/2-S*0.04;
  ctx.lineCap='round';
  ctx.beginPath(); ctx.strokeStyle='rgba(113,136,209,.16)'; ctx.lineWidth=lw;
  ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
  var g=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
  g.addColorStop(0,'#7188C1'); g.addColorStop(1,'#8EA6E8');
  ctx.strokeStyle=g; ctx.lineWidth=lw;
  ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+p*Math.PI*2); ctx.stroke();
  document.querySelectorAll('.tl-ring__cv').forEach(function(c){
    if(c===cv) return;
    var s2=c.width/dpr; c.style.width=s2+'px'; c.style.height=s2+'px';
    var x2=c.getContext('2d'); x2.scale(dpr,dpr);
    var cx2=s2/2, cy2=s2/2, lw2=Math.max(5,s2*0.08), r2=s2/2-lw2/2-s2*0.04;
    x2.lineCap='round';
    x2.beginPath(); x2.strokeStyle='rgba(113,136,209,.16)'; x2.lineWidth=lw2;
    x2.arc(cx2,cy2,r2,0,Math.PI*2); x2.stroke();
    var g2=x2.createLinearGradient(cx2-r2,cy2-r2,cx2+r2,cy2+r2);
    g2.addColorStop(0,'#7188C1'); g2.addColorStop(1,'#8EA6E8');
    x2.strokeStyle=g2; x2.lineWidth=lw2;
    x2.beginPath(); x2.arc(cx2,cy2,r2,-Math.PI/2,-Math.PI/2+p*Math.PI*2); x2.stroke();
  });`;
}

// 行=质感，列=背景
const rows = PAGE_STYLES.map((ps) => `
<div class="cmp-row">
  <div class="cmp-lb">${ps.name}</div>
  ${BG_STYLES.map((bg) => `
  <div class="cmp-cell">
    <div class="cmp-cap">${bg.name}</div>
    <div class="cmp-frame tl tshell tshell-ps-${ps.key} tshell-bg-${bg.key}" style="${varsCss}">
      <div class="cmp-in">${sample()}</div>
    </div>
  </div>`).join('')}
</div>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;}
body{margin:0;padding:20px;background:#e9ecf3;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;}
${css}
.cmp-wrap{display:inline-block;}
.cmp-row{display:flex;align-items:flex-start;margin-bottom:14px;}
/* 关键：.tshell 自带 min-height:100vh，会把每个样张撑成一整屏，
   导致对照矩阵被撑成 3 个超长页面。这里必须显式压掉，
   否则真机上也会遇到"背景铺满整屏"的观感问题（对比页专用覆盖）。 */
.cmp-frame{min-height:0 !important;height:auto;}
.cmp-lb{width:76px;flex:none;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#3d4763;writing-mode:vertical-rl;letter-spacing:2px;background:#fff;border-radius:8px;margin-right:10px;height:288px;}
.cmp-cell{margin-right:12px;}
.cmp-cap{text-align:center;font-size:12px;color:#5b6379;margin-bottom:6px;font-weight:600;}
.cmp-frame{width:250px;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(30,40,70,.10);}
.cmp-in{padding:10px;}
</style></head>
<body>
<div class="cmp-wrap">
  <div style="font-size:15px;font-weight:700;color:#2c3550;margin-bottom:14px;">待办清单 · 质感 × 背景 对照（每格都是真实类名渲染）</div>
  ${rows}
</div>
<script>window.addEventListener('load',function(){${ringScript()}});</script>
</body></html>`;

fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, 'texture-compare.html');
fs.writeFileSync(outFile, html);
console.log('生成：' + outFile);
console.log('矩阵：3 种质感 × ' + BG_STYLES.length + ' 种背景');