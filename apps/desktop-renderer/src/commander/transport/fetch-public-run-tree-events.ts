import type { TimelineEvent } from '@lucid-fin/contracts';

import { getAPI } from '../../utils/api.js';

/**
 * Fetch only the append-only public timelines for every Run in a session.
 * Consumers remain responsible for cancellation and dispatching into their
 * own Redux lifecycle.
 */
export async function fetchPublicRunTreeEvents(sessionId: string): Promise<TimelineEvent[]> {
  const commander = getAPI()?.commander;
  if (!commander?.runTree || !commander.eventsHydrate) return [];

  const { runs } = await commander.runTree({ sessionId });
  const histories = await Promise.all(
    runs.map(async (run) => {
      try {
        return await commander.eventsHydrate({ runId: run.id, afterSeq: -1 });
      } catch {
        return null;
      }
    }),
  );

  return histories.flatMap((history) => history?.events ?? []);
}
