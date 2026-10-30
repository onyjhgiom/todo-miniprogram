// scripts/scan-recruit-theme.js —— 扫描秋招各页 WXSS 中需要深色覆盖的类
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '..', 'miniprogram', 'subpackages', 'recruit', 'pages', 'recruit');
const LIGHT = /(#fff\b|#ffffff|white|#f8fafc|#f9fafb|#fbfbfd|#f1f5f9|#eef2ff|#f5f6fb)/i;
const DARKTXT = /(#0f172a|#1a1d29|#111827|#1e293b|#334155|#475569|#64748b|#94a3b8|#1d4ed8|#B5714C)/i;

for (const f of ['recruit', 'detail', 'openings', 'resource', 'resume', 'analysis', 'calendar']) {
  const css = fs.readFileSync(path.join(dir, f + '.wxss'), 'utf8');
  const light = new Set();
  const dark = new Set();
  for (const b of css.split('}')) {
    const m = b.match(/^([^{]+)\{([\s\S]*)$/);
    if (!m) continue;
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!sel || sel.includes('@') || sel.includes('data-theme') || sel.includes(':')) continue;
    const body = m[2];
    const bg = body.match(/background(?:-color)?:\s*([^;]+)/);
    const fg = body.match(/[^-a-z]color:\s*([^;]+)/);
    if (bg && LIGHT.test(bg[1])) light.add(sel);
    if (fg && DARKTXT.test(fg[1])) dark.add(sel);
  }
  console.log('-- ' + f + ' --');
  console.log('LIGHT: ' + Array.from(light).join(' '));
  console.log('TEXT : ' + Array.from(dark).join(' '));
  console.log('');
}
