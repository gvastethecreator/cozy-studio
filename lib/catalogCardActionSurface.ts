export const CATALOG_CARD_ACTION_TOUCH_MAX_WIDTH = 639;

export interface CatalogCardActionSurfaceState {
  alwaysShowActions: boolean;
  isActionSurfaceActive: boolean;
  isSelected: boolean;
}

export function shouldAlwaysShowCatalogCardActions(viewportWidth: number) {
  return viewportWidth <= CATALOG_CARD_ACTION_TOUCH_MAX_WIDTH;
}

export function shouldMountCatalogCardActions({
  alwaysShowActions,
  isActionSurfaceActive,
  isSelected,
}: CatalogCardActionSurfaceState) {
  return alwaysShowActions || isSelected || isActionSurfaceActive;
}
