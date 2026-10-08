import { CatalogCardBackdrop } from '../CatalogCardBackdrop';
import {
  NavArrowLeft as ChevronLeft,
  NavArrowRight as ChevronRight,
  MultiplePages as Layers,
} from 'iconoir-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  STYLE_COLLECTION_FAMILIES,
  STYLE_COLLECTIONS,
} from './styles/collections/styleCollectionDefinitions';
import type { StyleCollection } from './styles/collections/styleCollectionTypes';
import {
  getStyleCollectionFolderImageCandidates,
  getStyleFolderImages,
  type StyleFolderImageCandidate,
} from './styles/collections/styleCollectionFolderImages';
import { getStyleLandingFolder } from '../../lib/installedStylePacks';
import {
  loadStyleThumbnailPack,
  getStyleThumbnail,
  subscribeStyleThumbnailCatalog,
} from '../../lib/styleThumbnailCatalog';
import { STYLE_RUNTIME_PACK_SUMMARIES } from './stylesData';
import { resolveStyleRuntimePackLoadRequest } from './styleRuntimePackRequirements';
import { STYLE_PACKS_TAB_ID } from './styleTabRouting';
import { USER_STYLE_PACK_ID } from './userStyleRuntimeAdapter';
import { getPackIcon, getStyleCollectionIcon } from './styleNavigationPresentation';
import { NoStylePacksNotice } from './NoStylePacksNotice';

const FAVORITES_PACK_ID = 'favorites';
const STYLE_NAVIGATION_PREVIEW_DELAY_MS = 150;

const VISIBLE_STYLE_COLLECTIONS = STYLE_COLLECTIONS.filter(
  (collection) => collection.entries.length > 0 && collection.id !== 'my_styles',
);
const STYLE_NAVIGATION_COLLECTIONS = VISIBLE_STYLE_COLLECTIONS.filter(
  (collection) => collection.familyId !== 'personal',
);

interface StyleCollectionsLandingSurfaceProps {
  favoritesCount: number;
  userStyleCount: number;
  isNavigationPanelOpen: boolean;
  getCollectionTabId: (collectionId: string) => string;
  getStyleTabHash: (tabId: string) => string;
  onNavigateToStyleTab: (tabId: string) => void;
  onPrefetchStyleTab?: (tabId: string) => void;
  onToggleNavigationPanel: () => void;
}

interface StyleFolderCardProps {
  id: string;
  targetId: string;
  title: string;
  description: string;
  countLabel: string;
  countAriaLabel: string;
  eyebrow: string;
  sourcePackIds: string[];
  imageCandidates?: StyleFolderImageCandidate[];
  tabHash: string;
  dataAttributes: Record<string, string>;
  isHighlighted: boolean;
  onOpen: () => void;
  onPrefetch?: () => void;
}

interface StyleNavigationItem {
  id: string;
  targetId: string;
  label: string;
  caption: string;
  countLabel: string;
  tabId: string;
  icon: React.ReactNode;
  kind: 'collection' | 'source';
}

interface StyleNavigationSection {
  id: string;
  title: string;
  items: StyleNavigationItem[];
}

