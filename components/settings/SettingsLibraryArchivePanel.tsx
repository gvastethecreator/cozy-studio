import { useRef, useState } from 'react';
import { useToastUi, useWorkspaceState } from '../../contexts/GlobalContext';
import { LIBRARY_ARCHIVE_MAX_BYTES } from '../../packages/shared/src/libraryArchive';
import { exportLibraryArchive, importLibraryArchive } from '../../services/studio-api/workspaces';
import { downloadBlob } from '../../utils/fileUtils';

export function SettingsLibraryArchivePanel() {
  const { activeWorkspaceId, createWorkspace } = useWorkspaceState();
  const { addToast } = useToastUi();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const reportError = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Library archive failed.';
    setStatus(message);
    addToast(message, 'error');
  };
  const exportWorkspace = async () => {
    setBusy(true);
    setStatus('Preparing archive…');
    try {
      const result = await exportLibraryArchive(activeWorkspaceId);
      downloadBlob(result.blob, result.filename);
      const message = `Archive downloaded: ${result.images} images.${result.missing ? ` ${result.missing} images were missing on disk and are listed in the archive.` : ''}`;
      setStatus(message);
      addToast(message, result.missing ? 'warning' : 'success');
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  const importWorkspace = async (file: File) => {
    setBusy(true);
    setStatus('Importing archive…');
    try {
      if (file.size > LIBRARY_ARCHIVE_MAX_BYTES) throw new Error('Choose an archive up to 1 GiB.');
      const result = await importLibraryArchive(file);
      createWorkspace(
        {
          id: result.workspace.id,
          name: result.workspace.name,
          createdAt: Date.parse(result.workspace.createdAt),
        },
        { activate: true },
      );
      const message = `Imported ${result.imported} images into "${result.workspace.name}".${result.skipped.length ? ` ${result.skipped.length} files skipped: ${result.skipped.map((item) => `${item.file} (${item.reason})`).join(', ')}` : ''}${result.missing.length ? ` ${result.missing.length} images were missing from the exported Library.` : ''}`;
      setStatus(message);
      addToast(
        `Imported ${result.imported} images into "${result.workspace.name}".`,
        result.skipped.length || result.missing.length ? 'warning' : 'success',
      );
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-disclosure mt-4" aria-labelledby="library-archive-heading">
      <h3 id="library-archive-heading" className="font-medium">
        Library archive
      </h3>
      <p className="my-2 text-xs studio-muted">
        Export this workspace with its original images, tags and collections. Import creates a new
        workspace. Up to 1 GiB.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="studio-ghost-control px-3"
          disabled={busy}
          onClick={() => void exportWorkspace()}
          aria-label="Export this workspace"
        >
          Export this workspace
        </button>
        <button
          type="button"
          className="studio-ghost-control px-3"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          Import a Library archive
        </button>
        <input
          ref={picker}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          aria-label="Library archive ZIP"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importWorkspace(file);
          }}
        />
      </div>
      <p role="status" aria-live="polite" className="mt-2 break-words text-xs studio-muted">
        {status}
      </p>
    </section>
  );
}
