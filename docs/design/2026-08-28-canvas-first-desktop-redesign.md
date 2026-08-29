# Lucid Fin：Canvas-first 桌面端重构设计规格

**状态：实现目标（设计产物，不包含源码改动）**

**适用范围：** `apps/desktop-renderer` 与 Electron 窗口外壳
**视觉模式：** Operate——高频、可审计的电影生产工具，而不是营销页、通用仪表盘或模型工作流编辑器。

本规格依据当前产品决策重新定义桌面端信息架构。它保留 `asset/Logo.png`、深色专业制作语义、现有的事实所有权和可恢复的结果历史；不延续旧的 Overview / Canvas / Media / Production / Delivery 并列工作区，也不复制旧 Canvas 的技术节点拼线界面。已删除的历史外壳规格不能作为这次重构的视觉实现依据。

参考构图：

- [主制作台：Chat、Canvas、Inspector 与 Sequence](lucid-fin-canvas-workspace-reference.png)
- [全局资产库：角色、地点、世界、风格与媒体](lucid-fin-global-assets-reference.png)
- [全局设置：Provider、费用与三档执行授权](lucid-fin-settings-reference.png)

这些图是空间、层级和质感参考；真实实现必须使用现有 Logo 文件、真实数据、可访问文字与 canonical IPC/authority，不能把图中的示例文字、人物或价格当成产品数据。

## 1. 设计主张与不可违反的产品关系

**一句话：** 用户从一个 Project 中的任意 Chat 开始导演；AI 把可复用的生产事实和候选结果放进 Canvas，独立的 Sequence Lane 决定最终顺序，Global Assets 让角色、地点、世界和媒体跨项目复用。

界面首先要让用户看到“影片正在变成什么、AI 正在为哪个语义单元工作、我何时需要决定”，而不是让用户管理 provider、prompt、工具节点或 JSON。

必须始终成立：

- **Chat 是默认入口。** 一个 Project 可以有很多 Chat；每个 Chat 是独立的指令与 Run 上下文。用户能同时启动多个 Chat/Run，并一眼识别运行、等待、暂停和完成状态。
- **Canvas 是生产图谱，不是流程图。** Canvas 节点表示稳定的创作意图（故事节拍、场景、镜头、角色、地点、世界、交付片段），不是“调用某个模型”或“一张生成图”。
- **一个语义节点内保留全部候选。** 一个 Shot 节点可以拥有多个图片、视频、音频候选；画布只显示当前选中的代表结果与候选计数。只有显式创意分叉才建立新 Shot/Scene 节点。
- **Sequence Lane 是唯一的片段顺序权威。** Canvas 的 x/y、分组、连线永不改变镜头或交付顺序。拖动 Sequence Lane 才修改顺序；Canvas 只帮助理解关系。
- **Assets 是跨项目的权威资源库。** 角色、地点、世界、风格和原始媒体都可复用；项目引用锁定到使用时的版本，之后全局版本变化不会悄悄改掉已完成的镜头。
- **Settings 是唯一的全局控制面。** Provider、模型、凭证、费用上限、执行策略和 Skills/catalog 都在此处；项目内不再出现第二个“项目设置”入口。
- **所有付费或危险操作都可追溯。** 任何模式都不越过硬预算、凭证安全、删除和外部分享保护；Full auto 是自动推进依赖阶段，不是伪造“跳过实际生成”。

明确不做：传统多轨 NLE、手工节点工作流搭建器、通用 KPI 卡片首页、原始 JSON/change feed、提示词/模型调用日志堆在用户面前、把 200 多个镜头预设逐一伪装成 Skills、重复的 Chat/Run/设置入口。

## 2. 信息架构

```text
Lucid Fin
├─ Projects
│  ├─ Project list
│  │  ├─ Active
│  │  └─ Archived (filter only; Restore is explicit)
│  └─ Project
│     ├─ Chats                         ← 默认进入的导演工作面
│     │  ├─ Chat A / Run(s)
│     │  └─ Chat B / Run(s)            ← 可并行
│     ├─ Canvases                      ← 多个可命名生产图谱
│     │  ├─ Story / episode canvas
│     │  └─ Sequence lane (同一事实的唯一顺序控制器)
│     └─ Project menu                  ← rename, project details, archive
├─ Global Assets
│  ├─ All assets / Media
│  ├─ Characters / Locations / Worlds / Styles
│  └─ Collections and cross-project usage
└─ Settings
   ├─ AI providers
   ├─ Execution policy
   ├─ Budget & cost
   ├─ Skills & catalogs
   └─ Appearance / accessibility
```

