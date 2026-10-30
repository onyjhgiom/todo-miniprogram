# course-schedule · 课表存储层与校验器

微信小程序「工具中心 → 课程表」的运行时内核。**AI 产出的 JSON 一律先过校验器，再落存储层**，避免脏数据直接写进底表。

```
course-schedule/
├── utils/
│   ├── time.js         # HH:MM / YYYY-MM-DD 工具（字符串比较，无需转 Date）
│   ├── weekRule.js     # 周次归一化 / 展开 / 交集 / 冲突检测
│   ├── slots.js        # 节次常量 + 网格行构建（作息按学校实际填写）
│   ├── format.js       # weekRule → 人话
│   ├── validator.js    # AI 输出校验（import / edit）
│   └── inlineEdit.js   # 卡片就地编辑：字段定义 + 人手输入的校验
├── store/
│   ├── scheduleStore.js# entries + overrides 分离存储，按周 merge，撤销栈
│   └── applyEdit.js    # 把 edit operations 落到 store
├── components/
│   └── undo-bar/       # 撤销提示条（5 秒自动消失，点击即回滚）
├── services/
│   ├── parser.js       # 指令解析：AI 优先（可注入），本地规则兜底
│   └── scheduleAI.js   # 课程表 AI 内核：统一意图路由 assist()，走云函数代理
├── pages/
│   ├── schedule/       # 课表主页：周次切换、网格、冲突提示、撤销入口
│   ├── schedule-edit/  # AI 课表助手：单输入框，改课表/问答/分析/建议一体
│   └── schedule-import/# 导入预览页：勾选确认 + 低置信度标黄 + 行内可改
├── app.sample.js       # app.js 接入片段
└── test/
    ├── smoke.js        # 55 项断言，node test/smoke.js
    ├── ai-assist.js    # 25 项断言，AI 层纯逻辑（JSON 容错 / 课表摘要）
    └── fixtures/sample-entries.js
```

全部 CommonJS，无第三方依赖，可直接拷进小程序 `miniprogram/` 目录，也可在 Node 下单测。

---

## 一、为什么 entries 与 overrides 要分开

| 改动类型 | 落点 | 例子 |
|---|---|---|
| 导入课表、整学期改地点/时间 | `entries`（底表） | 「把所有计算机网络教室改成博文北302」 |
| 某周停课、某周换教室 | `overrides.kind = 'week'` | 「第6周周五嵌入式停课」 |
| 从某周起生效 | `overrides.kind = 'from'` | 「第8周起操作系统改到周五」 |

好处：

1. **底表永不被临时改动污染** —— 第6周停课不会把嵌入式整门课删掉；
2. **切周只是换 merge 参数** —— `getWeek(n)` 是纯函数，不会累积副作用；
3. **撤销是一句话** —— 整批操作压一个快照，`undo()` 直接回退；
4. **学期末清理方便** —— 清空 overrides 就回到原始课表。

---

## 二、快速接入

```js
// pages/schedule/schedule.js
const ScheduleStore = require('../../course-schedule/store/scheduleStore');
const validator = require('../../course-schedule/utils/validator');
const { applyEdit } = require('../../course-schedule/store/applyEdit');

const store = new ScheduleStore({
  totalWeeks: 16,
  semesterStart: '2026-09-01',
  // storage 省略时自动使用 wx.getStorageSync / localStorage / 内存
});

Page({
  data: { week: 1, courses: [], conflicts: [] },

  onShow() {
    this.render(getApp().globalData.currentWeek || 1);
  },

  render(week) {
    const courses = store.getWeek(week);
    this.setData({
      week,
      courses,
      conflicts: store.conflictsOfWeek(week),
    });
  },

  switchWeek(e) {
    this.render(Number(e.currentTarget.dataset.week));
  },
});
```

> 切周只 `setData` 一屏数据（约 10~15 条），不要整表重建，中低端安卓上肉眼可见差异。

---

## 二点五、页面与组件

### app.json 注册

```json
{
  "pages": [
    "course-schedule/pages/schedule/index",
    "course-schedule/pages/schedule-import/index",
    "course-schedule/pages/schedule-edit/index"
  ]
}
```

撤销条组件已在 `pages/schedule/index.json` 里按页面维度注册，无需全局引入：

```json
{ "usingComponents": { "undo-bar": "/course-schedule/components/undo-bar/undo-bar" } }
```

