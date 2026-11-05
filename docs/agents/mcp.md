# Studio MCP

The local `cozy-studio-mcp` server is the agent interface to a running Studio. It calls the running Studio backend, so jobs use the same routes, provider adapters, catalog and persistent job batches as the UI. It does not start another worker or sign in to providers.

This page is the tool contract: registration, access levels, tools, errors and the HTTP routes that agents may call. `studio_guide` serves it as the topic `contract`. [cozy-studio-mcp](../../skills/cozy-studio-mcp/SKILL.md) owns the procedures and the safety rules. The one exception is the agent HTTP route allowlist at the end of this page.

## Register the server

The checkout registers the server as `cozy-studio-mcp` in `.mcp.json` and `.cursor/mcp.json`. Open the repo as a workspace and reload MCP connections. The command is `bun` with `scripts/studio-mcp.ts`, and the working directory is the checkout. Start Studio before calling tools.

For a different workspace, point the same server name at this checkout:

```json
{
  "mcpServers": {
    "cozy-studio-mcp": {
      "command": "bun",
      "args": ["/absolute/path/to/cozy-studio/scripts/studio-mcp.ts"],
      "env": { "COZY_STUDIO_API_URL": "http://127.0.0.1:17223" }
    }
  }
}
```

For Codex, add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.cozy-studio-mcp]
command = "bun"
args = ["/absolute/path/to/cozy-studio/scripts/studio-mcp.ts"]
env = { COZY_STUDIO_API_URL = "http://127.0.0.1:17223" }
tool_timeout_sec = 150
```

The bridge waits 30 seconds for a call, and 120 seconds for `studio_install_extension`, `studio_updates` and `studio_apply_update`. Keep the client tool timeout above 120 seconds.

Use an absolute `bun` executable when the client does not search `PATH`. Set `COZY_STUDIO_API_URL` when the API port is not 17223. The URL must be a loopback HTTP origin. The bridge opens no listening port. `bun run mcp` starts the same script from a shell.

## Access

Settings > Advanced & maintenance > **Agent access (MCP)** controls every call, including calls from already connected clients. Studio reads the setting again on each call. Each level includes the one before it.

| Level        | `mcpAccess` | Adds                                                                                                                                                                                                                            |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Off          | `off`       | Nothing. Every call except `studio_guide` returns 403.                                                                                                                                                                          |
| Read only    | `read`      | The default. Every read tool, including `studio_plan_generation`.                                                                                                                                                               |
| Organize     | `organize`  | `studio_organize_images`, `studio_undo_organize` and `studio_save_smart_collection`: tags, manual memberships and saved filters. They never delete, archive or move images, delete collections, or spend provider usage.        |
| Full control | `write`     | `studio_generate`, `studio_retry_batch`, `studio_cancel`, `studio_import_reference`, `studio_import_reference_file`, `studio_update_settings`, `studio_install_extension`, `studio_remove_extension` and `studio_apply_update`. |

The bridge answers `studio_guide` itself from `skills/cozy-studio-mcp/` and this page, so it works while Studio is offline and when Agent access is Off.

The setting controls the MCP gateway, not the app's own UI and API. Local MCP clients share this setting; there are no per-client credentials. The loopback host and browser-origin checks still apply. No tool returns provider secrets or transcripts. No tool can change `mcpAccess` or `mcpAllowedImportRoots`.

**Allowed import folders**, in the same Settings section, controls which local folders agents can read through `studio_import_reference_file`. Enter one absolute folder path per line and save. The default is empty, which turns off import by path. This permission includes subfolders. Remove a folder or clear the list to revoke access on the next call.

## Tools

| Tool                                                               | Access             | Purpose                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `studio_guide`                                                     | none (bridge)      | The agent guide: `SKILL.md` for `overview`, this page for `contract`, or one reference topic.                                                        |
| `studio_status`                                                    | read               | Health, access level, update status and `unorganized` (`total` for all workspaces, `workspaces` per workspace), with a `notice` or `organizeNotice`. |
| `studio_onboarding`                                                | read               | Onboarding probe and provider readiness, with the ChatGPT sign-in state.                                                                             |
| `studio_providers`                                                 | read               | Provider readiness.                                                                                                                                  |
| `studio_recipes`                                                   | read               | Workflow summaries; `q` filters them, `id` returns one workflow with parameters and defaults.                                                        |
| `studio_find_styles`                                               | read               | Installed style presets by id, name or category, for `studio_generate` `styles`.                                                                     |
| `studio_plan_generation`                                           | read               | Preview a `studio_generate` call: provider, model, workspace, filing and prompt. Spends nothing.                                                     |
| `studio_workspaces`                                                | read               | Workspaces; with `workspaceId`, its tags, collections and `unorganized` count.                                                                       |
| `studio_settings`                                                  | read               | Editable Studio Settings.                                                                                                                            |
| `studio_update_settings`                                           | write              | Change agent-safe settings.                                                                                                                          |
| `studio_extensions`, `studio_extension_json`, `studio_user_styles` | read               | Installed packs, their JSON files, saved user styles.                                                                                                |
| `studio_available_extensions`                                      | read               | Published packs with `installedVersion`, `installedLayers` and `updateAvailable`.                                                                    |
| `studio_install_extension`                                         | write              | Install or update a published pack.                                                                                                                  |
| `studio_remove_extension`                                          | write, destructive | Delete a downloaded pack from disk.                                                                                                                  |
| `studio_jobs`, `studio_job`, `studio_batch`                        | read               | Jobs and batches; `studio_job` with `detail: true` adds model, filing, events and images.                                                            |
| `studio_catalog`                                                   | read               | One workspace's Library images by text, `#tag`, collection, job, batch or workflow. Needs `workspace_id`.                                            |
| `studio_organize_images`                                           | organize           | Tag existing images and add them to or remove them from a collection.                                                                                |
| `studio_undo_organize`                                             | organize           | Undo the newest active organize change in its workspace.                                                                                             |
| `studio_save_smart_collection`                                     | organize           | Save or update a named Smart Collection rule in one workspace. Images stay in place.                                                                 |
| `studio_generate`, `studio_retry_batch`                            | write              | Queue generation, retry the failed jobs of a batch. Both use the user's provider account.                                                            |
| `studio_cancel`                                                    | write, destructive | Cancel a queued or running job.                                                                                                                      |
| `studio_import_reference`, `studio_import_reference_file`          | write              | Import an image reference.                                                                                                                           |
| `studio_updates`                                                   | read               | App update status with source and channel; `check: true` checks the selected channel.                                                                |
| `studio_apply_update`                                              | write, destructive | Apply the checked Git or portable release update, then restart.                                                                                      |

