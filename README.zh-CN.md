# 梦鱼

**AI 驱动的影视制作桌面应用**

[English Documentation](README.md)

---

## 什么是梦鱼？

梦鱼是一款 AI 辅助影视制作桌面应用。它提供基于画布的工作流：你可以创建、连接和生成图像/视频/音频节点，每个节点代表一个镜头、场景或音频片段。内置 AI 助手（Commander AI）帮助你拆解剧本、管理角色和场景、应用电影预设，并通过多个 AI 提供方生成媒体。

## 功能

- **画布工作区** — 节点式可视化编辑器，支持图像、视频、音频、文本和背景板节点，通过有向边连接
- **Commander AI** — 内置 AI 助手，拥有 161 个工具，覆盖画布操作、角色/装备/场景管理、预设应用、剧本拆解等
- **多提供方生成** — 支持 OpenAI、Google Imagen/Veo、Runway、Flux、Recraft、Stability、Luma、Pika、MiniMax、ElevenLabs，以及通过 OpenRouter 接入自定义 OpenAI 兼容提供方
- **预设系统** — 8 类预设轨道（主体、风格、摄影机、灯光、色彩、情绪、构图、特效），支持强度控制
- **角色与装备管理** — 创建角色并附带详细外观描述和参考图，确保视觉一致性
- **剧本集成** — 导入剧本（Fountain/FDX/纯文本），自动拆解为镜头，转换为画布节点
- **系列管理** — 将画布组织为剧集，适用于连续内容制作
- **日志面板** — 实时应用日志，支持级别过滤，Commander AI 可访问用于自我调试
- **国际化** — 完整的中英文本地化
- **导出** — FCPXML 和 EDL 导出，对接专业非线性编辑软件

## 架构

```
apps/
  desktop-main/       Electron 主进程（IPC、生成管线、Commander AI 处理器）
  desktop-renderer/   React + Vite 前端（画布、面板、Redux 状态管理）

packages/
  contracts/          共享 TypeScript 类型、DTO、IPC 通道定义
  storage/            SQLite 数据库、内容寻址资产存储、系统钥匙串、提示模板
  adapters-ai/        AI 提供方适配器（图像、视频、音频、LLM）
  application/        Commander AI 编排器、161 个代理工具、提示编译器、工作流引擎
  domain/             剧本解析器、提示组装器、级联逻辑
  media-engine/       FFmpeg 工具、Ken Burns 效果、拼接器、NLE 导出、字幕

e2e/                  Playwright 端到端测试
docs/                 AI 视频提示词指南、规划文档
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

## AI 提供方配置

1. 打开 **设置**（齿轮图标或 `/settings`）
2. 展开提供方分组（LLM、图像、视频、音频）
3. 输入 API 密钥并点击 **保存**
4. 将提供方设为当前使用
5. 添加自定义提供方（如 OpenRouter）：点击 **+ 添加自定义提供方**，输入名称、基础 URL 和模型

## 许可证

专有软件。版权所有。
