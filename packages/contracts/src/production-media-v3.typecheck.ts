import type {
  ProductionMediaGenerationSpec,
  ProductionMediaTaskAttempt,
  RepairDelta,
  TaskArtifact,
  TaskEvaluation,
} from './dto/task-execution.js';

type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

type _GenerationSpecV3 = Assert<
  Extends<
    ProductionMediaGenerationSpec,
    {
      specVersion: 3;
      scope: 'canvas' | 'style_audition' | 'production';
      taskListId: string;
      taskId: string;
      canvasId: string;
      canvasUpdatedAt: number;
      nodeId: string;
      nodeUpdatedAt: number;
      modelId: string;
      promptAssemblyId: string;
      promptHash: string;
      referenceEvidence: unknown[];
      lineage: {
        purpose: string;
        variantIndex: number;
        variantCount: number;
      };
    }
  >
>;

type _AttemptSubmissionLineage = Assert<
  Extends<
    ProductionMediaTaskAttempt,
    {
      scope: ProductionMediaGenerationSpec['scope'];
      promptAssemblyId: string;
      submissionPurpose: ProductionMediaGenerationSpec['lineage']['purpose'];
    }
  >
>;

type _ArtifactAttemptLineage = Assert<Extends<TaskArtifact, { attemptId?: string }>>;
type _EvaluationLineage = Assert<
  Extends<
    TaskEvaluation,
    {
      artifactId: string;
      profile: 'canvas_media.v1' | 'style_audition.v1' | 'production_media.v1';
      sourcePromptHash: string;
    }
  >
>;
type _RepairLineage = Assert<
  Extends<
    RepairDelta,
    { reasonCodes: string[]; sourceEvaluationId?: string; sourceArtifactId?: string }
  >
>;

export {};
