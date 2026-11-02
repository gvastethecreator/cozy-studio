import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useT } from '../lib/i18n';
import {
  parseCatalogSmartRule,
  type CatalogCollection,
  type CatalogFacets,
  type CatalogSmartRule,
} from '../packages/shared/src';
import {
  createCatalogCollection,
  getCatalogFacets,
  notifyCatalogOrganizationChanged,
  updateCatalogCollection,
} from '../services/studio-api/catalog';
import { CollectionEmojiPicker } from './OrganizationAppearancePicker';

function localDate(iso: string | undefined, exclusive = false) {
  if (!iso) return '';
  const date = new Date(iso);
  if (exclusive) date.setTime(date.getTime() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateBoundary(value: string, exclusive = false) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day + (exclusive ? 1 : 0)).toISOString();
}

export function SmartCollectionDialog({
  workspaceId,
  collection,
  query = '',
  favorites = false,
  unorganized = false,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  collection?: CatalogCollection;
  query?: string;
  favorites?: boolean;
  unorganized?: boolean;
  onClose: () => void;
  onSaved: (collection: CatalogCollection) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(collection?.name ?? '');
  const [emoji, setEmoji] = useState(collection?.emoji ?? null);
  const [rule, setRule] = useState<CatalogSmartRule>(
    () =>
      collection?.rule ?? {
        ...(query ? { q: query } : {}),
        ...(favorites ? { favorite: true } : {}),
        ...(unorganized ? { unorganized: true } : {}),
      },
  );
  const [dateMode, setDateMode] = useState(() =>
    rule.createdFrom || rule.createdTo ? 'range' : rule.withinDays ? String(rule.withinDays) : '',
  );
  const [facets, setFacets] = useState<CatalogFacets>({ providers: [], recipes: [], styles: [] });
  const [facetsLoading, setFacetsLoading] = useState(true);
  const [facetsError, setFacetsError] = useState('');
  const [facetRevision, setFacetRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  const dialogRef = useDialogFocus(true, close, undefined, 'input');
  useEffect(() => {
    let cancelled = false;
    setFacetsLoading(true);
    setFacetsError('');
    void getCatalogFacets(workspaceId)
      .then(
        (result) => {
          if (!cancelled) setFacets(result);
        },
        (cause: unknown) => {
          if (!cancelled)
            setFacetsError(
              cause instanceof Error ? cause.message : t('smartCollection.facetsError'),
            );
        },
      )
      .finally(() => {
        if (!cancelled) setFacetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, facetRevision, t]);
  const setFilter = <K extends keyof CatalogSmartRule>(key: K, value: CatalogSmartRule[K]) => {
    setRule((current) => {
      const next = { ...current };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  };
  const title = t(collection ? 'smartCollection.edit' : 'smartCollection.new');
  const selectClass = 'studio-well mt-1 w-full px-2 py-2';
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={title}
      className="studio-modal fixed inset-0 z-110 flex items-center justify-center p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="studio-scrim absolute inset-0" onClick={close} aria-hidden="true" />
      <form
        className="studio-dialog relative max-h-[85vh] w-full max-w-lg overflow-y-auto p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !name.trim()) return;
          setBusy(true);
          setError('');
          void (async () => {
            try {
              const parsed = parseCatalogSmartRule(rule);
              const saved = collection
                ? await updateCatalogCollection(collection.id, { name, emoji, rule: parsed })
                : await createCatalogCollection({ workspaceId, name, emoji, rule: parsed });
              notifyCatalogOrganizationChanged();
              onSaved(saved);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : t('smartCollection.saveError'));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            aria-label={t('smartCollection.close')}
            className="studio-ghost-control px-2 py-1"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        </header>
        <p className="mb-4 text-xs text-[color:var(--wb-muted)]">{t('smartCollection.hint')}</p>
        <fieldset disabled={busy} className="space-y-4 text-xs">
          <label className="block">
            {t('smartCollection.name')}
            <input
              required
              className={selectClass}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <CollectionEmojiPicker value={emoji} onChange={setEmoji} />
          <label className="block">
            {t('smartCollection.search')}
            <input
              type="search"
              className={selectClass}
              maxLength={2000}
              value={rule.q ?? ''}
              onChange={(event) => setFilter('q', event.target.value)}
            />
          </label>
          <label className="block">
            {t('smartCollection.favorites')}
            <select
              className={selectClass}
              value={rule.favorite === undefined ? '' : String(rule.favorite)}
              onChange={(event) =>
                setFilter(
                  'favorite',
                  event.target.value === '' ? undefined : event.target.value === 'true',
                )
              }
            >
              <option value="">{t('smartCollection.any')}</option>
              <option value="true">{t('smartCollection.favoritesOnly')}</option>
              <option value="false">{t('smartCollection.notFavorites')}</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rule.unorganized === true}
              onChange={(event) =>
                setFilter('unorganized', event.target.checked ? true : undefined)
              }
            />
            {t('smartCollection.unorganizedOnly')}
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label>
              {t('smartCollection.provider')}
              <select
                className={selectClass}
                disabled={facetsLoading}
                value={rule.providerId ?? ''}
                onChange={(event) => setFilter('providerId', event.target.value)}
              >
                <option value="">{t('smartCollection.any')}</option>
                {rule.providerId &&
                  !facets.providers.some((item) => item.id === rule.providerId) && (
                    <option value={rule.providerId}>{rule.providerId}</option>
                  )}
                {facets.providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} ({item.count})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('smartCollection.recipe')}
              <select
                className={selectClass}
                disabled={facetsLoading}
                value={rule.recipeId ?? ''}
                onChange={(event) => setFilter('recipeId', event.target.value)}
              >
                <option value="">{t('smartCollection.any')}</option>
                {rule.recipeId && !facets.recipes.some((item) => item.id === rule.recipeId) && (
                  <option value={rule.recipeId}>{rule.recipeId}</option>
                )}
                {facets.recipes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} ({item.count})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('smartCollection.style')}
              <select
                className={selectClass}
                disabled={facetsLoading}
                value={rule.stylePresetId ?? ''}
                onChange={(event) => setFilter('stylePresetId', event.target.value)}
              >
                <option value="">{t('smartCollection.any')}</option>
                {rule.stylePresetId &&
                  !facets.styles.some((item) => item.presetId === rule.stylePresetId) && (
                    <option value={rule.stylePresetId}>{rule.stylePresetId}</option>
                  )}
                {facets.styles.map((item) => (
                  <option key={item.presetId} value={item.presetId}>
                    {item.name} ({item.count})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {facetsError && (
            <p role="alert">
              {facetsError}{' '}
              <button type="button" onClick={() => setFacetRevision((value) => value + 1)}>
                {t('smartCollection.retry')}
              </button>
            </p>
          )}
          <label className="block">
            {t('smartCollection.date')}
            <select
              className={selectClass}
              value={dateMode}
              onChange={(event) => {
                const mode = event.target.value;
                setDateMode(mode);
                setRule((current) => {
                  const next = { ...current };
                  delete next.withinDays;
                  delete next.createdFrom;
                  delete next.createdTo;
                  if (mode && mode !== 'range') next.withinDays = Number(mode);
                  return next;
                });
              }}
            >
              <option value="">{t('smartCollection.anyTime')}</option>
              <option value="7">{t('smartCollection.lastDays', { count: 7 })}</option>
              <option value="30">{t('smartCollection.lastDays', { count: 30 })}</option>
              {rule.withinDays && ![7, 30].includes(rule.withinDays) && (
                <option value={String(rule.withinDays)}>
                  {t('smartCollection.lastDays', { count: rule.withinDays })}
                </option>
              )}
              <option value="range">{t('smartCollection.customRange')}</option>
            </select>
          </label>
          {dateMode === 'range' && (
            <div className="grid grid-cols-2 gap-3">
              <label>
                {t('smartCollection.from')}
                <input
                  type="date"
                  className={selectClass}
                  value={localDate(rule.createdFrom)}
                  onChange={(event) => setFilter('createdFrom', dateBoundary(event.target.value))}
                />
              </label>
              <label>
                {t('smartCollection.through')}
                <input
                  type="date"
                  className={selectClass}
                  value={localDate(rule.createdTo, true)}
                  onChange={(event) =>
                    setFilter('createdTo', dateBoundary(event.target.value, true))
                  }
                />
              </label>
            </div>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="mt-4 text-xs">
            {error}
          </p>
        )}
        <footer className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            className="studio-ghost-control px-3 py-2"
            disabled={busy}
            onClick={close}
          >
            {t('smartCollection.cancel')}
          </button>
          <button
            type="submit"
            className="studio-primary-control px-3 py-2"
            disabled={busy || !name.trim()}
          >
            {t(busy ? 'smartCollection.saving' : 'smartCollection.save')}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
