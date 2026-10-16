import React, { useState } from 'react';
import { useWorkspaceState } from '../../contexts/WorkspaceContext';
import { useCatalogOrganization } from '../../hooks/useCatalogOrganization';
import {
  notifyCatalogOrganizationChanged,
  updateCatalogCollection,
  updateCatalogTag,
} from '../../services/studio-api/catalog';
import { CollectionEmojiPicker, TagColorPicker } from '../OrganizationAppearancePicker';
import { OrganizationCreatePopover } from '../OrganizationCreatePopover';

function OrganizationRow({
  name,
  appearance,
  kind,
  count,
  onSave,
}: {
  name: string;
  appearance: string | null;
  kind: 'tag' | 'collection';
  count: number;
  onSave: (name: string, appearance: string | null) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(name);
  const [value, setValue] = useState(appearance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = draft !== name || value !== appearance;
  return (
    <form
      className="organization-edit-row"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !draft.trim()) return;
        setBusy(true);
        setError('');
        try {
          await onSave(draft, value);
          notifyCatalogOrganizationChanged();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not save.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <details className="organization-appearance-popover">
        <summary aria-label={`Edit ${kind === 'tag' ? 'color' : 'emoji'} for ${name}`}>
          {kind === 'tag' ? (
            <span
              className="organization-mark"
              style={{ backgroundColor: value ?? 'var(--wb-dim)' }}
            />
          ) : (
            (value ?? '📁')
          )}
        </summary>
        <div className="studio-popover">
          {kind === 'tag' ? (
            <TagColorPicker value={value} onChange={setValue} />
          ) : (
            <CollectionEmojiPicker value={value} onChange={setValue} />
          )}
        </div>
      </details>
      <input
        className="studio-well min-w-0 flex-1"
        aria-label={`Rename ${kind} ${name}`}
        value={draft}
        maxLength={kind === 'tag' ? 64 : 80}
        onChange={(event) => setDraft(event.target.value)}
      />
      <span className="organization-count" aria-label={`${count} images`}>
        {count}
      </span>
      <button
        type="submit"
        className="studio-ghost-control"
        disabled={!changed || busy || !draft.trim()}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      {changed && (
        <button
          type="button"
          className="studio-ghost-control"
          disabled={busy}
          onClick={() => {
            setDraft(name);
            setValue(appearance);
            setError('');
          }}
        >
          Cancel
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function SettingsOrganizationPanel() {
  const { activeWorkspaceId } = useWorkspaceState();
  const { tags, collections, errors, loading, refresh } = useCatalogOrganization(activeWorkspaceId);
  const error = Object.values(errors).filter(Boolean).join(' ');
  return (
    <div className="settings-form-stack" key={activeWorkspaceId}>
      {(['tag', 'collection'] as const).map((kind) => (
        <section
          className="settings-group"
          key={kind}
          aria-label={kind === 'tag' ? 'Manage tags' : 'Manage collections'}
        >
          <header className="mb-4 flex items-center justify-between">
            <h3>{kind === 'tag' ? 'Tags' : 'Collections'}</h3>
            <OrganizationCreatePopover
              kind={kind}
              workspaceId={activeWorkspaceId}
              onCreated={refresh}
            />
          </header>
          <div className="organization-edit-list">
            {kind === 'tag'
              ? tags.map((tag) => (
                  <OrganizationRow
                    key={`${tag.name}-${tag.color}`}
                    kind={kind}
                    name={tag.name}
                    appearance={tag.color}
                    count={tag.imageCount}
                    onSave={(name, color) =>
                      updateCatalogTag(activeWorkspaceId, tag.name, {
                        ...(name !== tag.name ? { name } : {}),
                        color,
                      })
                    }
                  />
                ))
              : collections.map((collection) => (
                  <OrganizationRow
                    key={`${collection.id}-${collection.name}-${collection.emoji}`}
                    kind={kind}
                    name={collection.name}
                    appearance={collection.emoji ?? null}
                    count={collection.imageCount}
                    onSave={(name, emoji) =>
                      updateCatalogCollection(collection.id, { name, emoji })
                    }
                  />
                ))}
          </div>
        </section>
      ))}
      {loading && <p role="status">Loading…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
