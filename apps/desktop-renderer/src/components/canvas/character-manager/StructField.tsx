import React from 'react';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';

interface ListThumbProps {
  hash?: string;
}

export function ListThumb({ hash }: ListThumbProps) {
  const { url, markFailed } = useAssetUrl(hash, 'image', 'png');
  if (!url) return <div className="shrink-0 w-8 h-8 rounded bg-muted/50" />;
  return (
    <img src={url} alt="" className="shrink-0 w-8 h-8 rounded object-cover" onError={markFailed} />
  );
}

interface StructFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function StructField({ label, value, onChange }: StructFieldProps) {
  return (
    <div className="space-y-0.5">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-muted px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder={label}
      />
    </div>
  );
}
