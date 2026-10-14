import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERATION_CONFIG } from '../constants';
import type { GeneratedImageWithConfig } from '../types';
import { downloadMultipleImagesAsZip, fetchImageBlob, generateSmartFilename } from './fileUtils';

const archive = vi.hoisted(() => ({
  file: vi.fn(),
  generateAsync: vi.fn().mockResolvedValue('archive'),
  saveAs: vi.fn(),
}));
vi.mock('jszip', () => ({
  default: class {
    file = archive.file;
    generateAsync = archive.generateAsync;
  },
}));
vi.mock('file-saver', () => ({ saveAs: archive.saveAs }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('download filenames', () => {
  it('preserves saved Windows and POSIX basenames with safe names and the image extension', () => {
    const filename = (localPath: string, mimeType?: string) =>
      generateSmartFilename('alpha', 'one', 'gpt-image-2', '1:1', undefined, mimeType, localPath);
    expect(filename('B:\\#OUTPUTS\\CozyStudio\\2026-10-03_000009_owl.png', 'image/png')).toBe(
      '2026-10-03_000009_owl.png',
    );
    expect(filename('/home/user/Pictures/2026-10-03_000010_owl.jpeg', 'image/jpeg')).toBe(
      '2026-10-03_000010_owl.jpeg',
    );
    expect(filename('/home/user/Pictures/image.jpeg')).toBe('image.jpeg');
    expect(filename('/home/user/Pictures/CON:owl?.png', 'image/webp')).toBe('CON-owl-.webp');
    expect(filename('/home/user/Pictures/CON.png', 'image/png')).toBe('_CON.png');
    expect(filename('/home/user/Pictures/CON', 'image/png')).toBe('_CON.png');
    expect(generateSmartFilename('alpha', 'one', 'model', '1:1', 2, 'image/png')).toBe(
      '002-alpha-model-1-1.png',
    );
  });

  it('reports partial ZIPs and keeps unique names in selection order despite fetch completion order', async () => {
    const paths = ['/first/shot.png', '/second/SHOT.png', '/third/SHOT-000002.png', '/missing.png'];
    const images: GeneratedImageWithConfig[] = paths.map((localPath, index) => ({
      id: String(index),
      src: `/image-${index}`,
      localPath,
      batchId: 'download-batch',
      createdAt: 0,
      config: { ...DEFAULT_GENERATION_CONFIG, prompt: 'alpha' },
    }));
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetch = vi.fn((src: string) => {
      if (src === '/image-0') return first;
      return Promise.resolve(
        new Response(new Blob([src], { type: 'image/png' }), {
          status: src === '/image-3' ? 404 : 200,
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);

    let resolveOthers!: () => void;
    const othersSettled = new Promise<void>((resolve) => {
      resolveOthers = resolve;
    });
    const onProgress = vi.fn(({ completed }: { completed: number; total: number }) => {
      if (completed === 3) resolveOthers();
    });
    const download = downloadMultipleImagesAsZip(images, 'selection.zip', onProgress);
    expect(fetch).toHaveBeenCalledTimes(4);
    await othersSettled;
    resolveFirst(new Response(new Blob(['first'], { type: 'image/png' })));
    expect(await download).toEqual({ requested: 4, exported: 3, failedImages: [images[3]] });
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { completed: 1, total: 4 },
      { completed: 2, total: 4 },
      { completed: 3, total: 4 },
      { completed: 4, total: 4 },
    ]);

    expect(archive.file.mock.calls.map(([name]) => name)).toEqual([
      'shot.png',
      'SHOT-000003.png',
      'SHOT-000002.png',
    ]);
    expect(archive.file.mock.calls.map(([, blob]) => blob.type)).toEqual([
      'image/png',
      'image/png',
      'image/png',
    ]);
    expect(archive.saveAs).toHaveBeenCalledWith('archive', 'selection.zip');
  });

  it('reports all failed images and saves no empty archive for failed or empty selections', async () => {
    const images: GeneratedImageWithConfig[] = ['one', 'two'].map((id) => ({
      id,
      src: `/missing-${id}`,
      sourceUrl: `/original-${id}`,
      batchId: 'download-batch',
      createdAt: 0,
      config: DEFAULT_GENERATION_CONFIG,
    }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const onProgress = vi.fn();

    expect(await downloadMultipleImagesAsZip(images, 'failed.zip', onProgress)).toEqual({
      requested: 2,
      exported: 0,
      failedImages: images,
    });
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ]);
    onProgress.mockClear();
    expect(await downloadMultipleImagesAsZip([], 'empty.zip', onProgress)).toEqual({
      requested: 0,
      exported: 0,
      failedImages: [],
    });
    expect(onProgress).not.toHaveBeenCalled();
    expect(archive.file).not.toHaveBeenCalled();
    expect(archive.generateAsync).not.toHaveBeenCalled();
    expect(archive.saveAs).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/original-one', { cache: 'no-cache' });
    expect(fetch).not.toHaveBeenCalledWith('/missing-one', expect.anything());
  });

  it('propagates ZIP generation and save failures', async () => {
    const image: GeneratedImageWithConfig = {
      id: 'one',
      src: '/image.png',
      batchId: 'download-batch',
      createdAt: 0,
      config: DEFAULT_GENERATION_CONFIG,
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(new Blob(['image'], { type: 'image/png' }))),
        ),
    );
    archive.generateAsync.mockRejectedValueOnce(new Error('Encoding failed'));
    await expect(downloadMultipleImagesAsZip([image])).rejects.toThrow('Encoding failed');
    expect(archive.saveAs).not.toHaveBeenCalled();
    archive.saveAs.mockImplementationOnce(() => {
      throw new Error('Saving failed');
    });
    await expect(downloadMultipleImagesAsZip([image])).rejects.toThrow('Saving failed');
  });
});

describe('fetchImageBlob', () => {
  it('returns successful image bodies', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(blob, { status: 200 })));

    const result = await fetchImageBlob('/image.png');
    expect(fetch).toHaveBeenCalledWith('/image.png', { cache: 'no-cache' });
    expect(result.type).toBe('image/png');
    expect(
      generateSmartFilename('alpha', 'one', 'gpt-image-2', '1:1', undefined, result.type),
    ).toMatch(/\.png$/);
    expect(
      generateSmartFilename('alpha', 'two', 'gpt-image-2', '1:1', undefined, 'image/webp'),
    ).toMatch(/\.webp$/);
  });

  it('rejects HTTP error bodies instead of adding them to an archive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));

    await expect(fetchImageBlob('/missing.png')).rejects.toThrow(
      'Image request failed with HTTP 404.',
    );
  });
});
