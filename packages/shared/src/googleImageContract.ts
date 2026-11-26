export const GOOGLE_IMAGE_MODELS = [
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
] as const;

export type GoogleImageModel = (typeof GOOGLE_IMAGE_MODELS)[number];

export type GoogleImageSize = '512px' | '1K' | '2K' | '4K';

export const DEFAULT_GOOGLE_IMAGE_MODEL: GoogleImageModel = 'gemini-nano-banana-2.1';

export const GOOGLE_IMAGE_SIZES_BY_MODEL = {
  'gemini-nano-banana-2.1': ['1K', '2K', '4K'],
  'gemini-3.1-flash-lite-image': ['1K'],
  'gemini-3.1-flash-image': ['512px', '1K', '2K', '4K'],
  'gemini-3-pro-image': ['1K', '2K', '4K'],
} as const satisfies Record<GoogleImageModel, readonly GoogleImageSize[]>;

export interface GoogleImageModelOption {
  id: GoogleImageModel;
  displayName: string;
  shortName: string;
  sizes: readonly GoogleImageSize[];
}

export const GOOGLE_IMAGE_MODEL_OPTIONS: readonly GoogleImageModelOption[] = [
  {
    id: 'gemini-nano-banana-2.1',
    displayName: 'Nano Banana 2.1',
    shortName: 'NB 2.1',
    sizes: GOOGLE_IMAGE_SIZES_BY_MODEL['gemini-nano-banana-2.1'],
  },
  {
    id: 'gemini-3.1-flash-image',
    displayName: 'Gemini 3.1 Flash Image',
    shortName: '3.1 Flash',
    sizes: GOOGLE_IMAGE_SIZES_BY_MODEL['gemini-3.1-flash-image'],
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    displayName: 'Gemini 3.1 Flash Lite',
    shortName: '3.1 Lite',
    sizes: GOOGLE_IMAGE_SIZES_BY_MODEL['gemini-3.1-flash-lite-image'],
  },
  {
    id: 'gemini-3-pro-image',
    displayName: 'Gemini 3 Pro Image',
    shortName: '3 Pro',
    sizes: GOOGLE_IMAGE_SIZES_BY_MODEL['gemini-3-pro-image'],
  },
];

export function isGoogleImageModel(value: unknown): value is GoogleImageModel {
  return typeof value === 'string' && (GOOGLE_IMAGE_MODELS as readonly string[]).includes(value);
}

export function resolveGoogleImageModel(value?: string | null): GoogleImageModel {
  return isGoogleImageModel(value) ? value : DEFAULT_GOOGLE_IMAGE_MODEL;
}

export function getGoogleImageModelOption(value?: string | null): GoogleImageModelOption {
  const model = resolveGoogleImageModel(value);
  return (
    GOOGLE_IMAGE_MODEL_OPTIONS.find((option) => option.id === model) ??
    GOOGLE_IMAGE_MODEL_OPTIONS[0]!
  );
}

export function normalizeGoogleImageSizeTier(
  value: string | null | undefined,
): GoogleImageSize | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper === '512' || upper === '512PX' || upper === '0.5K') return '512px';
  if (upper === '1K' || upper === '2K' || upper === '4K') return upper;
  return null;
}

export function isGoogleImageSizeSupported(model: GoogleImageModel, size: string) {
  const normalized = normalizeGoogleImageSizeTier(size) ?? size;
  return (GOOGLE_IMAGE_SIZES_BY_MODEL[model] as readonly string[]).includes(normalized);
}
