import { RecipeWorkbenchContext } from './recipes/recipeWorkbenchContextState';
/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspaceState = vi.hoisted(() => ({ activeWorkspaceId: 'workspace-a' }));

vi.mock('../contexts/GlobalContext', () => ({
  useToastUi: () => ({ addToast: vi.fn() }),
  useWorkspaceState: () => workspaceState,
}));

vi.mock('../contexts/GenerationContext', () => ({ useGenerationDraft: vi.fn() }));

vi.mock('../services/studio-api/catalog', () => ({
  getCatalogImageDetail: vi.fn(async (id) => ({
    id,
    publicUrl: '/library/source.png',
    filePath: 'X:/library/source.png',
    sourceExists: true,
    createdAt: '2026-10-07T00:00:00Z',
    width: 1024,
    height: 1024,
  })),
}));

vi.mock('./ui/DemandMountedGsapDropdown', () => ({
  DemandMountedGsapDropdown: ({
    open,
    children,
    role,
    'aria-label': ariaLabel,
  }: {
    open: boolean;
    children: ReactNode;
    role?: string;
    'aria-label'?: string;
  }) =>
    open ? (
      <div role={role ?? 'dialog'} aria-label={ariaLabel}>
        {children}
      </div>
    ) : null,
}));

import { MODELS } from '../constants';
import { getCatalogImageDetail } from '../services/studio-api/catalog';
import type { StudioCommandCenterProjection } from '../lib/commandCenterProjection';
import type { ImageGenerationConfig } from '../types';
import { Toolbar, type ToolbarProps } from './Toolbar';
import { StudioGenerationDock, type StudioGenerationDockProps } from './shell/StudioGenerationDock';
import { useGenerationDraft } from '../contexts/GenerationContext';

afterEach(() => {
  cleanup();
  workspaceState.activeWorkspaceId = 'workspace-a';
});

const commandCenter: StudioCommandCenterProjection = {
  compactMode: false,
  runtimeStatus: { label: 'Ready', tone: 'success', tooltip: 'Runtime ready.' },
  provider: {
    id: 'codex',
    label: 'Codex app-server',
    shortLabel: 'Codex',
    toolbarLabel: 'Codex',
    status: 'active',
    tone: 'success',
    tooltip: 'Ready',
    canExecute: true,
    statusDetail: 'Ready',
  },
  providerOptions: [
    {
      id: 'codex',
      label: 'Codex app-server',
      shortLabel: 'Codex',
      toolbarLabel: 'Codex',
      status: 'active',
      tone: 'success',
      tooltip: 'Ready',
      canExecute: true,
      statusDetail: 'Ready',
    },
    {
      id: 'grok',
      label: 'Grok Imagine',
      shortLabel: 'Grok',
      toolbarLabel: 'Grok',
      status: 'active',
      tone: 'success',
      tooltip: 'Ready',
      canExecute: true,
      statusDetail: 'Ready',
    },
  ],
  queue: { activeCount: 0, reviewCount: 0, isOpen: false },
};

function config(overrides: Partial<ImageGenerationConfig> = {}): ImageGenerationConfig {
  return {
    prompt: 'A lantern',
    attachments: [],
    aspectRatio: '1:1',
    batchCount: 4,
    model: MODELS.CODEX_IMAGEGEN,
    executionModel: 'gpt-5.4-codex',
    executionReasoningEffort: 'medium',
    executionSpeed: 'standard',
    ...overrides,
  };
}

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    generationConfig: config(),
    updateConfig: vi.fn(),
    updateAttachment: vi.fn(),
    onGenerate: vi.fn(),
    isGenerating: false,
    generationStartTime: null,
    onFileSelect: vi.fn(),
    onFilesDrop: vi.fn(),
    onRemoveAttachment: vi.fn(),
    setPreviewRatio: vi.fn(),
    setIsInteracting: vi.fn(),
    onOpenEditor: vi.fn(),
    isKeyPopoverOpen: false,
    onOpenKeySelector: vi.fn(),
    onSelectKey: vi.fn(),
    maxAttachments: 4,
    codexModelCatalog: null,
    isLoadingCodexModelCatalog: false,
    codexModelCatalogError: null,
    activeProviderId: 'codex',
    commandCenter,
    onSelectProvider: vi.fn(),
    isProviderSaving: false,
    onOpenSettings: vi.fn(),
    layout: 'rail',
    ...overrides,
  };
  return { ...render(<Toolbar {...props} />), props };
}

