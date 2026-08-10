# Contributing to Lucid Fin

Thanks for your interest in contributing to **Lucid Fin** -- an AI-powered film production desktop app built with Electron, React, and TypeScript.

The canonical version matrix and upgrade policy live in [docs/TECH_STACK.md](docs/TECH_STACK.md).

---

## Prerequisites

| Tool         | Version    | Notes                                                   |
| ------------ | ---------- | ------------------------------------------------------- |
| **Node.js**  | >= 26.5.1  | Required by `engines` in `package.json`                 |
| **pnpm**     | 11.21.0    | Canonical workspace package manager                     |
| **Git**      | any recent | Standard version control                                |

### Platform-specific requirements

- **Windows**: Visual Studio Build Tools (C++ workload) -- required by `better-sqlite3` and `keytar` native modules.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: `build-essential`, `python3`, `libsecret-1-dev` (for keytar).

### Optional runtime dependencies

- **FFmpeg 8.1.2 LGPL runtime** -- pinned and verified for video/audio processing. Local binaries can be restored with `node scripts/fetch-ffmpeg.ts`; they are not needed for ordinary builds or unit tests.

---

## Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/NAinfini/Inifni-Lucid-Fin.git
cd Inifni-Lucid-Fin

# 2. Install dependencies from the canonical lock file
pnpm install --frozen-lockfile

# 3. Build all workspaces in dependency order
pnpm run build

# 4. Start the development app
pnpm run dev
```

`pnpm run dev` builds all packages, builds the renderer in dev mode, then launches Electron with the main process.

> **Note:** The `postinstall` script verifies `better-sqlite3` against the installed Electron version. If the Electron ABI is stale, run `pnpm run predev`; Node test scripts perform their own Node ABI check.

`pnpm-workspace.yaml` controls native/package build scripts through `allowBuilds`: it permits `better-sqlite3`, `keytar`, `electron-winstaller`, and the `esbuild` binary used by `tsx`, while blocking Electron's installer in favor of the repository's verified installer. Review and pin any future addition; never use a blanket script approval.

---

## Project Structure

This is a **pnpm workspace** monorepo with two apps and ten packages. `pnpm-lock.yaml` is the only install/CI source of truth; `package-lock.json` must not be reintroduced.

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
    workflows/             # Persisted production workflow execution
    agent/                 # Commander planning, tools, grading, and repair loop
  scripts/                 # Repo-level tooling (codegen, lint checks, coverage ratchet)
  evals/                   # Commander evaluation harness (not linted)
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
        +-- workflows
              +-- agent
                    +-- application (+ zod; also uses storage, adapters-ai, shared-utils)

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
pnpm test

# Run tests with verbose output (matches CI)
pnpm exec vitest run --reporter=verbose

# Run tests in watch mode (during development)
pnpm exec vitest

# Run the critical coverage gate
pnpm run test:coverage:critical

# Compile the dedicated type-contract tests
pnpm run test:types

# Run machine-sensitive performance tests (kept out of the default lane)
pnpm run test:perf

# Run the built Electron smoke tests
pnpm run test:e2e
```

Tests use **Vitest 4** with the `vmForks` pool. The default lane excludes `*.perf.test.ts`
benchmarks and `tests/types`; run those through `test:perf` and `test:types`. The `pretest`
script probes `better-sqlite3` in the target runtime and rebuilds it only when incompatible.

### Lint

```bash
# Run full lint (ESLint + contract drift check)
pnpm run lint

# ESLint only
pnpm exec eslint .

# Contract drift only
pnpm run lint:contracts
```

ESLint 10 is configured at the repo root (`eslint.config.js`) with `typescript-eslint` and `react-hooks` plugin.

### Type check

```bash
# Type check specific packages (matches CI)
pnpm exec tsc --noEmit -p packages/contracts/tsconfig.json
pnpm exec tsc --noEmit -p packages/application/tsconfig.json
pnpm exec tsc --noEmit -p packages/adapters-ai/tsconfig.json
pnpm run test:types
```

All packages extend `tsconfig.base.json` which targets **ES2022** with strict mode.

### Format

```bash
# Format all files
pnpm run format

# Check formatting without writing
pnpm run format:check
```

Prettier config (`.prettierrc.json`): 100 char width, single quotes, semicolons, trailing commas.

### IPC drift checks

```bash
pnpm run check:ipc-drift
```

Verifies that the preload bridge, migration allowlist, and generated preload code are in sync.

---

## Build and Package

```bash
# Full production build (all workspaces in order)
pnpm run build

# Package distributable for current platform
pnpm run dist

# Platform-specific packaging
pnpm --filter ./apps/desktop-main run pack:win
pnpm --filter ./apps/desktop-main run pack:mac
pnpm --filter ./apps/desktop-main run pack:linux
```

The build order matters because packages have inter-dependencies. The root `build` script handles the correct sequence.

---

## CI Pipeline

CI runs on **GitHub Actions** (`windows-latest`, Node 26.5.1, pnpm 11.21.0) for pushes to `main`, `dev`, and `feature/**` branches.

Steps:

1. `pnpm install --frozen-lockfile`
2. `pnpm run build` -- full workspace build
3. Type check (`tsc --noEmit` on key packages plus `pnpm run test:types`)
4. `pnpm test -- --reporter=verbose` (the native ABI pretest rebuilds only if needed)
5. `pnpm exec eslint . --max-warnings=0`

All checks must pass before merging.

---

## Common Issues and Troubleshooting

### `better-sqlite3` native module errors

The native module must match the active runtime ABI. For the Electron app, run:

```bash
pnpm run predev
```

### `pnpm install` fails with native compilation errors

Ensure you have the C++ build toolchain installed for your platform (see Prerequisites above).

### TypeScript build errors after pulling new changes

Packages must be built in dependency order. Run:

```bash
pnpm run build
```

This builds all workspaces in the correct sequence.

### Tests fail with "Cannot find module" errors

If packages have been modified, ensure they are rebuilt first:

```bash
pnpm run build && pnpm test
```

### Renderer imports from `contracts-parse` -- ESLint error

This is intentional. The renderer must only import types from `@lucid-fin/contracts`. Runtime schemas (zod) belong in `@lucid-fin/contracts-parse` and must stay out of the renderer bundle.

---

## Code Style Summary

- **TypeScript strict mode** everywhere
- **Named exports** only (no default exports)
- **Tailwind CSS** for all styling (no inline styles, no CSS modules)
- **`cn()`** helper for class merging (`clsx` + `tailwind-merge`)
- **Radix UI** for accessible primitives
- **`cva`** (class-variance-authority) for component variants
- **Redux Toolkit** for state management in the renderer
- Prettier enforces formatting -- run `pnpm run format` before committing
