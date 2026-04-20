/**
 * Contract registry barrel.
 *
 * Import order matters: `info-answer.ts` is the fallback contract and must
 * register first so workflow contracts (which do NOT call
 * `setFallback`) can be resolved via the standard `select()` path. Once
 * this module is imported, the module-level `contractRegistry` is fully
 * populated — later `register` calls on the same id throw.
 *
 * Consumers should import `@/agent/exit-contract` rather than this file
 * directly; the outer barrel re-exports the registry and types.
 */

import './info-answer.js'; // MUST be first — sets the fallback.
import './workflow-story-to-video.js';
import './workflow-style-plate.js';
import './workflow-shot-list.js';
import './workflow-continuity-check.js';
import './workflow-image-analyze.js';
import './workflow-audio-production.js';
import './workflow-style-transfer.js';

export { infoAnswerContract } from './info-answer.js';
export { storyToVideoContract } from './workflow-story-to-video.js';
export { stylePlateContract } from './workflow-style-plate.js';
export { shotListContract } from './workflow-shot-list.js';
export { continuityCheckContract } from './workflow-continuity-check.js';
export { imageAnalyzeContract } from './workflow-image-analyze.js';
export { audioProductionContract } from './workflow-audio-production.js';
export { styleTransferContract } from './workflow-style-transfer.js';