Every input object is strict: an unknown field rejects the call.

### Status and setup

`studio_status` returns `{health, mcpAccess, mcpAccessLabel, unorganized: {total, workspaces: [{id, name, count}]}, update: {source, channel, currentVersion, latestVersion, behind, latestCommit, canUpdate, blocker, checkedAt} | null}`. `mcpAccessLabel` is `Read only`, `Organize` or `Full control`. At Off, `studio_status` returns 403 with `access: "off"`, like every tool except `studio_guide`. `unorganized.total` counts live images with no tags and no manual collection in all workspaces. `unorganized.workspaces` lists each workspace with a count above zero. When the selected channel has an update, the result adds `notice`. When `unorganized.total` is above zero, it adds `organizeNotice`, which recommends organizing one workspace at a time.

`studio_onboarding` returns `{probe, readiness, chatgptAuth, signIn}`. `probe.facts.chatgptLoggedIn` is the ChatGPT sign-in state, and `probe.checks` lists each first-run check. Sign in is a user action in Studio Settings; no tool starts it.

### Library

`studio_catalog` reads the Library of one workspace. It takes `workspace_id` (required), `limit` (1 to 100, default 30), `offset`, `q` (text or `#tag`), `collection_id`, `job_id`, `batch_id`, `recipe_id`, `unorganized` and `sort` (`desc`, `asc`, `prompt`, `prompt_desc`, `ratio` or `id`). Use the id from `studio_workspaces`, or the `workspaceId` that `studio_generate`, `studio_batch` or `studio_job` with `detail: true` returns. A search, also a `#tag` search, never spans workspaces. A call without `workspace_id` returns 400 `Invalid tool arguments`. It returns `{images, total, hasMore}`. Each image row has `id`, `prompt`, `tags`, `thumbnailPath` and `filePath`. Rows do not list collections: page `collection_id` for each collection instead. `unorganized: true` returns live images with no tags and no manual collection in their own workspace. Image IDs work as `studio_generate` `referenceIds`.

