import { Effect } from 'effect';
import {
  providerOperation,
  providerBody,
  type ProviderEffect,
  type ProviderSleep,
} from './providerEffect';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { TurnResult } from '../codex/turn';
import { resolveLibraryPath } from '../library';
import type {
  ExternalProviderExecutionContext,
  ExternalProviderExecutor,
} from './externalProvider';
import type { HostedImageApiCompiledPayload } from './externalProviderInputs';
import {
  fetchExternalProviderWithRetry,
  isRecord,
  responseSnippet,
  storeHostedImageResult,
  type ExternalProviderFetch,
} from './externalProviderResults';
import { DEFAULT_REPLICATE_IMAGE_MODEL } from './providerExecutionDefaults';

export interface ReplicateImageExecutorDependencies {
  env?: Record<string, string | undefined>;
  fetch?: ExternalProviderFetch;
  resolveLibraryPath?: typeof resolveLibraryPath;
  mkdir?: typeof mkdirSync;
  writeFile?: typeof writeFileSync;
  now?: () => number;
  sleep?: ProviderSleep;
  maxAttempts?: number;
  retryDelayMs?: number;
}

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 750;

function asReplicatePayload(value: unknown): HostedImageApiCompiledPayload {
  if (
    !isRecord(value) ||
    value.apiFamily !== 'replicate_image' ||
    typeof value.prompt !== 'string'
  ) {
    throw new Error('Compiled Replicate Provider Input payload is invalid.');
  }
  return value as unknown as HostedImageApiCompiledPayload;
}

export function createReplicateImageExecutor({
  env = process.env,
  fetch: fetchFn = fetch,
  resolveLibraryPath: resolveLibrary = resolveLibraryPath,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
  now = () => Date.now(),
  sleep = (durationMs) => Effect.sleep(durationMs),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: ReplicateImageExecutorDependencies = {}): ExternalProviderExecutor {
  return function executeReplicateImageJob({
    providerId,
    job,
    compiledInput,
  }: ExternalProviderExecutionContext): ProviderEffect<TurnResult> {
    return providerOperation(
      Effect.gen(function* () {
        if (providerId !== 'replicate' || compiledInput.providerId !== 'replicate') {
          throw new Error(`Replicate executor received provider "${providerId}".`);
        }
        const payload = asReplicatePayload(compiledInput.payload);
        if (payload.assets.length > 0) {
          throw new Error('The Replicate adapter supports text-to-image only.');
        }
        const token = env.REPLICATE_API_TOKEN?.trim();
        if (!token) throw new Error('Missing Provider Secret source: REPLICATE_API_TOKEN.');

        const startedAt = now();
        const model =
          payload.model?.trim() || env.REPLICATE_MODEL?.trim() || DEFAULT_REPLICATE_IMAGE_MODEL;
        const endpoint = `${REPLICATE_API_BASE}/models/${model.replace(/^\/+/, '')}/predictions`;
        const input = {
          prompt: payload.prompt,
          ...(payload.output.aspectRatio ? { aspect_ratio: payload.output.aspectRatio } : {}),
        };
        // ponytail: sync mode only (Prefer: wait, up to 60 s); poll `urls.get` if slow models need it.
        const { response, attempts: requestAttempts } = yield* fetchExternalProviderWithRetry({
          label: 'Replicate request',
          fetch: fetchFn,
          input: endpoint,
          init: {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              Prefer: 'wait',
            },
            body: JSON.stringify({ input }),
            signal: job.signal,
          },
          maxAttempts,
          retryDelayMs,
          sleep,
        });

        if (!response.ok) {
          const body = yield* providerBody(() => response.text().catch(() => ''));
          throw new Error(
            `Replicate request failed after ${requestAttempts} attempt(s): ${response.status} ${response.statusText}${body ? ` ${responseSnippet(body, [token])}` : ''}`,
          );
        }

        const json: unknown = yield* providerBody(() => response.json());
        const output = isRecord(json) ? json.output : null;
        const imageUrl = Array.isArray(output) ? output[0] : output;
        if (typeof imageUrl !== 'string') {
          const status = isRecord(json) ? String(json.status) : 'unknown';
          throw new Error(`Replicate prediction returned no image (status ${status}).`);
        }

        return yield* storeHostedImageResult({
          providerId: 'replicate',
          providerSlug: 'replicate',
          model,
          endpointBase: REPLICATE_API_BASE,
          job,
          compiledInput,
          responseJson: json,
          imageUrl,
          requestAttempts,
          startedAt,
          diagnostics: { inputFieldNames: Object.keys(input).sort() },
          fetch: fetchFn,
          files: { resolveLibraryPath: resolveLibrary, mkdir, writeFile, now },
          maxAttempts,
          retryDelayMs,
          sleep,
        });
      }),
    );
  };
}
