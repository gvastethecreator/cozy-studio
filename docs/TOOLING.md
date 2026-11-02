# Tooling

## Package manager and runtime

Cozy Studio uses **Bun** as package manager and backend runtime. Use `bun` or `bunx` for operational scripts. Do not use `npm`, `npx`, `pnpm`, or `yarn` for those scripts.

The repository and CI pin Bun `1.4.2` through `packageManager` and the workflow setup step. Use `bun install` for a local dependency refresh. Use `bun install --frozen-lockfile` for reproducible validation and CI.

`bun run portable:build [target]` builds a portable ZIP after `bun run build`. Targets are `windows-x64`, `windows-arm64`, `linux-x64`, `linux-arm64`, `macos-x64` and `macos-arm64`; the default matches the build host. It verifies the official pinned Bun release SHA-256, includes that target's unmodified executable and notices, and installs production dependencies with explicit OS/CPU options into an isolated folder under `.scratch/portable/`. Native install scripts are disabled for cross-platform safety; the required prebuilt Sharp binary must be present. Each archive has its own launcher, executable permissions, target record and SHA-256. The ZIP leaves out the package-manager CLI shims of the build host.

These ZIPs are local artifacts. The command does not publish a release, and it does not include user Library data, credentials or `.env.local`. A cross-built ZIP needs a native startup check on its target OS and CPU. [Platform support](PLATFORMS.md) lists the OS requirements, and `PORTABLE.txt` inside the ZIP explains how to launch it.

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

| Script                           | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `bun run validate:fast`          | Fixed unit subset + server typecheck         |
| `bun run validate`               | Main PR gate                                 |
| `bun run validate:release`       | Release gate                                 |
| `bun run validate:full`          | Compatibility alias of the release gate      |
| `bun run typecheck:environments` | Web, server, shared, and script boundaries   |
| `bun run docs:check`             | Broken local doc links                       |
| `bun run repo:hygiene:verify`    | Reject tracked secrets, DBs, and scratch     |
| `bun run repo:assets:audit`      | Core budget and optional pack hashes         |
| `bun run repo:assets:lock`       | Refresh optional pack integrity lock         |
| `bun run core-assets:smoke`      | Build and route smoke without optional packs |
| `bun run portability:smoke`      | Isolated local API health smoke              |

## Complete test pass

`bun run test` runs the complete Vitest suite. Native Bun cases use `bun:sqlite` and `Bun.Image` and are excluded from Vitest; `bun run test:bun` runs them. `validate` runs both.

The full test task limits Vitest to eight workers, to avoid Windows filesystem and process contention. Set `VITEST_MAX_WORKERS` to a positive integer only when you need a different local limit.

The UI build checks chunk budgets. Keep optional surfaces demand-loaded and preserve the 500,000-byte main-entry limit; a smaller entry alone does not prove faster startup.

## Dependency maintenance

Follow the scoped update workflow in [Dependencies](DEPENDENCIES.md). It also lists the pinned packages. Keep unrelated packages unchanged.

If `bun install` stalls on Windows, see [Troubleshooting](TROUBLESHOOTING.md).

## CI

CI must call these named scripts. Do not fork gate step lists inside workflow YAML.
