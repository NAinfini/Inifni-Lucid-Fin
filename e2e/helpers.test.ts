import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getElectronLaunchOptions } from './helpers.js';

describe('E2E Electron launch config', () => {
  it('launches the desktop Electron app from the package root entry', () => {
    const options = getElectronLaunchOptions();
    const expectedAppDir = path.join(process.cwd(), 'apps', 'desktop-main');

    expect(options.args).toEqual([expectedAppDir]);
    expect(options.cwd).toBeUndefined();
    expect(options.args[0]).not.toContain(path.join('dist', 'electron.js'));
    expect(options.env.NODE_ENV).toBe('test');
    expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