### 导入预览页 `pages/schedule-import/index`

流程：**AI 解析 → 把 payload 放进 `app.globalData.pendingImport` → 跳转本页 → 用户勾选/修改 → 确认入库**。

```js
const result = validator.validate(raw, { totalWeeks: 16 });
getApp().globalData.pendingImport = result.value;
wx.navigateTo({ url: '/course-schedule/pages/schedule-import/index' });
// 追加而不是替换：url 加 ?mode=append
```

页面行为：
- `confidence < 0.8` 的条目自动打「待确认」标、卡片标黄，顶部可「只看待确认」；
- 卡片行内可直接改课程名 / 地点 / 教师 / 星期 / 节次 / 周次（每周·单周·双周·自定义周次范围）；
- 文本输入统一用 `bindblur`，避免每次按键触发 `setData` 导致输入框失焦；
- 确认后写入 store，并回调上一页的 `onScheduleChanged()`。

### 撤销入口

任何写操作后调用 `showUndo(text)` 唤起底部提示条：

```js
this.store.removeEntry(id);
this.render(this.data.week);
this.showUndo('已删除「' + title + '」');
```

5 秒自动消失，点「撤销」即 `store.undo()` 并重新渲染。整批 AI 编辑只压一个撤销点，所以「一次性改了 8 条」也是一键回滚。

### 课表主页 `pages/schedule/index`

- 渲染完全依赖 `store.getWeek(week)`，切周只换 merge 参数；
- 网格行由 `buildRows()` 生成：先取预设节次，识别到的非常规时间（如 3-6 节连排）自动追加为独立行，**不会丢课**；
- 左侧时间轴每行显示**上课 + 下课**两个时间（中间一条短横线连成区间）；连排课等动态行的 `end` 取同一开始时间下**最晚**的一条，缺 `endTime` 时该行不显示下课时间，绝不退化成 `08:20 / 08:20`；
- 冲突课程标红，顶部给一句汇总；
- 点课程卡片**就地编辑**（见下），面板里的「更多」保留「单周停课 / 整学期删除」——前者写 override、后者删底表，语义不混淆。

#### 就地编辑（点卡片直接改）

格子只有约 88rpx 宽（7 列），在原地塞输入框根本点不中，所以编辑面板是 **fixed 浮层**：
`wx.createSelectorQuery` 取卡片位置 → 面板从卡片那里"长出来"，视觉上就地，**不占文档流，格子和行高一动不动**。

| 行为 | 结果 |
|---|---|
| 点卡片 | 进入编辑，课程名自动聚焦 |
| 回车 / 点空白处 / 失焦 | 保存 |
| 「取消」 | 还原原值，不写入 |
| 「更多」 | 单周停课 / 整学期删除 |

写入走 `store.applyEntryEditForWeek(id, week, changes)`，落点按优先级判定：

| 当前周该课的数据来自 | 写入位置 | 影响范围 |
|---|---|---|
| 本周 override | override 的 changes | 仅本周 |
| 「从第 N 周起」override | 最后生效的那条 from override | 第 N 周及以后 |
| 都没有 | 底表 entry | 整学期 |

**为什么不能一律写底表**：第 6 周恰好有 override 覆盖了教室时，改底表会被 override 盖掉，
用户看到的还是旧值——表现为"改了没反应"。

校验在 `utils/inlineEdit.js`：课程名必填且 ≤15 字，教师/地点 ≤20 字。
非法时 **toast 明确原因并回退到修改前的值**（不是静默截断——用户正盯着输入框，
悄悄改他的输入会让人以为没保存上）。没改动则直接关闭，不写库也不压撤销点。

**边界情况**都已处理：

- 重复点同一张 → 忽略，绝不重置 draft（否则会清掉刚敲的字）；
- 点另一张 → 先提交当前编辑再开新的，连续快速编辑不丢输入；
- 三个输入框之间切焦点 → blur 延迟 150ms 提交，focus 时取消，不会切一次就关掉；
- 切周 / 页面隐藏 → 先落库再切；
- `onEditInput` 不 setData，只改 `this.data.draft`，避免每次按键重渲染导致光标跳到末尾（安卓尤其明显）。

