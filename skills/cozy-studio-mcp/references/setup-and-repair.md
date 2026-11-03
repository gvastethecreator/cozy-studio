# Setup and repair

[troubleshooting.md](troubleshooting.md) maps each error text to its action.

The `overview` topic names the Studio application folder on its first line (`Studio checkout: <path>`). The `Cozy Studio is not running` message names it too. A source checkout runs Bun scripts there. In a portable install, that folder is `app/`; use the launcher in its parent folder instead.

## Process

1. Find the state.
   - Call `studio_status`. A result with `mcpAccessLabel` means Studio runs: go to step 4.
   - 403 with `access: "off"`: Studio runs, and Agent access is Off. Ask the user to set Agent access (MCP) in Studio Settings > Advanced & maintenance to the level the task needs ([configure.md](configure.md)). Then go to step 4.
   - `Cozy Studio is not running at <origin>.`: go to step 2.
   - No `cozy-studio-mcp` tools in the client, a tool missing from the list, `Something other than this Studio answered at <origin>` or `Unknown Studio MCP tool`: go to step 3.
   - Done when you know which step applies.

2. Start Studio.
   - Identify the launch mode first. `app/portable.json` identifies a portable install. It bundles Bun and the built UI, and it can start without `.env.local`. Do not run checkout setup or install dependencies for that reason.
   - Look for a running Studio before starting another. The checkout defaults to UI 17222 (`STUDIO_UI_PORT`) and API 17223 (`STUDIO_SERVER_PORT`); portable serves both from the API origin. `.env.local` can change the ports. When `GET http://127.0.0.1:<API port>/api/health` answers, reuse that Studio and go to step 3.
   - Portable: open the root **Cozy Studio.bat** on Windows, **Cozy Studio.command** on macOS or **Cozy Studio.sh** on Linux. Use the printed URL if the browser does not open. `PORTABLE.txt` in that root covers OS requirements, trusted-download prompts and lost executable permissions. Do not launch from `app/` for managed updates or restart.
   - Checkout: when the user asks for setup, or `.env.local` is missing, follow `skills/cozy-studio-setup/SKILL.md`. That skill owns initialization, provider readiness and runtime checks. Otherwise run `bun run dev` as a background process in the checkout; it starts the API and UI. Without a shell, give the user that command or the portable launcher for their OS.
   - When port 17223 is busy, `bun run dev` starts the API on the next free port and logs `[dev] Port 17223 unavailable for the backend; starting on port <N>`. The bridge still calls 17223. Set `COZY_STUDIO_API_URL` to `http://127.0.0.1:<N>` in the MCP registration and reload the connection, or follow **Ask before destructive steps** before stopping the process on 17223.
   - A busy UI port stops the start with `Studio UI port 17222 is already in use.` Follow **Ask before destructive steps** before you stop the process that holds it.
   - For other start failures (Codex, Studio data folder path, database), read the matching section of `docs/TROUBLESHOOTING.md` in the application folder.
   - Done when `studio_status` returns JSON.

3. Repair the MCP connection.
   - The bridge runs `bun scripts/studio-mcp.ts` from the application folder (`bun run mcp` in a checkout shell). A portable install includes Bun at `app/runtime/bun.exe` on Windows or `app/runtime/bun` on macOS/Linux. Use its absolute path when no global Bun is installed. The `contract` topic has the registration for each client.
   - No Studio tools in the client: the bridge did not start. `COZY_STUDIO_API_URL must be a loopback HTTP origin.` means the URL must be `http://127.0.0.1:<port>`, `http://localhost:<port>` or `http://[::1]:<port>`, with no path. A client that does not search `PATH` needs the absolute path to `bun`.
   - `Something other than this Studio answered at <origin> (HTTP 500)`: Studio itself probably failed on that call. Call `studio_status`. When it answers, send the call again once. When it fails again, ask the user to check the Studio log.
   - `Something other than this Studio answered at <origin>` with another status: another program or an old Studio build answers on that port. Compare `COZY_STUDIO_API_URL` with the API port that Studio logged. Ask the user to restart the intended checkout or portable install.
   - `Unknown Studio MCP tool. If Studio was updated, restart Studio so it knows the new tools.`: the bridge is newer than the running server. Ask the user to restart Studio: Settings > Help & updates > Restart Studio with a managed launcher, or close and open it again using step 2.
   - A tool from the `contract` topic is missing from the client, or `studio_guide` returns `Unknown guide topic`: the bridge started before the update. Reload the MCP connection in the client.
   - Done when the client lists the Studio tools and `studio_status` returns JSON.

