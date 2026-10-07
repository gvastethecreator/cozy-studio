/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import type { GeneratedImageWithConfig } from '../types';
import { CarouselImageDetails } from './CarouselImageDetails';

afterEach(cleanup);

it('shows original metadata and active style badges, preserving unknown file size', () => {
  const image: GeneratedImageWithConfig = {
    id: 'image',
    src: '/image.png',
    batchId: 'batch',
    createdAt: Date.UTC(2026, 9, 7, 12),
    width: 2048,
    height: 1536,
    fileSizeBytes: 1.5 * 1024 ** 2,
    mimeType: 'image/png',
    providerId: 'chatgpt',
    config: {
      ...DEFAULT_GENERATION_CONFIG,
      prompt: 'A detailed landscape with distant mountains. '.repeat(40),
      recipeParams: {
        selectedStyles: [
          { presetId: 'active', presetName: 'Woodcut', packName: 'Print', enabled: true },
          { presetId: 'disabled', presetName: 'Oil paint', enabled: false },
          null,
        ],
      },
    },
  };
  const view = render(
    <CarouselImageDetails image={image}>
      <button>Download</button>
    </CarouselImageDetails>,
  );
  expect(screen.getByText('2048 × 1536')).toBeDefined();
  expect(screen.getByText('1.5 MiB')).toBeDefined();
  expect(screen.getByText('image/png')).toBeDefined();
  expect(screen.getByText('ChatGPT')).toBeDefined();
  expect(screen.getByText(new Date(image.createdAt).toLocaleString())).toBeDefined();
  expect(screen.getByText('Woodcut').getAttribute('title')).toBe('Print');
  expect(screen.queryByText('Oil paint')).toBeNull();
  expect(screen.getByLabelText('Full image prompt').textContent).toContain(image.config.prompt);
  expect(screen.getByRole('button', { name: 'Download' })).toBeDefined();

  const provider = screen.getByText('ChatGPT');
  const dimensions = screen.getByText('2048 × 1536');
  const fileSize = screen.getByText('1.5 MiB');
  view.rerender(
    <CarouselImageDetails
      image={{
        ...image,
        id: 'next-image',
        fileSizeBytes: null,
        config: { ...image.config, prompt: 'Next image prompt' },
      }}
    />,
  );
  expect(screen.getByLabelText('Full image prompt').textContent).toBe('PromptNext image prompt');
  expect(screen.getByText('ChatGPT')).toBe(provider);
  expect(screen.getByText('2048 × 1536')).toBe(dimensions);
  expect(fileSize.isConnected).toBe(false);
  expect(screen.getByText('File size').nextElementSibling?.textContent).toBe('Unknown');
});
