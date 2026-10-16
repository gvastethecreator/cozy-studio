import { useState, useCallback, useMemo, useEffect } from 'react';
import type { GeneratedImageWithConfig } from '../types';

import { startViewTransition } from '../utils/transitionUtils';

interface UseImageManagerProps {
  activeWorkspaceId: string;
  log: (message: string) => void;
  handleCloseModal: () => void;
  modalImage?: GeneratedImageWithConfig | null;
  images?: GeneratedImageWithConfig[];
  deleteImage: (imageId: string) => void;
  deleteImages: (imageIds: string[]) => void;
  toggleImageFavorite: (imageId: string) => void;
  clearWorkspace: (workspaceId: string) => void;
  onRequestClearWorkspace?: (workspaceId: string) => void | Promise<void>;
}

/**
 * A custom hook to manage the state and actions related to the image gallery.
 * This includes handling image selection, deletion (single and multiple),
 * and providing a flattened list of all images for rendering.
 */
export const useImageManager = ({
  activeWorkspaceId,
  log,
  handleCloseModal,
  modalImage,
  images,
  deleteImage,
  deleteImages,
  toggleImageFavorite,
  clearWorkspace,
  onRequestClearWorkspace,
}: UseImageManagerProps) => {
  const [selectionByWorkspace, setSelectionByWorkspace] = useState<
    Record<string, GeneratedImageWithConfig[]>
  >({});

  const allImages = useMemo(() => {
    return images ?? [];
  }, [images]);

  const availableIds = useMemo(() => new Set(allImages.map((image) => image.id)), [allImages]);
  const selectedImages = useMemo(
    () => selectionByWorkspace[activeWorkspaceId] ?? [],
    [selectionByWorkspace, activeWorkspaceId],
  );
  const selectedImageIds = useMemo(() => selectedImages.map((image) => image.id), [selectedImages]);
  const updateSelection = useCallback(
    (update: (previous: GeneratedImageWithConfig[]) => GeneratedImageWithConfig[]) => {
      setSelectionByWorkspace((previous) => {
        const current = previous[activeWorkspaceId] ?? [];
        const next = update(current);
        return next === current ? previous : { ...previous, [activeWorkspaceId]: next };
      });
    },
    [activeWorkspaceId],
  );
  useEffect(() => {
    const currentImages = new Map(allImages.map((image) => [image.id, image]));
    updateSelection((previous) => {
      const next = previous.map((image) => currentImages.get(image.id) ?? image);
      return next.every((image, index) => image === previous[index]) ? previous : next;
    });
  }, [allImages, updateSelection]);

  const handleSelectionChange = useCallback(
    (id: string, selected: boolean) => {
      startViewTransition(() => {
        updateSelection((prev) =>
          selected
            ? prev.some((image) => image.id === id) || !availableIds.has(id)
              ? prev
              : [...prev, allImages.find((image) => image.id === id)!]
            : prev.filter((image) => image.id !== id),
        );
      });
    },
    [availableIds, allImages, updateSelection],
  );

  const handleDelete = useCallback(
    (imageId: string) => {
      const performDelete = () => {
        if (!allImages.some((image) => image.id === imageId)) return;

        deleteImage(imageId);

        updateSelection((prev) => prev.filter((image) => image.id !== imageId));
        if (modalImage?.id === imageId) {
          handleCloseModal();
        }
        log(`Moved image ${imageId} to archives`);
      };

      startViewTransition(performDelete);
    },
    [allImages, modalImage, deleteImage, handleCloseModal, log, updateSelection],
  );

  const handleDeleteSelected = useCallback(
    (imageIds = selectedImageIds) => {
      const selectedIds = new Set(selectedImageIds);
      imageIds = [...new Set(imageIds)].filter((id) => availableIds.has(id) || selectedIds.has(id));
      const performDelete = () => {
        if (imageIds.length > 0) {
          const imageIdSet = new Set(imageIds);
          deleteImages(imageIds);
          log(`Moved ${imageIds.length} selected images to archives.`);
          if (modalImage && imageIdSet.has(modalImage.id)) {
            handleCloseModal();
          }
          updateSelection((prev) => prev.filter((image) => !imageIdSet.has(image.id)));
        }
      };
      startViewTransition(performDelete);
    },
    [
      selectedImageIds,
      availableIds,
      deleteImages,
      log,
      modalImage,
      handleCloseModal,
      updateSelection,
    ],
  );

  const handleSelectAll = useCallback(
    (images: GeneratedImageWithConfig[]) => {
      startViewTransition(() => {
        updateSelection((previous) => [
          ...new Map([
            ...previous.map((image) => [image.id, image] as const),
            ...images
              .filter((image) => availableIds.has(image.id))
              .map((image) => [image.id, image] as const),
          ]).values(),
        ]);
        log(`Selected all ${images.length} images.`);
      });
    },
    [log, availableIds, updateSelection],
  );

  const handleDeselectAll = useCallback(() => {
    startViewTransition(() => {
      updateSelection(() => []);
      log('Deselected all images.');
    });
  }, [log, updateSelection]);

  const clearWorkspaceSelection = useCallback((workspaceId: string) => {
    setSelectionByWorkspace((previous) => ({ ...previous, [workspaceId]: [] }));
  }, []);

  const handleToggleFavorite = useCallback(
    (imgId: string) => {
      toggleImageFavorite(imgId);
    },
    [toggleImageFavorite],
  );

  const handleClearWorkspace = useCallback(
    (activeWorkspaceId: string) => {
      if (onRequestClearWorkspace) {
        void onRequestClearWorkspace(activeWorkspaceId);
        return;
      }

      startViewTransition(() => {
        clearWorkspace(activeWorkspaceId);
        updateSelection(() => []);
        log(`Moved workspace ${activeWorkspaceId} images to archives.`);
      });
    },
    [clearWorkspace, log, onRequestClearWorkspace, updateSelection],
  );

  return {
    allImages,
    selectedImageIds,
    selectedImages,
    clearWorkspaceSelection,
    handleSelectionChange,
    handleDelete,
    handleDeleteSelected,
    handleSelectAll,
    handleDeselectAll,
    handleToggleFavorite,
    handleClearWorkspace,
  };
};
