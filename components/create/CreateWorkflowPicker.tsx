import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NavArrowDown, Network } from 'iconoir-react';

import type { RecipeAliasId } from '../../lib/recipeAliases';
import { createRecipeDiscoveryProjection } from '../../lib/recipeDiscoveryProjection';
import { preloadRecipeComponent } from '../../lib/recipeRouteModules';
import { buildRecipeIntentPreloadPlan } from '../../lib/routePreloadBudget';
import { preloadStudioViewportSurface } from '../../lib/studioViewportRouteSurfaces';
import type { RecipeId } from '../../types';
import Tooltip from '../Tooltip';

const loadWorkflowCards = () => import('../recipes/RecipeDiscoveryList');
const RecipeDiscoveryList = lazy(() =>
  loadWorkflowCards().then((module) => ({ default: module.RecipeDiscoveryList })),
);

export interface CreateWorkflowPickerProps {
  onSelectRecipe: (id: RecipeId, aliasId?: RecipeAliasId | null) => void;
  onPreviewRecipe?: (id: RecipeId) => void;
  onSelectDefault?: () => void;
  selectedLabel?: string;
  selectedId?: string | null;
}

function preloadRecipeIntent(recipeId: RecipeId) {
  const plan = buildRecipeIntentPreloadPlan(recipeId);
  for (const surface of plan.surfaces) {
    void preloadStudioViewportSurface(surface);
  }
  for (const id of plan.recipeIds) {
    void preloadRecipeComponent(id);
  }
}

export const CreateWorkflowPicker: React.FC<CreateWorkflowPickerProps> = ({
  onSelectRecipe,
  onPreviewRecipe,
  onSelectDefault,
  selectedLabel = 'Default',
  selectedId,
}) => {
  const [open, setOpen] = useState<'pointer' | 'keyboard' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const recipeDiscovery = useMemo(() => createRecipeDiscoveryProjection(), []);
  const activeId =
    selectedId ??
    recipeDiscovery.entries.find(
      (entry) => entry.title.toLowerCase() === selectedLabel.toLowerCase(),
    )?.id;

  const handlePreviewRecipe = useCallback(
    (recipeId: RecipeId) => {
      preloadRecipeIntent(recipeId);
      onPreviewRecipe?.(recipeId);
    },
    [onPreviewRecipe],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const updatePopoverPosition = () => {
      if (!rootRef.current || !popoverRef.current) return;
      popoverRef.current.style.setProperty(
        '--create-workflow-popover-top',
        `${rootRef.current.getBoundingClientRect().bottom + 7}px`,
      );
      const toolbar = rootRef.current.closest('.studio-toolbar-shell');
      if (toolbar && backdropRef.current) {
        backdropRef.current.style.top = `${toolbar.getBoundingClientRect().bottom}px`;
      }
    };
    updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(null);
        rootRef.current.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(null);
        rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const closeAndFocus = () => {
    setOpen(null);
    rootRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
  };

  return (
    <section className="create-workflow-block is-header" aria-label="Workflow">
      {open && <div ref={backdropRef} className="create-workflow-backdrop" aria-hidden="true" />}
      <div ref={rootRef} className="create-workflow-row">
        <Tooltip content="Workflow" position="bottom">
          <button
            type="button"
            className="create-workflow-quiet-select studio-control"
            aria-label={`Workflow: ${selectedLabel}`}
            aria-haspopup="listbox"
            aria-expanded={Boolean(open)}
            aria-controls="create-workflow-list"
            onPointerEnter={() => void loadWorkflowCards()}
            onFocus={() => void loadWorkflowCards()}
            onClick={(event) => setOpen(open ? null : event.detail === 0 ? 'keyboard' : 'pointer')}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setOpen('keyboard');
              }
            }}
          >
            <Network width={16} height={16} aria-hidden="true" />
            <span id="create-workflow-value">{selectedLabel}</span>
            <NavArrowDown
              width={14}
              height={14}
              className={`create-workflow-chevron${open ? ' is-open' : ''}`}
              aria-hidden="true"
            />
          </button>
        </Tooltip>
        {open ? (
          <div
            ref={popoverRef}
            id="create-workflow-list"
            role="listbox"
            aria-label="Workflows"
            className="create-workflow-popover custom-scrollbar"
            data-entry={open}
            onKeyDown={(event) => {
              const options = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'),
              );
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              const last = options.length - 1;
              let next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? last
                    : event.key === 'ArrowDown' || event.key === 'ArrowRight'
                      ? (index + 1) % options.length
                      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                        ? (index - 1 + options.length) % options.length
                        : null;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const current = options[index]?.getBoundingClientRect();
                if (current?.height) {
                  const direction = event.key === 'ArrowDown' ? 1 : -1;
                  const rows = options
                    .map((option, optionIndex) => ({
                      index: optionIndex,
                      rect: option.getBoundingClientRect(),
                    }))
                    .filter(({ rect }) => direction * (rect.top - current.top) > 1);
                  rows.sort(
                    (a, b) =>
                      direction * (a.rect.top - b.rect.top) ||
                      Math.abs(a.rect.left - current.left) - Math.abs(b.rect.left - current.left),
                  );
                  next = rows[0]?.index ?? index;
                }
              }
              if (next !== null) {
                event.preventDefault();
                options[next]?.focus();
              }
              if (event.key === 'Tab') closeAndFocus();
            }}
          >
            <div className="create-workflow-popover-heading">
              <strong>Choose a workflow</strong>
              <span>A starting point for your next idea.</span>
            </div>
            <Suspense fallback={<p className="create-popover-note">Loading workflows…</p>}>
              <RecipeDiscoveryList
                entries={recipeDiscovery.entries}
                selectedId={selectedLabel === 'Default' ? 'default' : activeId}
                onSelectDefault={() => {
                  closeAndFocus();
                  onSelectDefault?.();
                }}
                density="compact"
                onSelectRecipe={(id, aliasId) => {
                  closeAndFocus();
                  onSelectRecipe(id, aliasId);
                }}
                onPreviewRecipe={handlePreviewRecipe}
              />
            </Suspense>
            <div className="create-popover-note">
              Arrow keys to explore · Enter to select · Esc to close
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};
