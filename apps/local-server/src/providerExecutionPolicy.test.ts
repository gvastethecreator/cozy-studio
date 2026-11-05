import { describe, expect, it, vi } from 'vitest';
import { createDefaultEditableStudioSettings } from '../../../packages/shared/src';
import { resolveEffectiveJobExecutionOptions } from './providerExecutionPolicy';
import { resolveJobExecutionOptions } from './codex/executionOptions';
vi.mock('./config', () => ({
  getSettings: () => ({
    codexImagegenModel: 'changed-model',
    codexImagegenReasoningEffort: 'high',
    codexImagegenServiceTier: 'fast',
  }),
}));

describe('resolveEffectiveJobExecutionOptions', () => {
  const bootstrap = {
    model: 'bootstrap-model',
    reasoningEffort: 'medium',
    serviceTier: null,
  } as const;

  it('resolves each field through explicit override, provider default, then bootstrap', () => {
    const settings = createDefaultEditableStudioSettings();
    settings.providerDefaults.codex = {
      providerId: 'codex',
      model: 'provider-model',
      reasoningEffort: 'high',
      serviceTier: 'flex',
    };

    expect(
      resolveEffectiveJobExecutionOptions({
        providerId: 'codex',
        explicit: {
          model: 'explicit-model',
          reasoningEffort: '',
          serviceTier: null,
        },
        settings,
        bootstrap,
      }),
    ).toEqual({
      model: 'explicit-model',
      reasoningEffort: 'high',
      serviceTier: null,
    });
  });

  it('uses bootstrap values after nullable provider defaults are cleared', () => {
    const settings = createDefaultEditableStudioSettings();

    expect(
      resolveEffectiveJobExecutionOptions({
        providerId: 'codex',
        settings,
        bootstrap,
      }),
    ).toEqual(bootstrap);
    settings.providerDefaults.chatgpt = {
      providerId: 'chatgpt',
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      imageModel: 'gpt-image-2.6-flare',
    };
    expect(
      resolveEffectiveJobExecutionOptions({
        providerId: 'chatgpt',
        settings,
        bootstrap,
      }).providerOptions?.chatgpt?.imageModel,
    ).toBe('gpt-image-2.6-flare');
    expect(
      resolveEffectiveJobExecutionOptions({
        providerId: 'chatgpt',
        settings,
        bootstrap,
        explicit: {
          ...bootstrap,
          providerOptions: {
            chatgpt: {
              image: { model: 'gpt-image-2.6-sunburst', size: '1024x1024', quality: 'medium' },
            },
          },
        },
      }).providerOptions?.chatgpt?.imageModel,
    ).toBe('gpt-image-2.6-sunburst');
  });
  it('preserves captured standard speed after global defaults change', () => {
    expect(
      resolveJobExecutionOptions({
        model: 'accepted-model',
        reasoningEffort: 'low',
        serviceTier: null,
      }),
    ).toEqual({ model: 'accepted-model', reasoningEffort: 'low', serviceTier: null });
  });
});
