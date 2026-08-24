/**
 * Contract registry barrel.
 *
 * Import order matters: `info-answer.ts` is the fallback contract and must
 * register first so other contracts (which do NOT call
 * `setFallback`) can be resolved via the standard `select()` path. Once
 * this module is imported, the module-level `contractRegistry` is fully
 * populated — later `register` calls on the same id throw.
 *
 * Consumers should import `@/agent/exit-contract` rather than this file
 * directly; the outer barrel re-exports the registry and types.
 */

import './info-answer.js'; // MUST be first — sets the fallback.
import './mutation-execution.js';
import './task-list-execution.js';

export { infoAnswerContract } from './info-answer.js';
export { mutationExecutionContract } from './mutation-execution.js';
export { taskListExecutionContract } from './task-list-execution.js';
