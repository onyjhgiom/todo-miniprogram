# 国风卦相 · 面相 / 手相 AI 识别接入说明（v3 · 火山方舟）

> 项目：`C:\Users\陈乐天\WorkBuddy\2026-09-07-09-23-30\todo-miniprogram`
> 本文取代 `AI面相识别优化说明v2.md` 与 `手相识别接入说明.md` 中关于**默认供应商 / 默认模型**的描述——
> 那两个文档默认走 DeepSeek，现在默认改为**火山方舟（Ark）**。

---

## 一、结论先行

| 项 | 值 |
|---|---|
| 供应商 | 火山方舟 Ark（`https://ark.cn-beijing.volces.com/api/v3`） |
| 默认模型 | `doubao-seed-character-260628` |
| 实测耗时 | 面相 1.68s / 手相 1.53s（448×560 测试图） |
| 白名单命中 | 面相 7/7 字段 |
| 改动云函数 | `cloudfunctions/faceReading`、`cloudfunctions/palmReading` |
| 是否需要手动配 Key | **不需要**，已内置兜底 Key；配了环境变量则优先用环境变量 |

---

## 二、Key 与模型实测结论

**Key：通过云函数环境变量 `AI_API_KEY` 注入（火山方舟 Ark），请勿硬编码到源码或文档。**

这把 Key 在 `faceReading`、`palmReading` 两个云函数的**环境变量 `AI_API_KEY`** 里配置；
源码中的 `FALLBACK_API_KEY` 已从仓库移除，统一改为「环境变量缺失即报错」，部署时请在云函数环境变量里填写 `AI_API_KEY`。

实测（2026-09-14）：

| 验证项 | 结果 |
|---|---|
| 纯文本请求 | 200 / **1.01s** |
| **识图请求**（448×560 PNG） | 200 / **1.61s**，返回白名单 7 字段全部命中 |
| 面相端到端 | 200 / **1.20s** |
| 手相端到端 | 200 / **1.28s** |

→ Key 有效，`doubao-seed-character-260628` 已开通且**支持视觉输入**。

### 默认模型锁定

两个云函数均新增 `DEFAULT_MODEL = 'doubao-seed-character-260628'`：

- 未配 `AI_MODEL` → **锁定用 `doubao-seed-character-260628`**（面相、手相都用它）；
- 配了 `AI_MODEL` → 以环境变量为准（非视觉模型仍会被自动丢弃）；
- 仅当该模型返回「未开通 / ID 失效」时，才顺延到 `doubao-seed-evolving` 等兜底模型。

> 下方表格为**旧 Key 账号**的历史扫描结果，仅供了解模型开通情况参考：

| 模型 | 支持图片 | 实测耗时 | 可用性 |
|---|---|---|---|
| **`doubao-seed-character-260628`** | ✅ | **1.7s** | ✅ 已开通 —— **本项目默认** |
| `doubao-seed-evolving` | ✅ | 12.0s（默认思考）/ **2.2s（关思考）** | ✅ 已开通 —— 候选链兜底 |
| `doubao-seed-character-251128` | ✗ 纯文本 | — | ✅ 已开通（不能识图） |
| `deepseek-v4-pro-260425` | ✗ 纯文本 | — | ✅ 已开通（不能识图） |
| `deepseek-v4-pro-ga-260813` | ✗ 纯文本 | — | ✅ 已开通（不能识图） |
| `glm-5-3-flash-260828` | ✗ 纯文本 | — | ✅ 已开通（不能识图） |

**未开通**（调用返回 404 `ModelNotOpen`，需去控制台开通）：
`doubao-seed-2-1-pro-260628`、`doubao-seed-2-1-turbo-260628`、`doubao-seed-2-0-lite/mini/pro-260215/260428`、`glm-5-2-260617`、`deepseek-v4-flash-ga-260731`、以及全部 qwen / glm-4-5-air 系列。

> 也就是说：你 curl 里的 `doubao-seed-character-260628` **本身就能识图**（实测正确读出图片的颜色构成），
> 但它是「角色扮演」定位的模型；本项目在提示词里显式加了「你是测量工具，不是角色扮演助手，
> 不要问候/语气词/人格化表达」，并叠加白名单约束，确保输出稳定为结构化特征。

