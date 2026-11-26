/**
 * Live Antigravity CLI quota & credits snapshot read via zero-quota print commands
 * (`agy -p "/usage" --output-format json` and `agy -p "/credits" --output-format json`).
 */
export interface AntigravityUsageBucket {
  id: string;
  label: string;
  window: string;
  remainingPercent: number;
  resetTime: string | null;
}

export interface AntigravityUsageStatus {
  available: boolean;
  checkedAt: string;
  /** Lowest remaining percentage across active Gemini buckets, or null when unavailable. */
  tightestPercentLeft: number | null;
  tightestWindowLabel: string | null;
  resetsAt: number | null;
  buckets: AntigravityUsageBucket[];
  remainingCredits: number | null;
  upgradeUri: string | null;
  error: string | null;
}

export const UNKNOWN_ANTIGRAVITY_USAGE: AntigravityUsageStatus = {
  available: false,
  checkedAt: new Date(0).toISOString(),
  tightestPercentLeft: null,
  tightestWindowLabel: null,
  resetsAt: null,
  buckets: [],
  remainingCredits: null,
  upgradeUri: null,
  error: null,
};

export function formatAntigravityWindowLabel(window: string | null | undefined) {
  if (!window) return 'Quota';
  if (window === '5h') return '5h';
  if (window === 'weekly') return 'Weekly';
  return window;
}
