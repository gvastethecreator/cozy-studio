import { useEffect, useRef, useState } from 'react';
import { useWorkspaceState } from '../../contexts/WorkspaceContext';
import { useT } from '../../lib/i18n';
import { resolveCatalogEntryThumbnailUrl } from '../../lib/studioCatalogImageAdapter';
import type { CatalogDuplicateScanResult } from '../../packages/shared/src/storageMaintenance';
import type { CatalogBatchCommandResult } from '../../packages/shared/src';
import { toStudioAssetUrl } from '../../services/studio-api/assetUrls';
import { archiveCatalogByFilter } from '../../services/studio-api/catalog';
import { findCatalogDuplicates } from '../../services/studio-api/maintenance';
import { ConfirmationModal } from '../ConfirmationModal';

export function SettingsDuplicatesPanel() {
  const { activeWorkspaceId, workspaces } = useWorkspaceState();
  const workspace = workspaces.find((entry) => entry.id === activeWorkspaceId);
  return (
    <WorkspaceDuplicatesPanel
      key={activeWorkspaceId}
      workspaceId={activeWorkspaceId}
      workspaceName={workspace?.name || activeWorkspaceId}
    />
  );
}

function WorkspaceDuplicatesPanel({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const { t, formatBytes, formatDate } = useT();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ready' | 'archiving'>('idle');
  const [result, setResult] = useState<CatalogDuplicateScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archiveResult, setArchiveResult] = useState<CatalogBatchCommandResult | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  const busy = phase === 'scanning' || phase === 'archiving';
  const keepOne =
    result?.groups.some((group) => group.images.every((image) => selected.has(image.id))) ?? false;
  const canArchive = phase === 'ready' && selected.size > 0 && !keepOne;

  async function scan(clearArchiveResult = true) {
    const id = ++requestId.current;
    setPhase('scanning');
    setResult(null);
    setSelected(new Set());
    setError('');
    if (clearArchiveResult) setArchiveResult(null);
    try {
      while (id === requestId.current) {
        const next = await findCatalogDuplicates({ workspaceId });
        if (id !== requestId.current) return;
        setResult(next);
        if (next.pending > 0) continue;
        setSelected(
          new Set(
            next.groups.flatMap((group) =>
              group.images
                .filter((image) => image.id !== group.keeperId && !image.isFavorite)
                .map((image) => image.id),
            ),
          ),
        );
        setPhase('ready');
        return;
      }
    } catch (cause) {
      if (id !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : t('settings.duplicates.scanError'));
      setPhase('idle');
    }
  }

  async function archiveSelected() {
    setConfirming(false);
    if (!canArchive) return;
    const id = ++requestId.current;
    setPhase('archiving');
    setError('');
    try {
      const archived = await archiveCatalogByFilter({ ids: [...selected], workspaceId });
      if (id !== requestId.current) return;
      setArchiveResult(archived);
      await scan(false);
    } catch (cause) {
      if (id !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : t('settings.duplicates.archiveError'));
      setPhase('ready');
    }
  }

  return (
    <section
      className="mt-4 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_4%,transparent)] p-4"
      aria-label={t('settings.duplicates.heading')}
    >
      <h3 className="text-sm font-semibold">{t('settings.duplicates.heading')}</h3>
      <p className="studio-muted text-sm">{t('settings.duplicates.hint')}</p>
      <button
        type="button"
        className="studio-ghost-control mt-3 px-3"
        disabled={busy}
        onClick={() => void scan()}
      >
        {t('settings.duplicates.scan', { workspace: workspaceName })}
      </button>
      <div role="status" aria-live="polite" className="studio-muted mt-2 text-sm">
        {phase === 'scanning' && !result && t('settings.duplicates.starting')}
        {result &&
          t('settings.duplicates.progress', { checked: result.checked, total: result.total })}
        {result && result.skipped > 0 && (
          <p>{t('settings.duplicates.skipped', { count: result.skipped })}</p>
        )}
        {phase === 'ready' && result?.groups.length === 0 && <p>{t('settings.duplicates.none')}</p>}
        {archiveResult && (
          <p>{t('settings.duplicates.archived', { count: archiveResult.changedCount })}</p>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[color:var(--wb-warning)]">
          {error}
        </p>
      )}
      {archiveResult && archiveResult.failed.length > 0 && (
        <div role="alert" className="mt-2 text-sm text-[color:var(--wb-warning)]">
          <p>{t('settings.duplicates.failed', { count: archiveResult.failed.length })}</p>
          <ul>
            {archiveResult.failed.map((failure) => (
              <li key={failure.id}>
                {failure.id}: {failure.message || t('settings.duplicates.archiveError')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && result.groups.length > 0 && (
        <div className="mt-3 grid gap-3">
          {result.groups.map((group, index) => (
            <fieldset
              key={group.keeperId}
              disabled={busy}
              className="min-w-0 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] p-3"
            >
              <legend className="px-1 text-sm">
                {t('settings.duplicates.group', { number: index + 1, count: group.images.length })}
              </legend>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {group.images.map((image) => (
                  <div key={image.id} className="w-36 shrink-0 text-xs">
                    <a
                      href={toStudioAssetUrl(image.publicUrl)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('settings.duplicates.openImage', { id: image.id })}
                    >
                      <img
                        src={resolveCatalogEntryThumbnailUrl(image)}
                        loading="lazy"
                        alt=""
                        className="h-28 w-full rounded object-contain bg-[color:var(--wb-well)]"
                      />
                    </a>
                    <label className="mt-2 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(image.id)}
                        aria-label={t('settings.duplicates.select', { id: image.id })}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(image.id);
                            else next.delete(image.id);
                            return next;
                          })
                        }
                      />
                      {selected.has(image.id)
                        ? t('settings.duplicates.archive')
                        : t('settings.duplicates.kept')}
                    </label>
                    {image.isFavorite && <p>{t('settings.duplicates.favorite')}</p>}
                    <p className="mt-1">{formatDate(image.createdAt)}</p>
                    <p>
                      {image.width && image.height
                        ? `${image.width} × ${image.height}`
                        : t('settings.duplicates.unknownDimensions')}
                    </p>
                    <p>
                      {image.fileSizeBytes === null
                        ? t('settings.duplicates.unknownSize')
                        : formatBytes(image.fileSizeBytes)}
                    </p>
                    <p className="break-words">
                      {t('settings.duplicates.workflow', {
                        name: image.recipeId || t('settings.general.defaultWorkflow'),
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          {keepOne && (
            <p role="alert" className="text-sm text-[color:var(--wb-warning)]">
              {t('settings.duplicates.keepOne')}
            </p>
          )}
          <button
            type="button"
            className="studio-ghost-control justify-self-start px-3"
            disabled={!canArchive}
            onClick={() => setConfirming(true)}
          >
            {phase === 'archiving'
              ? t('settings.duplicates.archiving')
              : t('settings.duplicates.move', { count: selected.size })}
          </button>
        </div>
      )}
      <ConfirmationModal
        isOpen={confirming}
        title={t('settings.duplicates.move', { count: selected.size })}
        description={t('settings.duplicates.confirm')}
        confirmLabel={t('settings.duplicates.move', { count: selected.size })}
        cancelLabel={t('settings.duplicates.cancel')}
        tone="warning"
        onClose={() => setConfirming(false)}
        onConfirm={archiveSelected}
      />
    </section>
  );
}
