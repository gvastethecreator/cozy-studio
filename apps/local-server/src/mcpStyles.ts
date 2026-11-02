import {
  createSelectedStyleSlot,
  createSelectedStylesGenerationPlan,
} from '../../../components/recipes/styleLayerComposer';
import {
  getStyleRuntimePresetDisplayName,
  normalizeStyleRuntimePack,
  type StyleRuntimePack,
} from '../../../components/recipes/styles/runtimeTypes';
import {
  resolveStylePackExtensions,
  type ExtensionManifest,
} from '../../../packages/shared/src/extensions';
import type { EditableStudioSettings } from '../../../packages/shared/src/studioSettings';
import * as Intentional from '../../../packages/shared/src/styles/intentional-v1';

type Get = (path: string) => Promise<Response>;

/** Installed style packs as the Studio UI loads them: the first source wins, hidden copies drop. */
export async function loadInstalledStylePacks(get: Get, packIds?: ReadonlySet<string>) {
  const listed = (await get('/api/extensions')
    .then((response) => response.json())
    .catch(() => null)) as { extensions?: ExtensionManifest[] } | null;
  const { byPackId, hiddenPresetIds } = resolveStylePackExtensions(listed?.extensions ?? []);
  const packs = await Promise.all(
    [...byPackId]
      .filter(([packId]) => !packIds || packIds.has(packId))
      .map(async ([packId, extension]) => {
        const response = await get(
          `/api/extensions/${extension.id}/files/${extension.files.runtime}`,
        );
        if (!response.ok) return null;
        const pack = (await response.json()) as StyleRuntimePack;
        const hidden = hiddenPresetIds.get(packId);
        return normalizeStyleRuntimePack({
          ...pack,
          presets: pack.presets.filter((preset) => !hidden?.has(preset.id)),
        });
      }),
  );
  return packs.filter((pack) => pack !== null);
}

export function findStyles(packs: StyleRuntimePack[], { q, limit }: { q?: string; limit: number }) {
  const query = q?.trim().toLowerCase();
  return packs
    .flatMap((pack) => pack.presets.map((preset) => ({ pack, preset })))
    .filter(
      ({ preset }) =>
        !query ||
        [preset.id, preset.name, preset.displayName, preset.category].some((value) =>
          value?.toLowerCase().includes(query),
        ),
    )
    .slice(0, limit)
    .map(({ pack, preset }) => ({
      packId: pack.id,
      presetId: preset.id,
      name: getStyleRuntimePresetDisplayName(preset),
      category: preset.category ?? null,
      hasIntentionalPolicy: Boolean(preset.intentional),
      summary: String(preset.style.aesthetic ?? '').slice(0, 160),
    }));
}

/** Compiles studio_generate styles with the same functions and settings the Studio UI uses. */
export async function compileMcpStyles(
  get: Get,
  {
    styles,
    prompt,
    negativePrompt,
    references,
    styleMode,
    settings,
  }: {
    styles: { packId: string; presetId: string; strength?: number }[];
    prompt: string;
    negativePrompt?: string;
    references: readonly { id: string; dataUrl: string }[];
    styleMode?: Intentional.Mode;
    settings: Pick<
      EditableStudioSettings,
      'intentionalStylesV1' | 'defaultStyleIntensity' | 'defaultStyleReferenceMode'
    >;
  },
): Promise<
  | { error: string; issues?: Intentional.Issue[] }
  | {
      recipeParams: Record<string, unknown>;
      negativePrompt?: string;
      styles: {
        compiler: 'intentional-v1' | 'legacy';
        mode: Intentional.Mode;
        issues: Intentional.Issue[];
      };
    }
> {
  const packs = await loadInstalledStylePacks(get, new Set(styles.map(({ packId }) => packId)));
  const slots = [];
  for (const style of styles) {
    const pack = packs.find(({ id }) => id === style.packId);
    const preset = pack?.presets.find(({ id }) => id === style.presetId);
    if (!pack || !preset)
      return {
        error: `Style ${style.packId}/${style.presetId} is not installed. Find presets with studio_find_styles.`,
      };
    slots.push(
      createSelectedStyleSlot(
        preset,
        pack.id,
        pack.name,
        style.strength ?? settings.defaultStyleIntensity,
      ),
    );
  }
  const mode = Intentional.resolveStyleMode({
    saved: styleMode,
    defaultStyleReferenceMode: settings.defaultStyleReferenceMode,
    intentionalStylesV1: settings.intentionalStylesV1,
  });
  if (settings.intentionalStylesV1) {
    try {
      const compiled = await Intentional.compileIntentionalStylePlan(
        { slots, prompt, attachments: references, mode, negativePrompt },
        { resolvePolicy: async (slot) => slot.preset.intentional ?? null },
      );
      return {
        recipeParams: { ...compiled.recipeParams, selectedStyleDraft: slots },
        styles: { compiler: 'intentional-v1', mode, issues: compiled.issues },
      };
    } catch (error) {
      if (!(error instanceof Intentional.CompilationBlocked)) throw error;
      return { error: error.message, issues: error.issues };
    }
  }
  const plan = createSelectedStylesGenerationPlan({
    slots,
    hasReferenceImages: references.length > 0,
    referenceMode: mode === 'generate' ? 'preserve' : mode,
    baseNegativePrompt: negativePrompt,
  });
  if (!plan) return { error: 'The selected styles have no visual fields to apply.' };
  return {
    recipeParams: { ...plan.recipeParams, selectedStyleDraft: slots },
    negativePrompt: plan.negativePrompt,
    styles: { compiler: 'legacy', mode, issues: [] },
  };
}
