/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GsapDropdown } from './GsapDropdown';

afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

describe('GsapDropdown Workbench Ambient', () => {
  it('focuses a dialog field after opening and restores the trigger on Escape', async () => {
    function DisplayOptions() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button ref={triggerRef} onClick={() => setOpen(true)}>
            Display options
          </button>
          <GsapDropdown
            open={open}
            onOpenChange={setOpen}
            triggerRef={triggerRef}
            role="dialog"
            portal
          >
            <select aria-label="Sort">
              <option>Source</option>
            </select>
          </GsapDropdown>
        </>
      );
    }
    render(<DisplayOptions />);
    const trigger = screen.getByRole('button', { name: 'Display options' });
    fireEvent.click(trigger);
    const field = screen.getByRole('combobox', { name: 'Sort' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Carbon scope and makes a closing menu inert until it reopens', async () => {
    const { container, rerender } = render(
      <GsapDropdown open onOpenChange={() => undefined}>
        Item
      </GsapDropdown>,
    );
    const menu = container.querySelector('[data-gsap-dropdown]');
    expect(menu?.className).toContain('wb-ambient');
    expect(menu?.className).toContain('wbp-system');
    expect(menu?.className).toContain('studio-popover');
    expect(menu?.getAttribute('data-theme')).toBe('carbon');
    expect(menu?.getAttribute('data-density')).toBe('comfortable');
    expect(menu?.getAttribute('data-wbp-density')).toBe('comfortable');
    rerender(<GsapDropdown open={false}>Item</GsapDropdown>);
    expect(menu?.hasAttribute('inert')).toBe(true);
    expect(menu?.getAttribute('aria-hidden')).toBe('true');
    rerender(<GsapDropdown open>Item</GsapDropdown>);
    await waitFor(() => expect((menu as HTMLElement).style.opacity).toBe('1'));
    expect(menu?.hasAttribute('inert')).toBe(false);
    expect(container.querySelector('[data-gsap-dropdown]')).toBe(menu);

    document.documentElement.dataset.motion = 'reduced';
    try {
      rerender(<GsapDropdown open={false}>Item</GsapDropdown>);
      expect(container.querySelector('[data-gsap-dropdown]')).toBeNull();
      rerender(<GsapDropdown open>Item</GsapDropdown>);
      expect((container.querySelector('[data-gsap-dropdown]') as HTMLElement).style.opacity).toBe(
        '1',
      );
    } finally {
      delete document.documentElement.dataset.motion;
    }
  });

  it('keeps keyboard focus in the options, then returns it when the menu closes', async () => {
    function Menu() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <div style={{ clipPath: 'inset(0)' }}>
          <button ref={triggerRef} aria-expanded={open} onClick={() => setOpen(!open)}>
            Choose format
          </button>
          <GsapDropdown
            open={open}
            onOpenChange={setOpen}
            triggerRef={triggerRef}
            role="listbox"
            portal
          >
            <button role="option" aria-selected={false}>
              Square
            </button>
            <button role="option" aria-selected={true}>
              Portrait
            </button>
            <button role="option" aria-selected={false} onClick={() => setOpen(false)}>
              Landscape
            </button>
          </GsapDropdown>
        </div>
      );
    }
    const { container } = render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Choose format' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Portrait' })),
    );
    expect(container.contains(screen.getByRole('listbox'))).toBe(false);
    expect(screen.getByRole('listbox').parentElement).toBe(document.body);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Landscape' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Square' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Portrait' })),
    );
    fireEvent.click(screen.getByRole('option', { name: 'Landscape' }));
    expect(document.activeElement).toBe(trigger);
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    const lastOption = await screen.findByRole('option', { name: 'Landscape' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(lastOption);
    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
