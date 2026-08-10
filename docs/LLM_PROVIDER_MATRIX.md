# LLM and vision provider matrix

Verified against official provider documentation on **2026-08-10**. The executable source of truth
is `packages/contracts/src/llm-provider.ts`; Settings mirrors it and tests enforce runtime parity.
Model aliases change frequently, so this document records the reviewed defaults rather than acting
as a second registry.

## Hosted and local LLM defaults

| Provider                | Default model                 | Protocol                    | Context window |
| ----------------------- | ----------------------------- | --------------------------- | -------------: |
| OpenAI                  | `gpt-5.6-sol`                 | Responses API               |      1,050,000 |
| Anthropic               | `claude-sonnet-5`             | Messages API                |      1,000,000 |
| Google                  | `gemini-3.6-flash`            | Gemini API                  |      1,048,576 |
| DeepSeek                | `deepseek-v4-pro`             | OpenAI-compatible           |      1,048,576 |
| xAI                     | `grok-4.5`                    | OpenAI-compatible           |        500,000 |
| Alibaba Qwen            | `qwen3.7-max`                 | OpenAI-compatible           |      1,000,000 |
| SiliconFlow             | `deepseek-ai/DeepSeek-V4-Pro` | OpenAI-compatible           |      1,048,576 |
| Doubao / Volcengine Ark | `doubao-seed-2-0-pro-260215`  | OpenAI-compatible           |        256,000 |
| Zhipu                   | `glm-5.2`                     | OpenAI-compatible           |      1,000,000 |
| Moonshot                | `kimi-k3`                     | OpenAI-compatible           |      1,000,000 |
| Baichuan                | `Baichuan4-Turbo`             | OpenAI-compatible           |         32,000 |
| StepFun                 | `step-3.5-flash`              | OpenAI-compatible           |        256,000 |
| OpenRouter              | `openai/gpt-5.6-sol`          | OpenAI-compatible           |      1,050,000 |
| Together AI             | `deepseek-ai/DeepSeek-V4-Pro` | OpenAI-compatible           |      1,048,576 |
| Groq                    | `openai/gpt-oss-120b`         | OpenAI-compatible           |        131,072 |
| Mistral                 | `mistral-large-latest`        | OpenAI-compatible           |        128,000 |
| Cohere                  | `command-a-plus-05-2026`      | Cohere Chat V2              |        128,000 |
| Ollama                  | `qwen3.5:9b` for new installs | OpenAI-compatible local API |        262,144 |

`doubao` and `volcengine-ark` remain stable credential/configuration aliases so existing encrypted
keys and projects are not orphaned. They resolve to the same current Ark model. Existing Ollama
model selections are never force-migrated because local availability is controlled by the user.

## OAuth LLM entries

| Settings entry        | Execution path          | Credential boundary                       | Visual input |
| --------------------- | ----------------------- | ----------------------------------------- | ------------ |
| ChatGPT (OAuth)       | Codex App Server        | Isolated `capability-llm` App Server home | Yes          |
| Google Gemini (OAuth) | Gemini REST with bearer | `oauth:gemini:llm` OS-keychain slot       | Yes          |

These entries sit beside OpenAI and Google API-key entries; OAuth never replaces or impersonates an
API key. ChatGPT OAuth is not sent to `api.openai.com`. Every media/vision OAuth capability has its
own login slot, so selecting one account for the LLM does not force that account onto generation.

## Vision defaults

| Provider     | Default model                 |
| ------------ | ----------------------------- |
| OpenAI       | `gpt-5.6-sol`                 |
| Google       | `gemini-3.6-flash`            |
| Anthropic    | `claude-sonnet-5`             |
| Alibaba Qwen | `qwen3.7-plus`                |
| OpenRouter   | `openai/gpt-5.6-sol`          |
| SiliconFlow  | `Qwen/Qwen3-VL-32B-Instruct`  |
| Together AI  | `Qwen/Qwen3.5-9B`             |
| xAI          | `grok-4.5`                    |
| Mistral      | `mistral-large-latest`        |
| Doubao       | `doubao-seed-2-0-pro-260215`  |
| Zhipu        | `glm-5v-turbo`                |
| Moonshot     | `kimi-k3`                     |
| StepFun      | `step-3`                      |
| Ollama       | `qwen3.5:9b` for new installs |

The vision list is a fallback registry, not a mandatory second analysis call. When the active LLM
explicitly declares `image-understanding`, the same LLM adapter and credential analyze images. The
fallback selected in the Vision tab is used only for a text-only active LLM. Failure of an active
visual LLM is surfaced instead of silently invoking another provider.

The old `deepseek-vision` preset was removed because DeepSeek's direct API documents text input for
its current chat models, not image input. A user may still add a custom compatible endpoint, but the
app does not advertise an unverified built-in vision route.

## Scenario: refresh built-in LLM and vision models

### 1. Scope / trigger

Apply this contract when a built-in model, model context window, provider protocol, vision capability,
or provider lifecycle changes. A model-ID-only edit is incomplete whenever the replacement changes
sampling fields, multimodal content blocks, reasoning continuation, or tool-call metadata.

### 2. Signatures