`studio_workspaces` without arguments lists the workspaces. With `workspaceId` it returns `{workspace, tags: [{name, color, imageCount}], collections: [{id, name, emoji, kind, rule, imageCount}], unorganized, recentChanges}`. Collection `kind` is `manual` or `smart`; a smart collection has a saved `rule` and a live count. `recentChanges` lists the last five organize changes with their `operationId`, UI or agent `source`, timestamps and counts, including undone entries. An unknown id returns 400 `Unknown workspaceId.`

`studio_save_smart_collection` takes `{workspaceId, name, emoji?, rule}` with Organize or Full control access. It creates a Smart Collection or updates the smart collection with the same name; a manual collection with that name is an error. The rule combines optional `q`, `favorite`, `unorganized`, `providerId`, `recipeId`, `stylePresetId`, `withinDays` (1–3650), `createdFrom` (inclusive) and `createdTo` (exclusive). Dates are ISO timestamps with an offset. A catalog request with `collection_id` evaluates the rule together with its other filters. Smart collections cannot be organize targets; matching one does not affect Unorganized. Saving a rule never changes images or spends provider usage.

`studio_organize_images` takes `{workspaceId, imageIds, addTags?, removeTags?, addToCollection?, removeFromCollection?}`:

- `imageIds`: 1 to 100 ids. Duplicates count once.
- `addTags`, `removeTags`: up to 8 tags each. `addTags` are normalized (`#Pick` is stored as `pick`). `removeTags` must match the stored names exactly, as `tags` shows them.
- `addToCollection`, `removeFromCollection`: a collection name, 1 to 80 characters. A case-insensitive match uses the existing collection. `addToCollection` creates the collection when it is missing.
- Set at least one change. Do not add and remove the same tag or collection.

Studio checks the whole call before the first write. Every image must be live and in `workspaceId`, every image must stay within 32 tags, and `removeFromCollection` must name a collection in that workspace. When a check fails, the call returns 400 and changes nothing; image checks also return the `imageIds` at fault. Then Studio updates the tags of each image that changes and updates the collections. The result is `{workspaceId, imageCount, tags: {added, removed}, collection: {id, name, created, imageCount, addedImageIds} | null, removedFrom: {id, name, removedImageIds} | null}`. `tags.added` and `tags.removed` map each stored tag name to the images that gained or lost that tag, for example `{"pick": ["img-a1"]}`. `addedImageIds` lists the images that were not in the collection before the call. `removedImageIds` lists the images that were in the collection before the call.

One call is one SQLite transaction (`POST /api/catalog/commands/organize`): if any image or change is rejected, nothing changes. The result also includes `operationId`; it is null when nothing changed. MCP records the source as `agent`.

`studio_undo_organize` takes `{operationId}`. Undo only your own changes unless the user asks. Studio restores the recorded pairs and preserves earlier membership; it never reconstructs an inverse from current state. The newest active change in the workspace must be undone first. A 409 `newer_change` identifies the newer operation: stop and report it. Repeating Undo returns `alreadyUndone: true`; missing or expired history returns 404. Studio keeps 20 changes per workspace.

Undo reports `skippedImageIds` for missing or moved images and tags that no longer fit the tag limit. Archived images can still be updated. Renamed tags and deleted collections are left alone. A collection created by the original call stays, empty. The UI exposes the same history through **Recent changes** in the Tags and Collections menus, and shows **Undo** on a success notice.

Imported references land in the Default workspace with the tag `imported reference`, so they never count as unorganized. In the Studio UI, the **Unorganized** toolbar filter shows the same images as `unorganized: true`.

### Generation

`studio_generate` queues 1 to 16 jobs as one persistent batch and returns the batch (`JobBatchDetail`). `studio_plan_generation` takes the same input without `requestId`.

