/** @vitest-environment jsdom */
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_CONFIG } from '../constants';
import type { GeneratedImageWithConfig } from '../types';
import { CarouselImageDetails } from './CarouselImageDetails';
import { ImageTagsEditor } from './ImageTagsEditor';
import { ImageCollectionsEditor } from './ImageCollectionsEditor';
import { ImageOrganizationPicker } from './ImageOrganizationPicker';
import {
  createCatalogCollection,
  getCatalogCollectionSelection,
  updateCatalogCollection,
  updateCatalogImage,
  listCatalogTags,
  listCatalogCollections,
  CATALOG_ORGANIZATION_CHANGED,
} from '../services/studio-api/catalog';
import { useCatalogOrganization } from '../hooks/useCatalogOrganization';
import { applyCatalogTagChanges } from '../packages/shared/src/catalogTags';

vi.mock('../services/studio-api/catalog', () => ({
  CATALOG_ORGANIZATION_CHANGED: 'studio:catalog-organization-changed',
  listCatalogTags: vi.fn().mockResolvedValue([]),
  listCatalogCollections: vi.fn().mockResolvedValue([]),
  notifyCatalogOrganizationChanged: vi.fn(),
  updateCatalogImage: vi.fn(),
  getCatalogCollectionSelection: vi.fn().mockResolvedValue([]),
  updateCatalogCollection: vi.fn(),
  createCatalogCollection: vi.fn(),
}));

afterEach(cleanup);

it('refreshes collection checkboxes after another control changes membership', async () => {
  let selectedImageCount = 0;
  const collection = {
    id: 'album',
    workspaceId: 'default',
    name: 'Album',
    imageCount: 1,
    createdAt: '',
    updatedAt: '',
  };
  vi.mocked(listCatalogCollections).mockImplementation(async () => [{ ...collection }]);
  vi.mocked(getCatalogCollectionSelection).mockImplementation(async () => [
    { ...collection, selectedImageCount },
  ]);
  render(
    <ImageOrganizationPicker kind="collection" workspaceId="default" images={[taggedImage]} />,
  );
  const checkbox = await screen.findByRole('menuitemcheckbox', { name: 'Album' });
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  selectedImageCount = 1;
  act(() => {
    window.dispatchEvent(new Event(CATALOG_ORGANIZATION_CHANGED));
  });
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('true'));
  vi.mocked(updateCatalogCollection).mockResolvedValue(collection);
  fireEvent.click(checkbox);
  await waitFor(() =>
    expect(updateCatalogCollection).toHaveBeenLastCalledWith('album', {
      removeImageIds: ['tagged'],
    }),
  );
  vi.mocked(listCatalogCollections).mockResolvedValue([]);
  vi.mocked(getCatalogCollectionSelection).mockResolvedValue([]);
});

it('does not expose the previous workspace organization when a new scope fails, and retries', async () => {
  const collections = [
    {
      id: 'references',
      workspaceId: 'second',
      name: 'References',
      imageCount: 2,
      createdAt: '',
      updatedAt: '',
    },
  ];
  vi.mocked(listCatalogCollections)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(collections)
    .mockResolvedValueOnce(collections);
  vi.mocked(listCatalogTags)
    .mockResolvedValueOnce([{ name: 'private-tag', color: null, imageCount: 1, lastUsedAt: null }])
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce([]);
  const { result, rerender } = renderHook(
    ({ workspaceId }) => useCatalogOrganization(workspaceId),
    { initialProps: { workspaceId: 'first' } },
  );
  await waitFor(() => expect(result.current.tags[0]?.name).toBe('private-tag'));
  rerender({ workspaceId: 'second' });
  expect(result.current.tags).toEqual([]);
  await waitFor(() => expect(result.current.errors.tag).toBe('Offline'));
  expect(result.current.errors.collection).toBe('');
  expect(result.current.collections).toEqual(collections);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.errors).toEqual({ tag: '', collection: '' });
  expect(result.current.tags).toEqual([]);
});

