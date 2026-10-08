import React from 'react';
import type { PreferredWorkflow } from '../../packages/shared/src/workflowCatalog';
import defaultArt from '../../assets/workflow-cards/default.webp';
import remasterArt from '../../assets/workflow-cards/remaster.webp';
import characterPosesArt from '../../assets/workflow-cards/character-poses.webp';
import characterSpritesArt from '../../assets/workflow-cards/character-sprites.webp';
import characterScenesArt from '../../assets/workflow-cards/character-scenes.webp';
import characterVariantsArt from '../../assets/workflow-cards/character-variants.webp';
import characterTransformsArt from '../../assets/workflow-cards/character-transforms.webp';
import characterArt from '../../assets/workflow-cards/character.webp';
import characterLabArt from '../../assets/workflow-cards/character-lab.webp';
import cameraArt from '../../assets/workflow-cards/camera.webp';
import cinematicArt from '../../assets/workflow-cards/cinematic.webp';
import timelineArt from '../../assets/workflow-cards/timeline.webp';
import animationSequenceArt from '../../assets/workflow-cards/animation-sequence.webp';
import spritesheetArt from '../../assets/workflow-cards/spritesheet.webp';
import spriteAtlasArt from '../../assets/workflow-cards/sprite-atlas.webp';

const WORKFLOW_CARDS: Record<PreferredWorkflow, { description: string; image: string }> = {
  default: { description: 'Turn a prompt and references into an image.', image: defaultArt },
  remaster: { description: 'Restore detail and refine an existing image.', image: remasterArt },
  'character-poses': {
    description: 'Explore poses and expressions with the same identity.',
    image: characterPosesArt,
  },
  'character-sprites': {
    description: 'Build a sprite action with a chosen frame count.',
    image: characterSpritesArt,
  },
  'character-scenes': {
    description: 'Place your character in a new environment.',
    image: characterScenesArt,
  },
  'character-variants': {
    description: 'Try new outfits, equipment and character variants.',
    image: characterVariantsArt,
  },
  'character-transforms': {
    description: 'Change framing, lighting and the canvas.',
    image: characterTransformsArt,
  },
  character: { description: 'Create a consistent character reference sheet.', image: characterArt },
  'character-lab': {
    description: 'All character tools in one creative workspace.',
    image: characterLabArt,
  },
  camera: {
    description: 'Reframe a scene with camera and perspective controls.',
    image: cameraArt,
  },
  cinematic: {
    description: 'Compose a story as a series of cinematic shots.',
    image: cinematicArt,
  },
  timeline: {
    description: 'Arrange shots and shape their timing on a timeline.',
    image: timelineArt,
  },
  'animation-sequence': {
    description: 'Generate connected frames and preview the motion.',
    image: animationSequenceArt,
  },
  spritesheet: {
    description: 'Create a clean grid of consistent sprite frames.',
    image: spritesheetArt,
  },
  'sprite-atlas': {
    description: 'Organize sprite actions into a structured atlas.',
    image: spriteAtlasArt,
  },
};

export function WorkflowCardArt({ id }: { id: PreferredWorkflow }) {
  return (
    <img
      className="create-workflow-card-art"
      src={WORKFLOW_CARDS[id].image}
      width={640}
      height={480}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

export function WorkflowCardDescription({ id }: { id: PreferredWorkflow }) {
  return <>{WORKFLOW_CARDS[id].description}</>;
}
