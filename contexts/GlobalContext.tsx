import React, { type ReactNode } from 'react';
import { ToastUiProvider } from './ToastUiContext';
import { RuntimeLogProvider } from './RuntimeLogContext';
import { WorkspaceProvider } from './WorkspaceContext';

export const GlobalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <ToastUiProvider>
      <RuntimeLogProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </RuntimeLogProvider>
    </ToastUiProvider>
  );
};

export { useWorkspaceState } from './WorkspaceContext';
export { useRuntimeLogActions, useRuntimeLogs } from './RuntimeLogContext';
export { useToastUi, useToastList } from './ToastUiContext';
