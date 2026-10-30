import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createGenerationTaskSpec } from '../../../../packages/shared/src';
import { compileReplicateImageApiInput } from './externalProviderInputs';
import { createReplicateImageExecutor } from './replicateExecutor';
import { getExternalProviderRuntimePreflight } from './runtimeConfig';

const WEBP_BYTES = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);

describe('Replicate executor', () => {
  it('runs a synchronous prediction and downloads its first output', async () => {
    const env = { REPLICATE_API_TOKEN: 'secret-replicate-value' };
    const job = {
      id: 'job-replicate',
      workspaceId: 'workspace-1',
      providerId: 'replicate' as const,
      prompt: 'fallback prompt',
      sourceSpec: createGenerationTaskSpec({
        id: 'spec-replicate',
        task: 'image_generate',
        providerId: 'replicate',
        prompt: 'small brass key',
        output: { aspectRatio: '16:9' },
      }),
    };
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const writes: string[] = [];
    const executor = createReplicateImageExecutor({
      env,
      fetch: async (input, init) => {
        calls.push({ input: input as string, init });
        if (calls.length === 1) {
          return new Response(
            JSON.stringify({
              status: 'succeeded',
              output: ['https://replicate.delivery/out.webp'],
            }),
          );
        }
        return new Response(WEBP_BYTES, { headers: { 'content-type': 'image/webp' } });
      },
      resolveLibraryPath: (...segments) => `D:/studio-library/${segments.join('/')}`,
      mkdir: (() => undefined) as typeof import('node:fs').mkdirSync,
      writeFile: ((filePath, content) => {
        writes.push(`${String(filePath)} ${typeof content === 'string' ? content : ''}`);
      }) as typeof import('node:fs').writeFileSync,
      now: () => 1000,
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        executor({
          providerId: 'replicate',
          job,
          compiledInput: compileReplicateImageApiInput(job),
          preflight: getExternalProviderRuntimePreflight('replicate', env)!,
        }),
      ),
    );

    expect(calls.map((call) => call.input)).toEqual([
      'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
      'https://replicate.delivery/out.webp',
    ]);
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: 'Bearer secret-replicate-value',
      Prefer: 'wait',
    });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      input: { prompt: expect.stringContaining('small brass key'), aspect_ratio: '16:9' },
    });
    expect(result.assets).toEqual([
      {
        type: 'file',
        sourcePath: 'D:/studio-library/assets/job-replicate-replicate-1000.webp',
        mimeType: 'image/webp',
      },
    ]);
    expect(writes.join('\n')).not.toContain('secret-replicate-value');
  });
});
