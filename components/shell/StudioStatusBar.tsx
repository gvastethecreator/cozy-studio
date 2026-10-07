import React from 'react';
import { LayoutRight as SidebarRight } from 'iconoir-react';

import type { UseCatalogResult } from '../../hooks/useCatalogPage';
import type { StudioCommandCenterProjection } from '../../lib/commandCenterProjection';
import type { StudioUsageSummary } from '../../lib/studioDiagnostics';
import { cn } from '../../lib/utils';
import { UsageStatusCard } from '../header/UsageStatusCard';
import { ProviderBrandMark } from '../ProviderBrandMark';
import { CozyStatusCup } from '../CozyMascot';
import Tooltip from '../Tooltip';

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
}

export function StudioStatusBar({
  providerUsage,
  commandCenter,
  imageHistory,
  isQueueOpen,
  onToggleQueue,
  onOpenDashboard,
  onOpenOnboarding,
}: StudioStatusBarProps) {
  const runtimeStatus = commandCenter.runtimeStatus;
  const queueCount = commandCenter.queue.activeCount;
  const reviewCount = commandCenter.queue.reviewCount;
  const queueLabel = `${queueCount} active, ${reviewCount} need review`;

  return (
    <footer className="studio-status-bar studio-bar" aria-label="Studio status">
      <ul className="studio-status-providers m-0 list-none p-0" aria-label="Provider status">
        {commandCenter.providerOptions
          .filter((provider) => provider.status === 'active')
          .map((provider) => {
            const usage =
              provider.id === 'codex'
                ? providerUsage.codex
                : provider.id === 'chatgpt'
                  ? providerUsage.chatgpt
                  : undefined;
            return (
              <li
                key={provider.id}
                data-tooltip={provider.tooltip}
                aria-label={`${provider.shortLabel}: ${provider.statusDetail}`}
                className={cn(
                  'studio-status-provider',
                  provider.id === commandCenter.provider.id && 'is-active',
                )}
              >
                <ProviderBrandMark
                  providerId={provider.id}
                  size="xs"
                  canExecute={provider.canExecute}
                  status={provider.status}
                />
                <span className="studio-status-provider-label">{provider.shortLabel}</span>
                {usage ? (
                  <UsageStatusCard
                    usage={usage}
                    providerLabel={provider.shortLabel}
                    weeklyOnly
                    onOpenDashboard={onOpenDashboard}
                    className="relative flex h-7 shrink-0 items-center"
                    popoverPlacement="top"
                  />
                ) : null}
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

      <Tooltip content={runtimeStatus.tooltip} position="top" className="shrink-0">
        <button
          type="button"
          onClick={onOpenOnboarding}
          aria-label={`Open runtime status: ${runtimeStatus.label}`}
          className={`studio-command-surface studio-hit-target flex h-7 shrink-0 items-center justify-center rounded-[var(--wb-radius)] border border-transparent px-2 ${runtimeStatus.tone === 'success' ? 'text-[color:var(--wb-success)]' : 'text-[color:var(--wb-danger)]'}`}
        >
          <CozyStatusCup healthy={runtimeStatus.tone === 'success'} />
        </button>
      </Tooltip>

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
            <span className="tabular-nums text-accent-200">{queueCount} active</span>
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
