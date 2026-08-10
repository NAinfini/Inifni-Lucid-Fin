/**
 * Phase F — public surface snapshot.
 *
 * The set of named exports from `@lucid-fin/application` is part of the
 * plugin contract. Accidentally re-exporting an internal symbol (for
 * example a contract object, `EvidenceLedger`, or a predicate helper)
 * widens that surface silently and makes it hard to refactor the
 * exit-contract internals later without breaking external callers.
 *
 * This test fails loudly when the export list drifts. If the change is
 * intentional, update the frozen list below in the same PR.
 */
import { describe, expect, it } from 'vitest';
import * as pkg from './index.js';

const EXPECTED_EXPORTS: readonly string[] = [
  // Utility primitives
  'JobQueue',
  'LRUCache',
  'compilePrompt',
  'getCameraShot',
  'TemplateManager',
  'WorkflowRegistry',
  'WorkflowPlanner',
  'WorkflowEngine',
  'WorkflowRecovery',
  'MAX_PERSISTED_PRODUCTION_SHOTS',
  'VISUAL_PREVIEW_RUBRIC_VERSION',
  'registerDefaultWorkflows',
  'styleExtractWorkflow',
  'characterGenerateReferencesWorkflow',
  'locationGenerateReferencesWorkflow',
  'buildCharacterAppearancePrompt',
  'buildCharacterRefImagePrompt',
  'buildLocationRefImagePrompt',
  'getMovieProductionTaskContract',
  // Agent orchestration
  'AgentToolRegistry',
  'registerToolModule',
  'AgentOrchestrator',
  'createAgentOrchestratorForRun',
  'freshRunId',
  'coercePhaseNoteCode',
  'inferErrorCodeFromMessage',
  'ContextManager',
  'selectContextualToolSet',
  'registerAgentTools',
  'registerFiltered',
  'EXCLUDED_TOOLS',
  // Tool factories
  'createCanvasTools',
  'createEntityTools',
  'createScriptTools',
  'createJobTools',
  'jobToolModule',
  'createSeriesTools',
  'seriesToolModule',
  'createColorStyleTools',
  'colorStyleToolModule',
  'createProviderTools',
  'createAssetTools',
  'createPromptTools',
  'createRenderTools',
  'createPresetTools',
  'createWorkflowTools',
  'createMetaTools',
  'createTextAnalyzeTools',
  'createSnapshotTools',
  'snapshotToolModule',
  'createTodoTools',
  'TodoRunStore',
  'TodoRunStoreError',
  'ok',
  'fail',
  'requireString',
  'requireNumber',
  'requireStringArray',
  'requireText',
  'requireBoolean',
  'getToolCompactionCategory',
  'getClassifiedToolNames',
  'ToolCatalog',
  'entityMutatingToolNames',
  'canvasSyncMutatingToolNames',
  // Exit-contract extensibility (Phase F public surface)
  'contractRegistry',
  'decide',
  'classifyIntent',
  'evaluateProcessPromptSpecs',
  'createStylePlateLockSpec',
  // RunContext (Phase P3)
  'SCRATCHPAD_MAX_CHARS',
  'createEmptyScratchpad',
  'serializeScratchpad',
];

describe('public surface', () => {
  it('freezes the named-export set', () => {
    const actual = Object.keys(pkg).sort();
    const expected = [...EXPECTED_EXPORTS].sort();
    expect(actual).toEqual(expected);
  });

  it('does not re-export internal exit-contract symbols', () => {
    const forbidden = [
      'EvidenceLedger',
      'stylePlateLockPredicate',
      'isGenerationTool',
      'infoAnswerContract',
      'mutationExecutionContract',
      'workflowExecutionContract',
    ];
    for (const name of forbidden) {
      expect(pkg).not.toHaveProperty(name);
    }
  });
});