### 2.1 不再使用的项目导航

项目内不再把 `Overview`、`Media`、`Production`、`Delivery` 做成与 Chat 并列、会迫使用户“跳出当前对话”的一级页面。它们分别被收敛为：

| 旧入口        | 新位置                                                         | 目的                             |
| ------------- | -------------------------------------------------------------- | -------------------------------- |
| Overview      | Chat 的 Run 摘要、Canvas 当前状态、Project list 的一行摘要     | 不制造仪表盘                     |
| Production    | Canvas 节点 Inspector 的 Facts / References；Assets 的实体详情 | 让结构化事实靠近正在导演的对象   |
| Project media | Shot 的候选查看器与 Global Assets 的项目链接                   | 不复制媒体库                     |
| Delivery      | Sequence Lane 的 review cut / export 抽屉                      | 让交付顺序在唯一顺序控制面上完成 |

项目菜单仅有一个来源：项目标题旁的 `⋯`。Archive 置于该菜单的“Project management”分组中，二次确认后从 Active 列表移走；Projects 页的 Archived 过滤器负责 Restore。它不能成为侧栏一级页，也不能被放在高频创作动作旁边。

## 3. 窗口外壳与核心布局

### 3.1 自绘标题栏

Windows 目标使用无系统框架窗口（实现上应是自绘 titlebar + 最小化、最大化/还原、关闭三枚真实控制按钮），不保留 `titleBarOverlay` 的 Windows 标题栏或系统边框。

- 高度 `38px`；左侧是 24px 圆形裁切的真实 `asset/Logo.png`、Lucid Fin、当前 Project 名；中间留出可拖动区；右侧为 46px × 38px 的自绘窗口控制区。
- 拖动区使用 Electron 可拖动区域；所有按钮、输入、菜单和滑块必须显式为不可拖动区域。
- 边缘仅使用 `1px` 低对比结构线；最大化状态不出现双重边框。关闭按钮 hover 使用明确而克制的红色背景，其他控制按钮只改变表面色。
- App logo 不再用通用 clapperboard 替代。小尺寸时仍保留品牌圆标与可访问名称。

### 3.2 宽屏（`>= 1440px`）

```text
38 Title bar
┌────56────┬─────260 Project sidebar─────┬──── flexible work surface ────┬──360 Inspector / Commander──┐
│ Global   │ Project / Chats / Canvases   │ Chat or Canvas                │ one contextual right panel  │
│ rail     │                               │ (Canvas includes Sequence)    │ never a duplicate chat      │
└──────────┴───────────────────────────────┴──────────────────────────────┴─────────────────────────────┘
```

- **Global rail：** 56px，只放 Projects、Assets、Settings；顶部展示品牌，底部可放 Help/account。图标有 tooltip、文字标签或展开语义，不能靠颜色猜当前位置。
- **Project sidebar：** 260px。顶部为返回 Projects、项目名、`⋯`；其下首先是 Chats（含 `+ New chat`），再是 Canvases（含 `+ New canvas`）。列表项有标题、最多一行次级状态、Run 状态点/文字；不出现另一个 project workspace menu。
- **中央工作面：** 通过当前 sidebar 选择进入 Chat 或 Canvas。Chat 是首次/恢复后的默认面；Canvas 是制作图谱面。中央 header 只有面包屑、当前名称、清晰的模式/预算摘要和与内容直接相关的动作。
- **右面板：** 默认 360px（可调整 336–440px），只有两个互斥模式：Inspector 或 Commander。它们共享同一个 active Chat、selection 与 Run；绝不复制一个“巨大当前聊天”到页面中央。选择对象时显示 Inspector；点击 Chat drawer 或快捷键时以 Commander 替换 Inspector。
- **Sequence Lane：** Canvas 底部固定停靠、可拖动调整 156–280px。它不是 Canvas 上的水平排列，也不是隐藏在 Delivery 页里的第二套顺序。

### 3.3 1024–1439px 与最小窗口

应用的最小支持宽度保持 `1024px`。在这个范围内：

- Global rail 保持 56px；Project sidebar 可折叠至 60px 图标+tooltip，或覆盖式展开。
- 右侧 Inspector / Commander 不与中央面并排硬挤；用户显式点击后从右侧覆盖进入，关闭/`Esc` 回到原位置，且不改变 Chat、Canvas camera 或 selection。
- Canvas Sequence Lane 默认收至 156px，但它的顺序、选择和拖拽能力不消失。
- 不使用横向页面滚动。英文与中文较长标签允许两行或中间省略，危险/主要动作永远保留文字。

