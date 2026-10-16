import type {
  CatalogCollection,
  CatalogCollectionPatch,
  CatalogCollectionSelection,
  CatalogCommandFilter,
  CatalogImage,
  CatalogPage,
  CatalogSortOption,
  CatalogWorkspaceSummary,
  CatalogTag,
  CatalogTagPatch,
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
  isDeleted?: boolean;
  q?: string | null;
  sort?: CatalogSortOption;
  offset?: number;
  limit?: number;
}

export type CatalogUpdatePatch = {
  isFavorite?: boolean;
  tags?: string[];
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
  listCollectionSelection(workspaceId: string, imageIds: string[]): CatalogCollectionSelection[];
  createCollection(input: {
    workspaceId: string;
    name: string;
    emoji?: string | null;
    imageIds: string[];
  }): CatalogCollection;
  updateCollection(id: string, patch: CatalogCollectionPatch): CatalogCollection | null;
  deleteCollection(id: string): boolean;
  listTags(workspaceId: string): CatalogTag[];
  createTag(workspaceId: string, name: string, color: string | null): CatalogTag;
  updateTag(workspaceId: string, name: string, patch: CatalogTagPatch): CatalogTag | null;
}

export async function createDefaultCatalogStore(): Promise<StudioCatalogStore> {
  const [catalog, collections, tags] = await Promise.all([
    import('./catalog'),
    import('./catalogCollections'),
    import('./catalogTags'),
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
    updateCatalogCollection,
  } = collections;
  const { listCatalogTags, createCatalogTag, updateCatalogTag } = tags;

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
    listCollections: listCatalogCollections,
    listCollectionSelection: listCatalogCollectionSelection,
    createCollection: createCatalogCollection,
    updateCollection: updateCatalogCollection,
    deleteCollection: deleteCatalogCollection,
    listTags: listCatalogTags,
    createTag: createCatalogTag,
    updateTag: updateCatalogTag,
  };
}
