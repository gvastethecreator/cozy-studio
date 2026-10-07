import { buildStylePromptText } from './stylePromptText';
import {
  Copy,
  FloppyDisk as Save,
  Sparks as Sparkles,
  Trash as Trash2,
  Upload,
  Xmark as X,
} from 'iconoir-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import type {
  CodexStyleReferenceImage,
  UserStyleDraftAction,
  UserStyleDraftFieldId,
  UserStylePreset,
  UserStylePresetDraft,
  UserStylePresetSource,
  UserStylePresetTask,
  UserStyleVisualDnaKey,
} from '../../packages/shared/src/userStyles';
import { USER_STYLE_SUPPORTED_TASKS } from '../../packages/shared/src/userStyles';
import {
  archiveUserStylePreset,
  createUserStylePreset,
  draftUserStylePreset,
  duplicateUserStylePreset,
  updateUserStylePreset,
} from '../../services/studio-api/userStyles';
import {
  USER_STYLE_DNA_FIELDS,
  createUserStyleDraftFromReferenceImages,
  createUserStyleReferenceImageSummary,
  createUserStyleInputFromDraft,
  createUserStyleVisualDna,
  mergeUserStyleDraftWithDisabledFields,
} from './userStyleDraftBuilders';

type UserStyleEditorMode = 'create' | 'edit';

interface UserStyleEditorSurfaceProps {
  sessionId: number;
  mode: UserStyleEditorMode;
  initialDraft: UserStylePresetDraft;
  initialSource: UserStylePresetSource | null;
  editingStyleId?: string;
  selectedStyleLayers?: unknown[];
  onClose: () => void;
  onSaved: (style: UserStylePreset) => void;
  onArchived: (style: UserStylePreset) => void;
}

const DRAFT_ACTIONS: Array<{ id: UserStyleDraftAction; label: string }> = [
  { id: 'draft_from_description', label: 'Draft' },
  { id: 'improve_draft', label: 'Improve' },
  { id: 'make_transferable', label: 'Transfer' },
  { id: 'audit_style_quality', label: 'Audit' },
];

const MAX_REFERENCE_IMAGES = 12;
const DEFAULT_REFERENCE_ASSIST_PROMPT =
  'Distill these references into a transferable style preset. Extract visual DNA only; avoid source pose, exact composition, readable text, logos, or character likeness.';

const DRAFT_FIELD_SWITCHES: Array<{ id: UserStyleDraftFieldId; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'category', label: 'Category' },
  { id: 'tags', label: 'Tags' },
  { id: 'supportedTasks', label: 'Tasks' },
  { id: 'creative_brief', label: 'Brief' },
  ...USER_STYLE_DNA_FIELDS.map((field) => ({ id: field.key, label: field.label })),
  { id: 'avoidRules', label: 'Avoid' },
];

type ReferenceImageItem = CodexStyleReferenceImage & {
  id: string;
  previewUrl: string;
  included: boolean;
};

function parseListText(value: string) {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of value.split(/[,;\n]/g)) {
    const clean = part.trim().replace(/\s+/g, ' ');
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(clean);
  }
  return list;
}

function uniqueTextList(values: string[]) {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(clean);
  }
  return list;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Style action failed.';
}

function taskLabel(task: UserStylePresetTask) {
  return task.replace(/_/g, ' ');
}

function formatFileSize(sizeBytes: number | undefined) {
  if (!sizeBytes || sizeBytes < 1) return '';
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripReferenceImage(item: ReferenceImageItem): CodexStyleReferenceImage {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    role: item.role,
    notes: item.notes,
  };
}

function mergeSourceData(sourceData: unknown, extraData: Record<string, unknown>) {
  if (sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData)) {
    return { ...sourceData, ...extraData };
  }
  if (sourceData === undefined || sourceData === null) return extraData;
  return { previous: sourceData, ...extraData };
}

