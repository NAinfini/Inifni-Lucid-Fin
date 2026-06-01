/**
 * Phase I — option-list detector unit tests.
 */

import { describe, it, expect } from 'vitest';
import { detectOptionListMarkdown } from './detect-option-list-markdown.js';

describe('detectOptionListMarkdown', () => {
  it('detects A/B/C dot-separated options', () => {
    const text = `Which would you prefer?
A. option one
B. option two
C. option three`;
    expect(detectOptionListMarkdown(text)).toBe(true);
  });

  it('detects A/B paren-separated options', () => {
    const text = `A) add character\nB) add image`;
    expect(detectOptionListMarkdown(text)).toBe(true);
  });

  it('detects 1/2/3 numeric lists', () => {
    const text = `Pick one:\n1. foo\n2. bar\n3. baz`;
    expect(detectOptionListMarkdown(text)).toBe(true);
  });

  it('detects with colon separator', () => {
    const text = `A: choice one\nB: choice two`;
    expect(detectOptionListMarkdown(text)).toBe(true);
  });

  it('does not fire on a single option line', () => {
    const text = `Here is one thing:\nA. only option`;
    expect(detectOptionListMarkdown(text)).toBe(false);
  });

  it('does not fire on prose mentioning A and B inline', () => {
    const text = 'Option A is better than option B because it handles the edge case.';
    expect(detectOptionListMarkdown(text)).toBe(false);
  });

  it('does not fire on code fences with headings', () => {
    const text = `Look at this:\n\`\`\`\nfn foo() {}\n\`\`\``;
    expect(detectOptionListMarkdown(text)).toBe(false);
  });

  it('does not fire on empty / near-empty text', () => {
    expect(detectOptionListMarkdown('')).toBe(false);
    expect(detectOptionListMarkdown('ok')).toBe(false);
  });

  it('handles mixed letter and number options', () => {
    const text = `A. first\n1. second`;
    expect(detectOptionListMarkdown(text)).toBe(true);
  });

  it('tolerates indented option lines', () => {
    const text = `  A. foo\n  B. bar`;
    expect(detectOptionListMarkdown(text)).toBe(true);
  });
});
