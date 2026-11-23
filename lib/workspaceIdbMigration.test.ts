import { describe, expect, it, vi } from 'vitest';
import type { StudioWorkspace, StudioWorkspaceSortOrder } from '../packages/shared/src';
import {
  migrateIndexedDbWorkspacesToServer,
  WORKSPACE_IDB_MIGRATION_MARKER,
} from './workspaceIdbMigration';

describe('workspaceIdbMigration', () => {
  it('imports missing IndexedDB workspaces once and preserves active id', async () => {
    const store = new Map<string, unknown>([
      [
        'app-workspaces',
        [
          { id: 'default', name: 'Default', createdAt: 1 },
          { id: 'local-only', name: 'Local Only', createdAt: 2 },
        ],
      ],
      ['app-active-workspace-id', 'local-only'],
    ]);
    const createRemote = vi.fn(
      async (input: {
        id?: string;
        name: string;
        filter?: Record<string, unknown>;
        sortOrder?: StudioWorkspaceSortOrder;
      }): Promise<StudioWorkspace> => ({
        id: input.id ?? 'created',
        name: input.name,
        filter: {},
        sortOrder: 'newest',
        styleScope: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const listRemote = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'default',
          name: 'Default',
          filter: {},
          sortOrder: 'newest',
          styleScope: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ])
      .mockResolvedValue([
        {
          id: 'default',
          name: 'Default',
          filter: {},
          sortOrder: 'newest',
          styleScope: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'local-only',
          name: 'Local Only',
          filter: {},
          sortOrder: 'newest',
          styleScope: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

    const first = await migrateIndexedDbWorkspacesToServer({
      getIdb: async (key) => store.get(key) as never,
      setIdb: async (key, value) => {
        store.set(key, value);
      },
      delIdb: async (key) => {
        store.delete(key);
      },
      listRemote,
      createRemote,
    });

    expect(first.migrated).toBe(true);
    expect(createRemote).toHaveBeenCalledWith({
      id: 'local-only',
      name: 'Local Only',
    });
    expect(first.activeWorkspaceId).toBe('local-only');
    expect(store.get(WORKSPACE_IDB_MIGRATION_MARKER)).toBe(true);
    expect(store.has('app-workspaces')).toBe(false);
    expect(store.get('app-active-workspace-id')).toBe('local-only');

    createRemote.mockClear();
    const second = await migrateIndexedDbWorkspacesToServer({
      getIdb: async (key) => store.get(key) as never,
      setIdb: async (key, value) => {
        store.set(key, value);
      },
      delIdb: async (key) => {
        store.delete(key);
      },
      listRemote,
      createRemote,
    });
    expect(second.migrated).toBe(false);
    expect(createRemote).not.toHaveBeenCalled();
    expect(store.has('app-workspaces')).toBe(false);
  });
});
