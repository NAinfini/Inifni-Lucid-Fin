import { describe, it, expect, vi, beforeEach } from 'vitest';
import { t, setLocale, getLocale, onLocaleChange, getAvailableLocales, messages } from './i18n.js';
import { zhCNMessages } from './i18n.messages.zh-CN.js';
import { enUSMessages } from './i18n.messages.en-US.js';

describe('i18n', () => {
  beforeEach(() => {
    setLocale('zh-CN');
  });

  describe('t()', () => {
    it('resolves nested keys in zh-CN', () => {
      expect(t('nav.canvas')).toBe('画布');
      expect(t('action.save')).toBe('保存');
      expect(t('mode.simple')).toBe('简单');
    });

    it('resolves nested keys in en-US', () => {
      setLocale('en-US');
      expect(t('nav.canvas')).toBe('Canvas');
      expect(t('action.save')).toBe('Save');
      expect(t('mode.simple')).toBe('Simple');
    });

    it('returns key for missing translations', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('returns key for partial path (non-leaf)', () => {
      expect(t('nav')).toBe('nav');
    });

    it('returns key for deeply missing path', () => {
      expect(t('nav.home.extra')).toBe('nav.home.extra');
    });
  });

  describe('setLocale / getLocale', () => {
    it('switches locale', () => {
      expect(getLocale()).toBe('zh-CN');
      setLocale('en-US');
      expect(getLocale()).toBe('en-US');
    });

    it('affects t() immediately', () => {
      expect(t('error.title')).toBe('出现了一个错误');
      setLocale('en-US');
      expect(t('error.title')).toBe('Something went wrong');
    });
  });

  describe('onLocaleChange', () => {
    it('notifies listeners on locale change', () => {
      const listener = vi.fn();
      const unsub = onLocaleChange(listener);
      setLocale('en-US');
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('unsubscribes correctly', () => {
      const listener = vi.fn();
      const unsub = onLocaleChange(listener);
      unsub();
      setLocale('en-US');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getAvailableLocales', () => {
    it('returns both locales', () => {
      expect(getAvailableLocales()).toEqual(['zh-CN', 'en-US']);
    });
  });

  describe('translation completeness', () => {
    function flattenLeafEntries(
      value: unknown,
      prefix = '',
      out: Array<{ key: string; value: string }> = [],
    ): Array<{ key: string; value: string }> {
      if (!value || typeof value !== 'object') {
        return out;
      }

      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof child === 'string') {
          out.push({ key: path, value: child });
          continue;
        }
        flattenLeafEntries(child, path, out);
      }

      return out;
    }

    it('keeps zh-CN and en-US key sets in sync', () => {
      const zhKeys = flattenLeafEntries(messages['zh-CN'])
        .map((entry) => entry.key)
        .sort();
      const enKeys = flattenLeafEntries(messages['en-US'])
        .map((entry) => entry.key)
        .sort();
      expect(enKeys).toEqual(zhKeys);
    });

    it('keeps en-US values free of Chinese characters', () => {
      const enEntries = flattenLeafEntries(messages['en-US']);
      const entriesWithCjk = enEntries.filter((entry) => /[\u4e00-\u9fff]/u.test(entry.value));
      expect(entriesWithCjk).toEqual([]);
    });

    it('assembles translations from locale-specific modules', () => {
      expect(messages['zh-CN']).toBe(zhCNMessages);
      expect(messages['en-US']).toBe(enUSMessages);
    });
  });
});
