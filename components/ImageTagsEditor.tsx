import React, { useEffect, useId, useRef, useState } from 'react';
import { parseImageHashtags, type CatalogTagChanges } from '../packages/shared/src/catalogTags';
import { updateCatalogImage } from '../services/studio-api/catalog';
import type { GeneratedImage } from '../types';

export function ImageTagsEditor({ image }: { image: GeneratedImage }) {
  const inputId = useId();
  const [tags, setTags] = useState(image.tags ?? []);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  const confirmedRef = useRef(false);
  const tagsKey = JSON.stringify(image.tags ?? []);
  useEffect(() => {
    // A delayed catalog refresh must not replace this editor's confirmed save.
    if (!confirmedRef.current) setTags(JSON.parse(tagsKey) as string[]);
  }, [tagsKey]);

  const save = async (changes: CatalogTagChanges, clearInput = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setError('');
    setSaved(false);
    try {
      setSaving(true);
      const result = await updateCatalogImage(image.id, changes);
      confirmedRef.current = true;
      setTags(result.tags);
      if (clearInput) setInput('');
      setSaved(true);
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
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex max-w-full items-center gap-1 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] px-2 py-1"
          >
            <span className="break-all">{tag.includes(' ') ? tag : `#${tag}`}</span>
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
        {tags.length === 0 && <span className="text-[color:var(--wb-muted)]">No tags yet</span>}
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
          aria-describedby={`${inputId}-help`}
          aria-invalid={!!error}
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
      <p id={`${inputId}-help`} className="text-[color:var(--wb-muted)]">
        Separate hashtags with spaces or commas. Press Enter to save. Search Library with #tag;
        multiple hashtags match all tags.
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--wb-danger)]">
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
