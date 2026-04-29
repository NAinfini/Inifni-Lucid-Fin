# Continuity Check — Prompt Guide

> How to detect and flag visual inconsistencies across AI-generated image/video sequences.

---

## Core Principle

Continuity checking compares nodes across a canvas to find breaks in character appearance, lighting direction, color grade, or scene dressing that would be jarring in the final edit.

---

## Continuity Axes

| Axis              | What to check                                                          |
| ----------------- | ---------------------------------------------------------------------- |
| Character         | Hair, clothing, accessories, skin tone consistent across shots         |
| Lighting          | Light source direction and color temperature consistent within a scene |
| Color grade       | Saturation, contrast, color palette consistent across scene            |
| Environment       | Props, set dressing, time-of-day consistent within a scene             |
| Motion continuity | Character position/orientation matches between consecutive shots       |

---

## Vision LLM Check Prompt

When Commander analyzes a node image for continuity, use:

```
You are a film continuity supervisor. Analyze this image and extract:
1. CHARACTER: visible characters, their clothing colors, hair, notable accessories
2. LIGHTING: apparent light source direction, color temperature (warm/cool/neutral)
3. COLOR: dominant palette, saturation level (muted/normal/vivid), contrast
4. ENVIRONMENT: location type, time of day, notable props

Output as JSON. Be specific and brief. Max 20 words per field.
```

---

## Cross-Node Comparison Prompt

After extracting continuity data from all nodes in a scene:

```
Compare these continuity records from consecutive shots in the same scene.
Flag any inconsistencies that would be visible in a final edit.
For each inconsistency: specify which nodes, which axis, and what differs.
Ignore minor variations that would not be noticeable in motion.
```

---

## Severity Levels

| Level      | Description                                       | Action                     |
| ---------- | ------------------------------------------------- | -------------------------- |
| Critical   | Character wearing different clothes between shots | Must fix before generation |
| Major      | Light source switches sides between shots         | Should fix                 |
| Minor      | Slight color temperature shift                    | Flag only                  |
| Acceptable | Natural variation in handheld/organic shots       | Ignore                     |

---

## Commander Workflow

1. User selects a scene or range of nodes
2. Commander calls `image.analyze` per node (vision LLM)
3. Commander compares extracted continuity data across nodes
4. Commander reports inconsistencies grouped by severity
5. For each critical/major issue: suggest which node to regenerate or which prompt to fix

---

## Anti-Patterns

- **Checking across scenes** — continuity rules apply within a scene, not across scene cuts
- **Flagging intentional contrast** — flashback sequences, dream sequences intentionally break continuity
- **Over-flagging** — minor color shifts in motion are invisible; only flag what matters in a cut
