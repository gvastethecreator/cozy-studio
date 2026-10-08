import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLatestRef } from '../../hooks/useLatestRef';

export function TooltipBubble({
  anchor,
  content,
  id,
  position = 'top',
  className = '',
  delay = 300,
}: {
  anchor: HTMLElement | null;
  content: React.ReactNode;
  id: string;
  position?: 'top' | 'bottom';
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latestContent = useLatestRef(content);
  const [shown, setShown] = useState<{ anchor: HTMLElement; content: React.ReactNode } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    const timer = window.setTimeout(
      () => {
        if (anchor?.isConnected) {
          setShown({ anchor, content: latestContent.current });
          setVisible(true);
        } else setShown(null);
      },
      anchor ? delay : 140,
    );
    return () => window.clearTimeout(timer);
  }, [anchor, delay, latestContent]);
  const displayedAnchor = shown?.anchor;
  const displayedContent = anchor === displayedAnchor ? content : shown?.content;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !displayedAnchor) return;
    const anchor = displayedAnchor;
    let frameId = 0;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const below =
        position === 'bottom' ? rect.bottom + height + 8 < innerHeight : rect.top < height + 12;
      node.dataset.side = below ? 'bottom' : 'top';
      node.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left + (rect.width - width) / 2))}px`;
      node.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, below ? rect.bottom + 8 : rect.top - height - 8))}px`;
    };
    const scheduleUpdate = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        update();
      });
    };
    update();
    const oldDescription = anchor.getAttribute('aria-describedby');
    if (visible)
      anchor.setAttribute('aria-describedby', [oldDescription, id].filter(Boolean).join(' '));
    window.addEventListener('resize', scheduleUpdate);
    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    return () => {
      if (oldDescription) anchor.setAttribute('aria-describedby', oldDescription);
      else anchor.removeAttribute('aria-describedby');
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleUpdate);
      document.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [displayedAnchor, displayedContent, id, position, visible]);
  if (!displayedAnchor?.isConnected) return null;
  const fullscreen = document.fullscreenElement;
  const owner =
    fullscreen && fullscreen.contains(displayedAnchor)
      ? fullscreen
      : (displayedAnchor.closest('dialog[open], [role="dialog"]') ?? document.body);
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      aria-hidden={!visible}
      data-open={visible}
      className={`studio-tooltip ${className}`}
    >
      {displayedContent}
    </div>,
    owner,
  );
}
