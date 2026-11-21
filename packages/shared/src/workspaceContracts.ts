export const DEFAULT_WORKSPACE_ID = 'default';

export type StudioWorkspaceSortOrder = 'newest' | 'oldest' | 'favorite';

/**
 * One link in a Workspace Style Scope: a whole style pack, one category of it (by category name,
 * as presets carry it), or one preset. Pack ids are portable; workspace ids are not.
 */
export interface WorkspaceStyleRef {
  packId: string;
  category?: string;
  presetId?: string;
}

export const MAX_WORKSPACE_STYLE_REFS = 200;

export interface StudioWorkspace {
  id: string;
  name: string;
  filter: Record<string, unknown>;
  sortOrder: StudioWorkspaceSortOrder;
  /** The styles the user linked to this workspace's project, in order. Empty means none. */
  styleScope: WorkspaceStyleRef[];
  createdAt: string;
  updatedAt: string;
}

function readStyleRefText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Keeps valid, unique refs in order; a preset ref wins over a category on the same ref. */
export function normalizeWorkspaceStyleScope(value: unknown): WorkspaceStyleRef[] {
  if (!Array.isArray(value)) return [];
  const refs: WorkspaceStyleRef[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const packId = readStyleRefText(record.packId);
    if (!packId) continue;
    const presetId = readStyleRefText(record.presetId);
    const category = presetId ? undefined : readStyleRefText(record.category);
    const ref: WorkspaceStyleRef = {
      packId,
      ...(category && { category }),
      ...(presetId && { presetId }),
    };
    const key = workspaceStyleRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length >= MAX_WORKSPACE_STYLE_REFS) break;
  }
  return refs;
}

export function workspaceStyleRefKey(ref: WorkspaceStyleRef) {
  return ref.presetId
    ? `${ref.packId}/preset/${ref.presetId}`
    : ref.category
      ? `${ref.packId}/category/${ref.category}`
      : `${ref.packId}/pack`;
}

/** True when a preset belongs to the scope through its pack, its category or its own id. */
export function isPresetInWorkspaceStyleScope(
  scope: readonly WorkspaceStyleRef[],
  preset: { packId: string; presetId: string; category?: string | null },
) {
  return scope.some(
    (ref) =>
      ref.packId === preset.packId &&
      (ref.presetId
        ? ref.presetId === preset.presetId
        : !ref.category || ref.category === preset.category),
  );
}

export function isDefaultWorkspaceId(workspaceId: string | null | undefined): boolean {
  return (workspaceId ?? '').trim() === DEFAULT_WORKSPACE_ID;
}

export function normalizeWorkspaceId(workspaceId: string | null | undefined): string {
  const trimmed = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  return trimmed || DEFAULT_WORKSPACE_ID;
}

export function readWorkspaceIdFromSourceSpecMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const workspaceId = (metadata as Record<string, unknown>).workspaceId;
  if (typeof workspaceId !== 'string') return null;
  const trimmed = workspaceId.trim();
  return trimmed || null;
}

export function resolveJobWorkspaceId(input: {
  columnWorkspaceId?: string | null;
  sourceSpecMetadata?: unknown;
}): string {
  const fromColumn =
    typeof input.columnWorkspaceId === 'string' ? input.columnWorkspaceId.trim() : '';
  if (fromColumn) return fromColumn;
  return normalizeWorkspaceId(readWorkspaceIdFromSourceSpecMetadata(input.sourceSpecMetadata));
}

export function withWorkspaceMetadata<T extends { metadata?: Record<string, unknown> | null }>(
  sourceSpec: T | null | undefined,
  workspaceId: string,
): T | null | undefined {
  if (!sourceSpec) return sourceSpec;
  const metadata =
    sourceSpec.metadata &&
    typeof sourceSpec.metadata === 'object' &&
    !Array.isArray(sourceSpec.metadata)
      ? { ...sourceSpec.metadata }
      : {};
  return {
    ...sourceSpec,
    metadata: {
      ...metadata,
      workspaceId: normalizeWorkspaceId(workspaceId),
    },
  };
}
