import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { StudioUsageSummary } from '../../lib/studioDiagnostics';
import Tooltip from '../Tooltip';

interface UsageStatusCardProps {
  usage: StudioUsageSummary;
  onOpenDashboard: () => void;
  className?: string;
  popoverPlacement?: 'bottom' | 'top';
  providerLabel?: string;
  children: ReactNode;
}

function getUsageDetailLabel(label: string, meta: string) {
  const scope = meta.split(' · ').at(-1)?.trim();
  return scope && label.startsWith(`${scope} · `) ? label.slice(scope.length + 3) : label;
}

export function UsageStatusCard({
  usage,
  onOpenDashboard,
  className,
  popoverPlacement = 'bottom',
  providerLabel = 'Codex',
  children,
}: UsageStatusCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        trigger.current?.focus();
      }
    };
    const pointerdown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', pointerdown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', pointerdown);
    };
  }, [isOpen]);
  const tooltip =
    usage.limits.length > 0
      ? `${usage.tooltip} · ${usage.limits
          .map(
            (limit) =>
              `${getUsageDetailLabel(limit.label, usage.meta)}: ${Math.round(limit.availablePercent)}% available${limit.resetLabel ? `, ${limit.resetLabel}` : ''}`,
          )
          .join(' · ')}`
      : usage.tooltip;

  return (
    <div ref={root} className="relative">
      <Tooltip content={tooltip} position={popoverPlacement === 'top' ? 'top' : 'bottom'}>
        <button
          type="button"
          ref={trigger}
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className={className}
          aria-label={`${providerLabel} usage status`}
        >
          {children}
        </button>
      </Tooltip>
      {isOpen && (
        <div
          role="region"
          aria-label={`${providerLabel} account usage`}
          className={`absolute left-0 z-[100] w-80 rounded-[var(--wb-radius)] border border-[color:var(--wb-border)] bg-[color:var(--wb-panel)] p-4 shadow-xl ${popoverPlacement === 'top' ? 'bottom-9' : 'top-11'}`}
        >
          <div className="flex items-center justify-between">
            <strong>{providerLabel} account usage</strong>
            <button
              type="button"
              aria-label="Close usage"
              onClick={() => {
                setIsOpen(false);
                trigger.current?.focus();
              }}
            >
              Close
            </button>
          </div>
          <p className="my-3 text-sm text-[color:var(--wb-ink)]">{usage.tooltip}</p>
          {usage.limits.map((limit) => (
            <p key={limit.id} className="my-2 text-sm">
              {limit.label}: {Math.round(limit.availablePercent)}% available · {limit.resetLabel}
            </p>
          ))}
          <button
            type="button"
            className="mt-3 text-sm underline"
            onClick={() => {
              setIsOpen(false);
              onOpenDashboard();
            }}
          >
            Library summary
          </button>
        </div>
      )}
    </div>
  );
}
