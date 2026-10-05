---
name: imagegen
description: 'Cozy Studio recipe-aware raster generation and editing. Use when explicitly loading this bundled skill for an image task.'
---

# Image Generation

This is Cozy Studio's adaptation of the OpenAI Codex image-generation skill. The upstream Apache 2.0 license is preserved in [LICENSE.txt](LICENSE.txt); the repository's third-party license index records the attribution. Keep notices with redistributed files.

## Select the execution path

- Studio jobs: follow the provider and recipe selected by the authorized job. Ordinary image jobs use Studio Settings Sign in and ChatGPT HTTP, as defined in the repository's AGENTS.md.
- Direct agent generation: use the available built-in image-generation tool. Read its current schema for inputs, transparency, and returned artifacts.
- Explicit API/CLI requests: use this package's [CLI reference](references/cli.md) and [script](scripts/image_gen.py). Live calls require OPENAI_API_KEY and spend API usage. A batch, local input path, or transparency request alone does not select this path.
- If the required tool is unavailable, report the missing capability. Do not silently change providers, models, authentication, or billing paths.

The bundled copy does not override the host's system image skill. Studio's Codex provider resolves that skill in apps/local-server/src/codex/turn.ts. Inspect that source when changing provider integration.

## Process

1. Establish the image contract.
   - Identify generation or editing, each input image's role, exact text, output shape, constraints, and destination.
   - Inspect local edit targets before using them. With a tool that supports referenced_image_paths, pass the target paths; use conversation-image references only for targets without local paths. Do not combine both mechanisms.
   - Keep existing SVG, vector, or code-native assets in their native workflow when that is what the user requested.
   - Done when the inputs, requested changes, and preserved details are explicit.

2. Apply the recipe contract when this is a Studio task.
   - Treat Task, Recipe directives, Recipe instructions, Image size, and Aspect ratio in a compiled job as the current contract. These are plain-text instructions; do not require a slash command.
   - For a direct request naming a recipe, resolve its module under lib/recipeModules before choosing parameters. Read AGENTS.md and CONTEXT.md from the verified checkout.
   - Keep Generation Task separate from Generation Provider. Preserve preset identity, reference roles, recipe controls, negative constraints, and output shape.
   - A sprite sheet stays a sheet; a storyboard stays a frame grid; a style card stays one representative card. Do not claim an extracted atlas from a sheet image.
   - Style-card visual DNA must remain stronger than generic decoration. Do not add labels, logos, or UI unless requested.
   - Done when the prompt retains every applicable recipe constraint.

3. Generate or edit with the selected tool.
   - Use [prompting guidance](references/prompting.md) for constraints and invariants; use [sample prompts](references/sample-prompts.md) only for the relevant asset type.
   - Preserve a detailed prompt's specificity. Add only details that help an underspecified request.
   - For transparent output, use the tool's native transparency control when available, such as transparent_background: true. Preserve existing transparency on edits.
   - Chroma key is an explicitly selected output or post-processing workflow. It is not a requirement for native transparency.
   - Use separate prompts for distinct assets. Do not invent a batch or count parameter absent from the current tool.
   - Done when the tool returns the requested artifacts, or a concrete failure is recorded.

4. Inspect and deliver.
   - Inspect subject, style, text, output shape, edit invariants, and edges. For transparency, verify actual alpha when a local file is available; a drawn checkerboard is not evidence.
   - Use the artifact path or media returned by the tool. Do not assume a CODEX_HOME output directory or an undocumented save-path argument.
   - For project assets, copy the selected local result into the authorized destination and update its consumer. Preserve existing assets unless replacement was requested. Provider-managed Studio output follows the configured output service.
   - Show preview-only results inline. Report a save limitation if the tool returns no local file; do not invent one.
   - Done when the user has the result, its execution path, and the relevant visual or file evidence. File checks alone do not establish creative acceptance.

## Optional CLI and post-processing

Resolve resources relative to this SKILL.md, not a host system-skill installation.

- [scripts/image_gen.py](scripts/image_gen.py): explicit API generation, editing, or batch work. Use its help and dry-run for supported arguments; unchanged helpers do not need execution for prose-only edits.
- [scripts/remove_chroma_key.py](scripts/remove_chroma_key.py): only for an explicitly requested local chroma-key operation. Read its help and validate the alpha result. Do not use it in place of the native image-editing tool by default.
- [references/image-api.md](references/image-api.md): the bundled CLI's model and parameter notes. Verify current official API support before live use; these notes do not define the built-in tool.
- [references/codex-network.md](references/codex-network.md): only when an explicit CLI call is blocked by its execution environment.

Use the existing Python environment for these optional helpers. Do not install dependencies for ordinary built-in or ChatGPT HTTP jobs. Keep API keys in secure storage or task-scoped environment variables and never print them.
