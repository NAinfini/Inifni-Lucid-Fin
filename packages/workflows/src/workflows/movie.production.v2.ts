import { TaskKind } from '@lucid-fin/contracts';
import type {
  RegisteredWorkflowDefinition,
  RegisteredWorkflowTaskDefinition,
} from '../workflow-registry.js';

export const MAX_PERSISTED_PRODUCTION_SHOTS = 24;

export interface ProductionGraphShot {
  id: string;
  actIndex: number;
  sceneIndex: number;
  title: string;
  summary?: string;
  storyBeat?: string;
  dialogueIntent?: string;
}

export interface MovieProductionWorkflowGraph {
  definition: RegisteredWorkflowDefinition;
  shots: ProductionGraphShot[];
  sourceSceneCount: number;
  truncated: boolean;
}

export type MovieProductionTaskRole =
  | 'document'
  | 'style_audition'
  | 'script'
  | 'entities'
  | 'references'
  | 'shot_spec'
  | 'production_media'
  | 'assembly'
  | 'final_export';

export interface MovieProductionTaskContract {
  version: 1;
  role: MovieProductionTaskRole;
  objective: string;
  primaryTools: readonly string[];
  requiredEvidence: readonly string[];
  completion: string;
}

const MOVIE_PRODUCTION_TASK_CONTRACTS: Record<
  MovieProductionTaskRole,
  MovieProductionTaskContract
> = {
  document: {
    version: 1,
    role: 'document',
    objective: 'Expand the user idea into the complete structured Production Plan.',
    primaryTools: ['workflow.manage'],
    requiredEvidence: [
      'Structured story acts/scenes',
      'Format, assumptions, budget, and visual directions',
    ],
    completion:
      'Call workflow.manage createProductionPlan. Stop when the immutable Production Plan gate is pending.',
  },
  style_audition: {
    version: 1,
    role: 'style_audition',
    objective: 'Generate and grade visible style candidates within the approved audition budget.',
    primaryTools: ['workflow.visual'],
    requiredEvidence: ['Candidate asset hashes', 'Deterministic grades, costs, and recommendation'],
    completion: 'Use workflow.visual. Stop when the immutable Visual Constitution gate is pending.',
  },
  script: {
    version: 1,
    role: 'script',
    objective: 'Persist a production-ready script matching the approved plan and duration.',
    primaryTools: ['script.manage', 'workflow.manage'],
    requiredEvidence: ['Persisted scenes, dialogue, actions, and timing'],
    completion: 'Call workflow.manage completeCurrentTask with persisted script evidence.',
  },
  entities: {
    version: 1,
    role: 'entities',
    objective:
      'Create stable character, location, and equipment identity records used by every shot.',
    primaryTools: ['entity.list', 'entity.create', 'entity.update', 'workflow.manage'],
    requiredEvidence: [
      'Persistent entity IDs',
      'Identity descriptions, costumes/loadouts, and continuity anchors',
    ],
    completion: 'Call workflow.manage completeCurrentTask with the created entity IDs.',
  },
  references: {
    version: 1,
    role: 'references',
    objective:
      'Create, grade, accept, and bind one explicit reference image per required entity selector.',
    primaryTools: [
      'provider.manage',
      'canvas.createNodes',
      'canvas.updateNodes',
      'canvas.setNodeRefs',
      'workflow.media',
      'entity.setRefImageFromNode',
      'workflow.manage',
    ],
    requiredEvidence: [
      'Accepted image-node asset hashes',
      'Entity IDs with canonical slots',
      'Workflow media grades and attempt IDs',
    ],
    completion:
      'Bind accepted still images to entities, then call workflow.manage completeCurrentTask with entity, node, slot, asset, and attempt evidence.',
  },
  shot_spec: {
    version: 1,
    role: 'shot_spec',
    objective:
      'Persist the structured shot contract from the current task input without changing approved story facts.',
    primaryTools: [
      'canvas.createNodes',
      'canvas.setNodeRefs',
      'canvas.setVideoFrames',
      'workflow.manage',
    ],
    requiredEvidence: [
      'Shot node ID',
      'Character/location/equipment selectors',
      'Framing, motion, timing, and continuity notes',
    ],
    completion:
      'Call workflow.manage completeCurrentTask with the shot-node and selector evidence.',
  },
  production_media: {
    version: 1,
    role: 'production_media',
    objective:
      'Generate and grade the current shot from its host-owned Generation Spec and explicit continuity references.',
    primaryTools: [
      'provider.manage',
      'canvas.updateNodes',
      'workflow.media',
      'workflow.mediaFeedback',
    ],
    requiredEvidence: [
      'Accepted attempt ID and asset hash',
      'Identity/style/continuity grade',
      'Provider, seed, prompt hash, and cost receipt',
    ],
    completion:
      'Call workflow.media for the current task and node. The host completes the task only after an accepted grade; use workflow.mediaFeedback for bounded repairs.',
  },
  assembly: {
    version: 1,
    role: 'assembly',
    objective: 'Arrange only accepted shot assets into the durable story-order rough cut.',
    primaryTools: [
      'canvas.listNodes',
      'canvas.connectNodes',
      'canvas.updateNodes',
      'workflow.manage',
    ],
    requiredEvidence: [
      'Ordered accepted node IDs and asset hashes',
      'Timing and transition decisions',
    ],
    completion: 'Call workflow.manage completeCurrentTask with the ordered assembly evidence.',
  },
  final_export: {
    version: 1,
    role: 'final_export',
    objective: 'Prepare an immutable Final Export manifest from the accepted assembly.',
    primaryTools: ['workflow.finalExport'],
    requiredEvidence: ['Manifest revision/hash', 'Assembly snapshot hash and ordered segments'],
    completion:
      'Call workflow.finalExport. Stop when the exact Final Export gate is pending; rendering begins only after user approval.',
  },
};

