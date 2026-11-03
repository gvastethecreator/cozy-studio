import type {
  CatalogCollection,
  CatalogCollectionPatch,
  CatalogCollectionSelection,
  CatalogCommandFilter,
  CatalogImage,
  CatalogOrganizeInput,
  CatalogOrganizeResult,
  CatalogOrganizeSuggestion,
  CatalogOrganizeUndoResult,
  CatalogOrganizeHistoryEntry,
  CatalogPage,
  CatalogSortOption,
  CatalogWorkspaceSummary,
  CatalogTag,
  CatalogTagPatch,
  CatalogSmartRule,
  CatalogFacets,
} from '../../../packages/shared/src';

export interface RegisterCatalogImageInput {
  libraryId?: string | null;
  filePath: string;
  thumbnailPath?: string | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  aspectRatio?: string | null;
  imageSize?: string | null;
  width?: number | null;
  height?: number | null;
  mimeType: string;
  fileSizeBytes?: number | null;
  jobId?: string | null;
  workspaceId?: string | null;
  batchId?: string | null;
  recipeId?: string | null;
  tags?: string[];
  generationConfig?: Record<string, unknown> | null;
}

export interface QueryCatalogFilters {
  id?: string;
  recipeId?: string | null;
  libraryId?: string | null;
  workspaceId?: string | null;
  jobId?: string | null;
  batchId?: string | null;
  favorite?: boolean;
  collectionId?: string | null;
  unorganized?: boolean;
  isDeleted?: boolean;
  q?: string | null;
  sort?: CatalogSortOption;
  offset?: number;
  limit?: number;
}

export type CatalogUpdatePatch = {
  isFavorite?: boolean;
  workspaceId?: string | null;
};

export interface StudioCatalogStore {
  getCatalogImage(id: string): CatalogImage | null;
  queryCatalog(filters?: QueryCatalogFilters): CatalogPage;
  queryWorkspaceSummaries(filters?: {
    libraryId?: string | null;
    isDeleted?: boolean;
  }): CatalogWorkspaceSummary[];
  listCatalogImageIds(filters?: CatalogCommandFilter): string[];
  registerCatalogImage(input: RegisterCatalogImageInput): CatalogImage;
  updateCatalogImage(id: string, patch: CatalogUpdatePatch): CatalogImage | null;
  softDeleteCatalogImage(id: string): CatalogImage | null;
  restoreCatalogImage(id: string): CatalogImage | null;
  purgeCatalogImage(id: string): CatalogImage | null;
  listCollections(workspaceId: string): CatalogCollection[];
  listFacets(workspaceId: string): CatalogFacets;
  listCollectionSelection(workspaceId: string, imageIds: string[]): CatalogCollectionSelection[];
  createCollection(input: {
    workspaceId: string;
    name: string;
    emoji?: string | null;
    imageIds: string[];
    rule?: CatalogSmartRule;
  }): CatalogCollection;
  updateCollection(id: string, patch: CatalogCollectionPatch): CatalogCollection | null;
  deleteCollection(id: string): boolean;
  /** One transaction: every image and change is checked first, so a rejection changes nothing. */
  organizeImages(input: CatalogOrganizeInput): CatalogOrganizeResult;
  suggestOrganization(workspaceId: string): CatalogOrganizeSuggestion;
  undoOrganize(operationId: string): CatalogOrganizeUndoResult | null;
  listOrganizeHistory(workspaceId: string, limit?: number): CatalogOrganizeHistoryEntry[];
  listTags(workspaceId: string): CatalogTag[];
  createTag(workspaceId: string, name: string, color: string | null): CatalogTag;
  updateTag(workspaceId: string, name: string, patch: CatalogTagPatch): CatalogTag | null;
}

export async function createDefaultCatalogStore(): Promise<StudioCatalogStore> {
  const [catalog, collections, tags, organize] = await Promise.all([
    import('./catalog'),
    import('./catalogCollections'),
    import('./catalogTags'),
    import('./catalogOrganize'),
  ]);
  const {
    getCatalogImage,
    listCatalogImageIds,
    purgeCatalogImage,
    queryCatalog,
    queryCatalogWorkspaceSummaries,
    registerCatalogImage,
    restoreCatalogImage,
    softDeleteCatalogImage,
    updateCatalogImage,
  } = catalog;
  const {
    createCatalogCollection,
    deleteCatalogCollection,
    listCatalogCollections,
    listCatalogCollectionSelection,
    organizeCatalogImages,
    undoCatalogOrganize,
    listCatalogOrganizeHistory,
    updateCatalogCollection,
  } = collections;
  const { listCatalogTags, createCatalogTag, updateCatalogTag } = tags;
  const withLiveCount = (collection: CatalogCollection): CatalogCollection =>
    collection.kind === 'smart'
      ? {
          ...collection,
          imageCount: queryCatalog({
            workspaceId: collection.workspaceId,
            collectionId: collection.id,
            limit: 1,
          }).total,
        }
      : collection;

  return {
    getCatalogImage,
    listCatalogImageIds,
    queryCatalog,
    queryWorkspaceSummaries: queryCatalogWorkspaceSummaries,
    registerCatalogImage,
    updateCatalogImage,
    softDeleteCatalogImage,
    restoreCatalogImage,
    purgeCatalogImage,
    // ponytail: one COUNT per smart collection per list.
    listCollections: (workspaceId) => listCatalogCollections(workspaceId).map(withLiveCount),
    listFacets: catalog.listCatalogFacets,
    listCollectionSelection: listCatalogCollectionSelection,
    createCollection: (input) => withLiveCount(createCatalogCollection(input)),
    updateCollection: (id, patch) => {
      const collection = updateCatalogCollection(id, patch);
      return collection ? withLiveCount(collection) : null;
    },
    deleteCollection: deleteCatalogCollection,
    organizeImages: organizeCatalogImages,
    suggestOrganization: organize.suggestCatalogOrganization,
    undoOrganize: undoCatalogOrganize,
    listOrganizeHistory: listCatalogOrganizeHistory,
    listTags: listCatalogTags,
    createTag: createCatalogTag,
    updateTag: updateCatalogTag,
  };
}
