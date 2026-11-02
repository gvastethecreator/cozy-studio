import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLatestRef } from './useLatestRef';

let scrollLocks = 0;
let previousOverflow = '';
const activeDialogs: HTMLDialogElement[] = [];
const dialogListeners = new Set<() => void>();

function subscribeDialogLayer(listener: () => void) {
  dialogListeners.add(listener);
  return () => {
    dialogListeners.delete(listener);
  };
}

/** Interactive overlays must belong to the active modal's native focus and paint layer. */
export function useDialogPortalHost() {
  return useSyncExternalStore(
    subscribeDialogLayer,
    () => activeDialogs.at(-1) ?? null,
    () => null,
  );
}

export function useDialogFocus<T extends HTMLDialogElement = HTMLDialogElement>(
  isOpen: boolean,
  onClose: () => void,
  returnFocusSelector?: string,
  initialFocusSelector?: string,
) {
  const ref = useRef<T>(null);
  const openerRef = useRef<Element | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const close = useLatestRef(onClose);
  useEffect(() => {
    if (!isOpen || !ref.current) return;
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current);
    const previous = openerRef.current ?? document.activeElement;
    openerRef.current = previous;
    const previousLabel = previous?.getAttribute('aria-label');
    const root = ref.current;
    if (!root.open) root.showModal();
    activeDialogs.push(root);
    for (const listener of dialogListeners) listener();
    const cancel = (event: Event) => {
      event.preventDefault();
      close.current();
    };
    root.addEventListener('cancel', cancel);
    if (scrollLocks++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const preferred = initialFocusSelector
      ? root.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    if (
      preferred &&
      !preferred.matches(':disabled') &&
      !preferred.closest('[inert]') &&
      preferred.getClientRects().length > 0
    )
      preferred.focus();
    return () => {
      root.removeEventListener('cancel', cancel);
      if (root.open) root.close();
      activeDialogs.splice(activeDialogs.lastIndexOf(root), 1);
      for (const listener of dialogListeners) listener();
      if (--scrollLocks === 0) document.body.style.overflow = previousOverflow;
      restoreFrameRef.current = requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        openerRef.current = null;
        // An exit can finish after the user has already focused another control.
        if (document.activeElement !== document.body && !root.contains(document.activeElement))
          return;
        if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected)
          previous.focus();
        else if (returnFocusSelector)
          document.querySelector<HTMLElement>(returnFocusSelector)?.focus();
        else if (previousLabel)
          document
            .querySelector<HTMLElement>(`[aria-label="${CSS.escape(previousLabel)}"]`)
            ?.focus();
      });
    };
  }, [isOpen, close, returnFocusSelector, initialFocusSelector]);
  return ref;
}
