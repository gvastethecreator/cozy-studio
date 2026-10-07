import { useId, useLayoutEffect, useMemo, useRef, type HTMLAttributes } from 'react';
import { gsap } from 'gsap';
import fullSvg from '../assets/brand/cozy.svg?raw';
import compactSvg from '../assets/brand/cozy-compact.svg?raw';
import { MOTION_CHANGE_EVENT, prefersReducedMotion } from '../lib/motionPreference';

export function CozyStatusCup({ healthy }: { healthy: boolean }) {
  return (
    <svg width="24" height="20" viewBox="0 0 28 23" fill="none" aria-hidden="true">
      <path d="M21 5h2a4 4 0 0 1 0 8h-2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M2 4h19v9a8 8 0 0 1-8 8h-3a8 8 0 0 1-8-8Z"
        fill="currentColor"
        fillOpacity=".18"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <ellipse cx="11.5" cy="4" rx="9.5" ry="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="11" r="1.2" fill="currentColor" />
      <path
        d={healthy ? 'M8 15Q11.5 19 15 15' : 'M8 17Q11.5 13 15 17'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CozyMascot({
  size = 160,
  compact = false,
  state = 'welcome',
  className = '',
}: {
  size?: number | string;
  compact?: boolean;
  state?: 'waiting' | 'working' | 'welcome' | 'success';
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const id = useId().replaceAll(':', '');
  const svg = useMemo(() => {
    let source = compact ? compactSvg : fullSvg;
    const ids = [...source.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    for (const name of ids)
      source = source
        .replaceAll(`id="${name}"`, `id="${id}-${name}"`)
        .replaceAll(`url(#${name})`, `url(#${id}-${name})`);
    return source;
  }, [compact, id]);
  useLayoutEffect(() => {
    if (!root.current) return;
    const element = root.current;
    let visible = true;
    let context: gsap.Context | undefined;
    let timeline: gsap.core.Timeline | undefined;
    const pause = () => {
      timeline?.paused(!visible || document.hidden || prefersReducedMotion());
    };
    const animate = () => {
      context?.revert();
      if (prefersReducedMotion()) return;
      context = gsap.context(() => {
        timeline = gsap.timeline({
          repeat: state === 'waiting' || state === 'working' ? -1 : 0,
          repeatDelay: 0.2,
        });
        const steam = element.querySelectorAll('[data-part^="steam-"]');
        timeline
          .to(steam, { y: -14, opacity: 0.65, duration: 0.85, stagger: 0.12, ease: 'sine.inOut' })
          .to(steam, { y: 0, opacity: 1, duration: 0.85, stagger: 0.12, ease: 'sine.inOut' });
        if (!compact)
          timeline.fromTo(
            element.querySelector('[id$="-torso"]'),
            { y: 0 },
            {
              y: state === 'success' ? -15 : -5,
              yoyo: true,
              repeat: 1,
              duration: 0.6,
              ease: 'sine.inOut',
            },
            0,
          );
        if (!compact && state === 'welcome') {
          const pencil = element.querySelector('[id$="-pencil-carrier"]');
          const eyes = element.querySelectorAll('[data-part^="eye-"]');
          const drawing = element.querySelector('[id$="-ink-drawing"]');
          timeline
            .to(
              pencil,
              { rotation: '-=16', transformOrigin: '50% 85%', duration: 0.28, ease: 'power2.out' },
              0,
            )
            .to(pencil, { rotation: '+=16', duration: 0.32, ease: 'sine.inOut' }, 0.28)
            .to(
              eyes,
              { scaleY: 0.12, transformOrigin: '50% 50%', duration: 0.08, repeat: 1, yoyo: true },
              0.42,
            )
            .to(drawing, { opacity: 1, duration: 0.2 }, 0.6)
            .fromTo(
              drawing?.querySelectorAll('path') ?? [],
              { strokeDasharray: 100, strokeDashoffset: 100 },
              { strokeDashoffset: 0, duration: 0.5, stagger: 0.12, ease: 'power1.inOut' },
              0.6,
            );
        }
      }, element);
      pause();
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            pause();
          });
    observer?.observe(element);
    document.addEventListener('visibilitychange', pause);
    window.addEventListener(MOTION_CHANGE_EVENT, animate);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    media?.addEventListener('change', animate);
    animate();
    return () => {
      observer?.disconnect();
      context?.revert();
      document.removeEventListener('visibilitychange', pause);
      window.removeEventListener(MOTION_CHANGE_EVENT, animate);
      media?.removeEventListener('change', animate);
    };
  }, [compact, state, svg]);
  return (
    <span
      ref={root}
      aria-hidden="true"
      className={`cozy-mascot ${compact ? 'is-compact' : ''} ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function CozyLoader({
  size = 20,
  className = '',
  strokeWidth: _strokeWidth,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { size?: number | string; strokeWidth?: number | string }) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={`cozy-loader ${className.replace(/(?:[\w-]+:)*animate-spin/g, '')}`}
    >
      <CozyMascot size={size} compact state="working" />
    </span>
  );
}