function StyleFolderCard({
  id,
  targetId,
  title,
  description,
  countLabel,
  countAriaLabel,
  eyebrow,
  sourcePackIds,
  imageCandidates,
  tabHash,
  dataAttributes,
  isHighlighted,
  onOpen,
  onPrefetch,
}: StyleFolderCardProps) {
  const { cover, files } = useMemo(
    () => getStyleFolderImages({ seedId: id, sourcePackIds, imageCandidates }),
    [id, sourcePackIds, imageCandidates],
  );
  return (
    <button
      type="button"
      data-style-folder-target={targetId}
      data-style-folder-highlighted={isHighlighted ? 'true' : 'false'}
      data-style-tab-url={`#${tabHash}`}
      aria-label={`Open ${title}`}
      onClick={onOpen}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      className={`style-folder-card catalog-art-card group relative z-0 block aspect-[3/4] w-full cursor-pointer overflow-visible rounded-[var(--wb-radius)] text-left outline-none hover:z-20 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-white/35 ${
        isHighlighted ? 'z-30 brightness-[1.08]' : ''
      }`}
      {...dataAttributes}
    >
      {isHighlighted && (
        <span className="pointer-events-none absolute -inset-2 z-[70] rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_22px_55px_rgba(255,255,255,0.10)]" />
      )}
      {files.map((file) => (
        <div
          key={file.id}
          data-style-pack-folder-file={file.id}
          aria-hidden="true"
          className="absolute inset-x-3 top-3 aspect-[3/4] overflow-hidden rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] shadow-[0_12px_24px_rgba(0,0,0,0.3)]"
        >
          {file.src ? (
            <img
              src={file.src}
              alt=""
              width={320}
              height={420}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center p-3 text-xs text-[color:var(--wb-muted)]">
              {file.label}
            </div>
          )}
        </div>
      ))}
      <div
        data-style-pack-folder-cover={id}
        className="absolute inset-0 z-10 overflow-hidden rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] shadow-[0_18px_42px_rgba(0,0,0,0.38)]"
      >
        {cover.src ? (
          <img
            src={cover.src}
            alt=""
            width={420}
            height={560}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center p-3 text-xs text-[color:var(--wb-muted)]">
            {title}
          </div>
        )}
        <span
          data-style-pack-count={id}
          aria-label={countAriaLabel}
          className="absolute right-2 top-2 rounded-[var(--wb-radius)] bg-[color:var(--wb-panel)] px-2 py-1 text-xs"
        >
          {countLabel}
        </span>
        <CatalogCardBackdrop
          interactive={false}
          label={title}
          title={
            <span data-style-pack-card-title={id} className="block min-w-0 truncate">
              {title}
            </span>
          }
        >
          <span className="sr-only">{eyebrow}</span>
          <p>{description}</p>
        </CatalogCardBackdrop>
      </div>
    </button>
  );
}
function formatLandingFolderLabel(key: string) {
  const rawName = key.includes('__') ? key.slice(key.indexOf('__') + 2) : key;
  return (
    rawName
      .replace(/_/g, ' ')
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
      .trim() || key
  );
}

function getLandingFolderImageCandidates(id: string): StyleFolderImageCandidate[] {
  return (getStyleLandingFolder(id)?.imageKeys ?? []).flatMap((key) => {
    const src = getStyleThumbnail(key);
    if (!src) return [];
    return [{ id: key, src, label: formatLandingFolderLabel(key) }];
  });
}

