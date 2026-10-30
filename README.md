# Todo 小程序（微信小程序 + 腾讯云开发 CloudBase · TypeScript · Phase 1）

零自建服务器的待办事项小程序，所有数据落在云开发（云函数 + 云数据库 + 云存储）。  
云函数基于 `wxContext.OPENID` 自动识别用户并做数据隔离，无需登录页。

> 前端使用 **TypeScript** 编写（`project.config.json` 已开启 `useCompilerPlugins: ["typescript"]`），  
> 微信开发者工具会直接编译 `.ts`；云函数为 Node.js JavaScript。

**Phase 1 升级**：在原 MVP 基础上落地 9 大模块能力（子任务、重复/提醒、附件、多视图、四象限、模板、主题、Pomodoro、数据导出），并保留 `mock` 本地回退便于无云开发环境演示。

---

## 1. 目录结构

```
todo-miniprogram/
├── project.config.json / tsconfig.json / README.md
├── miniprogram/
│   ├── app.js / app.json / app.wxss / sitemap.json
│   ├── types/index.d.ts                 # 业务模型 + 全局 API 类型
│   ├── utils/
│   │   ├── cloud.ts                     # callFn / toast / handleError + 本地 mock
│   │   ├── theme.ts                     # 5 套主题（light/dark/rose/forest/twilight）
│   │   ├── date.ts                      # 日期/倒计时/连续打卡/日历等纯函数
│   │   ├── export.ts                    # JSON / CSV 导出到本地沙盒
│   │   └── storage.ts                   # 统一 wx.storage 包装
│   ├── components/
│   │   ├── todo-card/                   # 任务卡片（优先级色条 / 倒计时 / 地点 / 人物 / 标签 / 子任务进度）
│   │   ├── todo-composer/               # 轻量新增/编辑底部 sheet
│   │   ├── stats-card/                  # 顶部 hero 统计
│   │   ├── filter-bar/                  # 状态分段 + 搜索 + 筛选 chip 行
│   │   ├── view-switcher/               # 列表 / 日历 / 看板 三视图切换
│   │   ├── bottom-tab/                  # 底部导航（首页/日历/看板/模板/设置）
│   │   ├── empty-state/                 # 通用空态
│   │   ├── theme-switcher/              # 5 套主题切换面板
│   │   ├── template-picker/             # 模板选择（系统 + 用户）
│   │   ├── subtask-list/                # 子任务进度条 + CRUD
│   │   ├── attachment-bar/              # 附件：图片 + 链接
│   │   ├── recurrence-editor/           # 重复规则（每天/每周/每月/自定义）
│   │   └── reminder-editor/             # 多时间点提醒
│   └── pages/
│       ├── index/                       # 首页（列表视图 + 统计 + 筛选）
│       ├── calendar/                    # 日历视图（按 dueDate 聚合）
│       ├── kanban/                      # 四象限看板（重要×紧急）
│       ├── detail/                      # 任务详情（重复/提醒/子任务/附件）
│       ├── templates/                   # 模板库（系统 + 自定义）
│       └── settings/                    # 设置（主题 + 导出 + 统计）
└── cloudfunctions/
    ├── todos/                           # 业务云函数（11 个 action）
    ├── subtasks/                        # 子任务云函数
    ├── templates/                       # 模板云函数（含 6 套系统模板 seed）
    ├── export/                          # 数据导出（JSON / CSV）
    └── triggerDueReminders/             # 定时器云函数：到期扫描 + 订阅消息推送
```

---

## 2. 数据结构（云数据库集合）

### 2.1 `todos`（任务主体）

| 字段                                  | 类型                              | 必填 | 说明                                              |
| ----------------------------------- | ------------------------------- | -- | ----------------------------------------------- |
| `_id` / `_openid`                   | string                          | 自动 | 云数据库 / 微信 openid（数据隔离键）                         |
| `content`                           | string                          | ✓  | 任务内容（≤200 字）                                    |
| `completed`                         | bool                            | ✓  | 是否已完成                                           |
| `completedTime`                     | number | null                   |    | 完成时间戳（归档统计用）                                    |
| `archived` / `archivedAt`           | bool / number                   |    | 是否归档 + 归档时间                                     |
| `createTime` / `updateTime`         | number (ms)                     | ✓  | 时间戳                                             |
| `dueDate`                           | number | null                   |    | 截止时间戳                                           |
| `priority`                          | `'high'\|'medium'\|'low'\|null` |    | 优先级                                             |
| `quadrant`                          | `1\|2\|3\|4\|null`              |    | 看板四象限分类                                         |
| `order`                             | number                          |    | 手动拖拽排序                                          |
| `location`                          | string | null                   |    | 地点                                              |
| `people`                            | string[]                        |    | 关联人物                                            |
| `tags`                              | string[]                        |    | 标签                                              |
| `description`                       | string | null                   |    | 备注                                              |
| `recurrence`                        | `IRecurrence` | null            |    | 重复规则 `{ type, interval?, weekdays?, endDate? }` |
| `reminders`                         | `IReminder[]`                   |    | 提醒项 `{ id, at, sent?, channel? }`               |
| `attachments`                       | `IAttachment[]`                 |    | 附件 `{ id, type:'image'\|'link', url, title? }`  |
| `subtaskCount` / `subtaskDoneCount` | number                          |    | 子任务进度冗余（避免每次统计）                                 |

