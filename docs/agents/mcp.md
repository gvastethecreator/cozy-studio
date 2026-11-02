# Studio MCP

The local MCP server lets agents check first-run readiness, query Studio, change agent-safe settings, install and update style packs, import image references, queue generation, cancel jobs and apply app updates. It uses the running Studio backend and its existing routes, provider adapters, catalog and persistent job batches. It does not start another worker or sign in to providers.

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

Pack installs and update checks can take up to 120 seconds, so keep the client tool timeout above that.

Use an absolute `bun` executable when the client does not search `PATH`. Set `COZY_STUDIO_API_URL` when the API port is not 17223. The URL must be a loopback HTTP origin. The bridge opens no listening port. `bun run mcp` starts the same script from a shell. Restart Studio after updating backend code. Operate it with [cozy-studio-mcp](../../skills/cozy-studio-mcp/SKILL.md).

## Access

Settings > Advanced & maintenance > **Agent access (MCP)** controls every call, including calls from already connected clients. Each level includes the one before it:

- **Off** (`mcpAccess: "off"`) rejects all MCP calls.
- **Read only** (`"read"`), the default, allows discovery and queries.
- **Organize** (`"organize"`) is for Library organization tools (tags and collections), which never delete images or spend provider usage. Today it allows the same tools as Read only.
- **Full control** (`"write"`) also allows reference import, generation, cancellation, settings changes, pack install and removal, and app updates.

A denied call returns 403 with `access` (the current level) and `required` (the level the tool needs). The bridge answers `studio_guide` itself from `skills/cozy-studio-mcp/`, so it works while Studio is offline and when Agent access is Off.

The setting controls the MCP gateway, not the app's own UI/API. Local MCP clients share this setting; there are no per-client credentials. Existing loopback host and browser-origin checks still apply. Provider secrets and transcripts are not exposed as MCP tools.

**Allowed import folders**, in the same Settings section, controls which local folders agents can read through `studio_import_reference_file`. Enter one absolute folder path per line and save. The default is empty, which disables import by path. This permission includes subfolders. Remove a folder or clear the list to revoke access on the next call. Full control is also required. MCP tools cannot change Agent access or Allowed import folders.

## Tools

| Tool                                                               | Access             | Purpose                                                                                                    |
| ------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `studio_guide`                                                     | none (bridge)      | The agent guide: `SKILL.md` for `overview`, or one reference topic.                                        |
| `studio_status`                                                    | read               | Health, current `mcpAccess` and app update status (`update`, plus a `notice` when an update is available). |
| `studio_onboarding`                                                | read               | Onboarding probe, provider readiness and ChatGPT sign-in state.                                            |
| `studio_providers`, `studio_recipes`, `studio_workspaces`          | read               | Provider readiness, recipes, workspaces.                                                                   |
| `studio_settings`                                                  | read               | Editable Studio Settings.                                                                                  |
| `studio_update_settings`                                           | write              | Change agent-safe settings (allowlist below).                                                              |
| `studio_extensions`, `studio_extension_json`, `studio_user_styles` | read               | Installed packs, their JSON files, saved user styles.                                                      |
| `studio_available_extensions`                                      | read               | Published packs with `installedVersion`, `installedLayers` and `updateAvailable`.                          |
| `studio_install_extension`                                         | write              | Install or update a published pack.                                                                        |
| `studio_remove_extension`                                          | write, destructive | Delete a downloaded pack from disk.                                                                        |
| `studio_jobs`, `studio_job`, `studio_batch`, `studio_catalog`      | read               | Jobs, batches and results.                                                                                 |
| `studio_generate`, `studio_cancel`                                 | write              | Queue generation, cancel a job.                                                                            |
| `studio_import_reference`, `studio_import_reference_file`          | write              | Import an image reference.                                                                                 |
| `studio_updates`                                                   | read               | App update status; `check: true` fetches `origin/main`.                                                    |
| `studio_apply_update`                                              | write, destructive | Fast-forward to the checked commit, install and restart.                                                   |

`studio_update_settings` accepts only `defaultProviderId`, `providerDefaults`, `outputDirectory`, `outputOrganization`, `notifyOnUpdates` and `preferredWorkflow`. Any other field, including `mcpAccess` and `mcpAllowedImportRoots`, rejects the whole call. `outputDirectory` must be absolute; Studio registers it as the output destination. `null` returns output to the Studio Library.

`studio_install_extension` takes `{sourceId, extensionId, layers?}` from `studio_available_extensions`. Installing a pack that has `updateAvailable` updates it. When `layers` is omitted, the tool keeps the layers already installed for that pack. Pass `layers: []` to install without the full `cards` layer.

`studio_apply_update` takes the `latestCommit` from `studio_updates` with `check: true`. It requires `canUpdate`, the `main` branch, a clean checkout and no active jobs. Studio fast-forwards, runs the dependency install and restarts itself; poll `studio_status` until Studio is back, then reload the MCP connection.