const UserStyleEditorSession: React.FC<UserStyleEditorSurfaceProps> = ({
  mode,
  initialDraft,
  initialSource,
  editingStyleId,
  selectedStyleLayers = [],
  onClose,
  onSaved,
  onArchived,
}) => {
  const [draft, setDraft] = useState<UserStylePresetDraft>(initialDraft);
  const [source, setSource] = useState<UserStylePresetSource | null>(initialSource);
  const [section, setSection] = useState<'basics' | 'dna' | 'references' | 'assistant'>('basics');
  const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);
  const [disabledDraftFields, setDisabledDraftFields] = useState<UserStyleDraftFieldId[]>([]);
  const [tagsText, setTagsText] = useState(() => initialDraft.tags.join(', '));
  const [avoidRulesText, setAvoidRulesText] = useState(() => initialDraft.avoidRules.join('\n'));
  const [assistPrompt, setAssistPrompt] = useState('');
  const [assistAction, setAssistAction] = useState<UserStyleDraftAction>('draft_from_description');
  const [assistWarnings, setAssistWarnings] = useState<string[]>(initialDraft.warnings);
  const [isSaving, setIsSaving] = useState(false);
  const [isAssisting, setIsAssisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const referenceImageUrlsRef = useRef<string[]>([]);
  const dialogRef = useDialogFocus(true, onClose, undefined, '[aria-label="Close style editor"]');

  useEffect(
    () => () => {
      for (const url of referenceImageUrlsRef.current) URL.revokeObjectURL(url);
      referenceImageUrlsRef.current = [];
    },
    [],
  );

  const normalizedDraft = useMemo(
    () => ({
      ...draft,
      tags: parseListText(tagsText),
      avoidRules: parseListText(avoidRulesText),
      visualDna: createUserStyleVisualDna(draft.visualDna),
    }),
    [avoidRulesText, draft, tagsText],
  );

  const canSave = normalizedDraft.name.trim().length > 0 && !isSaving;
  const includedReferenceImages = useMemo(
    () => referenceImages.flatMap((image) => (image.included ? [stripReferenceImage(image)] : [])),
    [referenceImages],
  );
  const referenceSummary = useMemo(
    () => createUserStyleReferenceImageSummary(includedReferenceImages),
    [includedReferenceImages],
  );
  const disabledDraftFieldSet = useMemo(
    () => new Set<UserStyleDraftFieldId>(disabledDraftFields),
    [disabledDraftFields],
  );
  const updateDraft = <K extends keyof UserStylePresetDraft>(
    key: K,
    value: UserStylePresetDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateVisualDna = (key: UserStyleVisualDnaKey | 'creative_brief', value: string) => {
    setDraft((current) => ({
      ...current,
      visualDna: {
        ...current.visualDna,
        [key]: value,
      },
    }));
  };

  const toggleTask = (task: UserStylePresetTask) => {
    setDraft((current) => {
      const exists = current.supportedTasks.includes(task);
      const supportedTasks = exists
        ? current.supportedTasks.filter((item) => item !== task)
        : [...current.supportedTasks, task];
      return { ...current, supportedTasks };
    });
  };

  const toggleDraftField = (field: UserStyleDraftFieldId) => {
    setDisabledDraftFields((current) =>
      current.includes(field) ? current.filter((item) => item !== field) : [...current, field],
    );
  };

  const handleReferenceFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) {
      setAssistWarnings((current) =>
        uniqueTextList([...current, 'Only image files can be used as style references.']),
      );
      return;
    }

    const items = images.map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      referenceImageUrlsRef.current.push(previewUrl);
      return {
        id: `style-ref-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        role: 'style_reference' as const,
        notes: '',
        previewUrl,
        included: true,
      };
    });

    const referenceDraft = createUserStyleDraftFromReferenceImages(
      items.map(stripReferenceImage),
      assistPrompt,
    );
    if (referenceImages.length === 0 && normalizedDraft.name.trim() === 'Custom Style') {
      setDraft(referenceDraft);
      setTagsText(referenceDraft.tags.join(', '));
      setAvoidRulesText(referenceDraft.avoidRules.join('\n'));
      setAssistWarnings((current) => uniqueTextList([...current, ...referenceDraft.warnings]));
    }

    setReferenceImages((current) => {
      const openSlots = Math.max(0, MAX_REFERENCE_IMAGES - current.length);
      const accepted = items.slice(0, openSlots);
      for (const item of items.slice(openSlots)) URL.revokeObjectURL(item.previewUrl);
      return [...current, ...accepted];
    });
    setAssistAction('draft_from_description');
    setAssistPrompt((current) => current || DEFAULT_REFERENCE_ASSIST_PROMPT);
    setSource(
      (current) =>
        current ?? {
          kind: 'manual',
          note: 'Created from visual references in Style Editor.',
        },
    );
  };

  const handleRemoveReferenceImage = (id: string) => {
    setReferenceImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.id !== id);
    });
  };

  const updateReferenceImage = (
    id: string,
    patch: Partial<Pick<ReferenceImageItem, 'included' | 'notes' | 'role'>>,
  ) => {
    setReferenceImages((current) =>
      current.map((image) => (image.id === id ? { ...image, ...patch } : image)),
    );
  };

  const createSourceForSave = () => {
    const baseSource =
      source ??
      ({
        kind: 'manual',
        note: 'Created manually in Style Editor.',
      } satisfies UserStylePresetSource);
    if (includedReferenceImages.length === 0 && disabledDraftFields.length === 0) return baseSource;

    return {
      ...baseSource,
      note:
        baseSource.note ??
        (includedReferenceImages.length > 0
          ? 'Created with visual references in Style Editor.'
          : 'Created in Style Editor.'),
      data: mergeSourceData(baseSource.data, {
        ...(includedReferenceImages.length > 0
          ? {
              referenceImages: includedReferenceImages,
              referenceSummary,
            }
          : {}),
        ...(disabledDraftFields.length > 0 ? { disabledDraftFields } : {}),
      }),
    };
  };

  const handleAssist = async () => {
    setError(null);
    setIsAssisting(true);
    try {
      const description = [assistPrompt.trim(), referenceSummary].filter(Boolean).join('\n\n');
      const response = await draftUserStylePreset({
        action: assistAction,
        description,
        draft: normalizedDraft,
        selectedStyleLayers,
        referenceImages: includedReferenceImages,
        disabledFields: disabledDraftFields,
      });
      const nextDraft = mergeUserStyleDraftWithDisabledFields(
        normalizedDraft,
        response.draft,
        disabledDraftFields,
      );
      setDraft(nextDraft);
      setTagsText(nextDraft.tags.join(', '));
      setAvoidRulesText(nextDraft.avoidRules.join('\n'));
      setAssistWarnings(uniqueTextList([...nextDraft.warnings, ...response.warnings]));
      setSource({
        kind: 'codex_assist',
        note:
          includedReferenceImages.length > 0
            ? 'Created or revised through style assist with visual references.'
            : 'Created or revised through style assist.',
        data: {
          action: assistAction,
          source: response.source,
          referenceImages: includedReferenceImages,
          disabledDraftFields,
        },
      });
    } catch (assistError) {
      setError(getErrorMessage(assistError));
    } finally {
      setIsAssisting(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);
    try {
      const input = createUserStyleInputFromDraft(normalizedDraft, createSourceForSave());
      const saved =
        mode === 'edit' && editingStyleId
          ? await updateUserStylePreset(editingStyleId, input)
          : await createUserStylePreset(input);
      onSaved(saved);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!editingStyleId) return;
    setError(null);
    setIsSaving(true);
    try {
      const archived = await archiveUserStylePreset(editingStyleId);
      onArchived(archived);
    } catch (archiveError) {
      setError(getErrorMessage(archiveError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!editingStyleId) return;
    setError(null);
    setIsSaving(true);
    try {
      const duplicate = await duplicateUserStylePreset(editingStyleId);
      onSaved(duplicate);
    } catch (duplicateError) {
      setError(getErrorMessage(duplicateError));
    } finally {
      setIsSaving(false);
    }
  };

  const previewPrompt = buildStylePromptText({
    id: 'draft',
    name: normalizedDraft.name,
    category: normalizedDraft.category,
    style: normalizedDraft.visualDna,
  });
  const sections = ['basics', 'dna', 'references', 'assistant'] as const;
  const sectionLabels = {
    basics: 'Identity',
    dna: 'Visual DNA',
    references: 'References',
    assistant: 'Assistant',
  };

  return (
    <div
      data-user-style-editor
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Style editor"
      tabIndex={-1}
      className="studio-style-editor absolute inset-0 z-50 flex flex-col bg-[color:var(--wb-panel)] text-[color:var(--wb-ink)]"
    >
      <header className="user-style-header">
        <div>
          <p>{mode === 'edit' ? 'Custom style' : 'New custom style'}</p>
          <h2>{draft.name || 'Untitled style'}</h2>
        </div>
        <button type="button" aria-label="Close style editor" onClick={onClose}>
          <X width={18} height={18} />
        </button>
      </header>
      <div className="user-style-workspace">
        <nav
          className="user-style-navigation"
          role="tablist"
          aria-label="Style editor sections"
          aria-orientation="vertical"
        >
          {sections.map((id) => (
            <button
              key={id}
              id={`style-editor-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={section === id}
              aria-controls={`style-editor-${id}`}
              tabIndex={section === id ? 0 : -1}
              onClick={() => setSection(id)}
              onKeyDown={(event) => {
                if (
                  !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? sections[0]
                    : event.key === 'End'
                      ? sections[3]
                      : sections[
                          (sections.indexOf(id) +
                            (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 3)) %
                            4
                        ];
                setSection(next);
                document.getElementById(`style-editor-tab-${next}`)?.focus();
              }}
            >
              {sectionLabels[id]}
            </button>
          ))}
        </nav>
        <section
          className="user-style-form"
          role="tabpanel"
          id={`style-editor-${section}`}
          aria-labelledby={`style-editor-tab-${section}`}
        >
          {section === 'basics' && (
            <>
              <h3>Give your style an identity</h3>
              <label>
                Name
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft('name', event.target.value)}
                  maxLength={160}
                />
              </label>
              <label>
                Category
                <input
                  value={draft.category}
                  onChange={(event) => updateDraft('category', event.target.value)}
                />
              </label>
              <label>
                Tags
                <input
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  placeholder="Separate tags with commas"
                />
              </label>
              <label>
                Creative brief
                <textarea
                  value={draft.visualDna.creative_brief ?? ''}
                  onChange={(event) => updateVisualDna('creative_brief', event.target.value)}
                  rows={4}
                />
              </label>
              <fieldset>
                <legend>Use this style for</legend>
                <div className="user-style-chip-list">
                  {USER_STYLE_SUPPORTED_TASKS.map((task) => (
                    <button
                      key={task}
                      type="button"
                      aria-pressed={draft.supportedTasks.includes(task)}
                      onClick={() => toggleTask(task)}
                    >
                      {taskLabel(task)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {section === 'dna' && (
            <>
              <h3>Define the visual language</h3>
              <div className="user-style-dna-fields">
                {USER_STYLE_DNA_FIELDS.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <textarea
                      value={draft.visualDna[field.key] ?? ''}
                      onChange={(event) => updateVisualDna(field.key, event.target.value)}
                      rows={3}
                    />
                  </label>
                ))}
              </div>
              <label>
                Avoid
                <textarea
                  value={avoidRulesText}
                  onChange={(event) => setAvoidRulesText(event.target.value)}
                  rows={3}
                />
              </label>
            </>
          )}
          {section === 'references' && (
            <>
              <h3>Collect visual references</h3>
              <label className="user-style-upload">
                <Upload width={24} height={24} />
                Add reference images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  aria-label="Add style reference images"
                  onChange={(event) => {
                    handleReferenceFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              <p>
                {includedReferenceImages.length} of {MAX_REFERENCE_IMAGES} references included
              </p>
              <div className="user-style-reference-grid">
                {referenceImages.map((image) => (
                  <article key={image.id}>
                    <img src={image.previewUrl} alt={image.name} />
                    <p>
                      {image.name} · {formatFileSize(image.sizeBytes)}
                    </p>
                    <div className="user-style-chip-list">
                      <button
                        type="button"
                        aria-pressed={image.included}
                        onClick={() =>
                          updateReferenceImage(image.id, { included: !image.included })
                        }
                      >
                        {image.included ? 'Included' : 'Excluded'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateReferenceImage(image.id, {
                            role:
                              image.role === 'avoid_reference'
                                ? 'style_reference'
                                : 'avoid_reference',
                          })
                        }
                      >
                        {image.role === 'avoid_reference' ? 'Avoid' : 'Style reference'}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${image.name}`}
                        onClick={() => handleRemoveReferenceImage(image.id)}
                      >
                        <X width={14} height={14} />
                      </button>
                    </div>
                    <label>
                      Reference notes
                      <input
                        value={image.notes ?? ''}
                        onChange={(event) =>
                          updateReferenceImage(image.id, { notes: event.target.value })
                        }
                      />
                    </label>
                  </article>
                ))}
              </div>
            </>
          )}
          {section === 'assistant' && (
            <>
              <h3>Develop your style</h3>
              <label>
                Action
                <select
                  value={assistAction}
                  onChange={(event) => setAssistAction(event.target.value as UserStyleDraftAction)}
                >
                  {DRAFT_ACTIONS.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Instructions
                <textarea
                  aria-label="Style assistant instructions"
                  value={assistPrompt}
                  onChange={(event) => setAssistPrompt(event.target.value)}
                  rows={6}
                  placeholder="Describe the visual language you want to create or improve."
                />
              </label>
              <details>
                <summary>Fields the assistant can change</summary>
                <div className="user-style-chip-list">
                  {DRAFT_FIELD_SWITCHES.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      aria-pressed={!disabledDraftFieldSet.has(field.id)}
                      onClick={() => toggleDraftField(field.id)}
                    >
                      {field.label}
                    </button>
                  ))}
                </div>
              </details>
              <button
                type="button"
                className="studio-primary-control"
                onClick={handleAssist}
                disabled={isAssisting || isSaving}
              >
                <Sparkles width={16} height={16} />
                {isAssisting ? 'Working…' : 'Apply assistant draft'}
              </button>
            </>
          )}
        </section>
        <aside className="user-style-preview" aria-label="Style draft preview">
          <h3>Prompt preview</h3>
          <p>{normalizedDraft.category || 'Uncategorized'}</p>
          <pre>{previewPrompt}</pre>
          {normalizedDraft.avoidRules.length > 0 && (
            <>
              <h4>Avoid</h4>
              <p>{normalizedDraft.avoidRules.join(', ')}</p>
            </>
          )}
          {assistWarnings.map((warning) => (
            <p key={warning} className="text-[color:var(--wb-warning)]">
              {warning}
            </p>
          ))}
        </aside>
      </div>
      <footer className="user-style-footer">
        <div className="user-style-chip-list">
          {mode === 'edit' && (
            <>
              <button type="button" onClick={handleDuplicate} disabled={isSaving || isAssisting}>
                <Copy width={14} height={14} />
                Duplicate
              </button>
              <button type="button" onClick={handleArchive} disabled={isSaving || isAssisting}>
                <Trash2 width={14} height={14} />
                Archive
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[color:var(--wb-danger)]">
            {error}
          </p>
        )}
        <button
          type="button"
          className="studio-primary-control"
          onClick={handleSave}
          disabled={!canSave || isAssisting}
        >
          <Save width={16} height={16} />
          {isSaving ? 'Saving…' : 'Save style'}
        </button>
      </footer>
    </div>
  );
};

export const UserStyleEditorSurface: React.FC<UserStyleEditorSurfaceProps> = (props) => (
  <UserStyleEditorSession key={props.sessionId} {...props} />
);
