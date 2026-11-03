import { CozyLoader as LoaderCircle } from '../CozyMascot';
import { Database, MediaImage as FileImage, Refresh as RefreshCw } from 'iconoir-react';
import { useMemo, useState } from 'react';
import { ConfirmationModal } from '../ConfirmationModal';
import type {
  StorageMaintenanceAuditReport,
  StorageMaintenanceCompactResult,
  StorageMaintenanceThumbnailBackfillResult,
  ToolingLogsPruneResult,
} from '../../packages/shared/src/storageMaintenance';
import { createStorageRepairPlanFromAudit } from '../../packages/shared/src/storageMaintenance';
import { useT } from '../../lib/i18n';
import type { MessageKey } from '../../lib/i18n/en';

const MAINTENANCE_MODE_LABELS = {
  'dry-run': 'settings.maintenance.modePreview',
  write: 'settings.maintenance.modeWrite',
} as const satisfies Record<StorageMaintenanceCompactResult['mode'], MessageKey>;

export interface SettingsMaintenancePanelProps {
  maintenance: {
    audit: StorageMaintenanceAuditReport | null;
    compactResult: StorageMaintenanceCompactResult | null;
    thumbnailBackfillResult: StorageMaintenanceThumbnailBackfillResult | null;
    toolingLogsPruneResult: ToolingLogsPruneResult | null;
    isLoadingAudit: boolean;
    runningAction: 'compact' | 'thumbnails' | 'tooling-logs' | null;
    refreshAudit: () => void | Promise<void>;
    compactStorage: (input?: {
      write?: boolean;
      vacuum?: boolean;
      confirm?: string | null;
    }) => void | Promise<void>;
    backfillThumbnails: (input?: {
      write?: boolean;
      confirm?: string | null;
      limit?: number;
    }) => void | Promise<void>;
    pruneToolingLogs: (input?: { retainPerTask?: number }) => void | Promise<void>;
  };
}

function getCompactOmittedBytes(result: StorageMaintenanceCompactResult | null) {
  return result?.results.reduce((total, item) => total + item.omittedBytes, 0) ?? 0;
}

function getCompactChangedRows(result: StorageMaintenanceCompactResult | null) {
  return result?.results.reduce((total, item) => total + item.changedRows, 0) ?? 0;
}

function RepairPlanDetails({
  repairPlan,
}: {
  repairPlan: ReturnType<typeof createStorageRepairPlanFromAudit> | null;
}) {
  const { t, formatBytes } = useT();
  if (!repairPlan) return null;
  return (
    <div className="mt-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
          {t('settings.maintenance.repairPlan')}
        </div>
        <div className="font-mono text-[length:var(--wbp-label)] font-bold text-[color:var(--wb-muted)]">
          {t('settings.maintenance.planSummary', {
            count: String(repairPlan.summary.itemCount),
            bytes: formatBytes(repairPlan.summary.totalBytes),
          })}
        </div>
      </div>
      {repairPlan.items.length > 0 ? (
        <div className="grid gap-2">
          {repairPlan.items.map((item) => (
            <div
              key={item.id}
              className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_3%,transparent)] px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)]">
                  {item.title}
                </span>
                <span
                  className={`text-[length:var(--wbp-label)] font-semibold tracking-normal ${
                    item.severity === 'warning'
                      ? 'text-[color:var(--wb-warning)] '
                      : 'text-[color:var(--wb-muted)]'
                  }`}
                >
                  {item.severity}
                </span>
              </div>
              <p className="mt-1 text-[length:var(--wbp-label)] leading-relaxed text-[color:var(--wb-muted)]">
                {item.detail}
              </p>
              <div className="mt-2 truncate font-mono text-[length:var(--wbp-label)] text-[color:var(--wb-dim)]">
                {item.command}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[length:var(--wbp-label)] font-bold tracking-normal text-[color:var(--wb-dim)]">
          {t('settings.maintenance.noRepairs')}
        </div>
      )}
    </div>
  );
}

