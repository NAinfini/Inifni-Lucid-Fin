/** Shared visual grammar used by Canvas drafts and approved Visual Constitutions. */
export interface VisualStyleGrammar {
  medium: string;
  era: string;
  rendering: string;
  linework: string;
  palette: string;
  lighting: string;
  texture: string;
  mood: string;
  cameraGrammar: string;
  lensGrammar: string;
  compositionGrammar: string;
  motionGrammar: string;
  characterAnchors: string[];
  locationAnchors: string[];
  negativeConstraints: string[];
}

/**
 * Canonical manual/pre-approval style policy for one Canvas.
 *
 * Persistent video task lists do not promote this draft into an approval. Once
 * the Visual Constitution gate is approved, its immutable document is the only
 * style authority for that task list.
 */
export interface CanvasVisualStylePolicy {
  version: 1;
  /** Human-readable direction used by image and text-to-video generators. */
  summary?: string;
  /** Fields the prompt compiler must preserve across shots. */
  locked?: Partial<VisualStyleGrammar>;
  /** Explicitly permitted shot-to-shot changes within this style. */
  allowedVariations?: string[];
  /** Provider-facing exclusions merged into the negative prompt. */
  negativeConstraints?: string[];
}

export type VisualStyleSource = 'canvas-draft' | 'legacy-style-plate' | 'visual-constitution';

/** Auditable style identity recorded on generated assets. */
export interface VisualStyleProvenance {
  source: VisualStyleSource;
  policyHash: string;
  taskListId?: string;
  revision?: number;
  contentHash?: string;
}
