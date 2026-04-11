# 梦鱼

**AI 驱动的影视制作桌面应用**

[English Documentation](README.md)

---

## 什么是梦鱼？

梦鱼是一款 AI 辅助影视制作桌面应用。它提供基于画布的工作流：你可以创建、连接和生成图像/视频/音频节点，每个节点代表一个镜头、场景或音频片段。内置 AI 助手（Commander AI）帮助你拆解剧本、管理角色和场景、应用电影预设，并通过多个 AI 提供方生成媒体。

## 功能

### 核心

- **画布工作区** — 节点式可视化编辑器，支持图像、视频、音频、文本和背景板节点，通过有向边连接
- **Commander AI** — 内置 AI 助手，拥有 170+ 个工具，覆盖画布操作、角色/装备/场景管理、预设应用、剧本拆解、视觉分析等
- **多提供方生成** — 支持 OpenAI、Google Imagen/Veo、Runway、Flux、Recraft、Stability、Luma、Pika、MiniMax、ElevenLabs，以及通过 OpenRouter 接入自定义 OpenAI 兼容提供方
- **预设系统** — 8 类预设轨道（主体、风格、摄影机、灯光、色彩、情绪、构图、特效），支持强度控制
- **角色与装备管理** — 创建角色并附带详细外观描述和参考图，确保视觉一致性
- **剧本集成** — 导入剧本（Fountain/FDX/纯文本），自动拆解为镜头，转换为画布节点
- **系列管理** — 将画布组织为剧集，适用于连续内容制作

### 视觉与分析

- **视觉提供方** — 独立的视觉 AI 提供方类别，支持 15+ 家提供方（OpenAI、Gemini、Claude、通义千问、Grok、Mistral、豆包、智谱 GLM、月之暗面/Kimi、阶跃星辰、DeepSeek、OpenRouter、SiliconFlow、Together AI、Ollama）
- **反向提示词推理** — 分析任意图像，提取可用于 AI 再生成的提示词，或结构化风格报告（画风、灯光、色彩、情绪、构图、摄影机、质感）
- **语义图像搜索** — 基于视觉描述的自然语言素材搜索，按相关度排序

### 视频制作

- **视频克隆模式** — 导入现有视频，FFmpeg 自动检测场景切换、提取关键帧，视觉 AI 描述每帧，生成一画布一节点的可编辑分镜 — 一键 AI 翻拍
- **跨帧连续性** — 视频生成完成后自动提取最后一帧，设置为下一节点的首帧参考，实现视觉无缝过渡
- **双提示词系统** — 每个节点支持独立的图像提示词和视频提示词（图像侧重构图细节，视频侧重运动描述）
- **口型同步** — 视频生成后自动运行口型同步后处理，支持云端 API 和本地 Wav2Lip

### 音频与语音

- **情感向量 TTS** — 8 维情感向量（开心、悲伤、愤怒、恐惧、惊讶、厌恶、轻蔑、中性），为音频节点赋予表现力
- **SRT 字幕导入** — 导入 SRT 字幕文件，在画布上创建对应的文本/音频节点
- **文案工具** — Commander AI 的剧本改写、标题生成、文本转换工具

### 导出与集成

- **CapCut 导出** — 将画布导出为 CapCut 兼容的草稿项目，包含正确的时间码和轨道布局
- **FCPXML 和 EDL 导出** — 专业非线性编辑导出，对接 Final Cut Pro、DaVinci Resolve、Premiere Pro

### 设置与数据

- **存储管理** — 可视化存储概览、快速文件夹访问、数据库备份/恢复、VACUUM 压缩、日志清理、语义索引清除、自定义项目存储路径
- **国际化** — 完整的中英文本地化
- **日志面板** — 实时应用日志，支持级别过滤，Commander AI 可访问用于自我调试

## 架构

```
apps/
  desktop-main/       Electron 主进程（IPC、生成管线、Commander AI 处理器）
  desktop-renderer/   React + Vite 前端（画布、面板、Redux 状态管理）

packages/
  contracts/          共享 TypeScript 类型、DTO、IPC 通道定义
  storage/            SQLite 数据库、内容寻址资产存储、系统钥匙串、提示模板
  adapters-ai/        AI 提供方适配器（图像、视频、音频、LLM）
  application/        Commander AI 编排器、170+ 个代理工具、提示编译器、工作流引擎
  domain/             剧本解析器、提示组装器、级联逻辑
  media-engine/       FFmpeg 工具、Ken Burns 效果、拼接器、NLE 导出、字幕、场景检测

e2e/                  Playwright 端到端测试
docs/                 AI 视频提示词指南（18 篇）、规划文档
```

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发环境（Electron + Vite）
npm run dev

# 构建生产版本
npm run build
```

## 环境要求

- Node.js 20+
- npm 10+
- Windows / macOS / Linux（Electron）
- FFmpeg（用于视频处理、场景检测、帧提取）

## AI 提供方配置

1. 打开 **设置**（齿轮图标或 `/settings`）
2. 选择提供方分组标签：**LLM**、**图像**、**视频**、**音频**、或 **视觉**
3. 输入 API 密钥并点击 **保存**
4. 将提供方设为当前使用
5. 添加自定义提供方（如 OpenRouter）：点击 **+ 添加自定义提供方**，输入名称、基础 URL 和模型

## 许可证

专有软件。版权所有。
