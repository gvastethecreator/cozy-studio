/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { STUDIO_SETTINGS_DOMAIN_TABS } from '../lib/studioSettingsDomains';
import { setLanguage, t } from '../lib/i18n';
import { findCatalogDuplicates } from '../services/studio-api/maintenance';
import { archiveCatalogByFilter } from '../services/studio-api/catalog';
import { importLibraryArchive } from '../services/studio-api/workspaces';

const workspaceState = vi.hoisted(() => ({
  activeWorkspaceId: 'default',
  workspaces: [{ id: 'default', name: 'Test workspace' }],
  createWorkspace: vi.fn(),
  adoptWorkspace: vi.fn(),
}));
vi.mock('../services/studio-api/workspaces', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  importLibraryArchive: vi.fn(),
}));
vi.mock('../contexts/WorkspaceContext', () => ({ useWorkspaceState: () => workspaceState }));
vi.mock('../services/studio-api/maintenance', () => ({ findCatalogDuplicates: vi.fn() }));
vi.mock('../services/studio-api/catalog', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  archiveCatalogByFilter: vi.fn(),
}));

const theme = vi.hoisted(() => ({
  preferences: {},
  savedPreferences: {},
  previewPreferences: vi.fn(),
  commitPreferences: vi.fn(),
}));
vi.mock('../hooks/useTheme', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTheme: () => theme,
}));
vi.mock('../contexts/GlobalContext', () => ({
  useWorkspaceState: () => workspaceState,
  useToastUi: () => ({ addToast: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  setLanguage('en');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  workspaceState.activeWorkspaceId = 'default';
  workspaceState.workspaces = [{ id: 'default', name: 'Test workspace' }];
  workspaceState.createWorkspace.mockClear();
  workspaceState.adoptWorkspace.mockClear();
  vi.mocked(importLibraryArchive).mockReset();
});

function renderSettingsModal(
  overrides: Partial<React.ComponentProps<typeof StudioSettingsModal>> = {},
) {
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
      ...overrides,
    }),
  );
}

it('finds Spanish settings and focuses maintenance and Library archive controls', () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  setLanguage('es');
  renderSettingsModal();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar ajustes' }), {
    target: { value: 'almacenamiento' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Auditoría de almacenamiento/ }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: t('settings.maintenance.audit') }),
  );
  expect(screen.getByRole('searchbox', { name: 'Buscar ajustes' })).toHaveProperty('value', '');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar ajustes' }), {
    target: { value: 'archivo de biblioteca' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Archivo de Biblioteca/ }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Export this workspace' }),
  );
});

