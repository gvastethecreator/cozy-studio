import type { UseCatalogResult } from '../../hooks/useCatalogPage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NavArrowLeft as ChevronLeft,
  NavArrowRight as ChevronRight,
  Copy,
  Download,
  Heart,
  Minus,
  Plus,
  Expand as OpenFull,
  Attachment as Paperclip,
  MediaImage as Photo,
} from 'iconoir-react';

import { buildCarouselThumbnailWindow } from '../../lib/imageCarouselThumbnails';
import { useImagePanZoom } from '../../lib/imagePanZoom';
import { useImagePresentation } from '../../hooks/useImagePresentation';
import { useHorizontalDragScroll } from '../../hooks/useHorizontalDragScroll';
import { writeCatalogImageDrag } from '../../lib/catalogImageDrag';
import { useToastUi } from '../../contexts/GlobalContext';
import { useImageConversion } from '../../contexts/ImageConversionContext';
import type { Attachment, GeneratedImageWithConfig } from '../../types';
import { copyImageToClipboard, downloadImage, generateSmartFilename } from '../../utils/fileUtils';
import Tooltip from '../Tooltip';

type StageBackground = 'dark' | 'light' | 'checkered';
type NavSide = 'prev' | 'next' | null;

function hasFineHoverPointer() {
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function useResultCanvasNavigation(isStage: boolean, imageCount: number, selectedIndex: number) {
  const [navSide, setNavSide] = useState<NavSide>(null);
  const [canvasFocused, setCanvasFocused] = useState(false);
  const fineHover = hasFineHoverPointer();
  const canNavigate = isStage && imageCount > 1;
  const showPrevNav =
    canNavigate && selectedIndex > 0 && (!fineHover || canvasFocused || navSide === 'prev');
  const showNextNav =
    canNavigate &&
    selectedIndex >= 0 &&
    selectedIndex < imageCount - 1 &&
    (!fineHover || canvasFocused || navSide === 'next');
  const handleCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = rect.width || event.currentTarget.clientWidth || 1;
    const x = event.clientX - rect.left;
    setNavSide(x < width / 2 ? 'prev' : 'next');
  }, []);

  return {
    navSide,
    setNavSide,
    setCanvasFocused,
    showPrevNav,
    showNextNav,
    handleCanvasPointerMove,
  };
}

function useRecipeResultSelection(
  images: GeneratedImageWithConfig[],
  history: UseCatalogResult | undefined,
  externalSelectedId: string | null | undefined,
  onSelectId: ((id: string) => void) | undefined,
) {
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedId = externalSelectedId === undefined ? localSelectedId : externalSelectedId;
  const setSelectedId = onSelectId ?? setLocalSelectedId;
  const previousIndex = useRef(0);
  const previousScope = useRef(history?.scopeKey);
  const fallbackIndex =
    previousScope.current === history?.scopeKey
      ? Math.min(previousIndex.current, Math.max(0, images.length - 1))
      : 0;
  const requestedImage = images.find((image) => image.id === selectedId) ?? images[fallbackIndex];
  const selectedIndex = requestedImage
    ? images.findIndex((image) => image.id === requestedImage.id)
    : -1;
  useEffect(() => {
    if (previousScope.current !== history?.scopeKey) {
      previousIndex.current = 0;
      previousScope.current = history?.scopeKey;
    }
    if (selectedIndex >= 0) previousIndex.current = selectedIndex;
  }, [selectedIndex, history?.scopeKey]);
  useEffect(() => {
    if (
      history?.hasMore &&
      !history.isLoading &&
      !history.error &&
      selectedIndex >= images.length - 12
    )
      void history.loadMore();
  }, [history, images.length, selectedIndex]);
  return { requestedImage, selectedIndex, setSelectedId };
}

