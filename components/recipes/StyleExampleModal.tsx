import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, Xmark, Minus, Plus } from 'iconoir-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useImagePanZoom } from '../../lib/imagePanZoom';
import { useToastUi } from '../../contexts/GlobalContext';
import { downloadImage } from '../../utils/fileUtils';

export interface StyleExample {
  src: string;
  thumbnail: string;
  label: string;
  prompt: string;
  promptLabel: string;
  metadata: Record<string, unknown>;
}

export function StyleExampleModal({
  example,
  onClose,
}: {
  example: StyleExample;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus(true, onClose);
  const panZoom = useImagePanZoom(true, example.src);
  const { addToast } = useToastUi();
  const [dimensions, setDimensions] = useState('');
  const [error, setError] = useState(false);
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={example.label}
      className="studio-modal style-example-modal"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="studio-bar">
        <strong>{example.label}</strong>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Zoom out" onClick={panZoom.zoomOut}>
            <Minus width={16} />
          </button>
          <button type="button" aria-label="Actual size" onClick={panZoom.actualSize}>
            100%
          </button>
          <button type="button" aria-label="Fit image" onClick={panZoom.fit}>
            Fit
          </button>
          <button type="button" aria-label="Zoom in" onClick={panZoom.zoomIn}>
            <Plus width={16} />
          </button>
          <button
            type="button"
            aria-label="Download image"
            onClick={() => {
              void downloadImage(
                example.src,
                decodeURIComponent(
                  new URL(example.src, window.location.href).pathname.split('/').pop() ||
                    'style.webp',
                ),
              ).catch(() => addToast('Could not download image.', 'error'));
            }}
          >
            <Download width={17} />
          </button>
          <button type="button" aria-label="Close image preview" onClick={onClose}>
            <Xmark width={20} />
          </button>
        </div>
      </header>
      <div className="style-example-modal-body">
        <div
          ref={panZoom.viewportRef}
          tabIndex={0}
          role="group"
          aria-label="Style image pan and zoom"
          className="style-example-canvas"
          {...panZoom.viewportProps}
          onDoubleClick={panZoom.fit}
        >
          <img
            ref={panZoom.contentRef}
            src={example.src}
            alt={example.label}
            draggable={false}
            onError={() => setError(true)}
            onLoad={(event) => {
              setDimensions(
                `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
              );
              panZoom.onImageLoad();
              panZoom.actualSize();
            }}
          />
          {error && <p role="alert">Could not load the original image.</p>}
        </div>
        <aside>
          <h2>{example.label}</h2>
          {dimensions && <p className="text-xs text-[var(--wb-muted)]">{dimensions}</p>}
          {example.prompt && (
            <section>
              <header className="flex items-center justify-between">
                <h3>{example.promptLabel}</h3>
                <button
                  type="button"
                  aria-label="Copy image prompt"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(example.prompt);
                      addToast('Prompt copied', 'success');
                    } catch {
                      addToast('Could not copy prompt.', 'error');
                    }
                  }}
                >
                  <Copy width={16} />
                </button>
              </header>
              <p className="whitespace-pre-wrap break-words text-xs">{example.prompt}</p>
            </section>
          )}
          <dl>
            {Object.entries(example.metadata)
              .filter(([key, value]) => key !== 'prompt' && value != null && value !== '')
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ')}</dt>
                  <dd>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</dd>
                </div>
              ))}
          </dl>
        </aside>
      </div>
    </dialog>,
    document.body,
  );
}
