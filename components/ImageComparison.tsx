import React, { useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useImagePanZoom } from '../lib/imagePanZoom';
import type { GeneratedImageWithConfig } from '../types';

export function ImageComparison({
  images,
  onClose,
}: {
  images: [GeneratedImageWithConfig, GeneratedImageWithConfig];
  onClose: () => void;
}) {
  const dialog = useDialogFocus(true, onClose);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const fitted = useRef(false);
  const zoom = useImagePanZoom(true, images.map((image) => image.id).join(':'));
  const image = images[index];
  return (
    <dialog
      ref={dialog}
      aria-label="Compare 2 images"
      className="m-auto h-[90vh] w-[94vw] max-w-none rounded-xl border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] text-[color:var(--wb-ink)] backdrop:bg-black/70"
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Compare 2 images</h2>
          {images.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              className="studio-ghost-control rounded px-3 py-2"
              aria-pressed={index === itemIndex}
              onClick={() => {
                if (index === itemIndex) return;
                setStatus('loading');
                setIndex(itemIndex);
              }}
            >
              Image {itemIndex === 0 ? 'A' : 'B'}
            </button>
          ))}
          <button
            type="button"
            className="studio-ghost-control ml-auto rounded px-3 py-2"
            onClick={onClose}
          >
            Close comparison
          </button>
        </div>
        <p className="text-sm">
          Switch A and B to compare at the same zoom and position. Scroll to zoom; drag to pan.
        </p>
        <div
          ref={zoom.viewportRef}
          {...zoom.viewportProps}
          role="group"
          tabIndex={0}
          aria-label="Comparison image. Plus and minus zoom, arrows pan, zero fits."
          className="relative min-h-0 flex-1 overflow-hidden rounded bg-black/40 outline-offset-2"
        >
          <img
            ref={zoom.contentRef}
            src={image.sourceUrl ?? image.src}
            alt={`Image ${index === 0 ? 'A' : 'B'}: ${image.config.prompt || 'Selected result'}`}
            draggable={false}
            className={status === 'ready' ? '' : 'invisible'}
            onLoad={(event) => {
              const element = event.currentTarget;
              element.style.width = `${element.naturalWidth}px`;
              element.style.height = `${element.naturalHeight}px`;
              if (!fitted.current) {
                zoom.onImageLoad();
                fitted.current = true;
              }
              setStatus('ready');
            }}
            onError={() => setStatus('error')}
          />
          {status !== 'ready' && (
            <p
              role={status === 'error' ? 'alert' : 'status'}
              className="absolute inset-0 flex items-center justify-center"
            >
              {status === 'error'
                ? 'This original image could not be loaded. Try the other image or reopen the comparison.'
                : 'Loading original image…'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2"
            disabled={status !== 'ready'}
            onClick={zoom.zoomOut}
            aria-label="Zoom out comparison"
          >
            −
          </button>
          <span className="text-sm tabular-nums">{Math.round(zoom.scale * 100)}%</span>
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2"
            disabled={status !== 'ready'}
            onClick={zoom.zoomIn}
            aria-label="Zoom in comparison"
          >
            +
          </button>
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2"
            disabled={status !== 'ready'}
            onClick={zoom.fit}
          >
            Fit image
          </button>
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2"
            disabled={status !== 'ready'}
            onClick={zoom.actualSize}
          >
            Actual size
          </button>
          <p className="min-w-0 flex-1 truncate text-sm" title={image.config.prompt}>
            {image.config.prompt || 'Untitled image'}
          </p>
        </div>
      </div>
    </dialog>
  );
}
