import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';
import type { Attachment, ImageGenerationConfig } from '../../types';
import type { StyleRuntimePreset } from './styles/runtimeTypes';
import {
  clampStyleLayerFieldWeight,
  clampStyleStrength,
  createDefaultStyleLayerFieldControls,
  createSelectedStylesGenerationPlan,
  createSelectedStyleLayer,
  DEFAULT_SELECTED_STYLE_STRENGTH,
  type SelectedStyleSlot,
  type SelectedStyleLayer,
  type StyleLayerAvoidRulesMode,
  type StyleLayerFieldId,
  type StyleReferenceMode,
} from './styleLayerComposer';
import { useLatestRef } from '../../hooks/useLatestRef';
import { readSelectedStyleDraft, projectStyleCompositionDraft } from './styleCompositionDraft';
import * as Intentional from '../../packages/shared/src/styles/intentional-v1';

interface StyleCompositionInput {
  config: ImageGenerationConfig;
  updateConfig: <K extends keyof ImageGenerationConfig>(
    key: K,
    value: ImageGenerationConfig[K],
  ) => void;
  onGenerate: (
    prompt?: string,
    overrides?: Partial<ImageGenerationConfig>,
    options?: { preventModal?: boolean },
  ) => void;
  referenceImages: Attachment[];
  generationBlocked: boolean;
  maxSlots: number;
  intentionalStylesV1?: boolean;
  defaultStyleIntensity?: number;
  defaultStyleReferenceMode?: StyleReferenceMode;
}

