# Lucid Fin

[English](README.md)

Lucid Fin 是一款用于本地 AI 辅助视频制作的 Electron 桌面应用。当前开发版本只有一条正式
应用路径：类型化合同、`node:sqlite` 存储、可恢复的运行时、本地媒体处理，以及本地 Ollama
模型适配器。

## 功能

- 通过概览、画布、媒体、制作和交付五个工作区组织项目。
- 通过原生文件选择导入全局与项目媒体，以规范元数据保存，并通过不透明能力而非文件路径提供预览。
- 通过类型化 Electron 桥接运行可持久恢复的项目对话、根 Run 与子 Run。
- 使用 FFmpeg/ffprobe 在本地生成媒体派生物、审阅片和交付导出。
- 在规范存储中保存项目决策、结果状态、历史、保护控制和确认记录。
- 首次启动提供 287 个已签入的内置 Skill：216 个预设、19 个镜头模板、26 个渲染器
  Skill、21 个流程提示词和 5 个提示词模板。
- 用户可以直接要求 AI 新增 Skill；`skill.propose` 会先创建精确提案，必须经过持久化确认后
  才能注册，并从下一个根 Run 开始可见。

## 运行模型

```text
React 渲染器 → 类型化桌面协议 → Electron 主进程
                                  ├─ contracts
                                  ├─ storage（node:sqlite）
                                  ├─ runtime
                                  ├─ media-engine（FFmpeg/ffprobe）
                                  └─ 本地 Ollama 适配器
```

渲染器不能直接访问数据库、密钥链、文件系统、原始 Electron IPC 或模型地址。主进程拥有新的
`lucid-fin-v1` 配置目录、通过 `keytar` 管理的恢复密钥边界，以及本地媒体与导出适配器。

Ollama 是唯一配置的模型提供方。桌面应用仅接受无认证的回环 HTTP 地址，默认模型为
`qwen3:8b`；请求失败会明确报错，不会切换到云服务。

## 快速开始

要求：

- Node.js `>=26.5.1`
- pnpm `11.21.0` 且 `<12`
- 本地安装 Ollama，并可用 `qwen3:8b`

```bash
git clone https://github.com/NAinfini/Inifni-Lucid-Fin.git
cd Inifni-Lucid-Fin
pnpm install --frozen-lockfile

# 如果 Ollama 尚未运行，请在另一个终端执行
ollama serve
ollama pull qwen3:8b

pnpm run build
pnpm run dev
```

## 开发验证

```bash
pnpm run lint
pnpm run test:types
pnpm test
pnpm run build
pnpm run check:production-closure
pnpm run test:e2e
pnpm run format:check
pnpm run license:audit
```

使用 `pnpm run dist` 创建当前平台的软件包。打包完成后执行：

```bash
pnpm run check:production-closure -- --require-package
```

## 进一步阅读

- [产品合同](PRODUCT.md)
- [技术栈](docs/TECH_STACK.md)
- [贡献指南](CONTRIBUTING.md)
- [应用所有权](docs/architecture/application-ownership.md)
- [生产适配器边界](docs/architecture/production-adapters.md)
- [规范 Skill](docs/architecture/skills.md)

## 许可证

MIT，详见 [LICENSE](LICENSE)。
