import { X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';

interface InspectorVariantThumbProps {
  hash?: string;
  index: number;
  selected: boolean;
  mediaType: 'image' | 'video' | 'audio';
  onClick: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}

export function InspectorVariantThumb({
  hash,
  index,
  selected,
  mediaType,
  onClick,
  onDelete,
  canDelete,
}: InspectorVariantThumbProps) {
  const assetType = mediaType === 'audio' ? 'audio' : mediaType;
  const assetExt = mediaType === 'image' ? 'png' : mediaType === 'video' ? 'mp4' : 'mp3';
  const { url } = useAssetUrl(hash, assetType, assetExt);
  const isSelectable = Boolean(hash);

  return (
    <button
      type="button"
      className={cn(
        'group relative h-16 overflow-hidden rounded-md border bg-muted/40',
        selected ? 'border-primary ring-1 ring-primary/40' : 'border-border',
        isSelectable ? 'hover:bg-muted' : 'cursor-default opacity-70',
      )}
      onClick={onClick}
      disabled={!isSelectable}
      aria-label={`Select variant ${index + 1}`}
    >
      {hash && mediaType === 'image' && url ? (
        <img src={url} alt={`Variant ${index + 1}`} className="h-full w-full object-cover" />
      ) : hash && mediaType === 'video' && url ? (
        <video src={url} className="h-full w-full object-cover" muted preload="metadata" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs font-medium text-muted-foreground">
          V{index + 1}
        </div>
      )}
      <span className="absolute bottom-1 right-1 rounded bg-background/85 px-1 py-0.5 text-[9px] font-semibold uppercase leading-none text-foreground shadow-sm">
        v{index + 1}
      </span>
      {canDelete && onDelete && (
        <span
          role="button"
          tabIndex={0}
          className="absolute top-0.5 right-0.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-destructive/90 text-destructive-foreground hover:bg-destructive cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDelete(); } }}
          aria-label={`Delete variant ${index + 1}`}
        >
          <X className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}
