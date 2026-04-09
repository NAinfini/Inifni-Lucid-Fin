import { Image } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import type { CanvasNode, ImageNodeData } from '@lucid-fin/contracts';

interface InspectorFrameThumbProps {
  node: CanvasNode & { data: ImageNodeData };
}

export function InspectorFrameThumb({ node }: InspectorFrameThumbProps) {
  const { t } = useI18n();
  const { url } = useAssetUrl(node.data.assetHash, 'image', 'jpg');

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted">
        {url ? (
          <img src={url} alt={node.title} className="h-full w-full object-cover" />
        ) : (
          <Image className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <span className="max-w-[80px] truncate text-[10px] text-muted-foreground">
        {node.title || t('node.image')}
      </span>
    </div>
  );
}
