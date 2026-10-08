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

## Dependency maintenance

Follow the scoped update workflow in [Dependencies](DEPENDENCIES.md). Keep unrelated packages unchanged.

Effect remains pinned to `4.0.0`: `4.0.2` loses the unconfirmed Comfy cancellation error when its fiber is interrupted. The existing `comfyExecutor.test.ts` cancellation case reproduces the regression and passes on `4.0.0`. Require that case to pass before upgrading Effect. The landing overrides transitive `sharp` to `0.35.5` until Miniflare updates its vulnerable exact pin.

## CI

CI must call these named scripts. Do not fork gate step lists inside workflow YAML.
