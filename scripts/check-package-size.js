// scripts/check-package-size.js —— 代码包体积门禁
//
// 微信小程序硬性限制：单个分包/主包不超过 2MB（2048KB），全部包合计不超过 20MB。
// 主包体积直接决定「冷启动耗时」与「点击入口的响应速度」——主包越大，
// 启动时要解析的代码越多，首屏和第一次点击就越慢。
//
// 本脚本给出：主包/各分包体积、超限判定、以及体积占比 TOP 榜（定位可优化的大文件）。
// 用法：node scripts/check-package-size.js [--top=25]
// 退出码：0 未超限 / 1 有包超限
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const LIMIT_KB = 2048;
const TOTAL_LIMIT_KB = 20480;

const topArg = (process.argv.find((a) => a.startsWith('--top=')) || '--top=20').split('=')[1];
const TOP = Math.max(5, parseInt(topArg, 10) || 20);

const toPosix = (p) => p.replace(/\\/g, '/');
const kb = (n) => (n / 1024).toFixed(1);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walk(full, out);
    } else {
      // 注意：这里【不】跳过 .bak —— 磁盘上有多少就统计多少，
      // 是否从上传包里剔除交给 packOptions.ignore 决定，否则会低估真实体积。
      out.push({ abs: full, size: fs.statSync(full).size });
    }
  }
  return out;
}

const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
const subRoots = (appJson.subpackages || []).map((s) => toPosix(s.root));

/** project.config.json 的 packOptions.ignore —— 上传时会被排除的文件 */
const projCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
const ignoreRules = ((projCfg.packOptions || {}).ignore || []).slice();