## 4. Chat：默认的导演工作面

点击一个 Chat 后，中央区域显示该 Chat 的唯一 transcript 与 Run 公开进度；不是聊天副本，也不是“项目变更页”。

### 4.1 结构

1. **Chat header：** Chat 标题、运行状态、当前授权模式、累计费用 / 硬上限、`Open Canvas`。全部是信息条而非卡片仪表盘。
2. **Conversation：** 用户指令、AI 的简短可见摘要、可展开的计划、等待决策、生成结果 strip 和已完成总结。每个结果或对象链接回 Canvas/Assets，并可用 closeable Inspector 就地查看。
3. **Run 控制：** 当前 Run 只出现一次。运行中显示当前阶段、已完成/待处理数量、Pause/Stop；不单独再造 activity console。
4. **Composer：** 底部 sticky，含附件、当前上下文 chips、授权/预算 pill 和发送键。`Shift+Enter` 换行；出现并行 Run 时，后续消息明确会进入本 Chat 的安全 follow-up/下一 Run。

### 4.2 三档授权模式的可见行为

全局默认在 Settings 设置；一个 Run 开始时以可见 pill 读取并冻结。用户可以点 pill 打开很小的“本次 Run 授权摘要”，跳转到 Settings 修改未来默认，不在每个项目中再造一套设置表单。

| 模式                   | Chat 中看到什么                                          | AI 自动做什么                                    | 必须暂停的情况                                             |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| **Review every spend** | 每个付费动作前出现报价、范围、预计费用、Approve / Reject | 不执行未确认的图片、视频、音频、评价调用         | 每笔 spend，及所有硬保护                                   |
| **Approve for me**     | 只显示实时费用、计划和“AI chose … because …”记录         | 在本次预算内调用、评价、选择候选并继续           | 硬上限、低置信度、缺失关键引用、受保护动作                 |
| **Full auto**          | 阶段进度、累计费用、暂停点、最后 review cut 与选择理由   | 自动经过计划、生成、评价、挑选、排序、review cut | 硬上限、凭证、删除、外部分享、不可逆导出；不能跳过真实依赖 |

所有自动选择保留：所选候选、评估证据、选择理由、成本、前一选择和 `Undo / Compare`。这让“自动”成为可审计的加速，而不是不可解释的黑箱。

### 4.3 不迷路的打开/关闭规则

- 点击 Project change、结果、角色、地点或 Sequence item 时，在当前面右侧打开 Inspector；`Esc`、`×`、返回焦点均关闭它。不得导航到没有明显出口的孤立页面。
- 点击 Canvas 节点或资产条目，保留 Chat 状态与滚动位置；只切换中央工作面和选中对象。
- Focus Chat 是中央面替换（Project sidebar + conversation + contextual inspector），含明确 `Exit focus` 和 `Esc`，返回之前的 Chat/Canvas 及其滚动/相机位置。

## 5. Canvas、候选查看与 Inspector

### 5.1 Canvas 的内容模型与视觉语法

Canvas 是一个有限层级、可缩放和可搜索的“生产图谱”。它对 AI 与用户都可读，但对普通用户不暴露 provider/tool graph。

| 节点类型                             | 核心内容                                | 视觉规则                                     |
| ------------------------------------ | --------------------------------------- | -------------------------------------------- |
| Story beat                           | 标题、简短意图、完成状态                | 无大图，像写在分镜纸上的语义块               |
| Scene                                | 场景名、目标、包含 Shot 数              | 低对比区域/章节框，不是独立数据副本          |
| Shot                                 | 标题、当前选中图片/视频、候选计数、状态 | 最大、媒体优先；一个节点代表一个稳定拍摄意图 |
| Character / Location / World / Style | 版本、参考缩略图、被引用关系            | 小型关联节点；点击进入实体 Inspector         |
| Output / review cut                  | 当前 Sequence 输出、时长、缺失项        | 只表示交付结果，不能重新定义顺序             |

- 连线表达“属于、使用、参考、产生”这类关系；只在必要时出现标签。不能使用端口颜色来暗示模型调用链。
- Canvas 节点可自由拖动、分组、注释、缩放和搜索；hover 显示表面提升、边框和快速动作。拖动不改 Sequence；左下角永久提示“Layout is visual only · sequence is below”。
- Canvas 顶栏提供 hand/select、zoom、fit, search、minimap、layers。键盘：`Space` 平移、`/` 搜索、`F` 适配、`Esc` 清除临时选择。
- 空 Canvas 不显示空卡片墙：中央仅显示一条故事起点与一个 `Ask Commander to plan this production` 动作；AI 首次完成计划后自然生成 Scene/Shot 图谱。

