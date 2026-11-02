import { spawn } from 'node:child_process';

interface OwnedProcessHandle {
  pid?: number | null;
  kill(): unknown;
}

export type OwnedProcessTermination = 'tree' | 'process';

function defaultKillWindowsProcessTree(pid: number) {
  return new Promise<boolean>((resolve) => {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
      .once('error', () => resolve(false))
      .once('exit', (code) => resolve(code === 0));
  });
}

export async function terminateOwnedProcessTree(
  processHandle: OwnedProcessHandle,
  {
    platform = process.platform,
    killWindowsProcessTree = defaultKillWindowsProcessTree,
  }: {
    platform?: NodeJS.Platform;
    killWindowsProcessTree?: (pid: number) => Promise<boolean>;
  } = {},
): Promise<OwnedProcessTermination> {
  if (
    platform === 'win32' &&
    typeof processHandle.pid === 'number' &&
    (await killWindowsProcessTree(processHandle.pid))
  ) {
    return 'tree';
  }

  try {
    processHandle.kill();
  } catch {
    // The process may have exited before termination.
  }
  return 'process';
}
