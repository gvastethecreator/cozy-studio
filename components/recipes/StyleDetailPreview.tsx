import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Plus, Xmark as X } from 'iconoir-react';
import { resolveStyleFullCardUrl } from '../../lib/styleThumbnailCatalog';
import type { StylePresetVisualState } from './StylePresetCardSurface';
import { getStyleRuntimePresetDisplayName, type StyleRuntimePreset } from './stylesData';
import { buildStylePromptText } from './stylePromptText';
import { StyleExampleModal, type StyleExample } from './StyleExampleModal';
import { getStyleImageMetadata } from '../../services/studio-api/extensions';
import { getCatalogImageDetail } from '../../services/studio-api/catalog';
import { useToastUi } from '../../contexts/GlobalContext';

interface StyleExampleSource {
  src: string;
  label: string;
  imageId?: string;
}

interface StyleDetailPreviewProps {
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
}

export default function StyleDetailPreview(props: StyleDetailPreviewProps) {
  const { visualState } = props;
  const seen = new Set<string>();
  const sourcesKey = JSON.stringify(
    [
      ...(visualState?.defaultImage ? [{ src: visualState.defaultImage, label: 'Main card' }] : []),
      ...(visualState?.defaultImageVariants ?? []),
      ...(visualState?.resultImages ?? []).map((image) => ({
        src: image.sourceUrl ?? image.src,
        label: 'Generated image',
        imageId: image.id,
      })),
    ]
      .filter((entry) => {
        if (seen.has(entry.src)) return false;
        seen.add(entry.src);
        return true;
      })
      .slice(0, 3),
  );
  return (
    <StyleDetailPreviewContent
      key={`${props.preset.id}:${sourcesKey}`}
      {...props}
      sourcesKey={sourcesKey}
    />
  );
}

function StyleDetailPreviewContent({
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
  sourcesKey,
}: StyleDetailPreviewProps & { sourcesKey: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [preset.id]);
  const name = getStyleRuntimePresetDisplayName(preset);
  const { addToast } = useToastUi();
  const [preview, setPreview] = useState<number | null>(null);
  const [examples, setExamples] = useState<StyleExample[]>([]);
  const [metadataError, setMetadataError] = useState('');
  const stylePrompt = buildStylePromptText(preset);
  const category = preset.category;
  const packName = visualState?.presetPackName;
  useEffect(() => {
    let cancelled = false;
    const sourceImages: StyleExampleSource[] = JSON.parse(sourcesKey);
    setMetadataError('');
    const initial = sourceImages.map((entry) => ({
      src: resolveStyleFullCardUrl(entry.src) ?? entry.src,
      thumbnail: entry.src,
      label: `${name} · ${entry.label}`,
      prompt: stylePrompt,
      promptLabel: 'Style prompt',
      metadata: { style: name, pack: packName, category },
    }));
    setExamples(initial);
    void Promise.all(
      initial.map(async (example, index) => {
        const entry = sourceImages[index];
        try {
          const metadata = entry.imageId
            ? await getCatalogImageDetail(entry.imageId)
            : await getStyleImageMetadata(example.src);
          if (!metadata) return example;
          const prompt = typeof metadata.prompt === 'string' ? metadata.prompt : example.prompt;
          return {
            ...example,
            prompt,
            promptLabel: metadata.prompt ? 'Original prompt' : example.promptLabel,
            metadata: { ...example.metadata, ...metadata },
          };
        } catch {
          if (!cancelled) setMetadataError('Some original metadata could not be loaded.');
          return example;
        }
      }),
    ).then((value) => {
      if (!cancelled) setExamples(value);
    });
    return () => {
      cancelled = true;
    };
  }, [name, stylePrompt, category, sourcesKey, packName]);
  const copyPrompt = (prompt: string) => {
    void navigator.clipboard.writeText(prompt).then(
      () => addToast('Prompt copied', 'success'),
      () => addToast('Could not copy prompt.', 'error'),
    );
  };
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
      {metadataError && <p role="alert">{metadataError}</p>}
      <div className="style-detail-body">
        <div className="style-detail-examples" aria-label="Style examples">
          {examples.map((example, index) => (
            <figure key={example.src}>
              <button
                type="button"
                className="style-example-image"
                aria-label={`Open ${name} example ${index + 1} at full size`}
                onClick={() => setPreview(index)}
              >
                <img
                  src={example.thumbnail}
                  alt={`${name} example ${index + 1}`}
                  decoding="async"
                />
              </button>
              <figcaption>
                <span>{example.label}</span>
                <button
                  type="button"
                  aria-label={`Copy prompt for example ${index + 1}`}
                  onClick={() => copyPrompt(example.prompt)}
                >
                  <Copy width={15} />
                </button>
              </figcaption>
              {example.prompt && (
                <div className="style-example-prompt">
                  <span>{example.promptLabel}</span>
                  <p>{example.prompt}</p>
                </div>
              )}
            </figure>
          ))}
        </div>
        <aside className="style-detail-information">
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
      {preview !== null && examples[preview] && (
        <StyleExampleModal example={examples[preview]} onClose={() => setPreview(null)} />
      )}
    </section>
  );
}
