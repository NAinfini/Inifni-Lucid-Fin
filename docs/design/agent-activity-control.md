# Agent Activity Control 设计规范

状态：Phase 6 实施基线
适用范围：Commander 窄面板、`HistoryPanel` 会话行
视觉模式：Operate；延续现有深色 DaVinci Resolve / After Effects 风格

## 1. 设计结论

将输入框上方现有 `TaskProgressPopover` 区域升级为唯一的 `AgentActivityControl`。它同时承担根 Agent、子 Agent、Tool Program 和 TaskList 进度的实时查看与控制；现有 `CommanderActiveRun` 不再作为第二个实时监控面板重复展示相同内容。已完成、失败、取消或阻塞 Run 的永久记录仍由既有消息时间线呈现，并可复用同一个 `AgentActivityControl` 打开历史执行树详情。

控制面遵循以下边界：

- 只展示持久化的公共事件投影，不展示私有思维链、provider thought signature、凭据、请求头、原始参数或未审查响应。
- AI 自行提供执行单元名称、目标、公共计划和当前步骤；UI 不用短语匹配、硬编码翻译表或宿主推断改写这些内容。
- 所有根 Agent、子 Agent、Tool Program 都是既有 Commander Run 的不同 `workType`，共享时间线、hydration、资源与控制管线。
- 不新增第二套任务状态数据库、事件总线、右侧监控栏或独立“子代理中心”。
- 现场活动入口仅在当前执行树存在 `running`、`waiting_user`、`pausing` 或 `paused` 单元时固定显示在输入框正上方；整棵树进入终态后入口自动消失，避免错误后遗留“仍在执行”。终态详情从对应消息的“查看活动”入口打开同一个组件。

## 2. 信息架构与布局

### 2.1 固定触发器

触发器位于 `CommanderInputBar` 正上方、Commander 内容区底部，位置不随消息滚动。其视觉宽度独立于 Commander 面板宽度：默认 `380px`，限制在 `300–420px`，窄视口时以容器宽度减 `24px` 为上限并居中。

单行结构：

```text
[运行圆环] 2 个执行单元 · 连续性检查      04:18 [⌃]
```

- 左侧图标表达整棵树的最高优先状态；存在活跃后代即旋转，`prefers-reduced-motion` 下改为静态状态环。
- 中间文案优先显示“活跃数量 + 当前选中/最近活跃单元的 AI 名称”，单行截断；不得使用固定 TaskList 任务名替代 AI 名称。
- 右侧显示根 Run 的总 elapsed，再放展开箭头。
- 触发器本身是按钮，拥有清晰 focus ring、`aria-expanded` 与 `aria-controls`。

### 2.2 单列树 ↔ 详情

弹层向上展开，宽度与触发器一致，高度上限为 `min(560px, 60vh)`。任何时刻只显示“执行树”或“单元详情”之一，禁止在 300–420px 中并排挤入双栏。

树视图：

```text
Agent Activity                         [关闭]
────────────────────────────────────────────
● 制作《星坠遗迹》的两人                运行中
  当前：生成镜头规格                     04:18
  ├─ ◌ 连续性审查                        运行中
  │    检查角色与道具                     01:02
  └─ ✓ 视觉风格评估                      已完成
       3 个结果                           00:47
────────────────────────────────────────────
2 运行中 · 1 已完成
```

- 根 Run 永远第一行；后代按创建顺序稳定排列，不因状态更新重新排序。
- 层级只用 12px 缩进、短连接线与状态图标表达，不用多层卡片。
- 每行最小高度 44px，主名称 13px/中等字重，副摘要与耗时 11px。
- 行点击进入该执行单元详情；整行可聚焦，当前选中行用 `bg-primary/10` 和细蓝色内描边，不使用大面积高饱和背景。
- `workType` 只在歧义时以低对比文字显示“Agent / 子 Agent / Tool Program”，避免胶囊标签堆积。

详情视图：

