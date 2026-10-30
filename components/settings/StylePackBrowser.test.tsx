/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StylePackPreviewResponse } from '../../services/studio-api/extensions';
import { PackDetail, type BrowsablePack } from './StylePackBrowser';

afterEach(() => {
  cleanup();
});

function previewResponse(description: string): StylePackPreviewResponse {
  return {
    preview: {
      schemaVersion: 1,
      title: 'Ink studies',
      description,
      presetCount: 3,
      categories: [],
      cover: null,
      samples: [],
    },
    imageBase: '/api/extensions/test/',
  };
}

function pack(key: string, version: string, loadPreview: BrowsablePack['loadPreview']) {
  return { key, version, title: 'Ink studies', subtitle: '3 styles', loadPreview };
}

describe('PackDetail', () => {
  it('retries a failed preview load', async () => {
    const loadPreview = vi
      .fn<BrowsablePack['loadPreview']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(previewResponse('Loaded after retry'));
    render(<PackDetail pack={pack('retry', '1.0.0', loadPreview)} onBack={() => undefined} />);

    expect((await screen.findByRole('alert')).textContent).toBe('offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading Ink studies preview' }));

    await screen.findByText('Loaded after retry');
    expect(loadPreview).toHaveBeenCalledTimes(2);
  });

  it('loads a fresh preview for a new pack version', async () => {
    const first = vi.fn(async () => previewResponse('Version one'));
    const view = render(
      <PackDetail pack={pack('versioned', '1.0.0', first)} onBack={() => undefined} />,
    );
    await screen.findByText('Version one');

    const second = vi.fn(async () => previewResponse('Version two'));
    view.rerender(
      <PackDetail pack={pack('versioned', '1.1.0', second)} onBack={() => undefined} />,
    );

    await screen.findByText('Version two');
    expect(second).toHaveBeenCalledTimes(1);
  });
});
