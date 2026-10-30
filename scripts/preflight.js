// scripts/preflight.js —— 上线前全量门禁（一条命令跑完全部自检）
//
// 从「首页 → 工具栏 → 各功能入口」的可达性，到页面模板结构、模块依赖、包体积、
// 以及课程表模块的功能回归，全部收在这里。上传/预览前跑一次，即可确认：
//
//   · 没有任何入口点了打不开（路由未注册 / 组件未声明 / 依赖缺失）
//   · 没有页面会白屏（模板标签错配 / 导入路径断裂）
//   · 主分包体积都在 2MB 限额内，且非运行时文件不会被上传
//   · 已知功能模块的行为没有回归
//
// 用法：node scripts/preflight.js          只跑静态检查（秒级）
//       node scripts/preflight.js --full   额外跑课程表功能回归测试
// 退出码：0 全通过 / 1 有失败项
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FULL = process.argv.includes('--full');

/** 递归收集 wxml */
function walkWxml(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      walkWxml(full, out);
    } else if (ent.name.endsWith('.wxml') && !/\.bak/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

const WXML_FILES = walkWxml(path.join(ROOT, 'miniprogram'));

const CHECKS = [
  {
    name: '入口可达性 / 组件注册 / 模块依赖',
    desc: '63 个页面 · 组件声明 · wxml 标签 · 跳转目标 · 导入解析',
    cmd: 'scripts/check-routes.js',
    args: []
  },
  {
    name: 'WXML 模板结构配对',
    desc: `${WXML_FILES.length} 个模板的标签闭合与嵌套`,
    cmd: 'scripts/check-wxml-tags.js',
    args: WXML_FILES
  },
  {
    name: '代码包体积限额',
    desc: '主包/分包 < 2MB，并核对 packOptions.ignore',
    cmd: 'scripts/check-package-size.js',
    args: ['--top=5']
  },
  {
    name: '自定义导航栏几何',
    desc: '状态栏/胶囊/标题不重叠',
    cmd: 'scripts/check-navbar.js',
    args: []
  },
  {
    name: '首页风格维度一致性',
    desc: '常量 / 选择器 / WXSS 类名三方对齐',
    cmd: 'scripts/check-home-skin.js',
    args: []
  },
  {
    name: '资产账本页面完整性',
    desc: '四件套文件齐备',
    cmd: 'scripts/check-asset-ledger.js',
    args: []
  },
  {
    name: '小助手 AI 链路',
    desc: 'ops 归一化 · 模型顺延 · 错误分级 · 多模态 · 简报 · 前端纯函数',
    cmd: 'scripts/check-helper-ai.js',
    args: []
  },
  {
    name: '卦相 AI 识别链路（面相 / 手相）',
    desc: '供应商识别 · 候选链顺延 · thinking 自适应 · 白名单过滤 · 错误分级',
    cmd: 'scripts/check-gua-ai.js',
    args: []
  },
  {
    name: '秋招岗位数据校验',
    desc: '招聘数据源结构合法',
    cmd: 'scripts/check-openings.js',
    args: []
  },
  {
    name: '秋招助手 · 数据层冒烟',
    desc: '面试安排 · 提醒计划 · 待办 reminders 落库 · 收藏关注',
    cmd: 'scripts/check-recruit-store.js',
    args: []
  },
  {
    name: '秋招助手 · 智能分析层冒烟',
    desc: '简历诊断 · 岗位匹配 · 今日清单 · 面试提纲 · 岗位推荐 · 看板诊断 · 资源上下文',
    cmd: 'scripts/check-recruit-intel.js',
    args: []
  },
  {
    name: '目标拆解 · 智能分析层冒烟',
    desc: '目标分类 · 周期解析（含中文数字）· 结构预览 · 可行性分析 · 策略推荐',
    cmd: 'scripts/check-goal-insight.js',
    args: []
  },
  {
    name: '旅行清单 · 数据层 / AI 链路冒烟',
    desc: 'AI 能力解耦 · 兜底 Key · 冷备切换 · 云端 id 对齐 · 删除不复活 · 墓碑补删',
    cmd: 'scripts/check-travel-store.js',
    args: []
  },
  {
    name: '路由健壮性守卫',
    desc: '禁止裸路由 · 目标页已注册 · 外跳 appId 已声明',
    cmd: 'scripts/check-nav-routing.js',
    args: []
  },
  {
    name: '表单控件守卫',
    desc: '原生 input 必须显式定高（防占位文字被裁）· placeholder-class 必须存在',
    cmd: 'scripts/check-input-sizing.js',
    args: []
  },
  {
    name: '添加到桌面 · 平台分流与埋点',
    desc: 'iOS 绝不误判为可添加 · 仅 scene 1023 计数 · 旧基础库兜底',
    cmd: 'scripts/test-add-to-desktop.js',
    args: []
  },
  {
    name: '弹幕引擎 · 轨道与性能',
    desc: '同行不重叠 · 密度上限 · 区域计算 · 长帧夹取 · 单帧耗时',
    cmd: 'scripts/check-danmaku-engine.mjs',
    args: []
  },
  {
    name: '弹幕方向 / 全屏适配',
    desc: '方向判定 · 安全区约束轨道与行程 · 旋转不闪断 · 竖横屏差异',
    cmd: 'scripts/check-danmaku-orientation.mjs',
    args: []
  },
  {
    name: '迷宫 · 第 10 关手感冒烟',
    desc: '阈值自适应 · 连续滑动 · 长按连发 · 单步单次 setData · 撞墙判定不变 · 完美迷宫结构不变',
    cmd: 'scripts/check-maze-feel.js',
    args: []
  },
  {
    name: '岗位报名链接守卫',
    desc: '体制内 65 条 + 校招社招 272 条必有官方报名入口 · 域名在官方白名单 · 禁用第三方站与短链',
    cmd: 'scripts/check-civil-apply-link.js',
    args: []
  },
  {
    name: '照片墙 · 排点 / 渲染 / 存储',
    desc: '形状可辨 · 点数守恒 · 落点在画布内 · 图片永久化 · 删除清目录',
    cmd: 'scripts/check-photowall.js',
    args: []
  },
  {
    name: '订阅提醒 · 推送链路与字段格式',
    desc: '授权配额累积 · 47003 不清配额 · 字段贴官方正则（time 不带年月日）· 两云函数 KEY_MAP 一致',
    cmd: 'scripts/test-push-reminder.js',
    args: []
  }
];

if (FULL) {
  CHECKS.push(
    {
      name: '课程表 · 存储/校验/本地解析',
      desc: 'smoke.js 功能回归',
      cmd: 'miniprogram/course-schedule/test/smoke.js',
      args: []
    },
    {
      name: '课程表 · AI 层容错',
      desc: 'ai-assist.js 功能回归',
      cmd: 'miniprogram/course-schedule/test/ai-assist.js',
      args: []
    },
    {
      name: '课程表 · 主题皮肤',
      desc: 'theme-check.js 功能回归',
      cmd: 'miniprogram/course-schedule/test/theme-check.js',
      args: []
    }
  );
}

const results = [];
console.log('══════════════════════════════════════════════════════');
console.log(' 上线前全量门禁' + (FULL ? '（含功能回归）' : '（静态检查，加 --full 跑功能回归）'));
console.log('══════════════════════════════════════════════════════\n');

for (const c of CHECKS) {
  const started = Date.now();
  let out = '';
  let pass = true;
  try {
    out = execFileSync(process.execPath, [c.cmd, ...c.args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    pass = false;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const ms = Date.now() - started;
  results.push({ ...c, pass, out, ms });
  const mark = pass ? '通过' : '失败';
  console.log(`[${mark}] ${c.name}  (${ms}ms)`);
  console.log(`        ${c.desc}`);
  if (!pass) {
    // 只回显失败行，保持输出可读
    out
      .split('\n')
      .filter((l) => /FAIL|失败|错误|Error/.test(l))
      .slice(0, 12)
      .forEach((l) => console.log('        │ ' + l.trim()));
  }
}

const failed = results.filter((r) => !r.pass);
const totalMs = results.reduce((s, r) => s + r.ms, 0);

console.log('\n══════════════════════════════════════════════════════');
console.log(` 门禁结果：${results.length - failed.length}/${results.length} 项通过，耗时 ${totalMs}ms`);
console.log('══════════════════════════════════════════════════════');

if (failed.length) {
  console.log('\n未通过项（修复后再上线）：');
  failed.forEach((f) => console.log(`  ✗ ${f.name}`));
  process.exit(1);
}

console.log('\n全部通过，可以安全上传 / 预览。');
process.exit(0);
