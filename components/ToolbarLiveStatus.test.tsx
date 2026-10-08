/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationElapsedStatus, LivePromptTextarea } from './ToolbarLiveStatus';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ToolbarLiveStatus', () => {
  it('grows and shrinks the rail prompt within its bounds, including after a width change', () => {
    let resize: () => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const textareaRef = React.createRef<HTMLTextAreaElement>();
    let height = 80;
    let width = 280;
    const scroll = vi
      .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(() => height);
    const client = vi
      .spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get')
      .mockImplementation(() => width);
    const props = {
      textareaRef,
      prompt: '',
      variant: 'rail' as const,
      isScrambling: false,
      isHidden: false,
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onChange: vi.fn(),
      onKeyDown: vi.fn(),
      onPaste: vi.fn(),
      onDrop: vi.fn(),
      onDragOver: vi.fn(),
    };
    const { rerender } = render(<LivePromptTextarea {...props} />);
    expect(textareaRef.current?.style.height).toBe('192px');
    height = 250;
    rerender(<LivePromptTextarea {...props} prompt="A longer prompt" />);
    expect(textareaRef.current?.style.height).toBe('250px');
    height = 480;
    width = 200;
    act(() => resize());
    expect(textareaRef.current?.style.height).toBe('320px');
    height = 80;
    rerender(<LivePromptTextarea {...props} />);
    expect(textareaRef.current?.style.height).toBe('192px');
    scroll.mockRestore();
    client.mockRestore();
  });
  it('updates elapsed generation time without rerendering its parent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    let parentRenders = 0;

    function Harness() {
      parentRenders += 1;
      return <GenerationElapsedStatus startTime={Date.now()} />;
    }

    render(<Harness />);
    expect(parentRenders).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(screen.getByText('0.3s')).toBeTruthy();
    expect(parentRenders).toBe(1);
  });

  it('updates scramble feedback without rerendering its parent', async () => {
    vi.useFakeTimers();
    let parentRenders = 0;
    const textareaRef = React.createRef<HTMLTextAreaElement>();

    function Harness() {
      parentRenders += 1;
      return (
        <LivePromptTextarea
          textareaRef={textareaRef}
          prompt="alpha beta"
          isScrambling
          isHidden={false}
          onFocus={() => {}}
          onBlur={() => {}}
          onChange={() => {}}
          onKeyDown={() => {}}
          onPaste={() => {}}
          onDrop={() => {}}
          onDragOver={() => {}}
        />
      );
    }

    render(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(90));

    expect(screen.getByRole('textbox', { name: 'Prompt input' })).toHaveProperty(
      'value',
      expect.stringMatching(/^\S{5} \S{4}$/),
    );
    expect(parentRenders).toBe(1);
  });
});
