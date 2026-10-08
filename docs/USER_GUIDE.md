# User guide

For installation and your first image, start with the [README](../README.md#quick-start). If something is blocked, use [Troubleshooting](TROUBLESHOOTING.md).

## Find a setting

Open Settings from the app header. Search opens the matching section and focuses its control. Changes apply when you select **Save**; **Discard** restores saved values, including appearance previews.

| Section                | Use it for                                                     |
| ---------------------- | -------------------------------------------------------------- |
| Creation & startup     | Startup workflow and defaults for new style selections         |
| Appearance & layout    | Theme, accent, motion and panel positions                      |
| Accounts & models      | Sign in, provider selection and model execution defaults       |
| Files & naming         | Generated image destination, subfolders and filename templates |
| Library & imports      | Scan and import external images; export workspace metadata     |
| Styles & workflows     | Install style packs and enable built-in workflows              |
| Advanced & maintenance | Agent access (MCP), storage diagnostics and repair controls    |
| Help & updates         | Getting started, update checks and managed restart             |

## Where your files go

Cozy Studio keeps its own data apart from your images.

| What                                                                                   | Where                                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio Library: SQLite, settings, references, thumbnails, temporary files, logs, trash | `Library` inside the private app-data folder: `%LOCALAPPDATA%\Cozy Studio` on Windows, `~/Library/Application Support/Cozy Studio` on macOS, `~/.local/share/cozy-studio` on Linux |
| Installed style packs                                                                  | `Extensions` in the same app-data folder                                                                                                                                           |
| Sign-in tokens for ChatGPT, xAI and Google                                             | The current user's private app-data folder, never in SQLite                                                                                                                        |
| Generated images                                                                       | `Cozy Studio` in your Pictures folder, or the folder you choose in onboarding or Settings → Files & naming                                                                         |

### File names and folders

Settings → Files & naming can add subfolders and change the file name. The default template is `{timestampUtc}_{generation}_{style}_{prompt}`.

Available file name tokens are `{date}`, `{time}`, `{timestamp}`, `{timestampUtc}`, `{generation}`, `{style}`, `{prompt}`, `{workspace}`, `{workflow}`, `{provider}`, `{model}`, `{job}`, `{jobId}` and `{recipe}`.

- `{generation}` is a continuous number with at least six digits, assigned when a job is queued and preserved on retry. It continues across days and restarts; cancelled jobs can leave gaps.
- The default `{timestampUtc}` uses the captured job creation time in UTC, marked with `Z`, so clock and time zone changes do not reorder files. Custom `{date}`, `{time}` and `{timestamp}` tokens keep local time.
- `{prompt}` keeps the first meaningful words of your prompt; `{style}` keeps the style name, or the names of a style mix joined with `+`. Empty tokens drop their separator.

Folder levels can use workspace, date, workflow, provider, model and recipe. The previous default template upgrades automatically; custom templates and running jobs keep their captured choices. Existing files stay in place and remain in the catalog.

Downloads and ZIP exports preserve their file names, adding a numeric suffix for duplicate ZIP names. Registered roots, safe Windows names and numeric suffixes prevent path escape and overwriting existing outputs. The Library opens with the newest images first unless its URL selects another order.

### Embedded metadata

New PNG, JPEG and WebP results automatically carry the compiled generation prompt and known image model inside the image, together with the recipe, output settings and generation date. Codex app-server does not report its internal image model, so that field is `unknown`. Studio writes metadata without recompressing the image; original downloads and ZIP exports keep it. Sharing the original file also shares this prompt. Existing images are not rewritten automatically. A manual metadata rewrite reconstructs the prompt from the saved job using the current provider compiler.

### Convert or compress images

Use the image action in the Library, image viewer or recipe result, or select several Library images and choose Convert selected. Choose JPG, WebP or PNG.

JPG and lossy WebP expose a quality slider, WebP also offers lossless encoding, and PNG exposes lossless compression levels. JPG fills transparent areas with the chosen background color.

Keep metadata enabled to retain the embedded prompt, model and EXIF, or turn it off to remove descriptive metadata. Color profiles remain to preserve appearance. Use PNG to preserve 16-bit images; lossless WebP accepts 8-bit sources.

Save copies in the current output directory and Library, or prepare a download (ZIP for several images). Originals stay unchanged. The result shows actual file sizes; conversion does not guarantee a smaller file. Failed items can be retried without repeating completed items. Animated images are not supported by these controls.

### Change storage locations

Studio detects the Pictures folder configured by your OS: the Windows Known Folder (including redirected locations), `~/Pictures` on macOS, and `XDG_PICTURES_DIR` from the environment or `user-dirs.dirs` on Linux. Onboarding shows the actual images destination. Linux uses `~/Pictures` when no user directory is configured; if Pictures is disabled in XDG, choose an explicit `STUDIO_IMAGES_DIR`.

To choose another library folder, set an absolute `STUDIO_LIBRARY_DIR` in `.env.local`. `STUDIO_IMAGES_DIR` sets the default images folder for a new library. Paths must be absolute for the OS running the server. An existing images destination or `STUDIO_LIBRARY_DIR` is kept, and the app does not auto-migrate an older library. Changing the images destination in Settings affects new jobs; it does not move existing files.

```env
# Windows
STUDIO_LIBRARY_DIR=D:\Cozy Studio Library

# macOS
STUDIO_LIBRARY_DIR=/Users/<your-user>/Cozy Studio Library

# Linux
STUDIO_LIBRARY_DIR=/home/<your-user>/Cozy Studio Library
```

External folder to scan in Settings → Library & imports finds images to import. It does not change the output directory for new images.

## Style packs

Studio loads styles only from installed style packs (ADR 0011). Settings → Styles & workflows shows each pack's cover and sample cards before you install it, and it installs and updates packs published on GitHub. The default source is `gvastethecreator/cozy-styles`; add more with `STUDIO_EXTENSION_REMOTE_SOURCES=owner/repo,owner/repo`. For a private repository, set `COZY_STYLES_GITHUB_TOKEN` in `.env.local`. To use packs built on this machine, point `STUDIO_EXTENSION_SOURCES` at their folder, such as `../cozy-styles-dev/dist/build`.

Essentials copies its styles from the full packs. When you install a full pack, Studio hides the matching Essentials copies so a style never shows twice.

## Providers

Use the provider control in the Create footer to choose the provider for the next image job. It shows readiness, and the choice is saved in Studio Settings. A connected session confirms authentication, not available quota.

**ChatGPT (recommended).** Settings → Accounts & models → Sign in plus direct subscription HTTP, with GPT Image 2.5 Flare, GPT Image 2.5 Sunburst, or GPT Image 2 when available. Usage and models are read over the same HTTP path. These jobs do not create Codex turns, so they do not spend the Codex app-server usage bucket. They can still reach the ChatGPT HTTP usage limit. This path is not a second subscription and not API credits.

**Codex.** Uses local `codex app-server` and your `codex login`. Choose it only when you want that route. If the Codex path or app-server support is unclear, run `bun run runtime:doctor`. Do not set `STUDIO_CODEX_CLI_PATH` to a `node_modules/.../vendor` binary; use a supported launcher such as the desktop binary or `codex.cmd`.

**Grok Imagine.**

1. Sign in with xAI from Studio Settings, or install Grok Build and run `grok login`.
2. `XAI_API_KEY` in `.env.local` also works on the same HTTP path.
3. Make sure that `bun run providers:preflight -- --provider=grok` reports `canAttempt=true`.

**Google Nano Banana.**

1. Set `GOOGLE_API_KEY` or `GEMINI_API_KEY` to a restricted Gemini key; or enable the Generative Language API, create a Desktop app OAuth client, and set `GOOGLE_OAUTH_CLIENT_ID` plus `GOOGLE_CLOUD_PROJECT_ID`.
2. For OAuth, add your account to the consent-screen test users when the app is still in testing, then connect Google from Studio Settings. `GOOGLE_OAUTH_CLIENT_SECRET` is optional.
3. Confirm that `bun run providers:preflight -- --provider=google` reports `canAttempt=true`.

Direct requests use the Interactions API and current Nano Banana models. An API key takes priority over OAuth. OAuth requests charge quota to `GOOGLE_CLOUD_PROJECT_ID`. Studio requests `store: false`, but Google's service terms and account controls still apply.

**Nano Banana through Antigravity.**

1. Install the official `agy` CLI, open it interactively once, and complete its Google authentication.
2. Run `agy models`, then confirm that `bun run providers:preflight -- --provider=antigravity` reports `canAttempt=true`.
3. Select Antigravity in Studio. Its model setting chooses an Antigravity reasoning model; Nano Banana runs behind the CLI as the `generate_image` tool.

Studio never reads or copies Antigravity credentials. It runs one sandboxed headless conversation in a temporary workspace, imports one validated image, and leaves Antigravity's own artifact history in place. Grok Build keeps its CLI login under `GROK_HOME`.

Provider API keys stay in backend environment variables. Do not put Provider Secrets in SQLite, logs, screenshots, docs, or committed files.

## Workflows and preferences

Open the workflow picker in Create to switch between image, character, camera, animation and game-asset tools. Timeline Frame prepares neighboring storyboard frames; Animation Sequence owns frame sequences and GIF export. Character views share the source character within a workspace and keep separate action, prompt, appearance, format, and background drafts. The style catalog also holds the Medieval and TCG visual catalogs; the TCG finishes, layouts and crossover recipes open in Component Studio, which exports a digital PNG composition and does not certify a physical print process.

Settings starts in Creation & startup. Choose a preferred workflow for startup and for new workspaces. Direct workflow links take priority. Save applies the draft; Discard restores saved settings, including the theme, accent, and motion preview. Search opens the matching section and focuses its control. Help & updates contains the Cozy guide.

Every workflow offers Maintain background or Remove background. Maintain keeps the source background for image-guided work, while explicit prompt or action changes take priority. With text only, it follows the requested scene and uses workflow defaults only when unspecified. Remove requests native transparent PNG and suppresses automatic backdrops. Native alpha uses the ChatGPT HTTP provider and GPT Image models; Flare and Sunburst support transparent output, and GPT Image 2 support is in preview. See the [OpenAI image prompting guide](https://developers.openai.com/api/docs/guides/image-prompting). Provider rejection remains an error. Studio keeps opaque results and reports an alpha warning instead of applying a hidden cutout.

PNG keeps full alpha. Animation Sequence export can preserve alpha or apply an explicit solid fill. GIF uses binary alpha at 128 and clears each frame to avoid trails. A checkerboard is a preview aid, never part of the saved image.

## Jobs

Jobs separates Active, Review, and History, with a workspace filter for each view. Active holds only queued and running jobs; jobs needing review stay in Review and do not appear as loading images in the gallery. Batch progress and retry are available within each job, and Worker details shows active slots and provider limits. Queued jobs show why they wait. Providers take turns; jobs within one provider keep their arrival order.

Worker capacity is configured on the host and applies after restart. `STUDIO_MAX_CONCURRENT_JOBS` sets the global ceiling (default 4, range 1–16). Each `STUDIO_MAX_CONCURRENT_<PROVIDER>_JOBS` value limits one provider (default 1, no higher than the global ceiling). Invalid limits stop startup. See `.env.example` in the checkout for provider-specific names.

## Updates and restart

In **Settings → Help & updates**, enable **Notify me about updates** to check `origin/main` at startup and every hour while Studio is visible. You can also check manually. **Update and restart** requires `bun run dev`, a clean `main` checkout with no local commits ahead of the remote, and no queued or running jobs. It fast-forwards to the checked commit, runs `bun install --frozen-lockfile`, restarts the backend and UI, and reconnects the page. If installation fails, Studio blocks new work and keeps the error visible. Retry installs dependencies for the commit already applied, without fetching Git again. **Restart Studio** also works without an update. Save pending settings first. Portable archives and independently launched servers cannot update or restart from Settings.
