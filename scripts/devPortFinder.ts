import net from 'node:net';

export function isPortAvailable(port: number, hostname = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', () => {
      resolve(false);
    });

    server.listen({ port, host: hostname }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

export async function findAvailablePort(
  startPort = 17223,
  maxAttempts = 50,
  hostname = '127.0.0.1',
  excludedPorts: readonly number[] = [],
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (excludedPorts.includes(port)) continue;
    if (await isPortAvailable(port, hostname)) {
      return port;
    }
  }

  throw new Error(
    `No available port found between ${startPort} and ${startPort + maxAttempts - 1} on ${hostname}.`,
  );
}

export interface DevWaitOptions {
  /** How long to wait in total. A loaded machine can need most of a minute. */
  timeoutMs?: number;
  /** When to print one console note that the wait is still going. */
  slowAfterMs?: number;
  warn?: (message: string) => void;
}

function slowNotice(slowAfterMs: number, warn: (message: string) => void, message: string) {
  const timer = setTimeout(() => warn(message), slowAfterMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/** Windows may report a wrapper exit before its children release their sockets. */
export async function waitForPortRelease(
  ports: readonly number[],
  { timeoutMs = 60_000, slowAfterMs = 10_000, warn = console.warn }: DevWaitOptions = {},
) {
  const deadline = Date.now() + timeoutMs;
  const stopNotice = slowNotice(
    slowAfterMs,
    warn,
    `[dev] Waiting for ports ${ports.join(', ')} to close before Studio restarts...`,
  );
  try {
    await waitUntilPortsRelease(ports, deadline);
  } finally {
    stopNotice();
  }
}

async function waitUntilPortsRelease(ports: readonly number[], deadline: number) {
  while (true) {
    const available = await Promise.all(
      ports.map(
        async (port) => (await isPortAvailable(port)) && (await isPortAvailable(port, '0.0.0.0')),
      ),
    );
    if (available.every(Boolean)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Studio could not release ports ${ports.filter((_, index) => !available[index]).join(', ')}. Close the remaining Studio processes before restarting.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function probeUrl(url: string, timeoutMs = 2_000): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { Connection: 'close' },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolves true when the renderer answers, or false when it is still starting at the deadline.
 * A slow renderer never stops the backend; only a renderer that exits rejects.
 */
export async function waitForRendererReady(
  url: string,
  child: { readonly exitCode: number | null },
  { timeoutMs = 60_000, slowAfterMs = 10_000, warn = console.warn }: DevWaitOptions = {},
) {
  function assertRunning() {
    const exitCode = child.exitCode;
    if (exitCode !== null)
      throw new Error(`Studio UI exited before becoming ready (code ${exitCode}).`);
  }
  const deadline = Date.now() + timeoutMs;
  const stopNotice = slowNotice(
    slowAfterMs,
    warn,
    `[dev] Studio UI at ${url} is still starting; the server keeps running.`,
  );
  try {
    while (Date.now() < deadline) {
      assertRunning();
      const ready = await probeUrl(url, Math.max(1, Math.min(2_000, deadline - Date.now())));
      assertRunning();
      if (ready) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    stopNotice();
  }
  warn(
    `[dev] Studio UI did not answer at ${url} within ${Math.round(timeoutMs / 1000)} s. The server keeps running; check the renderer output.`,
  );
  return false;
}
