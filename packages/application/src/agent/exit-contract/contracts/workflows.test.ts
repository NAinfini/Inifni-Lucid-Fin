import { describe, expect, it } from 'vitest';
import { decide } from '../exit-decision-engine.js';
import type { CompletionEvidence, RunIntent } from '../types.js';
import {
  storyToVideoContract,
  stylePlateContract,
  shotListContract,
  continuityCheckContract,
  imageAnalyzeContract,
  audioProductionContract,
  styleTransferContract,
} from './index.js';

function commit(
  toolName: string,
  args: unknown,
  resultOk = true,
): CompletionEvidence {
  return { kind: 'mutation_commit', toolName, args, resultOk, at: 0 };
}

function expectSatisfied(
  contractId: string,
  ledger: CompletionEvidence[],
  intent: RunIntent = { kind: 'execution', workflow: contractId },
) {
  const contract = {
    ...(contractMap[contractId] ?? storyToVideoContract),
    id: contractId,
  };
  const decision = decide({ contract, intent, ledger });
  expect(decision.outcome, JSON.stringify(decision)).toBe('satisfied');
}

function expectUnsatisfied(
  contractId: string,
  ledger: CompletionEvidence[],
  intent: RunIntent = { kind: 'execution', workflow: contractId },
) {
  const contract = {
    ...(contractMap[contractId] ?? storyToVideoContract),
    id: contractId,
  };
  const decision = decide({ contract, intent, ledger });
  expect(decision.outcome, JSON.stringify(decision)).toBe('unsatisfied');
}

const contractMap = {
  'story-to-video': storyToVideoContract,
  'style-plate': stylePlateContract,
  'shot-list': shotListContract,
  'continuity-check': continuityCheckContract,
  'image-analyze': imageAnalyzeContract,
  'audio-production': audioProductionContract,
  'style-transfer': styleTransferContract,
} as const;

describe('workflow contracts — satisfied paths', () => {
  it('story-to-video: canvas.batchCreate with non-empty nodes satisfies', () => {
    expectSatisfied('story-to-video', [
      commit('canvas.batchCreate', { nodes: [{ type: 'image' }] }),
    ]);
  });

  it('story-to-video: canvas.batchCreate with empty nodes does NOT satisfy', () => {
    expectUnsatisfied('story-to-video', [
      commit('canvas.batchCreate', { nodes: [] }),
    ]);
  });

  it('style-plate: canvas.setSettings with stylePlate key satisfies', () => {
    expectSatisfied('style-plate', [
      commit('canvas.setSettings', { settings: { stylePlate: 'warm cinematic' } }),
    ]);
  });

  it('style-plate: canvas.setSettings writing unrelated keys does NOT satisfy', () => {
    expectUnsatisfied('style-plate', [
      commit('canvas.setSettings', { settings: { audioProvider: 'elevenlabs' } }),
    ]);
  });

  it('shot-list: canvas.batchCreate satisfies', () => {
    expectSatisfied('shot-list', [
      commit('canvas.batchCreate', { nodes: [{ type: 'shot' }] }),
    ]);
  });

  it('shot-list: shotTemplate.create satisfies via substitute', () => {
    expectSatisfied('shot-list', [commit('shotTemplate.create', { name: 'hero' })]);
  });

  it('continuity-check: canvas.updateNodes with non-empty updates satisfies', () => {
    expectSatisfied('continuity-check', [
      commit('canvas.updateNodes', { updates: [{ id: 'n1', prompt: 'x' }] }),
    ]);
  });

  it('image-analyze: character.create satisfies primary requirement', () => {
    expectSatisfied('image-analyze', [commit('character.create', { name: 'hero' })]);
  });

  it('image-analyze: preset.create satisfies via substitute', () => {
    expectSatisfied('image-analyze', [commit('preset.create', { name: 'warm' })]);
  });

  it('audio-production: canvas.setSettings with audioProvider satisfies', () => {
    expectSatisfied('audio-production', [
      commit('canvas.setSettings', { settings: { audioProvider: 'elevenlabs' } }),
    ]);
  });

  it('audio-production: canvas.setSettings with stylePlate does NOT satisfy', () => {
    expectUnsatisfied('audio-production', [
      commit('canvas.setSettings', { settings: { stylePlate: 'x' } }),
    ]);
  });

  it('audio-production: canvas.setVideoParams satisfies via substitute', () => {
    expectSatisfied('audio-production', [
      commit('canvas.setVideoParams', { nodeId: 'n1', lipSync: true }),
    ]);
  });

  it('style-transfer: canvas.updateNodes satisfies primary', () => {
    expectSatisfied('style-transfer', [
      commit('canvas.updateNodes', { updates: [{ id: 'n1', preset: 'warm' }] }),
    ]);
  });

  it('style-transfer: preset.update satisfies via substitute', () => {
    expectSatisfied('style-transfer', [commit('preset.update', { id: 'p1' })]);
  });
});

describe('workflow contracts — informational exemption', () => {
  it('every execution contract exempts informational intent', () => {
    for (const contract of Object.values(contractMap)) {
      const decision = decide({
        contract,
        intent: { kind: 'informational' },
        ledger: [],
      });
      expect(decision.outcome).toBe('informational_answered');
    }
  });
});

describe('workflow contracts — failed commit does not satisfy', () => {
  it('story-to-video: resultOk=false batchCreate does not satisfy', () => {
    expectUnsatisfied('story-to-video', [
      commit('canvas.batchCreate', { nodes: [{ type: 'image' }] }, false),
    ]);
  });
});
