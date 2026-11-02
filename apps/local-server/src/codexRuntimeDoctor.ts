import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CodexRuntimeDoctorIssue,
  CodexRuntimeDoctorReport,
} from '../../../packages/shared/src';
import { runCliProbe, type CliProbeResult, type CliProbeRunner } from './cliProbe';
import {
  resolveCodexExecutable,
  resolveCodexInvocation,
  resolveCodexInvocationForExecutable,
  resolveWindowsCommandInvocation,
} from './codexExecutable';
import { listPlatformPathCandidates } from './platformPaths';
import { createRuntimeDoctorCache } from './runtimeDoctorCache';

export interface CodexRuntimeDoctorDependencies {
  now?: () => Date;
  exists?: (path: string) => boolean;
  run?: CliProbeRunner;
  resolveExecutable?: () => string;
  resolveInvocation?: (args: string[], executable?: string) => string[];
  listCandidates?: () => Array<{ path: string; source: string }>;
}

const PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_DOCTOR_CACHE_MS = 10_000;

function outputText(result: CliProbeResult) {
  return [result.stdout, result.stderr]
    .map((value) => (value == null ? '' : String(value)))
    .join('\n')
    .trim();
}

function parseVersionNumber(raw: string | null) {
  return raw?.match(/(?:codex-cli\s*)?v?(\d+\.\d+(?:\.\d+)?)/i)?.[1] ?? null;
}

function isLegacyCodexCli({
  rawVersion,
  versionNumber,
  executable,
}: {
  rawVersion: string | null;
  versionNumber: string | null;
  executable: string;
}) {
  if (!versionNumber) return false;
  const looksBranded = /codex-cli/i.test(rawVersion ?? '');
  const looksLikeNpmShim = /[\\/]npm[\\/](codex(?:\.cmd|\.exe)?|node_modules[\\/])/i.test(
    executable,
  );
  return looksLikeNpmShim && !looksBranded;
}

function appServerHelpSupported(result: CliProbeResult) {
  if (result.status !== 0) return false;
  const text = outputText(result);
  if (/\b(?:unknown|unrecognized|unrecognised|invalid)\s+(?:command|subcommand)\b/i.test(text)) {
    return false;
  }
  return /app-server|--listen|websocket/i.test(text);
}

function buildIssue(
  issue: Pick<CodexRuntimeDoctorIssue, 'code' | 'message' | 'action'>,
): CodexRuntimeDoctorIssue {
  return {
    ...issue,
    severity: 'error',
  };
}

function dedupeCandidates(candidates: Array<{ path: string; source: string }>) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readKnownLegacyNpmShimIssue(executable: string): CodexRuntimeDoctorIssue | null {
  if (process.platform !== 'win32') return null;
  if (!/[\\/]npm[\\/]codex(?:\.cmd|\.exe)?$/i.test(executable)) return null;

  const manifestPath = path.join(path.dirname(executable), 'node_modules', 'codex', 'package.json');
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      version?: string;
      description?: string;
    };
    if (manifest.name !== 'codex') return null;

    return buildIssue({
      code: 'codex_cli_legacy',
      message: `Selected Codex CLI shim points to legacy npm package codex ${manifest.version ?? 'unknown version'}.`,
      action:
        'Remove the old global `codex` npm package, install `@openai/codex`, then restart the local backend.',
    });
  } catch {
    return null;
  }
}

function runCodexProbe(run: CliProbeRunner, [command, ...args]: string[]) {
  return run(command, args, {
    timeoutMs: PROBE_TIMEOUT_MS,
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command),
    windowsVerbatimArguments: process.platform === 'win32' && command === 'cmd.exe',
  });
}

function shouldTryWindowsShellFallback(result: CliProbeResult, command: string[]) {
  if (process.platform !== 'win32') return false;
  const executable = command[0] ?? '';
  if (!executable || executable === 'cmd.exe' || executable === 'codex') return false;
  return result.status !== 0;
}

async function runProbeWithFallback({
  run,
  invocation,
  executable,
  args,
}: {
  run: CliProbeRunner;
  invocation: string[];
  executable: string;
  args: string[];
}) {
  const result = await runCodexProbe(run, invocation);
  if (!shouldTryWindowsShellFallback(result, invocation)) return { command: invocation, result };

  const fallbackInvocation = resolveWindowsCommandInvocation(executable, args);
  const fallbackResult = await runCodexProbe(run, fallbackInvocation);
  if (fallbackResult.status !== 0) return { command: invocation, result };
  return { command: fallbackInvocation, result: fallbackResult };
}