function useRecipeResultPreviewController({
  images,
  reference,
  onOpen,
  onToggleFavorite,
  onUseAsReference,
  variant = 'default',
  emptyTitle = 'Your next result starts here',
  isGenerating = false,
  history,
  selectedId: externalSelectedId,
  onSelectId,
}: {
  images: GeneratedImageWithConfig[];
  reference?: Attachment;
  onOpen?: (image: GeneratedImageWithConfig) => void;
  onToggleFavorite?: (id: string) => void;
  onUseAsReference?: (image: GeneratedImageWithConfig) => void;
  variant?: 'default' | 'stage';
  emptyTitle?: string;
  isGenerating?: boolean;
  history?: UseCatalogResult;
  selectedId?: string | null;
  onSelectId?: (id: string) => void;
}) {
  const { addToast } = useToastUi();
  const openConversion = useImageConversion();
  const [showReference, setShowReference] = useState(false);
  const [background, setBackground] = useState<StageBackground>('dark');
  const { requestedImage, selectedIndex, setSelectedId } = useRecipeResultSelection(
    images,
    history,
    externalSelectedId,
    onSelectId,
  );
  const requestedSrc =
    showReference || !requestedImage
      ? reference?.dataUrl
      : (requestedImage.sourceUrl ?? requestedImage.src);
  const presentation = useImagePresentation(
    { image: requestedImage, showReference },
    requestedSrc,
    history?.scopeKey,
  );
  const { image: selected, showReference: displayedReference } = presentation.value;
  const src = presentation.src;
  const isStage = variant === 'stage';
  const canCompare = Boolean(isStage && reference && selected);
  const panZoom = useImagePanZoom(isStage && Boolean(src), src);
  const stripRef = useRef<HTMLDivElement>(null);
  const stripDrag = useHorizontalDragScroll(stripRef);
  const thumbnailWindow = useMemo(
    () => buildCarouselThumbnailWindow(images, Math.max(selectedIndex, 0)),
    [images, selectedIndex],
  );
  const navigation = useResultCanvasNavigation(isStage, images.length, selectedIndex);

  const selectIndex = (index: number) => {
    const image = images[index];
    if (!image) return;
    setSelectedId(image.id);
    setShowReference(false);
  };

  const handleCopy = async () => {
    if (!src) return;
    try {
      await copyImageToClipboard(src);
      addToast('Image copied to clipboard', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not copy image', 'error');
    }
  };

  const handleDownload = () => {
    if (!src) return;
    downloadImage(
      src,
      selected
        ? generateSmartFilename(
            selected.config.prompt,
            selected.id,
            selected.config.model,
            selected.config.aspectRatio,
            undefined,
            selected.mimeType,
            selected.localPath,
          )
        : 'reference.png',
    );
  };

  return {
    isStage,
    variant,
    background,
    isGenerating,
    presentation,
    displayedReference,
    selected,
    reference,
    showReference,
    setShowReference,
    onOpen,
    src,
    canCompare,
    handleCopy,
    handleDownload,
    openConversion,
    onToggleFavorite,
    onUseAsReference,
    setBackground,
    panZoom,
    ...navigation,
    images,
    selectedIndex,
    selectIndex,
    emptyTitle,
    stripRef,
    stripDrag,
    thumbnailWindow,
    requestedImage,
  };
}

type RecipeResultPreviewViewModel = ReturnType<typeof useRecipeResultPreviewController>;

function RecipeResultPreviewView({ model }: { model: RecipeResultPreviewViewModel }) {
  const { isStage, variant, background, isGenerating, presentation, src, images } = model;

  return (
    <section
      className={isStage ? 'recipe-result recipe-result-stage' : 'recipe-result'}
      data-result-variant={variant}
      data-stage-background={isStage ? background : undefined}
      aria-label="Result preview"
      aria-busy={isGenerating || presentation.pending}
      data-image-transition={Boolean(presentation.previousSrc)}
    >
      {isGenerating && (
        <div className="recipe-result-progress" role="status">
          Generating… Your result will appear here.
        </div>
      )}
      {!isStage ? <RecipeResultHeading model={model} /> : null}
      {isStage && src ? <RecipeResultToolbar model={model} /> : null}
      <RecipeResultCanvas model={model} />
      {images.length > 0 && <RecipeResultStrip model={model} />}
    </section>
  );
}

export const RecipeResultPreview: React.FC<{
  images: GeneratedImageWithConfig[];
  reference?: Attachment;
  onOpen?: (image: GeneratedImageWithConfig) => void;
  onToggleFavorite?: (id: string) => void;
  onUseAsReference?: (image: GeneratedImageWithConfig) => void;
  variant?: 'default' | 'stage';
  emptyTitle?: string;
  isGenerating?: boolean;
  history?: UseCatalogResult;
  selectedId?: string | null;
  onSelectId?: (id: string) => void;
}> = (props) => {
  const view = useRecipeResultPreviewController(props);
  return <RecipeResultPreviewView model={view} />;
};

function RecipeResultToolbar({
  model,
}: {
  model: Pick<
    RecipeResultPreviewViewModel,
    | 'displayedReference'
    | 'selected'
    | 'isGenerating'
    | 'reference'
    | 'canCompare'
    | 'showReference'
    | 'setShowReference'
    | 'handleCopy'
    | 'handleDownload'
    | 'openConversion'
    | 'onToggleFavorite'
    | 'onUseAsReference'
    | 'onOpen'
    | 'background'
    | 'setBackground'
    | 'panZoom'
  >;
}) {
  const { selected, background, setBackground, panZoom } = model;

  return (
    <div className="recipe-result-toolbar">
      <div
        className="recipe-result-toolbar-row"
        role="toolbar"
        aria-label="Selected result actions"
      >
        <RecipeResultContext model={model} />
        <RecipeResultImageActions model={model} />
        <div className="result-view-controls">
          <div className="recipe-result-background" role="group" aria-label="Canvas background">
            <Tooltip content="Dark background">
              <button
                type="button"
                aria-pressed={background === 'dark'}
                aria-label="Dark background"
                onClick={() => setBackground('dark')}
              />
            </Tooltip>
            <Tooltip content="Light background">
              <button
                type="button"
                aria-pressed={background === 'light'}
                aria-label="Light background"
                onClick={() => setBackground('light')}
              />
            </Tooltip>
            <Tooltip content="Checkered background">
              <button
                type="button"
                aria-pressed={background === 'checkered'}
                aria-label="Checkered background"
                onClick={() => setBackground('checkered')}
              />
            </Tooltip>
          </div>
          <div className="recipe-result-zoom" role="group" aria-label="Zoom controls">
            <Tooltip content="Zoom out">
              <button type="button" aria-label="Zoom out" onClick={panZoom.zoomOut}>
                <Minus width={14} height={14} />
              </button>
            </Tooltip>
            <Tooltip content="Reset zoom to 100%">
              <button
                type="button"
                className="recipe-result-scale"
                aria-label="Reset zoom to 100%"
                onClick={panZoom.actualSize}
              >
                {Math.round(panZoom.scale * 100)}%
              </button>
            </Tooltip>
            <Tooltip content="Fit image">
              <button type="button" aria-label="Fit image" onClick={panZoom.fit}>
                Fit
              </button>
            </Tooltip>
            <Tooltip content="Zoom in">
              <button type="button" aria-label="Zoom in" onClick={panZoom.zoomIn}>
                <Plus width={14} height={14} />
              </button>
            </Tooltip>
          </div>
        </div>
        <p
          key={selected?.config.prompt}
          className="recipe-result-prompt image-metadata-enter"
          data-tooltip={selected?.config.prompt}
        >
          {selected?.config.prompt || 'No prompt saved.'}
        </p>
      </div>
    </div>
  );
}

function RecipeResultCanvas({
  model,
}: {
  model: Pick<
    RecipeResultPreviewViewModel,
    | 'isStage'
    | 'background'
    | 'src'
    | 'navSide'
    | 'panZoom'
    | 'handleCanvasPointerMove'
    | 'setNavSide'
    | 'setCanvasFocused'
    | 'images'
    | 'showPrevNav'
    | 'selectedIndex'
    | 'selectIndex'
    | 'showNextNav'
    | 'presentation'
    | 'displayedReference'
    | 'selected'
    | 'emptyTitle'
  >;
}): React.ReactElement {
  const contents = <RecipeResultCanvasContents model={model} />;
  return model.isStage ? (
    <RecipeResultStageCanvas model={model}>{contents}</RecipeResultStageCanvas>
  ) : (
    <div className="recipe-result-image">{contents}</div>
  );
}

type RecipeResultCanvasModel = React.ComponentProps<typeof RecipeResultCanvas>['model'];

function RecipeResultStageCanvas({
  model,
  children,
}: {
  model: RecipeResultCanvasModel;
  children: React.ReactNode;
}) {
  const {
    background,
    src,
    navSide,
    panZoom,
    handleCanvasPointerMove,
    setNavSide,
    setCanvasFocused,
  } = model;

  return (
    <div
      className={`recipe-result-image is-${background}`}
      role="group"
      aria-label="Image canvas"
      aria-description="Drag to pan. Scroll or press + and - to zoom. Press 0 to fit the image."
      tabIndex={src ? 0 : undefined}
      data-nav-side={navSide ?? undefined}
      {...panZoom.viewportProps}
      ref={panZoom.viewportRef}
      onPointerMove={(event) => {
        panZoom.viewportProps.onPointerMove(event);
        handleCanvasPointerMove(event);
      }}
      onPointerLeave={() => setNavSide(null)}
      onFocusCapture={() => setCanvasFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setCanvasFocused(false);
        }
      }}
    >
      {children}
    </div>
  );
}