/** Owns selected layers and their provider-independent recipe output. */
export function useStyleComposition({
  config,
  updateConfig,
  onGenerate,
  referenceImages,
  generationBlocked,
  maxSlots,
  intentionalStylesV1 = false,
  defaultStyleIntensity = DEFAULT_SELECTED_STYLE_STRENGTH,
  defaultStyleReferenceMode,
}: StyleCompositionInput) {
  const configRef = useLatestRef(config);
  const selectedStyles = useMemo(
    () => readSelectedStyleDraft(config.recipeParams),
    [config.recipeParams],
  );
  const savedMode = config.recipeParams?.intentionalMode ?? config.recipeParams?.styleReferenceMode;
  const preferredMode =
    savedMode === 'generate' || savedMode === 'preserve' || savedMode === 'reinterpret'
      ? savedMode
      : (defaultStyleReferenceMode ?? (intentionalStylesV1 ? 'generate' : 'preserve'));
  const intentionalMode: Intentional.Mode =
    !intentionalStylesV1 && preferredMode === 'generate' ? 'preserve' : preferredMode;
  const [compileIssues, setCompileIssues] = useState<Intentional.Issue[]>([]);
  const commitComposition = useCallback(
    (slots: SelectedStyleSlot[], mode: Intentional.Mode) => {
      const current = configRef.current;
      const draftConfig: ImageGenerationConfig = {
        ...current,
        recipeId: slots.some((slot) => slot.enabled ?? true) ? 'styles' : null,
        recipeParams: {
          ...(intentionalStylesV1 ? { intentionalMode: mode } : {}),
          ...(mode === 'generate' ? {} : { styleReferenceMode: mode }),
          selectedStyleDraft: slots,
        },
      };
      const next = intentionalStylesV1 ? draftConfig : projectStyleCompositionDraft(draftConfig);
      configRef.current = next;
      updateConfig('recipeId', next.recipeId);
      updateConfig('recipeParams', next.recipeParams);
    },
    [configRef, intentionalStylesV1, updateConfig],
  );
  const setSelectedStyles = useCallback(
    (update: SetStateAction<SelectedStyleSlot[]>) => {
      const current = readSelectedStyleDraft(configRef.current.recipeParams);
      const next = typeof update === 'function' ? update(current) : update;
      commitComposition(next, intentionalMode);
    },
    [commitComposition, configRef, intentionalMode],
  );
  const setIntentionalMode = useCallback(
    (mode: Intentional.Mode) => {
      commitComposition(readSelectedStyleDraft(configRef.current.recipeParams), mode);
    },
    [commitComposition, configRef],
  );
  const [isAdvancedStyleControlsOpen, setIsAdvancedStyleControlsOpen] = useState(false);
  const selectedStyleIds = useMemo(
    () => new Set(selectedStyles.map((slot) => slot.preset.id)),
    [selectedStyles],
  );
  const toggleStyle = useCallback(
    (preset: StyleRuntimePreset, presetPackId: string, packName: string) => {
      setSelectedStyles((current) => {
        if (current.some((slot) => slot.preset.id === preset.id)) {
          return current.filter((slot) => slot.preset.id !== preset.id);
        }
        if (current.length >= maxSlots) {
          return current;
        }
        return [
          ...current,
          {
            preset,
            packId: presetPackId,
            packName,
            strength: clampStyleStrength(defaultStyleIntensity),
            enabled: true,
            fieldControls: createDefaultStyleLayerFieldControls(),
            avoidRulesMode: 'merge',
          },
        ];
      });
    },
    [defaultStyleIntensity, maxSlots, setSelectedStyles],
  );
  const selectedStyleLayers = useMemo(
    () => selectedStyles.map(createSelectedStyleLayer),
    [selectedStyles],
  );
  const registeredStyleGenerationPlan = useMemo(
    () =>
      createSelectedStylesGenerationPlan({
        slots: selectedStyles,
        hasReferenceImages: referenceImages.length > 0,
        referenceMode: intentionalMode === 'generate' ? 'preserve' : intentionalMode,
        baseNegativePrompt: config.negativePrompt,
      }),
    [config.negativePrompt, intentionalMode, referenceImages.length, selectedStyles],
  );
  const activeSelectedStyleCount = intentionalStylesV1
    ? selectedStyleLayers.filter((layer) => layer.enabled).length
    : ((
        registeredStyleGenerationPlan?.recipeParams.selectedStyles as
          | SelectedStyleLayer[]
          | undefined
      )?.length ?? 0);
  useEffect(() => {
    if (!intentionalStylesV1) return;
    if (activeSelectedStyleCount === 0) {
      setCompileIssues([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { compileIntentionalStylePlan } = await import('./intentionalStyleCompile');
        if (cancelled) return;
        const compiled = await compileIntentionalStylePlan({
          slots: selectedStyles,
          prompt: config.prompt || '',
          attachments: referenceImages,
          mode: intentionalMode,
          locks:
            intentionalMode === 'preserve'
              ? Intentional.PRESERVE_LOCKS
              : intentionalMode === 'reinterpret'
                ? Intentional.FREE_LAYOUT_LOCKS
                : {
                    identity: false,
                    pose: false,
                    camera: false,
                    composition: false,
                  },
          variation: Intentional.NO_VARIATION,
          permissions: { ...Intentional.NO_PERMISSIONS },
          baseAvoidRules: config.negativePrompt
            ? config.negativePrompt
                .split(',')
                .map((rule) => rule.trim())
                .filter(Boolean)
            : [],
        });
        if (cancelled) return;
        setCompileIssues(compiled.issues);
        updateConfig('recipeParams', {
          ...compiled.recipeParams,
          selectedStyleDraft: selectedStyles,
        });
      } catch (error) {
        if (cancelled) return;
        const issues =
          error instanceof Intentional.CompilationBlocked
            ? error.issues
            : [
                {
                  severity: 'error' as const,
                  code: 'COMPILE_FAILED',
                  message: error instanceof Error ? error.message : 'Style compile failed.',
                  layerIds: [],
                },
              ];
        setCompileIssues(issues);
        const message = issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join(' ');
        updateConfig('recipeParams', {
          selectedStyleDraft: selectedStyles,
          selectedStyles: selectedStyles.map((slot) => ({
            presetId: slot.preset.id,
            presetName: slot.preset.displayName || slot.preset.name,
            enabled: slot.enabled ?? true,
          })),
          intentionalMode,
          ...(intentionalMode === 'generate' ? {} : { styleReferenceMode: intentionalMode }),
          intentionalCompileError: message,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeSelectedStyleCount,
    config.negativePrompt,
    config.prompt,
    intentionalMode,
    intentionalStylesV1,
    referenceImages,
    selectedStyles,
    updateConfig,
  ]);
  const updateSelectedStyleStrength = useCallback(
    (presetId: string, strength: number) => {
      setSelectedStyles((current) =>
        current.map((slot) =>
          slot.preset.id === presetId ? { ...slot, strength: clampStyleStrength(strength) } : slot,
        ),
      );
    },
    [setSelectedStyles],
  );

  const toggleSelectedStyleEnabled = useCallback(
    (presetId: string) => {
      setSelectedStyles((current) =>
        current.map((slot) =>
          slot.preset.id === presetId ? { ...slot, enabled: !(slot.enabled ?? true) } : slot,
        ),
      );
    },
    [setSelectedStyles],
  );

  const toggleSelectedStyleField = useCallback(
    (presetId: string, fieldId: StyleLayerFieldId) => {
      setSelectedStyles((current) =>
        current.map((slot) => {
          if (slot.preset.id !== presetId) return slot;
          const controls = {
            ...createDefaultStyleLayerFieldControls(),
            ...slot.fieldControls,
          };
          const currentField = controls[fieldId] ?? { enabled: true, weight: 1 };
          return {
            ...slot,
            fieldControls: {
              ...controls,
              [fieldId]: {
                ...currentField,
                enabled: !currentField.enabled,
              },
            },
          };
        }),
      );
    },
    [setSelectedStyles],
  );

  const updateSelectedStyleFieldWeight = useCallback(
    (presetId: string, fieldId: StyleLayerFieldId, weight: number) => {
      setSelectedStyles((current) =>
        current.map((slot) => {
          if (slot.preset.id !== presetId) return slot;
          const controls = {
            ...createDefaultStyleLayerFieldControls(),
            ...slot.fieldControls,
          };
          const currentField = controls[fieldId] ?? { enabled: true, weight: 1 };
          return {
            ...slot,
            fieldControls: {
              ...controls,
              [fieldId]: {
                ...currentField,
                weight: clampStyleLayerFieldWeight(weight),
              },
            },
          };
        }),
      );
    },
    [setSelectedStyles],
  );

  const setSelectedStyleAvoidRulesMode = useCallback(
    (presetId: string, avoidRulesMode: StyleLayerAvoidRulesMode) => {
      setSelectedStyles((current) =>
        current.map((slot) => (slot.preset.id === presetId ? { ...slot, avoidRulesMode } : slot)),
      );
    },
    [setSelectedStyles],
  );

  const removeSelectedStyle = useCallback(
    (presetId: string) => {
      setSelectedStyles((current) => current.filter((slot) => slot.preset.id !== presetId));
    },
    [setSelectedStyles],
  );

  const moveSelectedStyle = useCallback(
    (presetId: string, direction: -1 | 1) => {
      setSelectedStyles((current) => {
        const index = current.findIndex((slot) => slot.preset.id === presetId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
        const next = [...current];
        const [moved] = next.splice(index, 1);
        next.splice(nextIndex, 0, moved);
        return next;
      });
    },
    [setSelectedStyles],
  );

  const handleGenerateSelectedStyles = useCallback(() => {
    if (intentionalStylesV1) {
      const error = compileIssues.find((issue) => issue.severity === 'error');
      if (error || generationBlocked) return;
      onGenerate(config.prompt?.trim() || undefined, undefined, { preventModal: true });
      return;
    }
    // Generate exactly the plan already shown/registered, not a random rewrite.
    const generationPlan = registeredStyleGenerationPlan;
    if (!generationPlan || generationBlocked) return;

    onGenerate(
      config.prompt?.trim() || generationPlan.fallbackPrompt,
      {
        recipeId: 'styles',
        recipeParams: { ...generationPlan.recipeParams, selectedStyleDraft: selectedStyles },
        attachments: referenceImages,
        model: config.model,
        imageSize: config.imageSize,
        batchCount: config.batchCount,
        aspectRatio: config.aspectRatio,
        executionModel: config.executionModel,
        executionReasoningEffort: config.executionReasoningEffort,
        executionSpeed: config.executionSpeed,
        negativePrompt: generationPlan.negativePrompt,
      },
      { preventModal: true },
    );
  }, [
    registeredStyleGenerationPlan,
    generationBlocked,
    config.aspectRatio,
    config.batchCount,
    config.executionModel,
    config.executionReasoningEffort,
    config.executionSpeed,
    config.imageSize,
    config.model,
    config.prompt,
    onGenerate,
    referenceImages,
    selectedStyles,
    compileIssues,
    intentionalStylesV1,
  ]);

  const clear = useCallback(() => setSelectedStyles([]), [setSelectedStyles]);
  const toggleAdvanced = useCallback(
    () => setIsAdvancedStyleControlsOpen((current) => !current),
    [],
  );
  const replacePreset = useCallback(
    (preset: StyleRuntimePreset) =>
      setSelectedStyles((current) =>
        current.map((slot) => (slot.preset.id === preset.id ? { ...slot, preset } : slot)),
      ),
    [setSelectedStyles],
  );
  return {
    selectedStyles,
    selectedStyleIds,
    selectedStyleLayers,
    activeSelectedStyleCount,
    isAdvancedStyleControlsOpen,
    toggleStyle,
    clear,
    toggleAdvanced,
    replacePreset,
    updateSelectedStyleStrength,
    toggleSelectedStyleEnabled,
    toggleSelectedStyleField,
    updateSelectedStyleFieldWeight,
    setSelectedStyleAvoidRulesMode,
    removeSelectedStyle,
    moveSelectedStyle,
    handleGenerateSelectedStyles,
    compileIssues,
    intentionalMode,
    setIntentionalMode,
  };
}
