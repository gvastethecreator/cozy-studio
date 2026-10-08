# Electron development shell

Electron is an optional development shell. The user path remains the browser with portable launchers or `bun run dev` from a checkout. There is no packaged desktop distribution in this repository.

## Run

- `bun run dev:electron` starts the development shell.
- `bun run preview:electron` loads a local build; run `bun run build` first when the build is missing or stale.

Use the same [setup requirements](../README.md#quick-start) as the browser app. The shell does not bundle Bun, provider CLIs or sign-in sessions. Codex is needed only when that provider is selected.

## Runtime boundary

The renderer uses Studio Runtime, not direct desktop APIs. It resolves `apiBase` from `window.codexStudio?.apiBase`, then `VITE_STUDIO_API_BASE`, then localhost. [preload.cjs](../electron/preload.cjs) exposes the narrow bridge; [main.cjs](../electron/main.cjs) owns the window and navigation policy.

Keep `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`. Preserve the explicit preload, blocked unexpected navigation and restricted window opens. A working development window is not evidence that runtime packaging, installation or updates are ready for distribution.
