# Generate and compare

This file runs a generation from plan to report, and compares styles, providers, models or style modes on one prompt. `studio_generate` and `studio_retry_batch` need Full control access. The rules in [SKILL.md](../SKILL.md) apply to every step, mainly **Organize while generating**, **Plan before you spend** and **Retry with the same requestId**.

## Generation loop

1. Build the input.
   - Set `prompt`. Choose a workflow with [workflows-and-recipes.md](workflows-and-recipes.md) and styles with [styles-and-packs.md](styles-and-packs.md) when the request needs them.
   - Set the filing fields. [organize-library.md](organize-library.md) gives the naming scheme for the workspace, tags and collection.
   - References are Library image ids in `referenceIds`. To use a local file, import it with `studio_import_reference_file`: an absolute `path` inside Allowed import folders and a stable `requestId` such as `reference-character-sheet-1`. Put the returned `catalogImageId` in `referenceIds`, with `task: "image_edit"` for an edit. Imports land in the Default workspace.
   - Done when the input has `prompt`, one of `workspaceId` or `workspaceName`, `tags` and `collection`.

2. Plan.
   - Call `studio_plan_generation` with the same input and no `requestId`. It creates no job, batch or workspace and calls no provider.
   - Read `providerId`, `model`, `jobCount`, `workspace` (`willCreate: true` means Studio will create it), `filing`, `providerPrompt` (cut to 4,000 characters) and `styles.issues`.
   - `ready: false` returns `blocker: {error, code}`, for example when the provider is not signed in. See [troubleshooting.md](troubleshooting.md).
   - Done when the plan returns `ready: true`.

3. Confirm.
   - When the user asked for exactly these images, skip this step (**Plan before you spend**).
   - Otherwise tell the user the provider, model, image count, workspace, tags and collection.
   - Done when the user agreed, or the request was direct.

4. Generate.
   - Call `studio_generate` with the planned input and a new `requestId` that matches `batch-[a-zA-Z0-9-]+` (8 to 128 characters), for example `batch-neon-city-cover-1`.
   - The result is the batch. Its `id` is the `batchId`. After a timeout, a repeat with the same `requestId` returns the accepted batch.
   - Done when you have the `batchId`.

5. Poll.
   - Call `studio_batch` with `{batchId}` about every 15 seconds.
   - After about 10 minutes, stop polling. Report the current counts and tell the user that the jobs keep running in Studio, and that you can check again when they ask.
   - Done when `counts.queued` and `counts.running` are both 0, or you stopped and reported.

6. Collect.
   - Call `studio_catalog` with `{workspace_id, batch_id, limit: 100}`. The batch result has the `workspaceId`. Each row has `id`, `prompt`, `tags`, `thumbnailPath` and `filePath`.
   - Call `studio_job` with `{jobId}` for its `notices`, such as a returned size that differs from the request. Add `detail: true` for the model, the filing and the last 20 events.
   - Done when you have the image ids of every completed job.

7. Look.
   - Open each image as **Look through thumbnails** says.
   - Compare each image with the request. Describe what you see. The user judges quality.
   - Done when you opened every image, or told the user which images you could not open.

8. Report.
   - Give the batch id, the image ids, the workspace, the tags and the collection.
   - Tell the user where to look: the Library, in that workspace, filtered by the collection.
   - List failed jobs with their errors, and every notice.
   - Done when the user knows where each result is.

## Job outcomes

| `studio_batch` shows | Action                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completed` jobs     | Collect and look (steps 6 and 7).                                                                                                                                                                                                                                     |
| `failed` jobs        | Report each `error`. To retry, follow **Plan before you spend**, then call `studio_retry_batch` with `{batchId, requestId}` and a new `retry-` id. It requeues the jobs in `retryable` with their original input and filing. `retried: 0` means no job was retryable. |
| `needs_review` jobs  | The job `error` gives the reason. The user resolves it in Studio, in Jobs > Review. Tell the user.                                                                                                                                                                    |
| `cancelled` jobs     | Report them.                                                                                                                                                                                                                                                          |

To stop a queued or running job, call `studio_cancel` with `{jobId}`. Finished jobs do not change. Cancelling may not refund provider usage.

## Comparisons

A comparison changes one variable and keeps everything else the same. Each variant is one `studio_generate` call.

1. Fix the shared input.
   - Use the same `prompt`, `referenceIds`, `aspectRatio`, `imageSize`, `count` and `negativePrompt` in every call.
   - File every call in the same workspace and the same collection, for example `Compare ink styles`.
   - Put the same comparison tag on every call: `cmp-<slug>`, for example `cmp-ink`. Add one variant tag per call, for example `sumi-e`.
   - Tags use only letters, numbers, `_` and `-`, up to 64 characters. Replace dots, colons and spaces with `-`: `gpt-image-2.5-flare` becomes `gpt-image-2-5-flare`.
   - Done when each variant input differs from the others only in the variable and the variant tag.

2. Plan every variant.
   - Call `studio_plan_generation` for each variant.
   - Compare the `providerPrompt` values. Only the variable must change them.
   - Unless the user named every variant, confirm once with the user: the variants, the total image count (the sum of each `count`) and the collection.
   - Done when every plan returns `ready: true` and the user agreed.

3. Run every variant.
   - Call `studio_generate` once per variant. Give each call its own `requestId`, for example `batch-cmp-ink-sumi-e`.
   - Poll, collect and look for each batch (loop steps 5 to 7).
   - Done when every batch has no queued or running jobs.

4. Report a results table.
   - Make one row per variant:

     | Variant | Batch | Status | Image ids | Thumbnail | Notes |
     | ------- | ----- | ------ | --------- | --------- | ----- |

   - Under the table, describe the visible differences between the variants.
   - Tell the user how to see them side by side: in the Library, filter by the collection, select 2 to 9 images and choose **Compare N images**. `studio_catalog` with the comparison's `workspace_id` and `q: "#cmp-<slug>"` lists the whole comparison again later.
   - When the user picks favorites, offer to tag them. Use [organize-library.md](organize-library.md).
   - Done when the table has a row for every variant.

### Variables

| Comparison              | Change per call                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Styles × prompt         | `styles: [{packId, presetId}]`, one preset per call                | Add one call without `styles` as a baseline when the user wants it. With Intentional styles on, choose presets with `hasIntentionalPolicy: true`. Without `referenceIds`, set `styleMode: "generate"` on every variant. Variant tag: the preset id.                                                                                                                                      |
| Providers × prompt      | `providerId`                                                       | Use providers that `studio_providers` shows as ready and that the workflow lists in `supportedProviders`. **Plan before you spend** limits `codex`. Leave `model` out. Variant tag: the provider id.                                                                                                                                                                                     |
| Models × prompt         | `model`, with one `providerId`                                     | `chatgpt` takes a GPT Image model id, for example `gpt-image-2.5-flare`. A wrong id returns 400 with the allowed ids, also from `studio_plan_generation`. `codex` takes a Codex model; the plan and `studio_job` report its model as `unknown`, so the variant tag is the record. Other providers return 400 "This provider uses its Settings default model." Variant tag: the model id. |
| Preserve vs Reinterpret | `styleMode: "preserve"` or `"reinterpret"`, with the same `styles` | Needs `referenceIds`. The `styleMode` table in [styles-and-packs.md](styles-and-packs.md) gives each mode's effect. Variant tag: the mode.                                                                                                                                                                                                                                               |
