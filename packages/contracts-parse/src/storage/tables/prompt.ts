/**
 * Prompt + process-prompt storage.
 */
import type { PromptCode, ProcessPromptKey } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const PromptOverridesTable = defineTable('t_prompt_overrides', {
  code: col<PromptCode>('code'),
  customValue: col<string>('customValue'),
});

export const ProcessPromptsTable = defineTable('process_prompts', {
  id: col<number>('id'),
  processKey: col<ProcessPromptKey>('process_key'),
  name: col<string>('name'),
  description: col<string>('description'),
  defaultValue: col<string>('default_value'),
  customValue: col<string | null>('custom_value'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
