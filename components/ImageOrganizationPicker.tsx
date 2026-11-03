import { organizeWithUndo } from '../hooks/useCatalogOrganization';
import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import type { GeneratedImage } from '../types';
import type { CatalogCollectionSelection, CatalogOrganizeResult } from '../packages/shared/src';
import { applyOrganizeResult, useCatalogOrganization } from '../hooks/useCatalogOrganization';
import {
  getCatalogCollectionSelection,
  CATALOG_ORGANIZATION_CHANGED,
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
  const { t } = useT();
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
    const onOrganized = (event: Event) => {
      const result = (event as CustomEvent<CatalogOrganizeResult | undefined>).detail;
      if (!result || result.workspaceId !== workspaceId) return;
      setImageTags(
        (current) =>
          new Map([...current].map(([id, tags]) => [id, applyOrganizeResult(id, tags, result)])),
      );
    };
    window.addEventListener(CATALOG_ORGANIZATION_CHANGED, onOrganized);
    return () => window.removeEventListener(CATALOG_ORGANIZATION_CHANGED, onOrganized);
  }, [workspaceId]);
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
          setError(
            cause instanceof Error ? cause.message : t('library.picker.loadCollectionsError'),
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, idsKey, revision, kind, availableCollections, t]);
  const save = async (work: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      onSaved?.();
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('library.picker.saveError'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const imageIds = images.map((image) => image.id);
  // All or nothing: a rejected call changes no image.
  const applyTag = async (name: string, remove: boolean) => {
    const result = await organizeWithUndo({
      workspaceId,
      imageIds,
      ...(remove ? { removeTags: [name] } : { addTags: [name] }),
    });
    setImageTags(
      (current) =>
        new Map(
          [...current].map(([id, tags]) => [id, applyOrganizeResult(id, tags, result)] as const),
        ),
    );
  };
  const toggleCollection = (name: string, remove: boolean) =>
    organizeWithUndo({
      workspaceId,
      imageIds,
      ...(remove ? { removeFromCollection: name } : { addToCollection: name }),
    });
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
                  : toggleCollection(item.name, item.count === images.length),
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
            {t('library.picker.showMore')}
          </button>
        )}
      </div>
      {loading && <p role="status">{t('library.picker.loading')}</p>}
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
            {t('library.picker.retry')}
          </button>
        </p>
      )}
    </div>
  );
}
