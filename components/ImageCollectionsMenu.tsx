import React, { useRef, useState } from 'react';
import { Folder, Hashtag } from 'iconoir-react';
import { useCatalogOrganization } from '../hooks/useCatalogOrganization';
import {
  parseCatalogSearch,
  formatCatalogSearchTag,
  type CatalogCollection,
} from '../packages/shared/src';
import { openStudioSettings } from '../lib/studioSettingsDomains';
import { DemandMountedGsapDropdown } from './ui/DemandMountedGsapDropdown';
import { OrganizationCreatePopover } from './OrganizationCreatePopover';
import {
  updateCatalogCollection,
  deleteCatalogCollection,
  notifyCatalogOrganizationChanged,
} from '../services/studio-api/catalog';
import { ConfirmationModal } from './ConfirmationModal';

const EMPTY_IMAGE_IDS: string[] = [];

function OrganizationMenuFooter({
  active,
  selectedImageIds,
  busy,
  title,
  onChange,
  onManage,
  onDelete,
}: {
  active: CatalogCollection | undefined;
  selectedImageIds: string[];
  busy: boolean;
  title: string;
  onChange: (action: () => Promise<unknown>) => Promise<void>;
  onManage: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      {active && selectedImageIds.length > 0 && (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() =>
              void onChange(() =>
                updateCatalogCollection(active.id, { addImageIds: selectedImageIds }),
              )
            }
          >
            Add {selectedImageIds.length} selected to {active.name}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() =>
              void onChange(() =>
                updateCatalogCollection(active.id, { removeImageIds: selectedImageIds }),
              )
            }
          >
            Remove {selectedImageIds.length} selected from {active.name}
          </button>
        </>
      )}
      <button type="button" role="menuitem" onClick={onManage}>
        Manage {title.toLowerCase()}…
      </button>
      {active && (
        <button type="button" role="menuitem" disabled={busy} onClick={onDelete}>
          Delete {active.name}…
        </button>
      )}
    </>
  );
}

function OrganizationMenu({
  workspaceId,
  kind,
  collectionId,
  onOpenCollection,
  selectedImageIds = EMPTY_IMAGE_IDS,
  query = '',
  onQueryChange,
  onCatalogChanged,
}: {
  workspaceId: string;
  kind: 'tag' | 'collection';
  collectionId?: string | null;
  onOpenCollection?: (id: string | null) => void;
  selectedImageIds?: string[];
  query?: string;
  onQueryChange?: (query: string) => void;
  onCatalogChanged?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(15);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { tags, collections, loading, errors, refresh } = useCatalogOrganization(workspaceId);
  const error = errors[kind];
  const active = collections.find((collection) => collection.id === collectionId);
  const search = parseCatalogSearch(query);
  const searchTags = new Set(search.tags);
  const isTag = kind === 'tag';
  const [title, Icon] = isTag ? (['Tags', Hashtag] as const) : (['Collections', Folder] as const);
  const changeCollection = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
      notifyCatalogOrganizationChanged();
      await onCatalogChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not update collection.');
    } finally {
      setBusy(false);
    }
  };
  const items = isTag
    ? tags.map((tag) => ({
        id: tag.name,
        name: `#${tag.name}`,
        color: tag.color,
        emoji: null,
        count: tag.imageCount,
        selected: searchTags.has(tag.name),
      }))
    : collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        color: null,
        emoji: collection.emoji,
        count: collection.imageCount,
        selected: collection.id === collectionId,
      }));
  return (
    <div className="relative">
      <button
        ref={ref}
        type="button"
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className="studio-control studio-ghost-control"
        onClick={() => {
          setOpen(!open);
          setLimit(15);
          if (!open) refresh();
        }}
      >
        {active?.emoji ? <span>{active.emoji}</span> : <Icon width={16} height={16} />}
        <span className="hidden max-w-28 truncate text-xs lg:inline">{active?.name ?? title}</span>
        {isTag && search.tags.length > 0 && <span className="text-xs">{search.tags.length}</span>}
      </button>
      <DemandMountedGsapDropdown
        open={open}
        onOpenChange={setOpen}
        triggerRef={ref}
        portal
        placement="bottom-left"
        className="organization-toolbar-menu studio-popover"
        aria-label={title}
      >
        <OrganizationCreatePopover
          kind={kind}
          workspaceId={workspaceId}
          imageIds={selectedImageIds}
          onCreated={(value) => {
            refresh();
            if (!isTag && value.id) {
              onOpenCollection?.(value.id);
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            if (isTag) onQueryChange?.(search.text);
            else onOpenCollection?.(null);
            setOpen(false);
          }}
        >
          All images
        </button>
        <div
          className="organization-scroll"
          onScroll={(event) => {
            const node = event.currentTarget;
            if (node.scrollHeight - node.scrollTop - node.clientHeight < 64)
              setLimit((value) => value + 15);
          }}
        >
          {items.slice(0, limit).map((item) => (
            <button
              key={item.id}
              type="button"
              role={isTag ? 'menuitemcheckbox' : 'menuitemradio'}
              aria-checked={item.selected}
              onClick={() => {
                if (isTag) {
                  const next = item.selected
                    ? search.tags.filter((tag) => tag !== item.id)
                    : [...search.tags, item.id];
                  onQueryChange?.(
                    [search.text, ...next.map(formatCatalogSearchTag)].filter(Boolean).join(' '),
                  );
                } else {
                  onOpenCollection?.(item.id);
                  setOpen(false);
                }
              }}
            >
              <span
                aria-hidden="true"
                className="organization-mark"
                style={item.color ? { backgroundColor: item.color } : undefined}
              >
                {item.emoji ?? (isTag ? '' : '📁')}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="text-[var(--wb-dim)]">{item.count}</span>
              {item.selected && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {limit < items.length && (
            <button type="button" role="menuitem" onClick={() => setLimit((value) => value + 15)}>
              Show more
            </button>
          )}
        </div>
        {loading && <p role="status">Loading…</p>}
        {error && (
          <p role="alert">
            {error}{' '}
            <button type="button" onClick={refresh}>
              Retry
            </button>
          </p>
        )}
        <div className="organization-menu-separator" />
        <OrganizationMenuFooter
          active={active}
          selectedImageIds={selectedImageIds}
          busy={busy}
          title={title}
          onChange={changeCollection}
          onManage={() => {
            setOpen(false);
            openStudioSettings('organization');
          }}
          onDelete={() => {
            setOpen(false);
            setConfirmDelete(true);
          }}
        />
        {actionError && <p role="alert">{actionError}</p>}
      </DemandMountedGsapDropdown>
      <ConfirmationModal
        isOpen={confirmDelete && Boolean(active)}
        title={`Delete ${active?.name ?? 'collection'}?`}
        description="The images will stay in your Library."
        confirmLabel="Delete collection"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          changeCollection(async () => {
            if (!active) return;
            await deleteCatalogCollection(active.id);
            onOpenCollection?.(null);
            setConfirmDelete(false);
          })
        }
      />
      {!open && actionError && <p role="alert">{actionError}</p>}
    </div>
  );
}

export function ImageCollectionsMenu(props: {
  workspaceId: string;
  collectionId: string | null;
  selectedImageIds: string[];
  onOpenCollection: (collectionId: string | null) => void;
  onCatalogChanged?: () => void | Promise<void>;
}) {
  return <OrganizationMenu kind="collection" {...props} />;
}

export function ImageTagsMenu(props: {
  workspaceId: string;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return <OrganizationMenu kind="tag" {...props} />;
}
