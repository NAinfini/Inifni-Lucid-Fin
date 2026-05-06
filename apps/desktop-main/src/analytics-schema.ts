/**
 * Anonymous usage analytics event schema.
 *
 * All tracked events are aggregate-only: no PII, no file paths, no content.
 * This schema is documented for future privacy audits.
 *
 * Tracked events:
 *
 * - `canvas_created`
 *   No additional properties. Fires when a new canvas is created.
 *
 * - `canvas_opened`
 *   Properties: `{ nodeCount: number }`
 *   Fires when a canvas is loaded/opened. Reports the node count at load time.
 *
 * - `commander_session_started`
 *   No additional properties. Fires when a Commander chat session begins.
 *
 * - `ai_generation`
 *   Properties: `{ provider: string }`
 *   Fires when an AI generation is requested. Reports the provider name only
 *   (never prompts, responses, or API keys).
 */

export interface AnalyticsEvent {
  name: string;
  timestamp: string; // ISO-8601
  properties: Record<string, string | number>;
}