it('applies batch tag changes without replacing unrelated tags and keeps partial failures retryable', async () => {
  const images = [
    { ...taggedImage, tags: ['boss'] },
    { ...taggedImage, id: 'second', tags: ['forest'] },
  ];
  const stored = new Map(images.map((image) => [image.id, image.tags]));
  let failSecond = true;
  vi.mocked(updateCatalogImage)
    .mockReset()
    .mockImplementation(async (id, patch) => {
      if (id === 'second' && failSecond) throw new Error('Offline');
      const tags = applyCatalogTagChanges(stored.get(id)!, patch);
      stored.set(id, tags);
      return { tags } as Awaited<ReturnType<typeof updateCatalogImage>>;
    });
  render(<ImageTagsEditor images={images} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add tag boss to all selected images' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('1 of 2'));
  expect(stored.get('second')).toEqual(['forest']);
  failSecond = false;
  fireEvent.click(screen.getByRole('button', { name: 'Add tag boss to all selected images' }));
  await waitFor(() => expect(screen.getByText('2/2')).toBeDefined());
  expect(stored.get('second')).toEqual(['forest', 'boss']);
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag boss' }));
  await waitFor(() => expect(screen.queryByText('#boss')).toBeNull());
  expect(stored.get('second')).toEqual(['forest']);
  expect(updateCatalogImage).toHaveBeenLastCalledWith('second', { removeTags: ['boss'] });
});

it('adds and removes collection membership for a mixed selection and preserves failed creation input', async () => {
  let selectedImageCount = 1;
  const collection = {
    id: 'album',
    workspaceId: 'default',
    name: 'Bosses',
    imageCount: 3,
    createdAt: '',
    updatedAt: '',
  };
  vi.mocked(getCatalogCollectionSelection).mockImplementation(async () => [
    { ...collection, selectedImageCount },
  ]);
  vi.mocked(updateCatalogCollection).mockImplementation(async (_id, patch) => {
    selectedImageCount = patch.addImageIds ? 2 : 0;
    return collection;
  });
  vi.mocked(createCatalogCollection)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(collection);
  render(<ImageCollectionsEditor workspaceId="default" imageIds={['one', 'two']} />);
  const checkbox = await screen.findByRole('checkbox', { name: 'Bosses' });
  expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
  fireEvent.click(screen.getByRole('button', { name: 'Remove selected images from Bosses' }));
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('false'));
  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('true'));
  expect(updateCatalogCollection).toHaveBeenLastCalledWith('album', {
    addImageIds: ['one', 'two'],
  });
  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('false'));
  expect(updateCatalogCollection).toHaveBeenLastCalledWith('album', {
    removeImageIds: ['one', 'two'],
  });
  const input = screen.getByRole('textbox', { name: 'New collection' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'New album' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(screen.getByRole('status').textContent).toBe('Saving collections…');
  expect(input.disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Offline'));
  expect(screen.queryByRole('status')).toBeNull();
  expect(input.value).toBe('New album');
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(input.value).toBe(''));
  expect(createCatalogCollection).toHaveBeenLastCalledWith({
    workspaceId: 'default',
    name: 'New album',
    imageIds: ['one', 'two'],
  });
  vi.mocked(getCatalogCollectionSelection).mockResolvedValue([]);
});

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
  const view = render(
    <ImageTagsEditor key={taggedImage.id} workspaceId="default" images={[taggedImage]} />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Add hashtags' }), {
    target: { value: '#ACCIÓN #accio\u0301n, #Jefe' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Add tags' }).closest('form')!);
  await waitFor(() => expect(screen.getByText('#acción')).toBeDefined());
  expect(update).toHaveBeenLastCalledWith('tagged', { addTags: ['acción', 'jefe'] });
  view.rerender(
    <ImageTagsEditor
      key={taggedImage.id}
      workspaceId="default"
      images={[{ ...taggedImage, tags: ['imported reference', 'acción'] }]}
    />,
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
  render(<ImageTagsEditor key={taggedImage.id} workspaceId="default" images={[taggedImage]} />);
  const input = screen.getByRole('textbox', { name: 'Add hashtags' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '#jefe #bad!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add tags' }));
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Use letters');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  fireEvent.change(input, { target: { value: '#jefe' } });
  expect(input.getAttribute('aria-invalid')).toBe('false');
  expect(input.hasAttribute('aria-describedby')).toBe(false);
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
  const view = render(
    <ImageTagsEditor key={taggedImage.id} workspaceId="default" images={[taggedImage]} />,
  );
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
  view.rerender(
    <ImageTagsEditor
      key="other"
      workspaceId="default"
      images={[{ ...taggedImage, id: 'other', tags: ['cielo'] }]}
    />,
  );
  await act(async () => {
    finish({ tags: ['imported reference', 'jefe'] } as Awaited<
      ReturnType<typeof updateCatalogImage>
    >);
  });
  expect(screen.getByText('#cielo')).toBeDefined();
  expect(screen.queryByText('#jefe')).toBeNull();
});

it('shows original metadata and active style badges, omitting missing file size', () => {
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
    <CarouselImageDetails workspaceId="default" image={image}>
      <button>Download</button>
    </CarouselImageDetails>,
  );
  expect(screen.getByText('2048 × 1536')).toBeDefined();
  expect(screen.getByText('1.5 MiB')).toBeDefined();
  expect(screen.getByText('PNG')).toBeDefined();
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
      workspaceId="default"
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
  expect(screen.queryByText('File size')).toBeNull();
});
