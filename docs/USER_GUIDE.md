# User guide

For installation and your first image, start with the [README](../README.md#quick-start). If something is blocked, use [Troubleshooting](TROUBLESHOOTING.md).

## Find a setting

Open Settings from the app header. Settings starts in **Creation & startup**. Search opens the matching section and focuses its control. Changes apply when you select **Save**. **Discard** restores the saved values, including the theme, accent and motion previews. Refreshing diagnostics keeps your unsaved edits.

An invalid or empty filename template blocks Save and stays visible in the footer from any section. **Fix filename template** returns to the field. Provider settings and the onboarding **Connections** open **Accounts & models**.

| Section                | Use it for                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| Creation & startup     | Language, startup workflow, workflow for new workspaces and style defaults    |
| Appearance & layout    | Theme, accent, motion and panel positions                                     |
| Accounts & models      | Sign in, provider selection and model execution defaults                      |
| Files & naming         | Generated image destination, subfolders and filename templates                |
| Data folder & imports  | Scan external images; export and import Library ZIPs with images and metadata |
| Tags & collections     | Rename tags and collections; set tag colors and emojis                        |
| Styles & workflows     | Install style packs and enable built-in workflows                             |
| Advanced & maintenance | Agent access, allowed import folders, diagnostics and repair                  |
| Help & updates         | The Cozy guide, update checks and managed restart                             |

A direct workflow link takes priority over the startup workflow.

### Agent access

**Agent access (MCP)** in **Advanced & maintenance** sets what a local agent can do:

- **Off**
- **Read only** (the default)
- **Organize**: also changes tags and collection memberships, undoes organize changes and saves smart collections
- **Full control**: also generation, imports, settings, style packs and updates

To let an agent import local image references by path, set **Agent access (MCP)** to **Full control**. Enter one absolute path per line in **Allowed import folders**, then save. The permission includes subfolders. An empty list turns off import by path. Studio copies and optimizes the image and does not change the source. See [Studio MCP](agents/mcp.md#import-an-image-reference) for the limits and tool inputs.

## Find, select and compare images

The header labels **Workspace** and **Workflow** separately. Workspace chooses the Library: its images, tags and collections. Workflow chooses the creation tools.

Library search, Favorites and sorting apply to the whole workspace before the results are paged. Selections stay with each workspace while you search or load more images. The selection bar shows how many selected images are not shown now. Download, convert and archive selected act on that full selection. **Archive workspace** shows a fresh count and includes images hidden by filters.

**Delete workspace**, in the workspace menu in the header, moves the images of that workspace to Archived Images (**Tools → Archive** in the header) and deletes its tags and collections. You cannot delete Default. When you restore an image of a deleted workspace, it comes back in a workspace named `Imported (…)`, with its tags but without their old colors.

Studio has no control that moves images to another workspace. A move through the local API changes only the image's workspace: the image keeps its tags and leaves the collections of its old workspace. The file stays where it is, also when its folder name has the old workspace name.

Select 2 to 9 images and choose **Compare N images**. All images share one zoom and position; **One at a time** switches between them without losing it. Scroll or use the zoom buttons; drag or use the arrow keys to pan. When the grid is taller than the window, the wheel scrolls it and Ctrl+wheel or pinch zooms. **Fit image** resets the view, and **Actual size** shows an original at 1:1. Each image shows what differs (prompt, style, model, provider, size). **Pick** marks your favorite. A missing original shows an error in its own cell.

ZIP downloads show progress and the exported count. A partial download lists the missing count, and **Retry missing images** puts those images in a separate ZIP. If every image fails, no empty ZIP is downloaded.

### Tags and collections

Right-click an image, or open **More image actions** in Library, the viewer or the workspace canvas. Choose **Tags** or **Collections**. **New tag** or **New collection** opens a creation popover. Recently used items come first; scroll to load more. For several images, select them and use **Tags and collections** in the Library toolbar. The viewer's details panel has the same controls.

Right-click a carousel thumbnail to act on that image without changing the selected preview. Keyboard users can press Shift+F10 on a focused thumbnail.

**Tags.** Enter hashtags, such as `#character #boss`, and press Enter or **Add tags**. Remove a tag with ×. For a selection, the counts show how many selected images have each tag. + adds the tag to the rest, and × removes it from the selection.

- Hashtags use lowercase letters, numbers, underscores or hyphens. Accents are supported.
- Each image can have up to 32 tags of up to 64 characters each.
- Existing metadata tags stay in place. If saving fails, the input stays available for retry.
- Tags are saved in the Studio catalog. Original image files do not change.
- Tags and tag colors belong to the current workspace. The same tag name in another workspace is a separate tag with its own color.

**Collections.** Check a collection to add the image or selection, and uncheck it to remove them. A mixed checkbox means that only some selected images belong to that collection. Click it to add the rest, or use × to remove the selection. Enter a name and click **Create** to make a new collection that contains these images. Changes save immediately.

- An image can belong to more than one collection. Collections belong to the current workspace.
- Removing images from a collection, or deleting the collection, never deletes the images.

**Undo.** Click **Undo** on the success notice, or open **Recent changes** in the **Tags** or **Collections** menu. The menu shows the last five changes, including changes made by an agent. Undo the newest active change first. It restores only the tags and memberships that change affected, so earlier ones stay. A newly created collection stays, empty. Studio keeps 20 changes per workspace; Undo does not move, archive or delete images.

**Filter and search.** The **Tags** and **Collections** buttons filter Library. Search, Favorites and sorting still apply inside an open collection. **Unorganized**, next to **Favorites**, shows only the images with no tags and no manual collection in this workspace. Images leave that view as you organize them.

**Smart collections.** In **Collections**, choose **New smart collection** to save a filter. Combine search text or hashtags with favorites, Unorganized, provider, workflow, style and a date range. The provider, workflow and style lists show values present in this workspace. Saving opens the collection; its images and count update as matching images change. Search, Favorites and sorting can narrow the view further.

The **Smart** marker distinguishes these collections. Open one and choose **Edit rules** to change its filter. Smart collections do not appear in image organization checklists, and you cannot add images to them by hand. An image that only matches a smart collection still counts as Unorganized. Deleting a smart collection removes its rule and leaves every image in place. Library archive export and import preserve the rules.

**Suggestions.** Open **Unorganized** and choose **Suggest** to review groups based on saved prompts, workflows and styles. This uses no provider and spends no generation usage. Suggestions cover the newest 1000 unorganized images. Edit collection names and tags, and uncheck groups you do not want before applying them.

Each selected group is one organize change. If a group fails, earlier completed groups stay applied and the dialog reports the failure. **Undo** restores confirmed changes newest first and keeps any created collections. It stops if a newer change from elsewhere must be undone first. If an apply response is lost, close the dialog and use **Recent changes** in Tags or Collections to check and undo that change before trying again. The dialog cannot undo a group whose result it could not confirm.

Search Library with `#boss` to match that exact tag in the current workspace, or with `#boss #forest` to require both. You can combine tags with prompt text, Favorites and sorting. For metadata tags with spaces, use quotes, such as `#"imported reference"`.

To rename items, choose tag colors or collection emojis, open Settings → **Tags & collections**. It shows the tags and collections of the current workspace only. Edit the row, then select **Save** or **Cancel**.

## Keep and reuse creative work

**Download image** saves the image file. In the viewer, the complete prompt and its copy button are in the right panel. Double-click the image to fit it in the canvas. **100%** shows one image pixel per screen pixel.

**Use as source** puts the chosen result first in the references. **Use as reference** adds it to the references. In the image viewer, the reuse settings can keep the current references or restore the result's original references. If the originals cannot be read, the current references stay.

Closing the image editor keeps its instruction and mask for that image and workflow during the current tab session. **Discard draft** clears that edit. This draft does not survive a reload of the tab.

If a creation draft or reference cannot be saved, a notice offers a retry and a local copy. Keep that copy before you close the tab if saving still fails.

While images are generating, the Generate button shows the animated Cozy cup. Hover or focus the button to see **Add to queue** with the current image count. Click it to add that batch to the queue.

### Export and import a Library archive

Open Settings → **Data folder & imports** → **Library archive**. **Export this workspace** downloads one ZIP with the original images, prompts, favorites, dates, tags, tag colors and collections. Missing files are listed in the archive.

**Import a Library archive** accepts a Studio Library ZIP up to 1 GiB and opens a new workspace. The source workspace stays as it was. Invalid images and images above 64 MiB are skipped with a reason. Imported files get new IDs; references to local files, jobs and provider credentials are not restored. The metadata-only legacy workspace export remains export-only.

### Review duplicate images

In Settings → **Advanced & maintenance**, use **Duplicate images** to scan the current workspace. Studio compares visual similarity, so review each group before moving images. The first scan reads the originals; later scans reuse cached results.

Studio prefers keeping a favorite, then an organized image, then the oldest. Other favorites are not selected for archiving automatically. Keep at least one image in every group. **Move to Archived Images** asks for confirmation, and those images can be restored from Archived Images.

## Where your files go

Cozy Studio keeps its own data apart from your images. [Platform support](PLATFORMS.md#default-paths) lists the exact default paths for each OS.

| What                                                                                       | Where                                                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Studio data folder: SQLite, settings, references, thumbnails, temporary files, logs, trash | `Library` inside the private app-data folder                                                               |
| Installed style packs                                                                      | `Extensions` in the same app-data folder                                                                   |
| Sign-in tokens for ChatGPT, xAI and Google                                                 | A private file for the current user, never in SQLite                                                       |
| Generated images                                                                           | `Cozy Studio` in your Pictures folder, or the folder you choose in onboarding or Settings → Files & naming |

A portable ZIP has a launcher in its main folder and the application inside `app/`. Start Studio with that outer launcher. It keeps the default Studio data folder, `Cozy Studio Library`, beside `app/`, unless you set `STUDIO_LIBRARY_DIR`.

### File names and folders

Settings → Files & naming can add subfolders and change the file name. The default template is `{timestampUtc}_{generation}_{style}_{prompt}`.

The file name tokens are `{date}`, `{time}`, `{timestamp}`, `{timestampUtc}`, `{generation}`, `{style}`, `{prompt}`, `{workspace}`, `{workflow}`, `{provider}`, `{model}`, `{job}`, `{jobId}` and `{recipe}`.

- `{generation}` is a continuous number with at least six digits. Studio assigns it when a job is queued and keeps it on retry. It continues across days and restarts. Cancelled jobs can leave gaps.
- The default `{timestampUtc}` uses the job creation time in UTC, marked with `Z`, so clock and time zone changes do not reorder files. The custom `{date}`, `{time}` and `{timestamp}` tokens use local time.
- `{prompt}` keeps the first meaningful words of your prompt. `{style}` keeps the style name, or the names of a style mix joined with `+`. An empty token drops its separator.

Folder levels can use workspace, date, workflow, provider and model. The older `recipe` token also names the workflow; when none is selected, it uses `no-recipe`, while `workflow` uses `default`. Custom templates and running jobs keep their captured choices. Existing files stay in place and stay in the catalog.

Downloads and ZIP exports keep their file names. Duplicate names in a ZIP get a numeric suffix. Studio never writes outside the registered folders and never overwrites existing outputs. The Library opens with the newest images first unless its URL selects another order.

### Embedded metadata

New PNG, JPEG and WebP results carry the compiled generation prompt and the known image model inside the file, with the workflow, output settings and generation date. Codex app-server does not report its internal image model, so that field is `unknown`. Studio writes metadata without recompressing the image, and original downloads and ZIP exports keep it. Sharing the original file also shares this prompt.

Existing images are not rewritten automatically. A manual metadata rewrite rebuilds the prompt from the saved job with the current provider compiler.

### Convert or compress images

Use the image action in Library, the image viewer or a workflow result. For several images, select them in Library and choose **Convert selected**. Choose JPG, WebP or PNG.

- JPG and lossy WebP have a quality slider. WebP also offers lossless encoding. PNG has lossless compression levels.
- JPG fills transparent areas with the chosen background color.
- Keep metadata on to keep the embedded prompt, model and EXIF, or turn it off to remove descriptive metadata. Color profiles stay, to keep the appearance.
- Use PNG for 16-bit images. Lossless WebP accepts only 8-bit sources.
- Animated images are not supported.

Save copies in the current output folder and Library, or prepare a download (a ZIP for several images). The originals do not change. The result shows the actual file sizes; conversion does not always make a smaller file. You can retry failed items without repeating completed ones.

### Change storage locations

Onboarding shows the actual images destination. Studio uses the Pictures folder that your OS reports. To use another images folder for new jobs, change it in Settings → Files & naming. Existing files do not move.

To use another Studio data folder, set an absolute `STUDIO_LIBRARY_DIR` in `.env.local`. `STUDIO_IMAGES_DIR` sets the default images folder for a new data folder. Paths must be absolute for the OS that runs the server. Studio keeps an existing images destination or `STUDIO_LIBRARY_DIR`, and it does not migrate an older data folder automatically.

```env
# Windows
STUDIO_LIBRARY_DIR=D:\Cozy Studio Library

# macOS
STUDIO_LIBRARY_DIR=/Users/<your-user>/Cozy Studio Library

# Linux
STUDIO_LIBRARY_DIR=/home/<your-user>/Cozy Studio Library
```

### Import external images

**External folder to scan**, in Settings → Data folder & imports, finds images to import. It does not change the output folder for new images. Scan a registered source before you choose files. **Select all** applies to the files that the scan returned. Files that import leave the list. Files that fail stay selected, so you can retry them.

## Style packs

Studio loads styles only from installed style packs. Settings → Styles & workflows shows each pack's cover and sample cards before you install it. It installs and updates packs published on GitHub.

- The default source is the public `gvastethecreator/cozy-styles` repository, which needs no token. Browse its styles at <https://gvastethecreator.github.io/cozy-styles/>.
- To add sources, set `STUDIO_EXTENSION_REMOTE_SOURCES=owner/repo,owner/repo`. A private source also needs `COZY_STYLES_GITHUB_TOKEN` in `.env.local`.
- To use packs built on this machine, point `STUDIO_EXTENSION_SOURCES` at their build folder.

If someone shares a private pack hub with you, open **Private packs** in the same panel. Enter its link and password, and select **Unlock**. Studio checks the password with the hub and lists the hub's packs under **Get more packs**. **Forget** removes the hub. Studio keeps the password in a private file next to its sign-in tokens, not in Studio Settings.

Each pack downloads with small thumbnails. Tick **Full-quality cards** to also download its large sample cards. An update keeps the cards you already have. After you install or remove a pack, reload Studio to see the change in Styles.

Essentials copies its styles from the full packs. When you install a full pack, Studio hides the matching Essentials copies, so a style never shows twice. Collections list only the collections that your installed packs add styles to.

## Providers

Use the provider control in the Create footer to choose the provider for the next image job. It shows readiness, and Studio Settings saves the choice. A connected session confirms authentication, not available quota.

### ChatGPT (recommended)

Sign in from Settings → Accounts & models. Studio then uses ChatGPT's own subscription HTTP path with GPT Image 2.5 Flare, GPT Image 2.5 Sunburst or GPT Image 2 when available. Usage and models are read over the same path.

These jobs do not create Codex turns, so they do not spend the Codex app-server usage. They can still reach the ChatGPT HTTP usage limit. This path is not a second subscription and not API credits.

### Codex

Codex uses local `codex app-server` and your `codex login`. Choose it only when you want that route. If the Codex path or app-server support is unclear, run `bun run runtime:doctor`. Do not set `STUDIO_CODEX_CLI_PATH` to a `node_modules/.../vendor` binary. Use a supported launcher, such as the desktop binary or `codex.cmd`.

### Grok Imagine

1. Sign in with xAI from Studio Settings, or install Grok Build and run `grok login`. `XAI_API_KEY` in `.env.local` also works on the same HTTP path.
2. Make sure that `bun run providers:preflight -- --provider=grok` reports `canAttempt=true`.

Grok Build keeps its CLI login under `GROK_HOME`. Default supports Grok, including its optional styles. Other workflows offer Grok only when they declare Grok support, so use Default when you want Grok. With references, Grok edits the image; without them, it generates a new one. Each Grok job makes one image, so a batch makes one job per image.

### Google Nano Banana (Untested)

1. Set `GOOGLE_API_KEY` or `GEMINI_API_KEY` to a restricted Gemini key. Or enable the Generative Language API, create a Desktop app OAuth client, and set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_CLOUD_PROJECT_ID`.
2. For OAuth, add your account to the consent-screen test users while the app is in testing. Then connect Google from Studio Settings. `GOOGLE_OAUTH_CLIENT_SECRET` is optional.
3. Make sure that `bun run providers:preflight -- --provider=google` reports `canAttempt=true`.

Direct requests use the Interactions API. An API key takes priority over OAuth. OAuth requests charge quota to `GOOGLE_CLOUD_PROJECT_ID`, and OAuth users need permission to use services in that project. Studio requests `store: false`, but Google's service terms and account controls still apply.

New Google jobs use `gemini-nano-banana-2.1` (1K, 2K or 4K). Studio also supports `gemini-3.1-flash-lite-image` (1K), `gemini-3.1-flash-image` (512px to 4K) and `gemini-3-pro-image` (1K to 4K). Saved jobs keep their selected model. See [Google's image model guide](https://ai.google.dev/gemini-api/docs/image-generation).

### Nano Banana through Antigravity

1. Install the official `agy` CLI, open it once, and complete its Google authentication.
2. Run `agy models`. Then make sure that `bun run providers:preflight -- --provider=antigravity` reports `canAttempt=true`.
3. Select Antigravity in Studio. Its model setting chooses an Antigravity reasoning model. Nano Banana runs behind the CLI as the `generate_image` tool.

Studio never reads or copies Antigravity credentials. It runs one sandboxed headless conversation in a temporary workspace, imports one validated image and leaves Antigravity's own artifact history in place.

### Other untested providers

Settings marks these adapters **Untested**. They follow each API's documented request shape but have not run against the live service. Each one shows Setup until its backend setting exists.

- fal.ai: `FAL_KEY` or `FAL_API_KEY`. `FAL_MODEL` overrides the model.
- OpenAI Images API: `OPENAI_API_KEY`. `OPENAI_IMAGE_MODEL` overrides `gpt-image-1`. Text-to-image only.
- Replicate: `REPLICATE_API_TOKEN`. `REPLICATE_MODEL` overrides `black-forest-labs/flux-schnell`. Text-to-image only.
- ComfyUI local: `COMFY_API_URL` or `COMFYUI_API_URL`, plus `COMFY_WORKFLOW_TEMPLATE_PATH`.

Provider API keys stay in backend environment variables. Do not put Provider Secrets in SQLite, logs, screenshots, docs or committed files.

## Workflows

Open the workflow picker in Create to switch between image, character, camera, animation and game-asset tools. The picker uses the active workflow's icon and accent color. Choose a preferred workflow for startup and for new workspaces in **Creation & startup**.

- Timeline Frame prepares neighboring storyboard frames. Animation Sequence owns frame sequences and GIF export.
- Character views share the source character within a workspace. Each keeps its own action, prompt, appearance, format and background drafts.
- The style catalog also holds the Medieval and TCG visual catalogs. The TCG finishes, layouts and crossover recipes open in Component Studio. It exports a digital PNG composition and does not certify a physical print process.

### Style catalog

The docked style catalog supports three columns. Card names and actions stay below the preview, so the image stays visible on hover. In **Explore**, open a style's information to see its examples. Each example has its prompt and a copy action. Click the image to open the viewer with zoom, download and any available original metadata. Full cards show when they are installed. **Style prompt** marks the preset instructions when the image has no embedded original prompt.

### Backgrounds and transparency

Every workflow offers **Maintain background** or **Remove background**.

- **Maintain** keeps the source background for image-guided work. Explicit prompt or action changes take priority. With text only, it follows the requested scene and uses workflow defaults only when the scene is not specified.
- **Remove** requests a native transparent PNG and turns off automatic backdrops. Native alpha uses the ChatGPT provider and GPT Image models. Flare and Sunburst support transparent output, and GPT Image 2 support is in preview. See the [OpenAI image prompting guide](https://developers.openai.com/api/docs/guides/image-prompting).
- If the provider rejects the request, Studio shows an error. Studio keeps opaque results and reports an alpha warning. It does not apply a hidden cutout.

PNG keeps full alpha. Animation Sequence export can keep alpha or apply an explicit solid fill. GIF uses binary alpha at 128 and clears each frame to avoid trails. A checkerboard is only a preview aid, never part of the saved image.

## Jobs

Jobs separates Active, Review and History, with a workspace filter for each view. Active holds only queued and running jobs. Jobs that need review stay in Review and do not show as loading images in the gallery. Each job has its batch progress and retry. Worker details shows the active slots and provider limits. Queued jobs show why they wait. Providers take turns, and jobs of one provider keep their arrival order.

In the Jobs header, **Clear** hides finished jobs and review requests. The choice persists in this browser and syncs across its Studio tabs. Jobs that are active when you clear stay visible after they finish. Images and job records are kept. **Show cleared jobs** restores the hidden items.

The host sets the worker capacity, which applies after a restart. `STUDIO_MAX_CONCURRENT_JOBS` sets the global limit (default 4, range 1–16). Each `STUDIO_MAX_CONCURRENT_<PROVIDER>_JOBS` value limits one provider (default 1, no higher than the global limit). Invalid limits stop startup. `.env.example` in the checkout lists the provider-specific names.

## Updates and restart

Studio checks its selected update channel when it starts and shows a notice when an update is available. Connected agents see the same source, channel and status through `studio_status`. In **Settings → Help & updates**, turn on **Notify me about updates** to also check every hour while Studio is visible. You can also check by hand.

Git checkouts default to **Commits**, which follows `origin/main`. They may select **Releases** to update only to a published release tag. Portable installs use **Releases** and show the installed and available versions.

**Update and restart** requires a managed launcher and no queued or running jobs. A Git checkout must be on clean `main`, without local commits ahead of the checked target. A portable install must keep its Library outside `app/` and start from the launcher in the main Cozy Studio folder.

Git updates fast-forward to the checked commit, run `bun install --frozen-lockfile`, restart the backend and UI, and reconnect the page. If installation fails, Studio blocks new work and keeps the error visible. Retry installs dependencies for the commit already applied, without fetching Git again.

Portable updates download the matching release ZIP, verify its checksum and stage a new `app/` folder. The root launcher carries over `.env.local` and starts the new app. If it fails before the server begins listening, the launcher restores the previous app. The data folder stays in place; database backups are never restored automatically. See [platform support](PLATFORMS.md) for recovery and unsigned first-run instructions.

**Restart Studio** also works without an update. Save pending settings first. Portable archives started with the launcher in their main folder can restart. Servers started without a managed launcher cannot update or restart from Settings.
