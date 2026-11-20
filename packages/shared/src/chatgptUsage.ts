/**
 * The ChatGPT account usage state. When the usage window is used up, ChatGPT keeps running jobs
 * on the account's ChatGPT credits, which cost money. `/usage` reports no price per image.
 */
export type ChatgptUsageState = 'window' | 'credits' | 'exhausted' | 'unknown';

export interface ChatgptUsageStatus {
  state: ChatgptUsageState;
  /** Percent left in the tightest usage window; null when the account reports no window. */
  windowPercentLeft: number | null;
  /** The tightest window's label, such as `5h` or `Weekly`. */
  windowLabel: string | null;
  /** Unix seconds when the tightest window resets. */
  resetsAt: number | null;
  creditBalance: number | null;
  creditsUnlimited: boolean;
}

/** What Studio does when the next ChatGPT job would spend credits. */
export type ChatgptCreditSpendPolicy = 'ask' | 'use' | 'stop';

export const CHATGPT_CREDIT_SPEND_POLICIES: readonly ChatgptCreditSpendPolicy[] = [
  'ask',
  'use',
  'stop',
];

export const CHATGPT_CREDIT_SPEND_POLICY_LABELS: Record<ChatgptCreditSpendPolicy, string> = {
  ask: 'Ask before using credits',
  use: 'Use credits',
  stop: 'Stop at 0%',
};

export function isChatgptCreditSpendPolicy(value: unknown): value is ChatgptCreditSpendPolicy {
  return value === 'ask' || value === 'use' || value === 'stop';
}

/** Error codes for jobs that the credits policy or an exhausted account stops at intake. */
export const CHATGPT_CREDIT_CONFIRMATION_REQUIRED = 'chatgpt_credits_confirmation_required';
export const CHATGPT_CREDITS_STOPPED = 'chatgpt_credits_stopped';
export const CHATGPT_USAGE_EXHAUSTED = 'chatgpt_usage_exhausted';

export const UNKNOWN_CHATGPT_USAGE: ChatgptUsageStatus = {
  state: 'unknown',
  windowPercentLeft: null,
  windowLabel: null,
  resetsAt: null,
  creditBalance: null,
  creditsUnlimited: false,
};

export function formatChatgptUsageReset(resetsAt: number | null, now = Date.now()) {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return null;
  const minutes = Math.max(0, Math.ceil((resetsAt * 1000 - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function windowName(label: string | null) {
  if (!label) return 'usage window';
  if (label === '5h') return '5-hour window';
  return `${label.toLowerCase()} window`;
}

export function formatChatgptCreditBalance(status: ChatgptUsageStatus) {
  if (status.creditsUnlimited) return 'unlimited';
  // `/usage` reports the balance with many decimals; two are enough to read it.
  return status.creditBalance === null
    ? null
    : status.creditBalance.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export interface ChatgptUsageCopy {
  state: ChatgptUsageState;
  /** Short pill text: `62% left`, `Using credits`, `Limit reached`; null when unknown. */
  short: string | null;
  tone: 'ok' | 'warning' | 'danger' | 'neutral';
  /** One sentence for the composer, the setup row and the usage popover. */
  line: string | null;
  /** True when Studio stops ChatGPT jobs in this state with this policy. */
  blocksGeneration: boolean;
}

/** The one wording every surface uses for a usage state, so they never disagree. */
export function describeChatgptUsage(
  status: ChatgptUsageStatus,
  policy: ChatgptCreditSpendPolicy,
  now = Date.now(),
): ChatgptUsageCopy {
  const reset = formatChatgptUsageReset(status.resetsAt, now);
  const resets = reset ? ` Resets in ${reset}.` : '';
  const window = windowName(status.windowLabel);
  const usedUp =
    status.windowPercentLeft === null
      ? 'This account has no usage window left.'
      : `The ${window} is used up.`;
  switch (status.state) {
    case 'window': {
      const left = Math.round(status.windowPercentLeft ?? 0);
      return {
        state: 'window',
        short: `${left}% left`,
        tone: 'ok',
        line: `${left}% of the ${window} left.`,
        blocksGeneration: false,
      };
    }
    case 'credits': {
      const balance = formatChatgptCreditBalance(status);
      const spend = `ChatGPT jobs now spend credits, which cost money${balance ? ` (balance ${balance})` : ''}.`;
      if (policy === 'stop')
        return {
          state: 'credits',
          short: 'Stopped at 0%',
          tone: 'danger',
          line: `${usedUp} Settings stop ChatGPT jobs instead of spending credits.${resets}`,
          blocksGeneration: true,
        };
      return {
        state: 'credits',
        short: 'Using credits',
        tone: 'warning',
        line: `${usedUp} ${spend}${policy === 'ask' ? ' Studio asks before each batch.' : ''}${resets}`,
        blocksGeneration: false,
      };
    }
    case 'exhausted':
      return {
        state: 'exhausted',
        short: 'Limit reached',
        tone: 'danger',
        line: `ChatGPT limit reached and no credits are left.${resets}`,
        blocksGeneration: true,
      };
    default:
      return {
        state: 'unknown',
        short: null,
        tone: 'neutral',
        line: null,
        blocksGeneration: false,
      };
  }
}
