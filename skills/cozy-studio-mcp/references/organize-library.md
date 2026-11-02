# Organize the Library

This file covers three jobs:

- File new images while you generate them.
- Organize the existing images of a workspace.
- Give the user the manual path in the Studio UI.

## Filing scheme

Use the same scheme when you generate and when you organize.

- **Tags** describe one image. Give each image 2-5 tags: subject (`cover`, `character`), project (`neon-city`), variant (`ink`, `v2`) and, after a review, status (`pick`, `rework`). A comparison uses the tags in [generate-and-compare.md](generate-and-compare.md).
- **Collections** hold a set that the user opens as one unit: a deliverable, a chapter or a comparison. Use one collection per set, for example `Neon City covers`.
- Reuse the names that `studio_workspaces` with `workspaceId` returns: `character`, not a new `characters`.
- Tag format: letters, numbers, `_` or `-`, with no spaces, up to 64 characters. A leading `#` is optional. Studio stores `#Cover` as `cover`.
- Limits: 8 tags in each tag list of a call, 32 tags on one image, 80 characters in a collection name. Collection names match without case.
- A collection belongs to one workspace. An image can be in many collections.

## Organize while generating

Every `studio_generate` call files its outputs. `studio_plan_generation` takes the same fields.

1. Choose the workspace with [workspaces.md](workspaces.md).
2. For an existing workspace, read its names with `studio_workspaces` and `workspaceId`.
3. Set the filing fields:
   - `workspaceId`, or `workspaceName` to find or create the workspace by name. Set one of them, not both.
   - `tags`: 2-5 hashtags from the filing scheme.
   - `collection`: the set name.
   - **Organize while generating** says when to send `tags: []` or `collection: null`.
4. Check `workspace` (with `willCreate`) and `filing` in the `studio_plan_generation` result.
5. When the batch completes, tell the user the workspace, the tags and the collection. `studio_catalog` with `batch_id` lists the images.

Studio applies the filing to each image when it saves the image. `studio_retry_batch` uses the original filing again. `studio_job` with `detail: true` shows the filing as `libraryOrganization`.

Done when every output has the planned tags and collection, or the user chose to opt out.

## Organize existing images

Start here when `studio_status` returns `organizeNotice`, or when the user asks you to organize, sort, tag or clean up images. Steps 1-4 need only Read only access. Step 5 needs Organize or Full control.

### 1. Choose the scope

- Call `studio_workspaces` for the list of workspaces. For each candidate, call `studio_workspaces` with `workspaceId`. The result has `tags`, `collections` (with `id` and `imageCount`) and `unorganized`.
- Work on one workspace at a time. One `studio_organize_images` call changes one workspace.
- Choose the mode with the user:
  - **Unorganized only**: the images with no tags and no collection.
  - **Full reorganization**: every image. Use it when images have tags but no collection, or when the user wants a new scheme.

Done when you know the `workspaceId`, its names and the mode.

### 2. Read the whole set

Read every image before the first write.

- Page `studio_catalog` with `workspace_id`, `sort: "asc"` and `limit: 100`. Start at `offset: 0` and add 100 until `hasMore` is false. For the unorganized-only mode, add `unorganized: true`. `sort: "asc"` keeps the order stable, and new images go to the end.
- Rows show `tags` but not collections. For a full reorganization, page `studio_catalog` with `collection_id` for each collection from step 1, and record the members.
- For each image, record `id`, `prompt`, `tags`, `thumbnailPath`, `filePath` and its collections. For more than one page, keep this inventory in a working file.

Done when your inventory has as many images as the `total` of the last page.

### 3. Look and compare

- Work one page (100 rows) at a time: open its images, write each image's planned change into the working file, then go to the next page. The working file, not your context, holds the decisions.
- Open images as **Look through thumbnails** says. If `filePath` does not open either, mark the image as missing.
- Group the images by prompt and tags first. For a large group, look at a few images to confirm it, and open every image only to choose near duplicates and the best take. Tell the user which groups you sampled.
- Compare similar images to find near duplicates, the best take and the variants.
- Sort by what the user needs: subject, use, variant and status.
- If your client cannot open local files, group by prompt and tags only. Tell the user that you did not look at the images.

Done when the working file gives each image a planned change or the mark "leave as is".

### 4. Propose and wait

Show the scheme as one table:

| Collection or tag  | Rule                                | Images | Example ids        |
| ------------------ | ----------------------------------- | ------ | ------------------ |
| `Neon City covers` | Final cover candidates for the book | 24     | `img-a1`, `img-b7` |
| `rework`           | Wrong hands or broken text          | 6      | `img-c3`           |

