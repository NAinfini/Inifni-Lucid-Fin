import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';
import { openConfiguredDatabase } from '../kernel/database.js';
import {
  preflightLegacyCanvasNodeMedia,
  type LegacyCanvasNodeMediaPreflightBlocker,
  type LegacyCanvasNodeMediaPreflightReport,
} from './canvas-node-media-preflight.js';
import {
  preflightLegacyDelivery,
  type LegacyDeliveryPreflightBlocker,
  type LegacyDeliveryPreflightReport,
} from './delivery-preflight.js';
import {
  preflightLegacyEntityReferenceImages,
  type LegacyEntityReferenceImagesPreflightBlocker,
  type LegacyEntityReferenceImagesPreflightReport,
} from './entity-reference-images-preflight.js';
import {
  preflightLegacyGenerationMetadata,
  type LegacyGenerationMetadataPreflightBlocker,
  type LegacyGenerationMetadataPreflightReport,
} from './generation-metadata-preflight.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import {
  preflightLegacyMedia,
  type LegacyMediaPreflightBlocker,
  type LegacyMediaPreflightReport,
} from './media-preflight.js';
import {
  preflightLegacyProductionMediaAttempts,
  type LegacyProductionMediaAttemptPreflightBlocker,
  type LegacyProductionMediaAttemptPreflightReport,
} from './production-media-attempt-preflight.js';
import {
  preflightLegacySources,
  type LegacySourcePreflightBlocker,
  type LegacySourcesPreflightReport,
} from './source-preflight.js';
import {
  preflightLegacyScalarMediaReferences,
  type LegacyScalarMediaPreflightReport,
  type LegacyScalarMediaReferenceBlocker,
} from './scalar-media-preflight.js';
import {
  preflightLegacySnapshotMedia,
  type LegacySnapshotMediaPreflightBlocker,
  type LegacySnapshotMediaPreflightReport,
} from './snapshot-media-preflight.js';
import {
  preflightLegacyTaskEvaluationMedia,
  type LegacyTaskEvaluationMediaPreflightBlocker,
  type LegacyTaskEvaluationMediaPreflightReport,
} from './task-evaluation-media-preflight.js';

export interface LegacyPreflightPaths {
  readonly mainDatabasePath: string;
  readonly promptsDatabasePath: string;
  readonly assetsRoot: string;
}

export type LegacyPreflightBlocker =
  | {
      readonly source: 'main' | 'prompts';
      readonly blocker: LegacySourcePreflightBlocker;
    }
  | {
      readonly source: 'media';
      readonly blocker: LegacyMediaPreflightBlocker;
    }
  | {
      readonly source: 'scalar-media';
      readonly blocker: LegacyScalarMediaReferenceBlocker;
    }
  | {
      readonly source: 'generation-metadata';
      readonly blocker: LegacyGenerationMetadataPreflightBlocker;
    }
  | {
      readonly source: 'entity-reference-images';
      readonly blocker: LegacyEntityReferenceImagesPreflightBlocker;
    }
  | {
      readonly source: 'delivery';
      readonly blocker: LegacyDeliveryPreflightBlocker;
    }
  | {
      readonly source: 'canvas-node-media';
      readonly blocker: LegacyCanvasNodeMediaPreflightBlocker;
    }
  | {
      readonly source: 'production-media-attempt';
      readonly blocker: LegacyProductionMediaAttemptPreflightBlocker;
    }
  | {
      readonly source: 'task-evaluation-media';
      readonly blocker: LegacyTaskEvaluationMediaPreflightBlocker;
    }
  | {
      readonly source: 'snapshot-media';
      readonly blocker: LegacySnapshotMediaPreflightBlocker;
    };

export type LegacyMediaPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacyMediaPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason: 'source_preflight_blocked';
    };

export type LegacyScalarMediaPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacyScalarMediaPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason: 'source_preflight_blocked' | 'media_preflight_blocked';
    };

export type LegacyGenerationMetadataPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacyGenerationMetadataPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason:
        'source_preflight_blocked' | 'media_preflight_blocked' | 'scalar_media_preflight_blocked';
    };

export type LegacyEntityReferenceImagesPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacyEntityReferenceImagesPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason:
        | 'source_preflight_blocked'
        | 'media_preflight_blocked'
        | 'scalar_media_preflight_blocked'
        | 'generation_metadata_preflight_blocked';
    };

