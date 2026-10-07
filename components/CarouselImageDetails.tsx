import React from 'react';
import type { GeneratedImageWithConfig } from '../types';
import { resolveProviderShortLabel } from '../lib/commandCenterProjection';

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
}: {
  image: GeneratedImageWithConfig;
  children?: React.ReactNode;
  hidden?: boolean;
}) {
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
    ['Dimensions', image.width && image.height ? `${image.width} × ${image.height}` : 'Unknown'],
    ['File size', formatFileSize(image.fileSizeBytes)],
    ['Format', image.mimeType || 'Unknown'],
    ['Provider', image.providerId ? resolveProviderShortLabel(image.providerId) : 'Unknown'],
    ['Created', new Date(image.createdAt).toLocaleString()],
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
        {metadata.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[color:var(--wb-muted)]">{label}</dt>
            <dd key={value} className="image-metadata-enter break-words text-[color:var(--wb-ink)]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <section className="carousel-style-badges" aria-label="Applied styles">
        <h3 className="mb-2 text-xs text-[color:var(--wb-muted)]">Styles</h3>
        <div className="flex flex-wrap gap-1.5">
          {styles.length === 0 && (
            <span className="image-metadata-enter text-xs text-[color:var(--wb-muted)]">
              No styles attached
            </span>
          )}
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
      {children}
      <section className="carousel-detail-prompt" aria-label="Full image prompt">
        <h3 className="text-xs text-[color:var(--wb-muted)]">Prompt</h3>
        <p key={image.config.prompt} className="image-metadata-enter">
          {image.config.prompt || 'No prompt saved.'}
        </p>
      </section>
    </aside>
  );
}
