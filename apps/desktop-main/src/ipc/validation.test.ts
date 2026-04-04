import { describe, it, expect } from 'vitest';
import { assertWithinRoot, sanitizeFilename, assertValidAssetType } from './validation.js';
import path from 'node:path';

describe('assertWithinRoot', () => {
  const root = '/projects/my-film';

  it('allows paths within root', () => {
    const result = assertWithinRoot(root, 'assets/image/test.png');
    expect(result).toBe(path.resolve(root, 'assets/image/test.png'));
  });

  it('allows root itself', () => {
    const result = assertWithinRoot(root, '.');
    expect(result).toBe(path.resolve(root));
  });

  it('rejects path traversal with ..', () => {
    expect(() => assertWithinRoot(root, '../../etc/passwd')).toThrow('Path traversal detected');
  });

  it('rejects absolute paths outside root', () => {
    expect(() => assertWithinRoot(root, '/etc/passwd')).toThrow('Path traversal detected');
  });

  it('handles nested .. that stays within root', () => {
    const result = assertWithinRoot(root, 'assets/../assets/test.png');
    expect(result).toBe(path.resolve(root, 'assets/test.png'));
  });
});

describe('sanitizeFilename', () => {
  it('strips dangerous characters', () => {
    expect(sanitizeFilename('my<file>name.txt')).toBe('my_file_name.txt');
    expect(sanitizeFilename('path/to\\file')).toBe('path_to_file');
    expect(sanitizeFilename('file:name')).toBe('file_name');
  });

  it('replaces .. with underscores', () => {
    expect(sanitizeFilename('../../../etc')).toBe('______etc');
  });

  it('returns untitled for empty string', () => {
    expect(sanitizeFilename('')).toBe('untitled');
  });

  it('preserves safe characters', () => {
    expect(sanitizeFilename('my-film_v2.mp4')).toBe('my-film_v2.mp4');
  });

  it('strips null bytes', () => {
    expect(sanitizeFilename('file\x00name')).toBe('file_name');
  });
});

describe('assertValidAssetType', () => {
  it('accepts valid types', () => {
    expect(() => assertValidAssetType('image')).not.toThrow();
    expect(() => assertValidAssetType('video')).not.toThrow();
    expect(() => assertValidAssetType('audio')).not.toThrow();
  });

  it('rejects invalid types', () => {
    expect(() => assertValidAssetType('text')).toThrow('Invalid asset type');
    expect(() => assertValidAssetType('')).toThrow('Invalid asset type');
    expect(() => assertValidAssetType('IMAGE')).toThrow('Invalid asset type');
  });
});
