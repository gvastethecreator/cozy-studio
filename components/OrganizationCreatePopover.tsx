import React, { useState } from 'react';
import {
  createCatalogCollection,
  createCatalogTag,
  notifyCatalogOrganizationChanged,
} from '../services/studio-api/catalog';
import { CollectionEmojiPicker, TagColorPicker } from './OrganizationAppearancePicker';

const EMPTY_IMAGE_IDS: string[] = [];

export function OrganizationCreatePopover({
  kind,
  workspaceId,
  imageIds = EMPTY_IMAGE_IDS,
  onCreated,
}: {
  kind: 'tag' | 'collection';
  workspaceId: string;
  imageIds?: string[];
  onCreated?: (value: { name: string; id?: string }) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="organization-create">
      <button
        type="button"
        role="menuitem"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ＋ New {kind}
      </button>
      {open && (
        <dialog
          open
          aria-label={`New ${kind}`}
          className="studio-panel-dialog organization-create-popover studio-popover"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              event.currentTarget.parentElement?.querySelector('button')?.focus();
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !name.trim()) return;
              setBusy(true);
              setError('');
              void (async () => {
                try {
                  const value =
                    kind === 'tag'
                      ? await createCatalogTag({ workspaceId, name, color: appearance })
                      : await createCatalogCollection({
                          workspaceId,
                          name,
                          emoji: appearance,
                          imageIds,
                        });
                  setOpen(false);
                  setName('');
                  setAppearance(null);
                  notifyCatalogOrganizationChanged();
                  await onCreated?.(value);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Could not create.');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <input
              aria-label={`New ${kind} name`}
              autoFocus
              className="studio-well w-full"
              value={name}
              maxLength={kind === 'tag' ? 64 : 80}
              placeholder={kind === 'tag' ? 'Tag name' : 'Collection name'}
              onChange={(event) => setName(event.target.value)}
            />
            {kind === 'tag' ? (
              <TagColorPicker value={appearance} onChange={setAppearance} />
            ) : (
              <CollectionEmojiPicker value={appearance} onChange={setAppearance} />
            )}
            <button
              type="submit"
              className="studio-primary-control"
              disabled={busy || !name.trim()}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
            {error && <p role="alert">{error}</p>}
          </form>
        </dialog>
      )}
    </div>
  );
}