function useStyleLandingThumbnailCatalog() {
  const [revision, setRevision] = useState(0);

  useEffect(() => subscribeStyleThumbnailCatalog(() => setRevision((value) => value + 1)), []);

  useEffect(() => {
    const packIds = resolveStyleRuntimePackLoadRequest({
      isPackLandingOpen: true,
      currentPackId: STYLE_PACKS_TAB_ID,
      activeStyleCollectionId: null,
      activeCollectionSourcePackIds: [],
      isGlobalStyleBrowseTab: false,
      favoritesCount: 0,
      isGlobalStyleSearchActive: false,
      runtimePackIds: STYLE_RUNTIME_PACK_SUMMARIES.map((pack) => pack.id),
      favoritesPackId: FAVORITES_PACK_ID,
      visibleCollectionSourcePackIds: VISIBLE_STYLE_COLLECTIONS.flatMap(
        (collection) => collection.sourcePackIds,
      ),
    }).requiredThumbnailPackIds;
    let cancelled = false;
    void (async () => {
      for (let index = 0; index < packIds.length; index += 2) {
        if (cancelled) return;
        await Promise.all(
          packIds.slice(index, index + 2).map((packId) => loadStyleThumbnailPack(packId)),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return revision;
}

function getLandingFolderPresetCount(id: string, fallback: number) {
  return getStyleLandingFolder(id)?.presetCount ?? fallback;
}

function StyleCollectionCard({
  collection,
  countLabel,
  familyLabel,
  targetId,
  tabId,
  isHighlighted,
  onOpen,
  onPrefetch,
  getStyleTabHash,
  thumbnailRevision,
}: {
  collection: StyleCollection;
  countLabel: string;
  familyLabel: string;
  targetId: string;
  tabId: string;
  isHighlighted: boolean;
  onOpen: () => void;
  onPrefetch?: () => void;
  getStyleTabHash: (tabId: string) => string;
  thumbnailRevision: number;
}) {
  const imageCandidates = useMemo(() => {
    const landingImages = getLandingFolderImageCandidates(collection.id);
    return landingImages.length > 0
      ? landingImages
      : getStyleCollectionFolderImageCandidates(collection);
  }, [collection, thumbnailRevision]);

  return (
    <StyleFolderCard
      id={collection.id}
      targetId={targetId}
      title={collection.title}
      description={collection.description}
      countLabel={countLabel}
      countAriaLabel={`${collection.title} count ${countLabel}`}
      eyebrow={familyLabel}
      sourcePackIds={collection.sourcePackIds}
      imageCandidates={imageCandidates}
      tabHash={getStyleTabHash(tabId)}
      dataAttributes={{ 'data-style-collection-card': collection.id }}
      isHighlighted={isHighlighted}
      onOpen={onOpen}
      onPrefetch={onPrefetch}
    />
  );
}

function SourcePackCard({
  pack,
  targetId,
  getStyleTabHash,
  isHighlighted,
  onOpen,
  onPrefetch,
  thumbnailRevision,
}: {
  pack: (typeof STYLE_RUNTIME_PACK_SUMMARIES)[number];
  targetId: string;
  getStyleTabHash: (tabId: string) => string;
  isHighlighted: boolean;
  onOpen: () => void;
  onPrefetch?: () => void;
  thumbnailRevision: number;
}) {
  const title = pack.cardTitle ?? pack.name;
  const imageCandidates = useMemo(
    () => getLandingFolderImageCandidates(pack.id),
    [pack.id, thumbnailRevision],
  );

  return (
    <StyleFolderCard
      id={pack.id}
      targetId={targetId}
      title={title}
      description={pack.cardDescription ?? pack.description}
      countLabel={`${pack.presetCount}`}
      countAriaLabel={`${pack.name} presets ${pack.presetCount}`}
      eyebrow="Source pack"
      sourcePackIds={[pack.id]}
      imageCandidates={imageCandidates}
      tabHash={getStyleTabHash(pack.id)}
      dataAttributes={{ 'data-style-pack-card': pack.id }}
      isHighlighted={isHighlighted}
      onOpen={onOpen}
      onPrefetch={onPrefetch}
    />
  );
}

function useDemandMountedSection(
  scrollRootRef: React.RefObject<HTMLDivElement | null>,
  forceMount: boolean,
) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [isMounted, setIsMounted] = useState(forceMount);

  useEffect(() => {
    if (forceMount) {
      setIsMounted(true);
      return;
    }
    if (isMounted) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsMounted(true);
      return;
    }

    const section = sectionRef.current;
    const root = scrollRootRef.current;
    if (!section || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setIsMounted(true);
        observer.disconnect();
      },
      { root, rootMargin: '360px 0px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [forceMount, isMounted, scrollRootRef]);

  return { sectionRef, isMounted };
}

function StyleFolderPlaceholder({
  targetId,
  title,
  tabHash,
  dataAttributes,
  isHighlighted,
  onOpen,
}: {
  targetId: string;
  title: string;
  tabHash: string;
  dataAttributes: Record<string, string>;
  isHighlighted: boolean;
  onOpen: () => void;
  onPrefetch?: () => void;
}) {
  return (
    <button
      type="button"
      data-style-pack-folder-open="false"
      data-style-folder-target={targetId}
      data-style-folder-highlighted={isHighlighted ? 'true' : 'false'}
      data-style-tab-url={`#${tabHash}`}
      aria-label={`Open ${title}`}
      onClick={onOpen}
      className={`group relative z-0 block aspect-[3/4] w-full cursor-pointer overflow-hidden rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] text-left outline-none focus-visible:ring-2 focus-visible:ring-white/35 ${
        isHighlighted ? 'z-30 brightness-[1.08]' : ''
      }`}
      {...dataAttributes}
    >
      <span className="absolute inset-x-3 bottom-3 truncate text-xs font-semibold text-[color:var(--wb-muted)]">
        {title}
      </span>
    </button>
  );
}

function StyleCollectionFamilySection({
  family,
  collections,
  activeTargetId,
  scrollRootRef,
  getCollectionTabId,
  getStyleTabHash,
  onNavigateToStyleTab,
  onPrefetchStyleTab,
  thumbnailRevision,
}: {
  family: (typeof STYLE_COLLECTION_FAMILIES)[number];
  collections: StyleCollection[];
  activeTargetId: string | null;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  getCollectionTabId: (collectionId: string) => string;
  getStyleTabHash: (tabId: string) => string;
  onNavigateToStyleTab: (tabId: string) => void;
  onPrefetchStyleTab?: (tabId: string) => void;
  thumbnailRevision: number;
}) {
  const forceMount = collections.some(
    (collection) => activeTargetId === `collection:${collection.id}`,
  );
  const { sectionRef, isMounted } = useDemandMountedSection(scrollRootRef, forceMount);

  return (
    <section
      ref={sectionRef}
      data-style-collection-family={family.id}
      data-style-family-mounted={isMounted ? 'true' : 'false'}
      className="min-w-0"
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="min-w-0">
          <h3 className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)]">
            {family.title}
          </h3>
          <p className="mt-0.5 line-clamp-1 text-[length:var(--wbp-label)] font-medium text-[color:var(--wb-dim)]">
            {family.description}
          </p>
        </div>
        <div className="h-px flex-1 bg-white/6" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {collections.map((collection) => {
          const tabId = getCollectionTabId(collection.id);
          const targetId = `collection:${collection.id}`;
          const sharedProps = {
            targetId,
            isHighlighted: activeTargetId === targetId,
            onOpen: () => onNavigateToStyleTab(tabId),
            onPrefetch: () => onPrefetchStyleTab?.(tabId),
          };

          return isMounted ? (
            <StyleCollectionCard
              key={collection.id}
              {...sharedProps}
              collection={collection}
              countLabel={`${getLandingFolderPresetCount(collection.id, collection.sourcePackIds.length)}`}
              familyLabel={family.title}
              tabId={tabId}
              getStyleTabHash={getStyleTabHash}
              thumbnailRevision={thumbnailRevision}
            />
          ) : (
            <StyleFolderPlaceholder
              key={collection.id}
              {...sharedProps}
              title={collection.title}
              tabHash={getStyleTabHash(tabId)}
              dataAttributes={{ 'data-style-collection-card': collection.id }}
            />
          );
        })}
      </div>
    </section>
  );
}

function StyleSourcePacksSection({
  activeTargetId,
  scrollRootRef,
  getStyleTabHash,
  onNavigateToStyleTab,
  onPrefetchStyleTab,
  thumbnailRevision,
}: {
  activeTargetId: string | null;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  getStyleTabHash: (tabId: string) => string;
  onNavigateToStyleTab: (tabId: string) => void;
  onPrefetchStyleTab?: (tabId: string) => void;
  thumbnailRevision: number;
}) {
  const forceMount = activeTargetId?.startsWith('source:') ?? false;
  const { sectionRef, isMounted } = useDemandMountedSection(scrollRootRef, forceMount);

  return (
    <section
      ref={sectionRef}
      data-style-source-packs-section
      data-style-source-packs-mounted={isMounted ? 'true' : 'false'}
      className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)]"
    >
      <div
        data-style-source-packs-summary
        className="flex items-center gap-2 px-3 py-3 text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-muted)]"
      >
        <Layers width={16} height={16} />
        Source Packs
        <span className="ml-auto rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-white/[0.035] px-2 py-1 text-[length:var(--wbp-label)] text-[color:var(--wb-muted)]">
          {STYLE_RUNTIME_PACK_SUMMARIES.length}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 border-t border-[color:var(--wb-line)] p-3">
        {STYLE_RUNTIME_PACK_SUMMARIES.map((pack) => {
          const targetId = `source:${pack.id}`;
          const sharedProps = {
            targetId,
            isHighlighted: activeTargetId === targetId,
            onOpen: () => onNavigateToStyleTab(pack.id),
            onPrefetch: () => onPrefetchStyleTab?.(pack.id),
          };
          return isMounted ? (
            <SourcePackCard
              key={pack.id}
              {...sharedProps}
              pack={pack}
              getStyleTabHash={getStyleTabHash}
              thumbnailRevision={thumbnailRevision}
            />
          ) : (
            <StyleFolderPlaceholder
              key={pack.id}
              {...sharedProps}
              title={pack.cardTitle ?? pack.name}
              tabHash={getStyleTabHash(pack.id)}
              dataAttributes={{ 'data-style-pack-card': pack.id }}
            />
          );
        })}
      </div>
    </section>
  );
}

function StyleNavigationPanel({
  sections,
  activeTargetId,
  onPreview,
  onOpen,
  onClose,
}: {
  sections: StyleNavigationSection[];
  activeTargetId: string | null;
  onPreview: (item: StyleNavigationItem) => void;
  onOpen: (tabId: string) => void;
  onClose: () => void;
}) {
  const previewDelayRef = useRef<number | null>(null);

  const cancelDelayedPreview = useCallback(() => {
    if (previewDelayRef.current === null) return;
    window.clearTimeout(previewDelayRef.current);
    previewDelayRef.current = null;
  }, []);

  const scheduleDelayedPreview = useCallback(
    (item: StyleNavigationItem) => {
      cancelDelayedPreview();
      previewDelayRef.current = window.setTimeout(() => {
        previewDelayRef.current = null;
        onPreview(item);
      }, STYLE_NAVIGATION_PREVIEW_DELAY_MS);
    },
    [cancelDelayedPreview, onPreview],
  );

  useEffect(() => cancelDelayedPreview, [cancelDelayedPreview]);

  return (
    <aside className="hidden min-h-0 min-w-0 lg:block" data-style-landing-navigation>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[color:var(--wb-line)] px-3">
          <div className="min-w-0">
            <p className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-muted)]">
              Collections
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-style-landing-navigation-toggle
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-white/[0.035] text-[color:var(--wb-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]"
            aria-label="Hide style map"
            data-tooltip="Hide style map"
          >
            <ChevronLeft width={14} height={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
          {sections.map((section) => (
            <div key={section.id} className="mb-3 last:mb-0">
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span className="h-px flex-1 bg-white/6" />
                <span className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-dim)]">
                  {section.title}
                </span>
                <span className="h-px flex-1 bg-white/6" />
              </div>
              <div className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const active = activeTargetId === item.targetId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-style-nav-item={item.targetId}
                      onPointerEnter={(event) => {
                        if (event.pointerType === 'touch') return;
                        scheduleDelayedPreview(item);
                      }}
                      onPointerLeave={cancelDelayedPreview}
                      onFocus={() => {
                        cancelDelayedPreview();
                        onPreview(item);
                      }}
                      onClick={() => {
                        cancelDelayedPreview();
                        onOpen(item.tabId);
                      }}
                      className={`group/nav flex min-h-9 w-full items-center gap-2 rounded-[var(--wb-radius)] border px-2 py-1.5 text-left outline-none transition-[background-color,border-color,transform,color] duration-150 focus-visible:ring-2 focus-visible:ring-white/30 ${
                        active
                          ? 'border-[color:var(--wb-line)] bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] text-[color:var(--wb-ink)]'
                          : 'border-transparent bg-transparent text-[color:var(--wb-muted)] hover:border-[color:var(--wb-border)] hover:bg-white/[0.045] hover:text-[color:var(--wb-ink)]'
                      }`}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-white/[0.035] text-[color:var(--wb-muted)]">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)]">
                          {item.label}
                        </span>
                        <span className="block truncate text-[length:var(--wbp-label)] font-medium text-[color:var(--wb-dim)]">
                          {item.caption}
                        </span>
                      </span>
                      <span className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-white/[0.035] px-1.5 py-0.5 text-[length:var(--wbp-label)] font-semibold tabular-nums text-[color:var(--wb-muted)]">
                        {item.countLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function StyleCollectionsLandingSurface({
  favoritesCount,
  userStyleCount,
  isNavigationPanelOpen,
  getCollectionTabId,
  getStyleTabHash,
  onNavigateToStyleTab,
  onPrefetchStyleTab,
  onToggleNavigationPanel,
}: StyleCollectionsLandingSurfaceProps) {
  const thumbnailRevision = useStyleLandingThumbnailCatalog();
  const [activeNavigationTargetId, setActiveNavigationTargetId] = useState<string | null>(null);
  const cardsScrollerRef = useRef<HTMLDivElement | null>(null);
  const personalStyleCollections = useMemo(
    () =>
      STYLE_COLLECTIONS.filter(
        (collection) => collection.id === 'my_styles' || collection.id === 'favorites',
      ),
    [],
  );
  const styleCollectionFamilySections = useMemo(
    () =>
      STYLE_COLLECTION_FAMILIES.map((family) => ({
        family,
        collections: STYLE_NAVIGATION_COLLECTIONS.filter(
          (collection) => collection.familyId === family.id,
        ),
      })).filter((section) => section.collections.length > 0),
    [],
  );
  const navigationSections = useMemo<StyleNavigationSection[]>(() => {
    const personalItems = personalStyleCollections.map((collection) => {
      const isUserStyles = collection.id === 'my_styles';
      const tabId = isUserStyles ? USER_STYLE_PACK_ID : FAVORITES_PACK_ID;
      return {
        id: `collection:${collection.id}`,
        targetId: `collection:${collection.id}`,
        label: collection.title,
        caption: 'Personal',
        countLabel: `${isUserStyles ? userStyleCount : favoritesCount}`,
        tabId,
        icon: getStyleCollectionIcon(collection.icon, 14),
        kind: 'collection',
      } satisfies StyleNavigationItem;
    });

    const collectionSections = styleCollectionFamilySections.map(({ family, collections }) => ({
      id: family.id,
      title: family.title,
      items: collections.map((collection) => {
        return {
          id: `collection:${collection.id}`,
          targetId: `collection:${collection.id}`,
          label: collection.title,
          caption: family.title,
          countLabel: `${getLandingFolderPresetCount(collection.id, collection.sourcePackIds.length)}`,
          tabId: getCollectionTabId(collection.id),
          icon: getStyleCollectionIcon(collection.icon, 14),
          kind: 'collection',
        } satisfies StyleNavigationItem;
      }),
    }));

    return [
      { id: 'personal', title: 'Personal', items: personalItems },
      ...collectionSections,
      {
        id: 'source',
        title: 'Source',
        items: STYLE_RUNTIME_PACK_SUMMARIES.map((pack) => {
          return {
            id: `source:${pack.id}`,
            targetId: `source:${pack.id}`,
            label: pack.cardTitle ?? pack.name,
            caption: 'Source pack',
            countLabel: `${pack.presetCount}`,
            tabId: pack.id,
            icon: getPackIcon(pack.id),
            kind: 'source',
          } satisfies StyleNavigationItem;
        }),
      },
    ];
  }, [
    favoritesCount,
    getCollectionTabId,
    personalStyleCollections,
    styleCollectionFamilySections,
    userStyleCount,
  ]);

  const previewNavigationItem = useCallback(
    (item: StyleNavigationItem) => {
      setActiveNavigationTargetId(item.targetId);
      onPrefetchStyleTab?.(item.tabId);
    },
    [onPrefetchStyleTab],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-3 pb-4 sm:px-5 sm:pt-4 sm:pb-5 2xl:px-6">
      <div className="mb-3 shrink-0 flex flex-col gap-1">
        <h2 className="vt-style-pack-title truncate text-lg font-semibold tracking-tight text-[color:var(--wb-ink)]">
          Collections
        </h2>
        <p className="max-w-3xl text-[length:var(--wbp-label)] font-medium leading-relaxed text-[color:var(--wb-muted)]">
          Browse styles by creative intent. Source packs show where styles come from.
        </p>
        <label className="styles-catalog-map-select lg:hidden">
          <span>Collections</span>
          <select
            aria-label="Browse collections"
            value={activeNavigationTargetId ?? ''}
            onChange={(event) => {
              const item = navigationSections
                .flatMap((section) => section.items)
                .find((entry) => entry.targetId === event.target.value);
              if (item) onNavigateToStyleTab(item.tabId);
            }}
          >
            {navigationSections.flatMap((section) =>
              section.items.map((item) => (
                <option key={item.id} value={item.targetId}>
                  {item.label}
                </option>
              )),
            )}
          </select>
        </label>
        {STYLE_RUNTIME_PACK_SUMMARIES.length === 0 ? <NoStylePacksNotice /> : null}
      </div>

      <div
        className={`style-landing-layout grid min-h-0 min-w-0 flex-1 gap-4 overflow-hidden ${
          isNavigationPanelOpen
            ? 'lg:grid-cols-[260px_minmax(0,1fr)]'
            : 'lg:grid-cols-[40px_minmax(0,1fr)]'
        }`}
      >
        {isNavigationPanelOpen ? (
          <StyleNavigationPanel
            sections={navigationSections}
            activeTargetId={activeNavigationTargetId}
            onPreview={previewNavigationItem}
            onOpen={onNavigateToStyleTab}
            onClose={onToggleNavigationPanel}
          />
        ) : (
          <aside
            data-style-landing-navigation-rail
            className="hidden min-h-0 min-w-0 items-start justify-center rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)]/70 p-1.5 lg:flex"
          >
            <button
              type="button"
              onClick={onToggleNavigationPanel}
              data-style-landing-navigation-toggle
              className="flex size-7 items-center justify-center rounded-[var(--wb-radius)] text-[color:var(--wb-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] hover:text-[color:var(--wb-ink)]"
              aria-label="Show style map"
              data-tooltip="Show style map"
            >
              <ChevronRight width={14} height={14} />
            </button>
          </aside>
        )}

        <div
          ref={cardsScrollerRef}
          data-style-card-scroll-root
          className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar"
        >
          <div className="flex min-w-0 flex-col gap-5 pb-16">
            <section data-style-collection-family="personal" className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-[length:var(--wbp-label)] font-semibold tracking-normal text-[color:var(--wb-ink)]">
                  Personal
                </h3>
                <div className="h-px flex-1 bg-white/6" />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                {personalStyleCollections.map((collection) => {
                  const tabId =
                    collection.id === 'my_styles' ? USER_STYLE_PACK_ID : FAVORITES_PACK_ID;
                  const isUserStyles = collection.id === 'my_styles';
                  const targetId = `collection:${collection.id}`;
                  if ((isUserStyles ? userStyleCount : favoritesCount) === 0)
                    return (
                      <button
                        key={collection.id}
                        type="button"
                        className="studio-ghost-control flex items-center justify-between gap-2 p-3 text-xs"
                        onClick={() => onNavigateToStyleTab(tabId)}
                      >
                        <span>{isUserStyles ? 'My styles' : 'Favorites'}</span>
                        <span className="text-[color:var(--wb-muted)]">0 styles</span>
                      </button>
                    );
                  return (
                    <StyleCollectionCard
                      key={collection.id}
                      collection={collection}
                      countLabel={`${isUserStyles ? userStyleCount : favoritesCount}`}
                      familyLabel="Personal"
                      targetId={targetId}
                      tabId={tabId}
                      isHighlighted={activeNavigationTargetId === targetId}
                      getStyleTabHash={getStyleTabHash}
                      onOpen={() => onNavigateToStyleTab(tabId)}
                      thumbnailRevision={thumbnailRevision}
                    />
                  );
                })}
              </div>
            </section>

            {styleCollectionFamilySections.map(({ family, collections }) => (
              <StyleCollectionFamilySection
                key={family.id}
                family={family}
                collections={collections}
                activeTargetId={activeNavigationTargetId}
                scrollRootRef={cardsScrollerRef}
                getCollectionTabId={getCollectionTabId}
                getStyleTabHash={getStyleTabHash}
                onNavigateToStyleTab={onNavigateToStyleTab}
                onPrefetchStyleTab={onPrefetchStyleTab}
                thumbnailRevision={thumbnailRevision}
              />
            ))}

            <StyleSourcePacksSection
              activeTargetId={activeNavigationTargetId}
              scrollRootRef={cardsScrollerRef}
              getStyleTabHash={getStyleTabHash}
              onNavigateToStyleTab={onNavigateToStyleTab}
              onPrefetchStyleTab={onPrefetchStyleTab}
              thumbnailRevision={thumbnailRevision}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
