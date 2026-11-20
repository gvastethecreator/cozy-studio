import { describe, expect, it } from 'vitest';
import {
  describeGrokImagineEditNotice,
  isImageEditorApplyDisabled,
  listGrokImagineRatioOptions,
  resolveGrokImagineGenerateBlock,
  resolveImageEditorRequiresMask,
  summarizeGrokProviderStatusLine,
} from './grokImagineUiPolicy';
import { selectProviderReadiness } from './providerReadiness';

describe('grokImagineUiPolicy', () => {
  it('keeps Home and Styles unblocked for a ready Grok runtime', () => {
    expect(
      resolveGrokImagineGenerateBlock({
        providerId: 'grok',
        recipeId: null,
        aspectRatio: '1:1',
        canExecute: true,
      }),
    ).toBeNull();
    expect(
      resolveGrokImagineGenerateBlock({
        providerId: 'grok',
        recipeId: 'styles',
        aspectRatio: '16:9',
        canExecute: true,
      }),
    ).toBeNull();
  });

  it('blocks Camera and an unsupported ratio before Generate', () => {
    expect(
      resolveGrokImagineGenerateBlock({
        providerId: 'grok',
        recipeId: 'camera',
        aspectRatio: '1:1',
        canExecute: true,
      }),
    ).toMatchObject({ code: 'unsupported_grok_recipe' });
    expect(
      resolveGrokImagineGenerateBlock({
        providerId: 'grok',
        recipeId: null,
        aspectRatio: '2:3',
        canExecute: true,
      }),
    ).toMatchObject({ code: 'invalid_grok_aspect_ratio' });
  });

  it('lists only Grok-supported ratios and names login blockers', () => {
    expect(listGrokImagineRatioOptions().map((option) => option.ratio)).toEqual([
      '16:9',
      '4:3',
      '1:1',
      '3:4',
      '9:16',
    ]);
    expect(
      summarizeGrokProviderStatusLine({
        canExecute: false,
        status: 'not_configured',
        diagnostics: ['Grok Build does not have a usable local login. Run `grok login`.'],
      }),
    ).toBe('Sign in with xAI');
    expect(
      summarizeGrokProviderStatusLine({
        canExecute: false,
        status: 'not_configured',
        subscriptionAuthState: 'logged_in',
        diagnostics: ['Grok Build does not have a usable local login. Run `grok login`.'],
      }),
    ).toBe('Run grok login');
    expect(describeGrokImagineEditNotice('grok')).toMatch(/painted mask/);
    expect(describeGrokImagineEditNotice('codex')).toBeNull();
    const providerDomain = (canAttemptExecution?: boolean) =>
      ({
        capabilities: { providers: [{ providerId: 'grok', canExecute: true }] },
        runtimePreflight: {
          providers:
            canAttemptExecution === undefined ? [] : [{ providerId: 'grok', canAttemptExecution }],
        },
      }) as unknown as Parameters<typeof selectProviderReadiness>[0];
    expect(selectProviderReadiness(providerDomain(true), 'grok').canExecute).toBe(true);
    expect(selectProviderReadiness(providerDomain(), 'grok').canExecute).toBe(false);
    expect(
      summarizeGrokProviderStatusLine({
        canExecute: false,
        status: 'not_configured',
        diagnostics: ['Grok Build did not report an available model. grok_model_unavailable'],
      }),
    ).toBe('Choose a current Grok model');
    expect(
      resolveGrokImagineGenerateBlock({
        providerId: 'grok',
        canExecute: false,
        status: 'not_configured',
        diagnostics: ['Grok Build did not report an available model. grok_model_unavailable'],
      }),
    ).toEqual({
      code: 'grok_not_ready',
      message: 'Grok Imagine is blocked. Choose a current Grok model.',
    });
    expect(resolveImageEditorRequiresMask('grok')).toBe(false);
    expect(resolveImageEditorRequiresMask('antigravity')).toBe(false);
    expect(
      isImageEditorApplyDisabled({
        isGenerating: false,
        editPrompt: 'softer light',
        historyIndex: -1,
      }),
    ).toBe(true);
    expect(
      isImageEditorApplyDisabled({
        isGenerating: false,
        editPrompt: 'softer light',
        historyIndex: -1,
        requireMask: false,
      }),
    ).toBe(false);
  });
});
