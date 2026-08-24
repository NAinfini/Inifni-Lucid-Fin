---
score: 60
p0: 2
p1: 5
timestamp: 2026-08-12T02-14-48Z
slug: apps-desktop-renderer-src-pages-canvaspage-tsx
---
Method: dual-agent (A: independent UX/design assessment · B: deterministic detector + browser evidence)

# Canvas + Commander 端到端用户流程审查

## 总结

当前产品已经形成可信的 AI 媒体制作骨架：Commander 是单列浮窗，聊天左右分列、有时间戳、无头像；运行中隐藏思考与原始工具载荷；任务进度悬浮在输入框上方；所有审批均位于 Commander；Prompt Assembly、任务、资产与最终导出具备持久化和哈希绑定。

主要问题不在“有没有功能”，而在关键交接：首次 Provider 配置、Inspector 发起生成、后台任务完成、失败恢复、Prompt 来源解释和最终交付。用户在这些节点会从创作界面突然进入内部命令、审计字段或不可见后台状态。

## 评分

| Nielsen 原则 | 0–4 | 结论 |
|---|---:|---|
| 系统状态可见性 | 3 | 当前任务、耗时、状态可见；后台任务和最终渲染完成后的刷新/通知不足。 |
| 与现实世界匹配 | 2 | 制作术语自然，但内部英文 JSON、hash、provider/model 泄漏到主流程。 |
| 用户控制与自由 | 2 | 有取消和修改入口，但媒体取消是排队给 Commander 的自然语言意图。 |
| 一致性与标准 | 3 | 聊天与审批一致；直接 UI 操作和 AI 代操作边界不一致。 |
| 错误预防 | 3 | 审批版本、CAS、幂等与删除确认较强；首启 Provider 配置却与目录脱节。 |
| 识别优于记忆 | 2 | 有提示和历史，但 preset/template/guide/process prompt/assembly 关系不透明。 |
| 灵活性与效率 | 3 | 快捷键、slash、队列、批量资产操作较好；任务级恢复不足。 |
| 美学与极简 | 2 | 思考过程已隐藏；审批仍以审计数据为主。 |
| 错误识别与恢复 | 2 | 有错误文案，但任务行缺少就地重试、换 Provider、打开产物。 |
| 帮助与文档 | 2 | 有 onboarding 和设置说明；缺少能力矩阵与 Prompt 来源解释。 |

总分：24/40（60/100）。

## 端到端旅程

| 阶段 | 入口与反馈 | 状态所有者 | 结论 |
|---|---|---|---|
| 首次启动 | Onboarding 配主题、Provider、首个 Canvas | renderer + keychain | 有明确方向，但 Provider ID/能力映射错误，可能导致首轮生成仍显示未配置。 |
| 打开/创建画布 | 空状态有唯一主操作；左右工具栏有名称和 tooltip | Canvas Redux + SQLite | 基本清晰；普通空状态创建失败没有可见反馈。 |
| 构建内容 | 左侧资产/角色/装备/地点/模板/预设；右侧 Inspector/依赖/历史/笔记/日志 | Canvas + AssetEntry | 功能覆盖完整，但模板、预设、Guide、Process Prompt 的关系依赖用户记忆。 |
| 发起生成 | Inspector 的 Generate 打开 Commander | listener middleware | 当前把内部英文指令与 JSON 放入聊天队列，并最终显示成用户消息。 |
| Commander 对话 | 单列浮窗；用户右、AI 左；时间戳；无头像 | Commander session/run | 与目标一致，最终仅显示结果和工具摘要。关闭按钮会在流式期间同时取消运行，语义意外。 |
| 任务执行 | 输入框上方显示当前 N/总数；hover/focus 展开列表 | TaskList | 状态、耗时、错误、次数可见；无产物链接、就地重试或换 Provider；刷新依附流式会话。 |
| 选择与审批 | Production Plan、Visual Constitution、Final Export 均在聊天内 | PlanDocument/Approval | 位置正确、绑定可靠；首屏技术信息过载，视觉候选缺“全部不合适”。 |
| Prompt 组装 | Commander 决策全部来源，final prompt 原样持久化 | PromptAssembly | 数据链正确；用户只能看到 final/negative prompt 和 ID，看不到 source decisions/warnings。 |
| 结果回流 | 资产详情与节点历史显示 Prompt 和 Assembly ID | AssetEntry + Canvas | 可追溯最终文本，但任务→产物→画布缺少直接导航。 |
| 最终导出 | 审批后 render.start，后台完成并写 TaskList output | FinalExportService | separate audio/subtitles 被拒绝；启动只回 renderId，前端无完成订阅/状态消费/打开输出动作，默认路径还在临时目录。 |

