# Batch Re-Prompt — Prompt Guide

> How to rewrite multiple node prompts in a consistent style, tone, or visual language across a canvas.

---

## Core Principle

Batch re-prompting is **style normalization**: take N existing prompts with inconsistent vocabulary, structure, or tone, and rewrite them all to share a unified visual grammar while preserving each shot's unique content.

---

## Re-Prompt Instruction Template

When Commander rewrites a batch of prompts, use this system instruction:

```
You are rewriting AI video generation prompts for consistency.

STYLE TARGET: [extracted style descriptor — see 09-style-transfer.md]
TONE: [cinematic / documentary / anime / etc.]
STRUCTURE: [shot type] + [subject state] + [environment] + [lighting] + [motion]

Rules:
- Preserve the unique content/action of each shot
- Apply identical style block, lighting logic, and color vocabulary
- Normalize shot type codes (ECU, CU, MS, LS, ELS)
- Remove conflicting style words from original prompts
- Max [N] words per prompt
- Output ONLY the rewritten prompt, no explanation
```

---

## Consistency Axes to Normalize

| Axis                 | Example normalization                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Rendering technique  | All prompts use "35mm film grain, anamorphic"                                                                                   |
| Color grade          | All prompts use "muted teal-orange grade, -0.5 saturation"                                                                      |
| Lighting logic       | All prompts use "motivated practical lighting, soft fill"                                                                       |
| Shot structure order | All prompts follow: type → subject → environment → light → motion                                                               |
| Vocabulary register  | All prompts use cinematography terms, not casual description                                                                    |
| Character anchor     | Observable attributes only — never names: "woman, late 30s, sharp jawline, dark brown shoulder-length hair, charcoal wool coat" |

---

## Seed Locking

When the model supports seeds (Flux, SD, Midjourney `--seed`):

- Generate one "golden frame" first
- Lock its seed and reuse across all batch generations
- For video models without seed control: use the golden frame as first-frame image reference instead

---

## Shared Negative Prompt Block

Maintain a single negative prompt block applied to every node in the batch:

```
[NEGATIVE: inconsistent lighting, different hair color, different clothing,
cartoon, anime, oversaturated, lens flare, style change]
```

---

## Golden Prompt Workflow

1. Write one prompt that produces the desired output ("golden prompt")
2. Use Commander / LLM to rewrite all other prompts to match its structure and vocabulary
3. Diff to verify locked sections (style, character, lighting) are unchanged
4. Generate in batches of 4–8, review, adjust style block before next batch

---

## Batch Processing Order

1. Extract style target from selected reference node or user-specified style
2. For each node in batch:
   - Read existing prompt via `canvas.getNode`
   - Extract content-only (strip existing style words)
   - Apply style target + normalize structure
   - Write back via `canvas.updateNodeData`
3. Present diff summary to user before writing (use `commander.askUser` for approval)

---

## Prompt Diff Format (for user review)

```
Node: [title]
BEFORE: [original prompt truncated to 80 chars]
AFTER:  [rewritten prompt truncated to 80 chars]
```

---

## Anti-Patterns

- **Rewriting content** — only style/structure should change, never the shot's subject or action
- **Over-normalizing** — some shots intentionally break style for contrast; flag these, don't force-normalize
- **Silent writes** — always show diff and get approval before batch-writing to canvas nodes