### thinking 参数实测

| 组合 | 结果 |
|---|---|
| `doubao-seed-character-260628` + 无 thinking | 200 / 1.87s |
| `doubao-seed-character-260628` + `thinking:{type:'disabled'}` | 200 / **1.02s** |
| `doubao-seed-evolving` + 无 thinking | 200 / 14.13s（消耗 445 reasoning tokens） |
| `doubao-seed-evolving` + `thinking:{type:'disabled'}` | 200 / **2.21s** |

→ 两个模型都接受 `disabled`，且更快。故**默认关闭思考**（`AI_THINKING=enabled` 可改回）。

---

## 三、改造内容

### 1. 模型候选链 + 自动顺延

```
doubao-seed-character-260628  →  doubao-seed-evolving  →  doubao-seed-2-1-turbo-260628
        （最快，默认）              （已开通，兜底）          （未开通则自动跳过）
```

- 遇 404 `ModelNotOpen`（账号未开通）或 `InvalidEndpointOrModel.NotFound`（模型 ID 失效）→ **自动试下一个**，最多 3 个。
- 全部不可用才返回 `AI_MODEL_NOT_OPEN`，前端自动切手动选择，功能不中断。
- 额外内置 `doubao-seed-2-0-lite-260428` 等，一旦你在控制台开通即可自动生效，无需改代码。

### 2. thinking 自适应

默认发 `thinking:{type:'disabled'}`；若某模型不接受该参数（返回 400 且提示含 thinking）→ **自动摘掉重试一次**。

### 3. 多供应商可切

`AI_API_BASE` 指向 deepseek / 智谱 等任意 OpenAI 兼容端点时，按域名自动切换候选链：

| 域名关键词 | 供应商 | 候选链 |
|---|---|---|
| `volces.com` / `ark.cn` | ark | character-260628 → evolving → 2.1-turbo |
| `bigmodel.cn` / `zhipu` | zhipu | glm-4v-flash → glm-5.3-flash → glm-4.6 |
| `deepseek.com` | deepseek | deepseek-v4-flash-vision-exp → deepseek-chat |

### 4. 错误分级（新增 `AI_MODEL_NOT_OPEN`）

新增「模型未开通」这一档，前端会明确提示「到方舟控制台开通」，而不是笼统的「识别失败」。

### 5. 云函数超时

新增 `cloudfunctions/{faceReading,palmReading}/config.json`，超时设为 **60s**（微信云函数默认仅 20s，视觉识别高峰期可能不够）。

---

## 四、配置项（云函数环境变量）

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `AI_API_KEY` | 选填 | 已内置兜底 Key | **配了就优先用环境变量** |
| `AI_API_BASE` | 选填 | `https://ark.cn-beijing.volces.com/api/v3` | 指到别家会自动切候选链 |
| `AI_PROVIDER` | 选填 | 按域名自动判定 | `ark` / `zhipu` / `deepseek` / `openai` |
| `AI_MODEL` | 选填 | 候选链首位 | 显式指定排到首位；**非视觉模型会被自动丢弃** |
| `AI_THINKING` | 选填 | `disabled` | 改 `enabled` 可恢复思考（更慢） |

> ⚠️ **安全提示**：为做到「上传即可用」，云函数源码里内置了兜底 Key。
> Key 不会下发到客户端，但若仓库对外分发（传到 GitHub 等）会随代码泄露。
> 生产建议：在云函数环境变量配好 `AI_API_KEY`，然后把源码里的 `FALLBACK_API_KEY` 清空。

---

## 五、部署步骤

1. 微信开发者工具 → 云开发 → 云函数
2. 右键 `faceReading` → **上传并部署（云端安装依赖）**
3. 右键 `palmReading` → **上传并部署（云端安装依赖）**
4. 核对两个云函数的**超时时间**为 60 秒（`config.json` 已声明，控制台里确认一下）
5. 不需要配 request 合法域名（走云函数转发）

---

## 五·补、v3.1 关键修复：图片改走「云存储中转」（必读）

### 为什么必须改

