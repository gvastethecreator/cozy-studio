import React from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useT } from '../lib/i18n';
import type { GeneratedImage } from '../types';
import { ImageTagsEditor } from './ImageTagsEditor';
import { ImageCollectionsEditor } from './ImageCollectionsEditor';

export function ImageOrganizationDialog({
  images,
  workspaceId,
  onClose,
  onSaved,
}: {
  images: GeneratedImage[];
  workspaceId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useT();
  const dialogRef = useDialogFocus(true, onClose, undefined, 'input');
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={t('library.picker.heading')}
      className="studio-modal fixed inset-0 z-110 flex items-center justify-center p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="studio-scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="studio-dialog relative max-h-[85vh] w-full max-w-md overflow-y-auto p-5">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t('library.picker.heading')}</h2>
            <p className="mt-1 text-xs text-[color:var(--wb-muted)]">
              {images.length === 1
                ? t('library.picker.organizeOne')
                : t('library.picker.organizeMany', { count: String(images.length) })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('library.picker.close')}
            className="studio-ghost-control rounded px-2 py-1"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="space-y-5">
          <ImageTagsEditor images={images} workspaceId={workspaceId} onSaved={onSaved} />
          <ImageCollectionsEditor
            workspaceId={workspaceId}
            imageIds={images.map((image) => image.id)}
            onSaved={onSaved}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="studio-ghost-control mt-5 w-full rounded border border-[color:var(--wb-line)] px-3 py-2 text-xs"
        >
          {t('library.picker.done')}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
