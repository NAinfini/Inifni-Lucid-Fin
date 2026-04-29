import React from 'react';
import { Pencil, Save, X } from 'lucide-react';
import type { Asset } from '../../../store/slices/assets.js';
import { t, getLocale } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { formatSize, formatDuration, localizeAssetType } from './utils.js';

export interface AssetDetailPanelProps {
  asset: Asset;
  editingName: string;
  isEditingName: boolean;
  onEditingNameChange: (name: string) => void;
  onStartEditing: () => void;
  onSaveName: () => void;
  onCancelEditing: () => void;
  onClose: () => void;
}

export function AssetDetailPanel({
  asset,
  editingName,
  isEditingName,
  onEditingNameChange,
  onStartEditing,
  onSaveName,
  onCancelEditing,
  onClose,
}: AssetDetailPanelProps) {
  return (
    <div className="border-t border-border/60 px-3 py-2 space-y-1.5 bg-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium">{t('assetBrowser.details')}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <input
          value={editingName}
          onChange={(e) => onEditingNameChange(e.target.value)}
          disabled={!isEditingName}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isEditingName) onSaveName();
            if (e.key === 'Escape') onCancelEditing();
          }}
          className={cn(
            'flex-1 rounded border px-2 py-1 text-xs outline-none',
            isEditingName
              ? 'border-primary bg-background focus:ring-1 focus:ring-primary'
              : 'border-transparent bg-muted text-foreground cursor-default',
          )}
        />
        {isEditingName ? (
          <>
            <button
              type="button"
              onClick={onSaveName}
              className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground"
              title={t('action.save')}
            >
              <Save className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onCancelEditing}
              className="rounded px-1.5 py-1 text-destructive hover:bg-destructive/10"
              title={t('action.cancel')}
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStartEditing}
            className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
            title={t('contextMenu.rename')}
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="space-y-1 text-[10px] text-muted-foreground">
        <div className="flex justify-between">
          <span>{t('assetBrowser.fields.type')}</span>
          <span>{localizeAssetType(asset.type)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t('assetBrowser.fields.size')}</span>
          <span>{formatSize(asset.size)}</span>
        </div>
        {asset.format && (
          <div className="flex justify-between">
            <span>{t('assetBrowser.fields.format')}</span>
            <span className="uppercase">{asset.format}</span>
          </div>
        )}
        {asset.width != null && asset.height != null && (
          <div className="flex justify-between">
            <span>{t('assetBrowser.fields.dimensions')}</span>
            <span>
              {asset.width}&times;{asset.height}
            </span>
          </div>
        )}
        {asset.duration != null && (asset.type === 'video' || asset.type === 'audio') && (
          <div className="flex justify-between">
            <span>{t('assetBrowser.fields.duration')}</span>
            <span>{formatDuration(asset.duration)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>{t('assetBrowser.fields.hash')}</span>
          <span className="font-mono truncate max-w-[120px]" title={asset.hash}>
            {asset.hash.slice(0, 16)}...
          </span>
        </div>
        <div className="flex justify-between">
          <span>{t('assetBrowser.created')}</span>
          <span>{new Date(asset.createdAt).toLocaleString(getLocale())}</span>
        </div>
        {asset.provider && (
          <div className="flex justify-between">
            <span>{t('assetBrowser.fields.provider')}</span>
            <span>{asset.provider}</span>
          </div>
        )}
        {asset.prompt && (
          <div className="flex flex-col gap-0.5">
            <span>{t('assetBrowser.fields.prompt')}</span>
            <span className="text-[10px] text-foreground/80 break-words leading-snug">
              {asset.prompt}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
