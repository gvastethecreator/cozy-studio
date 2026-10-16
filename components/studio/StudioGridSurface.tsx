import type { LibraryFilters } from '../../hooks/useLibraryUrlState';
import React, { useCallback, useRef, useState } from 'react';

import type { AspectRatio, GeneratedImage, GeneratedImageWithConfig } from '../../types';
import { getCatalogRegenerateIssue } from '../../utils/catalogImageGenerationConfig';
import { downloadMultipleImagesAsZip } from '../../utils/fileUtils';
import { useToastUi } from '../../contexts/GlobalContext';
import { ErrorBoundary } from '../ErrorBoundary';
import { FormatPreview } from '../FormatPreview';
import { ImageGrid } from '../ImageGrid';
import { ImageComparison } from '../ImageComparison';

export interface StudioGridSurfaceProps {
  libraryFilters: LibraryFilters;
  onLibraryFiltersChange: (filters: Partial<LibraryFilters>) => void;
  onCreate?: () => void;
  activeWorkspaceId: string;
  allImages: GeneratedImage[];
  imagesWithConfig: GeneratedImageWithConfig[];
  selectedImageIds: string[];
  selectedImages: GeneratedImageWithConfig[];
  openModal: (image: GeneratedImageWithConfig) => void;
  handleSelectionChange: (id: string, selected: boolean) => void;
  handleGenerate: (
    promptOverride?: string,
    configOverrides?: Partial<GeneratedImageWithConfig['config']>,
    options?: { preventModal?: boolean; useCurrentAttachments?: boolean },
  ) => void;
  handleAddToContext: (image: GeneratedImageWithConfig) => void;
  handleUseAsSource: (image: GeneratedImageWithConfig) => void;
  handleLoadRecipe: (config: GeneratedImageWithConfig['config']) => void;
  handleDelete: (imageId: string) => void;
  handleToggleFavorite: (imageId: string) => void;
  transitioningImageId: string | null;
  activeModalImageId: string | null;
  handleSelectAll: (images: GeneratedImageWithConfig[]) => void;
  handleDeselectAll: () => void;
  handleDeleteSelected: (imageIds?: string[]) => void;
  handleClearWorkspace: (workspaceId: string) => void;
  chrome: {
    isModalOpen: boolean;
    isInteractingWithToolbar: boolean;
    previewRatio: AspectRatio | null;
    generationAspectRatio: AspectRatio;
  };
  generation: {
    isGenerating: boolean;
    placeholders?: React.ComponentProps<typeof ImageGrid>['generationPlaceholders'];
  };
  catalog: {
    total: number;
    hasMore: boolean;
    isLoading: boolean;
    error: string | null;
    loadMore: () => void | Promise<void>;
    refresh: () => void;
  };
}

