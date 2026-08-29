# Lucid Fin

[简体中文](README.zh-CN.md)

Lucid Fin is an Electron desktop application for local AI-assisted video production. The current
development build has one canonical application path: typed contracts, `node:sqlite` storage, durable
runtime execution, local media processing, and a local Ollama model adapter.

## What it does

- Organizes projects across overview, canvas, media, production, and delivery workspaces.
- Imports global and project media through native file selection, stores canonical media metadata, and
  serves previews through opaque capabilities rather than filesystem paths.
- Runs durable project conversations and root/child Run workflows through a typed Electron bridge.
- Creates local media derivations, review cuts, and delivery exports with FFmpeg/ffprobe.
- Keeps project decisions, result state, history, protection controls, and confirmations in canonical
  storage.
- Provisions 287 checked-in built-in Skills, including the repository's presets, shot templates,
  renderer Skills, process prompts, and prompt templates.
- Lets a user ask for a new Skill through `skill.propose`; an exact durable confirmation is required
  before it is registered, and it becomes available to the next root Run.

## Runtime model

The production composition uses the following boundaries:

```text
React renderer → typed desktop wire → Electron main process
                                      ├─ contracts
                                      ├─ storage (node:sqlite)
                                      ├─ runtime
                                      ├─ media-engine (FFmpeg/ffprobe)
                                      └─ local Ollama adapter
```

The renderer does not access the database, keychain, filesystem, raw Electron IPC, or model endpoint
directly. The main process owns the fresh `lucid-fin-v1` profile, the recovery-key boundary through
`keytar`, and the native media/export adapters.

Ollama is the only configured model provider. The desktop app accepts only an unauthenticated loopback
HTTP endpoint and starts with `qwen3:8b`; it does not select or fall back to a cloud provider.

## Quick start

Requirements:

- Node.js `>=26.5.1`
- pnpm `11.21.0` through `<12`
- A local Ollama installation with `qwen3:8b` available

```bash
git clone https://github.com/NAinfini/Inifni-Lucid-Fin.git
cd Inifni-Lucid-Fin
pnpm install --frozen-lockfile

# In another terminal, if Ollama is not already running
ollama serve
ollama pull qwen3:8b

pnpm run build
pnpm run dev
```

## Development checks

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

Use `pnpm run dist` to create a current-platform package. After packaging, run:

```bash
pnpm run check:production-closure -- --require-package
```

## Further reading

- [Contributing guide](CONTRIBUTING.md)
- [Current goal and cross-PC handoff](docs/goal.md)
- [Product redesign master plan](docs/plans/2026-08-29-lucid-fin-product-redesign-master-plan.md)
- [Current versus historical capability matrix](docs/plans/2026-08-29-current-vs-historical-capability-matrix.md)
- [Target authority map](docs/architecture/target-authorities.md)
- [Desktop design specification](docs/design/2026-08-28-canvas-first-desktop-redesign.md)
- [Planning worktree ledger](docs/validation/2026-08-29-planning-worktree-ledger.md)

## License

MIT — see [LICENSE](LICENSE).
