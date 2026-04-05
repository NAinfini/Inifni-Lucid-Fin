# Lucid Fin

**AI-Powered Film Production Desktop App**

[中文文档](README.zh-CN.md)

---

## What is Lucid Fin?

Lucid Fin is a desktop application for AI-assisted film production. It provides a canvas-based workflow where you create, connect, and generate image/video/audio nodes — each representing a shot, scene, or audio clip. An AI assistant (Commander AI) helps you break down scripts, manage characters and locations, apply cinematic presets, and generate media through multiple AI providers.

## Features

- **Canvas Workspace** — Node-based visual editor with image, video, audio, text, and backdrop nodes connected by directional edges
- **Commander AI** — Built-in AI assistant with 161 tools for canvas manipulation, character/equipment/location management, preset application, script breakdown, and more
- **Multi-Provider Generation** — Connect to OpenAI, Google Imagen/Veo, Runway, Flux, Recraft, Stability, Luma, Pika, MiniMax, ElevenLabs, and custom OpenAI-compatible providers via OpenRouter
- **Preset System** — 8-category preset tracks (subject, style, camera, lighting, color, mood, composition, effects) with intensity control
- **Character & Equipment Manager** — Create characters with detailed appearance descriptions and reference images for visual consistency
- **Script Integration** — Import screenplays (Fountain/FDX/plaintext), auto-breakdown into shots, and convert to canvas nodes
- **Series Management** — Organize canvases into episodes for episodic content
- **Logger Panel** — Real-time application logs with level filtering and Commander AI access for self-debugging
- **i18n** — Full Chinese and English localization
- **Export** — FCPXML and EDL export for professional NLE workflows

## Architecture

```
apps/
  desktop-main/       Electron main process (IPC, generation pipeline, Commander AI handler)
  desktop-renderer/   React + Vite frontend (canvas, panels, Redux store)

packages/
  contracts/          Shared TypeScript types, DTOs, IPC channel definitions
  storage/            SQLite database, content-addressable asset store, OS keychain, prompt templates
  adapters-ai/        AI provider adapters (image, video, audio, LLM)
  application/        Commander AI orchestrator, 161 agent tools, prompt compiler, workflow engine
  domain/             Script parser, prompt assembler, cascade logic
  media-engine/       FFmpeg utilities, Ken Burns, stitcher, NLE export, subtitles

e2e/                  Playwright end-to-end tests
docs/                 AI video prompt guide, planning docs
```

## Quick Start

```bash
# Install dependencies
npm install

# Start development (Electron + Vite)
npm run dev

# Build for production
npm run build
```

## Requirements

- Node.js 20+
- npm 10+
- Windows / macOS / Linux (Electron)

## AI Provider Setup

1. Open **Settings** (gear icon or `/settings`)
2. Expand a provider group (LLM, Image, Video, Audio)
3. Enter your API key and click **Save**
4. Set the provider as active
5. For custom providers (e.g. OpenRouter), click **+ Add Custom Provider**, enter name, base URL, and model

## License

Proprietary. All rights reserved.
