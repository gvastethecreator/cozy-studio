/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEditableStudioSettings } from '../packages/shared/src';
import { StudioSettingsModal } from './StudioSettingsModal';
import {
  buildStudioSettingsPatch,
  EXTERNAL_SCAN_PATH_HELP,
  EXTERNAL_SCAN_PATH_LABEL,
  getStudioSettingsFormState,
  OUTPUT_SUBFOLDER_PRESETS,
} from '../lib/studioSettingsForm';

const theme = vi.hoisted(() => ({
  preferences: {},
  savedPreferences: {},
  previewPreferences: vi.fn(),
  commitPreferences: vi.fn(),
}));
vi.mock('../hooks/useTheme', () => ({ useTheme: () => theme }));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('explains blocked saving from every section and returns focus to the invalid filename', () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  render(
    React.createElement(StudioSettingsModal, {
      isOpen: true,
      settings: createDefaultEditableStudioSettings(),
      libraryDir: 'D:/Library',
      isLoading: false,
      isSaving: false,
      error: null,
      providerCapabilities: null,
      providerRuntimePreflight: null,
      outputSources: null,
      outputSourceFiles: {},
      isLoadingOutputSources: false,
      loadingOutputSourceFiles: {},
      isRegisteringOutputSource: false,
      importingOutputSources: {},
      onClose: vi.fn(),
      onRefresh: vi.fn(),
      onUpdate: vi.fn(),
      onExportLegacyWorkspaceSnapshot: vi.fn(),
      onRegisterOutputSource: vi.fn(),
      onLoadOutputSourceFiles: vi.fn(),
      onImportOutputSourceFiles: vi.fn(),
      maintenance: {
        audit: null,
        compactResult: null,
        thumbnailBackfillResult: null,
        toolingLogsPruneResult: null,
        isLoadingAudit: false,
        runningAction: null,
        refreshAudit: vi.fn(),
        compactStorage: vi.fn(),
        backfillThumbnails: vi.fn(),
        pruneToolingLogs: vi.fn(),
      },
      onResetStudio: vi.fn(),
      isResettingStudio: false,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Files & naming' }));
  fireEvent.change(screen.getByLabelText('File name template'), { target: { value: '{unknown}' } });
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  const error = screen.getByRole('alert').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Creation & startup' }));
  expect(screen.getByRole('status').textContent).toContain(error);
  expect(screen.getByRole('button', { name: 'Files & naming · Error' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fix filename template' }));
  expect(document.activeElement).toBe(screen.getByLabelText('File name template'));
  fireEvent.click(screen.getByRole('button', { name: 'Fix filename template' }));
  expect(document.activeElement).toBe(screen.getByLabelText('File name template'));
  fireEvent.change(screen.getByLabelText('File name template'), { target: { value: '{jobId}' } });
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('button', { name: 'Fix filename template' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Files & naming' })).toBeTruthy();
});

describe('StudioSettingsModal provider defaults', () => {
  it('round-trips editable provider defaults including nullable resets', () => {
    const settings = createDefaultEditableStudioSettings();
    settings.providerDefaults.codex = {
      providerId: 'codex',
      model: null,
      reasoningEffort: null,
      serviceTier: null,
    };

    settings.mcpAccess = 'write';
    settings.clearReviewJobsOnStartup = true;
    settings.toolsPanelSide = 'right';
    settings.jobsPanelSide = 'left';
    settings.defaultStyleIntensity = 0.4;
    settings.defaultStyleReferenceMode = 'reinterpret';
    const patch = buildStudioSettingsPatch(getStudioSettingsFormState(settings));

    expect(patch.mcpAccess).toBe('write');
    expect(patch.toolsPanelSide).toBe('right');
    expect(patch.jobsPanelSide).toBe('left');
    expect(patch.clearReviewJobsOnStartup).toBe(true);
    expect(patch.defaultStyleIntensity).toBe(0.4);
    expect(patch.defaultStyleReferenceMode).toBe('reinterpret');
    expect(patch.providerDefaults?.codex).toEqual(settings.providerDefaults.codex);
  });

  it('labels preferredOutputPath as an external scan folder, not generate destination', () => {
    expect(EXTERNAL_SCAN_PATH_LABEL).toBe('External folder to scan');
    expect(EXTERNAL_SCAN_PATH_HELP).toContain('import');
    expect(EXTERNAL_SCAN_PATH_HELP).toContain('does not change where new images are saved');
    expect(EXTERNAL_SCAN_PATH_LABEL.toLowerCase()).not.toContain('preferred output');

    const settingsSource = [
      'StudioSettingsModal.tsx',
      'settings/SettingsFormPanel.tsx',
      'settings/SettingsProvidersPanel.tsx',
    ]
      .map((file) => readFileSync(path.join(import.meta.dirname, file), 'utf8'))
      .join('\n');
    expect(settingsSource).toContain('EXTERNAL_SCAN_PATH_LABEL');
    expect(settingsSource).toContain('EXTERNAL_SCAN_PATH_HELP');
    expect(settingsSource).not.toMatch(/Preferred Output Path/);
    expect(settingsSource).toContain('STUDIO_SETTINGS_DOMAIN_TABS');
    expect(settingsSource).toContain('Accounts');
    expect(settingsSource).toContain('ProviderBrandMark');
    expect(settingsSource).toContain('type="radio"');
    expect(settingsSource).toContain('studio-dialog');
    expect(settingsSource).not.toMatch(/bg-zinc-950/);
    expect(
      readFileSync(path.join(import.meta.dirname, '..', 'lib', 'studioSettingsDomains.ts'), 'utf8'),
    ).toContain("label: 'Accounts & models'");
  });

  it('keeps a flat default output preset alongside date provider model and recipe', () => {
    expect(OUTPUT_SUBFOLDER_PRESETS[0]).toEqual({ label: 'None, all in one folder', value: [] });
    expect(OUTPUT_SUBFOLDER_PRESETS.map((preset) => preset.value)).toContainEqual([
      'date',
      'provider',
      'recipe',
    ]);
    expect(OUTPUT_SUBFOLDER_PRESETS.map((preset) => preset.value)).toContainEqual([
      'date',
      'model',
      'recipe',
    ]);
  });

  it('does not offer a second generate output folder during onboarding', () => {
    const onboardingSource = readFileSync(
      path.join(import.meta.dirname, 'OnboardingModal.tsx'),
      'utf8',
    );
    expect(onboardingSource).not.toMatch(/preferredOutputPath/);
    expect(onboardingSource).not.toMatch(/Preferred Output Path/);
    expect(onboardingSource).not.toMatch(/External folder to scan/);
  });
});
