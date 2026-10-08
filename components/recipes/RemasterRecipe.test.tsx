/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERATION_CONFIG } from '../../constants';
import { getRecipeModule, validateRecipeParams } from '../../lib/recipeModules';
import type { ImageGenerationConfig } from '../../types';
import { RemasterRecipe } from './RemasterRecipe';

afterEach(cleanup);

const remasterConfig = (overrides: Partial<ImageGenerationConfig> = {}): ImageGenerationConfig => ({
  ...DEFAULT_GENERATION_CONFIG,
  recipeId: 'remaster',
  ...overrides,
});

describe('RemasterRecipe', () => {
  it('shows reused settings and builds Reinterpret from them without preserve conflicts', () => {
    const updateConfig = vi.fn();
    const view = render(
      <RemasterRecipe config={remasterConfig()} updateConfig={updateConfig} isGenerating={false} />,
    );
    view.rerender(
      <RemasterRecipe
        config={remasterConfig({
          recipeParams: { style: 'Analog Film', text: 'Remove Text', fidelity: 60 },
        })}
        updateConfig={updateConfig}
        isGenerating={false}
      />,
    );
    expect(screen.getByRole('spinbutton', { name: 'Fidelity value' })).toHaveProperty(
      'value',
      '60',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reinterpret' }));
    const params = updateConfig.mock.lastCall?.[1];
    expect(params).toEqual({
      style: 'Realistic Reconstruction',
      lighting: 'Lighting Correction',
      camera: 'Texture Enhancement',
      anatomy: 'Fix Anatomy',
      text: 'Remove Text',
      color: 'Color Correction',
      fidelity: 35,
    });
    expect(validateRecipeParams(getRecipeModule('remaster')!, params).valid).toBe(true);
  });
});