interface CandidateProbe {
  executable: string;
  source: string;
  exists: boolean;
  versionCommand: string[];
  selectedVersion: string | null;
  selectedVersionNumber: string | null;
  appServerSupported: boolean;
  issues: CodexRuntimeDoctorIssue[];
  canRunJobs: boolean;
}

async function inspectCandidate({
  candidate,
  exists,
  resolveInvocation,
  selectedExecutable,
  run,
}: {
  candidate: { path: string; source: string };
  exists: (path: string) => boolean;
  resolveInvocation: (args: string[], executable?: string) => string[];
  selectedExecutable: string;
  run: CliProbeRunner;
}): Promise<CandidateProbe> {
  const candidateExists =
    candidate.path === 'codex' ? process.platform !== 'win32' : exists(candidate.path);
  const fallbackProbe: CandidateProbe = {
    executable: candidate.path,
    source: candidate.source,
    exists: candidateExists,
    versionCommand: [candidate.path, '--version'],
    selectedVersion: null,
    selectedVersionNumber: null,
    appServerSupported: false,
    issues: [],
    canRunJobs: false,
  };

  if (!candidateExists) return fallbackProbe;
  const legacyShimIssue = readKnownLegacyNpmShimIssue(candidate.path);
  if (legacyShimIssue) {
    return {
      ...fallbackProbe,
      versionCommand: resolveCodexInvocationForExecutable(candidate.path, ['--version']),
      issues: [legacyShimIssue],
    };
  }

  const probe = (args: string[]) =>
    runProbeWithFallback({
      run,
      invocation:
        candidate.path === selectedExecutable
          ? resolveInvocation(args, candidate.path)
          : resolveCodexInvocationForExecutable(candidate.path, args),
      executable: candidate.path,
      args,
    });
  const versionProbe = await probe(['--version']);
  const versionText = outputText(versionProbe.result);
  const selectedVersion = versionProbe.result.status === 0 ? versionText : null;
  const selectedVersionNumber = parseVersionNumber(selectedVersion);
  const issues: CodexRuntimeDoctorIssue[] = [];

  if (versionProbe.result.status !== 0) {
    const errorText = versionProbe.result.error?.message || versionText;
    issues.push(
      buildIssue({
        code: 'codex_cli_unavailable',
        message: errorText
          ? `Codex CLI is not available: ${errorText}`
          : 'Codex CLI is not available from the selected command.',
        action: 'Install Codex CLI or fix PATH, then restart the local backend.',
      }),
    );
  }

  if (
    versionProbe.result.status === 0 &&
    isLegacyCodexCli({
      rawVersion: selectedVersion,
      versionNumber: selectedVersionNumber,
      executable: candidate.path,
    })
  ) {
    issues.push(
      buildIssue({
        code: 'codex_cli_legacy',
        message: `Selected Codex CLI looks legacy (${selectedVersion ?? 'unknown version'}).`,
        action:
          'Use the OpenAI Codex desktop CLI binary or update/remove the old npm shim, then restart the local backend.',
      }),
    );
  }

  let appServerSupported = false;
  if (versionProbe.result.status === 0 && issues.length === 0) {
    const helpProbe = await probe(['app-server', '--help']);
    appServerSupported = appServerHelpSupported(helpProbe.result);
    if (!appServerSupported) {
      issues.push(
        buildIssue({
          code: 'codex_app_server_unsupported',
          message: 'Selected Codex CLI does not expose `codex app-server`.',
          action:
            'Update Codex CLI to a build with app-server support, then restart the local backend.',
        }),
      );
    }
  }

  return {
    executable: candidate.path,
    source: candidate.source,
    exists: candidateExists,
    versionCommand: versionProbe.command,
    selectedVersion,
    selectedVersionNumber,
    appServerSupported,
    issues,
    canRunJobs: issues.length === 0 && appServerSupported,
  };
}

