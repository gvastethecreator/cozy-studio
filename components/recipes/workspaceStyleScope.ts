// Workspace Style Scope: the styles a user links to a workspace's project. Studio shows them first
// in Create and as one collection in the style explorer. It never adds a style to a draft by itself.
import type { StylePackSummary } from '../../packages/shared/src/extensions';
import {
  workspaceStyleRefKey,
  type WorkspaceStyleRef,
} from '../../packages/shared/src/workspaceContracts';
import type { StyleCollection } from './styles/collections/styleCollectionTypes';

export const WORKSPACE_STYLE_COLLECTION_ID = 'workspace_styles';

type ProjectPackSummary = Pick<StylePackSummary, 'id' | 'name' | 'project'>;

/** The scope as a style collection, so the explorer resolves it like any other collection. */
export function createWorkspaceStyleCollection(
  scope: readonly WorkspaceStyleRef[],
  copy: { title: string; description: string },
): StyleCollection | null {
  if (scope.length === 0) return null;
  return {
    id: WORKSPACE_STYLE_COLLECTION_ID,
    title: copy.title,
    familyId: 'personal',
    description: copy.description,
    icon: 'layers',
    order: 5,
    sourcePackIds: [...new Set(scope.map((ref) => ref.packId))],
    entries: scope.map((ref) => ({
      id: workspaceStyleRefKey(ref),
      kind: ref.presetId ? 'preset' : ref.category ? 'category' : 'pack',
      packId: ref.packId,
      ...(ref.category && { categoryName: ref.category }),
      ...(ref.presetId && { presetId: ref.presetId }),
      role: 'primary',
    })),
  };
}

export function findProjectStylePacks<T extends ProjectPackSummary>(summaries: readonly T[]) {
  return summaries.filter((summary) => Boolean(summary.project?.name.trim()));
}

function normalizeName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Project packs whose project name and the workspace name hold one another as whole words, such
 * as "Black Flag" for "Black Flag biomas". The user confirms a suggestion before it is saved.
 */
export function suggestWorkspaceProjectPacks<T extends ProjectPackSummary>(
  workspaceName: string,
  summaries: readonly T[],
) {
  const workspace = normalizeName(workspaceName);
  if (workspace.length < 3) return [];
  return findProjectStylePacks(summaries).filter((summary) => {
    const project = normalizeName(summary.project!.name);
    if (project.length < 3) return false;
    return ` ${workspace} `.includes(` ${project} `) || ` ${project} `.includes(` ${workspace} `);
  });
}

export function isStylePackLinked(scope: readonly WorkspaceStyleRef[], packId: string) {
  return scope.some((ref) => ref.packId === packId && !ref.category && !ref.presetId);
}

/** Links or unlinks a whole pack; its category links go, its single-style links stay. */
export function setStylePackLinked(
  scope: readonly WorkspaceStyleRef[],
  packId: string,
  linked: boolean,
): WorkspaceStyleRef[] {
  const others = scope.filter((ref) => ref.packId !== packId || ref.presetId);
  return linked ? [...others, { packId }] : others;
}

/**
 * Links or unlinks one category of a pack. A whole-pack link turns into its other categories, and
 * linking every category turns back into one whole-pack link.
 */
export function setStyleCategoryLinked(
  scope: readonly WorkspaceStyleRef[],
  packId: string,
  categories: readonly string[],
  category: string,
  linked: boolean,
): WorkspaceStyleRef[] {
  const current = isStylePackLinked(scope, packId)
    ? [...categories]
    : scope.flatMap((ref) => (ref.packId === packId && ref.category ? [ref.category] : []));
  const next = linked
    ? [...new Set([...current, category])]
    : current.filter((name) => name !== category);
  const others = scope.filter((ref) => ref.packId !== packId || ref.presetId);
  const whole = categories.length > 0 && categories.every((name) => next.includes(name));
  return [...others, ...(whole ? [{ packId }] : next.map((name) => ({ packId, category: name })))];
}

/** What the style explorer and the Create picker need to show the active workspace's styles. */
export interface WorkspaceProjectStyles {
  workspaceName: string;
  scope: WorkspaceStyleRef[];
  collection: StyleCollection | null;
  projectPacks: StylePackSummary[];
  suggestedPackIds: string[];
  suggestion: { packName: string } | null;
  openEditor: () => void;
}
