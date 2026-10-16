import React, { useEffect, useId, useRef, useState } from 'react';
import { parseImageHashtags, type CatalogTagChanges } from '../packages/shared/src/catalogTags';
import {
  updateCatalogImage,
  notifyCatalogOrganizationChanged,
} from '../services/studio-api/catalog';
import type { GeneratedImage } from '../types';
import { useCatalogOrganization } from '../hooks/useCatalogOrganization';

export function ImageTagsEditor({
  images,
  onSaved,
  workspaceId = 'default',
}: {
  images: GeneratedImage[];
  onSaved?: () => void;
  workspaceId?: string;
}) {
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
      const results = await Promise.allSettled(
        imageTags.map(async (image) => {
          const result = await updateCatalogImage(image.id, changes);
          return { id: image.id, tags: result.tags };
        }),
      );
      const updated = new Map(
        results.flatMap((result) =>
          result.status === 'fulfilled' ? [[result.value.id, result.value.tags] as const] : [],
        ),
      );
      if (updated.size) {
        confirmedRef.current = true;
        setImageTags((current) =>
          current.map((image) => ({ ...image, tags: updated.get(image.id) ?? image.tags })),
        );
        onSaved?.();
        notifyCatalogOrganizationChanged();
      }
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length) {
        const cause = failed[0].reason;
        setError(
          `${failed.length} of ${imageTags.length} images could not be updated. ${cause instanceof Error ? cause.message : 'Try again.'}`,
        );
      } else {
        if (clearInput) setInput('');
        setSaved(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save tags. Try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section aria-label="Image tags" className="space-y-2 text-xs">
      <h3 className="text-[color:var(--wb-muted)]">Tags</h3>
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
                aria-label={`Add tag ${tag} to all selected images`}
                disabled={saving}
                onClick={() => void save({ addTags: [tag] })}
              >
                +
              </button>
            )}
            <button
              type="button"
              className="studio-ghost-control rounded px-1"
              aria-label={`Remove tag ${tag}`}
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
            setError(cause instanceof Error ? cause.message : 'Invalid hashtags.');
          }
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          Add hashtags
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
          placeholder="#character #boss"
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
          {saving ? 'Saving…' : 'Add tags'}
        </button>
      </form>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-[color:var(--wb-danger)]">
          {error} Your input is kept. Try again.
        </p>
      )}
      {!error && saved && (
        <p role="status" className="text-[color:var(--wb-muted)]">
          Tags saved.
        </p>
      )}
    </section>
  );
}
