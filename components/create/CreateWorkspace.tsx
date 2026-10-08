import type { UseCatalogResult } from '../../hooks/useCatalogPage';
import React, { Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useGenerationDraft } from '../../contexts/GenerationContext';
import { buildRoutePreloadPlan, type RoutePreloadPlan } from '../../lib/routePreloadBudget';
import { preloadRecipeComponent } from '../../lib/recipeRouteModules';
import { preloadStudioViewportSurface } from '../../lib/studioViewportRouteSurfaces';
import type { GeneratedImageWithConfig } from '../../types';
import type { RecipePageRuntimeProps } from '../RecipePage';
import { RecipeResultPreview } from '../recipes/RecipeResultPreview';
import { RecipeWorkbenchContext } from '../recipes/recipeWorkbenchContextState';
import type { StudioGenerationDockProps } from '../shell/StudioGenerationDock';

function preloadStudioViewportPlan(plan: RoutePreloadPlan) {
  for (const surface of plan.surfaces) {
    void preloadStudioViewportSurface(surface);
  }
  for (const recipeId of plan.recipeIds) {
    void preloadRecipeComponent(recipeId);
  }
}

const StudioGenerationDockFallback: React.FC = () => (
  <div
    className="create-tool-dock-loading min-h-0 flex-1"
    data-generation-dock-loading="true"
    aria-hidden="true"
  />
);

export interface CreateWorkspaceProps {
  recipePageProps: RecipePageRuntimeProps;
  hasGenerationDock: boolean;
  GenerationDock: React.LazyExoticComponent<React.ComponentType<StudioGenerationDockProps>>;
  generationDockProps: StudioGenerationDockProps;
  onToggleFavorite?: (imageId: string) => void;
  onUseAsReference?: (image: GeneratedImageWithConfig) => void;
  tools?: React.ReactNode;
  workflowControls?: React.ReactNode;
  workflowName?: string;
  action?: React.ReactNode;
  stage?: React.ReactNode;
  images?: GeneratedImageWithConfig[];
  history?: UseCatalogResult;
  selectedId?: string | null;
  onSelectId?: (id: string) => void;
  routeKey?: string;
  workspaceTab?: 'configure' | 'preview';
  onNarrowChange?: (narrow: boolean) => void;
  onSidePanelTarget?: (node: HTMLElement | null) => void;
}

