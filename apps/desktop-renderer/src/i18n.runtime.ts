import { availableLocales, messages, type Locale, type NestedMessages } from './i18n.messages.js';

let currentLocale: Locale = loadLocale();
const listeners = new Set<() => void>();

function loadLocale(): Locale {
  try {
    const stored = localStorage.getItem('lucid-fin:locale');
    if (stored === 'zh-CN' || stored === 'en-US') return stored;

    const sys = navigator.language;
    if (sys.startsWith('zh')) return 'zh-CN';
    return 'en-US';
  } catch {
    return 'zh-CN';
  }
}

function localizeWithFallback(key: string, fallback: string): string {
  const result = t(key);
  return result !== key ? result : fallback;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;

  try {
    localStorage.setItem('lucid-fin:locale', locale);
  } catch {
    // localStorage unavailable
  }

  listeners.forEach((fn) => fn());
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: string): string {
  const parts = key.split('.');
  let obj: NestedMessages | string = messages[currentLocale];

  for (const part of parts) {
    if (typeof obj === 'string') return key;
    obj = obj[part];
    if (obj === undefined) return key;
  }

  return typeof obj === 'string' ? obj : key;
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAvailableLocales(): Locale[] {
  return [...availableLocales];
}

export function localizePresetName(name: string): string {
  return localizeWithFallback('presetNames.' + name, name);
}

export function localizeSlot(slot: string): string {
  const result = t('slots.' + slot);
  if (result !== 'slots.' + slot) return result;
  return slot.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function localizeShotTemplateName(id: string, fallback: string): string {
  return localizeWithFallback('shotTemplateNames.' + id, fallback);
}

export function localizeShotTemplateDescription(id: string, fallback: string): string {
  return localizeWithFallback('shotTemplateDescriptions.' + id, fallback);
}

export function localizePromptTemplateName(id: string, fallback: string): string {
  return localizeWithFallback('promptTemplateNames.' + id, fallback);
}

export function localizeWorkflowDefinitionName(id: string, fallback: string): string {
  return localizeWithFallback('workflowDefinitionNames.' + id, fallback);
}

export function localizeSettingsCategory(category: string): string {
  return localizeWithFallback('settings.category.' + category, category);
}