### 2.2 `subtasks`（子任务）

`_id / _openid / todoId / content / completed / order / createTime / updateTime`

### 2.3 `templates`（模板）

`_id / _openid / name / icon / isSystem / items[] / createTime / updateTime`  
其中 `items` 含 `content / location / tags / description / subtasks[] / dueOffsetDays`

---

## 3. 功能一览（Phase 1）

### 一、核心任务管理

- **新增 / 编辑 / 删除**：列表右下 FAB 触发 `todo-composer` 弹层（轻量）；卡片主体跳转 `detail` 详情页（完整字段）
- **子任务**：详情页展开进度条 + 子项勾选；外层 `todo-card` 也会显示完成进度
- **优先级 / 自定义标签**：通过 chip 行与 composer 表单
- **多周期重复**：`recurrence-editor` 支持「每天 / 每周（多选星期）/ 每月 / 自定义间隔」
- **精细化提醒**：`reminder-editor` 支持多时间点，存为 `reminders[]`，到期由定时器扫描推送
- **逾期自动标红**：`todo-card` 根据 `dueDate` 计算 `countdown.key` 显示对应色
- **完成归档**：完成态保留在 `todos`，可手动设置 `archived=true`（设置页提供入口）

### 二、多视图与交互

- **三视图**：列表 / 日历 / 看板 — 通过 `view-switcher` 切换，本页为列表视图时直接 navigateTo 至日历/看板页
- **全局搜索**：内容 / 地点 / 人物 / 标签 / 备注统一模糊匹配
- **左滑快捷操作**：`todo-card` 提供 toggle / edit / delete（已实现点击版，可扩展 swipe）
- **语音输入**（预留）：组件层已为 `wx.getRecorderManager` 留位

### 三、任务详情

- 字段完整编辑器：内容 / 优先级 / 截止 / 重复 / 多提醒 / 描述
- **附件**：`attachment-bar` 支持图片（`wx.chooseMedia`）和链接（输入 URL）

### 四、激励系统

- `stats-card` 显示：进行中、今日完成、本周完成、已完成 + 连续打卡天数
- 设置页数据统计：总任务 / 进行中 / 已完成 / 已归档

### 五、模板与效率

- 6 套系统模板（开学 / 旅行 / 会议 / 健身 / 搬家 / 上线）
- 用户自定义模板（保存到 `templates`）
- 模板应用：`templates` 云函数 `apply` action 批量生成 todos
- **Pomodoro**（预留）：可在 detail 页扩展

### 六、协作（预留）

- 数据模型已含 `_openid` 字段，未来可扩展 `sharedWith` 共享字段并新增权限校验

### 七、体验与数据

- **5 套主题**：`light / dark / rose / forest / twilight`，切换通过 `data-theme` 属性 + CSS 变量级联
- **数据导出**：`export` 云函数支持 JSON（含子任务）+ CSV，下载到本地沙盒
- **离线缓存**：未配云开发时全部走 `wx.storage` mock

### 八、通知与性能

- **订阅消息**：到期任务 → `triggerDueReminders` → 推送
- **分页**：`todos.listPaged` action 支持 `page / pageSize / hasMore`
- **弱网**：mock 回退保证无网也能用

### 九、扩展与商业化

- 周报海报：海报生成钩子已预留（基于 `wx.canvasToTempFilePath`）
- 付费分级：`todo` 主数据免费；高级字段（如「团队协作」「Pomodoro 高级统计」）可在 detail 页扩展付费门禁

---

## 4. 云函数 action

### `todos`

