import React from 'react';
import {
  AlertCircle,
  ArrowRight,
  Box,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Film,
  Image,
  Layers3,
  Link2,
  Map,
  Play,
  Sparkles,
} from 'lucide-react';
import type { DomainObjectRef } from '@lucid-fin/target-contracts';
import type { TargetResult } from './api.js';
import { targetCopy } from './copy.js';
import { useTargetEnvironment } from './environment.js';
import type { TargetSharedSelection, TargetWorkspace } from './shared-selection.js';

export interface TargetWorkspaceData {
  readonly canvas: TargetResult<'canvas.get'> | null;
  readonly media: TargetResult<'media.project.list'>['items'];
  readonly production: TargetResult<'production.query'>['items'];
  readonly delivery: TargetResult<'delivery.query'> | null;
}

interface ProjectWorkspaceProps {
  readonly workspace: TargetWorkspace;
  readonly overview: TargetResult<'overview.get'>;
  readonly data: TargetWorkspaceData;
  readonly selection: TargetSharedSelection;
  readonly onSelect: (ref: DomainObjectRef) => void;
  readonly onOpenWorkspace: (workspace: TargetWorkspace) => void;
}

function selected(selection: TargetSharedSelection, ref: DomainObjectRef): boolean {
  return selection.primary?.authority === ref.authority && selection.primary.id === ref.id;
}

function productionLabel(view: TargetWorkspaceData['production'][number]): string {
  const object = view.object;
  if ('title' in object.content) return object.content.title;
  if ('name' in object.content) return object.content.name;
  if ('summary' in object.content) return object.content.summary;
  return object.type;
}

function refForProduction(view: TargetWorkspaceData['production'][number]): DomainObjectRef {
  return {
    authority: 'production',
    id: view.object.id,
    revision: view.object.revision,
    contentHash: view.object.contentHash,
  };
}

