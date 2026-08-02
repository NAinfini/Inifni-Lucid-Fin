// @vitest-environment jsdom

import React, { act } from 'react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { configureStore } from '@reduxjs/toolkit';
import type { WorkflowApprovalContext } from '@lucid-fin/contracts';
import { WorkflowDetailDrawer } from './WorkflowDetailDrawer.js';
import { t } from '../../i18n.js';
import {
  setWorkflowStages,
  setWorkflowSummaries,
  setWorkflowTasks,
  workflowsSlice,
} from '../../store/slices/workflows.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkflowDetailDrawer', () => {
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
    (window as unknown as { lucidAPI?: unknown }).lucidAPI = undefined;
  });

  it('shows stage, task, prompt template, and model data for a workflow run', async () => {
    const store = configureStore({
      reducer: {
        workflows: workflowsSlice.reducer,
      },
    });

    store.dispatch(
      setWorkflowSummaries([
        {
          id: 'wf-1',
          workflowType: 'storyboard.generate',
          entityType: 'scene',
          entityId: 'scene-1',
          triggerSource: 'user',
          status: 'running',
          summary: 'running 1/3 stages, 1/3 tasks',
          progress: 33,
          completedStages: 1,
          totalStages: 3,
          completedTasks: 1,
          totalTasks: 3,
          displayCategory: 'Storyboard',
          displayLabel: 'Generate storyboard',
          relatedEntityLabel: 'Opening Scene · KF 1',
          provider: 'flux',
          modelKey: 'flux',
          createdAt: 100,
          updatedAt: 200,
        },
      ]),
    );

    store.dispatch(
      setWorkflowStages({
        workflowRunId: 'wf-1',
        stages: [
          {
            id: 'stage-1',
            workflowRunId: 'wf-1',
            stageId: 'generate',
            name: 'Generate storyboard variants',
            status: 'running',
            order: 1,
            progress: 50,
            completedTasks: 0,
            totalTasks: 1,
            metadata: {},
            updatedAt: 200,
          },
        ],
      }),
    );

    store.dispatch(
      setWorkflowTasks({
        workflowRunId: 'wf-1',
        tasks: [
          {
            id: 'task-1',
            workflowRunId: 'wf-1',
            stageRunId: 'stage-1',
            taskId: 'generate-frames',
            kind: 'adapter_generation',
            status: 'running',
            displayCategory: 'Storyboard',
            displayLabel: 'Generate storyboard frames',
            relatedEntityLabel: 'Opening Scene · KF 1',
            provider: 'flux',
            modelKey: 'flux-pro-1',
            promptTemplateId: 'storyboard.generate.frames',
            promptTemplateVersion: '1.0.0',
            summary: 'Generate storyboard frame variants from the selected scene prompt.',
            updatedAt: 210,
          },
        ],
      }),
    );

    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <Provider store={store}>
          <WorkflowDetailDrawer workflowRunId="wf-1" open onClose={onClose} />
        </Provider>,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('Generate storyboard');
    expect(container.textContent).toContain('Generate storyboard variants');
    expect(container.textContent).toContain('Generate storyboard frames');
    expect(container.textContent).toContain('flux-pro-1');
    expect(container.textContent).toContain('storyboard.generate.frames');

    const closeButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('workflowDrawer.close')),
    );

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps visual selection and Visual Constitution approval as separate user actions', async () => {
    const store = configureStore({ reducer: { workflows: workflowsSlice.reducer } });
    store.dispatch(
      setWorkflowSummaries([
        {
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
          displayCategory: 'Movie',
          displayLabel: 'Produce Signal',
          createdAt: 1,
          updatedAt: 2,
        },
      ]),
    );
    store.dispatch(setWorkflowStages({ workflowRunId: 'wf-visual-1', stages: [] }));
    store.dispatch(setWorkflowTasks({ workflowRunId: 'wf-visual-1', tasks: [] }));

    const run = {
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
      rowVersion: 3,
    } as const;
    const visualGrammar = {
      medium: 'cinematic image',
      era: '1970s',
      rendering: 'photochemical realism',
      linework: 'natural',
      palette: 'amber and charcoal',
      lighting: 'tungsten practicals',
      texture: 'fine grain',
      mood: 'foreboding',
      cameraGrammar: 'locked frames',
      lensGrammar: '32mm wides',
      compositionGrammar: 'negative space',
      motionGrammar: 'stable camera',
      characterAnchors: [],
      locationAnchors: ['radio room'],
      negativeConstraints: ['no neon'],
    };
    const makeCandidate = (id: string, assetHash: string, seed: number) => ({
      id,
      name: id === 'analog' ? 'Analog Horror' : 'Quiet Realism',
      summary: 'A visible visual direction',
      prompt: `${id} prompt`,
      seed,
      constitution: visualGrammar,
      status: 'completed',
      selectedAttempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'completed',
          prompt: `${id} prompt`,
          promptHash: '1'.repeat(64),
          providerId: 'image-provider',
          model: 'image-model',
          requestedSeed: seed,
          width: 1024,
          height: 576,
          estimatedCostUsd: 0.2,
          reportedActualCostUsd: 0.18,
          assetHash,
          grade: {
            rubricVersion: 'visual-preview-rubric-v1',
            promptAdherence: 85,
            styleClarity: 85,
            storyFit: 85,
            lighting: 85,
            composition: 85,
            continuityPotential: 85,
            total: 85,
            verdict: 'pass',
            strengths: ['Clear hierarchy'],
            risks: ['Identity not locked'],
            evidence: 'The radio room is visible.',
            visionProviderId: 'vision-provider',
          },
          startedAt: 3,
          completedAt: 4,
        },
      ],
    });
    const candidates = [
      makeCandidate('analog', 'asset-analog', 101),
      makeCandidate('realism', 'asset-realism', 202),
    ];
    const auditionContext = {
      run,
      document: {
        id: 'audition-5',
        workflowRunId: run.id,
        logicalKey: 'visual-auditions',
        documentType: 'visual_auditions',
        revision: 5,
        schemaVersion: 1,
        content: {
          status: 'complete',
          requestHash: '2'.repeat(64),
          rubricVersion: 'visual-preview-rubric-v1',
          productionPlan: { revision: 1, contentHash: '3'.repeat(64) },
          providerId: 'image-provider',
          width: 1024,
          height: 576,
          candidates,
          recommendedCandidateId: 'analog',
          budget: {
            approvedStyleAuditionCostUsd: 1,
            maxRegenerations: 2,
            maxAttemptsPerCandidate: 2,
            estimatedCommittedUsd: 0.4,
            reportedActualUsd: 0.36,
            hasUnreportedActualCosts: false,
            unpricedOperations: ['vision-grade'],
          },
        },
        contentHash: '4'.repeat(64),
        status: 'active',
        createdAt: 3,
        updatedAt: 4,
      },
    };
    const approvalContext = {
      run: {
        ...run,
        status: 'awaiting_approval',
        currentGate: 'visual_constitution',
        rowVersion: 4,
      },
      approval: {
        id: 'approval-visual',
        workflowRunId: run.id,
        gateKey: 'visual_constitution',
        subjectLogicalKey: 'visual-constitution',
        subjectRevision: 1,
        subjectHash: '5'.repeat(64),
        manifestHash: '6'.repeat(64),
        status: 'pending',
        createdAt: 5,
        updatedAt: 5,
      },
      document: {
        id: 'visual-constitution-1',
        workflowRunId: run.id,
        logicalKey: 'visual-constitution',
        documentType: 'visual_constitution',
        revision: 1,
        schemaVersion: 1,
        content: {
          productionPlan: { revision: 1, contentHash: '3'.repeat(64) },
          visualAuditions: { revision: 5, contentHash: '4'.repeat(64) },
          selectedCandidateId: 'analog',
          selectedBy: 'user',
          selectedPreview: {
            assetHash: 'asset-analog',
            providerId: 'image-provider',
            seed: 101,
            prompt: 'analog prompt',
            promptHash: '1'.repeat(64),
          },
          locked: visualGrammar,
          candidates,
          budget: auditionContext.document.content.budget,
        },
        contentHash: '5'.repeat(64),
        status: 'active',
        createdAt: 5,
        updatedAt: 5,
      },
    };

    const getPendingApproval = vi.fn(async () => null);
    const getVisualAuditions = vi.fn(async () => auditionContext);
    const selectVisualCandidate = vi.fn(async () => ({
      context: approvalContext,
      created: true,
    }));
    const approveGate = vi.fn(async () => ({ ok: true, code: 'approved' }));
    window.lucidAPI = {
      workflow: {
        getPendingApproval,
        getVisualAuditions,
        selectVisualCandidate,
        approveGate,
      },
    } as never;

    await act(async () => {
      root.render(
        <Provider store={store}>
          <WorkflowDetailDrawer workflowRunId={run.id} open onClose={vi.fn()} />
        </Provider>,
      );
      await flushPromises();
    });

    expect(getVisualAuditions).toHaveBeenCalledWith(run.id);
    expect(approveGate).not.toHaveBeenCalled();
    const lockButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('visualConstitutionApproval.lockSelection')),
    );
    await act(async () => {
      lockButton?.click();
      await flushPromises();
    });

    expect(selectVisualCandidate).toHaveBeenCalledWith({
      workflowRunId: run.id,
      candidateId: 'analog',
      expectedRowVersion: 3,
      expectedAuditionRevision: 5,
      expectedAuditionHash: '4'.repeat(64),
    });
    expect(approveGate).not.toHaveBeenCalled();

    const approveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('visualConstitutionApproval.approve')),
    );
    await act(async () => {
      approveButton?.click();
      await flushPromises();
    });

    expect(approveGate).toHaveBeenCalledWith({
      workflowRunId: run.id,
      gateKey: 'visual_constitution',
      expectedRowVersion: 4,
      expectedSubjectRevision: 1,
      expectedSubjectHash: '5'.repeat(64),
    });
  });

  it('approves Final Export only with its exact manifest revision, hash, and row version', async () => {
    const store = configureStore({ reducer: { workflows: workflowsSlice.reducer } });
    store.dispatch(
      setWorkflowSummaries([
        {
          id: 'wf-final-1',
          workflowType: 'movie.production.v2',
          entityType: 'canvas',
          entityId: 'canvas-final-1',
          triggerSource: 'user',
          status: 'awaiting_approval',
          summary: 'Final Export awaiting approval',
          progress: 90,
          completedStages: 5,
          totalStages: 6,
          completedTasks: 10,
          totalTasks: 11,
          displayCategory: 'Movie',
          displayLabel: 'Produce Signal',
          createdAt: 1,
          updatedAt: 2,
        },
      ]),
    );
    store.dispatch(setWorkflowStages({ workflowRunId: 'wf-final-1', stages: [] }));
    store.dispatch(setWorkflowTasks({ workflowRunId: 'wf-final-1', tasks: [] }));

    const approvalContext: WorkflowApprovalContext = {
      run: {
        id: 'wf-final-1',
        workflowType: 'movie.production.v2',
        entityType: 'canvas',
        entityId: 'canvas-final-1',
        triggerSource: 'user',
        status: 'awaiting_approval',
        summary: 'Final Export awaiting approval',
        progress: 90,
        completedStages: 5,
        totalStages: 6,
        completedTasks: 10,
        totalTasks: 11,
        input: {},
        output: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 2,
        rowVersion: 19,
        currentGate: 'final_export',
      },
      approval: {
        id: 'approval-final-1',
        workflowRunId: 'wf-final-1',
        gateKey: 'final_export',
        subjectLogicalKey: 'final-export',
        subjectRevision: 7,
        subjectHash: 'manifest-hash-7',
        manifestHash: 'manifest-hash-7',
        status: 'pending',
        createdAt: 3,
        updatedAt: 3,
      },
      document: {
        id: 'manifest-7',
        workflowRunId: 'wf-final-1',
        logicalKey: 'final-export',
        documentType: 'final_export_manifest',
        revision: 7,
        schemaVersion: 1,
        content: {
          manifestVersion: 1,
          workflowRunId: 'wf-final-1',
          productionPlan: { revision: 3, contentHash: 'plan-hash-3' },
          visualConstitution: { revision: 5, contentHash: 'visual-hash-5' },
          canvasId: 'canvas-final-1',
          assemblySnapshotHash: 'assembly-hash-1',
          segments: [
            {
              order: 1,
              nodeId: 'node-one',
              nodeUpdatedAt: 10,
              title: 'Opening signal',
              assetHash: 'asset-hash-one',
              assetFormat: 'video/mp4',
              selectedVariantIndex: 0,
              trimInMs: 0,
              trimOutMs: 4000,
              sourceDurationMs: 4000,
              sourceStartSeconds: 0,
              durationSeconds: 4,
              speed: 1,
            },
          ],
          audioTracks: [],
          subtitleTracks: [],
          output: {
            container: 'mp4',
            codec: 'h264',
            quality: 'high',
            width: 1920,
            height: 1080,
            fps: 24,
            logicalFileName: 'signal-final.mp4',
            audioCodec: 'aac',
            pixelFormat: 'yuv420p',
            overwritePolicy: 'fail',
          },
          expectedDurationMs: 4000,
          estimatedDurationSeconds: 4,
          maxRenderAttempts: 2,
          capabilities: {
            embeddedClipAudio: true,
            separateAudioMix: false,
            subtitles: false,
          },
        },
        contentHash: 'manifest-hash-7',
        status: 'active',
        createdAt: 3,
        updatedAt: 3,
      },
    };

    const getPendingApproval = vi.fn(async () => approvalContext);
    const getVisualAuditions = vi.fn(async () => null);
    const approveGate = vi.fn(async () => ({ ok: true, code: 'approved' }));
    window.lucidAPI = {
      workflow: {
        getPendingApproval,
        getVisualAuditions,
        approveGate,
      },
    } as never;

    await act(async () => {
      root.render(
        <Provider store={store}>
          <WorkflowDetailDrawer workflowRunId="wf-final-1" open onClose={vi.fn()} />
        </Provider>,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain(t('finalExportApproval.title'));
    expect(approveGate).not.toHaveBeenCalled();
    const approveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('finalExportApproval.approve')),
    );
    await act(async () => {
      approveButton?.click();
      await flushPromises();
    });

    expect(approveGate).toHaveBeenCalledWith({
      workflowRunId: 'wf-final-1',
      gateKey: 'final_export',
      expectedRowVersion: 19,
      expectedSubjectRevision: 7,
      expectedSubjectHash: 'manifest-hash-7',
    });
  });
});
