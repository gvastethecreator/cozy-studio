import { accessSync, constants, existsSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import type {
  GoogleCredentialsClearScope,
  GoogleCredentialsPublicStatus,
  SaveGoogleCredentialsInput,
} from '../../../../packages/shared/src';
import { resolveGoogleApiBase } from '../providers/googleApiBase';
import { studioUserAgent } from './constants';
import { atomicWrite, resolveSubscriptionAuthFilePath } from './store';
import type { AuthFetch } from './tokens';

const GOOGLE_CREDENTIALS_STORE_VERSION = 1;
const GOOGLE_CREDENTIALS_FILE_NAME = 'google-credentials.json';
const GOOGLE_API_KEY_ENV_NAMES = [
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'NANO_BANANA_API_KEY',
] as const;

export class GoogleCredentialsError extends Error {
  readonly status: 400 | 415 | 502 | 503;
  readonly code: string;

  constructor(message: string, status: 400 | 415 | 502 | 503, code: string) {
    super(message);
    this.name = 'GoogleCredentialsError';
    this.status = status;
    this.code = code;
  }
}

export interface StoredGoogleCredentials {
  version: number;
  apiKey: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  cloudProjectId: string | null;
  updatedAt: string | null;
}

export interface GoogleCredentialsStore {
  filePath(): string;
  assertWritable(): void;
  read(): StoredGoogleCredentials;
  write(next: StoredGoogleCredentials): StoredGoogleCredentials;
  clear(scope?: GoogleCredentialsClearScope): StoredGoogleCredentials;
}

export interface GoogleCredentialsStoreDependencies {
  resolveFilePath?: () => string;
  now?: () => Date;
}

function emptyCredentials(): StoredGoogleCredentials {
  return {
    version: GOOGLE_CREDENTIALS_STORE_VERSION,
    apiKey: null,
    oauthClientId: null,
    oauthClientSecret: null,
    cloudProjectId: null,
    updatedAt: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanSecretField(value: unknown, field: string, maximum = 4096): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new GoogleCredentialsError(`${field} must be a string.`, 400, 'invalid_credentials');
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maximum || /[\u0000-\u001f\u007f\s]/.test(trimmed)) {
    throw new GoogleCredentialsError(
      `${field} contains invalid characters or exceeds the safe length limit.`,
      400,
      'invalid_credentials',
    );
  }
  return trimmed;
}

function parseCredentialsFile(raw: string): StoredGoogleCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new GoogleCredentialsError(
      'Google credential store is corrupted. Stored credentials were not changed.',
      503,
      'credential_store_corrupted',
    );
  }
  if (!isRecord(parsed) || parsed.version !== GOOGLE_CREDENTIALS_STORE_VERSION) {
    throw new GoogleCredentialsError(
      'Google credential store has an unsupported format.',
      503,
      'credential_store_corrupted',
    );
  }
  const updatedAt =
    typeof parsed.updatedAt === 'string' && Number.isFinite(Date.parse(parsed.updatedAt))
      ? parsed.updatedAt
      : null;
  return {
    version: GOOGLE_CREDENTIALS_STORE_VERSION,
    apiKey: cleanSecretField(parsed.apiKey, 'Google API key', 4096),
    oauthClientId: cleanSecretField(parsed.oauthClientId, 'Google OAuth Client ID', 4096),
    oauthClientSecret: cleanSecretField(
      parsed.oauthClientSecret,
      'Google OAuth Client Secret',
      64 * 1024,
    ),
    cloudProjectId: cleanSecretField(parsed.cloudProjectId, 'Google Cloud project ID', 256),
    updatedAt,
  };
}

export function resolveGoogleCredentialsFilePath() {
  if (process.env.VITEST === 'true') {
    return path.join(
      process.cwd(),
      'tmp',
      'vitest-auth',
      String(process.pid),
      GOOGLE_CREDENTIALS_FILE_NAME,
    );
  }
  return path.join(path.dirname(resolveSubscriptionAuthFilePath()), GOOGLE_CREDENTIALS_FILE_NAME);
}

