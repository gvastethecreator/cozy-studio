/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { GeneratedImageWithConfig } from '../types';
import { setIsGlobalTransitioning } from '../utils/transitionUtils';
import { useModalManager } from './useModalManager';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'startViewTransition');
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.transitionType;
  setIsGlobalTransitioning(false);
  window.history.replaceState(null, '', '/');
});

function image(id: string) {
  return { id } as GeneratedImageWithConfig;
}

it('keeps the newly opened carousel selection when an older close transition finishes', async () => {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn((update: () => void) => {
      update();
      return { ready: Promise.resolve(), finished };
    }),
  });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const { result } = renderHook(() => useModalManager());
  setIsGlobalTransitioning(true);
  act(() => result.current.openModal(image('first')));
  setIsGlobalTransitioning(false);
  act(() => result.current.closeModal());
  act(() => result.current.openModal(image('second')));
  act(() => result.current.setActiveCarouselId('third'));
  await act(async () => {
    finish();
    await finished;
  });
  expect(result.current.modalImage?.id).toBe('second');
  expect(result.current.activeCarouselId).toBe('third');
  expect(result.current.transitioningImageId).toBeNull();
});

it('opens and closes immediately with Studio reduced motion enabled', () => {
  document.documentElement.dataset.motion = 'reduced';
  const start = vi.fn((update: () => void) => {
    update();
    return { ready: Promise.resolve(), finished: Promise.resolve() };
  });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const { result } = renderHook(() => useModalManager());
  act(() => result.current.openModal(image('first')));
  expect(result.current.activeCarouselId).toBe('first');
  act(() => result.current.closeModal());
  expect(result.current.isModalOpen).toBe(false);
  expect(result.current.transitioningImageId).toBeNull();
  expect(start).not.toHaveBeenCalled();
});