`wx.cloud.callFunction` 的 `data` 存在**链路传输大小限制**（官方文档：data 中大数据字段
**建议临界值 100KB**，超过应改用 `wx.cloud.CDN`）。手机照片即使压到 1024px/q75，
base64 也常达 **165KB~1MB**，稳定超限 —— **请求根本到不了云函数**。

真机表现：

| 平台 | 报错 |
|---|---|
| iOS | `cloud.callFunction:fail Error: data exceed max size` |
| Android | `errCode: -404012 polling exceed max timeout` |

更糟的是，安卓的 `-404012` 命中了 `miniprogram/utils/cloud.ts` 的 `DEGRADE_PATTERNS`，
被当成「云端系统级故障」而**静默降级为本地 mock**；mock 对这两个云函数硬编码返回
`AI_NOT_CONFIGURED`，于是界面显示「云端识别尚未配置，已切换手动选择」——
**把「图片太大」谎报成「没配 Key」**，这就是此前「上传图片后大模型识别不了」的假象。

### 改成了什么

```
选择照片 → compressImage（限长边 1024 / q75）
  → wx.cloud.uploadFile 传到 ai-tmp/ 目录
  → 只把 fileID（几十字节）传给云函数          ← 彻底绕开传输限制
  → 云函数 cloud.downloadFile → base64 → 调模型
  → 无论成功失败，finally 里 cloud.deleteFile 立即删除   ← 保持「不留存」合规承诺
```

- 云函数**同时兼容**旧的 `imageBase64` 入参（`resolveImage()` 里 fileID 优先），旧客户端不会挂。
- 前端云能力不可用时自动回退 base64 直传，并在失败时由 `cloud.ts` 明确报
  `PAYLOAD_TOO_LARGE`，不再伪装成 `AI_NOT_CONFIGURED`。
- 新增错误码：`IMG_DOWNLOAD_FAIL`（云端下载失败）、`PAYLOAD_TOO_LARGE`（入参超限）。

### 部署注意

- **两个云函数都必须重新「上传并部署」**，否则云端仍是旧代码，fileID 分支不生效。
- 云存储无需额外配置，`ai-tmp/` 目录会自动创建；云函数用管理员权限下载/删除，不受权限规则影响。
- 隐私承诺不变：图片仅在云函数内存中过一次，识别完立即删除，不落库、不写日志。

**验证一行**（开发者工具 Console）：

```js
wx.cloud.callFunction({ name:'faceReading', data:{ action:'ping', probe:true } }).then(console.log)
// 期望：{ success:true, provider:'ark', candidates:[...], model:'doubao-seed-character-260628', latencyMs:~500 }
```

---

## 五·补二、v3.2 成段解读（不展示中间结果）

### 需求
用户上传正面人脸 / 清晰手掌照片后：
- 系统识别关键特征——面相含脸型、额头、眉、眼、鼻、**颧骨**、唇、**下巴**、气色；
  手相含手掌形状、生命线、智慧线、感情线、**事业线**、掌色、纹质。
- **直接输出流畅成段的中文解读，不展示中间识别结果**。

### 实现
1. 客户端 `callFn('faceReading'|'palmReading', { action:'analyze', withReading:true, ... })`。
   `withReading` 缺省时云函数只回特征值（老版本客户端不受影响）。
2. 云函数识别成功后**再发一次纯文本请求**让模型按固定结构成文：
   - `【整体印象】` → 两三句话串起整体观感；
   - `【特征细说】` → 按上述顺序逐项一小段，每项**同时给「长处/讨喜之处」+ 一个温和的「可以留意」点**，
     涉及传统相术说法时声明是文化趣味而非客观事实；
   - `【综合建议】` → 2~3 条贴近生活的温和建议。
3. 解读正文过**三重合规校验**（结构齐全 / 篇幅 260~4000 字 / 违禁词表）：
   绝对化（必然、注定…）、恐吓（短寿、灾祸、破财…）、医疗/心理诊断、命理承诺（算命、改运…）
   任一命中即丢弃该次 AI 文案。
