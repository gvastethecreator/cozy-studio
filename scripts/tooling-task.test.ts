import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getToolingTaskDefinition, pruneToolingLogs } from './tooling-task';

describe('pruneToolingLogs', () => {
  it('keeps latest logs and rolling latest files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'codex-tooling-logs-'));
    try {
      for (let index = 0; index < 3; index += 1) {
        const file = path.join(dir, `build-2026-06-21T00-00-0${index}-000Z.log`);
        writeFileSync(file, String(index));
      }
      writeFileSync(path.join(dir, 'build.latest.log'), 'latest');

      expect(pruneToolingLogs(2, dir)).toBe(1);
      expect(readdirSync(dir).sort()).toEqual([
        'build-2026-06-21T00-00-01-000Z.log',
        'build-2026-06-21T00-00-02-000Z.log',
        'build.latest.log',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('tooling gate aliases', () => {
  it('keeps the release gate portable and validate:full as its alias', () => {
    expect(getToolingTaskDefinition('validate:full')?.steps).toEqual([
      expect.objectContaining({ args: ['run', 'scripts/tooling-task.ts', 'validate:release'] }),
    ]);
    expect(getToolingTaskDefinition('validate:release')?.steps[0]).toMatchObject({
      args: ['run', 'scripts/tooling-task.ts', 'validate'],
      env: { VITE_STUDIO_API_BASE: '' },
    });
    for (const task of ['build', 'build:ui', 'validate']) {
      const build = getToolingTaskDefinition(task)?.steps.find((step) => step.label === 'UI Build');
      expect(build).toBeDefined();
      expect(build?.env).toBeUndefined();
    }
  });
});
