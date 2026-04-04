export type AssetType = 'image' | 'video' | 'audio';

export interface AssetMeta {
  hash: string;
  type: AssetType;
  format: string;
  originalName: string;
  fileSize: number;
  width?: number;
  height?: number;
  duration?: number;
  prompt?: string;
  provider?: string;
  tags: string[];
  createdAt: number;
}

export interface AssetRef {
  hash: string;
  type: AssetType;
  format: string;
  path: string;
}
