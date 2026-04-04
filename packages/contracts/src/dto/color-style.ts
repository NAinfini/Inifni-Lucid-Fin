/** A single color stop in hex format */
export interface ColorSwatch {
  hex: string;
  name?: string;
  weight: number; // 0-1, dominance in the palette
}

export interface GradientStop {
  hex: string;
  position: number; // 0-1
}

export interface GradientDef {
  type: 'linear' | 'radial';
  angle?: number; // degrees, for linear
  stops: GradientStop[];
}

export interface ExposureProfile {
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  highlights: number; // -100 to 100
  shadows: number; // -100 to 100
  temperature: number; // 2000-10000 Kelvin
  tint: number; // -100 to 100 (green-magenta)
}

export interface ColorStyle {
  id: string;
  name: string;
  sourceType: 'manual' | 'image' | 'video';
  sourceAsset?: string; // asset hash if extracted from media
  palette: ColorSwatch[];
  gradients: GradientDef[];
  exposure: ExposureProfile;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
