import { useCallback, useEffect, useState } from 'react';
import { useLatestRef } from './useLatestRef';
import { prefersReducedMotion } from '../lib/motionPreference';

// Keep the visible image and its metadata together until the next original is decoded.
export function useImagePresentation<T>(value: T, src?: string, scope?: string) {
  const latestValue = useLatestRef(value);
  const [shown, setShown] = useState({
    value,
    src,
    scope,
    width: 0,
    height: 0,
    failed: false,
    previousSrc: undefined as string | undefined,
  });
  const latestShown = useLatestRef(shown);
  const currentScope = shown.scope === scope;
  const presented = currentScope
    ? shown
    : { value, src, scope, width: 0, height: 0, failed: false, previousSrc: undefined };

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    const commit = (failed: boolean) => {
      if (cancelled) return;
      const previous = latestShown.current;
      const retainedSrc = previous.previousSrc ?? previous.src;
      const previousSrc =
        !failed &&
        src &&
        previous.src &&
        src !== previous.src &&
        previous.scope === scope &&
        retainedSrc !== src &&
        !prefersReducedMotion()
          ? retainedSrc
          : undefined;
      setShown({
        value: latestValue.current,
        src,
        scope,
        failed,
        width: failed ? 0 : image.naturalWidth,
        height: failed ? 0 : image.naturalHeight,
        previousSrc,
      });
    };
    if (src) {
      image.onload = () => {
        void image.decode().then(
          () => commit(false),
          () => commit(true),
        );
      };
      image.onerror = () => commit(true);
      image.src = src;
    } else commit(false);
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, scope, latestValue, latestShown]);

  const finishTransition = useCallback(() => {
    setShown((current) => (current.previousSrc ? { ...current, previousSrc: undefined } : current));
  }, []);

  return {
    ...presented,
    value: presented.src === src ? value : presented.value,
    pending: presented.src !== src,
    finishTransition,
  };
}
