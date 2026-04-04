export interface ProviderConfig {
  providerId: string;
  enabled: boolean;
  priority: number;
}

export interface StyleGuide {
  global: {
    artStyle: string;
    colorPalette: { primary: string; secondary: string; forbidden: string[] };
    lighting: 'natural' | 'studio' | 'dramatic' | 'neon' | 'custom';
    texture: string;
    referenceImages: string[];
    loraModel?: string;
    checkpoint?: string;
    freeformDescription: string;
  };
  sceneOverrides: Record<string, Partial<StyleGuide['global']>>;
}

export interface Snapshot {
  id: string;
  name: string;
  createdAt: number;
  description?: string;
}

export interface Series {
  id: string;
  title: string;
  description: string;
  styleGuide: StyleGuide;
  episodeIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectManifest {
  id: string;
  title: string;
  description: string;
  genre: string;
  resolution: [number, number];
  fps: number;
  aspectRatio: string;
  createdAt: number;
  updatedAt: number;
  seriesId?: string;
  aiProviders: ProviderConfig[];
  snapshots: Snapshot[];
  styleGuide: StyleGuide;
}