> ⚠️ **Esc 取消做不了**：小程序 `input` 组件没有 keydown 事件，无法区分「按 Esc」和「点别处」，
> 两者都只触发 blur。替代方案是面板上的「取消」按钮。
> 未改动时按 Esc 触发 blur → `isDirty` 为 false → 直接关闭，效果等同取消、无副作用；
> 已改动时按 Esc 会走"失焦保存"（数据不丢，但不是取消）。

### AI 课表助手 `pages/schedule-edit/index`

入口：主页右下角悬浮「课表调整」按钮 → `wx.navigateTo` 到本页。

**核心设计：只有一个输入框。** 用户说什么都行，`scheduleAI.assist()` 先判断意图再决定动作，
不需要切换模式，所有结果统一呈现在对话流（feed）里：

| 用户说什么 | 意图 | 处理 |
|---|---|---|
| 「第6周周五嵌入式停课」 | `edit` | 解析为 operations → `validator.validate` → `applyEdit` → 回显执行结果 |
| 「我周三下午有课吗？」 | `ask` | 直接自然语言回答 |
| 「帮我分析一下课表」 | `analyze` | 输出分点的课表分析报告 |
| 「给我一份学习建议」 | `study` | 输出个性化学习计划 |
| 与课表无关 | `unknown` | 礼貌引导回课表话题 |

**兜底链路（三层，保证不瘫）**

1. `assist()` 请求失败 / 返回非法 → 自动降级到 `parser.js` 的 `localParse`（本地规则，仅覆盖改课表指令）；
2. 本地也兜不住 → 明确告诉用户"离线模式只能处理改课表指令"，绝不瞎猜；
3. `edit` 结果仍要和以前一样过 `validator` —— AI 的 JSON 永远不能直接入库。

**结果呈现**

- `applied` → 绿色对勾列表；`skipped`（unknown/缺参数）→ 黄条 + 「新增这门课」弹层入口；
- `output_candidates`（如停课时长二选一）→ 可点选卡片，选完才执行；
- `conflicts` → 「保留两者 / 删除旧课」二选一，删除走 `store.removeEntry` 并带撤销点；
- 执行后回写主页（`prev.onScheduleChanged()`），主页自动重渲染并弹撤销条。

