import { MAX_CATALOG_COLLECTION_NAME } from './catalogCollections';
import { normalizeImageHashtag } from './catalogTags';
import type { GenerationTaskSpec } from './generationContracts';
import { isRecord } from './types';

/**
 * Organize while generating: when a job carries no Library organization of its own, Studio files
 * its images with tags from facts the job already has (workflow, task, style pack and preset), and
 * a batch of two or more jobs gets one collection.
 */
type JobFacts = {
  kind: string;
  sourceSpec?: Pick<GenerationTaskSpec, 'recipeId' | 'recipeParams' | 'stylePresetId'> | null;
};

const MAX_AUTO_TAGS = 8;

// Plain image generation is the default task, so it adds no tag.
const TASK_TAGS: Record<string, string> = {
  image_edit: 'edit',
  style_preset_card: 'style-preview',
  sprite_sheet: 'sprite-sheet',
  texture_generate: 'texture',
};

const TASK_LABELS: Record<string, string> = {
  image_generate: 'Images',
  image_edit: 'Edits',
  style_preset_card: 'Style previews',
  sprite_sheet: 'Sprite sheets',
  texture_generate: 'Textures',
};

function toTag(value: unknown) {
  if (typeof value !== 'string') return null;
  const slug = value
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  try {
    return slug ? normalizeImageHashtag(slug) : null;
  } catch {
    return null;
  }
}

function selectedStyles(facts: JobFacts) {
  const params = facts.sourceSpec?.recipeParams;
  const styles = Array.isArray(params?.selectedStyles)
    ? params.selectedStyles.filter(isRecord)
    : [];
  if (styles.length) return styles;
  // A style preview card names only its preset. Built-in preset ids carry their pack: SP35 is pack_35.
  const presetId = facts.sourceSpec?.stylePresetId;
  if (!presetId) return [];
  const pack = /^SP(\d{2})-/i.exec(presetId)?.[1];
  return [{ presetId, ...(pack && { packId: `pack_${pack}` }) }];
}

export function deriveLibraryTags(facts: JobFacts): string[] {
  const recipeId = facts.sourceSpec?.recipeId;
  const candidates = [
    // The styles workflow adds its pack and preset tags below.
    recipeId === 'styles' ? null : recipeId,
    TASK_TAGS[facts.kind],
    ...selectedStyles(facts).flatMap((style) => [style.packId, style.presetId]),
  ];
  const tags = candidates.flatMap((value) => toTag(value) ?? []);
  return [...new Set(tags)].slice(0, MAX_AUTO_TAGS);
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** "Akira - Otomo Light-Trail Collapse · 2026-11-22 14:05", in local time. */
export function deriveBatchCollectionName(facts: JobFacts, createdAt: Date) {
  const styleNames = selectedStyles(facts).flatMap((style) =>
    typeof style.presetName === 'string' && style.presetName.trim()
      ? [style.presetName.trim()]
      : [],
  );
  const recipeId = facts.sourceSpec?.recipeId;
  const label =
    styleNames.join(' + ') ||
    (recipeId && recipeId !== 'styles'
      ? recipeId.replace(/[-_]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())
      : (TASK_LABELS[facts.kind] ?? 'Images'));
  const stamp = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`;
  const room = MAX_CATALOG_COLLECTION_NAME - stamp.length - 3;
  const shortLabel = label.length > room ? `${label.slice(0, room - 1).trimEnd()}…` : label;
  return `${shortLabel} · ${stamp}`;
}
