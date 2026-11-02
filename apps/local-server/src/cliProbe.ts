import { spawn, type SpawnOptions } from 'node:child_process';
import { terminateOwnedProcessTree } from './ownedProcessTree';

export interface CliProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | null;
}

export interface CliProbeOptions extends SpawnOptions {
  timeoutMs: number;
  maxOutputBytes?: number;
}

export type CliProbeRunner = (
  command: string,
  args: string[],
  options: CliProbeOptions,
) => Promise<CliProbeResult>;

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Runs one Runtime Doctor CLI probe without blocking the event loop. A probe that runs past
 * `timeoutMs` or writes more than `maxOutputBytes` is stopped and reported as failed.
 */
export function runCliProbe(
  command: string,
  args: string[],
  { timeoutMs, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES, ...options }: CliProbeOptions,
): Promise<CliProbeResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { windowsHide: true, ...options });
    } catch (error) {
      resolve({
        status: null,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: CliProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const stop = (message: string) => {
      if (settled) return;
      try {
        terminateOwnedProcessTree(child);
      } catch {
        // The probe may have exited between the limit and termination.
      }
      finish({ status: null, stdout, stderr, error: new Error(message) });
    };
    const timeout = setTimeout(() => stop(`CLI probe timed out after ${timeoutMs} ms`), timeoutMs);
    const collect = (append: (text: string) => void) => (chunk: string) => {
      append(chunk);
      if (stdout.length + stderr.length > maxOutputBytes) stop('CLI probe output is too large');
    };

    child.stdout?.setEncoding('utf8').on(
      'data',
      collect((text) => (stdout += text)),
    );
    child.stderr?.setEncoding('utf8').on(
      'data',
      collect((text) => (stderr += text)),
    );
    child.once('error', (error) => finish({ status: null, stdout, stderr, error }));
    child.once('close', (code) => finish({ status: code, stdout, stderr }));
  });
}
