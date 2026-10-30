import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createGenerationTaskSpec } from '../../../../packages/shared/src';
import { compileOpenaiImageApiInput } from './externalProviderInputs';
import { createOpenaiImagesExecutor } from './openaiImagesExecutor';
import { getExternalProviderRuntimePreflight } from './runtimeConfig';

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe('OpenAI Images executor', () => {
  it('posts a text-to-image request and stores the returned image without leaking the key', async () => {
    const env = { OPENAI_API_KEY: 'secret-openai-value' };
    const job = {
      id: 'job-openai',
      workspaceId: 'workspace-1',
      providerId: 'openai' as const,
      prompt: 'fallback prompt',
      sourceSpec: createGenerationTaskSpec({
        id: 'spec-openai',
        task: 'image_generate',
        providerId: 'openai',
        prompt: 'small brass key',
        output: { aspectRatio: '9:16' },
      }),
    };
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const writes: string[] = [];
    const executor = createOpenaiImagesExecutor({
      env,
      fetch: async (input, init) => {
        calls.push({ input: input as string, init });
        return new Response(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString('base64') }] }));
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
          providerId: 'openai',
          job,
          compiledInput: compileOpenaiImageApiInput(job),
          preflight: getExternalProviderRuntimePreflight('openai', env)!,
        }),
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe('https://api.openai.com/v1/images/generations');
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer secret-openai-value' });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      model: 'gpt-image-1',
      prompt: expect.stringContaining('small brass key'),
      size: '1024x1536',
    });
    expect(result.assets).toEqual([
      {
        type: 'file',
        sourcePath: 'D:/studio-library/assets/job-openai-openai-1000.png',
        mimeType: 'image/png',
      },
    ]);
    expect(writes.join('\n')).not.toContain('secret-openai-value');
  });
});
