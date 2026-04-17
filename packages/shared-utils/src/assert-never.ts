/**
 * Exhaustiveness helper. Calling this at the end of a switch or match forces
 * the compiler to prove every DU variant has been handled — if the type shows
 * up as `never`, compilation succeeds; otherwise TS flags the missing case.
 *
 * At runtime it throws to guard against types drifting from runtime values
 * (e.g. data returned by an IPC or DB layer that predates a new variant).
 */
export function assertNever(value: never, context?: string): never {
  const location = context !== undefined ? ` in ${context}` : '';
  throw new Error(
    `assertNever: unexpected value${location}: ${JSON.stringify(value)}`,
  );
}
