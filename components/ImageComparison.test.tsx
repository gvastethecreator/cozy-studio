/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import { ImageComparison } from './ImageComparison';

vi.mock('../lib/motionPreference', () => ({ prefersReducedMotion: () => true }));
afterEach(cleanup);

it('compares two originals at the same zoom and position and reports unavailable images', async () => {
  const first = {
    id: 'a',
    src: '/a.png',
    createdAt: 1,
    batchId: 'batch',
    config: DEFAULT_GENERATION_CONFIG,
  };
  const close = vi.fn();
  render(
    <ImageComparison
      images={[first, { ...first, id: 'b', src: '/b-thumb.png', sourceUrl: '/b.png' }]}
      onClose={close}
    />,
  );
  const viewport = screen.getByRole('group', { name: /Comparison image/ });
  Object.defineProperties(viewport, { clientWidth: { value: 512 }, clientHeight: { value: 512 } });
  const img = screen.getByRole('img', { hidden: true });
  Object.defineProperties(img, {
    naturalWidth: { value: 1024, configurable: true },
    naturalHeight: { value: 1024, configurable: true },
  });
  fireEvent.load(img);
  fireEvent.click(screen.getByRole('button', { name: 'Actual size' }));
  await waitFor(() => expect(img.style.transform).toContain('scale(1)'));
  const transform = img.style.transform;
  fireEvent.click(screen.getByRole('button', { name: 'Image B' }));
  Object.defineProperty(img, 'naturalWidth', { value: 2048, configurable: true });
  fireEvent.load(img);
  expect(img.getAttribute('src')).toBe('/b.png');
  expect(img.style.width).toBe('2048px');
  expect(img.style.transform).toBe(transform);
  fireEvent.error(img);
  expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
});