### 5.2 Shot 节点：一个节点，多个候选

Shot 是候选集合的表面投影，而非新建第二套 CandidateSet 事实。

- 节点正面只显示**选中代表帧**、`8 image candidates · 3 video candidates`、状态与可读的 selection marker。
- 所有候选继续由既有 Generated Result、assessment 和 result decision 记录拥有；UI 仅把它们按 `targetRef` 聚合显示。
- 明确的 `Creative fork` 才创建第二个 Shot；同一意图的不同 seed/model/quality 尝试始终留在原节点内。
- 生成中的节点使用媒体 skeleton、阶段文字和费用累计；失败显示人类可读原因与 `Retry`/`Change direction`，不显示 provider 原始响应。

### 5.3 Inspector 与候选比较

右 Inspector 打开一个 Shot 时：

```text
Shot 03 · Pier arrival                     [⋯] [×]
Candidates 8 | Evaluation | References | Facts
┌ candidate grid (2–4 columns, media first) ┐
│ thumbnail · selected/rejected/processing  │
│ score · provider/model · cost (short)     │
└──────────────────────────────────────────┘
Compare  Select for shot  Regenerate
AI selection reason · assessment summary · cost / budget
Selection history / Undo
```

- 点击 thumbnail 不立即丢弃现选择；显示大预览、可比较候选、相同 prompt/reference 的必要 provenance。
- `Select for shot` 是显式 decision；选中态用图标、文字、边框三重编码，不能只靠青色。
- `Compare` 进入可关闭的 2–4 面板比较，支持方向键切换、空格播放、`Esc` 返回；比较不会创建新 Canvas 节点。
- `Evaluation` 显示评分维度、连续性问题和 AI 选择理由；`References` 显示角色/地点/世界/风格的**版本固定**引用；`Facts` 展示可编辑的创作事实和来源。
- 任何 `Open in Chat`、`Use as reference`、`Promote to asset` 都是具体、有返回路径的动作；没有真正 authority 的动作必须禁用并解释原因。

## 6. Sequence Lane：唯一顺序控制器

Sequence Lane 是 Canvas 底部的独立 controller/view，不以 Canvas 坐标、节点排序或 delivery 的另一个列表推断顺序。

- Header 显示 Sequence 名称、总时长、片段数、review cut 状态和一个 `Open review cut` 动作。
- 片段卡以 `01 / 02 / 03 …` 和选中代表帧呈现；拖拽、键盘 `Move earlier/later`、插入、移除都写入相同的 canonical sequence authority。
- 选中 Lane item 会选中对应 Shot；选中 Canvas Shot 也会在 Lane 定位并高亮，不创建另一份对象。
- 只提供顺序、选中结果、简单 trim/时长、音频偏好、review cut / export 准备；不扩张为多轨、关键帧、调色、转场或专业剪辑软件。
- 生成 review cut 前，Lane 显示缺失候选、未选镜头、冲突时长等 blocking items，并可把这些作为结构化上下文发送给 Commander。

## 7. Global Assets：可复用的角色、地点、世界、风格与媒体

Assets 是顶级全局入口，不藏在某个项目的“Library”页。它有自己的 taxonomy sidebar：All assets、Characters、Locations、Worlds、Styles、Media、Collections。

### 7.1 主列表

- 采用“媒体优先的编辑式行/块”，而不是同尺寸 dashboard cards：大缩略图 + 类型 + 名称 + 一行事实 + 版本 + 被引用次数 + 当前选择。
- 搜索同时支持名称、标签、角色/地点事实、Collection；Filters 包括类型、更新、项目、状态和版本。
- `New asset` 可从空实体、现有 Global Media 或 Commander 建议创建；`Import` 只导入真实文件，保留其 canonical bytes/technical metadata。
- Collections 只是组织视图，不拥有第二份资产或复制 bytes。

### 7.2 实体 Inspector 与版本

选中角色/地点/世界/风格时，右 Inspector 显示：媒体变体、结构化事实、关联实体、当前/历史版本、哪些 Project/Shot 正在使用、`Use in project`。

