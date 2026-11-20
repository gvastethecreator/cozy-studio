/**
 * Runtime Catalog Entry thumbnails and reference WebP. Authoring cover-fit,
 * flatten, raw pixels, and SVG raster stay on `sharpAuthoringAdapter.ts`.
 */
export interface ResizeWebpOptions {
  maxEdge: number;
  quality: number;
}

export interface EncodedWebp {
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
}

/** First Bun release with `Bun.Image`; local-server refuses to start below it. */
export const MIN_BUN_VERSION = '1.3.14';

function getBunImage() {
  const Image = globalThis.Bun?.Image;
  if (typeof Image !== 'function') {
    throw new Error(
      `Bun.Image is required for Catalog Entry thumbnails and reference WebP conversion. Run local-server with Bun ${MIN_BUN_VERSION} or later.`,
    );
  }
  return Image;
}

export async function encodeResizedWebpFromPath(
  sourcePath: string,
  destinationPath: string,
  options: ResizeWebpOptions,
) {
  const Image = getBunImage();
  await new Image(sourcePath)
    .resize(options.maxEdge, options.maxEdge, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: options.quality })
    .write(destinationPath);
}

export async function encodeResizedWebpFromBytes(
  bytes: Uint8Array,
  options: ResizeWebpOptions,
): Promise<EncodedWebp> {
  const Image = getBunImage();
  const image = new Image(bytes)
    .resize(options.maxEdge, options.maxEdge, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: options.quality });
  const encoded = await image.bytes();
  return {
    bytes: encoded,
    width: image.width ?? null,
    height: image.height ?? null,
  };
}
