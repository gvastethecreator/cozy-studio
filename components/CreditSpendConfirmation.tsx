import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatChatgptCreditBalance,
  formatChatgptUsageReset,
  type ChatgptUsageStatus,
} from '../packages/shared/src/chatgptUsage';
import { registerCreditSpendConfirmer } from '../services/creditSpendConfirmation';
import { ConfirmationModal } from './ConfirmationModal';

interface PendingCreditSpend {
  usage: ChatgptUsageStatus | null;
}

/**
 * Asks once per batch before ChatGPT jobs spend credits (credits policy `ask`). The server sends
 * the usage it read when it refused the batch, so the balance here is fresh.
 */
export function CreditSpendConfirmation() {
  const [pending, setPending] = useState<PendingCreditSpend | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setPending(null);
  }, []);

  useEffect(
    () =>
      registerCreditSpendConfirmer(
        ({ usage }) =>
          new Promise<boolean>((resolve) => {
            // A newer request replaces an open one; the older batch is not sent.
            resolveRef.current?.(false);
            resolveRef.current = resolve;
            setPending({ usage });
          }),
      ),
    [],
  );
  useEffect(() => () => resolveRef.current?.(false), []);

  const usage = pending?.usage ?? null;
  const balance = usage ? formatChatgptCreditBalance(usage) : null;
  const reset = usage ? formatChatgptUsageReset(usage.resetsAt) : null;
  return (
    <ConfirmationModal
      isOpen={pending !== null}
      title="Spend ChatGPT credits?"
      description="The ChatGPT usage window is used up. This batch will spend the account's ChatGPT credits, which cost money."
      details={[
        balance ? `Credit balance: ${balance}` : 'ChatGPT did not report a credit balance.',
        ...(reset ? [`The window resets in ${reset}.`] : []),
      ]}
      note='ChatGPT does not report a price per image. To change this, open Settings > Accounts & models > "When the ChatGPT window is used up".'
      confirmLabel="Spend credits"
      cancelLabel="Don't spend"
      tone="warning"
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
    />
  );
}
