import type { GenerationProviderId, GenerationTaskSpec } from './generationContracts';

export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2.6-flare';

export const DIRECT_GIF_IMAGE_MODELS = ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'] as const;

export function supportsDirectGifGeneration(
  providerId: GenerationProviderId,
  imageModel: string | null | undefined,
): boolean {
  return providerId === 'openai' && DIRECT_GIF_IMAGE_MODELS.some((model) => model === imageModel);
}

export function collectDirectGifJobIssues({
  providerId,
  imageModel,
  sourceSpec,
}: {
  providerId: GenerationProviderId;
  imageModel: string | null | undefined;
  sourceSpec?:
    | (Pick<GenerationTaskSpec, 'task' | 'output'> & { assets: readonly unknown[] })
    | null;
}): Array<{ code: string; field: string; message: string }> {
  if (sourceSpec?.output.mimeType !== 'image/gif') return [];
  if (!supportsDirectGifGeneration(providerId, imageModel)) {
    return [
      {
        code: 'gif_output_unavailable',
        field: 'sourceSpec.output.mimeType',
        message:
          'Animated GIF output requires GPT Image 2.6 Flare or Sunburst through the OpenAI Images API.',
      },
    ];
  }
  if (sourceSpec.task !== 'image_generate' || sourceSpec.assets.length > 0) {
    return [
      {
        code: 'gif_task_unsupported',
        field: 'sourceSpec.task',
        message: 'Animated GIF output supports text-to-image generation without input images.',
      },
    ];
  }
  if (sourceSpec.output.count !== 1) {
    return [
      {
        code: 'gif_output_count_unsupported',
        field: 'sourceSpec.output.count',
        message: 'Animated GIF output requires exactly one animation per job.',
      },
    ];
  }
  if (sourceSpec.output.background === 'transparent') {
    return [
      {
        code: 'gif_transparency_unsupported',
        field: 'sourceSpec.output.background',
        message: 'Animated GIF output requires an automatic or opaque background.',
      },
    ];
  }
  return [];
}