## 已验证优势

1. Commander 聊天已经符合用户要求：单列、无头像、左右消息、时间戳、运行中隐藏思考、终态仅最终回复与工具摘要。
2. 任务进度采用正确的渐进披露：当前任务始终可见，hover/focus 展开完整列表，并支持 Escape。
3. 审批已统一进入 Commander；Canvas 右栏没有 Workflow/Task 面板。
4. Prompt Assembly 是 durable 单一事实源，最终 Prompt 可在生成历史与资产详情查看。
5. 资产导入、持久重命名、批量复制/移动/删除与 History restore 的错误反馈比旧流程完整。
6. 空画布、左右工具栏、设置导航和 Commander 的基础语义/accessible name 较好。

## 优先问题

### P0 — 首启 Provider 配置不是实际生成能力的事实源

Onboarding 使用 `openai/google/stability` 写 keychain；媒体目录使用 `openai-image/google-image/stability-image` 等 credential ID，且向导成功后不更新 Settings Redux 的 `hasKey`。新用户可以在向导看到“成功”，回到 Inspector 仍被判为未配置。

建议：Onboarding 与 Settings 直接复用同一 Provider catalog、credential ID、OAuth/API-key 卡片和 readiness refresh；按 Commander、图像、视频、音频明确显示能力覆盖。

### P0 — 最终交付不是闭环

Final Export 明确拒绝非空 separate audio/subtitle tracks；因此产品提供的生成音频不能进入最终成片。渲染启动返回 renderId 后后台执行，但 renderer 没有消费 `render.status`，Commander 工具只返回 renderId，任务轮询又在流式结束后停止。用户不能可靠知道“完成了没有、文件在哪里、如何打开”。默认输出目录还是临时目录。

建议：把音频混轨纳入 v2 manifest/render；为 export completion 增加 durable event/subscription，并在 Commander 最终状态显示“打开文件 / 打开文件夹 / 复制路径 / 重试”。若暂不支持音频，必须在创建音频任务前明确标注“仅资产库用途，不进入成片”。

### P1 — Generate/Cancel 被伪装成用户聊天

Inspector 生成和取消被构造成内部英文说明 + JSON，放入 Commander 队列，最后由 SessionService 记录为 user message。Cancel 也会等待当前流结束，并不是按钮文案暗示的立即停止。

建议：传 typed media intent，不走可见文本队列；聊天只记录人类可读事件。取消直接对确定 taskListId/taskId 执行持久取消，Commander 只展示结果。

### P1 — 任务列表能看但不能处理

任务浮层只展示 `artifactCount`、错误和尝试次数，没有打开产物、重试、换 Provider、查看完整诊断。任务刷新每 2 秒只发生在 `isStreaming` 为真时，后台 Provider/render 在流结束后继续时会陈旧。

建议：任务状态改为事件订阅，轮询仅作恢复兜底；每行增加“查看产物、重试、取消、换 Provider、诊断”。

### P1 — 审批首屏把审计信息放在决策信息之前

Production Plan 默认展开所有 acts；Final Export 直接展示大量 revision/hash/segment/source range；Visual Constitution 需要先锁定一个候选才出现修改/批准，缺少“全部不合适”。

建议：首屏只回答成片目标、时长、预算、候选差异、音频、主要风险；hash/manifest 收入“技术详情”。候选区增加“全部不合适，重新生成/修改方向”。

### P1 — Prompt 追溯只展示结果，不展示原因

Prompt Assembly 持久化了 sources、sourceDecisions、warnings 和 summary，但 renderer 只显示 final prompt、negative prompt 和 assembly ID。用户无法回答“哪个 preset 被忽略、为何冲突、哪条 workflow/task 指令生效”。

建议：在 Generation History 增加 Prompt provenance：来源、应用/忽略/冲突解决、原因、父版本与差异；Commander 提供按 assemblyId 读取完整 lineage 的只读动作。

