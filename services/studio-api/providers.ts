import type {
  AntigravityUsageStatus,
  GenerationProviderCapabilitiesResponse,
  GenerationProviderRuntimePreflightResponse,
  OnboardingHostActionResult,
} from '../../packages/shared/src';
import { request } from './http';

let capabilitiesInFlight: Promise<GenerationProviderCapabilitiesResponse> | null = null;
let preflightInFlight: Promise<GenerationProviderRuntimePreflightResponse> | null = null;

export function invalidateGenerationProviderReads() {
  capabilitiesInFlight = null;
  preflightInFlight = null;
}

export function getGenerationProviderCapabilities() {
  if (capabilitiesInFlight) return capabilitiesInFlight;
  const promise = request<GenerationProviderCapabilitiesResponse>('/api/providers').finally(() => {
    if (capabilitiesInFlight === promise) capabilitiesInFlight = null;
  });
  capabilitiesInFlight = promise;
  return promise;
}

export function getGenerationProviderRuntimePreflight() {
  if (preflightInFlight) return preflightInFlight;
  const promise = request<GenerationProviderRuntimePreflightResponse>(
    '/api/providers/preflight',
  ).finally(() => {
    if (preflightInFlight === promise) preflightInFlight = null;
  });
  preflightInFlight = promise;
  return promise;
}

export function getAntigravityUsageStatus(options: { force?: boolean; signal?: AbortSignal } = {}) {
  const suffix = options.force ? '?force=1' : '';
  return request<AntigravityUsageStatus>(`/api/providers/antigravity/usage${suffix}`, {
    signal: options.signal,
  });
}

export function refreshAntigravityProviderRuntime() {
  invalidateGenerationProviderReads();
  return request<{
    capabilities: GenerationProviderCapabilitiesResponse;
    preflights: GenerationProviderRuntimePreflightResponse['providers'];
    usage: AntigravityUsageStatus;
  }>('/api/providers/antigravity/refresh', {
    method: 'POST',
  });
}

export function launchAntigravityLoginTerminal() {
  return request<OnboardingHostActionResult>('/api/providers/antigravity/login', {
    method: 'POST',
    body: JSON.stringify({ consent: true }),
  });
}
