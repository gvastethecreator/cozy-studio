/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import ImageCarousel from './ImageCarousel';

vi.mock('../contexts/GlobalContext', () => ({
  useToastUi: () => ({ addToast: vi.fn() }),
}));
vi.mock('../contexts/WorkspaceContext', () => ({
  useWorkspaceState: () => ({ activeWorkspaceId: 'default' }),
}));
vi.mock('../services/studio-api/catalog', () => ({
  CATALOG_ORGANIZATION_CHANGED: 'studio:catalog-organization-changed',
  listCatalogTags: vi.fn().mockResolvedValue([]),
  listCatalogCollections: vi.fn().mockResolvedValue([]),
  getCatalogCollectionSelection: vi.fn().mockResolvedValue([]),
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
    config: {
      ...DEFAULT_GENERATION_CONFIG,
      attachments: [{ id: 'reference', name: 'source.png', dataUrl: '/source.png', strength: 1 }],
    },
  }));
  const select = vi.fn();
  const loadConfig = vi.fn();
  render(
    <ImageCarousel
      activeImage={images[0]}
      allImages={images}
      activeGenerationConfig={null}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onRegenerate={vi.fn()}
      onAddToContext={vi.fn()}
      onLoadConfig={loadConfig}
      onToggleFavorite={vi.fn()}
      onActiveImageChange={select}
    />,
  );
  const canvas = screen.getByRole('group', { name: /Image pan and zoom area/ });
  const fullscreenSurface = canvas.closest<HTMLElement>('.carousel-viewer')!;
  const requestFullscreen = vi.fn().mockResolvedValue(undefined);
  Object.assign(fullscreenSurface, { requestFullscreen });
  expect(fullscreenSurface.tagName).toBe('DIV');
  expect(fullscreenSurface.closest('dialog')).toBe(
    screen.getByRole('dialog', { name: 'Image viewer' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
  expect(requestFullscreen).toHaveBeenCalledOnce();
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
  fireEvent.click(screen.getByRole('button', { name: 'Reuse settings · keep current references' }));
  expect(loadConfig).toHaveBeenLastCalledWith(images[0].config);
  fireEvent.click(screen.getByRole('button', { name: 'Reuse settings and original references' }));
  expect(loadConfig).toHaveBeenLastCalledWith(images[0].config, {
    restoreOriginalReferences: true,
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Next image' }), { key: 'ArrowRight' });
  expect(select).toHaveBeenCalledWith('second');
  select.mockClear();
  fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
  expect(select).not.toHaveBeenCalled();
});

it('opens full actions for an inactive thumbnail without changing selection or navigating with menu arrows', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  const images = ['first', 'second'].map((id) => ({
    id,
    src: `/library/${id}.png`,
    batchId: 'batch',
    createdAt: 0,
    config: DEFAULT_GENERATION_CONFIG,
  }));
  const favorite = vi.fn();
  const select = vi.fn();
  const remove = vi.fn();
  render(
    <ImageCarousel
      activeImage={images[0]}
      allImages={images}
      activeGenerationConfig={null}
      onClose={vi.fn()}
      onDelete={remove}
      onRegenerate={vi.fn()}
      onAddToContext={vi.fn()}
      onLoadConfig={vi.fn()}
      onToggleFavorite={favorite}
      onActiveImageChange={select}
    />,
  );
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Open image 2 of 2' }), {
    clientX: 77,
    clientY: 88,
  });
  const action = await screen.findByRole('menuitem', { name: 'Add favorite' });
  await waitFor(() =>
    expect(screen.getByRole('menu', { name: 'Image actions' }).style.left).toBe('77px'),
  );
  expect(screen.getByRole('menu', { name: 'Image actions' }).style.top).toBe('88px');
  for (const name of [
    'Use as reference',
    'Tags',
    'Collections',
    'Copy prompt',
    'Copy image',
    'Download',
    'Load configuration',
    'Regenerate',
    'Move to trash',
  ]) {
    expect(screen.getByRole('menuitem', { name })).toBeDefined();
  }
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy prompt' }), { key: 'ArrowRight' });
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(action);
  expect(favorite).toHaveBeenCalledWith('second');
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Open image 2 of 2' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to trash' }));
  expect(remove).toHaveBeenCalledWith('second');
  expect(select).not.toHaveBeenCalled();
});
