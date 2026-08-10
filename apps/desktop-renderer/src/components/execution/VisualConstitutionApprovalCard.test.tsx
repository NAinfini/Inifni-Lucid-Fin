// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ApproveWorkflowGateResult,
  VisualConstitutionSelectionResult,
  WorkflowApprovalContext,
  WorkflowRun,
  WorkflowVisualAuditionContext,
} from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import { VisualConstitutionApprovalCard } from './VisualConstitutionApprovalCard.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

const run: WorkflowRun = {
  id: 'wf-visual-1',
  workflowType: 'movie.production.v2',
  entityType: 'canvas',
  entityId: 'canvas-1',
  triggerSource: 'commander',
  status: 'ready',
  summary: 'Choose a visual direction',
  progress: 20,
  completedStages: 1,
  totalStages: 6,
  completedTasks: 1,
  totalTasks: 6,
  currentStageId: 'style-exploration',
  input: {},
  output: {},
  metadata: {},
  createdAt: 1,
  updatedAt: 2,
  rowVersion: 4,
};

function grammar(rendering: string) {
  return {
    medium: 'cinematic digital image',
    era: 'late 1970s',
    rendering,
    linework: 'natural edges',
    palette: 'amber, teal, charcoal',
    lighting: 'tungsten practical with cold fill',
    texture: 'fine grain',
    mood: 'isolated and foreboding',
    cameraGrammar: 'locked frames',
    lensGrammar: '32mm wides and 65mm closeups',
    compositionGrammar: 'negative space',
    motionGrammar: 'stable camera',
    characterAnchors: [],
    locationAnchors: ['radio room'],
    negativeConstraints: ['no neon'],
  };
}

function candidate(id: string, name: string, assetHash: string, score: number, seed: number) {
  return {
    id,
    name,
    summary: `${name} summary`,
    prompt: `${name} prompt`,
    seed,
    constitution: grammar(name),
    status: 'completed' as const,
    selectedAttempt: 1,
    attempts: [
      {
        attempt: 1,
        status: 'completed' as const,
        prompt: `${name} prompt`,
        promptHash: id.padEnd(64, 'a').slice(0, 64),
        providerId: 'image-provider',
        model: 'image-model-v2',
        requestedSeed: seed,
        reportedSeed: seed + 1,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.3,
        reportedActualCostUsd: 0.25,
        assetHash,
        grade: {
          rubricVersion: 'visual-preview-rubric-v1',
          promptAdherence: score,
          styleClarity: score,
          storyFit: score,
          lighting: score,
          composition: score,
          continuityPotential: score,
          total: score,
          verdict: 'pass' as const,
          strengths: ['Clear lighting hierarchy'],
          risks: ['Identity is not locked yet'],
          evidence: 'The radio room and tungsten practical are both visible.',
          visionProviderId: 'vision-provider',
          visionModel: 'vision-model-v1',
        },
        startedAt: 3,
        completedAt: 4,
      },
    ],
  };
}

const auditionContext: WorkflowVisualAuditionContext = {
  run,
  document: {
    id: 'audition-doc-8',
    workflowRunId: run.id,
    logicalKey: 'visual-auditions',
    documentType: 'visual_auditions',
    revision: 8,
    schemaVersion: 1,
    content: {
      status: 'complete',
      requestHash: 'c'.repeat(64),
      rubricVersion: 'visual-preview-rubric-v1',
      productionPlan: { revision: 2, contentHash: 'p'.repeat(64) },
      providerId: 'image-provider',
      width: 1024,
      height: 576,
      candidates: [
        candidate('analog-horror', 'Analog Horror', 'asset-one', 88, 101),
        candidate('quiet-realism', 'Quiet Realism', 'asset-two', 82, 202),
      ],
      recommendedCandidateId: 'analog-horror',
      budget: {
        approvedStyleAuditionCostUsd: 2,
        maxRegenerations: 2,
        maxAttemptsPerCandidate: 2,
        estimatedCommittedUsd: 0.6,
        reportedActualUsd: 0.5,
        hasUnreportedActualCosts: false,
        unpricedOperations: ['vision-grade'],
      },
    },
    contentHash: 'd'.repeat(64),
    status: 'active',
    createdAt: 3,
    updatedAt: 4,
  },
};

