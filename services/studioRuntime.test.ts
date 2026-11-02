import { describe, expect, it } from 'vitest';

import { resolveStudioRuntimeFromSources } from './studioRuntime';

describe('resolveStudioRuntimeFromSources', () => {
  it('uses the env api base for the web runtime', () => {
    const runtime = resolveStudioRuntimeFromSources({
      envApiBase: 'http://localhost:9999/',
    });

    expect(runtime).toEqual({
      label: 'Web runtime',
      isDesktop: false,
      apiBase: 'http://127.0.0.1:9999',
    });
  });

  it('keeps the Vite env api base ahead of the page origin for split-port dev', () => {
    const runtime = resolveStudioRuntimeFromSources({
      envApiBase: 'http://127.0.0.1:17223',
      productionUi: true,
      pageOrigin: 'http://127.0.0.1:17222',
    });

    expect(runtime.apiBase).toBe('http://127.0.0.1:17223');
  });

  it('uses the default local backend when no env override exists', () => {
    const runtime = resolveStudioRuntimeFromSources();

    expect(runtime.apiBase).toBe('http://127.0.0.1:17223');
  });

  it('uses the loopback page origin in production UI when env is unset', () => {
    const runtime = resolveStudioRuntimeFromSources({
      productionUi: true,
      pageOrigin: 'http://127.0.0.1:18000/',
    });

    expect(runtime.apiBase).toBe('http://127.0.0.1:18000');
  });

  it('does not treat file:// as a Studio API origin', () => {
    const runtime = resolveStudioRuntimeFromSources({
      productionUi: true,
      pageOrigin: 'file:///C:/CozyStudio/index.html',
    });

    expect(runtime.apiBase).toBe('http://127.0.0.1:17223');
  });
});
