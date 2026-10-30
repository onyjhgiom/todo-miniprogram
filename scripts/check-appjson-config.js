#!/usr/bin/env node
// scripts/check-appjson-config.js —— app.json 合法字段守卫
//
// 背景：小程序基础库对 app.json 做**严格 schema 校验**，字段名或字段值不在白名单里
// 会直接报 [miniprogram/app.json 文件内容错误]，整个 app 起不来。本脚本把这些
// 已知踩过的坑固化成回归守卫，避免"照搬博客写法"反复踩。
//
// 覆盖：
//   1) JSON 本身合法
//   2) requiredPrivateInfos 的每个值都在官方 8 个「地理位置接口」白名单内
//      （最容易错：把 record/camera 等非位置接口塞进去 —— 录音不在此列！）
//   3) permission 的 key 只能是官方列出的 scope（当前仅 scope.userLocation）
//   4) 不存在已废弃/不存在的顶层字段（如 navigateToMiniProgramAppIdList）
//   5) 页面路由自检：pages 与 subpackages[].pages 路径必须真实存在
//
// 用法：node scripts/check-appjson-config.js
// 退出码：0 = 全通过；1 = 有失败
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const MINIPROGRAM = path.join(ROOT, 'miniprogram');
const APP_JSON = path.join(MINIPROGRAM, 'app.json');

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}

console.log('\n[1] app.json 存在且 JSON 合法');
let app = null;
try {
  app = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
  ok(true, 'app.json 可解析');
} catch (e) {
  ok(false, 'app.json 可解析', e.message);
  console.log('\n无法继续检查。');
  process.exit(1);
}

console.log('\n[2] requiredPrivateInfos —— 仅限官方 8 个地理位置接口');
// 来源：https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html
// 「自 2022 年 7 月 14 日后发布的小程序，使用以下 8 个地理位置相关接口时，需要声明该字段」
const RPI_ALLOWED = [
  'getFuzzyLocation', 'getLocation', 'onLocationChange', 'startLocationUpdate',
  'startLocationUpdateBackground', 'chooseLocation', 'choosePoi', 'chooseAddress'
];
const rpi = app.requiredPrivateInfos || [];
ok(Array.isArray(rpi), 'requiredPrivateInfos 是数组');
const rpiBad = rpi.filter((v) => !RPI_ALLOWED.includes(v));
ok(rpiBad.length === 0, 'requiredPrivateInfos 全部在白名单内（共 ' + rpi.length + ' 项）',
  '非法值：' + rpiBad.join(', ') + ' —— 录音 record / 摄像头 camera 等不在此白名单内！');
// 提示：录音等普通授权接口不需要在此声明
const dupRpi = rpi.filter((v, i) => rpi.indexOf(v) !== i);
ok(dupRpi.length === 0, 'requiredPrivateInfos 无重复项', dupRpi.join(', '));

console.log('\n[3] permission —— key 只能是官方列出的 scope');
// 官方 app.json 文档中 permission 目前只列出 scope.userLocation
const PERMISSION_ALLOWED = ['scope.userLocation'];
const pkeys = Object.keys(app.permission || {});
const pBad = pkeys.filter((k) => !PERMISSION_ALLOWED.includes(k));
ok(pBad.length === 0, 'permission 的 key 合法（共 ' + pkeys.length + ' 项）',
  pBad.join(', ') + ' —— 录音 scope.record 不需在 app.json 声明，运行时用 wx.authorize 申请');
Object.keys(app.permission || {}).forEach((k) => {
  const desc = (app.permission[k] || {}).desc;
  ok(typeof desc === 'string' && desc.length > 0 && desc.length <= 30,
    'permission.' + k + '.desc 存在且 ≤30 字符', '实际 ' + (desc || '').length);
});

console.log('\n[4] 不存在的顶层字段');
// navigateToMiniProgramAppIdList 从来不是 app.json 合法配置，基础库会报 invalid
ok(!('navigateToMiniProgramAppIdList' in app),
  '未配置非法的 navigateToMiniProgramAppIdList',
  '跳转目标 appId 在调用处传入，白名单配在小程序后台');
const KNOWN_TOP = [
  'pages', 'window', 'tabBar', 'networkTimeout', 'debug', 'functionalPages',
  'subpackages', 'workers', 'requiredBackgroundModes', 'requiredPrivateInfos',
  'plugins', 'permission', 'sitemapLocation', 'style', 'lazyCodeLoading',
  'entryPagePath', 'preloadRule', 'usingComponents', 'componentFramework',
  'debugOptions', 'resizable', 'navigateToMiniProgramAppIdList'
];
// ⚠️ 重要：微信基础库会对「未知顶层字段」报 invalid app.json。_comment_* 这类自造注释键
// 也会被标记（实测在 3.17.2 下输出 invalid app.json ["_comment_requiredPrivateInfos"]）。
// JSON 不支持注释，相关说明统一放在本脚本头部与 README，切勿再往 app.json 塞 _comment_*。
const commentKeys = Object.keys(app).filter((k) => k.startsWith('_comment'));
ok(commentKeys.length === 0, '未使用 _comment_* 注释键（微信会报 invalid）',
  commentKeys.join(', ') + ' —— 注释说明请放本脚本 / README');
const unknown = Object.keys(app).filter((k) => !KNOWN_TOP.includes(k));
ok(unknown.length === 0, '无未知顶层字段', unknown.join(', '));

console.log('\n[5] 路由自检：注册页必须真实存在');
const missing = [];
(app.pages || []).forEach((p) => {
  ['ts', 'js', 'wxml'].forEach((ext) => {
    const base = path.join(MINIPROGRAM, p + '.' + ext);
    const hasTs = fs.existsSync(base);
    const hasJs = fs.existsSync(path.join(MINIPROGRAM, p + '.js'));
    if (!hasTs && !hasJs && ext === 'ts') missing.push(p + '.ts/js');
  });
});
(app.subpackages || []).forEach((pkg) => {
  (pkg.pages || []).forEach((p) => {
    const abs = path.join(MINIPROGRAM, pkg.root, p);
    const hasTs = fs.existsSync(abs + '.ts');
    const hasJs = fs.existsSync(abs + '.js');
    const hasWxml = fs.existsSync(abs + '.wxml');
    if (!hasTs && !hasJs) missing.push(pkg.root + '/' + p);
    if (!hasWxml) missing.push(pkg.root + '/' + p + '.wxml');
  });
});
ok(missing.length === 0,
  '注册的 ' + (app.pages || []).length + ' 主包页 + 分包页均有对应文件',
  missing.slice(0, 8).join(' | '));

console.log('\n==================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  console.log('失败项：');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
