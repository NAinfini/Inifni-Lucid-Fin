import {
  MediaSourceSelectorSchema,
  parseCanonical,
  type GlobalMediaAsset,
  type MediaBlob,
  type ProjectMediaRef,
  z,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import { loadGlobalMediaAsset, loadMediaBlob, loadProjectMediaRecord } from './media-records.js';
import { loadGeneratedResultRecord } from './operation-owner-records.js';
import { loadRun } from './run-records.js';
import { loadRunSnapshots } from './run-snapshots.js';

type MediaSourceSelector = z.output<typeof MediaSourceSelectorSchema>;

export interface ResolvedRunMediaSource {
  readonly blob: MediaBlob;
  readonly globalAsset: GlobalMediaAsset;
  readonly projectMediaRef: ProjectMediaRef | null;
}

function invalid(message: string): TargetStorageError {
  return new TargetStorageError('INVALID_REQUEST', message);
}

function corrupt(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

export function resolveRunMediaSource(
  database: DatabaseSync,
  runId: string,
  sourceValue: MediaSourceSelector,
): ResolvedRunMediaSource {
  const run = loadRun(database, runId);
  const source = parseCanonical(MediaSourceSelectorSchema, sourceValue);
  switch (source.kind) {
    case 'global_asset': {
      const globalAsset = loadGlobalMediaAsset(database, source.id);
      return {
        blob: loadMediaBlob(database, globalAsset.blobHash),
        globalAsset,
        projectMediaRef: null,
      };
    }
    case 'project_media_ref': {
      const projectMediaRef = loadProjectMediaRecord(database, source.id);
      if (projectMediaRef.projectId !== run.projectId) {
        throw invalid(`Project Media reference ${projectMediaRef.id} belongs to another Project`);
      }
      if (projectMediaRef.lifecycle !== 'active') {
        throw invalid(`Project Media reference ${projectMediaRef.id} is detached`);
      }
      const globalAsset = loadGlobalMediaAsset(database, projectMediaRef.globalAssetId);
      return {
        blob: loadMediaBlob(database, globalAsset.blobHash),
        globalAsset,
        projectMediaRef,
      };
    }
    case 'accepted_attachment': {
      const { manifest } = loadRunSnapshots(database, run);
      const attachment = manifest.attachments.find(
        ({ projectMediaRefId }) => projectMediaRefId === source.id,
      );
      if (attachment === undefined) {
        throw invalid(`Project Media reference ${source.id} is not an accepted Run attachment`);
      }
      const projectMediaRef = loadProjectMediaRecord(database, attachment.projectMediaRefId);
      const globalAsset = loadGlobalMediaAsset(database, attachment.globalAssetId);
      if (
        projectMediaRef.projectId !== run.projectId ||
        projectMediaRef.globalAssetId !== attachment.globalAssetId ||
        globalAsset.blobHash !== attachment.blobHash
      ) {
        throw corrupt(`Run ${run.id} accepted attachment no longer matches its frozen identity`);
      }
      return {
        blob: loadMediaBlob(database, attachment.blobHash),
        globalAsset,
        projectMediaRef,
      };
    }
    case 'generated_result': {
      const result = loadGeneratedResultRecord(database, source.id);
      if (result.projectId !== run.projectId || result.runId !== run.id) {
        throw invalid(`Generated Result ${result.id} belongs to another Project or Run`);
      }
      const globalAsset = loadGlobalMediaAsset(database, result.globalMediaAssetId);
      const projectMediaRef = loadProjectMediaRecord(database, result.projectMediaRefId);
      return {
        blob: loadMediaBlob(database, result.mediaBlobHash),
        globalAsset,
        projectMediaRef,
      };
    }
  }
}
