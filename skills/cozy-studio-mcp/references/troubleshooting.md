# Troubleshooting

Find the error text, then do the action. Text in `<>` changes per call. A Studio error is JSON with `error`, and some add `code`, `issues`, `imageIds` or `imageId`. A bridge error is plain text.

## Connection

- `Cozy Studio is not running at <origin>. ...`: the bridge cannot reach Studio. Start Studio or ask the user to open it: [setup-and-repair.md](setup-and-repair.md) step 2.
- No `cozy-studio-mcp` tools in the client, for example after `COZY_STUDIO_API_URL must be a loopback HTTP origin.`: the bridge did not start. Follow [setup-and-repair.md](setup-and-repair.md) step 3.
- `Something other than this Studio answered at <origin> (HTTP <status>). ...`: with HTTP 500, an internal Studio error; otherwise a wrong port or an old Studio build. Follow [setup-and-repair.md](setup-and-repair.md) step 3.
- 400 `Unknown Studio MCP tool. ...`, a tool from the `contract` topic missing in the client, or `Unknown guide topic. ...`: Studio or the bridge predates an update. Follow [setup-and-repair.md](setup-and-repair.md) step 3.
- `<tool> did not answer within <N>s. Studio may have accepted it: retry with the same requestId and identical input; ...`: `studio_generate` or an import timed out. Send the same call again with the same `requestId` and identical input. Studio returns the accepted result. Do not make a new `requestId`.
- `studio_retry_batch did not answer within <N>s. ...`: call `studio_batch`. Queued or running jobs mean Studio accepted the retry. When the jobs are still `failed` and none are queued, ask the user, then retry with a new `retry-` id.
- `Studio did not answer <tool> within <N>s. Call studio_status, then retry.`: another tool timed out after 30 s, or after 120 s for `studio_install_extension`, `studio_updates` and `studio_apply_update`. Call `studio_status`, then retry. After `studio_install_extension`, check `studio_extensions` first. After `studio_apply_update`, follow [setup-and-repair.md](setup-and-repair.md) step 5.
- The client reports its own timeout: the client tool timeout is shorter than 120 s. Ask the user to set it above 120 s. The `contract` topic shows how.
- `The request is larger than Studio accepts. Import local images with studio_import_reference_file instead of base64.`: HTTP 413. Import local files with `studio_import_reference_file`.
- `Studio update is incomplete. Finish it in Settings before continuing.` (503, or 400 from an import): an update runs, or its install failed. Studio blocks writes. Follow [setup-and-repair.md](setup-and-repair.md) step 5.
- 500 `Could not read <path>. Nothing changed. Call studio_status, then retry.`: a read failed before the first write. Call `studio_status`, then send the same call again.

## Access and arguments

- 403 `This tool needs <level> access. Agent access is <label>. ...` with `access` and `required`: Agent access is too low. Tell the user which level to set and where: [configure.md](configure.md).
- 400 `Invalid tool arguments` with `issues: [{path, message}]`: the input does not match the tool schema. Fix each field in `issues`, then send the call again.
- `issues` names an unknown key on `studio_update_settings`: that setting is user-only or does not exist. See [configure.md](configure.md).
- `issues` message `Set addTags, removeTags, addToCollection or removeFromCollection.`: `studio_organize_images` has no change. Add at least one.
- `issues` message `Do not add and remove the same tag or collection.`: one name is in both lists. This check counts `#Pick` and `pick` as the same tag. Keep the name in one list.
- `issues` message `Provide at least one setting.`: the settings patch is empty. Send at least one field.

## Generation and plans

Input errors return 400 from both `studio_generate` and `studio_plan_generation`. Intake errors (the entries with a `code`) return 400 from `studio_generate`, and `ready: false` with `blocker: {error, code}` from `studio_plan_generation`.

