/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioLanguage } from '../../packages/shared/src/studioSettings';
import { formatBytes, getLanguage, setLanguage, t } from './index';

describe('i18n', () => {
  afterEach(() => setLanguage('en'));

  it('interpolates params and picks plural forms for the active language', () => {
    expect(t('tcg.mask.loaded', { file: 'foil.png' })).toBe('Loaded: foil.png');
    expect(t('tcg.layout.columns', { count: 1 })).toBe('1 column');
    expect(t('tcg.layout.columns', { count: 3 })).toBe('3 columns');
    expect(formatBytes(1536)).toBe('1.5 KB');

    setLanguage('es');
    expect(document.documentElement.lang).toBe('es');
    expect(t('tcg.reason.missingArt', { count: 1 })).toBe(
      'Falta 1 archivo de arte para este layout.',
    );
    expect(t('tcg.reason.missingArt', { count: 2 })).toBe(
      'Faltan 2 archivos de arte para este layout.',
    );
    expect(formatBytes(1536)).toBe('1,5 KB');
  });

  it('falls back to English when the backend sends no known language', () => {
    setLanguage('es');
    setLanguage(undefined);
    expect(getLanguage()).toBe('en');
    setLanguage('fr' as StudioLanguage);
    expect(getLanguage()).toBe('en');
  });
});
