import ReactDOM from 'react-dom/client';
import React from 'react';
import { NuqsAdapter } from 'nuqs/adapters/react';
import App from './App';
import { loadInstalledStylePacks } from './lib/installedStylePacks';
import { registerDisabledWorkflowModules } from './lib/workflowModuleState';
import { setLanguage, useT } from './lib/i18n';
import { getEditableStudioSettings } from './services/studio-api/settings';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

// Style surfaces read installed pack summaries, navigation reads which workflow modules are on,
// and the UI reads its language, synchronously, so load them before mounting. If the backend is
// unreachable the catalogue starts empty, every module stays on, the UI stays in English and the
// app still mounts.
const settingsLoaded = getEditableStudioSettings().then((settings) => {
  registerDisabledWorkflowModules(settings.disabledWorkflowModules);
  setLanguage(settings.language);
});
// Re-renders the tree when the language changes. Memoized components call useT() themselves.
function LocalizedApp() {
  useT();
  return <App />;
}

void Promise.allSettled([loadInstalledStylePacks(), settingsLoaded]).finally(() => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <NuqsAdapter>
        <LocalizedApp />
      </NuqsAdapter>
    </React.StrictMode>,
  );
});
