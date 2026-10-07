import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './motionPreference';

const LERP_FACTOR = 0.32;
export const IMAGE_PAN_ZOOM_MIN_SCALE = 0.2;
export const IMAGE_PAN_ZOOM_MAX_SCALE = 15;
export const IMAGE_PAN_ZOOM_ACTUAL_SCALE = 1;

function lerp(start: number, end: number, factor: number) {
  return start + (end - start) * factor;
}

export function clampImagePanZoomScale(scale: number, minScale = IMAGE_PAN_ZOOM_MIN_SCALE) {
  return Math.min(Math.max(scale, minScale), IMAGE_PAN_ZOOM_MAX_SCALE);
}

export function nextImageWheelScale(
  scale: number,
  deltaY: number,
  minScale = IMAGE_PAN_ZOOM_MIN_SCALE,
) {
  if (deltaY === 0) return scale;
  return clampImagePanZoomScale(scale + (deltaY < 0 ? 1 : -1) * 0.25 * scale, minScale);
}

export function imageFitScale(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  if (imageWidth <= 0 || imageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0)
    return IMAGE_PAN_ZOOM_ACTUAL_SCALE;
  return Math.min(
    viewportWidth / imageWidth,
    viewportHeight / imageHeight,
    IMAGE_PAN_ZOOM_MAX_SCALE,
  );
}

