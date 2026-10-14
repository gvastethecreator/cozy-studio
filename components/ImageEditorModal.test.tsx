/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageEditorModal, type ImageEditorDraft } from './ImageEditorModal';
import { StudioImageOverlays } from './overlays/StudioImageOverlays';
import { useStudioViewState } from '../hooks/useStudioViewState';

const draftScope = vi.hoisted(() => ({ key: 'workspace-a:studio' }));
vi.mock('../contexts/GenerationContext', () => ({
  useGenerationDraft: () => ({ draftScopeKey: draftScope.key, generationConfig: {} }),
}));
vi.mock('../contexts/GlobalContext', () => ({ useToastUi: () => ({ addToast: vi.fn() }) }));
vi.mock('./ImageCarousel', () => ({ default: () => null }));
vi.mock('./create/OutputBackgroundControl', () => ({ OutputBackgroundControl: () => null }));
vi.mock('../lib/gsapMotion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('image editor draft', () => {
  it('retains drafts after the whole overlay unmounts and isolates workspace and image keys', async () => {
    draftScope.key = 'workspace-a:studio';
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 20;
        naturalHeight = 10;
        onload: (() => void) | null = null;
        set src(_value: string) {
          this.onload?.();
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const source = {
      id: 'source',
      name: 'source.png',
      dataUrl: '/library/source.png',
      strength: 1,
    };
    const other = { ...source, id: 'other', name: 'other.png', dataUrl: '/library/other.png' };
    function Shell() {
      const owner = useStudioViewState({ closeOverlay: () => {} });
      return (
        <>
          <button onClick={() => owner.editor.open(source, () => {})}>Open source</button>
          <button onClick={() => owner.editor.open(other, () => {})}>Open other</button>
          {owner.editor.isOpen && (
            <StudioImageOverlays
              providerId="codex"
              modalImage={null}
              imagesWithConfig={[]}
              activeGenerationConfig={null}
              closeModal={() => {}}
              handleDelete={() => {}}
              handleGenerate={() => {}}
              handleAddToContext={() => {}}
              handleLoadRecipe={async () => true}
              handleToggleFavorite={() => {}}
              setActiveCarouselId={() => {}}
              isEditorOpen
              closeEditor={owner.editor.close}
              imageToEdit={owner.editor.image}
              editorDrafts={owner.editor.drafts}
              handleExecuteEdit={async () => {}}
              isEditingImage={false}
            />
          )}
        </>
      );
    }
    const view = render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));
    const prompt = await screen.findByRole('textbox', { name: 'Edit prompt' });
    fireEvent.change(prompt, { target: { value: 'source A draft' } });
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open other' }));
    expect(
      ((await screen.findByRole('textbox', { name: 'Edit prompt' })) as HTMLTextAreaElement).value,
    ).toBe('');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'other A draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close image editor' }));
    draftScope.key = 'workspace-b:studio';
    view.rerender(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));
    expect(
      ((await screen.findByRole('textbox', { name: 'Edit prompt' })) as HTMLTextAreaElement).value,
    ).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Close image editor' }));

    draftScope.key = 'workspace-a:studio';
    view.rerender(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));
    expect(
      ((await screen.findByRole('textbox', { name: 'Edit prompt' })) as HTMLTextAreaElement).value,
    ).toBe('source A draft');
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open other' }));
    expect(
      ((await screen.findByRole('textbox', { name: 'Edit prompt' })) as HTMLTextAreaElement).value,
    ).toBe('other A draft');
  });

  it('keeps instruction and mask on dialog cancellation and explicitly discards the draft', () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 20;
        naturalHeight = 10;
        onload: (() => void) | null = null;
        set src(_value: string) {
          this.onload?.();
        }
      },
    );
    const mask = { width: 20, height: 10, data: new Uint8ClampedArray(800) } as ImageData;
    const ctx = {
      getImageData: vi.fn(() => mask),
      putImageData: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
    let draft: ImageEditorDraft | undefined;
    const onDraftChange = (next: ImageEditorDraft | null) => {
      draft = next ?? undefined;
    };
    const props = {
      isOpen: true,
      onClose: vi.fn(),
      image: { id: 'source', name: 'source.png', dataUrl: '/library/source.png', strength: 1 },
      onGenerate: vi.fn(),
      isGenerating: false,
      onDraftChange,
    };
    const first = render(<ImageEditorModal {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit prompt' }), {
      target: { value: 'keep this edit' },
    });
    const canvas = first.container.querySelector('canvas')!;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(draft?.mask).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(draft?.mask).toBe(mask);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(draft?.prompt).toBe('keep this edit');
    expect(draft?.mask).toBe(mask);
    first.unmount();
    render(<ImageEditorModal {...props} draft={draft} />);
    expect(
      (screen.getByRole('textbox', { name: 'Edit prompt' }) as HTMLTextAreaElement).value,
    ).toBe('keep this edit');
    expect(ctx.putImageData).toHaveBeenCalledWith(mask, 0, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(draft).toBeUndefined();
  });
});