| action           | 入参                                                                                                                              | 返回                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `list`           | —                                                                                                                               | `{ success, items: ITodo[] }`                        |
| `listPaged`      | page, pageSize, archived?                                                                                                       | `{ success, items, total, page, pageSize, hasMore }` |
| `add`            | content, dueDate?, priority?, location?, people?, tags?, description?, recurrence?, reminders?, attachments?, quadrant?, order? | `{ success, id }`                                    |
| `update`         | id + 任意上述字段                                                                                                                     | `{ success, updated }`                               |
| `toggle`         | id, completed                                                                                                                   | `{ success, updated }`                               |
| `archive`        | id, archived                                                                                                                    | `{ success, updated }`                               |
| `restore`        | id                                                                                                                              | `{ success, updated }`                               |
| `move`           | id, order                                                                                                                       | `{ success, updated }`                               |
| `delete`         | id                                                                                                                              | `{ success, removed }`                               |
| `clearCompleted` | —                                                                                                                               | `{ success, removed }`                               |
| `remind`         | —（定时器触发）                                                                                                                        | `{ success, scanned, sent }`                         |

### `subtasks`

`listByTodo / countByTodo / add / update / toggle / delete / clearDone` — 每次写操作会同步更新父 todo 的 `subtaskCount / subtaskDoneCount` 冗余字段。

### `templates`

`list / save / delete / apply / seed` — `seed` action 启动时植入 6 套系统模板。

### `export`

`json / csv` — 拉取当前用户所有 todos + subtasks，返回 `{ filename, content, total }`。

所有写操作强制以 `_openid` 过滤，越权返回「任务不存在或无权限」。

---

## 5. 上手 3 步

1. **填 envId** —— 编辑 `miniprogram/app.js` 的 `globalData.envId` 为你的 CloudBase 环境 ID（默认已填示例占位）
2. **建集合** —— 云开发控制台 → 数据库 → 新增集合 `todos` / `subtasks` / `templates`
3. **部署云函数** —— 微信开发者工具右键 `cloudfunctions/` 下 5 个目录 → 「上传并部署：云端安装依赖」

> ⚠️ 项目 AppID 不可为「测试号」，云开发需要真实注册的小程序 AppID。

### 详细流程与常见问题

1. `mp.weixin.qq.com` 注册小程序并取得 AppID
2. 微信开发者工具「导入」项目 → 选 `todo-miniprogram` 目录
3. 工具栏「云开发」→ 开通并创建环境（**记住 envId**）
4. 编辑器右键 `cloudfunctions/` → 「当前环境」→ 选你的环境
5. 右键 5 个云函数目录分别「上传并部署：云端安装依赖」
6. 数据库控制台创建集合 `todos` / `subtasks` / `templates`
7. 修改 `miniprogram/app.js` 填入 envId（若还没填）
8. 点「编译」→ 在模拟器里测试
9. 若用真实云开发，详情页的 `wx.chooseMedia` / `wx.uploadFile` 需在「微信公众平台 → 开发管理 → 接口设置」开启「上传图片」接口

### 离线 / Mock 模式

`utils/cloud.ts` 在检测到 `envId` 仍为占位或无 `wx.cloud` 时，自动切到 `wx.storage` mock 模式，**18 个 action** 全部本地化，便于演示与本地开发。

---

## 6. 设计系统速查

| Token   | light     | dark      | rose      | forest    | twilight  |
| ------- | --------- | --------- | --------- | --------- | --------- |
| primary | `#6366f1` | `#818cf8` | `#e11d48` | `#047857` | `#7c3aed` |
| bg      | `#f5f6fb` | `#0f172a` | `#fff5f7` | `#f0fdf6` | `#f4f1fb` |
| card    | `#ffffff` | `#1e2333` | `#ffffff` | `#ffffff` | `#ffffff` |
| text    | `#1a1d29` | `#f1f5f9` | `#2d1318` | `#0e2e21` | `#1f1a36` |

**通用 Token**：`radius-sm 8 / md 12 / lg 16 / xl 20 / pill 999`；`shadow-sm / md / lg`；`duration-fast 160ms / base 240ms / slow 320ms`；`ease-out cubic-bezier(0.22, 1, 0.36, 1)`。

---

## 7. 验证

同时日历增加日期对应的农历，节假日，双休，放假的休息天数，和节假日的排班调休等，同时设置一些提醒功能，

类型与语法均通过；JSON 配置通过 `node -e` 解析；云函数 JS 通过 `node --check` 语法验证。

---

## 8. 路线图（Phase 2 预留）

- 周报海报分享（基于 canvas 渲染统计卡片）
- 团队协作 / 共享清单（`sharedWith: string[]` 字段 + 权限校验）
- Pomodoro 计时器（详情页底部 dock）
- 语音快速录入（首页 FAB 长按）
- 高级订阅（云函数 `subscriptionTier` 字段 + 客户端门禁）
