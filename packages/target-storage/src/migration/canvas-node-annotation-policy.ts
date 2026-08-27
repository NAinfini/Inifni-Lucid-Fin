export const LEGACY_CANVAS_NODE_ANNOTATION_KEYS = ['text', 'content', 'label', 'title'] as const;

export type LegacyCanvasNodeAnnotationKey = (typeof LEGACY_CANVAS_NODE_ANNOTATION_KEYS)[number];

export interface LegacyCanvasNodeAnnotationSource {
  readonly key: LegacyCanvasNodeAnnotationKey;
  readonly text: string;
}

/**
 * Selects the one Legacy node field that can be represented exactly by the
 * Target Canvas annotation contract. Every other candidate remains offline
 * evidence instead of being trimmed, truncated, or silently merged.
 */
export function legacyCanvasNodeAnnotationSource(
  data: Readonly<Record<string, unknown>>,
): LegacyCanvasNodeAnnotationSource | null {
  for (const key of LEGACY_CANVAS_NODE_ANNOTATION_KEYS) {
    const value = data[key];
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 20_000 &&
      value === value.trim()
    ) {
      return { key, text: value };
    }
  }
  return null;
}
