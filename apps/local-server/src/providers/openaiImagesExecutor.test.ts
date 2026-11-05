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
      model: 'gpt-image-2.6-flare',
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

  it('preserves direct animated GIFs and rejects static images before saving', async () => {
    const env = { OPENAI_API_KEY: 'secret-openai-value' };
    const gifBytes = Buffer.from(
      'R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQBFAABACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7',
      'base64',
    );
    let responseBytes = gifBytes;
    const job = {
      id: 'job-gif',
      workspaceId: 'workspace-1',
      providerId: 'openai' as const,
      prompt: 'a lantern sways in a seamless loop',
      execution: { model: 'gpt-image-2.6-sunburst', reasoningEffort: 'minimal' as const },
      sourceSpec: createGenerationTaskSpec({
        id: 'spec-gif',
        task: 'image_generate',
        providerId: 'openai',
        prompt: 'a lantern sways in a seamless loop',
        output: { mimeType: 'image/gif', aspectRatio: '16:9' },
      }),
    };
    const requests: unknown[] = [];
    const writes: Array<{ path: string; bytes: unknown }> = [];
    const executor = createOpenaiImagesExecutor({
      env,
      fetch: async (_input, init) => {
        requests.push(JSON.parse(init?.body as string));
        return new Response(
          JSON.stringify({ data: [{ b64_json: responseBytes.toString('base64') }] }),
        );
      },
      resolveLibraryPath: (...segments) => `D:/studio-library/${segments.join('/')}`,
      mkdir: (() => undefined) as typeof import('node:fs').mkdirSync,
      writeFile: ((filePath, bytes) => {
        writes.push({ path: String(filePath), bytes });
      }) as typeof import('node:fs').writeFileSync,
      now: () => 1000,
    });
    const execute = () =>
      Effect.runPromise(
        Effect.scoped(
          executor({
            providerId: 'openai',
            job,
            compiledInput: compileOpenaiImageApiInput(job),
            preflight: getExternalProviderRuntimePreflight('openai', env)!,
          }),
        ),
      );

    const result = await execute();
    expect(requests[0]).toEqual({
      model: 'gpt-image-2.6-sunburst',
      prompt: expect.stringContaining('seamless loop'),
      size: 'auto',
      output_format: 'gif',
      n: 1,
    });
    expect(result.assets).toEqual([
      {
        type: 'file',
        sourcePath: 'D:/studio-library/assets/job-gif-openai-1000.gif',
        mimeType: 'image/gif',
      },
    ]);
    expect(writes[0].bytes).toEqual(gifBytes);
    const writeCount = writes.length;
    responseBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
    await expect(execute()).rejects.toThrow('single-frame GIF');
    expect(writes).toHaveLength(writeCount);
    responseBytes = PNG_BYTES;
    await expect(execute()).rejects.toThrow('declared image/gif, received image/png');
    expect(writes).toHaveLength(writeCount);
    const requestCount = requests.length;
    job.execution.model = 'gpt-image-1';
    await expect(execute()).rejects.toThrow('requires GPT Image 2.6');
    expect(requests).toHaveLength(requestCount);
    expect(writes).toHaveLength(writeCount);
  });
});
