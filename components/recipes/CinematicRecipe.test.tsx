/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_GENERATION_CONFIG } from '../../constants';
import { CinematicRecipe } from './CinematicRecipe';

afterEach(cleanup);

it('edits the selected scene in Workflow and keeps selection valid after reducing the grid', () => {
  render(
    <CinematicRecipe
      config={DEFAULT_GENERATION_CONFIG}
      updateConfig={() => {}}
      updateAttachment={() => {}}
      onFileSelect={() => {}}
      onGenerate={() => {}}
      isGenerating={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select scene 9' }));
  expect(
    screen.getByRole('button', { name: 'Scene 9 shot' }).closest('.recipe-parameters'),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '3 Scenes' }));
  expect(screen.getByRole('button', { name: 'Select scene 3' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('button', { name: 'Scene 3 shot' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Scene 9 shot' })).toBeNull();
});
