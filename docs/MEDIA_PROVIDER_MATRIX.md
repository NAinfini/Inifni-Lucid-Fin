# Media provider matrix

Verified against official public documentation on **2026-08-10**. The runtime source of truth is
`packages/contracts/src/media-provider-catalog.ts`; Settings, adapter resolution, credential routing,
and stored-key host allowlisting consume that catalog.

“Supported” means the provider has a public, officially documented production API and the app has a
registered adapter that returns a usable image/video asset rather than only a submission ID. Model
hubs are listed separately because their exact request fields depend on the selected model.

The researched mainstream boundary is: first-party, general-purpose image/video APIs plus major
public model hubs with a documented production lifecycle. Avatar/talking-head products, enterprise
cloud surfaces that require structured credentials or customer storage, and duplicate reseller
gateways are recorded below rather than represented by adapters that cannot satisfy their contracts.

## Official image APIs

| Provider             | Default model / API              | Runtime adapter     | Notes                                                            |
| -------------------- | -------------------------------- | ------------------- | ---------------------------------------------------------------- |
| ChatGPT              | Managed `$imagegen`              | `codex-imagegen`    | Capability-scoped OAuth and ChatGPT plan quota; no API key       |
| OpenAI               | `gpt-image-2`                    | `openai-dalle`      | Generation plus ordered image edits                              |
| Google               | `gemini-3.1-flash-image`         | `google-imagen3`    | API-key and separate OAuth entries; Imagen is being retired      |
| Recraft              | `recraftv4_1`                    | `recraft-v4`        | Official REST API                                                |
| Ideogram             | `ideogram-v3`                    | `ideogram`          | Official REST API                                                |
| Leonardo AI          | Lucid Origin                     | `leonardo-v2`       | Bounded polling returns the final image URL                      |
| Zhipu                | `glm-image`                      | `zhipu-image`       | Official BigModel API                                            |
| StepFun              | `step-2x-large`                  | `stepfun-image`     | Official image endpoint                                          |
| Volcengine           | Seedream endpoint/model ID       | `volcengine-image`  | Region/model ID may be account-specific                          |
| Alibaba Model Studio | `wan2.7-image-pro`               | `alibaba-wan-image` | DashScope/Wan image API                                          |
| xAI                  | `grok-imagine-image-quality`     | `xai-imagine`       | Official Images API                                              |
| Black Forest Labs    | `flux-2-pro`                     | `bfl-flux`          | Stable FLUX 2 endpoint                                           |
| Stability AI         | Stable Image Core                | `stability-image`   | Stability Platform v2beta                                        |
| Bria AI              | `image/generate`                 | `bria`              | Commercially safe V2 generation; optional single reference image |
| Baidu Qianfan        | `qwen-image` / `qwen-image-edit` | `baidu-qianfan`     | Official Qianfan generation and edit endpoints                   |

## Official video APIs

| Provider             | Default model / API         | Runtime adapter     | Notes                                                                                                       |
| -------------------- | --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Google               | `gemini-omni-flash-preview` | `google-veo-2`      | API-key and separate OAuth entries; 3–10 s, 720p, native audio                                              |
| Runway               | `gen4.5`                    | `runway-gen4`       | Submit/status/result with bounded polling                                                                   |
| LTX                  | `ltx-2-3-pro`               | `ltx`               | Official V2 async text/image video, first/last frames, generated audio                                      |
| Luma                 | `ray-2`                     | `luma-ray2`         | Submit/status/`assets.video` with bounded polling                                                           |
| MiniMax              | `MiniMax-H3`                | `minimax-video01`   | Official V2 API; 4–15 s, 768P/2K, native stereo audio, first/last-frame and multimodal reference generation |
| Kling                | `kling-v3`                  | `kling-v1`          | JWT or bearer credential; bounded result polling                                                            |
| Zhipu                | `cogvideox-3`               | `zhipu-video`       | Async BigModel lifecycle                                                                                    |
| Vidu                 | `viduq3-pro`                | `vidu`              | q3 pro/turbo lifecycle                                                                                      |
| Volcengine           | Seedance endpoint/model ID  | `volcengine-video`  | Ark task submission/status/result                                                                           |
| Alibaba Model Studio | Wan 2.7 T2V/I2V/R2V         | `alibaba-wan-video` | 2–15 s; audio; first/last frames; up to five ordered references                                             |
| Baidu Qianfan        | `K3.0` / `VQ3-Turbo`        | `baidu-qianfan`     | Official qianfan-video text/image lifecycle with optional sound                                             |
| xAI                  | `grok-imagine-video`        | `xai-imagine`       | Official async Videos API                                                                                   |
| PixVerse             | `v6`                        | `pixverse`          | 1–15 s, 360p–1080p, generated audio; unverified transition payloads are rejected                            |

MiniMax launched **H3** on 2026-07-31 and now documents it as `MiniMax-H3` on the official V2 API.
The direct adapter uses H3 by default and preserves the legacy Hailuo 2.3/2.3 Fast V1 lifecycle for
existing projects. The fal transport also defaults to `minimax/h3/text-to-video` and routes H3 text,
first/last-frame, and reference requests to their distinct queue endpoints.

ChatGPT image, Gemini image, and Gemini video OAuth credentials are independent capability slots.
The Settings cards expose browser login/logout and provider usage when available; Gemini links to its
Cloud quota dashboard because the OAuth scope does not expose a reliable remaining-quota value. No
OAuth route silently falls back to an API-key or different paid provider.

## Model hubs