```text
[←] 连续性审查                    [运行中]
    子 Agent · 01:02
────────────────────────────────────────────
目标
检查角色、服装、道具与场景连续性

计划
✓ 收集当前镜头事实
● 对比连续性约束
○ 输出可执行修正

当前工作
对比镜头 004–008 的角色服装

工具与结果
● canvas.node.list · 已完成
  读取 5 个镜头节点                [查看]
● continuity.check · 执行中

产物
continuity-report.json              [打开]

资源
Elapsed 01:02
Tokens 18,420 / 31,580 remaining
Cost 不可用

[给此单元发送消息…]                 [发送]
[暂停] [停止当前步骤]                   [取消]
```

详情采用单一垂直阅读流，章节之间使用 `border-border/50` 分隔，不嵌套“卡片套卡片”。章节顺序固定：身份 → 目标 → 公共计划 → 当前工作 → 工具与结果 → 产物 → blocker → 资源 → 控制。没有数据的可选章节直接省略；目标缺失时显示本地化的“未提供目标”，不得从用户消息猜测。

## 3. 组件树

```text
CommanderPanelShell
├─ MessageList
│  └─ RunSummaryAction("查看活动") ───────┐
├─ QuestionCard / confirmation             │
└─ AgentActivityControl                    │  唯一实现
   ├─ AgentActivityTrigger                 │
   └─ AgentActivityPopover <───────────────┘
      ├─ ActivityTreeView
      │  ├─ ActivityTreeHeader
      │  ├─ ActivityTreeNode[]
      │  └─ ActivityTreeSummary
      └─ ActivityDetailView
         ├─ ActivityDetailHeader
         ├─ ObjectiveSection
         ├─ PublicPlanSection
         ├─ CurrentWorkSection
         ├─ SafeToolTimeline
         ├─ ArtifactList
         ├─ BlockerSection
         ├─ ResourceDefinitionList
         └─ ActivityControls
            ├─ TargetedMessageComposer
            └─ RunControlActions

HistoryPanel
└─ SessionRow
   └─ AgentActivityTreeIndicator
```

实施时删除或内聚 `TaskProgressPopover` 的展示职责；TaskList checklist 作为根 Run 的公共计划数据进入 `PublicPlanSection`，不保留平行弹层。`CommanderActiveRun` 的实时摘要、工具和资源职责也并入详情；消息中的终态 Run summary 继续存在，但不实时复制控制面内容。

## 4. 视图状态与事实来源

### 4.1 唯一投影

`AgentActivityControl` 只消费由 Commander Run record 与 append-only `TimelineEvent` 派生的只读视图：

```ts
type AgentActivityNodeView = {
  runId: string;
  parentRunId?: string;
  retryOfRunId?: string;
  workType: 'agent' | 'subagent' | 'tool_program';
  displayName: string;
  objective?: string;
  status:
    | 'accepted'
    | 'running'
    | 'waiting_user'
    | 'pausing'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'blocked';
  publicPlan: Array<{
    id: string;
    title: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped';
  }>;
  currentStep?: { id?: string; title: string; summary?: string };
  tools: SafeToolActivity[];
  artifacts: PublicToolArtifact[];
  blocker?: RunBlocker;
  startedAt?: number;
  completedAt?: number;
  resourceState?: RunResourceState;
  childRunIds: string[];
};

type AgentActivityTreeView = {
  rootRunId: string;
  nodesById: Record<string, AgentActivityNodeView>;
  orderedRunIds: string[];
  hasActiveDescendant: boolean;
};
```

- `displayName`、`objective`、计划项与当前步骤来自显式公共 Run 元数据/结构化 `public_progress` 字段；不得解析 assistant 文本或按英文/中文短语推断。
- 工具调用与结果只来自现有 `tool_call` / `tool_result` 公共投影；显示 canonical capability 的本地化 display metadata，不读取私有调用对象。
- artifacts 来自 `PublicToolArtifact`；同一 artifact identity 去重但保留最早产生顺序。
- blocker 来自显式 `RunBlocker` 或终态事件，不从错误字符串分类。
- tokens、tool calls、active time、cost 取最新累计 `resource_state`。Cost 为 `unknown` 时始终显示“不可用”，绝不显示 `$0`。
- elapsed 是从 `startedAt` 到当前/`completedAt` 的总历时；active time 是资源项，二者不得混名。
- `HistoryPanel` 与 Commander 触发器必须复用同一个 `hasActiveDescendant` selector，不能分别推断运行状态。

