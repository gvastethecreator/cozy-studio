import { useCallback, useMemo } from 'react';
import type { AspectRatio, ImageGenerationConfig } from '../types';
import { DEFAULT_GENERATION_CONFIG, RATIO_MAP } from '../constants';
import useIndexedDBStorage from './useIndexedDBStorage';
import {
  activateCharacterLabView,
  restoreCharacterLabDraft,
  updateCharacterLabView,
} from '../lib/characterLabDraft';
import type { CharacterLabModeId } from '../lib/characterLabCatalog.generated';
import { projectStyleCompositionDraft } from '../components/recipes/styleCompositionDraft';

const EMPTY_DRAFTS: Record<string, ImageGenerationConfig> = {};

function withWorkspaceAttachments(
  current: ImageGenerationConfig,
  next: ImageGenerationConfig,
  recipe = next.recipeId,
): ImageGenerationConfig {
  const previousSource = current.attachments[0];
  const source = next.attachments[0];
  if (
    recipe !== 'remaster' ||
    !source?.width ||
    !source.height ||
    (source.id === previousSource?.id && previousSource.width && previousSource.height)
  )
    return next;
  const target = Math.log(source.width / source.height);
  const distance = (ratio: AspectRatio) => Math.abs(Math.log(RATIO_MAP[ratio]) - target);
  const aspectRatio = (Object.keys(RATIO_MAP) as AspectRatio[]).reduce((best, ratio) =>
    distance(ratio) < distance(best) ? ratio : best,
  );
  return { ...next, aspectRatio };
}

function getWorkspaceScope(scope: string) {
  return scope.slice(0, scope.lastIndexOf(':'));
}

function collectWorkspaceAttachments(
  drafts: Record<string, ImageGenerationConfig>,
  workspace: string,
  active: ImageGenerationConfig,
) {
  const attachments = [
    ...active.attachments,
    ...Object.entries(drafts)
      .filter(([key]) => key.startsWith(`${workspace}:`))
      .flatMap(([, draft]) => draft.attachments),
  ];
  return attachments.filter(
    (attachment, index) => attachments.findIndex((item) => item.id === attachment.id) === index,
  );
}

function shareWorkspaceAttachments(
  drafts: Record<string, ImageGenerationConfig>,
  workspace: string,
  attachments: ImageGenerationConfig['attachments'],
) {
  return Object.fromEntries(
    Object.entries(drafts).map(([key, draft]) => [
      key,
      key.startsWith(`${workspace}:`)
        ? withWorkspaceAttachments(draft, { ...draft, attachments })
        : draft,
    ]),
  );
}

export function useScopedGenerationDraft(
  scope: string,
  prepare: (config: ImageGenerationConfig) => ImageGenerationConfig,
  characterLabMode?: CharacterLabModeId,
) {
  // Preserve the original draft at its existing key; recipe drafts have explicit scopes.
  const [legacy, , legacyReady] = useIndexedDBStorage<ImageGenerationConfig>(
    'generation-config',
    DEFAULT_GENERATION_CONFIG,
  );
  const prepareDrafts = useCallback(
    (drafts: Record<string, ImageGenerationConfig>) =>
      Object.fromEntries(Object.entries(drafts).map(([key, value]) => [key, prepare(value)])),
    [prepare],
  );
  const [drafts, setDrafts, draftsReady] = useIndexedDBStorage('generation-drafts', EMPTY_DRAFTS, {
    prepareForPersist: prepareDrafts,
  });
  const initial = useMemo(
    () =>
      scope === 'default:studio'
        ? legacy
        : {
            ...DEFAULT_GENERATION_CONFIG,
            executionModel: legacy.executionModel,
            executionReasoningEffort: legacy.executionReasoningEffort,
            executionSpeed: legacy.executionSpeed,
            codexTransport: legacy.codexTransport,
            codexImageModel: legacy.codexImageModel,
          },
    [scope, legacy],
  );
  const workspace = useMemo(() => getWorkspaceScope(scope), [scope]);
  const config = useMemo(() => {
    const active = drafts[scope] ?? initial;
    const shared = withWorkspaceAttachments(
      active,
      {
        ...active,
        attachments: collectWorkspaceAttachments(drafts, workspace, active),
      },
      scope.endsWith(':remaster') ? 'remaster' : active.recipeId,
    );
    if (scope.endsWith(':character-lab')) return activateCharacterLabView(shared, characterLabMode);
    return scope.endsWith(':studio') ? projectStyleCompositionDraft(shared) : shared;
  }, [drafts, initial, scope, workspace, characterLabMode]);
  const setConfig = useCallback(
    (
      update: ImageGenerationConfig | ((current: ImageGenerationConfig) => ImageGenerationConfig),
    ) => {
      if (!legacyReady || !draftsReady) return;
      setDrafts((current) => {
        const active = current[scope] ?? initial;
        const sharedAttachments = collectWorkspaceAttachments(current, workspace, active);
        const shared = withWorkspaceAttachments(
          active,
          { ...active, attachments: sharedAttachments },
          scope.endsWith(':remaster') ? 'remaster' : active.recipeId,
        );
        const currentView = scope.endsWith(':character-lab')
          ? activateCharacterLabView(shared, characterLabMode)
          : shared;
        let updated = typeof update === 'function' ? update(currentView) : update;
        updated = withWorkspaceAttachments(
          currentView,
          updated,
          scope.endsWith(':remaster') ? 'remaster' : updated.recipeId,
        );
        if (updated.recipeId === 'character-lab' && updated.characterLabDraft) {
          updated = updateCharacterLabView(updated, updated.characterLabDraft.activeMode, {
            prompt: updated.prompt ?? '',
            labAspectRatio: updated.aspectRatio,
            batchCount: updated.batchCount,
            outputBackground: updated.outputBackground ?? 'workflow',
          });
        }
        if (scope.endsWith(':studio')) updated = projectStyleCompositionDraft(updated);
        return {
          ...shareWorkspaceAttachments(current, workspace, updated.attachments),
          [scope]: updated,
        };
      });
    },
    [scope, initial, setDrafts, legacyReady, draftsReady, workspace, characterLabMode],
  );
  const setRecipeDraft = useCallback(
    (recipeId: ImageGenerationConfig['recipeId'], value: ImageGenerationConfig) => {
      if (!legacyReady || !draftsReady) return;
      setDrafts((current) => {
        const key = `${workspace}:${recipeId === 'styles' ? 'studio' : (recipeId ?? 'studio')}`;
        const restored =
          recipeId === 'character-lab'
            ? restoreCharacterLabDraft(current[key] ?? initial, value)
            : value;
        return {
          ...shareWorkspaceAttachments(current, workspace, restored.attachments),
          [key]: restored,
        };
      });
    },
    [workspace, setDrafts, initial, legacyReady, draftsReady],
  );
  return [config, setConfig, setRecipeDraft, legacyReady && draftsReady] as const;
}
