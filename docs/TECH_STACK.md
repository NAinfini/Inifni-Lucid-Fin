# Technology Stack / 技术栈

Snapshot date: **2026-08-10**. This file documents the supported development, runtime, media, and CI baseline. Exact dependency ranges live in the workspace `package.json` files; exact resolved versions live in the canonical `pnpm-lock.yaml`.

快照日期：**2026-08-10**。本文件记录受支持的开发、运行、媒体与 CI 基线；各 workspace 的 `package.json` 定义直接依赖范围，`pnpm-lock.yaml` 记录精确解析版本。

## Canonical sources / 唯一事实源

- **Package manager:** pnpm 11.21.0, declared by the root `packageManager` field.
- **Install and CI lock:** `pnpm-lock.yaml`. Use `pnpm install --frozen-lockfile` for reproducible installs.
- **Removed legacy lock:** `package-lock.json` has been deleted; do not regenerate or reintroduce it.
- **Runtime engines:** the root `engines` field and GitHub Actions workflows.
- **FFmpeg payloads:** `packages/media-engine/ffmpeg-checksums.json` and `resources/bin/README.md`.
- **Provider OAuth:** `docs/PROVIDER_OAUTH.md`; ChatGPT capability isolation, safe status, usage reporting, visual routing, and Codex native packaging must be upgraded together.
- **Media provider runtime:** `docs/MEDIA_PROVIDER_MATRIX.md`; the shared provider catalog is the source of truth for Settings, adapters, credentials, and host allowlisting.
- **LLM and vision runtime:** `docs/LLM_PROVIDER_MATRIX.md`; `packages/contracts/src/llm-provider.ts` is the executable source of truth for model IDs, protocols, and context windows.
- **Image/video prompt authority:** `docs/PROMPT_ASSEMBLY.md`; `prompt_assemblies` persists the exact Commander input/output lineage, while provider, resolution, references, budget, retries, and approvals remain host-owned.
- **TypeScript exception:** every workspace remains on TypeScript 6.0.2 by product decision. Do not update its range or resolved version while upgrading other dependencies.
- **Install scripts:** `pnpm-workspace.yaml` controls builds through `allowBuilds`: it permits `better-sqlite3`, `keytar`, `electron-winstaller`, and the `esbuild` binary used by `tsx`, while blocking Electron's installer in favor of the verified repository installer; do not approve packages globally.

## Current version matrix / 当前版本矩阵

| Layer / 层级               | Technology / 技术       | Supported version / 支持版本 | Upgrade status / 升级状态              |
| -------------------------- | ----------------------- | ---------------------------: | -------------------------------------- |
| Runtime                    | Node.js                 |                       26.5.1 | Current stable baseline                |
| Package management         | pnpm                    |                      11.21.0 | Current stable baseline                |
| Desktop runtime            | Electron                |                       43.2.0 | Current stable baseline                |
| Renderer                   | React / React DOM       |                       19.2.8 | Current stable baseline                |
| Renderer build             | Vite                    |                        8.2.1 | Current stable baseline                |
| Styling                    | Tailwind CSS            |                        4.3.3 | Current stable baseline                |
| Language                   | TypeScript              |                        6.0.2 | **Intentionally held; do not upgrade** |
| Linting                    | ESLint                  |                       10.8.1 | Current stable baseline                |
| Unit and integration tests | Vitest                  |                       4.1.10 | Current stable baseline                |
| Desktop E2E                | Playwright              |                       1.62.1 | Current stable baseline                |
| Native persistence         | better-sqlite3          |                       13.0.3 | Rebuild for Node and Electron ABIs     |
| Schema validation          | Zod                     |                        4.4.3 | Current stable baseline                |
| AI provider SDK            | Replicate               |                        1.4.0 | Current stable baseline                |
| Managed AI runtime         | OpenAI Codex App Server |                      0.145.0 | Exact pin; native package is unpacked  |
| Packaging                  | electron-builder        |                      26.15.3 | Current stable baseline                |
| Media runtime              | FFmpeg / ffprobe LGPL   |                        8.1.2 | Pinned, checksummed per platform       |

The renderer also uses Redux Toolkit 2.12.0, React Router 7.18.2, Radix UI stable releases, and Tailwind CSS 4.3.3. The package manifests and lock files remain authoritative if this summary ever differs.

渲染器同时使用 Redux Toolkit 2.12.0、React Router 7.18.2、Radix UI 稳定版和 Tailwind CSS 4.3.3。如本摘要与 manifest 或锁文件不一致，以 manifest 与锁文件为准。

## Known upstream constraints / 已知上游约束

- pnpm audit currently reports two high-severity dependency nodes for one React Router RSC-mode CSRF advisory. React Router DOM 7.18.2 is the current stable release, and Lucid Fin is a client-only Electron renderer that does not enable RSC server actions. Keep the latest release, monitor [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2), and do not downgrade to silence the audit.
- `fluent-ffmpeg` 2.1.3 is the final published release and is deprecated upstream. Replacing its wrapper with direct, argument-safe FFmpeg process execution is a separate media-engine migration, not a dependency-only upgrade.

pnpm audit 当前针对同一个 React Router RSC 模式 CSRF 公告报告两个高危依赖节点；本应用是未启用 RSC Server Actions 的纯客户端 Electron 渲染器。继续使用最新稳定版并跟踪上游修复，不通过降级伪造“零告警”。`fluent-ffmpeg` 已被上游弃用，后续应以独立媒体引擎迁移替换。

## CI and release actions / CI 与发布 Actions

| Action                        | Major |
| ----------------------------- | ----: |
| `actions/checkout`            |    v6 |
| `pnpm/action-setup`           |    v6 |
| `actions/setup-node`          |    v6 |
| `actions/upload-artifact`     |    v7 |
| `actions/download-artifact`   |    v8 |
| `softprops/action-gh-release` |    v3 |

