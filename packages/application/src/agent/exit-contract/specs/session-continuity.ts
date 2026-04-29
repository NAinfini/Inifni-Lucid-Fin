import type { ProcessPromptSpec } from '../process-prompt-spec.js';

export interface SessionContinuitySpecDeps {
  resolvePromptText: (key: 'session-continuity') => string | null | undefined;
}

export function createSessionContinuitySpec(deps: SessionContinuitySpecDeps): ProcessPromptSpec {
  return {
    key: 'session-continuity',
    displayName: 'Session Continuity',
    lifecycle: 'one-shot',
    activationPredicate: (ctx) => !!ctx.isResumedSession && ctx.step === 0,
    content: () => deps.resolvePromptText('session-continuity')?.trim() ?? '',
  };
}
