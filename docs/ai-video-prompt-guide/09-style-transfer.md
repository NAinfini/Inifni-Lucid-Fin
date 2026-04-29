# Style Transfer — Prompt Guide

> How to extract visual style from a reference image and apply it consistently to new AI-generated images and videos.

---

## Core Principle

Style transfer in AI generation is **not** copying content — it is extracting and re-applying the _visual grammar_: color palette, texture, lighting logic, rendering technique, and compositional rhythm.

---

## Style Extraction Formula

When analyzing a reference image for style, decompose into 6 axes:

```
[rendering technique] + [color palette] + [texture/surface quality] + [lighting logic] + [compositional rhythm] + [era/medium reference]
```

**Example extraction from a Studio Ghibli frame:**

```
hand-drawn cel animation, warm desaturated earth tones with selective cyan accents,
soft watercolor wash backgrounds, diffused natural window light with no hard shadows,
wide establishing shots with foreground foliage framing, 1980s Japanese animation
```

---

## Prompt Patterns

### Pattern 1 — Explicit Style Descriptor Block

Prepend a style block before the scene description:

```
[STYLE: oil painting, impasto texture, Rembrandt chiaroscuro lighting, warm amber-brown palette, Dutch Golden Age]
[SUBJECT: a young woman reading by candlelight]
[ACTION: turning a page slowly, eyes downcast]
```

Separate STYLE, SUBJECT, and ACTION explicitly — models treat them as independent axes.

### Pattern 2 — Style Anchor Phrase

Embed style as a modifier clause:

```
rendered in the visual style of [extracted descriptors], [scene content]
```

### Pattern 3 — Negative Style Isolation

Use negative prompts to suppress competing styles:

```
prompt: cinematic film grain, anamorphic lens flare, muted teal-orange grade
negative: anime, illustration, CGI, plastic, oversaturated
```

---

## Style Consistency Across Batch

To maintain style across multiple generations:

1. **Generate a style reference frame first** — produce one canonical output, then use it as image reference for all subsequent nodes
2. **Lock the style block** — use identical style descriptor text across all nodes
3. **Seed anchoring** — use the same or related seed values when the model supports it
4. **Reference image attachment** — attach the same style reference image to all nodes
5. **Avoid style drift** — do not vary lighting or color descriptors between shots; only vary scene content

### Consistency Checklist

- [ ] Same rendering technique keyword (e.g., "35mm film", "cel animation", "oil painting")
- [ ] Same color palette descriptor (e.g., "muted earth tones", "neon cyberpunk palette")
- [ ] Same lighting logic (e.g., "motivated side lighting", "overcast diffused light")
- [ ] Same texture/surface quality (e.g., "film grain", "watercolor wash", "photorealistic skin")

---

## Style Extraction from Reference Image (Vision LLM)

When Commander analyzes a reference image, prompt the vision model with:

```
Analyze this image and extract its visual style as a reusable prompt fragment.
Output ONLY the style descriptor — no scene content, no subject description.
Format: [rendering technique], [color palette], [texture], [lighting], [compositional tendency], [era/medium]
Max 60 words. Use vocabulary compatible with Kling, Runway, and Wan 2.1.
```

---

## Model-Specific Notes

| Model        | Style Transfer Approach                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| Kling 2.0    | `--style` image input + text block; use first-frame image ref for i2v style lock    |
| Runway Gen-4 | Style image upload; keep prompts under 200 chars; first 30 tokens carry most weight |
| Wan 2.1      | Text only; responds well to medium/era references; always add `cinematic, 24fps`    |
| Sora         | Longer narrative style paragraphs work; supports style reference images natively    |
| Luma Ray 2   | "in the style of [medium]" phrasing; reference image strongly overrides text        |

---

## Anti-Patterns

- **"in the style of [artist name]"** — inconsistent results; use descriptive decomposition instead
- **Mixing style vocabularies** — don't combine "anime" with "photorealistic"; pick one rendering lane
- **Over-specifying content in style block** — style block should describe HOW it looks, not WHAT is in it
- **Ignoring negative prompts** — without negatives, models default to their training bias style