本地 UI 状态只允许：`open`、`mode: 'tree' | 'detail'`、`selectedRunId`、`messageDraft`、`pendingControlAction`、`inlineError`。关闭弹层不改变运行事实；再次打开恢复最后选中单元，切换 session 时重置为该 session 的根树。

## 5. 状态与视觉语义

| 状态               | 图标/颜色                                   | 触发器与详情语义             |
| ------------------ | ------------------------------------------- | ---------------------------- |
| accepted / running | `Loader2`, `text-primary`                   | “运行中”；仅此状态旋转       |
| waiting_user       | `CircleHelp`, `text-amber-400`              | “等待你的输入”               |
| pausing            | `Loader2`, `text-amber-400`                 | “将在安全边界暂停”           |
| paused             | `PauseCircle`, `text-amber-400`             | “已暂停”                     |
| completed          | `CheckCircle2`, `text-emerald-400`          | “已完成”                     |
| failed             | `AlertCircle`, `text-destructive`           | “失败”并展示规范化错误       |
| blocked            | `ShieldAlert` 或 `Clock3`, `text-amber-400` | “已阻塞”并展示 typed blocker |
| cancelled          | `CircleSlash2`, `text-muted-foreground`     | “已取消”                     |

状态不能只靠颜色表达；图标、文字和 `aria-label` 同时存在。树的总状态优先级为：`waiting_user` > `blocked/failed` > `pausing/paused` > `running` > terminal。

## 6. 交互与控制

### 6.1 导航

- 点击触发器打开树；点击节点进入详情；详情顶部返回按钮回到树并把焦点还给原节点。
- `Escape` 关闭弹层；点击 Commander 内其他区域关闭，但控制提交中不应误关。
- 实时更新不得把用户从详情推回树，也不得因子节点加入而重排已有节点。
- 从历史 Run summary 打开时，直接进入对应节点详情；返回进入该历史树，而不是新建另一面板。

### 6.2 消息

- 消息始终只发送给当前选中单元，输入提示明确写“给「{name}」发送消息”。
- `Enter` 发送，`Shift+Enter` 换行；空内容不可发送。
- 终态单元的消息输入禁用并解释“此执行已结束”；不把消息静默转发给父 Agent。
- 提交使用统一 `run:control` dispatcher；成功后清空草稿，失败时保留草稿并在输入下显示 inline error。

### 6.3 Pause / resume / cancel / retry

- `running`：显示 Pause、可用时的“停止当前步骤”、Cancel。
- `pausing`：Pause 禁用，文案改为“等待安全边界”；Cancel 仍可用。
- `paused`：显示 Resume、Cancel。
- `waiting_user`：允许 Message 与 Cancel；Pause 不重复出现。
- `failed`、`blocked`、`cancelled`：仅可重建输入的根 Agent 显示 Retry；子 Agent 与 Tool Program
  的私有指令或程序不持久化，因此不伪装成可精确重放。
- `completed`：控制区只读；无 Retry，除非后端显式返回该动作能力。
- Pause/Cancel 作用于所选节点及其全部后代。确认文案必须显示影响范围，例如“取消「连续性审查」及其 3 个后代？”；Message 只作用于所选节点。
- “停止当前步骤”只在当前步骤可中断时显示；不可中断调用中不伪装成功，状态改为“取消请求已排队”。
- Retry 创建带 `retryOfRunId` 的新 Run，并在树中作为新节点/同级关联项出现；旧 Run 保持不可变。
- 破坏性 Cancel 使用现有确认对话框；Pause/Resume/Message 不额外确认。所有动作按钮提交中禁用，避免重复调用。

## 7. 内容章节规则

### 公共计划

- 计划项使用模型提供的标题与稳定 id；UI 不补写制作方法。
- 最多直接显示 8 项，超出时显示“再显示 {count} 项”展开；当前项自动滚入可见区域一次，但后续更新不抢滚动。
- TaskList 的状态映射为计划项状态；宿主标签按当前语言本地化，AI 提供的名称保持原文。

