import React from 'react';
import {
  Network,
  MediaImage,
  MagicWand,
  User,
  Community,
  Running,
  City,
  Shirt,
  Crop,
  Camera,
  Movie,
  Clock,
  Play,
  ViewGrid,
  Database,
} from 'iconoir-react';
const WORKFLOW_ICONS: Record<string, typeof Network> = {
  default: MediaImage,
  remaster: MagicWand,
  character: User,
  'character-lab': Community,
  'character-poses': Running,
  'character-sprites': Play,
  'character-scenes': City,
  'character-variants': Shirt,
  'character-transforms': Crop,
  camera: Camera,
  cinematic: Movie,
  timeline: Clock,
  'animation-sequence': Play,
  spritesheet: ViewGrid,
  'sprite-atlas': Database,
};

export default function WorkflowIcon({ id }: { id: string }) {
  const Icon = WORKFLOW_ICONS[id] ?? Network;
  return <Icon width={16} height={16} aria-hidden="true" />;
}
