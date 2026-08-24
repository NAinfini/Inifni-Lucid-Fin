import { useCallback, useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ChevronDown, ChevronUp, Film, GripVertical, LibraryBig, Plus, Replace, Trash2, Volume2 } from 'lucide-react';
import type { OrderedDeliveryItem } from '@lucid-fin/contracts';
import type { AppDispatch, RootState } from '../../../../store/index.js';
import { selectActiveCanvas } from '../../../../store/slices/canvas/canvas-selectors.js';
import {
  addDeliveryItem,
  removeDeliveryItems,
  reorderDeliveryItem,
  replaceDeliveryItem,
  setDeliveryEmbeddedAudio,
  trimDeliveryItem,
} from '../../../../store/slices/canvas/canvas.js';
import { getAPI } from '../../../../utils/api.js';
import { useAssetUrl } from '../../../../hooks/useAssetUrl.js';
import { useI18n } from '../../../../hooks/use-i18n.js';
import { cn } from '../../../../lib/utils.js';
import { Button } from '../../../ui/Button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../ui/Dialog.js';
import { Switch } from '../../../ui/Switch.js';
import {
  canvasDeliveryMediaSources,
  libraryDeliveryMediaSources,
  type DeliveryMediaSource,
} from './delivery-media-sources.js';

interface MediaDetails {
  durationMs: number;
  hasAudio: boolean;
  format: string;
}

function asDurationMs(value: number | undefined): number | null {
  if (!Number.isFinite(value) || !value || value <= 0) return null;
  return Math.round(value * 1_000);
}

function formatDuration(value: number | null | undefined): string {
  if (!value || value <= 0) return '—';
  const totalSeconds = Math.round(value / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatSecondsInput(valueMs: number): string {
  return String(valueMs / 1_000);
}

function sourceForItem(
  item: OrderedDeliveryItem,
  sourcesByHash: Map<string, DeliveryMediaSource>,
): DeliveryMediaSource | undefined {
  return sourcesByHash.get(item.selectedVideoHash);
}

export function DeliveryView() {
  const { t } = useI18n();
  const dispatch = useDispatch<AppDispatch>();
  const canvas = useSelector(selectActiveCanvas);
  const assets = useSelector((state: RootState) => state.assets.items);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerScope, setPickerScope] = useState<'canvas' | 'library'>('canvas');
  const [replaceShotId, setReplaceShotId] = useState<string | null>(null);
  const [detailsByHash, setDetailsByHash] = useState<Record<string, MediaDetails>>({});
  const [pickerError, setPickerError] = useState<string | null>(null);

  const canvasSources = useMemo(
    () => (canvas ? canvasDeliveryMediaSources(canvas, assets) : []),
    [assets, canvas],
  );
  const librarySources = useMemo(() => libraryDeliveryMediaSources(assets), [assets]);
  const allSources = useMemo(
    () => [...canvasSources, ...librarySources],
    [canvasSources, librarySources],
  );
  const sourcesByHash = useMemo(() => {
    const sources = new Map<string, DeliveryMediaSource>();
    for (const source of allSources) {
      if (!sources.has(source.assetHash)) sources.set(source.assetHash, source);
    }
    return sources;
  }, [allSources]);
  const sequence = canvas?.deliverySequence;

  const inspect = useCallback(async (source: DeliveryMediaSource): Promise<MediaDetails | null> => {
    const cached = detailsByHash[source.assetHash];
    if (cached) return cached;
    const api = getAPI();
    if (!api?.assetContent) return null;
    try {
      const metadata = await api.assetContent.inspect(source.assetHash);
      const durationMs = asDurationMs(metadata.duration);
      if (!durationMs) return null;
      const details = {
        durationMs,
        hasAudio: metadata.hasAudio === true,
        format: metadata.format.replace(/^\./, '') || source.format,
      };
      setDetailsByHash((current) => ({ ...current, [source.assetHash]: details }));
      return details;
    } catch {
      return null;
    }
  }, [detailsByHash]);

  useEffect(() => {
    const currentSources = sequence?.items
      .map((item) => sourceForItem(item, sourcesByHash))
      .filter((source): source is DeliveryMediaSource => Boolean(source)) ?? [];
    void Promise.all(currentSources.map((source) => inspect(source)));
  }, [inspect, sequence?.items, sourcesByHash]);

  const openPicker = useCallback((shotId: string | null = null) => {
    setReplaceShotId(shotId);
    setPickerError(null);
    setPickerOpen(true);
  }, []);

  const chooseSource = useCallback(async (source: DeliveryMediaSource) => {
    if (!canvas) return;
    const details = await inspect(source);
    if (!details) {
      setPickerError(t('delivery.metadataUnavailable'));
      return;
    }
    const shotId = replaceShotId ?? source.shotId;
    const item: OrderedDeliveryItem = {
      shotId,
      selectedVideoHash: source.assetHash,
      trimInMs: 0,
      trimOutMs: details.durationMs,
      embeddedAudioEnabled: details.hasAudio,
    };
    if (sequence?.items.some((candidate) => candidate.shotId === shotId)) {
      dispatch(replaceDeliveryItem(item));
    } else {
      dispatch(addDeliveryItem(item));
    }
    setPickerOpen(false);
    setReplaceShotId(null);
  }, [canvas, dispatch, inspect, replaceShotId, sequence?.items, t]);

  const reorder = useCallback((shotId: string, toIndex: number) => {
    dispatch(reorderDeliveryItem({ shotId, toIndex }));
  }, [dispatch]);

  if (!canvas) return null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label={t('delivery.ariaLabel')}>
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{t('delivery.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('delivery.description')}</p>
        </div>
        <Button type="button" size="sm" onClick={() => openPicker()}>
          <Plus className="h-3.5 w-3.5" />
          {t('delivery.addVideo')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!sequence?.items.length ? (
          <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-border/80 bg-card/30 px-6 text-center">
            <Film className="mb-3 h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t('delivery.emptyTitle')}</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{t('delivery.emptyDescription')}</p>
            <Button type="button" size="sm" className="mt-4" onClick={() => openPicker()}>
              <LibraryBig className="h-3.5 w-3.5" />
              {t('delivery.addFirstVideo')}
            </Button>
          </div>
        ) : (
          <ol className="mx-auto flex w-full max-w-5xl flex-col gap-2" aria-label={t('delivery.orderedShots')}>
            {sequence.items.map((item, index) => (
              <DeliveryRow
                key={item.shotId}
                item={item}
                index={index}
                count={sequence.items.length}
                source={sourceForItem(item, sourcesByHash)}
                details={detailsByHash[item.selectedVideoHash]}
                onMove={reorder}
                onReplace={() => openPicker(item.shotId)}
                onRemove={() => dispatch(removeDeliveryItems([item.shotId]))}
                onTrim={(trimInMs, trimOutMs) => dispatch(trimDeliveryItem({ shotId: item.shotId, trimInMs, trimOutMs }))}
                onAudioChange={(embeddedAudioEnabled) => dispatch(setDeliveryEmbeddedAudio({ shotId: item.shotId, embeddedAudioEnabled }))}
              />
            ))}
          </ol>
        )}
      </div>

      <p className="shrink-0 border-t border-border bg-card/50 px-4 py-2 text-xs text-muted-foreground">
        {t('delivery.reviewCutOnly')}
      </p>

      <MediaPicker
        open={pickerOpen}
        source={pickerScope}
        sources={pickerScope === 'canvas' ? canvasSources : librarySources}
        error={pickerError}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) {
            setReplaceShotId(null);
            setPickerError(null);
          }
        }}
        onSourceChange={setPickerScope}
        onChoose={chooseSource}
      />
    </section>
  );
}

