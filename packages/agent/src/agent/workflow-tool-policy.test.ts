import { describe, expect, it } from 'vitest';
import { getWorkflowToolDenial, type WorkflowToolPolicy } from './workflow-tool-policy.js';

function policy(phase: WorkflowToolPolicy['phase']): WorkflowToolPolicy {
  return {
    workflowRunId: 'workflow-1',
    phase,
    rowVersion: 2,
    gate: phase.endsWith('_pending')
      ? phase === 'production_plan_pending'
        ? 'production_plan'
        : phase === 'visual_constitution_pending'
          ? 'visual_constitution'
          : 'final_export'
      : undefined,
  };
}

describe('workflow tool policy', () => {
  it('blocks every mutation while the production plan is awaiting approval', () => {
    expect(getWorkflowToolDenial(policy('production_plan_pending'), 'canvas.createNodes')).toMatch(
      /Production Plan/i,
    );
    expect(
      getWorkflowToolDenial(policy('production_plan_pending'), 'canvas.generation', {
        action: 'start',
      }),
    ).toMatch(/Production Plan/i);
    expect(getWorkflowToolDenial(policy('production_plan_pending'), 'canvas.listNodes')).toBeNull();
  });

  it('allows planning changes but blocks general media generation during style exploration', () => {
    expect(getWorkflowToolDenial(policy('style_exploration'), 'canvas.createNodes')).toBeNull();
    expect(
      getWorkflowToolDenial(policy('style_exploration'), 'canvas.generation', {
        action: 'start',
      }),
    ).toMatch(/Visual Constitution/i);
    expect(getWorkflowToolDenial(policy('style_exploration'), 'entity.generateRefImage')).toMatch(
      /Visual Constitution/i,
    );
  });

  it('allows media generation after Visual Constitution but blocks final export', () => {
    expect(
      getWorkflowToolDenial(policy('media_generation'), 'canvas.generation', { action: 'start' }),
    ).toMatch(/workflow\.media/i);
    expect(getWorkflowToolDenial(policy('media_generation'), 'entity.generateRefImage')).toMatch(
      /reference sheets|workflow\.media/i,
    );
    expect(getWorkflowToolDenial(policy('media_generation'), 'workflow.media')).toBeNull();
    expect(getWorkflowToolDenial(policy('media_generation'), 'workflow.mediaFeedback')).toBeNull();
    expect(
      getWorkflowToolDenial(policy('media_generation'), 'canvas.updateNodes', {
        nodeId: 'shot-1',
        set: { prompt: 'replace everything' },
      }),
    ).toMatch(/workflow\.mediaFeedback/i);
    expect(
      getWorkflowToolDenial(policy('media_generation'), 'canvas.updateNodes', {
        nodeId: 'shot-1',
        set: { title: 'Shot 1' },
      }),
    ).toBeNull();
    expect(getWorkflowToolDenial(policy('media_generation'), 'workflow.finalExport')).toMatch(
      /only after.*assembly/i,
    );
    expect(getWorkflowToolDenial(policy('media_generation'), 'render.start')).toMatch(
      /final export/i,
    );
    expect(getWorkflowToolDenial(policy('media_generation'), 'render.exportBundle')).toMatch(
      /final export/i,
    );
  });

  it('freezes mutations while the exact final export revision is awaiting approval', () => {
    expect(getWorkflowToolDenial(policy('final_export_pending'), 'workflow.finalExport')).toMatch(
      /frozen/i,
    );
    expect(getWorkflowToolDenial(policy('final_export_pending'), 'canvas.updateNodes')).toMatch(
      /final export/i,
    );
    expect(getWorkflowToolDenial(policy('final_export_pending'), 'canvas.listNodes')).toBeNull();
  });

  it('allows export only after the final gate is approved', () => {
    expect(getWorkflowToolDenial(policy('final_export_approved'), 'workflow.finalExport')).toMatch(
      /already approved/i,
    );
    expect(getWorkflowToolDenial(policy('final_export_approved'), 'render.start')).toBeNull();
    expect(
      getWorkflowToolDenial(policy('final_export_approved'), 'render.exportBundle'),
    ).toBeNull();
    expect(
      getWorkflowToolDenial(policy('final_export_approved'), 'canvas.generation', {
        action: 'refine',
      }),
    ).toMatch(/frozen|workflow revision/i);
  });

  it('hides the composite Canvas generation schema while retaining direct safe actions', () => {
    for (const phase of [
      'production_plan_pending',
      'style_exploration',
      'media_generation',
      'final_export_pending',
      'final_export_approved',
      'blocked',
    ] as const) {
      expect(getWorkflowToolDenial(policy(phase), 'canvas.generation')).not.toBeNull();
      expect(
        getWorkflowToolDenial(policy(phase), 'canvas.generation', { action: 'estimate' }),
      ).toBeNull();
      expect(
        getWorkflowToolDenial(policy(phase), 'canvas.generation', { action: 'cancel' }),
      ).toBeNull();
    }
    expect(
      getWorkflowToolDenial(policy('media_generation'), 'canvas.generation', { action: 'start' }),
    ).toMatch(/workflow\.media/i);
    expect(
      getWorkflowToolDenial(policy('media_generation'), 'canvas.generation', { action: 'refine' }),
    ).toMatch(/workflow\.media/i);
    expect(
      getWorkflowToolDenial(policy('media_generation'), 'tool.get', {
        names: ['canvas.generation'],
      }),
    ).toMatch(/unavailable/i);
  });

  it('keeps the approved Visual Constitution authoritative over Canvas draft edits', () => {
    expect(
      getWorkflowToolDenial(policy('media_generation'), 'canvas.setSettings', {
        visualStylePolicy: { version: 1, summary: 'replace the whole look' },
      }),
    ).toMatch(/Visual Constitution/i);
    expect(
      getWorkflowToolDenial(policy('final_export_approved'), 'canvas.updateNodes', {
        nodeId: 'shot-1',
        set: { prompt: 'replace the approved style' },
      }),
    ).toMatch(/workflow\.mediaFeedback/i);
  });

  it('exposes Final Export preparation only during its dedicated phase', () => {
    expect(getWorkflowToolDenial(undefined, 'workflow.finalExport')).toMatch(/persistent video/i);
    expect(getWorkflowToolDenial(policy('style_exploration'), 'workflow.finalExport')).toMatch(
      /only after media generation/i,
    );
    expect(
      getWorkflowToolDenial(policy('final_export_preparation'), 'workflow.finalExport'),
    ).toBeNull();
  });

  it('exposes task-bound production media only for reference and shot generation', () => {
    expect(getWorkflowToolDenial(undefined, 'workflow.media')).toMatch(/persistent video/i);
    expect(getWorkflowToolDenial(policy('style_exploration'), 'workflow.media')).toMatch(
      /reference-assets|production-shot/i,
    );
    expect(
      getWorkflowToolDenial(
        { ...policy('preproduction'), currentTaskRole: 'references' },
        'workflow.media',
      ),
    ).toBeNull();
    expect(getWorkflowToolDenial(policy('media_generation'), 'workflow.media')).toBeNull();
    expect(getWorkflowToolDenial(policy('final_export_pending'), 'workflow.media')).toMatch(
      /reference-assets|production-shot/i,
    );
  });

  it('allows exact media feedback through assembly preparation but freezes it at export', () => {
    expect(getWorkflowToolDenial(policy('assembly'), 'workflow.mediaFeedback')).toBeNull();
    expect(
      getWorkflowToolDenial(policy('final_export_preparation'), 'workflow.mediaFeedback'),
    ).toMatch(/before assembly/i);
    expect(getWorkflowToolDenial(policy('final_export_pending'), 'workflow.mediaFeedback')).toMatch(
      /before assembly/i,
    );
  });

  it('blocks a second createProductionPlan action while a run is already bound', () => {
    expect(
      getWorkflowToolDenial(policy('style_exploration'), 'workflow.manage', {
        action: 'createProductionPlan',
      }),
    ).toMatch(/already active/i);
    expect(
      getWorkflowToolDenial(policy('style_exploration'), 'workflow.manage', {
        action: 'control',
        controlAction: 'pause',
      }),
    ).toBeNull();
  });

  it('exposes the dedicated visual audition tool only during style exploration', () => {
    expect(getWorkflowToolDenial(undefined, 'workflow.visual')).toMatch(
      /persistent video workflow/i,
    );
    expect(getWorkflowToolDenial(policy('production_plan_pending'), 'workflow.visual')).toMatch(
      /Production Plan approval/i,
    );
    expect(getWorkflowToolDenial(policy('style_exploration'), 'workflow.visual')).toBeNull();
    expect(getWorkflowToolDenial(policy('visual_constitution_pending'), 'workflow.visual')).toMatch(
      /frozen/i,
    );
    expect(getWorkflowToolDenial(policy('media_generation'), 'workflow.visual')).toMatch(
      /only during/i,
    );
  });
});