- 在 Project 内选择 `Link from Assets` 打开相同资产选择器；链接的是版本固定的引用。
- 更新全局资产默认创建新版本。已锁定的 Project/Shot 不自动漂移；用户可在该 Project 明确选择 Upgrade reference。
- “Use in 7 projects”是导航信息，点击后显示只读 usage 列表和来源，不把项目关系变成编辑权限。

## 8. Settings：Provider、授权、预算和 Skills 的唯一控制面

Settings 由 Global rail 打开，左侧采用稳定分类，主区每次只处理一种职责；不要在 Project header、Project footer、Composer、modal 各放一个相互漂移的 settings button。

### 8.1 AI providers

提供五种角色行：Director LLM、Image generation、Video generation、Vision evaluation、Audio。每行显示 Connected / Needs setup / Test connection、当前模型、上次健康检查、`Configure`。凭证输入只进入 OS Keychain；界面只能显示“已连接/需重新授权”，不能回显 key。

### 8.2 Execution policy 与持续费用可见性

Settings 中有三张明确的 radio-card：Review every spend、Approve for me、Full auto。右侧固定 Budget overview：本期支出、当前 Run、硬 ceiling、provider readiness 和保护说明。

- 成本为 unknown 时显示 `Unavailable`，绝不显示 `$0`。
- 切换 Full auto 前，展示明确的完整范围、硬限额、会暂停的条件和不会自动放行的受保护动作。
- 所有正常界面的 header/Composer 状态条只显示 compact `mode · run spend / cap`，点击跳 Settings；不会复制完整的设置表。

### 8.3 Skills & catalogs

将现有 preset/template/camera vocabulary 作为**可搜索、可编辑、带类型的 Catalog**（shot language、prompt method、renderer habit、process guide），不把每个枚举值做成一张 Skill 卡。真正 Skills 保持方法/工作流定义。

- Chat 中用户说“把这个方法保存成 Skill”时，AI 创建 `skill.propose`；Settings 的 `Proposals` 区显示名称、差异、适用范围、风险与 Confirm / Reject。
- Confirm 后只对下一 root Run 生效；正在运行的 Run 冻结自己的 Skill set。界面要说明这点，不静默更改当前 Run。

## 9. 设计令牌与微交互

### 9.1 色彩、字型和空间

保留现有蓝黑基调，扩展为从 Logo 水蓝提取的受控强调色；不能做霓虹赛博、玻璃拟态或泛化 AI dashboard。

| Token           | 建议值    | 作用                           |
| --------------- | --------- | ------------------------------ |
| `--ink-0`       | `#0B0E12` | app 背景与 Canvas 暗场         |
| `--ink-1`       | `#11161D` | rail / sidebar / titlebar      |
| `--ink-2`       | `#171E27` | 输入、Inspector、hover surface |
| `--line`        | `#2B3542` | 1px 结构分隔线                 |
| `--text-strong` | `#F0F5FA` | 标题和关键事实                 |
| `--text`        | `#C7D1DE` | 正文                           |
| `--text-muted`  | `#8290A2` | 次级信息，不能用于主要可读内容 |
| `--aqua`        | `#55CDE4` | selection、brand、水蓝强调     |
| `--action`      | `#3E90F4` | 主动作、focus ring             |
| `--warning`     | `#F3B346` | 等待/需要确认                  |
| `--danger`      | `#F26B73` | destructive / failure          |
| `--success`     | `#5BCB91` | 已完成 / within budget         |

- 字体沿用可靠的 Inter / system UI stack；主文本 `14px / 1.5`，关键标题 `16–20px / 600`，分区标签 `11px / 650`。不把品牌感寄托在难以加载的新字体上。
- 采用 4px 基准：外壳 12px，面板 16px，主要表面 20–24px；正文和边框至少 12px 内缩，textarea 14px。任何文字、icon 或 button 不得贴边。
- radius：控件 8px，面板 10px，菜单 12px。阴影只用于浮层，避免大面积悬浮卡片。

### 9.2 Hover、focus、pressed 与滚动

用户已明确要求 hover，因此每个真实交互元素都必须具有可感知状态：

| 状态          | 视觉/行为                                                                              |
| ------------- | -------------------------------------------------------------------------------------- |
| Hover         | `--ink-2` 背景 + `--line` 提亮 + icon/text 轻微提升；候选缩略图可出现 1px aqua outline |
| Selected      | 左侧 2px 或 2px outline、文字/图标、状态标签三重编码；不能只有颜色                     |
| Focus-visible | 外侧 2px `--action` ring + 2px offset；键盘焦点永远不被阴影吞掉                        |
| Pressed       | 80–100ms 表面压下 / inset border；不做明显缩放跳动                                     |
| Disabled      | 明确减饱和 + explanatory tooltip/inline reason；不让不可用按钮表现成可点击             |

