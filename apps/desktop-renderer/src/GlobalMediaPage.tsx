import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Paperclip } from 'lucide-react';
import type { WireResult } from './api.js';
import { wireResult } from './api.js';
import { appCopy } from './copy.js';
import { useDesktopEnvironment } from './environment.js';
import { GlobalRail } from './GlobalRail.js';

type GlobalMediaItem = WireResult<'media.global.list'>['items'][number];

function errorSummary(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Global Media could not be loaded.';
}

function formatBytes(
  byteLength: number,
  locale: ReturnType<typeof useDesktopEnvironment>['locale'],
): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    byteLength / (1024 * 1024),
  )} MB`;
}

function mediaEmptyCopy(locale: ReturnType<typeof useDesktopEnvironment>['locale']): string {
  return locale === 'zh-CN'
    ? '还没有全局媒体。导入一个素材以在项目间复用。'
    : 'No Global Media yet. Import media to reuse it across Projects.';
}

export function GlobalMediaPage() {
  const { api, createRequestId, locale } = useDesktopEnvironment();
  const [items, setItems] = useState<readonly GlobalMediaItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRequestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++listRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await wireResult(
        api.media.globalList({
          requestId: createRequestId(),
          input: { kinds: [], query: '', page: { cursor: null, limit: 100 } },
        }),
      );
      if (request !== listRequestRef.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (request === listRequestRef.current) setError(errorSummary(cause));
    } finally {
      if (request === listRequestRef.current) setLoading(false);
    }
  }, [api, createRequestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const cursor = nextCursor;
    if (cursor === null || loading || pageLoading || importing || removingId !== null) return;
    const request = listRequestRef.current;
    setPageLoading(true);
    try {
      const page = await wireResult(
        api.media.globalList({
          requestId: createRequestId(),
          input: { kinds: [], query: '', page: { cursor, limit: 100 } },
        }),
      );
      if (request !== listRequestRef.current) return;
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.asset.id, item] as const));
        for (const item of page.items) byId.set(item.asset.id, item);
        return [...byId.values()];
      });
      setNextCursor((current) => (current === cursor ? page.nextCursor : current));
    } catch (cause) {
      if (request === listRequestRef.current) setError(errorSummary(cause));
    } finally {
      if (request === listRequestRef.current) setPageLoading(false);
    }
  };

  const importMedia = async () => {
    if (importing || removingId !== null || loading || pageLoading) return;
    listRequestRef.current += 1;
    setImporting(true);
    setError(null);
    try {
      const grant = await wireResult(
        api.os.mediaPick({
          requestId: createRequestId(),
          input: { kinds: ['image', 'video', 'audio', 'document'], multiple: false },
        }),
      );
      const imported = await wireResult(
        api.media.globalImport({
          requestId: createRequestId(),
          input: { capabilityToken: grant.capabilityToken, displayName: null, tags: [] },
        }),
      );
      setItems((current) => [
        imported,
        ...current.filter((item) => item.asset.id !== imported.asset.id),
      ]);
    } catch (cause) {
      setError(errorSummary(cause));
    } finally {
      setImporting(false);
    }
  };

  const removeMedia = async (item: GlobalMediaItem) => {
    if (importing || removingId !== null || loading || pageLoading) return;
    listRequestRef.current += 1;
    setRemovingId(item.asset.id);
    setError(null);
    try {
      await wireResult(
        api.media.globalRemove({
          requestId: createRequestId(),
          input: {
            globalAssetId: item.asset.id,
            expectedRevision: item.asset.revision,
            expectedContentHash: item.asset.contentHash,
          },
        }),
      );
      setItems((current) => current.filter((candidate) => candidate.asset.id !== item.asset.id));
    } catch (cause) {
      setError(errorSummary(cause));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="lucid-home-shell">
      <GlobalRail active="media" />
      <section className="lucid-home-content" aria-labelledby="global-media-heading">
        <header className="lucid-home-header">
          <div>
            <h1 id="global-media-heading">{appCopy(locale, 'globalMedia')}</h1>
            <p>
              {locale === 'zh-CN'
                ? '将素材导入可复用的全局媒体库。'
                : 'Import references into a reusable Global Media library.'}
            </p>
          </div>
          <button
            className="lucid-primary-button"
            type="button"
            onClick={() => void importMedia()}
            disabled={importing || removingId !== null || loading || pageLoading}
          >
            <Paperclip size={15} />
            {importing
              ? appCopy(locale, 'loading')
              : locale === 'zh-CN'
                ? '导入媒体'
                : 'Import Media'}
          </button>
        </header>

        {error !== null && (
          <div className="lucid-state lucid-state-error" role="alert">
            <strong>
              {locale === 'zh-CN' ? '无法完成媒体请求' : 'Could not complete the media request'}
            </strong>
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>
              {locale === 'zh-CN' ? '重新加载媒体' : 'Reload media'}
            </button>
          </div>
        )}

        <section className="lucid-global-media-list" aria-label={appCopy(locale, 'globalMedia')}>
          {loading ? (
            <div className="lucid-state" role="status">
              {appCopy(locale, 'loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="lucid-project-empty">
              <Film size={20} />
              <p>{mediaEmptyCopy(locale)}</p>
            </div>
          ) : (
            items.map((item) => (
              <article className="lucid-global-media-row" key={item.asset.id}>
                <span className="lucid-project-thumb" aria-hidden="true">
                  <Film size={18} />
                </span>
                <div className="lucid-global-media-summary">
                  <strong>{item.asset.displayName}</strong>
                  <span>
                    {item.asset.filename} · {item.mimeType} · {formatBytes(item.byteLength, locale)}
                  </span>
                  {item.asset.tags.length > 0 && <small>{item.asset.tags.join(' · ')}</small>}
                </div>
                <button
                  className="lucid-secondary-button"
                  type="button"
                  aria-label={`${locale === 'zh-CN' ? '移除' : 'Remove'} ${item.asset.displayName}`}
                  disabled={importing || removingId !== null || loading || pageLoading}
                  onClick={() => void removeMedia(item)}
                >
                  {removingId === item.asset.id
                    ? appCopy(locale, 'loading')
                    : locale === 'zh-CN'
                      ? '移除'
                      : 'Remove'}
                </button>
              </article>
            ))
          )}
          {nextCursor !== null && (
            <button
              className="lucid-conversation-pager"
              type="button"
              disabled={loading || pageLoading || importing || removingId !== null}
              onClick={() => void loadMore()}
            >
              {pageLoading
                ? appCopy(locale, 'loading')
                : locale === 'zh-CN'
                  ? '载入更多媒体'
                  : 'Load more Media'}
            </button>
          )}
        </section>
      </section>
    </div>
  );
}
