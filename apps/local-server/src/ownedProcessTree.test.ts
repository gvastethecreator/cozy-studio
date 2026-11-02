import { describe, expect, it, vi } from 'vitest';

import { terminateOwnedProcessTree } from './ownedProcessTree';

describe('owned process tree termination', () => {
  it('kills the whole Windows wrapper tree when taskkill succeeds', async () => {
    const kill = vi.fn();
    const killWindowsProcessTree = vi.fn(async () => true);

    await expect(
      terminateOwnedProcessTree({ pid: 4321, kill }, { platform: 'win32', killWindowsProcessTree }),
    ).resolves.toBe('tree');
    expect(killWindowsProcessTree).toHaveBeenCalledWith(4321);
    expect(kill).not.toHaveBeenCalled();
  });

  it('falls back to the direct handle outside Windows or when tree kill fails', async () => {
    const windowsKill = vi.fn();
    const killWindowsProcessTree = vi.fn(async () => false);
    const posixKill = vi.fn();

    await expect(
      terminateOwnedProcessTree(
        { pid: 4321, kill: windowsKill },
        { platform: 'win32', killWindowsProcessTree },
      ),
    ).resolves.toBe('process');
    expect(windowsKill).toHaveBeenCalledOnce();

    await expect(
      terminateOwnedProcessTree(
        { pid: 9876, kill: posixKill },
        { platform: 'linux', killWindowsProcessTree },
      ),
    ).resolves.toBe('process');
    expect(posixKill).toHaveBeenCalledOnce();
  });
});