> **AI 走云函数代理**：`services/scheduleAI.js` 只负责把课表摘要传给云函数
> `cloudfunctions/courseScheduleAI`，由云函数在服务端调模型。
>
> 这样做的原因（2026-09-14 改造）：原实现在前端直连火山方舟、API Key 硬编码在包里，
> 一是 Key 可被解包提取，二是真机必须配 `ark.cn-beijing.volces.com` 域名白名单。
> 该 Key 于 2026-09-14 实测已失效（`401 The API key doesn't exist.`），遂整体迁到云函数。
>
> 现在**前端没有任何 Key，也不需要配任何域名白名单**，且与小助手共用的是同一个智谱底座。
>
> ### 部署与配置（三步）
>
> 1. 开发者工具里右键 `cloudfunctions/courseScheduleAI` → **上传并部署**（云端依赖选"云端安装依赖"）；
> 2. 云开发控制台 → 云函数 → `courseScheduleAI` → 版本与配置 → **把超时时间改成 60 秒**；
> 3. （可选）在环境变量里配 Key；不配则用源码里的兜底 Key，与小助手 `helperChat` 是同一把。
>
> ⚠️ **第 2 步是命门，跳过必然「AI 没反应」**：新版 CloudBase 云函数默认超时只有 **3 秒**，
> 而云函数目录下 `config.json` 的 `timeout` 未必随部署生效（helperChat 上实测踩过）。
> 代码侧已做保护：预算不足时直接返回 `AI_TIMEOUT_BUDGET` 并附修复指引，
> 而不是被平台强杀成 `-504003` 这种没有指向性的错误。
>
> ### 环境变量（与 helperChat 同名同义）
>
> | 变量 | 说明 | 默认 |
> |---|---|---|
> | `AI_API_KEY` | API Key（`ZHIPU_API_KEY` 亦可） | 源码兜底 Key |
> | `AI_API_BASE` | 端点 | `https://open.bigmodel.cn/api/paas/v4` |
> | `AI_PROVIDER` | `zhipu` / `deepseek` / `ark` / `openai` | 按 base 自动判定 |
> | `AI_MODEL` | 指定模型，优先级最高 | 候选链首位 |
> | `AI_THINKING` | `enabled` / `disabled` | **disabled** |
> | `AI_TIMEOUT_MS` | 单次上游请求超时 | 45000 |
>
> 注意：**环境变量是云函数级别的**，在 `helperChat` 上配的 Key 不会自动给 `courseScheduleAI` 用，
> 两个云函数要各配一次（或都依赖同一把源码兜底 Key）。
>
> ### 模型候选链：`glm-4.6` → `glm-4-flash`
>
> 课程表是「短输入 → 短结构化 JSON」，只放快且稳的文本模型。
> 实测端到端（含网络）：改课表约 13s、提问约 3.7s、分析约 8.9s、学习建议约 6.8s。
>
> ⚠️ **不要把 `glm-5.x` 放进这条链** —— 智谱 5.x 系列强制思考且不支持关闭，
> 传 `thinking:disabled` 会直接报 1210，白白多等几十秒。`test/ai-assist.js` 有断言守着这条线。
>
> ### 排错表（页面会把这些码翻成人话显示在对话流里）
>
> | 错误码 | 含义 | 处理方式 |
> |---|---|---|
> | `AI_NOT_CONFIGURED` | 没取到 Key | 给云函数配 `AI_API_KEY` |
> | `AI_TIMEOUT_BUDGET` / `AI_TIMEOUT` | 云函数超时太短 | 控制台把超时改成 60 秒 |
> | `AI_AUTH` | Key 无效 / 无权限 | 检查 `AI_API_KEY` |
> | `AI_BALANCE` | 余额不足 | 充值 |
> | `AI_MODEL_UNAVAILABLE` | 账号下没有可用模型 | 配 `AI_MODEL`（如 `glm-4.6`） |
> | `CLOUD_CALL_FAILED` | 云函数没部署 | 右键上传并部署 |
> | `CLOUD_NOT_READY` | 云环境未初始化 | 等 `wx.cloud.init` 完成再试 |
>
> ### 诊断命令
>
> ```bash
> node scripts/check-ai-e2e.js      # 端到端：加载云函数源码真调模型，验证四类意图
> node miniprogram/course-schedule/test/ai-assist.js  # 离线：纯逻辑与调用契约（进 preflight）
> ```
>
> `check-ai-e2e.js` 会用 `Module._load` 打桩 `wx-server-sdk`，直接 require 云函数源码来跑 ——
> 测的就是线上那份代码，不用在脚本里再抄一遍 prompt。会真实消耗 token，**不进 preflight**。
>
> 真机/工具里排查可执行（控制台）：
> `getApp().globalData.scheduleAI.probe().then(console.log)`，
> 返回 `provider` / `model` / `hasKey` / `budgetMs`（`budgetMs` 若只有 3000 上下，说明超时没改成 60 秒）。

> 本页 `data` 里**必须**声明 `undoVisible: false` / `undoText: ''` ——
> 缺了的话首屏 `{{undoText}}` 是 `undefined`，传给 `undo-bar` 会变成 `null`，
> 触发 `expected <String> but get null value` 告警。

### 课表皮肤系统 `styles/themes.wxss` + `utils/csTheme.js`

课表工具自带 6 套皮肤，与主项目全局主题（`--color-*`）**完全隔离**，
变量前缀统一 `--cs-*`，课程表的张扬配色不会外溢到工具中心、待办等其他页面。

| key | 名称 | 明暗 | 气质 |
|---|---|---|---|
| `dawn` | 晨光笔记 | 浅 | 清爽蓝白，默认 |
| `midnight` | 深空夜航 | 深 | 深蓝夜空，夜间护眼 |
| `candy` | 糖果马卡龙 | 浅 | 粉紫奶油，28rpx 大圆角 |
| `cyber` | 赛博霓虹 | 深 | 纯黑荧光，8rpx 直角 + 等宽字体 |
| `retro` | 复古胶片 | 浅 | 米黄纸质，衬线字体 |
| `moss` | 森林苔原 | 深 | 墨绿苔藓，安静专注 |

**机制**

- 页面根节点绑定 `class="cs-root cs-theme-{{csTheme}}"`，皮肤变量靠 CSS 变量级联生效，
  切换皮肤只 `setData({ csTheme })`，**不需要重渲染课表**；