The app includes first-class image/video transports for **Replicate**, **fal**, **Together AI**,
**SiliconFlow**, **Krea**, **Higgsfield**, **Segmind**, and **Freepik**. The visible Seedance and
HunyuanVideo cards reuse Replicate transport and make that credential requirement explicit. The old
Wan 2.1 and unverified Kolors shortcut cards were removed; current Wan 2.7 is available through the
official Alibaba adapter and supported configurable hubs.
Every hub adapter uses bounded polling and rejects a completed response that lacks a usable media
URL. Krea defaults to Krea 2 Medium / Hailuo 2.3, Higgsfield to Seedream / DoP, Segmind to Seedream
5 Pro / Seedance 2.0, and Freepik to FLUX 2 Pro / Runway 4.5 with an official Veo image-video route.
fal image generation defaults to `fal-ai/flux-2-pro`; Replicate video defaults to
`minimax/hailuo-2.3`.

BytePlus ModelArk uses the same protocol as Volcengine Ark. The existing Volcengine adapters and
stored-key allowlist accept the official Asia-Pacific and Europe data-plane hosts; it is therefore a
regional endpoint option, not a duplicate provider implementation.

## Deliberate exclusions

| Provider                         | Reason                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adobe Firefly                    | Requires both an Adobe client ID and an OAuth token; the current single-secret provider credential UI cannot represent or refresh both safely                    |
| Midjourney                       | No generally available official generation API                                                                                                                   |
| Pika direct API                  | Pika routes general API use through fal; use a Pika model on the fal adapter                                                                                     |
| StepFun video                    | No public production video-generation lifecycle was verifiable in official docs                                                                                  |
| OpenAI Sora API                  | Current OpenAI Sora API pages are legacy/deprecated, so it is not advertised as a current built-in                                                               |
| Amazon Nova Canvas / Reel        | Bedrock requires structured AWS credentials and SigV4; Reel also requires a customer S3 output destination. Nova Canvas reaches end of support on 2026-09-30     |
| Tencent Hunyuan direct           | Requires SecretId, SecretKey, region, and TC3-HMAC signing; Hunyuan video remains available through the supported Replicate transport                            |
| HeyGen, Synthesia, D-ID          | Avatar, voice, script, template, consent, and lip-sync fields require a dedicated `avatar-video` contract, not the generic shot request                          |
| WaveSpeed, AI/ML API, Kie, PiAPI | Duplicate reseller gateways; equivalent models are already available through supported configurable hubs, so they are not counted as first-party mainstream APIs |

Excluded products are kept out of Settings rather than being shown as adapters that appear to work.
Custom endpoints remain available, but the app never attaches a stored credential to an unrecognized
remote host.

## Primary references

- [MiniMax video generation](https://platform.minimax.io/docs/guides/video-generation)
- [MiniMax H3 launch](https://www.minimax.io/blog/minimax-h3)
- [MiniMax H3 on fal](https://fal.ai/models/minimax/h3/text-to-video)
- [MiniMax H3 ComfyUI workflows](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)
- [LTX text-to-video](https://docs.ltx.io/api-documentation/api-reference/async-video-generation/submit-text-to-video) and [image-to-video](https://docs.ltx.io/api-documentation/api-reference/async-video-generation/submit-image-to-video)
- [Google Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Google Gemini Omni Flash video](https://ai.google.dev/gemini-api/docs/omni)
- [Google Gemini OAuth](https://ai.google.dev/gemini-api/docs/oauth)
- [OpenAI GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2)
- [xAI Images API](https://docs.x.ai/developers/rest-api-reference/inference/images) and [Videos API](https://docs.x.ai/developers/rest-api-reference/inference/videos)
- [fal queue API](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [Together video API](https://docs.together.ai/docs/inference/videos/overview)
- [SiliconFlow video API](https://docs.siliconflow.cn/cn/api-reference/videos/videos_submit)
- [Zhipu CogVideoX-3](https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3)
- [Vidu text-to-video](https://platform.vidu.com/docs/text-to-video)
- [PixVerse V6](https://docs.platform.pixverse.ai/v6-2056814m0)
- [Alibaba Wan 2.7 text-to-video](https://help.aliyun.com/en/model-studio/text-to-video-api-reference), [image-to-video](https://help.aliyun.com/en/model-studio/image-to-video-general-api-reference), and [reference-to-video](https://help.aliyun.com/en/model-studio/wan-video-to-video-api-reference)
- [Baidu Qianfan image generation](https://cloud.baidu.com/doc/qianfan-api/s/8m7u6un8a) and [video generation](https://cloud.baidu.com/doc/qianfan-api/s/Eml7rnswy)
- [Black Forest Labs image generation](https://docs.bfl.ai/quick_start/generating_images)
- [Stability API](https://platform.stability.ai/docs/api-reference)
- [Bria image generation](https://docs.bria.ai/image-generation)
- [Krea job lifecycle](https://www.krea.ai/docs/developers/job-lifecycle)
- [Higgsfield official JavaScript SDK](https://github.com/higgsfield-ai/higgsfield-js)
- [Segmind Seedance 2.0](https://www.segmind.com/models/seedance-2.0/api)
- [Freepik Runway 4.5 video API](https://docs.freepik.com/api-reference/video/runway-gen-4-5/generate-t2v)
- [BytePlus ModelArk regions](https://docs.byteplus.com/api/docs/modelark/2191806)
- [Leonardo Lucid Origin](https://docs.leonardo.ai/docs/lucid-origin)
- [Adobe Firefly API](https://developer.adobe.com/firefly-services/docs/firefly-api/)