export type LegacyDeliveryPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacyDeliveryPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason:
        | 'source_preflight_blocked'
        | 'media_preflight_blocked'
        | 'scalar_media_preflight_blocked'
        | 'generation_metadata_preflight_blocked'
        | 'entity_reference_images_preflight_blocked';
    };

export type LegacyCanvasNodeMediaPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacyCanvasNodeMediaPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason:
        | 'source_preflight_blocked'
        | 'media_preflight_blocked'
        | 'scalar_media_preflight_blocked'
        | 'generation_metadata_preflight_blocked'
        | 'entity_reference_images_preflight_blocked'
        | 'delivery_preflight_blocked';
    };

export type LegacyProductionMediaAttemptPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacyProductionMediaAttemptPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason:
        | 'source_preflight_blocked'
        | 'media_preflight_blocked'
        | 'scalar_media_preflight_blocked'
        | 'generation_metadata_preflight_blocked'
        | 'entity_reference_images_preflight_blocked'
        | 'delivery_preflight_blocked'
        | 'canvas_node_media_preflight_blocked';
    };

export type LegacyTaskEvaluationMediaPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacyTaskEvaluationMediaPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason:
        | 'source_preflight_blocked'
        | 'media_preflight_blocked'
        | 'scalar_media_preflight_blocked'
        | 'generation_metadata_preflight_blocked'
        | 'entity_reference_images_preflight_blocked'
        | 'delivery_preflight_blocked'
        | 'canvas_node_media_preflight_blocked'
        | 'production_media_attempt_preflight_blocked';
    };

export type LegacySnapshotMediaPreflightDisposition =
  | {
      readonly status: 'checked';
      readonly report: LegacySnapshotMediaPreflightReport;
    }
  | {
      readonly status: 'skipped';
      readonly reason:
        | 'source_preflight_blocked'
        | 'media_preflight_blocked'
        | 'scalar_media_preflight_blocked'
        | 'generation_metadata_preflight_blocked'
        | 'entity_reference_images_preflight_blocked'
        | 'delivery_preflight_blocked'
        | 'canvas_node_media_preflight_blocked'
        | 'production_media_attempt_preflight_blocked'
        | 'task_evaluation_media_preflight_blocked';
    };

export interface LegacyPreflightReport {
  readonly source: LegacySourcesPreflightReport;
  readonly media: LegacyMediaPreflightDisposition;
  readonly scalarMedia: LegacyScalarMediaPreflightDisposition;
  readonly generationMetadata: LegacyGenerationMetadataPreflightDisposition;
  readonly entityReferenceImages: LegacyEntityReferenceImagesPreflightDisposition;
  readonly delivery: LegacyDeliveryPreflightDisposition;
  readonly canvasNodeMedia: LegacyCanvasNodeMediaPreflightDisposition;
  readonly productionMediaAttempt: LegacyProductionMediaAttemptPreflightDisposition;
  readonly taskEvaluationMedia: LegacyTaskEvaluationMediaPreflightDisposition;
  readonly snapshotMedia: LegacySnapshotMediaPreflightDisposition;
  readonly fingerprint: string;
  readonly blockers: readonly LegacyPreflightBlocker[];
  readonly ok: boolean;
}

/**
 * Owns the complete read-only Legacy input preflight lifecycle. No source
 * path is copied into the returned report.
 */