export function getMovieProductionTaskContract(
  role: unknown,
): MovieProductionTaskContract | undefined {
  return typeof role === 'string'
    ? MOVIE_PRODUCTION_TASK_CONTRACTS[role as MovieProductionTaskRole]
    : undefined;
}

export function createMovieProductionWorkflowGraph(
  plan: Record<string, unknown>,
): MovieProductionWorkflowGraph {
  const derived = deriveShots(plan);
  const shotSpecTasks = derived.shots.map((shot) =>
    externalTask({
      id: `shot-spec-${shot.id}`,
      name: `Shot specification ${shot.id}`,
      kind: TaskKind.Validation,
      dependsOnTaskIds: ['script', 'entities', 'references'],
      displayCategory: 'Pre-production',
      displayLabel: `Shot ${shot.id}: ${shot.title}`,
      summary: 'Create the structured shot specification used for media generation.',
      inputBinding: { shot, workflowTaskRole: 'shot_spec' },
    }),
  );
  const mediaTasks = derived.shots.map((shot) =>
    externalTask({
      id: `media-shot-${shot.id}`,
      name: `Generate shot ${shot.id}`,
      kind: TaskKind.AdapterGeneration,
      dependsOnTaskIds: [`shot-spec-${shot.id}`, 'references'],
      displayCategory: 'Media generation',
      displayLabel: `Generate shot ${shot.id}: ${shot.title}`,
      summary: 'Generate, grade, and repair the shot within approved limits.',
      inputBinding: { shot, workflowTaskRole: 'production_media' },
    }),
  );

  const definition: RegisteredWorkflowDefinition = {
    id: 'movie.production.v2',
    name: 'Persistent hybrid movie production',
    version: 2,
    kind: 'movie-production',
    description: 'Durable plan, visual direction, production, assembly, and export workflow.',
    displayCategory: 'Production',
    displayLabel: 'Movie production',
    summary: 'AI-assisted movie production with three fixed user approval gates.',
    cancellationPolicy: { allowCancellation: true },
    resumePolicy: { allowResume: true },
    stages: [
      {
        id: 'production-plan',
        name: 'Production plan',
        order: 0,
        tasks: [
          externalTask({
            id: 'production-plan',
            name: 'Create production plan',
            kind: TaskKind.Validation,
            displayCategory: 'Planning',
            displayLabel: 'Production plan',
            summary: 'Expand the idea into the immutable first approval subject.',
            inputBinding: {
              workflowTaskRole: 'document',
              documentLogicalKey: 'production-plan',
            },
          }),
        ],
      },
      {
        id: 'style-exploration',
        name: 'Style exploration',
        order: 1,
        dependsOnStageIds: ['production-plan'],
        tasks: [
          externalTask({
            id: 'style-audition',
            name: 'Create and grade style auditions',
            kind: TaskKind.AdapterGeneration,
            dependsOnTaskIds: ['production-plan'],
            displayCategory: 'Visual direction',
            displayLabel: 'Style previews',
            summary: 'Generate visible style candidates for the Visual Constitution gate.',
            inputBinding: { workflowTaskRole: 'style_audition' },
          }),
        ],
      },
      {
        id: 'preproduction',
        name: 'Pre-production',
        order: 2,
        dependsOnStageIds: ['style-exploration'],
        tasks: [
          externalTask({
            id: 'script',
            name: 'Write production script',
            kind: TaskKind.Transform,
            dependsOnTaskIds: ['style-audition'],
            displayCategory: 'Pre-production',
            displayLabel: 'Script',
            summary: 'Expand approved story beats into production-ready scenes and dialogue.',
            inputBinding: { workflowTaskRole: 'script' },
          }),
          externalTask({
            id: 'entities',
            name: 'Define production entities',
            kind: TaskKind.MetadataExtract,
            dependsOnTaskIds: ['script'],
            displayCategory: 'Pre-production',
            displayLabel: 'Characters and locations',
            summary: 'Create persistent character, location, and equipment identities.',
            inputBinding: { workflowTaskRole: 'entities' },
          }),
          externalTask({
            id: 'references',
            name: 'Create reference assets',
            kind: TaskKind.AssetResolve,
            dependsOnTaskIds: ['entities'],
            displayCategory: 'Pre-production',
            displayLabel: 'Reference assets',
            summary: 'Create and lock reusable visual references for continuity.',
            inputBinding: { workflowTaskRole: 'references' },
          }),
          ...shotSpecTasks,
        ],
      },
      {
        id: 'media-generation',
        name: 'Media generation',
        order: 3,
        dependsOnStageIds: ['preproduction'],
        tasks: mediaTasks,
      },
      {
        id: 'assembly',
        name: 'Assembly',
        order: 4,
        dependsOnStageIds: ['media-generation'],
        tasks: [
          externalTask({
            id: 'assembly',
            name: 'Assemble rough cut',
            kind: TaskKind.TimelineAssembly,
            dependsOnTaskIds: mediaTasks.map((task) => task.id),
            displayCategory: 'Assembly',
            displayLabel: 'Assemble movie',
            summary: 'Assemble accepted shots in story order.',
            inputBinding: { workflowTaskRole: 'assembly' },
          }),
        ],
      },
      {
        id: 'final-export',
        name: 'Final export',
        order: 5,
        dependsOnStageIds: ['assembly'],
        tasks: [
          externalTask({
            id: 'final-export',
            name: 'Approve and render final export',
            kind: TaskKind.Export,
            dependsOnTaskIds: ['assembly'],
            displayCategory: 'Export',
            displayLabel: 'Final export',
            summary: 'Prepare the immutable manifest and render only after final approval.',
            inputBinding: { workflowTaskRole: 'final_export' },
          }),
        ],
      },
    ],
  };

  return { definition, ...derived };
}

