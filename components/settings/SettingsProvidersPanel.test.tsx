/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createDefaultEditableStudioSettings } from '../../packages/shared/src';
import type { GenerationProviderCapability } from '../../packages/shared/src/providerCapabilities';
import {
  getStudioSettingsFormState,
  type StudioSettingsFormState,
} from '../../lib/studioSettingsForm';
import {
  getGoogleCredentialsStatus,
  getSubscriptionAuthStatus,
} from '../../services/studio-api/auth';
import { getAntigravityUsageStatus } from '../../services/studio-api/providers';
import { SettingsProvidersPanel } from './SettingsProvidersPanel';
import { DIRECT_GIF_IMAGE_MODELS } from '../../packages/shared/src/openaiImageContract';

vi.mock('../../services/studio-api/auth', () => ({
  cancelSubscriptionAuth: vi.fn(),
  clearGoogleCredentials: vi.fn(),
  getGoogleCredentialsStatus: vi.fn(),
  getSubscriptionAuthStatus: vi.fn(),
  logoutSubscriptionAuth: vi.fn(),
  saveGoogleCredentials: vi.fn(),
  startSubscriptionAuth: vi.fn(),
}));

vi.mock('../../services/studio-api/providers', () => ({
  getAntigravityUsageStatus: vi.fn(),
  launchAntigravityLoginTerminal: vi.fn(),
  refreshAntigravityProviderRuntime: vi.fn(),
}));

vi.mock('../../services/studioEventSource', () => ({
  createStudioEventStream: () => ({ onAuthUpdated: () => () => undefined, close: () => undefined }),
}));

afterEach(cleanup);

it('offers image choices while preserving custom OpenAI models', () => {
  let formState: StudioSettingsFormState = {
    ...getStudioSettingsFormState(createDefaultEditableStudioSettings()),
    defaultProviderId: 'openai',
  };
  const view = render(
    <SettingsProvidersPanel
      formState={formState}
      onFormChange={(update) => {
        formState = typeof update === 'function' ? update(formState) : update;
      }}
      providerOptions={['openai']}
      providerCapabilities={null}
      providerRuntimePreflight={null}
    />,
  );
  const model = screen.getByRole('combobox', {
    name: 'Provider default model',
  }) as HTMLInputElement;
  expect(Array.from(model.list!.options, (option) => option.value)).toEqual(
    DIRECT_GIF_IMAGE_MODELS,
  );
  fireEvent.change(model, { target: { value: 'custom-openai-image-model' } });
  expect(formState.providerDefaults.openai?.model).toBe('custom-openai-image-model');
  formState.defaultProviderId = 'chatgpt';
  view.rerender(
    <SettingsProvidersPanel
      formState={formState}
      onFormChange={(update) => {
        formState = typeof update === 'function' ? update(formState) : update;
      }}
      providerOptions={['chatgpt']}
      providerCapabilities={null}
      providerRuntimePreflight={null}
    />,
  );
  const chatgptModel = screen.getByRole('combobox', { name: 'ChatGPT default image model' });
  expect(Array.from((chatgptModel as HTMLSelectElement).options, (option) => option.value)).toEqual(
    expect.arrayContaining(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']),
  );
  fireEvent.change(chatgptModel, { target: { value: 'gpt-image-2.6-flare' } });
  expect(formState.providerDefaults.chatgpt?.imageModel).toBe('gpt-image-2.6-flare');
});

const capability = (
  providerId: GenerationProviderCapability['providerId'],
  canExecute: boolean,
  detail: string,
): GenerationProviderCapability => ({
  providerId,
  label: providerId,
  runtimeKind: 'hosted_api',
  status: canExecute ? 'active' : 'not_configured',
  isDefault: false,
  hasAdapter: true,
  canExecute,
  secretState: 'missing',
  subscriptionAuthState: 'logged_out',
  detail,
});

it('tells the truth about readiness without sending the user to Settings from Settings', async () => {
  vi.mocked(getSubscriptionAuthStatus).mockImplementation(async (providerId) => ({
    providerId,
    status: 'logged_out',
    accountLabel: null,
    expiresAt: null,
    lastError: null,
    verificationUrl: null,
    authorizationUrl: null,
    userCode: null,
  }));
  render(
    <SettingsProvidersPanel
      formState={{
        ...getStudioSettingsFormState(createDefaultEditableStudioSettings()),
        defaultProviderId: 'fal',
      }}
      onFormChange={vi.fn()}
      providerOptions={['chatgpt', 'grok', 'fal']}
      providerCapabilities={{
        providers: [
          capability('chatgpt', false, 'Sign in with ChatGPT in Studio Settings.'),
          capability('grok', true, 'Grok CLI ready.'),
          capability('fal', false, 'Add a backend FAL_KEY.'),
        ],
      }}
      providerRuntimePreflight={null}
    />,
  );

  expect(
    screen.getByText('fal.ai cannot generate yet. Set it up below, or pick another provider.'),
  ).toBeTruthy();
  const chatgpt = document.querySelector('[data-provider="chatgpt"]')!;
  expect(chatgpt.textContent).toContain('Not set up');
  expect(chatgpt.textContent).not.toContain('Needs setup');
  expect(chatgpt.textContent).not.toContain('in Studio Settings');
  const grok = document.querySelector('[data-provider="grok"]')!;
  expect(await screen.findByText('Sign-in optional')).toBeTruthy();
  expect(grok.textContent).not.toContain('Not signed in');
});

it('shows seamless Gemini API key setup and Antigravity login/quota controls', async () => {
  vi.mocked(getGoogleCredentialsStatus).mockResolvedValue({
    apiKeyConfigured: false,
    apiKeySource: null,
    apiKeyEnvName: null,
    apiKeyHint: null,
    oauthConfigured: false,
    oauthSource: null,
    oauthClientIdHint: null,
    cloudProjectId: null,
    updatedAt: null,
  });
  vi.mocked(getAntigravityUsageStatus).mockResolvedValue({
    available: true,
    checkedAt: '2026-11-25T20:00:00.000Z',
    tightestPercentLeft: 80,
    tightestWindowLabel: 'Weekly',
    resetsAt: null,
    buckets: [
      {
        id: 'gemini-5h',
        label: 'Gemini',
        window: '5h',
        remainingPercent: 100,
        resetTime: null,
      },
      {
        id: 'gemini-weekly',
        label: 'Gemini',
        window: 'weekly',
        remainingPercent: 80,
        resetTime: null,
      },
    ],
    remainingCredits: 500,
    upgradeUri: null,
    error: null,
  });

  render(
    <SettingsProvidersPanel
      formState={{
        ...getStudioSettingsFormState(createDefaultEditableStudioSettings()),
        defaultProviderId: 'google',
      }}
      onFormChange={vi.fn()}
      providerOptions={['google', 'antigravity']}
      providerCapabilities={{
        providers: [
          capability('google', false, 'Add a Gemini API key in Studio Settings.'),
          {
            ...capability('antigravity', true, 'Antigravity ready.'),
            runtimeKind: 'agent_cli',
            secretState: 'not_required',
          },
        ],
      }}
      providerRuntimePreflight={null}
    />,
  );

  expect(await screen.findByRole('button', { name: 'Save & verify' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Get key in Google AI Studio/i })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  expect(await screen.findByText(/5h: 100% left · Weekly: 80% left · 500 G1 credits/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh status' })).toBeTruthy();
});
