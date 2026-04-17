import type {
  CanvasNode,
  PresetTrackSet,
  ImageNodeData,
  VideoNodeData,
  AudioNodeData,
} from '@lucid-fin/contracts';
import { isVisualMedia, isGeneratableMedia } from '@lucid-fin/shared-utils';

export function hasTracks(node: CanvasNode | undefined): node is CanvasNode & {
  data: {
    presetTracks: PresetTrackSet;
  };
} {
  if (!node || !isVisualMedia(node.type)) return false;
  const candidate = node.data as { presetTracks?: unknown };
  return Boolean(candidate.presetTracks && typeof candidate.presetTracks === 'object');
}

export function isGenerationNode(node: CanvasNode | undefined): node is CanvasNode & {
  data: ImageNodeData | VideoNodeData | AudioNodeData;
} {
  return Boolean(node && isGeneratableMedia(node.type));
}
