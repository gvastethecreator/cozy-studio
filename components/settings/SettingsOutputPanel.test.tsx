/** @vitest-environment jsdom */
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createInitialStudioSettingsFormState } from '../../lib/studioSettingsForm';
import { SettingsOutputPanel } from './SettingsOutputPanel';

afterEach(cleanup);

it('opens custom editors without changing saved values and exposes invalid filenames', () => {
  function Settings() {
    const [value, onChange] = useState(createInitialStudioSettingsFormState);
    return <SettingsOutputPanel value={value} onChange={onChange} libraryDir="D:/Library" />;
  }
  render(<Settings />);
  const filename = screen.getByRole('textbox', {
    name: 'File name template',
    hidden: true,
  }) as HTMLInputElement;
  const initialName = filename.value;
  expect(filename.closest('details')?.open).toBe(false);
  fireEvent.change(screen.getByLabelText('Filename preset'), { target: { value: 'custom' } });
  expect(filename.closest('details')?.open).toBe(true);
  expect(filename.value).toBe(initialName);
  fireEvent.change(screen.getByLabelText('Output folder preset'), { target: { value: 'custom' } });
  expect(screen.getByLabelText('Folder levels').closest('details')?.open).toBe(true);
  fireEvent.change(filename, { target: { value: '{unknown}' } });
  expect(filename.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('alert').textContent).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filename preset'), { target: { value: '{jobId}' } });
  expect(filename.value).toBe('{jobId}');
  expect(filename.closest('details')?.open).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});
