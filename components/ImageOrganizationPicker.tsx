import React, { useEffect, useRef, useState } from 'react';
import type { GeneratedImage } from '../types';
import type { CatalogCollectionSelection } from '../packages/shared/src';
import { useCatalogOrganization } from '../hooks/useCatalogOrganization';
import {
  getCatalogCollectionSelection,
  notifyCatalogOrganizationChanged,
  updateCatalogCollection,
  updateCatalogImage,
} from '../services/studio-api/catalog';
import { OrganizationCreatePopover } from './OrganizationCreatePopover';

export function ImageOrganizationPicker({
  kind,
  workspaceId,
  images,
  onSaved,
}: {
  kind: 'tag' | 'collection';
  workspaceId: string;
  images: GeneratedImage[];
  onSaved?: () => void;
}) {
  const {
    tags,
    collections: availableCollections,
    errors,
    loading,
    refresh,
  } = useCatalogOrganization(workspaceId);
  const loadError = errors[kind];
  const [collections, setCollections] = useState<CatalogCollectionSelection[]>([]);
  const [imageTags, setImageTags] = useState(
    () => new Map(images.map((image) => [image.id, image.tags ?? []])),
  );
  const [limit, setLimit] = useState(15);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const idsKey = JSON.stringify(images.map((image) => image.id));
  const imageTagsKey = JSON.stringify(images.map((image) => [image.id, image.tags ?? []]));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setImageTags(new Map(JSON.parse(imageTagsKey) as [string, string[]][]));
  }, [imageTagsKey]);
  useEffect(() => {
    if (kind !== 'collection') return;
    let cancelled = false;
    void getCatalogCollectionSelection(workspaceId, JSON.parse(idsKey)).then(
      (value) => {
        if (!cancelled) setCollections(value);
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Could not load collections.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, idsKey, revision, kind, availableCollections]);
  const save = async (work: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      onSaved?.();
      notifyCatalogOrganizationChanged();
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const applyTag = async (name: string, remove: boolean) => {
    const results = await Promise.allSettled(
      images.map((image) =>
        updateCatalogImage(image.id, remove ? { removeTags: [name] } : { addTags: [name] }),
      ),
    );
    setImageTags((current) => {
      const next = new Map(current);
      for (const result of results)
        if (result.status === 'fulfilled') next.set(result.value.id, result.value.tags);
      return next;
    });
    onSaved?.();
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new Error(
        `${failures.length} of ${images.length} images could not be updated. Try again.`,
      );
  };
  const tagCounts = new Map<string, number>();
  for (const image of images) {
    for (const tag of new Set(imageTags.get(image.id))) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const items =
    kind === 'tag'
      ? tags.map((tag) => ({
          id: tag.name,
          name: `#${tag.name}`,
          color: tag.color,
          emoji: null,
          count: tagCounts.get(tag.name) ?? 0,
        }))
      : collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          color: null,
          emoji: collection.emoji,
          count: collection.selectedImageCount,
        }));
  return (
    <div className="organization-picker">
      <OrganizationCreatePopover
        kind={kind}
        workspaceId={workspaceId}
        imageIds={kind === 'collection' ? images.map((image) => image.id) : []}
        onCreated={async (value) => {
          if (kind === 'tag') await save(() => applyTag(value.name, false));
          else {
            onSaved?.();
            setRevision((value) => value + 1);
          }
        }}
      />
      <div
        className="organization-scroll"
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight - node.scrollTop - node.clientHeight < 64)
            setLimit((value) => value + 15);
        }}
      >
        {items.slice(0, limit).map((item) => (
          <button
            type="button"
            key={item.id}
            role="menuitemcheckbox"
            aria-checked={item.count === images.length ? true : item.count > 0 ? 'mixed' : false}
            disabled={busy}
            onClick={() =>
              void save(() =>
                kind === 'tag'
                  ? applyTag(item.id, item.count === images.length)
                  : updateCatalogCollection(
                      item.id,
                      item.count === images.length
                        ? { removeImageIds: images.map((image) => image.id) }
                        : { addImageIds: images.map((image) => image.id) },
                    ),
              )
            }
          >
            <span
              aria-hidden="true"
              className="organization-mark"
              style={item.color ? { backgroundColor: item.color } : undefined}
            >
              {item.emoji ?? (kind === 'tag' ? '' : '📁')}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span aria-hidden="true">
              {item.count === images.length ? '✓' : item.count > 0 ? '−' : ''}
            </span>
          </button>
        ))}
        {limit < items.length && (
          <button type="button" role="menuitem" onClick={() => setLimit((value) => value + 15)}>
            Show more
          </button>
        )}
      </div>
      {loading && <p role="status">Loading…</p>}
      {(error || loadError) && (
        <p role="alert">
          {error || loadError}{' '}
          <button
            type="button"
            onClick={() => {
              setError('');
              refresh();
              setRevision((value) => value + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
