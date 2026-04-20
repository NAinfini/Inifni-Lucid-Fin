import { randomUUID } from 'node:crypto';
import {
  TaskKind,
  TaskRunStatus,
  characterViewToSlot,
  locationViewToSlot,
  type CharacterRefImageView,
  type LocationRefImageView,
} from '@lucid-fin/contracts';
import type { WorkflowTaskHandler } from '@lucid-fin/application';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { CAS, IStorageLayer } from '@lucid-fin/storage';
import {
  parseCanvasId,
  parseCharacterId,
  parseLocationId,
  parseWorkflowRunId,
} from '@lucid-fin/contracts-parse';
import { makeGenerateImage } from '../ipc/handlers/commander-image-gen.js';
import {
  buildCharacterRefImagePrompt,
  buildLocationRefImagePrompt,
} from '@lucid-fin/application';

/**
 * Workflow-handler input contract for ref-image generation (Phase 2b):
 *   input.view     — CharacterRefImageView | LocationRefImageView
 *   input.canvasId — optional; when present, canvas.settings.stylePlate
 *                    leads the prompt, negativePrompt trails it, and
 *                    defaultResolution overrides the hardcoded size.
 *
 * The old `slot: string` input is gone; callers MUST pass a structured view.
 */

function parseCharacterView(raw: unknown): CharacterRefImageView {
  if (raw === undefined || raw === null) return { kind: 'full-sheet' };
  if (typeof raw !== 'object') {
    throw new Error('view must be { kind: "full-sheet" | "extra-angle", angle?: string }');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'full-sheet') return { kind: 'full-sheet' };
  if (obj.kind === 'extra-angle') {
    if (typeof obj.angle !== 'string' || obj.angle.trim().length === 0) {
      throw new Error('view.angle is required when kind=extra-angle');
    }
    return { kind: 'extra-angle', angle: obj.angle.trim() };
  }
  throw new Error(`view.kind must be "full-sheet" or "extra-angle" (got ${String(obj.kind)})`);
}

function parseLocationView(raw: unknown): LocationRefImageView {
  if (raw === undefined || raw === null) return { kind: 'bible' };
  if (typeof raw !== 'object') {
    throw new Error('view must be { kind: "bible" | "fake-360" | "extra-angle", angle?: string }');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'bible') return { kind: 'bible' };
  if (obj.kind === 'fake-360') return { kind: 'fake-360' };
  if (obj.kind === 'extra-angle') {
    if (typeof obj.angle !== 'string' || obj.angle.trim().length === 0) {
      throw new Error('view.angle is required when kind=extra-angle');
    }
    return { kind: 'extra-angle', angle: obj.angle.trim() };
  }
  throw new Error(`view.kind must be "bible", "fake-360", or "extra-angle" (got ${String(obj.kind)})`);
}

function readCanvasSettings(
  db: IStorageLayer,
  canvasIdRaw: unknown,
): import('@lucid-fin/contracts').CanvasSettings | undefined {
  if (typeof canvasIdRaw !== 'string' || !canvasIdRaw.trim()) return undefined;
  try {
    const canvas = db.repos.canvases.get(parseCanvasId(canvasIdRaw));
    return canvas?.settings;
  } catch {
    return undefined;
  }
}

const DEFAULT_REF_IMAGE_WIDTH  = 2048;
const DEFAULT_REF_IMAGE_HEIGHT = 1360;

function applyNegativePrompt(prompt: string, negativePrompt: string | undefined): string {
  const trimmed = negativePrompt?.trim();
  return trimmed ? `${prompt}\n\nAvoid: ${trimmed}` : prompt;
}