function RecipeResultCanvasContents({ model }: { model: RecipeResultCanvasModel }) {
  const { src, isStage, images, showPrevNav, selectedIndex, selectIndex, showNextNav, emptyTitle } =
    model;
  return (
    <>
      {src ? (
        <>
          {isStage && images.length > 1 ? (
            <>
              <button
                type="button"
                className="recipe-result-nav is-prev"
                aria-label="Previous result"
                hidden={!showPrevNav}
                disabled={selectedIndex <= 0}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => selectIndex(selectedIndex - 1)}
              >
                <ChevronLeft width={22} height={22} />
              </button>
              <button
                type="button"
                className="recipe-result-nav is-next"
                aria-label="Next result"
                hidden={!showNextNav}
                disabled={selectedIndex >= images.length - 1}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => selectIndex(selectedIndex + 1)}
              >
                <ChevronRight width={22} height={22} />
              </button>
            </>
          ) : null}
          <RecipeResultImagePresentation model={model} />
        </>
      ) : (
        <div>
          <h2>{emptyTitle}</h2>
          <p>Add a prompt or reference, choose your settings, then generate.</p>
        </div>
      )}
    </>
  );
}

function RecipeResultImageActions({
  model,
}: {
  model: Pick<
    RecipeResultPreviewViewModel,
    | 'handleCopy'
    | 'handleDownload'
    | 'openConversion'
    | 'selected'
    | 'showReference'
    | 'onToggleFavorite'
    | 'onUseAsReference'
    | 'onOpen'
  >;
}): React.ReactElement {
  const {
    handleCopy,
    handleDownload,
    openConversion,
    selected,
    showReference,
    onToggleFavorite,
    onUseAsReference,
    onOpen,
  } = model;

  return (
    <div className="result-image-controls" role="group" aria-label="Image actions">
      <Tooltip content="Copy image">
        <button type="button" aria-label="Copy image" onClick={() => void handleCopy()}>
          <Copy width={14} height={14} />
        </button>
      </Tooltip>
      <Tooltip content="Download image">
        <button type="button" aria-label="Download image" onClick={handleDownload}>
          <Download width={14} height={14} />
        </button>
      </Tooltip>
      {openConversion && selected && !showReference && (
        <Tooltip content="Convert or compress image">
          <button
            type="button"
            aria-label="Convert or compress image"
            onClick={() => openConversion([selected])}
          >
            <Photo width={14} height={14} />
          </button>
        </Tooltip>
      )}
      {onToggleFavorite ? (
        <Tooltip content={selected?.isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
          <button
            type="button"
            aria-label={selected?.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={Boolean(selected?.isFavorite)}
            onClick={() => selected && onToggleFavorite(selected.id)}
          >
            <Heart width={14} height={14} />
          </button>
        </Tooltip>
      ) : null}
      {onUseAsReference && selected ? (
        <Tooltip content="Use as source">
          <button
            type="button"
            aria-label="Use as source"
            onClick={() => onUseAsReference(selected)}
          >
            <Paperclip width={14} height={14} />
          </button>
        </Tooltip>
      ) : null}
      {onOpen && selected ? (
        <Tooltip content="Open result">
          <button type="button" aria-label="Open result" onClick={() => onOpen(selected)}>
            <OpenFull width={14} height={14} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function RecipeResultHeading({
  model,
}: {
  model: React.ComponentProps<typeof RecipeResultPreviewView>['model'];
}) {
  const { displayedReference, selected, reference, showReference, setShowReference, onOpen } =
    model;
  return (
    <div className="recipe-result-heading">
      <span>{displayedReference || !selected ? 'Reference preview' : 'Result'}</span>
      {reference && selected && (
        <button
          type="button"
          aria-pressed={showReference}
          onClick={() => setShowReference(!showReference)}
        >
          {showReference ? 'Show result' : 'Compare reference'}
        </button>
      )}
      {selected && !showReference && onOpen ? (
        <button type="button" onClick={() => onOpen(selected)}>
          Open result
        </button>
      ) : null}
    </div>
  );
}

function RecipeResultStrip({
  model,
}: {
  model: React.ComponentProps<typeof RecipeResultPreviewView>['model'];
}) {
  const {
    isStage,
    showReference,
    images,
    selectIndex,
    stripRef,
    stripDrag,
    thumbnailWindow,
    requestedImage,
  } = model;
  return (
    <div
      ref={stripRef}
      className="recipe-result-strip"
      aria-label={isStage ? 'Library results' : 'Recipe results'}
      {...stripDrag}
    >
      {(isStage ? thumbnailWindow.map((entry) => entry.item) : images.slice(0, 20)).map(
        (image, index) => {
          const resultIndex = isStage ? (thumbnailWindow[index]?.index ?? index) : index;
          return (
            <button
              type="button"
              key={image.id}
              draggable
              onDragStart={(event) => writeCatalogImageDrag(event, image.id)}
              aria-label={`View result ${resultIndex + 1}`}
              aria-pressed={requestedImage?.id === image.id && !showReference}
              onClick={() => selectIndex(resultIndex)}
            >
              <img src={image.thumbnail || image.src} alt="" draggable={false} />
            </button>
          );
        },
      )}
    </div>
  );
}

function RecipeResultContext({
  model,
}: {
  model: React.ComponentProps<typeof RecipeResultToolbar>['model'];
}) {
  const { canCompare, showReference, setShowReference } = model;
  const context = describeResultContext(model);
  return (
    <div className="result-context-controls" role="group" aria-label="Result context">
      <span className="result-context-label" data-tooltip={context.description}>
        {context.label}
      </span>
      {canCompare ? (
        <Tooltip content={showReference ? 'Show result' : 'Compare reference'}>
          <button
            type="button"
            aria-pressed={showReference}
            aria-label={showReference ? 'Show result' : 'Compare reference'}
            onClick={() => setShowReference((current) => !current)}
          >
            {showReference ? 'Result' : 'Compare'}
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function describeResultContext({
  displayedReference,
  selected,
  isGenerating,
  reference,
}: Pick<
  RecipeResultPreviewViewModel,
  'displayedReference' | 'selected' | 'isGenerating' | 'reference'
>) {
  if (displayedReference || !selected)
    return { label: 'Source image', description: 'Source image' };
  if (isGenerating) return { label: 'Previous result', description: 'Previous result' };
  if (reference?.dataUrl === selected.src)
    return { label: 'Used as source', description: 'Result · used as source' };
  return { label: 'Not a source', description: 'Recent result · not attached as source' };
}

function RecipeResultImagePresentation({
  model,
}: {
  model: React.ComponentProps<typeof RecipeResultCanvas>['model'];
}) {
  const { presentation, src, isStage, panZoom, displayedReference, selected } = model;
  return (
    <>
      {[presentation.previousSrc, src]
        .filter((source): source is string => Boolean(source))
        .map((source) => (
          <div
            key={source}
            aria-hidden={source !== src || undefined}
            onTransitionEnd={source === src ? presentation.finishTransition : undefined}
            className={`image-presentation-layer ${source === src ? 'image-swap-enter' : 'image-swap-previous'}`}
          >
            <img
              ref={isStage && source === src ? panZoom.contentRef : undefined}
              onLoad={isStage && source === src ? panZoom.onImageLoad : undefined}
              src={source}
              hidden={source === src && presentation.failed}
              aria-hidden={source !== src || undefined}
              alt={
                source !== src
                  ? ''
                  : displayedReference || !selected
                    ? 'Reference image'
                    : 'Generated result'
              }
              draggable={false}
            />
          </div>
        ))}
      {presentation.failed && (
        <p role="alert" className="image-load-error">
          Original image unavailable.
        </p>
      )}
    </>
  );
}