function OverviewWorkspace({
  overview,
  data,
  onOpenWorkspace,
}: Pick<ProjectWorkspaceProps, 'overview' | 'data' | 'onOpenWorkspace'>) {
  const { locale } = useTargetEnvironment();
  const waiting = overview.activeRuns.filter((run) =>
    ['waiting_question', 'waiting_confirmation', 'blocked'].includes(run.status),
  );
  const direction = data.production.find((view) => view.object.type === 'direction');
  const recent = [
    data.media[0] === undefined
      ? null
      : `${data.media[0].label} ${locale === 'zh-CN' ? '已加入媒体' : 'added to Media'}`,
    data.production.find((view) => view.object.type === 'shot') === undefined
      ? null
      : `${productionLabel(data.production.find((view) => view.object.type === 'shot')!)} ${locale === 'zh-CN' ? '已更新' : 'updated'}`,
  ].filter((item): item is string => item !== null);

  return (
    <div className="target-workspace target-overview-workspace">
      <header className="target-surface-heading">
        <div>
          <h2>{targetCopy(locale, 'overview')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '先处理需要你的决定，再继续制作。'
              : 'Decisions first, then the work shaping the film.'}
          </p>
        </div>
      </header>

      {waiting.length > 0 && (
        <section
          className="target-feed-section target-decision-section"
          aria-labelledby="target-decisions-heading"
        >
          <header>
            <AlertCircle size={15} />
            <h3 id="target-decisions-heading">{targetCopy(locale, 'decisions')}</h3>
          </header>
          {waiting.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => undefined}
              aria-disabled="true"
              title={targetCopy(locale, 'unsupported')}
            >
              <span>
                <strong>
                  {run.status === 'waiting_confirmation'
                    ? locale === 'zh-CN'
                      ? '确认后继续'
                      : 'Confirmation needed'
                    : locale === 'zh-CN'
                      ? 'Commander 正在等待'
                      : 'Commander is waiting'}
                </strong>
                <small>{run.id}</small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
        </section>
      )}

      <section className="target-feed-section" aria-labelledby="target-direction-heading">
        <header>
          <Sparkles size={15} />
          <h3 id="target-direction-heading">
            {locale === 'zh-CN' ? '当前方向' : 'Current direction'}
          </h3>
        </header>
        {direction?.object.type === 'direction' ? (
          <div className="target-direction-copy">
            <strong>{direction.object.content.summary}</strong>
            <p>{direction.object.content.visualLanguage}</p>
            <span>{direction.object.content.tone}</span>
            <button type="button" onClick={() => onOpenWorkspace('production')}>
              {locale === 'zh-CN' ? '在制作中查看' : 'Open in Production'}
              <ArrowRight size={13} />
            </button>
          </div>
        ) : (
          <div className="target-inline-empty">
            {locale === 'zh-CN'
              ? 'Commander 将从你的首个请求建立方向。'
              : 'Commander will derive direction from your first request.'}
          </div>
        )}
      </section>

      <section className="target-feed-section" aria-labelledby="target-active-heading">
        <header>
          <Clock3 size={15} />
          <h3 id="target-active-heading">{targetCopy(locale, 'activeWork')}</h3>
        </header>
        {overview.activeRuns.length === 0 ? (
          <div className="target-inline-empty">
            {locale === 'zh-CN'
              ? '当前没有活动 Run。'
              : 'No active Run. Start from Commander when ready.'}
          </div>
        ) : (
          overview.activeRuns.map((run) => (
            <div className="target-active-row" key={run.id}>
              <span className="target-active-icon">
                <Clapperboard size={17} />
              </span>
              <span>
                <strong>
                  {run.status === 'recovering'
                    ? locale === 'zh-CN'
                      ? '正在恢复已记录工作'
                      : 'Recovering recorded work'
                    : locale === 'zh-CN'
                      ? 'Commander 正在制作'
                      : 'Commander is producing'}
                </strong>
                <small>
                  {run.model.model} · {run.permissionMode}
                </small>
              </span>
              <span className="target-live-label">
                <span />
                {run.status}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="target-feed-section" aria-labelledby="target-recent-heading">
        <header>
          <Layers3 size={15} />
          <h3 id="target-recent-heading">{targetCopy(locale, 'recentChanges')}</h3>
        </header>
        {recent.length === 0 ? (
          <div className="target-inline-empty">{targetCopy(locale, 'noWorkspaceData')}</div>
        ) : (
          recent.map((item, index) => (
            <div className="target-change-row" key={item}>
              <span>
                {index === 0 ? <Image size={14} /> : <Film size={14} />}
                {item}
              </span>
              <small>{locale === 'zh-CN' ? '最近' : 'Recent'}</small>
            </div>
          ))
        )}
      </section>

      <section
        className="target-readiness-strip"
        aria-label={locale === 'zh-CN' ? '制作与交付状态' : 'Production and delivery readiness'}
      >
        <span>
          <CheckCircle2 size={15} />
          {overview.counts.productionObjects}{' '}
          {locale === 'zh-CN' ? '个制作对象' : 'production objects'}
        </span>
        <span>
          <Film size={15} />
          {overview.counts.media} {locale === 'zh-CN' ? '项媒体' : 'media items'}
        </span>
        <button type="button" onClick={() => onOpenWorkspace('delivery')}>
          {locale === 'zh-CN' ? '检查交付' : 'Check Delivery'}
          <ArrowRight size={13} />
        </button>
      </section>
    </div>
  );
}

function CanvasWorkspace({
  data,
  selection,
  onSelect,
}: Pick<ProjectWorkspaceProps, 'data' | 'selection' | 'onSelect'>) {
  const { locale } = useTargetEnvironment();
  const canvas = data.canvas;
  return (
    <div className="target-workspace target-canvas-workspace">
      <header className="target-surface-heading is-compact">
        <div>
          <h2>{targetCopy(locale, 'canvas')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '空间工作区 · 只拥有位置、分组和连线'
              : 'Spatial workspace · placement, grouping, and edges only'}
          </p>
        </div>
        <span>
          {canvas?.placements.length ?? 0} {locale === 'zh-CN' ? '个放置对象' : 'placements'}
        </span>
      </header>
      <div
        className="target-canvas-field"
        aria-label={locale === 'zh-CN' ? '空间工作区' : 'Spatial workspace'}
      >
        {canvas === null || canvas.placements.length === 0 ? (
          <div className="target-canvas-empty">
            <Map size={24} />
            <strong>
              {locale === 'zh-CN' ? '把项目对象放在这里' : 'Place Project objects here'}
            </strong>
            <span>
              {locale === 'zh-CN'
                ? '选择现有对象，或让 Commander 整理当前工作。'
                : 'Select existing objects, attach media, or ask Commander to arrange the work.'}
            </span>
          </div>
        ) : (
          canvas.placements.map((placement, index) => {
            const ref: DomainObjectRef = {
              authority: placement.target.targetType,
              id: placement.target.targetId,
              revision: placement.target.targetRevision,
              contentHash: placement.target.targetContentHash,
            };
            const label = data.production.find((view) => view.object.id === ref.id);
            return (
              <button
                key={placement.id}
                type="button"
                className={`target-canvas-node${selected(selection, ref) ? ' is-selected' : ''}`}
                style={{
                  left: `${8 + (index % 3) * 31}%`,
                  top: `${12 + Math.floor(index / 3) * 28}%`,
                }}
                onClick={() => onSelect(ref)}
                aria-label={`${locale === 'zh-CN' ? '选择' : 'Select'} ${label ? productionLabel(label) : ref.id}`}
              >
                <span className="target-canvas-node-media">
                  <Film size={24} />
                </span>
                <span>
                  <strong>{label ? productionLabel(label) : ref.id}</strong>
                  <small>{ref.authority.replaceAll('_', ' ')}</small>
                </span>
              </button>
            );
          })
        )}
        <div className="target-canvas-key">
          <Link2 size={13} />
          {locale === 'zh-CN' ? '拖动只改变空间位置' : 'Dragging changes spatial placement only'}
        </div>
      </div>
    </div>
  );
}

function MediaWorkspace({
  data,
  selection,
  onSelect,
}: Pick<ProjectWorkspaceProps, 'data' | 'selection' | 'onSelect'>) {
  const { locale } = useTargetEnvironment();
  return (
    <div className="target-workspace target-media-workspace">
      <header className="target-surface-heading">
        <div>
          <h2>{targetCopy(locale, 'media')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '项目媒体、候选结果、比较与来源'
              : 'Project Library, candidates, comparison, and provenance'}
          </p>
        </div>
        <div className="target-view-tabs" role="tablist" aria-label={targetCopy(locale, 'media')}>
          <button type="button" role="tab" aria-selected="true">
            {locale === 'zh-CN' ? '项目媒体' : 'Library'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            title={targetCopy(locale, 'unsupported')}
          >
            {locale === 'zh-CN' ? '候选' : 'Candidates'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            title={targetCopy(locale, 'unsupported')}
          >
            {locale === 'zh-CN' ? '比较' : 'Compare'}
          </button>
        </div>
      </header>
      {data.media.length === 0 ? (
        <div className="target-workspace-empty">
          <Image size={24} />
          <strong>
            {locale === 'zh-CN'
              ? '添加源媒体或请求生成'
              : 'Attach source media or request generation'}
          </strong>
          <span>{targetCopy(locale, 'noWorkspaceData')}</span>
        </div>
      ) : (
        <div className="target-media-grid">
          {data.media.map((media, index) => {
            const ref: DomainObjectRef = {
              authority: 'project_media_ref',
              id: media.id,
              revision: media.revision,
              contentHash: media.contentHash,
            };
            return (
              <button
                key={media.id}
                className={selected(selection, ref) ? 'is-selected' : ''}
                type="button"
                onClick={() => onSelect(ref)}
                aria-label={`${locale === 'zh-CN' ? '选择' : 'Select'} ${media.label}`}
              >
                <span className="target-media-thumbnail">
                  <Image size={24} />
                  <small>{String(index + 1).padStart(2, '0')}</small>
                </span>
                <span className="target-media-copy">
                  <strong>{media.label}</strong>
                  <small>{media.roles.join(' · ')}</small>
                  <em>
                    {media.productionLinks.length}{' '}
                    {locale === 'zh-CN' ? '个制作关联' : 'production links'}
                  </em>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductionWorkspace({
  data,
  selection,
  onSelect,
}: Pick<ProjectWorkspaceProps, 'data' | 'selection' | 'onSelect'>) {
  const { locale } = useTargetEnvironment();
  const groups = [
    { key: 'direction', label: locale === 'zh-CN' ? '方向' : 'Direction', types: ['direction'] },
    {
      key: 'story',
      label: locale === 'zh-CN' ? '故事' : 'Story',
      types: ['story', 'sequence', 'scene', 'beat'],
    },
    {
      key: 'world',
      label: locale === 'zh-CN' ? '世界' : 'World',
      types: ['character', 'location', 'equipment', 'prop', 'wardrobe', 'world_fact'],
    },
    { key: 'shots', label: locale === 'zh-CN' ? '镜头' : 'Shots', types: ['shot'] },
  ];
  return (
    <div className="target-workspace target-production-workspace">
      <header className="target-surface-heading">
        <div>
          <h2>{targetCopy(locale, 'production')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '影片的创意事实、结构和来源'
              : 'Creative truth, shot structure, and provenance'}
          </p>
        </div>
      </header>
      {data.production.length === 0 ? (
        <div className="target-workspace-empty">
          <Clapperboard size={24} />
          <strong>
            {locale === 'zh-CN' ? '从证据建立制作结构' : 'Build only the structure the film needs'}
          </strong>
          <span>{targetCopy(locale, 'noWorkspaceData')}</span>
        </div>
      ) : (
        groups.map((group) => {
          const objects = data.production.filter((view) => group.types.includes(view.object.type));
          if (objects.length === 0) return null;
          return (
            <section className="target-production-section" key={group.key}>
              <header>
                <h3>{group.label}</h3>
                <span>{objects.length}</span>
              </header>
              {objects.map((view) => {
                const ref = refForProduction(view);
                const object = view.object;
                const description =
                  'description' in object.content
                    ? object.content.description
                    : 'summary' in object.content
                      ? object.content.summary
                      : 'premise' in object.content
                        ? object.content.premise
                        : '';
                return (
                  <button
                    key={object.id}
                    type="button"
                    className={selected(selection, ref) ? 'is-selected' : ''}
                    onClick={() => onSelect(ref)}
                    aria-label={`${locale === 'zh-CN' ? '选择' : 'Select'} ${productionLabel(view)}`}
                  >
                    <span className="target-object-icon">
                      {object.type === 'shot' ? <Clapperboard size={16} /> : <Box size={16} />}
                    </span>
                    <span>
                      <strong>{productionLabel(view)}</strong>
                      <small>{description}</small>
                    </span>
                    <em>{object.type.replaceAll('_', ' ')}</em>
                  </button>
                );
              })}
            </section>
          );
        })
      )}
    </div>
  );
}

function DeliveryWorkspace({
  data,
  selection,
  onSelect,
}: Pick<ProjectWorkspaceProps, 'data' | 'selection' | 'onSelect'>) {
  const { locale } = useTargetEnvironment();
  const plans = data.delivery?.plans ?? [];
  return (
    <div className="target-workspace target-delivery-workspace">
      <header className="target-surface-heading">
        <div>
          <h2>{targetCopy(locale, 'delivery')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '排序、审看、检查并导出已选择的源素材'
              : 'Sequence, review, check, and export selected source media'}
          </p>
        </div>
      </header>
      {plans.length === 0 ? (
        <div className="target-workspace-empty">
          <Play size={25} />
          <strong>
            {locale === 'zh-CN'
              ? '交付由已选择的项目结果组装'
              : 'Delivery is assembled from selected Project results'}
          </strong>
          <span>
            {locale === 'zh-CN'
              ? '选择镜头结果后，可让 Commander 准备可逆的初始序列。'
              : 'Select Shot results, then ask Commander to prepare a reversible draft sequence.'}
          </span>
          <button type="button" aria-disabled="true" title={targetCopy(locale, 'unsupported')}>
            {locale === 'zh-CN' ? '准备审看片' : 'Prepare Review Cut'}
          </button>
        </div>
      ) : (
        plans.map((plan) => {
          const ref: DomainObjectRef = {
            authority: 'delivery',
            id: plan.id,
            revision: plan.revision,
            contentHash: plan.contentHash,
          };
          const activeItems = plan.items
            .filter((item) => item.lifecycle === 'active')
            .sort((left, right) => left.order - right.order);
          return (
            <section
              className={`target-delivery-plan${selected(selection, ref) ? ' is-selected' : ''}`}
              key={plan.id}
            >
              <header>
                <button type="button" onClick={() => onSelect(ref)}>
                  <strong>{plan.name}</strong>
                  <small>
                    {plan.formatIntent.width}×{plan.formatIntent.height} ·{' '}
                    {plan.formatIntent.frameRate} fps
                  </small>
                </button>
                <span>
                  {activeItems.length} {locale === 'zh-CN' ? '项' : 'items'}
                </span>
              </header>
              <div className="target-delivery-sequence">
                {activeItems.map((item) => (
                  <div key={item.id}>
                    <span>{String(item.order + 1).padStart(2, '0')}</span>
                    <Film size={16} />
                    <strong>{item.shot.id}</strong>
                    <small>
                      {item.trimStartMs}–{item.trimEndMs} ms · {item.audioPolicy}
                    </small>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

export function ProjectWorkspace(props: ProjectWorkspaceProps) {
  if (props.workspace === 'overview') return <OverviewWorkspace {...props} />;
  if (props.workspace === 'canvas') return <CanvasWorkspace {...props} />;
  if (props.workspace === 'media') return <MediaWorkspace {...props} />;
  if (props.workspace === 'production') return <ProductionWorkspace {...props} />;
  return <DeliveryWorkspace {...props} />;
}
