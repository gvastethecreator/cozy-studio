import { CatalogCardBackdrop } from '../CatalogCardBackdrop';
import { Check, Copy, Heart, Palette, InfoCircle as Eye, TextBox as TextPlus } from 'iconoir-react';
import React, { useMemo } from 'react';

import type { GeneratedImageWithConfig } from '../../types';
import {
  resolveStylePresetCardImages,
  type StylePresetCardImage,
  type StylePresetImageVariant,
} from '../../lib/stylePresetVisuals';
import { getStyleRuntimePresetDisplayName, type StyleRuntimePreset } from './stylesData';
import type { StyleCollectionRuntimePreset } from './styles/collections';
import type { StyleTheme } from './StyleRecipeNavigationPanel';

const EMPTY_IMAGES: GeneratedImageWithConfig[] = [];

export interface StylePresetVisualState {
  presetPackName: string;
  resultImages: GeneratedImageWithConfig[];
  defaultImage: string | undefined;
  defaultImageVariants: StylePresetImageVariant[];
  previewImage: string | undefined;
  exampleImageSrc: string | null;
}

export interface StylePresetSourceProvenance {
  sourcePackId: string;
  sourcePackName: string;
  sourceCategory: string;
  collectionRole: StyleCollectionRuntimePreset['collectionRole'];
}

export type StylePresetFadeImageComponent = React.ComponentType<
  React.ImgHTMLAttributes<HTMLImageElement>
>;

export interface StylePresetCardProps {
  preset: StyleRuntimePreset;
  packId: string;
  sourceProvenance?: StylePresetSourceProvenance;
  visualState: StylePresetVisualState | undefined;
  active: boolean;
  previewOnClick?: boolean;
  onInspect: (preset: StyleRuntimePreset) => void;
  selectionDisabled?: boolean;
  copied: boolean;
  favorite: boolean;
  theme: StyleTheme;
  FadeImageComponent: StylePresetFadeImageComponent;
  onApply: (preset: StyleRuntimePreset) => void;
  onUsePrompt?: (preset: StyleRuntimePreset) => void;
  onCopy: (e: React.MouseEvent, preset: StyleRuntimePreset) => void;
  onToggleFavorite: (presetId: string) => void;
}

function resolveStyleCardImageDiagnostics({
  activeCardImage,
}: {
  activeCardImage: StylePresetCardImage | null;
}) {
  return activeCardImage ?? ({ kind: 'empty', src: null } as const);
}

interface StylePresetResultButtonProps {
  activeCardImage: StylePresetCardImage | null;
  preset: StyleRuntimePreset;
  active: boolean;
  selectionDisabled: boolean;
  FadeImageComponent: StylePresetFadeImageComponent;
  onApply: (preset: StyleRuntimePreset) => void;
  onPreview?: () => void;
}

function StylePresetResultButton({
  activeCardImage,
  preset,
  active,
  selectionDisabled,
  FadeImageComponent,
  onApply,
  onPreview,
}: StylePresetResultButtonProps) {
  const name = getStyleRuntimePresetDisplayName(preset);
  return (
    <button
      type="button"
      className="style-card-image-hit"
      aria-label={
        onPreview ? `Preview style ${name}` : `${active ? 'Remove' : 'Select'} style ${name}`
      }
      aria-pressed={onPreview ? undefined : active}
      disabled={!onPreview && selectionDisabled}
      onClick={() => (onPreview ? onPreview() : onApply(preset))}
    >
      {activeCardImage ? (
        <FadeImageComponent
          src={activeCardImage.src}
          width={300}
          height={400}
          loading="lazy"
          decoding="async"
          className="style-preset-thumbnail size-full object-cover"
          alt={name}
        />
      ) : (
        <span className="flex flex-col items-center gap-2 text-xs text-[color:var(--wb-muted)]">
          <Palette width={24} height={24} aria-hidden="true" />
          <span>
            {preset.ui &&
            typeof preset.ui === 'object' &&
            'previewStatus' in preset.ui &&
            preset.ui.previewStatus === 'pending'
              ? 'Preview pending'
              : 'No preview'}
          </span>
        </span>
      )}
      {active && (
        <span className="style-card-selection-mark" aria-hidden="true">
          <Check width={14} height={14} />
        </span>
      )}
    </button>
  );
}

