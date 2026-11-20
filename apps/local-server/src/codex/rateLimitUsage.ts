import type {
  ChatgptUsageStatus,
  CodexUsageCredits,
  CodexUsageLimitWindow,
  CodexUsageSnapshot,
} from '../../../../packages/shared/src';
import { UNKNOWN_CHATGPT_USAGE } from '../../../../packages/shared/src/chatgptUsage';

function readNumber(value: any, keys: string[]) {
  for (const key of keys) {
    const raw = value?.[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }

  return null;
}

function readString(value: any, keys: string[]) {
  for (const key of keys) {
    const raw = value?.[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }

  return null;
}

function quotaWindows(snapshot: any) {
  return (['primary', 'secondary'] as const)
    .map((key) => readNumber(snapshot?.[key], ['usedPercent', 'used_percent']))
    .filter((used): used is number => used !== null);
}

function hasAvailableQuota(snapshot: any) {
  const windows = quotaWindows(snapshot);
  if (windows.some((used) => used < 100)) return true;

  const credits = snapshot?.credits;
  if (!credits || typeof credits !== 'object') return false;
  if (credits.unlimited === true) return true;
  if (typeof credits.balance === 'number') return credits.balance > 0;
  if (typeof credits.balance === 'string') return Number(credits.balance) > 0;
  return credits.hasCredits === true;
}

function isQuotaExhausted(snapshot: any) {
  const windows = quotaWindows(snapshot);
  if (windows.some((used) => used >= 100)) return true;

  const credits = snapshot?.credits;
  return Boolean(
    windows.length === 0 &&
    credits &&
    typeof credits === 'object' &&
    credits.unlimited !== true &&
    ((typeof credits.balance === 'number' && credits.balance <= 0) ||
      (typeof credits.balance === 'string' && Number(credits.balance) <= 0) ||
      credits.hasCredits === false),
  );
}

function isReserveSnapshot(limitId: string, snapshot: any) {
  const limitName = readString(snapshot, ['limitName', 'limit_name']);
  return limitId === 'base_model_inference' || limitName?.toLowerCase() === 'gpt-reserve';
}

export function pickRateLimitSnapshot(response: any) {
  const byLimitId = response?.rateLimitsByLimitId ?? response?.rate_limits_by_limit_id;
  if (byLimitId && typeof byLimitId === 'object') {
    const regular = byLimitId.codex;
    const reserveEntry = Object.entries(byLimitId).find(
      ([limitId, snapshot]) =>
        snapshot && typeof snapshot === 'object' && isReserveSnapshot(limitId, snapshot),
    );

    if (
      reserveEntry &&
      reserveEntry[1] &&
      typeof reserveEntry[1] === 'object' &&
      hasAvailableQuota(reserveEntry[1]) &&
      (!regular || typeof regular !== 'object' || isQuotaExhausted(regular))
    ) {
      const [limitId, snapshot] = reserveEntry;
      return { snapshot, path: `rateLimitsByLimitId.${limitId}` };
    }

    if (regular && typeof regular === 'object') {
      return { snapshot: regular, path: 'rateLimitsByLimitId.codex' };
    }

    for (const [limitId, snapshot] of Object.entries(byLimitId)) {
      if (snapshot && typeof snapshot === 'object') {
        return { snapshot, path: `rateLimitsByLimitId.${limitId}` };
      }
    }
  }

  if (response?.rateLimits && typeof response.rateLimits === 'object') {
    return { snapshot: response.rateLimits, path: 'rateLimits' };
  }

  if (response?.rate_limits && typeof response.rate_limits === 'object') {
    return { snapshot: response.rate_limits, path: 'rate_limits' };
  }

  return { snapshot: null, path: null };
}

function formatQuotaWindowLabel(windowMinutes: number | null, fallback: string) {
  if (windowMinutes === 300) return '5h';
  if (windowMinutes === 10080) return 'Weekly';
  if (typeof windowMinutes === 'number' && windowMinutes > 0) {
    if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}d`;
    if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
    return `${windowMinutes}m`;
  }
  return fallback;
}

function extractQuotaWindow(
  snapshot: any,
  key: 'primary' | 'secondary',
  pathPrefix: string | null,
): CodexUsageLimitWindow | null {
  const window = snapshot?.[key];
  if (!window || typeof window !== 'object') return null;

  const usedPercent = readNumber(window, ['usedPercent', 'used_percent']);
  if (usedPercent === null) return null;

  const windowMinutes = readNumber(window, [
    'windowMinutes',
    'window_minutes',
    'windowDurationMins',
    'window_duration_mins',
  ]);
  const resetsAt = readNumber(window, ['resetsAt', 'resets_at']);
  const normalizedUsed = Math.max(0, Math.min(100, usedPercent));
  const availablePercent = Math.max(0, Math.min(100, 100 - normalizedUsed));

  return {
    id: key,
    label: formatQuotaWindowLabel(windowMinutes, key === 'primary' ? '5h' : 'Weekly'),
    usedPercent: normalizedUsed,
    availablePercent,
    windowMinutes,
    resetsAt,
    path: pathPrefix ? `${pathPrefix}.${key}` : key,
  };
}

function extractCredits(snapshot: any): CodexUsageCredits | null {
  const credits = snapshot?.credits;
  if (!credits || typeof credits !== 'object') return null;
  const balance =
    typeof credits.balance === 'number'
      ? credits.balance
      : typeof credits.balance === 'string' && credits.balance.trim()
        ? Number(credits.balance)
        : null;
  return {
    hasCredits: typeof credits.hasCredits === 'boolean' ? credits.hasCredits : null,
    unlimited: credits.unlimited === true,
    balance: balance !== null && Number.isFinite(balance) ? balance : null,
  };
}

function creditsAvailable(credits: CodexUsageCredits | null | undefined) {
  if (!credits) return false;
  if (credits.unlimited) return true;
  if (credits.balance !== null) return credits.balance > 0;
  return credits.hasCredits === true;
}

/**
 * Derives the usage state once from a snapshot. Every window must have room for jobs to use the
 * window; once one is used up, jobs spend credits while the account has them.
 */
export function deriveChatgptUsageStatus(usage: CodexUsageSnapshot | null): ChatgptUsageStatus {
  if (!usage) return UNKNOWN_CHATGPT_USAGE;
  const limits = usage.limits ?? [];
  const credits = usage.credits ?? null;
  const tightest = limits.reduce<CodexUsageLimitWindow | null>(
    (current, limit) =>
      !current ||
      limit.availablePercent < current.availablePercent ||
      (limit.availablePercent === current.availablePercent &&
        (limit.resetsAt ?? 0) > (current.resetsAt ?? 0))
        ? limit
        : current,
    null,
  );
  if (!tightest && !credits) return UNKNOWN_CHATGPT_USAGE;
  const windowHasRoom = tightest !== null && tightest.availablePercent > 0;
  return {
    state: windowHasRoom ? 'window' : creditsAvailable(credits) ? 'credits' : 'exhausted',
    windowPercentLeft: tightest?.availablePercent ?? null,
    windowLabel: tightest?.label ?? null,
    resetsAt: tightest?.resetsAt ?? null,
    creditBalance: credits?.balance ?? null,
    creditsUnlimited: credits?.unlimited ?? false,
  };
}

export function extractUsageSnapshot(
  snapshot: any,
  pathPrefix: string | null,
): CodexUsageSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const normalizedCredits = extractCredits(snapshot);

  const limitId = pathPrefix?.split('.').at(-1) ?? null;
  const limitName =
    readString(snapshot, ['limitName', 'limit_name']) ??
    (limitId === 'base_model_inference' ? 'gpt-reserve' : null);

  const limits = (['primary', 'secondary'] as const)
    .map((key) => extractQuotaWindow(snapshot, key, pathPrefix))
    .filter((window): window is CodexUsageLimitWindow => window !== null);

  if (limits.length > 0) {
    const primary = limits[0];
    const roundedAvailable = Math.round(primary.availablePercent);
    return {
      available: primary.availablePercent,
      unit: 'quota_percent',
      display: `${roundedAvailable}%`,
      path: primary.path,
      limitId,
      limitName,
      limits,
      credits: normalizedCredits,
      raw: snapshot,
    };
  }

  const credits = snapshot.credits;
  if (credits && typeof credits === 'object') {
    if (credits.unlimited === true) {
      return {
        available: 'unlimited',
        unit: 'credits',
        display: 'Unlimited',
        path: pathPrefix ? `${pathPrefix}.credits` : 'credits',
        limitId,
        limitName,
        credits: normalizedCredits,
        raw: credits,
      };
    }

    if (typeof credits.balance === 'string' && credits.balance.trim().length > 0) {
      const numericBalance = Number(credits.balance);
      return {
        available: Number.isFinite(numericBalance) ? numericBalance : credits.balance.trim(),
        unit: 'credits',
        display: credits.balance.trim(),
        path: pathPrefix ? `${pathPrefix}.credits.balance` : 'credits.balance',
        limitId,
        limitName,
        credits: normalizedCredits,
        raw: credits,
      };
    }

    if (credits.hasCredits === false) {
      return {
        available: 0,
        unit: 'credits',
        display: '0',
        path: pathPrefix ? `${pathPrefix}.credits` : 'credits',
        limitId,
        limitName,
        credits: normalizedCredits,
        raw: credits,
      };
    }
  }

  return null;
}
