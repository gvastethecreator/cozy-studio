/**
 * Stale-while-revalidate cache for a CLI Runtime Doctor. Request paths read it without waiting on
 * a CLI: an expired report stays in use while one background probe replaces it.
 */
export function createRuntimeDoctorCache<Report>({
  maxAgeMs,
  probe,
  checking,
}: {
  maxAgeMs: number;
  probe: () => Promise<Report>;
  /** The report that `read` returns before the first probe finishes. */
  checking: () => Report;
}) {
  let cached: { report: Report; expiresAt: number } | null = null;
  let inFlight: Promise<Report> | null = null;

  const refresh = () => {
    inFlight ??= probe()
      .then((report) => {
        cached = { report, expiresAt: Date.now() + maxAgeMs };
        return report;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const revalidate = () => {
    // A failed probe keeps the last report; the next read tries again.
    if (!cached || cached.expiresAt <= Date.now()) refresh().catch(() => undefined);
  };

  return {
    /** The last report, or `checking` before the first probe finishes. Never waits. */
    read(): Report {
      revalidate();
      return cached?.report ?? checking();
    },
    /** The last report. Waits only while the first probe runs. */
    load(): Promise<Report> {
      revalidate();
      return cached ? Promise.resolve(cached.report) : refresh();
    },
    /** Starts a probe, or joins the one in flight. */
    refresh,
  };
}
