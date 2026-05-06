# Contributing to Lucid Fin

Thanks for your interest in contributing to **Lucid Fin** -- an AI-powered film production desktop app built with Electron, React, and TypeScript.

---

## Prerequisites

| Tool         | Version    | Notes                                                   |
| ------------ | ---------- | ------------------------------------------------------- |
| **Node.js**  | >= 22.12.0 | Required by `engines` in `package.json`                 |
| **npm**      | >= 10      | Ships with Node 22; used for workspace management       |
| **Git**      | any recent | Standard version control                                |
| **Python 3** | >= 3.10    | Only needed for `.trellis/` workflow scripts (optional) |

### Platform-specific requirements

- **Windows**: Visual Studio Build Tools (C++ workload) -- required by `better-sqlite3` and `keytar` native modules.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: `build-essential`, `python3`, `libsecret-1-dev` (for keytar).

### Optional runtime dependencies

- **FFmpeg 7+** -- required for video/audio processing features (`@lucid-fin/media-engine` wraps `fluent-ffmpeg`). Not needed for building or running tests.

---

## Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/NAinfini/Inifni-Lucid-Fin.git
cd Inifni-Lucid-Fin

# 2. Install dependencies (also runs postinstall: patch-package + electron-rebuild)
npm ci

# 3. Build all workspaces in dependency order
npm run build

# 4. Start the development app
npm run dev
```

`npm run dev` builds all packages, builds the renderer in dev mode, then launches Electron with the main process.

> **Note:** The `postinstall` script automatically rebuilds `better-sqlite3` for the Electron version. If you see native module errors, run `npm rebuild better-sqlite3` manually.

---

## Project Structure

This is an **npm workspaces** monorepo with two apps and eight packages.

```
lucid-fin/
  apps/
    desktop-main/          # Electron main process (IPC handlers, DB, AI adapters)
    desktop-renderer/      # React 19 + Vite 8 + Tailwind 4 + Redux Toolkit
  packages/
    contracts/             # Type-only shared types (zero runtime, no zod)
    contracts-parse/       # Zod schemas for runtime validation of contracts
    shared-utils/          # Pure utility functions shared across layers
    domain/                # Domain models and business logic
    application/           # Application services (orchestrator, tools, workflows)
    storage/               # SQLite persistence (better-sqlite3) + keytar secrets
    adapters-ai/           # AI provider adapters (LLM, vision, TTS, image-gen)
    media-engine/          # FFmpeg-based video/audio processing
  scripts/                 # Repo-level tooling (codegen, lint checks, coverage ratchet)
  evals/                   # Commander evaluation harness (not linted)
  .trellis/                # Workflow tracking and dev specs
```

### Dependency graph (simplified)

```
contracts  (type-only, no deps)
  +-- shared-utils
  +-- contracts-parse  (+ zod)
  +-- domain
  +-- adapters-ai      (+ zod)
  +-- media-engine
  +-- storage           (+ better-sqlite3, zod)
        +-- application (+ zod, depends on storage, adapters-ai, shared-utils)

desktop-main   --> application, storage, adapters-ai, media-engine, contracts-parse
desktop-renderer --> contracts only (no zod in renderer bundle)
```

**Key architectural rule:** The renderer must _never_ import from `@lucid-fin/contracts-parse` or `@lucid-fin/application` -- this is enforced by ESLint.

---

## Development Workflow

### Branch naming

- `feature/<name>` -- new features
- `fix/<name>` -- bug fixes
- `docs/<name>` -- documentation only
- `refactor/<name>` -- refactoring without behavior change

### Commit convention

```
type(scope): description
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
**Scope:** package or app name, e.g. `contracts`, `desktop-renderer`, `storage`

Examples from the repo:

```
feat(desktop-renderer): canvas polish, commander todo snapshot, entity detail panels
fix: production hardening v0.0.7 -- security audit fixes, test repairs
chore: test cleanup, lint fixes, and version bump to 0.0.6
```

### Pull requests

- Target `main` branch.
- CI must pass (build, typecheck, test, lint).
- Keep PRs focused -- one concern per PR.