- `Set workspaceId (an existing workspace) or workspaceName (find or create by name), not both.`: set exactly one of them.
- `Unknown workspaceId. Use studio_workspaces, or workspaceName to create one.`: use an id from `studio_workspaces`, or pass `workspaceName`.
- `Could not read the workspaces. ...` or `Could not create the workspace.`: the workspace step failed and nothing was queued. Call `studio_status`, then send the same call again.
- `Use letters, numbers, underscores or hyphens in each hashtag.`, `Each hashtag can have up to 64 characters.`, `Use a collection name of up to 80 characters.`, `Collection name cannot include control characters.`, or code `invalid_library_organization`: fix `tags` or `collection`. A tag holds only letters, numbers, `_` and `-`. Studio removes a leading `#` and lowercases the tag.
- `Catalog reference not found` with `imageId`: no Library image has that id. Find the image with `studio_catalog` and the `workspace_id` of the workspace where it should be.
- `Catalog reference is unavailable` with `imageId`: the image is in the Archive (trash) or its file is missing. Choose another image. The user can restore it from the Archive.
- `Unknown recipe. ...`, `Recipe Module <id> does not support ...`, a recipe parameter error or code `workflow_module_disabled`: see [workflows-and-recipes.md](workflows-and-recipes.md).
- `This workflow needs its run in the Studio UI (Workflows). studio_generate makes single images.`: Sprite Atlas and Animation Sequence runs work only in the Studio UI. Tell the user to run that workflow in Studio.
- `Style <packId>/<presetId> is not installed. ...`, `styles uses the styles recipe. ...`, `Pass styles instead of compiled style fields.`, `The selected styles have no visual fields to apply.`, `Style pack <packId> cannot be read: ...`, or 400 with style `issues`: see [styles-and-packs.md](styles-and-packs.md).
- `Unknown ChatGPT image model. Use one of: <ids>.`: use one of the listed ids.
- `This provider uses its Settings default model.`: only `chatgpt` and `codex` take `model`. Leave `model` out.
- Code `chatgpt_transport_unavailable` (`ChatGPT Sign in is not ready. ...`): ask the user to sign in at Settings > Accounts & models. Do not switch to `codex`.
- Code `codex_transport_unavailable`: the Codex route is not ready. Use `chatgpt`. Set up Codex only when the user asks for it: `skills/cozy-studio-setup/SKILL.md` in the checkout.
- Code `provider_runtime_blocked` (`Provider cannot execute jobs yet.`) with `detail` and `diagnostics`: the provider is not set up. Read `detail`. For a key-based provider, see [configure.md](configure.md). Tell the user what is missing.
- Code `provider_not_registered` (`Provider is not registered.`): use a provider id from `studio_providers`.
- Code `transparent_background_unavailable`: transparent output works only with `chatgpt`. Use `chatgpt`, or ask the user about an opaque background.
- Code `chatgpt_execution_unsupported` or `codex_execution_unsupported`: the provider rejects the execution options. Read `error`. Leave `model` out or choose another one.
- `Invalid Generation Task Spec` with `code`, `field`, `reason` and `issues`: the recipe input is invalid. Fix `field`. Check the recipe with `studio_recipes {id}`.
- `Unmanaged Generation Task asset`: a reference is not a Library image. Pass Library image ids in `referenceIds`. Import local files first.
- Another `code` with `field` from a provider check, for example for Grok: read `error` and `field`, then fix that field.
- 409 `This request identity was already used for a different batch.`: a batch with this `requestId` was already accepted with other input, and it may be running. The batch id is the `requestId`: read it with `studio_batch` and report it. Start another batch only when the user asks for another run (**Plan before you spend**).

## Jobs and batches

- 404 `Job not found` or `Batch not found`: use ids from `studio_jobs` or from the `studio_generate` result.
- `studio_retry_batch` returns `retried: 0`: no job was retryable, or a job's attempt changed after the read. Call `studio_batch` and report the job states.
- 409 `This retry identity was already used for a different request.`: the earlier retry with this id was queued, and its jobs changed since. Call `studio_batch`. Retry again only after the user confirms the new `retryable` count.
- `studio_retry_batch` returns 400 with a provider `code`: the provider is not ready. Use the provider entries under Generation and plans.
- 409 `job_requires_review` (`Review the job and reconcile its provider result before taking another action.`): the job is `needs_review`. Tell the user. The user resolves it in Jobs > Review.
- 409 `Job cannot be cancelled right now`: the job changed state. Call `studio_job`. It can be finished already.
- A job in `needs_review`: Studio could not confirm the provider result, and `error` gives the reason. Tell the user to resolve it in Jobs > Review. Do not send the request again.
- A `notices` entry such as `Requested image size <a>; provider returned <b>. Original dimensions preserved.`: the job completed, and the saved image differs from the request. Tell the user.

## Failed jobs