export const CreateWorkspace: React.FC<CreateWorkspaceProps> = ({
  recipePageProps,
  hasGenerationDock,
  GenerationDock,
  generationDockProps,
  onToggleFavorite,
  onUseAsReference,
  tools,
  workflowControls,
  workflowName,
  action,
  stage,
  images,
  history,
  selectedId,
  onSelectId,
  routeKey = 'recipes-list',
  workspaceTab = 'configure',
  onNarrowChange,
  onSidePanelTarget,
}) => {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<'wide' | 'split' | 'single'>('split');
  const context = useContext(RecipeWorkbenchContext);
  const [pane, setPane] = useState<'prompt' | 'workflow' | 'styles'>(
    workflowName ? 'workflow' : 'prompt',
  );
  const [panelExpanded, setPanelExpanded] = useState(false);
  const previousPane = useRef(pane);
  const catalogTrigger = useRef<HTMLElement | null>(null);
  const openStyles = React.useCallback(
    (expanded = false) => {
      if (expanded) previousPane.current = pane;
      catalogTrigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPane('styles');
      setPanelExpanded(expanded);
    },
    [pane],
  );
  const closeStyles = React.useCallback(() => {
    setPane(panelExpanded ? previousPane.current : 'prompt');
    setPanelExpanded(false);
    requestAnimationFrame(() => {
      const trigger = catalogTrigger.current;
      if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus();
      else
        workspaceRef.current
          ?.querySelector<HTMLButtonElement>(
            '.create-panel-launchers button, [aria-label="Open style catalog"]',
          )
          ?.focus();
    });
  }, [panelExpanded]);
  const promptHidden = panelExpanded || (layout !== 'wide' && pane !== 'prompt');
  const singlePane = layout === 'single' ? workspaceTab : null;
  const tabs = ['prompt', 'workflow', 'styles'] as const;
  const selectPane = (next: typeof pane) => {
    setPane(next);
    setPanelExpanded(false);
  };
  const selectTab = (event: React.KeyboardEvent, tab: typeof pane) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item === tab);
    const next =
      event.key === 'Home'
        ? tabs[0]
        : event.key === 'End'
          ? tabs[tabs.length - 1]
          : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectPane(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-pane="${next}"]`)
      ?.focus();
  };
  useLayoutEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const resize = () => {
      const width = element.clientWidth;
      setLayout(width >= 1120 ? 'wide' : width >= 720 ? 'split' : 'single');
      onNarrowChange?.(width < 720);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [onNarrowChange]);
  useEffect(() => {
    const plan = buildRoutePreloadPlan({ routeView: 'recipes', activeRecipe: null });
    const timeoutId = window.setTimeout(() => preloadStudioViewportPlan(plan), plan.delayMs);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <RecipeWorkbenchContext
      value={{
        ...context,
        stylesOpen: pane === 'styles',
        catalogExpanded: panelExpanded,
        openStyles,
        closeStyles,
      }}
    >
      <div
        ref={workspaceRef}
        className="create-workspace"
        data-route-key={routeKey}
        data-layout={layout}
        data-catalog-pane={pane !== 'prompt'}
        data-active-pane={pane}
        data-catalog-expanded={panelExpanded}
        data-workspace-view={workspaceTab}
      >
        <div className="create-tray-stack" inert={singlePane === 'preview'}>
          {workflowName ? (
            <div
              className="create-pane-switch"
              role="tablist"
              aria-label="Configure panel"
              inert={panelExpanded}
              hidden={layout === 'wide'}
            >
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  data-pane={tab}
                  aria-selected={pane === tab}
                  tabIndex={pane === tab ? 0 : -1}
                  onKeyDown={(event) => selectTab(event, tab)}
                  onClick={() => selectPane(tab)}
                >
                  {tab === 'prompt' ? 'Prompt' : tab === 'workflow' ? 'Workflow' : 'Styles'}
                </button>
              ))}
            </div>
          ) : null}
          <aside
            className={`create-tools studio-surface${tools ? ' workbench-config' : ''}`}
            aria-label="Create tools"
            inert={promptHidden}
            aria-hidden={promptHidden}
          >
            {workflowName && (
              <div className="create-panel-launchers">
                <button
                  type="button"
                  aria-expanded={pane === 'workflow'}
                  onClick={() => selectPane(pane === 'workflow' ? 'prompt' : 'workflow')}
                >
                  {workflowName}
                </button>
              </div>
            )}
            {hasGenerationDock ? (
              <Suspense fallback={<StudioGenerationDockFallback />}>
                <GenerationDock
                  {...generationDockProps}
                  layout="rail"
                  railTools={tools}
                  railAction={action}
                />
              </Suspense>
            ) : (
              tools
            )}
          </aside>
          <div
            className="create-side-panel studio-surface"
            hidden={pane === 'prompt'}
            inert={pane === 'prompt'}
          >
            <div
              className="create-secondary-head"
              hidden={!workflowName || (layout !== 'wide' && !panelExpanded)}
            >
              {workflowName ? (
                <div className="create-secondary-tabs" role="tablist" aria-label="Workflow panels">
                  {tabs
                    .filter((tab) => tab !== 'prompt')
                    .map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={pane === tab}
                        tabIndex={pane === tab ? 0 : -1}
                        onKeyDown={(event) => {
                          if (
                            !workflowName ||
                            !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
                          )
                            return;
                          event.preventDefault();
                          const next =
                            event.key === 'Home'
                              ? 'workflow'
                              : event.key === 'End'
                                ? 'styles'
                                : tab === 'styles'
                                  ? 'workflow'
                                  : 'styles';
                          selectPane(next);
                          event.currentTarget.parentElement
                            ?.querySelector<HTMLButtonElement>(`[data-pane="${next}"]`)
                            ?.focus();
                        }}
                        data-pane={tab}
                        onClick={() => selectPane(tab)}
                      >
                        {tab === 'workflow' ? 'Workflow' : 'Styles'}
                      </button>
                    ))}
                </div>
              ) : null}
              <button
                type="button"
                aria-label="Close controls panel"
                onClick={() => {
                  selectPane('prompt');
                  requestAnimationFrame(() =>
                    workspaceRef.current
                      ?.querySelector<HTMLButtonElement>(
                        '.create-panel-launchers button, [aria-label="Open style catalog"], [aria-label="Add a style"], [data-pane="prompt"]',
                      )
                      ?.focus(),
                  );
                }}
              >
                ×
              </button>
            </div>
            {workflowName && (
              <div
                className="create-workflow-panel workbench-config custom-scrollbar"
                role="tabpanel"
                aria-label={`${workflowName} controls`}
                hidden={pane !== 'workflow'}
                inert={pane !== 'workflow'}
              >
                {workflowControls}
              </div>
            )}
            <div
              ref={onSidePanelTarget}
              className="create-styles-panel"
              role="tabpanel"
              aria-label="Styles controls"
              hidden={pane !== 'styles'}
              inert={pane !== 'styles'}
            />
          </div>
        </div>
        <section
          className="create-stage studio-well"
          aria-label="Create canvas"
          inert={panelExpanded || singlePane === 'configure'}
        >
          {stage ?? (
            <CreateResults
              recipePageProps={recipePageProps}
              images={images}
              history={history}
              selectedId={selectedId}
              onSelectId={onSelectId}
              onToggleFavorite={onToggleFavorite}
              onUseAsReference={onUseAsReference}
            />
          )}
        </section>
      </div>
    </RecipeWorkbenchContext>
  );
};

export function CreateResults({
  recipePageProps,
  images,
  onToggleFavorite,
  onUseAsReference,
  title,
  history,
  selectedId,
  onSelectId,
}: Pick<
  CreateWorkspaceProps,
  | 'recipePageProps'
  | 'images'
  | 'onToggleFavorite'
  | 'onUseAsReference'
  | 'history'
  | 'selectedId'
  | 'onSelectId'
> & { title?: string }) {
  const draft = useGenerationDraft();
  return (
    <RecipeResultPreview
      variant="stage"
      history={history}
      selectedId={selectedId}
      onSelectId={onSelectId}
      images={images ?? recipePageProps.imagesWithConfig}
      reference={draft.generationConfig.attachments[0]}
      onOpen={recipePageProps.openModal}
      onToggleFavorite={onToggleFavorite}
      onUseAsReference={onUseAsReference}
      emptyTitle={title ? `${title} results` : undefined}
      isGenerating={recipePageProps.isGenerating}
    />
  );
}
