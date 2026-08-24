import { randomUUID } from 'node:crypto';

export type TargetGeneratedIdKind =
  | 'canvas'
  | 'canvas_placement'
  | 'capability_catalog_snapshot'
  | 'chat'
  | 'context_manifest'
  | 'delivery'
  | 'delivery_item'
  | 'delivery_manifest'
  | 'delivery_manifest_item'
  | 'delivery_protection'
  | 'delivery_export'
  | 'dispatch_operation'
  | 'global_media_asset'
  | 'generated_result'
  | 'generation_attempt'
  | 'generation_request'
  | 'message'
  | 'media_derivation'
  | 'media_derivation_attempt'
  | 'media_derivation_output'
  | 'model_attempt'
  | 'project'
  | 'project_event'
  | 'project_media_ref'
  | 'project_search_document'
  | 'production'
  | 'production_fact_source'
  | 'production_relation'
  | 'private_recovery_envelope'
  | 'run'
  | 'run_activation'
  | 'run_event'
  | 'run_confirmation'
  | 'run_interaction'
  | 'run_resource_entry'
  | 'run_inbox_message'
  | 'result_assessment_attempt'
  | 'review_cut_attempt'
  | 'task_item'
  | 'task_list'
  | 'user_choice'
  | 'production_protection';

export interface TargetStorageEnvironment {
  readonly now: () => string;
  readonly createId: (kind: TargetGeneratedIdKind) => string;
}

export type TargetStorageEnvironmentOptions = Partial<TargetStorageEnvironment>;

export function resolveTargetStorageEnvironment(
  options: TargetStorageEnvironmentOptions = {},
): TargetStorageEnvironment {
  return Object.freeze({
    now: options.now ?? (() => new Date().toISOString()),
    createId: options.createId ?? ((kind) => `${kind}.${randomUUID()}`),
  });
}
