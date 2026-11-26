import { Effect } from 'effect';
import {
  providerOperation,
  providerPromise,
  providerBody,
  type ProviderEffect,
  type ProviderSleep,
} from './providerEffect';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { GenerationTaskKind } from '../../../../packages/shared/src';
import {
  DEFAULT_GOOGLE_IMAGE_MODEL,
  GOOGLE_IMAGE_MODELS,
  isGoogleImageModel,
  isGoogleImageSizeSupported,
  normalizeGoogleImageSizeTier,
  type GoogleImageModel,
  type GoogleImageSize,
} from '../../../../packages/shared/src/googleImageContract';
import { readGoogleOAuthConfig } from '../auth/googleOAuthConfig';
import {
  getUsableAccessToken,
  invalidateStoredAccessToken,
  readGoogleApiKey,
} from '../auth/tokens';
import type { TurnResult } from '../codex/turn';
import { resolveLibraryPath } from '../library';
import type {
  ExternalProviderExecutionContext,
  ExternalProviderExecutor,
} from './externalProvider';
import type {
  HostedImageApiCompiledPayload,
  ProviderAssetInputRef,
} from './externalProviderInputs';
import {
  fetchExternalProviderWithRetry,
  findFirstInlineImageData,
  isRecord,
  responseSnippet,
  storeInlineImageResult,
  type ExternalProviderFetch,
} from './externalProviderResults';
import { resolveGoogleApiBase } from './googleApiBase';
import { SubscriptionHttpError } from './subscriptionHttpError';

export { resolveGoogleApiBase };

type ReadLocalFile = (path: string) => Uint8Array;

export interface GoogleImageExecutorDependencies {
  env?: Record<string, string | undefined>;
  fetch?: ExternalProviderFetch;
  resolveLibraryPath?: typeof resolveLibraryPath;
  mkdir?: typeof mkdirSync;
  writeFile?: typeof writeFileSync;
  readFile?: ReadLocalFile;
  now?: () => number;
  sleep?: ProviderSleep;
  maxAttempts?: number;
  retryDelayMs?: number;
  getAccessToken?: (env: Record<string, string | undefined>) => Promise<string>;
  invalidateAccessToken?: (message: string) => void;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 750;
const MAX_INPUT_IMAGE_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function asGooglePayload(value: unknown): HostedImageApiCompiledPayload {
  if (!isRecord(value) || value.apiFamily !== 'google_image' || typeof value.prompt !== 'string') {
    throw new Error('Compiled Google Provider Input payload is invalid.');
  }

  return value as unknown as HostedImageApiCompiledPayload;
}

function inferMimeType(filePath: string) {
  return MIME_BY_EXTENSION[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function createGooglePromptText(payload: HostedImageApiCompiledPayload) {
  return payload.negativePrompt
    ? `${payload.prompt}\n\nAvoid: ${payload.negativePrompt}`
    : payload.prompt;
}

function createGoogleAssetPart(asset: ProviderAssetInputRef, readFile: ReadLocalFile) {
  if (asset.sourceUrl) {
    throw new Error(
      `Google image asset "${asset.name}" must be imported as a localPath asset before execution.`,
    );
  }

  if (asset.hasInlineData && !asset.localPath) {
    throw new Error(
      `Google inline asset "${asset.name}" is not available in the compact Provider Input; import it as a localPath asset before execution.`,
    );
  }

  if (!asset.localPath) return null;

  const bytes = Buffer.from(readFile(asset.localPath));
  if (bytes.byteLength > MAX_INPUT_IMAGE_BYTES) {
    throw new Error(`Google image asset "${asset.name}" exceeded the 25 MB limit.`);
  }
  return {
    inlineData: {
      mimeType: inferMimeType(asset.localPath),
      data: bytes.toString('base64'),
    },
  };
}

function assertGoogleRequestBodySupportsTask(
  task: GenerationTaskKind,
  payload: HostedImageApiCompiledPayload,
) {
  if (
    task === 'image_edit' &&
    !payload.assets.some((asset) => asset.role === 'input' || asset.role === 'external_output')
  ) {
    throw new Error('Google image_edit task requires an input or external_output asset.');
  }
}

function createGoogleTranscriptDiagnostics(
  payload: HostedImageApiCompiledPayload,
  requestBody: Record<string, unknown>,
) {
  const contents = Array.isArray(requestBody.contents) ? requestBody.contents : [];
  const firstTurn = isRecord(contents[0]) ? contents[0] : null;
  const parts = Array.isArray(firstTurn?.parts) ? firstTurn.parts : [];
  return {
    assetCount: payload.assets.length,
    assetRoles: payload.assets.map((asset) => asset.role).sort(),
    inlineImagePartCount: parts.filter((part) => isRecord(part) && isRecord(part.inlineData))
      .length,
    requestFieldNames: Object.keys(requestBody).sort(),
  };
}

function normalizeGoogleImageSize(
  value: string | null,
  model: GoogleImageModel,
): GoogleImageSize | null {
  const tier = normalizeGoogleImageSizeTier(value);
  if (tier) {
    if (!isGoogleImageSizeSupported(model, tier)) {
      throw new Error(`Google image model "${model}" does not support ${tier} output.`);
    }
    return tier;
  }
  const normalized = value?.trim().toUpperCase() ?? '';
  const dimensions = normalized.match(/^(\d+)X(\d+)$/);
  if (!dimensions) return null;
  const largest = Math.max(Number(dimensions[1]), Number(dimensions[2]));
  const requested: GoogleImageSize =
    largest <= 512 ? '512px' : largest <= 1536 ? '1K' : largest <= 3072 ? '2K' : '4K';
  return isGoogleImageSizeSupported(model, requested) ? requested : '1K';
}

function describeMissingImageReason(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const feedback = isRecord(json.promptFeedback) ? json.promptFeedback : null;
  if (feedback && typeof feedback.blockReason === 'string' && feedback.blockReason) {
    return `Google blocked the request (${feedback.blockReason}).`;
  }
  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  const first = isRecord(candidates[0]) ? candidates[0] : null;
  const content = isRecord(first?.content) ? first.content : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const textReply = parts
    .flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text.trim()] : []))
    .filter(Boolean)
    .join(' ')
    .slice(0, 240);
  if (textReply) {
    return `Google returned text without an image: ${textReply}`;
  }
  if (first && typeof first.finishReason === 'string' && first.finishReason !== 'STOP') {
    return `Google did not return an image (finishReason: ${first.finishReason}).`;
  }
  return null;
}

