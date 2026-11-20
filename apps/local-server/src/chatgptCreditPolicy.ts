import {
  CHATGPT_CREDIT_CONFIRMATION_REQUIRED,
  CHATGPT_CREDITS_STOPPED,
  CHATGPT_USAGE_EXHAUSTED,
  describeChatgptUsage,
  formatChatgptCreditBalance,
  type ChatgptCreditSpendPolicy,
  type ChatgptUsageStatus,
} from '../../../packages/shared/src/chatgptUsage';

export interface ChatgptCreditSpendBlock {
  error: string;
  code:
    | typeof CHATGPT_CREDIT_CONFIRMATION_REQUIRED
    | typeof CHATGPT_CREDITS_STOPPED
    | typeof CHATGPT_USAGE_EXHAUSTED;
  usage: ChatgptUsageStatus;
  creditPolicy: ChatgptCreditSpendPolicy;
}

/**
 * Applies the credits policy to a ChatGPT job before it is queued. An unknown state does not
 * block: a failed `/usage` read must not stop work, and ChatGPT still enforces its own limit.
 */
export function checkChatgptCreditSpend({
  usage,
  policy,
  confirmed,
  now = Date.now(),
}: {
  usage: ChatgptUsageStatus;
  policy: ChatgptCreditSpendPolicy;
  confirmed: boolean;
  now?: number;
}): ChatgptCreditSpendBlock | null {
  const copy = describeChatgptUsage(usage, policy, now);
  const block = (code: ChatgptCreditSpendBlock['code'], error: string) => ({
    error,
    code,
    usage,
    creditPolicy: policy,
  });
  if (usage.state === 'exhausted')
    return block(
      CHATGPT_USAGE_EXHAUSTED,
      `${copy.line} Wait for the reset or add ChatGPT credits to the account.`,
    );
  if (usage.state !== 'credits' || policy === 'use') return null;
  if (policy === 'stop')
    return block(
      CHATGPT_CREDITS_STOPPED,
      `${copy.line} Wait for the reset, or change "When the ChatGPT window is used up" in Studio Settings.`,
    );
  if (confirmed) return null;
  const balance = formatChatgptCreditBalance(usage);
  return block(
    CHATGPT_CREDIT_CONFIRMATION_REQUIRED,
    `The ChatGPT usage window is used up. This job would spend ChatGPT credits, which cost money${balance ? ` (balance ${balance})` : ''}. Confirm the credit spend to queue it.`,
  );
}
