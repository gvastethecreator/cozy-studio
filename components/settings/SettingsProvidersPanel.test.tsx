/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createDefaultEditableStudioSettings } from '../../packages/shared/src';
import type { GenerationProviderCapability } from '../../packages/shared/src/providerCapabilities';
import { getStudioSettingsFormState } from '../../lib/studioSettingsForm';
import { getSubscriptionAuthStatus } from '../../services/studio-api/auth';
import { SettingsProvidersPanel } from './SettingsProvidersPanel';

vi.mock('../../services/studio-api/auth', () => ({
  cancelSubscriptionAuth: vi.fn(),
  getSubscriptionAuthStatus: vi.fn(),
  logoutSubscriptionAuth: vi.fn(),
  startSubscriptionAuth: vi.fn(),
}));

vi.mock('../../services/studioEventSource', () => ({
  createStudioEventStream: () => ({ onAuthUpdated: () => () => undefined, close: () => undefined }),
}));

afterEach(cleanup);

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
  expect(chatgpt.textContent).toContain('Needs setup');
  expect(chatgpt.textContent).not.toContain('in Studio Settings');
  const grok = document.querySelector('[data-provider="grok"]')!;
  expect(await screen.findByText('Sign-in optional')).toBeTruthy();
  expect(grok.textContent).not.toContain('Not signed in');
});