export function createRefImageWorkflowHandlers(options: {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
}): WorkflowTaskHandler[] {
  const generateImage = makeGenerateImage({
    adapterRegistry: options.adapterRegistry,
    cas: options.cas,
  });

  return [
    // -------------------------------------------------------------------------
    // character.validate-input
    // -------------------------------------------------------------------------
    {
      id: 'character.validate-input',
      kind: TaskKind.Validation,
      async execute(context) {
        const characterId =
          (context.taskRun.input.characterId as string | undefined) ??
          (context.workflowRun.entityId as string | undefined);
        if (!characterId) {
          throw new Error('characterId is required');
        }
        const character = context.db.repos.entities.getCharacter(parseCharacterId(characterId));
        if (!character) {
          throw new Error(`Character not found: ${characterId}`);
        }
        if (!character.name) {
          throw new Error('Character must have a name');
        }
        const view = parseCharacterView(context.taskRun.input.view);
        const canvasId =
          typeof context.taskRun.input.canvasId === 'string' ? context.taskRun.input.canvasId : undefined;

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'validated',
          output: {
            characterId,
            view,
            ...(canvasId && { canvasId }),
            characterName: character.name,
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // character.generate-ref-image
    // -------------------------------------------------------------------------
    {
      id: 'character.generate-ref-image',
      kind: TaskKind.AdapterGeneration,
      async execute(context) {
        const validated = getTaskOutput(
          context.db.repos.workflows.listTaskRuns(parseWorkflowRunId(context.workflowRun.id)).rows,
          'validate-character-input',
        );
        const characterId = requireString(validated.characterId, 'characterId');
        const view = parseCharacterView(validated.view);

        const character = context.db.repos.entities.getCharacter(parseCharacterId(characterId));
        if (!character) {
          throw new Error(`Character not found: ${characterId}`);
        }

        const canvasSettings = readCanvasSettings(context.db, validated.canvasId);
        const stylePlate = canvasSettings?.stylePlate;
        const prompt = applyNegativePrompt(
          buildCharacterRefImagePrompt(character, view, stylePlate),
          canvasSettings?.negativePrompt,
        );
        const width  = canvasSettings?.defaultResolution?.width  ?? DEFAULT_REF_IMAGE_WIDTH;
        const height = canvasSettings?.defaultResolution?.height ?? DEFAULT_REF_IMAGE_HEIGHT;
        const result = await generateImage(prompt, { width, height });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'generated',
          output: {
            characterId,
            view,
            assetHash: result.assetHash,
            prompt,
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // character.persist-ref-image
    // -------------------------------------------------------------------------
    {
      id: 'character.persist-ref-image',
      kind: TaskKind.Transform,
      async execute(context) {
        const generated = getTaskOutput(
          context.db.repos.workflows.listTaskRuns(parseWorkflowRunId(context.workflowRun.id)).rows,
          'generate-character-ref-image',
        );
        const characterId = requireString(generated.characterId, 'characterId');
        const view = parseCharacterView(generated.view);
        const assetHash = requireString(generated.assetHash, 'assetHash');
        const slot = characterViewToSlot(view);

        const character = context.db.repos.entities.getCharacter(parseCharacterId(characterId));
        if (!character) {
          throw new Error(`Character not found: ${characterId}`);
        }

        const referenceImages = [...(character.referenceImages ?? [])];
        const existingIndex = referenceImages.findIndex((img) => img.slot === slot);
        if (existingIndex >= 0) {
          const existing = referenceImages[existingIndex];
          const prevVariants = [...(existing.variants ?? [])];
          if (existing.assetHash && !prevVariants.includes(existing.assetHash)) {
            prevVariants.push(existing.assetHash);
          }
          if (!prevVariants.includes(assetHash)) {
            prevVariants.push(assetHash);
          }
          referenceImages[existingIndex] = { ...existing, assetHash, variants: prevVariants };
        } else {
          referenceImages.push({ slot, assetHash, isStandard: true, variants: [assetHash] });
        }

        const updated = { ...character, referenceImages, updatedAt: Date.now() };
        context.db.repos.entities.upsertCharacter(updated);

        const timestamp = Date.now();
        context.db.repos.workflows.insertArtifact({
          id: randomUUID(),
          workflowRunId: context.workflowRun.id,
          taskRunId: context.taskRun.id,
          artifactType: 'ref_image',
          entityType: 'character',
          entityId: characterId,
          assetHash,
          metadata: { slot, view },
          createdAt: timestamp,
        });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'persisted',
          output: {
            characterId,
            view,
            slot,
            assetHash,
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // location.validate-input
    // -------------------------------------------------------------------------
    {
      id: 'location.validate-input',
      kind: TaskKind.Validation,
      async execute(context) {
        const locationId =
          (context.taskRun.input.locationId as string | undefined) ??
          (context.workflowRun.entityId as string | undefined);
        if (!locationId) {
          throw new Error('locationId is required');
        }
        const location = context.db.repos.entities.getLocation(parseLocationId(locationId));
        if (!location) {
          throw new Error(`Location not found: ${locationId}`);
        }
        if (!location.name) {
          throw new Error('Location must have a name');
        }
        const view = parseLocationView(context.taskRun.input.view);
        const canvasId =
          typeof context.taskRun.input.canvasId === 'string' ? context.taskRun.input.canvasId : undefined;

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'validated',
          output: {
            locationId,
            view,
            ...(canvasId && { canvasId }),
            locationName: location.name,
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // location.generate-ref-image
    // -------------------------------------------------------------------------
    {
      id: 'location.generate-ref-image',
      kind: TaskKind.AdapterGeneration,
      async execute(context) {
        const validated = getTaskOutput(
          context.db.repos.workflows.listTaskRuns(parseWorkflowRunId(context.workflowRun.id)).rows,
          'validate-location-input',
        );
        const locationId = requireString(validated.locationId, 'locationId');
        const view = parseLocationView(validated.view);

        const location = context.db.repos.entities.getLocation(parseLocationId(locationId));
        if (!location) {
          throw new Error(`Location not found: ${locationId}`);
        }

        const canvasSettings = readCanvasSettings(context.db, validated.canvasId);
        const stylePlate = canvasSettings?.stylePlate;
        const prompt = applyNegativePrompt(
          buildLocationRefImagePrompt(location, view, stylePlate),
          canvasSettings?.negativePrompt,
        );
        const width  = canvasSettings?.defaultResolution?.width  ?? DEFAULT_REF_IMAGE_WIDTH;
        const height = canvasSettings?.defaultResolution?.height ?? DEFAULT_REF_IMAGE_HEIGHT;
        const result = await generateImage(prompt, { width, height });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'generated',
          output: {
            locationId,
            view,
            assetHash: result.assetHash,
            prompt,
          },
        };
      },
    },

    // -------------------------------------------------------------------------
    // location.persist-ref-image
    // -------------------------------------------------------------------------
    {
      id: 'location.persist-ref-image',
      kind: TaskKind.Transform,
      async execute(context) {
        const generated = getTaskOutput(
          context.db.repos.workflows.listTaskRuns(parseWorkflowRunId(context.workflowRun.id)).rows,
          'generate-location-ref-image',
        );
        const locationId = requireString(generated.locationId, 'locationId');
        const view = parseLocationView(generated.view);
        const assetHash = requireString(generated.assetHash, 'assetHash');
        const slot = locationViewToSlot(view);

        const location = context.db.repos.entities.getLocation(parseLocationId(locationId));
        if (!location) {
          throw new Error(`Location not found: ${locationId}`);
        }

        const referenceImages = [...(location.referenceImages ?? [])];
        const existingIndex = referenceImages.findIndex((img) => img.slot === slot);
        if (existingIndex >= 0) {
          const existing = referenceImages[existingIndex];
          const prevVariants = [...(existing.variants ?? [])];
          if (existing.assetHash && !prevVariants.includes(existing.assetHash)) {
            prevVariants.push(existing.assetHash);
          }
          if (!prevVariants.includes(assetHash)) {
            prevVariants.push(assetHash);
          }
          referenceImages[existingIndex] = { ...existing, assetHash, variants: prevVariants };
        } else {
          referenceImages.push({ slot, assetHash, isStandard: true, variants: [assetHash] });
        }

        const updated = { ...location, referenceImages, updatedAt: Date.now() };
        context.db.repos.entities.upsertLocation(updated);

        const timestamp = Date.now();
        context.db.repos.workflows.insertArtifact({
          id: randomUUID(),
          workflowRunId: context.workflowRun.id,
          taskRunId: context.taskRun.id,
          artifactType: 'ref_image',
          entityType: 'location',
          entityId: locationId,
          assetHash,
          metadata: { slot, view },
          createdAt: timestamp,
        });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'persisted',
          output: {
            locationId,
            view,
            slot,
            assetHash,
          },
        };
      },
    },
  ];
}

function getTaskOutput(
  taskRuns: Array<{ taskId: string; output: Record<string, unknown> }>,
  taskId: string,
): Record<string, unknown> {
  const taskRun = taskRuns.find((entry) => entry.taskId === taskId);
  if (!taskRun) {
    throw new Error(`Workflow task "${taskId}" not found`);
  }
  return taskRun.output;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}
