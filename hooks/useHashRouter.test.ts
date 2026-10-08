/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveHashRouterState,
  resolveHashRouterTransition,
  useHashRouter,
} from './useHashRouter';
import { setIsGlobalTransitioning } from '../utils/transitionUtils';

const studioRoute = {
  view: 'studio' as const,
  activeRecipeId: null,
  activeRecipeAliasId: null,
  overlay: 'none' as const,
};

it('keeps one native transition through hash sync and lets newer navigation win', async () => {
  const originalTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
  let commit: () => void = () => {};
  let finish: () => void = () => {};
  const native = vi.fn((callback: () => void) => {
    commit = callback;
    return {
      ready: Promise.resolve(),
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    } as ViewTransition;
  });
  document.startViewTransition = native;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  window.history.replaceState(null, '', '/');
  try {
    const { result } = renderHook(useHashRouter);
    act(() => result.current.navigateToRecipes());
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(native).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.transitionType).toBe('route');
    act(commit);
    expect(result.current.route.view).toBe('recipes');
    await act(async () => {
      finish();
    });
    expect(document.documentElement.dataset.transitionType).toBeUndefined();

    act(() => result.current.navigateToStudio());
    act(() => result.current.navigateToRecipe('timeline'));
    act(commit);
    expect(result.current.route.activeRecipeId).toBe('timeline');
    await act(async () => {
      finish();
    });
  } finally {
    cleanup();
    if (originalTransition) {
      Object.defineProperty(document, 'startViewTransition', originalTransition);
    } else {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
    setIsGlobalTransitioning(false);
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
    document.documentElement.removeAttribute('data-transition-type');
    document.documentElement.removeAttribute('data-route-direction');
  }
});

describe('resolveHashRouterState', () => {
  it('maps recipes hash to the recipes view', () => {
    const next = resolveHashRouterState(studioRoute, '#recipes');

    expect(next).toEqual({
      view: 'recipes',
      activeRecipeId: null,
      activeRecipeAliasId: null,
      overlay: 'none',
    });
    expect(resolveHashRouterState(studioRoute, '#recipes/pack_01')).toEqual(next);
  });

  it('maps recipe hashes to the concrete recipe page', () => {
    const next = resolveHashRouterState(studioRoute, '#recipe-camera');

    expect(next).toEqual({
      view: 'recipe',
      activeRecipeId: 'camera',
      activeRecipeAliasId: null,
      overlay: 'none',
    });
  });

  it('keeps style pack subroutes on the styles recipe page', () => {
    const next = resolveHashRouterState(studioRoute, '#recipe-styles/pack_01');

    expect(next).toEqual({
      view: 'recipe',
      activeRecipeId: 'styles',
      activeRecipeAliasId: null,
      overlay: 'none',
    });
  });

  it('maps recipe alias hashes to their canonical recipe and alias id', () => {
    const next = resolveHashRouterState(studioRoute, '#recipe-character-sprites');

    expect(next).toEqual({
      view: 'recipe',
      activeRecipeId: 'character-lab',
      activeRecipeAliasId: 'character-sprites',
      overlay: 'none',
    });
  });

  it('maps canonical Character Lab mode hashes to recipe aliases', () => {
    const next = resolveHashRouterState(studioRoute, '#recipe-character-lab/spritesheets');

    expect(next).toEqual({
      view: 'recipe',
      activeRecipeId: 'character-lab',
      activeRecipeAliasId: 'character-sprites',
      overlay: 'none',
    });
  });

  it('keeps the previous recipe route when opening the modal overlay', () => {
    const next = resolveHashRouterState(
      {
        view: 'recipe',
        activeRecipeId: 'timeline',
        activeRecipeAliasId: null,
        overlay: 'none',
      },
      '#modal',
    );

    expect(next).toEqual({
      view: 'recipe',
      activeRecipeId: 'timeline',
      activeRecipeAliasId: null,
      overlay: 'modal',
    });
  });

  it('keeps the previous studio route when opening the editor overlay', () => {
    const next = resolveHashRouterState(
      {
        view: 'studio',
        activeRecipeId: null,
        activeRecipeAliasId: null,
        overlay: 'none',
      },
      '#editor',
    );

    expect(next).toEqual({
      view: 'studio',
      activeRecipeId: null,
      activeRecipeAliasId: null,
      overlay: 'editor',
    });
  });

  it('falls back to studio for unknown hashes', () => {
    const next = resolveHashRouterState(studioRoute, '#totally-unknown');

    expect(next).toEqual({
      view: 'studio',
      activeRecipeId: null,
      activeRecipeAliasId: null,
      overlay: 'none',
    });
  });
});

describe('resolveHashRouterTransition', () => {
  it('moves forward from studio to recipes and recipe detail', () => {
    const recipesRoute = resolveHashRouterState(studioRoute, '#recipes');
    const recipeRoute = resolveHashRouterState(recipesRoute, '#recipe-camera');

    expect(resolveHashRouterTransition(studioRoute, recipesRoute)).toBe('forward');
    expect(resolveHashRouterTransition(recipesRoute, recipeRoute)).toBe('forward');
  });

  it('moves back from recipe detail to recipes and studio', () => {
    const recipesRoute = resolveHashRouterState(studioRoute, '#recipes');
    const recipeRoute = resolveHashRouterState(recipesRoute, '#recipe-camera');

    expect(resolveHashRouterTransition(recipeRoute, recipesRoute)).toBe('back');
    expect(resolveHashRouterTransition(recipesRoute, studioRoute)).toBe('back');
  });

  it('keeps overlay-only changes out of page route transitions', () => {
    const recipeRoute = resolveHashRouterState(studioRoute, '#recipe-timeline');
    const modalRoute = resolveHashRouterState(recipeRoute, '#modal');

    expect(resolveHashRouterTransition(recipeRoute, modalRoute)).toBeUndefined();
  });
});