function ensurePrivateDirectory(directoryPath: string) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directoryPath, 0o700);
  } catch {
    // Windows protects LocalAppData through inherited user ACLs instead of POSIX modes.
  }
}

export function createGoogleCredentialsStore({
  resolveFilePath = resolveGoogleCredentialsFilePath,
  now = () => new Date(),
}: GoogleCredentialsStoreDependencies = {}): GoogleCredentialsStore {
  const readSync = (): StoredGoogleCredentials => {
    const filePath = resolveFilePath();
    if (!existsSync(filePath)) return emptyCredentials();
    return parseCredentialsFile(readFileSync(filePath, 'utf8'));
  };

  const writeSync = (next: StoredGoogleCredentials) => {
    const stamped: StoredGoogleCredentials = {
      ...next,
      version: GOOGLE_CREDENTIALS_STORE_VERSION,
      updatedAt: now().toISOString(),
    };
    atomicWrite(resolveFilePath(), `${JSON.stringify(stamped, null, 2)}\n`);
    return stamped;
  };

  return {
    filePath: resolveFilePath,
    assertWritable() {
      try {
        const filePath = resolveFilePath();
        const directoryPath = path.dirname(filePath);
        ensurePrivateDirectory(directoryPath);
        accessSync(directoryPath, constants.W_OK);
        if (existsSync(filePath)) accessSync(filePath, constants.R_OK | constants.W_OK);
      } catch {
        throw new GoogleCredentialsError(
          'Studio cannot write its private credential store. Repair app-data permissions before saving credentials.',
          503,
          'credential_store_not_writable',
        );
      }
    },
    read: readSync,
    write: writeSync,
    clear(scope: GoogleCredentialsClearScope = 'all') {
      if (scope === 'all') {
        if (!existsSync(resolveFilePath())) return emptyCredentials();
        return writeSync(emptyCredentials());
      }
      const current = readSync();
      if (scope === 'api_key') {
        return writeSync({ ...current, apiKey: null });
      }
      return writeSync({
        ...current,
        oauthClientId: null,
        oauthClientSecret: null,
        cloudProjectId: null,
      });
    },
  };
}

let defaultGoogleCredentialsStore: GoogleCredentialsStore | null = null;

export function getGoogleCredentialsStore() {
  defaultGoogleCredentialsStore ??= createGoogleCredentialsStore();
  return defaultGoogleCredentialsStore;
}

export function maskSecretHint(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length < 12) return 'Configured';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function readStoredGoogleCredentialsSafe(
  store: GoogleCredentialsStore = getGoogleCredentialsStore(),
): StoredGoogleCredentials {
  try {
    return store.read();
  } catch {
    return emptyCredentials();
  }
}

export function findGoogleApiKeyEnvName(env: Record<string, string | undefined> = process.env) {
  return GOOGLE_API_KEY_ENV_NAMES.find((name) => Boolean(env[name]?.trim())) ?? null;
}

export function readGoogleCredentialsPublicStatus({
  env = process.env,
  store = getGoogleCredentialsStore(),
}: {
  env?: Record<string, string | undefined>;
  store?: GoogleCredentialsStore;
} = {}): GoogleCredentialsPublicStatus {
  const stored = readStoredGoogleCredentialsSafe(store);
  const envKeyName = findGoogleApiKeyEnvName(env);
  const envKey = envKeyName ? (env[envKeyName]?.trim() ?? null) : null;
  const apiKeySource = envKey ? 'env' : stored.apiKey ? 'store' : null;
  const activeKey = envKey ?? stored.apiKey;

  const envClientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
  const envCloudProjectId = env.GOOGLE_CLOUD_PROJECT_ID?.trim() || null;
  const effectiveClientId = envClientId ?? stored.oauthClientId;
  const effectiveCloudProjectId = envCloudProjectId ?? stored.cloudProjectId;
  const oauthConfigured = Boolean(effectiveClientId && effectiveCloudProjectId);
  const oauthSource =
    envClientId && envCloudProjectId
      ? 'env'
      : oauthConfigured
        ? envClientId || envCloudProjectId
          ? 'env'
          : 'store'
        : null;

  return {
    apiKeyConfigured: Boolean(activeKey),
    apiKeySource,
    apiKeyEnvName: envKeyName,
    apiKeyHint: maskSecretHint(activeKey),
    oauthConfigured,
    oauthSource,
    oauthClientIdHint: maskSecretHint(effectiveClientId),
    cloudProjectId: effectiveCloudProjectId,
    updatedAt: stored.updatedAt,
  };
}

