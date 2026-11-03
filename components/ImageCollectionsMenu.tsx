import { organizeWithUndo } from '../hooks/useCatalogOrganization';
import React, { useEffect, useRef, useState } from 'react';
import { Folder, Hashtag } from 'iconoir-react';
import {
  useCatalogOrganization,
  summarizeOrganizeCounts,
  undoOrganization,
} from '../hooks/useCatalogOrganization';
import {
  parseCatalogSearch,
  formatCatalogSearchTag,
  type CatalogCollection,
  type CatalogOrganizeHistoryEntry,
} from '../packages/shared/src';
import { openStudioSettings } from '../lib/studioSettingsDomains';
import { useT } from '../lib/i18n';
import { DemandMountedGsapDropdown } from './ui/DemandMountedGsapDropdown';
import { OrganizationCreatePopover } from './OrganizationCreatePopover';
import {
  deleteCatalogCollection,
  notifyCatalogOrganizationChanged,
  listCatalogOrganizeHistory,
  CATALOG_ORGANIZATION_CHANGED,
} from '../services/studio-api/catalog';
import { ConfirmationModal } from './ConfirmationModal';
import { SmartCollectionDialog } from './SmartCollectionDialog';

const EMPTY_IMAGE_IDS: string[] = [];

function OrganizationMenuFooter({
  history,
  historyError,
  active,
  selectedImageIds,
  busy,
  kind,
  onChange,
  onManage,
  onDelete,
  onEditRules,
}: {
  history: CatalogOrganizeHistoryEntry[];
  historyError: string;
  active: CatalogCollection | undefined;
  selectedImageIds: string[];
  busy: boolean;
  kind: 'tag' | 'collection';
  onChange: (action: () => Promise<unknown>) => Promise<void>;
  onManage: () => void;
  onDelete: () => void;
  onEditRules: () => void;
}) {
  const { t } = useT();
  return (
    <>
      <section aria-label={t('library.organize.recent')} className="px-2 py-2 text-xs">
        <p className="mb-2 text-[var(--wb-muted)]">{t('library.organize.recent')}</p>
        {historyError && <p role="alert">{historyError}</p>}
        {!historyError && history.length === 0 && <p>{t('library.organize.noRecent')}</p>}
        {history.slice(0, 5).map((entry) => {
          const summary = summarizeOrganizeCounts(entry.counts);
          const newest = history.find((change) => !change.undoneAt);
          return (
            <div key={entry.operationId} className="mb-2">
              <p>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>{' '}
                · {entry.source === 'ui' ? t('library.organize.you') : t('library.organize.agent')}{' '}
                · {summary}
              </p>
              {entry.undoneAt ? (
                <span>{t('library.organize.undone')}</span>
              ) : (
                newest?.operationId === entry.operationId && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    aria-label={t('library.organize.undoLabel', { summary })}
                    onClick={() =>
                      void onChange(() => undoOrganization(entry.operationId, summary))
                    }
                  >
                    {t('library.organize.undo')}
                  </button>
                )
              )}
            </div>
          );
        })}
      </section>
      {active?.kind === 'smart' && (
        <button type="button" role="menuitem" disabled={busy} onClick={onEditRules}>
          {t('smartCollection.editRules')}
        </button>
      )}
      {active && active.kind !== 'smart' && selectedImageIds.length > 0 && (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() =>
              void onChange(() =>
                organizeWithUndo({
                  workspaceId: active.workspaceId,
                  imageIds: selectedImageIds,
                  addToCollection: active.name,
                }),
              )
            }
          >
            {t('library.organize.addSelected', {
              count: String(selectedImageIds.length),
              name: active.name,
            })}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() =>
              void onChange(() =>
                organizeWithUndo({
                  workspaceId: active.workspaceId,
                  imageIds: selectedImageIds,
                  removeFromCollection: active.name,
                }),
              )
            }
          >
            {t('library.organize.removeSelected', {
              count: String(selectedImageIds.length),
              name: active.name,
            })}
          </button>
        </>
      )}
      <button type="button" role="menuitem" onClick={onManage}>
        {t(kind === 'tag' ? 'library.organize.manageTags' : 'library.organize.manageCollections')}
      </button>
      {active && (
        <button type="button" role="menuitem" disabled={busy} onClick={onDelete}>
          {t('library.organize.deleteMenu', { name: active.name })}
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
  favorites = false,
  unorganized = false,
  onQueryChange,
  onCatalogChanged,
}: {
  workspaceId: string;
  kind: 'tag' | 'collection';
  collectionId?: string | null;
  onOpenCollection?: (id: string | null) => void;
  selectedImageIds?: string[];
  query?: string;
  favorites?: boolean;
  unorganized?: boolean;
  onQueryChange?: (query: string) => void;
  onCatalogChanged?: () => void | Promise<void>;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [smartDialog, setSmartDialog] = useState<CatalogCollection | null | undefined>();
  const [history, setHistory] = useState<CatalogOrganizeHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    setHistory([]);
    setHistoryError('');
    if (!open) return;
    let cancelled = false;
    let revision = 0;
    const refreshHistory = () => {
      const request = ++revision;
      void listCatalogOrganizeHistory(workspaceId).then(
        (entries) => {
          if (!cancelled && request === revision) {
            setHistory(entries);
            setHistoryError('');
          }
        },
        (cause: unknown) => {
          if (!cancelled && request === revision)
            setHistoryError(
              cause instanceof Error ? cause.message : t('library.organize.historyError'),
            );
        },
      );
    };
    refreshHistory();
    window.addEventListener(CATALOG_ORGANIZATION_CHANGED, refreshHistory);
    return () => {
      cancelled = true;
      window.removeEventListener(CATALOG_ORGANIZATION_CHANGED, refreshHistory);
    };
  }, [workspaceId, open, t]);
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
  const title = t(isTag ? 'library.organize.tags' : 'library.organize.collections');
  const Icon = isTag ? Hashtag : Folder;
  const changeCollection = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
      notifyCatalogOrganizationChanged();
      await onCatalogChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t('library.organize.updateError'));
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
        smart: false,
      }))
    : collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        color: null,
        emoji: collection.emoji,
        count: collection.imageCount,
        selected: collection.id === collectionId,
        smart: collection.kind === 'smart',
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
        {!isTag && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setSmartDialog(null);
            }}
          >
            ＋ {t('smartCollection.new')}
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            if (isTag) onQueryChange?.(search.text);
            else onOpenCollection?.(null);
            setOpen(false);
          }}
        >
          {t('library.organize.allImages')}
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
              {item.smart && (
                <span className="text-[var(--wb-muted)]">{t('smartCollection.marker')}</span>
              )}
              <span className="text-[var(--wb-dim)]">{item.count}</span>
              {item.selected && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {limit < items.length && (
            <button type="button" role="menuitem" onClick={() => setLimit((value) => value + 15)}>
              {t('library.organize.showMore')}
            </button>
          )}
        </div>
        {loading && <p role="status">{t('library.organize.loading')}</p>}
        {error && (
          <p role="alert">
            {error}{' '}
            <button type="button" onClick={refresh}>
              {t('library.organize.retry')}
            </button>
          </p>
        )}
        <div className="organization-menu-separator" />
        <OrganizationMenuFooter
          history={history}
          historyError={historyError}
          active={active}
          selectedImageIds={selectedImageIds}
          busy={busy}
          kind={kind}
          onChange={changeCollection}
          onEditRules={() => {
            setOpen(false);
            setSmartDialog(active);
          }}
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
      {smartDialog !== undefined && (!smartDialog || smartDialog.workspaceId === workspaceId) && (
        <SmartCollectionDialog
          key={`${workspaceId}-${smartDialog?.id ?? 'new'}`}
          workspaceId={workspaceId}
          collection={smartDialog ?? undefined}
          query={query}
          favorites={favorites}
          unorganized={unorganized}
          onClose={() => setSmartDialog(undefined)}
          onSaved={(collection) => {
            setSmartDialog(undefined);
            refresh();
            void changeCollection(async () => {
              onOpenCollection?.(collection.id);
            });
          }}
        />
      )}
      <ConfirmationModal
        isOpen={confirmDelete && Boolean(active)}
        title={t('library.organize.deleteTitle', {
          name: active?.name ?? t('library.organize.collection'),
        })}
        description={t('library.organize.deleteHint')}
        confirmLabel={t('library.organize.deleteCollection')}
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
  query?: string;
  favorites?: boolean;
  unorganized?: boolean;
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
