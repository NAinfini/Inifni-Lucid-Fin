# Capability-scoped provider OAuth contract

This document is the executable contract for ChatGPT OAuth in Lucid Fin. OAuth is an alternative
provider entry beside API-key providers; it is never treated as an API key and no OAuth token,
authorization URL, account email, or local credential path may cross into the renderer.

## Scope

The supported OAuth targets are:

| Provider | LLM | Image generation | Vision fallback |
| -------- | --- | ---------------- | --------------- |
| ChatGPT  | Yes | Yes              | Yes             |

Every capability target is an independent login slot. A user may therefore use one ChatGPT account
for Commander and another for image generation or fallback vision. Logging out of one slot must not
affect another. Gemini remains available through its API-key providers and has no OAuth entry.

## Public contract

```ts
type OAuthProviderTarget = {
  provider: 'chatgpt';
  capability: 'llm' | 'image' | 'vision';
};

window.lucidAPI.providerOAuth.status({ target }): Promise<OAuthProviderStatus>;
window.lucidAPI.providerOAuth.login({ target }): Promise<OAuthProviderStatus>;
window.lucidAPI.providerOAuth.cancelLogin({ target }): Promise<OAuthProviderStatus>;
window.lucidAPI.providerOAuth.logout({ target }): Promise<OAuthProviderStatus>;
window.lucidAPI.providerOAuth.onChanged((status) => {}): () => void;
```

`OAuthProviderStatus` is renderer-safe. A ready status may contain the plan name and usage display
data, but never secrets or identity details. Settings renders login, cancel, and logout actions; an
OAuth provider card never renders an API-key or password field.

## ChatGPT boundary

- ChatGPT OAuth runs only through the pinned `@openai/codex` App Server. A ChatGPT credential is
  never attached to `api.openai.com`; the separate OpenAI provider continues to require an API key.
- Lucid Fin owns isolated homes under `<userData>/codex-home/capability-{llm,image,vision}`. It never
  reads the user's global `~/.codex` profile and never shares a capability login implicitly.
- App Server owns browser authentication, refresh, and credential persistence. The child process
  receives a scrubbed environment without inherited OpenAI, Codex, or ChatGPT secrets.
- Each generation/Commander execution uses an ephemeral thread. Image output is accepted only from
  the matching stable App Server item and after managed-root, symlink, size, and signature checks.
- Commander dynamic tools are restricted to the exact host tools registered for the current step.
  Tool execution returns through the existing ToolExecutor so approvals, `askUser`, Task List state,
  evidence, and context updates remain authoritative. Built-in shell, file, network, permission, or
  unregistered tool requests fail the turn.

The App Server `account/rateLimits/read` result is normalized into remaining percentage, window
duration, reset time, and credits when supplied. If App Server omits usage, Settings says usage is
unavailable; it must not invent a number or label subscription work as free.

## Visual-analysis routing

Image analysis is not a second-agent requirement:

1. If the currently selected LLM declares `image-understanding`, Lucid Fin sends the image to that
   same configured LLM and account.
2. The provider selected under **Vision (Image Understanding)** is consulted only when the current
   LLM is text-only.
3. If the selected visual LLM fails, the error is surfaced. Lucid Fin does not silently charge or
   sign into a different vision provider.

The `supportsVision`/`image-understanding` declaration is explicit in the shared provider registry;
it is not guessed from a model name. Settings repeats this routing rule above the fallback provider
list.

## Validation matrix

| Condition                                                          | Required behavior                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| OAuth URL has the wrong scheme or owner                            | Reject it in main and cancel the login                                |
| Renderer response contains a token, auth URL, email, or local path | Contract validation fails                                             |
| Provider or capability is outside the ChatGPT contract             | Reject it during contract validation                                  |
| Capability slot is signed out                                      | Show the matching login button; do not inspect keychain API-key state |
| Current LLM supports images                                        | Reuse it; do not read or invoke the fallback vision credential        |
| Current LLM is text-only                                           | Use the configured fallback vision provider                           |
| Active visual LLM errors                                           | Surface the error; do not silently fall back                          |
| Usage data is missing                                              | Show unavailable, never zero or unlimited                             |

## Required verification

```text
pnpm test -- apps/desktop-main/src/oauth/*.test.ts
pnpm test -- apps/desktop-main/src/codex/*.test.ts
pnpm test -- apps/desktop-main/src/ipc/handlers/provider-oauth.handlers.test.ts
pnpm test -- apps/desktop-main/src/ipc/handlers/vision.handlers.test.ts
pnpm test -- packages/contracts-parse/src/ipc/channels/batch-14.test.ts
pnpm test -- apps/desktop-renderer/src/pages/Settings.test.tsx
pnpm exec tsx scripts/gen-preload.ts --check
pnpm run build
```

Release builds must unpack `node_modules/@openai/codex-*/vendor/**` from ASAR and run
`apps/desktop-main/build/verify-codex-binary.cjs`. Real ChatGPT login, quota display, generation,
logout, and account-isolation checks remain release smoke tests because they require a live user
account.

Primary references: [Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md),
and [OpenAI API authentication](https://developers.openai.com/api/reference/overview#backwards-compatibility).
