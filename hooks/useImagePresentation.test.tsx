/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useImagePresentation } from './useImagePresentation';

let loads: HTMLImageElement[];
beforeEach(() => {
  vi.useFakeTimers();
  loads = [];
  vi.stubGlobal(
    'Image',
    class {
      constructor() {
        const image = document.createElement('img');
        Object.defineProperties(image, {
          naturalWidth: { value: 2048 },
          naturalHeight: { value: 1024 },
          decode: { value: vi.fn().mockResolvedValue(undefined) },
        });
        loads.push(image);
        return image;
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.documentElement.dataset.motion;
});
async function loaded(index: number) {
  await act(async () => {
    loads[index].dispatchEvent(new Event('load'));
  });
}

it('keeps image and metadata together, ignores superseded loads and retains the old original until the overlay finishes', async () => {
  const { result, rerender } = renderHook(
    ({ id }) => useImagePresentation({ id }, `/${id}.png`, 'one'),
    { initialProps: { id: 'a' } },
  );
  await loaded(0);
  rerender({ id: 'b' });
  expect(result.current.value.id).toBe('a');
  expect(result.current.pending).toBe(true);
  rerender({ id: 'c' });
  await loaded(1);
  expect(result.current.value.id).toBe('a');
  await loaded(2);
  expect(result.current.previousSrc).toBe('/a.png');
  expect(result.current.src).toBe('/c.png');
  act(() => {
    result.current.finishTransition();
  });
  expect(result.current).toMatchObject({
    src: '/c.png',
    width: 2048,
    height: 1024,
    pending: false,
    previousSrc: undefined,
    value: { id: 'c' },
  });
  rerender({ id: 'b' });
  await loaded(3);
  rerender({ id: 'c' });
  await loaded(4);
  act(() => {
    result.current.finishTransition();
  });
  expect(result.current.src).toBe('/c.png');
  expect(result.current.previousSrc).toBeUndefined();
});

it('clears the previous workspace immediately and settles failed loads without animation in reduced motion', async () => {
  document.documentElement.dataset.motion = 'reduced';
  const { result, rerender } = renderHook(
    ({ id, scope }) => useImagePresentation(id, `/${id}.png`, scope),
    { initialProps: { id: 'a', scope: 'one' } },
  );
  await loaded(0);
  rerender({ id: 'b', scope: 'two' });
  expect(result.current.value).toBe('b');
  await loaded(1);
  rerender({ id: 'c', scope: 'two' });
  act(() => {
    loads[2].dispatchEvent(new Event('error'));
  });
  expect(result.current).toMatchObject({
    value: 'c',
    failed: true,
    pending: false,
    previousSrc: undefined,
    width: 0,
  });
});