所有状态动画 `120–160ms ease-out`；`prefers-reduced-motion` 时移除位移、弹跳和持续旋转，仅保留状态切换。

默认系统滚动条不能露出，但也不能把可滚动性藏掉：每个滚动区使用 12px gutter 命中区域与 4px 半透明 custom thumb；thumb 在 hover、focus-within、滚动中出现，在静止时淡出。键盘滚动、Page Up/Down、Home/End、拖动和触控板必须完整可用。

## 10. 状态、无障碍与完成验收

### 10.1 必须设计的状态

- 新 Project：描述输入即是 Project/首 Chat 名；不显示另一个 optional name 字段。描述提交后进入正在规划的 Chat。
- 空 Chat / 空 Canvas / 空 Asset 分类：一个清晰下一动作，不塞说明卡。
- queued、running、waiting for approval、paused、blocked、failed、completed：图标 + 文本 + 色彩；never color-only。
- 候选生成中、部分成功、无评估、评估失败、选择已撤销、版本过期、引用锁定、预算未知/已耗尽。
- Provider 未设置、健康检查失败、需要 Keychain/OAuth 授权：动作必须指向真实 Settings 页面。
- archived Project：Projects list 可检索、可 Restore；不能只靠深层路径找到。

### 10.2 无障碍与本地化

- 全部 icon button 有本地化 `aria-label` 和 hover tooltip；完整键盘顺序是 titlebar → rail → project sidebar → work surface → right panel → Sequence Lane。
- 菜单、Inspector、compare、right drawer 以 `Esc` 关闭并把焦点归还启动元素。危险操作默认焦点在 Cancel。
- Canvas 节点有可读的列表/outline 替代导航；缩放与拖动不能是理解内容的唯一方式。
- 英文/中文长度增加时，标题最多两行后中间省略；不裁切行动动词或预算状态。媒体比例与视觉预览可以裁切，文本不可无声裁切。

### 10.3 实现验收清单

- [ ] Windows 窗口不再显示原生标题/边框；三枚自绘窗口控制按钮真实可用。
- [ ] Logo 使用真实 `asset/Logo.png`，而非 clapperboard 替代品。
- [ ] Projects → Project → multiple Chats 的路径可恢复；开对象不会把用户困进无退出的页面。
- [ ] Project 侧栏只有 Chats / Canvases 与一个 project overflow；没有重复 Project Settings。
- [ ] Canvas node 是语义对象，候选位于节点内；不把图片/视频尝试拆成大量 provider-node。
- [ ] Canvas 拖动不影响 Sequence；Lane 是唯一可更改顺序的入口。
- [ ] Assets 支持角色/地点/世界/风格/媒体、跨项目 usage 和版本固定引用。
- [ ] Settings 的 Provider、budget、three authorization modes、Skill proposal 都有单一入口且有真实 authority。
- [ ] 费用、模式、Run 进度在 Chat/Canvas 可见；所有受保护操作在任何模式下仍会停下。
- [ ] 不出现 raw JSON、无可读标签的 ID、死路、贴边文字、默认系统滚动条或无状态 hover。
- [ ] 在 1024px 和 1440px 两个宽度下，无横向溢出、主要操作可访问、Chat/Canvas/Sequence/Inspector 都可达。

## 11. 参考图生成记录

三图均由内置 image generation 生成，仅作 implementation reference；每张都以 `asset/Logo.png` 作为品牌输入，真实产品应直接渲染原资产而非复绘 mockup 中的近似 logo。

| 文件                                       | 生成意图         | 核心提示摘要                                                                                         |
| ------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `lucid-fin-canvas-workspace-reference.png` | 16:10 主制作台   | Chat + Canvas + semantic Shot + Inspector 内候选网格 + 独立 Sequence Lane；强调不是 tool-node editor |
| `lucid-fin-global-assets-reference.png`    | 16:10 资产管理   | 角色/地点/世界/风格/媒体的跨项目资源库、版本与 usage Inspector                                       |
| `lucid-fin-settings-reference.png`         | 16:10 设置控制面 | Provider roles、Review every spend / Approve for me / Full auto、硬预算与保护说明                    |

生成使用的完整意图已内嵌在图像的 C2PA 元数据；本文件记录了图的用途和约束。图中的人物、项目名、价格和 provider 状态均为合成示例，绝不构成产品能力、成本或客户数据声明。