---

## Running Quality Checks

### Tests

```bash
# Run all tests
npm test

# Run tests with verbose output (matches CI)
npx vitest run --reporter=verbose

# Run tests in watch mode (during development)
npx vitest

# Run coverage report
npm run test:coverage
```

Tests use **Vitest 4** with `vmForks` pool. The `pretest` script automatically rebuilds `better-sqlite3`.

### Lint

```bash
# Run full lint (ESLint + contract drift check)
npm run lint

# ESLint only
npx eslint .

# Contract drift only
npm run lint:contracts
```

ESLint 10 is configured at the repo root (`eslint.config.js`) with `typescript-eslint` and `react-hooks` plugin.

### Type check

```bash
# Type check specific packages (matches CI)
npx tsc --noEmit -p packages/contracts/tsconfig.json
npx tsc --noEmit -p packages/application/tsconfig.json
npx tsc --noEmit -p packages/adapters-ai/tsconfig.json
```

All packages extend `tsconfig.base.json` which targets **ES2022** with strict mode.

### Format

```bash
# Format all files
npm run format

# Check formatting without writing
npm run format:check
```

Prettier config (`.prettierrc.json`): 100 char width, single quotes, semicolons, trailing commas.

### IPC drift checks

```bash
npm run check:ipc-drift
```

Verifies that the preload bridge, migration allowlist, and generated preload code are in sync.

---

## Build and Package

```bash
# Full production build (all workspaces in order)
npm run build

# Package distributable for current platform
npm run dist

# Platform-specific packaging
npm run pack:win --workspace=apps/desktop-main
npm run pack:mac --workspace=apps/desktop-main
npm run pack:linux --workspace=apps/desktop-main
```

The build order matters because packages have inter-dependencies. The root `build` script handles the correct sequence.

---

## CI Pipeline

CI runs on **GitHub Actions** (`windows-latest`, Node 22) for pushes to `main`, `dev`, and `feature/**` branches.

Steps:

1. `npm ci` + `npm rebuild better-sqlite3`
2. `npm run build` -- full workspace build
3. Type check (`tsc --noEmit` on key packages)
4. `npx vitest run --reporter=verbose`
5. `npx eslint . --max-warnings=0`

All checks must pass before merging.

---

## Common Issues and Troubleshooting

### `better-sqlite3` native module errors

The native module must be compiled for the Electron version, not your system Node. Fix:

```bash
npm rebuild better-sqlite3
# or the full rebuild:
npx @electron/rebuild -f -w better-sqlite3 -v 41.2.0
```

### `npm install` fails with native compilation errors

Ensure you have the C++ build toolchain installed for your platform (see Prerequisites above).

### TypeScript build errors after pulling new changes

Packages must be built in dependency order. Run:

```bash
npm run build
```

This builds all workspaces in the correct sequence.

### Tests fail with "Cannot find module" errors

If packages have been modified, ensure they are rebuilt first:

```bash
npm run build && npm test
```

### Renderer imports from `contracts-parse` -- ESLint error

This is intentional. The renderer must only import types from `@lucid-fin/contracts`. Runtime schemas (zod) belong in `@lucid-fin/contracts-parse` and must stay out of the renderer bundle.

---

## Development Specs

Detailed development guidelines live in `.trellis/spec/`:

- **Frontend:** `.trellis/spec/frontend/index.md` -- component patterns, hooks, state management, type safety
- **Backend:** `.trellis/spec/backend/index.md` -- database, logging, type safety
- **Guides:** `.trellis/spec/guides/` -- cross-layer thinking guide

Read the relevant spec docs before making changes to unfamiliar areas.

---

## Code Style Summary

- **TypeScript strict mode** everywhere
- **Named exports** only (no default exports)
- **Tailwind CSS** for all styling (no inline styles, no CSS modules)
- **`cn()`** helper for class merging (`clsx` + `tailwind-merge`)
- **Radix UI** for accessible primitives
- **`cva`** (class-variance-authority) for component variants
- **Redux Toolkit** for state management in the renderer
- Prettier enforces formatting -- run `npm run format` before committing
