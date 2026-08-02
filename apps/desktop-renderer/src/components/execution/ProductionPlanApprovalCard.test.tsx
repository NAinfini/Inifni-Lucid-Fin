// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { ApproveWorkflowGateResult } from '@lucid-fin/contracts';
import { ProductionPlanApprovalCard } from './ProductionPlanApprovalCard.js';
import { t } from '../../i18n.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ProductionPlanApprovalCard', () => {
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

  it('shows the exact revision and only approves after an explicit click', async () => {
    const onApprove = vi.fn(
      async () => ({ ok: true, code: 'approved' }) as ApproveWorkflowGateResult,
    );
    const onApproved = vi.fn();
    await act(async () => {
      root.render(
        <ProductionPlanApprovalCard
          context={{
            run: {
              id: 'wf-1',
              workflowType: 'movie.production.v2',
              entityType: 'project',
              triggerSource: 'commander',
              status: 'awaiting_approval',
              summary: 'Production plan awaiting approval',
              progress: 0,
              completedStages: 0,
              totalStages: 0,
              completedTasks: 0,
              totalTasks: 0,
              input: {},
              output: {},
              metadata: {},
              createdAt: 1,
              updatedAt: 1,
              rowVersion: 1,
              currentGate: 'production_plan',
            },
            approval: {
              id: 'approval-1',
              workflowRunId: 'wf-1',
              gateKey: 'production_plan',
              subjectLogicalKey: 'production-plan',
              subjectRevision: 3,
              subjectHash: 'a'.repeat(64),
              manifestHash: 'b'.repeat(64),
              status: 'pending',
              createdAt: 1,
              updatedAt: 1,
            },
            document: {
              id: 'doc-3',
              workflowRunId: 'wf-1',
              logicalKey: 'production-plan',
              documentType: 'production_plan',
              revision: 3,
              schemaVersion: 1,
              content: {
                title: 'The Last Signal',
                logline: 'A radio operator hears tomorrow.',
                synopsis: 'She races to prevent the disaster in the transmission.',
                format: { targetDurationSeconds: 90, aspectRatio: '16:9' },
                story: { acts: [{ scenes: [{}] }] },
                assumptions: ['Single primary location'],
                visualDirections: ['analog cosmic horror'],
                budget: {
                  maxTotalCostUsd: 25,
                  styleAuditionCostUsd: 3,
                  maxAttemptsPerShot: 3,
                  maxRegenerations: 8,
                },
              },
              contentHash: 'a'.repeat(64),
              status: 'active',
              createdAt: 1,
              updatedAt: 1,
            },
          }}
          onApprove={onApprove}
          onApproved={onApproved}
        />,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('The Last Signal');
    expect(container.textContent).toContain(`${t('workflowApproval.revision')} 3`);
    expect(container.textContent).toContain('a'.repeat(64));
    expect(onApprove).not.toHaveBeenCalled();

    const approveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('workflowApproval.approve')),
    );
    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApproved).toHaveBeenCalledTimes(1);
  });
});