export const movieProductionWorkflow = createMovieProductionWorkflowGraph({}).definition;

function externalTask(
  task: Pick<
    RegisteredWorkflowTaskDefinition,
    | 'id'
    | 'name'
    | 'kind'
    | 'dependsOnTaskIds'
    | 'displayCategory'
    | 'displayLabel'
    | 'summary'
    | 'inputBinding'
  >,
): RegisteredWorkflowTaskDefinition {
  return {
    ...task,
    handlerId: 'persistent-hybrid.external',
    maxRetries: 0,
    inputBinding: {
      ...task.inputBinding,
      executionMode: 'external',
    },
  };
}

function deriveShots(
  plan: Record<string, unknown>,
): Omit<MovieProductionWorkflowGraph, 'definition'> {
  const story = asRecord(plan.story);
  const acts = asRecords(story.acts);
  const shots: ProductionGraphShot[] = [];
  let sourceSceneCount = 0;

  for (const [actIndex, act] of acts.entries()) {
    const scenes = asRecords(act.scenes);
    sourceSceneCount += scenes.length;
    for (const [sceneIndex, scene] of scenes.entries()) {
      if (shots.length >= MAX_PERSISTED_PRODUCTION_SHOTS) continue;
      const sequence = String(shots.length + 1).padStart(3, '0');
      const summary = readString(scene.summary);
      const storyBeat = readString(scene.storyBeat);
      const dialogueIntent = readString(scene.dialogueIntent);
      shots.push({
        id: sequence,
        actIndex,
        sceneIndex,
        title: readString(scene.title) ?? `Scene ${shots.length + 1}`,
        ...(summary ? { summary } : {}),
        ...(storyBeat ? { storyBeat } : {}),
        ...(dialogueIntent ? { dialogueIntent } : {}),
      });
    }
  }

  if (shots.length === 0) {
    shots.push({ id: '001', actIndex: 0, sceneIndex: 0, title: 'Opening shot' });
  }

  return {
    shots,
    sourceSceneCount,
    truncated: sourceSceneCount > MAX_PERSISTED_PRODUCTION_SHOTS,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
