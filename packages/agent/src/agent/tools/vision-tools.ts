export interface VisionToolDeps {
  describeImage: (
    assetHash: string,
    assetType: 'image' | 'video',
    style?: string,
    providerId?: string,
  ) => Promise<{ prompt: string }>;
  getNodeAssetHash?: (nodeId: string, canvasId?: string) => Promise<string | null>;
  writeNodeField?: (
    nodeId: string,
    field: string,
    value: string,
    canvasId?: string,
  ) => Promise<void>;
}
