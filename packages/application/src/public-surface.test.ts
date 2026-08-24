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
  'LRUCache',
  'compilePrompt',
  'computeEffectiveIntensity',
  'getCameraShot',
  'resolvePromptTemplate',
  'TemplateManager',
  'TaskListRegistry',
  'TaskListPlanner',
  'TaskExecutionEngine',
  'VISUAL_PREVIEW_RUBRIC_VERSION',
  'registerDefaultTaskLists',
  'styleExtractTaskList',
  'movieProductionTaskList',
  'audioProductionTaskList',
  'createMovieProductionTaskListGraph',
  'getMovieProductionTaskContract',
  // Agent orchestration
  'ToolRegistry',
  'TOOL_PROGRAM_LIMITS',
  'createToolProgramTool',
  'describeToolProgram',
  'executeToolProgram',
  'parseToolProgram',
  'ToolProgramBlockedError',
  'ToolProgramCancelledError',
  'registerToolModule',
  'AgentOrchestrator',
  'createAgentOrchestratorForRun',
  'freshRunId',
  'makeStampedEmit',
  'RunResourceBudgetController',
  'parseRunResourceBudgetCheckpoint',
  'coercePhaseNoteCode',
  'inferErrorCodeFromMessage',
  'ContextManager',
  'registerAgentTools',
  'registerFiltered',
  'EXCLUDED_TOOLS',
  // Tool factories
  'createCanvasTools',
  'createEntityTools',
  'createScriptTools',
  'createColorStyleTools',
  'colorStyleToolModule',
  'createProviderTools',
  'createAssetTools',
  'createPromptTools',
  'createPresetTools',
  'createTaskListTools',
  'createMetaTools',
  'createTextAnalyzeTools',
  'createSnapshotTools',
  'snapshotToolModule',
  'createRunChecklistTools',
  'RunChecklistStore',
  'RunChecklistStoreError',
  'ok',
  'fail',
  'requireString',
  'requireNumber',
  'requireStringArray',
  'requireText',
  'requireBoolean',
  'getToolCompactionCategory',
  'getClassifiedToolNames',
  'deriveEntityMutatingToolNames',
  'deriveCanvasSyncMutatingToolNames',
  // Exit-contract extensibility (Phase F public surface)
  'contractRegistry',
  'decide',
  // RunContext (Phase P3)
  'SCRATCHPAD_MAX_CHARS',
  'createEmptyScratchpad',
  'serializeScratchpad',
  // Durable Commander context projection
  'PROJECTOR_VERSION',
  'canonicalJson',
  'hashCommanderContextProjection',
  'hashEventChain',
  'projectCommanderContext',
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
      'infoAnswerContract',
      'mutationExecutionContract',
      'taskListExecutionContract',
    ];
    for (const name of forbidden) {
      expect(pkg).not.toHaveProperty(name);
    }
  });
});
