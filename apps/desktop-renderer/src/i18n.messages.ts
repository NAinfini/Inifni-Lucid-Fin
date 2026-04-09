/**
 * i18n - lightweight internationalization framework.
 * Supports zh-CN and en-US with instant language switching.
 */

import { enUSMessages } from './i18n.messages.en-US.js';
import { zhCNMessages } from './i18n.messages.zh-CN.js';

export type Locale = 'zh-CN' | 'en-US';

export type NestedMessages = { [key: string]: string | NestedMessages };

export const messages = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
} satisfies Record<Locale, NestedMessages>;

export const availableLocales = ['zh-CN', 'en-US'] as const satisfies readonly Locale[];
