# Dependencies

Cozy Studio uses Bun as its package manager and backend runtime. `bun:sqlite` and Bun script APIs are runtime dependencies. Changing the package manager alone does not replace them.

## Version sources

- `package.json` declares dependency ranges, overrides, and the Bun baseline.
- `bun.lock` records resolved packages.
- `.github/workflows/ci.yml` selects the CI runtime.
- `vitest.config.ts` owns tests. Tests import `vitest` directly; Vite+ supplies the build and check commands.

Read these files for current versions. A local run on another Bun release does not prove compatibility with the CI baseline.

## Compatibility constraints

- Keep the Bun baseline, CI runtime, and `@types/bun` aligned when changing the runtime.
- Review Vite, Vite+, the React plugin, Oxfmt, Oxlint, and matching overrides together. Do not bump one pin solely to clear an outdated-package report.
- Verify the Electron development shell before a major Electron update.
- Before updating Sharp, verify `writePngFromSvg` through the Sprite Atlas fixture path. That path protects SVG rasterization used by atlas fixtures; a package install alone does not prove it works.
- Use a top-level override only for a demonstrated compatibility or security problem. Bun does not support nested overrides.

## Pinned packages

Effect is pinned to `4.0.5`. Keep domain cancellation separate from fiber interruption in tests: the Comfy executor must report unconfirmed cancellation, and the worker must retain `needs_review` when an interrupted job has no confirmed remote cancellation. A raw interrupted fiber does not promise to return the domain error from its cleanup.

Studio and the landing use Pretext `1.0.0`. The landing bundles its public entry instead of copying private implementation files. Its VGPU `0.6.0` shaders are prepared during the build with the matching `@vgpu/wgsl` version. Rebuild the tracked vendor output when updating these packages; do not retain stale output after a failed build. See the [Pretext release notes](https://github.com/chenglou/pretext/releases/tag/v1.0.0) and [VGPU migration guide](https://github.com/vercel-labs/vgpu/blob/v0.6.0/docs/migrations/0.6.0.docs.md).

## Update workflow

1. Run `bun outdated` and `bun audit`. Review official release notes for the affected packages.
2. Identify the compatibility issue or feature that justifies each update. Keep unrelated versions unchanged.
3. Use `bun update` or explicit `bun add` commands. Do not edit `bun.lock` manually.
4. Run `bun install --frozen-lockfile`, then the affected migration check and `bun run validate` once at integration.
5. Record unresolved advisories and incompatible updates with their failing command. An outdated package is not, by itself, a failed gate.

See [Tooling](TOOLING.md) for the command and logging contracts.

## Provider currency

`bun run providers:preflight` checks the configured routes, credentials and local model catalogs without generating an image. It does not prove account quota or successful generation. Codex and Grok use their local model catalogs; Antigravity also discovers models from its CLI. Keep saved job model choices intact when updating provider defaults.

For local CLI maintenance, compare `codex --version` with the [Codex changelog](https://learn.chatgpt.com/docs/changelog), use `grok update --check --json`, and use Antigravity's `agy update`. Update through the CLI's existing installation method. A running server or CLI process may need a restart before using its newly installed version.

Hosted contracts are documented by [Google](https://ai.google.dev/gemini-api/docs/image-generation), [xAI](https://docs.x.ai/developers/model-capabilities/images/generation), [fal.ai](https://fal.ai/models/fal-ai/flux/schnell/api), and [ComfyUI](https://docs.comfy.org/development/comfyui-server/comms_routes). API model availability does not establish entitlement on ChatGPT's subscription endpoint; verify that route independently before changing its chat-model contract.
