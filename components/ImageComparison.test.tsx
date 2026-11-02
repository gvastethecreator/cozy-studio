/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import { ImageComparison } from './ImageComparison';

vi.mock('../lib/motionPreference', () => ({ prefersReducedMotion: () => true }));
vi.mock('../services/studio-api/catalog', () => ({
  getCatalogImageDetail: vi.fn(async (id: string) => ({
    id,
    prompt: 'castle',
    generationConfig: { prompt: 'castle', executionModel: 'gpt-image-2' },
  })),
}));
afterEach(cleanup);

it('compares originals in a grid at one zoom and position, picks a favorite and reports unavailable images', async () => {
  const first = {
    id: 'a',
    src: '/a.png',
    createdAt: 1,
    batchId: 'batch',
    providerId: 'chatgpt',
    width: 1024,
    height: 1024,
    config: DEFAULT_GENERATION_CONFIG,
  };
  const close = vi.fn();
  const favorite = vi.fn();
  render(
    <ImageComparison
      images={[
        first,
        {
          ...first,
          id: 'b',
          src: '/b-thumb.png',
          sourceUrl: '/b.png',
          width: 2048,
          isFavorite: true,
        },
        { ...first, id: 'c', src: '/c.png' },
      ]}
      workspaceId="ws"
      onToggleFavorite={favorite}
      onClose={close}
    />,
  );
  const viewport = screen.getByRole('group', { name: /Comparison images/ });
  const cells = screen.getAllByRole('figure');
  const images = [...viewport.querySelectorAll('img')];
  expect(cells).toHaveLength(3);
  expect(images.map((img) => img.getAttribute('src'))).toEqual(['/a.png', '/b.png', '/c.png']);
  for (const img of images) {
    fireEvent.load(img);
    expect(img.parentElement?.getAttribute('style')).toContain('var(--pan-zoom-transform');
  }
  await waitFor(() =>
    expect(screen.getByText(/Same in all/).parentElement?.textContent).toContain(
      'Model: gpt-image-2',
    ),
  );
  expect(within(cells[1]).getByText('2048 × 1024')).toBeTruthy();

  const transform = () => viewport.style.getPropertyValue('--pan-zoom-transform');
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in comparison' }));
  await waitFor(() => expect(transform()).toContain('scale(1.25)'));

  // 1:1 for a 4096 px original in a 200 × 100 cell is 40.96× the fit, above the old 15× cap.
  const [firstBox, secondBox] = cells.map((cell) => cell.querySelector('[data-pan-zoom-cell]')!);
  Object.defineProperties(firstBox, { clientWidth: { value: 200 }, clientHeight: { value: 100 } });
  Object.defineProperties(images[0], {
    naturalWidth: { value: 4096 },
    naturalHeight: { value: 4096 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Actual size' }));
  await waitFor(() => expect(transform()).toContain('scale(40.96)'));
  // A wheel over a caption zooms around the pointer in that caption's cell, here its center.
  secondBox.getBoundingClientRect = () =>
    ({ left: 100, top: 0, width: 100, height: 100 }) as DOMRect;
  fireEvent.wheel(cells[1].querySelector('figcaption')!, {
    deltaY: -100,
    clientX: 150,
    clientY: 50,
  });
  await waitFor(() => expect(transform()).toContain('translate3d(0px, 0px, 0) scale(45.2'));

  fireEvent.click(screen.getByRole('button', { name: 'Pick image 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick image 2' }));
  expect(favorite).toHaveBeenCalledOnce();
  expect(favorite).toHaveBeenCalledWith('a');
  expect(screen.getByRole('status').textContent).toBe('Image 2 is your pick');

  fireEvent.error(images[2]);
  expect(within(cells[2]).getByRole('alert').textContent).toContain('could not be loaded');
  expect(within(cells[0]).queryByRole('alert')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'One at a time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in comparison' }));
  await waitFor(() => expect(transform()).toContain('scale(1.25)'));
  const zoomed = transform();
  fireEvent.click(screen.getByRole('button', { name: 'Show image 2' }));
  expect(cells[0].hidden).toBe(true);
  expect(cells[1].hidden).toBe(false);
  expect(transform()).toBe(zoomed);

  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
});
