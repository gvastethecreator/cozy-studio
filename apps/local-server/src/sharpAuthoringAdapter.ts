/**
 * Sharp for authoring, conversion and reference import. Catalog Entry thumbnails and generation reference WebP use
 * `imagePipeline.ts` / Bun.Image. Do not import this module from that hot path.
 */
import sharp, { type Metadata, type OutputInfo, type OverlayOptions } from 'sharp';

export { sharp as authoringSharp };
export type { Metadata, OutputInfo, OverlayOptions };

export async function writePngFromSvg(svg: string, destinationPath: string) {
  await sharp(Buffer.from(svg)).png().toFile(destinationPath);
}