export function useImagePanZoom(enabled: boolean, imageKey?: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLImageElement>(null);
  const target = useRef({ x: 0, y: 0, scale: IMAGE_PAN_ZOOM_ACTUAL_SCALE });
  const current = useRef({ x: 0, y: 0, scale: IMAGE_PAN_ZOOM_ACTUAL_SCALE });
  const fitScale = useRef(IMAGE_PAN_ZOOM_ACTUAL_SCALE);
  const autoFit = useRef(true);
  const dragStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const rafId = useRef<number | null>(null);
  const [scale, setScale] = useState(IMAGE_PAN_ZOOM_ACTUAL_SCALE);

  const animate = useCallback(() => {
    rafId.current = null;
    if (!enabled) return;
    const factor = prefersReducedMotion() ? 1 : LERP_FACTOR;
    current.current.scale = lerp(current.current.scale, target.current.scale, factor);
    current.current.x = lerp(current.current.x, target.current.x, factor);
    current.current.y = lerp(current.current.y, target.current.y, factor);

    const isStillMoving =
      Math.abs(target.current.scale - current.current.scale) > 0.0005 ||
      Math.abs(target.current.x - current.current.x) > 0.05 ||
      Math.abs(target.current.y - current.current.y) > 0.05;

    if (isStillMoving) {
      rafId.current = requestAnimationFrame(animate);
    } else {
      current.current = { ...target.current };
    }

    if (contentRef.current) {
      contentRef.current.style.transform = `translate(-50%, -50%) translate3d(${current.current.x}px, ${current.current.y}px, 0) scale(${current.current.scale})`;
    }
    setScale(current.current.scale);
  }, [enabled]);

  const startAnimation = useCallback(() => {
    if (rafId.current === null && enabled) rafId.current = requestAnimationFrame(animate);
  }, [animate, enabled]);

  const setZoom = useCallback(
    (nextScale: number, point = { x: 0, y: 0 }) => {
      autoFit.current = false;
      const clampedScale = clampImagePanZoomScale(
        nextScale,
        Math.min(IMAGE_PAN_ZOOM_MIN_SCALE, fitScale.current * 0.2),
      );
      const ratio = clampedScale / target.current.scale;
      target.current.x = point.x - (point.x - target.current.x) * ratio;
      target.current.y = point.y - (point.y - target.current.y) * ratio;
      target.current.scale = clampedScale;
      startAnimation();
    },
    [startAnimation],
  );

  const reset = useCallback(() => {
    autoFit.current = true;
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = null;
    isDragging.current = false;
    const image = contentRef.current;
    const viewport = viewportRef.current;
    if (image?.naturalWidth && image.naturalHeight && viewport) {
      Object.assign(image.style, {
        position: 'absolute',
        left: '50%',
        top: '50%',
        right: 'auto',
        bottom: 'auto',
        width: `${image.naturalWidth}px`,
        height: `${image.naturalHeight}px`,
        maxWidth: 'none',
        maxHeight: 'none',
        transformOrigin: 'center',
      });
      fitScale.current = imageFitScale(
        image.naturalWidth,
        image.naturalHeight,
        viewport.clientWidth,
        viewport.clientHeight,
      );
    } else fitScale.current = IMAGE_PAN_ZOOM_ACTUAL_SCALE;
    target.current = { x: 0, y: 0, scale: fitScale.current };
    current.current = { ...target.current };
    if (contentRef.current)
      contentRef.current.style.transform = `translate(-50%, -50%) translate3d(0px, 0px, 0) scale(${fitScale.current})`;
    if (viewportRef.current) viewportRef.current.style.cursor = '';
    setScale(fitScale.current);
  }, []);

  const zoomIn = useCallback(() => setZoom(target.current.scale * 1.25), [setZoom]);
  const zoomOut = useCallback(() => setZoom(target.current.scale / 1.25), [setZoom]);
  const actualSize = useCallback(() => setZoom(IMAGE_PAN_ZOOM_ACTUAL_SCALE), [setZoom]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.button !== 0) {
        return;
      }
      event.preventDefault();
      const viewport = event.currentTarget as HTMLElement;
      viewport.focus({ preventScroll: true });
      viewport.style.cursor = 'grabbing';
      isDragging.current = true;
      dragStart.current = {
        x: event.clientX - target.current.x,
        y: event.clientY - target.current.y,
      };
      viewport.setPointerCapture(event.pointerId);
    },
    [enabled],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || !isDragging.current) return;
      autoFit.current = false;
      target.current.x = event.clientX - dragStart.current.x;
      target.current.y = event.clientY - dragStart.current.y;
      startAnimation();
    },
    [enabled, startAnimation],
  );

  const finishPointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = false;
    event.currentTarget.style.cursor = '';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useLayoutEffect(() => {
    reset();
    const viewport = viewportRef.current;
    const observer =
      enabled && viewport && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (autoFit.current) reset();
            else {
              const image = contentRef.current;
              if (image)
                fitScale.current = imageFitScale(
                  image.naturalWidth,
                  image.naturalHeight,
                  viewport.clientWidth,
                  viewport.clientHeight,
                );
            }
          })
        : null;
    if (viewport) observer?.observe(viewport);
    return () => {
      observer?.disconnect();
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
      isDragging.current = false;
    };
  }, [enabled, imageKey, reset]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!enabled || !viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      setZoom(
        nextImageWheelScale(
          target.current.scale,
          event.deltaY,
          Math.min(IMAGE_PAN_ZOOM_MIN_SCALE, fitScale.current * 0.2),
        ),
        {
          x: event.clientX - rect.left - rect.width / 2,
          y: event.clientY - rect.top - rect.height / 2,
        },
      );
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [enabled, setZoom]);

  return {
    viewportRef,
    contentRef,
    scale,
    get fitScale() {
      return fitScale.current;
    },
    setZoom,
    actualSize,
    onImageLoad: reset,
    zoomIn,
    zoomOut,
    reset,
    fit: reset,
    viewportProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishPointerDrag,
      onPointerCancel: finishPointerDrag,
      onLostPointerCapture: finishPointerDrag,
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!enabled || event.target !== event.currentTarget) return;
        const step = event.shiftKey ? 80 : 32;
        if (event.key === '+' || event.key === '=') zoomIn();
        else if (event.key === '-' || event.key === '_') zoomOut();
        else if (event.key === '0' || event.key === 'Escape') reset();
        else if (event.key === 'ArrowLeft') target.current.x -= step;
        else if (event.key === 'ArrowRight') target.current.x += step;
        else if (event.key === 'ArrowUp') target.current.y -= step;
        else if (event.key === 'ArrowDown') target.current.y += step;
        else return;
        if (event.key.startsWith('Arrow')) autoFit.current = false;
        event.preventDefault();
        event.stopPropagation();
        startAnimation();
      },
    },
  };
}