function DeliveryRow({
  item,
  index,
  count,
  source,
  details,
  onMove,
  onReplace,
  onRemove,
  onTrim,
  onAudioChange,
}: {
  item: OrderedDeliveryItem;
  index: number;
  count: number;
  source: DeliveryMediaSource | undefined;
  details: MediaDetails | undefined;
  onMove: (shotId: string, toIndex: number) => void;
  onReplace: () => void;
  onRemove: () => void;
  onTrim: (trimInMs: number, trimOutMs: number) => void;
  onAudioChange: (enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [trimIn, setTrimIn] = useState(formatSecondsInput(item.trimInMs));
  const [trimOut, setTrimOut] = useState(formatSecondsInput(item.trimOutMs));
  const { url, markFailed } = useAssetUrl(item.selectedVideoHash, 'video', details?.format ?? source?.format ?? 'mp4');
  const maxDuration = details?.durationMs ?? source?.durationMs ?? null;
  const canToggleAudio = details?.hasAudio === true;

  useEffect(() => {
    setTrimIn(formatSecondsInput(item.trimInMs));
    setTrimOut(formatSecondsInput(item.trimOutMs));
  }, [item.trimInMs, item.trimOutMs]);

  const commitTrim = useCallback(() => {
    const trimInMs = Math.round(Number(trimIn) * 1_000);
    const trimOutMs = Math.round(Number(trimOut) * 1_000);
    if (
      !Number.isInteger(trimInMs) ||
      !Number.isInteger(trimOutMs) ||
      trimInMs < 0 ||
      trimOutMs <= trimInMs ||
      (maxDuration !== null && trimOutMs > maxDuration)
    ) {
      setTrimIn(formatSecondsInput(item.trimInMs));
      setTrimOut(formatSecondsInput(item.trimOutMs));
      return;
    }
    onTrim(trimInMs, trimOutMs);
  }, [item.trimInMs, item.trimOutMs, maxDuration, onTrim, trimIn, trimOut]);

  const onDragStart = (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-lucid-delivery-shot', item.shotId);
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const draggedShotId = event.dataTransfer.getData('application/x-lucid-delivery-shot');
    if (draggedShotId && draggedShotId !== item.shotId) onMove(draggedShotId, index);
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    onMove(item.shotId, event.key === 'ArrowUp' ? index - 1 : index + 1);
  };

  return (
    <li
      draggable
      tabIndex={0}
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      className={cn(
        'grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-lg border border-border bg-card p-3 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/70',
        dragging && 'opacity-50',
      )}
      aria-label={`${t('delivery.shot')} ${index + 1}: ${source?.title ?? item.shotId}`}
    >
      <button
        type="button"
        aria-label={t('delivery.dragToReorder')}
        className="row-span-2 flex h-10 w-7 cursor-grab items-center justify-center self-center text-muted-foreground active:cursor-grabbing"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex h-10 min-w-8 items-center justify-center self-center rounded-md bg-muted px-2 text-xs font-semibold tabular-nums text-muted-foreground">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="flex min-w-0 items-start gap-3">
        <VideoThumbnail url={url} title={source?.title ?? item.shotId} onError={markFailed} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{source?.title ?? t('delivery.sourceUnavailable')}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.shotId} · {formatDuration(maxDuration)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button type="button" size="icon" variant="ghost" disabled={index === 0} onClick={() => onMove(item.shotId, index - 1)} aria-label={t('delivery.moveUp')}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" disabled={index === count - 1} onClick={() => onMove(item.shotId, index + 1)} aria-label={t('delivery.moveDown')}>
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onReplace}>
            <Replace className="h-3.5 w-3.5" />
            {t('delivery.replace')}
          </Button>
          <Button type="button" size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={t('delivery.remove')}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="col-start-3 flex flex-wrap items-end gap-x-4 gap-y-2 border-t border-border/70 pt-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t('delivery.trimIn')}</span>
          <input
            aria-label={t('delivery.trimIn')}
            type="number"
            step="0.1"
            min={0}
            max={maxDuration === null ? undefined : maxDuration / 1_000}
            value={trimIn}
            onChange={(event) => setTrimIn(event.target.value)}
            onBlur={commitTrim}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            className="h-7 w-24 rounded-md border border-input bg-background px-2 text-xs tabular-nums text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span>s</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t('delivery.trimOut')}</span>
          <input
            aria-label={t('delivery.trimOut')}
            type="number"
            step="0.1"
            min={1}
            max={maxDuration === null ? undefined : maxDuration / 1_000}
            value={trimOut}
            onChange={(event) => setTrimOut(event.target.value)}
            onBlur={commitTrim}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            className="h-7 w-24 rounded-md border border-input bg-background px-2 text-xs tabular-nums text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span>s</span>
        </label>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Volume2 className="h-3.5 w-3.5" />
          <span>{t('delivery.embeddedAudio')}</span>
          <Switch
            aria-label={t('delivery.embeddedAudio')}
            checked={item.embeddedAudioEnabled && canToggleAudio}
            disabled={!canToggleAudio}
            onCheckedChange={(enabled) => {
              if (canToggleAudio) onAudioChange(enabled);
            }}
          />
          {!canToggleAudio && <span>{t('delivery.noEmbeddedAudio')}</span>}
        </div>
      </div>
    </li>
  );
}

function VideoThumbnail({
  url,
  title,
  onError,
}: {
  url: string | null;
  title: string;
  onError: () => void;
}) {
  return (
    <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {url ? (
        <video aria-label={title} className="h-full w-full object-cover" src={url} muted preload="metadata" onError={onError} />
      ) : (
        <Film className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

function MediaPicker({
  open,
  source,
  sources,
  error,
  onOpenChange,
  onSourceChange,
  onChoose,
}: {
  open: boolean;
  source: 'canvas' | 'library';
  sources: readonly DeliveryMediaSource[];
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSourceChange: (source: 'canvas' | 'library') => void;
  onChoose: (source: DeliveryMediaSource) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('delivery.chooseVideo')}</DialogTitle>
          <DialogDescription>{t('delivery.pickerDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 border-b border-border">
          {(['canvas', 'library'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              aria-pressed={source === scope}
              onClick={() => onSourceChange(scope)}
              className={cn(
                'border-b-2 px-2.5 py-2 text-xs font-medium transition-colors',
                source === scope ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {scope === 'canvas' ? t('delivery.canvasVideos') : t('delivery.globalMedia')}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="max-h-80 overflow-auto pr-1">
          {sources.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('delivery.noVideoSources')}</p>
          ) : (
            <ul className="space-y-1">
              {sources.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={item.title}
                    onClick={() => { void onChoose(item); }}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(item.durationMs)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
