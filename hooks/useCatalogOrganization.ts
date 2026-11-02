import { useCallback, useEffect, useState } from 'react';
import type { CatalogCollection, CatalogOrganizeResult, CatalogTag } from '../packages/shared/src';
import {
  CATALOG_ORGANIZATION_CHANGED,
  listCatalogCollections,
  listCatalogTags,
} from '../services/studio-api/catalog';

const EMPTY_TAGS: CatalogTag[] = [];
const EMPTY_COLLECTIONS: CatalogCollection[] = [];

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
  return [...tags.filter((tag) => !removed.has(tag)), ...has(result.tags.added)];
}
