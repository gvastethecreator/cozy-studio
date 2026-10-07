/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import ImageCarousel from './ImageCarousel';

vi.mock('../contexts/GlobalContext', () => ({
  useToastUi: () => ({ addToast: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

it('keeps the canvas while hiding details and navigates from focused controls without stealing pan keys', () => {
  const resizeCallbacks = new Map<Element, () => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe(element: Element) {
        resizeCallbacks.set(element, this.callback);
      }
      disconnect() {}
    },
  );
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
  const images = ['first', 'second'].map((id) => ({
    id,
    src: `/library/${id}.png`,
    batchId: 'batch',
    createdAt: 0,
    config: DEFAULT_GENERATION_CONFIG,
  }));
  const select = vi.fn();
  render(
    <ImageCarousel
      activeImage={images[0]}
      allImages={images}
      activeGenerationConfig={null}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onRegenerate={vi.fn()}
      onAddToContext={vi.fn()}
      onLoadConfig={vi.fn()}
      onToggleFavorite={vi.fn()}
      onActiveImageChange={select}
    />,
  );
  const canvas = screen.getByRole('group', { name: /Image pan and zoom area/ });
  const strip = screen.getByRole('toolbar', { name: 'Image thumbnails' });
  const activeThumbnail = screen.getByRole('button', { name: 'Open image 1 of 2' });
  scroll.mockClear();
  act(resizeCallbacks.get(strip)!);
  expect(scroll).not.toHaveBeenCalled();
  Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 320 });
  act(resizeCallbacks.get(strip)!);
  expect(scroll.mock.contexts.at(-1)).toBe(activeThumbnail);
  expect(scroll).toHaveBeenLastCalledWith({
    behavior: 'instant',
    block: 'nearest',
    inline: 'center',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Hide image details' }));
  expect(screen.queryByRole('complementary', { name: 'Image details' })).toBeNull();
  expect(screen.getByRole('group', { name: /Image pan and zoom area/ })).toBe(canvas);
  fireEvent.click(screen.getByRole('button', { name: 'Show image details' }));
  expect(screen.getByRole('complementary', { name: 'Image details' })).toBeDefined();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Next image' }), { key: 'ArrowRight' });
  expect(select).toHaveBeenCalledWith('second');
  select.mockClear();
  fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
  expect(select).not.toHaveBeenCalled();
});
