import type { GeneratedImageWithConfig } from '../types';
import { getActiveRecipeIndicator } from './activeRecipeIndicator';
import { isRegisteredRecipeId } from './recipeIds';

// Output files are named from a date, a time and a counter, and imported references from a hash.
const GENERATED_FILE_NAME =
  /^\d{4}-\d{2}-\d{2}[_T]|^[0-9a-f]{16,}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-/i;

/** A file name a person chose, without its extension; null when Studio or a hash named the file. */
export function readableFileTitle(localPath: string | undefined) {
  const name = localPath?.split(/[\\/]/).pop() ?? '';
  const stem = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  if (!stem || stem.length > 80 || !/\p{L}/u.test(stem) || GENERATED_FILE_NAME.test(stem))
    return null;
  return stem;
}

function styleNames(recipeParams: Record<string, unknown> | null | undefined) {
  const selected = Array.isArray(recipeParams?.selectedStyles) ? recipeParams.selectedStyles : [];
  const names = selected.flatMap((style: unknown) => {
    const name = (style as { presetName?: unknown } | null)?.presetName;
    return typeof name === 'string' && name.trim() ? [name.trim()] : [];
  });
  if (names.length) return names;
  const preset = recipeParams?.presetName;
  return typeof preset === 'string' && preset.trim() ? [preset.trim()] : [];
}

/**
 * The card title: a readable file name, else the style and workflow, else the prompt. Many prompts
 * open with the same technical instruction, so the prompt alone often reads the same on every card.
 */
export function libraryCardTitle(
  image: Pick<GeneratedImageWithConfig, 'localPath' | 'config' | 'styleName'>,
) {
  const prompt = image.config.prompt?.trim() || 'Untitled image';
  const fileTitle = readableFileTitle(image.localPath);
  if (fileTitle) return fileTitle;
  const recipeId = image.config.recipeId;
  const recipe =
    recipeId && recipeId !== 'styles' && isRegisteredRecipeId(recipeId)
      ? getActiveRecipeIndicator(recipeId)?.title
      : null;
  const styles = image.styleName ? [image.styleName] : styleNames(image.config.recipeParams);
  if (styles.length) return [styles.join(' + '), recipe].filter(Boolean).join(' · ');
  return recipe ? `${recipe} · ${prompt}` : prompt;
}
