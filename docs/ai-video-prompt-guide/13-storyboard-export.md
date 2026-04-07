# Storyboard Export — Prompt Guide

> How to arrange AI-generated images into a storyboard layout with shot annotations for review and export.

---

## Core Principle

A storyboard is a **visual script**: ordered panels with shot type, action description, and timing. The goal is to produce a reviewable document from canvas image nodes arranged in story order.

---

## Panel Annotation Format

Each storyboard panel should include:

```
Panel #  | Shot Type | Duration | Action Description (1 line) | Dialogue/SFX (optional)
```

**Example:**
```
Panel 3 | ECU | 3s | Hands grip katana hilt, knuckles whitening | SFX: rain on wood
```

---

## Story Order Resolution

Commander determines panel order by:
1. Node position on canvas (left-to-right, top-to-bottom by default)
2. Edge connections — follow directed edges as sequence order
3. Node title numbering if present (e.g., "Shot 01", "Shot 02")
4. Fallback: ask user to confirm order via `commander.askUser`

---

## Export Formats

| Format | Use |
|---|---|
| PDF grid | Standard storyboard review document |
| Markdown table | Quick text-based review in Commander |
| JSON | Machine-readable for further processing |

---

## Markdown Storyboard Template (for Commander output)

```markdown
## Scene: [Scene Name]

| # | Thumbnail | Shot | Duration | Action |
|---|---|---|---|---|
| 1 | [node-id] | ECU | 3s | Hands grip katana |
| 2 | [node-id] | MS | 5s | Samurai turns to face enemy |
| 3 | [node-id] | LS | 4s | Wide reveal of dojo interior |
```

---

## Commander Workflow

1. User selects nodes or a scene
2. Commander resolves story order (edges → position → title)
3. Commander reads each node's shot type, duration, prompt summary via `canvas.getNode`
4. Commander outputs markdown storyboard in chat
5. For PDF export: Commander calls `export.storyboard(canvasId, nodeIds, format)`

---

## Anti-Patterns

- **Exporting ungenerated nodes** — skip nodes with no output image; mark as "PENDING"
- **Ignoring edge order** — if edges exist, they define sequence; don't use position as fallback
- **Over-annotating** — action description max 1 line; storyboards are visual-first
