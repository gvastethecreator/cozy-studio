# Troubleshooting

Start with the fast diagnostics. Then find your symptom below. Each section gives the check and the fix. Provider setup steps are in the [user guide](USER_GUIDE.md#providers).

Paths that start with `.studio/` are inside the Studio Library folder, not in the checkout. [Platform support](PLATFORMS.md#default-paths) lists where the Library is on each OS.

## Fast diagnostics

1. Run `bun run studio:onboard --probe` or use the in-app onboarding checklist.
2. Run `bun run studio:init` when the Bootstrap Configuration or the Studio Library still needs repair.
3. Use the running Studio instance if there is one. If none is running, start the UI and backend with `bun run dev`.
4. Run `bun run providers:preflight` for the selected provider. Use `bun run runtime:doctor` only for the Codex route.
5. Open `http://localhost:17223/api/health` (or your configured API port).

## Setup and Library

### First run is not finished

Sign in with ChatGPT from the welcome screen or Settings → Accounts & models. Setup details expand when work is needed and collapse when Studio is ready. Codex CLI, its login and app-server matter only when you choose the Codex route.

To run setup from a terminal:

```bash
bun run studio:onboard --probe
bun run studio:onboard --setup
```

Mutating steps need an explicit yes. On a TTY the command asks `[y/N]`. Agents that already have user authority can pass `--yes`. A no leaves the disk unchanged.

### The Library is in the wrong folder

The default Studio Library is `Library` inside the private Cozy Studio app-data folder (`%LOCALAPPDATA%\Cozy Studio` on Windows). To keep or choose another Library folder, set an absolute path in `.env.local`:

```env
STUDIO_LIBRARY_DIR=D:\Cozy Studio Library
```

Then run `bun run studio:init`. Studio keeps an existing `STUDIO_LIBRARY_DIR`. It does not migrate an older library automatically.

### New images are not in the folder I expected

External folder to scan is an import source, not the generation destination. Generate writes to the images folder chosen in onboarding or Settings → Files & naming, which is Pictures/Cozy Studio on a new library. A new destination applies to new jobs; existing files do not move.

### A provider check fails next to saved settings

A failed provider diagnostic can show beside settings that loaded or saved correctly. It does not mean that the settings write failed. Refreshing diagnostics keeps your unsaved edits.

## ChatGPT

### ChatGPT HTTP generation is rejected

A connected session only confirms authentication. The job diagnostics name the cause: exhausted quota, a temporary rate limit, an expired session, missing access or a service failure. They keep a sanitized provider message and `Retry-After` when the provider sends it. A generic HTTP 429 or "rate limit" message is a temporary limit, not proof that the subscription is exhausted.

Studio does not switch a failed job to another provider. If a submission was interrupted or its result is uncertain, the job goes to review. Inspect it before you generate again.

## Codex route

These problems affect only the Codex provider. They do not block an authenticated ChatGPT connection.

### `codex` is missing or does not respond

Symptoms: `codexCli.available: false`, and jobs that use the Codex provider do not start.

Make sure that the selected CLI path and `PATH` are correct. Restart the terminal after you install Codex. Then run:

```bash
bun run runtime:doctor
```

The doctor reports the selected executable, CLI metadata, app-server support and the recommended action. It does not print secrets. A changed version string alone is not a setup failure.

### Studio stopped working after a Codex update

Symptoms: a checkout that worked before the update no longer starts jobs, `app-server` fails to bind, or Runtime Doctor reports a path inside `node_modules/.../vendor`.

1. Stop the old `bun run dev` process and start it again. Managed shutdown closes the UI, the backend and the owned `codex app-server` process tree.
2. Run `bun run runtime:doctor`. Make sure that it selects a supported desktop, npm, Bun or PATH launcher with `app-server` capability.
3. Open `http://localhost:17223/api/health`. `checks.onboardingReady` is true when the Library is ready and either Studio ChatGPT Sign in or Codex CLI + app-server + Local Codex Session is ready.
4. If you set `STUDIO_CODEX_CLI_PATH` or `CODEX_CLI_PATH`, point it at a stable launcher. Never pin a release-specific vendor path.

### An old `codex` install is selected

Symptoms: jobs fail with WebSocket connection errors, `runtime:doctor` reports `codex_cli_legacy`, and health shows `codexRuntime.status: blocked`. The selected CLI does not have `codex app-server`.

A common Windows case: `C:\Users\<you>\AppData\Roaming\npm\codex.cmd` points to an unrelated old npm package named `codex`, and OpenAI Codex is missing or later in `PATH`. The setup UI shows the selected executable, the failing command, the top candidates and repair commands that you can copy.

```bash
npm uninstall -g codex
codex login
bun run runtime:doctor
```

If Codex is still missing after you remove the old shim, install or update the current OpenAI Codex CLI through its supported channel. Then run `bun run runtime:doctor` again and restart `bun run dev:server`.

### `codex app-server` is not available

Symptoms: the backend starts but generations do not progress, and `appServer.running: false`.

Make sure that app-server support is present, the Codex session is signed in and the WebSocket port is free.

### Codex session expired

Symptoms: Codex CLI exists, but jobs fail with permission or authorization errors.

Run `codex login`, complete its ChatGPT authentication, and restart the Studio runtime if necessary. Studio's ChatGPT provider signs in separately through Settings → Accounts & models. That sign-in does not repair a Codex CLI session.

If the selected route is unavailable, Studio blocks the job and shows the setup action for that route. It does not switch accounts silently.

### Codex usage is exhausted

Luna Reserve belongs to the signed-in Codex app-server session. When the regular Codex usage is exhausted, select `GPT-Reserve` and a reasoning mode such as `MAX`. For ordinary image jobs, use the ChatGPT provider instead. The [user guide](USER_GUIDE.md#chatgpt-recommended) explains how the two routes use your plan.

## Grok Imagine is missing or blocked

Symptoms: the Grok Settings card shows `not_configured`, or Grok jobs fail before they run.

```bash
grok version
grok models
bun run providers:preflight -- --provider=grok
```

The preflight must report `canAttempt=true`. If it does not, sign in with xAI from Studio Settings, set `XAI_API_KEY` in `.env.local`, or run `grok login`.

- **HTTP 403 after a successful xAI Sign in:** some SuperGrok tiers do not include this access. The token is good. Studio uses the Grok Build CLI only when the explicit HTTP fallback policy allows it, and it never resends an uncertain submission through another route.
- **The wrong binary is selected:** set `STUDIO_GROK_CLI_PATH` to the stable native Grok executable and restart the backend.
- **A stored model is rejected:** HTTP generation uses `grok-imagine-image-2.0` unless `GROK_IMAGE_MODEL` or Settings store a current `grok-imagine-*` ID. If the stored model is not in the `grok models` list, Studio rejects the job before it is queued.

Studio also rejects these Grok jobs before they are queued:

- unresolved remote references
- source files outside the Studio Library that the job captured
- more than five CLI source images or three HTTP edit source images
- unsupported explicit aspect ratios
- output counts other than one

Import the reference into the Library, or choose a supported ratio (`1:1`, `16:9`, `9:16`, `4:3` or `3:4`), and retry. The Generate dock names the same blocks.

## Google Nano Banana is missing or blocked

Symptoms: the Google Settings card shows `not_configured`, Sign in cannot start, or Studio rejects a Google job before it runs.

```bash
bun run providers:preflight -- --provider=google
```

The preflight names the missing field without showing its value. Check the credential steps in the [user guide](USER_GUIDE.md#google-nano-banana-untested). The Google Cloud project must have the Generative Language API turned on.

- **An old model override fails:** remove a `gemini-2.5-flash-image` override and retry.
- **The browser cannot return to Studio after Google sign-in:** the callback uses `127.0.0.1` on a temporary port. Allow local loopback traffic, cancel the pending sign-in and retry. A state mismatch closes that sign-in.

Studio does not reuse credentials from Antigravity, Gemini CLI, a browser profile or another token store.

## Antigravity is missing or blocked

Symptoms: the Antigravity Settings card shows `not_configured`, or the job fails before the CLI starts.

```bash
agy --version
agy models
bun run providers:preflight -- --provider=antigravity
```

Studio needs a current CLI with the headless stream, sandbox, model and permission controls. If `agy models` reports an authentication error, open `agy` and complete Google authentication. Set `STUDIO_ANTIGRAVITY_CLI_PATH` to an absolute native executable path only when normal discovery selects the wrong binary.

Edit sources must already be inside the Studio Library that the job captured. A ready preflight proves the CLI, login, flags and model discovery. It does not prove image credits or account access; only a live generation does.

## Startup

### Only the UI is running

Symptoms: `dev:ui` opens, but jobs and assets do not sync.

Use `bun run dev`, or run `dev:server` and `dev:ui` in parallel.

### Ports are busy

Symptoms: Vite or Bun reports `listen` errors.

Change `STUDIO_SERVER_PORT` or `STUDIO_CODEX_WS_PORT` in `.env.local`. `bun run dev` returns the exit code of the first child that fails. On Windows, it stops the wrapper process trees, so Vite or Codex children do not keep the ports after a failed start.

### `bun install` stalls on Windows

Symptoms: Bun stops responding after it extracts dependencies.

Stop that install and retry with `bun install --backend copyfile`. Use the same backend with `--frozen-lockfile` when you validate that checkout. Do not change the package manager or edit the lockfile by hand.

### `studio:init` reports a foreign-key failure

Symptoms: SQLite reports `FOREIGN KEY constraint failed` while a migration rebuilds `jobs` or another parent table.

Current migrations keep child rows and check `foreign_key_check` before they commit. Stop the local server, update the checkout, and then run:

```bash
bun install --frozen-lockfile
bun run studio:init
```

Do not delete `.studio/studio.sqlite` to get past the error. If it still fails, keep the database and its `-wal` and `-shm` files together, and report the exact stack. Restore from a copy only after the server is stopped.

## Storage and logs

### The Library uses too much disk space

Run `bun run storage:audit`. It reports SQLite size, WAL and SHM files, logs, transcripts, references, historical inline payloads, missing thumbnails, duplicate references and compactable payloads. It does not print private content. In the app, Settings → Advanced & maintenance runs the same audit and the plans below.

`storage:compact` only plans by default. To write the historical compaction, stop the local server and run:

```bash
bun run storage:compact -- --write --confirm=compact-inline-payloads
```

### Old images have no thumbnails

To plan the backfill without writing, run:

```bash
bun run storage:thumbnails:backfill
```

To write a planned batch, run:

```bash
bun run storage:thumbnails:backfill -- --limit=1000 --write --confirm=backfill-thumbnails
```

### I cannot find older log lines

Backend logs rotate under `.studio/logs/history`. `/api/logs` and the activity panel show a recent window, not the full history.
