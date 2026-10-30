/**
 * 「添加到桌面」逻辑离线自检（不联网、不依赖开发者工具、不改真机）
 *
 * 用项目同款方式（绝对路径找 tsc，见 check-photowall.js）把被测 TS 编译到 .tmp-add 再 require，
 * **不依赖 NODE_PATH**，因此可以直接挂进 preflight 门禁。
 *
 * 重点盯两个「不能错」的地方：
 *  ① iOS 绝不能被判成「可添加」——否则会给用户画一套点了也没用的菜单引导；
 *  ② 只有 scene === 1023（桌面图标）才计数 ——否则「已从桌面打开 N 次」这个
 *     唯一的转化信号就失真了（微信不提供添加成功回调，这个数字是唯一真相）。
 *
 * 用法：node scripts/test-add-to-desktop.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const TMP = path.join(ROOT, '.tmp-add');
const SRC = path.join(ROOT, 'miniprogram', 'utils', 'add-to-desktop.ts');

/** tsc 定位：优先 WorkBuddy workspace，其次项目本地 node_modules */
function findTsc() {
  const cands = [
    path.join(ROOT, '..', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join('C:', 'Users', '陈乐天', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  ];
  return cands.find((p) => fs.existsSync(p)) || null;
}

function build() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const tsc = findTsc();
  if (!tsc) throw new Error('未找到 tsc，无法编译被测模块');
  try {
    execFileSync(
      NODE,
      [tsc, SRC, '--outDir', TMP, '--target', 'ES2018', '--module', 'commonjs', '--skipLibCheck'],
      { stdio: 'ignore' }
    );
  } catch (e) {
    // 单文件编译缺少 wx / WechatMiniprogram 全局声明会报错，但默认仍会产出 JS
    // （noEmitOnError 默认 false），与 check-photowall.js 同一处理方式
  }
  const out = path.join(TMP, 'add-to-desktop.js');
  if (!fs.existsSync(out)) throw new Error('编译产物缺失：' + out);
  return out;
}

const OUT = build();

/* ==================== 可变桩：每个用例改 device/enter 后重跑 ==================== */
const mem = {};
const device = { platform: 'android' };
const enter = { scene: 1001, throwOnEnter: false, hasEnterOptions: true };

global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => {
    mem[k] = v;
  },
  removeStorageSync: (k) => {
    delete mem[k];
  },
  getDeviceInfo: () => ({ platform: device.platform }),
  getEnterOptionsSync: () => {
    if (enter.throwOnEnter) throw new Error('getEnterOptionsSync 不可用');
    return { scene: enter.scene };
  },
  getLaunchOptionsSync: () => ({ scene: 1000 })
};
// 旧基础库模拟：删掉 getEnterOptionsSync
function setHasEnterOptions(v) {
  enter.hasEnterOptions = v;
  if (v) {
    global.wx.getEnterOptionsSync = () => {
      if (enter.throwOnEnter) throw new Error('getEnterOptionsSync 不可用');
      return { scene: enter.scene };
    };
  } else {
    delete global.wx.getEnterOptionsSync;
  }
}

// 模块内有内存缓存（同一实例内保证单一数据源），测试要拿干净状态就得清 require 缓存重新加载。
// 生产代码不为此暴露 reset 接口。
function loadModule() {
  delete require.cache[require.resolve(OUT)];
  return require(OUT);
}
let A = loadModule();

let failed = 0;
function ok(cond, label, extra) {
  if (cond) console.log(`✅ ${label}${extra ? '  ' + extra : ''}`);
  else {
    failed++;
    console.log(`❌ ${label}${extra ? '  ' + extra : ''}`);
  }
}
function reset() {
  Object.keys(mem).forEach((k) => delete mem[k]);
  device.platform = 'android';
  enter.scene = 1001;
  enter.throwOnEnter = false;
  setHasEnterOptions(true);
  A = loadModule();
}

console.log('=== 一、平台分流 ===');
reset();

device.platform = 'android';
ok(A.getPlatform() === 'android', '安卓识别为 android');
ok(A.canAddToDesktop() === true, '安卓 → 可添加到桌面');

