import { TaskKind } from '@lucid-fin/contracts';
import type {
  RegisteredTaskListBlueprint,
  RegisteredTaskBlueprint,
} from '../task-list-registry.js';

export interface ProductionGraphShot {
  id: string;
  actIndex: number;
  sceneIndex: number;
  title: string;
  summary?: string;
  storyBeat?: string;
  dialogueIntent?: string;
}

export interface MovieProductionTaskListGraph {
  definition: RegisteredTaskListBlueprint;
  shots: ProductionGraphShot[];
  sourceSceneCount: number;
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
  | 'delivery';

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
    primaryTools: ['taskList.manage'],
    requiredEvidence: [
      'Structured story acts/scenes',
      'Format, assumptions, budget, and visual directions',
    ],
    completion:
      'Call taskList.manage createProductionPlan. Stop when the immutable Production Plan gate is pending.',
  },
  style_audition: {
    version: 1,
    role: 'style_audition',
    objective: 'Generate and grade visible style candidates within the approved audition budget.',
    primaryTools: ['task.visual'],
    requiredEvidence: ['Candidate asset hashes', 'Deterministic grades, costs, and recommendation'],
    completion: 'Use task.visual. Stop when the immutable Visual Constitution gate is pending.',
  },
  script: {
    version: 1,
    role: 'script',
    objective: 'Persist a production-ready script matching the approved plan and duration.',
    primaryTools: ['script.manage', 'taskList.manage'],
    requiredEvidence: ['Persisted scenes, dialogue, actions, and timing'],
    completion: 'Call taskList.manage completeCurrentTask with persisted script evidence.',
  },
  entities: {
    version: 1,
    role: 'entities',
    objective:
      'Create stable character, location, and equipment identity records used by every shot.',
    primaryTools: ['entity.list', 'entity.create', 'entity.update', 'taskList.manage'],
    requiredEvidence: [
      'Persistent entity IDs',
      'Identity descriptions, costumes/loadouts, and continuity anchors',
    ],
    completion: 'Call taskList.manage completeCurrentTask with the created entity IDs.',
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
      'task.media',
      'entity.setRefImageFromNode',
      'taskList.manage',
    ],
    requiredEvidence: [
      'Accepted image-node asset hashes',
      'Entity IDs with canonical slots',
      'Task media grades and attempt IDs',
    ],
    completion:
      'Bind accepted still images to entities, then call taskList.manage completeCurrentTask with entity, node, slot, asset, and attempt evidence.',
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
      'taskList.manage',
    ],
    requiredEvidence: [
      'Shot node ID',
      'Character/location/equipment selectors',
      'Framing, motion, timing, and continuity notes',
    ],
    completion:
      'Call taskList.manage completeCurrentTask with the shot-node and selector evidence.',
  },
  production_media: {
    version: 1,
    role: 'production_media',
    objective:
      'Generate and grade the current shot from its host-owned Generation Spec and explicit continuity references.',
    primaryTools: ['provider.manage', 'canvas.updateNodes', 'task.media', 'task.mediaFeedback'],
    requiredEvidence: [
      'Accepted attempt ID and asset hash',
      'Identity/style/continuity grade',
      'Provider, seed, prompt hash, and cost receipt',
    ],
    completion:
      'Call task.media for the current task and node. The host completes the task only after an accepted grade; use task.mediaFeedback for bounded repairs.',
  },
  assembly: {
    version: 1,
    role: 'assembly',
    objective: 'Arrange only accepted source videos into the durable Ordered Delivery sequence.',
    primaryTools: [
      'canvas.listNodes',
      'canvas.connectNodes',
      'canvas.updateNodes',
      'taskList.manage',
    ],
    requiredEvidence: [
      'Ordered accepted node IDs and asset hashes',
      'Non-destructive trim and embedded-audio preferences',
    ],
    completion: 'Call taskList.manage completeCurrentTask with the Ordered Delivery evidence.',
  },
  delivery: {
    version: 1,
    role: 'delivery',
    objective: 'Prepare an immutable Delivery manifest from the persisted Ordered Delivery sequence.',
    primaryTools: ['task.delivery'],
    requiredEvidence: ['Manifest revision/hash', 'Delivery sequence revision/hash and source lineage'],
    completion:
      'Call task.delivery. Stop when the exact Delivery gate is pending; packaging remains an explicit host UI action after approval.',
  },
};

