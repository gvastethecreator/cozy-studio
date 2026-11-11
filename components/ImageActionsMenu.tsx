import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  Copy,
  Download,
  Heart,
  HeartSolid,
  PlusCircle,
  Refresh,
  Trash,
  Folder,
  Hashtag,
  NavArrowRight,
  MediaImage,
  Clock,
} from 'iconoir-react';
import type { GeneratedImageWithConfig } from '../types';
import { DemandMountedGsapDropdown } from './ui/DemandMountedGsapDropdown';
import { ImageOrganizationPicker } from './ImageOrganizationPicker';
import { useToastUi } from '../contexts/GlobalContext';
import { openCatalogImageFolder } from '../services/studio-api/catalog';
import { resolveStudioApiBase } from '../services/studioRuntime';

function originalImageHref(image: GeneratedImageWithConfig) {
  if (image.sourceExists === false) return null;
  const source = image.sourceUrl?.trim() || image.src;
  if (!source || (!image.sourceUrl && source === image.thumbnail)) return null;
  try {
    const url = new URL(source, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) && url.searchParams.get('variant') !== 'thumb'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function isLocalStudio() {
  const loopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  return loopback(window.location.hostname) && loopback(new URL(resolveStudioApiBase()).hostname);
}

export function ImageActionsMenu({
  image,
  workspaceId,
  open,
  onOpenChange,
  triggerRef,
  anchorPoint,
  onReference,
  onFavorite,
  onDownload,
  onCopyPrompt,
  onCopyImage,
  onConvert,
  onLoadConfig,
  onRegenerate,
  onDelete,
  onSaved,
}: {
  image: GeneratedImageWithConfig;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  anchorPoint?: { x: number; y: number } | null;
  onReference: () => void;
  onFavorite: () => void;
  onDownload: () => void;
  onCopyPrompt: () => void;
  onCopyImage?: () => void;
  onConvert?: () => void;
  onLoadConfig: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onSaved?: () => void;
}) {
  const { addToast } = useToastUi();
  const originalHref = originalImageHref(image);
  const hasOriginal = image.sourceExists !== false;
  const canOpenFolder = hasOriginal && Boolean(image.localPath) && isLocalStudio();
  const [submenu, setSubmenu] = useState<'tag' | 'collection' | null>(null);
  const [side, setSide] = useState<'left' | 'right' | 'compact'>('right');
  const [top, setTop] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const collectionRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) setSubmenu(null);
  }, [open]);
  useLayoutEffect(() => {
    if (!submenu || !panelRef.current || !submenuRef.current) return;
    const position = () => {
      const rect = panelRef.current!.getBoundingClientRect();
      const anchor = (submenu === 'tag' ? tagRef : collectionRef).current!;
      const height = submenuRef.current!.offsetHeight;
      setSide(
        rect.right + 278 <= window.innerWidth ? 'right' : rect.left >= 278 ? 'left' : 'compact',
      );
      setTop(
        Math.max(
          8 - rect.top,
          Math.min(anchor.offsetTop, window.innerHeight - rect.top - height - 8),
        ),
      );
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(submenuRef.current);
    window.addEventListener('resize', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
    };
  }, [submenu]);
  const closeMenu = () => {
    onOpenChange(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const run = (action: () => void) => {
    action();
    closeMenu();
  };
  const openSubmenu = (kind: 'tag' | 'collection', focus = false) => {
    setSubmenu(kind);
    if (focus)
      requestAnimationFrame(() =>
        submenuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus(),
      );
  };
  const FavoriteIcon = image.isFavorite ? HeartSolid : Heart;
  return (
    <DemandMountedGsapDropdown
      ref={panelRef}
      open={open}
      onOpenChange={onOpenChange}
      triggerRef={triggerRef}
      anchorPoint={anchorPoint}
      portal
      placement="bottom-right"
      className="library-image-menu image-actions-cascade studio-popover"
      aria-label="Image actions"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!hasOriginal}
        onClick={() => run(onReference)}
      >
        <PlusCircle width={15} />
        Use as reference
      </button>
      <button type="button" role="menuitem" onClick={() => run(onFavorite)}>
        <FavoriteIcon width={15} />
        {image.isFavorite ? 'Remove favorite' : 'Add favorite'}
      </button>
      {(['tag', 'collection'] as const).map((kind) => (
        <button
          key={kind}
          ref={kind === 'tag' ? tagRef : collectionRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={submenu === kind}
          aria-controls={`${id}-${kind}`}
          onPointerEnter={() => openSubmenu(kind)}
          onClick={() => openSubmenu(kind, true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              openSubmenu(kind, true);
            }
          }}
        >
          {kind === 'tag' ? <Hashtag width={15} /> : <Folder width={15} />}
          {kind === 'tag' ? 'Tags' : 'Collections'}
          <NavArrowRight className="ml-auto" width={14} />
        </button>
      ))}
      <div className="organization-menu-separator" />
      <button type="button" role="menuitem" onClick={() => run(onCopyPrompt)}>
        <Copy width={15} />
        Copy prompt
      </button>
      {onCopyImage && (
        <button
          type="button"
          role="menuitem"
          disabled={!hasOriginal}
          onClick={() => run(onCopyImage)}
        >
          <Copy width={15} />
          Copy image
        </button>
      )}
      {originalHref ? (
        <a
          role="menuitem"
          href={originalHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={closeMenu}
        >
          <MediaImage width={15} />
          Open image in new tab
        </a>
      ) : (
        <button
          type="button"
          role="menuitem"
          disabled
          title="The original image is not available as a browser URL."
        >
          <MediaImage width={15} />
          Open image in new tab
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={!canOpenFolder}
        title={canOpenFolder ? undefined : 'Available locally when the original file exists.'}
        onClick={() =>
          run(() => {
            void openCatalogImageFolder(image.id).catch((error: unknown) =>
              addToast(
                error instanceof Error ? error.message : 'Could not open containing folder.',
                'error',
              ),
            );
          })
        }
      >
        <Folder width={15} />
        Open containing folder
      </button>
      <button type="button" role="menuitem" disabled={!hasOriginal} onClick={() => run(onDownload)}>
        <Download width={15} />
        Download
      </button>
      {onConvert && (
        <button
          type="button"
          role="menuitem"
          disabled={!hasOriginal}
          onClick={() => run(onConvert)}
        >
          <MediaImage width={15} />
          Convert or compress
        </button>
      )}
      <button type="button" role="menuitem" onClick={() => run(onLoadConfig)}>
        <Clock width={15} />
        Load configuration
      </button>
      <button type="button" role="menuitem" onClick={() => run(onRegenerate)}>
        <Refresh width={15} />
        Regenerate
      </button>
      <button type="button" role="menuitem" className="is-danger" onClick={() => run(onDelete)}>
        <Trash width={15} />
        Move to trash
      </button>
      {submenu && (
        <div
          ref={submenuRef}
          id={`${id}-${submenu}`}
          role="menu"
          aria-label={submenu === 'tag' ? 'Tags' : 'Collections'}
          className={`image-actions-submenu studio-popover is-${side}`}
          style={{ top }}
          onKeyDown={(event) => {
            if (event.target instanceof HTMLInputElement) return;
            if (event.key === 'Escape' || event.key === 'ArrowLeft') {
              event.preventDefault();
              event.stopPropagation();
              setSubmenu(null);
              (submenu === 'tag' ? tagRef : collectionRef).current?.focus();
            }
          }}
        >
          {side === 'compact' && (
            <button
              type="button"
              role="menuitem"
              className="organization-submenu-back"
              onClick={() => {
                setSubmenu(null);
                (submenu === 'tag' ? tagRef : collectionRef).current?.focus();
              }}
            >
              ← Back to image actions
            </button>
          )}
          <ImageOrganizationPicker
            key={`${image.id}-${submenu}`}
            kind={submenu}
            workspaceId={workspaceId}
            images={[image]}
            onSaved={onSaved}
          />
        </div>
      )}
    </DemandMountedGsapDropdown>
  );
}
