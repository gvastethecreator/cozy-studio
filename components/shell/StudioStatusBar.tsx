import React, { useEffect, useRef, useState } from 'react';
import { LayoutRight as SidebarRight } from 'iconoir-react';

import type { UseCatalogResult } from '../../hooks/useCatalogPage';
import type { StudioCommandCenterProjection } from '../../lib/commandCenterProjection';
import type { StudioUsageSummary } from '../../lib/studioDiagnostics';
import { cn } from '../../lib/utils';
import { providerRuntimeStatusDotClass } from '../../lib/providerBrand';
import { UsageStatusCard } from '../header/UsageStatusCard';
import { CozyStatusCup } from '../CozyMascot';
import { ProviderBrandMark } from '../ProviderBrandMark';
import Tooltip from '../Tooltip';
import { RuntimeStatusPanel, type RuntimeStatusDetails } from './RuntimeStatusPanel';

export interface StudioStatusBarProps {
  providerUsage: Partial<Record<'codex' | 'chatgpt', StudioUsageSummary>>;
  commandCenter: StudioCommandCenterProjection;
  imageHistory?: Pick<
    UseCatalogResult,
    'total' | 'isLoading' | 'error' | 'hasMore' | 'loadMore' | 'refresh'
  >;
  isQueueOpen: boolean;
  onToggleQueue: () => void;
  onOpenDashboard: () => void;
  onOpenOnboarding: () => void;
  onOpenSettings?: () => void;
  runtimeDetails?: RuntimeStatusDetails;
}

const NO_RUNTIME_DETAILS: RuntimeStatusDetails = {
  statusItems: [],
  stuckJobCount: 0,
  lastJobError: null,
};