export function createGoogleRequestBody(
  payload: HostedImageApiCompiledPayload,
  task: GenerationTaskKind,
  readFile: ReadLocalFile,
  model: GoogleImageModel,
) {
  assertGoogleRequestBodySupportsTask(task, payload);

  const assetParts = payload.assets.map((asset) => ({
    part: createGoogleAssetPart(asset, readFile),
    role: asset.role,
    strength: asset.strength,
  }));

  const inlineParts = assetParts
    .filter(
      (
        entry,
      ): entry is {
        part: { inlineData: { mimeType: string; data: string } };
        role: ProviderAssetInputRef['role'];
        strength: number | null;
      } => entry.part !== null,
    )
    .sort((a, b) => {
      const order: Record<string, number> = {
        input: 0,
        external_output: 0,
        mask: 1,
        control: 2,
        reference: 3,
      };
      return (order[a.role] ?? 4) - (order[b.role] ?? 4);
    })
    .map((entry) => entry.part);

  const editInstruction =
    task === 'image_edit'
      ? ' Edit the input image following the instructions above. Preserve the original composition, subject identity, and overall structure while applying the requested changes.'
      : '';

  const promptText = createGooglePromptText(payload) + editInstruction;
  const promptPart = { text: promptText };
  const parts = task === 'image_edit' ? [...inlineParts, promptPart] : [promptPart, ...inlineParts];

  const aspectRatio = payload.output.aspectRatio?.trim() || null;
  const imageSize = normalizeGoogleImageSize(payload.output.imageSize, model);
  const imageConfig: Record<string, string> = {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(imageSize ? { imageSize } : {}),
  };

  return {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
    },
  };
}

