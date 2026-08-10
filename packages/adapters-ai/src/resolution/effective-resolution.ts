import type {
  CanvasSettings,
  ImageNodeData,
  ResolutionIntent,
  ResolutionMediaType,
  ResolutionSource,
  VideoNodeData,
} from '@lucid-fin/contracts';

export interface EffectiveResolutionInput {
  mediaType: ResolutionMediaType;
  canvasSettings?: CanvasSettings;
  nodeData?: Pick<ImageNodeData | VideoNodeData, 'width' | 'height' | 'resolutionIntent'>;
  candidateIntent?: ResolutionIntent;
}

export interface EffectiveResolutionIntent {
  intent: ResolutionIntent;
  source: ResolutionSource;
}

/** Resolve ownership only. Provider support is checked separately and before billing. */
export function resolveEffectiveResolutionIntent(
  input: EffectiveResolutionInput,
): EffectiveResolutionIntent {
  if (input.candidateIntent) {
    return { intent: cloneIntent(input.candidateIntent), source: 'node' };
  }

  const nodeIntent = input.nodeData?.resolutionIntent;
  if (nodeIntent) return { intent: cloneIntent(nodeIntent), source: 'node' };

  const legacyNodeIntent = exactIntent(input.nodeData?.width, input.nodeData?.height);
  if (legacyNodeIntent) return { intent: legacyNodeIntent, source: 'node' };

  const policyIntent = policyFor(input.canvasSettings, input.mediaType);
  if (policyIntent) return { intent: cloneIntent(policyIntent), source: 'canvas' };

  const legacyCanvasResolution =
    input.mediaType === 'reference-image'
      ? input.canvasSettings?.refResolution
      : input.mediaType === 'video'
        ? input.canvasSettings?.publishVideoResolution
        : input.canvasSettings?.publishImageResolution;
  const legacyCanvasIntent = exactIntent(
    legacyCanvasResolution?.width,
    legacyCanvasResolution?.height,
  );
  if (legacyCanvasIntent) return { intent: legacyCanvasIntent, source: 'canvas' };

  return { intent: { mode: 'provider-default' }, source: 'provider' };
}

function policyFor(
  settings: CanvasSettings | undefined,
  mediaType: ResolutionMediaType,
): ResolutionIntent | undefined {
  if (mediaType === 'reference-image') return settings?.resolutionPolicy?.referenceImage;
  return settings?.resolutionPolicy?.[mediaType];
}

function exactIntent(
  width: number | undefined,
  height: number | undefined,
): ResolutionIntent | null {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { mode: 'exact', width, height };
}

function cloneIntent(intent: ResolutionIntent): ResolutionIntent {
  return { ...intent };
}
