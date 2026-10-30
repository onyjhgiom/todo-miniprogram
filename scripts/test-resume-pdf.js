// 本地冒烟测试：验证 jpegSize 解析与 PDF 装配（不依赖云环境）
const fs = require('fs');
const path = require('path');

// 复用被测文件里的两个纯函数：这里用 eval 摘取，避免 wx-server-sdk 在 Node 下初始化失败
const src = fs.readFileSync(path.join(__dirname, '../cloudfunctions/resume/index.js'), 'utf8');
const startJpeg = src.indexOf('function jpegSize');
const endJpeg = src.indexOf('/* ==================== 最小 PDF 构造');
const startPdf = src.indexOf('function buildPdf');
const endPdf = src.indexOf('/* ==================== 入口');

const code = src.slice(startJpeg, endJpeg) + '\n' + src.slice(startPdf, endPdf) + '\nmodule.exports={jpegSize,buildPdf};';
const mod = { exports: {} };
new Function('module', 'Buffer', code)(mod, Buffer);
const { jpegSize, buildPdf } = mod.exports;

const jpgPath = 'C:/Users/陈乐天/.workbuddy/app/playbook-covers/3396084921bd118744a45e8423380e200ff5508946d1ef5aba9172acb4adbd90.jpg';
const buf = fs.readFileSync(jpgPath);

const size = jpegSize(buf);
console.log('JPEG 文件字节数:', buf.length);
console.log('解析出的尺寸:', size);

if (!size) { console.log('❌ 尺寸解析失败'); process.exit(1); }

const pdf = buildPdf([{ buffer: buf, width: size.width, height: size.height }]);
fs.writeFileSync(path.join(__dirname, '../cloudfunctions/resume/_out.pdf'), pdf);
console.log('PDF 字节数:', pdf.length);
console.log('PDF 头:', pdf.slice(0, 9).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
console.log('PDF 尾:', pdf.slice(-30).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));

// 基础结构校验
const s = pdf.toString('latin1');
const checks = [
  ['以 %PDF 开头', s.startsWith('%PDF-')],
  ['含 Catalog', s.includes('/Type /Catalog')],
  ['含 Pages', s.includes('/Type /Pages')],
  ['含 Page', s.includes('/Type /Page')],
  ['含 DCTDecode 图片', s.includes('/Filter /DCTDecode')],
  ['含 xref', s.includes('xref')],
  ['含 trailer', s.includes('trailer')],
  ['以 %%EOF 结尾', s.trimEnd().endsWith('%%EOF')]
];
let ok = true;
for (const [name, pass] of checks) {
  console.log((pass ? '✓' : '✗') + ' ' + name);
  if (!pass) ok = false;
}

// startxref 偏移必须指向 xref 关键字
const m = /startxref\s+(\d+)/.exec(s);
if (m) {
  const off = Number(m[1]);
  const at = s.substr(off, 4);
  console.log((at === 'xref' ? '✓' : '✗') + ` startxref 偏移正确 (${off} -> "${at}")`);
  if (at !== 'xref') ok = false;
} else {
  console.log('✗ 未找到 startxref');
  ok = false;
}

console.log(ok ? '\n✅ PDF 结构校验通过' : '\n❌ PDF 结构校验失败');
process.exit(ok ? 0 : 1);