export async function preflightLegacyInputs(
  paths: LegacyPreflightPaths,
): Promise<LegacyPreflightReport> {
  let main: DatabaseSync | undefined;
  let prompts: DatabaseSync | undefined;
  try {
    main = openConfiguredDatabase(resolve(paths.mainDatabasePath), true);
    prompts = openConfiguredDatabase(resolve(paths.promptsDatabasePath), true);
    const source = preflightLegacySources({ main, prompts }, I0_LEGACY_SOURCE_SCHEMAS);
    const sourceBlockers: LegacyPreflightBlocker[] = source.blockers.map(
      ({ database, blocker }) => ({ source: database, blocker }),
    );
    if (!source.ok) {
      const media = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      const scalarMedia = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      const generationMetadata = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      const entityReferenceImages = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      const delivery = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      const canvasNodeMedia = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      const productionMediaAttempt = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      const taskEvaluationMedia = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      const snapshotMedia = {
        status: 'skipped',
        reason: 'source_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          media,
          scalarMedia,
          generationMetadata,
          entityReferenceImages,
          delivery,
          canvasNodeMedia,
          productionMediaAttempt,
          taskEvaluationMedia,
          snapshotMedia,
        }),
        blockers: sourceBlockers,
        ok: false,
      };
    }

    const mediaReport = await preflightLegacyMedia(main, paths.assetsRoot);
    const media = { status: 'checked', report: mediaReport } as const;
    const mediaBlockers: LegacyPreflightBlocker[] = [
      ...sourceBlockers,
      ...mediaReport.blockers.map((blocker) => ({ source: 'media' as const, blocker })),
    ];
    if (!mediaReport.ok) {
      const scalarMedia = {
        status: 'skipped',
        reason: 'media_preflight_blocked',
      } as const;
      const generationMetadata = {
        status: 'skipped',
        reason: 'media_preflight_blocked',
      } as const;
      const entityReferenceImages = {
        status: 'skipped',
        reason: 'media_preflight_blocked',
      } as const;
      const delivery = {
        status: 'skipped',
        reason: 'media_preflight_blocked',
      } as const;
      const canvasNodeMedia = {
        status: 'skipped',
        reason: 'media_preflight_blocked',
      } as const;
      const productionMediaAttempt = {
        status: 'skipped',
        reason: 'media_preflight_blocked',
      } as const;
      const taskEvaluationMedia = {
        status: 'skipped',
        reason: 'media_preflight_blocked',
      } as const;
      const snapshotMedia = {
        status: 'skipped',
        reason: 'media_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          mediaFingerprint: mediaReport.fingerprint,
          scalarMedia,
          generationMetadata,
          entityReferenceImages,
          delivery,
          canvasNodeMedia,
          productionMediaAttempt,
          taskEvaluationMedia,
          snapshotMedia,
        }),
        blockers: mediaBlockers,
        ok: false,
      };
    }

    const scalarMediaReport = preflightLegacyScalarMediaReferences(main);
    const scalarMedia = { status: 'checked', report: scalarMediaReport } as const;
    const blockers: LegacyPreflightBlocker[] = [
      ...mediaBlockers,
      ...scalarMediaReport.blockers.map((blocker) => ({
        source: 'scalar-media' as const,
        blocker,
      })),
    ];
    if (!scalarMediaReport.ok) {
      const generationMetadata = {
        status: 'skipped',
        reason: 'scalar_media_preflight_blocked',
      } as const;
      const entityReferenceImages = {
        status: 'skipped',
        reason: 'scalar_media_preflight_blocked',
      } as const;
      const delivery = {
        status: 'skipped',
        reason: 'scalar_media_preflight_blocked',
      } as const;
      const canvasNodeMedia = {
        status: 'skipped',
        reason: 'scalar_media_preflight_blocked',
      } as const;
      const productionMediaAttempt = {
        status: 'skipped',
        reason: 'scalar_media_preflight_blocked',
      } as const;
      const taskEvaluationMedia = {
        status: 'skipped',
        reason: 'scalar_media_preflight_blocked',
      } as const;
      const snapshotMedia = {
        status: 'skipped',
        reason: 'scalar_media_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          mediaFingerprint: mediaReport.fingerprint,
          scalarMediaFingerprint: scalarMediaReport.fingerprint,
          generationMetadata,
          entityReferenceImages,
          delivery,
          canvasNodeMedia,
          productionMediaAttempt,
          taskEvaluationMedia,
          snapshotMedia,
        }),
        blockers,
        ok: false,
      };
    }

    const generationMetadataReport = preflightLegacyGenerationMetadata(main);
    const generationMetadata = { status: 'checked', report: generationMetadataReport } as const;
    blockers.push(
      ...generationMetadataReport.blockers.map((blocker) => ({
        source: 'generation-metadata' as const,
        blocker,
      })),
    );
    if (!generationMetadataReport.ok) {
      const entityReferenceImages = {
        status: 'skipped',
        reason: 'generation_metadata_preflight_blocked',
      } as const;
      const delivery = {
        status: 'skipped',
        reason: 'generation_metadata_preflight_blocked',
      } as const;
      const canvasNodeMedia = {
        status: 'skipped',
        reason: 'generation_metadata_preflight_blocked',
      } as const;
      const productionMediaAttempt = {
        status: 'skipped',
        reason: 'generation_metadata_preflight_blocked',
      } as const;
      const taskEvaluationMedia = {
        status: 'skipped',
        reason: 'generation_metadata_preflight_blocked',
      } as const;
      const snapshotMedia = {
        status: 'skipped',
        reason: 'generation_metadata_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          mediaFingerprint: mediaReport.fingerprint,
          scalarMediaFingerprint: scalarMediaReport.fingerprint,
          generationMetadataFingerprint: generationMetadataReport.fingerprint,
          entityReferenceImages,
          delivery,
          canvasNodeMedia,
          productionMediaAttempt,
          taskEvaluationMedia,
          snapshotMedia,
        }),
        blockers,
        ok: false,
      };
    }

    const entityReferenceImagesReport = preflightLegacyEntityReferenceImages(main);
    const entityReferenceImages = {
      status: 'checked',
      report: entityReferenceImagesReport,
    } as const;
    blockers.push(
      ...entityReferenceImagesReport.blockers.map((blocker) => ({
        source: 'entity-reference-images' as const,
        blocker,
      })),
    );
    if (!entityReferenceImagesReport.ok) {
      const delivery = {
        status: 'skipped',
        reason: 'entity_reference_images_preflight_blocked',
      } as const;
      const canvasNodeMedia = {
        status: 'skipped',
        reason: 'entity_reference_images_preflight_blocked',
      } as const;
      const productionMediaAttempt = {
        status: 'skipped',
        reason: 'entity_reference_images_preflight_blocked',
      } as const;
      const taskEvaluationMedia = {
        status: 'skipped',
        reason: 'entity_reference_images_preflight_blocked',
      } as const;
      const snapshotMedia = {
        status: 'skipped',
        reason: 'entity_reference_images_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          mediaFingerprint: mediaReport.fingerprint,
          scalarMediaFingerprint: scalarMediaReport.fingerprint,
          generationMetadataFingerprint: generationMetadataReport.fingerprint,
          entityReferenceImagesFingerprint: entityReferenceImagesReport.fingerprint,
          delivery,
          canvasNodeMedia,
          productionMediaAttempt,
          taskEvaluationMedia,
          snapshotMedia,
        }),
        blockers,
        ok: false,
      };
    }

    const deliveryReport = preflightLegacyDelivery(main);
    const delivery = { status: 'checked', report: deliveryReport } as const;
    blockers.push(
      ...deliveryReport.blockers.map((blocker) => ({
        source: 'delivery' as const,
        blocker,
      })),
    );
    if (!deliveryReport.ok) {
      const canvasNodeMedia = {
        status: 'skipped',
        reason: 'delivery_preflight_blocked',
      } as const;
      const productionMediaAttempt = {
        status: 'skipped',
        reason: 'delivery_preflight_blocked',
      } as const;
      const taskEvaluationMedia = {
        status: 'skipped',
        reason: 'delivery_preflight_blocked',
      } as const;
      const snapshotMedia = {
        status: 'skipped',
        reason: 'delivery_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          mediaFingerprint: mediaReport.fingerprint,
          scalarMediaFingerprint: scalarMediaReport.fingerprint,
          generationMetadataFingerprint: generationMetadataReport.fingerprint,
          entityReferenceImagesFingerprint: entityReferenceImagesReport.fingerprint,
          deliveryFingerprint: deliveryReport.fingerprint,
          canvasNodeMedia,
          productionMediaAttempt,
          taskEvaluationMedia,
          snapshotMedia,
        }),
        blockers,
        ok: false,
      };
    }

    const canvasNodeMediaReport = preflightLegacyCanvasNodeMedia(main);
    const canvasNodeMedia = { status: 'checked', report: canvasNodeMediaReport } as const;
    blockers.push(
      ...canvasNodeMediaReport.blockers.map((blocker) => ({
        source: 'canvas-node-media' as const,
        blocker,
      })),
    );
    if (!canvasNodeMediaReport.ok) {
      const productionMediaAttempt = {
        status: 'skipped',
        reason: 'canvas_node_media_preflight_blocked',
      } as const;
      const taskEvaluationMedia = {
        status: 'skipped',
        reason: 'canvas_node_media_preflight_blocked',
      } as const;
      const snapshotMedia = {
        status: 'skipped',
        reason: 'canvas_node_media_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          mediaFingerprint: mediaReport.fingerprint,
          scalarMediaFingerprint: scalarMediaReport.fingerprint,
          generationMetadataFingerprint: generationMetadataReport.fingerprint,
          entityReferenceImagesFingerprint: entityReferenceImagesReport.fingerprint,
          deliveryFingerprint: deliveryReport.fingerprint,
          canvasNodeMediaFingerprint: canvasNodeMediaReport.fingerprint,
          productionMediaAttempt,
          taskEvaluationMedia,
          snapshotMedia,
        }),
        blockers,
        ok: false,
      };
    }

    const productionMediaAttemptReport = preflightLegacyProductionMediaAttempts(main);
    const productionMediaAttempt = {
      status: 'checked',
      report: productionMediaAttemptReport,
    } as const;
    blockers.push(
      ...productionMediaAttemptReport.blockers.map((blocker) => ({
        source: 'production-media-attempt' as const,
        blocker,
      })),
    );
    if (!productionMediaAttemptReport.ok) {
      const taskEvaluationMedia = {
        status: 'skipped',
        reason: 'production_media_attempt_preflight_blocked',
      } as const;
      const snapshotMedia = {
        status: 'skipped',
        reason: 'production_media_attempt_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          mediaFingerprint: mediaReport.fingerprint,
          scalarMediaFingerprint: scalarMediaReport.fingerprint,
          generationMetadataFingerprint: generationMetadataReport.fingerprint,
          entityReferenceImagesFingerprint: entityReferenceImagesReport.fingerprint,
          deliveryFingerprint: deliveryReport.fingerprint,
          canvasNodeMediaFingerprint: canvasNodeMediaReport.fingerprint,
          productionMediaAttemptFingerprint: productionMediaAttemptReport.fingerprint,
          taskEvaluationMedia,
          snapshotMedia,
        }),
        blockers,
        ok: false,
      };
    }

    const taskEvaluationMediaReport = preflightLegacyTaskEvaluationMedia(main);
    const taskEvaluationMedia = {
      status: 'checked',
      report: taskEvaluationMediaReport,
    } as const;
    blockers.push(
      ...taskEvaluationMediaReport.blockers.map((blocker) => ({
        source: 'task-evaluation-media' as const,
        blocker,
      })),
    );
    if (!taskEvaluationMediaReport.ok) {
      const snapshotMedia = {
        status: 'skipped',
        reason: 'task_evaluation_media_preflight_blocked',
      } as const;
      return {
        source,
        media,
        scalarMedia,
        generationMetadata,
        entityReferenceImages,
        delivery,
        canvasNodeMedia,
        productionMediaAttempt,
        taskEvaluationMedia,
        snapshotMedia,
        fingerprint: hashCanonical({
          sourceSchemaFingerprint: source.schemaFingerprint,
          sourceContentFingerprint: source.contentFingerprint,
          mediaFingerprint: mediaReport.fingerprint,
          scalarMediaFingerprint: scalarMediaReport.fingerprint,
          generationMetadataFingerprint: generationMetadataReport.fingerprint,
          entityReferenceImagesFingerprint: entityReferenceImagesReport.fingerprint,
          deliveryFingerprint: deliveryReport.fingerprint,
          canvasNodeMediaFingerprint: canvasNodeMediaReport.fingerprint,
          productionMediaAttemptFingerprint: productionMediaAttemptReport.fingerprint,
          taskEvaluationMediaFingerprint: taskEvaluationMediaReport.fingerprint,
          snapshotMedia,
        }),
        blockers,
        ok: false,
      };
    }

    const snapshotMediaReport = preflightLegacySnapshotMedia(main);
    const snapshotMedia = {
      status: 'checked',
      report: snapshotMediaReport,
    } as const;
    blockers.push(
      ...snapshotMediaReport.blockers.map((blocker) => ({
        source: 'snapshot-media' as const,
        blocker,
      })),
    );
    return {
      source,
      media,
      scalarMedia,
      generationMetadata,
      entityReferenceImages,
      delivery,
      canvasNodeMedia,
      productionMediaAttempt,
      taskEvaluationMedia,
      snapshotMedia,
      fingerprint: hashCanonical({
        sourceSchemaFingerprint: source.schemaFingerprint,
        sourceContentFingerprint: source.contentFingerprint,
        mediaFingerprint: mediaReport.fingerprint,
        scalarMediaFingerprint: scalarMediaReport.fingerprint,
        generationMetadataFingerprint: generationMetadataReport.fingerprint,
        entityReferenceImagesFingerprint: entityReferenceImagesReport.fingerprint,
        deliveryFingerprint: deliveryReport.fingerprint,
        canvasNodeMediaFingerprint: canvasNodeMediaReport.fingerprint,
        productionMediaAttemptFingerprint: productionMediaAttemptReport.fingerprint,
        taskEvaluationMediaFingerprint: taskEvaluationMediaReport.fingerprint,
        snapshotMediaFingerprint: snapshotMediaReport.fingerprint,
      }),
      blockers,
      ok: blockers.length === 0,
    };
  } finally {
    prompts?.close();
    main?.close();
  }
}
