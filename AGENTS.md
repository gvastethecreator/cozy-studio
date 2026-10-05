# Cozy Studio agent rules

This file is for agents that work in this repo. Start with `git status --short` and preserve unrelated work. Read `CONTEXT.md` for domain terms and the relevant section of `docs/ARCHITECTURE.md` before changing a product boundary.

For product-module changes, inspect `docs/codemap/codemap.lock` and use the affected section of `docs/codemap/codemap.md` for callers, tests, and flows. Docs and skill edits do not require map regeneration. GitHub Issues and Project `#8` are the task tracker; do not introduce a second `tasks.json` tracker.

## Setup

If the user asks for setup, getting started, first run, or onboarding, or if the checkout is not initialized, follow `skills/cozy-studio-setup/SKILL.md` before ad hoc commands.

That skill owns initialization, provider-specific readiness, and runtime checks. A setup request authorizes the ordinary setup steps. Reuse a healthy running instance; preserve existing paths and data. Missing ChatGPT sign-in requires the user's action in Studio Settings, not a switch to the Codex provider.

## Image jobs

Use the ChatGPT provider after Studio Settings Sign in. Do not start `codex app-server` or select the Codex provider for ordinary image jobs. Codex app-server jobs create Codex turns and spend Codex usage. ChatGPT HTTP does not create those turns. It can still hit its own HTTP usage limit. It is not a separate subscription and not API credits. If Studio Settings still has the Codex provider selected, switch the next image job to ChatGPT before generating.

## Commands

Use Bun scripts. `package.json` and `scripts/tooling-task.ts` define the commands; `docs/TOOLING.md` explains gate selection. Select affected checks at integration. Do not run an aggregate and its included checks twice.

```bash
bun run test
bun run check
bun run build
bun run validate:fast
bun run validate
bun run validate:release
```

For focused unit tests:

```bash
bun run test -- path/to/test.ts
```

For docs and skills, run `bun run docs:check` and validate changed skill packages. `validate:fast` is a fixed unit subset plus server typecheck; it does not select tests from the diff. `validate:full` is an alias of the release gate.

If `rg` fails on Windows in this checkout, use PowerShell `Get-ChildItem` and `Select-String`.

## Safety

- Never delete, move, or rewrite Studio Library data unless the user asks for that action.
- Do not operate on arbitrary paths. Register or import External Output Sources first.
- Do not store Provider Secret values in SQLite, catalog metadata, logs, screenshots, or docs.
- Do not commit `.env.local`, generated images, SQLite DBs, transcripts, logs, or local output folders.
- Preserve dirty worktree changes that you did not make.
- Never print secrets.

## Code

- Shared domain contracts belong in `packages/shared/src`.
- Frontend backend calls go through `services/studio-api/` or `services/studioEventSource.ts`.
- Backend provider execution belongs behind provider adapters, not route handlers.
- Job kinds must describe provider-independent tasks.
- Provider-specific options belong in provider settings or input, not generic task names.
- New behavior needs tests. Reuse a nearby case for meaningful uncovered behavior. Import test APIs from `vitest`; `vitest.config.ts` owns test configuration.
- Keep the legacy workspace snapshot shape export-only. Durable and UI image truth is Catalog Entry.

## Agent skills

Read [skill ownership and loading](docs/agents/skills.md) when selecting, updating, or installing a project skill. Keep contributor guidance portable; local ecosystem links must not replace the tracked skill sources.

### Runtime tools

For app queries, generation and cancellation through MCP, read `docs/agents/mcp.md`. Use the running backend and its Settings access mode.

### Issue tracker

GitHub Issues and Project `#8` hold live state. `.scratch/` holds synchronized local mirrors. See `docs/agents/issue-tracker.md`.

### Triage labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix` for triage. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses one product context. Read the root `CONTEXT.md` and relevant `docs/adr/` entries when they exist. See `docs/agents/domain.md`.

### Style content

Style packs, presets, cards and curation live in the private `cozy-styles-dev` repository next to this checkout. For curation, read its `curation/agent-kit/START-HERE.md`. Studio only loads installed style extensions (ADR 0011); do not add style content here.

## Closeout

Do not claim completion without fresh command output. For broad product changes, run the main gate once:

```bash
bun run validate
```

It includes tests, check, and build. For bounded changes, use the affected checks above. Report changed files, evidence, skipped checks and reasons, and remaining limits. If a gate cannot run, report the exact command, the failure or blocker, and the risk. Commits require consent after diff review; push, branch changes, worktrees, and publication require explicit authority.
