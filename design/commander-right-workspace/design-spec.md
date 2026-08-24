# Commander AI 单一右侧工作区

## 设计结论

把当前可拖动的 `CommanderPanel`、画布上的独立 `ExecutionPanel` 和全屏 `WorkflowDetailDrawer` 收敛为一个贴右、全高、可调宽度的 Commander 工作区。保留现有 cool-neutral 深色卡片、primary blue、amber approval、red danger 语言；不新增品牌视觉。

参考图：[commander-right-workspace-1280x720.png](./commander-right-workspace-1280x720.png)。图中展示约 460 px 的窄栏状态，便于验证 440 px 下限的信息密度。

## 组件层级与现有组件映射

```text
CanvasPage
└─ CommanderWorkspaceDock <aside>
   ├─ ResizeSeparator
   ├─ CommanderHeader
   ├─ ViewTabs [Chat | Workflow]
   ├─ LiveActivityBar
   ├─ AttentionTray（跨视图固定）
   │  ├─ QuestionCard（蓝）
   │  ├─ ToolConfirmCard（琥珀）
   │  └─ ProductionPlanApprovalCard（强强调、持久）
   ├─ ActiveView
   │  ├─ ChatView → MessageList → RunProcessDisclosure
   │  └─ WorkflowView → ExecutionPanel → inline WorkflowDetail
   └─ Composer / 当前审批的 sticky actions
```

- `WorkflowDetailDrawer` 的内容改为 dock 内联详情，不再出现遮住画布的第二层抽屉。
- `ProductionPlanApprovalCard` 默认先显示可判断的摘要；“查看详情”在原卡片展开，批准和请求修改始终留在卡片底部。
- `QuestionCard`、`ToolConfirmCard`、工作流审批都进入同一个 `AttentionTray`，不再分别覆盖输入区或散落在执行浮层。

## 布局与尺寸

| 区域                 | 规格                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| Dock                 | 右侧全高；默认 560 px；用户可调 440–720 px；宽度按画布/工作区记忆              |
| ResizeSeparator      | 8 px 命中区、1 px 可见分隔线；hover/focus 用 primary；双击恢复 560 px          |
| Header               | 40 px；标题、当前 Canvas 上下文、更多、关闭                                    |
| Chat / Workflow tabs | 36 px；平面 tab + 2 px active underline；待办数显示为 badge                    |
| Live status          | 28–30 px；单行 phase、step、elapsed、可用时显示停止/跳过                       |
| AttentionTray        | 固定在 tabs/status 下；最大高度 `min(240px, 38vh)`，内部滚动；标题和计数不滚动 |
| Main view            | `minmax(0, 1fr)` 单一滚动区；Chat 与 Workflow 不同时挂载视觉层                 |
| Composer             | sticky bottom；最小 64 px、随输入增长至 132 px；控制高度 28–32 px              |
| Spacing / radius     | 4 px 基线；常用 8/12/16 px；普通卡 6–8 px，审批主卡 10–12 px                   |

内部所有 flex/grid 子项均使用 `min-width: 0`；正文 `overflow-wrap: anywhere`，URL/hash 使用 `break-all`。只允许摘要做 2–3 行截断，并必须提供明确“展开”入口。

### 1280×720 与 200% 缩放

- 1280×720 下使用 520–560 px 舒适宽度；440 px 状态仍保留全部按钮与文字，不依赖 hover 才可操作。
- 200% 缩放时，保存宽度临时钳制到可用上限，但不低于 440 px；允许画布只保留窄上下文带，不横向压缩 dock 内容。
- 可用高度约 360 CSS px 时：header/tabs/status 保持固定；AttentionTray 缩到 `38vh` 并自动滚到最新阻塞项；审批卡正文独立滚动，底部“请求修改 / 批准并继续”保持 sticky；Chat/Workflow 主区仍可滚动。
- 440–519 px 用单列详情；520–720 px 可把元数据改为两列。按钮可换行但不得裁切中英文标签。

## 视觉规范

