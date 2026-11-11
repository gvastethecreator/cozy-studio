import { AnimatePresence } from '../lib/gsapMotion';
import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useToastList, useToastUi } from '../contexts/ToastUiContext';
import { useDialogPortalHost } from '../hooks/useDialogFocus';
import Toast from './Toast';

function subscribeFullscreen(listener: () => void) {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
}

/**
 * Leaf toast list consumer. Subscribes to the toast store so toast appends do
 * not re-render WorkspaceProvider / useStudioShell.
 */
const ToastContainer: React.FC = () => {
  const { toasts } = useToastList();
  const { removeToast } = useToastUi();
  const dialog = useDialogPortalHost();
  const fullscreen = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement,
    () => null,
  );
  // The viewer enters fullscreen inside its dialog; another modal may open above it.
  const overlay = dialog && !dialog.contains(fullscreen) ? dialog : (fullscreen ?? dialog);

  return createPortal(
    <div
      role="region"
      aria-label="Notifications"
      className={`pointer-events-none fixed right-4 z-[200] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3 ${
        overlay ? 'top-20' : 'top-[calc(var(--studio-mobile-header-height)+1rem)] sm:top-16'
      }`}
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </AnimatePresence>
    </div>,
    overlay ?? document.body,
  );
};

export default ToastContainer;
