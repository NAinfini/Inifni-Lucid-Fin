/**
 * Commander wire envelope version (v2-only).
 *
 * The Commander stream channel wraps every `TimelineEvent` in a
 * `WireEnvelope` carrying the constant `wireVersion: 2`. No negotiation —
 * the envelope is retained only as a documented extension point if the
 * `TimelineEvent` shape ever needs to bump in the future.
 */

import type { TimelineEvent } from './timeline-event.js';

export const COMMANDER_WIRE_VERSION = 2 as const;
/** Kept as an alias of {@link COMMANDER_WIRE_VERSION} for existing importers. */
export const COMMANDER_WIRE_VERSION_LATEST = COMMANDER_WIRE_VERSION;
export type CommanderWireVersion = typeof COMMANDER_WIRE_VERSION;

export interface WireEnvelope<T> {
  wireVersion: CommanderWireVersion;
  event: T;
}

export type CommanderStreamEnvelope = WireEnvelope<TimelineEvent>;
