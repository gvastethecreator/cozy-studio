# Contributing to Cozy Studio

Use the existing Bun toolchain and keep changes small enough to review and verify.

## Start

Follow the [checkout setup](README.md#quick-start) for Bun, Node.js and startup commands. A provider login is needed for real image jobs, not for the local unit checks. ChatGPT HTTP is the recommended connection. Codex CLI is optional and only needed for the Codex provider.

The [development guide](docs/DEV_GUIDE.md) covers editor tasks and server commands. Read the relevant [architecture](docs/ARCHITECTURE.md) section before changing a product boundary.

## Validate a change

Choose the affected checks in [Tooling](docs/TOOLING.md). For documentation, run `bun run docs:check` and validate any changed skill package. For broad product changes, run `bun run validate` once. It includes architecture checks, format/lint/type checks, environment typechecks, tests and builds; do not repeat its components. Release work uses `bun run validate:release`.

In the pull request, explain the resulting behavior and list the commands and results. Name skipped checks and the remaining risk. Visual changes need rendered evidence; provider fixtures do not prove a live account works.

## Conventions

- Keep the local-first ChatGPT path working without `OPENAI_API_KEY`.
- Keep user images, logs, SQLite databases, Studio Library data, scratch captures and secrets out of Git. Reviewed product assets and documentation screenshots belong at their existing tracked locations.
- Document new environment variables in `.env.example` and the relevant user or contributor guide. Document public scripts in [Tooling](docs/TOOLING.md).
- Preserve unrelated work and existing product contracts.

## Report a bug

Include the operating system, Bun version, selected provider, command or UI steps, expected result and actual result. Include a provider CLI version only when that provider uses it. Attach only relevant, sanitized log excerpts from `logs/tooling/` or the Studio Library; remove credentials, private prompts and personal paths.

Use the [private security channel](SECURITY.md) for vulnerabilities. Other issues and feature requests belong in [GitHub Issues](https://github.com/gvastethecreator/cozy-studio/issues).

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
