import React, { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  parseImageHashtags,
  parseCatalogOrganizeInput,
  type CatalogCollection,
  type CatalogOrganizeResult,
  type CatalogOrganizeSuggestion,
} from '../packages/shared/src';
import { toStudioAssetUrl } from '../services/studio-api/assetUrls';
import {
  getCatalogOrganizeSuggestions,
  listCatalogCollections,
  notifyCatalogOrganizationChanged,
  organizeCatalogImages,
  undoCatalogOrganize,
} from '../services/studio-api/catalog';
import { StudioApiError } from '../services/studio-api/http';

type ReviewGroup = CatalogOrganizeSuggestion['groups'][number] & {
  included: boolean;
  tagDraft: string;
};
type AppliedGroup = { index: number; result: CatalogOrganizeResult; undone: boolean };
type Phase = 'loading' | 'review' | 'applying' | 'done' | 'undoing';
type DialogError = { action: 'load' | 'apply' | 'undo'; message: string; conflict?: boolean };

export function OrganizeSuggestionsDialog({
  workspaceId,
  onClose,
  onCatalogChanged,
}: {
  workspaceId: string;
  onClose: () => void;
  onCatalogChanged?: () => void;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('loading');
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [suggestion, setSuggestion] = useState<CatalogOrganizeSuggestion | null>(null);
  const [collections, setCollections] = useState<CatalogCollection[]>([]);
  const [applied, setApplied] = useState<AppliedGroup[]>([]);
  const [uncertainGroup, setUncertainGroup] = useState<{ index: number; name: string } | null>(
    null,
  );
  const [undoStarted, setUndoStarted] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const [error, setError] = useState<DialogError | null>(null);
  const [revision, setRevision] = useState(0);
  const busy = phase === 'applying' || phase === 'undoing';
  const close = () => {
    if (!busy) onClose();
  };
  const dialogRef = useDialogFocus(true, close, undefined, 'input');

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    void Promise.all([
      getCatalogOrganizeSuggestions(workspaceId),
      listCatalogCollections(workspaceId),
    ]).then(
      ([next, existing]) => {
        if (cancelled) return;
        setSuggestion(next);
        setGroups(next.groups.map((group) => ({ ...group, included: true, tagDraft: '' })));
        setCollections(existing);
        setPhase('review');
      },
      (cause: unknown) => {
        if (!cancelled)
          setError({
            action: 'load',
            message: cause instanceof Error ? cause.message : t('library.suggestions.loadError'),
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, revision, t]);

  const updateGroup = (index: number, patch: Partial<ReviewGroup>) =>
    setGroups((current) =>
      current.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    );
  const completed = new Set(applied.map((item) => item.index));
  const pending = groups.flatMap((group, index) =>
    group.included && !completed.has(index) ? [{ group, index }] : [],
  );
  const active = applied.filter((item) => !item.undone);
  const undoable = active.filter((item) => item.result.operationId);
  const organizedIds = new Set(
    active.flatMap(({ result }) => [
      ...Object.values(result.tags.added).flat(),
      ...(result.collection?.addedImageIds ?? []),
    ]),
  );
  const collectionCount = new Set(
    active.flatMap(({ result }) =>
      result.collection?.addedImageIds.length ? [result.collection.id] : [],
    ),
  ).size;
  const remaining =
    (suggestion?.total ?? 0) -
    groups.reduce((count, group) => count + (group.included ? group.imageIds.length : 0), 0);
  const refresh = () => {
    notifyCatalogOrganizationChanged();
    onCatalogChanged?.();
  };

  const apply = async () => {
    setPhase('applying');
    setError(null);
    let changed = false;
    let currentName = '';
    let requestingIndex: number | null = null;
    try {
      // Validate the edited proposals before applying the first group.
      const inputs = pending.map(({ group, index }) => {
        currentName =
          group.collection.trim() || t('library.suggestions.group', { number: String(index + 1) });
        const addTags = [...new Set([...group.tags, ...parseImageHashtags(group.tagDraft)])];
        if (!group.collection.trim() && !addTags.length) {
          throw new Error(t('library.suggestions.emptyGroup'));
        }
        return {
          index,
          name: currentName,
          input: parseCatalogOrganizeInput({
            source: 'ui',
            workspaceId,
            imageIds: group.imageIds,
            addTags,
            ...(group.collection.trim() && { addToCollection: group.collection }),
          }),
        };
      });
      for (const { input, index, name } of inputs) {
        currentName = name;
        requestingIndex = index;
        const result = await organizeCatalogImages(input);
        requestingIndex = null;
        changed = true;
        setApplied((current) => [...current, { index, result, undone: false }]);
      }
      setPhase('done');
    } catch (cause) {
      const rejected =
        cause instanceof StudioApiError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        cause.status !== 408;
      if (requestingIndex !== null && !rejected) {
        // A lost response can hide a committed operation. A no-op retry cannot recover its id.
        setUncertainGroup({ index: requestingIndex, name: currentName });
        changed = true;
        setError({
          action: 'apply',
          message: t('library.suggestions.unconfirmedError', {
            name: currentName,
            error: cause instanceof Error ? cause.message : t('library.suggestions.lostResponse'),
          }),
        });
      } else {
        setError({
          action: 'apply',
          message: t('library.suggestions.partialError', {
            name: currentName,
            error: cause instanceof Error ? cause.message : t('library.suggestions.organizeError'),
          }),
        });
      }
      setPhase('review');
    } finally {
      if (changed) refresh();
    }
  };

  const undo = async () => {
    setPhase('undoing');
    setUndoStarted(true);
    setError(null);
    let changed = false;
    try {
      for (const item of [...undoable].reverse()) {
        const result = await undoCatalogOrganize(item.result.operationId!);
        changed = true;
        setApplied((current) =>
          current.map((entry) => (entry.index === item.index ? { ...entry, undone: true } : entry)),
        );
        setSkippedCount((count) => count + result.skippedImageIds.length);
      }
    } catch (cause) {
      const conflict = cause instanceof StudioApiError && cause.status === 409;
      setError({
        action: 'undo',
        conflict,
        message: t(
          conflict ? 'library.suggestions.undoConflict' : 'library.suggestions.undoUnconfirmed',
          { error: cause instanceof Error ? cause.message : t('library.suggestions.undoError') },
        ),
      });
    } finally {
      setPhase('done');
      if (changed) refresh();
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={t('library.suggestions.title')}
      className="studio-modal fixed inset-0 z-110 flex items-center justify-center p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="studio-scrim absolute inset-0" onClick={close} aria-hidden="true" />
      <div className="studio-dialog relative max-h-[85vh] w-full max-w-2xl overflow-y-auto p-5">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('library.suggestions.title')}</h2>
            <p className="mt-1 text-xs text-[color:var(--wb-muted)]">
              {t('library.suggestions.intro')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('library.suggestions.close')}
            disabled={busy}
            onClick={close}
            className="studio-ghost-control rounded px-2 py-1"
          >
            ×
          </button>
        </header>
        {phase === 'loading' && !error && (
          <p role="status" className="py-6 text-sm">
            {t('library.suggestions.finding')}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mb-4 rounded border border-red-400/30 bg-red-400/10 p-3 text-xs"
          >
            <p>{error.message}</p>
            {error.action === 'load' && (
              <button
                type="button"
                onClick={() => setRevision((value) => value + 1)}
                className="studio-ghost-control mt-2 rounded px-3 py-2"
              >
                {t('library.suggestions.retry')}
              </button>
            )}
            {error.conflict && <p className="mt-2">{t('library.suggestions.conflictHint')}</p>}
          </div>
        )}
        {suggestion && !groups.length && (
          <p className="py-6 text-sm">{t('library.suggestions.none')}</p>
        )}
        {uncertainGroup && (
          <div
            role="status"
            className="mb-4 rounded border border-amber-400/30 bg-amber-400/10 p-3 text-xs"
          >
            <p>{t('library.suggestions.unknownGroup', { name: uncertainGroup.name })}</p>
            <p className="mt-1">{t('library.suggestions.unknownHint')}</p>
          </div>
        )}
        {applied.length > 0 && (
          <div
            role="status"
            className="mb-4 rounded border border-[color:var(--wb-line)] p-3 text-sm"
          >
            {undoStarted && !undoable.length
              ? uncertainGroup
                ? t('library.suggestions.confirmedUndone')
                : t('library.suggestions.allUndone')
              : t(
                  collectionCount
                    ? uncertainGroup
                      ? 'library.suggestions.confirmedCollections'
                      : 'library.suggestions.organizedCollections'
                    : uncertainGroup
                      ? 'library.suggestions.confirmedTags'
                      : 'library.suggestions.organizedTags',
                  {
                    count: String(organizedIds.size),
                    collections: t('library.suggestions.collectionCount', {
                      count: String(collectionCount),
                    }),
                  },
                )}
            {skippedCount > 0 && (
              <p className="mt-1 text-xs">
                {t('library.suggestions.skipped', { count: String(skippedCount) })}
              </p>
            )}
          </div>
        )}
        {(phase === 'review' || phase === 'applying') && (
          <div className="space-y-3">
            {groups.map((group, index) => {
              const saved = completed.has(index);
              const existing = collections.some(
                (item) =>
                  item.kind === 'manual' &&
                  item.name.toLocaleLowerCase() === group.collection.trim().toLocaleLowerCase(),
              );
              return (
                <fieldset
                  key={index}
                  disabled={busy || saved || !!uncertainGroup}
                  className="studio-well p-3"
                >
                  <legend className="sr-only">
                    {t('library.suggestions.group', { number: String(index + 1) })}
                  </legend>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      aria-label={t('library.suggestions.include', { number: String(index + 1) })}
                      checked={group.included}
                      onChange={(event) => updateGroup(index, { included: event.target.checked })}
                    />
                    <label className="flex-1 text-xs">
                      {t('library.suggestions.collectionLabel')}{' '}
                      {existing && (
                        <span className="text-[color:var(--wb-muted)]">
                          {t('library.suggestions.existing')}
                        </span>
                      )}
                      <input
                        aria-label={t('library.suggestions.collectionName', {
                          number: String(index + 1),
                        })}
                        value={group.collection}
                        maxLength={80}
                        placeholder={t('library.suggestions.collectionPlaceholder')}
                        onChange={(event) => updateGroup(index, { collection: event.target.value })}
                        className="studio-well mt-1 w-full px-2 py-2"
                      />
                    </label>
                    <span className="text-xs text-[color:var(--wb-muted)]">
                      {uncertainGroup?.index === index
                        ? t('library.suggestions.unknown')
                        : saved
                          ? t('library.suggestions.applied')
                          : t('library.suggestions.imageCount', {
                              count: String(group.imageIds.length),
                            })}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[color:var(--wb-muted)]">{group.reason}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {group.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        aria-label={t('library.suggestions.removeTag', {
                          tag,
                          number: String(index + 1),
                        })}
                        onClick={() =>
                          updateGroup(index, { tags: group.tags.filter((value) => value !== tag) })
                        }
                        className="studio-ghost-control rounded border border-[color:var(--wb-line)] px-2 py-1 text-xs"
                      >
                        #{tag} ×
                      </button>
                    ))}
                    <input
                      aria-label={t('library.suggestions.addTags', { number: String(index + 1) })}
                      value={group.tagDraft}
                      onChange={(event) => updateGroup(index, { tagDraft: event.target.value })}
                      placeholder={t('library.suggestions.tagPlaceholder')}
                      className="studio-well min-w-0 flex-1 px-2 py-1 text-xs"
                    />
                  </div>
                  {!!group.previewUrls.length && (
                    <div className="mt-3 flex gap-2">
                      {group.previewUrls.map((url, preview) => (
                        <img
                          key={`${url}-${preview}`}
                          src={toStudioAssetUrl(url)}
                          alt={t('library.suggestions.preview', {
                            number: String(index + 1),
                            preview: String(preview + 1),
                          })}
                          className="h-16 w-16 rounded object-cover"
                        />
                      ))}
                    </div>
                  )}
                </fieldset>
              );
            })}
          </div>
        )}
        {suggestion && !undoStarted && !uncertainGroup && phase !== 'done' && (
          <p className="mt-4 text-xs text-[color:var(--wb-muted)]">
            {t('library.suggestions.remaining', { count: String(remaining) })}
          </p>
        )}
        <p className="mt-2 text-xs text-[color:var(--wb-muted)]">
          {t('library.suggestions.usage')}
        </p>
        {suggestion && suggestion.total > suggestion.scanned && (
          <p className="mt-1 text-xs text-[color:var(--wb-muted)]">
            {t('library.suggestions.coverage', {
              scanned: String(suggestion.scanned),
              total: String(suggestion.total),
            })}
          </p>
        )}
        <footer className="mt-5 flex justify-end gap-2">
          {!!undoable.length && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void undo()}
              className="studio-ghost-control rounded border border-[color:var(--wb-line)] px-3 py-2 text-xs"
            >
              {phase === 'undoing'
                ? t('library.suggestions.undoing')
                : error?.action === 'undo'
                  ? t('library.suggestions.retryUndo')
                  : t('library.suggestions.undo')}
            </button>
          )}
          {!undoStarted &&
            !uncertainGroup &&
            (phase === 'review' || phase === 'applying') &&
            groups.length > 0 && (
              <button
                type="button"
                disabled={busy || !pending.length}
                onClick={() => void apply()}
                className="studio-ghost-control rounded border border-[color:var(--wb-line)] px-3 py-2 text-xs"
              >
                {phase === 'applying'
                  ? t('library.suggestions.applying')
                  : error?.action === 'apply'
                    ? t('library.suggestions.retryApply')
                    : t('library.suggestions.apply')}
              </button>
            )}
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="studio-ghost-control rounded border border-[color:var(--wb-line)] px-3 py-2 text-xs"
          >
            {uncertainGroup
              ? t('library.suggestions.closeToReview')
              : t('library.suggestions.done')}
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
