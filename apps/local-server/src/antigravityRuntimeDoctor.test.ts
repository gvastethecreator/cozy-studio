import { describe, expect, it } from 'vitest';

import {
  inspectAntigravityRuntime,
  parseAvailableAntigravityModels,
  pickRecommendedAntigravityModel,
} from './antigravityRuntimeDoctor';
import { createAntigravityChildEnvironment } from './antigravityExecutable';
import { inspectAntigravityUsage } from './antigravityUsage';

const HELP = [
  '--input-format',
  '--output-format',
  '--print-timeout',
  '--sandbox',
  '--disable-slash-commands',
  '--mode',
].join('\n');

describe('Antigravity runtime doctor', () => {
  it('parses the tab-separated model catalog', () => {
    expect(
      parseAvailableAntigravityModels(
        'Fetching available models...\ngemini-3.8-flash-low\tGemini 3.8 Flash\nclaude-sonnet-4-6\tClaude Sonnet',
      ),
    ).toEqual(['gemini-3.8-flash-low', 'claude-sonnet-4-6']);
  });

  it('reports a ready authenticated headless runtime', async () => {
    const report = await inspectAntigravityRuntime({
      now: () => new Date('2026-09-02T00:00:00.000Z'),
      resolveExecutable: () => 'agy',
      listCandidates: () => [{ path: 'agy', source: 'test' }],
      run: async (_command, args) => {
        if (args[0] === '--version') return { status: 0, stdout: '1.1.24\n', stderr: '' };
        if (args[0] === '--help') return { status: 0, stdout: HELP, stderr: '' };
        return {
          status: 0,
          stdout: 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n',
          stderr: '',
        };
      },
    });

    expect(report).toMatchObject({
      status: 'ready',
      canRunJobs: true,
      selectedVersionNumber: '1.1.24',
      defaultModel: 'gemini-3.8-flash-low',
      headlessSupported: true,
      generateImageSupported: true,
      availableModels: ['gemini-3.8-flash-low'],
    });
  });

  it('prefers lightweight Flash orchestration models and parses zero-quota usage and credits', async () => {
    expect(
      pickRecommendedAntigravityModel([
        'claude-opus-4-6',
        'gemini-3.1-pro-high',
        'gemini-3.8-flash-low',
      ]),
    ).toBe('gemini-3.8-flash-low');

    const usage = await inspectAntigravityUsage({
      now: () => new Date('2026-11-25T20:00:00.000Z'),
      resolveExecutable: () => 'agy',
      run: async (_command, args) => {
        if (args[1] === '/usage') {
          return {
            status: 0,
            stderr: '',
            stdout: JSON.stringify({
              status: 'SUCCESS',
              command: {
                name: 'usage',
                data: {
                  groups: [
                    {
                      name: 'Gemini',
                      buckets: [
                        {
                          id: 'gemini-flash-5h',
                          name: 'Gemini Flash',
                          window: '5h',
                          remaining_fraction: 0.9,
                          reset_time: '2026-11-26T00:00:00Z',
                        },
                        {
                          id: 'gemini-flash-weekly',
                          name: 'Gemini Flash',
                          window: 'weekly',
                          remaining_fraction: 0.65,
                          reset_time: '2026-12-01T00:00:00Z',
                        },
                      ],
                    },
                  ],
                },
              },
            }),
          };
        }
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify({
            status: 'SUCCESS',
            command: {
              name: 'credits',
              data: { remaining_credits: 420, upgrade_uri: 'https://one.google.com/ai' },
            },
          }),
        };
      },
    });
    expect(usage.available).toBe(true);
    expect(usage.buckets).toHaveLength(2);
    expect(usage.tightestPercentLeft).toBe(65);
    expect(usage.tightestWindowLabel).toBe('Weekly');
    expect(usage.remainingCredits).toBe(420);
    expect(usage.upgradeUri).toBe('https://one.google.com/ai');
  });

  it('blocks an outdated runtime before login probes', async () => {
    const calls: string[][] = [];
    const report = await inspectAntigravityRuntime({
      resolveExecutable: () => 'agy',
      listCandidates: () => [{ path: 'agy', source: 'test' }],
      run: async (_command, args) => {
        calls.push(args);
        return { status: 0, stdout: '1.1.22\n', stderr: '' };
      },
    });

    expect(report.canRunJobs).toBe(false);
    expect(report.issues[0]?.code).toBe('antigravity_cli_outdated');
    expect(calls).toEqual([['--version']]);
  });

  it('does not pass unrelated provider credentials to the CLI', () => {
    expect(
      createAntigravityChildEnvironment({
        PATH: 'C:\\tools',
        USERPROFILE: 'C:\\Users\\dev',
        GOOGLE_API_KEY: 'google-secret',
        XAI_API_KEY: 'xai-secret',
        HTTPS_PROXY: 'https://proxy.example',
        HTTP_PROXY: 'http://user:pass@proxy.example',
      }),
    ).toEqual({
      PATH: 'C:\\tools',
      USERPROFILE: 'C:\\Users\\dev',
      HTTPS_PROXY: 'https://proxy.example',
      NO_COLOR: '1',
    });
  });
});
