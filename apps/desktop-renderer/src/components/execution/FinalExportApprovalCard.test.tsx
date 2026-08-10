// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ApproveWorkflowGateResult,
  FinalExportManifestContent,
  WorkflowApprovalContext,
} from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import { FinalExportApprovalCard } from './FinalExportApprovalCard.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function finalExportContext(): WorkflowApprovalContext {
  const manifest: FinalExportManifestContent = {
    manifestVersion: 2,
    workflowRunId: 'wf-final-1',
    productionPlan: { revision: 3, contentHash: 'plan-hash-3' },
    visualConstitution: { revision: 5, contentHash: 'visual-hash-5' },
    canvasId: 'canvas-final-1',
    assemblySnapshotHash: 'assembly-hash-1',
    segments: [
      {
        order: 2,
        nodeId: 'node-two',
        nodeUpdatedAt: 20,
        title: 'Closing transmission',
        assetHash: 'asset-hash-two',
        assetFormat: 'video/mp4',
        selectedVariantIndex: 1,
        trimInMs: 500,
        trimOutMs: 2750,
        sourceDurationMs: 3000,
        sourceStartSeconds: 0.5,
        durationSeconds: 2.25,
        speed: 1,
        sourceWidth: 1080,
        sourceHeight: 1920,
      },
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
        sourceWidth: 1280,
        sourceHeight: 720,
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
      fitMode: 'contain',
      backgroundColor: '#000000',
    },
    expectedDurationMs: 6250,
    estimatedDurationSeconds: 6.25,
    maxRenderAttempts: 2,
    resolutionRisks: [
      {
        code: 'aspect_padding',
        severity: 'info',
        nodeId: 'node-two',
        message: 'Source aspect ratio will be padded to preserve composition',
        source: { width: 1080, height: 1920 },
        output: { width: 1920, height: 1080 },
      },
      {
        code: 'upscale',
        severity: 'warning',
        nodeId: 'node-one',
        message: 'Source will be upscaled 1.50×',
        source: { width: 1280, height: 720 },
        output: { width: 1920, height: 1080 },
      },
    ],
    capabilities: {
      embeddedClipAudio: true,
      separateAudioMix: false,
      subtitles: false,
    },
  };

  return {
    run: {
      id: manifest.workflowRunId,
      workflowType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: manifest.canvasId,
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
      workflowRunId: manifest.workflowRunId,
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
      workflowRunId: manifest.workflowRunId,
      logicalKey: 'final-export',
      documentType: 'final_export_manifest',
      revision: 7,
      schemaVersion: 1,
      content: manifest,
      contentHash: 'manifest-hash-7',
      status: 'active',
      createdAt: 3,
      updatedAt: 3,
    },
  };
}

describe('FinalExportApprovalCard', () => {
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

  it('shows the exact locked manifest before recording a final approval', async () => {
    const context = finalExportContext();
    const onApprove = vi.fn(
      async () => ({ ok: true, code: 'approved' }) as ApproveWorkflowGateResult,
    );
    const onApproved = vi.fn();
    const onRequestChanges = vi.fn(async () => undefined);
    const onRequested = vi.fn();

    await act(async () => {
      root.render(
        <FinalExportApprovalCard
          context={context}
          onApprove={onApprove}
          onApproved={onApproved}
          onRequestChanges={onRequestChanges}
          onRequested={onRequested}
        />,
      );
      await flushPromises();
    });

    const content = container.textContent ?? '';
    expect(content).toContain(`${t('finalExportApproval.manifestRevision')} 7`);
    expect(content).toContain('manifest-hash-7');
    expect(content).toContain('plan-hash-3');
    expect(content).toContain('visual-hash-5');
    expect(content).toContain('assembly-hash-1');
    expect(content.indexOf('Opening signal')).toBeLessThan(content.indexOf('Closing transmission'));
    expect(content).toContain('asset-hash-one');
    expect(content).toContain('asset-hash-two');
    expect(content).toContain('4s');
    expect(content).toContain('2.25s');
    expect(content).toContain('signal-final.mp4');
    expect(content).toContain('1920×1080');
    expect(content).toContain('1080×1920');
    expect(content).toContain('contain');
    expect(content).toContain(t('finalExportApproval.resolutionRisks'));
    expect(content).toContain(t('finalExportApproval.risk.aspect_padding'));
    expect(content).toContain(t('finalExportApproval.risk.upscale'));
    expect(content).toContain(t('finalExportApproval.noAudioTracks'));
    expect(content).toContain(t('finalExportApproval.noSubtitleTracks'));
    expect(content).toContain(t('finalExportApproval.unavailable'));
    expect(content).toContain(t('finalExportApproval.changeWarning'));
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
      setTextareaValue(reason, 'Please replace the opening shot before export.');
      await flushPromises();
    });
    const submitChanges = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('workflowApproval.submitRequestChanges')),
    );
    await act(async () => {
      submitChanges?.click();
      await flushPromises();
    });
    expect(onRequestChanges).toHaveBeenCalledWith('Please replace the opening shot before export.');
    expect(onRequested).toHaveBeenCalledTimes(1);

    const approveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('finalExportApproval.approve')),
    );
    await act(async () => {
      approveButton?.click();
      await flushPromises();
    });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApproved).toHaveBeenCalledTimes(1);
  });
});