export const StudioGridSurface: React.FC<StudioGridSurfaceProps> = ({
  libraryFilters,
  onLibraryFiltersChange,
  onCreate,
  activeWorkspaceId,
  allImages,
  imagesWithConfig,
  selectedImageIds,
  selectedImages,
  openModal,
  handleSelectionChange,
  handleGenerate,
  handleAddToContext,
  handleLoadRecipe,
  handleDelete,
  handleToggleFavorite,
  transitioningImageId,
  activeModalImageId,
  handleSelectAll,
  handleDeselectAll,
  handleDeleteSelected,
  handleClearWorkspace,
  chrome,
  generation,
  catalog,
}) => {
  const { addToast } = useToastUi();
  const exportLock = useRef(false);
  const [comparison, setComparison] = useState<
    [GeneratedImageWithConfig, GeneratedImageWithConfig] | null
  >(null);
  const [exportState, setExportState] = useState<{
    message: string;
    running: boolean;
    failedImages: GeneratedImageWithConfig[];
  } | null>(null);
  const exportImages = useCallback(async (images: GeneratedImageWithConfig[]) => {
    if (exportLock.current || images.length === 0) return;
    exportLock.current = true;
    setExportState({
      message: `Preparing images: 0 of ${images.length}…`,
      running: true,
      failedImages: [],
    });
    try {
      const result = await downloadMultipleImagesAsZip(
        images,
        `assets-${Date.now()}.zip`,
        ({ completed, total }) => {
          setExportState({
            message:
              completed === total
                ? 'Building ZIP archive…'
                : `Preparing images: ${completed} of ${total}…`,
            running: true,
            failedImages: [],
          });
        },
      );
      setExportState({
        message:
          result.exported === 0
            ? `No ZIP was downloaded. Could not load ${result.requested} image${result.requested === 1 ? '' : 's'}.`
            : result.failedImages.length
              ? `Partial ZIP downloaded: ${result.exported} of ${result.requested} images. Retry downloads the missing images in a separate ZIP.`
              : `ZIP downloaded: ${result.exported} image${result.exported === 1 ? '' : 's'}.`,
        running: false,
        failedImages: result.failedImages,
      });
    } catch {
      setExportState({
        message: 'The ZIP could not be created. Retry the download.',
        running: false,
        failedImages: images,
      });
    } finally {
      exportLock.current = false;
    }
  }, []);
  // Regenerate reuses the result's own saved sources, never the composer's current references.
  const handleGridRegenerate = useCallback(
    (config: GeneratedImageWithConfig['config']) => {
      const issue = getCatalogRegenerateIssue(config);
      if (issue) {
        addToast(issue, 'info');
        return;
      }
      handleGenerate(config.prompt, config, { preventModal: true });
    },
    [addToast, handleGenerate],
  );

  const handleGridSelectAll = useCallback(
    (visibleImages: GeneratedImageWithConfig[]) => {
      handleSelectAll(visibleImages);
    },
    [handleSelectAll],
  );

  const handleGridDownloadSelected = useCallback(() => {
    void exportImages(selectedImages);
  }, [exportImages, selectedImages]);

  const handleGridDownloadAll = useCallback(
    (visibleImages: GeneratedImageWithConfig[]) => {
      void exportImages(visibleImages);
    },
    [exportImages],
  );

  const handleGridDeleteSelected = useCallback(
    () => handleDeleteSelected(selectedImageIds),
    [handleDeleteSelected, selectedImageIds],
  );

  const handleGridClearWorkspace = useCallback(() => {
    handleClearWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, handleClearWorkspace]);

  return (
    <div className="flex-1 h-full relative overflow-hidden flex flex-col">
      {exportState && (
        <div
          role={exportState.failedImages.length ? 'alert' : 'status'}
          className="flex flex-wrap items-center gap-3 border-b border-[color:var(--wb-line)] px-4 py-3 text-sm"
        >
          <span>{exportState.message}</span>
          {exportState.failedImages.length > 0 && (
            <button
              type="button"
              className="studio-ghost-control rounded px-3 py-2"
              onClick={() => void exportImages(exportState.failedImages)}
            >
              Retry missing images
            </button>
          )}
          {!exportState.running && (
            <button
              type="button"
              className="studio-ghost-control rounded px-3 py-2"
              onClick={() => setExportState(null)}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
      <div className="flex-1 relative min-h-0">
        <ErrorBoundary fallbackMessage="Failed to render the image grid.">
          <ImageGrid
            libraryFilters={libraryFilters}
            onLibraryFiltersChange={onLibraryFiltersChange}
            workspaceId={activeWorkspaceId}
            onCreate={onCreate}
            key={activeWorkspaceId}
            images={imagesWithConfig}
            selectedImageIds={selectedImageIds}
            selectedImages={selectedImages}
            isExporting={exportState?.running}
            onCompareSelected={() => {
              if (selectedImages.length === 2)
                setComparison([selectedImages[0], selectedImages[1]]);
            }}
            onImageClick={openModal}
            onSelectionChange={handleSelectionChange}
            onRegenerate={handleGridRegenerate}
            onAddToContext={handleAddToContext}
            onLoadConfig={handleLoadRecipe}
            onDelete={handleDelete}
            onToggleFavorite={handleToggleFavorite}
            isGenerating={generation.isGenerating}
            transitioningImageId={transitioningImageId}
            activeModalImageId={activeModalImageId}
            generationPlaceholders={generation.placeholders}
            onSelectAll={handleGridSelectAll}
            onDeselectAll={handleDeselectAll}
            onDownloadSelected={handleGridDownloadSelected}
            onDownloadAll={handleGridDownloadAll}
            onDeleteSelected={handleGridDeleteSelected}
            onClearWorkspace={handleGridClearWorkspace}
            catalogTotal={catalog.total}
            hasMore={catalog.hasMore}
            isCatalogLoading={catalog.isLoading}
            catalogError={catalog.error}
            onLoadMore={catalog.loadMore}
            onRetryCatalog={catalog.refresh}
          />
        </ErrorBoundary>
      </div>
      {comparison && <ImageComparison images={comparison} onClose={() => setComparison(null)} />}
      <FormatPreview
        ratio={chrome.previewRatio || chrome.generationAspectRatio}
        isVisible={
          !chrome.isModalOpen && (chrome.isInteractingWithToolbar || !!chrome.previewRatio)
        }
        isWorkspaceEmpty={allImages.length === 0}
      />
    </div>
  );
};
