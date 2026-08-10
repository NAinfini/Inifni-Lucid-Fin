# Capability-scoped provider OAuth contract

This document is the executable contract for ChatGPT and Google Gemini OAuth in Lucid Fin. OAuth
is an alternative provider entry beside API-key providers; it is never treated as an API key and no
OAuth token, authorization URL, account email, or local credential path may cross into the renderer.

## Scope

The supported OAuth targets are:

| Provider | LLM | Image generation | Video generation | Vision fallback |
| -------- | --- | ---------------- | ---------------- | --------------- |
| ChatGPT  | Yes | Yes              | No               | Yes             |
| Gemini   | Yes | Yes              | Yes              | Yes             |

Every `(provider, capability)` target is an independent login slot. A user may therefore use one
ChatGPT account for Commander and another for image generation, or separate Google accounts for
Gemini LLM, image, video, and fallback vision. Logging out of one slot must not affect another.

## Public contract

```ts
type OAuthProviderTarget = {
  provider: 'chatgpt' | 'gemini';
  capability: 'llm' | 'image' | 'video' | 'vision';
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
  Tool execution returns through the existing ToolExecutor so approvals, `askUser`, workflow state,
  evidence, and context updates remain authoritative. Built-in shell, file, network, permission, or
  unregistered tool requests fail the turn.

The App Server `account/rateLimits/read` result is normalized into remaining percentage, window
duration, reset time, and credits when supplied. If App Server omits usage, Settings says usage is
unavailable; it must not invent a number or label subscription work as free.

## Gemini boundary

- Gemini uses Google's installed-desktop OAuth flow with loopback callback, PKCE S256, random state,
  offline access, bounded login timeout, refresh, and revocation.
- Release configuration is supplied only to the main process:

  ```text
  LUCID_GOOGLE_OAUTH_CLIENT_ID
  LUCID_GOOGLE_OAUTH_CLIENT_SECRET
  LUCID_GOOGLE_CLOUD_PROJECT
  ```

- Tokens are stored in the operating-system keychain under
  `oauth:gemini:{llm|image|video|vision}`. Adapters receive only a main-process authorization-header
  provider and send `Authorization: Bearer ...` plus `x-goog-user-project` to the verified Google
  Generative Language host.
- Gemini does not provide a reliable remaining-quota value through this OAuth scope. Settings states
  that explicitly and links to the Google Cloud quota dashboard instead of showing a fabricated
  percentage.
- Missing application OAuth configuration produces an unavailable card with a setup link. There is
  no hidden API-key fallback.

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
| ChatGPT target is video                                            | Reject as unsupported; never substitute another provider              |
| Google OAuth configuration is incomplete                           | Show unavailable and the setup link                                   |
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
`apps/desktop-main/build/verify-codex-binary.cjs`. Real provider login, quota display, generation,
refresh, revocation, and account-isolation checks remain release smoke tests because they require
live user accounts.

Primary references: [Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md),
[OpenAI API authentication](https://developers.openai.com/api/reference/overview#backwards-compatibility),
and [Gemini OAuth](https://ai.google.dev/gemini-api/docs/oauth).
