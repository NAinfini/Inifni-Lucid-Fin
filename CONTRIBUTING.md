# Contributing to Lucid Fin

Lucid Fin is a canonical Electron desktop application for local AI-assisted video production. This
repository is the source of truth for the application, its contracts, storage model, runtime, and
built-in Skill catalog.

## Requirements

| Tool    | Required version            |
| ------- | --------------------------- |
| Node.js | `>=26.5.1`                  |
| pnpm    | `11.21.0` through `<12`     |
| Git     | A current supported release |

The Electron main process uses `keytar` for the new recovery-key boundary. If its native build cannot
be installed or rebuilt on your platform, install the platform's normal native build toolchain before
continuing.

The only configured model runtime is a local Ollama endpoint. For development, start Ollama and make
the default model available before launching the app:

```bash
ollama serve
ollama pull qwen3:8b
```

The production adapter accepts only unauthenticated loopback HTTP for Ollama. Do not add a cloud
provider, credential fallback, or hidden provider selection path without an approved product change.

## Install and run

```bash
git clone https://github.com/NAinfini/Inifni-Lucid-Fin.git
cd Inifni-Lucid-Fin
pnpm install --frozen-lockfile
pnpm run build
pnpm run dev
```

`pnpm-lock.yaml` is the exact dependency graph. Do not introduce another lockfile or edit generated
contract artifacts by hand.

## Canonical layout

```text
apps/
  desktop-main/       Electron entry, native adapters, trusted IPC host
  desktop-renderer/   React renderer using the typed desktop bridge
packages/
  contracts/          Schemas, public wire contract, generated built-in Skill catalog
  storage/            node:sqlite persistence, host authorities, durable confirmations
  runtime/            Durable Run execution and catalog freezing
  media-engine/       Local FFmpeg/ffprobe media operations
```

The dependency direction is deliberate:

```text
contracts → storage → runtime
contracts → media-engine
desktop-main → contracts, storage, runtime, media-engine
desktop-renderer → contracts
```

The renderer must cross the process boundary only through `@lucid-fin/contracts` and the generated
desktop API. It must not import storage, runtime, media-engine, Electron, filesystem, or keychain
implementation code.

## Product boundaries

- Storage uses Node's built-in `node:sqlite` API and owns the fresh `lucid-fin-v1` profile.
- `keytar` is limited to the canonical recovery-key account; code must not enumerate or inspect a
  person's existing keychain records.
- Ollama is the sole configured model provider. A failed local request fails explicitly; it is not
  retried through another provider.
- The checked-in catalog contains exactly 287 built-in Skills: 216 presets, 19 shot templates,
  26 renderer Skills, 21 process prompts, and 5 prompt templates.
- A user-requested Skill is drafted through `skill.propose`, then requires a durable exact
  confirmation before registration. The active root Run stays frozen; the next root Run sees the
  registered Skill.
- Keep runtime, source, emitted build, and packaged Electron entrypoints canonical. Run the
  production-closure check whenever those boundaries change.

## Quality checks

Run the smallest relevant check while developing, then run the required repository checks before
requesting review:

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

Use `pnpm run dist` to build and package for the current platform. The desktop package scripts also
provide `pack:win`, `pack:mac`, and `pack:linux` under `@lucid-fin/desktop-main`.

## Change discipline

- Keep changes focused and preserve unrelated work already present in the worktree.
- Update contracts, storage, runtime, renderer, and tests together when changing a typed behavior.
- Regenerate and verify the contract artifacts with `pnpm run lint:contracts` after changing their
  inputs.
- Do not bypass durable confirmations, rewrite a frozen Run catalog, or create a second production
  entrypoint.
- Target pull requests at `main` and describe the validation actually run.
