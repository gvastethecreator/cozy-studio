export type MotionPreference = 'system' | 'reduced';
export const MOTION_CHANGE_EVENT = 'studio-motion-change';
export function prefersReducedMotion() {
  return (
    typeof document !== 'undefined' &&
    (document.documentElement.dataset.motion === 'reduced' ||
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  );
}

/** GSAP curve for the CSS `--ease-ui` token, cubic-bezier(0.22, 1, 0.36, 1). */
export const MOTION_EASE = 'power3.out';
/** Reduced motion keeps only a short opacity fade with this curve. */
export const REDUCED_MOTION_EASE = 'power1.out';

const MOTION_DURATION_FALLBACK_MS = { '--dur-fast': 120, '--dur-base': 180 } as const;

/** Read a CSS duration token from `styles/studio-foundation.css`, in seconds. */
export function motionDuration(token: keyof typeof MOTION_DURATION_FALLBACK_MS) {
  const fallback = MOTION_DURATION_FALLBACK_MS[token];
  if (typeof document === 'undefined') return fallback / 1000;
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(token),
  );
  return (Number.isFinite(value) && value > 0 ? value : fallback) / 1000;
}
