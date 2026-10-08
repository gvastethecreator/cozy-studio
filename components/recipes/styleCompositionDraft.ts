import type { ImageGenerationConfig } from '../../types';
import {
  createSelectedStylesGenerationPlan,
  STYLE_LAYER_FIELD_DEFINITIONS,
  type SelectedStyleLayer,
  type SelectedStyleSlot,
} from './styleLayerComposer';

/** Read historical layers once through the same draft shape used by the editor. */
export function readSelectedStyleDraft(
  params: ImageGenerationConfig['recipeParams'],
): SelectedStyleSlot[] {
  if (Array.isArray(params?.selectedStyleDraft))
    return params.selectedStyleDraft as SelectedStyleSlot[];
  const layers = params?.selectedStyles as SelectedStyleLayer[] | undefined;
  if (!Array.isArray(layers)) return [];
  return layers.map((layer) => ({
    packId: layer.packId,
    packName: layer.packName,
    strength: layer.strength,
    enabled: layer.enabled,
    avoidRulesMode: layer.avoidRulesMode,
    fieldControls: layer.fields,
    preset: {
      id: layer.presetId,
      name: layer.presetSourceName || layer.presetName,
      displayName: layer.presetName,
      category: layer.category,
      styleAnchors: layer.styleAnchors,
      negativePrompt: typeof params?.negativePrompt === 'string' ? params.negativePrompt : '',
      style: {
        creative_brief: layer.creativeBrief,
        ...Object.fromEntries(
          STYLE_LAYER_FIELD_DEFINITIONS.map((field) => [
            field.sourceKeys[0],
            layer[field.paramKey]?.replace(/ \(field weight [^)]+\)$/, ''),
          ]),
        ),
      } as SelectedStyleSlot['preset']['style'],
    },
  }));
}

/** Project reference-dependent instructions at the config owner, including restored drafts. */
export function projectStyleCompositionDraft(config: ImageGenerationConfig): ImageGenerationConfig {
  const params = config.recipeParams;
  if (!Array.isArray(params?.selectedStyleDraft) || params.intentionalMode) return config;
  const slots = params.selectedStyleDraft as SelectedStyleSlot[];
  const referenceMode = params.styleReferenceMode === 'reinterpret' ? 'reinterpret' : 'preserve';
  const plan = createSelectedStylesGenerationPlan({
    slots,
    hasReferenceImages: config.attachments.length > 0,
    referenceMode,
    baseNegativePrompt: config.negativePrompt,
  });
  return {
    ...config,
    recipeId: plan ? 'styles' : null,
    recipeParams: {
      ...plan?.recipeParams,
      styleReferenceMode: referenceMode,
      selectedStyles: plan?.recipeParams.selectedStyles ?? [],
      selectedStyleDraft: slots,
    },
  };
}
