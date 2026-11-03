# ADR 0012: One Library per workspace

## Status

Accepted (2026-11-02)

## Context

"Library" had two meanings. In code it named the storage folders of the install: the `libraries` table and the `library_id` columns. In the UI it named the user's image sets. The docs said that one Library holds many workspaces. The owner's model is the reverse. `workspaces.library_id` was never read.

## Decision

This extends [ADR 0006](0006-workspace-as-canonical-scope.md).

- One Workspace has exactly one Library (1:1). "Library" is the user-facing name for the images, Tags and Image Collections of one workspace.
- A Library has no disk folder of its own. Files stay in the current folders. Output paths can already include `{workspace}`.
- Tags stay per workspace. The same tag name in two workspaces is two tags, each with its own color.
- Deleting a workspace moves its images to the trash (Archived Images), where the user can restore them, and deletes its tags and collections. Default cannot be deleted.
- Moving an image to another workspace changes only its `workspace_id`. The image keeps its tags; a tag missing in the destination is created there with the same color. The image leaves the collections of its old workspace. An unknown workspace is rejected. The file stays where it is, also when its path contains the old workspace slug.
- One install has no other Libraries.
- The storage axis keeps its code names: the `libraries` table, `catalog_images.library_id`, `jobs.library_id`, `/library/<id>/` URLs, `settings.libraryDir` and `STUDIO_LIBRARY_DIR`. The docs call these folders the Studio data folder and the Output folders, never Library.
- Agent catalog reads name a workspace: `studio_catalog` requires `workspace_id`. Only the trash spans workspaces.

## Consequences

- Migration 15 deletes the tags of deleted workspaces that no live image uses. Migration 16 deletes collection members whose image is in another workspace. Both touch no image row and no file.
- `studio_status` returns `unorganized: {total, workspaces: [{id, name, count}]}` instead of `library: {unorganized}`.
- `GET /api/catalog/search` is removed. Use `GET /api/catalog` with `workspace_id` and `q`.
- `StudioWorkspace.libraryId` and `CatalogWorkspaceSummary.libraryIds` are removed. The `workspaces.library_id` column stays in SQLite, unused.
- Earlier revisions of the ADRs use "Studio Library" for the Studio data folder.
