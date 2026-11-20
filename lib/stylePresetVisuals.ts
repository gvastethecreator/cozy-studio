import type { GeneratedImageWithConfig } from '../types';

export type StylePresetCardImageKind = 'result' | 'default' | 'variant' | 'preview';

export interface StylePresetCardImage {
  kind: StylePresetCardImageKind;
  src: string;
  label: string;
}

export interface StylePresetImageVariant {
  src: string;
  label: string;
}

export function resolveStylePreviewImage({
  categoryImage,
  categoryPreviewImage,
  packFallbackImage,
}: {
  categoryImage?: string;
  categoryPreviewImage?: string;
  packFallbackImage?: string;
}) {
  return categoryImage || categoryPreviewImage || packFallbackImage;
}

export function resolveStylePresetCardImages({
  resultImages,
  defaultImage,
  defaultImageVariants = [],
  previewImage,
}: {
  resultImages: GeneratedImageWithConfig[];
  defaultImage?: string;
  defaultImageVariants?: StylePresetImageVariant[];
  previewImage?: string;
}): StylePresetCardImage[] {
  const seen = new Set<string>();
  const images: StylePresetCardImage[] = [];
  const add = (image: StylePresetCardImage) => {
    if (!image.src || seen.has(image.src)) return;
    seen.add(image.src);
    images.push(image);
  };

  for (const image of resultImages) {
    add({
      kind: 'result',
      src: image.thumbnail || image.preview || image.src,
      label: 'Generated',
    });
  }

  if (defaultImage) add({ kind: 'default', src: defaultImage, label: 'Card' });
  for (const variant of defaultImageVariants)
    add({ kind: 'variant', src: variant.src, label: variant.label });

  if (images.length === 0 && previewImage) {
    add({ kind: 'preview', src: previewImage, label: 'Preview' });
  }

  return images;
}
