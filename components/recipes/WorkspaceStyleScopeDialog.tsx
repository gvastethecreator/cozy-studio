import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavArrowDown, NavArrowRight } from 'iconoir-react';

import type { StylePackSummary } from '../../packages/shared/src/extensions';
import type { WorkspaceStyleRef } from '../../packages/shared/src/workspaceContracts';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useT } from '../../lib/i18n';
import { loadStylePresetCatalogSearchIndex } from './stylePresetCatalogSearchData';
import {
  isStylePackLinked,
  findProjectStylePacks,
  setStyleCategoryLinked,
  setStylePackLinked,
} from './workspaceStyleScope';

type CategoryLoad =
  | { status: 'loading' }
  | { status: 'ready'; categories: string[] }
  | { status: 'error' };

function usePackCategories(packId: string, open: boolean) {
  const [load, setLoad] = useState<CategoryLoad>({ status: 'loading' });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    loadStylePresetCatalogSearchIndex([packId]).then(
      (index) => {
        if (cancelled) return;
        const categories = [...new Set(index.presets.map((preset) => preset.categoryName))];
        setLoad({ status: 'ready', categories });
      },
      () => {
        if (!cancelled) setLoad({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, packId]);
  return load;
}

function PackRow({
  pack,
  scope,
  suggested,
  initiallyOpen,
  onChange,
}: {
  pack: StylePackSummary;
  scope: WorkspaceStyleRef[];
  suggested: boolean;
  initiallyOpen: boolean;
  onChange: (scope: WorkspaceStyleRef[]) => void;
}) {
  const { t } = useT();
  const hasCategoryLinks = scope.some((ref) => ref.packId === pack.id && ref.category);
  const [open, setOpen] = useState(initiallyOpen || hasCategoryLinks);
  const load = usePackCategories(pack.id, open);
  const wholePack = isStylePackLinked(scope, pack.id);
  const linkedCategories = new Set(
    scope.flatMap((ref) => (ref.packId === pack.id && ref.category ? [ref.category] : [])),
  );
  const presetLinks = scope.filter((ref) => ref.packId === pack.id && ref.presetId).length;
  const title = pack.cardTitle ?? pack.name;
  return (
    <li className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)]">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="studio-ghost-control flex size-6 shrink-0 items-center justify-center rounded-[var(--wb-radius)]"
          aria-expanded={open}
          aria-label={t('projectStyles.showCategories', { pack: title })}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <NavArrowDown width={13} height={13} />
          ) : (
            <NavArrowRight width={13} height={13} />
          )}
        </button>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={wholePack}
            ref={(input) => {
              if (input) input.indeterminate = !wholePack && linkedCategories.size > 0;
            }}
            onChange={(event) => onChange(setStylePackLinked(scope, pack.id, event.target.checked))}
          />
          <span className="min-w-0 truncate font-semibold text-[color:var(--wb-ink)]">{title}</span>
          {suggested ? (
            <span className="shrink-0 rounded-full border border-[color:var(--wb-line)] px-1.5 text-[length:var(--wbp-label)] text-[color:var(--wb-muted)]">
              {t('projectStyles.suggested')}
            </span>
          ) : null}
        </label>
        <span className="shrink-0 text-[length:var(--wbp-label)] text-[color:var(--wb-muted)]">
          {presetLinks > 0
            ? t('projectStyles.presetLinks', { count: String(presetLinks) })
            : pack.presetCount}
        </span>
      </div>
      {open ? (
        <div className="border-t border-[color:var(--wb-line)] px-3 py-2">
          {load.status === 'loading' ? (
            <p className="text-xs text-[color:var(--wb-muted)]">
              {t('projectStyles.loadingCategories')}
            </p>
          ) : load.status === 'error' ? (
            <p className="text-xs text-[color:var(--wb-muted)]">
              {t('projectStyles.categoriesError')}
            </p>
          ) : (
            <ul className="grid gap-1">
              {load.categories.map((category) => (
                <li key={category}>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-[color:var(--wb-ink)]">
                    <input
                      type="checkbox"
                      checked={wholePack || linkedCategories.has(category)}
                      onChange={(event) =>
                        onChange(
                          setStyleCategoryLinked(
                            scope,
                            pack.id,
                            load.categories,
                            category,
                            event.target.checked,
                          ),
                        )
                      }
                    />
                    <span className="min-w-0 truncate">{category}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Lets the user link packs and categories to one workspace. Saving changes no draft. */
export function WorkspaceStyleScopeDialog({
  workspaceName,
  scope,
  packs,
  suggestedPackIds,
  onSave,
  onClose,
}: {
  workspaceName: string;
  scope: WorkspaceStyleRef[];
  packs: readonly StylePackSummary[];
  suggestedPackIds: readonly string[];
  onSave: (scope: WorkspaceStyleRef[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const dialogRef = useDialogFocus(true, onClose);
  const [draft, setDraft] = useState<WorkspaceStyleRef[]>(scope);
  const installedIds = useMemo(() => new Set(packs.map((pack) => pack.id)), [packs]);
  const projectPacks = useMemo(() => {
    const suggested = new Set(suggestedPackIds);
    return [...findProjectStylePacks(packs)].sort(
      (a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)),
    );
  }, [packs, suggestedPackIds]);
  const otherPacks = useMemo(() => packs.filter((pack) => !pack.project?.name.trim()), [packs]);
  const missingPackIds = [
    ...new Set(draft.map((ref) => ref.packId).filter((id) => !installedIds.has(id))),
  ];
  const renderPacks = (list: readonly StylePackSummary[]) => (
    <ul className="grid gap-1.5">
      {list.map((pack) => (
        <PackRow
          key={pack.id}
          pack={pack}
          scope={draft}
          suggested={suggestedPackIds.includes(pack.id)}
          initiallyOpen={suggestedPackIds.includes(pack.id)}
          onChange={setDraft}
        />
      ))}
    </ul>
  );

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={t('projectStyles.dialogTitle', { workspace: workspaceName })}
      data-workspace-style-scope-dialog
      className="studio-modal fixed inset-0 z-110 flex items-center justify-center p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="studio-scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="studio-dialog relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden">
        <header className="flex items-start justify-between gap-3 border-b border-[color:var(--wb-line)] p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {t('projectStyles.dialogTitle', { workspace: workspaceName })}
            </h2>
            <p className="mt-1 text-xs text-[color:var(--wb-muted)]">
              {t('projectStyles.dialogHint')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('projectStyles.cancel')}
            className="studio-ghost-control rounded px-2 py-1"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {missingPackIds.map((packId) => (
            <p key={packId} className="text-xs text-[color:var(--wb-warning)]">
              {t('projectStyles.missingPack', { pack: packId })}
            </p>
          ))}
          {projectPacks.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-[color:var(--wb-muted)]">
                {t('projectStyles.projectPacks')}
              </h3>
              {renderPacks(projectPacks)}
            </section>
          ) : null}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-[color:var(--wb-muted)]">
              {t('projectStyles.otherPacks')}
            </h3>
            {renderPacks(otherPacks)}
          </section>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-[color:var(--wb-line)] p-4">
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2 text-xs"
            disabled={draft.length === 0}
            onClick={() => setDraft([])}
          >
            {t('projectStyles.clear')}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="studio-ghost-control rounded border border-[color:var(--wb-line)] px-3 py-2 text-xs"
              onClick={onClose}
            >
              {t('projectStyles.cancel')}
            </button>
            <button
              type="button"
              className="studio-primary-control rounded px-3 py-2 text-xs"
              data-workspace-style-scope-save
              onClick={() => {
                onSave(draft);
                onClose();
              }}
            >
              {t('projectStyles.save')}
            </button>
          </div>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
