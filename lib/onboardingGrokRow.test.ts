import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { grokRowNeedsInstall, grokRowNeedsLogin } from './onboardingGrokRow';

describe('optional Grok onboarding row', () => {
  it('shows Sign in even when Grok Build is missing', () => {
    expect(
      grokRowNeedsInstall({ cliAvailable: false, loggedIn: false, label: 'Grok', detail: '' }),
    ).toBe(true);
    expect(
      grokRowNeedsLogin({ cliAvailable: false, loggedIn: false, label: 'Grok', detail: '' }),
    ).toBe(true);
    expect(
      grokRowNeedsLogin({ cliAvailable: true, loggedIn: false, label: 'Grok', detail: '' }),
    ).toBe(true);
    expect(
      grokRowNeedsInstall({ cliAvailable: true, loggedIn: true, label: 'Grok', detail: '' }),
    ).toBe(false);
    expect(
      grokRowNeedsInstall({ cliAvailable: false, loggedIn: true, label: 'Grok', detail: '' }),
    ).toBe(false);
  });

  it('keeps Grok off the primary CTA', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, '..', 'components', 'OnboardingModal.tsx'),
      'utf8',
    );
    expect(source).toContain('ONBOARDING_GROK_INSTALL_URL');
    expect(source).toContain('onOpenSettings');
    expect(source).not.toMatch(/Ask Grok/i);
  });
});