```text
packages/contracts/src/llm-provider.ts
  LLMProviderRuntimeConfig { id, baseUrl, model, protocol, authStyle, contextWindow? }

packages/contracts/src/dto/adapter.ts
  LLMMessage { role, content, images?, reasoning?, toolCalls?, toolCallId? }
  LLMToolCall { id, name, arguments, thoughtSignature? }

LLMAdapter.completeWithTools(messages, options) -> AsyncIterable<LLMStreamEvent>
```

### 3. Contracts

- OpenAI GPT-5.6 uses the Responses API and native `input_image` parts.
- OpenAI-compatible vision requests use data-URL `image_url` content; Gemini, Anthropic, and Cohere
  use their native image content blocks.
- Visual routing is capability-based: reuse the active LLM when it declares `image-understanding`;
  read a separate vision credential only when the active LLM is text-only.
- Reasoning text is retained in the context graph and replayed for providers that require
  `reasoning_content` during tool continuation.
- Gemini function-call `thoughtSignature` values are preserved and returned byte-for-byte.
- Current reasoning models do not receive implicit `temperature` or `top_p` values. Model-specific
  token fields (`max_tokens` versus `max_completion_tokens`) are selected by capability.
- Stored built-in values migrate only when they exactly match a previously shipped default. Custom
  models, proxy URLs, context windows, and local Ollama choices remain unchanged.

### 4. Validation and error matrix

| Condition                                | Validation                           | Required behavior                                                         |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Retired default is stored                | Restore persisted Settings           | Replace the exact legacy default and keep its key state                   |
| User selected a different model or proxy | Restore persisted Settings           | Preserve the user value                                                   |
| Provider has no verified image input     | Inspect the vision registry          | Do not expose a built-in vision preset                                    |
| Current model rejects legacy sampling    | Inspect serialized request body      | Omit implicit sampling fields; never retry by silently changing the model |
| Tool loop returns reasoning metadata     | Execute assistant → tool → assistant | Preserve reasoning and opaque thought signatures across the continuation  |
| Provider refuses or rejects a request    | Adapter response mapping             | Return an explicit typed error; do not report an empty success            |
| Active LLM supports image input          | Inspect adapter capabilities         | Reuse that adapter; do not invoke the fallback vision provider            |
| Active LLM is text-only                  | Inspect adapter capabilities         | Use the configured fallback vision provider                               |

### 5. Good / base / bad cases

- **Good:** a saved `gpt-5.4` built-in migrates to `gpt-5.6-sol`, uses Responses image parts, and
  continues a tool loop without dropping provider metadata.
- **Base:** a fresh install receives the reviewed defaults and context windows from the shared
  contract registry.
- **Bad:** a custom `gpt-4o`, proxy URL, local Ollama model, or context override is overwritten; a
  text-only provider appears in Vision; or a reasoning model receives forced legacy sampling fields.

### 6. Tests required

- Contract/Settings parity: assert every built-in LLM `id`, `baseUrl`, `model`, `protocol`, and
  `authStyle` matches.
- Migration: assert exact historic defaults advance while custom hosted and local models survive.
- Adapter payloads: assert OpenAI Responses, OpenAI-compatible, Gemini, Anthropic, and Cohere image
  blocks; assert unsupported implicit sampling fields are absent.
- Continuation: assert `reasoning` and Gemini `thoughtSignature` survive response folding, context
  serialization, and the next provider request.
- Media lifecycle: assert removed Wan/Kolors cards are absent and the Replicate Hunyuan route remains.

### 7. Wrong vs correct

```text
Wrong:   replace a model string in Settings only
Correct: update shared presets, runtime payload compatibility, migration map, docs, and tests together

Wrong:   treat every saved built-in model as a user customization
Correct: migrate exact known historical defaults and preserve every unrecognized value
```

## Primary references

- [OpenAI GPT-5.6](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [Anthropic model overview](https://platform.claude.com/docs/en/about-claude/models/overview) and [deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) and [thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)
- [DeepSeek updates](https://api-docs.deepseek.com/updates/) and [model pricing/context](https://api-docs.deepseek.com/quick_start/pricing/)
- [xAI Grok 4.5](https://docs.x.ai/developers/models/grok-4.5)
- [Alibaba Model Studio models](https://help.aliyun.com/en/model-studio/what-is-model-studio)
- [Moonshot model catalog](https://platform.kimi.ai/docs/models) and [Kimi K3 quickstart](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart)
- [Zhipu model overview](https://docs.bigmodel.cn/cn/guide/start/model-overview)
- [StepFun Chat API](https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create)
- [Groq GPT OSS 120B](https://console.groq.com/docs/model/openai/gpt-oss-120b)
- [Mistral models](https://mistral.ai/models/)
- [Cohere Command A Plus](https://docs.cohere.com/docs/command-a-plus)
- [Ollama Qwen 3.5 tags](https://ollama.com/library/qwen3.5/tags)
- [SiliconFlow models](https://www.siliconflow.cn/models)
- [Together serverless models](https://docs.together.ai/docs/serverless-models)
- [Gemini OAuth](https://ai.google.dev/gemini-api/docs/oauth)
- [Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
