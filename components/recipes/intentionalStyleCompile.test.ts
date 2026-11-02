import { describe, expect, it } from 'vitest';

import catalogJson from '../../packages/shared/src/styles/intentional-v1/catalog.fixture.json';
import { buildRecipeProviderDirectives, getRecipeModule } from '../../lib/recipeModules';
import { createDefaultEditableStudioSettings } from '../../packages/shared/src/studioSettings';
import * as Intentional from '../../packages/shared/src/styles/intentional-v1';
import { compileMcpStyles } from '../../apps/local-server/src/mcpStyles';
import {
  createSelectedStyleSlot,
  createSelectedStylesGenerationPlan,
  type SelectedStyleSlot,
} from './styleLayerComposer';
import { normalizeStyleRuntimePack } from './styles/runtimeTypes';

const catalog = catalogJson as Array<{
  id: string;
  name: string;
  packId: string;
  packName: string;
  snapshot: {
    dna: SelectedStyleSlot['preset']['style'];
    version: number;
    policy: NonNullable<SelectedStyleSlot['preset']['intentional']>['policy'];
  };
}>;

function slotFor(id: string): SelectedStyleSlot {
  const entry = catalog.find((item) => item.id === id);
  if (!entry) throw new Error(`Missing catalog fixture ${id}`);
  return {
    preset: {
      id: entry.id,
      name: entry.name,
      style: entry.snapshot.dna,
      intentional: { policy: entry.snapshot.policy, presetVersion: entry.snapshot.version },
    },
    packId: entry.packId,
    packName: entry.packName,
    strength: 0.75,
    enabled: true,
  };
}

const resolvePolicy = async (slot: SelectedStyleSlot) => slot.preset.intentional ?? null;
const compile = (
  input: Omit<
    Parameters<typeof Intentional.compileIntentionalStylePlan<SelectedStyleSlot>>[0],
    'negativePrompt'
  >,
) => Intentional.compileIntentionalStylePlan(input, { resolvePolicy });

