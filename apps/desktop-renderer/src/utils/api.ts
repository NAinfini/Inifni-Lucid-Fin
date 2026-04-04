export type LucidAPI = typeof window.lucidAPI;

/**
 * Safe accessor for the Electron preload API.
 * Returns undefined when running outside Electron (e.g., browser, tests).
 */
export function getAPI(): LucidAPI | undefined {
  return typeof window !== 'undefined' ? window.lucidAPI : undefined;
}

export function getWorkflowAPI(): LucidAPI['workflow'] | undefined {
  return getAPI()?.workflow;
}
