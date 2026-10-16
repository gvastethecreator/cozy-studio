/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StyleRuntimePreset } from './styles/runtimeTypes';
import { StylePresetCard } from './StylePresetCardSurface';
import StyleDetailPreview from './StyleDetailPreview';
import { getStyleImageMetadata } from '../../services/studio-api/extensions';

vi.mock('../../contexts/GlobalContext', () => ({ useToastUi: () => ({ addToast: vi.fn() }) }));
vi.mock('../../services/studio-api/extensions', () => ({
  getStyleImageMetadata: vi.fn().mockResolvedValue({ prompt: 'Original example prompt' }),
}));

afterEach(cleanup);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

const PRESET: StyleRuntimePreset = {
  id: 'SP09-006',
  name: 'Polished Glass',
  category: '2. Man-Made Materials',
  style: {
    aesthetic: 'clean transparent studio material',
    subject_treatment: 'simple object silhouette',
    color_and_tone: 'cool mineral blues',
    lighting_and_shadow: 'softbox highlights',
    texture_and_material: 'polished glass caustics',
    camera_and_composition: 'centered product crop',
    atmosphere_and_mood: 'quiet inspection',
    rendering_and_quality: 'sharp commercial render',
  },
};

describe('StylePresetCard', () => {
  it('retains full-size examples for equivalent data and closes them when the style or sources change', async () => {
    const props = {
      preset: PRESET,
      selected: false,
      selectionDisabled: false,
      onApply: vi.fn(),
      onCopy: vi.fn(),
      onUsePrompt: vi.fn(),
      onClone: vi.fn(),
      onClose: vi.fn(),
    };
    const visualState = {
      presetPackName: 'Materials',
      defaultImage: '/style.webp',
      resultImages: [],
      defaultImageVariants: [],
      exampleImageSrc: null,
      previewImage: undefined,
    };
    vi.mocked(getStyleImageMetadata).mockClear();
    const { rerender } = render(
      <StyleDetailPreview {...props} visualState={{ ...visualState }} copied />,
    );
    await waitFor(() => expect(screen.getByText('Original example prompt')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Polished Glass example 1 at full size' }),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    rerender(<StyleDetailPreview {...props} visualState={{ ...visualState }} copied={false} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(getStyleImageMetadata).toHaveBeenCalledTimes(1);
    rerender(
      <StyleDetailPreview
        {...props}
        visualState={{ ...visualState, defaultImage: '/updated-style.webp' }}
        copied={false}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByText('Original example prompt')).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Polished Glass example 1 at full size' }),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    rerender(
      <StyleDetailPreview
        {...props}
        preset={{ ...PRESET, id: 'another-style' }}
        visualState={{ ...visualState, defaultImage: '/updated-style.webp' }}
        copied={false}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens details without changing the mix and preserves prompt actions', () => {
    const onApply = vi.fn();
    const onInspect = vi.fn();
    const onUsePrompt = vi.fn();
    const onCopy = vi.fn();
    render(
      <StylePresetCard
        preset={PRESET}
        packId="pack_09"
        visualState={{
          presetPackName: 'Texture & Materiality',
          resultImages: [],
          defaultImage: '/style.webp',
          defaultImageVariants: [{ src: '/style-grok.webp', label: 'Grok' }],
          previewImage: undefined,
          exampleImageSrc: null,
        }}
        active={false}
        selectionDisabled={false}
        copied={false}
        favorite={false}
        theme={{
          color: 'cyan',
          bg: 'bg-cyan-500',
          border: 'border-cyan-500/2',
          text: 'text-cyan-400',
        }}
        FadeImageComponent={(props) => <img {...props} />}
        onApply={onApply}
        onInspect={onInspect}
        onCopy={onCopy}
        onUsePrompt={onUsePrompt}
        onToggleFavorite={() => {}}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Select style Polished Glass' })[0]);
    expect(onApply).toHaveBeenCalledExactlyOnceWith(PRESET);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use as prompt' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onUsePrompt).toHaveBeenCalledExactlyOnceWith(PRESET);
    expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Information about Polished Glass' }));
    expect(onInspect).toHaveBeenCalledExactlyOnceWith(PRESET);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('keeps preview available but disables adding when all five slots are occupied', () => {
    const onApply = vi.fn();
    const onInspect = vi.fn();

    render(
      <StylePresetCard
        preset={PRESET}
        packId="pack_09"
        visualState={{
          presetPackName: 'Texture & Materiality',
          resultImages: [],
          defaultImage: '/style.webp',
          defaultImageVariants: [],
          previewImage: undefined,
          exampleImageSrc: null,
        }}
        active={false}
        selectionDisabled
        previewOnClick
        copied={false}
        favorite={false}
        theme={{
          color: 'cyan',
          bg: 'bg-cyan-500',
          border: 'border-cyan-500/2',
          text: 'text-cyan-400',
        }}
        FadeImageComponent={(props) => <img {...props} />}
        onApply={onApply}
        onInspect={onInspect}
        onCopy={() => {}}
        onToggleFavorite={() => {}}
      />,
    );

    const imageAction = screen.getByRole('button', { name: 'Information about Polished Glass' });
    const selectionActions = screen.getAllByRole('button', { name: 'Select style Polished Glass' });

    expect((imageAction as HTMLButtonElement).disabled).toBe(false);
    for (const action of selectionActions) {
      expect((action as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(action);
    }
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview style Polished Glass' }));
    expect(onInspect).toHaveBeenCalledExactlyOnceWith(PRESET);
    expect(onApply).not.toHaveBeenCalled();
  });
});
