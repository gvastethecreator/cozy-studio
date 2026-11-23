/**
 * Measures how late a 100 ms timer fires. The lag is the time the event loop spent on synchronous
 * work (SQLite, file I/O, parsing): every request waits that long. Health reports it.
 */
const SAMPLE_MS = 100;
const WINDOW_MS = 60_000;
const RECORD_LAG_MS = 200;
const STALL_LAG_MS = 1_000;

export interface EventLoopStatus {
  lagMs: number;
  maxLagMsLastMinute: number;
  stallsOver1sSinceStart: number;
  lastStall: { at: string; lagMs: number } | null;
}

let current: { read: () => EventLoopStatus; stop: () => void } | null = null;

export function startEventLoopMonitor(onStall: (lagMs: number) => void) {
  current?.stop();
  let expected = performance.now() + SAMPLE_MS;
  let lagMs = 0;
  let stalls = 0;
  let lastStall: EventLoopStatus['lastStall'] = null;
  let recent: Array<{ atMs: number; lagMs: number }> = [];
  const timer = setInterval(() => {
    const now = performance.now();
    lagMs = Math.max(0, Math.round(now - expected));
    expected = now + SAMPLE_MS;
    if (lagMs >= RECORD_LAG_MS) recent.push({ atMs: now, lagMs });
    if (lagMs >= STALL_LAG_MS) {
      stalls += 1;
      lastStall = { at: new Date().toISOString(), lagMs };
      onStall(lagMs);
    }
  }, SAMPLE_MS);
  timer.unref?.();
  current = {
    read: () => {
      const since = performance.now() - WINDOW_MS;
      recent = recent.filter((entry) => entry.atMs >= since);
      return {
        lagMs,
        maxLagMsLastMinute: Math.max(lagMs, ...recent.map((entry) => entry.lagMs)),
        stallsOver1sSinceStart: stalls,
        lastStall,
      };
    },
    stop: () => clearInterval(timer),
  };
  return current;
}

/** Null until the server starts the monitor (tests and tools do not). */
export function readEventLoopStatus(): EventLoopStatus | null {
  return current?.read() ?? null;
}
