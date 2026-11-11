# Tooling

## Package manager and runtime

Cozy Studio uses **Bun** as package manager and backend runtime. Use `bun` or `bunx` for operational scripts. Do not use `npm`, `npx`, `pnpm`, or `yarn` for those scripts.

The repository and CI pin Bun `1.4.4` through `packageManager` and the workflow setup step. Use `bun install` for a local dependency refresh. Use `bun install --frozen-lockfile` for reproducible validation and CI. `bun install` does not remove packages that `bun.lock` no longer lists, so `bun run validate` starts by listing them (`scripts/verify-installed-deps.ts`) without failing the gate. Follow [Clean dependency install](#clean-dependency-install) to repair that drift.

VS Code tasks run `bun` from the editor's `PATH`; `packageManager` does not switch that executable. Check `bun --version` in the editor's terminal before validation. Put the intended Bun installation directory, including `bunx`, first on `PATH` before starting the editor, then reopen it after changing `PATH`. Keep machine-specific executable paths in local editor settings.

`bun run portable:build [target]` builds a portable ZIP from the UI prepared by `bun run validate:release`. Targets are `windows-x64`, `windows-arm64`, `linux-x64`, `linux-arm64`, `macos-x64` and `macos-arm64`; the default matches the build host. It verifies the official pinned Bun release SHA-256, includes that target's unmodified executable and notices, and installs production dependencies with explicit OS/CPU options into an isolated folder under `.scratch/portable/`. Native install scripts are disabled for cross-platform safety; the required prebuilt Sharp binary must be present. Each archive has its own launcher, executable permissions, target record and SHA-256. The ZIP leaves out the package-manager CLI shims of the build host.

The release gate sets `VITE_STUDIO_API_BASE` to an empty string for its validation and UI build. This makes the UI use the portable server's selected port and prevents `.env.local` from baking a development API address into the ZIP. `portable:build` copies the existing `dist`; setting the variable only when packaging is too late. Build the UI once, then reuse it for all targets. Normal `build` and `build:ui` commands still support a separate API address for development and preview.

```bash
bun run validate:release
bun run portable:build windows-x64
```

These ZIPs are local artifacts. The command does not publish a release, and it does not include user Library data, credentials or `.env.local`. A cross-built ZIP needs a native startup check on its target OS and CPU. [Platform support](PLATFORMS.md) lists the OS requirements, and `PORTABLE.txt` inside the ZIP explains how to launch it.

Each ZIP has a `Cozy Studio/` root with a launcher and `app/`. The version in `app/portable.json` comes from `package.json`; it must match the release tag without the `v` prefix. The default Studio data folder is created beside `app/`, outside the update swap. Do not put user data in `app.next`, `app.next.tmp`, `app.previous` or `app.failed`.

Release preparation builds and verifies the target ZIPs before creating the version tag. With owner approval, push that tag to run `.github/workflows/release.yml`; it builds all six targets and creates a draft release. Inspect the assets and checksums, then publish the draft only with separate owner approval. The ZIPs are unsigned; include the [first-run steps](PLATFORMS.md#releases-and-updates) and native verification limits in the notes. GitHub must expose a `sha256:` asset digest for portable auto-update; an asset without it is rejected.

The Studio application is one Bun package. The separate `landing/` site has its own package and lockfile. Nested `apps/*` and `packages/*` folders are source boundaries, not separate package manifests, until real `package.json` files exist.

`tsconfig.json` is the aggregate compatibility config that `vp check` uses. Environment truth lives in `tsconfig.web.json`, `apps/local-server/tsconfig.json`, `packages/shared/tsconfig.json`, `tsconfig.scripts.json`, and `tsconfig.browser-scripts.json`.

Tooling logs stay in `logs/tooling/`. The incremental server typecheck cache stays in `.cache/`; neither belongs in the source tree.

## When terminal output is too short

If `check`, `lint`, `test` or `build` fails and the terminal output is cut off:

1. Run `bun run tooling:logs`.
2. Open the matching `*.latest.log`.
3. Put the failed command and a relevant, sanitized excerpt in the issue or pull request. Remove credentials, private prompts and personal paths.

Each task keeps one `.latest.log`, and timestamped runs are pruned automatically. To clean them by hand, run `bun run tooling:logs:prune`.

## Canonical scripts

For documentation-only changes, run `bun run docs:check` and validate changed skill packages. For bounded code changes, select the affected existing checks. For broad product changes, run `bun run validate` once. `validate:fast` is a fixed subset, not diff-based selection.

Use one validation level per integration. Each broader gate includes the narrower checks it needs; do not rerun its components separately. For one test file, use `bun run test -- path/to/test.ts`.

In VS Code, **Test file** runs the active `.test.ts` or `.test.tsx` file. **Test** runs the full Vitest suite; **Bun tests** runs the native cases.

| Script                           | Purpose                                    |
| -------------------------------- | ------------------------------------------ |
| `bun run validate:fast`          | Fixed unit subset + server typecheck       |
| `bun run validate`               | Main PR gate                               |
| `bun run validate:release`       | Release gate                               |
| `bun run validate:full`          | Compatibility alias of the release gate    |
| `bun run typecheck:environments` | Web, server, shared, and script boundaries |
| `bun run docs:check`             | Broken local doc links                     |
| `bun run repo:hygiene:verify`    | Reject tracked secrets, DBs, and scratch   |
| `bun run repo:assets:audit`      | Core budget and optional pack hashes       |
| `bun run repo:assets:lock`       | Refresh optional pack integrity lock       |
| `bun run core-assets:smoke`      | Isolated build and route smoke, no packs   |
| `bun run portability:smoke`      | Isolated local API health smoke            |

## Complete test pass

`bun run test` runs the complete Vitest suite. `vitest.config.ts` pins `VITE_STUDIO_API_BASE` to empty, so a custom port in `.env.local` does not change test results; a new `VITE_` variable that tests read needs the same pin. Native Bun cases use `bun:sqlite` and `Bun.Image` and are excluded from Vitest; `bun run test:bun` runs them. `validate` runs both.

`bun run test:coverage -- path/to/test.ts` adds V8 coverage through the pinned `@vitest/coverage-v8` package. It runs under Node through Vitest and is separate from the normal validation gate.

The full test task limits Vitest to eight workers, to avoid Windows filesystem and process contention. Set `VITEST_MAX_WORKERS` to a positive integer only when you need a different local limit.

The UI build checks chunk budgets. Keep optional surfaces demand-loaded and preserve the 500,000-byte main-entry limit; a smaller entry alone does not prove faster startup.

## Dependency maintenance

Follow the scoped update workflow in [Dependencies](DEPENDENCIES.md). It also lists the pinned packages. Keep unrelated packages unchanged.

If `bun install` stalls on Windows, see [Troubleshooting](TROUBLESHOOTING.md).

### Clean dependency install

Use this repair when installed packages no longer match `bun.lock`. Stop the dev server and other commands using this checkout first. Confirm that your current directory is the checkout root and that `node_modules` is its own dependency folder, not a link to a shared install. Removing that folder requires the owner's approval when an agent performs the repair. Keep `bun.lock` unchanged.

In PowerShell:

```powershell
Remove-Item -LiteralPath .\node_modules -Recurse -Force -ErrorAction Stop
bun install --frozen-lockfile
```

In a POSIX shell:

```sh
rm -rf -- node_modules && bun install --frozen-lockfile
```

Then run `bun run scripts/verify-installed-deps.ts` to check the new install. It reports drift without changing files or failing the gate.

## CI

CI must call these named scripts. Do not fork gate step lists inside workflow YAML.

The **Validate** job runs `validate:release` and the secret scan. The scan uses the full Git history and runs even when validation fails. Separate jobs check native initialization, migrations and API health on Windows and macOS; the macOS job runs on pushes to `main`.

## Releases

Releases use SemVer. The `version` field in `package.json` is the version, and the tag is `v` plus that version, for example `v0.1.0`. A tag with a `-` suffix, for example `v0.2.0-rc.1`, makes a prerelease. Before 1.0, increase the patch number for fixes and the minor number for features or database migrations. Each portable ZIP records the version in its `portable.json`.

To make a release:

1. On `main`, commit the new `version` in `package.json`.
2. Wait until CI is green for that commit.
3. Tag that commit and push only the tag: `git tag v0.1.1 <commit>`, then `git push origin v0.1.1`.
4. The `Release` workflow (`.github/workflows/release.yml`) starts. It stops if the tag does not match `package.json`. Then it runs `bun run validate:release`, builds the ZIPs for all six targets with `bun run portable:build`, and creates a draft GitHub Release with the ZIPs and a `SHA256SUMS` file.
5. Read the draft and edit its notes. Then publish it by hand. The workflow never publishes a release.

The workflow runs only for pushed `v*.*.*` tags, not for branch pushes. Only its single job can write repository contents. If a run fails because of a network error, run the job again. If the tagged commit is wrong, do not move the tag: delete any draft that the run left, fix `main`, and release the next patch version.
