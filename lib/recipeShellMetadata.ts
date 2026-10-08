import type { RecipeId } from '../types';
import { extractRecipeIdFromRecipeContext } from '../packages/shared/src/promptTransport';
import { isRegisteredRecipeId, type RegisteredRecipeId } from './recipeIds';

const RECIPE_SHELL_TITLES: Record<RegisteredRecipeId, string> = {
  'animation-sequence': 'Animation Sequence',
  styles: 'Styles',
  remaster: 'Remaster',
  spritesheet: 'Sprite Sheet',
  'sprite-atlas': 'Sprite Atlas',
  cinematic: 'Cinematic Storyboard',
  'character-lab': 'Character Lab',
  character: 'Character Sheet',
  camera: 'Camera View',
  timeline: 'Timeline Frame',
};

export const RECIPE_PROMPT_PLACEHOLDERS: Partial<Record<RegisteredRecipeId, string>> = {
  remaster: 'Describe what to restore or change in the source image…',
  character: 'Describe the character, identity, and details for the reference sheet…',
  spritesheet: 'Describe the character and action for the sprite sheet…',
  camera: 'Describe the scene and details to preserve in this camera view…',
  cinematic: 'Describe the scene and story for this storyboard…',
  timeline: 'Describe what happens around the selected frame…',
  styles: 'Describe the image to create with your style mix…',
};

export function getRecipeShellTitle(recipeId: RegisteredRecipeId) {
  return RECIPE_SHELL_TITLES[recipeId] ?? recipeId;
}

export function parseRecipeIdFromContext(context: string = ''): RecipeId {
  const recipeId = extractRecipeIdFromRecipeContext(context);
  return isRegisteredRecipeId(recipeId) ? recipeId : null;
}
