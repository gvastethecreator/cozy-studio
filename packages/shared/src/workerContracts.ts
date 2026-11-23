export interface WorkerLimits {
  global: number;
  providers: Record<string, number>;
}

export type JobWaitReason =
  | 'provider_capacity'
  | 'global_capacity'
  | 'provider_turn'
  | 'provider_paused'
  | 'stopping';

/** A provider whose queued jobs wait because it rejected the signed-in session. */
export interface ProviderPause {
  reason: 'session_rejected';
  message: string;
  since: string;
}

/** Payload of the `worker.provider_paused` Studio event. */
export interface ProviderPausedEventPayload extends ProviderPause {
  providerId: string;
}

export interface WorkerStatus {
  maxConcurrentJobs: number;
  activeWorkerCount: number;
  queuedJobs: number;
  trackedJobs: number;
  providerLimits: Record<string, number>;
  activeByProvider: Record<string, number>;
  waiting: Array<{ jobId: string; providerId: string; reason: JobWaitReason }>;
  /** Keyed by generation provider id; the worker sends no job to these until sign-in. */
  pausedProviders?: Record<string, ProviderPause>;
  stopping: boolean;
}

export function validateWorkerLimits(limits: WorkerLimits) {
  if (!Number.isInteger(limits.global) || limits.global < 1 || limits.global > 16) {
    throw new Error('Worker global capacity must be an integer from 1 to 16.');
  }
  for (const [provider, limit] of Object.entries(limits.providers)) {
    if (!Number.isInteger(limit) || limit < 1 || limit > limits.global) {
      throw new Error(
        `Worker capacity for ${provider} must be an integer from 1 to the global limit.`,
      );
    }
  }
  return limits;
}
