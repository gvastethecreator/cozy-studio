/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreateWorkflowPicker } from './CreateWorkflowPicker';
import { WORKFLOW_CATEGORIES } from '../../packages/shared/src/workflowCatalog';
import mascot from '../../assets/logo.svg';

vi.mock('../../lib/recipeRouteModules', () => ({ preloadRecipeComponent: vi.fn() }));
vi.mock('../../lib/studioViewportRouteSurfaces', () => ({
  preloadStudioViewportSurface: vi.fn(),
}));

afterEach(cleanup);

describe('CreateWorkflowPicker', () => {
  it('keeps Default selected and does not navigate when Default is chosen', async () => {
    const onSelectRecipe = vi.fn();
    const onPreviewRecipe = vi.fn();

    render(
      <CreateWorkflowPicker onSelectRecipe={onSelectRecipe} onPreviewRecipe={onPreviewRecipe} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Workflow: Default' }));
    const listbox = screen.getByRole('listbox', { name: 'Workflows' });
    expect(listbox).toBeTruthy();
    expect(listbox.className).toContain('custom-scrollbar');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(WORKFLOW_CATEGORIES.flatMap((group) => group.workflows).length);
    const scenes = options.map((option) => {
      const art = option.querySelector('svg');
      expect(art?.getAttribute('viewBox')).toBe('0 0 320 240');
      expect(art?.querySelector('image')?.getAttribute('href')).toBe(mascot);
      return art?.innerHTML;
    });
    expect(new Set(scenes).size).toBe(options.length);
    expect(screen.queryByRole('option', { name: /open styles/i })).toBeNull();

    fireEvent.click(await screen.findByRole('option', { name: 'Default' }));
    expect(onSelectRecipe).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox', { name: 'Workflows' })).toBeNull();
  });

  it('navigates to a recipe from the catalog', async () => {
    const onSelectRecipe = vi.fn();
    const onPreviewRecipe = vi.fn();

    render(
      <CreateWorkflowPicker onSelectRecipe={onSelectRecipe} onPreviewRecipe={onPreviewRecipe} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Workflow: Default' }));
    fireEvent.click(await screen.findByRole('option', { name: /open remaster/i }));

    expect(onSelectRecipe).toHaveBeenCalled();
    const [recipeId] = onSelectRecipe.mock.calls[0];
    expect(recipeId).toBe('remaster');
  });

  it('returns to Default through the optional default handler', async () => {
    const onSelectDefault = vi.fn();

    render(
      <CreateWorkflowPicker
        selectedLabel="Remaster"
        onSelectRecipe={vi.fn()}
        onSelectDefault={onSelectDefault}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Workflow: Remaster' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Default' }));
    expect(onSelectDefault).toHaveBeenCalledTimes(1);
  });
  it('marks an alias selected and supports keyboard navigation and focus return', async () => {
    render(
      <CreateWorkflowPicker
        selectedId="character-poses"
        selectedLabel="Character Poses"
        onSelectRecipe={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Workflow: Character Poses' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const selected = await screen.findByRole('option', { name: 'Open character poses' });
    expect(screen.getByRole('group', { name: 'Character' }).contains(selected)).toBe(true);
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(selected);
    expect(screen.getByRole('listbox').getAttribute('data-entry')).toBe('keyboard');
    fireEvent.keyDown(selected, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByRole('option', { name: 'Open character sprites' }),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(selected);
    fireEvent.keyDown(selected, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Open sprite atlas' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
