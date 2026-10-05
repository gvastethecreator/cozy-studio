# Project skill ownership

Cozy Studio keeps contributor skills in this repository. Read only the skill needed for the task.

- [cozy-studio-setup](../../skills/cozy-studio-setup/SKILL.md): first run and onboarding handoff. The path is used by `lib/onboardingSetupPrompt.ts`; keep it stable.
- [sprite-atlas-builder](../../skills/sprite-atlas-builder/SKILL.md): select an existing sprite workflow and identify the external specialist dependency.
- [imagegen](../../skills/imagegen/SKILL.md): recipe-aware image generation when explicitly loaded. This bundled adaptation does not replace a client's system image skill. Codex provider turns resolve their skill in `apps/local-server/src/codex/turn.ts`; ordinary Studio jobs use the ChatGPT provider.
- [react-doctor](../../.agents/skills/react-doctor/SKILL.md): the repository adapter for the pinned diagnostic command. It is already on the local skill-loading surface.

For changes, check the skill's commands and paths against current source, preserve third-party notices, run package validation, and run `bun run docs:check`. Prose changes need structural checks and review of a representative workflow. Runtime or UI changes need the corresponding functional or browser evidence.

## Local ecosystem installation

The optional agents-matrix integration indexes the repository's own skills through local junctions. Keep each junction pointed at its canonical source, exclude it from Git, and verify the resolved path and catalog result. Do not copy skill bodies into another catalog or install this project's `imagegen` over the client's system skill.

The existing `codex-studio` and `codex-studio-style-from-images` ecosystem entries route to the current Cozy Studio checkout and the separate `cozy-styles-dev` curation repository. Their registry names are owned by that ecosystem. Contributors do not need agents-matrix to use the skills linked above.

Style content belongs in `cozy-styles-dev`; read its `AGENTS.md` and `curation/agent-kit/START-HERE.md` for curation. Studio's extension boundary is documented in [ADR 0011](../adr/0011-declarative-extensions-and-style-pack-sources.md).

For runtime queries, generation and cancellation, use the [Studio MCP server](mcp.md). Skills supply task guidance; MCP tools operate the running app.
