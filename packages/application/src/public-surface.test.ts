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
  'Semaphore',
  'LRUCache',
  'compilePrompt',
  'getCameraShot',
  'CostCenter',
  'SnapshotManager',
  'TemplateManager',
  'WorkflowRegistry',
  'WorkflowPlanner',
  'WorkflowEngine',
  'WorkflowRecovery',
  'registerDefaultWorkflows',
  'styleExtractWorkflow',
  'characterGenerateReferencesWorkflow',
  'locationGenerateReferencesWorkflow',
  'buildCharacterAppearancePrompt',
  'buildCharacterRefImagePrompt',
  'buildLocationRefImagePrompt',
  // Agent orchestration
  'AgentToolRegistry',
  'defineToolModule',
  'registerToolModule',
  'AgentOrchestrator',
  'createAgentOrchestratorForRun',
  'freshRunId',
  'makeStampedEmit',
  'detectProcess',
  'getProcessCategoryName',
  'ContextManager',
  'ToolExecutor',
  'TranscriptIndex',
  'registerAgentTools',
  // Tool factories
  'createCanvasTools',
  'createCharacterTools',
  'createLocationTools',
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
  'createEquipmentTools',
  'createMetaTools',
  'createCopywritingTools',
  'createVisionTools',
  'createSnapshotTools',
  'snapshotToolModule',
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
  // Generation
  'GenerationApplicationService',
  'STRATEGIES',
  'selectStrategy',
  // Exit-contract extensibility (Phase F public surface)
  'contractRegistry',
  'decide',
  'classifyIntent',
  'evaluateProcessPromptSpecs',
  'createStylePlateLockSpec',
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
      'storyToVideoContract',
      'stylePlateContract',
      'shotListContract',
      'continuityCheckContract',
      'imageAnalyzeContract',
      'audioProductionContract',
      'styleTransferContract',
    ];
    for (const name of forbidden) {
      expect(pkg).not.toHaveProperty(name);
    }
  });
});
