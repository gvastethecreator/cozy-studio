import React, { useState } from 'react';
import { ConfirmationModal } from './ConfirmationModal';
import { canResumeStudioJob } from '../lib/studioJobRetry';
import type { ShellActivityJob as StudioJob } from '../lib/shellActivityJob';
import { markStudioJobFailed } from '../services/studio-api/jobs';

const BUTTON =
  'min-h-8 rounded-[var(--wb-radius)] bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] px-2 text-xs text-[color:var(--wb-ink)] hover:bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] disabled:opacity-50';

/**
 * Resolves several Review jobs at once with the per-job actions: Resume for a job whose remote
 * result Studio can still read, and Mark as failed, behind the same usage warning, for the rest.
 */
export function QueueReviewBulkBar({
  jobs,
  selectedIds,
  onSelectionChange,
  onResume,
}: {
  jobs: readonly StudioJob[];
  selectedIds: ReadonlySet<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onResume?: (jobId: string) => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = jobs.filter((job) => selectedIds.has(job.id));
  const resumable = selected.filter((job) => canResumeStudioJob(job));
  const failable = selected.filter((job) => !canResumeStudioJob(job));
  const allSelected = jobs.length > 0 && selected.length === jobs.length;

  const resume = () => {
    for (const job of resumable) onResume?.(job.id);
    onSelectionChange(new Set(failable.map((job) => job.id)));
  };

  const markFailed = async () => {
    setIsConfirming(false);
    setIsWorking(true);
    setError(null);
    const remaining = new Set(selectedIds);
    const failures: string[] = [];
    // One request at a time, like the per-job action; each job.failed event refreshes the list.
    for (const job of failable) {
      try {
        await markStudioJobFailed(job.id);
        remaining.delete(job.id);
      } catch (caught) {
        failures.push(caught instanceof Error ? caught.message : 'Studio could not mark this job.');
      }
    }
    setIsWorking(false);
    onSelectionChange(remaining);
    if (failures.length > 0)
      setError(
        `Studio could not mark ${failures.length} of ${failable.length} jobs. ${failures[0]}`,
      );
  };

  return (
    <div className="space-y-2 rounded-[var(--wb-radius)] border border-[color:var(--wb-border)] p-2 text-xs text-[color:var(--wb-ink)]">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-8 items-center gap-2">
          <input
            type="checkbox"
            aria-label="Select all jobs in Review"
            checked={allSelected}
            ref={(input) => {
              if (input) input.indeterminate = selected.length > 0 && !allSelected;
            }}
            onChange={() =>
              onSelectionChange(new Set(allSelected ? [] : jobs.map((job) => job.id)))
            }
          />
          {selected.length > 0 ? `${selected.length} selected` : `Select all ${jobs.length}`}
        </label>
        <span className="flex-1" />
        {onResume && resumable.length > 0 ? (
          <button type="button" disabled={isWorking} onClick={resume} className={BUTTON}>
            Resume {resumable.length}
          </button>
        ) : null}
        {failable.length > 0 ? (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => setIsConfirming(true)}
            className={BUTTON}
          >
            {isWorking ? 'Marking…' : `Mark ${failable.length} as failed`}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[color:var(--wb-danger)]">
          {error}
        </p>
      ) : null}
      <ConfirmationModal
        isOpen={isConfirming}
        title={`Mark ${failable.length} job${failable.length === 1 ? '' : 's'} as failed?`}
        description="These jobs are in Review because Studio could not confirm their results. The provider may already have made the images."
        details={[
          'Only do this if no image from these jobs arrived in the Library.',
          'After this, Retry sends each job again. If the provider did make an image, its retry uses your provider usage a second time.',
        ]}
        confirmLabel={`Mark ${failable.length} as failed`}
        cancelLabel="Keep in Review"
        tone="warning"
        onClose={() => setIsConfirming(false)}
        onConfirm={markFailed}
      />
    </div>
  );
}
