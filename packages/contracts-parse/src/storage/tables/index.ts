/**
 * Barrel for every storage table constant.
 *
 * Phase G1-1 deliverable: a single source of truth for SQL table +
 * column names, pairing them with phantom TS types for branded IDs.
 * Repositories (added in later G1 sub-tasks) build queries against
 * these constants rather than literal strings — schema drift then
 * fails at compile time, not at runtime against a live DB.
 */
export * from './assets.js';
export * from './entities.js';
export * from './script.js';
export * from './color-style.js';
export * from './task-execution.js';
export * from './canvas.js';
export * from './canvas-node.js';
export * from './canvas-edge.js';
export * from './shot-template.js';
export * from './preset.js';
export * from './session-snapshot.js';
export * from './prompt.js';
export * from './project-settings.js';