function visualApprovalContext(): WorkflowApprovalContext {
  return {
    run: { ...run, status: 'awaiting_approval', rowVersion: 5, currentGate: 'visual_constitution' },
    approval: {
      id: 'approval-visual-1',
      workflowRunId: run.id,
      gateKey: 'visual_constitution',
      subjectLogicalKey: 'visual-constitution',
      subjectRevision: 1,
      subjectHash: 'e'.repeat(64),
      manifestHash: 'f'.repeat(64),
      status: 'pending',
      createdAt: 5,
      updatedAt: 5,
    },
    document: {
      id: 'visual-doc-1',
      workflowRunId: run.id,
      logicalKey: 'visual-constitution',
      documentType: 'visual_constitution',
      revision: 1,
      schemaVersion: 1,
      content: {
        productionPlan: { revision: 2, contentHash: 'p'.repeat(64) },
        visualAuditions: { revision: 8, contentHash: 'd'.repeat(64) },
        selectedCandidateId: 'analog-horror',
        selectedBy: 'user',
        selectedPreview: {
          assetHash: 'asset-one',
          providerId: 'image-provider',
          model: 'image-model-v2',
          seed: 102,
          prompt: 'Analog Horror prompt',
          promptHash: 'a'.repeat(64),
        },
        locked: grammar('Analog Horror'),
        candidates: auditionContext.document.content.candidates,
        budget: auditionContext.document.content.budget,
      },
      contentHash: 'e'.repeat(64),
      status: 'active',
      createdAt: 5,
      updatedAt: 5,
    },
  };
}

describe('VisualConstitutionApprovalCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flushPromises();
    });
    container.remove();
  });

  it('shows real previews and records selection only after an explicit lock click', async () => {
    const context = visualApprovalContext();
    const onSelect = vi.fn(
      async () => ({ context, created: true }) as VisualConstitutionSelectionResult,
    );
    const onApprove = vi.fn(
      async () => ({ ok: true, code: 'approved' }) as ApproveWorkflowGateResult,
    );

    await act(async () => {
      root.render(
        <VisualConstitutionApprovalCard
          auditionContext={auditionContext}
          onSelect={onSelect}
          onApprove={onApprove}
        />,
      );
      await flushPromises();
    });

    const previews = Array.from(container.querySelectorAll('img'));
    expect(previews.map((image) => image.getAttribute('src'))).toEqual([
      'lucid-asset://asset-one/image/png',
      'lucid-asset://asset-two/image/png',
    ]);
    expect(container.textContent).toContain('88/100');
    expect(container.textContent).toContain('image-provider');
    expect(container.textContent).toContain('image-model-v2');
    expect(container.textContent).toContain('vision-provider');
    expect(container.textContent).toContain(
      'The radio room and tungsten practical are both visible.',
    );
    expect(container.textContent).toContain('vision-grade');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onApprove).not.toHaveBeenCalled();

    const quietRealism = container.querySelector<HTMLInputElement>('input[value="quiet-realism"]');
    await act(async () => {
      quietRealism?.click();
      await flushPromises();
    });
    const lockButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('visualConstitutionApproval.lockSelection')),
    );
    await act(async () => {
      lockButton?.click();
      await flushPromises();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('quiet-realism');
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('requires a second explicit action to approve the already locked revision', async () => {
    const approvalContext = visualApprovalContext();
    const onApprove = vi.fn(
      async () => ({ ok: true, code: 'approved' }) as ApproveWorkflowGateResult,
    );
    const onApproved = vi.fn();
    const onRequestChanges = vi.fn(async () => undefined);
    const onRequested = vi.fn();

    await act(async () => {
      root.render(
        <VisualConstitutionApprovalCard
          auditionContext={{ ...auditionContext, run: approvalContext.run }}
          approvalContext={approvalContext}
          onSelect={vi.fn()}
          onApprove={onApprove}
          onApproved={onApproved}
          onRequestChanges={onRequestChanges}
          onRequested={onRequested}
        />,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('e'.repeat(64));
    expect(onApprove).not.toHaveBeenCalled();
    const requestChangesButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('workflowApproval.requestChanges')),
    );
    await act(async () => {
      requestChangesButton?.click();
      await flushPromises();
    });
    const reason = container.querySelector<HTMLTextAreaElement>('textarea');
    if (!reason) throw new Error('Expected a request-changes reason field');
    await act(async () => {
      setTextareaValue(reason, 'Keep the composition but try a warmer palette.');
      await flushPromises();
    });
    const submitChanges = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('workflowApproval.submitRequestChanges')),
    );
    await act(async () => {
      submitChanges?.click();
      await flushPromises();
    });
    expect(onRequestChanges).toHaveBeenCalledWith('Keep the composition but try a warmer palette.');
    expect(onRequested).toHaveBeenCalledTimes(1);

    const approveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('visualConstitutionApproval.approve')),
    );
    await act(async () => {
      approveButton?.click();
      await flushPromises();
    });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApproved).toHaveBeenCalledTimes(1);
  });
});