export function StudioStatusBar({
  providerUsage,
  commandCenter,
  imageHistory,
  isQueueOpen,
  onToggleQueue,
  onOpenDashboard,
  onOpenOnboarding,
  onOpenSettings,
  runtimeDetails = NO_RUNTIME_DETAILS,
}: StudioStatusBarProps) {
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const statusRoot = useRef<HTMLDivElement>(null);
  const statusTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isStatusOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsStatusOpen(false);
      statusTrigger.current?.focus();
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.target instanceof Node && !statusRoot.current?.contains(event.target))
        setIsStatusOpen(false);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', pointerdown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', pointerdown);
    };
  }, [isStatusOpen]);
  const closeStatusThen = (action: () => void) => () => {
    setIsStatusOpen(false);
    action();
  };
  const runtimeStatus = commandCenter.runtimeStatus;
  const queueCount = commandCenter.queue.activeCount;
  const reviewCount = commandCenter.queue.reviewCount;
  const queueLabel = `${queueCount} active, ${reviewCount} need review`;
  const selected = commandCenter.provider;
  const options = commandCenter.providerOptions.some((provider) => provider.id === selected.id)
    ? commandCenter.providerOptions
    : [selected, ...commandCenter.providerOptions];
  // A pill that was active stays while readiness refreshes; its dot shows the current state.
  const [seenActive, setSeenActive] = useState<ReadonlySet<string>>(() => new Set());
  const newlyActive = options.filter(
    (provider) => provider.status === 'active' && !seenActive.has(provider.id),
  );
  if (newlyActive.length > 0)
    setSeenActive(new Set([...seenActive, ...newlyActive.map((provider) => provider.id)]));

  return (
    <footer className="studio-status-bar studio-bar" aria-label="Studio status">
      <ul className="studio-status-providers m-0 list-none p-0" aria-label="Provider status">
        {options
          .filter(
            (provider) =>
              provider.status === 'active' ||
              provider.id === selected.id ||
              seenActive.has(provider.id),
          )
          .map((provider) => {
            const usage =
              provider.id === 'codex'
                ? providerUsage.codex
                : provider.id === 'chatgpt'
                  ? providerUsage.chatgpt
                  : undefined;
            const weeklyLimit = usage?.limits.find((limit) => /weekly/i.test(limit.label));
            // ChatGPT shows its usage state: window left, using credits, or limit reached.
            const usageCopy = provider.id === 'chatgpt' ? usage?.usageCopy : null;
            // No stale percent: ChatGPT shows only its state, and nothing shows while offline.
            const usageText =
              provider.id === 'chatgpt'
                ? (usageCopy?.short ?? null)
                : weeklyLimit && usage?.tone !== 'offline'
                  ? `${Math.round(weeklyLimit.availablePercent)}% left`
                  : null;
            const usageDot =
              provider.canExecute && usageCopy?.tone === 'warning'
                ? 'bg-amber-400'
                : provider.canExecute && usageCopy?.tone === 'danger'
                  ? 'bg-rose-400'
                  : providerRuntimeStatusDotClass(provider);
            const pillClassName = cn(
              'studio-status-provider',
              provider.id === selected.id && 'is-active',
            );
            const content = (
              <>
                <ProviderBrandMark providerId={provider.id} size="xs" />
                <span className="studio-status-provider-label">{provider.shortLabel}</span>
                {provider.id === selected.id && !provider.canExecute ? (
                  <span className="studio-status-provider-usage">{provider.statusDetail}</span>
                ) : (
                  usageText && <span className="studio-status-provider-usage">{usageText}</span>
                )}
                <span aria-hidden="true" className={cn('studio-status-provider-dot', usageDot)} />
              </>
            );
            return (
              <li
                key={provider.id}
                data-tooltip={provider.tooltip}
                aria-label={`${provider.shortLabel}: ${provider.statusDetail}${usageCopy?.line ? `. ${usageCopy.line}` : ''}`}
              >
                {usage ? (
                  <UsageStatusCard
                    usage={usage}
                    providerLabel={provider.shortLabel}
                    onOpenDashboard={onOpenDashboard}
                    className={pillClassName}
                    popoverPlacement="top"
                  >
                    {content}
                  </UsageStatusCard>
                ) : (
                  <span className={pillClassName}>{content}</span>
                )}
              </li>
            );
          })}
      </ul>

      {imageHistory && (
        <div className="studio-status-image-history">
          <span role="status">
            {imageHistory.isLoading ? 'Loading images…' : `${imageHistory.total} images`}
          </span>
          {imageHistory.error && (
            <button
              type="button"
              aria-label="Retry loading images"
              onClick={() =>
                void (
                  imageHistory.hasMore ? imageHistory.loadMore() : imageHistory.refresh()
                ).catch(() => undefined)
              }
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div className="studio-status-spacer" />

      <div ref={statusRoot} className="relative shrink-0">
        <Tooltip content={runtimeStatus.tooltip} position="top" hidden={isStatusOpen}>
          <button
            ref={statusTrigger}
            type="button"
            onClick={() => setIsStatusOpen(!isStatusOpen)}
            aria-expanded={isStatusOpen}
            aria-label={`Open runtime status: ${runtimeStatus.label}`}
            className={`studio-command-surface studio-hit-target flex h-7 shrink-0 items-center justify-center rounded-[var(--wb-radius)] border border-transparent px-2 ${runtimeStatus.tone === 'success' ? 'text-[color:var(--wb-success)]' : 'text-[color:var(--wb-danger)]'}`}
          >
            <CozyStatusCup healthy={runtimeStatus.tone === 'success'} />
          </button>
        </Tooltip>
        {isStatusOpen ? (
          <RuntimeStatusPanel
            commandCenter={commandCenter}
            providerUsage={providerUsage}
            details={runtimeDetails}
            onClose={() => {
              setIsStatusOpen(false);
              statusTrigger.current?.focus();
            }}
            onOpenSettings={onOpenSettings && closeStatusThen(onOpenSettings)}
            onOpenSetupGuide={closeStatusThen(onOpenOnboarding)}
            onOpenJobs={closeStatusThen(() => {
              if (!isQueueOpen) onToggleQueue();
            })}
          />
        ) : null}
      </div>

      <Tooltip content={`Jobs · ${queueLabel}`} position="top" hidden className="shrink-0">
        <button
          type="button"
          onClick={onToggleQueue}
          aria-label={`${isQueueOpen ? 'Close' : 'Open'} jobs (${queueLabel})`}
          aria-pressed={isQueueOpen}
          className={cn(
            'studio-command-surface studio-hit-target flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--wb-radius)] border px-2 text-xs transition-colors',
            isQueueOpen
              ? 'border-[color:var(--wb-accent)] bg-[color-mix(in_srgb,var(--wb-accent)_18%,transparent)] text-[color:var(--wb-ink)]'
              : 'border-[color:var(--wb-border)] text-[color:var(--wb-muted)] hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)]',
          )}
        >
          <SidebarRight width={13} height={13} />
          <span>Jobs</span>
          {queueCount > 0 ? (
            <span className="tabular-nums text-accent-ink">{queueCount} active</span>
          ) : null}
          {reviewCount > 0 ? (
            <span className="border-l border-[color:var(--wb-line)] pl-1.5 text-[color:var(--wb-warning)]">
              {reviewCount} review
            </span>
          ) : null}
        </button>
      </Tooltip>
    </footer>
  );
}