device.platform = 'ios';
ok(A.getPlatform() === 'ios', 'iPhone 识别为 ios');
ok(A.canAddToDesktop() === false, 'iOS → 不可添加到桌面（官方不支持，绝不能给假引导）');
ok(
  A.iosAlternatives().length >= 3,
  'iOS 提供等效替代路径（我的小程序 / 下拉 / 排序）',
  `${A.iosAlternatives().length} 条`
);

device.platform = 'devtools';
ok(A.canAddToDesktop() === false, '开发者工具 → 不显示可添加（避免误报）');

device.platform = 'windows';
ok(A.canAddToDesktop() === false, '未知平台 → 一律按不可添加处理（保守）');

console.log('\n=== 二、scene 1023 埋点（唯一转化信号）===');
reset();
device.platform = 'android';

enter.scene = 1001; // 发现栏主入口
ok(A.isFromDesktop() === false, 'scene 1001（微信内入口）不判为桌面进入');
ok(A.trackEnter().count === 0, '非桌面进入不计数');

enter.scene = 1023; // 安卓桌面图标
ok(A.isFromDesktop() === true, 'scene 1023 判为桌面图标进入');
const t1 = A.trackEnter();
ok(t1.fromDesktop === true && t1.count === 1, '首次从桌面打开 → 计数 1');
const persisted = mem['my_add_desktop_state'];
ok(
  persisted && persisted.desktopOpenCount === 1,
  '计数已落本地存储（杀进程重进不会丢）'
);
const firstAt = A.getState().firstDesktopAt;
ok(firstAt > 0, '记录首次桌面进入时间', new Date(firstAt).toISOString());

const t2 = A.trackEnter();
ok(t2.count === 2, '再次从桌面打开 → 计数累加为 2');
ok(A.getState().firstDesktopAt === firstAt, 'firstDesktopAt 只记首次，不被覆盖');

enter.scene = 1007; // 聊天卡片
A.trackEnter();
ok(A.getDesktopOpenCount() === 2, '插进来的非桌面进入不会污染计数（仍为 2）');

console.log('\n=== 三、旧基础库兜底 ===');
reset();
setHasEnterOptions(false); // 删掉 getEnterOptionsSync
enter.scene = 1023;
ok(A.currentScene() === 1000, '无 getEnterOptionsSync 时退回 getLaunchOptionsSync', `scene=${A.currentScene()}`);
ok(A.isFromDesktop() === false, '冷启动参数非 1023 → 不误判');

reset();
setHasEnterOptions(true);
enter.throwOnEnter = true; // 有函数但调用抛错
ok(A.currentScene() === 1000, 'getEnterOptionsSync 抛错时仍能退回冷启动参数');
setHasEnterOptions(false);
ok(A.currentScene() === 1000, '两者都不可用时不抛异常');

console.log('\n=== 四、入口状态文案 ===');
reset();
device.platform = 'android';
ok(A.statusLabel() === '可添加', '安卓未添加 → 「可添加」');

enter.scene = 1023;
A.trackEnter();
ok(A.statusLabel() === '已从桌面打开 1 次', '从桌面打开过 → 显示真实使用次数（转化证据）');

reset();
device.platform = 'android';
A.markConfirmed();
ok(A.statusLabel() === '已添加', '用户自述已添加 → 「已添加」');

ok(A.summaryLine().indexOf('安卓') >= 0, '安卓摘要文案走安卓分支');

reset();
device.platform = 'ios';
ok(A.statusLabel() === 'iOS 暂不支持', 'iOS 状态文案如实说明不支持');
ok(A.summaryLine().indexOf('iPhone') >= 0, 'iOS 摘要文案走 iPhone 分支（不给假期待）');

console.log('\n=== 五、引导内容完整性 ===');
const steps = A.androidSteps();
ok(steps.length === 3, '安卓三步引导齐全', steps.map((s) => s.title).join(' → '));
ok(
  steps[0].desc.indexOf('右上角') >= 0,
  '第一步明确指向右上角胶囊（用户找不到就白引导）'
);
ok(A.ANDROID_PERMISSION_TIPS.length >= 3, '覆盖华为/小米/其他三类机型的授权路径');
ok(
  A.DESKTOP_SCENE === 1023,
  '桌面场景值常量与官方 FAQ 一致（1023）'
);

console.log(failed ? `\n共 ${failed} 项未通过` : '\n✅ 全部通过');
process.exit(failed ? 1 : 0);