function buildDoctorReport({
  initialExecutable,
  rawCandidates,
  probes,
  exists,
  now,
}: {
  initialExecutable: string;
  rawCandidates: Array<{ path: string; source: string }>;
  probes: CandidateProbe[];
  exists: (path: string) => boolean;
  now: () => Date;
}): CodexRuntimeDoctorReport {
  const selectedProbe =
    probes.find((probe) => probe.canRunJobs) ??
    probes.find((probe) => probe.executable === initialExecutable) ??
    probes.find((probe) => probe.exists) ??
    probes[0];
  const issues =
    selectedProbe?.issues.length || selectedProbe?.exists
      ? (selectedProbe?.issues ?? [])
      : [
          buildIssue({
            code: 'codex_cli_unavailable',
            message: 'Codex CLI is not available from any known command.',
            action: 'Install Codex CLI or fix PATH, then restart the local backend.',
          }),
        ];
  const canRunJobs = Boolean(selectedProbe?.canRunJobs);
  const selectedExecutable = selectedProbe?.executable ?? initialExecutable;

  return {
    status: canRunJobs ? 'ready' : 'blocked',
    canRunJobs,
    checkedAt: now().toISOString(),
    selectedExecutable,
    selectedCommand: (selectedProbe?.versionCommand ?? [selectedExecutable, '--version']).join(' '),
    selectedVersion: selectedProbe?.selectedVersion ?? null,
    selectedVersionNumber: selectedProbe?.selectedVersionNumber ?? null,
    appServerSupported: selectedProbe?.appServerSupported ?? false,
    recommendedAction: canRunJobs ? 'Codex Product Runtime is ready.' : issues[0].action,
    issues,
    candidates: rawCandidates.map((candidate) => ({
      executable: candidate.path,
      source: candidate.source,
      exists: candidate.path === 'codex' ? process.platform !== 'win32' : exists(candidate.path),
      selected: candidate.path === selectedExecutable,
    })),
  };
}

export async function inspectCodexRuntime({
  now = () => new Date(),
  exists = existsSync,
  run = runCliProbe,
  resolveExecutable = resolveCodexExecutable,
  resolveInvocation = resolveCodexInvocation,
  listCandidates = () => listPlatformPathCandidates('codex-binary'),
}: CodexRuntimeDoctorDependencies = {}): Promise<CodexRuntimeDoctorReport> {
  const initialExecutable = resolveExecutable();
  const rawCandidates = dedupeCandidates([
    { path: initialExecutable, source: 'resolved executable' },
    ...listCandidates(),
  ]);
  const initialCandidate = rawCandidates[0] ?? {
    path: initialExecutable,
    source: 'resolved executable',
  };
  const probes = [
    await inspectCandidate({
      candidate: initialCandidate,
      exists,
      resolveInvocation,
      selectedExecutable: initialExecutable,
      run,
    }),
  ];

  if (!probes[0].canRunJobs) {
    for (const candidate of rawCandidates.slice(1)) {
      const probe = await inspectCandidate({
        candidate,
        exists,
        resolveInvocation,
        selectedExecutable: initialExecutable,
        run,
      });
      probes.push(probe);
      if (probe.canRunJobs) break;
    }
  }
  return buildDoctorReport({ initialExecutable, rawCandidates, probes, exists, now });
}

/** The report that stands in for the Codex CLI until its first probe finishes. */
export function createCheckingCodexRuntimeReport(): CodexRuntimeDoctorReport {
  return {
    status: 'blocked',
    canRunJobs: false,
    checkedAt: new Date(0).toISOString(),
    selectedExecutable: '',
    selectedCommand: '',
    selectedVersion: null,
    selectedVersionNumber: null,
    appServerSupported: false,
    recommendedAction: 'Codex Product Runtime readiness is still being checked.',
    issues: [],
    candidates: [],
  };
}

const doctorCache = createRuntimeDoctorCache({
  maxAgeMs: DEFAULT_DOCTOR_CACHE_MS,
  probe: () => inspectCodexRuntime(),
  checking: createCheckingCodexRuntimeReport,
});

/** The last Codex report, or a checking report before the first probe. Never waits on the CLI. */
export function readCodexRuntimeDoctor() {
  return doctorCache.read();
}

/** The last Codex report. Waits only while the first probe runs. */
export function loadCodexRuntimeDoctor() {
  return doctorCache.load();
}

/** Probes the Codex CLI now, or joins the probe in flight. */
export function refreshCodexRuntimeDoctor() {
  return doctorCache.refresh();
}
