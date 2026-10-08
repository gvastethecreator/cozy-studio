import { RecipeWorkbenchContext, type WorkflowPrompt } from './recipeWorkbenchContextState';
import React, { useContext, useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function RecipeControls({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  const context = useContext(RecipeWorkbenchContext);
  const target = compact ? context.compactControls : context.controls;
  return target
    ? createPortal(<section className="recipe-controls">{children}</section>, target)
    : children;
}

export function useWorkflowPrompt(prompt: WorkflowPrompt) {
  const { value, label, placeholder } = prompt;
  const { setPrompt } = useContext(RecipeWorkbenchContext);
  const onChange = useRef(prompt.onChange);
  useLayoutEffect(() => {
    onChange.current = prompt.onChange;
  });
  useLayoutEffect(() => {
    setPrompt?.({ value, label, placeholder, onChange: (next) => onChange.current(next) });
    return () => setPrompt?.(null);
  }, [setPrompt, value, label, placeholder]);
}

export function RecipePrimaryAction({
  children,
  execute,
  disabled = false,
}: {
  children: React.ReactNode;
  execute: () => void;
  disabled?: boolean;
}) {
  const { action, setPrimaryAction } = useContext(RecipeWorkbenchContext);
  const executeRef = useRef(execute);
  useLayoutEffect(() => {
    executeRef.current = execute;
  });
  useLayoutEffect(() => {
    setPrimaryAction?.({ execute: () => executeRef.current(), disabled });
    return () => setPrimaryAction?.(null);
  }, [setPrimaryAction, disabled]);
  return action ? createPortal(children, action) : children;
}

export function RecipeOverlay({ children }: { children: React.ReactNode }) {
  const { overlay } = useContext(RecipeWorkbenchContext);
  return overlay ? createPortal(children, overlay) : children;
}

export function RecipeSidePanel({ children }: { children: React.ReactNode }) {
  const { sidePanel } = useContext(RecipeWorkbenchContext);
  return sidePanel ? createPortal(children, sidePanel) : null;
}

export function RecipeResults() {
  return <>{useContext(RecipeWorkbenchContext).results ?? null}</>;
}

/** Keep the editor mounted when viewing results so its local draft and canvas survive. */
export function RecipeEditor({ label, children }: { label: string; children: React.ReactNode }) {
  const { results, latestResultId } = useContext(RecipeWorkbenchContext);
  const [selected, setSelected] = useState<'editor' | 'results'>('editor');
  const previousResult = useRef(latestResultId);
  const id = useId();
  useEffect(() => {
    if (latestResultId && latestResultId !== previousResult.current) setSelected('results');
    previousResult.current = latestResultId;
  }, [latestResultId]);

  return (
    <div className="recipe-editor">
      <div className="recipe-stage-tabs" role="tablist" aria-label="Workflow view">
        {(['editor', 'results'] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            id={`${id}-${view}-tab`}
            aria-controls={`${id}-${view}`}
            aria-selected={selected === view}
            tabIndex={selected === view ? 0 : -1}
            onClick={() => setSelected(view)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'editor'
                  : event.key === 'End'
                    ? 'results'
                    : view === 'editor'
                      ? 'results'
                      : 'editor';
              setSelected(next);
              document.getElementById(`${id}-${next}-tab`)?.focus();
            }}
          >
            {view === 'editor' ? label : 'Results'}
          </button>
        ))}
      </div>
      <div
        id={`${id}-editor`}
        role="tabpanel"
        aria-labelledby={`${id}-editor-tab`}
        className="recipe-editor-content"
        hidden={selected !== 'editor'}
      >
        {children}
      </div>
      <div
        id={`${id}-results`}
        role="tabpanel"
        aria-labelledby={`${id}-results-tab`}
        className="recipe-editor-content"
        hidden={selected !== 'results'}
      >
        {results}
      </div>
    </div>
  );
}

export function RecipeOptionsPanel({
  title,
  children,
  open: controlledOpen,
  onOpenChange,
  triggerRef: suppliedRef,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const ownRef = useRef<HTMLButtonElement>(null);
  const triggerRef = suppliedRef ?? ownRef;
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (panelRef.current?.closest('[inert]')) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, setOpen, triggerRef]);
  return (
    <>
      <RecipeControls>
        <button
          ref={triggerRef}
          type="button"
          className="recipe-options-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {title}
        </button>
      </RecipeControls>
      <RecipeControls>
        <div
          ref={panelRef}
          id={id}
          role="region"
          aria-label={title}
          hidden={!open}
          inert={!open}
          tabIndex={-1}
          className="recipe-detail-section"
        >
          <div className="create-side-panel-head">
            <strong>{title}</strong>
            <button
              type="button"
              aria-label={`Close ${title.toLowerCase()}`}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              ×
            </button>
          </div>
          <div className="create-side-panel-body custom-scrollbar">{children}</div>
        </div>
      </RecipeControls>
    </>
  );
}
