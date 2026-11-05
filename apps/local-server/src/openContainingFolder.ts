import { spawn } from 'node:child_process';
import path from 'node:path';

export function createContainingFolderOpener({
  platform = process.platform,
  spawnProcess = spawn,
}: { platform?: NodeJS.Platform; spawnProcess?: typeof spawn } = {}) {
  return async (filePath: string): Promise<void> => {
    const folderPath = (platform === 'win32' ? path.win32 : path.posix).dirname(filePath);
    const command =
      platform === 'win32'
        ? 'explorer.exe'
        : platform === 'darwin'
          ? 'open'
          : platform === 'linux'
            ? 'xdg-open'
            : null;
    if (!command) throw new Error('Opening folders is unavailable on this operating system.');
    await new Promise<void>((resolve, reject) => {
      const child = spawnProcess(command, [folderPath], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  };
}

export const openContainingFolder = createContainingFolderOpener();
