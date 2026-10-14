/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import type { GeneratedImageWithConfig } from '../types';
import { CarouselImageDetails } from './CarouselImageDetails';
import { updateCatalogImage } from '../services/studio-api/catalog';
import { applyCatalogTagChanges } from '../packages/shared/src/catalogTags';

vi.mock('../services/studio-api/catalog', () => ({ updateCatalogImage: vi.fn() }));

afterEach(cleanup);

const taggedImage: GeneratedImageWithConfig = {
  id: 'tagged',
  src: '/image.png',
  batchId: 'batch',
  createdAt: 1,
  tags: ['imported reference'],
  config: DEFAULT_GENERATION_CONFIG,
};

it('adds multiple normalized hashtags without losing existing metadata and removes individual tags', async () => {
  const update = vi.mocked(updateCatalogImage);
  let stored = [...taggedImage.tags!];
  update.mockImplementation(async (_id, patch) => {
    stored = applyCatalogTagChanges(stored, patch);
    return { tags: stored } as Awaited<ReturnType<typeof updateCatalogImage>>;
  });
  const view = render(<CarouselImageDetails image={taggedImage} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Add hashtags' }), {
    target: { value: '#ACCIÓN #accio\u0301n, #Jefe' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Add tags' }).closest('form')!);
  await waitFor(() => expect(screen.getByText('#acción')).toBeDefined());
  expect(update).toHaveBeenLastCalledWith('tagged', { addTags: ['acción', 'jefe'] });
  view.rerender(
    <CarouselImageDetails image={{ ...taggedImage, tags: ['imported reference', 'acción'] }} />,
  );
  expect(screen.getByText('#jefe')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag jefe' }));
  await waitFor(() => expect(screen.queryByText('#jefe')).toBeNull());
  expect(update).toHaveBeenLastCalledWith('tagged', { removeTags: ['jefe'] });
});

it('keeps failed hashtag input for retry and does not apply partial invalid input', async () => {
  const update = vi.mocked(updateCatalogImage);
  update.mockReset();
  update
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ tags: ['imported reference', 'jefe'] } as Awaited<
      ReturnType<typeof updateCatalogImage>
    >);
  render(<CarouselImageDetails image={taggedImage} />);
  const input = screen.getByRole('textbox', { name: 'Add hashtags' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '#jefe #bad!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Use letters');
  fireEvent.change(input, { target: { value: '#jefe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Offline'));
  expect(input.value).toBe('#jefe');
  fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));
  await waitFor(() => expect(screen.getByText('#jefe')).toBeDefined());
  expect(input.value).toBe('');
});

it('blocks overlapping saves and isolates a late result after navigating to another image', async () => {
  let finish!: (value: Awaited<ReturnType<typeof updateCatalogImage>>) => void;
  const update = vi.mocked(updateCatalogImage);
  update.mockReset().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<CarouselImageDetails image={taggedImage} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Add hashtags' }), {
    target: { value: '#jefe' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));
  const remove = screen.getByRole('button', {
    name: 'Remove tag imported reference',
  }) as HTMLButtonElement;
  expect(remove.disabled).toBe(true);
  fireEvent.click(remove);
  expect(update).toHaveBeenCalledTimes(1);
  view.rerender(<CarouselImageDetails image={{ ...taggedImage, id: 'other', tags: ['cielo'] }} />);
  await act(async () => {
    finish({ tags: ['imported reference', 'jefe'] } as Awaited<
      ReturnType<typeof updateCatalogImage>
    >);
  });
  expect(screen.getByText('#cielo')).toBeDefined();
  expect(screen.queryByText('#jefe')).toBeNull();
});

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
