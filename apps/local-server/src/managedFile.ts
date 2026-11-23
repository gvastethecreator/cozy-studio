import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

/**
 * Writes a content-addressed Library file once. An existing file with the same bytes is kept, so
 * every caller that names the same digest shares one file.
 */
export function placeManagedFile(destination: string, bytes: Uint8Array) {
  mkdirSync(path.dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    if (!readFileSync(destination).equals(bytes)) {
      throw new Error(
        'A managed reference file already exists for this digest and was left unchanged.',
      );
    }
    return;
  }
  const partial = `${destination}.${randomUUID()}.partial`;
  const fd = openSync(partial, 'wx');
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(partial);
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(partial, destination);
  } catch (error) {
    try {
      unlinkSync(partial);
    } catch {
      // The partial file is disposable. The named reference file stays as it is.
    }
    if (existsSync(destination) && readFileSync(destination).equals(bytes)) return;
    throw error;
  }
}