| Field                          | Rule                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestId`                    | Required on `studio_generate`. `batch-` plus letters, digits or hyphens, 8 to 128 characters.                                                                                                                                                                                                                                      |
| `prompt`                       | Required. Up to 32000 characters.                                                                                                                                                                                                                                                                                                  |
| `workspaceId`, `workspaceName` | Exactly one. `workspaceId` must exist. `workspaceName` (1 to 80 characters) uses the workspace with that name, case-insensitive, or creates one with the id `ws-` plus the first 12 hex characters of the SHA-256 of the lowercased name.                                                                                          |
| `tags`                         | Required. Up to 8 hashtags: letters, digits, underscores or hyphens. `#Cover` is stored as `cover`. `[]` opts out.                                                                                                                                                                                                                 |
| `collection`                   | Required. A collection name in that workspace, 1 to 80 characters, created if missing. `null` opts out.                                                                                                                                                                                                                            |
| `providerId`                   | Defaults to `chatgpt`, not the Settings default.                                                                                                                                                                                                                                                                                   |
| `task`                         | `image_generate`, `image_edit`, `style_preset_card`, `sprite_sheet` or `texture_generate`.                                                                                                                                                                                                                                         |
| `recipeId`, `recipeParams`     | From `studio_recipes`. Workflows marked `uiOnly` (Sprite Atlas and Animation Sequence runs) return 400.                                                                                                                                                                                                                            |
| `referenceIds`                 | Up to 16 catalog image IDs. File paths are not generation inputs.                                                                                                                                                                                                                                                                  |
| `aspectRatio`, `imageSize`     | Default `1:1` and `1K`. `imageSize` is `512px`, `1K`, `2K` or `4K`.                                                                                                                                                                                                                                                                |
| `count`                        | 1 to 16, default 1. Each job gets the same input.                                                                                                                                                                                                                                                                                  |
| `styles`                       | 1 to 5 `{packId, presetId, strength?}` from `studio_find_styles`. Uses the styles workflow, so leave `recipeId` out. `strength` (0.1 to 1) defaults to the Settings style intensity. For a baseline without style, leave `styles` out.                                                                                             |
| `outputFormat`                 | Set `gif` for direct animation with `providerId: "openai"` and GPT Image 2.6 Flare or Sunburst in Settings. Use a text-only generation with no references and an automatic or opaque background. Omit for ordinary images.                                                                                                         |
| `styleMode`                    | `generate`, `preserve` or `reinterpret`. Defaults to the Settings reference mode. With Intentional styles on, `preserve` needs `referenceIds`.                                                                                                                                                                                     |
| `model`                        | One call only; Settings do not change. `chatgpt`: `gpt-image-2.6-flare`, `gpt-image-2.6-sunburst`, `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` or `gpt-image-2`. The 2.6 values request static-image aliases; a generic reported model does not confirm the exact variant. `codex`: a Codex model. Other providers return 400. |

`studio_job` with `detail: true` keeps `model` as requested or captured. `reportedImageModel` appears only when the server explicitly reported an image model; a generic identifier does not confirm the requested variant.

Studio compiles `styles` with the same functions and Settings as the Studio UI. The Intentional styles setting picks the compiler. `recipeParams` cannot carry compiled style fields such as `selectedStyles` or `compilerVersion`.

Studio stores the filing in `sourceSpec.metadata.libraryOrganization` and applies it in the same transaction that saves each Catalog Entry. The filing is part of the batch request, so a retry with the same `requestId` must send the same filing.

`studio_plan_generation` runs Studio's normal intake but creates no job, batch or workspace, and calls no provider. It returns `{ready: true, jobCount, providerId, model, task, recipeId, workspace: {id, name, willCreate}, filing: {tags, collection: {name, exists} | null}, providerPrompt, promptChars, styles?}`. `providerPrompt` is cut to 4000 characters. `styles` is `{compiler, mode, issues}`. For `codex`, `model` reads `unknown`. When intake blocks the job, for example because ChatGPT is not signed in, it returns `{ready: false, blocker: {error, code}}`. An invalid input returns 400, as `studio_generate` does.

### Jobs and batches

`studio_batch` takes `{batchId}` and returns the batch: `status`, `counts`, `jobs` and `retryable`, the failed jobs Studio can requeue.

`studio_retry_batch` takes `{batchId, requestId}`. `requestId` is `retry-` plus 2 to 122 letters, digits or hyphens, new for each retry. Studio requeues the `retryable` jobs with their original input and filing and returns `{retried, batch}`. `retried` counts the jobs that Studio queued; a job whose attempt changed since the read is skipped. With no retryable jobs it returns `retried: 0` and changes nothing.

