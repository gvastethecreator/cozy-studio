/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Tooltip, { ControlTooltips } from './Tooltip';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('lets Escape reach an open overlay when either kind of tooltip is visible', () => {
  const closeOverlay = vi.fn();
  document.addEventListener('keydown', closeOverlay);
  try {
    render(
      <>
        <ControlTooltips />
        <button aria-label="Settings">Settings</button>
        <Tooltip content="Help">
          <button>Help control</button>
        </Tooltip>
      </>,
    );

    const settings = screen.getByRole('button', { name: 'Settings' });
    fireEvent.focusIn(settings);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    const settingsEscape = fireEvent.keyDown(settings, { key: 'Escape' });
    expect(settingsEscape).toBe(true);
    expect(closeOverlay).toHaveBeenCalledTimes(1);

    const help = screen.getByRole('button', { name: 'Help control' });
    fireEvent.focus(help);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    const helpEscape = fireEvent.keyDown(help, { key: 'Escape' });
    expect(helpEscape).toBe(true);
    expect(closeOverlay).toHaveBeenCalledTimes(2);
  } finally {
    document.removeEventListener('keydown', closeOverlay);
  }
});

it('delays hover help, keeps it stable across child icons and cancels a pending reveal', () => {
  render(
    <>
      <ControlTooltips />
      <button aria-label="Settings">
        <span data-testid="icon">Icon</span>
      </button>
      <Tooltip content="Help">
        <button>Help control</button>
      </Tooltip>
    </>,
  );
  const settings = screen.getByRole('button', { name: 'Settings' });
  const icon = screen.getByTestId('icon');
  fireEvent.pointerOver(settings);
  act(() => {
    vi.advanceTimersByTime(299);
  });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.pointerOut(settings, { relatedTarget: icon });
  fireEvent.pointerOver(icon);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByRole('tooltip').textContent).toBe('Settings');
  expect(settings.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  fireEvent.pointerOut(icon);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(settings.hasAttribute('aria-describedby')).toBe(false);
  const help = screen.getByRole('button', { name: 'Help control' });
  fireEvent.pointerEnter(help.parentElement!);
  act(() => {
    vi.advanceTimersByTime(200);
  });
  fireEvent.keyDown(help, { key: 'Escape' });
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.queryByRole('tooltip')).toBeNull();
});
