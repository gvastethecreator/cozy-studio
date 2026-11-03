import { useCallback, useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import type {
  CatalogCollection,
  CatalogOrganizeInput,
  CatalogOrganizeResult,
  CatalogOrganizeHistoryEntry,
  CatalogTag,
} from '../packages/shared/src';
import { addToastToStore, removeToastFromStore } from '../contexts/toastStore';
import {
  CATALOG_ORGANIZATION_CHANGED,
  listCatalogCollections,
  listCatalogTags,
  organizeCatalogImages,
  undoCatalogOrganize,
  notifyCatalogOrganizationChanged,
} from '../services/studio-api/catalog';

const EMPTY_TAGS: CatalogTag[] = [];
const EMPTY_COLLECTIONS: CatalogCollection[] = [];

let organizeToastId: string | null = null;

export function summarizeOrganizeCounts(counts: CatalogOrganizeHistoryEntry['counts']) {
  const images = (count: number) => t('library.organize.imageCount', { count: String(count) });
  const parts = [
    ...Object.entries(counts.tagsAdded).map(([tag, count]) =>
      t('library.organize.addedTag', { tag, images: images(count) }),
    ),
    ...Object.entries(counts.tagsRemoved).map(([tag, count]) =>
      t('library.organize.removedTag', { tag, images: images(count) }),
    ),
  ];
  if (counts.collection?.added)
    parts.push(
      t('library.organize.addedCollection', {
        count: String(counts.collection.added),
        images: images(counts.collection.added),
        name: counts.collection.name,
      }),
    );
  if (counts.removedFrom?.removed)
    parts.push(
      t('library.organize.removedCollection', {
        count: String(counts.removedFrom.removed),
        images: images(counts.removedFrom.removed),
        name: counts.removedFrom.name,
      }),
    );
  return parts.join('; ');
}

export async function undoOrganization(operationId: string, summary: string) {
  try {
    const result = await undoCatalogOrganize(operationId);
    notifyCatalogOrganizationChanged(result);
    if (organizeToastId) removeToastFromStore(organizeToastId);
    organizeToastId = null;
    const skipped = result.skippedImageIds.length;
    addToastToStore(
      `${result.alreadyUndone ? 'Already undone' : 'Undid'}: ${summary}${skipped ? `. ${skipped} images skipped` : ''}`,
      'success',
    );
  } catch (cause) {
    addToastToStore(
      cause instanceof Error ? cause.message : 'Could not undo this change.',
      'error',
    );
  }
}

export async function organizeWithUndo(input: Omit<CatalogOrganizeInput, 'source'>) {
  const result = await organizeCatalogImages({ ...input, source: 'ui' });
  notifyCatalogOrganizationChanged(result);
  if (result.operationId) {
    const operationId = result.operationId;
    const countTags = (tags: Record<string, string[]>) =>
      Object.fromEntries(Object.entries(tags).map(([tag, ids]) => [tag, ids.length]));
    const summary = summarizeOrganizeCounts({
      tagsAdded: countTags(result.tags.added),
      tagsRemoved: countTags(result.tags.removed),
      collection: result.collection
        ? { name: result.collection.name, added: result.collection.addedImageIds.length }
        : null,
      removedFrom: result.removedFrom
        ? { name: result.removedFrom.name, removed: result.removedFrom.removedImageIds.length }
        : null,
    });
    if (organizeToastId) removeToastFromStore(organizeToastId);
    organizeToastId = addToastToStore(summary, 'success', 8000, {
      label: 'Undo',
      run: () => undoOrganization(operationId, summary),
    });
  }
  return result;
}

export function useCatalogOrganization(workspaceId: string, enabled = true) {
  const [tags, setTags] = useState<CatalogTag[]>([]);
  const [collections, setCollections] = useState<CatalogCollection[]>([]);
  // Loading means this workspace has no result yet; background refreshes keep the current lists.
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const [errors, setErrors] = useState({ tag: '', collection: '' });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener(CATALOG_ORGANIZATION_CHANGED, refresh);
    return () => window.removeEventListener(CATALOG_ORGANIZATION_CHANGED, refresh);
  }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setErrors({ tag: '', collection: '' });
    void Promise.allSettled([
      listCatalogTags(workspaceId),
      listCatalogCollections(workspaceId),
    ]).then(([nextTags, nextCollections]) => {
      if (cancelled) return;
      setLoadedWorkspaceId(workspaceId);
      setTags(nextTags.status === 'fulfilled' ? nextTags.value : []);
      setCollections(nextCollections.status === 'fulfilled' ? nextCollections.value : []);
      setErrors({
        tag:
          nextTags.status === 'rejected'
            ? nextTags.reason instanceof Error
              ? nextTags.reason.message
              : 'Could not load tags.'
            : '',
        collection:
          nextCollections.status === 'rejected'
            ? nextCollections.reason instanceof Error
              ? nextCollections.reason.message
              : 'Could not load collections.'
            : '',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, enabled, revision]);
  return {
    tags: loadedWorkspaceId === workspaceId ? tags : EMPTY_TAGS,
    collections: loadedWorkspaceId === workspaceId ? collections : EMPTY_COLLECTIONS,
    errors,
    loading: loadedWorkspaceId !== workspaceId,
    refresh,
  };
}

/** An image's tags after an organize call, from the ids the result lists per tag. */
export function applyOrganizeResult(
  imageId: string,
  tags: string[],
  result: CatalogOrganizeResult,
) {
  const has = (byTag: Record<string, string[]>) =>
    Object.keys(byTag).filter((tag) => byTag[tag].includes(imageId));
  const removed = new Set(has(result.tags.removed));
  return [...new Set([...tags.filter((tag) => !removed.has(tag)), ...has(result.tags.added)])];
}
