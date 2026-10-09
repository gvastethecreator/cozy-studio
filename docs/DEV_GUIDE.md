# Development guide

## Start the app

Follow [Quick start](../README.md#quick-start) for the supported Bun and Node.js versions and first-run setup. The app uses React with Vite+, a Bun/Hono local API, and SQLite through `bun:sqlite`.

```bash
bun run dev
```

This starts the UI and backend together. Reuse a healthy running instance. To work on one side independently, use `bun run dev:ui` or `bun run dev:server`; the UI still needs the backend for jobs and assets. Default ports are 17222 and 17223.

## Editor tasks

In VS Code, open **Terminal → Run Task**. The tracked tasks are Dev, Test, Check, Format, Build, Validate, Provider status, Runtime, Styles, Docs and Logs. Their exact labels and commands live in [tasks.json](../.vscode/tasks.json). Runtime diagnoses the optional Codex route, not ChatGPT authentication.

## Choose checks

[Tooling](TOOLING.md) defines the validation levels. `validate:fast` runs a fixed unit subset and the server typecheck; it does not select tests from your diff. Use a focused existing test for a bounded behavior change, and `validate` once for broad product changes. Documentation-only changes use `docs:check` plus changed skill validation. Do not run an aggregate and its included checks twice.

For dependency work, follow [Dependencies](DEPENDENCIES.md). Do not update packages as part of an unrelated fix.

## Boundaries and safety

- [Architecture](ARCHITECTURE.md) owns product boundaries; [CONTEXT.md](../CONTEXT.md) defines their vocabulary.
- Workspace is the durable organization entity. Persistent Jobs store `workspace_id`; do not restore Project APIs on the generation path.
- Use isolated temporary libraries in tests. Never mutate a real user's Studio Library to validate a code change.
- Keep `.env.local`, databases, user outputs, logs and scratch dumps out of Git.
- Provider execution and credentials stay behind backend adapters. A unit test or preflight does not authorize a live generation.

For local agent access to a running app, use [cozy-studio-mcp](../skills/cozy-studio-mcp/SKILL.md). The checkout registers that server in `.mcp.json` and `.cursor/mcp.json`. [Studio MCP](agents/mcp.md) owns the tool contract. Developer-specific skills, React Doctor configuration and local hooks are optional, ignored tools; a fresh checkout does not depend on them.