export function getMovieProductionTaskContract(
  role: unknown,
): MovieProductionTaskContract | undefined {
  return typeof role === 'string'
    ? MOVIE_PRODUCTION_TASK_CONTRACTS[role as MovieProductionTaskRole]
    : undefined;
}

export function createMovieProductionTaskListGraph(
  plan: Record<string, unknown>,
): MovieProductionTaskListGraph {
  const derived = deriveShots(plan);
  const taskNames = readTaskNames(plan.taskNames);
  const display = (
    taskKey: string,
    fallbackName: string,
    fallbackLabel: string,
    displayLabelKey?: string,
  ): Pick<RegisteredTaskBlueprint, 'name' | 'displayLabel' | 'displayLabelKey'> => {
    const authored = taskNames[taskKey];
    return authored
      ? { name: authored, displayLabel: authored }
      : {
          name: fallbackName,
          displayLabel: fallbackLabel,
          ...(displayLabelKey ? { displayLabelKey } : {}),
        };
  };
  const shotSpecTasks = derived.shots.map((shot) =>
    externalTask({
      id: `shot-spec-${shot.id}`,
      ...display(
        `shot-spec-${shot.id}`,
        `Shot specification ${shot.id}`,
        `Shot ${shot.id}: ${shot.title}`,
        'taskLabels.shotSpecification',
      ),
      phaseKey: 'preproduction',
      phaseName: 'Pre-production',
      phaseOrder: 2,
      kind: TaskKind.Validation,
      dependsOnTaskIds: ['script', 'entities', 'references'],
      displayCategory: 'Pre-production',
      relatedEntityLabel: `${shot.id} · ${shot.title}`,
      summary: 'Create the structured shot specification used for media generation.',
      inputBinding: { shot, taskRole: 'shot_spec' },
    }),
  );
  const mediaTasks = derived.shots.map((shot) =>
    externalTask({
      id: `media-shot-${shot.id}`,
      ...display(
        `media-shot-${shot.id}`,
        `Generate shot ${shot.id}`,
        `Generate shot ${shot.id}: ${shot.title}`,
        'taskLabels.generateShot',
      ),
      phaseKey: 'media-generation',
      phaseName: 'Media generation',
      phaseOrder: 3,
      kind: TaskKind.AdapterGeneration,
      dependsOnTaskIds: [`shot-spec-${shot.id}`, 'references'],
      displayCategory: 'Media generation',
      relatedEntityLabel: `${shot.id} · ${shot.title}`,
      summary: 'Generate, grade, and repair the shot within approved limits.',
      inputBinding: { shot, taskRole: 'production_media' },
    }),
  );

  const definition: RegisteredTaskListBlueprint = {
    id: 'movie.production.v2',
    name: 'Persistent hybrid movie production',
    version: 2,
    kind: 'movie-production',
    description: 'Durable plan, visual direction, production, Ordered Delivery, and handoff task list.',
    displayCategory: 'Production',
    displayLabel: 'Movie production',
    displayLabelKey: 'taskListLabels.movieProduction',
    summary: 'AI-assisted movie production with three fixed user approval gates.',
    cancellationPolicy: { allowCancellation: true },
    resumePolicy: { allowResume: true },
    tasks: [
      externalTask({
        id: 'production-plan',
        ...display(
          'production-plan',
          'Create production plan',
          'Production plan',
          'taskLabels.productionPlan',
        ),
        phaseKey: 'production-plan',
        phaseName: 'Production plan',
        phaseOrder: 0,
        kind: TaskKind.Validation,
        displayCategory: 'Planning',
        summary: 'Expand the idea into the immutable first approval subject.',
        inputBinding: {
          taskRole: 'document',
          documentLogicalKey: 'production-plan',
        },
      }),
      externalTask({
        id: 'style-audition',
        ...display(
          'style-audition',
          'Create and grade style auditions',
          'Style previews',
          'taskLabels.styleAuditions',
        ),
        phaseKey: 'style-exploration',
        phaseName: 'Style exploration',
        phaseOrder: 1,
        kind: TaskKind.AdapterGeneration,
        dependsOnTaskIds: ['production-plan'],
        displayCategory: 'Visual direction',
        summary: 'Generate visible style candidates for the Visual Constitution gate.',
        inputBinding: { taskRole: 'style_audition' },
      }),
      externalTask({
        id: 'script',
        ...display('script', 'Write production script', 'Script', 'taskLabels.script'),
        phaseKey: 'preproduction',
        phaseName: 'Pre-production',
        phaseOrder: 2,
        kind: TaskKind.Transform,
        dependsOnTaskIds: ['style-audition'],
        displayCategory: 'Pre-production',
        summary: 'Expand approved story beats into production-ready scenes and dialogue.',
        inputBinding: { taskRole: 'script' },
      }),
      externalTask({
        id: 'entities',
        ...display(
          'entities',
          'Define production entities',
          'Characters and locations',
          'taskLabels.entities',
        ),
        phaseKey: 'preproduction',
        phaseName: 'Pre-production',
        phaseOrder: 2,
        kind: TaskKind.MetadataExtract,
        dependsOnTaskIds: ['script'],
        displayCategory: 'Pre-production',
        summary: 'Create persistent character, location, and equipment identities.',
        inputBinding: { taskRole: 'entities' },
      }),
      externalTask({
        id: 'references',
        ...display(
          'references',
          'Create reference assets',
          'Reference assets',
          'taskLabels.references',
        ),
        phaseKey: 'preproduction',
        phaseName: 'Pre-production',
        phaseOrder: 2,
        kind: TaskKind.AssetResolve,
        dependsOnTaskIds: ['entities'],
        displayCategory: 'Pre-production',
        summary: 'Create and lock reusable visual references for continuity.',
        inputBinding: { taskRole: 'references' },
      }),
      ...shotSpecTasks,
      ...mediaTasks,
      externalTask({
        id: 'assembly',
        ...display(
          'assembly',
          'Prepare Ordered Delivery',
          'Order source videos',
          'taskLabels.orderedDelivery',
        ),
        phaseKey: 'assembly',
        phaseName: 'Ordered Delivery',
        phaseOrder: 4,
        kind: TaskKind.Transform,
        dependsOnTaskIds: mediaTasks.map((task) => task.id),
        displayCategory: 'Delivery',
        summary: 'Arrange accepted source videos and persist their non-destructive handoff preferences.',
        inputBinding: { taskRole: 'assembly' },
      }),
      externalTask({
        id: 'delivery',
        ...display(
          'delivery',
          'Prepare Delivery manifest',
          'Approve delivery package',
          'taskLabels.delivery',
        ),
        phaseKey: 'delivery',
        phaseName: 'Delivery',
        phaseOrder: 5,
        kind: TaskKind.Export,
        dependsOnTaskIds: ['assembly'],
        displayCategory: 'Delivery',
        summary: 'Prepare the immutable source-package manifest for the third approval gate.',
        inputBinding: { taskRole: 'delivery' },
      }),
    ],
  };

  return { definition, ...derived };
}

export const movieProductionTaskList = createMovieProductionTaskListGraph({}).definition;

function externalTask(
  task: Pick<
    RegisteredTaskBlueprint,
    | 'id'
    | 'name'
    | 'phaseKey'
    | 'phaseName'
    | 'phaseOrder'
    | 'kind'
    | 'dependsOnTaskIds'
    | 'displayCategory'
    | 'displayLabel'
    | 'displayLabelKey'
    | 'relatedEntityLabel'
    | 'summary'
    | 'inputBinding'
  >,
): RegisteredTaskBlueprint {
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

function readTaskNames(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const names: Record<string, string> = {};
  for (const [taskKey, label] of Object.entries(record)) {
    const text = readString(label);
    if (text) names[taskKey] = text;
  }
  return names;
}

function deriveShots(
  plan: Record<string, unknown>,
): Omit<MovieProductionTaskListGraph, 'definition'> {
  const story = asRecord(plan.story);
  const acts = asRecords(story.acts);
  const shots: ProductionGraphShot[] = [];
  let sourceSceneCount = 0;

  for (const [actIndex, act] of acts.entries()) {
    const scenes = asRecords(act.scenes);
    sourceSceneCount += scenes.length;
    for (const [sceneIndex, scene] of scenes.entries()) {
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