### P1 — 关闭 Commander 会隐式取消运行

Minimize 是安全隐藏；Close 在流式期间会同时 `cancel()` 并隐藏窗口。窗口关闭与任务取消是两个不同意图，当前行为容易造成不可逆误操作。

建议：Close 只隐藏；运行中关闭时弹出“隐藏并继续 / 取消任务并关闭”。

### P2 — 浮窗与侧栏仍主要依赖鼠标

Commander 拖动只限制左/上边界，窄窗口时可占约 95% 宽、81% 高；拖动、resize grip 和左右 3px 宽度柄没有键盘调整/复位。右工具栏也没有复用左工具栏的方向键 toolbar 模式。

建议：完整 viewport clamp、重置位置、键盘移动/缩放、可聚焦 separator、统一工具栏 roving tabindex。小窗口改为明确的全屏工作模式，而不是被 CSS 被动裁切。

### P2 — 次要连续性问题

- 普通空画布 Create Canvas 无 try/catch/toast。
- 左右 lazy panel 使用 `Suspense fallback={null}`，低速加载表现为空白。
- 审批/任务完成后缺“返回触发节点 / 打开新资产”。
- 依赖面板只显示直接邻居，没有完整影响路径。
- 部分 Inspector 文案仍硬编码英文。

## 认知负荷

- 单一焦点：失败。Canvas、左右栏、浮动 Commander、任务和审批可同时竞争注意力。
- 信息分块：失败。审批文档和 manifest 技术字段默认过度展开。
- 语义分组：通过。聊天、任务、资产、设置与审批区分清楚。
- 视觉层级：失败。hash/ID 与“用户到底批准什么”权重接近。
- 一次一件事：失败。Inspector 的直接操作跳转为 Commander 对话。
- 最少选择：失败。八类左栏工具与多类 Prompt 输入缺统一模型。
- 减少工作记忆：失败。Preset/Template/Guide/Process Prompt/Assembly 关系不可视。
- 渐进披露：部分通过。思考、工具、任务已折叠，审批尚未。

## Persona 风险

- Alex（熟练用户）：生成/取消绕自然语言、审批滚动长、无任务行内恢复、Prompt 决策不可快速比较。
- Jordan（新用户）：首启 Provider 假成功、内部 JSON 冒充自己消息、Prompt 构造概念过多、视觉候选被迫选择。
- Sam（键盘/无障碍）：无法移动/缩放/恢复 Commander，侧栏宽度只支持鼠标，部分图标队列动作无名称；任务浮层的 focus 路径是优点。

## 直接修复顺序

1. Provider onboarding/catalog/readiness 统一。
2. typed Generate/Cancel + 确定性取消；去掉可见内部 JSON。
3. TaskList 事件订阅、任务行恢复动作和产物导航。
4. Export 完成通知、输出路径/打开动作。
5. 审批信息层级和“全部不合适”。
6. Prompt provenance UI。
7. Commander close/minimize 语义、viewport clamp 和键盘操作。

## 需要产品决定

1. separate audio/subtitles 是本版本正式能力，还是明确延期并在入口阻断？
2. 小窗口下 Commander 应成为显式全屏模式，还是继续浮动并保持最小 Canvas 可见区？
3. 审批首屏的最低决策信息：预算、时长、风险、音频、预览，哪些必须默认显示？
4. 产品顶层对象是 Project 还是 Canvas？当前没有独立 Project chooser 心智模型。
5. Prompt provenance 面向普通创作者显示到什么深度，哪些 hash 只放高级详情？

## 运行与证据说明

- Deterministic detector：0 findings、0 primary、0 advisory。该结果只说明规则未命中，不代表流程无缺陷。
- 浏览器：验证空画布、设置、Commander/最小化及基础可访问树；Web 模式无 `window.lucidAPI`，未执行真实生成、审批和导出。
- 1280×720 Commander 为 980×608；800×600 时约 760×488，遮挡绝大部分 Canvas。
- 未进行付费 Provider 调用。
- 未修改产品源码；浏览器/Vite 临时进程和日志已清理。
- 本次没有前序 critique 基线；趋势从本快照开始。
- Targeted questions skipped：本轮是明确的只读审查；需要选择的方向已单列为产品决定。
