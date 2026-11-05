import type { GeneratedImageWithConfig } from '../types';
import { runtimeLogger } from './runtimeLogger';

export const downloadImage = async (src: string, filename: string) => {
  downloadBlob(await fetchImageBlob(src), filename);
};

/** Save a blob through a temporary download link. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Keep the blob alive until the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function safeDownloadFilename(value: string) {
  const name = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '') || 'image';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

/** Keep the saved basename, or build a name for an image that has no local file. */
export const generateSmartFilename = (
  prompt: string | undefined,
  id: string,
  model: string = 'unknown-model',
  resolution: string = 'unknown-res',
  index?: number,
  mimeType?: string,
  localPath?: string,
) => {
  const extension = IMAGE_EXTENSIONS[mimeType?.split(';')[0].trim().toLowerCase() ?? ''];
  const basename = localPath?.split(/[\\/]/).pop();
  if (basename && basename !== '.' && basename !== '..') {
    const name = safeDownloadFilename(basename);
    const suffix = /\.([^.]+)$/.exec(name);
    const savedExtension = suffix?.[1].toLowerCase();
    if (
      savedExtension &&
      (!extension ||
        extension === savedExtension ||
        (extension === 'jpg' && savedExtension === 'jpeg'))
    ) {
      return name;
    }
    return `${suffix ? name.slice(0, -suffix[0].length) : name}.${extension ?? 'png'}`;
  }
  // 1. Index: ### (e.g. 001, 002) or short ID
  const idxStr =
    index !== undefined
      ? String(index).padStart(3, '0')
      : (id.split('-').pop() || '000').padStart(3, '0');

  // 2. Prompt Slug: first 6 words, sanitized
  const cleanPrompt = (prompt || 'synthesized-asset')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/[\s_-]+/g, '-') // Replace spaces/underscores with single hyphen
    .replace(/^-+|-+$/g, '') // Trim hyphens
    .split('-')
    .slice(0, 6) // Limit to 6 words
    .join('-');

  const slug = cleanPrompt || 'untitled';

  // 3. Model and Resolution
  const safeModel = model.replace(/[^a-zA-Z0-9-]/g, '-');
  const safeResolution = resolution.replace(/[^a-zA-Z0-9-]/g, '-');
  return safeDownloadFilename(
    `${idxStr}-${slug}-${safeModel}-${safeResolution}.${extension ?? 'png'}`,
  );
};

export const downloadMultipleImagesAsZip = async (
  images: GeneratedImageWithConfig[],
  zipFilename: string = 'assets.zip',
  onProgress?: (progress: { completed: number; total: number }) => void,
): Promise<{ requested: number; exported: number; failedImages: GeneratedImageWithConfig[] }> => {
  let completed = 0;
  const files = await Promise.all(
    images.map(async (img, index) => {
      try {
        const blob = await fetchImageBlob(img.sourceUrl ?? img.src);
        const filename = generateSmartFilename(
          img.config.prompt,
          img.id,
          img.config.model,
          img.config.aspectRatio,
          index + 1,
          blob.type || img.mimeType,
          img.localPath,
        );
        return { filename, blob };
      } catch (err) {
        runtimeLogger.error(`Failed to fetch image ${img.id} for zip`, err);
        return null;
      } finally {
        onProgress?.({ completed: ++completed, total: images.length });
      }
    }),
  );
  const failedImages = images.filter((_, index) => !files[index]);
  const result = {
    requested: images.length,
    exported: images.length - failedImages.length,
    failedImages,
  };
  if (result.exported === 0) return result;
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const nameKey = (name: string) => name.normalize('NFC').toLowerCase();
  const originalNames = new Set(files.flatMap((file) => (file ? [nameKey(file.filename)] : [])));
  const usedNames = new Set<string>();
  // Allocate in selection order, independent of network completion order. Keep each original
  // basename available when a duplicate needs a suffix, including on case-insensitive systems.
  for (const file of files) {
    if (!file) continue;
    let filename = file.filename;
    const dot = filename.lastIndexOf('.');
    if (usedNames.has(nameKey(filename))) {
      let index = 2;
      do {
        filename = `${file.filename.slice(0, dot)}-${String(index++).padStart(6, '0')}${file.filename.slice(dot)}`;
      } while (originalNames.has(nameKey(filename)) || usedNames.has(nameKey(filename)));
    }
    usedNames.add(nameKey(filename));
    zip.file(filename, file.blob);
  }
  const content = await zip.generateAsync({ type: 'blob' });
  downloadBlob(content, zipFilename);
  return result;
};

export async function fetchImageBlob(source: string) {
  // Revalidate originals: an earlier <img> response may lack CORS headers in browser cache.
  const response = await fetch(source, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Image request failed with HTTP ${response.status}.`);
  }
  return response.blob();
}

async function encodePngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') {
    const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)) {
      return blob;
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error('The original image could not be decoded for copying.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) {
      throw new Error('This browser could not prepare the image for copying.');
    }
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png || png.type !== 'image/png') {
      throw new Error('This browser could not encode the image as PNG for copying.');
    }
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyImageToClipboard(source: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard is not available in this browser.');
  }
  let imageError: unknown;
  const png = fetchImageBlob(source).then(encodePngBlob);
  // A denied write may reject before the image has loaded. Observe its later failure too.
  void png.catch((error: unknown) => {
    imageError = error;
  });
  try {
    // Register the write during the click, before fetching or decoding loses user activation.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch (error) {
    if (imageError) throw imageError;
    if (error instanceof Error && error.name === 'NotAllowedError') {
      throw new Error(
        'Clipboard access was denied. Keep Studio focused and allow clipboard access.',
      );
    }
    throw error;
  }
}

/**
 * Export any serializable payload as a downloadable JSON file.
 */
export const exportToJson = <T>(data: T, filename: string) => {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
};

/** Read a file or blob as a data URL. */
export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