/** glob → RegExp（支持 **、*、? 三种通配） */
function globToRe(g) {
  let out = '^';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        out += '.*';
        i++;
        if (g[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp(out + '$');
}

function isIgnored(relFromMp) {
  for (const rule of ignoreRules) {
    const v = rule.value;
    if (rule.type === 'suffix' && relFromMp.endsWith(v)) return true;
    if (rule.type === 'file' && relFromMp === toPosix(v)) return true;
    if (rule.type === 'folder' && (relFromMp === toPosix(v) || relFromMp.startsWith(toPosix(v) + '/'))) return true;
    if (rule.type === 'glob' && globToRe(v).test(relFromMp)) return true;
    if (rule.type === 'regexp' && new RegExp(v).test(relFromMp)) return true;
  }
  return false;
}

const all = walk(MP).map((f) => ({ ...f, rel: toPosix(path.relative(MP, f.abs)) }));
const ignored = all.filter((f) => isIgnored(f.rel));
const kept = all.filter((f) => !isIgnored(f.rel));

/** 归属判定 */
function ownerOf(relFromMp) {
  for (const root of subRoots) {
    if (relFromMp.startsWith(root + '/')) return root;
  }
  return '__main__';
}

const buckets = new Map(); // owner -> files[]
for (const f of kept) {
  const owner = ownerOf(f.rel);
  if (!buckets.has(owner)) buckets.set(owner, []);
  buckets.get(owner).push(f);
}

const sum = (arr) => arr.reduce((s, x) => s + x.size, 0);
const mainFiles = buckets.get('__main__') || [];
const mainKB = sum(mainFiles) / 1024;

console.log('==============================================');
console.log(' 代码包体积门禁');
console.log('==============================================\n');

let fail = 0;
const line = (label, kbVal, limit) => {
  const over = kbVal > limit;
  if (over) fail++;
  const flag = over ? 'FAIL' : 'OK  ';
  const pct = ((kbVal / limit) * 100).toFixed(1);
  console.log(
    `${flag} ${label.padEnd(22)} ${kbVal.toFixed(1).padStart(8)} KB / ${limit} KB  (${pct}%)`
  );
};

line('主包', mainKB, LIMIT_KB);
const subKB = [];
for (const root of subRoots) {
  const files = buckets.get(root) || [];
  const v = sum(files) / 1024;
  subKB.push(v);
  line('分包 ' + root, v, LIMIT_KB);
}
const totalKB = mainKB + subKB.reduce((a, b) => a + b, 0);
line('全部包合计', totalKB, TOTAL_LIMIT_KB);

console.log('');
const overCount = (mainKB > LIMIT_KB ? 1 : 0) + subKB.filter((v) => v > LIMIT_KB).length;
if (overCount) {
  console.log(`!! 有 ${overCount} 个包超过 2MB 上限，无法上传，必须瘦身。\n`);
} else {
  console.log(`主包余量：${(LIMIT_KB - mainKB).toFixed(1)} KB\n`);
}

/** packOptions.ignore 生效情况：这些文件不会被上传，也就不占启动解析成本 */
if (ignored.length) {
  const igKB = sum(ignored) / 1024;
  console.log(`--- 已被 packOptions.ignore 排除：${ignored.length} 个文件 / ${igKB.toFixed(1)} KB ---`);
  const byRule = new Map();
  for (const f of ignored) {
    let matched = '未匹配';
    for (const rule of ignoreRules) {
      const v = rule.value;
      const hit =
        (rule.type === 'suffix' && f.rel.endsWith(v)) ||
        (rule.type === 'file' && f.rel === toPosix(v)) ||
        (rule.type === 'folder' && f.rel.startsWith(toPosix(v) + '/')) ||
        (rule.type === 'glob' && globToRe(v).test(f.rel)) ||
        (rule.type === 'regexp' && new RegExp(v).test(f.rel));
      if (hit) {
        matched = `${rule.type}:${v}`;
        break;
      }
    }
    byRule.set(matched, (byRule.get(matched) || 0) + f.size);
  }
  [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([rule, s]) => console.log(`  ${kb(s).padStart(8)} KB  ${rule}`));
  console.log('  （本地开发/预览时仍可正常编译调试，仅上传包不含这些文件）\n');
} else {
  console.log('提示：packOptions.ignore 为空，备份/测试/文档等非运行时文件也会被打进包里。\n');
}

/** 主包 TOP 榜：定位可以挪进分包 / 压缩的大文件 */
console.log(`--- 主包体积 TOP ${TOP}（占主包 ${mainKB.toFixed(0)} KB）---`);
mainFiles
  .sort((a, b) => b.size - a.size)
  .slice(0, TOP)
  .forEach((x) => {
    const pct = ((x.size / 1024 / mainKB) * 100).toFixed(1);
    console.log(`  ${kb(x.size).padStart(8)} KB  ${pct.padStart(5)}%  ${x.rel}`);
  });

/** 按目录聚合，便于判断「哪一坨该拆出去」 */
console.log('\n--- 主包各目录体积 ---');
const byDir = new Map();
for (const x of mainFiles) {
  const top = x.rel.includes('/') ? x.rel.split('/').slice(0, 2).join('/') : x.rel;
  byDir.set(top, (byDir.get(top) || 0) + x.size);
}
[...byDir.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([d, s]) => {
    const pct = ((s / 1024 / mainKB) * 100).toFixed(1);
    console.log(`  ${kb(s).padStart(8)} KB  ${pct.padStart(5)}%  ${d}`);
  });

/** preloadRule 预下载体积预算：单条规则内的分包合计受 2MB 限制，超出会 80058 上传失败 */
const preloadRules = appJson.preloadRule || {};
const ruleKeys = Object.keys(preloadRules);
if (ruleKeys.length) {
  console.log('\n--- preloadRule 预下载体积预算（单条规则内分包合计 ≤ 2048 KB）---');
  const pkgKB = new Map();
  for (const root of subRoots) pkgKB.set(root, sum(buckets.get(root) || []) / 1024);
  for (const key of ruleKeys) {
    const pkgs = preloadRules[key].packages || [];
    const total = pkgs.reduce((s, p) => s + (pkgKB.get(p) || 0), 0);
    const over = total > LIMIT_KB;
    if (over) fail++;
    console.log(
      `${over ? 'FAIL' : 'OK  '} rule[${key}]`.padEnd(42) +
      `${total.toFixed(1).padStart(8)} KB / ${LIMIT_KB} KB  (${pkgs.length} 个分包)`
    );
    if (over) {
      console.log(
        '       ↑ 预下载合计超 2MB，上传会报 80058（preloadRule source size exceed max limit）。\n' +
        '         处理：减少该规则的 packages，或把落单的分包改用运行时预热\n' +
        '         wx.preloadSubpackage（见 pages/tools/tools.ts 的 preloadSubPackages）。'
      );
    }
  }
}

console.log('\n==============================================');
console.log(fail ? ` 结果：FAIL ${fail} 项（存在超限包）` : ' 结果：全部在限额内');
console.log('==============================================');
process.exit(fail ? 1 : 0);
