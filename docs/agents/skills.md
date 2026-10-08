# Project skill ownership

The public app includes one operational skill: [cozy-studio-setup](../../skills/cozy-studio-setup/SKILL.md). The onboarding prompt uses its tracked path through `lib/onboardingSetupPrompt.ts`. Keep it portable and available in a fresh checkout.

Developer-specific skills, local React Doctor configuration, hooks and workflow notes are ignored local tools. They are not installed by the app, required by builds or linked as public setup dependencies. Retained local copies keep their licenses and notices. Do not make runtime behavior depend on them.

Studio image jobs follow the captured provider and recipe contract. Ordinary image jobs use ChatGPT HTTP; Codex provider turns resolve the host's image skill in `apps/local-server/src/codex/turn.ts`. Do not install a repository-specific image skill over the client's system skill.

For changes to the setup skill, verify source paths and commands, validate the package and run `bun run docs:check`. Prose-only changes need structural validation and a representative static review; runtime and UI changes need the matching functional evidence.

Style content belongs in the separate `cozy-styles-dev` repository. Its curation and authoring tools are not runtime dependencies of Studio. See [ADR 0011](../adr/0011-declarative-extensions-and-style-pack-sources.md).

For app queries, generation and cancellation, use [Studio MCP](mcp.md). Skills guide work; MCP tools operate the running app.