describe('intentionalStyleCompile', () => {
  it('compiles MCP styles exactly as the Studio UI does', async () => {
    const entry = catalog.find((item) => item.id === 'SP01-001')!;
    const runtimePack = {
      id: entry.packId,
      name: entry.packName,
      description: '',
      presets: [
        {
          id: entry.id,
          name: entry.name,
          negativePrompt: 'blurry, watermark',
          style: { ...entry.snapshot.dna, creative_brief: 'dropped by both loaders' },
          intentional: { policy: entry.snapshot.policy, presetVersion: entry.snapshot.version },
        },
      ],
    };
    const extension = {
      id: 'cozy.fixture',
      kind: 'style-pack',
      files: { runtime: 'runtime.json' },
      stylePack: { id: entry.packId },
    };
    const get = async (path: string) =>
      Response.json(path === '/api/extensions' ? { extensions: [extension] } : runtimePack);
    const prompt = 'A ceramic pitcher on a plain surface.';
    for (const intentionalStylesV1 of [true, false]) {
      const settings = {
        ...createDefaultEditableStudioSettings(),
        intentionalStylesV1,
        defaultStyleIntensity: 0.6,
      };
      // The UI path: the pack registry, toggleStyle and useStyleComposition.
      const [preset] = normalizeStyleRuntimePack(runtimePack).presets;
      const slots = [createSelectedStyleSlot(preset, runtimePack.id, runtimePack.name, 0.6)];
      // Intentional preserve needs a reference, so this request saves the generate mode.
      const mode = Intentional.resolveStyleMode({
        saved: 'generate',
        defaultStyleReferenceMode: settings.defaultStyleReferenceMode,
        intentionalStylesV1,
      });
      const legacy = createSelectedStylesGenerationPlan({
        slots,
        hasReferenceImages: false,
        referenceMode: mode === 'generate' ? 'preserve' : mode,
        baseNegativePrompt: 'text',
      })!;
      const ui = intentionalStylesV1
        ? await Intentional.compileIntentionalStylePlan(
            { slots, prompt, attachments: [], mode, negativePrompt: 'text' },
            { resolvePolicy },
          )
        : legacy;

      const server = await compileMcpStyles(get, {
        styles: [{ packId: entry.packId, presetId: entry.id }],
        prompt,
        negativePrompt: 'text',
        references: [],
        styleMode: 'generate',
        settings,
      });
      expect(server).toEqual({
        recipeParams: { ...ui.recipeParams, selectedStyleDraft: slots },
        ...(!intentionalStylesV1 && { negativePrompt: legacy.negativePrompt }),
        styles: {
          compiler: intentionalStylesV1 ? 'intentional-v1' : 'legacy',
          mode,
          issues: 'issues' in ui ? ui.issues : [],
        },
      });
      expect(server).toMatchObject({
        recipeParams: intentionalStylesV1
          ? { compilerVersion: Intentional.CORE_VERSION, styleRequestHash: expect.any(String) }
          : { mode: 'DIRECT_STYLE_SYNTHESIS' },
      });
    }
  });

  it('compiles the same Headshot request to the same hash', async () => {
    const input = {
      slots: [slotFor('SP01-001')],
      prompt: 'A ceramic pitcher on a plain surface.',
      attachments: [],
      mode: 'generate' as const,
    };
    const first = await compile(input);
    const second = await compile(input);
    expect(first.styleRequestHash).toBe(second.styleRequestHash);
    expect(first.effectivePrompt).not.toMatch(/force substantial variation/i);
    expect(first.effectivePrompt).not.toMatch(/Vary camera framing/i);
    expect(first.recipeParams.effectivePrompt).toBe(first.effectivePrompt);
  });

  it('preserves pose and composition when an image is attached', async () => {
    const compiled = await compile({
      slots: [slotFor('SP01-001')],
      prompt: 'Keep this person in the same studio setup.',
      attachments: [
        {
          id: 'ref-1',
          dataUrl: 'data:image/png;base64,aaaa',
        },
      ],
      mode: 'preserve',
    });
    expect(compiled.recipeParams.styleReferenceMode).toBe('preserve');
    expect(compiled.effectivePrompt).toContain('Mode: preserve.');
    expect(compiled.effectivePrompt).toContain('Preserve pose');
    expect(compiled.effectivePrompt).toContain('ref-1:composition — composition:');
  });

  it('releases pose and camera when the reference is reinterpreted', async () => {
    const compiled = await compile({
      slots: [slotFor('SP01-001')],
      prompt: 'Keep this person, but change the pose and framing.',
      attachments: [
        {
          id: 'ref-1',
          dataUrl: 'data:image/png;base64,aaaa',
        },
      ],
      mode: 'reinterpret',
    });
    expect(compiled.recipeParams.styleReferenceMode).toBe('reinterpret');
    expect(compiled.effectivePrompt).toContain('Mode: reinterpret.');
    expect(compiled.effectivePrompt).toContain('Restage only the aspects whose locks are released');
    expect(compiled.effectivePrompt).not.toContain('Preserve pose');
    expect(compiled.effectivePrompt).not.toContain('composition:');
  });

  it('does not emit restage copy when a reference is attached', async () => {
    const compiled = await compile({
      slots: [slotFor('SP01-001')],
      prompt: 'Keep this person in the same studio setup.',
      attachments: [
        {
          id: 'ref-1',
          dataUrl: 'data:image/png;base64,aaaa',
        },
      ],
      mode: 'generate',
    });
    expect(compiled.effectivePrompt).not.toContain('Re-stage the subject');
    expect(compiled.effectivePrompt).not.toContain('Do not preserve pose');
  });

  it('blocks Oak Wood until a material target is set', async () => {
    await expect(
      compile({
        slots: [slotFor('SP09-001')],
        prompt: 'A wooden bowl.',
        attachments: [],
        mode: 'generate',
      }),
    ).rejects.toMatchObject({ name: 'CompilationBlocked' });
  });

  it('keeps compiled provider directives free of style names and restage rules', () => {
    const context = JSON.stringify(
      buildRecipeProviderDirectives(getRecipeModule('styles')!, {
        compilerVersion: Intentional.CORE_VERSION,
        effectivePrompt: 'Apply charcoal editorial ink. Keep the pitcher identity.',
        styleRequestHash: 'a'.repeat(64),
        presetName: 'Katana Zero Neo-Noir Sideview',
        roleInstruction: 'Re-stage the subject with a different gesture.',
        creativeBrief: 'strict side-on action sprite',
      }),
    );
    expect(context).toContain('Intentional Style Plan');
    expect(context).toContain('Apply charcoal editorial ink');
    expect(context).not.toContain('Katana');
    expect(context).not.toContain('Re-stage the subject');
    expect(context).not.toContain('strict side-on');
  });
});
