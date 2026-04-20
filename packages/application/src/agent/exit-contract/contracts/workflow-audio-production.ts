import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Execution contract for the audio-production workflow. Mirrors
 * `docs/ai-skills/workflows/audio-production.md`:
 *
 *   canvas.setSettings — canvas-scoped audio configuration (provider,
 *   lip-sync toggles).
 *   canvas.batchCreate — creating voice or dialogue nodes.
 *   canvas.setVideoParams — attaching lip-sync flags to existing video
 *   nodes (never `canvas.updateNodes` for this).
 *
 * For `canvas.setSettings`, the argPredicate narrows the match to audio-
 * adjacent keys so a stylePlate write doesn't falsely satisfy.
 */
export const audioProductionContract: CompletionContract = {
  id: 'audio-production',
  requiredCommits: [
    {
      toolName: 'canvas.setSettings',
      description: 'Write canvas-scoped audio configuration.',
      argPredicate: (args) => settingsTouchesAudio(args),
    },
  ],
  acceptableSubstitutes: [
    {
      toolName: 'canvas.batchCreate',
      description: 'Create voice / dialogue nodes.',
      argPredicate: (args) => nodesArray(args).length >= 1,
    },
    {
      toolName: 'canvas.setVideoParams',
      description: 'Attach lip-sync flags to existing video nodes.',
    },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 2,
};

const AUDIO_KEYS = new Set([
  'audioProvider',
  'audioModel',
  'lipSync',
  'lipSyncEnabled',
  'voiceProvider',
  'dialogueProvider',
]);

function settingsTouchesAudio(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const settings = (args as Record<string, unknown>).settings;
  if (!settings || typeof settings !== 'object') return false;
  return Object.keys(settings).some((k) => AUDIO_KEYS.has(k));
}

function nodesArray(args: unknown): unknown[] {
  if (!args || typeof args !== 'object') return [];
  const nodes = (args as Record<string, unknown>).nodes;
  return Array.isArray(nodes) ? nodes : [];
}

contractRegistry.register(audioProductionContract);
