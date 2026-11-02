# Contributing to Cozy Studio

Use the existing Bun toolchain. Keep each change small enough to review and verify.

## Start the app

Follow the [checkout setup](README.md#quick-start) for the Bun and Node.js versions and the first-run commands. Real image jobs need a provider sign-in. The local unit checks do not. ChatGPT HTTP is the recommended connection. Codex CLI is optional and only needed for the Codex provider.

```bash
bun run dev
```

This command starts the UI and the backend together. If a healthy instance is already running, use it. To work on one side, use `bun run dev:ui` or `bun run dev:server`. The UI still needs the backend for jobs and assets. The default ports are 17222 (UI) and 17223 (API).

The app uses React with Vite+, a Bun/Hono local API and SQLite through `bun:sqlite`. Read the relevant [architecture](docs/ARCHITECTURE.md) section before you change a product boundary. [CONTEXT.md](CONTEXT.md) defines the domain terms.

In VS Code, open **Terminal → Run Task**. The tracked tasks are Dev, Test, Check, Format, Build, Validate, Provider status, Runtime, Styles, Docs and Logs. [tasks.json](.vscode/tasks.json) has their exact labels and commands. Runtime diagnoses the optional Codex route, not ChatGPT authentication.

## Boundaries and safety

- Keep the local-first ChatGPT path working without `OPENAI_API_KEY`.
- Workspace is the durable organization entity. Persistent Jobs store `workspace_id`. Do not restore Project APIs on the generation path.
- Provider execution and credentials stay behind backend adapters. A unit test or preflight does not authorize a live generation.
- Use isolated temporary libraries in tests. Never change a real user's Studio Library to validate a code change.
- Keep user images, logs, SQLite databases, Studio Library data, `.env.local`, scratch captures and secrets out of Git. Reviewed product assets and documentation screenshots stay at their tracked locations.
- Document new environment variables in `.env.example` and in the relevant user or contributor guide. Document public scripts in [Tooling](docs/TOOLING.md).
- For dependency work, follow [Dependencies](docs/DEPENDENCIES.md). Do not update packages as part of an unrelated fix.
- Preserve unrelated work and existing product contracts.

## Validate a change

[Tooling](docs/TOOLING.md) defines the validation levels. Choose the affected checks:

- For a bounded behavior change, run a focused existing test: `bun run test -- path/to/test.ts`.
- For documentation, run `bun run docs:check` and validate any changed skill package.
- For broad product changes, run `bun run validate` once. It includes the architecture checks, format, lint and type checks, environment typechecks, tests and builds. Do not run its parts again.
- For release work, run `bun run validate:release`.

In the pull request, explain the resulting behavior and list the commands and their results. Name the skipped checks and the remaining risk. Visual changes need rendered evidence. Provider fixtures do not prove that a live account works.

## Report a bug

Include the operating system, Bun version, selected provider, command or UI steps, expected result and actual result. Include a provider CLI version only when that provider uses it. Attach only relevant, sanitized log excerpts from `logs/tooling/` or the Studio Library. Remove credentials, private prompts and personal paths. For a platform failure, [Platform support](docs/PLATFORMS.md) lists the extra fields.

Use the [private security channel](SECURITY.md) for vulnerabilities. Other issues and feature requests belong in [GitHub Issues](https://github.com/gvastethecreator/cozy-studio/issues).

## Agents

To let a local agent operate a running app, use the [cozy-studio-mcp skill](skills/cozy-studio-mcp/SKILL.md). The checkout registers that server in `.mcp.json` and `.cursor/mcp.json`. [Studio MCP](docs/agents/mcp.md) owns the tool contract. Developer-specific skills, React Doctor configuration and local hooks are optional and ignored. A fresh checkout does not depend on them.

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