describe('Toolbar composer chrome', () => {
  it('keeps prompt edits debounced and discards a pending edit when a saved prompt is loaded', () => {
    vi.useFakeTimers();
    try {
      const updateConfig = vi.fn();
      const view = renderToolbar({ updateConfig });
      const prompt = screen.getByRole('textbox', { name: 'Prompt input' });
      fireEvent.change(prompt, { target: { value: 'Pending edit' } });
      expect(prompt).toHaveProperty('value', 'Pending edit');
      expect(updateConfig).not.toHaveBeenCalledWith('prompt', 'Pending edit');
      view.rerender(
        <Toolbar {...view.props} generationConfig={config({ prompt: 'Saved prompt' })} />,
      );
      expect(prompt).toHaveProperty('value', 'Saved prompt');
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(updateConfig).not.toHaveBeenCalledWith('prompt', 'Pending edit');
      fireEvent.change(prompt, { target: { value: 'New edit' } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(updateConfig).toHaveBeenCalledWith('prompt', 'New edit');
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens a different workflow at the start of the tool rail', () => {
    const view = renderToolbar({ interactionScope: 'recipes:character-sheet' });
    const rail = view.container.querySelector<HTMLElement>('.create-tool-scroll')!;
    rail.scrollTop = 400;
    view.rerender(<Toolbar {...view.props} interactionScope="recipes:character-lab" />);
    expect(rail.scrollTop).toBe(0);
  });

  it('projects the active atlas background before the draft has a recipe id', () => {
    const updateConfig = vi.fn();
    const view = renderToolbar({
      activeRecipe: 'sprite-atlas',
      activeProviderId: 'chatgpt',
      generationConfig: config({ recipeId: null }),
      updateConfig,
    });
    expect(screen.getByRole('combobox', { name: 'Output background' })).toHaveProperty(
      'value',
      'transparent',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Output background' }), {
      target: { value: 'workflow' },
    });
    expect(updateConfig).toHaveBeenCalledWith('outputBackground', 'workflow');
    view.unmount();
    renderToolbar({
      activeRecipe: 'sprite-atlas',
      activeProviderId: 'chatgpt',
      generationConfig: config({ recipeId: null, outputBackground: 'workflow' }),
    });
    expect(screen.getByRole('combobox', { name: 'Output background' })).toHaveProperty(
      'value',
      'workflow',
    );
  });

  it('resets Remove background when the provider has no native transparency', () => {
    const updateConfig = vi.fn();
    renderToolbar({
      activeProviderId: 'codex',
      generationConfig: config({ outputBackground: 'transparent' }),
      updateConfig,
    });
    const background = screen.getByRole('combobox', { name: 'Output background' });
    expect(background).toHaveProperty('value', 'workflow');
    expect(screen.getByRole('option', { name: 'Remove background' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(updateConfig).toHaveBeenCalledWith('outputBackground', 'workflow');
  });

  it('blocks Remaster click and shortcut until a source is attached', () => {
    const onGenerate = vi.fn();
    const view = renderToolbar({
      activeRecipe: 'remaster',
      activeProviderId: 'chatgpt',
      codexTransport: 'subscription_http',
      codexAvailableTransports: ['subscription_http'],
      generationConfig: config({ recipeId: 'remaster' }),
      onGenerate,
    });
    fireEvent.click(screen.getByRole('button', { name: /generate 4 images/i }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt input' }), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getAllByText('Add a source image to restore.').length).toBeGreaterThan(0);
    view.rerender(
      <Toolbar
        {...view.props}
        generationConfig={config({
          recipeId: 'remaster',
          attachments: [
            {
              id: 'source',
              name: 'original.png',
              dataUrl: 'data:image/png;base64,aaaa',
              strength: 1,
            },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /generate 4 images/i }));
    expect(onGenerate).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt input' }), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(onGenerate).toHaveBeenCalledTimes(2);
  });

  it('uses the registered workflow prompt and action, including disabled and absent actions', () => {
    const onGenerate = vi.fn();
    const onPrepare = vi.fn();
    const onPrompt = vi.fn();
    const initial = renderToolbar({
      mode: 'context-only',
      generationConfig: config({ prompt: 'Generic prompt' }),
      onGenerate,
    });
    initial.unmount();
    const value = {
      controls: null,
      action: null,
      overlay: null,
      sidePanel: null,
      compare: null,
      setCompare: () => {},
      prompt: {
        value: 'Motion only',
        label: 'Motion prompt',
        placeholder: 'Motion',
        onChange: onPrompt,
      },
      primaryAction: { execute: onPrepare, disabled: false },
    };
    const view = render(
      <RecipeWorkbenchContext value={value}>
        <Toolbar {...initial.props} railAction={<button onClick={onPrepare}>Prepare Run</button>} />
      </RecipeWorkbenchContext>,
    );
    const input = screen.getByRole('textbox', { name: 'Motion prompt' });
    expect(input).toHaveProperty('value', 'Motion only');
    fireEvent.change(input, { target: { value: 'New motion' } });
    expect(onPrompt).toHaveBeenCalledWith('New motion');
    expect(screen.getAllByRole('button', { name: 'Prepare Run' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Run' }));
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });
    expect(onPrepare).toHaveBeenCalledTimes(2);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });
    expect(onPrepare).toHaveBeenCalledTimes(2);
    dialog.remove();
    view.rerender(
      <RecipeWorkbenchContext
        value={{ ...value, primaryAction: { execute: onPrepare, disabled: true } }}
      >
        <Toolbar {...initial.props} railAction={<button disabled>Prepare Run</button>} />
      </RecipeWorkbenchContext>,
    );
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });
    expect(onPrepare).toHaveBeenCalledTimes(2);
    view.rerender(
      <RecipeWorkbenchContext value={{ ...value, primaryAction: null }}>
        <Toolbar {...initial.props} />
      </RecipeWorkbenchContext>,
    );
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true });
    expect(screen.queryByRole('button', { name: 'Prepare Run' })).toBeNull();
    expect(onPrepare).toHaveBeenCalledTimes(2);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('shows one generate requirement next to Generate and keeps the action usable', () => {
    const onGenerate = vi.fn();
    const { container } = renderToolbar({
      activeProviderId: 'chatgpt',
      codexTransport: 'subscription_http',
      codexAvailableTransports: ['subscription_http'],
      generationConfig: config({ prompt: '' }),
      onGenerate,
    });
    const requirement = container.querySelector('#generation-requirement');
    expect(requirement?.textContent).toBe('Add a prompt or image.');
    expect(container.querySelectorAll('#generation-requirement')).toHaveLength(1);
    const generate = screen.getByRole('button', { name: /generate 4 images/i });
    expect(generate.getAttribute('aria-disabled')).toBeNull();
    expect(generate).toHaveProperty('disabled', false);
    fireEvent.click(generate);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Prompt input' }));
    expect(container.querySelector('.create-prompt-error')?.textContent).toBe(
      'Add a prompt or image.',
    );
    expect(container.querySelectorAll('#generation-requirement')).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt input' }), {
      target: { value: 'A lantern with no style preset' },
    });
    fireEvent.click(generate);
    expect(onGenerate).toHaveBeenCalledWith(
      'A lantern with no style preset',
      { recipeId: null, codexTransport: 'subscription_http', imageSize: undefined, batchCount: 4 },
      { preventModal: true },
    );
  });

  it('groups provider and Codex execution in the same Create rail row', () => {
    const { container } = renderToolbar();
    const row = container.querySelector('.create-tool-provider-row');
    const provider = screen.getByRole('button', { name: /change provider/i });
    const execution = screen.getByRole('button', { name: /codex task execution/i });
    const generate = screen.getByRole('button', { name: /generate 4 images/i });

    expect(row?.contains(provider)).toBe(true);
    expect(row?.contains(execution)).toBe(true);
    expect(screen.queryByRole('button', { name: /generation model/i })).toBeNull();
    expect(
      provider.compareDocumentPosition(execution) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      execution.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container
        .querySelector('.create-tool-execution')
        ?.nextElementSibling?.querySelector('[data-studio-generate-button]'),
    ).toBe(generate);
    expect(generate.getAttribute('data-studio-generate-button')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Format: 1:1, Square' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aspect ratio: 1:1' })).toBeNull();
    expect(screen.getByText('Model')).toBeTruthy();
    expect(screen.getByText('5.4 Codex')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Landscape' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Toggle negative prompt' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Negative prompt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expand prompt editor' })).toBeNull();
    expect(screen.queryByText('Drop an image or paste it into the prompt.')).toBeNull();
    expect(screen.getByRole('button', { name: 'References' })).toBeTruthy();
    const output = container.querySelector('.create-output-grid');
    expect(output?.parentElement).toBe(container.querySelector('.create-tool-footer'));
    expect(output?.nextElementSibling).toBe(container.querySelector('.create-tool-execution'));
    expect(container.querySelector('.create-footer-meta')).toBeTruthy();
    expect(container.querySelector('.create-shortcut-hint')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Increase image count' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('toggles a single-row negative prompt and keeps its value', () => {
    const updateConfig = vi.fn();
    renderToolbar({ updateConfig });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle negative prompt' }));
    const input = screen.getByRole('textbox', { name: 'Negative prompt' });
    expect(input.tagName).toBe('INPUT');
    fireEvent.change(input, { target: { value: 'Blurry' } });
    expect(updateConfig).toHaveBeenCalledWith('negativePrompt', 'Blurry');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle negative prompt' }));
    expect(screen.queryByRole('textbox', { name: 'Negative prompt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add refine notes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add quality notes' })).toBeNull();
  });

  it('resolves a dragged original source only while its workspace remains active', async () => {
    const updateConfig = vi.fn();
    const view = renderToolbar({ updateConfig });
    const dropEvent = {
      dataTransfer: {
        types: ['application/x-cozy-catalog-image'],
        files: [],
        getData: () => 'image-42',
      },
    };
    fireEvent.drop(view.container.querySelector('[data-composer-input]')!, dropEvent);
    await waitFor(() =>
      expect(updateConfig).toHaveBeenCalledWith('attachments', [
        expect.objectContaining({
          localPath: 'X:/library/source.png',
          sourceUrl: expect.stringContaining('/library/source.png'),
        }),
      ]),
    );

    updateConfig.mockClear();
    const resolveEntry = vi.mocked(getCatalogImageDetail).getMockImplementation()!;
    let resolveDrop!: () => void;
    const pendingDrop = new Promise<void>((resolve) => {
      resolveDrop = resolve;
    });
    vi.mocked(getCatalogImageDetail).mockImplementationOnce(async (id) => {
      await pendingDrop;
      return resolveEntry(id);
    });
    fireEvent.drop(view.container.querySelector('[data-composer-input]')!, dropEvent);
    workspaceState.activeWorkspaceId = 'workspace-b';
    view.rerender(
      <Toolbar
        {...view.props}
        generationConfig={config({
          attachments: [
            { id: 'workspace-b-source', name: 'other.png', dataUrl: '/other.png', strength: 1 },
          ],
        })}
      />,
    );
    await act(async () => {
      resolveDrop();
      await pendingDrop;
    });
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('can remove a reference thumbnail from the Create rail', () => {
    const onRemoveAttachment = vi.fn();
    renderToolbar({
      onRemoveAttachment,
      generationConfig: config({
        attachments: [
          {
            id: 'ref-1',
            name: 'hero.png',
            dataUrl: 'data:image/png;base64,aaaa',
            strength: 1,
          },
        ],
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove hero.png' }));
    expect(onRemoveAttachment).toHaveBeenCalledWith('ref-1');
  });

  it('clamps Grok batch to 1 and restores prompt tools on the rail', () => {
    const updateConfig = vi.fn();
    const view = renderToolbar({
      activeProviderId: 'grok',
      grokCanExecute: true,
      generationConfig: config({ batchCount: 4 }),
      updateConfig,
    });

    expect(screen.getByRole('button', { name: 'Increase image count' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Decrease image count' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByRole('button', { name: 'Analyze references' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add refine notes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add quality notes' })).toBeNull();
    view.unmount();
    const draft: ReturnType<typeof useGenerationDraft> = {
      generationConfig: config({ batchCount: 4 }),
      setGenerationConfig: vi.fn(),
      setRecipeDraft: vi.fn(),
      isDraftReady: true,
      updateGenerationConfig: updateConfig,
      updateAttachment: vi.fn(),
      handleFileSelect: vi.fn(),
      handlePastedFiles: vi.fn(),
      handleRemoveAttachment: vi.fn(),
      handleAddToContext: vi.fn(),
      maxAttachments: 4,
      codexModelCatalog: null,
      isLoadingCodexModelCatalog: false,
      codexModelCatalogError: null,
    };
    vi.mocked(useGenerationDraft).mockReturnValue(draft);
    const dockProps: StudioGenerationDockProps = {
      isModalOpen: false,
      isUiChromeSuppressed: false,
      currentView: 'recipes',
      activeRecipe: null,
      isDragging: false,
      layout: 'rail',
      toolbarArgs: {
        actions: { onGenerate: vi.fn(), isGenerating: false, generationStartTime: null },
        ui: {
          setPreviewRatio: vi.fn(),
          setIsInteracting: vi.fn(),
          isKeyPopoverOpen: false,
          setIsKeyPopoverOpen: vi.fn(),
        },
        editor: { openEditor: vi.fn(), openEditorRoute: vi.fn() },
        sync: { verifyCodexSession: vi.fn() },
        provider: { activeProviderId: 'grok', grokCanExecute: true },
      },
    };
    const connected = render(<StudioGenerationDock {...dockProps} />);
    expect(updateConfig).toHaveBeenCalledWith('batchCount', 1);
    updateConfig.mockClear();
    // A provider change from any settings surface reaches the same draft owner.
    draft.generationConfig = config({ batchCount: 8 });
    const falProps = {
      ...dockProps,
      toolbarArgs: { ...dockProps.toolbarArgs, provider: { activeProviderId: 'fal' as const } },
    };
    connected.rerender(<StudioGenerationDock {...falProps} />);
    expect(updateConfig).toHaveBeenCalledWith('batchCount', 4);
    updateConfig.mockClear();
    // An externally restored draft is normalized even if the provider stays the same.
    draft.generationConfig = config({ batchCount: 9 });
    connected.rerender(<StudioGenerationDock {...falProps} railTools={<span />} />);
    expect(updateConfig).toHaveBeenCalledWith('batchCount', 4);
  });

  it('hides unreliable size controls while keeping ChatGPT model selection', () => {
    const updateConfig = vi.fn();
    renderToolbar({
      activeProviderId: 'chatgpt',
      codexTransport: 'subscription_http',
      codexAvailableTransports: ['codex_app_server', 'subscription_http'],
      generationConfig: config({
        aspectRatio: '16:9',
        imageSize: '1K',
        executionModel: 'gpt-5.5',
        executionReasoningEffort: 'provider_default',
        executionSpeed: 'standard',
        codexTransport: 'subscription_http',
      }),
      updateConfig,
    });

    expect(screen.queryByRole('button', { name: /Image size:/ })).toBeNull();
    expect(updateConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /chatgpt task execution/i }));
    expect(screen.queryByRole('heading', { name: 'Connection' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Text model' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Image model' })).toBeTruthy();
    expect(screen.getByText('Managed by ChatGPT')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reasoning: Managed' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'ChatGPT image size' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Output size' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close generation settings' }));
    expect(screen.queryByRole('dialog', { name: 'Image generation settings' })).toBeNull();
  });

  it('keeps a saved ChatGPT size and sends 1K to other providers', () => {
    const updateConfig = vi.fn();
    const onGenerate = vi.fn();
    renderToolbar({
      activeProviderId: 'grok',
      grokCanExecute: true,
      generationConfig: config({ imageSize: '4K', batchCount: 1 }),
      updateConfig,
      onGenerate,
    });
    fireEvent.click(screen.getByRole('button', { name: /generate 1 image/i }));
    expect(updateConfig).not.toHaveBeenCalledWith('imageSize', expect.anything());
    expect(onGenerate).toHaveBeenCalledWith(
      'A lantern',
      expect.objectContaining({ imageSize: '1K' }),
      { preventModal: true },
    );
  });

  it('hides ChatGPT size choices on Codex app-server', () => {
    renderToolbar({
      activeProviderId: 'codex',
      codexTransport: 'codex_app_server',
      codexAvailableTransports: ['codex_app_server', 'subscription_http'],
    });
    expect(screen.queryByRole('button', { name: 'Image size: 1K' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /codex task execution/i }));
    expect(screen.getByRole('heading', { name: 'Reasoning' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Speed' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Image model' })).toBeNull();
  });
});
