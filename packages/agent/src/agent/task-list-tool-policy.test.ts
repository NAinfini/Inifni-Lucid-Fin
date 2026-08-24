import { describe, expect, it } from 'vitest';
import { getTaskListToolDenial, type TaskListToolPolicy } from './task-list-tool-policy.js';

function policy(phase: TaskListToolPolicy['phase']): TaskListToolPolicy {
  return {
    taskListId: 'task-list-1',
    phase,
    rowVersion: 2,
    gate: phase.endsWith('_pending')
      ? phase === 'production_plan_pending'
        ? 'production_plan'
        : phase === 'visual_constitution_pending'
          ? 'visual_constitution'
          : 'delivery'
      : undefined,
  };
}

describe('task-list tool policy', () => {
  it('blocks every mutation while the production plan is awaiting approval', () => {
    expect(getTaskListToolDenial(policy('production_plan_pending'), 'canvas.createNodes')).toMatch(
      /Production Plan/i,
    );
    expect(
      getTaskListToolDenial(policy('production_plan_pending'), 'canvas.generation', {
        action: 'prepare',
      }),
    ).toMatch(/Production Plan/i);
    expect(getTaskListToolDenial(policy('production_plan_pending'), 'canvas.listNodes')).toBeNull();
  });

  it('allows planning changes but blocks general media generation during style exploration', () => {
    expect(getTaskListToolDenial(policy('style_exploration'), 'canvas.createNodes')).toBeNull();
    expect(
      getTaskListToolDenial(policy('style_exploration'), 'canvas.generation', {
        action: 'prepare',
      }),
    ).toMatch(/Visual Constitution/i);
  });

  it('allows media generation after Visual Constitution but blocks Delivery', () => {
    expect(
      getTaskListToolDenial(policy('media_generation'), 'canvas.generation', { action: 'submit' }),
    ).toMatch(/task\.media/i);
    expect(getTaskListToolDenial(policy('media_generation'), 'task.media')).toBeNull();
    expect(getTaskListToolDenial(policy('media_generation'), 'task.mediaFeedback')).toBeNull();
    expect(
      getTaskListToolDenial(policy('media_generation'), 'canvas.updateNodes', {
        nodeId: 'shot-1',
        set: { prompt: 'replace everything' },
      }),
    ).toMatch(/task\.mediaFeedback/i);
    expect(
      getTaskListToolDenial(policy('media_generation'), 'canvas.updateNodes', {
        nodeId: 'shot-1',
        set: { title: 'Shot 1' },
      }),
    ).toBeNull();
    expect(getTaskListToolDenial(policy('media_generation'), 'task.delivery')).toMatch(
      /only after.*Ordered Delivery/i,
    );
  });

  it('freezes mutations while the exact Delivery revision is awaiting approval', () => {
    expect(getTaskListToolDenial(policy('delivery_pending'), 'task.delivery')).toMatch(
      /frozen/i,
    );
    expect(getTaskListToolDenial(policy('delivery_pending'), 'canvas.updateNodes')).toMatch(
      /Delivery/i,
    );
    expect(getTaskListToolDenial(policy('delivery_pending'), 'canvas.listNodes')).toBeNull();
  });

  it('keeps approved Delivery packaging host-owned', () => {
    expect(getTaskListToolDenial(policy('delivery_approved'), 'task.delivery')).toMatch(
      /already approved/i,
    );
    expect(
      getTaskListToolDenial(policy('delivery_approved'), 'canvas.generation', {
        action: 'prepare',
      }),
    ).toMatch(/frozen|task-list revision/i);
  });

  it('hides the composite Canvas generation schema while retaining direct safe actions', () => {
    for (const phase of [
      'production_plan_pending',
      'style_exploration',
      'media_generation',
      'delivery_pending',
      'delivery_approved',
      'blocked',
    ] as const) {
      expect(getTaskListToolDenial(policy(phase), 'canvas.generation')).not.toBeNull();
      expect(
        getTaskListToolDenial(policy(phase), 'canvas.generation', { action: 'estimate' }),
      ).toBeNull();
      expect(
        getTaskListToolDenial(policy(phase), 'canvas.generation', { action: 'cancel' }),
      ).toBeNull();
      expect(
        getTaskListToolDenial(policy(phase), 'canvas.generation', { action: 'status' }),
      ).toBeNull();
    }
    expect(
      getTaskListToolDenial(policy('media_generation'), 'canvas.generation', { action: 'prepare' }),
    ).toMatch(/task\.media/i);
    expect(
      getTaskListToolDenial(policy('media_generation'), 'canvas.generation', { action: 'submit' }),
    ).toMatch(/task\.media/i);
    expect(
      getTaskListToolDenial(policy('media_generation'), 'tool.get', {
        names: ['canvas.generation'],
      }),
    ).toMatch(/unavailable/i);
  });

  it('keeps the approved Visual Constitution authoritative over Canvas draft edits', () => {
    expect(
      getTaskListToolDenial(policy('media_generation'), 'canvas.setSettings', {
        visualStylePolicy: { version: 1, summary: 'replace the whole look' },
      }),
    ).toMatch(/Visual Constitution/i);
    expect(
      getTaskListToolDenial(policy('delivery_approved'), 'canvas.updateNodes', {
        nodeId: 'shot-1',
        set: { prompt: 'replace the approved style' },
      }),
    ).toMatch(/task\.mediaFeedback/i);
  });

  it('exposes Delivery preparation only during its dedicated phase', () => {
    expect(getTaskListToolDenial(undefined, 'task.delivery')).toMatch(/persistent video/i);
    expect(getTaskListToolDenial(policy('style_exploration'), 'task.delivery')).toMatch(
      /only after media generation/i,
    );
    expect(getTaskListToolDenial(policy('delivery_preparation'), 'task.delivery')).toBeNull();
  });

  it('exposes task-bound production media only for reference and shot generation', () => {
    expect(getTaskListToolDenial(undefined, 'task.media')).toMatch(/persistent video/i);
    expect(getTaskListToolDenial(policy('style_exploration'), 'task.media')).toMatch(
      /reference-assets|production-shot/i,
    );
    expect(
      getTaskListToolDenial(
        { ...policy('preproduction'), currentTaskRole: 'references' },
        'task.media',
      ),
    ).toBeNull();
    expect(getTaskListToolDenial(policy('media_generation'), 'task.media')).toBeNull();
    expect(getTaskListToolDenial(policy('delivery_pending'), 'task.media')).toMatch(
      /reference-assets|production-shot/i,
    );
  });

  it('allows exact media feedback through assembly and freezes it at Delivery', () => {
    expect(getTaskListToolDenial(policy('assembly'), 'task.mediaFeedback')).toBeNull();
    expect(getTaskListToolDenial(policy('delivery_preparation'), 'task.mediaFeedback')).toMatch(
      /before Delivery/i,
    );
    expect(getTaskListToolDenial(policy('delivery_pending'), 'task.mediaFeedback')).toMatch(
      /before Delivery/i,
    );
  });

  it('blocks a second createProductionPlan action while a run is already bound', () => {
    expect(
      getTaskListToolDenial(policy('style_exploration'), 'taskList.manage', {
        action: 'createProductionPlan',
      }),
    ).toMatch(/already active/i);
    expect(
      getTaskListToolDenial(policy('style_exploration'), 'taskList.manage', {
        action: 'control',
        controlAction: 'pause',
      }),
    ).toBeNull();
  });

  it('allows structured gate decisions only for exact pending phases', () => {
    for (const phase of [
      'production_plan_pending',
      'visual_constitution_pending',
      'delivery_pending',
    ] as const) {
      expect(
        getTaskListToolDenial(policy(phase), 'taskList.manage', {
          action: 'decidePendingGate',
          decision: 'approve',
        }),
      ).toBeNull();
    }
    expect(
      getTaskListToolDenial(policy('style_exploration'), 'taskList.manage', {
        action: 'decidePendingGate',
        decision: 'approve',
      }),
    ).toMatch(/only while.*pending/i);
  });

  it('exposes the dedicated visual audition tool only during style exploration', () => {
    expect(getTaskListToolDenial(undefined, 'task.visual')).toMatch(/persistent video task list/i);
    expect(getTaskListToolDenial(policy('production_plan_pending'), 'task.visual')).toMatch(
      /Production Plan approval/i,
    );
    expect(getTaskListToolDenial(policy('style_exploration'), 'task.visual')).toBeNull();
    expect(getTaskListToolDenial(policy('visual_constitution_pending'), 'task.visual')).toMatch(
      /frozen/i,
    );
    expect(getTaskListToolDenial(policy('media_generation'), 'task.visual')).toMatch(
      /only during/i,
    );
  });
});
