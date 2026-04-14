import React from 'react';
import { useSelector } from 'react-redux';
import { Image } from 'lucide-react';
import { useAssetUrl } from '../../../hooks/useAssetUrl.js';
import { useI18n } from '../../../hooks/use-i18n.js';
import { selectImageAssets, type Asset } from '../../../store/slices/assets.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/Dialog.js';

interface AssetThumbProps {
  asset: Asset;
  onSelect: (hash: string) => void;
}

function AssetThumb({ asset, onSelect }: AssetThumbProps) {
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

interface AssetPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (hash: string) => void;
}

export function AssetPickerDialog({ open, onClose, onSelect }: AssetPickerDialogProps) {
  const { t } = useI18n();
  const imageAssets = useSelector(selectImageAssets);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('entity.selectImage')}</DialogTitle>
        </DialogHeader>
        {imageAssets.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            {t('entity.noImageAssetsFound')}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-h-96 overflow-y-auto p-1">
            {imageAssets.map((asset) => (
              <AssetThumb key={asset.id} asset={asset} onSelect={onSelect} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
