import React, { useState } from 'react';
import { normalizeCharacterRefSlot, type ReferenceImage } from '@lucid-fin/contracts';
import { Image, ImageOff, Upload, X } from 'lucide-react';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import { useI18n } from '../../../hooks/use-i18n.js';
import { t as translate } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { getAPI } from '../../../utils/api.js';
import { VariantThumb } from './VariantThumb.js';

interface SingleReferenceImageProps {
  referenceImages: ReferenceImage[];
  onUpload: () => void;
  onRemove: (slot: string) => void;
  onFromAssets: () => void;
  onDropHash?: (hash: string) => void;
  onSelectVariant?: (hash: string) => void;
  onDeleteVariant?: (hash: string) => void;
  entityType?: string;
  entityId?: string;
  slot?: string;
}

export function SingleReferenceImage({
  referenceImages,
  onUpload,
  onRemove,
  onFromAssets,
  onDropHash,
  onSelectVariant,
  onDeleteVariant,
  entityType,
  entityId,
  slot,
}: SingleReferenceImageProps) {
  const { t } = useI18n();
  const [isDragOver, setIsDragOver] = useState(false);
  const mainRef =
    referenceImages.find((r) => normalizeCharacterRefSlot(r.slot) === 'main') || referenceImages[0];
  const { url, markFailed } = useAssetUrl(mainRef?.assetHash, 'image', 'png');

  const handleDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (
      types.includes('Files') ||
      types.includes('application/x-lucid-asset') ||
      types.includes('application/x-lucid-ref-image')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!onDropHash) return;

    const assetRaw = e.dataTransfer.getData('application/x-lucid-asset');
    if (assetRaw) {
      try {
        const payload = JSON.parse(assetRaw) as { hash: string; type: string };
        if (payload.hash && payload.type === 'image') onDropHash(payload.hash);
      } catch {
        /* ignore */
      }
      return;
    }

    const refRaw = e.dataTransfer.getData('application/x-lucid-ref-image');
    if (refRaw) {
      try {
        const payload = JSON.parse(refRaw) as { assetHash: string };
        if (payload.assetHash) onDropHash(payload.assetHash);
      } catch {
        /* ignore */
      }
      return;
    }

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file && file.type.startsWith('image/')) {
        const filePath = (file as { path?: string }).path ?? '';
        if (filePath) {
          const api = getAPI();
          void api?.asset
            .import(filePath, 'image')
            .then((ref) => {
              const r = ref as { hash: string } | null;
              if (r?.hash) onDropHash(r.hash);
            })
            .catch(() => {
              /* image import failure is non-critical */
            });
        }
      }
    }
  };

  return (
    <div className="space-y-1.5">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'rounded border w-full',
          mainRef?.assetHash ? 'border-primary/50 bg-primary/5' : 'border-dashed border-border/70',
          isDragOver && 'border-blue-400/70 bg-blue-500/5 ring-2 ring-blue-400/40',
        )}
      >
        {url ? (
          <div className="relative w-full aspect-[3/2] bg-muted rounded overflow-hidden">
            <img
              src={url}
              alt="Reference"
              className="h-full w-full object-contain"
              onError={markFailed}
              draggable={Boolean(mainRef?.assetHash && entityType && entityId && slot)}
              onDragStart={
                mainRef?.assetHash && entityType && entityId && slot
                  ? (e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData(
                        'application/x-lucid-ref-image',
                        JSON.stringify({
                          assetHash: mainRef.assetHash,
                          entityType,
                          entityId,
                          slot,
                        }),
                      );
                      e.dataTransfer.effectAllowed = 'copy';
                    }
                  : undefined
              }
            />
            {isDragOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-blue-500/10">
                <span className="rounded border border-dashed border-blue-400/70 bg-blue-500/10 px-3 py-1 text-xs text-blue-400">
                  {t('entity.dropHere')}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center aspect-[3/2] gap-2">
            {isDragOver ? (
              <span className="text-xs text-blue-400">{t('entity.dropImageHere')}</span>
            ) : mainRef?.assetHash ? (
              <>
                <ImageOff className="w-8 h-8 text-destructive/40" />
                <span className="text-[10px] text-destructive/60">{t('entity.brokenImage')}</span>
              </>
            ) : (
              <Image className="w-8 h-8 text-muted-foreground/40" />
            )}
            {!isDragOver && !mainRef?.assetHash && (
              <span className="text-xs text-muted-foreground">
                {translate('characterManager.upload')}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 p-1.5">
          <button
            type="button"
            onClick={onUpload}
            className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] hover:bg-muted/80 transition-colors"
            aria-label={translate('characterManager.upload')}
          >
            <Upload className="w-3 h-3" aria-hidden="true" />
            {translate('characterManager.upload')}
          </button>
          <button
            type="button"
            onClick={onFromAssets}
            className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] hover:bg-muted/80 transition-colors"
            aria-label={t('entity.fromAssets')}
          >
            <Image className="w-3 h-3" aria-hidden="true" />
            {t('entity.fromAssets')}
          </button>
          {mainRef?.assetHash && (
            <button
              type="button"
              onClick={() => onRemove(mainRef.slot)}
              className="ml-auto flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] hover:bg-destructive/20 transition-colors"
              aria-label={t('entity.removeImage')}
            >
              <X className="w-3 h-3" aria-hidden="true" />
              {t('entity.removeImage')}
            </button>
          )}
        </div>
      </div>
      {url && mainRef?.variants && mainRef.variants.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground/70 shrink-0">
            {t('characterManager.variants')}:
          </span>
          <div className="flex gap-1 overflow-x-auto">
            {mainRef.variants.map((variantHash) => (
              <VariantThumb
                key={variantHash}
                hash={variantHash}
                isActive={variantHash === mainRef.assetHash}
                onClick={variantHash === mainRef.assetHash ? undefined : () => onSelectVariant?.(variantHash)}
                onDelete={onDeleteVariant ? () => onDeleteVariant(variantHash) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