export const StylePresetCard = React.memo(function StylePresetCard({
  preset,
  packId,
  sourceProvenance,
  visualState,
  active,
  previewOnClick = false,
  onInspect,
  selectionDisabled = false,
  copied,
  favorite,
  FadeImageComponent,
  onApply,
  onCopy,
  onUsePrompt,
  onToggleFavorite,
}: StylePresetCardProps) {
  const resultImages = visualState?.resultImages ?? EMPTY_IMAGES;
  const cardImages = useMemo(
    () =>
      resolveStylePresetCardImages({
        resultImages,
        defaultImage: visualState?.defaultImage,
        defaultImageVariants: visualState?.defaultImageVariants,
        previewImage: visualState?.previewImage,
      }),
    [
      resultImages,
      visualState?.defaultImage,
      visualState?.defaultImageVariants,
      visualState?.previewImage,
    ],
  );
  const activeCardImage = cardImages[0] ?? null;
  const presetDisplayName = getStyleRuntimePresetDisplayName(preset);
  const imageDiagnostics = resolveStyleCardImageDiagnostics({
    activeCardImage,
  });

  return (
    <>
      <div
        data-style-preset-card={preset.id}
        data-style-pack-id={packId}
        data-style-category={preset.category || 'General'}
        data-style-image-kind={imageDiagnostics.kind}
        data-style-image-src={imageDiagnostics.src ?? ''}
        data-style-image-label={'label' in imageDiagnostics ? imageDiagnostics.label : ''}
        data-style-source-pack-id={sourceProvenance?.sourcePackId ?? ''}
        data-style-source-category={sourceProvenance?.sourceCategory ?? ''}
        data-style-collection-role={sourceProvenance?.collectionRole ?? ''}
        data-selected={active}
        className="style-preset-tile catalog-art-card group relative aspect-[3/4] overflow-hidden rounded-[var(--wb-radius)] text-left"
        style={
          {
            contentVisibility: 'auto',
            containIntrinsicSize: '210px 280px',
          } as React.CSSProperties
        }
      >
        <div className="style-card-media">
          <StylePresetResultButton
            activeCardImage={activeCardImage}
            preset={preset}
            active={active}
            selectionDisabled={selectionDisabled}
            FadeImageComponent={FadeImageComponent}
            onApply={onApply}
            onPreview={previewOnClick ? () => onInspect(preset) : undefined}
          />
        </div>

        <CatalogCardBackdrop
          label={presetDisplayName}
          title={
            <button
              type="button"
              className="style-tile-caption"
              onClick={() => onApply(preset)}
              disabled={selectionDisabled}
              aria-pressed={active}
              aria-label={`${active ? 'Remove' : 'Select'} style ${presetDisplayName}`}
              data-tooltip={presetDisplayName}
            >
              {presetDisplayName}
            </button>
          }
        >
          <StylePresetCardActions
            preset={preset}
            favorite={favorite}
            copied={copied}
            onToggleFavorite={onToggleFavorite}
            onInspect={onInspect}
            onCopy={onCopy}
            onUsePrompt={onUsePrompt}
          />
        </CatalogCardBackdrop>
      </div>
    </>
  );
});

function StylePresetCardActions({
  preset,
  favorite,
  copied,
  onToggleFavorite,
  onInspect,
  onCopy,
  onUsePrompt,
}: Pick<
  StylePresetCardProps,
  'preset' | 'favorite' | 'copied' | 'onToggleFavorite' | 'onInspect' | 'onCopy' | 'onUsePrompt'
>) {
  const presetDisplayName = getStyleRuntimePresetDisplayName(preset);
  return (
    <div className="style-card-actions catalog-hover-actions">
      <button
        type="button"
        aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${presetDisplayName}`}
        aria-pressed={favorite}
        onClick={() => onToggleFavorite(preset.id)}
      >
        <Heart width={14} height={14} fill={favorite ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        aria-label={`Information about ${presetDisplayName}`}
        onClick={(event) => {
          event.stopPropagation();
          onInspect(preset);
        }}
      >
        <Eye width={16} height={16} />
      </button>
      <button
        type="button"
        aria-label={copied ? 'Prompt copied' : 'Copy prompt'}
        onClick={(event) => onCopy(event, preset)}
      >
        {copied ? <Check width={16} height={16} /> : <Copy width={16} height={16} />}
      </button>
      {onUsePrompt && (
        <button
          type="button"
          aria-label="Use as prompt"
          onClick={(event) => {
            event.stopPropagation();
            onUsePrompt(preset);
          }}
        >
          <TextPlus width={16} height={16} />
        </button>
      )}
    </div>
  );
}
