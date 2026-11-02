# Setup and repair

[troubleshooting.md](troubleshooting.md) maps each error text to its action.

The Studio checkout is the folder that the `overview` topic names on its first line (`Studio checkout: <path>`). The `Cozy Studio is not running` message names it too. Run every shell command below in that folder.

## Process

1. Find the state.
   - Call `studio_status`. A result with `mcpAccessLabel` means Studio runs: go to step 4.
   - 403 with `access: "off"`: Studio runs, and Agent access is Off. Ask the user to set Agent access (MCP) in Studio Settings > Advanced & maintenance to the level the task needs ([configure.md](configure.md)). Then go to step 4.
   - `Cozy Studio is not running at <origin>.`: go to step 2.
   - No `cozy-studio-mcp` tools in the client, a tool missing from the list, `Something other than this Studio answered at <origin>` or `Unknown Studio MCP tool`: go to step 3.
   - Done when you know which step applies.

2. Start Studio.
   - When the user asks for setup, or the checkout has no `.env.local`, follow `skills/cozy-studio-setup/SKILL.md` in the checkout. That skill owns initialization, provider readiness and runtime checks. Come back here when it reports Studio ready.
   - Without a shell, ask the user to open Cozy Studio: the portable launcher, or `bun run dev` in the checkout.
   - With a shell, look for a running Studio first. The default ports are UI 17222 (`STUDIO_UI_PORT`) and API 17223 (`STUDIO_SERVER_PORT`); `.env.local` can change them. When `GET http://127.0.0.1:<API port>/api/health` answers, reuse that Studio and go to step 3.
   - Otherwise run `bun run dev` in the checkout as a background process. It starts the API and the UI.
   - When port 17223 is busy, `bun run dev` starts the API on the next free port and logs `[dev] Port 17223 unavailable for the backend; starting on port <N>`. The bridge still calls 17223. Set `COZY_STUDIO_API_URL` to `http://127.0.0.1:<N>` in the MCP registration and reload the connection, or free port 17223 and start again.
   - A busy UI port stops the start with `Studio UI port 17222 is already in use.` Follow **Ask before destructive steps** before you stop the process that holds it.
   - For other start failures (Codex, Library path, database), read the matching section of `docs/TROUBLESHOOTING.md` in the checkout.
   - Done when `studio_status` returns JSON.

3. Repair the MCP connection.
   - The bridge runs `bun scripts/studio-mcp.ts` from the checkout (`bun run mcp` in a shell). The `contract` topic has the registration for each client.
   - No Studio tools in the client: the bridge did not start. `COZY_STUDIO_API_URL must be a loopback HTTP origin.` means the URL must be `http://127.0.0.1:<port>`, `http://localhost:<port>` or `http://[::1]:<port>`, with no path. A client that does not search `PATH` needs the absolute path to `bun`.
   - `Something other than this Studio answered at <origin> (HTTP 500)`: Studio itself probably failed on that call. Call `studio_status`. When it answers, send the call again once. When it fails again, ask the user to check the Studio log.
   - `Something other than this Studio answered at <origin>` with another status: another program or an old Studio build answers on that port. Compare `COZY_STUDIO_API_URL` with the API port that Studio logged. Ask the user to restart Studio from the current checkout.
   - `Unknown Studio MCP tool. If Studio was updated, restart Studio so it knows the new tools.`: the bridge is newer than the running server. Ask the user to restart Studio: Settings > Help & updates > Restart Studio under `bun run dev`, or close and open it again.
   - A tool from the `contract` topic is missing from the client, or `studio_guide` returns `Unknown guide topic`: the bridge started before the update. Reload the MCP connection in the client.
   - Done when the client lists the Studio tools and `studio_status` returns JSON.

4. Check readiness.
   - Call `studio_onboarding`. When `probe.facts.chatgptLoggedIn` is false, ask the user to sign in at Settings > Accounts & models.
   - Call `studio_providers` for the other providers. A key-based provider that is not ready needs the user's key in `.env.local`: see [configure.md](configure.md).
   - Compare `mcpAccessLabel` from `studio_status` with the level the task needs. [configure.md](configure.md) lists the tools of each level.
   - Done when you know which providers are ready, and you told the user each gap that only they can close.

5. Apply an app update and recover.
   - `studio_status` returns `notice` when Studio is behind `origin/main`. Tell the user.
   - After the user agrees, call `studio_updates` with `check: true`. Pass its `latestCommit` to `studio_apply_update`.
   - The update needs Studio started with `bun run dev`, the `main` branch, a clean checkout with no local commits ahead of `origin/main`, and no active jobs. `blocker` in `studio_status` or `studio_updates` names what is missing. Report it to the user (**Ask before destructive steps**).
   - Studio fast-forwards, runs `bun install --frozen-lockfile` and restarts. While it restarts, calls return `Cozy Studio is not running`. Call `studio_status` about every 5 seconds. When it does not return JSON within about 2 minutes, stop, tell the user, and go to step 2.
   - Reload the MCP connection. The bridge still runs the old code and the old tool list.
   - `Studio update is incomplete. Finish it in Settings before continuing.` on a write means the update still runs or its install failed. Call `studio_updates`. While `phase` is `updating` or `restarting`, wait.
   - When `phase` is `error`, report `error` to the user. A failed install keeps blocking writes. The user retries it in Settings > Help & updates, or, after they agree, call `studio_apply_update` again with the same `commit`.
   - Done when `studio_status` shows `update.behind` 0 and the client lists the current tools.
