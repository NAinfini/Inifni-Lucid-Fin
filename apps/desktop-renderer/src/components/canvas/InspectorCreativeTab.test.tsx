// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_SHOT_TEMPLATES, createEmptyPresetTrackSet, type ImageNodeData } from '@lucid-fin/contracts';
import { InspectorCreativeTab } from './InspectorCreativeTab.js';

const t = (key: string) =>
  ({
    'inspector.prompt': 'Prompt',
    'inspector.presetTracks': 'Preset tracks',
    'inspector.selectAll': 'Select all',
    'inspector.deselectAll': 'Deselect all',
    'shotTemplate.title': 'Shot Template',
    'shotTemplate.selectTemplate': 'Select template',
    'shotTemplate.builtIn': 'Built-in',
    'shotTemplate.custom': 'Custom',
  })[key] ?? key;

afterEach(() => {
  cleanup();
});

describe('InspectorCreativeTab', () => {
  it('shows the applied shot template name instead of the empty placeholder', () => {
    const template = BUILT_IN_SHOT_TEMPLATES.find((entry) => entry.id === 'builtin-tmpl-horror-suspense');
    if (!template) {
      throw new Error('Expected built-in shot template to exist');
    }

    const generationData = {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
      presetTracks: createEmptyPresetTrackSet(),
      appliedShotTemplateId: template.id,
      appliedShotTemplateName: template.name,
    } as ImageNodeData;

    render(
      <InspectorCreativeTab
        t={t}
        selectedNodeType="image"
        generationData={generationData}
        onContentChange={vi.fn()}
        onPromptChange={vi.fn()}
        templateDropdownOpen={false}
        onToggleTemplateDropdown={vi.fn()}
        builtInTemplates={BUILT_IN_SHOT_TEMPLATES}
        customTemplates={[]}
        hiddenTemplateIds={[]}
        onApplyTemplate={vi.fn()}
        localizeShotTemplateName={(_id, fallback) => fallback}
        localizeShotTemplateDescription={(_id, fallback) => fallback}
        trackGrid={<div>track grid</div>}
      />,
    );

    expect(screen.getByRole('button', { name: /horror suspense/i })).toBeTruthy();
    expect(screen.queryByText('Select template')).toBeNull();
  });

  it('falls back to matching the current preset tracks when template metadata is missing', () => {
    const template = BUILT_IN_SHOT_TEMPLATES.find((entry) => entry.id === 'builtin-tmpl-horror-suspense');
    if (!template) {
      throw new Error('Expected built-in shot template to exist');
    }

    const generationData = {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
      presetTracks: {
        ...createEmptyPresetTrackSet(),
        camera: template.tracks.camera!,
        scene: template.tracks.scene!,
        emotion: template.tracks.emotion!,
      },
    } as ImageNodeData;

    render(
      <InspectorCreativeTab
        t={t}
        selectedNodeType="image"
        generationData={generationData}
        onContentChange={vi.fn()}
        onPromptChange={vi.fn()}
        templateDropdownOpen={false}
        onToggleTemplateDropdown={vi.fn()}
        builtInTemplates={BUILT_IN_SHOT_TEMPLATES}
        customTemplates={[]}
        hiddenTemplateIds={[]}
        onApplyTemplate={vi.fn()}
        localizeShotTemplateName={(_id, fallback) => fallback}
        localizeShotTemplateDescription={(_id, fallback) => fallback}
        trackGrid={<div>track grid</div>}
      />,
    );

    expect(screen.getByRole('button', { name: /horror suspense/i })).toBeTruthy();
  });
});
