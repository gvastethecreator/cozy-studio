# Platform support

Studio runs a local Bun server and opens a browser. Windows, macOS and Linux share the same application and persistent formats. Development also needs the Node.js versions listed in the [README](../README.md#quick-start).

## Start

| Mode                           | Command or launcher   |
| ------------------------------ | --------------------- |
| Source development             | `bun run dev`         |
| Built app, normal user storage | `bun run start`       |
| Windows portable ZIP           | `Cozy Studio.bat`     |
| macOS portable ZIP             | `Cozy Studio.command` |
| Linux portable ZIP             | `Cozy Studio.sh`      |

Portable and built-app modes need `dist/`. A source checkout makes it with `bun run build`. Launchers find the app folder from their own location, not from the terminal's current folder. If browser opening is not available, use the printed loopback URL.

Portable wrappers set `STUDIO_PORTABLE=1`. The default Studio data folder is `Cozy Studio Library` beside `app/`. This does not move existing data or change where credentials are stored. [PORTABLE.txt](../PORTABLE.txt) explains how to launch a ZIP.

## Portable ZIP requirements

Download portable ZIPs from [Releases](https://github.com/gvastethecreator/cozy-studio/releases). [Tooling](TOOLING.md) explains how to build one. Each ZIP targets one OS and CPU: `windows-x64`, `windows-arm64`, `linux-x64`, `linux-arm64`, `macos-x64` or `macos-arm64`. Read the release notes for the native verification limits of each asset.

- Linux needs glibc 2.28 or newer. musl and Alpine are not supported.
- macOS needs version 13 or newer.
- x64 builds need SSE4.2.

The ZIP contains a `Cozy Studio/` folder with a root launcher and an `app/` subfolder. `app/` includes its Bun runtime (`runtime/bun.exe` on Windows, `runtime/bun` on Linux and macOS), production dependencies, license notices and a `portable.json` version and target record. Launchers prefer this runtime and add its folder to `PATH` for child processes.

## Releases and updates

Portable releases start at `0.1.1`. The initial ZIPs are unsigned. Download only from this repository's Releases page and check the supplied SHA-256 before opening them.

- **Windows:** before extracting, right-click the ZIP, open **Properties**, select **Unblock** and apply. If SmartScreen shows "Windows protected your PC", select **More info → Run anyway** when available. Managed devices can prevent this override. See [Microsoft's file-unblock guidance](https://learn.microsoft.com/powershell/module/microsoft.powershell.utility/unblock-file).
- **macOS:** for a trusted extracted folder, run `xattr -dr com.apple.quarantine "/path/to/Cozy Studio"`. This also removes quarantine from bundled libraries. In macOS 15 and later, a blocked app can also be approved in **System Settings → Privacy & Security → Open Anyway**. See [Apple's first-run guidance](https://support.apple.com/102445).
- **Linux:** if extraction drops executable permissions, run `chmod +x "Cozy Studio.sh" app/scripts/portable-launch.sh app/runtime/bun` inside the extracted folder.

Open **Settings → Help & updates** to check and apply an update. Portable installs always use the latest published release for their OS and CPU. Studio checks the asset's SHA-256 digest, stages only its `app/` files, verifies the version and target, then asks the root launcher to restart. The root launcher stays in place. Downloads made by Studio do not use a browser's quarantine metadata; these first-run steps apply to browser downloads.

Git checkouts default to **Commits on main**. They can select **Releases (recommended)** to update only to the latest published release tag. Save the channel before checking. Both channels require a clean `main` branch and a fast-forward; local changes and diverged commits block the update. Jobs and mutations also block an update.

The root launcher swaps `app.next` into `app/` and retains `app.previous` while the new server starts. If startup fails before readiness, it restores the old app and preserves the failed copy as `app.failed`. A later update removes these recovery copies only after checking that they contain app code and no Studio data, SQLite files or symbolic links. A blocked cleanup leaves the folders for manual review. Startup rollback does not restore or rewrite the database; migration backups remain in the Studio data folder for manual recovery.

An update is blocked if the Studio data folder, a registered Output Folder or a user extension folder overlaps `app/`. These paths also protect recovery copies from cleanup. For an older ZIP built with an internal `Cozy Studio Library`, stop Studio and move that folder beside `app/` before updating. If `STUDIO_LIBRARY_DIR` points to that folder, set it to the new absolute path. Keep custom `STUDIO_EXTENSION_INSTALL_DIR` and `STUDIO_EXTENSION_SOURCES` folders outside `app/`.

## Default paths

| Data                        | Windows                                          | macOS                                               | Linux                                                |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| Studio data folder          | `%LOCALAPPDATA%/Cozy Studio/Library`             | `~/Library/Application Support/Cozy Studio/Library` | `$XDG_DATA_HOME/cozy-studio/Library`                 |
| Portable Studio data folder | `Cozy Studio Library` beside `app/`              | `Cozy Studio Library` beside `app/`                 | `Cozy Studio Library` beside `app/`                  |
| Installed extensions        | Same app-data root, `Extensions`                 | Same app-data root, `Extensions`                    | Same app-data root, `Extensions`                     |
| Studio sign-in credentials  | App-data root, `auth/studio-oauth.json`          | App-data root, `auth/studio-oauth.json`             | `$XDG_STATE_HOME/cozy-studio/auth/studio-oauth.json` |
| Generated images            | Windows Pictures Known Folder plus `Cozy Studio` | `~/Pictures/Cozy Studio`                            | XDG Pictures directory plus `Cozy Studio`            |

Linux defaults are `~/.local/share` for XDG data and `~/.local/state` for XDG state. Relative XDG base directories are ignored. Pictures uses `XDG_PICTURES_DIR`, then `user-dirs.dirs` under the XDG config directory, then `~/Pictures`. If XDG turns off Pictures by setting it to your home folder, set `STUDIO_IMAGES_DIR`. Studio reads `user-dirs.dirs` as data; it never runs its shell contents.

Windows honors redirected Pictures folders, including network paths. If Windows cannot report that location, Studio asks for `STUDIO_IMAGES_DIR` instead of guessing. `LOCALAPPDATA` must be fully qualified; a path such as `\\AppData` cannot select an arbitrary current drive.

## Overrides and recovery

- `STUDIO_LIBRARY_DIR` and `STUDIO_IMAGES_DIR` must be absolute for the server's OS. Do not paste a Windows drive path into Linux or macOS.
- Settings → Files & naming changes the output destination for new jobs. Existing jobs keep their captured destination and existing files stay in place.
- `STUDIO_EXTENSION_INSTALL_DIR` selects the extension store. `STUDIO_EXTENSION_SOURCES` accepts local source folders separated by `;` on Windows and `:` on macOS/Linux. Relative extension paths resolve from the app's working directory.
- For the optional Codex provider, `STUDIO_CODEX_CLI_PATH` or `CODEX_CLI_PATH` selects a launcher. `CODEX_HOME` selects its absolute config, skill and generated-image root; otherwise it uses `~/.codex`. Studio discovers Unix Bun installs under `~/.bun/bin` as well as local/npm installs and PATH.
- Existing Studio data folders and credential files are never migrated automatically. Changing an environment variable selects another location; it does not copy the old contents.
- Keep the Studio data folder writable by the current user. Do not repair permission errors by running Studio as administrator or root. Inspect the selected path first.

For contributors: `platformHome.ts`, `platformDirectories.ts`, `config.ts`, `platformPaths.ts` and `auth/store.ts` under `apps/local-server/src/` own path resolution. Fix a resolution defect there, not with a UI-specific path rule.

## Report a platform failure

Follow the [bug report steps](../CONTRIBUTING.md#report-a-bug). For a platform failure, also include the OS version, CPU architecture and launch mode.

For a source checkout, run `bun run studio:onboard --probe` from the checkout root. The report's `host` field includes the OS, architecture, Bun and Node versions. For a Codex failure, also run `bun run runtime:doctor`. For another provider, run `bun run providers:preflight`.

For a portable ZIP, open the root launcher for your OS and use the in-app onboarding checklist and **Settings → Advanced & maintenance**. Include the app version, printed URL and relevant launcher error. No global Bun installation is needed. If Studio cannot start, report the launcher error first. Do not run checkout setup or repair commands inside `app/`: their offline probe can inspect the checkout defaults instead of the portable data folder, and missing `.env.local` is valid for portable installs.

The probe can contain account-related status and personal paths. Redact usernames, private directories and account identifiers before posting it. Never attach `.env.local`, the credential file, SQLite databases or complete transcripts. Use the [private security channel](../SECURITY.md) for exposure of credentials or files.

## Verification limits

Windows can be exercised in this workspace. Platform-parameterized tests check Windows, macOS and Linux path rules on one host; they do not prove native permissions, launch services, packaging, filesystem behavior or provider CLIs on another OS.

Before declaring a native macOS or Linux release supported, verify a fresh checkout, portable startup, a custom path with spaces/non-ASCII characters, credential isolation and shutdown on that OS. Run `bun run portability:smoke` for an isolated backend health check; it does not generate a provider image.
