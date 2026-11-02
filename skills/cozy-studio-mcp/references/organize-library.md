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
- Tags and collections belong to one workspace. A tag name in another workspace is a different tag with its own color. An image can be in many collections.
- Smart Collections are living views, not manual filing targets. `studio_workspaces` marks them with `kind: "smart"` and returns their rule. Reuse only manual collection names when generating or organizing.

## Smart Collections

When the user wants a living view, such as all favorites from the last 30 days, use `studio_save_smart_collection` with Organize or Full control access:

```json
{
  "workspaceId": "default",
  "name": "Recent favorites",
  "emoji": "⭐",
  "rule": { "favorite": true, "withinDays": 30 }
}
```

The tool creates the collection or updates the smart collection with the same name. A manual collection with that name is an error. Rules can filter search text and `#tags` (`q`), favorites, unorganized images, provider, workflow (`recipeId`), style (`stylePresetId`), a rolling number of days, or ISO date boundaries (`createdFrom` inclusive, `createdTo` exclusive). All fields narrow the results together. Imported images retain provider matching when their metadata has a provider.

Read the result with `studio_catalog`, sending both `workspace_id` and `collection_id`. Search filters narrow the saved rule further. Counts update as images change; matching a Smart Collection does not organize an image. Never pass a smart name to `studio_organize_images` or to generation filing. In the UI, use Collections → New smart collection, then Edit rules to change it.

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
5. When the batch completes, tell the user the workspace, the tags and the collection. `studio_catalog` with `workspace_id` and `batch_id` lists the images.

Studio applies the filing to each image when it saves the image. `studio_retry_batch` uses the original filing again. `studio_job` with `detail: true` shows the filing as `libraryOrganization`.

Done when every output has the planned tags and collection, or the user chose to opt out.

## Organize existing images

Start here when `studio_status` returns `organizeNotice`, or when the user asks you to organize, sort, tag or clean up images. Steps 1-4 need only Read only access. Step 5 needs Organize or Full control.

### 1. Choose the scope

- Start from `unorganized.workspaces` in `studio_status`: each entry has the workspace `id`, `name` and unorganized `count`. When the user names other workspaces, call `studio_workspaces` for the list. For each candidate, call `studio_workspaces` with `workspaceId`. The result has `tags`, `collections` (with `id` and `imageCount`) and `unorganized`.
- Work on one workspace at a time. One `studio_organize_images` call changes one workspace.
- Choose the mode with the user:
  - **Unorganized only**: the images with no tags and no collection.
  - **Full reorganization**: every image. Use it when images have tags but no collection, or when the user wants a new scheme.

Done when you know the `workspaceId`, its names and the mode.

### 2. Read the whole set

Read every image before the first write.

- Page `studio_catalog` with `workspace_id`, `sort: "asc"` and `limit: 100`. Start at `offset: 0` and add 100 until `hasMore` is false. For the unorganized-only mode, add `unorganized: true`. `sort: "asc"` keeps the order stable, and new images go to the end.
- Rows show `tags` but not collections. For a full reorganization, page `studio_catalog` with `workspace_id` and `collection_id` for each collection from step 1, and record the members.
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
- Page `studio_catalog` with `workspace_id` and `collection_id` for each collection that you changed. Check the `tags` of some rows.
- Tell the user the result for each collection and tag, and the images that you left as is. Tell them where to find the images: the workspace, then **Collections** or a `#tag` search in Library.

Done when the counts match the scheme, or you told the user the reason for each difference.

### Errors

| Result                                                                                           | Cause                                                 | Action                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| 400 `Every image must be live and in workspaceId. Nothing changed.` with `imageIds`              | Those images are deleted or are in another workspace. | Remove them from the call, tell the user, then send the call again. |
| 400 `<tag error> Nothing changed.` with `imageIds`, for example `Use an array of up to 32 tags.` | The tag change does not fit those images.             | Change the tags for those images, or remove them from the call.     |
| 400 collection name error without `imageIds`                                                     | `addToCollection` is not a valid name.                | Use up to 80 characters and no control characters.                  |
| 400 `removeFromCollection is not a collection in this workspace. Nothing changed.`               | The collection name is wrong.                         | Read the names with `studio_workspaces` and `workspaceId`.          |
| 400 `Unknown workspaceId.` from `studio_workspaces`                                              | No workspace has that id.                             | Call `studio_workspaces` without arguments for the ids.             |
| Any other failure                                                                                | The call is one transaction, so nothing changed.      | Call `studio_status`, then send the same call again.                |

### Undo

Call `studio_undo_organize` with the `operationId` returned by `studio_organize_images`. An unchanged call returns `operationId: null` and writes no history.

- Undo only your own calls unless the user asks. The newest active change in that workspace must be undone first. A 409 `newer_change` names the newer `operationId`. Stop and report it.
- After a timeout, find the last five changes in `studio_workspaces` with `workspaceId`, under `recentChanges`. Each entry has `operationId`, `source`, `createdAt`, `undoneAt` and counts. Repeating an undo is safe and returns `alreadyUndone: true`.
- Studio keeps 20 changes per workspace. A missing or expired change returns 404. Do not reconstruct an inverse call from current membership.
- Undo restores only the changed pairs. It reports `skippedImageIds` for missing or moved images and tags that no longer fit the 32-tag limit. Archived images can still be updated. Renamed tags and deleted collections are left alone.
- A collection created by the call stays, empty. No image is deleted, archived or moved.

The user can also click **Undo** on the success toast or open **Recent changes** in the Tags or Collections menu. Undone entries remain visible.

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
