/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogImage, CatalogPage } from '../packages/shared/src';
import { useCatalogPage } from './useCatalogPage';
import { useStudioCatalogController } from './useCatalog';
import { useCatalogWorkspaceSummaries } from './useCatalogWorkspaceSummaries';
import { useStudioActionConfirmations } from './useStudioActionConfirmations';
import { CATALOG_RENDER_BUDGET } from '../lib/catalogRenderBudget';

const api = vi.hoisted(() => ({ query: vi.fn(), detail: vi.fn(), summaries: vi.fn() }));
vi.mock('../services/studio-api/catalog', () => ({
  queryCatalog: api.query,
  getCatalogImageDetail: api.detail,
  queryCatalogWorkspaceSummaries: api.summaries,
  deleteCatalogImage: vi.fn(),
  archiveCatalogByFilter: vi.fn(),
  purgeCatalogByFilter: vi.fn(),
  restoreCatalogByFilter: vi.fn(),
  updateCatalogImage: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const emptyPage = {
  images: [],
  total: 0,
  hasMore: false,
} satisfies CatalogPage;

it('keeps the API sort across pages and passes favorites before pagination', async () => {
  const images = [
    { id: 'old', createdAt: '2026-01-01' },
    { id: 'new', createdAt: '2026-03-01' },
  ] as CatalogImage[];
  api.query.mockImplementation(async ({ offset = 0, limit = 1 }) => ({
    images: images.slice(offset, offset + limit),
    total: 2,
    hasMore: offset === 0,
  }));
  const { result } = renderHook(() =>
    useCatalogPage({ workspaceId: 'default', favorite: true, sort: 'asc', pageSize: 1 }),
  );
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  await act(() => result.current.loadMore());
  expect(result.current.view.entries.map((image) => image.id)).toEqual(['old', 'new']);
  expect(api.query.mock.calls.map(([params]) => params)).toEqual([
    { workspaceId: 'default', favorite: true, sort: 'asc', offset: 0, limit: 1 },
    { workspaceId: 'default', favorite: true, sort: 'asc', offset: 1, limit: 1 },
  ]);
});

it('counts the entire active workspace before confirming archive and refuses an unknown count', async () => {
  api.query.mockResolvedValue({ ...emptyPage, total: 6840 });
  const clearWorkspace = vi.fn();
  const addToast = vi.fn();
  const { result } = renderHook(() =>
    useStudioActionConfirmations({
      clearWorkspace,
      addToast,
      deleteWorkspace: vi.fn(),
      resetStudio: vi.fn(),
      restoreAllFromTrash: vi.fn(),
      emptyTrash: vi.fn(),
    }),
  );
  await act(() => result.current.requestClearWorkspace('default'));
  expect(api.query).toHaveBeenCalledWith({ workspaceId: 'default', deleted: false, limit: 1 });
  expect(result.current.pendingConfirmation?.details).toContain(
    '6840 images will leave the active workspace.',
  );
  expect(result.current.pendingConfirmation?.description).toContain(
    'hidden by search or favorites filters',
  );
  expect(clearWorkspace).not.toHaveBeenCalled();
  await act(() => result.current.confirmPendingAction());
  expect(clearWorkspace).toHaveBeenCalledWith('default');
  api.query.mockRejectedValue(new Error('Catalog unavailable'));
  await act(() => result.current.requestClearWorkspace('default'));
  expect(result.current.pendingConfirmation).toBeNull();
  expect(addToast).toHaveBeenCalledWith('Catalog unavailable', 'error');
});

it('loads workspace history beyond 160 entries and keeps loaded pages during refresh', async () => {
  const images = Array.from(
    { length: 171 },
    (_, index) =>
      ({
        id: `image-${index}`,
        createdAt: '2026-09-21',
        workspaceId: 'a',
        recipeId: index % 2 ? 'styles' : null,
      }) as CatalogImage,
  );
  api.query.mockImplementation(async ({ offset = 0, limit = 160 }) => ({
    images: images.slice(offset, offset + limit),
    total: images.length,
    hasMore: offset + limit < images.length,
  }));
  const { result } = renderHook(() =>
    useCatalogPage({ workspaceId: 'a', pageSize: 160, preserveLoadedPages: true }),
  );
  await waitFor(() => expect(result.current.entries).toHaveLength(160));
  await act(() => result.current.loadMore());
  expect(result.current.entries).toHaveLength(171);
  expect(result.current.hasMore).toBe(false);
  await act(() => result.current.refresh());
  expect(result.current.entries.at(-1)?.id).toBe('image-170');
  expect(result.current.entries).toHaveLength(171);
  expect(
    api.query.mock.calls.every(([params]) => params.workspaceId === 'a' && params.q === undefined),
  ).toBe(true);
});

it('retains a selected image beyond the first page only while it belongs to the new scope', async () => {
  const selected = {
    id: 'old',
    createdAt: '2025-01-01',
    workspaceId: 'a',
    recipeId: 'styles',
  } as CatalogImage;
  const newest = { id: 'new', createdAt: '2026-01-01', workspaceId: 'a' } as CatalogImage;
  api.query.mockImplementation(async ({ workspaceId, id, recipeId }) => ({
    images: workspaceId !== 'a' ? [] : id ? (recipeId === null ? [] : [selected]) : [newest],
    total: workspaceId === 'a' ? 200 : 0,
    hasMore: !id && workspaceId === 'a',
  }));
  const { result, rerender } = renderHook(
    ({ workspaceId, recipeId }: { workspaceId: string; recipeId?: string | null }) =>
      useCatalogPage({
        workspaceId,
        recipeId,
        selectedId: 'old',
        pageSize: 160,
        preserveLoadedPages: true,
      }),
    { initialProps: { workspaceId: 'a', recipeId: undefined as string | null | undefined } },
  );
  await waitFor(() =>
    expect(result.current.entries.map((entry) => entry.id)).toEqual(['new', 'old']),
  );
  rerender({ workspaceId: 'a', recipeId: 'styles' });
  await waitFor(() =>
    expect(result.current.entries.map((entry) => entry.id)).toEqual(['new', 'old']),
  );
  rerender({ workspaceId: 'a', recipeId: null });
  await waitFor(() => expect(result.current.entries.map((entry) => entry.id)).toEqual(['new']));
  rerender({ workspaceId: 'b', recipeId: undefined });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.entries).toEqual([]);
  expect(api.query.mock.calls.some(([params]) => params.id === 'old' && params.limit === 1)).toBe(
    true,
  );
});

it('shares detail reads and rejects detail responses from a previous filter generation', async () => {
  const entry = { id: 'one', createdAt: '2026-09-01', batchId: 'batch' } as CatalogImage;
  api.query.mockResolvedValue({ ...emptyPage, images: [entry], total: 1 });
  let resolve!: (value: CatalogImage) => void;
  api.detail.mockImplementation(
    () =>
      new Promise<CatalogImage>((done) => {
        resolve = done;
      }),
  );
  const { result, rerender } = renderHook(({ workspaceId }) => useCatalogPage({ workspaceId }), {
    initialProps: { workspaceId: 'a' },
  });
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  let first!: Promise<void>;
  act(() => {
    first = result.current.hydrateDetail('one');
    void result.current.hydrateDetail('one');
  });
  expect(api.detail).toHaveBeenCalledTimes(1);
  api.query.mockResolvedValue(emptyPage);
  rerender({ workspaceId: 'b' });
  await waitFor(() => expect(result.current.entries).toHaveLength(0));
  await act(async () => {
    resolve(entry);
    await first;
  });
  expect(result.current.entries).toHaveLength(0);
});

it('keeps queue results recent across Library filters and reuses the existing history page', async () => {
  const recent = [
    {
      id: 'newest',
      createdAt: '2026-10-01',
      publicUrl: '/library/newest.png',
      jobId: 'recent-job',
    },
  ] as CatalogImage[];
  const filtered = [
    {
      id: 'oldest-favorite',
      createdAt: '2026-01-01',
      publicUrl: '/library/oldest.png',
      jobId: 'old-job',
    },
  ] as CatalogImage[];
  api.query.mockImplementation(async (params) => ({
    images: params.favorite || params.sort === 'asc' || params.q ? filtered : recent,
    total: 1,
    hasMore: false,
  }));
  api.summaries.mockResolvedValue([]);
  const addToast = vi.fn();
  const { result, rerender } = renderHook(
    ({ favorites, sort, query }) =>
      useStudioCatalogController({
        activeWorkspaceId: 'default',
        isTrashOpen: false,
        historyRecipeId: 'remaster',
        historySelectedId: 'workflow-image',
        addToast,
        favorites,
        sort,
        query,
      }),
    { initialProps: { favorites: false, sort: 'desc' as 'desc' | 'asc', query: '' } },
  );
  await waitFor(() =>
    expect(result.current.queueResults.map((image) => image.id)).toEqual(['newest']),
  );
  expect(api.query).toHaveBeenCalledTimes(1);
  rerender({ favorites: true, sort: 'asc', query: 'gallows' });
  await waitFor(() =>
    expect(result.current.activeCatalog.entries.map((image) => image.id)).toEqual([
      'oldest-favorite',
    ]),
  );
  await waitFor(() =>
    expect(result.current.queueResults.map((image) => image.id)).toEqual(['newest']),
  );
  rerender({ favorites: false, sort: 'asc', query: 'another search' });
  await waitFor(() => expect(result.current.activeCatalog.isLoading).toBe(false));
  expect(result.current.queueResults.map((image) => image.id)).toEqual(['newest']);
  const recentCalls = () =>
    api.query.mock.calls.filter(
      ([params]) => params.limit === CATALOG_RENDER_BUDGET.queuePreviewLimit,
    );
  expect(recentCalls()).toHaveLength(1);
  expect(recentCalls()[0][0]).toMatchObject({ workspaceId: 'default', deleted: false, offset: 0 });
  expect(recentCalls()[0][0].q).toBeUndefined();
  expect(recentCalls()[0][0].favorite).toBeUndefined();
  expect(recentCalls()[0][0].sort).toBeUndefined();
  expect(recentCalls()[0][0].recipeId).toBeUndefined();
  expect(recentCalls()[0][0].id).toBeUndefined();
  await act(() => result.current.refreshCatalogs());
  expect(recentCalls()).toHaveLength(2);
});

it('queries trash only when it opens, including after an all-catalog refresh', async () => {
  api.query.mockResolvedValue(emptyPage);
  api.summaries.mockResolvedValue([]);
  const addToast = vi.fn();
  const { result, rerender } = renderHook(
    ({ isTrashOpen }) =>
      useStudioCatalogController({ activeWorkspaceId: 'default', isTrashOpen, addToast }),
    { initialProps: { isTrashOpen: false } },
  );
  await waitFor(() => expect(api.query).toHaveBeenCalledTimes(1));
  await act(async () => {
    await result.current.refreshCatalogs();
  });
  expect(api.query.mock.calls.filter(([query]) => query.deleted)).toHaveLength(0);
  rerender({ isTrashOpen: true });
  await waitFor(() =>
    expect(api.query.mock.calls.filter(([query]) => query.deleted)).toHaveLength(1),
  );
});

it('ignores a workspace summary response older than the latest refresh', async () => {
  let resolveOld!: (value: never[]) => void;
  api.summaries
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveOld = done;
        }),
    )
    .mockResolvedValue([{ workspaceId: 'new' }]);
  const { result } = renderHook(() => useCatalogWorkspaceSummaries());
  await act(async () => {
    await result.current.refresh();
  });
  await act(async () => {
    resolveOld([]);
  });
  expect(result.current.summaries).toEqual([{ workspaceId: 'new' }]);
});
