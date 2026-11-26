import { useEffect, useRef, type ReactNode } from 'react';
import { Xmark as X } from 'iconoir-react';

import type { StudioCommandCenterProjection } from '../../lib/commandCenterProjection';
import type { StudioRuntimeStatusItem, StudioUsageSummary } from '../../lib/studioDiagnostics';
import { formatDateTime } from '../../lib/i18n';
import { providerRuntimeStatusDotClass } from '../../lib/providerBrand';
import { cn } from '../../lib/utils';
import { useWorkerDiagnostics } from '../../hooks/useWorkerDiagnostics';
import { ProviderBrandMark } from '../ProviderBrandMark';

/** What the status button reports beyond the provider pills. */
export interface RuntimeStatusDetails {
  statusItems: StudioRuntimeStatusItem[];
  /** Running jobs with no update for 30 minutes. */
  stuckJobCount: number;
  lastJobError: { message: string; at: string } | null;
}

const ROW = 'flex items-start justify-between gap-3 py-1.5';
const BUTTON =
  'min-h-8 rounded-[var(--wb-radius)] border border-[color:var(--wb-border)] px-2.5 text-xs text-[color:var(--wb-ink)] hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)]';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[color:var(--wb-line)] pt-2">
      <h4 className="text-[length:var(--wbp-label)] font-semibold text-[color:var(--wb-muted)]">
        {title}
      </h4>
      {children}
    </section>
  );
}

function usageLine(usage: StudioUsageSummary | undefined) {
  if (!usage) return null;
  if (usage.usageCopy?.line) return usage.usageCopy.line;
  if (usage.tone === 'offline') return usage.tooltip;
  const limits = usage.limits.map(
    (limit) =>
      `${limit.label}: ${Math.round(limit.availablePercent)}% left${limit.resetLabel ? `, ${limit.resetLabel}` : ''}`,
  );
  return limits.length ? limits.join(' · ') : usage.tooltip;
}

/**
 * The status button's panel: server, each provider, usage and credits, jobs that need attention and
 * the last error. The welcome steps stay in the setup guide.
 */
export function RuntimeStatusPanel({
  commandCenter,
  providerUsage,
  details,
  onClose,
  onOpenSettings,
  onOpenSetupGuide,
  onOpenJobs,
}: {
  commandCenter: StudioCommandCenterProjection;
  providerUsage: Partial<Record<'codex' | 'chatgpt' | 'antigravity', StudioUsageSummary>>;
  details: RuntimeStatusDetails;
  onClose: () => void;
  onOpenSettings?: () => void;
  onOpenSetupGuide: () => void;
  onOpenJobs: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const worker = useWorkerDiagnostics();
  const backend = details.statusItems.find((item) => item.key === 'backend');
  const serverUp = backend?.tone === 'success';
  const { activeCount, reviewCount } = commandCenter.queue;
  const pauses = Object.values(worker.status?.pausedProviders ?? {});
  const usages = (['chatgpt', 'codex', 'antigravity'] as const).flatMap((id) => {
    const line = usageLine(providerUsage[id]);
    const label = id === 'chatgpt' ? 'ChatGPT' : id === 'codex' ? 'Codex' : 'Antigravity';
    return line ? [{ id, line, label }] : [];
  });

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Studio status"
      tabIndex={-1}
      className="absolute right-0 bottom-9 z-[100] flex max-h-[min(70vh,560px)] w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto rounded-[var(--wb-radius)] border border-[color:var(--wb-border)] bg-[color:var(--wb-panel)] p-3 text-xs text-[color:var(--wb-ink)] shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Studio status</h3>
        <button
          type="button"
          aria-label="Close status"
          onClick={onClose}
          className="studio-hit-target rounded-[var(--wb-radius)] p-1 text-[color:var(--wb-muted)] hover:text-[color:var(--wb-ink)]"
        >
          <X width={16} height={16} />
        </button>
      </div>

      <Section title="Server">
        <div className={ROW}>
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                serverUp ? 'bg-emerald-400' : backend ? 'bg-rose-400' : 'bg-amber-400',
              )}
            />
            Local server
          </span>
          <span
            className={
              serverUp ? 'text-[color:var(--wb-success)]' : 'text-[color:var(--wb-danger)]'
            }
          >
            {backend?.value ?? 'Checking'}
          </span>
        </div>
        {backend && !serverUp ? (
          <p className="text-[color:var(--wb-muted)]">{backend.detail}</p>
        ) : null}
      </Section>

      <Section title="Providers">
        <ul className="m-0 list-none p-0">
          {commandCenter.providerOptions.map((provider) => (
            <li key={provider.id} className={ROW} data-tooltip={provider.tooltip}>
              <span className="flex min-w-0 items-center gap-2">
                <ProviderBrandMark providerId={provider.id} size="xs" />
                <span className="truncate">
                  {provider.label}
                  {provider.id === commandCenter.provider.id ? (
                    <small className="ml-1 text-[color:var(--wb-muted)]">Default</small>
                  ) : null}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[color:var(--wb-muted)]">
                {provider.statusDetail}
                <span
                  aria-hidden="true"
                  className={cn('size-2 rounded-full', providerRuntimeStatusDotClass(provider))}
                />
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {usages.length ? (
        <Section title="Usage and credits">
          {usages.map((usage) => (
            <p key={usage.id} className="py-1">
              <strong className="font-semibold">{usage.label}:</strong> {usage.line}
            </p>
          ))}
        </Section>
      ) : null}

      <Section title="Jobs">
        <div className={ROW}>
          <span>
            {activeCount} active · {reviewCount} need review
          </span>
          <button type="button" onClick={onOpenJobs} className="underline">
            Open jobs
          </button>
        </div>
        {details.stuckJobCount > 0 ? (
          <p className="py-1 text-[color:var(--wb-warning)]">
            {details.stuckJobCount === 1
              ? '1 running job has had no update for 30 minutes.'
              : `${details.stuckJobCount} running jobs have had no update for 30 minutes.`}
          </p>
        ) : null}
        {pauses.map((pause) => (
          <p key={pause.message} className="py-1 text-[color:var(--wb-warning)]">
            {pause.message}
          </p>
        ))}
      </Section>

      {details.lastJobError ? (
        <Section title="Last error">
          <p className="line-clamp-3 py-1 text-[color:var(--wb-danger)]">
            {details.lastJobError.message}
          </p>
          <p className="text-[color:var(--wb-muted)]">{formatDateTime(details.lastJobError.at)}</p>
        </Section>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--wb-line)] pt-2">
        <button type="button" onClick={onOpenSetupGuide} className={BUTTON}>
          Setup guide
        </button>
        {onOpenSettings ? (
          <button type="button" onClick={onOpenSettings} className={BUTTON}>
            Settings
          </button>
        ) : null}
      </div>
    </div>
  );
}