- 每套皮肤 37 个 token，含玻璃/阴影/遮罩等易漏项，3 套深色皮肤全部完整覆盖，无浅色 token 泄漏；
- 每套皮肤的 `--cs-radius` 与 `--cs-font` 也不同，圆润/锐利/衬线/等宽的气质差异让 6 套一眼可辨；
- 课程卡片按 **课程名 hash** 分配 6 组色板（`.cs-c0`~`.cs-c5`），同屏多门课彼此可辨，不再一片同色；
- 切换时同步 `wx.setNavigationBarColor`，深色皮肤下导航栏不会留一条浅色破绽；
- 选择持久化在 `cs_theme`（与主项目 `theme` 键分开），非法值自动回落默认。

**接入**（三个页面均已接好）

```xml
<view class="cs-root cs-theme-{{csTheme}}">
  <cs-theme-picker current="{{csTheme}}" bind:change="onCsThemeChange" />
</view>
```

```js
const csTheme = require('../../utils/csTheme');
// onLoad: this.setData({ csTheme: csTheme.getCsTheme() }); csTheme.applyNavBar(...)
// onCsThemeChange(e) { this.setData({ csTheme: e.detail.key }); csTheme.applyNavBar(e.detail.key); }
```

**新增一套皮肤**：`styles/themes.wxss` 加一个 `.cs-root.cs-theme-新key` 块（照抄 dawn 的变量清单，37 个一个都不能少），
再到 `utils/csTheme.js` 的 `CS_THEMES` 加一项；`test/theme-check.js` 会自动校验变量完整性、对比度与元数据一致性。

---

## 三、AI 输出的正确处理姿势

```js
// 1. 拿到 AI 返回的 JSON（云函数 / 本地解析均可）
const raw = await requestParse(userInput);

// 2. 校验（绝不要跳过）
const result = validator.validate(raw, {
  totalWeeks: 16,
  validIds: store.getIds(),   // edit 类型必传，用于校验 target_id
});

if (!result.ok) {
  // 整体结构不可信 → 降级为手动添加，不要写入
  wx.showToast({ title: '识别失败，请手动添加', icon: 'none' });
  return;
}

if (result.errors.length) {
  // 个别条目有问题，已被剔除，提示用户核对
  console.warn('[schedule] 部分内容未通过校验', result.errors, result.rejected);
}

// 3. 落库
if (result.value.request_type === 'import') {
  // 预览确认后再写入，别一键覆盖
  wx.navigateTo({ url: '/pages/schedule-import/index' });
  // 用户勾选后： store.replaceAll(result.value.entries)
} else {
  const r = applyEdit(store, result.value);
  // r.applied / r.skipped / r.conflicts
  if (r.skipped.length) {
    // unknown 操作 → 必须弹确认框，不能静默丢弃
    wx.showModal({ title: '有指令没听懂', content: r.skipped[0].reason });
  }
  if (r.conflicts.length) {
    // 冲突只报不拦，交给用户选：保留两者 / 覆盖 / 改时间
    this.setData({ conflictTip: r.conflicts[0].detail });
  }
}
```

---

## 四、API

### `new ScheduleStore({ storage, totalWeeks, semesterStart, key })`

| 方法 | 说明 |
|---|---|
| `replaceAll(entries)` / `addEntries(entries)` | 导入（replaceAll 会清空 overrides） |
| `addEntry(entry)` / `updateEntry(id, changes)` / `removeEntry(id)` | 底表增删改，各自带撤销点 |
| `addOverride({ entryId, kind, week/fromWeek, cancelled, changes })` | 加单周或阶段性覆盖 |
| `getWeek(week)` | **按周 merge 后的课表**，渲染直接用它 |
| `weekStart(week)` / `weekOfDate(date)` | 周次 ↔ 日期互转 |
| `conflictsOfWeek(week)` / `conflicts()` | 冲突检测，返回 `{target_id, conflict_with_id, detail, weeks[]}` |
| `undo()` / `canUndo()` | 撤销，最多 10 步 |

### `validator.validate(payload, ctx)`

返回 `{ ok, value, errors, warnings, rejected }`：

- `ok=false` —— 整体结构不可信，必须降级处理；
- `errors[]` —— 有问题但已修复/剔除的明细，建议上报日志；
- `value` —— 可直接使用的净化后 payload。

能修的就地修（时间颠倒自动交换、周号截断、标题超长截断、伪造 `target_id` 置空），修不了的整条剔除，**绝不让脏数据进底表**。

