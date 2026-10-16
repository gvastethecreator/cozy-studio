import React, { useEffect, useState } from 'react';
import { Copy, Check } from 'iconoir-react';
import type { GeneratedImageWithConfig } from '../types';
import { resolveProviderShortLabel } from '../lib/commandCenterProjection';
import { useCatalogOrganization } from '../hooks/useCatalogOrganization';
import { getCatalogCollectionSelection } from '../services/studio-api/catalog';
import type { CatalogCollectionSelection } from '../packages/shared/src';
import { ImageOrganizationPicker } from './ImageOrganizationPicker';

function formatFileSize(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(4, Math.floor(Math.log2(bytes) / 10));
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}

export function CarouselImageDetails({
  image,
  children,
  hidden,
  workspaceId,
  onCopyPrompt,
  copiedPrompt,
}: {
  image: GeneratedImageWithConfig;
  children?: React.ReactNode;
  hidden?: boolean;
  workspaceId: string;
  onCopyPrompt?: () => void;
  copiedPrompt?: boolean;
}) {
  const {
    tags,
    collections: availableCollections,
    refresh,
  } = useCatalogOrganization(workspaceId, !hidden);
  const [collections, setCollections] = useState<CatalogCollectionSelection[]>([]);
  const [collectionError, setCollectionError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    setCollections([]);
    setCollectionError('');
    void getCatalogCollectionSelection(workspaceId, [image.id]).then(
      (value) => {
        if (!cancelled)
          setCollections(value.filter((collection) => collection.selectedImageCount > 0));
      },
      () => {
        if (!cancelled) setCollectionError('Could not load collections.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, image.id, hidden, revision, availableCollections]);
  const selectedStyles = image.config.recipeParams?.selectedStyles;
  const styles = Array.isArray(selectedStyles)
    ? selectedStyles.filter(
        (style) =>
          style &&
          typeof style === 'object' &&
          !Array.isArray(style) &&
          style.enabled !== false &&
          typeof style.presetName === 'string' &&
          style.presetName.trim(),
      )
    : [];
  const metadata = [
    ['Dimensions', image.width && image.height ? `${image.width} × ${image.height}` : null],
    ['File size', image.fileSizeBytes == null ? null : formatFileSize(image.fileSizeBytes)],
    ['Format', image.mimeType?.split('/')[1]?.toUpperCase() || null],
    ['Provider', image.providerId ? resolveProviderShortLabel(image.providerId) : null],
    ['Created', image.createdAt ? new Date(image.createdAt).toLocaleString() : null],
  ];

  return (
    <aside
      id="carousel-image-details"
      hidden={hidden}
      className="carousel-details"
      aria-label="Image details"
    >
      <h2 className="text-sm font-semibold text-[color:var(--wb-ink)]">Image details</h2>
      <dl className="carousel-metadata text-xs">
        {metadata
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt className="text-[color:var(--wb-muted)]">{label}</dt>
              <dd
                key={value}
                className="image-metadata-enter break-words text-[color:var(--wb-ink)]"
              >
                {value}
              </dd>
            </div>
          ))}
      </dl>
      {collectionError && (
        <p role="alert" className="text-xs">
          {collectionError}{' '}
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {(['tag', 'collection'] as const).map((kind) => (
        <section
          key={kind}
          className="carousel-organization-section"
          aria-label={kind === 'tag' ? 'Image tags' : 'Image collections'}
        >
          <details>
            <summary>
              {kind === 'tag' ? 'Tags' : 'Collections'}
              <span aria-hidden="true">＋</span>
            </summary>
            {!hidden && (
              <div role="menu" aria-label={kind === 'tag' ? 'Edit tags' : 'Edit collections'}>
                <ImageOrganizationPicker
                  key={`${image.id}-${kind}`}
                  kind={kind}
                  workspaceId={workspaceId}
                  images={[image]}
                  onSaved={() => {
                    refresh();
                    setRevision((value) => value + 1);
                  }}
                />
              </div>
            )}
          </details>
          <div className="carousel-organization-badges">
            {kind === 'tag'
              ? image.tags?.map((name) => (
                  <span
                    key={name}
                    style={{
                      borderColor: tags.find((tag) => tag.name === name)?.color ?? undefined,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="organization-mark"
                      style={{
                        backgroundColor:
                          tags.find((tag) => tag.name === name)?.color ?? 'var(--wb-dim)',
                      }}
                    />
                    #{name}
                  </span>
                ))
              : collections.map((collection) => (
                  <span key={collection.id}>
                    {collection.emoji ?? '📁'} {collection.name}
                  </span>
                ))}
          </div>
        </section>
      ))}
      {styles.length > 0 && (
        <section className="carousel-style-badges" aria-label="Applied styles">
          <h3 className="mb-2 text-xs text-[color:var(--wb-muted)]">Styles</h3>
          <div className="flex flex-wrap gap-1.5">
            {styles.map((style, index) => (
              <span
                key={`${style.presetId ?? style.presetName}-${index}`}
                title={typeof style.packName === 'string' ? style.packName : undefined}
                className="image-metadata-enter rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] px-2 py-1 text-xs text-[color:var(--wb-ink)]"
              >
                {style.presetName}
              </span>
            ))}
          </div>
        </section>
      )}
      {children}
      {image.config.prompt && (
        <section className="carousel-detail-prompt" aria-label="Full image prompt">
          <header className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[color:var(--wb-muted)]">Prompt</h3>
            {onCopyPrompt && (
              <button
                type="button"
                className="studio-icon-action studio-ghost-control"
                aria-label="Copy prompt"
                onClick={onCopyPrompt}
              >
                {copiedPrompt ? <Check width={15} /> : <Copy width={15} />}
              </button>
            )}
          </header>
          <p key={image.config.prompt} className="image-metadata-enter">
            {image.config.prompt}
          </p>
        </section>
      )}
    </aside>
  );
}
