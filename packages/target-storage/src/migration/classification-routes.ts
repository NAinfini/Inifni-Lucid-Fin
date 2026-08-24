import type { LegacySourceExpectedSchemas } from './source-preflight.js';

export type LegacyRowClassifierId =
  | 'media_blob'
  | 'global_media_catalog'
  | 'project_canvas'
  | 'production'
  | 'delivery'
  | 'chat'
  | 'run_history'
  | 'task_execution_history'
  | 'prompt_provenance'
  | 'project_settings'
  | 'legacy_skill_candidate'
  | 'offline_snapshot'
  | 'derived_projection';

export interface LegacyRowClassificationRoute {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly classifier: LegacyRowClassifierId;
  readonly tables: readonly string[];
}

export const LEGACY_ROW_CLASSIFICATION_ROUTES: readonly LegacyRowClassificationRoute[] = [
  {
    database: 'main',
    classifier: 'media_blob',
    tables: ['asset_contents'],
  },
  {
    database: 'main',
    classifier: 'global_media_catalog',
    tables: ['asset_entries', 'asset_folders'],
  },
  {
    database: 'main',
    classifier: 'project_canvas',
    tables: ['canvases', 'canvas_edges', 'canvas_nodes'],
  },
  {
    database: 'main',
    classifier: 'production',
    tables: [
      'character_folders',
      'characters',
      'color_styles',
      'dependencies',
      'equipment',
      'equipment_folders',
      'location_folders',
      'locations',
      'scripts',
    ],
  },
  {
    database: 'main',
    classifier: 'delivery',
    tables: ['delivery_asset_refs'],
  },
  {
    database: 'main',
    classifier: 'chat',
    tables: ['commander_sessions'],
  },
  {
    database: 'main',
    classifier: 'run_history',
    tables: [
      'commander_events',
      'commander_run_attachments',
      'commander_run_canvases',
      'commander_runs',
    ],
  },
  {
    database: 'main',
    classifier: 'task_execution_history',
    tables: [
      'plan_approvals',
      'plan_documents',
      'task_artifacts',
      'task_attempts',
      'task_decisions',
      'task_dependencies',
      'task_evaluations',
      'task_events',
      'task_lists',
      'tasks',
    ],
  },
  {
    database: 'main',
    classifier: 'prompt_provenance',
    tables: ['prompt_assemblies'],
  },
  {
    database: 'main',
    classifier: 'project_settings',
    tables: ['project_settings'],
  },
  {
    database: 'main',
    classifier: 'legacy_skill_candidate',
    tables: ['custom_shot_templates', 'preset_overrides'],
  },
  {
    database: 'main',
    classifier: 'offline_snapshot',
    tables: ['snapshots'],
  },
  {
    database: 'main',
    classifier: 'derived_projection',
    tables: ['asset_entries_fts'],
  },
  {
    database: 'prompts',
    classifier: 'legacy_skill_candidate',
    tables: ['process_prompts', 't_prompt_overrides'],
  },
] as const;

export function legacyRowClassifierFor(
  database: keyof LegacySourceExpectedSchemas,
  table: string,
): LegacyRowClassifierId {
  const route = LEGACY_ROW_CLASSIFICATION_ROUTES.find(
    (candidate) => candidate.database === database && candidate.tables.includes(table),
  );
  if (!route) throw new Error(`Unsupported Legacy classification source ${database}.${table}`);
  return route.classifier;
}
