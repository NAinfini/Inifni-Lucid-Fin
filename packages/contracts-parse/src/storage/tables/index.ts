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
export * from './jobs.js';
export * from './entities.js';
export * from './script.js';
export * from './color-style.js';
export * from './workflow.js';
export * from './canvas.js';
export * from './shot-template.js';
export * from './series.js';
export * from './preset.js';
export * from './session-snapshot.js';
export * from './prompt.js';