`studio_job` takes `{jobId, detail?}`. Without `detail` it returns `{id, status, error, updatedAt, notices}`. A notice tells how a saved result differs from the request, for example `Requested image size 1024x1024; provider returned 1024x1536. Original dimensions preserved.` The job stays `completed` and keeps the original image. With `detail: true` it returns `{id, status, kind, providerId, recipeId, workspaceId, batchId, attempt, createdAt, updatedAt, completedAt, error, notices, model, libraryOrganization, events, catalogImages}`: the last 20 events as `{type, message, createdAt}`, and the job's Library images as `{id, filePath, thumbnailPath, tags}`. It never returns transcripts or provider payloads.

`studio_jobs` takes `limit`, `workspaceId`, `status` (`completed`, `failed` or `cancelled`) and `cursor`. Queued, running and `needs_review` jobs are always included; `status` filters only finished history.

`studio_cancel` takes `{jobId}`. Finished jobs stay unchanged. Jobs that wait for human review keep that requirement. Cancelling does not guarantee a provider refund.

### Settings

`studio_update_settings` accepts only these fields. Any other field rejects the whole call, and an empty call returns `Provide at least one setting.`

- `language`: `en` or `es`.
- `preferredWorkflow`: a workflow id.
- `disabledWorkflowModules`: workflow module ids.
- `defaultStyleIntensity`: 0.1 to 1.
- `defaultStyleReferenceMode`: `preserve` or `reinterpret`.
- `intentionalStylesV1`: true or false.
- `outputOrganization`: `{subfolderTokens?, fileNameTemplate?}`. Up to 6 tokens from `workspace`, `date`, `provider`, `model`, `recipe` and `workflow`. The template has 1 to 120 characters.
- `notifyOnUpdates`: true or false.

Provider settings (`defaultProviderId`, `providerDefaults`), the output folder (`outputDirectory`), `mcpAccess` and `mcpAllowedImportRoots` stay user-only.

### Packs and updates

`studio_find_styles` takes `{q?, packId?, limit}` (`limit` 1 to 50, default 20) and returns `{styles: [{packId, presetId, name, category, hasIntentionalPolicy, summary}]}`. `q` matches the preset id, name, display name and category.

`studio_install_extension` takes `{sourceId, extensionId, layers?}` from `studio_available_extensions`. Installing a pack that has `updateAvailable` updates it. Without `layers`, the tool keeps the layers already installed for that pack. `layers: ["cards"]` adds full-quality cards; `layers: []` installs without them.

`studio_remove_extension` takes `{extensionId}` and returns `{removed}`. Built-in and local packs cannot be removed.

`studio_updates` reports `source` (`git` or `release`), `channel` (`commits` or `releases`), `currentVersion` and `latestVersion`. A Git checkout defaults to Commits and may choose Releases in Settings; the portable source always uses Releases.

`studio_apply_update` takes the exact `latestCommit` returned by `studio_updates` with `check: true`. It is a Git commit hash for a checkout and the ZIP SHA-256 for a portable release. The checked channel must still be current and `canUpdate` must be true. Both sources require no active jobs and a managed launcher. Git also requires clean `main` with no local commits ahead of the checked target. A portable update requires a matching release asset and a verified digest. The Library, registered image destinations and configured extension roots must stay outside the app and recovery folders that an update would replace. Git fast-forwards and installs dependencies; the portable stages a replacement app. Both restart through their launcher.

### Import an image reference

`studio_import_reference_file` takes `{requestId, path, name?}`. The path must be absolute and inside an allowed folder on the machine that runs Studio. The optional name defaults to the filename. Studio reads the file directly, so image bytes do not pass through the model. Studio resolves the file and the allowed folders with `realpath`. It rejects parent traversal, paths outside allowed folders, symlink or junction escapes, directories and other non-files, and files that change during reading. A missing or inaccessible allowed folder grants no access.

For example, after the user allows `C:/Images`:

```json
{
  "requestId": "reference-character-sheet-1",
  "path": "C:/Images/character.webp",
  "name": "Character sheet"
}
```

`studio_import_reference` takes `{requestId, name, mimeType, base64, sha256}`. `sha256` is the SHA-256 of the decoded source bytes. This tool accepts no filesystem path and needs no allowed folder.