The `error` of a failed ChatGPT job starts with one of these texts. Studio can add the provider's own message after it. A retry is `studio_retry_batch`, which spends usage.

- `ChatGPT session expired or was rejected.`: ask the user to sign in again at Settings > Accounts & models.
- `ChatGPT reported an exhausted usage limit for this HTTP route.`: stop generating. Tell the user to wait for the limit to reset. Do not switch to `codex`.
- `ChatGPT temporarily limited requests.`: wait, for the seconds in `Try again in <N> seconds.` when present. Then offer a retry.
- `This account cannot access HTTP image generation.`: tell the user to check the ChatGPT account.
- `ChatGPT reported a service failure.`: offer a retry later.
- A moderation or safety message: tell the user. Change the prompt only with the user.

## Organize

See the Errors table in [organize-library.md](organize-library.md).

## Imports

- 409 `This reference request identity was already used for different input.`: that `reference-` id belongs to other content or another name. After a timeout, send the identical input again. For a new image, use a new id.
- `Reference file import is disabled. Set Allowed import folders in Studio Settings.`: ask the user to add the folder at Settings > Advanced & maintenance > Allowed import folders.
- `Reference file is outside Allowed import folders.`: ask the user to allow its folder, or to choose a file in an allowed folder.
- `Reference file requires an absolute path without parent traversal.`, `Reference path must be a regular file.` or `Reference file could not be read. ...`: pass the absolute path of an image file that Studio can read.
- `Reference image exceeds 8 MiB.`, `Reference image exceeds 40 million pixels.`, `Reference optimized image exceeds 8 MiB.` or `Reference image must contain between 1 byte and 8 MiB.`: ask the user for a smaller image.
- `Reference digest does not match the image bytes.`: set `sha256` to the hash of the decoded bytes.
- `Reference image type does not match its contents.`: set the real `mimeType`.
- `Reference image could not be decoded.`, `... could not be decoded or optimized.` or `Reference file must contain a PNG, JPEG, WebP or GIF image.`: use a PNG, JPEG, WebP or GIF image.
- `Reference file changed during import. Retry with a stable file.`: retry when the file no longer changes.
- `Reference image is no longer available in the catalog.`: the earlier import with this id was deleted. Import again with a new `reference-` id.
- `Reference image changed on disk and was left unchanged.`, `... is not in its Studio Library.` or `A managed reference file already exists for this digest and was left unchanged.`: the stored file differs from its record. Tell the user (**Never delete, archive or move images**).

## Settings

- `Enter an output filename template.`, `Use at most 120 characters in the filename template.`, `Use a filename without folder separators or reserved characters.`, `Unknown filename token: {<token>}.` or `Close each filename token with matching braces.`: fix `outputOrganization.fileNameTemplate`. [configure.md](configure.md) lists the tokens.

## Style packs

- 400 `Request needs a known sourceId and an extension id` or 404 `<source> does not publish <id>`: use the source `id` and the extension `id` from `studio_available_extensions`.
- 422 from `studio_install_extension`: the download failed verification, and Studio kept the installed version. Report the error. Do not retry in a loop.
- 502 from `studio_install_extension`: the source could not be reached. Check `studio_extensions`, then retry once.
- 409 `Built-in and local extensions cannot be removed here`: only downloaded packs can be removed. Tell the user.
- 404 `Not found` or 400 `Unsupported file`: use the ids and file paths from `studio_extensions`.

## Updates

- 400 `Check for updates before updating.`: call `studio_updates` with `check: true` and pass its `latestCommit`.
- 409 `Check for updates again before updating.`, or `New commits arrived. Check and review the update again.` in the `studio_updates` `error`: the checked commit is out of date. Check again, and confirm the new update with the user.
- `Switch to main before updating.`, `Save or commit local changes and untracked files before updating.`, `Local commits differ from origin/main: ...` or `In-app updates need Studio started with bun run dev. ...` (409 or `blocker`): the checkout or the launcher blocks the update. Report it to the user (**Ask before destructive steps**).
- `Wait for active jobs and operations to finish before updating.` or `An update operation is already running.`: wait, then call `studio_updates` again.
- `Studio is already up to date.`: tell the user.
- `studio_updates` shows `phase: "error"` with `error`: the update stopped. Report `error`, then follow [setup-and-repair.md](setup-and-repair.md) step 5.
