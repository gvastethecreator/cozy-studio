export const CATALOG_IMAGE_DRAG_TYPE = 'application/x-cozy-catalog-image';

export function writeCatalogImageDrag(event: React.DragEvent, imageId: string) {
  event.stopPropagation();
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(CATALOG_IMAGE_DRAG_TYPE, imageId);
}
