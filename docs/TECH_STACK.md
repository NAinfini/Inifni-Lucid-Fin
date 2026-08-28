# Technology stack

This document describes the current canonical development and production baseline. Package manifests
define direct dependencies; `pnpm-lock.yaml` is the exact resolved graph.

## Source of truth

- Root `package.json`: Node, pnpm, repository commands, and shared developer tooling.
- Workspace `package.json` files: application and package dependencies.
- `pnpm-lock.yaml`: reproducible installation input.
- `packages/contracts`: typed public wire contract and generated built-in Skill catalog.
- `packages/storage`: canonical durable state and host authorities.
- `packages/runtime`: durable Run execution.
- `apps/desktop-main`: Electron composition and concrete local adapters.

## Runtime and tooling

| Area                   | Current technology                                                           |
| ---------------------- | ---------------------------------------------------------------------------- |
| Runtime                | Node.js `>=26.5.1`, pnpm `11.21.0` through `<12`                             |
| Desktop shell          | Electron `43.2.0`, electron-builder `26.15.3`                                |
| Language               | TypeScript `6.0.2`                                                           |
| Renderer               | React `19.2.8`, React Router `7.18.2`, Vite `8.2.0`, local CSS, Lucide icons |
| Tests                  | Vitest `4.1.10`, Playwright `1.62.1`                                         |
| Static analysis        | ESLint `10.8.0`, typescript-eslint, Prettier `3.9.6`                         |
| Schema validation      | Zod `4.4.3`                                                                  |
| Persistence            | Node built-in `node:sqlite` (`DatabaseSync`)                                 |
| Native secret boundary | keytar `7.9.0` for the canonical recovery key                                |
| Local model runtime    | Ollama at an unauthenticated loopback HTTP endpoint; default `qwen3:8b`      |
| Local media            | `fluent-ffmpeg` `2.1.3` with verified FFmpeg/ffprobe payloads                |

There is no hosted model-provider runtime in the production composition. Ollama is resolved as the
exact local provider and a failed request is reported rather than routed elsewhere.

## Canonical packages

```text
@lucid-fin/contracts
  Public schemas, generated desktop API, wire definitions, canonical Skill catalog

@lucid-fin/storage
  node:sqlite database, CAS metadata, durable confirmation and host authorities

@lucid-fin/runtime
  Durable root/child Run execution and frozen catalog views

@lucid-fin/media-engine
  FFmpeg/ffprobe inspection, derivation, review rendering, and local delivery support
```

The Electron main process depends on these four packages. The renderer depends on contracts only at
the workspace boundary.

## Built-in Skills

The checked-in generated catalog contains exactly 287 built-in Skills:

| Source class     |   Count |
| ---------------- | ------: |
| Presets          |     216 |
| Shot templates   |      19 |
| Renderer Skills  |      26 |
| Process prompts  |      21 |
| Prompt templates |       5 |
| **Total**        | **287** |

The catalog is provisioned into a fresh profile. User-requested additions follow `skill.propose`, a
durable exact confirmation, atomic registration, and visibility to the next root Run only.

## Commands

```bash
# Install exactly what the lockfile specifies
pnpm install --frozen-lockfile

# Build and run
pnpm run build
pnpm run dev

# Validate source, build, and package closure
pnpm run check:production-closure
pnpm run check:production-closure -- --require-package

# Quality checks
pnpm run test:types
pnpm test
pnpm run test:e2e
pnpm run lint
pnpm run format:check
pnpm run license:audit

# Current-platform package
pnpm run dist
```

`pnpm run lint:contracts` validates the generated contract artifacts. The release workflow rebuilds
the native `keytar` module for Electron and restores verified FFmpeg payloads before packaging.

## Upgrade policy

1. Change a direct dependency in its owning manifest and refresh `pnpm-lock.yaml` deliberately.
2. Keep Node, Electron, `keytar`, and the packaged native runtime compatible; validate a real package
   with `pnpm run check:production-closure -- --require-package`.
3. Preserve the typed contracts and one-way renderer boundary when changing runtime behavior.
4. Run the commands above and record the results with the change.

Historical material is retained only under `docs/archive/`; it is not a current technology baseline.
