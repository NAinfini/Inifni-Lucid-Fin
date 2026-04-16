import { randomUUID } from 'node:crypto';
import {
  TaskKind,
  TaskRunStatus,
  LOCATION_STANDARD_SLOTS,
  isCharacterReferenceSlotStandard,
  normalizeCharacterRefSlot,
} from '@lucid-fin/contracts';
import type { WorkflowTaskHandler } from '@lucid-fin/application';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { CAS } from '@lucid-fin/storage';
import { makeGenerateImage } from '../ipc/handlers/commander-image-gen.js';
import { buildCharacterRefImagePrompt } from '@lucid-fin/application';
import { buildLocationRefImagePrompt } from '@lucid-fin/application';

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
        const character = context.db.getCharacter(characterId);
        if (!character) {
          throw new Error(`Character not found: ${characterId}`);
        }
        if (!character.name) {
          throw new Error('Character must have a name');
        }
        const slot = normalizeCharacterRefSlot(
          typeof context.taskRun.input.slot === 'string'
            ? context.taskRun.input.slot
            : 'main',
        );

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'validated',
          output: {
            characterId,
            slot,
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
        const validated = getTaskOutput(context.db.listWorkflowTaskRuns(context.workflowRun.id), 'validate-character-input');
        const characterId = requireString(validated.characterId, 'characterId');
        const slot = requireString(validated.slot, 'slot');

        const character = context.db.getCharacter(characterId);
        if (!character) {
          throw new Error(`Character not found: ${characterId}`);
        }

        const prompt = buildCharacterRefImagePrompt(character, slot);
        const result = await generateImage(prompt, { width: 2048, height: 1360 });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'generated',
          output: {
            characterId,
            slot,
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
        const generated = getTaskOutput(context.db.listWorkflowTaskRuns(context.workflowRun.id), 'generate-character-ref-image');
        const characterId = requireString(generated.characterId, 'characterId');
        const slot = requireString(generated.slot, 'slot');
        const assetHash = requireString(generated.assetHash, 'assetHash');

        const character = context.db.getCharacter(characterId);
        if (!character) {
          throw new Error(`Character not found: ${characterId}`);
        }

        const referenceImages = [...(character.referenceImages ?? [])];
        const existingIndex = referenceImages.findIndex((img) => normalizeCharacterRefSlot(img.slot) === slot);
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
          const isStandard = isCharacterReferenceSlotStandard(slot);
          referenceImages.push({ slot, assetHash, isStandard, variants: [assetHash] });
        }

        const updated = { ...character, referenceImages, updatedAt: Date.now() };
        context.db.upsertCharacter(updated);

        const timestamp = Date.now();
        context.db.insertWorkflowArtifact({
          id: randomUUID(),
          workflowRunId: context.workflowRun.id,
          taskRunId: context.taskRun.id,
          artifactType: 'ref_image',
          entityType: 'character',
          entityId: characterId,
          assetHash,
          metadata: { slot },
          createdAt: timestamp,
        });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'persisted',
          output: {
            characterId,
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
        const location = context.db.getLocation(locationId);
        if (!location) {
          throw new Error(`Location not found: ${locationId}`);
        }
        if (!location.name) {
          throw new Error('Location must have a name');
        }
        const slot = typeof context.taskRun.input.slot === 'string'
          ? context.taskRun.input.slot
          : 'main';

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'validated',
          output: {
            locationId,
            slot,
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
        const validated = getTaskOutput(context.db.listWorkflowTaskRuns(context.workflowRun.id), 'validate-location-input');
        const locationId = requireString(validated.locationId, 'locationId');
        const slot = requireString(validated.slot, 'slot');

        const location = context.db.getLocation(locationId);
        if (!location) {
          throw new Error(`Location not found: ${locationId}`);
        }

        const prompt = buildLocationRefImagePrompt(location, slot);
        const result = await generateImage(prompt, { width: 2048, height: 1360 });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'generated',
          output: {
            locationId,
            slot,
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
        const generated = getTaskOutput(context.db.listWorkflowTaskRuns(context.workflowRun.id), 'generate-location-ref-image');
        const locationId = requireString(generated.locationId, 'locationId');
        const slot = requireString(generated.slot, 'slot');
        const assetHash = requireString(generated.assetHash, 'assetHash');

        const location = context.db.getLocation(locationId);
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
          const isStandard = LOCATION_STANDARD_SLOTS.includes(slot as (typeof LOCATION_STANDARD_SLOTS)[number]);
          referenceImages.push({ slot, assetHash, isStandard, variants: [assetHash] });
        }

        const updated = { ...location, referenceImages, updatedAt: Date.now() };
        context.db.upsertLocation(updated);

        const timestamp = Date.now();
        context.db.insertWorkflowArtifact({
          id: randomUUID(),
          workflowRunId: context.workflowRun.id,
          taskRunId: context.taskRun.id,
          artifactType: 'ref_image',
          entityType: 'location',
          entityId: locationId,
          assetHash,
          metadata: { slot },
          createdAt: timestamp,
        });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'persisted',
          output: {
            locationId,
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