export function createGoogleImageExecutor({
  env = process.env,
  fetch: fetchFn = fetch,
  resolveLibraryPath: resolveLibrary = resolveLibraryPath,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
  readFile = readFileSync,
  now = () => Date.now(),
  sleep = (durationMs) => Effect.sleep(durationMs),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  getAccessToken = (credentialEnv) =>
    getUsableAccessToken('google', { env: credentialEnv, fetch: fetchFn as typeof fetch }),
  invalidateAccessToken = (message) => invalidateStoredAccessToken('google', message),
}: GoogleImageExecutorDependencies = {}): ExternalProviderExecutor {
  return function executeGoogleImageJob({
    providerId,
    job,
    compiledInput,
  }: ExternalProviderExecutionContext): ProviderEffect<TurnResult> {
    return providerOperation(
      Effect.gen(function* () {
        if (providerId !== 'google' || compiledInput.providerId !== 'google') {
          throw new Error(`Google executor received provider "${providerId}".`);
        }
        if (compiledInput.payloadKind !== 'api_request') {
          throw new Error(`Google executor cannot run payload "${compiledInput.payloadKind}".`);
        }

        const startedAt = now();
        const payload = asGooglePayload(compiledInput.payload);
        const apiKey = readGoogleApiKey(env);
        const oauthConfig = apiKey ? null : readGoogleOAuthConfig(env);
        const cloudProjectId = oauthConfig?.cloudProjectId ?? null;
        const accessToken = apiKey ? null : yield* providerPromise(() => getAccessToken(env));
        const model =
          payload.model?.trim() ||
          env.GOOGLE_IMAGE_MODEL?.trim() ||
          env.GEMINI_IMAGE_MODEL?.trim() ||
          DEFAULT_GOOGLE_IMAGE_MODEL;
        if (!isGoogleImageModel(model)) {
          throw new Error(
            `Google image model "${model}" is unsupported. Available models: ${GOOGLE_IMAGE_MODELS.join(', ')}.`,
          );
        }
        if (payload.output.count !== 1) {
          throw new Error('Google image generation requires exactly one output image per Job.');
        }
        const apiBase = resolveGoogleApiBase(env.GOOGLE_API_BASE);
        const endpoint = `${apiBase}/models/${encodeURIComponent(model)}:generateContent`;
        const requestBody = createGoogleRequestBody(payload, compiledInput.task, readFile, model);
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(!apiKey && cloudProjectId ? { 'x-goog-user-project': cloudProjectId } : {}),
        };
        const { response, attempts: requestAttempts } = yield* fetchExternalProviderWithRetry({
          label: 'Google image request',
          fetch: fetchFn,
          input: endpoint,
          init: {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: job.signal,
          },
          maxAttempts,
          retryDelayMs,
          sleep,
        });

        if (!response.ok) {
          const body = yield* providerBody(() => response.text().catch(() => ''));
          const safeSnippet = body
            ? ` ${responseSnippet(body, [apiKey ?? '', accessToken ?? '', cloudProjectId ?? ''])}`
            : '';
          if (!apiKey && response.status === 401) {
            const message = 'Google rejected the stored access token. Sign in again.';
            invalidateAccessToken(message);
            throw new SubscriptionHttpError(message, {
              code: 'invalid_grant',
              fallbackAllowed: false,
              httpStatus: 401,
            });
          }
          throw new Error(
            `Google image request failed after ${requestAttempts} attempt(s): ${response.status} ${response.statusText}${safeSnippet}`,
          );
        }

        const json = yield* providerBody(() => response.json());
        const image = findFirstInlineImageData(json);
        if (!image) {
          throw new Error(
            describeMissingImageReason(json) ??
              'Google image response did not include inline image data.',
          );
        }

        return yield* storeInlineImageResult({
          providerId: 'google',
          providerSlug: 'google',
          model,
          endpointBase: apiBase,
          job,
          compiledInput,
          responseJson: json,
          image,
          requestAttempts,
          startedAt,
          diagnostics: createGoogleTranscriptDiagnostics(payload, requestBody),
          files: {
            resolveLibraryPath: resolveLibrary,
            mkdir,
            writeFile,
            now,
          },
        });
      }),
    );
  };
}
