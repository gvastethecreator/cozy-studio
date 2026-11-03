# Maintenance and cleanup

Agent Library and storage maintenance is read-only. No MCP tool deletes or archives images, compacts storage, prunes logs or resets Studio data. You inspect, explain and propose; the user applies these changes. App updates and pack removal use separate tools and consent rules in [SKILL.md](../SKILL.md).

## "Clean up my library" means organize

Follow [organize-library.md](organize-library.md). Propose tags and collections, not deletion.

If the user wants images out of the Library, they archive the images in Studio: select the images, then click **Archive selected (N)** in the Library toolbar. **Tools > Archive** in the header opens the archived images. There the user restores them or deletes them permanently.

For duplicate review, direct the user to Settings > Advanced & maintenance > **Duplicate images**. The scan covers the active workspace and reports missing or unreadable files. The user reviews each group, keeps at least one image, and confirms which copies move to Archived Images. This does not permanently delete them.

## Check Studio state

| Question                                         | Tool                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is Studio healthy? Is an update available?       | `studio_status`: `health`, `update` and `notice`.                                                                                                          |
| How many images have no tags and no collection?  | `studio_status`: `unorganized.total` for all workspaces, `unorganized.workspaces` for each one. For one workspace: `studio_workspaces` with `workspaceId`. |
| Which jobs failed, and why?                      | `studio_jobs` with `status: "failed"`, then `studio_job` with `detail: true`.                                                                              |
| Which packs are installed? Which have an update? | `studio_extensions` and `studio_available_extensions` (`updateAvailable`).                                                                                 |

A retry of failed jobs spends usage: see [generate-and-compare.md](generate-and-compare.md). For pack updates and removal, see [styles-and-packs.md](styles-and-packs.md).

Done when you can name each finding and the step that fixes it.

## Audit storage

With a shell in the Studio checkout, run only these commands. They open the Studio database read-only.

| Command                                              | Result                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run storage:audit`                              | The size of SQLite, WAL and SHM files, logs, transcripts, references, inline payloads, missing thumbnails, duplicate references and compactable payloads. It prints no private content. |
| `bun run scripts/studio-storage-maintenance.ts plan` | A repair plan made from the audit.                                                                                                                                                      |
| `bun run storage:compact`                            | A dry run of the inline-payload compaction.                                                                                                                                             |
| `bun run storage:thumbnails:backfill`                | A dry run of the missing-thumbnail backfill.                                                                                                                                            |

Without a shell, ask the user to click **Audit storage** in Settings > Advanced & maintenance > Storage maintenance, and to share the result.

Done when you have the audit and, for each fix, its dry-run result.

## Writes that the user does

Show the dry-run result. Then give the user the control or the command. The confirm tokens in these commands are for the user (**Ask before destructive steps**).

| Change                    | In Studio                                                                                                                                                                                         | From a shell                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Compact inline payloads   | Storage maintenance > **Plan database cleanup**, then **Apply plan**.                                                                                                                             | Stop Studio, then `bun run storage:compact -- --write --confirm=compact-inline-payloads`.    |
| Create missing thumbnails | Storage maintenance > **Plan missing thumbnails**, then **Apply plan**.                                                                                                                           | `bun run storage:thumbnails:backfill -- --limit=1000 --write --confirm=backfill-thumbnails`. |
| Prune diagnostic logs     | Storage maintenance > **Prune diagnostic logs**.                                                                                                                                                  | `bun run tooling:logs:prune`                                                                 |
| Hide finished jobs        | **Clear** in the Jobs header. It keeps the images and the job records.                                                                                                                            |                                                                                              |
| Empty the Archive         | **Tools > Archive** in the header, then **Delete permanently**. This cannot be undone.                                                                                                            |                                                                                              |
| Rebuild Studio data       | Settings > Advanced & maintenance > **Rebuild Studio data**. It deletes and recreates the Studio data folder for all workspaces: assets, references, thumbnails, archived items and the database. |                                                                                              |

**Leave user-only actions to the user** says when to mention emptying the Archive or **Rebuild Studio data**. For a stuck Studio, start with the audit and [troubleshooting.md](troubleshooting.md).

Done when the user has the dry-run result and the exact control or command for each write they want.
