import React from 'react';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import { cn } from '../../../lib/utils.js';

interface VariantThumbProps {
  hash: string;
  isActive: boolean;
  onClick?: () => void;
}

export function VariantThumb({ hash, isActive, onClick }: VariantThumbProps) {
  const { url, markFailed } = useAssetUrl(hash, 'image', 'png');
  if (!url) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 h-8 w-12 rounded border overflow-hidden transition-colors',
        isActive
          ? 'border-primary ring-1 ring-primary/40'
          : 'border-border/60 hover:border-primary/50',
      )}
    >
      <img src={url} alt="variant" className="h-full w-full object-cover" onError={markFailed} />
    </button>
  );
}
