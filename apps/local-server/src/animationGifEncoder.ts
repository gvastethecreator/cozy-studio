import { authoringSharp } from './sharpAuthoringAdapter';

export interface GifRgbaFrame {
  rgba: Uint8Array;
  delayCentiseconds: number;
}

export interface EncodeGifOptions {
  width: number;
  height: number;
  frames: GifRgbaFrame[];
  loop: boolean;
  matteColor?: string;
  transparent?: boolean;
}

function parseHexColor(value: string | null | undefined) {
  const cleaned = value?.trim().replace(/^#/, '') ?? '';
  if (!/^[0-9a-f]{6}$/i.test(cleaned)) return { r: 11, g: 15, b: 20 };
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

/**
 * Encodes equal-size RGBA frames as a GIF. Without `transparent`, alpha is flattened onto the
 * matte. With it, pixels below alpha 128 become transparent and a frame is cleared before the
 * next one, so they leave no trails.
 */
export async function encodeGif({
  width,
  height,
  frames,
  loop,
  matteColor,
  transparent = false,
}: EncodeGifOptions) {
  if (width <= 0 || height <= 0) throw new Error('GIF width and height must be positive.');
  if (frames.length === 0) throw new Error('GIF export requires at least one frame.');
  const expectedBytes = width * height * 4;
  if (frames.some((frame) => frame.rgba.length !== expectedBytes)) {
    throw new Error('GIF frame dimensions do not match the export dimensions.');
  }

  const pages = authoringSharp(Buffer.concat(frames.map((frame) => frame.rgba)), {
    raw: { width, height: height * frames.length, channels: 4, pageHeight: height },
    // The frames are decoded pixels already in memory, not an untrusted compressed file.
    limitInputPixels: false,
  });
  return (transparent ? pages : pages.flatten({ background: parseHexColor(matteColor) }))
    .gif({
      // 0 repeats forever. 1 plays once and writes no NETSCAPE loop block.
      loop: loop ? 0 : 1,
      delay: frames.map((frame) => Math.max(1, Math.round(frame.delayCentiseconds)) * 10),
      dither: 0,
      keepDuplicateFrames: true,
    })
    .toBuffer();
}
