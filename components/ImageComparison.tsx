import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Heart, HeartSolid } from 'iconoir-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { imageFitScale, useImagePanZoom } from '../lib/imagePanZoom';
import { resolveProviderShortLabel } from '../lib/commandCenterProjection';
import { getCatalogImageDetail } from '../services/studio-api/catalog';
import {
  buildGenerationConfigFromCatalogImage,
  readAppliedStyles,
} from '../utils/catalogImageGenerationConfig';
import type { CatalogImage } from '../packages/shared/src/types';
import type { GeneratedImageWithConfig } from '../types';
import { ImageOrganizationPicker } from './ImageOrganizationPicker';

export const COMPARE_MAX_IMAGES = 9;

const MISSING = '—';
type Field = 'Prompt' | 'Style' | 'Model' | 'Provider' | 'Size';
type Caption = [Field, string][];

/** Grid summaries carry no generation config, so Style and Model wait for the detail. */
function describeImage(image: GeneratedImageWithConfig, detail?: CatalogImage): Caption {
  const config = detail ? buildGenerationConfigFromCatalogImage(detail) : image.config;
  // The stored model only; the config builder would fill in the Codex default.
  const model = detail?.generationConfig?.executionModel;
  const format = image.mimeType?.split('/')[1]?.toUpperCase();
  return [
    ['Prompt', config.prompt || MISSING],
    [
      'Style',
      readAppliedStyles(config)
        .map((style) => style.presetName)
        .join(', ') || MISSING,
    ],
    ['Model', typeof model === 'string' && model ? model : MISSING],
    ['Provider', image.providerId ? resolveProviderShortLabel(image.providerId) : MISSING],
    [
      'Size',
      image.width && image.height
        ? [`${image.width} × ${image.height}`, format].filter(Boolean).join(', ')
        : MISSING,
    ],
  ];
}

const CompareCell = React.memo(function CompareCell({
  image,
  number,
  caption,
  picked,
  hidden,
  onPick,
}: {
  image: GeneratedImageWithConfig;
  number: number;
  caption: Caption;
  picked: boolean;
  hidden: boolean;
  onPick: (image: GeneratedImageWithConfig) => void;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <figure
      hidden={hidden}
      aria-label={`Image ${number}`}
      className="flex min-h-0 min-w-0 flex-col gap-2"
    >
      <div
        data-pan-zoom-cell
        className={`relative min-h-0 flex-1 overflow-hidden rounded bg-black/40 ${picked ? 'ring-2 ring-[color:var(--wb-accent)]' : ''}`}
      >
        {/* ponytail: originals in every cell; load thumbnails at fit if 9 large originals stall. */}
        <div
          className="absolute top-1/2 left-1/2 size-full"
          style={{ transform: 'var(--pan-zoom-transform, translate(-50%, -50%))' }}
        >
          <img
            src={image.sourceUrl ?? image.src}
            alt={`Image ${number}: ${image.config.prompt || 'Selected result'}`}
            draggable={false}
            className={`size-full object-contain ${status === 'ready' ? '' : 'invisible'}`}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('error')}
          />
        </div>
        <span
          aria-hidden="true"
          className="absolute top-2 left-2 rounded bg-black/70 px-1.5 text-xs text-white tabular-nums"
        >
          {number}
        </span>
        {status !== 'ready' && (
          <p
            role={status === 'error' ? 'alert' : 'status'}
            className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm"
          >
            {status === 'error'
              ? 'This original image could not be loaded. Reopen the comparison to try again.'
              : 'Loading original image…'}
          </p>
        )}
      </div>
      {/* Stop the viewport drag here so the caption text and Pick get normal pointer input. */}
      <figcaption
        className="flex min-w-0 items-start gap-2"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-xs">
          {caption.map(([field, value]) => (
            <React.Fragment key={field}>
              <dt className="text-[color:var(--wb-muted)]">{field}</dt>
              <dd className="line-clamp-2 break-words" title={value}>
                {value}
              </dd>
            </React.Fragment>
          ))}
        </dl>
        <button
          type="button"
          className="studio-ghost-control shrink-0 rounded"
          aria-pressed={picked}
          aria-label={`Pick image ${number}`}
          onClick={() => onPick(image)}
        >
          {image.isFavorite ? (
            <HeartSolid aria-hidden="true" width={14} height={14} />
          ) : (
            <Heart aria-hidden="true" width={14} height={14} />
          )}
          Pick
        </button>
      </figcaption>
    </figure>
  );
});