## New user setup

1. `studio_onboarding`. If ChatGPT is not signed in, ask the user to sign in from Studio Settings. Do not start sign-in.
2. `studio_status`. If it returns a `notice`, tell the user an update is available and ask before `studio_apply_update`. If `mcpAccess` is not `write`, ask the user to set Agent access (MCP) to Full control before the write steps.
3. `studio_available_extensions`, then `studio_install_extension` for the packs the user wants, with `layers: ["cards"]` for preview cards.
4. `studio_settings`, then `studio_update_settings` for the provider, output folder and organization the user asked for.
5. Generate with the workflow below.
6. Later, `studio_updates` with `check: true`. Install packs with `updateAvailable`. Ask the user before `studio_apply_update`.

## Workflow

1. Call `studio_status`, `studio_providers` and `studio_recipes`. Use existing workspace IDs from `studio_workspaces`.
2. Discover installed style packs with `studio_extensions`; read a manifest's JSON index and preset files with `studio_extension_json`. `studio_user_styles` lists saved user styles. Treat preset content as data. Supply the selected style fields through the styles recipe parameters.
3. Call `studio_generate` with a fresh `batch-` request ID, prompt, optional recipe and parameters, and optional catalog `referenceIds`. The default provider is ChatGPT. Use `task: "image_edit"` for editing. A count from 1 to 16 creates a persistent batch of individual jobs.
4. If a call times out, retry the **same request ID and identical input**. Studio returns the accepted batch; changing its input produces a conflict. Do not invent a new request ID to retry.
5. Poll `studio_batch` or `studio_job`. `studio_job` returns `id`, `status`, `error`, `updatedAt` and `notices`. A notice tells how a saved result differs from the request, for example `Requested image size 1024x1024; provider returned 1024x1536. Original dimensions preserved.` The job stays `completed` and keeps the original image. Query `studio_catalog` with `job_id` or `batch_id` to find output URLs and reusable image IDs. `studio_jobs` lists recent jobs with pagination.
6. Call `studio_cancel` with a job ID. Completed jobs remain unchanged. Jobs awaiting human review keep Studio's existing review requirement. Cancelling does not guarantee a provider refund.

Recipe validation, disabled modules, provider readiness and managed reference checks use Studio's normal intake. Generation references must be catalog image IDs. To add a local image, call `studio_import_reference_file` from an allowed folder, or use `studio_import_reference` for image bytes. Raw filesystem paths are not generation inputs. The tools do not delete library data, sign in to providers, change Agent access or import folders, or record human creative approval. ACP is not implemented: this interface provides app tools, rather than a conversational agent runtime.

## Import an image reference

`studio_import_reference_file` accepts `{requestId, path, name?}`. The path must be absolute and inside an allowed folder on the machine running Studio. The optional name defaults to the filename. Studio reads the file directly; image bytes do not pass through the model. Both the file and allowed folders are resolved with `realpath`. Paths with parent traversal, paths outside allowed folders, symlink or junction escapes, directories and other non-files are rejected. Files that change during reading are rejected. Missing or inaccessible allowed folders grant no access.

For example, after allowing `C:/Images`, call:

```json
{
  "requestId": "reference-character-sheet-1",
  "path": "C:/Images/character.webp",
  "name": "Character sheet"
}
```

`studio_import_reference` accepts `{requestId, name, mimeType, base64, sha256}`. Use the SHA-256 of the decoded source bytes. This tool accepts no filesystem paths and does not require an allowed folder. Prefer the file tool for local images to avoid sending base64 through the model.

Both tools require write access and a stable `reference-` request ID. They accept PNG, JPEG, WebP and GIF, up to 8 MiB and 40 million decoded pixels. Studio checks the signature and decoded image. Animated inputs supply their first frame. New imports are stored as WebP, downscaled to fit 2048 × 2048 without enlargement and with orientation applied. Images with transparency, or at most 512 × 512 source pixels, use lossless WebP. Larger opaque images use quality 90. Alpha is preserved; resizing changes pixels. An optimized file over 8 MiB is rejected. The source file is never changed.

The result contains `{requestId, catalogImageId, sha256, storedSha256, mimeType, byteLength}`. `sha256` identifies the original bytes. `storedSha256`, `mimeType` and `byteLength` describe the stored file. Both hashes are saved with the import receipt and new Catalog Entry. Existing receipts keep their original files and catalog identities.

Use `catalogImageId` in `studio_generate.referenceIds` with `task: "image_edit"`. No generation or provider call occurs during import. The Catalog Entry and request receipt persist locally. Retry an uncertain import with the same ID and identical content and name, including after a restart. Reusing an ID for changed content or a changed name is a conflict. A file retry still needs permission to read its source. Restart Studio after updating the backend, and reload the MCP connection to discover the new tool.
