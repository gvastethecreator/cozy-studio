import { useEffect, useSyncExternalStore } from 'react';
import {
  getInstalledStylePacksVersion,
  reloadInstalledStylePacks,
  reloadInstalledStylePacksOnReconnect,
  subscribeInstalledStylePacks,
} from '../lib/installedStylePacks';
import { createStudioEventStream } from '../services/studioEventSource';

/** Keeps the installed style pack list current while the app is open; mount it once at the root. */
export function useInstalledStylePacksSync() {
  useEffect(() => {
    const stream = createStudioEventStream();
    const stop = reloadInstalledStylePacksOnReconnect((listener) =>
      stream.onConnectionChange(listener),
    );
    // A local source folder can change while the tab is open, such as a rebuilt style pack.
    const onFocus = () => void reloadInstalledStylePacks().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => {
      stop();
      stream.close();
      window.removeEventListener('focus', onFocus);
    };
  }, []);
}

/** Changes whenever the installed pack list does; use it as a `key` to remount style surfaces. */
export function useInstalledStylePacksVersion() {
  return useSyncExternalStore(subscribeInstalledStylePacks, getInstalledStylePacksVersion);
}
