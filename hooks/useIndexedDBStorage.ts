import { useState, useEffect, useCallback, useRef } from 'react';
import { get, set } from '../utils/idb';
import { runtimeLogger } from '../utils/runtimeLogger';

/**
 * A custom hook to manage state persistence in IndexedDB.
 * Includes debouncing for the database write operation to improve performance
 * during rapid state changes.
 *
 * @template T The type of the state to be stored.
 * @param {string} key The key to use in the IndexedDB key-value store.
 * @param {T} initialValue The initial value to use if no value is found in IndexedDB.
 * @returns A stateful value, and a function to update it, analogous to `useState`.
 */
interface IDBState<T> {
  value: T;
  initialized: boolean;
}

export interface DraftPersistence {
  error: string | null;
  retry: () => Promise<void>;
}

function useIndexedDBStorage<T>(
  key: string,
  initialValue: T,
  options: {
    prepareForPersist?: (value: T) => T;
    recoverAfterRead?: (loaded: T | undefined, edited: T) => T;
  } = {},
): [T, (value: T | ((val: T) => T)) => void, boolean, DraftPersistence] {
  const [state, setState] = useState<IDBState<T>>({ value: initialValue, initialized: false });
  const [error, setError] = useState<string | null>(null);
  const readFailed = useRef(false);
  const edited = useRef(false);
  const latest = useRef(state.value);
  const saveAttempt = useRef(0);
  latest.current = state.value;
  const prepareForPersist = options.prepareForPersist;
  const recoverAfterRead = options.recoverAfterRead;

  const persist = useCallback(async () => {
    const attempt = ++saveAttempt.current;
    try {
      if (readFailed.current) {
        const loaded = await get<T>(key);
        if (!edited.current) {
          readFailed.current = false;
          setState({ value: loaded !== undefined ? loaded : initialValue, initialized: true });
          if (attempt === saveAttempt.current) setError(null);
          return;
        }
        if (!recoverAfterRead) {
          setError(
            'Saved draft was read again. Keep a copy of your current edits before reloading to restore it.',
          );
          return;
        }
        latest.current = recoverAfterRead(loaded, latest.current);
        readFailed.current = false;
        setState({ value: latest.current, initialized: true });
      }
      await set(key, prepareForPersist ? prepareForPersist(latest.current) : latest.current);
      if (attempt === saveAttempt.current) setError(null);
    } catch (failure) {
      runtimeLogger.error(`Error saving IndexedDB key "${key}"`, failure);
      if (attempt === saveAttempt.current)
        setError('Draft could not be saved on this device. Keep a copy before closing this tab.');
    }
  }, [key, initialValue, prepareForPersist, recoverAfterRead]);

  useEffect(() => {
    let isMounted = true;
    readFailed.current = false;
    edited.current = false;
    get<T>(key)
      .then((loaded) => {
        if (isMounted) {
          setState({
            value: loaded !== undefined ? loaded : initialValue,
            initialized: true,
          });
          setError(null);
        }
      })
      .catch((error) => {
        runtimeLogger.error(`Error reading IndexedDB key "${key}"`, error);
        if (isMounted) {
          readFailed.current = true;
          setError('Saved draft could not be read. Retry or keep a copy before closing this tab.');
          setState((prev) => ({ ...prev, initialized: true }));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [key, initialValue]);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        edited.current = true;
        setState((prev) => ({
          ...prev,
          value: value instanceof Function ? value(prev.value) : value,
        }));
      } catch (error) {
        runtimeLogger.error(`Error updating IndexedDB-backed state for "${key}"`, error);
      }
    },
    [key],
  );

  useEffect(() => {
    if (!state.initialized || readFailed.current) return;
    const timeout = window.setTimeout(() => void persist(), 300);
    return () => clearTimeout(timeout);
  }, [persist, state.value, state.initialized]);

  return [state.value, setValue, state.initialized, { error, retry: persist }];
}

export default useIndexedDBStorage;
