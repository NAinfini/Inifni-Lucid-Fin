import { Image, X } from 'lucide-react';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import { cn } from '../../../lib/utils.js';
import type { Asset } from '../../../store/slices/assets.js';

export function VariantThumb({
  hash,
  isActive,
  onClick,
  onDelete,
}: {
  hash: string;
  isActive: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}) {
  const { url, markFailed } = useAssetUrl(hash, 'image', 'png');
  if (!url) return null;
  return (
    <div className="relative shrink-0 group">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'h-8 w-12 rounded border overflow-hidden transition-colors',
          isActive
            ? 'border-primary ring-1 ring-primary/40'
            : 'border-border/60 hover:border-primary/50',
        )}
      >
        <img src={url} alt="variant" className="h-full w-full object-cover" onError={markFailed} />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Delete variant"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

export function ListThumb({ hash }: { hash?: string }) {
  const { url, markFailed } = useAssetUrl(hash, 'image', 'png');
  if (!url) return <div className="h-full w-full bg-muted/50" />;
  return <img src={url} alt="" className="h-full w-full object-contain" onError={markFailed} />;
}

export function AssetThumb({
  asset,
  onSelect,
}: {
  asset: Asset;
  onSelect: (hash: string) => void;
}) {
  const { url, markFailed } = useAssetUrl(asset.hash, 'image', asset.format ?? 'jpg');
  return (
    <button
      type="button"
      onClick={() => onSelect(asset.hash)}
      className="rounded border border-border/60 overflow-hidden hover:border-primary transition-colors"
      title={asset.name}
    >
      {url ? (
        <img
          src={url}
          alt={asset.name}
          className="w-full aspect-square object-cover"
          onError={markFailed}
        />
      ) : (
        <div className="w-full aspect-square bg-muted flex items-center justify-center">
          <Image className="w-6 h-6 text-muted-foreground/40" />
        </div>
      )}
      <div className="text-[9px] text-muted-foreground truncate px-1 py-0.5">{asset.name}</div>
    </button>
  );
}
