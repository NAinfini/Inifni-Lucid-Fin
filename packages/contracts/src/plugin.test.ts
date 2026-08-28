import { describe, expect, it } from 'vitest';
import {
  PluginPackageApplyInputV1Schema,
  PluginPackageManifestV1Schema,
  pluginPackageManifestHashInput,
} from './plugin.js';

const HASH_A = 'a'.repeat(64);
const NOW = '2026-08-24T12:00:00.000Z';

const manifest = {
  packageId: 'plugin.storyboard',
  version: '1.0.0',
  name: 'Storyboard review',
  description: 'Trusted storyboard review Skills.',
  manifestHash: HASH_A,
  skills: [
    {
      skillId: 'skill.storyboard.review',
      name: 'Storyboard review',
      description: 'Review storyboard continuity.',
      version: '1.0.0',
      contentHash: HASH_A,
      provenance: 'installed',
      trust: 'trusted',
      content: 'Review storyboard continuity.',
      createdAt: NOW,
    },
  ],
};

describe('trusted declarative Plugin package contracts', () => {
  it('accepts only sorted trusted installed Skill manifests and rejects executable extensions', () => {
    expect(PluginPackageManifestV1Schema.parse(manifest)).toEqual(manifest);
    expect(PluginPackageManifestV1Schema.safeParse({ ...manifest, tools: [] }).success).toBe(false);
    expect(
      PluginPackageManifestV1Schema.safeParse({
        ...manifest,
        skills: [{ ...manifest.skills[0], provenance: 'project' }],
      }).success,
    ).toBe(false);
    expect(
      PluginPackageManifestV1Schema.safeParse({
        ...manifest,
        skills: [{ ...manifest.skills[0], trust: 'reviewed' }],
      }).success,
    ).toBe(false);
    expect(pluginPackageManifestHashInput(manifest)).toBe(
      '{"description":"Trusted storyboard review Skills.","name":"Storyboard review","packageId":"plugin.storyboard","skills":[{"content":"Review storyboard continuity.","contentHash":"' +
        `${HASH_A}","createdAt":"${NOW}","description":"Review storyboard continuity.","name":"Storyboard review","provenance":"installed","skillId":"skill.storyboard.review","trust":"trusted","version":"1.0.0"}],"version":"1.0.0"}`,
    );
  });

  it('requires a manifest-bound CAS command and never accepts caller-supplied package content', () => {
    expect(
      PluginPackageApplyInputV1Schema.safeParse({
        action: 'install',
        packageId: manifest.packageId,
        version: manifest.version,
        manifestHash: manifest.manifestHash,
        expectedInstallationRevision: null,
      }).success,
    ).toBe(true);
    expect(
      PluginPackageApplyInputV1Schema.safeParse({
        action: 'remove',
        packageId: manifest.packageId,
        version: manifest.version,
        manifestHash: manifest.manifestHash,
        expectedInstallationRevision: 0,
        manifest,
      }).success,
    ).toBe(false);
  });
});
