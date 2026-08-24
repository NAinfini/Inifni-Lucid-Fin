// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ApprovePlanGateResult,
  DeliveryManifestContent,
  DeliveryManifestContext,
  DeliveryPackageTaskAttempt,
} from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';
import { DeliveryApprovalCard } from './DeliveryApprovalCard.js';

vi.mock('../../utils/api.js', () => ({ getAPI: vi.fn() }));

type DeliveryPackageAttemptView = {
  attemptId: string;
  status: DeliveryPackageTaskAttempt['status'];
  progress: number;
  destinationPath: string;
  manifestRevision: number;
  manifestHash: string;
  attempt: number;
  error?: string;
};

type ReviewCutJobView = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  outputPath: string;
  manifestRevision: number;
  manifestHash: string;
  error?: string;
};

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deliveryContext(): DeliveryManifestContext {
  const manifest: DeliveryManifestContent = {
    taskListId: 'delivery-task-list',
    canvasId: 'canvas-project',
    productionPlan: { revision: 3, contentHash: 'plan-hash-3' },
    visualConstitution: { revision: 5, contentHash: 'visual-hash-5' },
    deliverySequence: { revision: 12, contentHash: 'delivery-sequence-hash-12' },
    namingPolicy: {
      packageBaseName: 'signal-package',
      orderPrefixWidth: 3,
      separator: '_',
      overwritePolicy: 'fail',
    },
    items: [
      {
        shotId: 'shot-opening',
        selectedVideoHash: 'asset-hash-opening',
        packageFileName: '001_opening_signal_shot-opening.mp4',
        sourceFileName: 'opening signal original.mp4',
        sourceFormat: 'video/mp4',
        sourceBytes: 10_485_760,
        sourceDurationMs: 4_000,
        sourceWidth: 1_280,
        sourceHeight: 720,
        hasEmbeddedAudio: true,
        trimInMs: 0,
        trimOutMs: 4_000,
        embeddedAudioEnabled: true,
        provenance: {
          assetCreatedAt: 100,
          nodeId: 'node-opening',
          taskId: 'task-opening',
          attemptId: 'attempt-opening',
          evaluationId: 'evaluation-opening',
          promptAssemblyId: 'prompt-opening',
          providerId: 'provider-opening',
          model: 'model-opening',
        },
      },
      {
        shotId: 'shot-closing',
        selectedVideoHash: 'asset-hash-closing',
        packageFileName: '002_closing_signal_shot-closing.mp4',
        sourceFileName: 'closing signal original.mp4',
        sourceFormat: 'video/mp4',
        sourceBytes: 5_242_880,
        sourceDurationMs: 3_000,
        sourceWidth: 1_080,
        sourceHeight: 1_920,
        hasEmbeddedAudio: true,
        trimInMs: 500,
        trimOutMs: 2_750,
        embeddedAudioEnabled: false,
        provenance: {
          assetCreatedAt: 200,
          providerId: 'provider-closing',
          model: 'model-closing',
        },
      },
    ],
  };

  return {
    taskList: {
      id: manifest.taskListId,
      taskListType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: manifest.canvasId,
      triggerSource: 'user',
      status: 'awaiting_approval',
      summary: 'Delivery awaiting approval',
      progress: 90,
      completedPhases: 5,
      totalPhases: 6,
      completedTasks: 10,
      totalTasks: 11,
      input: {},
      output: {},
      metadata: {},
      createdAt: 1,
      updatedAt: 2,
      rowVersion: 19,
      currentGate: 'delivery',
    },
    approval: {
      id: 'delivery-approval',
      taskListId: manifest.taskListId,
      gateKey: 'delivery',
      subjectLogicalKey: 'delivery-manifest',
      subjectRevision: 7,
      subjectHash: 'manifest-hash-7',
      manifestHash: 'manifest-hash-7',
      status: 'pending',
      createdAt: 3,
      updatedAt: 3,
    },
    manifest: {
      id: 'delivery-manifest-7',
      taskListId: manifest.taskListId,
      logicalKey: 'delivery-manifest',
      documentType: 'delivery_manifest',
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

function packageAttempt(
  status: NonNullable<DeliveryManifestContext['packageAttempt']>['status'],
  overrides: Partial<NonNullable<DeliveryManifestContext['packageAttempt']>> = {},
): NonNullable<DeliveryManifestContext['packageAttempt']> {
  return {
    kind: 'batch_export',
    id: 'package-attempt-1',
    taskListId: 'delivery-task-list',
    taskId: 'delivery-task',
    manifestRevision: 7,
    manifestHash: 'manifest-hash-7',
    idempotencyKey: 'delivery-idempotency-key',
    status,
    rowVersion: 1,
    destinationPath: 'C:\\deliveries\\signal-package',
    attempt: 1,
    createdAt: 10,
    updatedAt: 11,
    ...overrides,
  };
}

function packageView(
  status: DeliveryPackageAttemptView['status'],
  overrides: Partial<DeliveryPackageAttemptView> = {},
): DeliveryPackageAttemptView {
  return {
    attemptId: 'package-attempt-1',
    status,
    progress: status === 'completed' ? 100 : status === 'ready_to_publish' ? 90 : 10,
    destinationPath: 'C:\\deliveries\\signal-package',
    manifestRevision: 7,
    manifestHash: 'manifest-hash-7',
    attempt: 1,
    ...overrides,
  };
}

function reviewCutJob(
  status: ReviewCutJobView['status'],
  overrides: Partial<ReviewCutJobView> = {},
): ReviewCutJobView {
  return {
    jobId: 'review-cut-job-1',
    status,
    progress: status === 'completed' ? 100 : status === 'running' ? 40 : 0,
    outputPath: 'C:\\reviews\\signal-review-cut.mp4',
    manifestRevision: 7,
    manifestHash: 'manifest-hash-7',
    ...overrides,
  };
}

describe('DeliveryApprovalCard', () => {
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
    vi.clearAllMocks();
  });

  it('shows the exact ordered source package and records approval without starting export', async () => {
    const context = deliveryContext();
    const onApprove = vi.fn(async () => ({ ok: true, code: 'approved' }) as ApprovePlanGateResult);
    const onApproved = vi.fn();

    await act(async () => {
      root.render(
        <DeliveryApprovalCard
          context={context}
          onApprove={onApprove}
          onApproved={onApproved}
        />,
      );
      await flushPromises();
    });

    const content = container.textContent ?? '';
    expect(content.indexOf('001_opening_signal_shot-opening.mp4')).toBeLessThan(
      content.indexOf('002_closing_signal_shot-closing.mp4'),
    );
    expect(content).toContain('opening signal original.mp4');
    expect(content).toContain('closing signal original.mp4');
    expect(content).toContain('0ms–4000ms');
    expect(content).toContain('500ms–2750ms');
    expect(content).toContain(t('deliveryApproval.audioEnabled'));
    expect(content).toContain(t('deliveryApproval.audioDisabled'));
    expect(content).toContain('asset-hash-opening');
    expect(content).toContain('asset-hash-closing');
    expect(content).toContain('provider-opening');
    expect(content).toContain('model-closing');
    expect(content).toContain('node-opening');
    expect(content).toContain('prompt-opening');
    expect(content).toContain('plan-hash-3');
    expect(content).toContain('visual-hash-5');
    expect(content).toContain('delivery-sequence-hash-12');
    expect(content).toContain('signal-package');
    expect(content).toContain(t('deliveryApproval.noAutomaticExport'));
    expect(content).not.toContain('Timeline');
    expect(content).not.toContain('Subtitle');
    expect(onApprove).not.toHaveBeenCalled();

    const approveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('deliveryApproval.approve')),
    );
    await act(async () => {
      approveButton?.click();
      await flushPromises();
    });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApproved).toHaveBeenCalledTimes(1);
  });

  it('starts package export only after an approved Delivery action and opens the completed package', async () => {
    const context = deliveryContext();
    context.approval.status = 'approved';
    const start = vi.fn().mockResolvedValue({
      cancelled: false,
      attempt: packageView('queued', { progress: 0 }),
    });
    const status = vi.fn().mockResolvedValue(packageView('completed'));
    const open = vi.fn().mockResolvedValue({ opened: true });
    vi.mocked(getAPI).mockReturnValue({
      deliveryPackage: {
        start,
        status,
        open,
      },
    } as unknown as ReturnType<typeof getAPI>);

    await act(async () => {
      root.render(<DeliveryApprovalCard context={context} />);
      await flushPromises();
    });

    expect(start).not.toHaveBeenCalled();
    expect(container.textContent).toContain(t('deliveryPackage.approvedTitle'));
    const startButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('deliveryPackage.start')),
    );
    await act(async () => {
      startButton?.click();
      await flushPromises();
    });

    expect(start).toHaveBeenCalledWith({
      taskListId: context.taskList.id,
      canvasId: 'canvas-project',
      expectedManifestRevision: context.manifest.revision,
      expectedManifestHash: context.manifest.contentHash,
    });
    expect(status).toHaveBeenCalledWith('package-attempt-1');
    expect(container.textContent).toContain(t('deliveryPackage.completedNotice'));

    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('deliveryPackage.open')),
    );
    await act(async () => {
      openButton?.click();
      await flushPromises();
    });
    expect(open).toHaveBeenCalledWith('package-attempt-1');
  });

  it('cancels an active package and restarts it through the service retry contract', async () => {
    const context = deliveryContext();
    context.approval.status = 'approved';
    context.packageAttempt = packageAttempt('running');
    const status = vi.fn().mockResolvedValue(packageView('running'));
    const cancel = vi.fn().mockResolvedValue({ attempt: packageView('cancelled', { progress: 0 }) });
    const retry = vi.fn().mockResolvedValue(packageView('queued', { progress: 0 }));
    vi.mocked(getAPI).mockReturnValue({
      deliveryPackage: {
        status,
        cancel,
        retry,
      },
    } as unknown as ReturnType<typeof getAPI>);

    await act(async () => {
      root.render(<DeliveryApprovalCard context={context} />);
      await flushPromises();
    });

    const cancelButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('deliveryPackage.cancel')),
    );
    await act(async () => {
      cancelButton?.click();
      await flushPromises();
    });
    expect(cancel).toHaveBeenCalledWith('package-attempt-1');
    expect(container.textContent).toContain(t('deliveryPackage.cancelledNotice'));

    const restartButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('deliveryPackage.restart')),
    );
    await act(async () => {
      restartButton?.click();
      await flushPromises();
    });
    expect(retry).toHaveBeenCalledWith('package-attempt-1');
  });

  it('keeps publishing package progress visible without offering cancellation', async () => {
    const context = deliveryContext();
    context.approval.status = 'approved';
    context.packageAttempt = packageAttempt('ready_to_publish');
    const status = vi.fn().mockResolvedValue(packageView('ready_to_publish', { progress: 90 }));
    vi.mocked(getAPI).mockReturnValue({
      deliveryPackage: { status },
    } as unknown as ReturnType<typeof getAPI>);

    await act(async () => {
      root.render(<DeliveryApprovalCard context={context} />);
      await flushPromises();
    });

    expect(status).toHaveBeenCalledWith('package-attempt-1');
    expect(container.textContent).toContain(t('deliveryPackage.status.ready_to_publish'));
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes(t('deliveryPackage.cancel')),
      ),
    ).toBe(false);
  });

  it.each(['failed', 'recovery_required'] as const)(
    'offers an explicit retry for a %s package attempt',
    async (attemptStatus) => {
      const context = deliveryContext();
      context.approval.status = 'approved';
      context.packageAttempt = packageAttempt(attemptStatus, { error: 'source copy failed' });
      const retry = vi.fn().mockResolvedValue(packageView('queued', { progress: 0 }));
      vi.mocked(getAPI).mockReturnValue({
        deliveryPackage: {
          retry,
        },
      } as unknown as ReturnType<typeof getAPI>);

      await act(async () => {
        root.render(<DeliveryApprovalCard context={context} />);
        await flushPromises();
      });

      expect(container.textContent).toContain(t(`deliveryPackage.status.${attemptStatus}`));
      expect(container.textContent).toContain('source copy failed');
      const retryButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(t('deliveryPackage.retry')),
      );
      await act(async () => {
        retryButton?.click();
        await flushPromises();
      });
      expect(retry).toHaveBeenCalledWith('package-attempt-1');
    },
  );

  it('creates a Review Cut only after an explicit action, then polls and opens the derived preview', async () => {
    const context = deliveryContext();
    context.approval.status = 'approved';
    const start = vi.fn().mockResolvedValue({
      cancelled: false,
      job: reviewCutJob('queued'),
    });
    const status = vi.fn().mockResolvedValue(reviewCutJob('completed'));
    const open = vi.fn().mockResolvedValue({ opened: true });
    vi.mocked(getAPI).mockReturnValue({
      reviewCut: { start, status, open },
    } as unknown as ReturnType<typeof getAPI>);

    await act(async () => {
      root.render(<DeliveryApprovalCard context={context} />);
      await flushPromises();
    });

    expect(start).not.toHaveBeenCalled();
    const startButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('reviewCut.start')),
    );
    await act(async () => {
      startButton?.click();
      await flushPromises();
    });

    expect(start).toHaveBeenCalledWith({
      taskListId: context.taskList.id,
      canvasId: 'canvas-project',
      expectedManifestRevision: context.manifest.revision,
      expectedManifestHash: context.manifest.contentHash,
    });
    expect(status).toHaveBeenCalledWith('review-cut-job-1');
    expect(container.textContent).toContain(t('reviewCut.completedNotice'));

    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('reviewCut.open')),
    );
    await act(async () => {
      openButton?.click();
      await flushPromises();
    });
    expect(open).toHaveBeenCalledWith('review-cut-job-1');
  });

  it('shows queued Review Cut progress and lets the user cancel the derived job', async () => {
    const context = deliveryContext();
    context.approval.status = 'approved';
    const start = vi.fn().mockResolvedValue({
      cancelled: false,
      job: reviewCutJob('queued'),
    });
    const status = vi.fn().mockResolvedValue(reviewCutJob('queued'));
    const cancel = vi.fn().mockResolvedValue({ job: reviewCutJob('cancelled') });
    vi.mocked(getAPI).mockReturnValue({
      reviewCut: { start, status, cancel },
    } as unknown as ReturnType<typeof getAPI>);

    await act(async () => {
      root.render(<DeliveryApprovalCard context={context} />);
      await flushPromises();
    });

    const startButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('reviewCut.start')),
    );
    await act(async () => {
      startButton?.click();
      await flushPromises();
    });

    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    const cancelButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('reviewCut.cancel')),
    );
    await act(async () => {
      cancelButton?.click();
      await flushPromises();
    });
    expect(cancel).toHaveBeenCalledWith('review-cut-job-1');
    expect(container.textContent).toContain(t('reviewCut.cancelledNotice'));
  });

  it('permits a fresh Review Cut start after failure and leaves a cancelled save dialog unchanged', async () => {
    const context = deliveryContext();
    context.approval.status = 'approved';
    const start = vi
      .fn()
      .mockResolvedValueOnce({ cancelled: false, job: reviewCutJob('queued') })
      .mockResolvedValueOnce({ cancelled: true });
    const status = vi.fn().mockResolvedValue(reviewCutJob('failed', { error: 'ffmpeg unavailable' }));
    vi.mocked(getAPI).mockReturnValue({
      reviewCut: { start, status },
    } as unknown as ReturnType<typeof getAPI>);

    await act(async () => {
      root.render(<DeliveryApprovalCard context={context} />);
      await flushPromises();
    });

    const initialStart = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('reviewCut.start')),
    );
    await act(async () => {
      initialStart?.click();
      await flushPromises();
    });

    expect(container.textContent).toContain(t('reviewCut.status.failed'));
    expect(container.textContent).toContain('ffmpeg unavailable');
    const startAgain = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('reviewCut.startAgain')),
    );
    await act(async () => {
      startAgain?.click();
      await flushPromises();
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(t('reviewCut.status.failed'));
  });
});
