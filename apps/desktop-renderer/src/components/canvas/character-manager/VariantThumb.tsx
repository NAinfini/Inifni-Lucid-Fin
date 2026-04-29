import React from 'react';
import { X } from 'lucide-react';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import { cn } from '../../../lib/utils.js';

interface VariantThumbProps {
  hash: string;
  isActive: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

export function VariantThumb({ hash, isActive, onClick, onDelete }: VariantThumbProps) {
  const { url, markFailed } = useAssetUrl(hash, 'image', 'png');
  if (!url) return null;
  return (
    <div className="relative shrink-0 group">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'h-12 w-16 rounded border overflow-hidden transition-colors',
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
