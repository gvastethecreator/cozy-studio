# Platform support

Studio runs a local Bun server and opens a browser. Windows, macOS and Linux share the same application and persistent formats. Development also needs the Node.js versions listed in the [README](../README.md#quick-start).

## Start

| Mode                           | Command or launcher           |
| ------------------------------ | ----------------------------- |
| Source development             | `bun run dev`                 |
| Built app, normal user storage | `bun run start`               |
| Windows portable               | `scripts/Cozy Studio.bat`     |
| macOS portable                 | `scripts/Cozy Studio.command` |
| Linux portable                 | `scripts/Cozy Studio.sh`      |

Portable and built-app modes need `dist/`. A source checkout makes it with `bun run build`. Launchers find the app folder from their own location, not from the terminal's current folder. If browser opening is not available, use the printed loopback URL.

Portable wrappers set `STUDIO_PORTABLE=1`. Without an explicit Library path, the Library is stored inside the app folder. This does not move existing data or change where credentials are stored. [PORTABLE.txt](../PORTABLE.txt) explains how to launch a ZIP.

## Portable ZIP requirements

No portable ZIPs are published yet. [Tooling](TOOLING.md) explains how to build one. Each ZIP targets one OS and CPU: `windows-x64`, `windows-arm64`, `linux-x64`, `linux-arm64`, `macos-x64` or `macos-arm64`.

- Linux needs glibc 2.28 or newer. musl and Alpine are not supported.
- macOS needs version 13 or newer.
- x64 builds need SSE4.2.

The ZIP includes its Bun runtime (`runtime/bun.exe` on Windows, `runtime/bun` on Linux and macOS), the matching production dependencies, license notices and a `portable.json` target record. Launchers prefer this runtime and add its folder to `PATH` for child processes.

## Default paths

| Data                       | Windows                                          | macOS                                               | Linux                                                |
| -------------------------- | ------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| Library                    | `%LOCALAPPDATA%/Cozy Studio/Library`             | `~/Library/Application Support/Cozy Studio/Library` | `$XDG_DATA_HOME/cozy-studio/Library`                 |
| Installed extensions       | Same app-data root, `Extensions`                 | Same app-data root, `Extensions`                    | Same app-data root, `Extensions`                     |
| Studio sign-in credentials | App-data root, `auth/studio-oauth.json`          | App-data root, `auth/studio-oauth.json`             | `$XDG_STATE_HOME/cozy-studio/auth/studio-oauth.json` |
| Generated images           | Windows Pictures Known Folder plus `Cozy Studio` | `~/Pictures/Cozy Studio`                            | XDG Pictures directory plus `Cozy Studio`            |

Linux defaults are `~/.local/share` for XDG data and `~/.local/state` for XDG state. Relative XDG base directories are ignored. Pictures uses `XDG_PICTURES_DIR`, then `user-dirs.dirs` under the XDG config directory, then `~/Pictures`. If XDG turns off Pictures by setting it to your home folder, set `STUDIO_IMAGES_DIR`. Studio reads `user-dirs.dirs` as data; it never runs its shell contents.

Windows honors redirected Pictures folders, including network paths. If Windows cannot report that location, Studio asks for `STUDIO_IMAGES_DIR` instead of guessing. `LOCALAPPDATA` must be fully qualified; a path such as `\\AppData` cannot select an arbitrary current drive.

## Overrides and recovery

- `STUDIO_LIBRARY_DIR` and `STUDIO_IMAGES_DIR` must be absolute for the server's OS. Do not paste a Windows drive path into Linux or macOS.
- Settings → Files & naming changes the output destination for new jobs. Existing jobs keep their captured destination and existing files stay in place.
- `STUDIO_EXTENSION_INSTALL_DIR` selects the extension store. `STUDIO_EXTENSION_SOURCES` accepts local source folders separated by `;` on Windows and `:` on macOS/Linux. Relative extension paths resolve from the app's working directory.
- For the optional Codex provider, `STUDIO_CODEX_CLI_PATH` or `CODEX_CLI_PATH` selects a launcher. `CODEX_HOME` selects its absolute config, skill and generated-image root; otherwise it uses `~/.codex`. Studio discovers Unix Bun installs under `~/.bun/bin` as well as local/npm installs and PATH.
- Existing Libraries and credential files are never migrated automatically. Changing an environment variable selects another location; it does not copy the old contents.
- Keep the Library writable by the current user. Do not repair permission errors by running Studio as administrator or root. Inspect the selected path first.

For contributors: `platformHome.ts`, `platformDirectories.ts`, `config.ts`, `platformPaths.ts` and `auth/store.ts` under `apps/local-server/src/` own path resolution. Fix a resolution defect there, not with a UI-specific path rule.

## Report a platform failure

Follow the [bug report steps](../CONTRIBUTING.md#report-a-bug). For a platform failure, also include the OS version, CPU architecture and launch mode. Run `bun run studio:onboard --probe` for a read-only setup report; its `host` field includes the OS, architecture, Bun and Node versions. For a Codex failure, also run `bun run runtime:doctor`. For another provider, run `bun run providers:preflight`.

The probe can contain account-related status and personal paths. Redact usernames, private directories and account identifiers before posting it. Never attach `.env.local`, the credential file, SQLite databases or complete transcripts. Use the [private security channel](../SECURITY.md) for exposure of credentials or files.

## Verification limits

Windows can be exercised in this workspace. Platform-parameterized tests check Windows, macOS and Linux path rules on one host; they do not prove native permissions, launch services, packaging, filesystem behavior or provider CLIs on another OS.

Before declaring a native macOS or Linux release supported, verify a fresh checkout, portable startup, a custom path with spaces/non-ASCII characters, credential isolation and shutdown on that OS. Run `bun run portability:smoke` for an isolated backend health check; it does not generate a provider image.
