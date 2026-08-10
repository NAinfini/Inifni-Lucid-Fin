<div align="center">

<!-- HERO BANNER -->
<img src="asset/光辉的鱼与蝶.png" alt="梦鱼 Lucid Fin" width="180">

<br>

# 梦鱼 Lucid Fin

### AI 驱动的影视制作桌面应用

_从剧本到镜头，从镜头到场景，从场景到影片 — 全程 AI 驱动。_

<p>
  <a href="#-功能特性">功能特性</a> &nbsp;&bull;&nbsp;
  <a href="#-截图">截图</a> &nbsp;&bull;&nbsp;
  <a href="#-架构">架构</a> &nbsp;&bull;&nbsp;
  <a href="docs/TECH_STACK.md">技术栈</a> &nbsp;&bull;&nbsp;
  <a href="#-快速开始">快速开始</a> &nbsp;&bull;&nbsp;
  <a href="README.md">English</a>
</p>

<p>
  <img src="https://img.shields.io/github/actions/workflow/status/NAinfini/Inifni-Lucid-Fin/ci.yml?branch=main&style=flat-square&label=CI" alt="CI">
  <img src="https://img.shields.io/github/stars/NAinfini/Inifni-Lucid-Fin?style=flat-square&color=f5c842" alt="Stars">
  <img src="https://img.shields.io/github/forks/NAinfini/Inifni-Lucid-Fin?style=flat-square" alt="Forks">
  <img src="https://img.shields.io/github/license/NAinfini/Inifni-Lucid-Fin?style=flat-square&color=red" alt="License">
  <img src="https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform">
</p>

<p>
  <img src="https://img.shields.io/badge/Electron-43.2.0-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/FFmpeg-8.1.2-007808?style=flat-square&logo=ffmpeg&logoColor=white" alt="FFmpeg">
  <img src="https://img.shields.io/badge/Node-%E2%89%A526.5.1-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node">
</p>

</div>

---

## 功能特性

<table>
  <tr>
    <td width="33%" valign="top">
      <h4>画布工作区</h4>
      <p>节点式可视化编辑器 — 图像、视频、音频、文本和背景板节点通过有向边连接。拖拽、连接、生成。</p>
    </td>
    <td width="33%" valign="top">
      <h4>梦鱼 AI</h4>
      <p>内置 AI 助手，拥有 170+ 个工具。拆解剧本、管理角色、应用预设、分析图像、生成媒体 — 全部通过对话完成。</p>
    </td>
    <td width="33%" valign="top">
      <h4>预设系统</h4>
      <p>8 类预设轨道（主体、风格、摄影机、灯光、色彩、情绪、构图、特效），支持每条目强度控制和多参数调节。</p>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h4>视频克隆模式</h4>
      <p>导入视频 &rarr; 自动检测场景切换 &rarr; 提取关键帧 &rarr; 视觉 AI 描述 &rarr; 生成可编辑 AI 分镜画布。</p>
    </td>
    <td width="33%" valign="top">
      <h4>视觉分析</h4>
      <p>从任意图像反向推理提示词。提取画风、灯光、色彩、情绪、构图 — 支持 15+ 家视觉 AI 提供方。</p>
    </td>
    <td width="33%" valign="top">
      <h4>情感向量 TTS</h4>
      <p>8 维情感控制（开心、悲伤、愤怒、恐惧、惊讶、厌恶、轻蔑、中性），为语音合成赋予丰富表现力。</p>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h4>剧本集成</h4>
      <p>导入 Fountain/FDX/纯文本剧本。自动拆解为镜头。转换为画布节点并关联角色、场景、装备。</p>
    </td>
    <td width="33%" valign="top">
      <h4>跨帧连续性</h4>
      <p>视频生成后自动提取最后一帧，设置为下一节点的首帧参考 — 实现视觉无缝过渡。</p>
    </td>
    <td width="33%" valign="top">
      <h4>专业导出</h4>
      <p>导出为 CapCut、FCPXML、EDL 格式。兼容 Final Cut Pro、DaVinci Resolve、Premiere Pro。</p>
    </td>
  </tr>
