// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationHistorySection } from './GenerationHistorySection.js';

vi.mock('../../LazyDetails.js', () => ({
  LazyDetails: ({ summary, children }: { summary: ReactNode; children: ReactNode }) => (
    <div>
      {summary}
      {children}
    </div>
  ),
}));

afterEach(cleanup);

describe('GenerationHistorySection', () => {
  it('shows the exact provider prompt, negative prompt, and assembly revision', () => {
    const exactPrompt = 'Line one.\nLine two — exact provider payload.';
    const exactNegativePrompt = 'watermark, extra limbs';

    render(
      <GenerationHistorySection
        node={
          {
            id: 'image-1',
            type: 'image',
            data: {
              generationHistory: [
                {
                  assetHash: 'asset-hash',
                  promptAssemblyId: 'assembly-1234567890',
                  prompt: exactPrompt,
                  negativePrompt: exactNegativePrompt,
                  providerId: 'image-provider',
                  createdAt: 1,
                },
              ],
            },
          } as never
        }
        canvas={{} as never}
        canvasId="canvas-1"
        dispatch={vi.fn()}
        t={(key) =>
          ({
            'inspector.generationHistory': 'Generation history',
            'inspector.finalProviderPrompt': 'Final provider prompt',
            'inspector.negativePrompt': 'Negative prompt',
            'inspector.promptRevision': 'Prompt revision',
            'inspector.copyPrompt': 'Copy prompt',
            'inspector.promptCopied': 'Copied',
          })[key] ?? key
        }
      />,
    );

    expect(screen.getByText('Generation history (1)')).toBeTruthy();
    expect(screen.getAllByText(/Line one\.\s+Line two — exact provider payload\./)).toHaveLength(2);
    expect(screen.getByText(exactNegativePrompt)).toBeTruthy();
    expect(screen.getByText('Prompt revision: assembly')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeTruthy();
  });
});