### 工具与结果

- 单一时间线合并 `tool_call` 与匹配的 `tool_result`，每项展示工具 display name、状态、公共 summary、duration。
- “查看”展开 allow-listed `PublicToolDetails` 与规范化结果；原始 JSON、prompt、headers 和 provider response 永不进入 DOM。
- failed 工具显示规范化 error code 与本地化说明；不直接显示可能含敏感内容的 raw error。

### 产物

- 列表展示类型图标、公开 label/id，以及后端明确允许的 Open / Reveal / Copy Path 操作。
- 没有 artifact 时省略整个章节，不展示空卡片。

### Blocker

- 位于资源之前，使用一条 amber/destructive 左边线和明确下一步；文案由 typed blocker code 本地化。
- 资源耗尽显示耗尽的 metric 与 remaining；`unavailable` 与 `exhausted` 必须区分。
- 恢复要求说明 Retry 会创建相关新 Run，不声称恢复丢失的 provider continuation。

## 8. HistoryPanel 复用

会话行右端的 `AgentActivityTreeIndicator` 读取同一个树摘要：

- 根或任意后代处于 `accepted/running/pausing` 时显示 14px 活跃圆环；`motion-reduce` 时静态。
- 存在 `waiting_user` 时显示 amber 问号状态；全部仅 paused 时显示 amber pause；无活跃后代则不显示圆环。
- `aria-label` 包含数量，例如“2 个执行单元正在运行”，不只写笼统“运行中”。
- 点击圆环先原子加载对应 chat，再打开同一个 `AgentActivityControl` 树；它不是新的 History 详情弹窗。
- 移动/删除锁定判断也消费同一树摘要，确保可见状态与实际 guard 一致。

## 9. 视觉令牌与尺寸

不新增另一套主题变量，直接复用 `globals.css`：

| 用途               | 令牌/utility                                |
| ------------------ | ------------------------------------------- |
| 弹层背景           | `bg-card`                                   |
| 内部轻微层级/hover | `bg-surface`, `hover:bg-muted`              |
| 边框/分隔          | `border-border/70`, `border-border/50`      |
| 主文本             | `text-foreground`                           |
| 次文本             | `text-muted-foreground`                     |
| 活跃/焦点          | `text-primary`, `ring-primary`              |
| 危险动作           | `text-destructive`, `border-destructive/50` |
| 等待/阻塞          | `text-amber-400`                            |
| 完成               | `text-emerald-400`                          |

- 字体沿用应用系统 UI stack；不引入新字体。
- 弹层 `rounded-xl`，行/按钮 `rounded-md` 或 `rounded-lg`；只保留一层 `0 16px 42px rgba(0,0,0,.42)` 阴影。
- 外边距/章节 padding：12px 与 16px；行间距 8px；正文 line-height 1.5。
- 正文 13px，标题 12–13px semibold，辅助信息 11px；数字使用 `tabular-nums`。
- 交互目标桌面最小 36px，高频整行节点 44px；图标 14–16px，不能使用 emoji。

## 10. 响应式行为

- Commander 内宽 `>= 444px`：弹层默认 380px，可由实现固定但不得随 Commander 拉伸超过 420px。
- Commander 内宽 `300–443px`：弹层宽度为内容区宽度减 24px，仍保持单列。
- 可用宽度 `< 300px`：以视口左右 12px 为硬边界，允许低于 300px；不得横向滚动或溢出屏幕。
- 高度不足时，header 与底部控制区 sticky，中间详情独立纵向滚动；弹层始终向可用空间方向展开，优先向上。
- 树名、目标和当前步骤允许两行后省略；详情正文允许自然换行，artifact id/path 使用中间省略或 break-all。
- 宽度变化不能令当前视图、焦点或选中 run 重置。

## 11. 无障碍

