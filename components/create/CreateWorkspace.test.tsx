/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../contexts/GenerationContext', () => ({
  useGenerationDraft: () => ({
    generationConfig: { attachments: [] },
  }),
}));

vi.mock('../../contexts/GlobalContext', () => ({
  useToastUi: () => ({ addToast: vi.fn() }),
}));

vi.mock('../../lib/studioViewportRouteSurfaces', () => ({
  preloadStudioViewportSurface: vi.fn(),
}));

vi.mock('../../lib/recipeRouteModules', () => ({
  preloadRecipeComponent: vi.fn(),
}));

import type { RecipePageRuntimeProps } from '../RecipePage';
import type { StudioGenerationDockProps } from '../shell/StudioGenerationDock';
import { CreateWorkspace } from './CreateWorkspace';
import {
  RecipeControls,
  RecipeSidePanel,
  RecipeEditor,
  RecipeOptionsPanel,
} from '../recipes/RecipeWorkbenchContext';
import { RecipeWorkbenchContext } from '../recipes/recipeWorkbenchContextState';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);

const GenerationDock = ((props: StudioGenerationDockProps) => (
  <div data-generation-dock-layout={props.layout ?? 'dock'} data-testid="generation-dock">
    {props.railTools}
    {props.railAction}
  </div>
)) as unknown as React.LazyExoticComponent<React.ComponentType<StudioGenerationDockProps>>;

const recipePageProps = {
  imagesWithConfig: [
    {
      id: 'img-styles',
      src: '/library/styles.png',
      thumbnail: '/library/styles-thumb.png',
      batchId: 'batch-1',
      createdAt: Date.parse('2026-05-26T00:00:00.000Z'),
      config: {
        prompt: 'A lantern',
        attachments: [],
        aspectRatio: '3:4',
        batchCount: 1,
        model: 'gpt-image-1',
        executionModel: 'gpt-5.4-codex',
        executionReasoningEffort: 'medium',
        executionSpeed: 'standard',
        recipeId: 'styles',
      },
    },
  ],
  openModal: vi.fn(),
} as unknown as RecipePageRuntimeProps;

const generationDockProps: StudioGenerationDockProps = {
  isModalOpen: false,
  isUiChromeSuppressed: false,
  currentView: 'recipes',
  activeRecipe: null,
  isDragging: false,
  toolbarArgs: {} as StudioGenerationDockProps['toolbarArgs'],
  layout: 'rail',
};

function Catalog() {
  const context = React.useContext(RecipeWorkbenchContext);
  return (
    <>
      <RecipeControls>
        <button onClick={() => context.openStyles?.(true)}>Explore styles</button>
      </RecipeControls>
      <RecipeSidePanel>
        <div data-workspace-expanded={context.catalogExpanded}>
          <input aria-label="Catalog search" />
          <button onClick={context.closeStyles}>Done exploring</button>
        </div>
      </RecipeSidePanel>
    </>
  );
}

