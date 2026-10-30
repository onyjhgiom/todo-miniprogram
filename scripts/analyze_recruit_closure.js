const fs = require('fs'), path = require('path');
const MP = path.resolve('miniprogram');
const exts = ['.ts', '.js', '.d.ts', '.json', '.wxss', '.wxml'];

function resolveImp(fromFile, spec) {
  let base;
  if (spec.startsWith('/')) base = path.join(MP, spec);
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // 包名/裸模块
  const cands = [base, ...exts.map((e) => base + e), ...exts.map((e) => path.join(base, 'index' + e))];
  for (const c of cands) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return { missing: base };
}

function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const r = resolveImp(file, m[1]);
    if (r && r.missing) out.push({ spec: m[1], missing: r.missing });
    else if (r) out.push({ spec: m[1], file: r });
  }
  return out;
}

// 1) recruit 簇的闭包
const roots = fs.readdirSync(path.join(MP, 'subpackages/tools/pages/recruit'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(MP, 'subpackages/tools/pages/recruit', f));
const inClosure = new Set();
const missing = [];
const stack = [...roots];
while (stack.length) {
  const f = stack.pop();
  if (inClosure.has(f)) continue;
  inClosure.add(f);
  for (const im of importsOf(f)) {
    if (im.missing) { missing.push([f, im.spec]); continue; }
    if (im.file.includes('node_modules')) continue;
    stack.push(im.file);
  }
}
// 闭包里的 .json/.wxml 依赖也带上（usingComponents / wxs）
const closureFiles = new Set();
for (const f of inClosure) for (const e of ['', '.js', '.wxml', '.json', '.wxss']) {
  const p = e ? f.replace(/\.ts$/, e) : f;
  if (fs.existsSync(p)) closureFiles.add(p);
}

// 2) 全项目反向引用表
const allFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(q); }
    else if (/\.(ts|js|json|wxml|wxss)$/.test(e.name)) allFiles.push(q);
  }
})(MP);

const users = new Map();
for (const f of allFiles) {
  for (const im of importsOf(f)) {
    if (im.missing || !im.file) continue;
    if (!users.has(im.file)) users.set(im.file, new Set());
    users.get(im.file).add(f);
  }
}

// 3) 哪些闭包文件被闭包外引用 = 阻塞项
const blockers = [];
for (const f of closureFiles) {
  const u = users.get(f) || new Set();
  const outside = [...u].filter((x) => !closureFiles.has(x));
  if (outside.length) blockers.push([f.replace(MP + path.sep, ''), outside.map((x) => x.replace(MP + path.sep, ''))]);
}

let total = 0;
for (const f of closureFiles) total += fs.statSync(f).size;
console.log('闭包文件数', closureFiles.size, '合计', (total / 1024).toFixed(1) + 'KB');
console.log('\n=== 闭包内文件（按体积） ===');
[...closureFiles].map((f) => [fs.statSync(f).size, f.replace(MP + path.sep, '')])
  .sort((a, b) => b[0] - a[0]).forEach(([s, f]) => console.log((s / 1024).toFixed(1).padStart(8) + 'KB  ' + f));
console.log('\n=== 阻塞项：闭包内但被闭包外引用（必须留原地/留主包） ===');
if (!blockers.length) console.log('无 ✅ 可整簇搬走');
else blockers.forEach(([f, us]) => console.log('  ' + f + '\n      ← ' + us.join('\n      ← ')));
console.log('\n=== 未解析的导入 ===');
missing.forEach(([f, s]) => console.log('  ' + f.replace(MP + path.sep, '') + '  ->  ' + s));
