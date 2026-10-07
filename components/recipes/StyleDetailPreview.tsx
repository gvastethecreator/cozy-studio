import { useEffect, useMemo, useRef } from 'react';
import { Copy, Check, Plus, Xmark as X } from 'iconoir-react';
import { resolveStyleFullCardUrl } from '../../lib/styleThumbnailCatalog';
import type { StylePresetVisualState } from './StylePresetCardSurface';
import { getStyleRuntimePresetDisplayName, type StyleRuntimePreset } from './stylesData';
import { buildStylePromptText } from './stylePromptText';

export default function StyleDetailPreview({
  preset,
  visualState,
  selected,
  selectionDisabled,
  copied,
  onApply,
  onCopy,
  onUsePrompt,
  onEdit,
  onClone,
  onClose,
}: {
  preset: StyleRuntimePreset;
  visualState?: StylePresetVisualState;
  selected: boolean;
  selectionDisabled: boolean;
  copied: boolean;
  onApply: () => void;
  onCopy: (event: React.MouseEvent) => void;
  onUsePrompt: () => void;
  onEdit?: () => void;
  onClone: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [preset.id]);
  const name = getStyleRuntimePresetDisplayName(preset);
  const images = useMemo(
    () =>
      [
        ...new Set(
          [
            visualState?.defaultImage,
            ...(visualState?.defaultImageVariants.map((image) => image.src) ?? []),
            ...(visualState?.resultImages.map((image) => image.src) ?? []),
          ].filter((src): src is string => Boolean(src)),
        ),
      ].slice(0, 3),
    [visualState],
  );
  return (
    <section
      className="style-detail-preview"
      aria-label={`Information about ${name}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <div>
          <p>
            {visualState?.presetPackName ?? 'Custom styles'} · {preset.category || 'General'}
          </p>
          <h2>{name}</h2>
        </div>
        <button ref={closeRef} type="button" aria-label="Close style preview" onClick={onClose}>
          <X width={18} height={18} />
        </button>
      </header>
      <div className="style-detail-body">
        <div className="style-detail-examples" aria-label="Style examples">
          {[0, 1, 2].map((index) => (
            <figure key={index}>
              {images[index] ? (
                <a
                  href={resolveStyleFullCardUrl(images[index]) ?? images[index]}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${name} example ${index + 1} at full size`}
                >
                  <img src={images[index]} alt={`${name} example ${index + 1}`} decoding="async" />
                </a>
              ) : (
                <div className="style-example-missing">No example available</div>
              )}
              <figcaption>{index === 0 ? 'Main card' : `Example ${index + 1}`}</figcaption>
            </figure>
          ))}
        </div>
        <aside className="style-detail-information">
          <div className="style-detail-actions">
            <button
              type="button"
              className="studio-primary-control"
              aria-pressed={selected}
              disabled={selectionDisabled}
              onClick={onApply}
            >
              {selected ? <Check width={15} height={15} /> : <Plus width={15} height={15} />}
              {selected ? 'Remove style' : 'Add style'}
            </button>
            <button type="button" onClick={onCopy}>
              <Copy width={15} height={15} />
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <button type="button" onClick={onUsePrompt}>
              Use prompt
            </button>
            {onEdit ? (
              <button type="button" onClick={onEdit}>
                Edit custom style
              </button>
            ) : (
              <button type="button" onClick={onClone}>
                Create custom copy
              </button>
            )}
          </div>
          <h3>Visual DNA</h3>
          <dl>
            {Object.entries(preset.style).map(([key, value]) =>
              typeof value === 'string' && value.trim() ? (
                <div key={key}>
                  <dt>{key.replaceAll('_', ' ')}</dt>
                  <dd>{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
          <details>
            <summary>Full prompt</summary>
            <pre>{buildStylePromptText(preset)}</pre>
          </details>
        </aside>
      </div>
    </section>
  );
}
