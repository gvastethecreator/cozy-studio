import React, { useEffect, useId, useRef, useState } from 'react';
import type { CatalogCollectionSelection } from '../packages/shared/src';
import {
  createCatalogCollection,
  getCatalogCollectionSelection,
  updateCatalogCollection,
  notifyCatalogOrganizationChanged,
} from '../services/studio-api/catalog';

export function ImageCollectionsEditor({
  workspaceId,
  imageIds,
  onSaved,
}: {
  workspaceId: string;
  imageIds: string[];
  onSaved?: () => void;
}) {
  const inputId = useId();
  const [collections, setCollections] = useState<CatalogCollectionSelection[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [revision, setRevision] = useState(0);
  const selectionKey = JSON.stringify(imageIds);

  useEffect(() => {
    let cancelled = false;
    setCollections(null);
    setError('');
    void getCatalogCollectionSelection(workspaceId, JSON.parse(selectionKey)).then(
      (list) => {
        if (!cancelled) setCollections(list);
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Could not load collections.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, selectionKey, revision]);

  const save = async (work: () => Promise<unknown>, clearName = false) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      if (clearName) setName('');
      onSaved?.();
      notifyCatalogOrganizationChanged();
      setCollections(await getCatalogCollectionSelection(workspaceId, imageIds));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update collections. Try again.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label="Image collections" className="space-y-2 text-xs">
      <h3 className="text-[color:var(--wb-muted)]">Collections</h3>
      {collections ? (
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {collections.map((collection) => {
            const all = collection.selectedImageCount === imageIds.length;
            const some = collection.selectedImageCount > 0;
            return (
              <div key={collection.id} className="flex items-center gap-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={all ? true : some ? 'mixed' : false}
                  aria-label={collection.name}
                  disabled={busy}
                  onClick={() =>
                    void save(() =>
                      updateCatalogCollection(
                        collection.id,
                        all ? { removeImageIds: imageIds } : { addImageIds: imageIds },
                      ),
                    )
                  }
                  className="studio-ghost-control flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-4 shrink-0 items-center justify-center rounded border border-[color:var(--wb-border)]"
                  >
                    {all ? '✓' : some ? '−' : ''}
                  </span>
                  <span aria-hidden="true">{collection.emoji ?? '📁'}</span>
                  <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                  {imageIds.length > 1 && (
                    <span className="text-[color:var(--wb-muted)]">
                      {collection.selectedImageCount}/{imageIds.length}
                    </span>
                  )}
                </button>
                {some && !all && (
                  <button
                    type="button"
                    aria-label={`Remove selected images from ${collection.name}`}
                    disabled={busy}
                    className="studio-ghost-control rounded px-2 py-1"
                    onClick={() =>
                      void save(() =>
                        updateCatalogCollection(collection.id, { removeImageIds: imageIds }),
                      )
                    }
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !error && <p role="status">Loading collections…</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim())
            void save(
              () => createCatalogCollection({ workspaceId, name: name.trim(), imageIds }),
              true,
            );
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          New collection
        </label>
        <input
          id={inputId}
          value={name}
          maxLength={80}
          disabled={busy || !collections}
          onChange={(event) => setName(event.target.value)}
          placeholder="New collection"
          className="studio-well min-w-0 flex-1 px-2 py-2"
        />
        <button
          type="submit"
          disabled={busy || !collections || !name.trim()}
          className="studio-ghost-control rounded px-3 py-2"
        >
          Create
        </button>
      </form>
      {busy && <p role="status">Saving collections…</p>}
      {error && (
        <div role="alert" className="text-[color:var(--wb-danger)]">
          {error}
          {!collections && (
            <button
              type="button"
              className="studio-ghost-control ml-2 rounded px-2 py-1"
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </section>
  );
}