function MaintenanceResults({
  compactResult,
  thumbnailBackfillResult,
  toolingLogsPruneResult,
}: Pick<
  SettingsMaintenancePanelProps['maintenance'],
  'compactResult' | 'thumbnailBackfillResult' | 'toolingLogsPruneResult'
>) {
  const { t, formatBytes } = useT();
  const compactRows = getCompactChangedRows(compactResult);
  const compactBytes = getCompactOmittedBytes(compactResult);
  return (
    <>
      {(compactResult || thumbnailBackfillResult || toolingLogsPruneResult) && (
        <div className="mt-3 grid gap-2 text-[length:var(--wbp-label)] font-bold tracking-normal text-[color:var(--wb-muted)] md:grid-cols-3">
          {compactResult ? (
            <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
              <span className="text-[color:var(--wb-ink)]">
                {t('settings.maintenance.compactResult', {
                  mode: t(MAINTENANCE_MODE_LABELS[compactResult.mode]),
                })}
              </span>
              <div className="mt-1 font-mono text-[color:var(--wb-muted)]">
                {t('settings.maintenance.compactSummary', {
                  count: String(compactRows),
                  bytes: formatBytes(compactBytes),
                })}
              </div>
            </div>
          ) : null}
          {thumbnailBackfillResult ? (
            <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
              <span className="text-[color:var(--wb-ink)]">
                {t('settings.maintenance.thumbnailResult', {
                  mode: t(MAINTENANCE_MODE_LABELS[thumbnailBackfillResult.mode]),
                })}
              </span>
              <div className="mt-1 font-mono text-[color:var(--wb-muted)]">
                {t('settings.maintenance.thumbnailSummary', {
                  wrote: String(thumbnailBackfillResult.wroteRows),
                  planned: String(thumbnailBackfillResult.plannedRows),
                  missing: String(thumbnailBackfillResult.missingSourceFiles),
                })}
              </div>
            </div>
          ) : null}
          {toolingLogsPruneResult ? (
            <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
              <span className="text-[color:var(--wb-ink)]">
                {t('settings.maintenance.logsPruned')}
              </span>
              <div className="mt-1 font-mono text-[color:var(--wb-muted)]">
                {t('settings.maintenance.logsSummary', {
                  count: String(toolingLogsPruneResult.pruned),
                  retain: String(toolingLogsPruneResult.retainPerTask),
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

export function SettingsMaintenancePanel({ maintenance }: SettingsMaintenancePanelProps) {
  const { t, formatBytes } = useT();
  const {
    audit,
    compactResult,
    thumbnailBackfillResult,
    toolingLogsPruneResult,
    isLoadingAudit,
    runningAction,
    refreshAudit,
    compactStorage,
    backfillThumbnails,
    pruneToolingLogs,
  } = maintenance;
  const isCompactRunning = runningAction === 'compact';
  const isThumbnailRunning = runningAction === 'thumbnails';
  const isPruneRunning = runningAction === 'tooling-logs';
  const inlineBytes =
    audit?.payloadFields.reduce((total, field) => total + field.inlineBytes, 0) ?? 0;
  const compactRows = getCompactChangedRows(compactResult);
  const compactBytes = getCompactOmittedBytes(compactResult);
  const repairPlan = useMemo(
    () => (audit ? createStorageRepairPlanFromAudit(audit) : null),
    [audit],
  );

  const [confirmation, setConfirmation] = useState<{ message: string; action: () => void } | null>(
    null,
  );
  const handleWriteCompact = () =>
    setConfirmation({
      message: t('settings.maintenance.confirmCompact', {
        count: String(compactRows),
        bytes: formatBytes(compactBytes),
      }),
      action: () => {
        void compactStorage({ write: true, confirm: 'compact-inline-payloads' });
      },
    });
  const handleWriteThumbnails = () =>
    setConfirmation({
      message: t('settings.maintenance.confirmThumbnails', {
        count: String(thumbnailBackfillResult?.plannedRows ?? 0),
      }),
      action: () => {
        void backfillThumbnails({ write: true, confirm: 'backfill-thumbnails', limit: 1000 });
      },
    });

  return (
    <div className="mt-4 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_4%,transparent)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)]">
            {t('settings.maintenance.heading')}
          </h3>
          <p className="mt-1 text-[length:var(--wbp-label)] font-bold tracking-normal text-[color:var(--wb-dim)]">
            {t('settings.maintenance.hint')}
          </p>
        </div>
        <button
          type="button"
          aria-label={t('settings.maintenance.audit')}
          onClick={() => void refreshAudit()}
          disabled={isLoadingAudit}
          className="flex h-9 items-center gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] disabled:opacity-40"
        >
          {isLoadingAudit ? (
            <LoaderCircle size={13} className="animate-spin" />
          ) : (
            <RefreshCw width={13} height={13} />
          )}
          {t('settings.maintenance.audit')}
        </button>
      </div>

      {audit ? (
        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
            <div className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
              {t('settings.maintenance.sqlite')}
            </div>
            <div className="mt-1 font-mono text-xs font-bold text-[color:var(--wb-ink)]">
              {audit.database.formattedBytes}
            </div>
          </div>
          <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
            <div className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
              {t('settings.maintenance.inlineData')}
            </div>
            <div className="mt-1 font-mono text-xs font-bold text-[color:var(--wb-ink)]">
              {formatBytes(inlineBytes)}
            </div>
          </div>
          <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
            <div className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
              {t('settings.maintenance.missingThumbnails')}
            </div>
            <div className="mt-1 font-mono text-xs font-bold text-[color:var(--wb-ink)]">
              {audit.catalog.missingThumbnails}
            </div>
          </div>
          <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
            <div className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
              {t('settings.maintenance.diagnosticLogs')}
            </div>
            <div className="mt-1 font-mono text-xs font-bold text-[color:var(--wb-ink)]">
              {audit.directories.toolingLogs?.formattedBytes ?? '0 B'}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3 text-[length:var(--wbp-label)] font-bold tracking-normal text-[color:var(--wb-dim)]">
          {t('settings.maintenance.empty')}
        </div>
      )}

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
          <div className="mb-3 flex items-center gap-2 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)]">
            <Database width={14} height={14} className="text-[color:var(--wb-muted)]" />
            {t('settings.maintenance.databaseCleanup')}
          </div>
          <p className="mb-3 text-xs text-[color:var(--wb-muted)]">
            {t('settings.maintenance.databaseHint')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label={t('settings.maintenance.planCleanup')}
              onClick={() => void compactStorage()}
              disabled={isCompactRunning}
              className="flex h-8 items-center gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] disabled:opacity-40"
            >
              {isCompactRunning ? <LoaderCircle size={13} className="animate-spin" /> : null}
              {t('settings.maintenance.previewCleanup')}
            </button>
            <button
              type="button"
              onClick={handleWriteCompact}
              disabled={isCompactRunning || compactResult?.mode !== 'dry-run' || compactRows === 0}
              className="h-8 rounded-[var(--wb-radius)] border border-amber-400/2 bg-amber-500/10 px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-warning)]  transition-colors hover:bg-amber-500/15 disabled:opacity-40"
            >
              {t('settings.maintenance.applyPlan')}
            </button>
          </div>
        </div>

        <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
          <div className="mb-3 flex items-center gap-2 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)]">
            <FileImage width={14} height={14} className="text-[color:var(--wb-muted)]" />
            {t('settings.maintenance.thumbnails')}
          </div>
          <p className="mb-3 text-xs text-[color:var(--wb-muted)]">
            {t('settings.maintenance.thumbnailsHint')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label={t('settings.maintenance.planThumbnails')}
              onClick={() => void backfillThumbnails({ limit: 1000 })}
              disabled={isThumbnailRunning}
              className="flex h-8 items-center gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] disabled:opacity-40"
            >
              {isThumbnailRunning ? <LoaderCircle size={13} className="animate-spin" /> : null}
              {t('settings.maintenance.previewRepair')}
            </button>
            <button
              type="button"
              onClick={handleWriteThumbnails}
              disabled={
                isThumbnailRunning ||
                thumbnailBackfillResult?.mode !== 'dry-run' ||
                thumbnailBackfillResult.plannedRows === 0
              }
              className="h-8 rounded-[var(--wb-radius)] border border-emerald-400/2 bg-emerald-500/10 px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-success)]  transition-colors hover:bg-emerald-500/15 disabled:opacity-40"
            >
              {t('settings.maintenance.applyPlan')}
            </button>
          </div>
        </div>

        <div className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-well)] p-3">
          <div className="mb-3 flex items-center gap-2 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)]">
            <RefreshCw width={14} height={14} className="text-[color:var(--wb-muted)]" />
            {t('settings.maintenance.diagnosticLogs')}
          </div>
          <button
            type="button"
            onClick={() =>
              setConfirmation({
                message: t('settings.maintenance.confirmLogs'),
                action: () => {
                  void pruneToolingLogs({ retainPerTask: 20 });
                },
              })
            }
            aria-label={t('settings.maintenance.pruneLogs')}
            disabled={isPruneRunning}
            className="flex h-8 items-center gap-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] px-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] disabled:opacity-40"
          >
            {isPruneRunning ? <LoaderCircle size={13} className="animate-spin" /> : null}
            {t('settings.maintenance.removeOldLogs')}
          </button>
        </div>
      </div>

      <RepairPlanDetails repairPlan={repairPlan} />

      <MaintenanceResults
        compactResult={compactResult}
        thumbnailBackfillResult={thumbnailBackfillResult}
        toolingLogsPruneResult={toolingLogsPruneResult}
      />
      <ConfirmationModal
        isOpen={Boolean(confirmation)}
        title={t('settings.maintenance.confirmTitle')}
        description={confirmation?.message ?? ''}
        confirmLabel={t('settings.maintenance.continue')}
        cancelLabel={t('settings.maintenance.cancel')}
        tone="warning"
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          confirmation?.action();
          setConfirmation(null);
        }}
      />
    </div>
  );
}