- 弹层使用命名 `region` 或非模态 dialog；保持 Commander 输入上下文可达，不实施 modal focus trap。
- 树使用 `role="tree"`、节点 `role="treeitem"`、`aria-level`、`aria-selected` 和 `aria-expanded`。支持 Up/Down 移动、Right 展开/进入、Left 折叠/返回、Home/End。
- 详情返回后恢复原 treeitem 焦点；关闭后恢复触发器焦点。
- 只有精简状态句进入 `aria-live="polite"`；工具流与资源更新不重复朗读整面板。
- destructive 确认对话框具有明确标题、影响数量、默认焦点在 Cancel。
- 所有图标按钮有本地化 `aria-label` 与 tooltip；状态图标装饰用途 `aria-hidden`。
- 遵循 `prefers-reduced-motion`；旋转与折叠动效可取消，功能不能依赖 motion。
- dark、light、high-contrast 三套既有 token 下都保持可读；任何状态必须至少有图标+文字双编码。

## 12. i18n 与内容策略

- UI chrome、状态、动作、单位、确认、错误、空状态全部进入现有中英文 i18n 目录；不在 JSX 内写用户可见英文。
- 数字、日期、elapsed、tokens 与 cost 使用 locale-aware formatter；英文可写 `18.4K`，中文可写 `1.84万`，但详情 tooltip/辅助文本提供精确数值。
- `displayName`、`objective`、计划与 current step 是 AI/用户生成的公共内容，按原文显示，不经本地硬编码短语表翻译或分类。
- 工具名称来自 canonical capability catalog 的本地化 metadata；未知工具显示安全的 canonical name，不依据名称字符串猜类型。
- 推荐 key 空间：`commander.agentActivity.*`；History 只引用同一状态 key，避免两套文案漂移。
- 关键状态文案必须覆盖：running、waitingUser、pausing、paused、completed、failed、cancelled、blocked、costUnavailable、safeBoundary、subtreeImpact、retryCreatesRun、terminalMessageDisabled。

## 13. 验收清单

- [ ] `TaskProgressPopover` 与 `CommanderActiveRun` 的实时监控职责已收敛到唯一 `AgentActivityControl`；不存在第二个 TaskList/子代理监控 UI。
- [ ] 触发器固定在输入框正上方，默认窄宽且不随 Commander 宽度无限增长；弹层始终为 300–420px 单列树 ↔ 详情。
- [ ] 用户可浏览根 Agent、子 Agent、Tool Program 树，并进入每个执行单元。
- [ ] 详情可查看 AI 名称、objective、公共计划、current step、安全工具记录、规范化结果、artifacts、blocker、elapsed、tokens 与 cost。
- [ ] Cost unknown 显示“不可用/Unavailable”，绝不显示 `$0`。
- [ ] 用户可按适用状态 Message、Pause、Resume、Cancel、Cancel current step、Retry；父级 Pause/Cancel 明确作用于后代，Message 只发送给选中单元。
- [ ] Pause 在当前不可中断调用结束后的安全边界生效；UI 不伪报已暂停。
- [ ] Retry 创建关联新 Run，旧 Run 事件与状态不变。
- [ ] 所有 UI/模型控制走同一 dispatcher 与 guards，按钮不直接修改本地运行状态。
- [ ] 整棵树终态后实时触发器清除；历史消息仍能用同一个组件查看终态详情。
- [ ] `HistoryPanel` 在任意后代活跃时显示圆环，并与移动/删除锁定复用同一 selector。
- [ ] AI 名称与计划原文显示，没有硬编码短语识别、宿主流程改写或客户端翻译表。
- [ ] DOM、SQLite、IPC 中不出现 CoT、secret sentinel、API key、authorization header、raw provider body 或未经公共投影的参数/结果。
- [ ] 键盘导航、焦点恢复、aria 状态、reduced motion、high contrast、中英文以及窄面板均通过测试。

## 14. 明确不做

- 不展示逐 token 私有推理或“思考过程”；只展示模型主动发布的公共进度摘要。
- 不创建独立子代理聊天 transcript 混入根聊天；子 Run 的公共历史只在控制面中查看。
- 不把 TaskList、Agent、Tool Program 做成三套信息架构。
- 不用新的全局侧栏、全屏 dashboard、2×2 监控卡阵列或可随 Commander 拉伸的宽面板。
- 不在 UI 根据自然语言猜测“是否批准”“是否继续”“属于哪个阶段”或工具风险。
