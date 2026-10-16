# Tooling

## Package manager and runtime

Cozy Studio uses **Bun** as package manager and backend runtime. Use `bun` or `bunx` for operational scripts. Do not use `npm`, `npx`, `pnpm`, or `yarn` for those scripts.

The repository and CI pin Bun `1.4.2` through `packageManager` and the workflow setup step. Use `bun install` for a local dependency refresh. Use `bun install --frozen-lockfile` for reproducible validation and CI.

The Studio application is one Bun package. The separate `landing/` site has its own package and lockfile. Nested `apps/*` and `packages/*` folders are source boundaries, not separate package manifests, until real `package.json` files exist.

`tsconfig.json` is the aggregate compatibility config that `vp check` uses. Environment truth lives in `tsconfig.web.json`, `apps/local-server/tsconfig.json`, `packages/shared/tsconfig.json`, `tsconfig.scripts.json`, and `tsconfig.browser-scripts.json`.

Tooling logs stay in `logs/tooling/`. The incremental server typecheck cache stays in `.cache/`; neither belongs in the source tree.

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

`bun run test` and `validate` run the complete Vitest suite. Native Bun cases use `bun:sqlite` and are excluded from Vitest. For a complete test pass, also run:

```bash
bun test apps/local-server/src/imagePipeline.bun.test.ts apps/local-server/src/mcpRoutes.bun.test.ts
```

The UI build checks chunk budgets. Keep optional surfaces demand-loaded and preserve the 500,000-byte main-entry limit; a smaller entry alone does not prove faster startup.

## Dependency maintenance

Follow the scoped update workflow in [Dependencies](DEPENDENCIES.md). Keep unrelated packages unchanged.

Effect is pinned to `4.0.5`. Keep domain cancellation separate from fiber interruption in tests: the Comfy executor must report unconfirmed cancellation, and the worker must retain `needs_review` when an interrupted job has no confirmed remote cancellation. A raw interrupted fiber does not promise to return the domain error from its cleanup.

Studio and the landing use Pretext `1.0.0`. The landing bundles its public entry instead of copying private implementation files. Its VGPU `0.6.0` shaders are prepared during the build with the matching `@vgpu/wgsl` version. Rebuild the tracked vendor output when updating these packages; do not retain stale output after a failed build. See the [Pretext release notes](https://github.com/chenglou/pretext/releases/tag/v1.0.0) and [VGPU migration guide](https://github.com/vercel-labs/vgpu/blob/v0.6.0/docs/migrations/0.6.0.docs.md).

If Bun stalls after extracting dependencies on Windows, stop that install and retry with `bun install --backend copyfile`. Use the same backend with `--frozen-lockfile` when validating that checkout. This avoids changing the package manager or the lockfile by hand.

## CI

CI must call these named scripts. Do not fork gate step lists inside workflow YAML.
