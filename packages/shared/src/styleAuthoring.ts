export const STYLE_AUTHORING_MAX_REQUEST_BYTES = 96 * 1024;
export const STYLE_AUTHORING_MAX_OUTPUT_CHARS = 128 * 1024;

export interface StyleAuthoringRequest {
  instructions: string;
  prompt: string;
  schema?: Record<string, unknown>;
}

export interface StyleAuthoringResult {
  text: string;
}

export interface StyleAuthoringCapabilities {
  available: boolean;
  reason: string | null;
}

export function parseStyleAuthoringRequest(value: unknown): StyleAuthoringRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a style authoring request.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['instructions', 'prompt', 'schema'].includes(key)))
    throw new TypeError('Unknown style authoring request field.');
  for (const [key, limit] of [
    ['instructions', 24_000],
    ['prompt', 24_000],
  ] as const) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > limit)
      throw new TypeError(`${key} must contain between 1 and ${limit} characters.`);
  }
  if (input.schema !== undefined) {
    if (
      !input.schema ||
      typeof input.schema !== 'object' ||
      Array.isArray(input.schema) ||
      (input.schema as Record<string, unknown>).type !== 'object' ||
      JSON.stringify(input.schema).length > 48_000
    )
      throw new TypeError('schema must be an object JSON schema of at most 48000 characters.');
  }
  return {
    instructions: input.instructions as string,
    prompt: input.prompt as string,
    ...(input.schema === undefined ? {} : { schema: input.schema as Record<string, unknown> }),
  };
}