function safeErrorSnippet(text: string, secrets: readonly string[]): string {
  let clean = text.replace(/[\r\n\t]+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret) clean = clean.split(secret).join('[redacted]');
  }
  return clean.slice(0, 240);
}

export async function validateGoogleApiKeyLive(
  apiKey: string,
  {
    env = process.env,
    fetch: fetchImpl = fetch,
  }: { env?: Record<string, string | undefined>; fetch?: AuthFetch } = {},
) {
  const cleaned = cleanSecretField(apiKey, 'Google API key', 4096);
  if (!cleaned) {
    throw new GoogleCredentialsError('Enter a Google Gemini API key.', 400, 'invalid_api_key');
  }
  const apiBase = resolveGoogleApiBase(env.GOOGLE_API_BASE);
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase}/models?pageSize=1`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-goog-api-key': cleaned,
        'User-Agent': studioUserAgent(),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoogleCredentialsError(
      'Could not reach Google Gemini API to verify this key. Check your internet connection and try again.',
      502,
      'verification_unreachable',
    );
  }
  if (response.ok) return;
  const body = await response.text().catch(() => '');
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed?.error?.message === 'string') {
      detail = safeErrorSnippet(parsed.error.message, [cleaned]);
    }
  } catch {
    detail = safeErrorSnippet(body, [cleaned]);
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new GoogleCredentialsError(
      detail
        ? `Google rejected this API key: ${detail}`
        : `Google rejected this API key (${response.status}). Check that it is an active Gemini API key.`,
      400,
      'invalid_api_key',
    );
  }
  throw new GoogleCredentialsError(
    detail
      ? `Google API verification failed (${response.status}): ${detail}`
      : `Google API verification failed (${response.status}).`,
    502,
    'verification_failed',
  );
}

export async function saveGoogleCredentials(
  input: SaveGoogleCredentialsInput,
  {
    env = process.env,
    store = getGoogleCredentialsStore(),
    fetch: fetchImpl = fetch,
  }: {
    env?: Record<string, string | undefined>;
    store?: GoogleCredentialsStore;
    fetch?: AuthFetch;
  } = {},
): Promise<GoogleCredentialsPublicStatus> {
  store.assertWritable();
  const current = readStoredGoogleCredentialsSafe(store);
  const next: StoredGoogleCredentials = { ...current };

  if ('apiKey' in input) {
    const cleanedKey = cleanSecretField(input.apiKey, 'Google API key', 4096);
    if (cleanedKey && input.validate !== false) {
      await validateGoogleApiKeyLive(cleanedKey, { env, fetch: fetchImpl });
    }
    next.apiKey = cleanedKey;
  }

  if ('oauthClientId' in input) {
    next.oauthClientId = cleanSecretField(input.oauthClientId, 'Google OAuth Client ID', 4096);
  }
  if ('oauthClientSecret' in input) {
    next.oauthClientSecret = cleanSecretField(
      input.oauthClientSecret,
      'Google OAuth Client Secret',
      64 * 1024,
    );
  }
  if ('cloudProjectId' in input) {
    next.cloudProjectId = cleanSecretField(input.cloudProjectId, 'Google Cloud project ID', 256);
  }

  store.write(next);
  return readGoogleCredentialsPublicStatus({ env, store });
}
