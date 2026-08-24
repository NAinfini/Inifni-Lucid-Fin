import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  t,
  setLocale,
  getLocale,
  onLocaleChange,
  getAvailableLocales,
  localizeToolName,
  localizeTaskLabel,
  messages,
} from './i18n.js';
import { zhCNMessages } from './i18n.messages.zh-CN.js';
import { enUSMessages } from './i18n.messages.en-US.js';
import { PRESET_CATEGORIES } from '@lucid-fin/contracts';

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

    it('localizes provider configuration fields and actionable validation errors', () => {
      setLocale('en-US');
      expect(t('settings.providerCard.reasoningStrength')).toBe('Reasoning Strength');
      expect(t('settings.providerCard.configurationFailed')).toBe(
        'Could not save provider configuration',
      );
      expect(t('settings.providerCard.configurationInvalid')).toBe(
        'Provider configuration is invalid',
      );
      expect(t('settings.providerCard.modelUnavailable')).toContain('Choose a model');
      expect(t('settings.providerCard.reasoningEffortUnsupported')).toContain(
        'Choose a supported strength',
      );

      setLocale('zh-CN');
      expect(t('settings.providerCard.reasoningStrength')).toBe('推理强度');
      expect(t('settings.providerCard.configurationFailed')).toBe('无法保存提供方配置');
      expect(t('settings.providerCard.configurationInvalid')).toBe('提供方配置无效');
      expect(t('settings.providerCard.modelUnavailable')).toContain('请选择');
      expect(t('settings.providerCard.reasoningEffortUnsupported')).toContain('推理强度');
    });

    it('localizes every preset category in both supported locales', () => {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        setLocale(locale);
        for (const category of PRESET_CATEGORIES) {
          const key = `presetCategory.${category}`;
          expect(t(key)).not.toBe(key);
        }
      }
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

  describe('flat tool-name localization', () => {
    it('localizes tool ids that contain dots without falling back to raw ids', () => {
      expect(localizeToolName('canvas.getInfo')).toBe('画布信息');
      expect(localizeToolName('script.import')).toBe('导入脚本');
      setLocale('en-US');
      expect(localizeToolName('canvas.getInfo')).toBe('Canvas Info');
      expect(localizeToolName('script.import')).toBe('Import Script');
    });

    it('keeps unknown tool ids readable', () => {
      expect(localizeToolName('custom.unknown')).toBe('custom.unknown');
    });
  });

  describe('task-list localization', () => {
    it('localizes host-authored labels while preserving AI-authored labels verbatim', () => {
      expect(localizeTaskLabel('taskLabels.productionPlan', 'Create production plan')).toBe(
        '创建制作计划',
      );
      expect(
        localizeTaskLabel(
          'taskLabels.shotSpecification',
          'Shot specification 001: Arrival',
          '001 · 抵达遗迹',
        ),
      ).toBe('镜头规格 001 · 抵达遗迹');
      expect(localizeTaskLabel(undefined, '梳理星际遗迹故事方案')).toBe(
        '梳理星际遗迹故事方案',
      );

      setLocale('en-US');
      expect(localizeTaskLabel('taskLabels.productionPlan', 'fallback')).toBe(
        'Create production plan',
      );
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
