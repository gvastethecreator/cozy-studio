import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useToastUi } from '../contexts/GlobalContext';
import { useImageConversion } from '../contexts/ImageConversionContext';
import {
  NavArrowLeft as ChevronLeft,
  NavArrowRight as ChevronRight,
  Xmark as X,
  Download,
  PlusCircle,
  Refresh as RefreshCw,
  Trash as Trash2,
  Expand as Maximize2,
  Collapse as Minimize2,
  List as ClipboardList,
  Clock as History,
  Check,
  Heart,
  ViewColumns2 as SplitSquareHorizontal,
  Plus,
  Minus,
  Copy,
  MediaImage as Photo,
  SidebarCollapse,
} from 'iconoir-react';
import type { GeneratedImageWithConfig, ImageGenerationConfig } from '../types';
import ActionButton from './ui/ActionButton';
import { RecipeWorkbenchContext } from './recipes/recipeWorkbenchContextState';
import { CarouselImageDetails } from './CarouselImageDetails';
import { copyImageToClipboard, downloadImage, generateSmartFilename } from '../utils/fileUtils';
import {
  buildCarouselThumbnailWindow,
  type CarouselThumbnailWindowItem,
} from '../lib/imageCarouselThumbnails';

import { TopToolbar } from './ui/TopToolbar';
import { resolveStudioCarouselDisplaySrc } from '../lib/studioCarouselImage';
import { useLatestRef } from '../hooks/useLatestRef';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useHorizontalDragScroll } from '../hooks/useHorizontalDragScroll';
import { writeCatalogImageDrag } from '../lib/catalogImageDrag';
import { useImagePanZoom } from '../lib/imagePanZoom';
import { useImagePresentation } from '../hooks/useImagePresentation';
import { prefersReducedMotion } from '../lib/motionPreference';

interface ImageCarouselProps {
  activeImage: GeneratedImageWithConfig | null;
  allImages: GeneratedImageWithConfig[];
  activeGenerationConfig: ImageGenerationConfig | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRegenerate: (config: ImageGenerationConfig) => void;
  onAddToContext: (image: GeneratedImageWithConfig) => void;
  onLoadConfig: (config: ImageGenerationConfig) => void;
  onToggleFavorite: (id: string) => void;
  onActiveImageChange: (id: string) => void;
  transitionName?: string;
}

