/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UserStyleEditorSurface } from './UserStyleEditorSurface';
import { createEmptyUserStyleDraft } from './userStyleDraftBuilders';
import { createUserStylePreset } from '../../services/studio-api/userStyles';

vi.mock('../../services/studio-api/userStyles', () => ({
  createUserStylePreset: vi.fn(async (input) => ({ ...input, id: 'saved-style' })),
  updateUserStylePreset: vi.fn(),
  archiveUserStylePreset: vi.fn(),
  duplicateUserStylePreset: vi.fn(),
  draftUserStylePreset: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps edits across sections, previews DNA and saves the complete custom style', async () => {
  const onSaved = vi.fn();
  render(
    <UserStyleEditorSurface
      sessionId={1}
      mode="create"
      initialDraft={createEmptyUserStyleDraft()}
      initialSource={null}
      onClose={() => {}}
      onSaved={onSaved}
      onArchived={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Midnight Ink' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Visual DNA' }));
  fireEvent.change(screen.getByLabelText('Aesthetic'), { target: { value: 'Bold black ink' } });
  expect(screen.getByLabelText('Style draft preview').textContent).toContain('Bold black ink');
  for (const [key, label] of [
    ['ArrowRight', 'References'],
    ['ArrowLeft', 'Visual DNA'],
    ['End', 'Assistant'],
    ['ArrowRight', 'Identity'],
    ['ArrowLeft', 'Assistant'],
    ['Home', 'Identity'],
  ]) {
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key });
    const tab = screen.getByRole('tab', { name: label });
    expect(document.activeElement).toBe(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab').filter((item) => item.tabIndex === 0)).toEqual([tab]);
  }
  expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Midnight Ink');
  fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(createUserStylePreset).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Midnight Ink',
      visualDna: expect.objectContaining({ aesthetic: 'Bold black ink' }),
    }),
  );
});

it('isolates the editor from shell controls and releases the modal lock on close', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  const onClose = vi.fn();
  const previousOverflow = document.body.style.overflow;
  const { unmount } = render(
    <div>
      <header aria-label="Studio toolbar">
        <button type="button">Open Library</button>
      </header>
      <main>
        <UserStyleEditorSurface
          sessionId={1}
          mode="create"
          initialDraft={createEmptyUserStyleDraft()}
          initialSource={null}
          onClose={onClose}
          onSaved={() => {}}
          onArchived={() => {}}
        />
      </main>
      <footer aria-label="Studio status">Studio status</footer>
    </div>,
  );
  const header = screen.getByRole('banner', { name: 'Studio toolbar' });
  const footer = screen.getByRole('contentinfo', { name: 'Studio status' });
  expect(header.inert).toBe(true);
  expect(footer.inert).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close style editor' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
  expect(header.inert).toBeFalsy();
  expect(footer.inert).toBeFalsy();
  expect(document.body.style.overflow).toBe(previousOverflow);
});
