import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle, RefreshCw, Volume2 } from 'lucide-react';
import type { MediaPreviewSourceV1 } from '@lucid-fin/target-contracts';
import { canonicalJson } from '@lucid-fin/target-contracts/canonical-json';
import { targetResult, type TargetResult } from './api.js';
import type { TargetLocale } from './copy.js';
import { useTargetEnvironment } from './environment.js';

type PreviewGrant = TargetResult<'media.preview.issue'>;
type PreviewMediaElement = HTMLVideoElement | HTMLAudioElement;

export interface SynchronizedPlaybackGroup {
  readonly error: string | null;
  register(id: string, element: PreviewMediaElement | null): void;
  play(id: string, element: PreviewMediaElement): void;
  pause(id: string, element: PreviewMediaElement): void;
  seek(id: string, element: PreviewMediaElement): void;
  changeRate(id: string, element: PreviewMediaElement): void;
}

export function useSynchronizedPlayback(): SynchronizedPlaybackGroup {
  const elements = useRef(new Map<string, PreviewMediaElement>());
  const [error, setError] = useState<string | null>(null);

  const peers = useCallback((id: string) => {
    return [...elements.current.entries()].filter(([peerId]) => peerId !== id);
  }, []);

  return useMemo(
    () => ({
      error,
      register(id: string, element: PreviewMediaElement | null) {
        if (element === null) elements.current.delete(id);
        else elements.current.set(id, element);
      },
      play(id: string, element: PreviewMediaElement) {
        setError(null);
        for (const [, peer] of peers(id)) {
          if (Math.abs(peer.currentTime - element.currentTime) > 0.05) {
            peer.currentTime = element.currentTime;
          }
          peer.playbackRate = element.playbackRate;
          if (peer.paused) {
            void peer.play().catch(() => {
              setError('Synchronized playback could not start for every candidate.');
            });
          }
        }
      },
      pause(id: string, _element: PreviewMediaElement) {
        for (const [, peer] of peers(id)) {
          if (!peer.paused) peer.pause();
        }
      },
      seek(id: string, element: PreviewMediaElement) {
        for (const [, peer] of peers(id)) {
          if (Math.abs(peer.currentTime - element.currentTime) > 0.05) {
            peer.currentTime = element.currentTime;
          }
        }
      },
      changeRate(id: string, element: PreviewMediaElement) {
        for (const [, peer] of peers(id)) peer.playbackRate = element.playbackRate;
      },
    }),
    [error, peers],
  );
}

function errorMessage(cause: unknown, locale: TargetLocale): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return locale === 'zh-CN' ? '无法载入媒体预览。' : 'The media preview could not be loaded.';
}

export function TargetMediaPreview({
  projectId,
  source,
  label,
  syncId,
  sync,
}: {
  readonly projectId: string;
  readonly source: MediaPreviewSourceV1;
  readonly label: string;
  readonly syncId?: string;
  readonly sync?: SynchronizedPlaybackGroup;
}) {
  const { api, createRequestId, locale } = useTargetEnvironment();
  const sourceIdentity = canonicalJson(source);
  const canonicalSource = useMemo(
    // Rehydrate the semantic identity so equivalent inline props do not rotate preview grants.
    () => JSON.parse(sourceIdentity) as MediaPreviewSourceV1,
    [sourceIdentity],
  );
  const [attempt, setAttempt] = useState(0);
  const [grant, setGrant] = useState<PreviewGrant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setGrant(null);
    setError(null);
    setLoading(true);
    void targetResult(
      api.media.previewIssue({
        requestId: createRequestId(),
        input: { projectId, source: canonicalSource },
      }),
    )
      .then((next) => {
        if (current) setGrant(next);
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setError(errorMessage(cause, locale));
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, attempt, canonicalSource, createRequestId, locale, projectId]);

  const failMedia = () => {
    setGrant(null);
    setLoading(false);
    setError(
      locale === 'zh-CN'
        ? '媒体预览已失效或无法读取。'
        : 'The preview expired or could not be read.',
    );
  };
  const loaded = () => setLoading(false);
  const retry = () => setAttempt((value) => value + 1);
  const register = (element: PreviewMediaElement | null) => {
    if (sync !== undefined && syncId !== undefined) sync.register(syncId, element);
  };

  return (
    <div
      className="target-media-preview"
      data-state={error ? 'error' : loading ? 'loading' : 'ready'}
    >
      {grant?.kind === 'image' && (
        <img src={grant.url} alt={label} onLoad={loaded} onError={failMedia} />
      )}
      {grant?.kind === 'video' && (
        <video
          ref={register}
          src={grant.url}
          aria-label={label}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={loaded}
          onError={failMedia}
          onPlay={(event) => sync?.play(syncId ?? '', event.currentTarget)}
          onPause={(event) => sync?.pause(syncId ?? '', event.currentTarget)}
          onSeeking={(event) => sync?.seek(syncId ?? '', event.currentTarget)}
          onRateChange={(event) => sync?.changeRate(syncId ?? '', event.currentTarget)}
        />
      )}
      {grant?.kind === 'audio' && (
        <div className="target-audio-preview">
          <Volume2 size={24} aria-hidden="true" />
          <audio
            ref={register}
            src={grant.url}
            aria-label={label}
            controls
            preload="metadata"
            onLoadedMetadata={loaded}
            onError={failMedia}
            onPlay={(event) => sync?.play(syncId ?? '', event.currentTarget)}
            onPause={(event) => sync?.pause(syncId ?? '', event.currentTarget)}
            onSeeking={(event) => sync?.seek(syncId ?? '', event.currentTarget)}
            onRateChange={(event) => sync?.changeRate(syncId ?? '', event.currentTarget)}
          />
        </div>
      )}
      {loading && (
        <span className="target-preview-status" role="status">
          <LoaderCircle size={20} />
          {locale === 'zh-CN' ? '正在载入预览…' : 'Loading preview…'}
        </span>
      )}
      {error !== null && (
        <span className="target-preview-status is-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button type="button" onClick={retry}>
            <RefreshCw size={13} />
            {locale === 'zh-CN' ? '重试' : 'Retry'}
          </button>
        </span>
      )}
    </div>
  );
}

export function UnsupportedMediaPreview({ label }: { readonly label: string }) {
  const { locale } = useTargetEnvironment();
  return (
    <div className="target-media-preview is-unavailable" aria-label={label}>
      <AlertCircle size={20} />
      <span>
        {locale === 'zh-CN' ? '此成品没有可播放预览。' : 'This artifact has no playable preview.'}
      </span>
    </div>
  );
}
