# Workspaces

A workspace holds the images of one project. Its images, tags (with their colors) and collections are its Library. Each image belongs to one workspace, and each collection belongs to one workspace. The same tag name in another workspace is a different tag. For tag and collection names, use the filing scheme in [organize-library.md](organize-library.md).

The Default workspace has the id `default` and the name `Default`. It cannot be deleted. Imported images go into it.

## Choose a workspace

1. Call `studio_workspaces` without arguments. Each entry has `id` and `name`.
2. Find the project that the user names. Names match without case.
3. Choose one:
   - An existing project: its `workspaceId`.
   - A new project: `workspaceName` with the project name. See "Create a workspace".
   - Variants or a comparison of an existing project: the workspace of that project, with a new collection.
   - A one-off image with no project: `workspaceId: "default"`, with tags and a collection.
   - A near match, such as `Comic` and `Comic covers`: ask the user which one to use.
4. For an existing workspace, call `studio_workspaces` with `workspaceId` to get its tags and collections.

Done when you have one `workspaceId` or `workspaceName`, and the names that it already has.

## Create a workspace

Only `studio_generate` creates a workspace, from `workspaceName`. It needs Full control access. No agent tool creates an empty workspace. The user can create one with **Create workspace** (+) in the header.

- Studio first looks for a workspace with that name, trimmed and without case. If there is none, Studio creates one with the id `ws-` plus the first 12 hex characters of the SHA-256 of the lowercase name. The same name always gives the same id, so a retry after a timeout with the same `workspaceName` uses the same workspace.
- `studio_plan_generation` creates nothing. For a new workspace, its result has `workspace.willCreate: true`. When you confirm the plan, tell the user the name of the new workspace.
- Use the project name that the user uses, up to 80 characters.

Done when `studio_workspaces` lists the workspace after the batch is queued.

## Read a workspace

- `studio_workspaces` with `workspaceId` returns `workspace`, `tags` (`name`, `color`, `imageCount`), `collections` (`id`, `name`, `emoji`, `imageCount`) and `unorganized`. It also returns the last five `recentChanges`, with `operationId`, `source`, `createdAt`, `undoneAt` and change counts.
- `studio_catalog` with `workspace_id` lists its images. `workspace_id` is required, and a search never reads another workspace. Add `collection_id` to list one collection.
- `studio_jobs` with `workspaceId` lists its jobs.

## Changes that only the user makes

Agent tools do not rename or delete workspaces, move images to another workspace, or set favorites. When the user asks for one of these changes, tell them where to make it:

| Change                                                            | Where in Studio                                                                                                                                                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename a workspace                                                | Click the name of the active workspace in the header.                                                                                                                                               |
| Delete a workspace                                                | Open the workspace menu in the header, then **Delete workspace**. Its images move to Archived Images, where the user can restore them, and its tags and collections are deleted. Default is locked. |
| Move an image to another workspace                                | Studio has no control for this today.                                                                                                                                                               |
| Mark a favorite                                                   | **Add to favorites** in the image viewer.                                                                                                                                                           |
| Rename tags and collections, set tag colors and collection emojis | Settings > **Tags & collections**.                                                                                                                                                                  |

To group images from two workspaces, add them to a collection in each workspace.
