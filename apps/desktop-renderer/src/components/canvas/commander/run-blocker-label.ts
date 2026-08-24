import type { RunBlocker } from '@lucid-fin/contracts';

/** Convert only the typed, public blocker union into localized user guidance. */
export function localizeRunBlocker(
  blocker: RunBlocker,
  t: (key: string) => string,
): string {
  if (blocker.kind === 'safety_limit') {
    switch (blocker.limit) {
      case 'context_window':
        return t('commander.resource.blocker.contextWindow');
      case 'provider_limit':
        return t('commander.resource.blocker.providerLimit');
      case 'recovery_required':
        return t('commander.resource.blocker.recoveryRequired');
    }
  }

  const reason = blocker.reason === 'unavailable' ? 'Unavailable' : 'Exhausted';
  switch (blocker.metric) {
    case 'tokens':
      return t(`commander.resource.blocker.tokens${reason}`);
    case 'tool_calls':
      return t(`commander.resource.blocker.toolCalls${reason}`);
    case 'wall_time':
      return t(`commander.resource.blocker.wallTime${reason}`);
    case 'cost':
      return t(`commander.resource.blocker.cost${reason}`);
  }
}
