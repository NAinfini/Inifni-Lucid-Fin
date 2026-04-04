# AI Video Prompt Guide — Index

> Compiled from [super-i.cn](https://www.super-i.cn/tool.html) (刺猬星球 Hedgehog Planet) 39-lesson prompt engineering curriculum + industry best practices from Kling AI, Sora, Veo 3.1, Runway.

## Documents

| #   | File                                                                 | Content                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 00  | [00-meta-prompt.md](./00-meta-prompt.md)                             | **Meta-Prompt** — System instruction that teaches AI how to write preset `prompt` fields for Lucid Fin. This is the main deliverable.                                                                                                                                                |
| 01  | [01-prompt-structure.md](./01-prompt-structure.md)                   | Core prompt formula, 6 dimensions, key principles, state flow, time words, perturbation, word trimming, JSON prompts, hallucination control                                                                                                                                          |
| 02  | [02-camera-and-composition.md](./02-camera-and-composition.md)       | Shot types, angles, composition control, camera movements, movement logic, kinematics, lens references, Z-axis depth, foreground occlusion, pseudo-perspective, lens-emotion matching, style-specific camera recipes                                                                 |
| 03  | [03-lighting-and-atmosphere.md](./03-lighting-and-atmosphere.md)     | Light formula, motivated lighting, indoor lighting, cinematic atmosphere, atmospheric media, HEX color grading, data-driven color grading, color temperature, lighting setup patterns                                                                                                |
| 04  | [04-motion-and-emotion.md](./04-motion-and-emotion.md)               | Emotion through environment, emotional contrast & montage, micro-expression control, multi-character control, multi-stage shot relay, creative motion, editorial rhythm                                                                                                              |
| 05  | [05-style-and-aesthetics.md](./05-style-and-aesthetics.md)           | Visual styles, device simulation, film stocks, textures, style extraction, feature collapse, portrait de-greasing, robustness breaking, quality modifiers, aspect ratios, environments                                                                                               |
| 06  | [06-workflow-methods.md](./06-workflow-methods.md)                   | Fake causality, reverse control, image deconstruction, reference image logic, mental image reverse-engineering, precise reproduction, salvaging, consistency, environment realism, director thinking, breaking AI defaults, video prompt kinematics                                  |
| 07  | [07-model-specific-adaptation.md](./07-model-specific-adaptation.md) | **Per-model prompt adaptation** — optimal prompt lengths, negative prompt syntax, i2v vs t2v differences, camera/motion control, style handling, quirks and pitfalls for: Kling 2.0, Runway Gen-4, Luma Ray 2, Wan 2.1, MiniMax/Hailuo, Pika 2.0+, Seedance, HunyuanVideo, CogVideoX |
| 08  | [08-audio-prompting.md](./08-audio-prompting.md)                     | Sound design prompting — dialogue/voice, ambient/atmosphere, music/score, SFX, audio-visual sync, anti-patterns                                                                                                                                                                      |

## Organization

Documents are organized by **topic**, not by lesson number. Each topic file merges content from multiple lessons and industry sources into a single coherent reference.

| Topic File                 | Lessons Covered                                      |
| -------------------------- | ---------------------------------------------------- |
| 01 — Prompt Structure      | L6, L7, L11, L12, L14, L15, L28                      |
| 02 — Camera & Composition  | L1, L3, L9, L21, L22, L26, L33, L39                  |
| 03 — Lighting & Atmosphere | L2, L20, L23, L32, L38                               |
| 04 — Motion & Emotion      | L29, L34, L36, L37                                   |
| 05 — Style & Aesthetics    | L4, L8, L10, L17, L18                                |
| 06 — Workflow Methods      | L5, L13, L16, L19, L24, L25, L27, L30, L31, L34, L35 |

## Source Coverage

### super-i.cn Prompt Tutorial Series (提示词创作)

All 39 lessons scraped and compiled:

| Lesson | Title                                           | ID   |
| ------ | ----------------------------------------------- | ---- |
| 1      | 控制 Prompt 的构图                              | 2205 |
| 2      | 三个技巧控制光线                                | 2223 |
| 3      | 掌控相机角度让 AI 理解"怎么拍"                  | 2290 |
| 4      | 模拟真实设备与纪实瞬间                          | 2377 |
| 5      | 利用"误解机制"反向控制画质                      | 2433 |
| 6      | 如何利用"扰动词"控制 AI 生图                    | 2449 |
| 7      | 你需要学会在提示词里"剪词"                      | 2463 |
| 8      | 鲁棒性破坏：掌控AI的"可控失控感"                | 2464 |
| 9      | 打破平面魔咒：利用"伪透视"欺骗 AI               | 2493 |
| 10     | 特征塌陷：AI绘画的"失控"美学                    | 2509 |
| 11     | 如何用"时间词"强行带出AI情绪与动态              | 2515 |
| 12     | 驾驭AI的"幻觉链反应"                            | 2521 |
| 13     | 打破"AI塑料感"—利用"假因果"赋予叙事灵魂         | 2566 |
| 14     | 进阶！三步正确掌握AI的json生图                  | 2570 |
| 15     | 打破"代码迷信"：JSON 提示词的真正威力与三大误区 | 2574 |
| 16     | 拒绝"抽卡式"反推：教你像AI架构师一样拆解画面    | 2583 |
| 17     | 风格即选择：AI画面风格提取三步法                | 2586 |
| 18     | 2026年了，为什么你的Midjourney人像依然"油腻"？  | 2591 |
| 19     | 参考图的"降维"逻辑                              | 2597 |
| 20     | 室内光线的终极逻辑                              | 2603 |
| 21     | 告别AI视频"摆拍感"：用运镜逻辑重塑真实影像      | 2604 |
| 22     | 拒绝"看图说话"：AI视频反推—运动学解构           | 2610 |
| 23     | 告别"AI塑料感"——数据驱动型电影级调色实战指南    | 2611 |
| 24     | AI视频一致性完全攻略                            | 2620 |
| 25     | 环境决定真实：打破AI绘图的"塑料感"魔咒          | 2621 |
| 26     | 告别"AI味"：用三大构图原则重塑画面叙事感        | 2632 |
| 27     | 如何用AI反向破译你脑海中的画面                  | 2633 |
| 28     | AI视频生成的"降维打击"：从动作清单到状态流      | 2634 |
| 29     | AI微表情的精准控制心法                          | 2637 |
| 30     | 拒绝"盲盒式"烧钱：3招榨干AI废片价值             | 2638 |
| 31     | 告别"抽卡"玄学：三步法让AI精准复刻你脑中的画面  | 2644 |
| 32     | 告别AI"塑料感"：3个底层，赋予画面电影级"氛围感" | 2647 |
| 33     | 3个维度彻底讲透镜头情绪匹配                     | 2652 |
| 34     | 告别工具人：3招掌握AI视频导演思维               | 2655 |
| 35     | 别再死磕"大片感"！3个高级思路重塑AI想象力       | 2671 |
| 36     | 打破AI摆拍感：3个情绪蒙太奇技巧                 | 2674 |
| 37     | AI视频多角色失控？3个技巧拿捏                   | 2679 |
| 38     | 如何不用提示词给画面调色？HEX调色法             | 2680 |
| 39     | 告别塑料AI味！两大前景遮挡神技                  | 2690 |

_Note: Lessons 18 and 23 are filed under 提示词教程 (not 提示词创作), but contain prompt engineering techniques integrated into our knowledge base._

### Industry Sources

- Kling AI 2.0 official prompt guides (Kuaishou 可灵)
- Google Veo 3 prompt framework
- Runway Gen-3 Alpha / Gen-4 best practices
- OpenAI Sora prompt engineering
- Luma Ray 2 / Dream Machine
- Wan 2.1 (Alibaba/Tongyi 通义万相)
- MiniMax / Hailuo AI (Video-01)
- Pika Labs 2.0+
- ByteDance Seedance (即梦)
- Tencent HunyuanVideo (混元)
- CogVideoX (Tsinghua/ZhipuAI 智谱)
- General cinematography and filmmaking references