</table>

<details>
<summary><strong>更多功能...</strong></summary>

- **双提示词系统** — 每个节点支持独立的图像提示词和视频提示词
- **角色与装备管理** — 参考图、结构化外观字段，确保角色一致性
- **场景管理** — 结构化场景位置，含氛围、天气、灯光、参考图和节点使用追踪
- **口型同步** — 视频生成后自动口型同步，支持云端 API 和本地 Wav2Lip
- **自适应工具执行** — 基于成功率自动调节并发度（1-8 路并行调用）
- **上下文压缩** — 借鉴 Codex/Claude Code 的 handoff 式摘要，附带防循环保护
- **镜头模板** — 预定义镜头设置一键应用到多个节点
- **批量工具操作** — 大部分画布工具支持多节点批量执行
- **快照与回滚** — Time Machine 式分级保留，支持手动和自动快照
- **国际化** — 完整的中英文本地化

</details>

---

## 截图

> 截图待补充

<details open>
<summary><strong>画布工作区</strong></summary>
<br>
<img src="docs/assets/screenshot-canvas.png" alt="画布工作区" width="100%">
<em>节点式画布，包含图像/视频/音频节点、预设轨道和生成控制</em>
</details>

<details>
<summary><strong>梦鱼 AI</strong></summary>
<br>
<img src="docs/assets/screenshot-commander.png" alt="梦鱼 AI" width="100%">
<em>AI 助手，支持斜杠命令、工具调用、流式响应和上下文管理</em>
</details>

<details>
<summary><strong>预设系统</strong></summary>
<br>
<img src="docs/assets/screenshot-presets.png" alt="预设系统" width="100%">
<em>8 类预设轨道，带强度滑块和每条目参数控制</em>
</details>

<details>
<summary><strong>设置与提供方</strong></summary>
<br>
<img src="docs/assets/screenshot-settings.png" alt="设置" width="100%">
<em>多提供方配置：LLM、图像、视频、音频、视觉 AI</em>
</details>

---

## 支持的 AI 提供方