CI installs pnpm from the root `packageManager` through `pnpm/action-setup@v6`, then sets up Node 26.5.1 and uses the cached pnpm store without implicit installs.

## Upgrade procedure / 升级流程

1. Run `pnpm outdated --recursive --json` and accept stable `latest` releases only.
2. Keep every TypeScript declaration at `^6.0.2` and the resolved version at `6.0.2`.
3. Update `pnpm-lock.yaml` with `pnpm install --lockfile-only`. Never regenerate `package-lock.json`.
4. Rebuild `better-sqlite3` for Node tests and Electron 43.2.0 packaging; release CI must use `@electron/rebuild`, not a Node-only rebuild.
5. Run build, tests, Electron E2E, lint, format, license, packaging, and lock consistency checks before release.

Historical documents under `docs/plans/` are dated design records. Their old version references describe the state at the time and are not the current stack baseline.

## Executable upgrade contract / 可执行升级契约

### 1. Scope / Trigger

Use this contract whenever a dependency, Node/pnpm baseline, Electron runtime, native module, FFmpeg payload, packaging target, or GitHub Action changes. It prevents package-manager drift, Node/Electron ABI mismatches, and unverified release artifacts.

### 2. Signatures

```text
pnpm install --frozen-lockfile
pnpm outdated --recursive --json
pnpm run electron:install
pnpm exec electron-rebuild -f -w better-sqlite3 -v 43.2.0
node scripts/fetch-ffmpeg.ts --platform <win32-x64|win32-arm64|linux-x64>
pnpm run build
pnpm test
pnpm run test:e2e
pnpm run lint
pnpm run format:check
pnpm run license:audit
pnpm run dist
```

Release CI passes `--win|--mac|--linux` and exactly one `--x64|--arm64` argument to `electron-builder`. The release matrix, not `electron-builder.json`, owns cross-architecture expansion.

### 3. Contracts

- Input versions come from root/workspace manifests; `pnpm-lock.yaml` is the sole exact dependency graph consumed by `pnpm install --frozen-lockfile`.
- `scripts/install-electron.mjs` first accepts an existing usable Electron binary, otherwise invokes Electron's installer. On Windows only, a failed native extractor may retry the downloaded, checksum-verified archive with `Expand-Archive`; every unsuccessful or missing-binary outcome is fatal.
- `better-sqlite3` must be rebuilt for Electron 43.2.0 before packaging. A Node-only `pnpm rebuild` does not satisfy the release ABI contract.
- FFmpeg archives must match `packages/media-engine/ffmpeg-checksums.json`; macOS payloads are built natively from the pinned 8.1.2 LGPL source in CI.
- `pnpm outdated` may report only TypeScript while the product hold is active. Any other direct dependency entry requires review and either an upgrade or a documented upstream constraint.

### 4. Validation & Error Matrix

| Condition                                              | Validation                                    | Required behavior                                                      |
| ------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------- |
| Node or pnpm is below baseline                         | `node --version`; `pnpm --version`            | Stop before install; use Node 26.5.1 and pnpm 11.21.0                  |
| TypeScript range/resolution changes                    | Inspect all manifests and `pnpm-lock.yaml`    | Fail the upgrade review; keep `^6.0.2` / `6.0.2`                       |
| Lock and manifests disagree                            | `pnpm install --frozen-lockfile`              | Treat any install failure or lock rewrite request as blocking          |
| Electron binary is absent or incomplete                | `pnpm run electron:install`                   | Repair in place; fail if no usable binary is produced                  |
| Native addon targets the Node ABI                      | Electron smoke test or packaging              | Rebuild with `@electron/rebuild -v 43.2.0`                             |
| FFmpeg checksum or platform key differs                | `node scripts/fetch-ffmpeg.ts --platform ...` | Abort; never accept or silently replace the payload                    |
| Audit reports the documented React Router RSC advisory | `pnpm audit`                                  | Record and monitor the upstream issue; do not downgrade or suppress it |

### 5. Good / Base / Bad Cases

- **Good:** Node 26.5.1 + pnpm 11.21.0 runs `pnpm install --frozen-lockfile`, Electron ABI rebuild, build, tests, E2E, lint, format, license audit, and packaging successfully.
- **Base:** `pnpm run electron:install` finds a valid existing Electron binary and exits without deleting or downloading anything.
- **Bad:** CI uses a non-frozen install, TypeScript resolves above 6.0.2, a release uses a Node-only native rebuild, or a checksum failure is bypassed. Each case blocks release.

### 6. Tests Required

- Manifest/YAML check: parse all 13 package manifests and all GitHub Actions YAML files; assert every manifest is MIT licensed and the TypeScript lock entry is exactly 6.0.2.
- Dependency check: assert `pnpm outdated --recursive --json` contains no package other than the approved TypeScript exception.
- Compatibility check: run the export-handler test covering `ZipArchive`, then the full build and test suite.
- Runtime check: run Electron E2E and assert all smoke scenarios pass after the Electron ABI rebuild.
- Release check: build one local installer and assert the filename contains the actual platform architecture; CI covers the remaining matrix entries.
- Repository check: run `pnpm run format:check` and `git diff --check`; confirm canonical lock/checksum/README files are not ignored.

### 7. Wrong vs Correct

```text
Wrong:   pnpm install                 # CI
Correct: pnpm install --frozen-lockfile

Wrong:   pnpm rebuild better-sqlite3  # before Electron packaging
Correct: pnpm exec electron-rebuild -f -w better-sqlite3 -v 43.2.0

Wrong:   electron-builder config expands x64 and arm64 in every local build
Correct: release.yml selects one architecture per native runner matrix entry
```