Add the totals: images to change, images to leave as is, new tags and new collections. Tell the user that the calls only add and remove tags and collection membership.

Ask the user to confirm or edit the scheme. Apply nothing before they confirm. After an edit, show the changed rows again.

Done when the user confirmed this exact scheme.

### 5. Apply in batches

- Check `mcpAccessLabel` in `studio_status`. If it is `Read only`, ask the user to set Agent access (MCP) to Organize in Studio Settings > Advanced & maintenance.
- One call applies the same changes to all of its images. Group the images that get the same `addTags`, `removeTags`, `addToCollection` and `removeFromCollection`. Split each group into calls of at most 100 `imageIds`.
- A call adds the images to one collection. An image that joins two collections needs two calls.
- `removeTags` matches stored names exactly. Copy them from the row's `tags`, for example `imported reference`.
- After each call, report the change, `imageCount` and `collection.created`. Then send the next call.
- To resume, or to see what is left in the unorganized-only mode, read `unorganized: true` again from offset 0. Organized images leave that filter, so an old offset skips images.

Done when every planned call returned its result.

### 6. Verify and report

- Call `studio_workspaces` with `workspaceId`. Compare the `imageCount` of each collection and the `unorganized` count with the scheme.
- Page `studio_catalog` with `collection_id` for each collection that you changed. Check the `tags` of some rows.
- Tell the user the result for each collection and tag, and the images that you left as is. Tell them where to find the images: the workspace, then **Collections** or a `#tag` search in Library.

Done when the counts match the scheme, or you told the user the reason for each difference.

### Errors

| Result                                                                                           | Cause                                                 | Action                                                                                                |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 400 `Every image must be live and in workspaceId. Nothing changed.` with `imageIds`              | Those images are deleted or are in another workspace. | Remove them from the call, tell the user, then send the call again.                                   |
| 400 `<tag error> Nothing changed.` with `imageIds`, for example `Use an array of up to 32 tags.` | The tag change does not fit those images.             | Change the tags for those images, or remove them from the call.                                       |
| 400 collection name error without `imageIds`                                                     | `addToCollection` is not a valid name.                | Use up to 80 characters and no control characters.                                                    |
| 400 `removeFromCollection is not a collection in this workspace. Nothing changed.`               | The collection name is wrong.                         | Read the names with `studio_workspaces` and `workspaceId`.                                            |
| 400 `Unknown workspaceId.` from `studio_workspaces`                                              | No workspace has that id.                             | Call `studio_workspaces` without arguments for the ids.                                               |
| 500 `Could not read <path>. Nothing changed. Call studio_status, then retry.`                    | Studio could not read the existing names.             | Call `studio_status`, then send the call again.                                                       |
| Any other failure, for example 404 `Catalog image not found`                                     | A write failed. The earlier writes of the call stay.  | Call `studio_status`, then send the same call again. Tags and members that exist stay. Tell the user. |

### Undo

Send the inverse call only for the ids that the result lists. The other images had that tag or membership before the call, so leave them as they are.

- Added tags: for each tag name in `tags.added`, one call with `removeTags` set to that name, for the ids listed under it.
- Removed tags: for each tag name in `tags.removed`, one call with `addTags` set to that name, for the ids listed under it.
- Added to a collection: `removeFromCollection` with the collection name, for `collection.addedImageIds`.
- Removed from a collection: `addToCollection` with the collection name, for `removedFrom.removedImageIds`.

A collection that a call created stays, empty. Agent tools cannot delete a collection or rename a tag. The user does that in Studio (see the manual path).

## Imported images

`studio_import_reference` and `studio_import_reference_file` put each image in the Default workspace (`workspaceId: "default"`) with the tag `imported reference`. These images never count as unorganized. List them with `studio_catalog`, `workspace_id: "default"` and `q` set to `#"imported reference"`. When the user wants them filed for a project, add them to a collection in Default with `studio_organize_images`. No tool moves them to another workspace.

## Manual path in the Studio UI

Give these steps when the user wants to organize by hand, or when Agent access stays Read only.

1. Open the workspace from **Workspace** in the header.
2. In the Library toolbar, turn on **Unorganized**, next to **Favorites**. The grid shows the images with no tags and no collection.
3. Scroll to load the images. Then click **Select loaded images (N)**. It selects only the loaded images.
4. Click **Tags and collections (N selected)**. Add hashtags, and check or create a collection. The changes save immediately, and organized images leave the filter.
5. Do steps 3-4 again until the grid shows "Every image in this workspace has tags or a collection."

To rename tags and collections, or to set tag colors and collection emojis, the user opens Settings > **Tags & collections**. To delete a collection, the user opens **Collections** in the Library toolbar. Its images stay in the Library.
