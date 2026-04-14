export type KeyframeStatus = 'draft' | 'generating' | 'review' | 'approved' | 'rejected';

export interface Keyframe {
  id: string;
  sceneId: string;
  index: number;
  prompt: string;
  negativePrompt?: string;
  assetHash?: string;
  status: KeyframeStatus;
  variants: string[];
  seed?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SceneSegment {
  id: string;
  sceneId: string;
  startKeyframeId: string;
  endKeyframeId: string;
  motion: string;
  camera: string;
  mood: string;
  moodIntensity?: number;
  negativePrompt?: string;
  seed?: number;
  duration: number;
  videoAssetHash?: string;
  lipSync?: boolean;
}

export interface Scene {
  id: string;
  index: number;
  title: string;
  description: string;
  location: string;
  timeOfDay: string;
  characters: string[];
  keyframes: Keyframe[];
  segments: SceneSegment[];
  styleOverride?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