- 直接复用 `globals.css` 令牌：`bg-background`、`bg-card`、`bg-surface`、`border-border`、`text-foreground`、`text-muted-foreground`、`bg-primary`、`text-destructive`。
- 字体沿用 Inter/system；正文 12–13 px / 18 px，次要标签 10–11 px，卡片标题 13–14 px；仅 section eyebrow 使用 uppercase + tracking。
- 普通层级用 1 px border 和极弱 shadow；不要玻璃拟态、霓虹渐变或浮动窗口外观。
- 三类“需要处理”不能只靠颜色：

| 类型           | 视觉编码                                                                                | 主要动作                       | 生命周期                        |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------- |
| 聊天问题       | 蓝色左轨/边框 + question 图标 + “需要回答”                                              | 选择答案或其他文本             | 回答后变为聊天历史              |
| 工具授权       | 琥珀细边 + shield + 风险/变更标签                                                       | 跳过、允许一次                 | 决策后移出 tray                 |
| 持久工作流审批 | 2 px 琥珀强调轨、elevated card、“阻塞中 / Persistent gate”、更大标题、solid blue 主 CTA | 查看详情、请求修改、批准并继续 | 跨视图/会话保留，完成前不可关闭 |
| 错误/危险      | 红色图标、边框和文案                                                                    | 重试、停止或查看错误           | 明确恢复后消失                  |

蓝色仍表示回答和主要确认动作；琥珀表示需要授权/审批；红色只用于错误、取消和不可逆危险。

## 交互与状态

- 新待办到达时自动展开 `AttentionTray` 并把对应卡片滚入视野，但不抢键盘焦点；持久审批完成前始终显示。badge 与 `aria-live` 同步更新。
- 卡片一次只展开一个详情。审批详情在原卡片展开，操作后显示 submitting/success/error；revision 已过期时禁用批准并显示红色说明。
- Chat/Workflow tab 只切换主内容；`AttentionTray` 和 live status 始终存在。Workflow 列表点击后在同一主区展开详情，不再开 modal/drawer。
- thinking、process、tool calls 默认折叠。折叠行必须同时展示 chevron、工具数、耗时、错误数、可见的“查看工具记录”和 overflow menu；展开后显示完整时间线与 raw args/result。
- 所有命令可从 Composer 的可见“命令 /”按钮打开，并支持输入 `/`；菜单提供名称、描述和快捷键。命令不得只藏在右键菜单或 hover 中。
- Live status 沿用真实 phase timer；>20 s 变琥珀，>45 s 或 failed 变红；可取消步骤时显示文本动作，而不是仅图标。

## 无障碍

- Dock 使用 `aside` + 可读名称；tabs 使用 `tablist/tab/tabpanel`，左右方向键切换。
- ResizeSeparator 使用可聚焦 `separator`，暴露 min/max/current；方向键每次 16 px，`Shift` + 方向键每次 64 px。
- 每张待办卡是带标题的 `article`；展开按钮具备 `aria-expanded`/`aria-controls`；status 采用 `role=status`、`aria-live=polite`。
- 颜色均配合图标和明确文本。正文/背景对比至少 4.5:1，图标和大文字至少 3:1；focus ring 为现有 primary 2 px。
- 新待办不自动移动焦点；操作完成后焦点回到同卡片标题或下一待办。Escape 只收起详情，不误关闭整个 dock。
- 尊重 `prefers-reduced-motion`；spinner 对读屏隐藏，状态文字负责播报。

## 最小验收

1. 在 440、560、720 px 三种 dock 宽度下无横向溢出，Question/Tool/Approval 三类待办可区分并可完成。
2. 待审批出现时，无论当前在 Chat 还是 Workflow，都自动可见、可原位查看、批准或请求修改。
3. 1280×720 与 200% 缩放下，header、tabs、status、需要处理标题和当前阻塞项仍可达；所有内容可通过键盘滚动访问。
4. 使用中英文长问题、长工作流标题、长 URL/hash 验证换行；操作按钮文本不截断。
5. thinking/tools 初始折叠，但键盘和鼠标均能发现命令入口、展开过程和查看工具记录。
