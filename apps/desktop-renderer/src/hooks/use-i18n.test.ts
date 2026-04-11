// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale, t } from '../i18n.js';
import { useI18n } from './use-i18n.js';

describe('useI18n', () => {
  beforeEach(() => {
    setLocale('zh-CN');
  });

  it('returns the current locale and translation function', () => {
    const { result } = renderHook(() => useI18n());

    expect(result.current.locale).toBe('zh-CN');
    expect(result.current.t('nav.canvas')).toBe(t('nav.canvas'));
  });

  it('updates locale through the returned setter', () => {
    const { result } = renderHook(() => useI18n());

    act(() => {
      result.current.setLocale('en-US');
    });

    expect(result.current.locale).toBe('en-US');
    expect(result.current.t('nav.canvas')).toBe('Canvas');
  });

  it('re-renders when locale changes externally', () => {
    const { result } = renderHook(() => useI18n());

    act(() => {
      setLocale('en-US');
    });

    expect(result.current.locale).toBe('en-US');
    expect(result.current.t('action.save')).toBe('Save');
  });
});
