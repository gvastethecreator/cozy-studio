import {
  formatAntigravityWindowLabel,
  UNKNOWN_ANTIGRAVITY_USAGE,
  type AntigravityUsageBucket,
  type AntigravityUsageStatus,
} from '../../../packages/shared/src/antigravityUsage';
import {
  createAntigravityChildEnvironment,
  resolveAntigravityExecutable,
} from './antigravityExecutable';
import { runCliProbe, type CliProbeRunner } from './cliProbe';

const USAGE_TIMEOUT_MS = 10_000;
const USAGE_CACHE_MS = 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface AntigravityUsageDependencies {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  now?: () => Date;
  run?: CliProbeRunner;
  resolveExecutable?: (env: NodeJS.ProcessEnv) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseResetSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

export function parseAntigravityUsageJson(raw: string): {
  buckets: AntigravityUsageBucket[];
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { buckets: [], error: 'Antigravity usage output was not valid JSON.' };
  }
  if (!isRecord(parsed) || parsed.status !== 'SUCCESS' || !isRecord(parsed.command)) {
    const err =
      isRecord(parsed) && typeof parsed.error === 'string'
        ? parsed.error
        : 'Antigravity usage check failed.';
    return { buckets: [], error: err };
  }
  const data = isRecord(parsed.command.data) ? parsed.command.data : null;
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const geminiGroup =
    groups.find(
      (group) => isRecord(group) && typeof group.name === 'string' && /gemini/i.test(group.name),
    ) ?? groups.find(isRecord);
  const rawBuckets =
    isRecord(geminiGroup) && Array.isArray(geminiGroup.buckets) ? geminiGroup.buckets : [];
  const buckets: AntigravityUsageBucket[] = rawBuckets.flatMap((bucket) => {
    if (!isRecord(bucket)) return [];
    const fraction =
      typeof bucket.remaining_fraction === 'number' && Number.isFinite(bucket.remaining_fraction)
        ? Math.max(0, Math.min(1, bucket.remaining_fraction))
        : null;
    if (fraction === null) return [];
    const window =
      typeof bucket.window === 'string' && bucket.window.trim() ? bucket.window.trim() : 'quota';
    const id = typeof bucket.id === 'string' && bucket.id.trim() ? bucket.id.trim() : window;
    const label = formatAntigravityWindowLabel(window);
    const resetTime =
      typeof bucket.reset_time === 'string' && parseResetSeconds(bucket.reset_time) !== null
        ? bucket.reset_time
        : null;
    return [
      {
        id,
        label,
        window,
        remainingPercent: Math.round(fraction * 1000) / 10,
        resetTime,
      },
    ];
  });
  return { buckets, error: null };
}

export function parseAntigravityCreditsJson(raw: string): {
  remainingCredits: number | null;
  upgradeUri: string | null;
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.status !== 'SUCCESS' || !isRecord(parsed.command)) {
      return { remainingCredits: null, upgradeUri: null };
    }
    const data = isRecord(parsed.command.data) ? parsed.command.data : null;
    const remainingCredits =
      typeof data?.remaining_credits === 'number' && Number.isFinite(data.remaining_credits)
        ? data.remaining_credits
        : null;
    const upgradeUri =
      typeof data?.upgrade_uri === 'string' && /^https:\/\//i.test(data.upgrade_uri.trim())
        ? data.upgrade_uri.trim()
        : null;
    return { remainingCredits, upgradeUri };
  } catch {
    return { remainingCredits: null, upgradeUri: null };
  }
}

export async function inspectAntigravityUsage({
  env = process.env,
  cwd = process.cwd(),
  now = () => new Date(),
  run = runCliProbe,
  resolveExecutable = resolveAntigravityExecutable,
}: AntigravityUsageDependencies = {}): Promise<AntigravityUsageStatus> {
  const executable = resolveExecutable(env);
  const childEnv = createAntigravityChildEnvironment(env);
  const probe = (slashCommand: string) =>
    run(executable, ['-p', slashCommand, '--output-format', 'json'], {
      cwd,
      env: childEnv,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      timeoutMs: USAGE_TIMEOUT_MS,
    });

  const [usageResult, creditsResult] = await Promise.all([probe('/usage'), probe('/credits')]);
  const checkedAt = now().toISOString();
  if (usageResult.status !== 0) {
    return {
      ...UNKNOWN_ANTIGRAVITY_USAGE,
      checkedAt,
      error: 'Antigravity usage is unavailable.',
    };
  }
  const parsedUsage = parseAntigravityUsageJson(usageResult.stdout);
  const parsedCredits =
    creditsResult.status === 0
      ? parseAntigravityCreditsJson(creditsResult.stdout)
      : { remainingCredits: null, upgradeUri: null };

  const sorted = [...parsedUsage.buckets].sort((a, b) => a.remainingPercent - b.remainingPercent);
  const tightest = sorted[0] ?? null;

  return {
    available: parsedUsage.buckets.length > 0 && !parsedUsage.error,
    checkedAt,
    tightestPercentLeft: tightest ? tightest.remainingPercent : null,
    tightestWindowLabel: tightest ? tightest.label : null,
    resetsAt: tightest ? parseResetSeconds(tightest.resetTime) : null,
    buckets: parsedUsage.buckets,
    remainingCredits: parsedCredits.remainingCredits,
    upgradeUri: parsedCredits.upgradeUri,
    error: parsedUsage.error,
  };
}

let cachedUsage: { value: AntigravityUsageStatus; expiresAt: number } | null = null;
let usageInFlight: Promise<AntigravityUsageStatus> | null = null;

export function clearAntigravityUsageCache() {
  cachedUsage = null;
}

export function readAntigravityUsageStatus({ force = false }: { force?: boolean } = {}) {
  if (!force && cachedUsage && cachedUsage.expiresAt > Date.now()) {
    return Promise.resolve(cachedUsage.value);
  }
  usageInFlight ??= inspectAntigravityUsage()
    .then((value) => {
      cachedUsage = { value, expiresAt: Date.now() + USAGE_CACHE_MS };
      return value;
    })
    .catch(() => ({
      ...UNKNOWN_ANTIGRAVITY_USAGE,
      checkedAt: new Date().toISOString(),
      error: 'Antigravity usage check failed.',
    }))
    .finally(() => {
      usageInFlight = null;
    });
  return usageInFlight;
}