export function ImageComparison({
  images,
  workspaceId,
  onToggleFavorite,
  onClose,
}: {
  images: GeneratedImageWithConfig[];
  workspaceId: string;
  onToggleFavorite: (imageId: string) => void;
  onClose: () => void;
}) {
  const dialog = useDialogFocus(true, onClose);
  const [single, setSingle] = useState(false);
  const [shown, setShown] = useState(0);
  const [pickId, setPickId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [details, setDetails] = useState<Record<string, CatalogImage>>({});
  const idsKey = images.map((image) => image.id).join(':');
  const zoom = useImagePanZoom(true, `${idsKey}:${single}`);
  const title = `Compare ${images.length} images`;

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled(idsKey.split(':').map((id) => getCatalogImageDetail(id))).then(
      (results) => {
        if (cancelled) return;
        setDetails(
          Object.fromEntries(
            results.flatMap((result) =>
              result.status === 'fulfilled' ? [[result.value.id, result.value]] : [],
            ),
          ),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  // Fields equal in every image go to one line; each caption lists only what differs.
  const { same, captions } = useMemo(() => {
    const described = images.map((image) => describeImage(image, details[image.id]));
    const differs = described[0].map(([, value], row) =>
      described.some((rows) => rows[row][1] !== value),
    );
    return {
      same: described[0].filter(([, value], row) => !differs[row] && value !== MISSING),
      captions: described.map((rows) => rows.filter((_, row) => differs[row])),
    };
  }, [images, details]);

  const pick = useCallback(
    (image: GeneratedImageWithConfig) => {
      setPickId(image.id);
      // Pick only ever adds a favorite; it never removes one.
      if (!image.isFavorite) onToggleFavorite(image.id);
    },
    [onToggleFavorite],
  );

  const reference = single ? shown : 0;
  const actualSize = () => {
    const cell =
      zoom.viewportRef.current?.querySelectorAll<HTMLElement>('[data-pan-zoom-cell]')[reference];
    const image = cell?.querySelector('img');
    if (!cell || !image?.naturalWidth) return;
    zoom.setZoom(
      1 /
        imageFitScale(image.naturalWidth, image.naturalHeight, cell.clientWidth, cell.clientHeight),
    );
  };

  const pickIndex = images.findIndex((image) => image.id === pickId);
  const columns = single
    ? 'grid-cols-1'
    : images.length === 2 || images.length === 4
      ? 'grid-cols-2'
      : 'grid-cols-2 sm:grid-cols-3';
  const sameText = same.map(([field, value]) => `${field}: ${value}`).join(' · ');

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      className="m-auto h-[90vh] w-[94vw] max-w-none rounded-xl border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] text-[color:var(--wb-ink)] backdrop:bg-black/70"
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">{title}</h2>
          <div role="group" aria-label="Layout" className="flex">
            {(['Side by side', 'One at a time'] as const).map((label) => {
              const pressed = (label === 'One at a time') === single;
              return (
                <button
                  key={label}
                  type="button"
                  className={`studio-tab ${pressed ? 'is-active' : ''}`}
                  aria-pressed={pressed}
                  onClick={() => setSingle(label === 'One at a time')}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {single && (
            <div role="group" aria-label="Shown image" className="flex flex-wrap">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  className={`studio-tab tabular-nums ${shown === index ? 'is-active' : ''}`}
                  aria-pressed={shown === index}
                  aria-label={`Show image ${index + 1}`}
                  onClick={() => setShown(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="studio-ghost-control ml-auto rounded px-3 py-2"
            onClick={onClose}
          >
            Close comparison
          </button>
        </div>
        <p className="text-sm">
          {single
            ? 'Switch images to compare them at the same zoom and position.'
            : 'All images share one zoom and position.'}{' '}
          Scroll to zoom; drag to pan.
        </p>
        {same.length > 0 && (
          <p className="line-clamp-2 text-xs" title={sameText}>
            <span className="font-semibold">Same in all:</span> {sameText}
          </p>
        )}
        <div
          ref={zoom.viewportRef}
          {...zoom.viewportProps}
          role="group"
          tabIndex={0}
          aria-label="Comparison images. Plus and minus zoom, arrows pan, zero fits."
          className={`grid min-h-0 flex-1 auto-rows-fr gap-3 overflow-hidden rounded outline-offset-2 touch-none ${columns}`}
        >
          {images.map((image, index) => (
            <CompareCell
              key={image.id}
              image={image}
              number={index + 1}
              caption={captions[index]}
              picked={image.id === pickId}
              hidden={single && index !== shown}
              onPick={pick}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2"
            onClick={zoom.zoomOut}
            aria-label="Zoom out comparison"
          >
            −
          </button>
          <span className="text-sm tabular-nums" title="Zoom relative to the fitted images">
            {Math.round(zoom.scale * 100)}%
          </span>
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2"
            onClick={zoom.zoomIn}
            aria-label="Zoom in comparison"
          >
            +
          </button>
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2"
            onClick={zoom.fit}
          >
            Fit
          </button>
          <button
            type="button"
            className="studio-ghost-control rounded px-3 py-2"
            onClick={actualSize}
          >
            Actual size
          </button>
          <p role="status" className="ml-auto text-sm">
            {pickIndex >= 0 ? `Image ${pickIndex + 1} is your pick` : ''}
          </p>
          {pickIndex >= 0 && (
            <details
              className="relative"
              onToggle={(event) => setPickerOpen(event.currentTarget.open)}
            >
              <summary className="studio-ghost-control cursor-pointer rounded px-3 py-2">
                Add the pick to a collection
              </summary>
              {pickerOpen && (
                <div
                  role="menu"
                  aria-label="Collections for the pick"
                  className="absolute right-0 bottom-full z-10 mb-2 w-72 rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] p-2"
                >
                  <ImageOrganizationPicker
                    key={images[pickIndex].id}
                    kind="collection"
                    workspaceId={workspaceId}
                    images={[images[pickIndex]]}
                  />
                </div>
              )}
            </details>
          )}
        </div>
      </div>
    </dialog>
  );
}
