/**
 * 云函数一键上传（不依赖微信开发者工具 GUI）
 *
 * ── 用法 ───────────────────────────────────────────────
 *   node scripts/upload-cloudfn.js todos          # 只传 todos
 *   node scripts/upload-cloudfn.js todos notes    # 传多个
 *   node scripts/upload-cloudfn.js --all          # 传全部云函数
 *
 * ── 运行前只需准备一次 ─────────────────────────────────
 * 1. 登录 https://mp.weixin.qq.com →「开发管理 → 开发设置」
 *    →「小程序代码上传密钥」→ 生成并下载 private.key
 *    → 放到项目根目录：todo-miniprogram/private.key
 *    （也可放同目录的 private.wx514f26332600479c.key）
 * 2. 同一页面「IP 白名单」里加上你当前的公网 IP（家庭宽带 IP 会变，
 *    变了要重新改；不改会报 "invalid ip"）。
 * 3. 安装依赖（已装可跳过）：
 *      cd C:\Users\陈乐天\.workbuddy\binaries\node\workspace
 *      npm install miniprogram-ci
 *
 * ── 说明 ───────────────────────────────────────────────
 * remoteNpmInstall: true 表示「上传并部署（云端安装依赖）」，
 * 与开发者工具右键上传的该选项等价，云函数有 package.json 时必须用它。
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APPID = 'wx514f26332600479c';
const CLOUD_FN_ROOT = path.join(PROJECT_ROOT, 'cloudfunctions');

// 从托管目录加载 miniprogram-ci（不污染项目本身）
const CI_CANDIDATES = [
  'C:/Users/陈乐天/.workbuddy/binaries/node/workspace/node_modules/miniprogram-ci',
  path.join(PROJECT_ROOT, 'node_modules/miniprogram-ci')
];

function loadCI() {
  for (const p of CI_CANDIDATES) {
    try {
      return require(p);
    } catch (e) {
      /* 继续找下一个 */
    }
  }
  console.error('✗ 未找到 miniprogram-ci。请先执行：');
  console.error('  cd C:\\Users\\陈乐天\\.workbuddy\\binaries\\node\\workspace && npm install miniprogram-ci');
  process.exit(1);
}

function findPrivateKey() {
  const names = [`private.${APPID}.key`, 'private.key'];
  for (const n of names) {
    const p = path.join(PROJECT_ROOT, n);
    if (fs.existsSync(p)) return p;
  }
  console.error('✗ 未找到代码上传密钥 private.key。');
  console.error('  请到 mp.weixin.qq.com → 开发管理 → 开发设置 → 生成「小程序代码上传密钥」，');
  console.error(`  下载后放到：${path.join(PROJECT_ROOT, 'private.key')}`);
  process.exit(1);
}

function listFunctions() {
  return fs
    .readdirSync(CLOUD_FN_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => fs.existsSync(path.join(CLOUD_FN_ROOT, n, 'index.js')));
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('用法： node scripts/upload-cloudfn.js <函数名...> 或 --all');
    console.log('可用云函数：' + listFunctions().join(', '));
    return;
  }

  let targets = [];
  if (args.includes('--all')) {
    targets = listFunctions();
  } else {
    const all = listFunctions();
    for (const a of args) {
      if (!all.includes(a)) {
        console.error(`✗ 云函数「${a}」不存在。可用：${all.join(', ')}`);
        process.exit(1);
      }
      targets.push(a);
    }
  }

  const ci = loadCI();
  const privateKeyPath = findPrivateKey();

  const project = new ci.Project({
    appid: APPID,
    type: 'miniProgram',
    projectPath: PROJECT_ROOT,
    privateKeyPath,
    ignores: ['node_modules/**/*', 'miniprogram/node_modules/**/*']
  });

  let ok = 0;
  let fail = 0;
  for (const name of targets) {
    process.stdout.write(`↑ 上传 ${name} ... `);
    try {
      await ci.uploadCloudFunction({
        project,
        name,
        path: path.join(CLOUD_FN_ROOT, name),
        remoteNpmInstall: true
      });
      console.log('完成');
      ok++;
    } catch (e) {
      const msg = (e && (e.message || e.errMsg)) || String(e);
      console.log('失败');
      console.error(`   ${msg}`);
      if (/ip/i.test(msg)) {
        console.error('   → 多半是 IP 白名单未配置：mp.weixin.qq.com → 开发管理 → 开发设置 → IP 白名单');
      } else if (/privateKey|key/i.test(msg)) {
        console.error('   → 检查 private.key 是否为本小程序的上传密钥');
      }
      fail++;
    }
  }

  console.log(`\n完成：成功 ${ok} 个，失败 ${fail} 个。`);
  if (ok) {
    console.log('提示：回到微信开发者工具重新编译小程序，云端新能力才会生效。');
  }
}

main().catch((e) => {
  console.error('✗ 执行失败：', e && e.message ? e.message : e);
  process.exit(1);
});
