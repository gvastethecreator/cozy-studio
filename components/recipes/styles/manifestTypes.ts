import type { StylePackProject } from '../../../packages/shared/src/extensions';
import type { StyleVisualDna } from './runtimeTypes';

export type StylePresetManifestTask =
  | 'image_generate'
  | 'image_edit'
  | 'style_preset_card'
  | 'sprite_sheet'
  | 'texture_generate';

export interface StylePresetManifestAssets {
  defaultImage?: string;
  previewImage?: string;
  referenceImage?: string;
}

export interface StylePresetManifestAttributes {
  negativePrompt?: string;
  camera?: unknown;
  render?: unknown;
  type?: unknown;
  ui?: unknown;
  layout?: unknown;
  materials?: unknown;
  print?: unknown;
  digital?: unknown;
  [key: string]: unknown;
}

export interface StylePresetEditorialTaxonomy {
  packId: string;
  packName: string;
  categoryId: string;
  categoryName: string;
  domain?: string;
  tags: string[];
  supportedTasks: StylePresetManifestTask[];
  hasDefaultImage: boolean;
}

export interface StylePresetManifest {
  schemaVersion: 1;
  id: string;
  packId: string;
  name: string;
  displayName?: string;
  styleAnchors?: string[];
  category: string;
  domain?: string;
  version: number;
  supportedTasks: StylePresetManifestTask[];
  tags: string[];
  visualDna: StyleVisualDna;
  avoidRules: string[];
  assets: StylePresetManifestAssets;
  taxonomy?: Partial<StylePresetEditorialTaxonomy>;
  attributes?: StylePresetManifestAttributes;
}

export interface StylePackManifestCategory {
  id: string;
  name: string;
  presetRefs: string[];
}

export interface StylePackManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  cardTitle?: string;
  cardDescription?: string;
  /** Search tags; the extension manifest carries them to Studio's style search. */
  tags?: string[];
  categories: StylePackManifestCategory[];
  presetRefs: string[];
  /** A private project pack names its project; the extension manifest carries it to Studio. */
  project?: StylePackProject;
}
