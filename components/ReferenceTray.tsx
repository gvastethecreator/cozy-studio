import React, { useState } from 'react';
import { EditPencil as Pencil, Refresh, Xmark as X } from 'iconoir-react';
import type { Attachment } from '../types';

export function ReferenceTray({
  attachments,
  onEdit,
  onRemove,
  onFiles,
  density = 'default',
  persistenceErrors,
  onRetryPersistence,
}: {
  attachments: Attachment[];
  onEdit: (attachment: Attachment) => void;
  onRemove: (id: string) => void;
  onFiles: (files: File[], replaceId?: string) => void;
  density?: 'default' | 'compact' | 'thumbs';
  persistenceErrors?: Record<string, string>;
  onRetryPersistence?: (id: string) => Promise<void>;
}) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const isCompact = density === 'compact';
  const isThumbs = density === 'thumbs';
  return (
    <div className="min-w-0 max-w-full">
      <div className="reference-tray" aria-label="Image references">
        {attachments.map((attachment, index) => {
          const roleLabel = index === 0 ? 'Source image' : `Detail reference ${index}`;
          const statusLabel = attachment.isProcessing
            ? 'Uploading…'
            : failed.has(attachment.id)
              ? 'Preview unavailable · replace this image'
              : roleLabel;
          return (
            <div
              className={`reference-item${isThumbs ? ' is-thumb' : ''}`}
              key={attachment.id}
              data-tooltip={`${attachment.name} · ${statusLabel}`}
            >
              <button
                type="button"
                className="reference-item-preview"
                onClick={() => onEdit(attachment)}
                disabled={attachment.isProcessing}
                aria-label={`Edit ${attachment.name}`}
              >
                <img
                  src={attachment.dataUrl}
                  alt=""
                  onError={() =>
                    setFailed((current) =>
                      current.has(attachment.id) ? current : new Set(current).add(attachment.id),
                    )
                  }
                />
              </button>
              {isThumbs ? (
                <div className="reference-item-actions is-overlay">
                  <button
                    type="button"
                    onClick={() => onEdit(attachment)}
                    disabled={attachment.isProcessing}
                    aria-label={`Edit ${attachment.name}`}
                    data-tooltip="Edit"
                  >
                    <Pencil width={11} height={11} />
                  </button>
                  <label className="relative inline-flex size-5 cursor-pointer items-center justify-center">
                    <Refresh width={11} height={11} aria-hidden="true" />
                    <input
                      type="file"
                      accept="image/*"
                      aria-label={`Replace ${attachment.name}`}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        onFiles([file], attachment.id);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="reference-item-remove"
                    onClick={() => onRemove(attachment.id)}
                    aria-label={`Remove ${attachment.name}`}
                    data-tooltip="Remove"
                  >
                    <X width={11} height={11} />
                  </button>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <span
                    className="reference-item-copy block truncate"
                    data-tooltip={attachment.name}
                  >
                    {attachment.name}
                  </span>
                  <span className="reference-item-copy block text-xs text-[color:var(--wb-muted)]">
                    {statusLabel}
                  </span>
                  <div className="reference-item-actions flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => onEdit(attachment)}
                      disabled={attachment.isProcessing}
                      aria-label={`Edit ${attachment.name}`}
                      data-tooltip="Edit"
                      className="inline-flex size-7 items-center justify-center rounded-md text-[color:var(--wb-muted)] hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]"
                    >
                      <Pencil width={14} height={14} />
                      {isCompact ? null : <span className="sr-only">Edit</span>}
                    </button>
                    <label className="relative inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-[color:var(--wb-muted)] hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]">
                      <Refresh width={14} height={14} aria-hidden="true" />
                      <input
                        type="file"
                        accept="image/*"
                        aria-label={`Replace ${attachment.name}`}
                        className="absolute inset-0 w-full opacity-0 cursor-pointer"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          onFiles([file], attachment.id);
                          event.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => onRemove(attachment.id)}
                      aria-label={`Remove ${attachment.name}`}
                      data-tooltip="Remove"
                      className="inline-flex size-7 items-center justify-center rounded-md text-[color:var(--wb-muted)] hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]"
                    >
                      <X width={14} height={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {attachments
        .filter((attachment) => persistenceErrors?.[attachment.id])
        .map((attachment) => (
          <div
            key={attachment.id}
            role="alert"
            className="mt-2 text-xs text-[color:var(--wb-danger)]"
          >
            <p>
              {attachment.name}: {persistenceErrors?.[attachment.id]}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={attachment.isProcessing || !onRetryPersistence}
                onClick={() => void onRetryPersistence?.(attachment.id)}
              >
                {attachment.isProcessing ? 'Saving…' : 'Retry saving'}
              </button>
              <a href={attachment.dataUrl} download={attachment.name}>
                Save a copy
              </a>
            </div>
          </div>
        ))}
    </div>
  );
}
