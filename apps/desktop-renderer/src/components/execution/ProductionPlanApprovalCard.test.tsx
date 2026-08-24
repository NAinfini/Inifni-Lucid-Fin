// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
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

  it('shows the plan as a read-only chat artifact without approval controls', async () => {
    await act(async () => {
      root.render(
        <ProductionPlanApprovalCard
          context={{
            taskList: {
              id: 'wf-1',
              taskListType: 'movie.production.v2',
              entityType: 'project',
              triggerSource: 'commander',
              status: 'awaiting_approval',
              summary: 'Production plan awaiting approval',
              progress: 0,
              completedPhases: 0,
              totalPhases: 0,
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
              taskListId: 'wf-1',
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
              taskListId: 'wf-1',
              logicalKey: 'production-plan',
              documentType: 'production_plan',
              revision: 3,
              schemaVersion: 1,
              content: {
                title: 'The Last Signal',
                logline: 'A radio operator hears tomorrow.',
                synopsis: 'She races to prevent the disaster in the transmission.',
                genre: 'science-fiction thriller',
                tone: 'tense and intimate',
                targetAudience: 'adult genre audience',
                format: { targetDurationSeconds: 90, aspectRatio: '16:9' },
                story: {
                  acts: [
                    {
                      name: 'Act 1',
                      scenes: [
                        {
                          title: 'The broadcast',
                          dialogueIntent: 'Disbelief gives way to fear.',
                        },
                      ],
                    },
                  ],
                },
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
        />,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('The Last Signal');
    expect(container.textContent).toContain(`${t('planApproval.revision')} 3`);
    expect(container.textContent).not.toContain('a'.repeat(64));
    expect(container.textContent).toContain('science-fiction thriller');
    expect(container.textContent).toContain('tense and intimate');
    expect(container.textContent).toContain('adult genre audience');
    expect(container.textContent).toContain('The broadcast');
    expect(container.textContent).toContain('Disbelief gives way to fear.');
    const actDetails = container.querySelector<HTMLDetailsElement>('details');
    expect(actDetails?.open).toBe(false);
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.textContent).toContain(t('planApproval.chatDecisionHint'));
  });
});