---

## 五、两个已知约束

1. `semesterStart` 必须与后端学期配置一致。当前上下文用的是 `2026-09-01`（第2周 = 09-08~09-14）；若以教务系统截图的 `2026-09-07` 为准，所有「X月X日 → 第N周」的换算都会偏移一周。
2. `getWeek()` 判断可见性用的是 **merge 后** 的 `weekRule`，所以「第8周起改周次规则」这类覆盖也能正确生效。

---

## 六、测试

```bash
node test/smoke.js        # 功能回归
node test/theme-check.js  # 皮肤校验
```

`smoke.js` 覆盖：weekRule 归一化与交集、校验器拦截非法数据、entries/overrides 分离、按周 merge、单周停课、阶段性生效、冲突检测、撤销回滚，`services/parser.js` 本地兜底解析器的指令解析用例（调课/停课/新增/删除/批量、unknown 回问、候选二选一），以及**就地编辑**（字段校验：必填/字数上限/trim/空值转 null/脏值判断；写入落点：无覆盖写底表、本周 override 只改本周、from override 改第 N 周起、条目不存在返回 null），以及**时间轴行 `buildRows()`**（预设节次必带 end、连排课追加独立行且带真实 end、同起点多课程 end 取最晚、缺 endTime 时 end 为空串）。当前 **96/96 通过**。

`ai-assist.js` 覆盖：`scheduleAI` 模块导出完整性（并断言 **CONFIG 里不许再出现 apiKey / baseUrl**）、`safeParseJSON` 对模型输出的容错（markdown 代码块 / 前后废话 / 嵌套 / 残缺 / 非 JSON）、`formatEntriesForPrompt` 的课表摘要渲染（id 标记、中文星期、周次模式、地点教师）、`buildPayload` 的字段与截断，**云函数调用契约**（打桩 `wx.cloud.callFunction`：action 与 payload 正确、业务失败返回 null 让调用方降级、平台失败归类为 `CLOUD_CALL_FAILED`、`wx.cloud` 缺失不抛错、`abortRequest` 逻辑取消后结果不落地）、**错误翻译**（每个云函数错误码都能给出可执行的下一步）、以及**云函数源码静态校验**（`config.json` 超时为 60、模型链不含强制思考的 `glm-5.x`、默认关思考、有超时预算收敛、前端 services 下不许残留任何硬编码 Key）。当前 **85/85 通过**。

`theme-check.js` 覆盖：6 套皮肤变量完整性（37 个 token 一个不漏、块内无重复声明）、**皮肤选择器必须为类选择器**（禁止属性选择器，否则小程序编译器告警且部分渲染模式不生效）、WCAG 对比度（正文≥12、次级≥7、弱化≥4、主色对白字≥3、主色对底色≥3）、卡片与页面底亮度差≥0.008、元数据 `preview`/`dot` 与 `--cs-hero`/`--cs-primary` 一致、课程配色分散度、三个页面与组件无硬编码色残留。当前 **41/41 通过**。

---

## 七、接入待办主项目（工具中心入口）

本模块已挂载进待办清单主项目 `todo-miniprogram`，在**已有工具中心**里作为正式工具出现（不是独立外壳）：

| 落点 | 改动 |
|---|---|
| `miniprogram/app.json` | `pages` 注册 `course-schedule/pages/{schedule,schedule-import,schedule-edit}/index` |
| `miniprogram/app.js` | `onLaunch` 调 `initCourseScheduleStore()`：建 `ScheduleStore`、算 `currentWeek`，挂 `globalData.store / currentWeek / pendingImport`；并把课程表 AI 注入 `globalData.parseInstruction` 与 `globalData.scheduleAI` |
| `miniprogram/utils/tools.ts` | `ToolDef.route` 联合类型加 `'course-schedule'`；`TOOLS` 新增「课程表」工具（实用工具分类，📚，badge NEW） |
| `miniprogram/pages/tools/tools.ts` | `ROUTE_PATHS` 加 `'course-schedule': '/course-schedule/pages/schedule/index'` |

> 页面链路由 `navigateTo` 串起：工具中心 → 课表主页 →（改课表 / 导入预览）。
> **注意**：本模块用 `--cs-*` 独立皮肤体系，不参与主项目的 `data-theme` 全局主题切换，两者互不影响。