const CarouselImageItem: React.FC<{
  src: string;
  previousSrc?: string;
  onTransitionEnd: () => void;
  transitionName?: string;
  failed: boolean;
  isComparing: boolean;
  controlsTarget: HTMLElement | null;
}> = React.memo(
  ({ src, previousSrc, onTransitionEnd, transitionName, failed, isComparing, controlsTarget }) => {
    const [background, setBackground] = useState('dark');
    const panZoom = useImagePanZoom(true, src);

    return (
      <div
        ref={panZoom.viewportRef}
        className="size-full flex items-center justify-center relative overflow-hidden touch-none select-none"
        data-viewer-background={background}
        role="group"
        tabIndex={0}
        aria-label="Image pan and zoom area. Use plus and minus to zoom, arrows to pan, zero to fit."
        {...panZoom.viewportProps}
        onDoubleClick={() => {
          if (Math.abs(panZoom.scale - panZoom.fitScale) > 0.01) panZoom.fit();
          else panZoom.actualSize();
        }}
      >
        {controlsTarget &&
          createPortal(
            <>
              <div
                role="group"
                aria-label="Canvas background"
                className="carousel-background-controls"
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {['dark', 'light', 'checkered'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value[0].toUpperCase() + value.slice(1)} background`}
                    aria-pressed={background === value}
                    data-viewer-background={value}
                    onClick={() => setBackground(value)}
                  />
                ))}
              </div>
              <div
                role="group"
                aria-label="Zoom controls"
                className="carousel-zoom-controls"
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <ActionButton
                  icon={<Minus width={16} height={16} />}
                  label="Zoom out"
                  onClick={panZoom.zoomOut}
                />
                <button
                  type="button"
                  className="carousel-zoom-level"
                  aria-label="Reset zoom to 100%"
                  data-tooltip="Reset zoom to 100%"
                  onClick={panZoom.actualSize}
                >
                  {Math.round(panZoom.scale * 100)}%
                </button>
                <button
                  type="button"
                  className="carousel-zoom-level"
                  aria-label="Fit image"
                  data-tooltip="Fit image"
                  onClick={panZoom.fit}
                >
                  Fit
                </button>
                <ActionButton
                  icon={<Plus width={16} height={16} />}
                  label="Zoom in"
                  onClick={panZoom.zoomIn}
                />
              </div>
            </>,
            controlsTarget,
          )}
        {[previousSrc, src]
          .filter((source): source is string => Boolean(source))
          .map((source) => (
            <div
              key={source}
              aria-hidden={source !== src || undefined}
              onTransitionEnd={source === src ? onTransitionEnd : undefined}
              className={`image-presentation-layer ${source === src ? 'image-swap-enter' : 'image-swap-previous'}`}
            >
              <img
                ref={source === src ? panZoom.contentRef : undefined}
                src={source}
                alt=""
                draggable={false}
                onLoad={source === src ? panZoom.onImageLoad : undefined}
                hidden={source === src && failed}
                className="object-contain shadow-[0_2px_12px_#0002]"
                style={{
                  viewTransitionName:
                    source === src && !isComparing ? transitionName || 'master-canvas' : 'none',
                }}
              />
            </div>
          ))}

        {failed && (
          <div
            role="alert"
            className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full border border-amber-300/2 bg-amber-500/10 px-3 py-1 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-warning)]"
          >
            {isComparing ? 'Reference image unavailable.' : 'Original image unavailable.'}
          </div>
        )}
      </div>
    );
  },
);
interface CarouselTopBarProps {
  actions: React.ReactNode;
  setControlsTarget: (element: HTMLDivElement | null) => void;
  activeIndex: number;
  total: number;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  isFullscreen: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
}

function CarouselTopBar({
  actions,
  setControlsTarget,
  activeIndex,
  total,
  loading,
  error,
  onRetry,
  isFullscreen,
  detailsOpen,
  onToggleDetails,
  onClose,
  onToggleFullscreen,
}: CarouselTopBarProps) {
  return (
    <TopToolbar
      className="carousel-top-toolbar"
      role="toolbar"
      aria-label="Selected image actions and view"
    >
      <div className="carousel-image-actions">{actions}</div>
      <span className="carousel-count" role="status">
        {activeIndex + 1} / {total}
        {loading ? ' · Loading…' : ''}
      </span>
      {error && (
        <button type="button" onClick={onRetry} aria-label="Retry loading history">
          Retry
        </button>
      )}
      <div className="carousel-view-tools" ref={setControlsTarget} />
      <div className="carousel-window-actions">
        <button
          type="button"
          onClick={onToggleDetails}
          aria-label={detailsOpen ? 'Hide image details' : 'Show image details'}
          data-tooltip={detailsOpen ? 'Hide image details' : 'Show image details'}
          aria-expanded={detailsOpen}
          aria-controls="carousel-image-details"
          className="studio-icon-action studio-ghost-control"
        >
          <SidebarCollapse width={16} height={16} />
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          data-tooltip={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className="min-h-8 min-w-8 rounded-[var(--wb-radius)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] p-1.5 text-[color:var(--wb-muted)] transition-[background-color,color,transform] hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)] cursor-pointer"
        >
          {isFullscreen ? (
            <Minimize2 width={15} height={15} />
          ) : (
            <Maximize2 width={15} height={15} />
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close image carousel"
          data-tooltip="Close"
          className="min-h-8 min-w-8 rounded-[var(--wb-radius)] bg-[color:var(--wb-panel)] p-1.5 text-[color:var(--wb-ink)] shadow-xl transition-[background-color,color,transform] hover:bg-red-500/20 hover:text-red-500 cursor-pointer"
        >
          <X width={15} height={15} />
        </button>
      </div>
    </TopToolbar>
  );
}

function CarouselFilmstrip({
  navScrollRef,
  thumbnailWindow,
  activeIndex,
  total,
  onJumpTo,
}: {
  navScrollRef: React.RefObject<HTMLDivElement | null>;
  thumbnailWindow: CarouselThumbnailWindowItem<GeneratedImageWithConfig>[];
  activeIndex: number;
  total: number;
  onJumpTo: (index: number) => void;
}) {
  const thumbnailDrag = useHorizontalDragScroll(navScrollRef);
  return (
    <div
      ref={navScrollRef}
      aria-label="Image thumbnails"
      role="toolbar"
      className="carousel-filmstrip custom-scrollbar"
      {...thumbnailDrag}
    >
      {thumbnailWindow.map(({ item: img, index: idx }) => (
        <button
          type="button"
          key={img.id}
          data-carousel-index={idx}
          draggable
          onDragStart={(event) => writeCatalogImageDrag(event, img.id)}
          aria-label={`Open image ${idx + 1} of ${total}`}
          aria-pressed={idx === activeIndex}
          onClick={() => onJumpTo(idx)}
          className={`carousel-thumbnail relative shrink-0 rounded-[var(--wb-radius)] overflow-hidden border snap-center cursor-pointer transition-[border-color,box-shadow,opacity] duration-150
                            ${
                              idx === activeIndex
                                ? 'ring-2 ring-[var(--wb-accent)] border-transparent opacity-100'
                                : 'opacity-60 hover:opacity-100 border-transparent'
                            }
                        `}
        >
          <img
            src={img.thumbnail || img.src}
            draggable={false}
            alt=""
            width={40}
            height={40}
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
          {img.isFavorite && (
            <div className="absolute top-1 right-1">
              <Heart width={8} height={8} className="text-accent-400 fill-accent-400" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

const ImageCarousel: React.FC<ImageCarouselProps> = (props) => {
  const model = useImageCarousel(props);
  return <ImageCarouselView model={model} />;
};

export default ImageCarousel;

function useImageCarousel(props: ImageCarouselProps) {
  const {
    activeImage,
    allImages,
    activeGenerationConfig,
    onClose,
    onDelete,
    onRegenerate,
    onAddToContext,
    onLoadConfig,
    onToggleFavorite,
    onActiveImageChange,
    transitionName,
  } = props;
  const { addToast } = useToastUi();
  const openConversion = useImageConversion();
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  const { history } = React.useContext(RecipeWorkbenchContext);
  const activeIndex = useMemo(() => {
    if (!activeImage || allImages.length === 0) return 0;
    const idx = allImages.findIndex((img) => img.id === activeImage.id);
    return idx !== -1 ? idx : 0;
  }, [activeImage, allImages]);

  useEffect(() => {
    if (
      history?.hasMore &&
      !history.isLoading &&
      !history.error &&
      activeIndex >= allImages.length - 12
    )
      void history.loadMore();
  }, [history, activeIndex, allImages.length]);

  const lastSetIndexRef = useRef(activeIndex);

  React.useLayoutEffect(() => {
    if (!allImages.some((image) => image.id === activeImage?.id)) return;
    lastSetIndexRef.current = activeIndex;
  }, [activeImage?.id, activeIndex, allImages]);

  const [carouselState, setCarouselState] = useState({
    isFullscreen: false,
    copiedPrompt: false,
    isComparing: false,
    detailsOpen: true,
  });
  const { isFullscreen, copiedPrompt, isComparing, detailsOpen } = carouselState;
  const timeoutRef = useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  const isProcessingDownloadRef = useRef(false);

  const containerRef = useDialogFocus<HTMLDialogElement>(Boolean(activeImage), () => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => addToast('Could not exit fullscreen.', 'error'));
    else onClose();
  });
  const navScrollRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncFullscreen = () => {
      const fullscreen = document.fullscreenElement === fullscreenRef.current;
      setCarouselState((current) =>
        current.isFullscreen === fullscreen ? current : { ...current, isFullscreen: fullscreen },
      );
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    if (allImages.length === 0 && !history?.isLoading && !history?.error) {
      onClose();
      return;
    }
    if (
      !activeImage ||
      allImages.some((image) => image.id === activeImage.id) ||
      allImages.length === 0
    )
      return;
    const clampedIndex = Math.min(lastSetIndexRef.current, allImages.length - 1);
    lastSetIndexRef.current = clampedIndex;
    onActiveImageChange(allImages[clampedIndex].id);
  }, [
    activeImage,
    activeIndex,
    allImages,
    onActiveImageChange,
    onClose,
    history?.isLoading,
    history?.error,
  ]);

  const handleJumpTo = useCallback(
    (index: number) => {
      if (index === lastSetIndexRef.current || index < 0 || index >= allImages.length) return;
      setCarouselState((prev) => ({
        ...prev,
        copiedPrompt: false,
        isComparing: false,
      }));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      lastSetIndexRef.current = index;
      onActiveImageChange(allImages[index].id);
    },
    [allImages, onActiveImageChange],
  );

  const handleNext = useCallback(() => {
    if (allImages.length === 0) return;
    const nextIndex = (lastSetIndexRef.current + 1) % allImages.length;
    handleJumpTo(nextIndex);
  }, [allImages.length, handleJumpTo]);

  const handlePrev = useCallback(() => {
    if (allImages.length === 0) return;
    const prevIndex = (lastSetIndexRef.current - 1 + allImages.length) % allImages.length;
    handleJumpTo(prevIndex);
  }, [allImages.length, handleJumpTo]);

  const handleNextRef = useLatestRef(handleNext);
  const handlePrevRef = useLatestRef(handlePrev);
  const onCloseRef = useLatestRef(onClose);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (
        e.defaultPrevented ||
        containerRef.current?.closest('[inert]') ||
        (target?.closest('dialog, [role="dialog"]') &&
          target.closest('dialog, [role="dialog"]') !== containerRef.current) ||
        target?.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.key === 'ArrowRight') handleNextRef.current();
        else handlePrevRef.current();
      }
      if (e.code === 'Space' && !e.repeat && !target?.closest('button'))
        setCarouselState((prev) => ({ ...prev, isComparing: true }));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setCarouselState((prev) => ({ ...prev, isComparing: false }));
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleNextRef, handlePrevRef, onCloseRef, containerRef]);

  const requestedImage =
    activeIndex >= 0 && activeIndex < allImages.length ? allImages[activeIndex] : activeImage;
  const presentation = useImagePresentation(
    { image: requestedImage, isComparing },
    requestedImage
      ? resolveStudioCarouselDisplaySrc({ image: requestedImage, isComparing })
      : undefined,
    history?.scopeKey,
  );
  const currentImage = presentation.value.image;
  const displayedIndex = currentImage
    ? allImages.findIndex((image) => image.id === currentImage.id)
    : activeIndex;
  useEffect(() => {
    const strip = navScrollRef.current;
    const scrollActive = (behavior: ScrollBehavior) =>
      strip?.querySelector(`[data-carousel-index="${activeIndex}"]`)?.scrollIntoView({
        behavior,
        block: 'nearest',
        inline: 'center',
      });
    scrollActive(prefersReducedMotion() ? 'instant' : 'smooth');
    if (!strip || typeof ResizeObserver === 'undefined') return;
    let width = strip.clientWidth;
    const observer = new ResizeObserver(() => {
      if (strip.clientWidth === width) return;
      width = strip.clientWidth;
      scrollActive('instant');
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [activeIndex]);
  const thumbnailWindow = useMemo(
    () => buildCarouselThumbnailWindow(allImages, activeIndex),
    [activeIndex, allImages],
  );

  const executeDownload = async () => {
    if (!currentImage || isProcessingDownloadRef.current) return;
    isProcessingDownloadRef.current = true;

    try {
      const promptSlug = currentImage.config.prompt ? currentImage.config.prompt : 'image';
      const smartName = generateSmartFilename(
        promptSlug,
        currentImage.id,
        currentImage.config.model,
        currentImage.config.aspectRatio,
        undefined,
        currentImage.mimeType,
        currentImage.localPath,
      );
      downloadImage(currentImage.sourceUrl ?? currentImage.src, smartName);
    } catch {
      addToast('Could not download image.', 'error');
    } finally {
      isProcessingDownloadRef.current = false;
    }
  };

  const handleDownloadClick = () => {
    void executeDownload();
  };

  const handleCopyPrompt = () => {
    if (!currentImage || copiedPrompt) return;
    void navigator.clipboard.writeText(currentImage.config.prompt || '').then(
      () => {
        setCarouselState((prev) => ({ ...prev, copiedPrompt: true }));
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(
          () => setCarouselState((prev) => ({ ...prev, copiedPrompt: false })),
          2000,
        );
      },
      () => addToast('Could not copy prompt.', 'error'),
    );
  };

  // Saved sources may carry only a local path. Compare needs an image the browser can show.
  const hasReference = Boolean(currentImage?.config.attachments?.[0]?.dataUrl);

  return {
    currentImage,
    containerRef,
    fullscreenRef,
    addToast,
    presentation,
    detailsOpen,
    setControlsTarget,
    handleDownloadClick,
    openConversion,
    onToggleFavorite,
    onAddToContext,
    activeIndex,
    displayedIndex,
    history,
    allImages,
    isFullscreen,
    setCarouselState,
    onClose,
    handlePrev,
    handleNext,
    controlsTarget,
    transitionName,
    isComparing,
    navScrollRef,
    thumbnailWindow,
    handleJumpTo,
    hasReference,
    onLoadConfig,
    onRegenerate,
    onDelete,
    handleCopyPrompt,
    copiedPrompt,
  };
}
type ImageCarouselModel = ReturnType<typeof useImageCarousel>;
function ImageCarouselView({ model }: { model: ImageCarouselModel }) {
  const {
    currentImage,
    containerRef,
    fullscreenRef,
    addToast,
    presentation,
    detailsOpen,
    setControlsTarget,
    activeIndex,
    displayedIndex,
    history,
    allImages,
    isFullscreen,
    setCarouselState,
    onClose,
    handlePrev,
    handleNext,
    controlsTarget,
    transitionName,
    isComparing,
    navScrollRef,
    thumbnailWindow,
    handleJumpTo,
    handleCopyPrompt,
    copiedPrompt,
  } = model;
  if (!currentImage) return null;

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await fullscreenRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      addToast('Could not change fullscreen mode.', 'error');
    }
  };

  return (
    <dialog
      ref={containerRef}
      aria-modal="true"
      aria-label="Image viewer"
      tabIndex={-1}
      className="studio-modal"
      aria-busy={presentation.pending}
      style={{ viewTransitionName: 'modal-backdrop' }}
    >
      <div
        ref={fullscreenRef}
        className="carousel-viewer fixed inset-0 z-100 flex flex-col studio-scrim overflow-hidden"
        data-image-transition={Boolean(presentation.previousSrc)}
        data-details-open={detailsOpen}
      >
        <CarouselTopBar
          setControlsTarget={setControlsTarget}
          actions={<CarouselImageActions model={{ ...model, currentImage }} />}
          activeIndex={Math.max(0, displayedIndex)}
          total={history?.total ?? allImages.length}
          loading={history?.isLoading ?? false}
          error={Boolean(history?.error)}
          onRetry={() => {
            void history?.refresh().catch(() => undefined);
          }}
          isFullscreen={isFullscreen}
          detailsOpen={detailsOpen}
          onToggleDetails={() =>
            setCarouselState((prev) => ({ ...prev, detailsOpen: !prev.detailsOpen }))
          }
          onClose={onClose}
          onToggleFullscreen={handleToggleFullscreen}
        />

        <div className="carousel-body">
          <div className="carousel-canvas-column">
            <section
              aria-label="Full image preview"
              className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center"
            >
              {allImages.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePrev();
                    }}
                    aria-label="Previous image"
                    className="studio-ghost-control absolute left-4 z-50 size-10 bg-[color:var(--wb-panel)] group cursor-pointer"
                  >
                    <ChevronLeft
                      width={40}
                      height={40}
                      className="group-hover:-translate-x-1 transition-transform"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNext();
                    }}
                    aria-label="Next image"
                    className="studio-ghost-control absolute right-4 z-50 size-10 bg-[color:var(--wb-panel)] group cursor-pointer"
                  >
                    <ChevronRight
                      width={40}
                      height={40}
                      className="group-hover:translate-x-1 transition-transform"
                    />
                  </button>
                </>
              )}
              <CarouselImageItem
                controlsTarget={controlsTarget}
                src={presentation.src!}
                previousSrc={presentation.previousSrc}
                onTransitionEnd={presentation.finishTransition}
                transitionName={transitionName}
                failed={presentation.failed}
                isComparing={presentation.value.isComparing}
              />
            </section>

            <CarouselFilmstrip
              navScrollRef={navScrollRef}
              thumbnailWindow={thumbnailWindow}
              activeIndex={activeIndex}
              total={history?.total ?? allImages.length}
              onJumpTo={handleJumpTo}
            />
          </div>
          <CarouselImageDetails
            hidden={!detailsOpen}
            image={
              presentation.width && !presentation.value.isComparing
                ? { ...currentImage, width: presentation.width, height: presentation.height }
                : currentImage
            }
          >
            <CarouselDetailActions model={{ ...model, currentImage }} />
          </CarouselImageDetails>
        </div>
        <footer className="carousel-prompt-bar" aria-label="Image prompt">
          <span className="text-xs text-[var(--wb-muted)]">Prompt</span>
          <p key={currentImage.config.prompt} className="image-metadata-enter">
            {currentImage.config.prompt || 'No prompt saved.'}
          </p>
          <ActionButton
            onClick={handleCopyPrompt}
            icon={
              copiedPrompt ? (
                <Check width={16} height={16} />
              ) : (
                <ClipboardList width={16} height={16} />
              )
            }
            label="Copy prompt"
            disabled={!currentImage.config.prompt}
          />
        </footer>
      </div>
    </dialog>
  );
}

function CarouselImageActions({
  model,
}: {
  model: ImageCarouselModel & { currentImage: GeneratedImageWithConfig };
}) {
  const {
    currentImage,
    addToast,
    handleDownloadClick,
    openConversion,
    onToggleFavorite,
    onAddToContext,
  } = model;
  return (
    <>
      <ActionButton
        icon={<Copy width={16} height={16} />}
        label="Copy image"
        onClick={() => {
          void copyImageToClipboard(currentImage.sourceUrl ?? currentImage.src).then(
            () => addToast('Image copied', 'success'),
            () => addToast('Could not copy image', 'error'),
          );
        }}
      />
      <ActionButton
        icon={<Download width={16} height={16} />}
        label="Download image"
        onClick={handleDownloadClick}
      />
      {openConversion && (
        <ActionButton
          icon={<Photo width={16} height={16} />}
          label="Convert or compress image"
          onClick={() => openConversion([currentImage])}
        />
      )}
      <ActionButton
        icon={<Heart width={16} height={16} />}
        label={currentImage.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        isActive={currentImage.isFavorite}
        onClick={() => onToggleFavorite(currentImage.id)}
      />
      <ActionButton
        icon={<PlusCircle width={16} height={16} />}
        label="Use as reference"
        onClick={() => onAddToContext(currentImage)}
      />
    </>
  );
}

function CarouselDetailActions({
  model,
}: {
  model: ImageCarouselModel & { currentImage: GeneratedImageWithConfig };
}) {
  const {
    hasReference,
    isComparing,
    setCarouselState,
    onLoadConfig,
    currentImage,
    onRegenerate,
    onDelete,
  } = model;
  return (
    <div className="carousel-detail-actions">
      <button
        type="button"
        aria-label="Compare with original"
        disabled={!hasReference}
        aria-pressed={isComparing}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            setCarouselState((prev) => ({ ...prev, isComparing: true }));
          }
        }}
        onKeyUp={(event) => {
          if (event.key === ' ' || event.key === 'Enter')
            setCarouselState((prev) => ({ ...prev, isComparing: false }));
        }}
        onBlur={() => setCarouselState((prev) => ({ ...prev, isComparing: false }))}
        onPointerDown={() => setCarouselState((prev) => ({ ...prev, isComparing: true }))}
        onPointerUp={() => setCarouselState((prev) => ({ ...prev, isComparing: false }))}
        onPointerLeave={() => setCarouselState((prev) => ({ ...prev, isComparing: false }))}
        className={`studio-icon-action studio-ghost-control ${isComparing ? 'is-active' : ''}`}
        data-tooltip="Hold to Compare with Original"
      >
        <SplitSquareHorizontal width={16} height={16} />
      </button>

      <ActionButton
        onClick={() => onLoadConfig(currentImage.config)}
        icon={<History width={16} height={16} />}
        label="Reuse settings"
      />
      <ActionButton
        onClick={() => onRegenerate(currentImage.config)}
        icon={<RefreshCw width={16} height={16} />}
        label="Generate variation"
        variant="primary"
      />
      <ActionButton
        onClick={() => onDelete(currentImage.id)}
        icon={<Trash2 width={16} height={16} />}
        label="Move to trash"
        variant="danger"
      />
    </div>
  );
}
