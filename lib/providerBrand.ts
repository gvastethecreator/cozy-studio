import { getProviderFacts } from '../packages/shared/src/providerCapabilities';

export function providerBrandWellClass(providerId: string) {
  return `provider-brand-well provider-brand-${getProviderFacts(providerId) ? providerId : 'unknown'}`;
}

export function providerBrandChipLabel(providerId: string) {
  return getProviderFacts(providerId)?.shortLabel ?? providerId;
}

export function providerReadyPillClass({
  canExecute,
  status,
}: {
  canExecute: boolean;
  status: string;
}) {
  if (canExecute) return 'border-emerald-500/20 bg-emerald-500/12 text-[color:var(--wb-success)]';
  if (status === 'planned')
    return 'border-amber-500/20 bg-amber-500/12 text-[color:var(--wb-warning)]';
  // Plain text: a filled grey chip next to the Sign in button reads as a second button.
  return 'border-transparent text-[color:var(--wb-muted)]';
}

export function subscriptionAuthPillClass(status: string | null | undefined) {
  if (status === 'logged_in')
    return 'border-emerald-500/20 bg-emerald-500/12 text-[color:var(--wb-success)]';
  if (status === 'pending')
    return 'border-accent-400/20 bg-accent-500/14 text-[color:var(--wb-info)]';
  if (status === 'refresh_failed')
    return 'border-rose-500/20 bg-rose-500/12 text-[color:var(--wb-danger)]';
  return 'border-[color:var(--wb-border)] bg-[color-mix(in_srgb,var(--wb-ink)_5%,transparent)] text-[color:var(--wb-muted)]';
}

export function providerRuntimeStatusDotClass({
  canExecute,
  status,
}: {
  canExecute: boolean;
  status: string;
}) {
  if (canExecute) return 'bg-emerald-400';
  if (status === 'unknown') return 'bg-amber-400';
  // Grey, like its label: nothing is broken, the provider is not set up or not reachable yet.
  if (status === 'not_configured' || status === 'offline') return 'bg-zinc-500';
  return 'bg-rose-400';
}
