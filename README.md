# Lucid Fin

**AI-Powered Film Production Desktop App**

[中文文档](README.zh-CN.md)

---

## What is Lucid Fin?

Lucid Fin is a desktop application for AI-assisted film production. It provides a canvas-based workflow where you create, connect, and generate image/video/audio nodes — each representing a shot, scene, or audio clip. An AI assistant (Commander AI) helps you break down scripts, manage characters and locations, apply cinematic presets, and generate media through multiple AI providers.

## Features

### Core

- **Canvas Workspace** — Node-based visual editor with image, video, audio, text, and backdrop nodes connected by directional edges
- **Commander AI** — Built-in AI assistant with 170+ tools for canvas manipulation, character/equipment/location management, preset application, script breakdown, vision analysis, and more
- **Multi-Provider Generation** — Connect to OpenAI, Google Imagen/Veo, Runway, Flux, Recraft, Stability, Luma, Pika, MiniMax, ElevenLabs, and custom OpenAI-compatible providers via OpenRouter
- **Preset System** — 8-category preset tracks (subject, style, camera, lighting, color, mood, composition, effects) with intensity control
- **Character & Equipment Manager** — Create characters with detailed appearance descriptions and reference images for visual consistency
- **Script Integration** — Import screenplays (Fountain/FDX/plaintext), auto-breakdown into shots, and convert to canvas nodes
- **Series Management** — Organize canvases into episodes for episodic content

### Vision & Analysis

- **Vision Provider Support** — Dedicated vision AI provider category supporting 15+ providers (OpenAI, Gemini, Claude, Qwen, Grok, Mistral, Doubao, Zhipu GLM, Moonshot/Kimi, StepFun, DeepSeek, OpenRouter, SiliconFlow, Together AI, Ollama)
- **Reverse Prompt Inference** — Analyze any image to extract a generation-ready AI prompt or structured style breakdown (art style, lighting, color palette, mood, composition, camera, texture)
- **Semantic Image Search** — Find assets by natural language description using vision-based embeddings with relevance scoring

### Video Production

- **Video Clone Mode** — Import an existing video, auto-detect scene cuts via FFmpeg, extract keyframes, describe each with vision AI, and build a new canvas with one node per scene — ready for AI-powered remake
- **Cross-Frame Continuity** — Automatically extract the last frame of a completed video and set it as the first frame of the next node for seamless visual transitions
- **Dual Prompt System** — Separate image and video prompts on each node for optimized generation (static composition detail for images, motion verbs for video)
- **Lip Sync** — Post-generation lip-sync processing using cloud API or local Wav2Lip, driven by connected audio nodes

### Audio & Voice

- **Emotion Vector TTS** — 8-dimensional emotion vector (happy, sad, angry, fearful, surprised, disgusted, contemptuous, neutral) on audio nodes for expressive speech synthesis
- **SRT Import** — Import SRT subtitle files to create timed text/audio nodes on the canvas
- **Copywriting Tools** — Commander AI tools for script rewriting, headline generation, and text transformation

### Export & Integration

- **CapCut Export** — Export canvas as a CapCut-compatible draft project with proper timecodes and track layout
- **FCPXML & EDL Export** — Professional NLE workflow export for Final Cut Pro, DaVinci Resolve, Premiere Pro

### Settings & Data

- **Storage Management** — Visual storage overview, quick folder access, database backup/restore, VACUUM compaction, log cleanup, semantic index clearing, customizable project storage path
- **i18n** — Full Chinese and English localization
- **Logger Panel** — Real-time application logs with level filtering and Commander AI access for self-debugging

## Architecture

```
apps/
  desktop-main/       Electron main process (IPC, generation pipeline, Commander AI handler)
  desktop-renderer/   React + Vite frontend (canvas, panels, Redux store)

packages/
  contracts/          Shared TypeScript types, DTOs, IPC channel definitions
  storage/            SQLite database, content-addressable asset store, OS keychain, prompt templates
  adapters-ai/        AI provider adapters (image, video, audio, LLM)
  application/        Commander AI orchestrator, 170+ agent tools, prompt compiler, workflow engine
  domain/             Script parser, prompt assembler, cascade logic
  media-engine/       FFmpeg utilities, Ken Burns, stitcher, NLE export, subtitles, scene detection

e2e/                  Playwright end-to-end tests
docs/                 AI video prompt guide (18 guides), planning docs
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
- FFmpeg (for video processing, scene detection, frame extraction)

## AI Provider Setup

1. Open **Settings** (gear icon or `/settings`)
2. Select a provider group tab: **LLM**, **Image**, **Video**, **Audio**, or **Vision**
3. Enter your API key and click **Save**
4. Set the provider as active
5. For custom providers (e.g. OpenRouter), click **+ Add Custom Provider**, enter name, base URL, and model

## License

Proprietary. All rights reserved.