<table>
  <tr>
    <th>类别</th>
    <th>提供方</th>
  </tr>
  <tr>
    <td><strong>LLM</strong></td>
    <td>
      <img src="https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white" alt="OpenAI">
      <img src="https://img.shields.io/badge/Claude-CC785C?style=flat-square&logo=anthropic&logoColor=white" alt="Claude">
      <img src="https://img.shields.io/badge/Gemini-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini">
      <img src="https://img.shields.io/badge/DeepSeek-0A84FF?style=flat-square" alt="DeepSeek">
      <img src="https://img.shields.io/badge/Grok-000000?style=flat-square" alt="Grok">
      <img src="https://img.shields.io/badge/通义千问-FF6A00?style=flat-square" alt="Qwen">
      <img src="https://img.shields.io/badge/Mistral-FF7000?style=flat-square" alt="Mistral">
      <img src="https://img.shields.io/badge/Ollama-000000?style=flat-square" alt="Ollama">
      <br>
      <img src="https://img.shields.io/badge/OpenRouter-6366F1?style=flat-square" alt="OpenRouter">
      <img src="https://img.shields.io/badge/Together-FF4500?style=flat-square" alt="Together">
      <img src="https://img.shields.io/badge/Groq-F55036?style=flat-square" alt="Groq">
      <img src="https://img.shields.io/badge/硅基流动-00D4AA?style=flat-square" alt="SiliconFlow">
      <img src="https://img.shields.io/badge/月之暗面-7C3AED?style=flat-square" alt="Moonshot">
      <img src="https://img.shields.io/badge/智谱-2563EB?style=flat-square" alt="Zhipu">
      <img src="https://img.shields.io/badge/豆包-FF4D4F?style=flat-square" alt="Doubao">
      <img src="https://img.shields.io/badge/百川-1D4ED8?style=flat-square" alt="Baichuan">
      <img src="https://img.shields.io/badge/阶跃星辰-10B981?style=flat-square" alt="StepFun">
    </td>
  </tr>
  <tr>
    <td><strong>图像</strong></td>
    <td>ChatGPT 图像生成（OAuth）、OpenAI GPT Image 2、Google Gemini 3.1 Image、Recraft、Ideogram、Leonardo、智谱 GLM Image、阶跃星辰、火山引擎 Seedream、通义万象、xAI Imagine、BFL FLUX、Stability、Bria、百度千帆、Replicate、fal、Together AI、硅基流动、Krea、Higgsfield、Segmind、Freepik</td>
  </tr>
  <tr>
    <td><strong>视频</strong></td>
    <td>Google Gemini Omni Flash、Runway Gen-4.5、LTX 2.3、Luma Dream Machine、MiniMax H3、可灵、智谱 CogVideoX-3、生数 Vidu、火山引擎 Seedance、阿里 Wan 2.7、百度千帆、xAI Imagine、PixVerse V6、Replicate、fal、Together AI、硅基流动、Krea、Higgsfield、Segmind、Freepik、Seedance、混元视频</td>
  </tr>
  <tr>
    <td><strong>音频</strong></td>
    <td>ElevenLabs、MiniMax TTS、火山引擎 TTS、Azure TTS、Google Cloud TTS、OpenAI TTS</td>
  </tr>
  <tr>
    <td><strong>视觉</strong></td>
    <td>14 家已验证图像输入的提供方，包括 OpenAI、Gemini、Claude、通义千问、Grok、Mistral、智谱、Kimi、阶跃星辰以及可配置模型中心/本地模型</td>
  </tr>
</table>

默认模型、传输映射、官方资料和明确排除项见[媒体提供方与 API 矩阵](docs/MEDIA_PROVIDER_MATRIX.md)。
当前 LLM/视觉默认模型、上下文窗口、协议要求和迁移行为见[LLM 与视觉提供方矩阵](docs/LLM_PROVIDER_MATRIX.md)。

---

## 架构

```mermaid
graph TB
    subgraph Desktop["桌面应用 (Electron 43)"]
        subgraph Renderer["渲染进程 — React 19 + Vite 8"]
            UI["画布工作区<br/>检查器 &middot; 梦鱼 AI"]
            Store["Redux 状态管理<br/>18 个切片"]
        end

        subgraph Main["主进程"]
            IPC["IPC 路由"]
            Pipeline["生成管线"]
            Commander["梦鱼 AI<br/>170+ 个代理工具"]
        end

        UI <--> Store
        Store <-- "IPC 桥接" --> IPC
        IPC --> Pipeline
        IPC --> Commander
    end

    subgraph Packages["共享包"]
        Contracts["contracts<br/>类型 &middot; DTO &middot; IPC"]
        AppLayer["application<br/>编排器 &middot; 工具 &middot; 提示编译器"]
        Storage["storage<br/>SQLite &middot; CAS &middot; 钥匙串"]
        Adapters["adapters-ai<br/>提供方 SDK"]
        Domain["domain<br/>剧本解析 &middot; 级联"]
        Media["media-engine<br/>FFmpeg &middot; 导出"]
    end

    Commander --> AppLayer
    Pipeline --> Media
    AppLayer --> Storage
    AppLayer --> Adapters
    AppLayer --> Domain

    subgraph Providers["AI 提供方"]
        LLM["LLM<br/>19 家"]
        IMG["图像<br/>已验证目录"]
        VID["视频<br/>已验证目录"]
        AUD["音频<br/>6 家"]
        VIS["视觉<br/>14 家"]
    end

    Adapters --> LLM
    Adapters --> IMG
    Adapters --> VID
    Adapters --> AUD
    Adapters --> VIS
```