it('explains blocked saving from every section and returns focus to the invalid filename', () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  renderSettingsModal();
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
  it('keeps favorites by default, requires a keeper and reports actual archive results after rescanning', async () => {
    const images = ['keeper', 'favorite', 'copy', 'locked'].map((id) => ({
      id,
      thumbnailUrl: null,
      publicUrl: `/library/${id}.png`,
      createdAt: '2026-01-01',
      isFavorite: id === 'keeper' || id === 'favorite',
      recipeId: 'default',
      width: 256,
      height: 256,
      fileSizeBytes: 100,
    }));
    vi.mocked(findCatalogDuplicates)
      .mockResolvedValueOnce({
        hashedNow: 4,
        pending: 0,
        checked: 4,
        total: 4,
        skipped: 0,
        groups: [{ keeperId: 'keeper', images }],
      })
      .mockResolvedValueOnce({
        hashedNow: 0,
        pending: 0,
        checked: 3,
        total: 3,
        skipped: 0,
        groups: [{ keeperId: 'keeper', images: images.filter((image) => image.id !== 'copy') }],
      });
    vi.mocked(archiveCatalogByFilter).mockResolvedValueOnce({
      ok: true,
      action: 'archive',
      matchedCount: 2,
      changedCount: 1,
      failed: [{ id: 'locked', reason: 'operation_failed', message: 'File is locked' }],
    });
    renderSettingsModal();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced & maintenance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Find duplicates in Test workspace' }));
    await screen.findByText('Checked 4 of 4 images');
    expect(
      (screen.getByRole('checkbox', { name: 'Archive image keeper' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole('checkbox', { name: 'Archive image favorite' }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (screen.getByRole('checkbox', { name: 'Archive image copy' }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Archive image keeper' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Archive image favorite' }));
    expect(screen.getByText('Keep at least one image in each group.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Move 4 to Archived Images' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Archive image keeper' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Archive image favorite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 to Archived Images' }));
    expect(archiveCatalogByFilter).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('dialog', { name: 'Move 2 to Archived Images' });
    expect(confirmation.textContent).toContain('restored from Archived Images');
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Move 2 to Archived Images' }),
    );
    await waitFor(() =>
      expect(archiveCatalogByFilter).toHaveBeenCalledWith({
        ids: ['copy', 'locked'],
        workspaceId: 'default',
      }),
    );
    await screen.findByText('Checked 3 of 3 images');
    expect(screen.getByText('Moved 1 to Archived Images.')).toBeTruthy();
    expect(screen.getByText('locked: File is locked')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Archive image copy' })).toBeNull();
    expect(findCatalogDuplicates).toHaveBeenCalledTimes(2);
  });

  it('round-trips editable provider defaults including nullable resets', () => {
    const settings = createDefaultEditableStudioSettings();
    settings.providerDefaults.codex = {
      providerId: 'codex',
      model: null,
      reasoningEffort: null,
      serviceTier: null,
    };

    settings.mcpAccess = 'write';
    settings.mcpAllowedImportRoots = ['C:/References', 'D:/Art'];
    settings.clearReviewJobsOnStartup = true;
    settings.toolsPanelSide = 'right';
    settings.jobsPanelSide = 'left';
    settings.defaultStyleIntensity = 0.4;
    settings.defaultStyleReferenceMode = 'reinterpret';
    const patch = buildStudioSettingsPatch(getStudioSettingsFormState(settings));

    expect(patch.mcpAccess).toBe('write');
    expect(patch.mcpAllowedImportRoots).toEqual(settings.mcpAllowedImportRoots);
    expect(
      buildStudioSettingsPatch({
        ...getStudioSettingsFormState(settings),
        mcpAllowedImportRoots: '',
      }).mcpAllowedImportRoots,
    ).toEqual([]);
    expect(patch.toolsPanelSide).toBe('right');
    expect(patch.jobsPanelSide).toBe('left');
    expect(patch.clearReviewJobsOnStartup).toBe(true);
    expect(patch.defaultStyleIntensity).toBe(0.4);
    expect(patch.defaultStyleReferenceMode).toBe('reinterpret');
    expect(patch.providerDefaults?.codex).toEqual(settings.providerDefaults.codex);
  });

  it('keeps imports in the shown workspace and adopts an archive workspace without creating it again', async () => {
    expect(EXTERNAL_SCAN_PATH_LABEL).toBe('External folder to scan');
    expect(EXTERNAL_SCAN_PATH_HELP).toContain('import');
    expect(EXTERNAL_SCAN_PATH_HELP).toContain('does not change where new images are saved');
    expect(EXTERNAL_SCAN_PATH_LABEL.toLowerCase()).not.toContain('preferred output');

    workspaceState.activeWorkspaceId = 'current';
    workspaceState.workspaces.push({ id: 'current', name: 'Current workspace' });
    const importFiles = vi.fn();
    renderSettingsModal({
      outputSources: {
        registry: {
          schemaVersion: 'external-output-sources/v1',
          sources: [
            {
              id: 'source',
              label: 'External',
              path: 'D:/External',
              providerId: null,
              status: 'registered',
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
        candidates: [],
      },
      outputSourceFiles: {
        source: [
          {
            relativePath: 'image.png',
            fileName: 'image.png',
            sizeBytes: 1,
            modifiedAt: null,
            mimeType: 'image/png',
          },
        ],
      },
      onImportOutputSourceFiles: importFiles,
    });
    expect(document.querySelector('.studio-dialog')).not.toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(STUDIO_SETTINGS_DOMAIN_TABS.map((tab) => t(tab.labelKey)));
    // Tags and Styles panels need the workspace provider and live in their own files.
    for (const tab of STUDIO_SETTINGS_DOMAIN_TABS.filter(
      ({ id }) => id !== 'organization' && id !== 'extensions',
    )) {
      fireEvent.click(screen.getByRole('button', { name: t(tab.labelKey) }));
      expect(document.body.textContent).not.toContain('Preferred Output Path');
      expect(document.querySelector('[class*="bg-zinc-950"]')).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Data folder & imports' }));
    expect(screen.getByLabelText(EXTERNAL_SCAN_PATH_LABEL)).toBeTruthy();
    expect(screen.getByText(EXTERNAL_SCAN_PATH_HELP)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export this workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import a Library archive' })).toBeTruthy();
    expect(
      screen.getByText('Selected images will be imported into "Current workspace".'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select image.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1' }));
    expect(importFiles).toHaveBeenCalledWith('source', ['image.png'], 'current');
    vi.mocked(importLibraryArchive).mockResolvedValueOnce({
      workspace: {
        id: 'restored',
        name: 'Restored',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        filter: {},
        sortOrder: 'newest',
      },
      imported: 1,
      skipped: [],
      missing: [],
    });
    fireEvent.change(screen.getByLabelText('Library archive ZIP'), {
      target: { files: [new File(['fixture'], 'library.zip', { type: 'application/zip' })] },
    });
    await waitFor(() =>
      expect(workspaceState.adoptWorkspace).toHaveBeenCalledWith(
        { id: 'restored', name: 'Restored', createdAt: Date.parse('2026-01-01T00:00:00.000Z') },
        { activate: true },
      ),
    );
    expect(workspaceState.createWorkspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Accounts & models' }));
    const radios = within(screen.getByRole('group', { name: 'Default provider' })).getAllByRole(
      'radio',
    );
    expect(radios.length).toBeGreaterThan(1);
    // Each option shows its decorative provider brand mark.
    for (const radio of radios)
      expect(radio.closest('label')?.querySelector('[aria-hidden="true"]')).not.toBeNull();
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
});
