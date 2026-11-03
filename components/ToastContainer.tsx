import { AnimatePresence } from '../lib/gsapMotion';
import React from 'react';
import { createPortal } from 'react-dom';
import { useToastList, useToastUi } from '../contexts/ToastUiContext';
import { useDialogPortalHost } from '../hooks/useDialogFocus';
import Toast from './Toast';

/**
 * Leaf toast list consumer. Subscribes to the toast store so toast appends do
 * not re-render WorkspaceProvider / useStudioShell.
 */
const ToastContainer: React.FC = () => {
  const { toasts } = useToastList();
  const { removeToast } = useToastUi();
  const dialog = useDialogPortalHost();

  return createPortal(
    <div
      className={`fixed right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3 ${
        dialog ? 'top-20' : 'top-[calc(var(--studio-mobile-header-height)+1rem)] sm:top-16'
      }`}
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </AnimatePresence>
    </div>,
    dialog ?? document.body,
  );
};

export default ToastContainer;