<details>
<summary><strong>目录结构</strong></summary>

```
apps/
  desktop-main/         Electron 主进程 — IPC、生成管线、梦鱼 AI
  desktop-renderer/     React + Vite 前端 — 画布、面板、Redux 状态管理

packages/
  contracts/            共享 TypeScript 类型、DTO、IPC 通道定义
  contracts-parse/      Zod 运行时校验 Schema
  shared-utils/         跨层共享的纯工具函数
  storage/              SQLite 数据库、内容寻址资产存储、系统钥匙串
  adapters-ai/          AI 提供方适配器（图像、视频、音频、LLM、视觉）
  application/          梦鱼 AI 编排器、170+ 个代理工具、提示编译器
  domain/               剧本解析器、提示组装器、级联逻辑
  media-engine/         FFmpeg 工具、Ken Burns 效果、拼接器、NLE 导出

evals/                  Commander 评估测试套件
.github/workflows/     CI 管线 — 每次 push/PR 自动类型检查、测试、代码规范
docs/                   AI 视频提示词指南、规划文档
```

</details>

---

## 快速开始

```bash
# 克隆
git clone https://github.com/NAinfini/Inifni-Lucid-Fin.git
cd Inifni-Lucid-Fin

# 安装依赖
pnpm install --frozen-lockfile

# 开发环境
pnpm run dev

# 运行测试
pnpm test

# 构建
pnpm run build
```

<details>
<summary><strong>环境要求</strong></summary>

| 要求     | 版本                    |
| -------- | ----------------------- |
| Node.js  | >= 26.5.1               |
| pnpm     | 11.21.0                 |
| FFmpeg   | 固定 8.1.2 LGPL 运行时  |
| 操作系统 | Windows / macOS / Linux |

</details>

完整版本矩阵、唯一事实源及 TypeScript 6.0.2 冻结策略见[技术栈文档](docs/TECH_STACK.md)。

<details>
<summary><strong>AI 提供方配置</strong></summary>

1. 打开 **设置**（齿轮图标）
2. 选择提供方标签：**LLM**、**图像**、**视频**、**音频** 或 **视觉**
3. API 提供方需输入 API 密钥并点击 **保存**；OAuth 提供方展开卡片后点击 **登录**，不会要求 API 密钥或密码
4. 将提供方设为当前使用
5. 添加自定义提供方：点击 **+ 添加自定义提供方**，输入名称、基础 URL 和模型

ChatGPT OAuth 可分别用于 Commander LLM、图像生成和备用视觉理解；Gemini OAuth 可分别用于
LLM、图像、视频和备用视觉理解，因此每项能力可以登录不同账号。提供方能返回额度时，OAuth
卡片会显示剩余用量；Gemini 无法可靠返回剩余额度时会链接到 Cloud 配额面板。当前 LLM 支持
图像理解时，Lucid Fin 会直接复用该 LLM，不再调用备用视觉提供方。详见
[OAuth 安全与路由契约](docs/PROVIDER_OAUTH.md)。

</details>

---

## CI / CD

每次 push 和 pull request 都会在 Node 26.5.1 与 pnpm 11.21.0 上通过 GitHub Actions 运行完整 CI 管线：

| 任务         | 内容                                                            |
| ------------ | --------------------------------------------------------------- |
| **类型检查** | `tsc --noEmit` — 检查 `contracts`、`application`、`adapters-ai` |
| **测试**     | `vitest run` — 运行所有单元测试和集成测试                       |
| **代码规范** | `eslint` — 零警告策略                                           |

详见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

---

## Star 趋势

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=NAinfini/Inifni-Lucid-Fin&type=Date)](https://star-history.com/#NAinfini/Inifni-Lucid-Fin&Date)

</div>

---

## 许可证

MIT — 详见 [LICENSE](LICENSE)。

---

<div align="center">

**为 AI 电影人倾力打造**

</div>
