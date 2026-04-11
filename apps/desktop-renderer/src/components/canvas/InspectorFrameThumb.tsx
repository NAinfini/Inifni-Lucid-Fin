import { Image } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import type { CanvasNode, ImageNodeData } from '@lucid-fin/contracts';

interface InspectorFrameThumbProps {
  node?: CanvasNode & { data: ImageNodeData };
  assetHash?: string;
  title?: string;
}

export function InspectorFrameThumb({ node, assetHash, title }: InspectorFrameThumbProps) {
  const { t } = useI18n();
  const resolvedAssetHash = assetHash ?? node?.data.assetHash;
  const resolvedTitle = title ?? node?.title ?? t('node.image');
  const { url } = useAssetUrl(resolvedAssetHash, 'image', 'png');

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex w-full aspect-video items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted">
        {url ? (
          <img src={url} alt={resolvedTitle} className="h-full w-full object-cover" />
        ) : (
          <Image className="h-5 w-5 text-muted-foreground/40" />
        )}
      </div>
      <span className="w-full truncate text-[10px] text-muted-foreground">
        {resolvedTitle}
      </span>
    </div>
  );
}
