// scripts/check-photowall.js —— 照片墙模块冒烟（形状算法 / 渲染管线 / 本地存储）
//
// 三个子脚本跑的都是编译后的 JS（.tmp-pw），所以这里先做一次 tsc 输出，再依次执行。
// 覆盖：
//   · 排点算法：形状可辨、点数守恒、极端数量、可复现
//   · 渲染管线：mock canvas 下照片落点 / 尺寸 / 裁剪 / 装饰 / 导出尺寸
//   · 存储层：存读往返、图片永久化、删除清理、收藏、蒙版、待办解锁
//
// 用法：node scripts/check-photowall.js

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const TSC = path.join(
  process.env.LOCALAPPDATA || '',
  '..', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'typescript', 'bin', 'tsc'
);

function run(file) {
  return execFileSync(NODE, [path.join(ROOT, 'scripts', file)], { encoding: 'utf8', stdio: 'pipe' });
}

// 找一个可用的 tsc：优先 workspace，其次本地 node_modules
function findTsc() {
  const cands = [
    TSC,
    path.join('C:', 'Users', '陈乐天', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return null;
}

const tsc = findTsc();
if (!tsc) {
  console.error('未找到 tsc，跳过照片墙冒烟');
  process.exit(0);
}

console.log('编译 TypeScript → .tmp-pw …');
try {
  execFileSync(NODE, [tsc, '-p', 'tsconfig.json', '--outDir', '.tmp-pw', '--noEmit', 'false',
    '--declaration', 'false', '--sourceMap', 'false'], { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
  console.error('编译失败（既有错误不影响产出时仍会生成 JS）');
}

let failed = 0;
[
  ['check-photowall-shapes.js', '形状排点算法'],
  ['check-photowall-render.js', '渲染管线'],
  ['check-photowall-store.js', '本地存储']
].forEach(([file, label]) => {
  console.log('\n──────── ' + label + ' ────────');
  try {
    const out = run(file);
    process.stdout.write(out);
    if (out.indexOf('❌') >= 0) failed++;
  } catch (e) {
    failed++;
    console.log('  ❌ ' + label + ' 脚本异常：' + (e && e.message ? e.message.split('\n')[0] : e));
    if (e && e.stdout) process.stdout.write(e.stdout.toString());
  }
});

console.log('\n══════════════════════════════════════════');
console.log(failed ? ` 照片墙冒烟：${failed} 个子项失败` : ' 照片墙冒烟：全部通过');
console.log('══════════════════════════════════════════');
process.exit(failed ? 1 : 0);