4. 云端返回 `reading`（空则 `readingSource=''`）。前端 `resolveReading` 解析成
   `{ text, sections, source }`：
   - `source==='ai'`：展示 AI 定制文案；
   - 空 / 校验失败：前端用 `composeFaceReading`/`composePalmReading` **本地静态文案兜底**成文（同样三段式 + 免责声明），
     用户始终能看到成段解读。
5. **图片质量门**（模糊 / 角度偏斜 / 遮挡 / 逆光 / 非人脸或非手掌）：
   云端返回 `IMG_QUALITY` / `NO_FACE` / `NO_HAND` + 友好文案，前端提示重拍，不进入解读。

### 前端默认行为
- 结果区只渲染 `sections`（成段解读），中间特征选择面板（`fields`）**默认收起**（`showFields=false`）；
  仅在用户点「微调特征重新生成」时才展开，可修正特征后本地重生成。

---

## 六、错误码对照

| 错误码 | 含义 | 前端行为 |
|---|---|---|
| `AI_NOT_CONFIGURED` | 没配 Key 或无可用候选 | 自动切「手动选择特征」 |
| `AI_MODEL_NOT_OPEN` | 候选模型账号均未开通 | 自动切「手动选择特征」+ 提示去控制台开通 |
| `AI_AUTH` | Key 无效 / 无权限 | 自动切手动 |
| `AI_BALANCE` | 余额不足 | 自动切手动 |
| `AI_RATE_LIMIT` | 请求过频 | 提示稍后再试 |
| `AI_TIMEOUT` | 超时 | 提示换更小的图 |
| `AI_NETWORK` | 连不上服务 | 提示检查网络 |
| `AI_BAD_REQUEST` | 模型拒绝（参数/图片不合规） | 提示换图重试 |
| `AI_UNPARSEABLE` | 模型没按 JSON 输出 | 提示换清晰图（`raw` 字段带回原文便于排查） |
| `NO_FACE` / `NO_HAND` | 没找到清晰人脸 / 手掌 | 提示重拍 |
| `NO_FEATURE` | 识别出但白名单外（一律丢弃） | 提示换图或手动选择 |
| `IMAGE_TOO_LARGE` / `NO_IMAGE` | 图太大 / 无图 | 提示换图 |

---

## 七、合规边界（未改动，务必保持）

- 云端模型**只做客观外观特征识别**（脸型/额/眉/眼/鼻/颧骨/唇/下巴/气色；手型/生命线/智慧线/感情线/事业线/掌色/纹质）。
- 识别提示词**明文禁止**输出：性格、命运、运势、吉凶、贫富、健康、寿命、身份、情感好坏。
- 模型输出**必须落在白名单枚举内**，非法值一律丢弃——即使模型「想算命」也进不来。
- **成段解读**（v3.2）：识别成功后由模型按固定三段式成文，提示词强制要求「温和正面、不绝对化、不恐吓」，
  且正文过**违禁词 + 结构 + 篇幅三重校验**；不合规则丢弃、改由端上静态文案兜底。
  所有解读文末均附娱乐性免责声明（不构成医疗/心理/专业命理建议）。
- 图片**仅在云函数内存中过一次**，不落库、不写存储、不打印日志；返回值只含特征值与解读文本，不含任何图片数据。
- 识别前需用户勾选授权；任何失败都降级为手动选择，功能始终可用。

---

## 八、自检与验证

```bash
node scripts/check-gua-ai.js          # 离线 71 项（零网络，进 preflight）
node scripts/check-gua-ai.js --live   # 额外跑真实端到端（消耗 token）
node scripts/preflight.js             # 全量门禁 9 项
```

当前状态：离线 **71/71**、真实端到端 **5/5**（合计 76 项全通过）；门禁 **9/9** 通过。

真实端到端实测输出：

```
模型=doubao-seed-character-260628  延迟=521ms
面相 1683ms  → {"faceShape":"oval","forehead":"medium","brow":"straight","eye":"round","nose":"straight","lip":"thin","skin":"wheat"}
手相 1529ms  → {"lifeLine":"curved","headLine":"straight","palmColor":"wheat","palmTexture":"clear"}
```

> 自检脚本内置「现场生成测试图」（纯 Node 手绘人脸 / 手掌 PNG），不依赖任何外链图片，
> 因此不存在「外链失效导致测不了」的问题。
