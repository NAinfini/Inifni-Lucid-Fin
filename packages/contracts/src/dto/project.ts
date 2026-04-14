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