4. Check readiness.
   - Call `studio_onboarding`. When `probe.facts.chatgptLoggedIn` is false, ask the user to sign in at Settings > Accounts & models.
   - Call `studio_providers` for the other providers. A key-based provider that is not ready needs the user's key in `.env.local`: see [configure.md](configure.md).
   - Compare `mcpAccessLabel` from `studio_status` with the level the task needs. [configure.md](configure.md) lists the tools of each level.
   - Done when you know which providers are ready, and you told the user each gap that only they can close.

5. Check, apply and verify an app update.
   - Call `studio_updates` with `check: true`. Read `source`, effective `channel`, `currentVersion`, `latestVersion`, `latestCommit`, `canUpdate`, `blocker` and `error`. A checkout can use Commits or Releases; a portable install always uses Releases. A `notice` from `studio_status` is a prompt to check, not approval to apply.
   - Explain the checked target and obtain the user's agreement (**Ask before destructive steps**). Send `{commit: latestCommit}` to `studio_apply_update` only when `canUpdate` is true. Keep the token exact: it is a Git commit for `source: "git"`, or the release ZIP's SHA-256 for `source: "release"`.
   - Both sources need no active jobs and a managed launcher. Git needs `bun run dev`, clean `main` and no local commits ahead of the checked target. Portable needs the root launcher and storage outside the app and recovery folders. Report a `blocker`; do not change the checkout or move data to bypass it.
   - Git fast-forwards to the checked commit or release tag, installs dependencies with the frozen lockfile and restarts. Portable verifies the matching OS/CPU ZIP and its digest, stages `app.next`, then restarts through the root launcher. It replaces application files, not the Studio data folder.
   - Monitor `studio_updates` while `phase` is `updating`. During `restarting`, poll `studio_status` about every 5 seconds. If Studio does not return within about 2 minutes after restart begins, report the last phase and error, then inspect the launcher output using step 2. Do not start a second update.
   - Reload the MCP connection after restart; the bridge still has the old code and tool list. Check updates again. For Git, compare `currentCommit` with the approved commit; for portable, compare `currentVersion` with the approved version. Report any newer available update separately.
   - Done when the running target matches the approved update and the client lists the current tools.

6. Recover a failed update.
   - `Studio update is incomplete. Finish it in Settings before continuing.` on a write means an update runs or a Git dependency install failed. Read `studio_updates`; wait during `updating` or `restarting`. For `error`, report its exact text.
   - For a failed Git install, the user retries in Settings > Help & updates, or authorizes `studio_apply_update` again with the same checked `commit`. Do not reset, stash or discard checkout changes.
   - For portable, read the root launcher's output. If the new server fails before readiness, the launcher restores `app.previous` and preserves `app.failed`; it does not roll back the database. If a folder is busy, ask the user to close windows or terminals using it, then reopen the root launcher. Preserve recovery folders and all storage. See `PORTABLE.txt` and `docs/PLATFORMS.md` for recovery limits.
   - For a digest, staged-version or protected-storage error, stop and follow [troubleshooting.md](troubleshooting.md). Do not edit manifests, remove protected folders or disable verification. A later attempt needs a fresh check and the user's agreement.
   - Done when the running version and remaining blocker are known; report recovery as incomplete if the approved target is not running.
