import {
  CHATGPT_CREDIT_CONFIRMATION_REQUIRED,
  type ChatgptUsageStatus,
} from '../packages/shared/src/chatgptUsage';
import { StudioApiError } from './studio-api/http';

/** Asks the user whether a ChatGPT batch may spend credits; resolves true to spend. */
export type CreditSpendConfirmer = (request: {
  usage: ChatgptUsageStatus | null;
  message: string;
}) => Promise<boolean>;

let confirmer: CreditSpendConfirmer | null = null;

/** The UI registers its dialog here; services call it when Studio asks before spending. */
export function registerCreditSpendConfirmer(next: CreditSpendConfirmer) {
  confirmer = next;
  return () => {
    if (confirmer === next) confirmer = null;
  };
}

export class CreditSpendDeclinedError extends Error {
  constructor() {
    super('Cancelled: ChatGPT credits were not used.');
    this.name = 'CreditSpendDeclinedError';
  }
}

function readUsage(payload: Record<string, unknown> | null): ChatgptUsageStatus | null {
  const usage = payload?.usage;
  return usage && typeof usage === 'object' ? (usage as ChatgptUsageStatus) : null;
}

/**
 * Sends a request once without credit consent. When Studio answers that the jobs would spend
 * ChatGPT credits, asks the user once and repeats the request with consent.
 */
export async function withCreditSpendConfirmation<T>(
  send: (confirmCreditSpend: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await send(false);
  } catch (error) {
    if (
      !(error instanceof StudioApiError) ||
      error.code !== CHATGPT_CREDIT_CONFIRMATION_REQUIRED ||
      !confirmer
    )
      throw error;
    const confirmed = await confirmer({ usage: readUsage(error.payload), message: error.message });
    if (!confirmed) throw new CreditSpendDeclinedError();
    return send(true);
  }
}