describe('CreateWorkspace', () => {
  it('places the tool rail left of the result canvas', () => {
    const { container, rerender } = render(
      <CreateWorkspace
        recipePageProps={recipePageProps}
        hasGenerationDock
        GenerationDock={GenerationDock}
        generationDockProps={generationDockProps}
      />,
    );

    const workspace = container.querySelector('.create-workspace');
    expect(workspace?.getAttribute('data-route-key')).toBe('recipes-list');
    expect(screen.getByRole('complementary', { name: 'Create tools' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Create canvas' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Result preview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View result 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Workflow: Default' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Styles' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Workflow' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Styles' })).toBeNull();
    expect(screen.getByTestId('generation-dock').getAttribute('data-generation-dock-layout')).toBe(
      'rail',
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
    const narrowWorkspace = (workspaceTab: 'configure' | 'preview') => (
      <CreateWorkspace
        key="narrow"
        recipePageProps={recipePageProps}
        hasGenerationDock
        GenerationDock={GenerationDock}
        generationDockProps={generationDockProps}
        workspaceTab={workspaceTab}
      />
    );
    rerender(narrowWorkspace('configure'));
    expect(container.querySelector('.create-stage')?.hasAttribute('inert')).toBe(true);
    rerender(narrowWorkspace('preview'));
    expect(container.querySelector('.create-stage')?.hasAttribute('inert')).toBe(false);
    expect(container.querySelector('.create-tray-stack')?.hasAttribute('inert')).toBe(true);
  });

  it('keeps recipe tools on the left and a specialized stage on the right', () => {
    const { container } = render(
      <CreateWorkspace
        recipePageProps={recipePageProps}
        hasGenerationDock
        GenerationDock={GenerationDock}
        generationDockProps={generationDockProps}
        routeKey="recipe-camera"
        tools={<div>Style mix</div>}
        workflowName="Camera"
        workflowControls={<div data-testid="recipe-tools">Camera tools</div>}
        stage={<div data-testid="camera-stage">Camera editor</div>}
      />,
    );

    const workspace = container.querySelector('.create-workspace');
    const toolsRail = screen.getByRole('complementary', { name: 'Create tools' });
    const stage = screen.getByRole('region', { name: 'Create canvas' });
    const recipeTools = screen.getByTestId('recipe-tools');
    const generate = screen.getByTestId('generation-dock');

    expect(workspace?.getAttribute('data-route-key')).toBe('recipe-camera');
    expect(screen.getAllByRole('tab', { name: 'Workflow' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('tab', { name: 'Styles' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Styles' })).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Camera controls' }).contains(recipeTools)).toBe(
      true,
    );
    expect(toolsRail.contains(generate)).toBe(true);
    expect(stage.contains(screen.getByTestId('camera-stage'))).toBe(true);
    expect(screen.queryByRole('region', { name: 'Result preview' })).toBeNull();
    expect(
      recipeTools.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toolsRail.className).toContain('workbench-config');
  });
  it('preserves the editor draft when results arrive and removes old workflow panels', async () => {
    function Workspace({
      resultId,
      workflow = 'camera',
    }: {
      resultId?: string;
      workflow?: string;
    }) {
      const [controls, setControls] = React.useState<HTMLElement | null>(null);
      const [sidePanel, setSidePanel] = React.useState<HTMLElement | null>(null);
      return (
        <RecipeWorkbenchContext
          value={{
            controls,
            sidePanel,
            action: null,
            overlay: null,
            compare: null,
            setCompare: () => {},
            latestResultId: resultId,
            results: <div>Workflow result</div>,
          }}
        >
          <CreateWorkspace
            recipePageProps={recipePageProps}
            hasGenerationDock
            GenerationDock={GenerationDock}
            generationDockProps={generationDockProps}
            tools={<div>Style mix</div>}
            workflowName="Camera"
            workflowControls={<div ref={setControls} />}
            onSidePanelTarget={setSidePanel}
            stage={
              <React.Fragment key={workflow}>
                <RecipeControls>
                  <button>Workflow control</button>
                </RecipeControls>
                <Catalog />
                <RecipeOptionsPanel title="Frame details">
                  <input aria-label="Correction" />
                </RecipeOptionsPanel>
                <RecipeEditor label="Camera">
                  <input aria-label="Editor draft" defaultValue="Keep this" />
                </RecipeEditor>
              </React.Fragment>
            }
          />
        </RecipeWorkbenchContext>
      );
    }
    const { rerender } = render(<Workspace resultId="old" />);
    const rail = screen.getByRole('complementary', { name: 'Create tools' });
    expect(
      screen
        .getByRole('tabpanel', { name: 'Camera controls' })
        .contains(screen.getByRole('button', { name: 'Workflow control' })),
    ).toBe(true);
    const trigger = screen.getByRole('button', { name: 'Frame details' });
    fireEvent.click(trigger);
    const panel = screen.getByRole('region', { name: 'Frame details' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Correction' }), {
      target: { value: 'Keep this correction' },
    });
    fireEvent.click(screen.getAllByRole('tab', { name: 'Styles' }).at(-1)!);
    expect(panel.closest('[inert]')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Catalog search' }), {
      target: { value: 'forest' },
    });
    fireEvent.click(screen.getAllByRole('tab', { name: 'Workflow' }).at(-1)!);
    expect(screen.getByRole('textbox', { name: 'Correction' })).toHaveProperty(
      'value',
      'Keep this correction',
    );
    const explore = screen.getByRole('button', { name: 'Explore styles' });
    explore.focus();
    fireEvent.click(explore);
    expect(screen.getByRole('textbox', { name: 'Catalog search' })).toHaveProperty(
      'value',
      'forest',
    );

    const canvas = screen.getByRole('region', { name: 'Create canvas' });
    await waitFor(() => {
      expect(rail.hasAttribute('inert')).toBe(true);
      expect(canvas.hasAttribute('inert')).toBe(true);
    });
    fireEvent.click(screen.getAllByRole('tab', { name: 'Workflow' }).at(-1)!);
    expect(canvas.hasAttribute('inert')).toBe(false);
    fireEvent.click(screen.getAllByRole('tab', { name: 'Styles' }).at(-1)!);
    expect(canvas.hasAttribute('inert')).toBe(false);
    fireEvent.click(screen.getAllByRole('tab', { name: 'Workflow' }).at(-1)!);
    explore.focus();
    fireEvent.click(explore);
    expect(canvas.hasAttribute('inert')).toBe(true);
    const done = screen.getByRole('button', { name: 'Done exploring' });
    done.focus();
    fireEvent.click(done);
    expect(
      screen.getAllByRole('tab', { name: 'Workflow' }).at(-1)!.getAttribute('aria-selected'),
    ).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(explore));
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Frame details' })).toBeNull();
    await waitFor(() => {
      expect(rail.hasAttribute('inert')).toBe(false);
      expect(canvas.hasAttribute('inert')).toBe(false);
    });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close controls panel' }));
    expect(screen.queryByRole('tabpanel', { name: 'Camera controls' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    expect(screen.getByRole('tabpanel', { name: 'Camera controls' }).contains(trigger)).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Editor draft' }), {
      target: { value: 'Edited draft' },
    });
    rerender(<Workspace resultId="new" />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Results' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Camera' }));
    expect((screen.getByRole('textbox', { name: 'Editor draft' }) as HTMLInputElement).value).toBe(
      'Edited draft',
    );
    fireEvent.click(trigger);
    rerender(<Workspace resultId="new" workflow="timeline" />);
    expect(screen.queryByRole('region', { name: 'Frame details' })).toBeNull();
  });
});
