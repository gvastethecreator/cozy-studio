import {
  CORE_VERSION,
  FREE_LAYOUT_LOCKS,
  NO_PERMISSIONS,
  NO_VARIATION,
  PRESERVE_LOCKS,
  type Issue,
  type Locks,
  type Mode,
  type Policy,
  type Reference,
} from './types.js';
import { sha256 } from './canonical.js';
import { CompilationBlocked, compileStyleRequest } from './compiler.js';
import { LEGACY_FIELD_IDS, layerFromLegacySlot, type LegacySlot } from './legacyAdapter.js';

/** A preset's Intentional policy, for the preset version it was written against. */
export interface PresetPolicy {
  policy: Policy;
  presetVersion: number;
}

/** The request's saved mode, else the user's default. Legacy styles have no generate mode. */
export function resolveStyleMode({
  saved,
  defaultStyleReferenceMode,
  intentionalStylesV1,
}: {
  saved?: unknown;
  defaultStyleReferenceMode?: Exclude<Mode, 'generate'>;
  intentionalStylesV1: boolean;
}): Mode {
  const preferred: Mode =
    saved === 'generate' || saved === 'preserve' || saved === 'reinterpret'
      ? saved
      : (defaultStyleReferenceMode ?? (intentionalStylesV1 ? 'generate' : 'preserve'));
  return !intentionalStylesV1 && preferred === 'generate' ? 'preserve' : preferred;
}

const MODE_LOCKS: Record<Mode, Locks> = {
  generate: { identity: false, pose: false, camera: false, composition: false },
  preserve: PRESERVE_LOCKS,
  reinterpret: FREE_LAYOUT_LOCKS,
};

function hasExplicitFieldControls(slot: LegacySlot) {
  return Object.values(LEGACY_FIELD_IDS).some((id) => {
    const current = slot.fieldControls?.[id];
    return current !== undefined && (current.enabled !== true || current.weight !== 1);
  });
}

async function hashedReferences(
  attachments: readonly { id?: string; dataUrl?: string }[],
  mode: Mode,
): Promise<Reference[]> {
  if (mode === 'generate' || attachments.length === 0) return [];
  const references = await Promise.all(
    attachments.map(async (attachment, index) => {
      const material = attachment.dataUrl || attachment.id || `ref-${index + 1}`;
      const id = attachment.id || `ref-${index + 1}`;
      const contentHash = await sha256(material);
      const refs: Reference[] = [{ id, role: 'subject', contentHash }];
      if (mode === 'preserve' && index === 0) {
        refs.push({ id: `${id}:composition`, role: 'composition', contentHash });
      }
      return refs;
    }),
  );
  return references.flat();
}

/** Compiles selected styles into the Intentional plan that the styles recipe sends to providers. */
export async function compileIntentionalStylePlan<S extends LegacySlot>(
  {
    slots,
    prompt,
    attachments,
    mode,
    negativePrompt,
  }: {
    slots: S[];
    prompt: string;
    attachments: readonly { id?: string; dataUrl?: string }[];
    mode: Mode;
    negativePrompt?: string | null;
  },
  {
    resolvePolicy,
  }: {
    // A slot saved before packs shipped policies carries none, so the caller reads its pack.
    resolvePolicy: (slot: S) => Promise<PresetPolicy | null>;
  },
): Promise<{
  recipeParams: Record<string, unknown>;
  effectivePrompt: string;
  styleRequestHash: string;
  issues: Issue[];
  fallbackPrompt: string;
}> {
  const enabled = slots.filter((slot) => slot.enabled ?? true);
  if (enabled.length === 0) {
    throw new CompilationBlocked([
      {
        severity: 'error',
        code: 'NO_ACTIVE_FIELDS',
        message: 'Choose a style before generating.',
        layerIds: [],
      },
    ]);
  }

  const policies = await Promise.all(enabled.map(resolvePolicy));
  const missing = enabled.filter((_slot, index) => !policies[index]);
  if (missing.length > 0) {
    throw new CompilationBlocked([
      {
        severity: 'error',
        code: 'UNMIGRATED_PRESET',
        message: `Turn off Intentional styles or remove styles that are not on that path: ${missing.map((slot) => slot.preset.displayName || slot.preset.name).join(', ')}.`,
        layerIds: missing.map((slot) => slot.preset.id),
      },
    ]);
  }

  const layers = await Promise.all(
    enabled.map(async (slot, index) => {
      const registered = policies[index];
      // Missing policies are rejected above before starting any layer conversion.
      if (!registered) throw new Error(`Missing style policy: ${slot.preset.id}`);
      return layerFromLegacySlot(
        slot,
        registered.policy,
        registered.presetVersion,
        `layer-${index + 1}`,
        hasExplicitFieldControls(slot),
      );
    }),
  );

  const userPrompt = prompt.trim() || 'Create a balanced composition using the selected styles.';
  const compiled = await compileStyleRequest({
    prompt: userPrompt,
    layers,
    mode,
    locks: MODE_LOCKS[mode],
    variation: NO_VARIATION,
    permissions: { ...NO_PERMISSIONS },
    references: await hashedReferences(attachments, mode),
    baseAvoidRules: negativePrompt
      ? negativePrompt
          .split(',')
          .map((rule) => rule.trim())
          .filter(Boolean)
      : [],
  });

  const errors = compiled.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new CompilationBlocked(compiled.issues);
  }

  const first = enabled[0];
  return {
    effectivePrompt: compiled.effectivePrompt,
    styleRequestHash: compiled.styleRequestHash,
    issues: compiled.issues,
    fallbackPrompt: userPrompt,
    recipeParams: {
      presetId: first?.preset.id ?? '',
      presetName: enabled.map((slot) => slot.preset.displayName || slot.preset.name).join(' + '),
      selectedStyles: enabled.map((slot, index) => ({
        presetId: slot.preset.id,
        presetName: slot.preset.displayName || slot.preset.name,
        packId: slot.packId,
        packName: slot.packName,
        strength: slot.strength,
        enabled: slot.enabled ?? true,
        slot: index + 1,
      })),
      compilerVersion: CORE_VERSION,
      styleRequestHash: compiled.styleRequestHash,
      effectivePrompt: compiled.effectivePrompt,
      intentionalMode: mode,
      ...(mode === 'generate' ? {} : { styleReferenceMode: mode }),
      appliedFields: compiled.appliedFields,
      issues: compiled.issues,
    },
  };
}