Both tools need Full control and a stable `reference-` request ID. They accept PNG, JPEG, WebP and GIF, up to 8 MiB and 40 million decoded pixels. Studio checks the signature and the decoded image. An animated input supplies its first frame. Studio stores new imports as WebP, scaled down to fit 2048 × 2048 without enlargement and with orientation applied. Images with transparency, or with at most 512 × 512 source pixels, use lossless WebP. Larger opaque images use quality 90. Alpha is kept; resizing changes pixels. An optimized file over 8 MiB is rejected. The source file never changes.

The result is `{requestId, catalogImageId, sha256, storedSha256, mimeType, byteLength}`. `sha256` identifies the original bytes. `storedSha256`, `mimeType` and `byteLength` describe the stored file. Studio saves both hashes with the import receipt and the new Catalog Entry. Existing receipts keep their original files and catalog identities.

Use `catalogImageId` in `studio_generate` `referenceIds` with `task: "image_edit"`. An import makes no generation or provider call. The Catalog Entry and the request receipt persist locally, also across a restart. Reusing an ID for changed content or a changed name returns 409. A file retry still needs permission to read its source.

## Errors

A JSON reply from Studio passes through unchanged and is an error when its HTTP status is not 2xx.

| Reply                                                                                           | Meaning                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 `Unknown Studio MCP tool. If Studio was updated, restart Studio so it knows the new tools.` | The bridge lists a tool that the running Studio predates.                                                                                                                                                                                                                   |
| 403 `{error, access, required}`                                                                 | The tool needs a higher access level. `access` is the current level and `required` the level the tool needs.                                                                                                                                                                |
| 400 `{error: "Invalid tool arguments", issues: [{path, message}]}`                              | The input does not match the tool schema.                                                                                                                                                                                                                                   |
| 400 `{error}`, sometimes with `imageId`, `imageIds` or `issues`                                 | A tool check failed, for example `Unknown workspaceId. Use studio_workspaces, or workspaceName to create one.` Nothing changed, with one exception: when `studio_generate` intake rejects the batch (an error with `code`), a workspace that `workspaceName` created stays. |
| 500 `Could not read <path>. Nothing changed. Call studio_status, then retry.`                   | A read before the first write failed in `studio_workspaces` or `studio_plan_generation`. Call `studio_status`, then retry.                                                                                                                                                  |
| 409                                                                                             | A `requestId` reused with different input, or a state conflict such as an update blocker.                                                                                                                                                                                   |
| 503 `Studio update is incomplete. Finish it in Settings before continuing.`                     | An app update is in progress; Studio blocks writes.                                                                                                                                                                                                                         |

The bridge returns these texts when Studio gives no JSON reply:

- `Cozy Studio is not running at <origin>. ...`: the request did not reach Studio.
- `<tool> did not answer within <N>s. Studio may have accepted it: retry with the same requestId and identical input; ...`: a timeout on `studio_generate` or an import.
- `studio_retry_batch did not answer within <N>s. Studio may have accepted it: call studio_batch; ...`: a timeout on a retry.
- `Studio did not answer <tool> within <N>s. Call studio_status, then retry.`: a timeout on any other tool.
- `The request is larger than Studio accepts. ...`: HTTP 413 from the body limit.
- `Something other than this Studio answered at <origin> (HTTP <status>). ...`: another server, a Studio build without the MCP route, or an internal Studio error (HTTP 500).
- `Unknown guide topic. Topics: <list>. After a Studio update, reload the MCP connection.`: a `studio_guide` topic with no file.

## Agent HTTP routes

Loopback HTTP has no Agent access check: Studio checks only the host and the browser origin. This allowlist is therefore the boundary for agents that have a shell. Use the MCP tools for everything else.

| Route                          | Use                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `GET /api/health`              | Backend health.                                                                                |
| `GET /api/onboarding/probe`    | First-run readiness.                                                                           |
| `GET /api/readiness`           | Provider readiness.                                                                            |
| `GET /api/providers/preflight` | Provider runtime preflight.                                                                    |
| `GET /api/codex/session`       | Only when the user asked for the Codex provider.                                               |
| `POST /api/app-server/start`   | Only when the user asked for the Codex provider and `/api/health` says the app-server is down. |

Every other route is off-limits to agents, including reset, purge and workspace delete, even with a confirm body. [cozy-studio-setup](../../skills/cozy-studio-setup/SKILL.md) owns when to run these checks.
