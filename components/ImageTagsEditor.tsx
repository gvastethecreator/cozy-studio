import { organizeWithUndo } from '../hooks/useCatalogOrganization';
import React, { useEffect, useId, useRef, useState } from 'react';
import { parseImageHashtags, type CatalogTagChanges } from '../packages/shared/src/catalogTags';
import type { GeneratedImage } from '../types';
import { applyOrganizeResult, useCatalogOrganization } from '../hooks/useCatalogOrganization';
import { CATALOG_ORGANIZATION_CHANGED } from '../services/studio-api/catalog';
import type { CatalogOrganizeResult } from '../packages/shared/src';
import { useT } from '../lib/i18n';

export function ImageTagsEditor({
  images,
  onSaved,
  workspaceId = 'default',
}: {
  images: GeneratedImage[];
  onSaved?: () => void;
  workspaceId?: string;
}) {
  const { t } = useT();
  const { tags: definitions } = useCatalogOrganization(workspaceId);
  const inputId = useId();
  const [imageTags, setImageTags] = useState(() =>
    images.map((image) => ({ id: image.id, tags: image.tags ?? [] })),
  );
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const confirmedRef = useRef(false);
  useEffect(() => {
    const onOrganized = (event: Event) => {
      const result = (event as CustomEvent<CatalogOrganizeResult | undefined>).detail;
      if (!result || result.workspaceId !== workspaceId) return;
      confirmedRef.current = true;
      setImageTags((current) =>
        current.map((image) => ({
          ...image,
          tags: applyOrganizeResult(image.id, image.tags, result),
        })),
      );
    };
    window.addEventListener(CATALOG_ORGANIZATION_CHANGED, onOrganized);
    return () => window.removeEventListener(CATALOG_ORGANIZATION_CHANGED, onOrganized);
  }, [workspaceId]);
  const tagsKey = JSON.stringify(images.map((image) => ({ id: image.id, tags: image.tags ?? [] })));
  useEffect(() => {
    // A delayed catalog refresh must not replace this editor's confirmed save.
    if (!confirmedRef.current) setImageTags(JSON.parse(tagsKey));
  }, [tagsKey]);
  const tagCounts = new Map<string, number>();
  const tagColors = new Map(definitions.map((tag) => [tag.name, tag.color ?? undefined]));
  for (const image of imageTags) {
    for (const tag of image.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const save = async (changes: CatalogTagChanges, clearInput = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setError('');
    setSaved(false);
    try {
      setSaving(true);
      // All or nothing: a rejected call changes no image.
      const result = await organizeWithUndo({
        workspaceId,
        imageIds: imageTags.map((image) => image.id),
        ...changes,
      });
      confirmedRef.current = true;
      setImageTags((current) =>
        current.map((image) => ({
          ...image,
          tags: applyOrganizeResult(image.id, image.tags, result),
        })),
      );
      onSaved?.();
      if (clearInput) setInput('');
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('library.picker.saveTagsError'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section aria-label={t('library.picker.imageTags')} className="space-y-2 text-xs">
      <h3 className="text-[color:var(--wb-muted)]">{t('library.picker.tags')}</h3>
      <div className="flex flex-wrap gap-1.5">
        {[...tagCounts].map(([tag, count]) => (
          <span
            key={tag}
            style={{ borderColor: tagColors.get(tag) }}
            className="inline-flex max-w-full items-center gap-1 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] px-2 py-1"
          >
            <span className="break-all">{tag.includes(' ') ? tag : `#${tag}`}</span>
            {imageTags.length > 1 && (
              <span className="text-[color:var(--wb-muted)]">
                {count}/{imageTags.length}
              </span>
            )}
            {count < imageTags.length && (
              <button
                type="button"
                className="studio-ghost-control rounded px-1"
                aria-label={t('library.picker.addTagToAll', { tag })}
                disabled={saving}
                onClick={() => void save({ addTags: [tag] })}
              >
                +
              </button>
            )}
            <button
              type="button"
              className="studio-ghost-control rounded px-1"
              aria-label={t('library.picker.removeTag', { tag })}
              disabled={saving}
              onClick={() => void save({ removeTags: [tag] })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const added = parseImageHashtags(input);
            if (added.length) void save({ addTags: added }, true);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('library.picker.invalidHashtags'));
          }
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          {t('library.picker.addHashtags')}
        </label>
        <input
          id={inputId}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setError('');
            setSaved(false);
          }}
          disabled={saving}
          placeholder={t('library.picker.hashtagPlaceholder')}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          maxLength={2200}
          className="studio-well min-w-0 flex-1 px-2 py-2"
        />
        <button
          type="submit"
          disabled={saving || !input.trim()}
          className="studio-ghost-control rounded px-3 py-2"
        >
          {saving ? t('library.picker.saving') : t('library.picker.addTags')}
        </button>
      </form>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-[color:var(--wb-danger)]">
          {error} {t('library.picker.inputKept')}
        </p>
      )}
      {!error && saved && (
        <p role="status" className="text-[color:var(--wb-muted)]">
          {t('library.picker.tagsSaved')}
        </p>
      )}
    </section>
  );
}
